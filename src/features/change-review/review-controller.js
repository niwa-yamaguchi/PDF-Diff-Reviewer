import { createReviewItems, pageKeyFor, reconcileReviewItems, sortReviewItems } from "../../core/change-review/model.js";

function reconcileRedrawnItems({ previousItems, nextItems, entries, allocateId }) {
  const remainingPrevious = [...previousItems];
  const exactMatches = new Map();
  for (const nextItem of nextItems) {
    const index = remainingPrevious.findIndex(previous => previous.pageKey === nextItem.pageKey
      && previous.kind === nextItem.kind
      && ["x", "y", "w", "h"].every(key => previous.rect[key] === nextItem.rect[key]));
    if (index < 0) continue;
    const [previous] = remainingPrevious.splice(index, 1);
    exactMatches.set(nextItem, { ...nextItem, id: previous.id });
  }
  const reconciled = reconcileReviewItems({
    previousItems: remainingPrevious,
    nextItems: nextItems.filter(item => !exactMatches.has(item)),
    entries,
    allocateId,
  });
  let remainingIndex = 0;
  return {
    ...reconciled,
    items: nextItems.map(item => exactMatches.get(item) || reconciled.items[remainingIndex++]),
    summary: { ...reconciled.summary, inherited: reconciled.summary.inherited + exactMatches.size },
  };
}

