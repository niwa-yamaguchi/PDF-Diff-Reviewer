import { sortReviewItems, summarizeReviews } from "../../core/change-review/model.js";

const KIND_LABELS = { added: "追加", removed: "削除", changed: "変更" };
const STATUS_LABELS = { pending: "未確認", confirmed: "確認済み", excluded: "対象外" };

export function createChangeReviewView({ state, dom, document = dom.reviewList.ownerDocument,
  requestPageThumbnails = () => {} }) {
  let previousSelectedId = null;
  const pageViews = new Map();
  const itemViews = new Map();
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // Leave existing children in place: detaching an active textarea cancels IME composition.
  function syncChildren(parent, children) {
    const kept = new Set(children);
    for (const child of [...parent.children]) if (!kept.has(child)) parent.removeChild(child);
    children.forEach((child, index) => {
      if (parent.children[index] !== child) parent.insertBefore(child, parent.children[index] || null);
    });
  }

  function createItem(item) {
    const article = element("article", "review-item");
    article.dataset.changeId = item.id;
    const select = element("button", "review-select");
    const number = element("span", "review-number");
    const kind = element("span");
    const stateLabel = element("span", "review-state");
    select.append(number, kind, stateLabel);
    const status = element("select", "review-status");
    status.dataset.reviewStatus = item.id;
    for (const [value, label] of Object.entries(STATUS_LABELS)) {
      const option = element("option", "", label);
      option.value = value;
      status.append(option);
    }
    const comment = element("textarea", "review-comment");
    comment.dataset.reviewComment = item.id;
    comment.rows = 2;
    comment.placeholder = "確認メモを入力";
    const thumbnail = element("div", "review-thumbnail");
    thumbnail.dataset.reviewThumbnail = item.id;
    thumbnail.style.width = "120px";
    thumbnail.style.height = "80px";
    article.append(select, thumbnail, status, comment);
    return { article, select, number, kind, stateLabel, status, comment, thumbnail };
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
      if (!pageViews.has(pageIndex)) {
        const group = element("details", "review-page");
        group.dataset.reviewPage = String(pageIndex);
        group.open = pageIndex === state.documents.currentPage;
        pageViews.set(pageIndex, { group, title: element("summary", "review-page-title") });
      }
      const { group, title } = pageViews.get(pageIndex);
      const children = [title];
      if (review.selectedId !== previousSelectedId && pageItems.some(item => item.id === review.selectedId)) {
        group.open = true;
      }
      title.textContent = `ページ ${pageIndex + 1}　${pageItems.length}件　完了 ${counts?.complete || 0}`;
      if (review.indexErrors.has(pageIndex)) {
        const error = element("div", "review-error");
        error.append(element("p", "", review.indexErrors.get(pageIndex)));
        const retry = element("button", "", "このページを再試行");
        retry.dataset.reviewRetry = String(pageIndex);
        retry.disabled = review.indexRunning;
        error.append(retry);
        children.push(error);
      }
      for (const [index, item] of pageItems.entries()) {
        const entry = review.entriesById.get(item.id) || { status: "pending", comment: "" };
        if (!itemViews.has(item.id)) itemViews.set(item.id, createItem(item));
        const { article, select, number, kind, stateLabel, status, comment, thumbnail } = itemViews.get(item.id);
        const thumbnails = review.thumbnailsByPage.get(pageIndex);
        const url = thumbnails instanceof Map ? thumbnails.get(item.id) : null;
        const thumbnailState = url || (thumbnails?.error ? "error" : "loading");
        if (thumbnail.dataset.state !== thumbnailState) {
          thumbnail.dataset.state = thumbnailState;
          thumbnail.setAttribute("aria-busy", String(thumbnailState === "loading"));
          thumbnail.classList.toggle("loading", thumbnailState === "loading");
          if (url) {
            const image = element("img");
            image.src = url;
            image.width = 120;
            image.height = 80;
            image.alt = `ページ ${pageIndex + 1} 変更 ${index + 1}の差分画像`;
            thumbnail.replaceChildren(image);
          } else thumbnail.textContent = thumbnails?.error ? "画像なし" : "";
        }
        article.classList.toggle("selected", review.selectedId === item.id);
        select.setAttribute("aria-pressed", String(review.selectedId === item.id));
        number.textContent = `${pageIndex + 1}.${index + 1}`;
        kind.className = `review-kind ${item.kind}`;
        kind.textContent = KIND_LABELS[item.kind] || "変更";
        stateLabel.textContent = STATUS_LABELS[entry.status];
        select.setAttribute("aria-label", `ページ ${pageIndex + 1} 変更 ${index + 1}を表示`);
        status.setAttribute("aria-label", `ページ ${pageIndex + 1} 変更 ${index + 1}の状態`);
        status.value = entry.status;
        if (activeStatusId === item.id) focusedStatus = status;
        comment.setAttribute("aria-label", `ページ ${pageIndex + 1} 変更 ${index + 1}のコメント`);
        if (active !== comment) {
          if (comment.textContent !== entry.comment) comment.textContent = entry.comment;
          if (comment.value !== entry.comment) comment.value = entry.comment;
        }
        if (focus?.id === item.id) focusedField = comment;
        children.push(article);
      }
      syncChildren(group, children);
      groups.push(group);
    }
    if (!groups.length) groups.push(element("p", "review-empty", review.indexRunning
      ? "変更箇所を調べています…" : "差分を表示すると、変更箇所を一覧で確認できます。"));
    syncChildren(dom.reviewList, groups);
    for (const pageIndex of pageViews.keys()) if (!pages.includes(pageIndex)) pageViews.delete(pageIndex);
    const ids = new Set(items.map(item => item.id));
    for (const id of itemViews.keys()) if (!ids.has(id)) itemViews.delete(id);
    previousSelectedId = review.selectedId;
    if (focusedField && visible && document.activeElement !== focusedField) {
      focusedField.focus({ preventScroll: true });
      focusedField.setSelectionRange(focus.start, focus.end, focus.direction);
    } else if (focusedStatus && visible && document.activeElement !== focusedStatus) {
      focusedStatus.focus({ preventScroll: true });
    }
    if (visible) for (const [pageIndex, { group }] of pageViews) {
      if (group.open) requestPageThumbnails(pageIndex);
    }
  }

  return { render };
}
