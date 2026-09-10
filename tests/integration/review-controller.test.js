import { expect, test, vi } from "vitest";
import { createAppState } from "../../src/app/state.js";
import { captureReviewMigration, invalidateDocuments, invalidateThreshold } from "../../src/app/invalidation.js";
import { createChangeReviewController } from "../../src/features/change-review/review-controller.js";
import { createViewerController } from "../../src/features/viewer/viewer-controller.js";
import { createVisualController, createVisualSnapshot } from "../../src/features/visual-diff/visual-controller.js";
import { createBoxEditorController } from "../../src/features/box-editor/box-editor-controller.js";
import { createBoxHistory } from "../../src/features/box-editor/box-history.js";

const box = (x = 10) => ({ x, y: 10, w: 20, h: 20, kind: "added" });
const page = (pageIndex, boxes = [box()]) => ({ pageIndex, boxes, width: 100, height: 100 });

function thumbnailHarness(overrides = {}) {
  const state = createAppState();
  state.documents.pages = 3;
  Object.assign(state.comparison, { dpi: 300, dx: 25, dy: -50 });
  const created = [];
  const createCanvas = (width, height) => {
    const canvas = { width, height, getContext: () => ({ fillRect() {}, drawImage() {} }),
      toDataURL: vi.fn(() => `data:image/png;base64,crop${created.length}`) };
    created.push(canvas);
    return canvas;
  };
  const renderThumbnailPage = vi.fn(async () => ({ canvas: { width: 100, height: 100 } }));
  const controller = createChangeReviewController({ state, renderThumbnailPage, createCanvas,
    createSnapshot: pageIndex => createVisualSnapshot(state, pageIndex, "diff"), ...overrides });
  controller.commitPage(page(0));
  controller.commitPage(page(1, [box(), box(50)]));
  controller.commitPage(page(2));
  return { state, controller, renderThumbnailPage, created };
}

// Break: rendering per item/reopening or mutating full-resolution settings wastes work and shifts crops.
test("renders one immutable 72 DPI page for all requested thumbnails and caches each PNG once", async () => {
  const { state, controller, renderThumbnailPage, created } = thumbnailHarness();
  await Promise.all([controller.requestPageThumbnails(1), controller.requestPageThumbnails(1)]);
  await controller.requestPageThumbnails(1);
  expect(renderThumbnailPage).toHaveBeenCalledTimes(1);
  const snapshot = renderThumbnailPage.mock.calls[0][0];
  expect(snapshot.comparison).toMatchObject({ dpi: 72, dx: 6, dy: -12 });
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.comparison)).toBe(true);
  expect(state.comparison).toMatchObject({ dpi: 300, dx: 25, dy: -50 });
  expect(state.review.thumbnailsByPage.get(1).size).toBe(2);
  expect(created).toHaveLength(2);
  for (const canvas of created) expect(canvas.toDataURL).toHaveBeenCalledExactlyOnceWith("image/png");
});

// Break: starting thumbnails during indexing contends for the single background Worker lane.
test("queues opened groups during indexing and processes them once in page order", async () => {
  let finishIndex;
  const events = [];
  const { controller, renderThumbnailPage } = thumbnailHarness({
    renderIndexPage: async index => {
      events.push(`index-${index}`);
      if (index === 0) await new Promise(resolve => { finishIndex = resolve; });
      return page(index);
    },
  });
  renderThumbnailPage.mockImplementation(async snapshot => {
    events.push(`thumb-${snapshot.pageIndex}`);
    return { canvas: { width: 100, height: 100 } };
  });
  const indexing = controller.startIndex();
  const pending = [controller.requestPageThumbnails(2), controller.requestPageThumbnails(0),
    controller.requestPageThumbnails(2)];
  expect(renderThumbnailPage).not.toHaveBeenCalled();
  finishIndex();
  await indexing;
  await Promise.all(pending);
  expect(events).toEqual(["index-0", "index-1", "index-2", "thumb-0", "thumb-2"]);
});

// Break: a thumbnail failure must not erase review data or trigger repeated failing renders.
test("caches failed thumbnails without blocking review operations", async () => {
  const { state, controller } = thumbnailHarness({ renderThumbnailPage: async () => { throw new Error("broken image"); } });
  await controller.requestPageThumbnails(1);
  expect(state.review.thumbnailsByPage.get(1)).toEqual({ error: true });
  controller.setComment("change-2", "確認を継続");
  expect(state.review.entriesById.get("change-2").comment).toBe("確認を継続");
});

