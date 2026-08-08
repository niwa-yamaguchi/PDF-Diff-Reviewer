import { bestAlignment } from "../../core/alignment/similarity.js";
import { bestQuadrant } from "../../core/alignment/quadrant.js";
import { computeBoxes } from "../../core/change-boxes/detect.js";
import { clampBoxes } from "../../core/geometry/rectangles.js";
import { luminanceAt } from "../../core/image-diff/luminance.js";
import { toleratedDiffMasks } from "../../core/image-diff/masks.js";

const QUAD_PROBE_LONG = 512;
const BOX_BASE_DPI = 150;
const BOX_BASE = 16;
const BOX_MIN_BLOCKS = 2;

export const DIFF_RGB = Object.freeze({
  common: Object.freeze([60, 60, 60]),
  removed: Object.freeze([255, 91, 87]),
  added: Object.freeze([77, 141, 255]),
});

function blockSize(comparison) {
  return Math.max(4, Math.round(BOX_BASE * comparison.dpi / BOX_BASE_DPI));
}

function toleranceRadiusPx(comparison) {
  return Math.round(comparison.tolerancePx * comparison.dpi / BOX_BASE_DPI);
}

async function ensureQuadrant(snapshot, indexes, sizes, cache, dependencies) {
  const { comparison, documents, pageIndex } = snapshot;
  if (!comparison.autoAlign || cache.has(pageIndex)) return;
  if (!sizes.old || !sizes.new) {
    cache.set(pageIndex, { k: 0, scores: [1, 0, 0, 0], applied: false, blank: true });
    return;
  }
  const probeScale = page => QUAD_PROBE_LONG / Math.max(page.w, page.h);
  const [oldCanvas, newCanvas] = await Promise.all([
    dependencies.renderPageCanvas(documents.oldDoc, indexes.old, probeScale(sizes.old)),
    dependencies.renderPageCanvas(documents.newDoc, indexes.new, probeScale(sizes.new)),
  ]);
  const oldGray = dependencies.canvasToGrayF(oldCanvas);
  const newGray = dependencies.canvasToGrayF(newCanvas);
  if (!oldGray || !newGray) {
    cache.set(pageIndex, { k: 0, scores: [1, 0, 0, 0], applied: false, blank: true });
    return;
  }
  cache.set(pageIndex, bestQuadrant(oldGray, newGray, comparison.threshold));
}

export function effectiveQuadrant(snapshot, quadrantCache) {
  const manual = snapshot.comparison.quadrantManual.get(snapshot.pageIndex);
  if (manual != null) return manual;
  if (!snapshot.comparison.autoAlign) return 0;
  const estimate = quadrantCache.get(snapshot.pageIndex);
  return estimate?.applied ? estimate.k : 0;
}

function sameFramePlan(left, right) {
  if (!left || !right) return false;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every(key => Object.is(left[key], right[key]));
}

export function createToggleCacheIdentity(snapshot, quadrant, framePlan) {
  return Object.freeze({
    documentGeneration: snapshot.documents.generation,
    oldDoc: snapshot.documents.oldDoc,
    newDoc: snapshot.documents.newDoc,
    oldIndex: snapshot.documents.oldSequence[snapshot.pageIndex] ?? null,
    newIndex: snapshot.documents.newSequence[snapshot.pageIndex] ?? null,
    dpi: snapshot.comparison.dpi,
    quadrant,
    framePlan: Object.freeze({ ...framePlan }),
  });
}

export function toggleCacheMatchesSnapshot(
  snapshot,
  cache,
  {
    quadrant = effectiveQuadrant(snapshot, snapshot.visual.quadrantCache),
    framePlan = snapshot.visual.currentPlan,
  } = {},
) {
  const identity = cache?.identity;
  return !!identity
    && cache.idx === snapshot.pageIndex
    && identity.documentGeneration === snapshot.documents.generation
    && identity.oldDoc === snapshot.documents.oldDoc
    && identity.newDoc === snapshot.documents.newDoc
    && identity.oldIndex === (snapshot.documents.oldSequence[snapshot.pageIndex] ?? null)
    && identity.newIndex === (snapshot.documents.newSequence[snapshot.pageIndex] ?? null)
    && identity.dpi === snapshot.comparison.dpi
    && identity.quadrant === quadrant
    && sameFramePlan(identity.framePlan, framePlan);
}

