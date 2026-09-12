import {
  boxStat,
  computeChangeBoxesAligned,
  createToggleCompletedIdentity,
  createToggleRawCacheIdentity,
  prepareVisualPage,
} from "./visual-renderer.js";

export function drawToggleSide(snapshot, cache, dependencies) {
  const canvas = dependencies.createWhiteCanvas(cache.width, cache.height);
  const context = canvas.getContext("2d");
  const side = snapshot.visual.toggleSide;
  const hasPage = side === "old" ? !!cache.oldCanvas : !!cache.newCanvas;
  if (hasPage) {
    context.drawImage(side === "old" ? cache.oldCanvas : cache.alignedNewCanvas, 0, 0);
  } else {
    context.fillStyle = "#7f8f9e";
    context.font = "20px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("この版にこのページはありません", canvas.width / 2, canvas.height / 2);
  }
  return canvas;
}

export async function renderTogglePage(snapshot, dependencies, { onProgress = null, cancellation = null } = {}) {
  const previous = snapshot.visual.toggleCache;
  const cachedPages = previous?.idx === snapshot.pageIndex ? previous : null;
  const prepared = await prepareVisualPage(snapshot, dependencies, cachedPages, onProgress, cancellation);
  const pageCache = {
    idx: snapshot.pageIndex,
    quad: prepared.quadrant,
    rawIdentity: createToggleRawCacheIdentity(
      snapshot,
      prepared.quadrant,
      prepared.currentPlan,
    ),
    completedIdentity: createToggleCompletedIdentity(snapshot),
    oldCanvas: prepared.oldCanvas,
    newCanvas: prepared.newCanvas,
    oldWidth: prepared.oldWidth,
    oldHeight: prepared.oldHeight,
    newWidth: prepared.newWidth,
    newHeight: prepared.newHeight,
    alignedNewCanvas: prepared.alignedNewCanvas,
    width: prepared.width,
    height: prepared.height,
  };
  const boxes = snapshot.boxEditor.manualBoxes != null
    ? snapshot.boxEditor.manualBoxes.map(box => ({ ...box }))
    : snapshot.boxEditor.showBoxes
      ? await computeChangeBoxesAligned(snapshot, prepared, dependencies, { onProgress })
      : [];
  const autoBoxes = snapshot.boxEditor.manualBoxes == null && snapshot.boxEditor.showBoxes
    ? boxes
    : undefined;
  const oldSnapshot = Object.freeze({
    ...snapshot,
    visual: Object.freeze({ ...snapshot.visual, toggleSide: "old" }),
  });
  const newSnapshot = Object.freeze({
    ...snapshot,
    visual: Object.freeze({ ...snapshot.visual, toggleSide: "new" }),
  });
  pageCache.sideCanvases = {
    old: drawToggleSide(oldSnapshot, pageCache, dependencies),
    new: drawToggleSide(newSnapshot, pageCache, dependencies),
  };
  return {
    canvas: pageCache.sideCanvases[snapshot.visual.toggleSide],
    currentPlan: prepared.currentPlan,
    alignmentCache: prepared.alignmentCache,
    quadrantCache: prepared.quadrantCache,
    quadrantGeneration: snapshot.visual.quadrantGeneration,
    toggleCache: pageCache,
    boxes,
    autoBoxes,
    stats: {
      removed: "削除 —",
      added: "追加 —",
      boxes: snapshot.boxEditor.showBoxes ? boxStat(snapshot, boxes) : "変更箇所 —",
    },
    status: `新旧切替（${snapshot.visual.toggleSide === "old" ? "OLD" : "NEW"}表示中）`,
    pageLabel: dependencies.pageLabelText(snapshot.documents, snapshot.pageIndex),
  };
}
