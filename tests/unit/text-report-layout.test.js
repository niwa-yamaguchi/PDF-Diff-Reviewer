import { expect, test } from "vitest";
import { layoutTextReport } from "../../src/core/text-diff/report-layout.js";

const measure = text => text.length * 10;
const runs = (...parts) => parts.map(([text, style = "plain"]) => ({ text, style }));
const runTexts = page => page.items.filter(item => item.type === "run").map(item => item.text);

test("lays out paragraphs as No./page | new | old rows with placeholders for one-sided ones", () => {
  const layout = layoutTextReport([
    { kind: "changed", newPage: 0, newPageEnd: 0, oldPage: 0, oldPageEnd: 0,
      newLines: [runs(["REV "], ["B", "added"])], oldLines: [runs(["REV "], ["A", "removed"])] },
    { kind: "added", newPage: 1, newPageEnd: 2, oldPage: null, oldPageEnd: null,
      newLines: [runs(["note", "added"])], oldLines: null },
  ], measure, { width: 400, fontPx: 10 });

  expect(layout.pages).toHaveLength(1);
  expect(runTexts(layout.pages[0])).toEqual([
    "No.・頁", "新", "旧",
    "1", "新 p1", "旧 p1", "REV ", "B", "REV ", "A",
    "2", "新 p2–3", "note", "（新設）",
  ]);
  const boxes = layout.pages[0].items.filter(item => item.type === "box");
  expect(boxes.filter(item => item.head)).toHaveLength(3);
  expect(boxes).toHaveLength(9);
});

test("joins wrapped source lines but keeps list items on their own lines", () => {
  const layout = layoutTextReport([
    { kind: "changed", newPage: 0, oldPage: 0,
      newLines: [runs(["1. 起動し"]), runs(["ます。"]), runs(["2. 停止"])], oldLines: [runs(["ABC"]), runs(["DEF"])] },
  ], measure, { width: 1000, fontPx: 10 });
  expect(runTexts(layout.pages[0]).slice(6)).toEqual(["1. 起動します。", "2. 停止", "ABC DEF"]);
});

test("continues a tall row on the next page under a repeated header", () => {
  const long = [runs(["0123456789".repeat(6)])];
  const layout = layoutTextReport([
    { kind: "added", newPage: 0, oldPage: null, newLines: long, oldLines: null },
  ], measure, { width: 400, height: 230, fontPx: 10 });

  expect(layout.pages.length).toBeGreaterThan(1);
  for (const page of layout.pages) expect(runTexts(page).slice(0, 3)).toEqual(["No.・頁", "新", "旧"]);
  const body = layout.pages.flatMap(page => runTexts(page).slice(3)).filter(text => /^\d{2,}/.test(text));
  expect(body.join("")).toBe("0123456789".repeat(6));
});

test("keeps an unpaged report on one page and says when there is nothing to report", () => {
  const empty = layoutTextReport([], measure, { width: 400, fontPx: 10 });
  expect(empty.pages).toHaveLength(1);
  expect(runTexts(empty.pages[0])).toEqual(["No.・頁", "新", "旧", "テキスト差分はありません"]);
  expect(Number.isFinite(empty.height)).toBe(true);
});

test("hangs a full stop past the column edge instead of starting a line with it", () => {
  // 幅400では本文の欄に10文字（100px）入る。
  const layout = layoutTextReport([
    { kind: "added", newPage: 0, oldPage: null, newLines: [runs(["0123456789。ab"])], oldLines: null },
  ], measure, { width: 400, fontPx: 10 });
  expect(runTexts(layout.pages[0]).slice(5)).toEqual(["0123456789。", "ab", "（新設）"]);
});
