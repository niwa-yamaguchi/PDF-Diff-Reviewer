import { sortReviewItems, summarizeReviews } from "../../core/change-review/model.js";
import { reviewLabels } from "../../core/change-review/label.js";

const KIND_LABELS = { added: "追加", removed: "削除", changed: "変更" };

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
    const confirmedLabel = element("label", "review-confirmed-label");
    const confirmed = element("input", "review-confirmed");
    confirmed.type = "checkbox";
    confirmed.dataset.reviewConfirmed = item.id;
    confirmedLabel.append(confirmed, element("span", "", "確認済み"));
    const comment = element("textarea", "review-comment");
    comment.dataset.reviewComment = item.id;
    comment.rows = 2;
    comment.placeholder = "確認メモを入力";
    const thumbnail = element("div", "review-thumbnail");
    thumbnail.dataset.reviewThumbnail = item.id;
    thumbnail.style.width = "120px";
    thumbnail.style.height = "80px";
    const actions = element("div", "review-actions");
    const editingLabel = element("span", "review-editing", "編集中");
    const edit = element("button", "review-edit", "編集");
    edit.dataset.reviewEdit = item.id;
    const remove = element("button", "review-delete", "削除");
    remove.dataset.reviewDelete = item.id;
    remove.title = "選択した変更箇所を削除（Delete）";
    actions.append(editingLabel, edit, remove);
    article.append(select, thumbnail, actions, confirmedLabel, comment);
    return { article, select, number, kind, stateLabel, confirmed, comment, thumbnail,
      editingLabel, edit, remove };
  }

  function render({ preserveCommentFocus = true } = {}) {
    const { review } = state;
    const visual = state.ui.topMode === "visual";
    const visible = review.panelOpen && visual;
    const selectionChanged = review.selectedId !== previousSelectedId;
    dom.reviewPanel.hidden = !visible;
    dom.reviewBackdrop.hidden = !visible;
    if (dom.reviewRail) dom.reviewRail.hidden = !visual;
    const toggle = dom.reviewRailToggle;
    toggle.textContent = visible ? "»" : "«";
    toggle.setAttribute("aria-expanded", String(visible));
    toggle.setAttribute("aria-label", visible ? "変更箇所を閉じる" : "変更箇所を開く");
    document.body.classList.toggle("review-open", visible);
    document.body.classList.toggle("review-rail-hidden", !visual);

    const active = document.activeElement;
    const focus = preserveCommentFocus && dom.reviewList.contains(active) && active.dataset.reviewComment
      ? { id: active.dataset.reviewComment, start: active.selectionStart, end: active.selectionEnd,
        direction: active.selectionDirection } : null;
    const activeConfirmedId = dom.reviewList.contains(active) ? active.dataset.reviewConfirmed : null;
    const items = sortReviewItems([...review.itemsByPage.values()].flat());
    const labels = reviewLabels(review.itemsByPage, review.entriesById);
    const summary = summarizeReviews(items, review.entriesById);
    dom.reviewTotal.textContent = `変更箇所 ${summary.total}件`;
    dom.reviewProgress.textContent = `確認済み ${summary.complete} / ${summary.total}　未確認 ${summary.pending}件`;
    dom.reviewIndexStatus.textContent = review.indexRunning
      ? `索引作成中 ${review.indexedPages} / ${review.indexTotal} ページ`
      : review.indexErrors.size ? `索引エラー ${review.indexErrors.size}ページ`
        : review.indexTotal ? `${review.indexedPages >= review.indexTotal ? "分析完了" : "分析待機中"} ${review.indexedPages} / ${review.indexTotal} ページ` : "";
    dom.reviewPrev.disabled = dom.reviewNext.disabled = !items.length;
    dom.reviewAdd.disabled = !state.visual.rendered;
    dom.reviewReset.disabled = !state.boxEditor.editsByPage.has(state.documents.currentPage);
    dom.reviewNotice.textContent = review.actionNotice || (review.migrationSummary
      ? `レビュー${review.migrationSummary.inherited}件を継承し、${review.migrationSummary.reset}件を未確認へ戻しました` : "");

    const pages = [...new Set([...review.itemsByPage.keys(), ...review.indexErrors.keys()])].sort((a, b) => a - b);
    const groups = [];
    let focusedField;
    let focusedConfirmed;
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
      for (const item of pageItems) {
        const changeNumber = labels.get(item.id).number;
        const entry = review.entriesById.get(item.id) || { status: "pending", comment: "" };
        if (!itemViews.has(item.id)) itemViews.set(item.id, createItem(item));
        const { article, select, number, kind, stateLabel, confirmed, comment, thumbnail,
          editingLabel, edit } = itemViews.get(item.id);
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
            thumbnail.replaceChildren(image);
          } else thumbnail.textContent = thumbnails?.error ? "画像なし" : "";
        }
        const image = thumbnail.querySelector("img");
        if (image) image.alt = `ページ ${pageIndex + 1} 変更 ${changeNumber}の差分画像`;
        article.classList.toggle("selected", review.selectedId === item.id);
        const editing = state.boxEditor.mode === "edit" && review.selectedId === item.id;
        article.classList.toggle("editing", editing);
        article.setAttribute("aria-current", String(review.selectedId === item.id));
        select.setAttribute("aria-pressed", String(review.selectedId === item.id));
        number.textContent = String(changeNumber);
        kind.className = `review-kind ${item.kind}`;
        kind.textContent = KIND_LABELS[item.kind] || "変更";
        const isConfirmed = entry.status === "confirmed";
        stateLabel.textContent = isConfirmed ? "確認済み" : "未確認";
        editingLabel.hidden = !editing;
        edit.textContent = editing ? "編集を終了" : "編集";
        select.setAttribute("aria-label", `ページ ${pageIndex + 1} 変更 ${changeNumber}を表示`);
        confirmed.checked = isConfirmed;
        if (activeConfirmedId === item.id) focusedConfirmed = confirmed;
        comment.setAttribute("aria-label", `ページ ${pageIndex + 1} 変更 ${changeNumber}のコメント`);
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
    if (visible && selectionChanged && review.selectedId) {
      itemViews.get(review.selectedId)?.article.scrollIntoView({ block: "nearest" });
    }
    previousSelectedId = review.selectedId;
    if (focusedField && visible && document.activeElement !== focusedField) {
      focusedField.focus({ preventScroll: true });
      focusedField.setSelectionRange(focus.start, focus.end, focus.direction);
    } else if (focusedConfirmed && visible && document.activeElement !== focusedConfirmed) {
      focusedConfirmed.focus({ preventScroll: true });
    }
    if (visible) for (const [pageIndex, { group }] of pageViews) {
      if (group.open) requestPageThumbnails(pageIndex);
    }
  }

  return { render };
}
