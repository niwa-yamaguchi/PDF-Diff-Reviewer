import { expect, test } from "vitest";
import { dilateMask, toleratedDiffMasks } from "../../src/core/image-diff/masks.js";
import { isInk, luminanceAt } from "../../src/core/image-diff/luminance.js";

test("treats a one-pixel shift as equal inside radius one", () => {
  const oldMask = Uint8Array.from([0, 1, 0, 0, 0]);
  const newMask = Uint8Array.from([0, 0, 1, 0, 0]);
  expect([...dilateMask(oldMask, 5, 1, 1)]).toEqual([1, 1, 1, 0, 0]);
  const diff = toleratedDiffMasks(oldMask, newMask, 5, 1, 1);
  expect([...diff.removed]).toEqual([0, 0, 0, 0, 0]);
  expect([...diff.added]).toEqual([0, 0, 0, 0, 0]);
});

test("dilates a two-dimensional mask as a radius-one square", () => {
  const mask = Uint8Array.from([
    0, 0, 0, 0, 0,
    0, 1, 0, 0, 0,
    0, 0, 0, 0, 0,
  ]);
  expect([...dilateMask(mask, 5, 3, 1)]).toEqual([
    1, 1, 1, 0, 0,
    1, 1, 1, 0, 0,
    1, 1, 1, 0, 0,
  ]);
});

test("does not expand masks when radius is zero or negative", () => {
  const mask = Uint8Array.from([0, 1, 0, 0]);
  expect([...dilateMask(mask, 2, 2, 0)]).toEqual([0, 1, 0, 0]);
  expect([...dilateMask(mask, 2, 2, -1)]).toEqual([0, 1, 0, 0]);
});

test("marks unmatched old ink as removed and unmatched new ink as added", () => {
  const oldMask = Uint8Array.from([1, 0, 0, 0]);
  const newMask = Uint8Array.from([0, 0, 0, 1]);
  const diff = toleratedDiffMasks(oldMask, newMask, 2, 2, 0);
  expect([...diff.removed]).toEqual([1, 0, 0, 0]);
  expect([...diff.added]).toEqual([0, 0, 0, 1]);
});

test("uses RGB luminance coefficients and a strict ink threshold boundary", () => {
  const data = Uint8Array.from([
    100, 0, 0, 255,
    0, 100, 0, 255,
    0, 0, 100, 255,
    10, 10, 10, 255,
  ]);
  expect(luminanceAt(data, 0)).toBeCloseTo(29.9, 12);
  expect(luminanceAt(data, 4)).toBeCloseTo(58.7, 12);
  expect(luminanceAt(data, 8)).toBeCloseTo(11.4, 12);
  expect(luminanceAt(data, 12)).toBe(10);
  expect(isInk(data, 12, 10)).toBe(false);
  expect(isInk(data, 12, 11)).toBe(true);
});
