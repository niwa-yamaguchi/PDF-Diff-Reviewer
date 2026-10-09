import { expect, test } from "vitest";
import { buildTextHighlights, collapseMovedRows } from "../../src/core/text-diff/highlights.js";

const token = (str, off) => ({ str, off, width: str.length, transform: [1, 0, 0, 1, off, 0] });

test("marks removed characters on the old side and added ones on the new side", () => {
  const oldPages = [[{ text: "REV A", tokens: [token("REV A", 0)] }]];
  const newPages = [[{ text: "REV B", tokens: [token("REV B", 0)] }]];
  const hi = buildTextHighlights(oldPages, newPages);
  expect(hi.old.get(0)[0].color).toBe("removed");
  expect(hi.new.get(0)[0].color).toBe("added");
});

const movedToken = (str, y) => ({ str, off: 0, width: str.length, transform: [1, 0, 0, 1, 10, y] });

test("drops a row that only moved to another page, highlights included", () => {
  const oldTok = movedToken("R 18 part", 90);
  const newTok = movedToken("R 18 part", 80);
  const hi = {
    old: new Map([[0, [{ token: oldTok, color: "removed" }]]]),
    new: new Map([[1, [{ token: newTok, color: "added" }]]]),
    changes: [
      // 表ごとに列の切れ目が変わるため、同じ行でも空白の位置だけがずれる。
      { kind: "removed", oldText: "R 18 part", newText: "", parts: [], oldPage: 0, newPage: null, oldRows: [{ text: "R 18 part", tokens: [oldTok], pageIndex: 0 }], newRows: [] },
      { kind: "added", oldText: "", newText: "R 18  part", parts: [], oldPage: null, newPage: 1, oldRows: [], newRows: [{ text: "R 18  part", tokens: [newTok], pageIndex: 1 }] },
    ],
  };

  collapseMovedRows(hi);

  expect(hi.changes).toEqual([]);
  expect(hi.old.get(0)).toEqual([]);
  expect(hi.new.get(1)).toEqual([]);
});

test("keeps the surplus removal when the same text returns only once", () => {
  const record = (kind, text, page) => (kind === "removed"
    ? { kind, oldText: text, newText: "", parts: [], oldPage: page, newPage: null, oldRows: [{ text, tokens: [], pageIndex: page }], newRows: [] }
    : { kind, oldText: "", newText: text, parts: [], oldPage: null, newPage: page, oldRows: [], newRows: [{ text, tokens: [], pageIndex: page }] });
  const hi = {
    old: new Map(),
    new: new Map(),
    changes: [record("removed", "dup row", 0), record("removed", "dup row", 0), record("added", "dup row", 1)],
  };

  collapseMovedRows(hi);

  expect(hi.changes.map(c => [c.kind, c.oldText, c.newText])).toEqual([["removed", "dup row", ""]]);
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

test("ignores a line break that only moved within a paragraph", () => {
  const line = text => ({ text, tokens: [token(text, 0)] });
  const hi = buildTextHighlights(
    [[line("2 段垂下が有効なら、"), line("停止せずに運転します")]],
    [[line("2 段垂下が有効なら、停止"), line("せずに運転します")]],
  );
  expect(hi.changes).toEqual([]);
  expect(hi.old.size + hi.new.size).toBe(0);
});

test("ignores a space added between sentences but keeps real edits in the block", () => {
  const line = text => ({ text, tokens: [token(text, 0)] });
  const hi = buildTextHighlights(
    [[line("ありません。停電のあと"), line("REV A")]],
    [[line("ありません。 停電のあと"), line("REV B")]],
  );
  expect(hi.changes.map(c => [c.oldText, c.newText])).toEqual([["REV A", "REV B"]]);
  expect(hi.old.get(0).map(e => e.token.str)).toEqual(["REV A"]);
});

test("highlights only the changed characters inside a text item", () => {
  const line = text => ({ text, tokens: [token(text, 0)] });
  const hi = buildTextHighlights([[line("校正、初期化を行います")]], [[line("校正、初期化、模擬警報を行います")]]);
  expect(hi.old.get(0)).toBeUndefined();
  expect(hi.new.get(0)).toEqual([{ token: hi.new.get(0)[0].token, color: "added", start: 6, end: 11 }]);
});

// L-02153 の部品表で、ページ末の行が次ページへ送られ、隣のページ番号「/ 5」→「/ 6」の変更と1件にまとまっていた。
test("drops rows pushed to the next page even when the page footer changed next to them", () => {
  const line = text => ({ text, tokens: [token(text, 0)] });
  const led = n => line(`LED ${n}& LEDｽﾍﾟｰｻ * LL-5 ﾏｯｸｴｲﾄ 11978`);
  const header = () => line("改版 SH 記号 番号 名称 形名 定格 メーカー 数量 備考Code");
  const unit = () => line("ﾕﾆｯﾄNo.：");
  const hi = buildTextHighlights(
    [[led(1), led(2), line("図面番号：L-02153 -22 / 5"), unit()], [header(), led(3)]],
    [[line("図面番号：L-02153 -22 / 6"), unit()], [header(), led(1), led(2), led(3)]],
  );
  collapseMovedRows(hi);
  expect(hi.changes.map(c => [c.kind, c.oldText, c.newText])).toEqual([["changed", "図面番号：L-02153 -22 / 5", "図面番号：L-02153 -22 / 6"]]);
  expect(hi.old.get(0).map(e => e.token.str)).toEqual(["図面番号：L-02153 -22 / 5"]);
  expect(hi.new.get(1)).toEqual([]);
});

test("keeps the rest of a removal when only some of its lines moved", () => {
  const line = text => ({ text, tokens: [token(text, 0)] });
  const hi = buildTextHighlights(
    [[line("keep"), line("moved row"), line("really gone")], [line("next")]],
    [[line("keep")], [line("moved row"), line("next")]],
  );
  collapseMovedRows(hi);
  expect(hi.changes.map(c => [c.kind, c.oldText, c.newText])).toEqual([["removed", "really gone", ""]]);
});
