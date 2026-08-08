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
    dlPng: { disabled: false },
    dlPdf: { disabled: false },
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
  const newLoad = controller.load("new", newFile);
  const newSettled = vi.fn();
  newLoad.then(newSettled);
  await vi.waitFor(() => expect(pdf.getDocument).toHaveBeenCalledTimes(2));
  await Promise.resolve();
  expect(newSettled).not.toHaveBeenCalled();
  oldParse.resolve(oldDoc);

  expect(await oldLoad).toBe(true);
  expect(await newLoad).toBe(true);
  expect(state.documents.oldDoc).toBe(oldDoc);
  expect(state.documents.newDoc).toBe(newDoc);
  expect(state.documents.generation).toBe(2);
  expect(onReady).toHaveBeenCalledOnce();
});

test("publishes only the complete replacement pair when both existing sides reload", async () => {
  const state = createAppState();
  const oldDoc0 = { numPages: 1, id: "old-0" };
  const newDoc0 = { numPages: 1, id: "new-0" };
  const oldDoc1 = { numPages: 2, id: "old-1" };
  const newDoc1 = { numPages: 3, id: "new-1" };
  state.documents.oldDoc = oldDoc0;
  state.documents.newDoc = newDoc0;
  state.documents.oldSequence = [0];
  state.documents.newSequence = [0];
  state.documents.pages = 1;
  state.visual.rendered = true;
  state.visual.pageCache.set(0, { stable: true });
  const dom = createDom();
  dom.run.disabled = false;
  dom.runText.disabled = false;
  dom.dropOld.fileName.textContent = "old-0.pdf";
  dom.dropNew.fileName.textContent = "new-0.pdf";
  const oldParse = deferred();
  const pdf = {
    getDocument: vi.fn()
      .mockReturnValueOnce({ promise: oldParse.promise })
      .mockReturnValueOnce({ promise: Promise.resolve(newDoc1) }),
  };
  const { controller, onReady } = createHarness({ state, dom, pdf });
  const oldFile = { name: "old-1.pdf", arrayBuffer: vi.fn(async () => new ArrayBuffer(1)) };
  const newFile = { name: "new-1.pdf", arrayBuffer: vi.fn(async () => new ArrayBuffer(2)) };

  const oldLoad = controller.load("old", oldFile);
  const readyClosedAtStart = {
    run: dom.run.disabled,
    runText: dom.runText.disabled,
    dlPng: dom.dlPng.disabled,
    dlPdf: dom.dlPdf.disabled,
    dlTextPng: dom.dlTextPng.disabled,
    dlTextPdf: dom.dlTextPdf.disabled,
    rendered: state.visual.rendered,
  };
  await vi.waitFor(() => expect(pdf.getDocument).toHaveBeenCalledTimes(1));
  const newLoad = controller.load("new", newFile);
  const newSettled = vi.fn();
  newLoad.then(newSettled);
  await vi.waitFor(() => expect(pdf.getDocument).toHaveBeenCalledTimes(2));
  await Promise.resolve();
  expect(newSettled).not.toHaveBeenCalled();
  const afterNew = {
    oldDoc: state.documents.oldDoc,
    newDoc: state.documents.newDoc,
    oldSequence: [...state.documents.oldSequence],
    newSequence: [...state.documents.newSequence],
    pages: state.documents.pages,
    oldName: dom.dropOld.fileName.textContent,
    newName: dom.dropNew.fileName.textContent,
    cached: state.visual.pageCache.get(0),
    renderGeneration: state.visual.renderGeneration,
    runDisabled: dom.run.disabled,
    readyCalls: onReady.mock.calls.length,
  };
  oldParse.resolve(oldDoc1);

  expect(await oldLoad).toBe(true);
  expect(await newLoad).toBe(true);
  expect(readyClosedAtStart).toEqual({
    run: true,
    runText: true,
    dlPng: true,
    dlPdf: true,
    dlTextPng: true,
    dlTextPdf: true,
    rendered: false,
  });
  expect(afterNew).toEqual({
    oldDoc: oldDoc0,
    newDoc: newDoc0,
    oldSequence: [0],
    newSequence: [0],
    pages: 1,
    oldName: "old-0.pdf",
    newName: "new-0.pdf",
    cached: { stable: true },
    renderGeneration: 0,
    runDisabled: true,
    readyCalls: 0,
  });
  expect(state.documents.oldDoc).toBe(oldDoc1);
  expect(state.documents.newDoc).toBe(newDoc1);
  expect(state.documents.pages).toBe(3);
  expect(state.documents.generation).toBe(2);
  expect(state.visual.pageCache.size).toBe(0);
  expect(state.visual.renderGeneration).toBe(1);
  expect(dom.dropOld.fileName.textContent).toBe("old-1.pdf");
  expect(dom.dropNew.fileName.textContent).toBe("new-1.pdf");
  expect(dom.run.disabled).toBe(false);
  expect(onReady).toHaveBeenCalledOnce();
});

