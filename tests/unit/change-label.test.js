import { expect, test } from "vitest";
import { drawChangeLabel, reviewLabels } from "../../src/core/change-review/label.js";

function recordingContext() {
  const calls = [];
  return {
    calls,
    fillStyle: "", font: "", textAlign: "", textBaseline: "",
    save() {}, restore() {},
    fillRect(...args) { calls.push(["fillRect", this.fillStyle, ...args]); },
    fillText(...args) { calls.push(["fillText", this.fillStyle, ...args]); },
    measureText: text => ({ width: [...text].length * 10 }),
  };
}

const item = (id, pageIndex, y) => ({ id, pageIndex, normalizedRect: { x: 0, y } });

test("numbers changes in list order across pages and carries normalized comments", () => {
  const labels = reviewLabels(
    new Map([[1, [item("b", 1, 0.1)]], [0, [item("c", 0, 0.5), item("a", 0, 0.2)]]]),
    new Map([["c", { comment: " 寸法\n変更 " }]]),
  );
  expect([...labels]).toEqual([
    ["a", { number: 1, comment: "" }],
    ["c", { number: 2, comment: "寸法 変更" }],
    ["b", { number: 3, comment: "" }],
  ]);
});

test("draws the tag above the box and truncates long comments with an ellipsis", () => {
  const context = recordingContext();
  drawChangeLabel(context, { number: 3, comment: "とても長いメモ本文" }, {
    x: 5, y: 40, fontPx: 10, maxWidth: 66, color: "#ff9500",
  });
  // pad 3 -> height 16, text limit 60px -> 5 chars + ellipsis
  expect(context.calls).toContainEqual(["fillRect", "#ff9500", 5, 24, 66, 16]);
  expect(context.calls).toContainEqual(["fillText", "#1a1206", "3 とても…", 8, 32]);
});

test("falls back inside the box when there is no room above", () => {
  const context = recordingContext();
  drawChangeLabel(context, { number: 12, comment: "" }, { x: 0, y: 4, fontPx: 10, maxWidth: 200, color: "#f90" });
  expect(context.calls).toContainEqual(["fillRect", "#f90", 0, 4, 26, 16]);
  expect(context.calls).toContainEqual(["fillText", "#1a1206", "12", 3, 12]);
});
