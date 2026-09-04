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
  expect(state.visual.splitCache).toBeNull();
  expect(state.visual.splitView).toEqual({ scale: 1, tx: 0, ty: 0 });
  expect(state.visual.splitNeedsFit).toBe(true);
  expect(state.visual.output).toEqual({
    ready: false,
    mode: null,
    pageIndex: 0,
    revision: 0,
    documentGeneration: 0,
  });
  expect(state.boxEditor.autoByPage).toBeInstanceOf(Map);
  expect(state.boxEditor.editsByPage).toBeInstanceOf(Map);
  expect(state.boxEditor.undoByPage).toBeInstanceOf(Map);
  expect(state.boxEditor.revisionByPage).toBeInstanceOf(Map);
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
  first.visual.splitView.scale = 2;

  expect(second.documents.alignmentOps).toEqual([]);
  expect(second.comparison.quadrantManual.size).toBe(0);
  expect(second.visual.pageCache.size).toBe(0);
  expect(second.boxEditor.autoByPage.size).toBe(0);
  expect(second.boxEditor.revisionByPage.size).toBe(0);
  expect(second.textReview.view).toEqual({ scale: 1, tx: 0, ty: 0 });
  expect(second.visual.splitView).toEqual({ scale: 1, tx: 0, ty: 0 });
});
