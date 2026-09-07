import { createReviewState } from "./state.js";
import { sortReviewItems } from "../core/change-review/model.js";

function clearBoxes(state) {
  state.boxEditor.autoByPage.clear();
  state.boxEditor.editsByPage.clear();
  state.boxEditor.undoByPage.clear();
  state.boxEditor.revisionByPage.clear();
  state.boxEditor.currentBoxes = null;
}

function clearReviewIndex(state) {
  state.review.itemsByPage.clear();
  state.review.selectedId = null;
  state.review.indexGeneration += 1;
  state.review.indexRunning = false;
  state.review.indexedPages = 0;
  state.review.indexTotal = 0;
  state.review.indexErrors.clear();
  state.review.migrationSummary = null;
  state.review.thumbnailsByPage.clear();
}

function cloneReviewItem(item) {
  return {
    ...item,
    rect: { ...item.rect },
    normalizedRect: { ...item.normalizedRect },
  };
}

function cloneReviewItemsByPage(itemsByPage) {
  return new Map(
    [...itemsByPage].map(([page, items]) => [
      page,
      sortReviewItems(items).map(cloneReviewItem),
    ]),
  );
}

function cloneReviewEntries(entriesById) {
  return new Map(
    [...entriesById].map(([id, entry]) => [id, { ...entry }]),
  );
}

export function captureReviewMigration(state) {
  const pending = state.review.pendingMigration;
  const itemsByPage = cloneReviewItemsByPage(pending?.itemsByPage || []);
  for (const [page, items] of cloneReviewItemsByPage(state.review.itemsByPage)) {
    itemsByPage.set(page, items);
  }
  const entriesById = cloneReviewEntries(pending?.entriesById || []);
  for (const [id, entry] of cloneReviewEntries(state.review.entriesById)) {
    entriesById.set(id, entry);
  }
  state.review.pendingMigration = { itemsByPage, entriesById };
  clearReviewIndex(state);
}

export function resetReviewState(state) {
  state.review = createReviewState();
}

function clearVisualDerived(state, { pageRendering, alignment, quadrant, boxes }) {
  state.visual.pageCache.clear();
  state.visual.renderGeneration += 1;
  if (pageRendering) {
    state.visual.toggleCache = null;
    state.visual.currentPlan = null;
  }
  if (alignment) state.visual.alignmentCache.clear();
  if (quadrant) {
    state.visual.quadrantCache.clear();
    state.comparison.quadrantManual.clear();
    state.visual.quadrantGeneration += 1;
  }
  if (boxes) clearBoxes(state);
}

export function applyInvalidatingChange(state, { confirmDiscard, update, invalidate }) {
  if (!confirmDiscard()) return false;
  update();
  invalidate(state);
  return true;
}

export function invalidateDocuments(state, { advanceGeneration = true } = {}) {
  clearVisualDerived(state, { pageRendering: true, alignment: true, quadrant: true, boxes: true });
  resetReviewState(state);
  if (advanceGeneration) state.documents.generation += 1;
  state.textReview.scale = null;
  state.textReview.extraction = null;
  state.textReview.highlights = null;
  state.textReview.page = 0;
  state.textReview.extractGeneration += 1;
  state.textReview.renderGeneration += 1;
}

export function invalidatePageAlignment(state) {
  captureReviewMigration(state);
  clearVisualDerived(state, { pageRendering: true, alignment: true, quadrant: true, boxes: true });
}

export function invalidateDpi(state) {
  captureReviewMigration(state);
  clearVisualDerived(state, { pageRendering: true, alignment: true, quadrant: false, boxes: true });
}

export function invalidateThreshold(state) {
  captureReviewMigration(state);
  clearVisualDerived(state, { pageRendering: false, alignment: true, quadrant: false, boxes: true });
}

export function invalidateTolerance(state) {
  captureReviewMigration(state);
  clearVisualDerived(state, { pageRendering: false, alignment: false, quadrant: false, boxes: true });
}

export function invalidateManualAlignment(state) {
  captureReviewMigration(state);
  clearVisualDerived(state, { pageRendering: false, alignment: false, quadrant: false, boxes: true });
}

export function invalidateBoxDetection(state) {
  clearBoxes(state);
}
