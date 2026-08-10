import { expect, test } from "vitest";
import {
  computeAlignment,
  computeQuadrant,
  grayFromRgba,
} from "../../src/core/alignment/align-compute.js";

function inkCanvas(width, height, draw) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  draw((x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const pixel = (y * width + x) * 4;
    data[pixel] = 0;
    data[pixel + 1] = 0;
    data[pixel + 2] = 0;
  });
  return { data, width, height };
}

test("converts RGBA to a luminance grid", () => {
  const data = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);

  const gray = grayFromRgba(data, 2, 1);

  expect(gray.w).toBe(2);
  expect(gray.h).toBe(1);
  expect(gray.g[0]).toBeCloseTo(0, 6);
  expect(gray.g[1]).toBeCloseTo(255, 6);
});

test("reports no alignment for identical pages", () => {
  const page = inkCanvas(64, 64, set => {
    for (let y = 10; y < 50; y += 1) set(20, y);
    for (let x = 20; x < 44; x += 1) set(x, 10);
  });

  const result = computeAlignment({
    oldData: page.data,
    oldWidth: page.width,
    oldHeight: page.height,
    newData: page.data,
    newWidth: page.width,
    newHeight: page.height,
    threshold: 128,
  });

  expect(result.applied).toBe(false);
  expect(result.method).toBe("identity");
});

test("detects a horizontal shift between pages", () => {
  const original = inkCanvas(64, 64, set => {
    for (let y = 10; y < 50; y += 1) set(20, y);
    for (let x = 20; x < 44; x += 1) set(x, 10);
  });
  const shifted = inkCanvas(64, 64, set => {
    for (let y = 10; y < 50; y += 1) set(28, y);
    for (let x = 28; x < 52; x += 1) set(x, 10);
  });

  const result = computeAlignment({
    oldData: original.data,
    oldWidth: 64,
    oldHeight: 64,
    newData: shifted.data,
    newWidth: 64,
    newHeight: 64,
    threshold: 128,
  });

  expect(result.applied).toBe(true);
  expect(result.txFrac).toBeLessThan(0);
});

test("keeps the upright quadrant for identical pages", () => {
  const page = inkCanvas(64, 64, set => {
    for (let x = 8; x < 40; x += 1) set(x, 12);
  });

  const result = computeQuadrant({
    oldData: page.data,
    oldWidth: 64,
    oldHeight: 64,
    newData: page.data,
    newWidth: 64,
    newHeight: 64,
    threshold: 128,
  });

  expect(result.k).toBe(0);
  expect(result.applied).toBe(false);
  expect(result.scores).toHaveLength(4);
});