function ensureAlignment(snapshot, oldCanvas, newCanvas, cache, dependencies) {
  if (!snapshot.comparison.autoAlign || cache.has(snapshot.pageIndex)) return;
  const oldGray = dependencies.canvasToGrayF(oldCanvas);
  const newGray = dependencies.canvasToGrayF(newCanvas);
  if (!oldGray || !newGray) {
    cache.set(snapshot.pageIndex, {
      angle: 0,
      scale: 1,
      txFrac: 0,
      tyFrac: 0,
      applied: false,
      method: "identity",
      scoreBase: 1,
      scoreBest: 1,
      blank: true,
    });
    return;
  }
  cache.set(
    snapshot.pageIndex,
    bestAlignment(oldGray, newGray, snapshot.comparison.threshold),
  );
}

function alignmentMatrix(snapshot, cache, oldWidth, oldHeight, newWidth, newHeight) {
  const automatic = snapshot.comparison.autoAlign
    ? cache.get(snapshot.pageIndex)
    : null;
  const automaticOn = !!automatic?.applied;
  const angle = (automaticOn ? automatic.angle : 0) + snapshot.comparison.manualAngle;
  const scale = (automaticOn ? automatic.scale : 1) * snapshot.comparison.manualScale;
  const frameWidth = Math.max(oldWidth, newWidth);
  const frameHeight = Math.max(oldHeight, newHeight);
  return {
    angle,
    scale,
    tx: automaticOn ? automatic.txFrac * frameWidth : 0,
    ty: automaticOn ? automatic.tyFrac * frameHeight : 0,
    applied: automaticOn
      || snapshot.comparison.manualAngle !== 0
      || snapshot.comparison.manualScale !== 1,
  };
}

function alignedNewBounds(newCanvas, matrix, comparison) {
  if (!newCanvas || !matrix.applied) return null;
  const centerX = newCanvas.width / 2;
  const centerY = newCanvas.height / 2;
  const cos = Math.cos(matrix.angle) * matrix.scale;
  const sin = Math.sin(matrix.angle) * matrix.scale;
  const e = centerX + matrix.tx + comparison.dx - (cos * centerX - sin * centerY);
  const f = centerY + matrix.ty + comparison.dy - (sin * centerX + cos * centerY);
  const corners = [
    [0, 0],
    [newCanvas.width, 0],
    [0, newCanvas.height],
    [newCanvas.width, newCanvas.height],
  ];
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of corners) {
    x1 = Math.max(x1, cos * x - sin * y + e);
    y1 = Math.max(y1, sin * x + cos * y + f);
  }
  return { x1, y1 };
}

function renderAlignedNewCanvas(newCanvas, matrix, width, height, comparison, dependencies) {
  const canvas = dependencies.createWhiteCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!newCanvas) return canvas;
  const centerX = newCanvas.width / 2;
  const centerY = newCanvas.height / 2;
  if (matrix.applied) {
    const cos = Math.cos(matrix.angle) * matrix.scale;
    const sin = Math.sin(matrix.angle) * matrix.scale;
    const e = centerX + matrix.tx + comparison.dx;
    const f = centerY + matrix.ty + comparison.dy;
    context.setTransform(
      cos,
      sin,
      -sin,
      cos,
      e - (cos * centerX - sin * centerY),
      f - (sin * centerX + cos * centerY),
    );
    context.drawImage(newCanvas, 0, 0);
    context.setTransform(1, 0, 0, 1, 0, 0);
  } else {
    context.drawImage(newCanvas, comparison.dx, comparison.dy);
  }
  return canvas;
}