// Break: a replaced document or canceled comparison must never receive an old thumbnail.
test("rejects a delayed thumbnail after cancellation", async () => {
  let finish;
  const { state, controller } = thumbnailHarness({ renderThumbnailPage: () => new Promise(resolve => { finish = resolve; }) });
  const pending = controller.requestPageThumbnails(0);
  controller.cancelIndex();
  finish({ canvas: { width: 100, height: 100 } });
  await pending;
  expect(state.review.thumbnailsByPage.size).toBe(0);
});

// Break: editing a rectangle without invalidating the crop shows the previous location forever.
test("refreshes thumbnails after geometry changes but preserves cache through identical redraws", async () => {
  const { state, controller, renderThumbnailPage } = thumbnailHarness();
  await controller.requestPageThumbnails(0);
  const cached = state.review.thumbnailsByPage.get(0);
  controller.commitPage(page(0));
  await controller.requestPageThumbnails(0);
  expect(state.review.thumbnailsByPage.get(0)).toBe(cached);
  controller.syncEditedPage({ pageIndex: 0, boxes: [{ ...box(40), id: "change-1" }] });
  expect(state.review.thumbnailsByPage.has(0)).toBe(false);
  await controller.requestPageThumbnails(0);
  expect(renderThumbnailPage).toHaveBeenCalledTimes(2);
});

// Break: incoming box order alone must not evict unchanged ID/rectangle thumbnail crops.
test("preserves cached thumbnails when equivalent manual boxes arrive in reverse display order", async () => {
  const { state, controller, renderThumbnailPage } = thumbnailHarness();
  await controller.requestPageThumbnails(1);
  const cached = state.review.thumbnailsByPage.get(1);
  controller.syncEditedPage({ pageIndex: 1, boxes: [
    { ...box(50), id: "change-3", kind: "added", source: "auto" },
    { ...box(10), id: "change-2", kind: "added", source: "auto" },
  ] });
  expect(state.review.thumbnailsByPage.get(1)).toBe(cached);
  await controller.requestPageThumbnails(1);
  expect(renderThumbnailPage).toHaveBeenCalledTimes(1);
});

// Break: a page retry can submit a Worker job while a thumbnail still owns the shared lane.
test("waits for an in-flight thumbnail before retrying an index page", async () => {
  let finish;
  const events = [];
  const { state, controller } = thumbnailHarness({
    renderThumbnailPage: async () => {
      events.push("thumbnail-start");
      await new Promise(resolve => { finish = resolve; });
      events.push("thumbnail-end");
      return { canvas: { width: 100, height: 100 } };
    },
    renderIndexPage: async index => { events.push("index"); return page(index); },
  });
  state.review.indexErrors.set(1, "retry");
  const thumbnail = controller.requestPageThumbnails(0);
  const retry = controller.retryPage(1);
  expect(events).toEqual(["thumbnail-start"]);
  finish();
  await Promise.all([thumbnail, retry]);
  expect(events).toEqual(["thumbnail-start", "thumbnail-end", "index"]);
});

function navigationHarness(show) {
  const state = createAppState();
  state.documents.pages = 2;
  state.visual.rendered = true;
  const out = { style: { display: "block" } };
  const viewer = createViewerController({ state, dom: {
    out, wrap: { clientWidth: 200, clientHeight: 200 }, zoomLabel: {},
  } });
  const visits = [];
  const controller = createChangeReviewController({ state,
    showPage: async index => {
      visits.push(index);
      const result = await show?.(index);
      if (result?.committed === false) return result;
      state.documents.currentPage = index;
      return { committed: true };
    },
    focusRect: viewer.focusRect,
  });
  controller.commitPage(page(0, [box(10), box(60)]));
  controller.commitPage(page(1, [box(40)]));
  return { state, controller, out, visits };
}

