import { DIFF_RGB } from "../../core/image-diff/diff-compute.js";

const QUAD_PROBE_LONG = 512;
const BOX_BASE_DPI = 150;
const BOX_BASE = 16;
const BOX_MIN_PIXELS_AT_BASE = 4;

function blockSize(comparison) {
  return Math.max(4, Math.round(BOX_BASE * comparison.dpi / BOX_BASE_DPI));
}

// 変更枠は変更画素の面積で採否を決める。ブロック数だとマス目との位置関係で小さな変更が残ったり消えたりする。
function minChangePixels(comparison) {
  const ratio = comparison.dpi / BOX_BASE_DPI;
  return Math.max(2, Math.round(BOX_MIN_PIXELS_AT_BASE * ratio * ratio));
}

function toleranceRadiusPx(comparison) {
  return Math.round(comparison.tolerancePx * comparison.dpi / BOX_BASE_DPI);
}

async function ensureQuadrant(snapshot, indexes, sizes, cache, dependencies, cancellation) {
  const { comparison, documents, pageIndex } = snapshot;
  if (!comparison.autoAlign || cache.has(pageIndex)) return;
  if (!sizes.old || !sizes.new) {
    cache.set(pageIndex, { k: 0, scores: [1, 0, 0, 0], applied: false, blank: true });
    return;
  }
  const probeScale = page => QUAD_PROBE_LONG / Math.max(page.w, page.h);
  const [oldCanvas, newCanvas] = await Promise.all([
    dependencies.renderPageCanvas(documents.oldDoc, indexes.old, probeScale(sizes.old), { cancellation }),
    dependencies.renderPageCanvas(documents.newDoc, indexes.new, probeScale(sizes.new), { cancellation }),
  ]);
  const oldRgba = dependencies.canvasToRgba(oldCanvas);
  const newRgba = dependencies.canvasToRgba(newCanvas);
  if (!oldRgba || !newRgba) {
    cache.set(pageIndex, { k: 0, scores: [1, 0, 0, 0], applied: false, blank: true });
    return;
  }
  cache.set(pageIndex, await dependencies.computeQuadrant({
    oldData: oldRgba.data,
    oldWidth: oldRgba.width,
    oldHeight: oldRgba.height,
    newData: newRgba.data,
    newWidth: newRgba.width,
    newHeight: newRgba.height,
    threshold: comparison.threshold,
  }, { transfer: [oldRgba.data.buffer, newRgba.data.buffer] }));
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

export function createToggleRawCacheIdentity(snapshot, quadrant, framePlan) {
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

export function toggleRawCacheMatchesSnapshot(
  snapshot,
  cache,
  {
    quadrant = effectiveQuadrant(snapshot, snapshot.visual.quadrantCache),
    framePlan = snapshot.visual.currentPlan,
  } = {},
) {
  const identity = cache?.rawIdentity;
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

export function createToggleCompletedIdentity(snapshot) {
  return Object.freeze({
    renderGeneration: snapshot.visual.renderGeneration,
  });
}

export function toggleCompletedCacheMatchesSnapshot(snapshot, cache) {
  return cache?.completedIdentity?.renderGeneration === snapshot.visual.renderGeneration
    && toggleRawCacheMatchesSnapshot(snapshot, cache);
}

async function ensureAlignment(snapshot, oldCanvas, newCanvas, cache, dependencies) {
  if (!snapshot.comparison.autoAlign || cache.has(snapshot.pageIndex)) return;
  const scale = dependencies.alignProbeScale([oldCanvas, newCanvas]);
  const oldRgba = dependencies.canvasToRgba(dependencies.downscaleCanvas(oldCanvas, scale));
  const newRgba = dependencies.canvasToRgba(dependencies.downscaleCanvas(newCanvas, scale));
  if (!oldRgba || !newRgba) {
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
  cache.set(snapshot.pageIndex, await dependencies.computeAlignment({
    oldData: oldRgba.data,
    oldWidth: oldRgba.width,
    oldHeight: oldRgba.height,
    newData: newRgba.data,
    newWidth: newRgba.width,
    newHeight: newRgba.height,
    threshold: snapshot.comparison.threshold,
  }, { transfer: [oldRgba.data.buffer, newRgba.data.buffer] }));
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

export async function prepareVisualPage(
  snapshot,
  dependencies,
  cachedPages = null,
  onProgress = null,
  cancellation = null,
) {
  onProgress?.({ phase: "render" });
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
  await ensureQuadrant(snapshot, indexes, sizes, quadrantCache, dependencies, cancellation);
  const quadrant = effectiveQuadrant(snapshot, quadrantCache);
  const rotatedNewSize = sizes.new && quadrant % 2
    ? { w: sizes.new.h, h: sizes.new.w }
    : sizes.new;
  const currentPlan = dependencies.framePlan(
    sizes.old,
    rotatedNewSize,
    snapshot.comparison.dpi,
  );
  const reusablePages = toggleRawCacheMatchesSnapshot(snapshot, cachedPages, {
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
        { cancellation },
      ),
      dependencies.renderPageCanvas(
        snapshot.documents.newDoc,
        indexes.new,
        currentPlan.newScale,
        { cancellation },
      ),
    ]);
    oldCanvas = renderedOld;
    newCanvas = dependencies.rotateCanvas90(renderedNew, quadrant);
  }
  if (snapshot.comparison.autoAlign) onProgress?.({ phase: "align" });
  await ensureAlignment(snapshot, oldCanvas, newCanvas, alignmentCache, dependencies);
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

function diffRequest(comparison, prepared, { needsImage, needsBoxes }) {
  const oldData = prepared.oldImage?.data ?? null;
  const newData = prepared.alignedNewImage.data;
  const transfer = [newData.buffer];
  if (oldData) transfer.push(oldData.buffer);
  return {
    payload: {
      oldData,
      oldWidth: prepared.oldWidth,
      oldHeight: prepared.oldHeight,
      newData,
      width: prepared.width,
      height: prepared.height,
      threshold: comparison.threshold,
      radius: toleranceRadiusPx(comparison),
      block: blockSize(comparison),
      minPixels: minChangePixels(comparison),
      needsImage,
      needsBoxes,
    },
    transfer,
  };
}

function runDiff(snapshot, prepared, dependencies, flags, onProgress) {
  const { payload, transfer } = diffRequest(snapshot.comparison, prepared, flags);
  return dependencies.computeDiff(payload, {
    transfer,
    onProgress: onProgress ? ratio => onProgress({ phase: "diff", ratio }) : null,
  });
}

export async function computeChangeBoxesAligned(
  snapshot,
  prepared,
  dependencies,
  { onProgress = null } = {},
) {
  const computed = await runDiff(
    snapshot,
    prepared,
    dependencies,
    { needsImage: false, needsBoxes: true },
    onProgress,
  );
  return computed.boxes;
}

function boxStat(snapshot, boxes) {
  const edited = snapshot.boxEditor.manualBoxes != null;
  return `変更箇所 ${boxes.length.toLocaleString()}${edited ? "（手編集）" : ""}`;
}

export async function renderChangeIndexPage(snapshot, dependencies, options = {}) {
  const prepared = await prepareVisualPage(
    snapshot, dependencies, null, options.onProgress, options.cancellation,
  );
  const boxes = await computeChangeBoxesAligned(snapshot, prepared, dependencies, options);
  return { boxes, width: prepared.width, height: prepared.height };
}

export async function renderDiffPage(snapshot, dependencies, { onProgress = null, cancellation = null } = {}) {
  const prepared = await prepareVisualPage(snapshot, dependencies, null, onProgress, cancellation);
  const canvas = dependencies.createCanvas(prepared.width, prepared.height);
  const context = canvas.getContext("2d");
  const needsBoxes = snapshot.boxEditor.manualBoxes == null;
  const computed = await runDiff(
    snapshot,
    prepared,
    dependencies,
    { needsImage: true, needsBoxes },
    onProgress,
  );
  context.putImageData(
    new ImageData(computed.image, prepared.width, prepared.height),
    0,
    0,
  );
  const removedCount = computed.removed;
  const addedCount = computed.added;
  const autoBoxes = needsBoxes ? computed.boxes : undefined;
  const boxes = needsBoxes
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

export { DIFF_RGB, boxStat };
