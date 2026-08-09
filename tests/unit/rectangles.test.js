import { expect, test } from "vitest";
import { clampBox, clampBoxes, normalizeRect } from "../../src/core/geometry/rectangles.js";

test("normalizes reverse drag and clamps it to the canvas", () => {
  expect(normalizeRect(30, 20, 10, 5)).toEqual({ x: 10, y: 5, w: 20, h: 15 });
  expect(clampBox({ x: -4, y: 8, w: 20, h: 20 }, 12, 16))
    .toEqual({ x: 0, y: 8, w: 12, h: 8 });
});

test("clamps multiple boxes and drops boxes with zero visible area", () => {
  expect(clampBoxes([
    { x: -4, y: 2, w: 6, h: 4 },
    { x: 8, y: 8, w: 4, h: 4 },
    { x: 10, y: 0, w: 2, h: 2 },
    { x: 0, y: 10, w: 2, h: 2 },
  ], 10, 10)).toEqual([
    { x: 0, y: 2, w: 2, h: 4 },
    { x: 8, y: 8, w: 2, h: 2 },
  ]);
});
