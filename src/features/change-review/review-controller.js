import { createReviewItems, pageKeyFor, reconcileReviewItems, sortReviewItems } from "../../core/change-review/model.js";
import { createRenderCancellation } from "../../core/rendering/cancellation.js";
import { cropChangeThumbnail } from "./thumbnail-renderer.js";

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
  showPage, focusRect, beginBoxEdit, beginBoxCreate, stopBoxEditing, deleteBox, resetBoxes, cancelNavigation,
  renderThumbnailPage, createCanvas, createSnapshot,
}) {
  const dimensionsByPage = new Map();
  let migration = null;
  let migrationCounts = new Map();
  let dimensionReview = state.review;
  let selectionTicket = 0;
  let navigationTicket = null;
  const thumbnailQueue = new Set();
  const thumbnailRequests = new Map();
  let thumbnailDrain = null;
  let indexCancellation = null;
  let thumbnailCancellation = null;
  let backgroundPaused = false;
  let resumeIndexRequested = false;
  let pendingIndexOptions = null;
  const pausedThumbnailPages = new Set();

  function drainThumbnails() {
    if (backgroundPaused || thumbnailDrain || state.review.indexRunning || !thumbnailQueue.size) return;
    thumbnailDrain = (async () => {
      while (thumbnailQueue.size && !state.review.indexRunning) {
        const pageIndex = Math.min(...thumbnailQueue);
        thumbnailQueue.delete(pageIndex);
        const request = thumbnailRequests.get(pageIndex);
        const { review, generation } = request;
        const isCurrent = () => review === state.review && generation === review.indexGeneration;
        try {
          if (!isCurrent() || review.thumbnailsByPage.has(pageIndex)) continue;
          const snapshot = createSnapshot(pageIndex);
          const ratio = 72 / snapshot.comparison.dpi;
          const thumbnailSnapshot = Object.freeze({ ...snapshot,
            comparison: Object.freeze({ ...snapshot.comparison, dpi: 72,
              dx: snapshot.comparison.dx * ratio, dy: snapshot.comparison.dy * ratio }),
          });
          const cancellation = createRenderCancellation();
          thumbnailCancellation = cancellation;
          const { canvas: source } = await renderThumbnailPage(thumbnailSnapshot, { cancellation });
          if (!isCurrent()) continue;
          const thumbnails = new Map();
          for (const item of review.itemsByPage.get(pageIndex) || []) {
            const canvas = cropChangeThumbnail({ source, normalizedRect: item.normalizedRect, createCanvas });
            thumbnails.set(item.id, canvas.toDataURL("image/png"));
          }
          review.thumbnailsByPage.set(pageIndex, thumbnails);
        } catch (error) {
          if (isCurrent() && error?.name !== "RenderCancelled") {
            review.thumbnailsByPage.set(pageIndex, { error: true });
          }
        } finally {
          thumbnailCancellation = null;
          if (thumbnailRequests.get(pageIndex) === request) thumbnailRequests.delete(pageIndex);
          request.resolve();
          if (isCurrent()) onChanged();
        }
      }
    })().finally(() => {
      thumbnailDrain = null;
      drainThumbnails();
    });
  }

  function requestPageThumbnails(pageIndex) {
    const review = state.review;
    if (!renderThumbnailPage || !review.itemsByPage.get(pageIndex)?.length
      || review.thumbnailsByPage.has(pageIndex)) return Promise.resolve();
    if (thumbnailRequests.has(pageIndex)) return thumbnailRequests.get(pageIndex).promise;
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    thumbnailRequests.set(pageIndex, { review, generation: review.indexGeneration, promise, resolve });
    thumbnailQueue.add(pageIndex);
    drainThumbnails();
    return promise;
  }

  const orderedItems = () => sortReviewItems([...state.review.itemsByPage.values()].flat());

  async function select(id, { preserveEdit = false } = {}) {
    const ticket = ++selectionTicket;
    const review = state.review;
    const item = orderedItems().find(item => item.id === id);
    if (!item || state.ui.topMode !== "visual") return false;
    if (!preserveEdit) stopBoxEditing?.();
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
    // ページ描画は背景の索引を一時停止して indexGeneration を進めるため、世代では判定しない。
    if (ticket !== selectionTicket || review !== state.review
      || state.ui.topMode !== "visual" || review.selectedId !== id) return false;
    const current = orderedItems().find(item => item.id === id);
    if (!current || current.pageIndex !== state.documents.currentPage) return false;
    focusRect(current.rect, { padding: 0.25, maxScale: 4 });
    onChanged();
    return true;
  }

  async function edit(id) {
    if (state.boxEditor.mode === "edit" && state.review.selectedId === id) {
      stopBoxEditing?.();
      onChanged();
      return true;
    }
    stopBoxEditing?.();
    if (!await select(id, { preserveEdit: true })) return false;
    const started = beginBoxEdit?.(id) ?? false;
    if (started) onChanged();
    return started;
  }

  function remove(id) {
    const deleted = deleteBox?.(id) ?? false;
    if (deleted) {
      state.review.actionNotice = "変更箇所を削除しました。Ctrl+Zで元に戻せます";
      onChanged();
    }
    return deleted;
  }

  function startCreate() {
    const started = beginBoxCreate?.() ?? false;
    if (started) onChanged();
    return started;
  }

  function resetCurrentPage() {
    const reset = resetBoxes?.() ?? false;
    if (reset) {
      state.review.actionNotice = "";
      onChanged();
    }
    return reset;
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

  function setConfirmed(id, confirmed) {
    updateEntry(id, { status: confirmed ? "confirmed" : "pending" });
  }

  function setComment(id, comment) { updateEntry(id, { comment }); }

  function togglePanel(open = !state.review.panelOpen) {
    if (state.review.panelOpen && !open) stopBoxEditing?.();
    state.review.panelOpen = open;
    onChanged();
  }

  async function retryPage(pageIndex) {
    const review = state.review;
    if (review.indexRunning || !review.indexErrors.has(pageIndex)) return;
    const generation = review.indexGeneration;
    let cancellation = null;
    review.indexRunning = true;
    onChanged();
    try {
      if (thumbnailDrain) await thumbnailDrain;
      if (review !== state.review || generation !== review.indexGeneration) return;
      cancellation = createRenderCancellation();
      indexCancellation = cancellation;
      const result = await renderIndexPage(pageIndex, { cancellation });
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
      if (indexCancellation === cancellation) indexCancellation = null;
      if (review === state.review && generation === review.indexGeneration) {
        review.indexRunning = false;
        onChanged();
        drainThumbnails();
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
    if (source === "manual" && current) {
      const retainedIds = new Set(items.map(item => item.id));
      for (const item of current) {
        if (retainedIds.has(item.id)) continue;
        entries.delete(item.id);
        pending?.entriesById.delete(item.id);
      }
    }
    review.entriesById = entries;
    const nextItemsById = new Map(items.map(item => [item.id, item]));
    if (!current || current.length !== items.length || current.some(item => {
      const next = nextItemsById.get(item.id);
      return !next
        || ["x", "y", "w", "h"].some(key => item.normalizedRect[key] !== next.normalizedRect[key]);
    })) review.thumbnailsByPage.delete(pageIndex);
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
        migration = null;
        migrationCounts.clear();
        const retainedIds = new Set([...review.itemsByPage.values()].flat().map(item => item.id));
        for (const history of state.boxEditor.undoByPage.values()) {
          for (const id of history.referencedIds()) retainedIds.add(id);
        }
        for (const boxes of state.boxEditor.autoByPage.values()) {
          for (const box of boxes) retainedIds.add(box.id);
        }
        for (const id of review.entriesById.keys()) {
          if (!retainedIds.has(id)) review.entriesById.delete(id);
        }
      }
    }
    onChanged();
    return { currentBoxes, autoBoxes: committedAuto };
  }

  function syncEditedPage({ pageIndex, boxes = state.boxEditor.editsByPage.get(pageIndex) || [], width, height }) {
    return commitPage({ pageIndex, boxes, width, height, source: "manual" });
  }

  function cancelIndex({ notify = true, preserveDeferred = false } = {}) {
    state.review.indexGeneration += 1;
    state.review.indexRunning = false;
    cancelLane?.();
    indexCancellation?.cancel();
    indexCancellation = null;
    thumbnailCancellation?.cancel();
    thumbnailCancellation = null;
    pausedThumbnailPages.clear();
    if (!preserveDeferred) {
      pendingIndexOptions = null;
      resumeIndexRequested = false;
    }
    thumbnailQueue.clear();
    for (const request of thumbnailRequests.values()) request.resolve();
    thumbnailRequests.clear();
    if (notify) onChanged();
  }

  function pauseBackground() {
    if (backgroundPaused) return;
    const incomplete = state.review.indexTotal > 0
      && (state.review.indexedPages < state.review.indexTotal || state.review.indexErrors.size > 0);
    const shouldResume = state.review.indexRunning || incomplete;
    const thumbnails = new Set([...thumbnailQueue, ...thumbnailRequests.keys()]);
    backgroundPaused = true;
    cancelIndex({ notify: false, preserveDeferred: true });
    for (const pageIndex of thumbnails) pausedThumbnailPages.add(pageIndex);
    resumeIndexRequested = shouldResume;
  }

  function resumeBackground() {
    if (!backgroundPaused) return undefined;
    backgroundPaused = false;
    const thumbnailPages = [...pausedThumbnailPages];
    pausedThumbnailPages.clear();
    const pending = pendingIndexOptions;
    pendingIndexOptions = null;
    let indexing;
    if (pending) indexing = startIndex(pending);
    if (resumeIndexRequested) {
      resumeIndexRequested = false;
      if (!indexing) indexing = resumeIndex();
    }
    for (const pageIndex of thumbnailPages) void requestPageThumbnails(pageIndex);
    drainThumbnails();
    return indexing;
  }

  async function startIndex({ skipPages = new Set() } = {}) {
    if (backgroundPaused) {
      pendingIndexOptions = { skipPages: new Set(skipPages) };
      return;
    }
    cancelIndex({ notify: false });
    const cancellation = createRenderCancellation();
    indexCancellation = cancellation;
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
    if (thumbnailDrain) await thumbnailDrain;
    for (let pageIndex = 0; pageIndex < review.indexTotal; pageIndex += 1) {
      if (!isCurrent()) break;
      try {
        if (state.boxEditor.editsByPage.has(pageIndex)) {
          syncEditedPage({ pageIndex });
        } else if (!skipPages.has(pageIndex)) {
          const result = await renderIndexPage(pageIndex, { cancellation });
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
      if (indexCancellation === cancellation) indexCancellation = null;
      onChanged();
      drainThumbnails();
    }
  }

  function resumeIndex() {
    const review = state.review;
    if (!review.indexTotal || review.indexRunning
      || (review.indexedPages >= review.indexTotal && !review.indexErrors.size)) return;
    return startIndex({ skipPages: new Set(review.itemsByPage.keys()) });
  }

  return { commitPage, startIndex, resumeIndex, cancelIndex, syncEditedPage, allocateId, rememberPageDimensions,
    select, edit, remove, startCreate, resetCurrentPage, selectPrevious: () => selectRelative(-1),
    selectNext: () => selectRelative(1), setConfirmed, setComment, togglePanel, retryPage, requestPageThumbnails,
    pauseBackground, resumeBackground };
}
