import { expect, test } from "vitest";
import { dilateMask, toleratedDiffMasks } from "../../src/core/image-diff/masks.js";

test("treats a one-pixel shift as equal inside radius one", () => {
  const oldMask = Uint8Array.from([0, 1, 0, 0, 0]);
  const newMask = Uint8Array.from([0, 0, 1, 0, 0]);
  expect([...dilateMask(oldMask, 5, 1, 1)]).toEqual([1, 1, 1, 0, 0]);
  const diff = toleratedDiffMasks(oldMask, newMask, 5, 1, 1);
  expect([...diff.removed]).toEqual([0, 0, 0, 0, 0]);
  expect([...diff.added]).toEqual([0, 0, 0, 0, 0]);
});
