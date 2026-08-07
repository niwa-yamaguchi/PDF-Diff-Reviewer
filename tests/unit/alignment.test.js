import { expect, test } from "vitest";
import { phaseCorrelate } from "../../src/core/alignment/similarity.js";
import { rotateGray90 } from "../../src/core/alignment/quadrant.js";

test("phase correlation returns the translation that moves new onto old", () => {
  const size = 8;
  const oldImage = new Float64Array(size * size);
  const newImage = new Float64Array(size * size);
  oldImage[3 * size + 2] = 255;
  newImage[2 * size + 4] = 255;
  const result = phaseCorrelate(oldImage, newImage, size);
  expect(result.dx).toBe(-2);
  expect(result.dy).toBe(1);
});

test("rotates a rectangular grayscale image clockwise", () => {
  const result = rotateGray90(Float64Array.from([1, 2, 3, 4, 5, 6]), 3, 2, 1);
  expect(result.w).toBe(2);
  expect(result.h).toBe(3);
  expect([...result.g]).toEqual([4, 1, 5, 2, 6, 3]);
});