// Break: skipping page navigation/focus or overwriting the other entry field loses review work.
test("selects across pages and persists confirmation and comments", async () => {
  const { state, controller, out, visits } = navigationHarness();
  await controller.select("change-3");
  expect(visits).toEqual([1]);
  expect(state.documents.currentPage).toBe(1);
  expect(state.review.selectedId).toBe("change-3");
  expect(out.style.transform).toBe("translate(-100px,20px) scale(4)");
  expect(state.boxEditor.editMode).toBe(false);
  controller.setConfirmed("change-3", true);
  controller.setComment("change-3", "抵抗値を確認");
  expect(state.review.entriesById.get("change-3")).toEqual({ status: "confirmed", comment: "抵抗値を確認" });
  controller.setConfirmed("change-3", false);
  expect(state.review.entriesById.get("change-3")).toEqual({ status: "pending", comment: "抵抗値を確認" });
  controller.togglePanel();
  expect(state.review.panelOpen).toBe(true);
  controller.togglePanel(false);
  expect(state.review.panelOpen).toBe(false);
});

// Break: using Map insertion order or stopping at either end breaks the inspection sequence.
test("cycles previous and next in page then rectangle display order", async () => {
  const { state, controller, visits } = navigationHarness();
  state.review.itemsByPage.set(0, [...state.review.itemsByPage.get(0)].reverse());
  await controller.selectNext();
  expect(state.review.selectedId).toBe("change-1");
  await controller.selectPrevious();
  expect(state.review.selectedId).toBe("change-3");
  await controller.selectNext();
  expect(state.review.selectedId).toBe("change-1");
  await controller.selectNext();
  expect(state.review.selectedId).toBe("change-2");
  expect(visits).toEqual([1, 0]);
});

// Break: removing the selection ticket focuses an old rectangle after a newer selection.
test("rejects stale focus after another selection or failed page commit", async () => {
  let resolve;
  const { state, controller, out } = navigationHarness(index => index === 1
    ? new Promise(done => { resolve = done; }) : undefined);
  const old = controller.select("change-3");
  await controller.select("change-2");
  const transform = out.style.transform;
  resolve({ committed: true });
  await old;
  expect(state.review.selectedId).toBe("change-2");
  expect(out.style.transform).toBe(transform);
  const failed = navigationHarness(async () => ({ committed: false }));
  await failed.controller.select("change-3");
  expect(failed.out.style.transform).toBeUndefined();
});

// Break: a new selection on the still-visible page must supersede the earlier page render too.
test("selecting the visible page during navigation cancels an obsolete visual commit", async () => {
  const state = createAppState();
  state.documents.pages = 2;
  state.visual.rendered = true;
  const out = { style: {}, getContext: () => ({ clearRect() {}, drawImage() {} }) };
  let resolveOld;
  const result = pageLabel => ({ canvas: { width: 100, height: 100 }, boxes: [],
    stats: { removed: "", added: "", boxes: "" }, pageLabel, status: "" });
  const visual = createVisualController({ state,
    dom: { out, placeholder: { style: {} }, pageLabel: {}, statRm: {}, statAd: {}, statBox: {},
      status: {}, dlPng: {}, dlPdf: {}, boxToggle: {} },
    renderDiffPage: snapshot => snapshot.pageIndex === 1
      ? new Promise(done => { resolveOld = done; }) : Promise.resolve(result("1 / 2")),
    drawBoxes() {},
  });
  const controller = createChangeReviewController({ state, showPage: visual.showPage, focusRect() {} });
  controller.commitPage(page(0));
  controller.commitPage(page(1));
  const old = controller.select("change-2");
  await controller.select("change-1");
  resolveOld(result("2 / 2"));
  await old;
  expect(state.documents.currentPage).toBe(0);
  expect(state.review.selectedId).toBe("change-1");
});

// Break: a retry must render the failed page and clear its error, without losing reviewed pages.
test("retries only the requested failed page", async () => {
  const { state, controller, renderIndexPage } = harness(2);
  controller.commitPage(page(0));
  state.review.entriesById.set("change-1", { status: "confirmed", comment: "keep" });
  state.review.indexErrors.set(1, "failed");
  await controller.retryPage(1);
  expect(renderIndexPage.mock.calls.map(([index]) => index)).toEqual([1]);
  expect(state.review.indexErrors.size).toBe(0);
  expect(state.review.itemsByPage.get(1)).toHaveLength(1);
  expect(state.review.entriesById.get("change-1")).toEqual({ status: "confirmed", comment: "keep" });
});

