import { expect, test } from "vitest";
import { DIFF_RGB, computeDiff } from "../../src/core/image-diff/diff-compute.js";

const rgba = values => new Uint8ClampedArray(values.flatMap(value => [value, value, value, 255]));

function base(overrides = {}) {
  return {
    oldData: rgba([0, 0, 255]),
    oldWidth: 3,
    oldHeight: 1,
    newData: rgba([0, 255, 0]),
    width: 3,
    height: 1,
    threshold: 128,
    radius: 0,
    block: 8,
    minBlocks: 2,
    needsImage: true,
    needsBoxes: true,
    ...overrides,
  };
}

test("colors common, removed and added pixels", () => {
  const result = computeDiff(base());

  expect([...result.image]).toEqual([
    60, 60, 60, 255,
    255, 91, 87, 255,
    77, 141, 255, 255,
  ]);
  expect(result.removed).toBe(1);
  expect(result.added).toBe(1);
});

test("leaves blank pixels white", () => {
  const result = computeDiff(base({
    oldData: rgba([255, 255, 255]),
    newData: rgba([255, 255, 255]),
  }));

  expect([...result.image]).toEqual([
    255, 255, 255, 255,
    255, 255, 255, 255,
    255, 255, 255, 255,
  ]);
  expect(result.removed).toBe(0);
  expect(result.added).toBe(0);
});

test("treats a missing old page as entirely added", () => {
  const result = computeDiff(base({ oldData: null, oldWidth: 0, oldHeight: 0 }));

  expect(result.removed).toBe(0);
  expect(result.added).toBe(2);
});

test("skips the image when needsImage is false", () => {
  const result = computeDiff(base({ needsImage: false }));

  expect(result.image).toBeNull();
  expect(result.removed).toBe(1);
  expect(result.added).toBe(1);
});

test("skips boxes when needsBoxes is false", () => {
  const result = computeDiff(base({
    width: 32,
    height: 32,
    oldWidth: 32,
    oldHeight: 32,
    oldData: new Uint8ClampedArray(32 * 32 * 4),
    newData: new Uint8ClampedArray(32 * 32 * 4).fill(255),
    needsBoxes: false,
  }));

  expect(result.boxes).toEqual([]);
});

test("finds a change box around a solid removed area", () => {
  const width = 32;
  const height = 32;
  const oldData = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < 20; y += 1) {
    for (let x = 0; x < 20; x += 1) {
      const pixel = (y * width + x) * 4;
      oldData[pixel] = 0;
      oldData[pixel + 1] = 0;
      oldData[pixel + 2] = 0;
    }
  }
  const newData = new Uint8ClampedArray(width * height * 4).fill(255);

  const result = computeDiff(base({
    oldData,
    oldWidth: width,
    oldHeight: height,
    newData,
    width,
    height,
  }));

  expect(result.boxes).toHaveLength(1);
  expect(result.boxes[0]).toMatchObject({ x: 0, y: 0 });
  expect(result.boxes[0].w).toBeGreaterThanOrEqual(20);
});

test("tolerates a shifted line when the radius covers the shift", () => {
  const width = 8;
  const height = 3;
  const oldData = new Uint8ClampedArray(width * height * 4).fill(255);
  const newData = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y += 1) {
    const oldPixel = (y * width + 2) * 4;
    oldData[oldPixel] = 0;
    oldData[oldPixel + 1] = 0;
    oldData[oldPixel + 2] = 0;
    const newPixel = (y * width + 3) * 4;
    newData[newPixel] = 0;
    newData[newPixel + 1] = 0;
    newData[newPixel + 2] = 0;
  }

  const strict = computeDiff(base({
    oldData, oldWidth: width, oldHeight: height, newData, width, height, radius: 0,
  }));
  const tolerant = computeDiff(base({
    oldData, oldWidth: width, oldHeight: height, newData, width, height, radius: 1,
  }));

  expect(strict.removed + strict.added).toBeGreaterThan(0);
  expect(tolerant.removed + tolerant.added).toBe(0);
});

test("reports monotonically increasing progress ending at one", () => {
  const ratios = [];
  computeDiff(base({
    width: 4,
    height: 64,
    oldWidth: 4,
    oldHeight: 64,
    oldData: new Uint8ClampedArray(4 * 64 * 4),
    newData: new Uint8ClampedArray(4 * 64 * 4).fill(255),
    onProgress: ratio => ratios.push(ratio),
  }));

  expect(ratios.length).toBeGreaterThan(0);
  expect(ratios.at(-1)).toBe(1);
  expect([...ratios].sort((a, b) => a - b)).toEqual(ratios);
});

test("reports monotonically increasing progress ending at one with tolerance radius", () => {
  const ratios = [];
  computeDiff(base({
    width: 4,
    height: 64,
    oldWidth: 4,
    oldHeight: 64,
    oldData: new Uint8ClampedArray(4 * 64 * 4),
    newData: new Uint8ClampedArray(4 * 64 * 4).fill(255),
    radius: 1,
    onProgress: ratio => ratios.push(ratio),
  }));

  expect(ratios.length).toBeGreaterThan(0);
  expect(ratios.at(-1)).toBe(1);
  expect([...ratios].sort((a, b) => a - b)).toEqual(ratios);
});

test("exposes the diff palette", () => {
  expect(DIFF_RGB.common).toEqual([60, 60, 60]);
  expect(DIFF_RGB.removed).toEqual([255, 91, 87]);
  expect(DIFF_RGB.added).toEqual([77, 141, 255]);
});