test("restores the stable pair and ready state after a single current failure", async () => {
  const state = createAppState();
  const oldDoc0 = { numPages: 1, id: "old-0" };
  const newDoc0 = { numPages: 1, id: "new-0" };
  state.documents.oldDoc = oldDoc0;
  state.documents.newDoc = newDoc0;
  state.documents.oldSequence = [0];
  state.documents.newSequence = [0];
  state.documents.pages = 1;
  state.documents.alignmentOps = [{ side: "old", slot: 0 }];
  state.visual.rendered = true;
  state.visual.pageCache.set(0, { stable: true });
  const dom = createDom();
  dom.run.disabled = false;
  dom.runText.disabled = false;
  dom.dlPng.disabled = false;
  dom.dlPdf.disabled = true;
  dom.dlTextPng.disabled = false;
  dom.dlTextPdf.disabled = true;
  dom.dropOld.fileName.textContent = "old-0.pdf";
  dom.dropNew.fileName.textContent = "new-0.pdf";
  const parseError = new Error("replacement failed");
  const pdf = { getDocument: vi.fn(() => ({ promise: Promise.reject(parseError) })) };
  const { controller, errorReporter, onReady } = createHarness({ state, dom, pdf });
  const file = { name: "broken.pdf", arrayBuffer: vi.fn(async () => new ArrayBuffer(1)) };

  expect(await controller.load("old", file)).toBe(false);

  expect(state.documents).toMatchObject({
    oldDoc: oldDoc0,
    newDoc: newDoc0,
    oldSequence: [0],
    newSequence: [0],
    pages: 1,
    alignmentOps: [{ side: "old", slot: 0 }],
    generation: 1,
  });
  expect(state.visual.pageCache.get(0)).toEqual({ stable: true });
  expect(state.visual.renderGeneration).toBe(0);
  expect(state.visual.rendered).toBe(true);
  expect(dom.run.disabled).toBe(false);
  expect(dom.runText.disabled).toBe(false);
  expect(dom.dlPng.disabled).toBe(false);
  expect(dom.dlPdf.disabled).toBe(true);
  expect(dom.dlTextPng.disabled).toBe(false);
  expect(dom.dlTextPdf.disabled).toBe(true);
  expect(dom.dropOld.fileName.textContent).toBe("old-0.pdf");
  expect(dom.dropNew.fileName.textContent).toBe("new-0.pdf");
  expect(errorReporter.report).toHaveBeenCalledWith(parseError, "PDFの読み込みに失敗しました");
  expect(onReady).not.toHaveBeenCalled();
});

test("clears an empty failed batch so the next single load can publish", async () => {
  const state = createAppState();
  const oldDoc0 = { numPages: 1, id: "old-0" };
  const newDoc0 = { numPages: 1, id: "new-0" };
  const newDoc1 = { numPages: 2, id: "new-1" };
  state.documents.oldDoc = oldDoc0;
  state.documents.newDoc = newDoc0;
  const dom = createDom();
  dom.run.disabled = false;
  dom.runText.disabled = false;
  const pdf = {
    getDocument: vi.fn()
      .mockImplementationOnce(() => ({ promise: Promise.reject(new Error("old failed")) }))
      .mockReturnValueOnce({ promise: Promise.resolve(newDoc1) }),
  };
  const { controller, onReady } = createHarness({ state, dom, pdf });
  const failedOld = { name: "broken-old.pdf", arrayBuffer: vi.fn(async () => new ArrayBuffer(1)) };
  const replacementNew = { name: "new-1.pdf", arrayBuffer: vi.fn(async () => new ArrayBuffer(2)) };

  expect(await controller.load("old", failedOld)).toBe(false);
  expect(await controller.load("new", replacementNew)).toBe(true);

  expect(state.documents.oldDoc).toBe(oldDoc0);
  expect(state.documents.newDoc).toBe(newDoc1);
  expect(state.documents.generation).toBe(2);
  expect(dom.run.disabled).toBe(false);
  expect(onReady).toHaveBeenCalledOnce();
});

