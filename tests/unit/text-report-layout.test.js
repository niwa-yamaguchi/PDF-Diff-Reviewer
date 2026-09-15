import { expect, test } from "vitest";
import { layoutTextReport } from "../../src/core/text-diff/report-layout.js";

const measure = text => text.length * 10;
const change = (kind, oldText, newText, parts = []) => ({ kind, oldPage: 0, newPage: 0, oldText, newText, parts });

test("wraps styled runs by character and moves overflowing lines to the next page", () => {
  const layout = layoutTextReport([
    change("changed", "REV A", "REV B", [[0, "REV "], [-1, "A"], [1, "B"]]),
    change("removed", "0123456789ABCDEFGHIJ", ""),
  ], measure, { width: 200, height: 190, fontPx: 10 });

  expect(layout.pages).toHaveLength(2);
  const body = layout.pages[0].items.filter(item => item.type === "run" && item.style !== "meta");
  expect(body.map(item => [item.text, item.style, item.x])).toEqual([
    ["REV ", "plain", 40],
    ["A", "removed", 80],
    ["B", "added", 90],
    ["0123456789AB", "removed", 40],
  ]);
  expect(layout.pages[0].items.filter(item => item.type === "meta" || item.style === "meta")
    .map(item => item.text)).toEqual(["#1  旧 p1 → 新 p1", "#2  旧 p1 → 新 p1"]);
  expect(layout.pages[1].items.map(item => item.text)).toEqual(["CDEFGHIJ"]);
});

test("keeps an unpaged report on one page and says when there is nothing to report", () => {
  const empty = layoutTextReport([], measure, { width: 200, fontPx: 10 });
  expect(empty.pages).toHaveLength(1);
  expect(empty.pages[0].items.map(item => item.text)).toEqual(["テキスト差分はありません"]);
  expect(empty.height).toBe(128);
});
