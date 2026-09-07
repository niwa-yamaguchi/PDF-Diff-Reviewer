import { expect, test } from "vitest";
import { createAppState } from "../../src/app/state.js";

test("creates isolated state slices with current defaults", () => {
  const state = createAppState();
  expect(state.comparison).toMatchObject({ dpi: 300, threshold: 128, tolerancePx: 0, dx: 0, dy: 0 });
  expect(state.documents).toMatchObject({ oldDoc: null, newDoc: null, pages: 0, currentPage: 0 });
  expect(state.boxEditor).toMatchObject({ showBoxes: true, editMode: false, selectedIndex: -1 });
  expect(state.textReview.view).toEqual({ scale: 1, tx: 0, ty: 0 });
  expect(state.comparison.quadrantManual).toBeInstanceOf(Map);
  expect(state.visual.pageCache).toBeInstanceOf(Map);
  expect(state.visual.alignmentCache).toBeInstanceOf(Map);
  expect(state.visual.quadrantCache).toBeInstanceOf(Map);
  expect(state.boxEditor.autoByPage).toBeInstanceOf(Map);
  expect(state.boxEditor.editsByPage).toBeInstanceOf(Map);
  expect(state.boxEditor.undoByPage).toBeInstanceOf(Map);
  expect(state.boxEditor.revisionByPage).toBeInstanceOf(Map);
});

test("creates isolated review state", () => {
  const first = createAppState();
  const second = createAppState();

  expect(first.review).toMatchObject({
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
  expect(first.review.itemsByPage).toBeInstanceOf(Map);
  expect(first.review.entriesById).toBeInstanceOf(Map);
  expect(first.review.indexErrors).toBeInstanceOf(Map);
  expect(first.review.thumbnailsByPage).toBeInstanceOf(Map);

  first.review.itemsByPage.set(0, []);
  first.review.entriesById.set("change-1", { status: "confirmed", comment: "確認" });
  first.review.indexErrors.set(0, new Error("failed"));
  first.review.thumbnailsByPage.set(0, "thumbnail");

  expect(second.review.itemsByPage.size).toBe(0);
  expect(second.review.entriesById.size).toBe(0);
  expect(second.review.indexErrors.size).toBe(0);
  expect(second.review.thumbnailsByPage.size).toBe(0);
});

test("creates independent maps arrays and views for every state", () => {
  const first = createAppState();
  const second = createAppState();
  first.documents.alignmentOps.push({ side: "old", slot: 0 });
  first.comparison.quadrantManual.set(0, 1);
  first.visual.pageCache.set(0, {});
  first.boxEditor.autoByPage.set(0, []);
  first.boxEditor.revisionByPage.set(0, 3);
  first.textReview.view.scale = 2;

  expect(second.documents.alignmentOps).toEqual([]);
  expect(second.comparison.quadrantManual.size).toBe(0);
  expect(second.visual.pageCache.size).toBe(0);
  expect(second.boxEditor.autoByPage.size).toBe(0);
  expect(second.boxEditor.revisionByPage.size).toBe(0);
  expect(second.textReview.view).toEqual({ scale: 1, tx: 0, ty: 0 });
});
