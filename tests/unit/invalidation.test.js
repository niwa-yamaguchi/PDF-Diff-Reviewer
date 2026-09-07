import { expect, test } from "vitest";
import { createAppState } from "../../src/app/state.js";
import {
  applyInvalidatingChange,
  captureReviewMigration,
  invalidateBoxDetection,
  invalidateDocuments,
  invalidateDpi,
  invalidateManualAlignment,
  invalidatePageAlignment,
  invalidateThreshold,
  invalidateTolerance,
  resetReviewState,
} from "../../src/app/invalidation.js";

function reviewItem(id, { x = 0, y = 0 } = {}) {
  return {
    id,
    pageIndex: 0,
    pageKey: "old:0|new:0",
    rect: { x: x * 100, y: y * 100, w: 10, h: 10 },
    normalizedRect: { x, y, w: 0.1, h: 0.1 },
    kind: "changed",
    source: "visual",
  };
}

function populateReviewState(state) {
  state.review.itemsByPage.set(0, [
    reviewItem("change-2", { x: 0.5, y: 0.5 }),
    reviewItem("change-1", { x: 0.1, y: 0.1 }),
  ]);
  state.review.entriesById.set("change-1", { status: "confirmed", comment: "確認" });
  state.review.entriesById.set("change-2", { status: "pending", comment: "" });
  state.review.selectedId = "change-1";
  state.review.panelOpen = true;
  state.review.nextId = 3;
  state.review.indexRunning = true;
  state.review.indexedPages = 1;
  state.review.indexTotal = 2;
  state.review.indexErrors.set(1, new Error("failed"));
  state.review.migrationSummary = { inherited: 1, reset: 0 };
  state.review.thumbnailsByPage.set(0, "thumbnail");
}

function populatedState() {
  const state = createAppState();
  state.visual.pageCache.set(0, { removed: 1, added: 2 });
  state.visual.alignmentCache.set(0, { applied: true });
  state.visual.quadrantCache.set(0, { k: 1 });
  state.visual.toggleCache = { idx: 0 };
  state.visual.currentPlan = { ratio: 1 };
  state.comparison.quadrantManual.set(0, 2);
  state.boxEditor.autoByPage.set(0, [{ x: 0, y: 0, w: 1, h: 1 }]);
  state.boxEditor.editsByPage.set(0, [{ x: 1, y: 1, w: 1, h: 1 }]);
  state.boxEditor.undoByPage.set(0, [[]]);
  state.boxEditor.revisionByPage.set(0, 4);
  state.boxEditor.currentBoxes = [{ x: 1, y: 1, w: 1, h: 1 }];
  state.textReview.scale = 2;
  state.textReview.extraction = { old: [], new: [] };
  state.textReview.highlights = { old: new Map(), new: new Map() };
  state.textReview.page = 2;
  return state;
}

function expectVisual(state, { pageRendering, alignment, quadrant }) {
  expect(state.visual.pageCache.size).toBe(0);
  expect(state.visual.toggleCache).toEqual(pageRendering ? null : { idx: 0 });
  expect(state.visual.currentPlan).toEqual(pageRendering ? null : { ratio: 1 });
  expect(state.visual.renderGeneration).toBe(1);
  expect(state.visual.alignmentCache.size).toBe(alignment ? 0 : 1);
  expect(state.visual.quadrantCache.size).toBe(quadrant ? 0 : 1);
  expect(state.comparison.quadrantManual.size).toBe(quadrant ? 0 : 1);
  expect(state.visual.quadrantGeneration).toBe(quadrant ? 1 : 0);
}

function expectBoxesCleared(state) {
  expect(state.boxEditor.autoByPage.size).toBe(0);
  expect(state.boxEditor.editsByPage.size).toBe(0);
  expect(state.boxEditor.undoByPage.size).toBe(0);
  expect(state.boxEditor.revisionByPage.size).toBe(0);
  expect(state.boxEditor.currentBoxes).toBeNull();
}

test("document invalidation clears every document-derived cache and advances tickets", () => {
  const state = populatedState();
  invalidateDocuments(state);

  expectVisual(state, { pageRendering: true, alignment: true, quadrant: true });
  expectBoxesCleared(state);
  expect(state.documents.generation).toBe(1);
  expect(state.textReview).toMatchObject({ scale: null, extraction: null, highlights: null, page: 0, extractGeneration: 1, renderGeneration: 1 });
});

