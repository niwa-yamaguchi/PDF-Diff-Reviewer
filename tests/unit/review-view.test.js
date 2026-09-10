import { expect, test, vi } from "vitest";
import { createAppState } from "../../src/app/state.js";
import { createChangeReviewController } from "../../src/features/change-review/review-controller.js";
import { createChangeReviewView } from "../../src/features/change-review/review-view.js";
import { reviewDom } from "../helpers/review-dom.js";

function harness(options = {}) {
  const state = createAppState();
  const { document, dom } = reviewDom();
  const controller = createChangeReviewController({ state });
  controller.commitPage({ pageIndex: 0, width: 100, height: 100,
    boxes: [{ x: 10, y: 10, w: 20, h: 20, kind: "added" }] });
  controller.commitPage({ pageIndex: 1, width: 100, height: 100,
    boxes: [{ x: 10, y: 10, w: 20, h: 20, kind: "removed" }] });
  state.review.entriesById.set("change-2", { status: "confirmed", comment: "抵抗値を確認" });
  state.review.panelOpen = true;
  const view = createChangeReviewView({ state, dom, document, ...options });
  return { state, dom, document, controller, view };
}

// Break: eagerly opening all pages renders the entire document instead of requested groups.
test("requests only open groups and shows fixed-size loading, images and failure placeholders", () => {
  const requestPageThumbnails = vi.fn();
  const { state, dom, view } = harness({ requestPageThumbnails });
  view.render();
  const groups = dom.reviewList.querySelectorAll("details");
  expect(groups.map(group => group.open)).toEqual([true, false]);
  expect(requestPageThumbnails.mock.calls.map(call => call[0])).toEqual([0]);
  const loading = dom.reviewList.querySelector('[data-review-thumbnail="change-1"]');
  expect([loading.style.width, loading.style.height]).toEqual(["120px", "80px"]);
  expect(loading.getAttribute("aria-busy")).toBe("true");
  requestPageThumbnails.mockClear();
  groups[1].open = true;
  view.render();
  expect(requestPageThumbnails.mock.calls.map(call => call[0])).toEqual([0, 1]);
  groups[1].open = false;
  requestPageThumbnails.mockClear();
  view.render();
  expect(requestPageThumbnails).toHaveBeenCalledExactlyOnceWith(0);
  state.review.thumbnailsByPage.set(0, new Map([["change-1", "data:image/png;base64,test"]]));
  state.review.thumbnailsByPage.set(1, { error: true });
  view.render();
  const image = loading.querySelector("img");
  expect(image.src).toBe("data:image/png;base64,test");
  expect([image.width, image.height]).toEqual([120, 80]);
  expect(loading.getAttribute("aria-busy")).toBe("false");
  expect(dom.reviewList.querySelector('[data-review-thumbnail="change-2"]').textContent).toBe("画像なし");
});

// Break: missing aggregation, page grouping, or entry rendering hides actionable review data.
test("renders progress, page groups, kinds, confirmation checks and comments", () => {
  const { dom, view } = harness();
  view.render();
  expect(dom.reviewTotal.textContent).toBe("変更箇所 2件");
  expect(dom.reviewProgress.textContent).toBe("確認済み 1 / 2　未確認 1件");
  expect(dom.reviewList.querySelectorAll("details")).toHaveLength(2);
  expect(dom.reviewList.querySelectorAll("article[data-change-id]")).toHaveLength(2);
  expect(dom.reviewList.textContent).toContain("追加");
  expect(dom.reviewList.textContent).toContain("削除");
  expect(dom.reviewList.textContent).toContain("抵抗値を確認");
  const checkbox = dom.reviewList.querySelector('[data-review-confirmed="change-2"]');
  expect(checkbox.type).toBe("checkbox");
  expect(checkbox.checked).toBe(true);
  expect(dom.reviewList.querySelector('[data-review-comment="change-2"]').value).toBe("抵抗値を確認");
  expect(dom.reviewList.textContent).not.toContain("対象外");
});

test("renders per-item edit and delete actions and marks only the active editor", () => {
  const { state, dom, view } = harness();
  state.review.selectedId = "change-2";
  state.boxEditor.mode = "edit";

  view.render();

  const editing = dom.reviewList.querySelector('[data-change-id="change-2"]');
  const idle = dom.reviewList.querySelector('[data-change-id="change-1"]');
  expect(editing.classList.contains("editing")).toBe(true);
  expect(editing.textContent).toContain("編集中");
  expect(editing.querySelector('[data-review-edit="change-2"]').textContent).toBe("編集を終了");
  expect(editing.querySelector('[data-review-delete="change-2"]').textContent).toBe("削除");
  expect(idle.classList.contains("editing")).toBe(false);
  expect(idle.querySelector('[data-review-edit="change-1"]').textContent).toBe("編集");
});