// Break: a delayed retry failure must not resurrect an error cleared by a manual edit.
test("a synchronized manual edit wins over a delayed retry failure", async () => {
  let reject;
  const { state, controller, renderIndexPage, reportError } = harness(1);
  controller.commitPage(page(0));
  state.review.indexErrors.set(0, "failed");
  renderIndexPage.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const running = controller.retryPage(0);
  const manual = [{ ...box(70), id: controller.allocateId(), kind: "changed", source: "manual" }];
  state.boxEditor.editsByPage.set(0, manual);
  controller.syncEditedPage({ pageIndex: 0 });
  reject(new Error("late retry failure"));
  await running;
  expect(state.review.indexErrors.has(0)).toBe(false);
  expect(reportError).not.toHaveBeenCalled();
  expect(state.review.itemsByPage.get(0)[0]).toMatchObject({ id: manual[0].id, rect: { x: 70 } });
  expect(state.review.indexRunning).toBe(false);
});
function harness(pages = 3, render = async () => page(0)) {
  const state = createAppState();
  Object.assign(state.documents, { pages, oldSequence: [0, 1, 2], newSequence: [0, 1, 2] });
  const renderIndexPage = vi.fn(render);
  const cancelIndex = vi.fn();
  const reportError = vi.fn();
  const controller = createChangeReviewController({ state, renderIndexPage, cancelIndex, reportError, onChanged() {} });
  return { state, controller, renderIndexPage, cancelIndex, reportError };
}

test("commits boxes with stable IDs and default entries without an initial migration notice", () => {
  const { state, controller } = harness();
  const first = controller.commitPage(page(0));
  expect(first.currentBoxes[0]).toEqual({ ...box(), id: "change-1", source: "auto" });
  state.review.entriesById.set("change-1", { status: "confirmed", comment: "checked" });
  const second = controller.commitPage(page(0));
  expect(second.currentBoxes[0].id).toBe("change-1");
  expect(state.review.entriesById.get("change-1").status).toBe("confirmed");
  expect(state.review.migrationSummary).toBeNull();
});

test.each([
  ["nested components", [
    { x: 0, y: 0, w: 80, h: 80, kind: "added" },
    { x: 30, y: 30, w: 20, h: 20, kind: "added" },
  ]],
  ["duplicate rectangles", [box(), box()]],
])("identical redraws preserve each review ID and input for %s", (_name, boxes) => {
  const { state, controller } = harness(1);
  controller.commitPage(page(0, boxes));
  state.review.entriesById.set("change-1", { status: "confirmed", comment: "outer" });
  state.review.entriesById.set("change-2", { status: "confirmed", comment: "inner" });
  const redraw = controller.commitPage(page(0, boxes.map(box => ({ ...box }))));
  expect(redraw.currentBoxes.map(box => box.id)).toEqual(["change-1", "change-2"]);
  expect(redraw.currentBoxes.map(box => state.review.entriesById.get(box.id))).toEqual([
    { status: "confirmed", comment: "outer" },
    { status: "confirmed", comment: "inner" },
  ]);
});

test("pending migration keeps the split and merge guard even for identical nested rectangles", () => {
  const { state, controller } = harness(1);
  const boxes = [
    { x: 0, y: 0, w: 80, h: 80, kind: "added" },
    { x: 30, y: 30, w: 20, h: 20, kind: "added" },
  ];
  controller.commitPage(page(0, boxes));
  state.review.entriesById.set("change-1", { status: "confirmed", comment: "outer" });
  captureReviewMigration(state);
  const migrated = controller.commitPage(page(0, boxes));
  expect(migrated.currentBoxes.map(box => box.id)).toEqual(["change-3", "change-4"]);
  expect(state.review.migrationSummary).toEqual({ inherited: 0, reset: 2 });
});

test("redraw matches exact rectangles across ordering changes and safely reconciles the remainder", () => {
  const { controller } = harness(1);
  const outer = { x: 0, y: 0, w: 80, h: 80, kind: "added" };
  const inner = { x: 30, y: 30, w: 20, h: 20, kind: "added" };
  controller.commitPage({ ...page(0, [outer, inner, box(120)]), width: 200 });
  const redraw = controller.commitPage({ ...page(0, [inner, box(121), outer]), width: 200 });
  expect(redraw.currentBoxes.map(box => box.id)).toEqual(["change-2", "change-3", "change-1"]);
});

