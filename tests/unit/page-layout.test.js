import { expect, test } from "vitest";
import {
  framePlan,
  pageLabelText,
  sequenceIndex,
} from "../../src/features/documents/page-layout.js";

test("uses the larger page as the normalized output frame", () => {
  const plan = framePlan({ w: 100, h: 200 }, { w: 200, h: 400 }, 144);
  expect(plan).toMatchObject({
    oldScale: 4,
    newScale: 2,
    frameScale: 2,
    ratio: 2,
    normalized: true,
    aspectMismatch: false,
    refSide: "new",
  });
});

test("maps null page spacers without converting them to zero", () => {
  expect(sequenceIndex([0, null, 1], 1)).toBeNull();
  expect(sequenceIndex([0, null, 1], 2)).toBe(1);
});

test("keeps the base scale when either page is missing", () => {
  const expected = {
    oldScale: 2,
    newScale: 2,
    frameScale: 2,
    ratio: 1,
    normalized: false,
    aspectMismatch: false,
    refSide: null,
  };

  expect(framePlan(null, { w: 200, h: 400 }, 144)).toEqual(expected);
  expect(framePlan({ w: 100, h: 200 }, null, 144)).toEqual(expected);
});

test("flags aspect mismatch without normalizing either page", () => {
  expect(framePlan({ w: 100, h: 200 }, { w: 200, h: 200 }, 144)).toEqual({
    oldScale: 2,
    newScale: 2,
    frameScale: 2,
    ratio: 1,
    normalized: false,
    aspectMismatch: true,
    refSide: null,
  });
});

test("keeps equal page sizes at the requested DPI", () => {
  expect(framePlan({ w: 200, h: 400 }, { w: 200, h: 400 }, 216)).toEqual({
    oldScale: 3,
    newScale: 3,
    frameScale: 3,
    ratio: 1,
    normalized: false,
    aspectMismatch: false,
    refSide: null,
  });
});

test("maps missing sequences and labels their slots as blank", () => {
  const documents = {
    oldSequence: null,
    newSequence: undefined,
    pages: 1,
  };

  expect(sequenceIndex(null, 0)).toBeNull();
  expect(sequenceIndex([0], 5)).toBeNull();
  expect(pageLabelText(documents, 0)).toBe("1 / 1（旧 空白 ↔ 新 空白）");
});

test("labels mapped old and new pages using one-based page numbers", () => {
  const documents = {
    oldSequence: [1],
    newSequence: [3],
    pages: 4,
  };

  expect(pageLabelText(documents, 0)).toBe("1 / 4（旧P2 ↔ 新P4）");
});
