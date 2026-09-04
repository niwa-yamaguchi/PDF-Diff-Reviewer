import { drawChangeBoxes } from "../../core/change-boxes/draw.js";
import {
  boxStat,
  computeChangeBoxesAligned,
  createVisualRawCacheIdentity,
  prepareVisualPage,
} from "./visual-renderer.js";

function copyBoxes(boxes) {
  return boxes.map(box => ({ ...box }));
}

function sideFrame(source, width, height, boxes, dpi, dependencies) {
  const canvas = dependencies.createWhiteCanvas(width, height);
  const context = canvas.getContext("2d");
  if (source) {
    context.drawImage(source, 0, 0);
  } else {
    context.fillStyle = "#7f8f9e";
    context.font = "20px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("この版にこのページはありません", width / 2, height / 2);
  }
  drawChangeBoxes(context, boxes, dpi);
  return canvas;
}

export async function renderSplitPage(snapshot, dependencies, { onProgress = null } = {}) {
  const cached = snapshot.visual.splitCache?.idx === snapshot.pageIndex
    ? snapshot.visual.splitCache
    : null;
  const prepared = await prepareVisualPage(snapshot, dependencies, cached, onProgress);
  let boxes = snapshot.boxEditor.manualBoxes || snapshot.boxEditor.autoBoxes;
  let autoBoxes;
  if (!boxes) {
    boxes = await computeChangeBoxesAligned(snapshot, prepared, dependencies, { onProgress });
    autoBoxes = boxes;
  } else {
    boxes = copyBoxes(boxes);
  }
  const oldSource = sideFrame(
    prepared.oldCanvas,
    prepared.width,
    prepared.height,
    boxes,
    snapshot.comparison.dpi,
    dependencies,
  );
  const newSource = sideFrame(
    prepared.newCanvas ? prepared.alignedNewCanvas : null,
    prepared.width,
    prepared.height,
    boxes,
    snapshot.comparison.dpi,
    dependencies,
  );
  const splitCache = {
    idx: snapshot.pageIndex,
    rawIdentity: createVisualRawCacheIdentity(snapshot, prepared.quadrant, prepared.currentPlan),
    oldCanvas: prepared.oldCanvas,
    newCanvas: prepared.newCanvas,
    alignedNewCanvas: prepared.alignedNewCanvas,
    width: prepared.width,
    height: prepared.height,
  };
  return {
    sideCanvases: { old: oldSource, new: newSource },
    splitCache,
    currentPlan: prepared.currentPlan,
    alignmentCache: prepared.alignmentCache,
    quadrantCache: prepared.quadrantCache,
    quadrantGeneration: snapshot.visual.quadrantGeneration,
    boxes,
    autoBoxes,
    stats: {
      removed: "削除 —",
      added: "追加 —",
      boxes: boxStat(snapshot, boxes),
    },
    status: "左右表示中",
    pageLabel: dependencies.pageLabelText(snapshot.documents, snapshot.pageIndex),
  };
}
