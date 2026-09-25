import { expect, test } from "vitest";
import { computeBoxes } from "../../src/core/change-boxes/detect.js";

const ones = flags => Uint32Array.from(flags, bits => (bits ? 1 : 0));

test("groups adjacent changed blocks and filters single-block noise", () => {
  const flags = Uint8Array.from([
    1, 1, 0, 0, 0, 0,
    0, 1, 0, 0, 0, 1,
    0, 0, 0, 0, 0, 0,
  ]);
  expect(computeBoxes(flags, ones(flags), 6, 3, 10, 2)).toEqual([
    { x: 0, y: 0, w: 30, h: 30, kind: "removed" },
  ]);
});

test("keeps a change inside one block when it has enough pixels", () => {
  const flags = Uint8Array.from([0, 2, 0]);
  const counts = Uint32Array.from([0, 20, 0]);
  expect(computeBoxes(flags, counts, 3, 1, 10, 4)).toEqual([
    { x: 0, y: 0, w: 30, h: 10, kind: "added" },
  ]);
});

test("drops a few noise pixels even when they straddle blocks", () => {
  const flags = Uint8Array.from([2, 2, 0]);
  const counts = Uint32Array.from([1, 1, 0]);
  expect(computeBoxes(flags, counts, 3, 1, 10, 4)).toEqual([]);
});

test("keeps diagonally touching dilated crosses as separate four-neighbor components", () => {
  const flags = Uint8Array.from([
    0, 0, 0, 0, 0,
    0, 1, 0, 0, 0,
    0, 0, 0, 0, 0,
    0, 0, 0, 1, 0,
    0, 0, 0, 0, 0,
  ]);
  expect(computeBoxes(flags, ones(flags), 5, 5, 10, 1)).toEqual([
    { x: 0, y: 0, w: 30, h: 30, kind: "removed" },
    { x: 20, y: 20, w: 30, h: 30, kind: "removed" },
  ]);
});

test("labels connected components from removed and added block bits", () => {
  const flags = Uint8Array.from([
    1, 1, 0, 2, 2,
    0, 1, 0, 0, 2,
    0, 0, 3, 0, 0,
  ]);

  expect(computeBoxes(flags, ones(flags), 5, 3, 10, 1)).toEqual([
    { x: 0, y: 0, w: 50, h: 30, kind: "changed" },
  ]);
});
