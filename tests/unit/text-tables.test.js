import { expect, test } from "vitest";
import { applyTableHighlights, detectTables } from "../../src/core/text-diff/tables.js";

const tok = (str, x, y) => ({ str, off: 0, width: str.length * 5, transform: [10, 0, 0, 10, x, y] });
const lines = (middleRight) => [
  { text: "A1 B1", tokens: [tok("A1", 10, 90), tok("B1", 100, 90)] },
  { text: `A2 ${middleRight}`, tokens: [tok("A2", 10, 70), tok(middleRight, 100, 70)] },
  { text: "A3 B3", tokens: [tok("A3", 10, 50), tok("B3", 100, 50)] },
];

test("detects a three-row table and replaces row highlights with cell highlights", () => {
  const oldLines = lines("B2");
  const newLines = lines("B2 changed");
  const tables = detectTables(oldLines);
  expect(tables).toHaveLength(1);
  expect(tables[0]).toMatchObject({ rowCount: 3, colCount: 2 });

  const hi = { old: new Map(), new: new Map() };
  applyTableHighlights([oldLines], [newLines], hi);
  expect(hi.old.get(0).some((entry) => entry.color === "changed")).toBe(true);
  expect(hi.new.get(0).some((entry) => entry.color === "changed")).toBe(true);
});
