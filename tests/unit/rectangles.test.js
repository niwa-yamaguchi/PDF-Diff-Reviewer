import { expect, test } from "vitest";
import { normalizeRect, clampBox } from "../../src/core/geometry/rectangles.js";

test("normalizes reverse drag and clamps it to the canvas", () => {
  expect(normalizeRect(30, 20, 10, 5)).toEqual({ x: 10, y: 5, w: 20, h: 15 });
  expect(clampBox({ x: -4, y: 8, w: 20, h: 20 }, 12, 16))
    .toEqual({ x: 0, y: 8, w: 12, h: 8 });
});