test("a stale same-side completion preserves current stages and pending requests", async () => {
  const state = createAppState();
  const oldDoc0 = { numPages: 1, id: "old-0" };
  const newDoc0 = { numPages: 1, id: "new-0" };
  const oldDoc2 = { numPages: 2, id: "old-2" };
  const newDoc1 = { numPages: 2, id: "new-1" };
  state.documents.oldDoc = oldDoc0;
  state.documents.newDoc = newDoc0;
  state.visual.pageCache.set(0, { stable: true });
  const dom = createDom();
  dom.run.disabled = false;
  dom.runText.disabled = false;
  const oldParse1 = deferred();
  const newParse1 = deferred();
  const oldParse2 = deferred();
  const pdf = {
    getDocument: vi.fn()
      .mockReturnValueOnce({ promise: oldParse1.promise })
      .mockReturnValueOnce({ promise: newParse1.promise })
      .mockReturnValueOnce({ promise: oldParse2.promise }),
  };
  const { controller, onReady } = createHarness({ state, dom, pdf });
  const oldFile1 = { name: "old-1.pdf", arrayBuffer: vi.fn(async () => new ArrayBuffer(1)) };
  const newFile1 = { name: "new-1.pdf", arrayBuffer: vi.fn(async () => new ArrayBuffer(2)) };
  const oldFile2 = { name: "old-2.pdf", arrayBuffer: vi.fn(async () => new ArrayBuffer(3)) };

  const oldLoad1 = controller.load("old", oldFile1);
  await vi.waitFor(() => expect(pdf.getDocument).toHaveBeenCalledTimes(1));
  const newLoad1 = controller.load("new", newFile1);
  await vi.waitFor(() => expect(pdf.getDocument).toHaveBeenCalledTimes(2));
  const oldLoad2 = controller.load("old", oldFile2);
  await vi.waitFor(() => expect(pdf.getDocument).toHaveBeenCalledTimes(3));
  oldParse1.resolve({ numPages: 3, id: "old-1" });

  expect(await oldLoad1).toBe(false);
  expect(state.documents.oldDoc).toBe(oldDoc0);
  expect(state.documents.newDoc).toBe(newDoc0);
  expect(state.visual.pageCache.get(0)).toEqual({ stable: true });
  expect(dom.run.disabled).toBe(true);
  expect(onReady).not.toHaveBeenCalled();

  newParse1.resolve(newDoc1);
  const newSettled = vi.fn();
  newLoad1.then(newSettled);
  await Promise.resolve();
  expect(newSettled).not.toHaveBeenCalled();
  expect(state.documents.oldDoc).toBe(oldDoc0);
  expect(state.documents.newDoc).toBe(newDoc0);
  expect(state.visual.pageCache.get(0)).toEqual({ stable: true });
  expect(dom.run.disabled).toBe(true);
  expect(onReady).not.toHaveBeenCalled();

  oldParse2.resolve(oldDoc2);
  expect(await oldLoad2).toBe(true);
  expect(await newLoad1).toBe(true);
  expect(state.documents.oldDoc).toBe(oldDoc2);
  expect(state.documents.newDoc).toBe(newDoc1);
  expect(state.documents.generation).toBe(3);
  expect(state.visual.renderGeneration).toBe(1);
  expect(dom.run.disabled).toBe(false);
  expect(onReady).toHaveBeenCalledOnce();
});

test("keeps a failed replacement batch unready until a successful retry", async () => {
  const state = createAppState();
  const oldDoc0 = { numPages: 1, id: "old-0" };
  const newDoc0 = { numPages: 1, id: "new-0" };
  const oldDoc1 = { numPages: 2, id: "old-1" };
  const newDoc1 = { numPages: 2, id: "new-1" };
  state.documents.oldDoc = oldDoc0;
  state.documents.newDoc = newDoc0;
  state.documents.oldSequence = [0];
  state.documents.newSequence = [0];
  state.documents.pages = 1;
  state.visual.rendered = true;
  state.visual.pageCache.set(0, { stable: true });
  const dom = createDom();
  dom.run.disabled = false;
  dom.runText.disabled = false;
  dom.dropOld.fileName.textContent = "old-0.pdf";
  dom.dropNew.fileName.textContent = "new-0.pdf";
  const oldParse = deferred();
  const parseError = new Error("new replacement failed");
  const pdf = {
    getDocument: vi.fn()
      .mockReturnValueOnce({ promise: oldParse.promise })
      .mockImplementationOnce(() => ({ promise: Promise.reject(parseError) }))
      .mockReturnValueOnce({ promise: Promise.resolve(newDoc1) }),
  };
  const { controller, errorReporter, onReady } = createHarness({ state, dom, pdf });
  const oldFile = { name: "old-1.pdf", arrayBuffer: vi.fn(async () => new ArrayBuffer(1)) };
  const failedNewFile = { name: "broken-new.pdf", arrayBuffer: vi.fn(async () => new ArrayBuffer(2)) };
  const retryNewFile = { name: "new-1.pdf", arrayBuffer: vi.fn(async () => new ArrayBuffer(3)) };

  const oldLoad = controller.load("old", oldFile);
  await vi.waitFor(() => expect(pdf.getDocument).toHaveBeenCalledTimes(1));
  expect(await controller.load("new", failedNewFile)).toBe(false);
  oldParse.resolve(oldDoc1);
  expect(await oldLoad).toBe(false);

  expect(state.documents.oldDoc).toBe(oldDoc0);
  expect(state.documents.newDoc).toBe(newDoc0);
  expect(state.documents.oldSequence).toEqual([0]);
  expect(state.documents.newSequence).toEqual([0]);
  expect(state.visual.pageCache.get(0)).toEqual({ stable: true });
  expect(state.visual.renderGeneration).toBe(0);
  expect(dom.dropOld.fileName.textContent).toBe("old-0.pdf");
  expect(dom.dropNew.fileName.textContent).toBe("new-0.pdf");
  expect(dom.run.disabled).toBe(false);
  expect(dom.runText.disabled).toBe(false);
  expect(onReady).not.toHaveBeenCalled();
  expect(errorReporter.report).toHaveBeenCalledWith(parseError, "PDFの読み込みに失敗しました");

  expect(await controller.load("new", retryNewFile)).toBe(true);
  expect(state.documents.oldDoc).toBe(oldDoc1);
  expect(state.documents.newDoc).toBe(newDoc1);
  expect(state.documents.generation).toBe(3);
  expect(state.visual.pageCache.size).toBe(0);
  expect(state.visual.renderGeneration).toBe(1);
  expect(dom.dropOld.fileName.textContent).toBe("old-1.pdf");
  expect(dom.dropNew.fileName.textContent).toBe("new-1.pdf");
  expect(dom.run.disabled).toBe(false);
  expect(onReady).toHaveBeenCalledOnce();
});

