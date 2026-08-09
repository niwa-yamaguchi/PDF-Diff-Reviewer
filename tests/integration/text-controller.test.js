import { describe, expect, test, vi } from "vitest";
import { createAppState } from "../../src/app/state.js";
import {
  createTextController,
  extractPageTokens,
} from "../../src/features/text-review/text-controller.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function classList() {
  const values = new Set();
  return {
    add: vi.fn(value => values.add(value)),
    remove: vi.fn(value => values.delete(value)),
    toggle: vi.fn((value, force) => force ? values.add(value) : values.delete(value)),
    contains: value => values.has(value),
  };
}

function context() {
  return {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    fillRect: vi.fn(),
  };
}

function canvas(width = 10, height = 10) {
  const ctx = context();
  return {
    width,
    height,
    style: {},
    getContext: () => ctx,
    context: ctx,
  };
}

function doc(numPages = 1) {
  return { numPages };
}

function lines(text) {
  return [{ text, tokens: [] }];
}

function makeHarness({ extract = vi.fn(), renderPage = vi.fn() } = {}) {
  const state = createAppState();
  state.documents.oldDoc = doc();
  state.documents.newDoc = doc();
  state.documents.generation = 7;
  state.ui.topMode = "text";
  const dom = {
    textStatus: { textContent: "stable", innerHTML: "", classList: classList() },
    runText: { disabled: false },
    dlTextPng: { disabled: true },
    dlTextPdf: { disabled: true },
    textPageInd: { textContent: "– / –" },
    oldTextCanvas: canvas(),
    newTextCanvas: canvas(),
    topVisual: { classList: classList() },
    topText: { classList: classList() },
    visualCtrl: { style: {} },
    textCtrl: { style: {} },
    viewbar: { style: {} },
    canvasWrap: { style: {} },
    textPanel: { style: {} },
    out: { style: { display: "block" } },
    cancelBoxEdit: vi.fn(),
    restoreVisual: vi.fn(),
  };
  const renderer = {
    renderPage,
    renderOffscreen: vi.fn(),
    fit: vi.fn(),
    applyView: vi.fn(),
    cancelPan: vi.fn(),
  };
  const errorReporter = { report: vi.fn() };
  const progress = vi.fn();
  const controller = createTextController({
    state,
    dom,
    extractPageTokens: extract,
    renderer,
    errorReporter,
    onProgress: progress,
  });
  return { state, dom, renderer, errorReporter, progress, controller };
}

