import { expect, test } from "vitest";
import { computeBoxes } from "../../src/core/change-boxes/detect.js";

test("groups adjacent changed blocks and filters single-block noise", () => {
  const flags = Uint8Array.from([
    1, 1, 0, 0, 0, 0,
    0, 1, 0, 0, 0, 1,
    0, 0, 0, 0, 0, 0,
  ]);
  expect(computeBoxes(flags, 6, 3, 10, 2)).toEqual([
    { x: 0, y: 0, w: 30, h: 30 },
  ]);
});

test("keeps diagonally touching dilated crosses as separate four-neighbor components", () => {
  const flags = Uint8Array.from([
    0, 0, 0, 0, 0,
    0, 1, 0, 0, 0,
    0, 0, 0, 0, 0,
    0, 0, 0, 1, 0,
    0, 0, 0, 0, 0,
  ]);
  expect(computeBoxes(flags, 5, 5, 10, 1)).toEqual([
    { x: 0, y: 0, w: 30, h: 30 },
    { x: 20, y: 20, w: 30, h: 30 },
  ]);
});