test("matching rectangles cannot inherit IDs after their page identity or kind changes", () => {
  const { controller } = harness(1);
  controller.commitPage(page(0));
  expect(controller.commitPage({ ...page(0), pageKey: "old:1|new:0" }).currentBoxes[0].id).toBe("change-2");
  expect(controller.commitPage({ ...page(0, [{ ...box(), kind: "removed" }]), pageKey: "old:1|new:0" })
    .currentBoxes[0].id).toBe("change-3");
});

test("inherits matching entries and finalizes migration only after every page is processed", () => {
  const { state, controller } = harness(2);
  controller.commitPage(page(0));
  controller.commitPage(page(1));
  state.review.entriesById.set("change-1", { status: "confirmed", comment: "checked" });
  captureReviewMigration(state);
  expect(controller.commitPage(page(0, [box(11)])).currentBoxes[0].id).toBe("change-1");
  expect(state.review.pendingMigration).not.toBeNull();
  controller.commitPage(page(1, [box(70)]));
  expect(state.review.pendingMigration).toBeNull();
  expect(state.review.migrationSummary).toEqual({ inherited: 1, reset: 1 });
  expect(state.review.entriesById.get("change-1").comment).toBe("checked");
});

function editorForReview(state, controller) {
  state.boxEditor.editMode = true;
  return createBoxEditorController({ state, dom: {}, confirmDiscard: () => true,
    view: { refresh() {}, getFrameSize: () => ({ width: 100, height: 100 }) },
    makeManualBox: ({ box }) => ({ ...box, id: controller.allocateId(), kind: "changed", source: "manual" }),
    onBoxesChanged: ({ pageIndex, boxes }) => controller.syncEditedPage({ pageIndex, boxes }),
  });
}

// Break: migration retains a deleted review after Undo was cleared, or assigns it to a newly detected box.
test("prunes deleted reviews only after comparison migration finishes and preserves live reviews", () => {
  const { state, controller } = harness(2);
  state.boxEditor.currentBoxes = controller.commitPage(page(0, [box(), box(60)])).currentBoxes;
  controller.commitPage(page(1));
  controller.setConfirmed("change-1", true);
  controller.setComment("change-1", "deleted review");
  controller.setConfirmed("change-2", true);
  controller.setComment("change-2", "current review");
  controller.setConfirmed("change-3", true);
  controller.setComment("change-3", "unprocessed page");
  const editor = editorForReview(state, controller);
  state.boxEditor.selectedIndex = 0;
  editor.deleteSelected();
  expect(state.boxEditor.undoByPage.get(0).size).toBe(1);
  expect(state.review.entriesById.get("change-1").comment).toBe("deleted review");

  invalidateThreshold(state);
  expect(state.boxEditor.undoByPage.size).toBe(0);
  const redetected = controller.commitPage(page(0, [box(), box(60)]));
  expect(redetected.currentBoxes.map(box => box.id)).toEqual(["change-4", "change-2"]);
  expect(state.review.pendingMigration).not.toBeNull();
  expect(state.review.entriesById.get("change-3").comment).toBe("unprocessed page");
  controller.commitPage(page(1));

  expect(state.review.pendingMigration).toBeNull();
  expect([...state.review.entriesById.keys()].sort()).toEqual(["change-2", "change-3", "change-4"]);
  expect(state.review.entriesById.get("change-4")).toEqual({ status: "pending", comment: "" });
  expect(state.review.entriesById.get("change-2")).toEqual({ status: "confirmed", comment: "current review" });
  expect(state.review.entriesById.get("change-3")).toEqual({ status: "confirmed", comment: "unprocessed page" });
});

// Break: pruning all non-current IDs destroys a review that Undo can still restore during migration.
test("migration cleanup keeps IDs reachable from Undo without consuming its history", () => {
  const { state, controller } = harness(2);
  controller.commitPage(page(0));
  controller.commitPage(page(1));
  controller.setConfirmed("change-1", true);
  controller.setComment("change-1", "restore after migration");
  invalidateThreshold(state);
  state.boxEditor.currentBoxes = controller.commitPage(page(0)).currentBoxes;
  const editor = editorForReview(state, controller);
  state.boxEditor.selectedIndex = 0;
  editor.deleteSelected();
  expect(state.review.itemsByPage.get(0)).toEqual([]);
  controller.commitPage(page(1));

  expect(state.review.pendingMigration).toBeNull();
  expect(state.boxEditor.undoByPage.get(0).size).toBe(1);
  expect(state.review.entriesById.get("change-1")).toEqual({ status: "confirmed", comment: "restore after migration" });
  expect(editor.undo()).toBe(true);
  expect(state.review.itemsByPage.get(0)[0].id).toBe("change-1");
  expect(state.review.entriesById.get("change-1")).toEqual({ status: "confirmed", comment: "restore after migration" });
});

