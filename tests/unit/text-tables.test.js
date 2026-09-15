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

  const oldRowToken = oldLines[1].tokens[0];
  const newRowToken = newLines[1].tokens[0];
  const hi = {
    old: new Map([[0, [{ token: oldRowToken, color: "changed" }]]]),
    new: new Map([[0, [{ token: newRowToken, color: "changed" }]]]),
    changes: [],
  };
  const returned = applyTableHighlights([oldLines], [newLines], hi);

  expect(returned).toBe(hi);
  expect(hi.old.get(0).some((entry) => entry.token === oldRowToken)).toBe(false);
  expect(hi.new.get(0).some((entry) => entry.token === newRowToken)).toBe(false);
  expect(hi.old.get(0)).toContainEqual({ token: oldLines[1].tokens[1], color: "changed" });
  expect(hi.new.get(0)).toContainEqual({ token: newLines[1].tokens[1], color: "changed" });
});

test("replaces line change records inside a diffed table with cell records in place", () => {
  const hi = {
    old: new Map(),
    new: new Map(),
    changes: [
      { kind: "changed", oldPage: 0, newPage: 0, oldText: "A2 B2", newText: "A2 X2", parts: [], oldAt: [10, 70], newAt: [10, 70] },
      { kind: "added", oldPage: null, newPage: 1, oldText: "", newText: "next page", parts: [], oldAt: null, newAt: [10, 90] },
    ],
  };
  applyTableHighlights([lines("B2")], [lines("X2")], hi);
  expect(hi.changes.map(c => [c.kind, c.oldText, c.newText, c.parts])).toEqual([
    ["changed", "B2", "X2", [[-1, "B2"], [1, "X2"]]],
    ["added", "", "next page", []],
  ]);
});