function workFrame(oldCanvas, newCanvas, matrix, comparison) {
  const oldWidth = oldCanvas?.width || 0;
  const oldHeight = oldCanvas?.height || 0;
  const newWidth = newCanvas?.width || 0;
  const newHeight = newCanvas?.height || 0;
  const warpedBounds = alignedNewBounds(newCanvas, matrix, comparison);
  let width = Math.max(oldWidth, newWidth + Math.max(0, comparison.dx))
    || Math.max(oldWidth, newWidth);
  let height = Math.max(oldHeight, newHeight + Math.max(0, comparison.dy))
    || Math.max(oldHeight, newHeight);
  if (warpedBounds) {
    width = Math.max(width, Math.ceil(warpedBounds.x1));
    height = Math.max(height, Math.ceil(warpedBounds.y1));
  }
  return {
    oldWidth,
    oldHeight,
    newWidth,
    newHeight,
    width: Math.max(oldWidth, newWidth, width, 1),
    height: Math.max(oldHeight, newHeight, height, 1),
  };
}

export async function prepareVisualPage(snapshot, dependencies, cachedPages = null) {
  const quadrantCache = new Map(snapshot.visual.quadrantCache);
  const alignmentCache = new Map(snapshot.visual.alignmentCache);
  const indexes = {
    old: dependencies.sequenceIndex(snapshot.documents.oldSequence, snapshot.pageIndex),
    new: dependencies.sequenceIndex(snapshot.documents.newSequence, snapshot.pageIndex),
  };
  const [oldSize, newSize] = await Promise.all([
    dependencies.pageSizePt(snapshot.documents.oldDoc, indexes.old),
    dependencies.pageSizePt(snapshot.documents.newDoc, indexes.new),
  ]);
  const sizes = { old: oldSize, new: newSize };
  await ensureQuadrant(snapshot, indexes, sizes, quadrantCache, dependencies);
  const quadrant = effectiveQuadrant(snapshot, quadrantCache);
  const rotatedNewSize = sizes.new && quadrant % 2
    ? { w: sizes.new.h, h: sizes.new.w }
    : sizes.new;
  const currentPlan = dependencies.framePlan(
    sizes.old,
    rotatedNewSize,
    snapshot.comparison.dpi,
  );
  const reusablePages = toggleCacheMatchesSnapshot(snapshot, cachedPages, {
    quadrant,
    framePlan: currentPlan,
  }) ? cachedPages : null;
  let oldCanvas = reusablePages?.oldCanvas;
  let newCanvas = reusablePages?.newCanvas;
  if (!reusablePages) {
    const [renderedOld, renderedNew] = await Promise.all([
      dependencies.renderPageCanvas(
        snapshot.documents.oldDoc,
        indexes.old,
        currentPlan.oldScale,
      ),
      dependencies.renderPageCanvas(
        snapshot.documents.newDoc,
        indexes.new,
        currentPlan.newScale,
      ),
    ]);
    oldCanvas = renderedOld;
    newCanvas = dependencies.rotateCanvas90(renderedNew, quadrant);
  }
  ensureAlignment(snapshot, oldCanvas, newCanvas, alignmentCache, dependencies);
  const frame = workFrame(
    oldCanvas,
    newCanvas,
    alignmentMatrix(
      snapshot,
      alignmentCache,
      oldCanvas?.width || 0,
      oldCanvas?.height || 0,
      newCanvas?.width || 0,
      newCanvas?.height || 0,
    ),
    snapshot.comparison,
  );
  const matrix = alignmentMatrix(
    snapshot,
    alignmentCache,
    frame.oldWidth,
    frame.oldHeight,
    frame.newWidth,
    frame.newHeight,
  );
  const alignedNewCanvas = renderAlignedNewCanvas(
    newCanvas,
    matrix,
    frame.width,
    frame.height,
    snapshot.comparison,
    dependencies,
  );
  const oldImage = oldCanvas
    ? oldCanvas.getContext("2d").getImageData(0, 0, frame.oldWidth, frame.oldHeight)
    : null;
  const alignedNewImage = alignedNewCanvas
    .getContext("2d")
    .getImageData(0, 0, frame.width, frame.height);
  return {
    indexes,
    quadrant,
    currentPlan,
    quadrantCache,
    alignmentCache,
    oldCanvas,
    newCanvas,
    alignedNewCanvas,
    oldImage,
    alignedNewImage,
    ...frame,
  };
}

