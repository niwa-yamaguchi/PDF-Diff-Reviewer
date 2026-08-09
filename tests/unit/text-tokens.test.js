import { expect, test } from "vitest";
import { assembleFromLeaves, reconstructLinesInItemOrder } from "../../src/core/text-diff/tokens.js";
import { xyCut } from "../../src/core/text-diff/xy-cut.js";

const item = (str, x, y) => ({ str, width: str.length * 5, transform: [10, 0, 0, 10, x, y] });

test("reconstructs lines by y and tokens by x", () => {
  const lines = reconstructLinesInItemOrder([
    item("B", 20, 100), item("A", 10, 100), item("C", 10, 80),
  ]);
  expect(lines.map((line) => line.text)).toEqual(["AB", "C"]);
});

const columnItem = (str, x, y) => ({ str, width: 10, transform: [10, 0, 0, 10, x, y] });
const twoColumnItems = [
  columnItem("L1", 10, 90), columnItem("R1", 100, 90),
  columnItem("L2", 10, 70), columnItem("R2", 100, 70),
  columnItem("L3", 10, 50), columnItem("R3", 100, 50),
];
const twoColumnTokens = twoColumnItems.map((entry, ord) => ({
  ord, x0: entry.transform[4], x1: entry.transform[4] + entry.width,
  y0: entry.transform[5], y1: entry.transform[5] + 10, fh: 10,
}));

test("xyCut defaults split columns, set the caller context, and preserve reading order", () => {
  const context = { hadVerticalCut: false };
  const leaves = xyCut(twoColumnTokens, { context });

  expect(context.hadVerticalCut).toBe(true);
  expect(leaves.map((leaf) => leaf.map((token) => token.ord))).toEqual([[0, 2, 4], [1, 3, 5]]);
  expect(assembleFromLeaves(twoColumnItems, leaves).map((line) => line.text))
    .toEqual(["L1", "L2", "L3", "R1", "R2", "R3"]);
});

test("xyCut honors an explicit column-gap option", () => {
  const leaves = xyCut(twoColumnTokens, { colGapEm: 9 });
  expect(leaves.map((leaf) => leaf.map((token) => token.ord))).toEqual([[0, 1, 2, 3, 4, 5]]);
});

const rowThenColumnItems = [
  columnItem("BL1", 10, 50), columnItem("BR1", 46, 50),
  columnItem("BL2", 10, 30), columnItem("BR2", 46, 30),
  columnItem("BL3", 10, 10), columnItem("BR3", 46, 10),
  columnItem("TL1", 10, 130), columnItem("TR1", 46, 130),
  columnItem("TL2", 10, 110), columnItem("TR2", 46, 110),
  columnItem("TL3", 10, 90), columnItem("TR3", 46, 90),
];
const rowThenColumnTokens = rowThenColumnItems.map((entry, ord) => ({
  ord, x0: entry.transform[4], x1: entry.transform[4] + entry.width,
  y0: entry.transform[5], y1: entry.transform[5] + 10, fh: 10,
}));

test("xyCut preserves ordinal reading order after a row cut and recursive column cuts", () => {
  const leaves = xyCut(rowThenColumnTokens);

  expect(leaves.map((leaf) => leaf.map((token) => token.ord)))
    .toEqual([[0, 2, 4], [1, 3, 5], [6, 8, 10], [7, 9, 11]]);
  expect(assembleFromLeaves(rowThenColumnItems, leaves).map((line) => line.text))
    .toEqual(["BL1", "BL2", "BL3", "BR1", "BR2", "BR3", "TL1", "TL2", "TL3", "TR1", "TR2", "TR3"]);
});

test("xyCut honors an explicit row-gap option", () => {
  const leaves = xyCut(rowThenColumnTokens, { rowGapEm: 4 });
  expect(leaves.map((leaf) => leaf.map((token) => token.ord)))
    .toEqual([[0, 2, 4, 6, 8, 10], [1, 3, 5, 7, 9, 11]]);
});