// Break: an automatic box remains restorable even after its Undo snapshot expires during a long migration.
test("migration cleanup preserves reviews reachable through reset to automatic boxes", () => {
  const { state, controller } = harness(2);
  controller.commitPage(page(0));
  controller.commitPage(page(1));
  controller.setConfirmed("change-1", true);
  controller.setComment("change-1", "automatic review");
  invalidateThreshold(state);
  state.boxEditor.currentBoxes = controller.commitPage(page(0)).currentBoxes;
  const editor = editorForReview(state, controller);
  state.boxEditor.undoByPage.set(0, createBoxHistory(1));
  state.boxEditor.selectedIndex = 0;
  editor.deleteSelected();
  editor.pointerDown({ x: 60, y: 60, pointerId: 1, button: 0 });
  editor.pointerMove({ x: 80, y: 80, pointerId: 1 });
  editor.pointerUp({ pointerId: 1 });
  controller.commitPage(page(1));
  expect(state.review.pendingMigration).toBeNull();

  expect(editor.resetToAuto()).toBe(true);
  expect(state.review.itemsByPage.get(0)[0].id).toBe("change-1");
  expect(state.review.entriesById.get("change-1")).toEqual({ status: "confirmed", comment: "automatic review" });
});

// Break: repeated delete/redetect cycles grow entriesById indefinitely even though no Undo or migration remains.
test("repeated deletion and redetection retains only current entries without reusing deleted IDs", () => {
  const { state, controller } = harness(1);
  const editor = editorForReview(state, controller);
  state.boxEditor.currentBoxes = controller.commitPage(page(0)).currentBoxes;
  const deleted = new Set();
  for (let cycle = 0; cycle < 3; cycle++) {
    const id = state.boxEditor.currentBoxes[0].id;
    deleted.add(id);
    controller.setConfirmed(id, true);
    controller.setComment(id, "do not transfer");
    state.boxEditor.selectedIndex = 0;
    editor.deleteSelected();
    invalidateThreshold(state);
    state.boxEditor.currentBoxes = controller.commitPage(page(0)).currentBoxes;
    const nextId = state.boxEditor.currentBoxes[0].id;
    expect(deleted.has(nextId)).toBe(false);
    expect(state.review.entriesById).toEqual(new Map([[nextId, { status: "pending", comment: "" }]]));
  }
});

test("indexes sequentially and ignores an obsolete generation", async () => {
  let resolve;
  const { state, controller, renderIndexPage } = harness(3, () => new Promise(done => { resolve = done; }));
  const running = controller.startIndex({ skipPages: new Set([0]) });
  expect(renderIndexPage.mock.calls.map(([index]) => index)).toEqual([1]);
  state.review.indexGeneration += 1;
  resolve(page(1));
  await running;
  expect(renderIndexPage).toHaveBeenCalledTimes(1);
  expect(state.review.itemsByPage.has(1)).toBe(false);
});

test("a second invalidation keeps unresolved pages and uses the latest reviewed page", () => {
  const { state, controller } = harness(2);
  controller.commitPage(page(0));
  controller.commitPage(page(1));
  state.review.entriesById.set("change-2", { status: "confirmed", comment: "second page" });
  captureReviewMigration(state);
  controller.commitPage(page(0, [box(11)]));
  state.review.entriesById.set("change-1", { status: "confirmed", comment: "updated" });
  captureReviewMigration(state);
  controller.commitPage(page(0, [box(12)]));
  controller.commitPage(page(1));
  expect(state.review.entriesById.get("change-1")).toEqual({ status: "confirmed", comment: "updated" });
  expect(state.review.entriesById.get("change-2").comment).toBe("second page");
  expect(state.review.migrationSummary).toEqual({ inherited: 2, reset: 0 });
});

