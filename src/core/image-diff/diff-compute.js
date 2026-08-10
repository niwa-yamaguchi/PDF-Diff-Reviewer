import { computeBoxes } from "../change-boxes/detect.js";
import { clampBoxes } from "../geometry/rectangles.js";
import { luminanceAt } from "./luminance.js";
import { toleratedDiffMasks } from "./masks.js";

export const DIFF_RGB = Object.freeze({
  common: Object.freeze([60, 60, 60]),
  removed: Object.freeze([255, 91, 87]),
  added: Object.freeze([77, 141, 255]),
});

const PROGRESS_STEPS = 20;
const MASK_PHASE = 0.4;
const DILATE_PHASE = 0.6;

function progressReporter(onProgress) {
  if (!onProgress) return () => {};
  let reported = -1;
  return ratio => {
    const clamped = Math.min(1, Math.max(0, ratio));
    const step = Math.round(clamped * PROGRESS_STEPS);
    if (step <= reported) return;
    reported = step;
    onProgress(step / PROGRESS_STEPS);
  };
}

function paint(image, index, [red, green, blue]) {
  if (!image) return;
  const pixel = index * 4;
  image[pixel] = red;
  image[pixel + 1] = green;
  image[pixel + 2] = blue;
}

export function computeDiff({
  oldData = null,
  oldWidth = 0,
  oldHeight = 0,
  newData,
  width,
  height,
  threshold,
  radius = 0,
  block,
  minBlocks,
  needsImage = true,
  needsBoxes = true,
  onProgress = null,
}) {
  const report = progressReporter(onProgress);
  const columns = Math.ceil(width / block);
  const rows = Math.ceil(height / block);
  const flags = new Uint8Array(columns * rows);
  const image = needsImage ? new Uint8ClampedArray(width * height * 4) : null;
  if (image) image.fill(255);
  let removedCount = 0;
  let addedCount = 0;

  const flag = (x, y) => {
    flags[Math.floor(y / block) * columns + Math.floor(x / block)] = 1;
  };

  if (radius > 0) {
    const oldMask = new Uint8Array(width * height);
    const newMask = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (oldData && x < oldWidth && y < oldHeight) {
          oldMask[index] = luminanceAt(oldData, (y * oldWidth + x) * 4) < threshold ? 1 : 0;
        }
        newMask[index] = luminanceAt(newData, index * 4) < threshold ? 1 : 0;
      }
      report(((y + 1) / height) * MASK_PHASE);
    }
    const { removed, added } = toleratedDiffMasks(oldMask, newMask, width, height, radius);
    report(DILATE_PHASE);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (!(oldMask[index] || newMask[index])) continue;
        if (removed[index]) {
          paint(image, index, DIFF_RGB.removed);
          removedCount += 1;
          flag(x, y);
        } else if (added[index]) {
          paint(image, index, DIFF_RGB.added);
          addedCount += 1;
          flag(x, y);
        } else {
          paint(image, index, DIFF_RGB.common);
        }
      }
      report(DILATE_PHASE + ((y + 1) / height) * (1 - DILATE_PHASE));
    }
  } else {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const oldInk = !!oldData
          && x < oldWidth
          && y < oldHeight
          && luminanceAt(oldData, (y * oldWidth + x) * 4) < threshold;
        const newInk = luminanceAt(newData, (y * width + x) * 4) < threshold;
        if (!(oldInk || newInk)) continue;
        const index = y * width + x;
        if (oldInk && newInk) {
          paint(image, index, DIFF_RGB.common);
        } else if (oldInk) {
          paint(image, index, DIFF_RGB.removed);
          removedCount += 1;
          flag(x, y);
        } else {
          paint(image, index, DIFF_RGB.added);
          addedCount += 1;
          flag(x, y);
        }
      }
      report((y + 1) / height);
    }
  }

  report(1);
  return {
    image,
    removed: removedCount,
    added: addedCount,
    boxes: needsBoxes
      ? clampBoxes(computeBoxes(flags, columns, rows, block, minBlocks), width, height)
      : [],
  };
}
