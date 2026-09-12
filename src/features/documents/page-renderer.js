import { createWhiteCanvas } from "../../platform/canvas.js";
import { renderCancelledError } from "../../core/rendering/cancellation.js";

export async function pageSizePt(doc, pageIndex) {
  if (!doc || pageIndex == null || pageIndex >= doc.numPages) return null;
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: 1 });
  return { w: viewport.width, h: viewport.height };
}

export async function renderPageCanvas(doc, pageIndex, scale, { cancellation } = {}) {
  if (!doc || pageIndex == null || pageIndex >= doc.numPages) return null;
  if (cancellation?.cancelled) throw renderCancelledError();
  const page = await doc.getPage(pageIndex + 1);
  if (cancellation?.cancelled) throw renderCancelledError();
  const viewport = page.getViewport({ scale });
  const canvas = createWhiteCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  const renderTask = page.render({ canvasContext: context, viewport });
  const unregister = cancellation?.onCancel?.(() => renderTask.cancel()) || (() => {});
  try {
    await renderTask.promise;
  } catch (error) {
    if (cancellation?.cancelled || error?.name === "RenderingCancelledException") {
      throw renderCancelledError();
    }
    throw error;
  } finally {
    unregister();
  }
  return canvas;
}

export const ALIGN_PROBE_LONG = 512;

export function canvasToRgba(canvas) {
  if (!canvas) return null;
  const { width, height } = canvas;
  const { data } = canvas.getContext("2d").getImageData(0, 0, width, height);
  return { data, width, height };
}

export function alignProbeScale(canvases, longEdge = ALIGN_PROBE_LONG) {
  let long = 0;
  for (const canvas of canvases) {
    if (!canvas) continue;
    long = Math.max(long, canvas.width, canvas.height);
  }
  return long > longEdge ? longEdge / long : 1;
}

export function downscaleCanvas(canvas, scale) {
  if (!canvas || scale >= 1) return canvas;
  const target = createWhiteCanvas(
    Math.max(1, Math.round(canvas.width * scale)),
    Math.max(1, Math.round(canvas.height * scale)),
  );
  const context = target.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(canvas, 0, 0, target.width, target.height);
  return target;
}

export function rotateCanvas90(canvas, quarterTurns) {
  const turns = ((quarterTurns % 4) + 4) % 4;
  if (!canvas || turns === 0) return canvas;
  const rotated = createWhiteCanvas(
    turns === 2 ? canvas.width : canvas.height,
    turns === 2 ? canvas.height : canvas.width,
  );
  const context = rotated.getContext("2d");
  context.imageSmoothingEnabled = false;
  if (turns === 1) context.setTransform(0, 1, -1, 0, canvas.height, 0);
  else if (turns === 2) context.setTransform(-1, 0, 0, -1, canvas.width, canvas.height);
  else context.setTransform(0, -1, 1, 0, 0, canvas.width);
  context.drawImage(canvas, 0, 0);
  return rotated;
}
