import { expect, test } from "vitest";
import { buildTextHighlights } from "../../src/core/text-diff/highlights.js";

const token = (str, off) => ({ str, off, width: str.length, transform: [1, 0, 0, 1, off, 0] });

test("marks changed characters on both sides", () => {
  const oldPages = [[{ text: "REV A", tokens: [token("REV A", 0)] }]];
  const newPages = [[{ text: "REV B", tokens: [token("REV B", 0)] }]];
  const hi = buildTextHighlights(oldPages, newPages);
  expect(hi.old.get(0)[0].color).toBe("changed");
  expect(hi.new.get(0)[0].color).toBe("changed");
});

test("records line changes in document order for the diff report", () => {
  const line = text => ({ text, tokens: [token(text, 0)] });
  const hi = buildTextHighlights(
    [[line("REV A"), line("keep"), line("gone"), line("tail 1"), line("tail 2"), line("tail 3")]],
    [[line("REV B"), line("keep"), line("tail 1"), line("tail 2"), line("tail 3")], [line("added")]],
  );
  expect(hi.changes.map(c => [c.kind, c.oldPage, c.newPage, c.oldText, c.newText])).toEqual([
    ["changed", 0, 0, "REV A", "REV B"],
    ["removed", 0, null, "gone", ""],
    ["added", null, 1, "", "added"],
  ]);
  expect(hi.changes[0].parts).toEqual([[0, "REV "], [-1, "A"], [1, "B"]]);
});