// Break: per-page numbering duplicates change numbers and leaves cached image labels stale when earlier pages grow.
test("numbers all pages in display order and updates cached image labels without changing IDs", () => {
  const { state, dom, controller, view } = harness();
  state.review.thumbnailsByPage.set(1, new Map([["change-2", "data:image/png;base64,cached"]]));
  view.render();
  const cachedImage = dom.reviewList.querySelector('[data-change-id="change-2"]').querySelector("img");
  controller.commitPage({ pageIndex: 0, width: 100, height: 100, boxes: [
    { x: 10, y: 10, w: 20, h: 20, kind: "added" },
    { x: 60, y: 60, w: 20, h: 20, kind: "changed" },
  ] });
  view.render();
  const rows = dom.reviewList.querySelectorAll("article[data-change-id]");
  expect(rows.map(row => row.dataset.changeId)).toEqual(["change-1", "change-3", "change-2"]);
  expect(rows.map(row => row.querySelectorAll("span").find(node => node.className === "review-number").textContent))
    .toEqual(["1", "2", "3"]);
  expect(rows.map(row => row.querySelector("button").getAttribute("aria-label"))).toEqual([
    "ページ 1 変更 1を表示", "ページ 1 変更 2を表示", "ページ 2 変更 3を表示",
  ]);
  expect(rows.map(row => row.querySelector("input").type)).toEqual(["checkbox", "checkbox", "checkbox"]);
  expect(rows.map(row => row.querySelector("textarea").getAttribute("aria-label"))).toEqual([
    "ページ 1 変更 1のコメント", "ページ 1 変更 2のコメント", "ページ 2 変更 3のコメント",
  ]);
  expect(rows[2].querySelector("img")).toBe(cachedImage);
  expect(cachedImage.alt).toBe("ページ 2 変更 3の差分画像");
  expect(rows[2].querySelector("textarea").value).toBe("抵抗値を確認");
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

// Break: replacing the textarea or its ancestors interrupts an active IME composition.
test("keeps the comment and its ancestors mounted through input and index progress", () => {
  const { state, dom, document, controller, view } = harness();
  view.render();
  const field = dom.reviewList.querySelector('[data-review-comment="change-1"]');
  const article = field.parentElement;
  const group = article.parentElement;
  field.focus();
  field.value = "にほん";
  controller.setComment("change-1", field.value);
  view.render();
  expect(dom.reviewList.querySelector('[data-review-comment="change-1"]')).toBe(field);
  expect(field.parentElement).toBe(article);
  expect(article.parentElement).toBe(group);
  // A composition update can precede its input event. External renders must not restore stale text.
  field.value = "日本";
  state.review.indexRunning = true;
  state.review.indexedPages = 1;
  state.review.indexErrors.set(0, "一時的な失敗");
  controller.commitPage({ pageIndex: 2, width: 100, height: 100, boxes: [] });
  view.render();
  view.render();
  expect(dom.reviewList.querySelector('[data-review-comment="change-1"]')).toBe(field);
  expect(field.value).toBe("日本");
  expect(document.activeElement).toBe(field);
  expect(document.detachedActiveCount).toBe(0);
  controller.setComment("change-1", field.value);
  view.render();
  expect(state.review.entriesById.get("change-1").comment).toBe("日本");
});

// Break: recreating a selected row button removes the keyboard user's active control.
test("retains the selected item's button and keyboard focus after rendering", () => {
  const { state, dom, document, view } = harness();
  view.render();
  const button = dom.reviewList.querySelector('[data-change-id="change-1"]').querySelector("button");
  button.focus();
  state.review.selectedId = "change-1";
  view.render();
  expect(dom.reviewList.querySelector('[data-change-id="change-1"]').querySelector("button")).toBe(button);
  expect(document.activeElement).toBe(button);
  expect(button.getAttribute("aria-pressed")).toBe("true");
});

test("shows the boundary rail labels for closed and open review panels", () => {
  const { state, dom, view } = harness();
  state.review.panelOpen = false;
  view.render();
  expect(dom.reviewRailToggle.textContent).toBe("«");
  expect(dom.reviewRailToggle.getAttribute("aria-label")).toBe("変更箇所を開く");
  expect(dom.reviewRailToggle.getAttribute("aria-expanded")).toBe("false");

  state.review.panelOpen = true;
  view.render();
  expect(dom.reviewRailToggle.textContent).toBe("»");
  expect(dom.reviewRailToggle.getAttribute("aria-label")).toBe("変更箇所を閉じる");
  expect(dom.reviewRailToggle.getAttribute("aria-expanded")).toBe("true");
});

// Break: using panel visibility as state erases the user's open state on text-mode switches.
test("hides only the panel presentation in text mode and restores the selected item", () => {
  const { state, dom, document, view } = harness();
  state.review.selectedId = "change-2";
  view.render();
  expect(dom.reviewPanel.hidden).toBe(false);
  expect(dom.reviewRail.hidden).toBe(false);
  expect(dom.reviewRailToggle.getAttribute("aria-expanded")).toBe("true");
  expect(dom.reviewList.querySelector('[data-change-id="change-2"]').classList.contains("selected")).toBe(true);
  state.ui.topMode = "text";
  view.render();
  expect(dom.reviewPanel.hidden).toBe(true);
  expect(dom.reviewRail.hidden).toBe(true);
  expect(dom.reviewBackdrop.hidden).toBe(true);
  expect(document.body.classList.contains("review-rail-hidden")).toBe(true);
  expect(state.review.panelOpen).toBe(true);
  state.ui.topMode = "visual";
  view.render();
  expect(dom.reviewPanel.hidden).toBe(false);
  expect(dom.reviewRail.hidden).toBe(false);
  expect(document.body.classList.contains("review-rail-hidden")).toBe(false);
  expect(dom.reviewList.querySelector('[data-review-comment="change-2"]').value).toBe("抵抗値を確認");
});

// Break: replacing an active confirmation checkbox drops keyboard focus during a confirmation change.
test("preserves the confirmation checkbox node and keyboard focus after its value changes", () => {
  const { state, dom, document, view } = harness();
  view.render();
  const checkbox = dom.reviewList.querySelector('[data-review-confirmed="change-1"]');
  checkbox.focus();
  state.review.entriesById.set("change-1", { status: "confirmed", comment: "" });
  view.render();
  expect(dom.reviewList.querySelector('[data-review-confirmed="change-1"]')).toBe(checkbox);
  expect(document.activeElement).toBe(checkbox);
  expect(checkbox.checked).toBe(true);
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
  expect(dom.reviewNotice.textContent).toContain("レビュー1件を継承し、");
  expect(dom.reviewNotice.textContent).toContain("1件を未確認へ戻しました");
  expect(dom.reviewList.textContent).toContain("画像を読めません");
  expect(dom.reviewList.querySelector('[data-review-retry="2"]').disabled).toBe(true);
  state.review.indexRunning = false;
  view.render();
  expect(dom.reviewList.querySelector('[data-review-retry="2"]').disabled).toBe(false);
});

// Break: an interrupted, error-free index must not claim completion before all pages are accounted for.
test("shows an incomplete idle index as waiting and a fully processed index as complete", () => {
  const { state, dom, view } = harness();
  Object.assign(state.review, { indexRunning: false, indexedPages: 1, indexTotal: 3 });
  view.render();
  expect(dom.reviewIndexStatus.textContent).toBe("分析待機中 1 / 3 ページ");
  state.review.indexedPages = 3;
  view.render();
  expect(dom.reviewIndexStatus.textContent).toBe("分析完了 3 / 3 ページ");
});

test("enables add after visual render and reset only when the current page has hand edits", () => {
  const { state, dom, view } = harness();
  view.render();
  expect(dom.reviewAdd.disabled).toBe(true);
  expect(dom.reviewReset.disabled).toBe(true);

  state.visual.rendered = true;
  view.render();
  expect(dom.reviewAdd.disabled).toBe(false);
  expect(dom.reviewReset.disabled).toBe(true);

  state.boxEditor.editsByPage.set(0, [{ id: "change-1", x: 10, y: 10, w: 20, h: 20 }]);
  view.render();
  expect(dom.reviewReset.disabled).toBe(false);

  state.documents.currentPage = 1;
  view.render();
  expect(dom.reviewReset.disabled).toBe(true);
});