export function computeChangeBoxesAligned(snapshot, prepared) {
  const { comparison } = snapshot;
  const {
    oldImage,
    oldWidth,
    oldHeight,
    alignedNewImage,
    width,
    height,
  } = prepared;
  const block = blockSize(comparison);
  const columns = Math.ceil(width / block);
  const rows = Math.ceil(height / block);
  const flags = new Uint8Array(columns * rows);
  const radius = toleranceRadiusPx(comparison);
  if (radius > 0) {
    const oldMask = new Uint8Array(width * height);
    const newMask = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (oldImage && x < oldWidth && y < oldHeight) {
          oldMask[index] = luminanceAt(oldImage.data, (y * oldWidth + x) * 4) < comparison.threshold ? 1 : 0;
        }
        newMask[index] = luminanceAt(alignedNewImage.data, index * 4) < comparison.threshold ? 1 : 0;
      }
    }
    const { removed, added } = toleratedDiffMasks(oldMask, newMask, width, height, radius);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (removed[index] || added[index]) {
          flags[Math.floor(y / block) * columns + Math.floor(x / block)] = 1;
        }
      }
    }
  } else {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const oldInk = !!oldImage
          && x < oldWidth
          && y < oldHeight
          && luminanceAt(oldImage.data, (y * oldWidth + x) * 4) < comparison.threshold;
        const newInk = luminanceAt(alignedNewImage.data, (y * width + x) * 4) < comparison.threshold;
        if (oldInk !== newInk) {
          flags[Math.floor(y / block) * columns + Math.floor(x / block)] = 1;
        }
      }
    }
  }
  return clampBoxes(
    computeBoxes(flags, columns, rows, block, BOX_MIN_BLOCKS),
    width,
    height,
  );
}

function boxStat(snapshot, boxes) {
  const edited = snapshot.boxEditor.manualBoxes != null;
  return `変更箇所 ${boxes.length.toLocaleString()}${edited ? "（手編集）" : ""}`;
}

