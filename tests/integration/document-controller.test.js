import { expect, test, vi } from "vitest";
import { createAppState } from "../../src/app/state.js";
import { createDocumentController } from "../../src/features/documents/document-controller.js";

function drop(initialName = "") {
  const fileName = { textContent: initialName };
  return {
    classList: { add: vi.fn() },
    querySelector: vi.fn(() => fileName),
    fileName,
  };
}

function createDom() {
  return {
    dropOld: drop(),
    dropNew: drop(),
    run: { disabled: true },
    runText: { disabled: true },
    dlTextPng: { disabled: false },
    dlTextPdf: { disabled: false },
    status: { textContent: "" },
    textStatus: { textContent: "" },
  };
}

function createHarness(overrides = {}) {
  const state = overrides.state ?? createAppState();
  const dom = overrides.dom ?? createDom();
  const errorReporter = overrides.errorReporter ?? { report: vi.fn() };
  const onReady = overrides.onReady ?? vi.fn();
  const controller = createDocumentController({
    state,
    dom,
    pdf: overrides.pdf,
    errorReporter,
    onReady,
    confirmDiscard: overrides.confirmDiscard,
  });
  return { state, dom, errorReporter, onReady, controller };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("commits each document and announces readiness after both sides load", async () => {
  const oldDoc = { numPages: 2 };
  const newDoc = { numPages: 2 };
  const pdf = {
    getDocument: vi.fn()
      .mockReturnValueOnce({ promise: Promise.resolve(oldDoc) })
      .mockReturnValueOnce({ promise: Promise.resolve(newDoc) }),
  };
  const { state, onReady, controller } = createHarness({ pdf });
  const fakeFile = { name: "fixture.pdf", arrayBuffer: vi.fn(async () => new ArrayBuffer(8)) };

  expect(await controller.load("old", fakeFile)).toBe(true);
  expect(state.documents.oldDoc).toBe(oldDoc);
  expect(state.documents.generation).toBe(1);
  expect(onReady).not.toHaveBeenCalled();

  expect(await controller.load("new", fakeFile)).toBe(true);
  expect(state.documents.newDoc).toBe(newDoc);
  expect(state.documents.generation).toBe(2);
  expect(onReady).toHaveBeenCalledOnce();
});

test("rejecting discard leaves the file state DOM and caches untouched", async () => {
  const state = createAppState();
  const existingDoc = { numPages: 1 };
  state.documents.oldDoc = existingDoc;
  state.documents.generation = 7;
  state.visual.pageCache.set(0, { removed: 1 });
  const dom = createDom();
  dom.dropOld.fileName.textContent = "existing.pdf";
  const file = { name: "replacement.pdf", arrayBuffer: vi.fn() };
  const pdf = { getDocument: vi.fn() };
  const { controller, errorReporter, onReady } = createHarness({
    state,
    dom,
    pdf,
    confirmDiscard: () => false,
  });

  expect(await controller.load("old", file)).toBe(false);
  expect(file.arrayBuffer).not.toHaveBeenCalled();
  expect(pdf.getDocument).not.toHaveBeenCalled();
  expect(state.documents.oldDoc).toBe(existingDoc);
  expect(state.documents.generation).toBe(7);
  expect(state.visual.pageCache.get(0)).toEqual({ removed: 1 });
  expect(dom.dropOld.fileName.textContent).toBe("existing.pdf");
  expect(dom.dropOld.classList.add).not.toHaveBeenCalled();
  expect(errorReporter.report).not.toHaveBeenCalled();
  expect(onReady).not.toHaveBeenCalled();
});

test("commits only the newest result from overlapping accepted loads", async () => {
  const firstParse = deferred();
  const firstDoc = { numPages: 1, id: "first" };
  const secondDoc = { numPages: 2, id: "second" };
  const pdf = {
    getDocument: vi.fn()
      .mockReturnValueOnce({ promise: firstParse.promise })
      .mockReturnValueOnce({ promise: Promise.resolve(secondDoc) }),
  };
  const { state, dom, controller } = createHarness({ pdf });
  const firstFile = { name: "first.pdf", arrayBuffer: vi.fn(async () => new ArrayBuffer(1)) };
  const secondFile = { name: "second.pdf", arrayBuffer: vi.fn(async () => new ArrayBuffer(2)) };

  const firstLoad = controller.load("old", firstFile);
  await vi.waitFor(() => expect(pdf.getDocument).toHaveBeenCalledTimes(1));
  expect(await controller.load("old", secondFile)).toBe(true);
  firstParse.resolve(firstDoc);

  expect(await firstLoad).toBe(false);
  expect(state.documents.oldDoc).toBe(secondDoc);
  expect(state.documents.generation).toBe(2);
  expect(dom.dropOld.fileName.textContent).toBe("second.pdf");
});

test("allows concurrent loads for opposite document sides to both commit", async () => {
  const oldParse = deferred();
  const oldDoc = { numPages: 1, id: "old" };
  const newDoc = { numPages: 2, id: "new" };
  const pdf = {
    getDocument: vi.fn()
      .mockReturnValueOnce({ promise: oldParse.promise })
      .mockReturnValueOnce({ promise: Promise.resolve(newDoc) }),
  };
  const { state, controller, onReady } = createHarness({ pdf });
  const oldFile = { name: "old.pdf", arrayBuffer: vi.fn(async () => new ArrayBuffer(1)) };
  const newFile = { name: "new.pdf", arrayBuffer: vi.fn(async () => new ArrayBuffer(2)) };

  const oldLoad = controller.load("old", oldFile);
  await vi.waitFor(() => expect(pdf.getDocument).toHaveBeenCalledTimes(1));
  expect(await controller.load("new", newFile)).toBe(true);
  oldParse.resolve(oldDoc);

  expect(await oldLoad).toBe(true);
  expect(state.documents.oldDoc).toBe(oldDoc);
  expect(state.documents.newDoc).toBe(newDoc);
  expect(state.documents.generation).toBe(2);
  expect(onReady).toHaveBeenCalledOnce();
});

test("reports a parse failure only for the current generation", async () => {
  const error = new Error("invalid PDF");
  const pdf = { getDocument: vi.fn(() => ({ promise: Promise.reject(error) })) };
  const { state, dom, controller, errorReporter } = createHarness({ pdf });
  const file = { name: "broken.pdf", arrayBuffer: vi.fn(async () => new ArrayBuffer(3)) };

  expect(await controller.load("new", file)).toBe(false);
  expect(state.documents.generation).toBe(1);
  expect(state.documents.newDoc).toBeNull();
  expect(dom.dropNew.fileName.textContent).toBe("");
  expect(errorReporter.report).toHaveBeenCalledOnce();
  expect(errorReporter.report).toHaveBeenCalledWith(error, "PDFの読み込みに失敗しました");
});

test("reports an arrayBuffer failure without invoking PDF parsing", async () => {
  const error = new Error("file unavailable");
  const pdf = { getDocument: vi.fn() };
  const { state, controller, errorReporter } = createHarness({ pdf });
  const file = { name: "unreadable.pdf", arrayBuffer: vi.fn(async () => { throw error; }) };

  expect(await controller.load("old", file)).toBe(false);
  expect(state.documents.generation).toBe(1);
  expect(pdf.getDocument).not.toHaveBeenCalled();
  expect(errorReporter.report).toHaveBeenCalledWith(error, "PDFの読み込みに失敗しました");
});

test("suppresses an error from a stale generation", async () => {
  const staleParse = deferred();
  const currentDoc = { numPages: 1 };
  const pdf = {
    getDocument: vi.fn()
      .mockReturnValueOnce({ promise: staleParse.promise })
      .mockReturnValueOnce({ promise: Promise.resolve(currentDoc) }),
  };
  const { state, controller, errorReporter } = createHarness({ pdf });
  const staleFile = { name: "stale.pdf", arrayBuffer: vi.fn(async () => new ArrayBuffer(1)) };
  const currentFile = { name: "current.pdf", arrayBuffer: vi.fn(async () => new ArrayBuffer(2)) };

  const staleLoad = controller.load("old", staleFile);
  await vi.waitFor(() => expect(pdf.getDocument).toHaveBeenCalledTimes(1));
  expect(await controller.load("old", currentFile)).toBe(true);
  staleParse.reject(new Error("late failure"));

  expect(await staleLoad).toBe(false);
  expect(state.documents.oldDoc).toBe(currentDoc);
  expect(state.documents.generation).toBe(2);
  expect(errorReporter.report).not.toHaveBeenCalled();
});