test("records a page failure and continues with later pages", async () => {
  const { state, controller, renderIndexPage } = harness();
  renderIndexPage.mockRejectedValueOnce(new Error("page 1 failed")).mockResolvedValueOnce(page(2));
  await controller.startIndex({ skipPages: new Set([0]) });
  expect(state.review.indexErrors.get(1)).toBe("page 1 failed");
  expect(state.review.itemsByPage.get(2)).toHaveLength(1);
  expect(state.review.indexRunning).toBe(false);
  expect(state.review.indexedPages).toBe(3);
});

test("stops on cancellation without recording a page failure", async () => {
  const error = Object.assign(new Error("cancel"), { name: "RenderCancelled" });
  const { state, controller, renderIndexPage } = harness(3, async () => { throw error; });
  await controller.startIndex();
  expect(renderIndexPage).toHaveBeenCalledTimes(1);
  expect(state.review.indexErrors.size).toBe(0);
  expect(state.review.indexRunning).toBe(false);
});

test("document replacement rejects an old result even when generation numbers repeat", async () => {
  let resolve;
  const { state, controller } = harness(1, () => new Promise(done => { resolve = done; }));
  const running = controller.startIndex();
  invalidateDocuments(state);
  state.review.indexGeneration = 1;
  resolve(page(0));
  await running;
  expect(state.review.itemsByPage.size).toBe(0);
});

test("synchronizes edited pages without workers and preserves reviews through move delete and undo", async () => {
  const { state, controller, renderIndexPage } = harness(1);
  const original = controller.commitPage(page(0)).currentBoxes;
  state.review.entriesById.set(original[0].id, { status: "confirmed", comment: "keep" });
  const moved = [{ ...original[0], x: 65 }];
  state.boxEditor.editsByPage.set(0, moved);
  await controller.startIndex();
  expect(renderIndexPage).not.toHaveBeenCalled();
  expect(state.review.itemsByPage.get(0)[0].rect.x).toBe(65);
  controller.syncEditedPage({ pageIndex: 0, boxes: [] });
  expect(state.review.itemsByPage.get(0)).toEqual([]);
  controller.syncEditedPage({ pageIndex: 0, boxes: original });
  expect(state.review.entriesById.get(original[0].id).comment).toBe("keep");
});

test("a manual edit during indexing wins over an in-flight automatic result", async () => {
  let resolve;
  const { state, controller } = harness(1, () => new Promise(done => { resolve = done; }));
  controller.commitPage(page(0));
  const running = controller.startIndex();
  const manual = [{ ...box(70), id: controller.allocateId(), kind: "changed", source: "manual" }];
  state.boxEditor.editsByPage.set(0, manual);
  controller.syncEditedPage({ ...page(0), boxes: manual });
  resolve(page(0));
  await running;
  expect(state.review.itemsByPage.get(0)[0]).toMatchObject({ id: manual[0].id, source: "manual", rect: { x: 70 } });
});

test("a synchronized manual edit wins over a delayed worker failure and indexing continues", async () => {
  let reject;
  const { state, controller, renderIndexPage, reportError } = harness(2);
  controller.commitPage(page(0));
  renderIndexPage.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const running = controller.startIndex();
  const manual = [{ ...box(70), id: controller.allocateId(), kind: "changed", source: "manual" }];
  state.boxEditor.editsByPage.set(0, manual);
  controller.syncEditedPage({ pageIndex: 0 });
  reject(new Error("late worker failure"));
  await running;
  expect(state.review.indexErrors.has(0)).toBe(false);
  expect(reportError).not.toHaveBeenCalled();
  expect(state.review.itemsByPage.get(0)[0]).toMatchObject({ id: manual[0].id, rect: { x: 70 } });
  expect(state.review.itemsByPage.has(1)).toBe(true);
  expect(state.review.indexedPages).toBe(2);
  expect(state.review.indexRunning).toBe(false);
});

test("worker cancellation still stops indexing when the waiting page was manually edited", async () => {
  let reject;
  const { state, controller, renderIndexPage } = harness(2);
  const boxes = controller.commitPage(page(0)).currentBoxes;
  renderIndexPage.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const running = controller.startIndex();
  state.boxEditor.editsByPage.set(0, boxes);
  controller.syncEditedPage({ pageIndex: 0 });
  reject(Object.assign(new Error("cancel"), { name: "RenderCancelled" }));
  await running;
  expect(state.review.indexErrors.size).toBe(0);
  expect(state.review.itemsByPage.has(1)).toBe(false);
  expect(state.review.indexRunning).toBe(false);
});
