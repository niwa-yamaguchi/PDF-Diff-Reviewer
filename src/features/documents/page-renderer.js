import { createWhiteCanvas } from "../../platform/canvas.js";

export async function pageSizePt(doc, pageIndex) {
  if (!doc || pageIndex == null || pageIndex >= doc.numPages) return null;
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: 1 });
  return { w: viewport.width, h: viewport.height };
}

export async function renderPageCanvas(doc, pageIndex, scale) {
  if (!doc || pageIndex == null || pageIndex >= doc.numPages) return null;
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale });
  const canvas = createWhiteCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas;
}

export function canvasToGrayF(canvas) {
  if (!canvas) return null;
  const { width, height } = canvas;
  const data = canvas.getContext("2d").getImageData(0, 0, width, height).data;
  const gray = new Float64Array(width * height);
  for (let index = 0, pixel = 0; index < gray.length; index += 1, pixel += 4) {
    gray[index] = 0.299 * data[pixel] + 0.587 * data[pixel + 1] + 0.114 * data[pixel + 2];
  }
  return { g: gray, w: width, h: height };
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