test("captures an isolated sorted migration snapshot before clearing the review index", () => {
  const state = createAppState();
  populateReviewState(state);
  const originalItems = state.review.itemsByPage.get(0);
  const originalEntry = state.review.entriesById.get("change-1");

  captureReviewMigration(state);

  const snapshotItems = state.review.pendingMigration.itemsByPage.get(0);
  const snapshotEntry = state.review.pendingMigration.entriesById.get("change-1");
  expect(snapshotItems.map(item => item.id)).toEqual(["change-1", "change-2"]);
  expect(snapshotItems).not.toBe(originalItems);
  expect(snapshotItems[0]).not.toBe(originalItems[1]);
  expect(snapshotEntry).toEqual({ status: "confirmed", comment: "確認" });
  expect(snapshotEntry).not.toBe(originalEntry);
  expect(state.review.itemsByPage.size).toBe(0);
  expect(state.review.entriesById.size).toBe(2);
  expect(state.review).toMatchObject({
    selectedId: null,
    indexGeneration: 1,
    indexRunning: false,
    indexedPages: 0,
    indexTotal: 0,
    migrationSummary: null,
  });
  expect(state.review.indexErrors.size).toBe(0);
  expect(state.review.thumbnailsByPage.size).toBe(0);
});

test.each([
  ["page alignment", invalidatePageAlignment],
  ["DPI", invalidateDpi],
  ["threshold", invalidateThreshold],
  ["tolerance", invalidateTolerance],
  ["manual alignment", invalidateManualAlignment],
])("%s invalidation preserves review data for migration", (_name, invalidate) => {
  const state = populatedState();
  populateReviewState(state);

  invalidate(state);

  expect(state.review.pendingMigration.itemsByPage.get(0).map(item => item.id)).toEqual([
    "change-1",
    "change-2",
  ]);
  expect(state.review.pendingMigration.entriesById.get("change-1")).toEqual({
    status: "confirmed",
    comment: "確認",
  });
  expect(state.review.itemsByPage.size).toBe(0);
  expect(state.review.entriesById.size).toBe(2);
  expect(state.review.indexGeneration).toBe(1);
});

test("document invalidation discards migration snapshots and all review data", () => {
  const state = populatedState();
  populateReviewState(state);
  captureReviewMigration(state);

  invalidateDocuments(state);

  expect(state.review.itemsByPage.size).toBe(0);
  expect(state.review.entriesById.size).toBe(0);
  expect(state.review.selectedId).toBeNull();
  expect(state.review.panelOpen).toBe(false);
  expect(state.review.nextId).toBe(1);
  expect(state.review.indexGeneration).toBe(0);
  expect(state.review.indexRunning).toBe(false);
  expect(state.review.indexedPages).toBe(0);
  expect(state.review.indexTotal).toBe(0);
  expect(state.review.indexErrors.size).toBe(0);
  expect(state.review.pendingMigration).toBeNull();
  expect(state.review.migrationSummary).toBeNull();
  expect(state.review.thumbnailsByPage.size).toBe(0);
});

test("resetReviewState restores review defaults without sharing maps", () => {
  const state = createAppState();
  populateReviewState(state);
  const previousItems = state.review.itemsByPage;

  resetReviewState(state);

  expect(state.review.itemsByPage).not.toBe(previousItems);
  expect(state.review).toMatchObject({
    selectedId: null,
    panelOpen: false,
    nextId: 1,
    indexGeneration: 0,
    indexRunning: false,
    indexedPages: 0,
    indexTotal: 0,
    pendingMigration: null,
    migrationSummary: null,
  });
  expect(state.review.itemsByPage.size).toBe(0);
  expect(state.review.entriesById.size).toBe(0);
  expect(state.review.indexErrors.size).toBe(0);
  expect(state.review.thumbnailsByPage.size).toBe(0);
});

