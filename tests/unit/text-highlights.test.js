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