export function createChangeReviewController({
  state, renderIndexPage, cancelIndex: cancelLane, onChanged = () => {}, reportError = () => {},
  showPage, focusRect,
}) {
  const dimensionsByPage = new Map();
  let migration = null;
  let migrationCounts = new Map();
  let dimensionReview = state.review;
  let selectionTicket = 0;
  let navigationTicket = null;

  const orderedItems = () => sortReviewItems([...state.review.itemsByPage.values()].flat());

  async function select(id) {
    const ticket = ++selectionTicket;
    const review = state.review;
    const generation = review.indexGeneration;
    const item = orderedItems().find(item => item.id === id);
    if (!item || state.ui.topMode !== "visual") return false;
    review.selectedId = id;
    onChanged();
    if (state.documents.currentPage !== item.pageIndex || !state.visual.rendered || navigationTicket !== null) {
      navigationTicket = ticket;
      try {
        const result = await showPage(item.pageIndex);
        if (!result?.committed) return false;
      } finally {
        if (navigationTicket === ticket) navigationTicket = null;
      }
    }
    if (ticket !== selectionTicket || review !== state.review || generation !== review.indexGeneration
      || state.ui.topMode !== "visual" || review.selectedId !== id) return false;
    const current = orderedItems().find(item => item.id === id);
    if (!current) return false;
    focusRect(current.rect, { padding: 0.25, maxScale: 4 });
    onChanged();
    return true;
  }

  function selectRelative(direction) {
    const items = orderedItems();
    if (!items.length) return Promise.resolve(false);
    const index = items.findIndex(item => item.id === state.review.selectedId);
    const next = index < 0 ? (direction > 0 ? 0 : items.length - 1)
      : (index + direction + items.length) % items.length;
    return select(items[next].id);
  }

  function updateEntry(id, patch) {
    if (!orderedItems().some(item => item.id === id)) return;
    const entry = state.review.entriesById.get(id) || { status: "pending", comment: "" };
    state.review.entriesById.set(id, { ...entry, ...patch });
    onChanged();
  }

  function setStatus(id, status) {
    if (["pending", "confirmed", "excluded"].includes(status)) updateEntry(id, { status });
  }

  function setComment(id, comment) { updateEntry(id, { comment }); }

  function togglePanel(open = !state.review.panelOpen) {
    state.review.panelOpen = open;
    onChanged();
  }

  async function retryPage(pageIndex) {
    const review = state.review;
    if (review.indexRunning || !review.indexErrors.has(pageIndex)) return;
    const generation = review.indexGeneration;
    review.indexRunning = true;
    onChanged();
    try {
      const result = await renderIndexPage(pageIndex);
      if (review !== state.review || generation !== review.indexGeneration) return;
      if (state.boxEditor.editsByPage.has(pageIndex)) {
        syncEditedPage({ pageIndex, width: result.width, height: result.height });
      } else commitPage({ ...result, pageIndex });
    } catch (error) {
      if (review !== state.review || generation !== review.indexGeneration) return;
      if (error?.name !== "RenderCancelled") {
        let failure = error;
        if (state.boxEditor.editsByPage.has(pageIndex)) {
          try {
            syncEditedPage({ pageIndex });
            failure = null;
          } catch (syncError) {
            failure = syncError;
          }
        }
        if (failure) {
          review.indexErrors.set(pageIndex, failure.message || String(failure));
          reportError(failure, pageIndex);
        }
      }
    } finally {
      if (review === state.review && generation === review.indexGeneration) {
        review.indexRunning = false;
        onChanged();
      }
    }
  }

  function allocateId() {
    let id;
    do { id = `change-${state.review.nextId++}`; }
    while (state.review.entriesById.has(id) || state.review.pendingMigration?.entriesById.has(id));
    return id;
  }

  function pageDimensions(pageIndex, width, height) {
    if (dimensionReview !== state.review) {
      dimensionsByPage.clear();
      dimensionReview = state.review;
    }
    if (width > 0 && height > 0) dimensionsByPage.set(pageIndex, { width, height });
    const dimensions = dimensionsByPage.get(pageIndex);
    if (!dimensions) throw new Error(`ページ ${pageIndex + 1} の変更枠寸法がありません`);
    return dimensions;
  }

  function rememberPageDimensions(pageIndex, width, height) {
    pageDimensions(pageIndex, width, height);
  }

  function commitPage({ pageIndex, pageKey = pageKeyFor(state.documents, pageIndex), boxes,
    autoBoxes, width, height, source = "auto" }) {
    const review = state.review;
    const dimensions = pageDimensions(pageIndex, width, height);
    const pending = review.pendingMigration;
    if (migration !== pending) {
      migration = pending;
      migrationCounts = new Map();
    }
    const current = review.itemsByPage.get(pageIndex);
    const previousItems = current || [...(pending?.itemsByPage.values() || [])]
      .flat().filter(item => item.pageKey === pageKey);
    const entries = new Map([...(pending?.entriesById || []), ...review.entriesById]);
    let items;
    let summary = { inherited: 0, reset: 0 };
    if (source === "manual") {
      items = boxes.map(box => ({
        ...createReviewItems({ boxes: [box], pageIndex, pageKey, ...dimensions,
          source: box.source || "manual", allocateId: () => box.id || allocateId() })[0],
      }));
    } else {
      const nextItems = createReviewItems({ boxes, pageIndex, pageKey, ...dimensions,
        source, allocateId: previousItems.length ? () => null : allocateId });
      if (previousItems.length) {
        const reconcile = current ? reconcileRedrawnItems : reconcileReviewItems;
        const reconciled = reconcile({ previousItems, nextItems, entries, allocateId });
        items = reconciled.items;
        summary = reconciled.summary;
        for (const [id, entry] of reconciled.entries) entries.set(id, entry);
      } else {
        items = nextItems;
        summary.reset = items.length;
      }
    }
    for (const item of items) {
      if (!entries.has(item.id)) entries.set(item.id, { status: "pending", comment: "" });
    }
    review.entriesById = entries;
    review.itemsByPage.set(pageIndex, sortReviewItems(items));
    review.indexErrors.delete(pageIndex);
    if (review.selectedId && current?.some(item => item.id === review.selectedId)
      && !items.some(item => item.id === review.selectedId)) review.selectedId = null;
    const currentBoxes = items.map(item => ({ ...item.rect, id: item.id, kind: item.kind, source: item.source }));
    const committedAuto = source === "auto" ? currentBoxes.map(box => ({ ...box })) : autoBoxes;
    if (committedAuto !== undefined) state.boxEditor.autoByPage.set(pageIndex, committedAuto);
    if (pending) {
      if (!migrationCounts.has(pageIndex)) migrationCounts.set(pageIndex, summary);
      if (Array.from({ length: state.documents.pages }, (_, index) => index)
        .every(index => review.itemsByPage.has(index))) {
        review.migrationSummary = [...pending.itemsByPage.values()].some(items => items.length)
          ? [...migrationCounts.values()].reduce((total, count) => ({
            inherited: total.inherited + count.inherited, reset: total.reset + count.reset,
          }), { inherited: 0, reset: 0 }) : null;
        review.pendingMigration = null;
      }
    }
    onChanged();
    return { currentBoxes, autoBoxes: committedAuto };
  }

  function syncEditedPage({ pageIndex, boxes = state.boxEditor.editsByPage.get(pageIndex) || [], width, height }) {
    return commitPage({ pageIndex, boxes, width, height, source: "manual" });
  }

  function cancelIndex() {
    state.review.indexGeneration += 1;
    state.review.indexRunning = false;
    cancelLane?.();
    onChanged();
  }

  async function startIndex({ skipPages = new Set() } = {}) {
    cancelIndex();
    const review = state.review;
    const generation = review.indexGeneration;
    const documentGeneration = state.documents.generation;
    const isCurrent = () => state.review === review && generation === review.indexGeneration
      && documentGeneration === state.documents.generation;
    review.indexRunning = true;
    review.indexedPages = 0;
    review.indexTotal = state.documents.pages;
    review.indexErrors.clear();
    onChanged();
    for (let pageIndex = 0; pageIndex < review.indexTotal; pageIndex += 1) {
      if (!isCurrent()) break;
      try {
        if (state.boxEditor.editsByPage.has(pageIndex)) {
          syncEditedPage({ pageIndex });
        } else if (!skipPages.has(pageIndex)) {
          const result = await renderIndexPage(pageIndex);
          if (!isCurrent()) break;
          // 編集は索引Workerの待機中にも発生する。最新の手編集を優先する。
          if (state.boxEditor.editsByPage.has(pageIndex)) {
            syncEditedPage({ pageIndex, width: result.width, height: result.height });
          } else {
            commitPage({ ...result, pageIndex });
          }
        }
      } catch (error) {
        if (!isCurrent() || error?.name === "RenderCancelled") break;
        let failure = error;
        if (state.boxEditor.editsByPage.has(pageIndex)) {
          try {
            syncEditedPage({ pageIndex });
            failure = null;
          } catch (syncError) {
            failure = syncError;
          }
        }
        if (failure) {
          review.indexErrors.set(pageIndex, failure.message || String(failure));
          reportError(failure, pageIndex);
        }
      }
      if (!isCurrent()) break;
      review.indexedPages += 1;
      onChanged();
    }
    if (isCurrent()) {
      review.indexRunning = false;
      onChanged();
    }
  }

  return { commitPage, startIndex, cancelIndex, syncEditedPage, allocateId, rememberPageDimensions,
    select, selectPrevious: () => selectRelative(-1), selectNext: () => selectRelative(1),
    setStatus, setComment, togglePanel, retryPage };
}
