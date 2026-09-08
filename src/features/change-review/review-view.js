import { sortReviewItems, summarizeReviews } from "../../core/change-review/model.js";

const KIND_LABELS = { added: "追加", removed: "削除", changed: "変更" };
const STATUS_LABELS = { pending: "未確認", confirmed: "確認済み", excluded: "対象外" };

export function createChangeReviewView({ state, dom, document = dom.reviewList.ownerDocument }) {
  let previousSelectedId = null;
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function render({ preserveCommentFocus = true } = {}) {
    const { review } = state;
    const visible = review.panelOpen && state.ui.topMode === "visual";
    dom.reviewPanel.hidden = !visible;
    dom.reviewBackdrop.hidden = !visible;
    dom.reviewToggle.setAttribute("aria-expanded", String(visible));
    document.body.classList.toggle("review-open", visible);

    const active = document.activeElement;
    const focus = preserveCommentFocus && dom.reviewList.contains(active) && active.dataset.reviewComment
      ? { id: active.dataset.reviewComment, start: active.selectionStart, end: active.selectionEnd,
        direction: active.selectionDirection } : null;
    const activeStatusId = dom.reviewList.contains(active) ? active.dataset.reviewStatus : null;
    const expanded = new Map([...dom.reviewList.querySelectorAll("details")]
      .map(group => [group.dataset.reviewPage, group.open]));
    const items = sortReviewItems([...review.itemsByPage.values()].flat());
    const summary = summarizeReviews(items, review.entriesById);
    dom.reviewTotal.textContent = `変更箇所 ${summary.total}件`;
    dom.reviewProgress.textContent = `完了 ${summary.complete} / ${summary.total}　未確認 ${summary.pending}件`;
    dom.reviewIndexStatus.textContent = review.indexRunning
      ? `索引作成中 ${review.indexedPages} / ${review.indexTotal} ページ`
      : review.indexErrors.size ? `索引エラー ${review.indexErrors.size}ページ`
        : review.indexTotal ? `索引完了 ${review.indexedPages} / ${review.indexTotal} ページ` : "";
    dom.reviewPrev.disabled = dom.reviewNext.disabled = !items.length;
    dom.reviewNotice.textContent = review.migrationSummary
      ? `引継ぎ ${review.migrationSummary.inherited}件 ／ 未確認に戻した変更 ${review.migrationSummary.reset}件` : "";

    const pages = [...new Set([...review.itemsByPage.keys(), ...review.indexErrors.keys()])].sort((a, b) => a - b);
    const groups = [];
    let focusedField;
    let focusedStatus;
    for (const pageIndex of pages) {
      const pageItems = items.filter(item => item.pageIndex === pageIndex);
      const counts = summary.byPage.get(pageIndex);
      const group = element("details", "review-page");
      group.dataset.reviewPage = String(pageIndex);
      group.open = expanded.get(String(pageIndex)) ?? true;
      if (review.selectedId !== previousSelectedId && pageItems.some(item => item.id === review.selectedId)) {
        group.open = true;
      }
      group.append(element("summary", "review-page-title",
        `ページ ${pageIndex + 1}　${pageItems.length}件　完了 ${counts?.complete || 0}`));
      if (review.indexErrors.has(pageIndex)) {
        const error = element("div", "review-error");
        error.append(element("p", "", review.indexErrors.get(pageIndex)));
        const retry = element("button", "", "このページを再試行");
        retry.dataset.reviewRetry = String(pageIndex);
        retry.disabled = review.indexRunning;
        error.append(retry);
        group.append(error);
      }
      for (const [index, item] of pageItems.entries()) {
        const entry = review.entriesById.get(item.id) || { status: "pending", comment: "" };
        const article = element("article", "review-item");
        article.dataset.changeId = item.id;
        article.classList.toggle("selected", review.selectedId === item.id);
        const select = element("button", "review-select");
        select.setAttribute("aria-pressed", String(review.selectedId === item.id));
        select.append(element("span", "review-number", `${pageIndex + 1}.${index + 1}`),
          element("span", `review-kind ${item.kind}`, KIND_LABELS[item.kind] || "変更"),
          element("span", "review-state", STATUS_LABELS[entry.status]));
        select.setAttribute("aria-label", `ページ ${pageIndex + 1} 変更 ${index + 1}を表示`);
        const status = element("select", "review-status");
        status.dataset.reviewStatus = item.id;
        status.setAttribute("aria-label", `ページ ${pageIndex + 1} 変更 ${index + 1}の状態`);
        for (const [value, label] of Object.entries(STATUS_LABELS)) {
          const option = element("option", "", label);
          option.value = value;
          status.append(option);
        }
        status.value = entry.status;
        if (activeStatusId === item.id) focusedStatus = status;
        const comment = element("textarea", "review-comment");
        comment.dataset.reviewComment = item.id;
        comment.rows = 2;
        comment.placeholder = "確認メモを入力";
        comment.setAttribute("aria-label", `ページ ${pageIndex + 1} 変更 ${index + 1}のコメント`);
        comment.textContent = entry.comment;
        comment.value = entry.comment;
        if (focus?.id === item.id) focusedField = comment;
        article.append(select, status, comment);
        group.append(article);
      }
      groups.push(group);
    }
    if (!groups.length) groups.push(element("p", "review-empty", review.indexRunning
      ? "変更箇所を調べています…" : "差分を表示すると、変更箇所を一覧で確認できます。"));
    dom.reviewList.replaceChildren(...groups);
    previousSelectedId = review.selectedId;
    if (focusedField && visible) {
      focusedField.focus({ preventScroll: true });
      focusedField.setSelectionRange(focus.start, focus.end, focus.direction);
    } else if (focusedStatus && visible) {
      focusedStatus.focus({ preventScroll: true });
    }
  }

  return { render };
}
