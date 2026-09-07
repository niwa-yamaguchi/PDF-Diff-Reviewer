import { expect, test, vi } from "vitest";
import { createAppState } from "../../src/app/state.js";
import { captureReviewMigration, invalidateDocuments } from "../../src/app/invalidation.js";
import { createChangeReviewController } from "../../src/features/change-review/review-controller.js";

const box = (x = 10) => ({ x, y: 10, w: 20, h: 20, kind: "added" });
const page = (pageIndex, boxes = [box()]) => ({ pageIndex, boxes, width: 100, height: 100 });
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
  state.review.entriesById.set("change-1", { status: "excluded", comment: "updated" });
  captureReviewMigration(state);
  controller.commitPage(page(0, [box(12)]));
  controller.commitPage(page(1));
  expect(state.review.entriesById.get("change-1")).toEqual({ status: "excluded", comment: "updated" });
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
