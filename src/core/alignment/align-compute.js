import { bestQuadrant } from "./quadrant.js";
import { bestAlignment } from "./similarity.js";

export function grayFromRgba(data, width, height) {
  const gray = new Float64Array(width * height);
  for (let index = 0, pixel = 0; index < gray.length; index += 1, pixel += 4) {
    gray[index] = 0.299 * data[pixel] + 0.587 * data[pixel + 1] + 0.114 * data[pixel + 2];
  }
  return { g: gray, w: width, h: height };
}

function pair({ oldData, oldWidth, oldHeight, newData, newWidth, newHeight }) {
  return [
    grayFromRgba(oldData, oldWidth, oldHeight),
    grayFromRgba(newData, newWidth, newHeight),
  ];
}

export function computeAlignment(payload) {
  const [oldGray, newGray] = pair(payload);
  return bestAlignment(oldGray, newGray, payload.threshold);
}

export function computeQuadrant(payload) {
  const [oldGray, newGray] = pair(payload);
  return bestQuadrant(oldGray, newGray, payload.threshold);
}