test("abandons a failed batch when the staged side is loaded again", async () => {
  const state = createAppState();
  const oldDoc0 = { numPages: 1, id: "old-0" };
  const newDoc0 = { numPages: 1, id: "new-0" };
  const oldDoc1 = { numPages: 2, id: "old-1" };
  const oldDoc2 = { numPages: 3, id: "old-2" };
  state.documents.oldDoc = oldDoc0;
  state.documents.newDoc = newDoc0;
  state.documents.oldSequence = [0];
  state.documents.newSequence = [0];
  state.documents.pages = 1;
  state.visual.rendered = true;
  state.visual.pageCache.set(0, { stable: true });
  const dom = createDom();
  dom.run.disabled = false;
  dom.runText.disabled = false;
  dom.dropOld.fileName.textContent = "old-0.pdf";
  dom.dropNew.fileName.textContent = "new-0.pdf";
  const newParse = deferred();
  const parseError = new Error("new replacement failed");
  const pdf = {
    getDocument: vi.fn()
      .mockReturnValueOnce({ promise: newParse.promise })
      .mockReturnValueOnce({ promise: Promise.resolve(oldDoc1) })
      .mockReturnValueOnce({ promise: Promise.resolve(oldDoc2) }),
  };
  const { controller, errorReporter, onReady } = createHarness({ state, dom, pdf });
  const failedNewFile = { name: "broken-new.pdf", arrayBuffer: vi.fn(async () => new ArrayBuffer(1)) };
  const stagedOldFile = { name: "old-1.pdf", arrayBuffer: vi.fn(async () => new ArrayBuffer(2)) };
  const replacementOldFile = { name: "old-2.pdf", arrayBuffer: vi.fn(async () => new ArrayBuffer(3)) };

  const failedNewLoad = controller.load("new", failedNewFile);
  await vi.waitFor(() => expect(pdf.getDocument).toHaveBeenCalledTimes(1));
  const stagedOldLoad = controller.load("old", stagedOldFile);
  await vi.waitFor(() => expect(pdf.getDocument).toHaveBeenCalledTimes(2));
  const stagedSettled = vi.fn();
  stagedOldLoad.then(stagedSettled);
  await Promise.resolve();
  expect(stagedSettled).not.toHaveBeenCalled();

  newParse.reject(parseError);
  expect(await failedNewLoad).toBe(false);
  expect(await stagedOldLoad).toBe(false);
  expect(state.documents.oldDoc).toBe(oldDoc0);
  expect(state.documents.newDoc).toBe(newDoc0);
  expect(state.visual.pageCache.get(0)).toEqual({ stable: true });
  expect(dom.run.disabled).toBe(false);
  expect(onReady).not.toHaveBeenCalled();

  expect(await controller.load("old", replacementOldFile)).toBe(true);
  expect(state.documents.oldDoc).toBe(oldDoc2);
  expect(state.documents.newDoc).toBe(newDoc0);
  expect(state.documents.generation).toBe(3);
  expect(state.visual.pageCache.size).toBe(0);
  expect(state.visual.renderGeneration).toBe(1);
  expect(dom.dropOld.fileName.textContent).toBe("old-2.pdf");
  expect(dom.dropNew.fileName.textContent).toBe("new-0.pdf");
  expect(dom.run.disabled).toBe(false);
  expect(errorReporter.report).toHaveBeenCalledWith(parseError, "PDFの読み込みに失敗しました");
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