test("document invalidation can preserve an already advanced document generation", () => {
  const state = populatedState();
  state.documents.generation = 4;

  invalidateDocuments(state, { advanceGeneration: false });

  expectVisual(state, { pageRendering: true, alignment: true, quadrant: true });
  expectBoxesCleared(state);
  expect(state.documents.generation).toBe(4);
  expect(state.textReview).toMatchObject({ scale: null, extraction: null, highlights: null, page: 0, extractGeneration: 1, renderGeneration: 1 });
});

test("page alignment invalidation clears visual alignment rotation and boxes but preserves text", () => {
  const state = populatedState();
  invalidatePageAlignment(state);

  expectVisual(state, { pageRendering: true, alignment: true, quadrant: true });
  expectBoxesCleared(state);
  expect(state.textReview.extraction).not.toBeNull();
  expect(state.documents.generation).toBe(0);
});

test("DPI invalidation clears page-render dependent data but preserves rotation and text", () => {
  const state = populatedState();
  invalidateDpi(state);

  expectVisual(state, { pageRendering: true, alignment: true, quadrant: false });
  expectBoxesCleared(state);
  expect(state.textReview.extraction).not.toBeNull();
});

test("threshold invalidation clears derived visual and edited boxes but not text extraction", () => {
  const state = populatedState();
  invalidateThreshold(state);

  expectVisual(state, { pageRendering: false, alignment: true, quadrant: false });
  expectBoxesCleared(state);
  expect(state.textReview.extraction).not.toBeNull();
});

test("tolerance invalidation clears only diff and box data", () => {
  const state = populatedState();
  invalidateTolerance(state);

  expectVisual(state, { pageRendering: false, alignment: false, quadrant: false });
  expectBoxesCleared(state);
  expect(state.textReview.extraction).not.toBeNull();
});

test("manual alignment invalidation clears only diff and box data", () => {
  const state = populatedState();
  invalidateManualAlignment(state);

  expectVisual(state, { pageRendering: false, alignment: false, quadrant: false });
  expectBoxesCleared(state);
  expect(state.textReview.extraction).not.toBeNull();
});

test("box detection invalidation preserves visual and text caches", () => {
  const state = populatedState();
  invalidateBoxDetection(state);

  expect(state.visual.pageCache.size).toBe(1);
  expect(state.visual.alignmentCache.size).toBe(1);
  expect(state.visual.quadrantCache.size).toBe(1);
  expect(state.comparison.quadrantManual.size).toBe(1);
  expect(state.visual.renderGeneration).toBe(0);
  expectBoxesCleared(state);
  expect(state.textReview.extraction).not.toBeNull();
});

test("cancelled invalidating change keeps the setting and every cache untouched", () => {
  const state = populatedState();

  const applied = applyInvalidatingChange(state, {
    confirmDiscard: () => false,
    update: () => { state.comparison.threshold = 160; },
    invalidate: invalidateThreshold,
  });

  expect(applied).toBe(false);
  expect(state.comparison.threshold).toBe(128);
  expect(state.visual.pageCache.size).toBe(1);
  expect(state.visual.alignmentCache.size).toBe(1);
  expect(state.visual.quadrantCache.size).toBe(1);
  expect(state.boxEditor.editsByPage.size).toBe(1);
  expect(state.boxEditor.revisionByPage.get(0)).toBe(4);
  expect(state.visual.renderGeneration).toBe(0);
});

test("confirms before updating the setting and invalidating its caches", () => {
  const state = populatedState();
  const order = [];

  const applied = applyInvalidatingChange(state, {
    confirmDiscard: () => {
      order.push(`confirm:${state.comparison.threshold}:${state.visual.pageCache.size}`);
      return true;
    },
    update: () => {
      order.push(`update:${state.comparison.threshold}:${state.visual.pageCache.size}`);
      state.comparison.threshold = 160;
    },
    invalidate: (target) => {
      order.push(`invalidate:${target.comparison.threshold}:${target.visual.pageCache.size}`);
      invalidateThreshold(target);
    },
  });

  expect(applied).toBe(true);
  expect(order).toEqual([
    "confirm:128:1",
    "update:128:1",
    "invalidate:160:1",
  ]);
  expect(state.comparison.threshold).toBe(160);
  expect(state.visual.pageCache.size).toBe(0);
  expect(state.boxEditor.editsByPage.size).toBe(0);
});
