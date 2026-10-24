import { expect, test } from "vitest";
import { buildParagraphReport } from "../../src/core/text-diff/paragraphs.js";

// 10pt の行。x は左端、w は字数×5。
const tok = (str, y, x = 10) => ({ str, off: 0, w: str.length * 5, transform: [10, 0, 0, 10, x, y] });
const line = (str, y, x) => ({ text: str, tokens: [tok(str, y, x)] });
const marks = (...entries) => {
  const map = new Map();
  for(const [page, token, color, start, end] of entries){
    if(!map.has(page)) map.set(page, []);
    map.get(page).push(start == null ? { token, color } : { token, color, start, end });
  }
  return map;
};
const text = lines => lines && lines.map(runs => runs.map(run => run.style === "plain" ? run.text : `[${run.text}]`).join("")).join("/");

test("splits paragraphs at wide line gaps and reports only the changed ones", () => {
  const oldPage = [line("aaa", 700), line("bbb", 684), line("ccc", 650)];
  const newPage = [line("aaa", 700), line("bbX", 684), line("ccc", 650)];
  const report = buildParagraphReport({ old: [oldPage], new: [newPage] }, {
    old: marks([0, oldPage[1].tokens[0], "removed", 2, 3]),
    new: marks([0, newPage[1].tokens[0], "added", 2, 3]),
  });
  expect(report).toHaveLength(1);
  expect(report[0]).toMatchObject({ kind: "changed", oldPage: 0, newPage: 0 });
  expect(text(report[0].newLines)).toBe("aaa/bb[X]");
  expect(text(report[0].oldLines)).toBe("aaa/bb[b]");
});

test("pairs a changed paragraph across an inserted one instead of by position", () => {
  const oldPage = [line("前の段落はそのまま", 700), line("この段落を少し直す", 650)];
  const newPage = [line("前の段落はそのまま", 700), line("まったく新しい段落", 650), line("この段落を少し直した", 600)];
  const report = buildParagraphReport({ old: [oldPage], new: [newPage] }, {
    old: marks(),
    new: marks([0, newPage[1].tokens[0], "added"], [0, newPage[2].tokens[0], "added", 8, 10]),
  });
  expect(report.map(entry => [entry.kind, text(entry.newLines), text(entry.oldLines)])).toEqual([
    ["added", "[まったく新しい段落]", null],
    ["changed", "この段落を少し直[した]", "この段落を少し直す"],
  ]);
});

test("treats a table row as one unit with its cells on one line", () => {
  const rows = [90, 70, 50].map(y => ({ text: `A${y} B${y}`, tokens: [tok(`A${y}`, y, 10), tok(`B${y}`, y, 100)] }));
  const changed = rows[1].tokens[1];
  const report = buildParagraphReport({ old: [rows], new: [rows] }, {
    old: marks([0, changed, "removed"]),
    new: marks(),
  });
  expect(report).toHaveLength(1);
  expect(text(report[0].oldLines)).toBe("A70  [B70]");
});

test("continues a paragraph cut mid-sentence by a page break, but not after a full stop", () => {
  const page1 = [line("ここまでの行は右端まで届く長い行です", 700), line("文の途中でページが変わ", 684, 10)];
  page1[1].tokens[0].w = 95;
  const page2 = [line("ります。", 780), line("次の段落", 740)];
  const changedTok = page2[0].tokens[0];
  const join = buildParagraphReport({ old: [page1, page2], new: [page1, page2] }, {
    old: marks(), new: marks([1, changedTok, "added", 0, 2]),
  });
  expect(join).toHaveLength(1);
  expect(join[0]).toMatchObject({ newPage: 0, newPageEnd: 1 });
  expect(text(join[0].newLines)).toBe("ここまでの行は右端まで届く長い行です/文の途中でページが変わ/[りま]す。");

  const ended = [line("ここまでの行は右端まで届く長い行です", 700), line("文はここで終わる。", 684)];
  const split = buildParagraphReport({ old: [ended, page2], new: [ended, page2] }, {
    old: marks(), new: marks([1, changedTok, "added", 0, 2]),
  });
  expect(split.map(entry => [entry.newPage, entry.newPageEnd])).toEqual([[1, 1]]);
});
