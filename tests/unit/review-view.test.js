import { expect, test } from "vitest";
import { createAppState } from "../../src/app/state.js";
import { createChangeReviewController } from "../../src/features/change-review/review-controller.js";
import { createChangeReviewView } from "../../src/features/change-review/review-view.js";
import { reviewDom } from "../helpers/review-dom.js";

function harness() {
  const state = createAppState();
  const { document, dom } = reviewDom();
  const controller = createChangeReviewController({ state });
  controller.commitPage({ pageIndex: 0, width: 100, height: 100,
    boxes: [{ x: 10, y: 10, w: 20, h: 20, kind: "added" }] });
  controller.commitPage({ pageIndex: 1, width: 100, height: 100,
    boxes: [{ x: 10, y: 10, w: 20, h: 20, kind: "removed" }] });
  state.review.entriesById.set("change-2", { status: "confirmed", comment: "抵抗値を確認" });
  state.review.panelOpen = true;
  const view = createChangeReviewView({ state, dom, document });
  return { state, dom, document, controller, view };
}

// Break: missing aggregation, page grouping, or entry rendering hides actionable review data.
test("renders progress, page groups, kinds, states and comments", () => {
  const { dom, view } = harness();
  view.render();
  expect(dom.reviewTotal.textContent).toBe("変更箇所 2件");
  expect(dom.reviewProgress.textContent).toBe("完了 1 / 2　未確認 1件");
  expect(dom.reviewList.querySelectorAll("details")).toHaveLength(2);
  expect(dom.reviewList.querySelectorAll("article[data-change-id]")).toHaveLength(2);
  expect(dom.reviewList.textContent).toContain("追加");
  expect(dom.reviewList.textContent).toContain("削除");
  expect(dom.reviewList.textContent).toContain("抵抗値を確認");
  expect(dom.reviewList.querySelector('[data-review-status="change-2"]').value).toBe("confirmed");
  expect(dom.reviewList.querySelector('[data-review-comment="change-2"]').value).toBe("抵抗値を確認");
  expect(dom.reviewList.querySelectorAll("option").map(option => option.value)).toEqual([
    "pending", "confirmed", "excluded", "pending", "confirmed", "excluded",
  ]);
});

// Break: rebuilding a focused textarea without restoring the selection interrupts typing.
test("preserves comment focus and selection while safely rendering literal markup", () => {
  const { state, dom, document, view } = harness();
  const comment = '<img src=x onerror="alert(1)">抵抗';
  state.review.entriesById.set("change-1", { status: "pending", comment });
  view.render();
  const field = dom.reviewList.querySelector('[data-review-comment="change-1"]');
  field.focus();
  field.setSelectionRange(3, 8, "backward");
  view.render({ preserveCommentFocus: true });
  expect(document.activeElement === dom.reviewList.querySelector('[data-review-comment="change-1"]')).toBe(true);
  expect(document.activeElement.value).toBe(comment);
  expect([document.activeElement.selectionStart, document.activeElement.selectionEnd, document.activeElement.selectionDirection])
    .toEqual([3, 8, "backward"]);
  expect(dom.reviewList.querySelectorAll("img")).toHaveLength(0);
});

// Break: using panel visibility as state erases the user's open state on text-mode switches.
test("hides only the panel presentation in text mode and restores the selected item", () => {
  const { state, dom, view } = harness();
  state.review.selectedId = "change-2";
  view.render();
  expect(dom.reviewPanel.hidden).toBe(false);
  expect(dom.reviewToggle.getAttribute("aria-expanded")).toBe("true");
  expect(dom.reviewList.querySelector('[data-change-id="change-2"]').classList.contains("selected")).toBe(true);
  state.ui.topMode = "text";
  view.render();
  expect(dom.reviewPanel.hidden).toBe(true);
  expect(dom.reviewBackdrop.hidden).toBe(true);
  expect(state.review.panelOpen).toBe(true);
  state.ui.topMode = "visual";
  view.render();
  expect(dom.reviewPanel.hidden).toBe(false);
  expect(dom.reviewList.querySelector('[data-review-comment="change-2"]').value).toBe("抵抗値を確認");
});

// Break: replacing an active status control drops keyboard focus during a confirmation change.
test("preserves keyboard focus on the state control after its value changes", () => {
  const { state, dom, document, view } = harness();
  view.render();
  dom.reviewList.querySelector('[data-review-status="change-1"]').focus();
  state.review.entriesById.set("change-1", { status: "excluded", comment: "" });
  view.render();
  expect(document.activeElement === dom.reviewList.querySelector('[data-review-status="change-1"]')).toBe(true);
  expect(document.activeElement.value).toBe("excluded");
});

// Break: navigation into a collapsed page leaves its newly selected change invisible in the list.
test("opens a newly selected page while keeping the other page disclosure choices", () => {
  const { state, dom, view } = harness();
  view.render();
  for (const group of dom.reviewList.querySelectorAll("details")) group.open = false;
  state.review.selectedId = "change-2";
  view.render();
  expect(dom.reviewList.querySelectorAll("details").map(group => group.open)).toEqual([false, true]);
  dom.reviewList.querySelectorAll("details")[1].open = false;
  view.render();
  expect(dom.reviewList.querySelectorAll("details").map(group => group.open)).toEqual([false, false]);
});

// Break: omitted progress, migration notice or failed-page controls makes partial indexing look complete.
test("shows indexing progress, migration results and retryable failed pages", () => {
  const { state, dom, view } = harness();
  Object.assign(state.review, { indexRunning: true, indexedPages: 2, indexTotal: 4,
    migrationSummary: { inherited: 1, reset: 1 } });
  state.review.indexErrors.set(2, "画像を読めません");
  view.render();
  expect(dom.reviewIndexStatus.textContent).toContain("2 / 4");
  expect(dom.reviewNotice.textContent).toContain("引継ぎ 1件");
  expect(dom.reviewNotice.textContent).toContain("未確認に戻した変更 1件");
  expect(dom.reviewList.textContent).toContain("画像を読めません");
  expect(dom.reviewList.querySelector('[data-review-retry="2"]').disabled).toBe(true);
  state.review.indexRunning = false;
  view.render();
  expect(dom.reviewList.querySelector('[data-review-retry="2"]').disabled).toBe(false);
});