describe("text extraction controller", () => {
  test("only the newest out-of-order extraction commits", async () => {
    const firstOld = deferred();
    const secondOld = deferred();
    const secondNew = deferred();
    const extract = vi.fn()
      .mockImplementationOnce(() => firstOld.promise)
      .mockImplementationOnce(() => secondOld.promise)
      .mockImplementationOnce(() => secondNew.promise);
    const rendered = canvas(80, 100);
    const { state, dom, controller } = makeHarness({
      extract,
      renderPage: vi.fn().mockResolvedValue(rendered),
    });

    const first = controller.run();
    const second = controller.run();
    secondOld.resolve(lines("new old-side"));
    await Promise.resolve();
    secondNew.resolve(lines("new new-side"));
    await second;
    firstOld.resolve(lines("stale old-side"));
    await first;

    expect(state.textReview.extraction).toEqual({
      old: [lines("new old-side")],
      new: [lines("new new-side")],
    });
    expect(dom.textStatus.textContent).toBe("テキスト差分を表示中");
  });

  test("document replacement discards stale extraction success and rejection without side effects", async () => {
    const oldPage = deferred();
    const extract = vi.fn(() => oldPage.promise);
    const { state, dom, errorReporter, controller } = makeHarness({ extract });
    const prior = { old: [lines("prior")], new: [lines("prior")] };
    state.textReview.extraction = prior;
    state.textReview.highlights = { old: new Map(), new: new Map() };
    state.textReview.extraction = null;
    const running = controller.run();
    state.documents.generation += 1;
    state.textReview.extractGeneration += 1;
    dom.textStatus.textContent = "document replaced";
    oldPage.resolve(lines("stale"));
    await running;

    expect(state.textReview.extraction).toBeNull();
    expect(dom.textStatus.textContent).toBe("document replaced");
    expect(errorReporter.report).not.toHaveBeenCalled();

    const rejection = deferred();
    extract.mockImplementationOnce(() => rejection.promise);
    const rejected = controller.run();
    state.documents.generation += 1;
    state.textReview.extractGeneration += 1;
    dom.textStatus.textContent = "newer state";
    rejection.reject(new Error("stale"));
    await rejected;
    expect(dom.textStatus.textContent).toBe("newer state");
    expect(errorReporter.report).not.toHaveBeenCalled();
  });

  test("current extraction rejection reports once and retains committed data", async () => {
    const extract = vi.fn().mockRejectedValue(new Error("broken text layer"));
    const { state, dom, errorReporter, controller } = makeHarness({ extract });
    const extraction = { old: [lines("prior old")], new: [lines("prior new")] };
    const highlights = { old: new Map(), new: new Map() };
    state.textReview.extraction = extraction;
    state.textReview.highlights = highlights;

    await controller.run({ force: true });

    expect(errorReporter.report).toHaveBeenCalledTimes(1);
    expect(errorReporter.report).toHaveBeenCalledWith(expect.any(Error), "テキスト抽出に失敗しました");
    expect(state.textReview.extraction).toBe(extraction);
    expect(state.textReview.highlights).toBe(highlights);
    expect(dom.textStatus.classList.contains("busy")).toBe(false);
  });

  test("no-text result keeps export disabled and shows the existing fallback", async () => {
    const extract = vi.fn().mockResolvedValue([]);
    const { state, dom, controller } = makeHarness({ extract });
    dom.dlTextPng.disabled = false;
    dom.dlTextPdf.disabled = false;

    await controller.run();

    expect(state.textReview.highlights).toBeNull();
    expect(dom.textStatus.textContent).toBe("テキストレイヤがありません。図面比較で確認してください");
    expect(dom.dlTextPng.disabled).toBe(true);
    expect(dom.dlTextPdf.disabled).toBe(true);
  });

  test("reports per-side page progress without core DOM writes", async () => {
    const extract = vi.fn().mockResolvedValue(lines("text"));
    const { state, progress, controller } = makeHarness({
      extract,
      renderPage: vi.fn().mockResolvedValue(canvas(20, 20)),
    });
    state.documents.oldDoc = doc(2);
    state.documents.newDoc = doc(1);

    await controller.run();

    expect(progress.mock.calls.map(([value]) => value)).toEqual([
      { side: "old", page: 1, total: 2 },
      { side: "old", page: 2, total: 2 },
      { side: "new", page: 1, total: 1 },
    ]);
    expect(extract).toHaveBeenCalledWith(expect.objectContaining({
      debugXYCut: false,
      onDebug: expect.any(Function),
    }));
  });
});