export async function renderDiffPage(snapshot, dependencies) {
  const prepared = await prepareVisualPage(snapshot, dependencies);
  const canvas = dependencies.createCanvas(prepared.width, prepared.height);
  const context = canvas.getContext("2d");
  const image = context.createImageData(prepared.width, prepared.height);
  image.data.fill(255);
  const block = blockSize(snapshot.comparison);
  const columns = Math.ceil(prepared.width / block);
  const rows = Math.ceil(prepared.height / block);
  const flags = new Uint8Array(columns * rows);
  const radius = toleranceRadiusPx(snapshot.comparison);
  const [commonRed, commonGreen, commonBlue] = DIFF_RGB.common;
  const [removedRed, removedGreen, removedBlue] = DIFF_RGB.removed;
  const [addedRed, addedGreen, addedBlue] = DIFF_RGB.added;
  let removedCount = 0;
  let addedCount = 0;

  if (radius > 0) {
    const oldMask = new Uint8Array(prepared.width * prepared.height);
    const newMask = new Uint8Array(prepared.width * prepared.height);
    for (let y = 0; y < prepared.height; y += 1) {
      for (let x = 0; x < prepared.width; x += 1) {
        const index = y * prepared.width + x;
        if (prepared.oldImage && x < prepared.oldWidth && y < prepared.oldHeight) {
          oldMask[index] = luminanceAt(
            prepared.oldImage.data,
            (y * prepared.oldWidth + x) * 4,
          ) < snapshot.comparison.threshold ? 1 : 0;
        }
        newMask[index] = luminanceAt(
          prepared.alignedNewImage.data,
          index * 4,
        ) < snapshot.comparison.threshold ? 1 : 0;
      }
    }
    const { removed, added } = toleratedDiffMasks(
      oldMask,
      newMask,
      prepared.width,
      prepared.height,
      radius,
    );
    for (let y = 0; y < prepared.height; y += 1) {
      for (let x = 0; x < prepared.width; x += 1) {
        const index = y * prepared.width + x;
        if (!(oldMask[index] || newMask[index])) continue;
        const pixel = index * 4;
        if (removed[index]) {
          image.data[pixel] = removedRed;
          image.data[pixel + 1] = removedGreen;
          image.data[pixel + 2] = removedBlue;
          removedCount += 1;
          flags[Math.floor(y / block) * columns + Math.floor(x / block)] = 1;
        } else if (added[index]) {
          image.data[pixel] = addedRed;
          image.data[pixel + 1] = addedGreen;
          image.data[pixel + 2] = addedBlue;
          addedCount += 1;
          flags[Math.floor(y / block) * columns + Math.floor(x / block)] = 1;
        } else {
          image.data[pixel] = commonRed;
          image.data[pixel + 1] = commonGreen;
          image.data[pixel + 2] = commonBlue;
        }
      }
    }
  } else {
    for (let y = 0; y < prepared.height; y += 1) {
      for (let x = 0; x < prepared.width; x += 1) {
        const oldInk = !!prepared.oldImage
          && x < prepared.oldWidth
          && y < prepared.oldHeight
          && luminanceAt(
            prepared.oldImage.data,
            (y * prepared.oldWidth + x) * 4,
          ) < snapshot.comparison.threshold;
        const newInk = luminanceAt(
          prepared.alignedNewImage.data,
          (y * prepared.width + x) * 4,
        ) < snapshot.comparison.threshold;
        if (!(oldInk || newInk)) continue;
        const pixel = (y * prepared.width + x) * 4;
        if (oldInk && newInk) {
          image.data[pixel] = commonRed;
          image.data[pixel + 1] = commonGreen;
          image.data[pixel + 2] = commonBlue;
        } else if (oldInk) {
          image.data[pixel] = removedRed;
          image.data[pixel + 1] = removedGreen;
          image.data[pixel + 2] = removedBlue;
          removedCount += 1;
          flags[Math.floor(y / block) * columns + Math.floor(x / block)] = 1;
        } else {
          image.data[pixel] = addedRed;
          image.data[pixel + 1] = addedGreen;
          image.data[pixel + 2] = addedBlue;
          addedCount += 1;
          flags[Math.floor(y / block) * columns + Math.floor(x / block)] = 1;
        }
      }
    }
  }
  context.putImageData(image, 0, 0);
  const autoBoxes = snapshot.boxEditor.manualBoxes == null
    ? clampBoxes(
      computeBoxes(flags, columns, rows, block, BOX_MIN_BLOCKS),
      prepared.width,
      prepared.height,
    )
    : undefined;
  const boxes = snapshot.boxEditor.manualBoxes == null
    ? autoBoxes
    : snapshot.boxEditor.manualBoxes.map(box => ({ ...box }));
  return {
    canvas,
    currentPlan: prepared.currentPlan,
    alignmentCache: prepared.alignmentCache,
    quadrantCache: prepared.quadrantCache,
    quadrantGeneration: snapshot.visual.quadrantGeneration,
    boxes,
    autoBoxes,
    cacheEntry: { rm: removedCount, ad: addedCount, bx: boxes.length },
    stats: {
      removed: `削除 ${removedCount.toLocaleString()}`,
      added: `追加 ${addedCount.toLocaleString()}`,
      boxes: boxStat(snapshot, boxes),
    },
    status: removedCount + addedCount === 0 ? "差分なし" : "差分を表示中",
    pageLabel: dependencies.pageLabelText(snapshot.documents, snapshot.pageIndex),
  };
}

export { boxStat };