describe("text page render controller", () => {
  test("initial candidate render failure preserves the prior committed review atomically", async () => {
    const renderPage = vi.fn().mockRejectedValue(new Error("candidate render failed"));
    const { state, dom, renderer, errorReporter, controller } = makeHarness({
      extract: vi.fn().mockResolvedValue(lines("candidate")),
      renderPage,
    });
    const priorExtraction = { old: [lines("prior old")], new: [lines("prior new")] };
    const priorHighlights = { old: new Map([[0, [{ color: "removed" }]]]), new: new Map() };
    state.textReview.extraction = priorExtraction;
    state.textReview.highlights = priorHighlights;
    state.textReview.scale = 1.25;
    state.textReview.page = 1;
    dom.oldTextCanvas.width = 71;
    dom.newTextCanvas.width = 72;
    dom.dlTextPng.disabled = false;
    dom.dlTextPdf.disabled = true;
    dom.textStatus.textContent = "prior review";

    await controller.run({ force: true });

    expect(errorReporter.report).toHaveBeenCalledTimes(1);
    expect(state.textReview.extraction).toBe(priorExtraction);
    expect(state.textReview.highlights).toBe(priorHighlights);
    expect(state.textReview.scale).toBe(1.25);
    expect(state.textReview.page).toBe(1);
    expect(dom.oldTextCanvas.width).toBe(71);
    expect(dom.newTextCanvas.width).toBe(72);
    expect(dom.oldTextCanvas.context.drawImage).not.toHaveBeenCalled();
    expect(dom.newTextCanvas.context.drawImage).not.toHaveBeenCalled();
    expect(dom.dlTextPng.disabled).toBe(false);
    expect(dom.dlTextPdf.disabled).toBe(true);
    expect(dom.textStatus.textContent).toBe("prior review");
    expect(dom.textStatus.classList.contains("busy")).toBe(false);
    expect(renderer.fit).not.toHaveBeenCalled();

    controller.renderOffscreen("old", 0);
    expect(renderer.renderOffscreen).toHaveBeenCalledWith(expect.objectContaining({
      snapshot: expect.objectContaining({ scale: 1.25 }),
    }));
    expect(renderer.renderOffscreen.mock.calls.at(-1)[0].snapshot.highlights.old.get(0))
      .toEqual([{ color: "removed" }]);
  });

  test("page navigation can settle the pending candidate after initial page zero becomes stale", async () => {
    const page0 = deferred();
    const page1Old = canvas(210, 310);
    const page1New = canvas(220, 320);
    const renderPage = vi.fn(({ side, pageIndex }) => (
      pageIndex === 0 ? page0.promise : Promise.resolve(side === "old" ? page1Old : page1New)
    ));
    const { state, dom, renderer, controller } = makeHarness({
      extract: vi.fn().mockResolvedValue(lines("candidate")),
      renderPage,
    });
    state.documents.oldDoc = doc(2);
    state.documents.newDoc = doc(2);
    const priorExtraction = { old: [lines("prior")], new: [lines("prior")] };
    state.textReview.extraction = priorExtraction;
    state.textReview.highlights = { old: new Map(), new: new Map() };
    state.textReview.scale = 1;
    dom.dlTextPng.disabled = true;
    dom.dlTextPdf.disabled = true;

    const running = controller.run({ force: true });
    await vi.waitFor(() => expect(renderPage).toHaveBeenCalledTimes(2));
    expect(state.textReview.extraction).toBe(priorExtraction);

    expect(await controller.showPage(1)).toBe(true);

    expect(state.textReview.extraction.old).toEqual([lines("candidate"), lines("candidate")]);
    expect(state.textReview.scale).toBe(150 / 72);
    expect(state.textReview.page).toBe(1);
    expect(dom.oldTextCanvas.width).toBe(210);
    expect(dom.newTextCanvas.width).toBe(220);
    expect(dom.textPageInd.textContent).toBe("2 / 2");
    expect(dom.dlTextPng.disabled).toBe(false);
    expect(dom.dlTextPdf.disabled).toBe(false);
    expect(dom.textStatus.textContent).toBe("テキスト差分を表示中");
    expect(dom.textStatus.classList.contains("busy")).toBe(false);
    expect(renderer.fit).toHaveBeenCalledTimes(1);

    page0.resolve(canvas(50, 60));
    expect(await running).toBe(true);
    expect(renderer.fit).toHaveBeenCalledTimes(1);
  });

  test("text mode restoration can settle a candidate whose initial render was cancelled", async () => {
    const initial = deferred();
    const restoredOld = canvas(310, 410);
    const restoredNew = canvas(320, 420);
    const renderPage = vi.fn(({ side }) => (
      renderPage.mock.calls.length <= 2
        ? initial.promise
        : Promise.resolve(side === "old" ? restoredOld : restoredNew)
    ));
    const { state, dom, renderer, controller } = makeHarness({
      extract: vi.fn().mockResolvedValue(lines("candidate")),
      renderPage,
    });
    state.textReview.extraction = { old: [lines("prior")], new: [lines("prior")] };
    state.textReview.highlights = { old: new Map(), new: new Map() };
    state.textReview.scale = 1;
    dom.dlTextPng.disabled = true;
    dom.dlTextPdf.disabled = true;

    const running = controller.run({ force: true });
    await vi.waitFor(() => expect(renderPage).toHaveBeenCalledTimes(2));
    await controller.setTopMode("visual");

    expect(await controller.setTopMode("text")).toBe(true);

    expect(state.textReview.extraction.old).toEqual([lines("candidate")]);
    expect(state.textReview.page).toBe(0);
    expect(dom.oldTextCanvas.width).toBe(310);
    expect(dom.newTextCanvas.width).toBe(320);
    expect(dom.dlTextPng.disabled).toBe(false);
    expect(dom.dlTextPdf.disabled).toBe(false);
    expect(dom.textStatus.textContent).toBe("テキスト差分を表示中");
    expect(renderer.fit).toHaveBeenCalledTimes(1);

    initial.resolve(canvas(60, 70));
    expect(await running).toBe(true);
    expect(renderer.fit).toHaveBeenCalledTimes(1);
  });

  test("document invalidation abandons the pending candidate without overwriting document UI", async () => {
    const pending = deferred();
    const renderPage = vi.fn(() => pending.promise);
    const { state, dom, controller } = makeHarness({
      extract: vi.fn().mockResolvedValue(lines("candidate")),
      renderPage,
    });
    const priorExtraction = { old: [lines("prior")], new: [lines("prior")] };
    state.textReview.extraction = priorExtraction;
    state.textReview.highlights = { old: new Map(), new: new Map() };

    const running = controller.run({ force: true });
    await vi.waitFor(() => expect(renderPage).toHaveBeenCalledTimes(2));
    state.documents.generation += 1;
    state.textReview.extractGeneration += 1;
    state.textReview.renderGeneration += 1;
    dom.textStatus.textContent = "new documents ready";
    dom.dlTextPng.disabled = true;
    dom.dlTextPdf.disabled = true;
    pending.resolve(canvas(70, 80));

    expect(await running).toBe(false);
    expect(state.textReview.extraction).toBe(priorExtraction);
    expect(dom.oldTextCanvas.width).toBe(10);
    expect(dom.newTextCanvas.width).toBe(10);
    expect(dom.textStatus.textContent).toBe("new documents ready");
    expect(dom.textStatus.classList.contains("busy")).toBe(false);
    expect(dom.dlTextPng.disabled).toBe(true);
    expect(dom.dlTextPdf.disabled).toBe(true);
  });

  test("explicit document invalidation clears a restoration candidate after its run already returned", async () => {
    const pending = deferred();
    const renderPage = vi.fn(() => pending.promise);
    const { state, dom, controller } = makeHarness({
      extract: vi.fn().mockResolvedValue(lines("candidate")),
      renderPage,
    });
    state.textReview.extraction = { old: [lines("prior")], new: [lines("prior")] };
    state.textReview.highlights = { old: new Map(), new: new Map() };

    const running = controller.run({ force: true });
    await vi.waitFor(() => expect(renderPage).toHaveBeenCalledTimes(2));
    await controller.setTopMode("visual");
    pending.resolve(canvas(70, 80));
    expect(await running).toBe(false);
    expect(dom.textStatus.classList.contains("busy")).toBe(true);

    state.documents.generation += 1;
    dom.textStatus.textContent = "new documents ready";
    dom.dlTextPng.disabled = true;
    dom.dlTextPdf.disabled = true;
    expect(controller.invalidateDocuments(state.documents.generation)).toBe(true);

    expect(dom.textStatus.textContent).toBe("new documents ready");
    expect(dom.textStatus.classList.contains("busy")).toBe(false);
    expect(dom.dlTextPng.disabled).toBe(true);
    expect(dom.dlTextPdf.disabled).toBe(true);
    state.textReview.highlights = null;
    const calls = renderPage.mock.calls.length;
    await controller.setTopMode("text");
    expect(renderPage).toHaveBeenCalledTimes(calls);
  });

  test("an older document notification cannot abandon a newer text session", async () => {
    const extraction = deferred();
    const { state, dom, controller } = makeHarness({ extract: vi.fn(() => extraction.promise) });
    state.documents.generation = 8;
    const newer = controller.run({ force: true });
    const status = dom.textStatus.textContent;

    expect(controller.invalidateDocuments(7)).toBe(false);
    expect(dom.textStatus.classList.contains("busy")).toBe(true);
    expect(dom.textStatus.textContent).toBe(status);

    state.documents.generation = 9;
    state.textReview.extractGeneration += 1;
    expect(controller.invalidateDocuments(9)).toBe(true);
    extraction.resolve(lines("stale"));
    expect(await newer).toBe(false);
    expect(dom.textStatus.classList.contains("busy")).toBe(false);
  });

  test("shares one ticket across both panes and discards a late older page atomically", async () => {
    const page0Old = deferred();
    const page0New = deferred();
    const page1Old = canvas(210, 310);
    const page1New = canvas(220, 320);
    const renderPage = vi.fn(({ side, pageIndex, snapshot }) => {
      if (pageIndex === 0) return side === "old" ? page0Old.promise : page0New.promise;
      return Promise.resolve(side === "old" ? page1Old : page1New);
    });
    const { state, dom, renderer, controller } = makeHarness({ renderPage });
    state.textReview.highlights = { old: new Map(), new: new Map() };
    state.documents.oldDoc = doc(2);
    state.documents.newDoc = doc(2);

    const first = controller.showPage(0);
    const second = controller.showPage(1);
    await second;
    const page1Calls = renderPage.mock.calls.filter(([arg]) => arg.pageIndex === 1);
    expect(page1Calls[0][0].snapshot.ticket).toBe(page1Calls[1][0].snapshot.ticket);
    expect(dom.oldTextCanvas.width).toBe(210);
    expect(dom.newTextCanvas.width).toBe(220);
    expect(dom.textPageInd.textContent).toBe("2 / 2");
    expect(renderer.applyView).toHaveBeenCalledTimes(1);

    page0Old.resolve(canvas(90, 90));
    page0New.resolve(canvas(91, 91));
    await first;
    expect(dom.oldTextCanvas.width).toBe(210);
    expect(dom.newTextCanvas.width).toBe(220);
    expect(dom.textPageInd.textContent).toBe("2 / 2");
    expect(renderer.applyView).toHaveBeenCalledTimes(1);
  });

  test("reports current render rejection but suppresses stale rejection", async () => {
    const renderPage = vi.fn().mockRejectedValue(new Error("current render"));
    const { state, dom, errorReporter, controller } = makeHarness({ renderPage });
    state.textReview.highlights = { old: new Map(), new: new Map() };

    await controller.showPage(0);
    expect(errorReporter.report).toHaveBeenCalledTimes(1);
    expect(dom.textStatus.classList.contains("busy")).toBe(false);

    errorReporter.report.mockClear();
    const rejection = deferred();
    renderPage.mockReset();
    renderPage.mockImplementation(() => rejection.promise);
    const stale = controller.showPage(0);
    controller.cancelRender();
    dom.textStatus.textContent = "mode changed";
    rejection.reject(new Error("stale render"));
    await stale;
    expect(errorReporter.report).not.toHaveBeenCalled();
    expect(dom.textStatus.textContent).toBe("mode changed");
  });

  test("current placeholder commits as 10x10 white while stale placeholder cannot commit", async () => {
    const placeholder = canvas(10, 10);
    const renderPage = vi.fn().mockResolvedValue(placeholder);
    const { state, dom, controller } = makeHarness({ renderPage });
    state.textReview.highlights = { old: new Map(), new: new Map() };
    state.documents.newDoc = null;

    await controller.showPage(0);

    expect(dom.newTextCanvas.width).toBe(10);
    expect(dom.newTextCanvas.context.drawImage).toHaveBeenCalledWith(placeholder, 0, 0);

    dom.newTextCanvas.width = 77;
    const late = deferred();
    renderPage.mockImplementation(() => late.promise);
    const stale = controller.showPage(0);
    controller.cancelRender();
    late.resolve(placeholder);
    await stale;
    expect(dom.newTextCanvas.width).toBe(77);
  });

  test("a mode change during the initial page render preserves the committed page", async () => {
    const pending = deferred();
    const { state, controller } = makeHarness({ renderPage: vi.fn(() => pending.promise) });
    state.documents.oldDoc = doc(2);
    state.documents.newDoc = doc(2);
    state.textReview.page = 1;
    state.textReview.extraction = { old: [lines("old")], new: [lines("new")] };
    state.textReview.highlights = { old: new Map(), new: new Map() };

    const running = controller.run();
    expect(state.textReview.page).toBe(1);
    await controller.setTopMode("visual");
    pending.resolve(canvas(50, 60));
    await running;

    expect(state.textReview.page).toBe(1);
  });
});

describe("text top mode and invalidation", () => {
  test("entering text restores cached highlights and returning visual cancels text commit", async () => {
    const pending = deferred();
    const renderPage = vi.fn(() => pending.promise);
    const { state, dom, renderer, controller } = makeHarness({ renderPage });
    state.ui.topMode = "visual";
    state.boxEditor.editMode = true;
    state.textReview.highlights = { old: new Map(), new: new Map() };

    const entering = controller.setTopMode("text");
    expect(dom.cancelBoxEdit).toHaveBeenCalled();
    expect(state.ui.topMode).toBe("text");
    const leaving = controller.setTopMode("visual");
    pending.resolve(canvas(40, 50));
    await entering;
    await leaving;

    expect(dom.restoreVisual).toHaveBeenCalled();
    expect(dom.oldTextCanvas.width).toBe(10);
    expect(renderer.applyView).not.toHaveBeenCalled();
  });

  test("document generation change prevents cached text render from restoring", async () => {
    const pending = deferred();
    const { state, dom, controller } = makeHarness({ renderPage: vi.fn(() => pending.promise) });
    state.textReview.highlights = { old: new Map(), new: new Map() };
    const show = controller.showPage(0);
    state.documents.generation += 1;
    state.textReview.renderGeneration += 1;
    dom.textPageInd.textContent = "invalidated";
    pending.resolve(canvas(99, 99));
    await show;
    expect(dom.oldTextCanvas.width).toBe(10);
    expect(dom.textPageInd.textContent).toBe("invalidated");
  });
});

describe("extractPageTokens", () => {
  test("is DOM-free, preserves fallbacks, and emits debug data through callback", async () => {
    const onDebug = vi.fn();
    const items = [
      { str: "A", width: 10, transform: [1, 0, 0, 10, 0, 100], hasEOL: true },
      { str: "B", width: 10, transform: [1, 0, 0, 10, 80, 100], hasEOL: true },
      { str: "C", width: 10, transform: [1, 0, 0, 10, 0, 80], hasEOL: true },
      { str: "D", width: 10, transform: [1, 0, 0, 10, 80, 80], hasEOL: true },
      { str: "E", width: 10, transform: [1, 0, 0, 10, 0, 60], hasEOL: true },
      { str: "F", width: 10, transform: [1, 0, 0, 10, 80, 60], hasEOL: true },
    ];
    const page = { rotate: 0, getTextContent: vi.fn().mockResolvedValue({ items }) };
    const document = { getPage: vi.fn().mockResolvedValue(page) };

    const result = await extractPageTokens({
      doc: document,
      pageIndex: 0,
      debugXYCut: true,
      onDebug,
    });

    expect(result.map(line => line.text)).toEqual(["A", "C", "E", "B", "D", "F"]);
    expect(onDebug).toHaveBeenCalledWith({
      pageIndex: 0,
      leafSizes: [3, 3],
      hadVerticalCut: true,
    });

    page.rotate = 90;
    onDebug.mockClear();
    expect((await extractPageTokens({ doc: document, pageIndex: 0 })).map(line => line.text))
      .toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(onDebug).not.toHaveBeenCalled();
  });
});
