import { expect, test, vi } from "vitest";
import { createApp } from "../../src/app/create-app.js";
import { applyInvalidatingChange } from "../../src/app/invalidation.js";
import { createBoxEditorController } from "../../src/features/box-editor/box-editor-controller.js";

const ids = [
  "alignAddNew", "alignDelOld", "alignReadout", "alignUndo", "autoAlign",
  "boxDel", "boxEdit", "boxLayer", "boxReset", "boxToggle", "dlPdf", "dlPng",
  "dlTextPdf", "dlTextPng", "dpi", "dpiVal", "dropNew", "dropOld", "fileNew",
  "fileOld", "modeDiff", "modeToggle", "newTextCanvas", "next", "nudgeReset",
  "oldTextCanvas", "out", "pageLabel", "ph", "prev", "quadReset", "rotReset",
  "run", "runText", "scaleReset", "sideNew", "sideOld", "statAd", "statBox",
  "statRm", "status", "textCtrl", "textNext", "textPageInd", "textPanel",
  "textPrev", "textStatus", "textZoom1", "textZoomFit", "textZoomIn", "textZoomOut",
  "th", "thVal", "toggleFlip", "toggleInd", "tolerance", "toleranceVal",
  "topText", "topVisual", "viewbar", "visualCtrl", "zoom1", "zoomFit", "zoomIn",
  "zoomLabel", "zoomOut",
];

function element(id) {
  const listeners = new Map();
  return {
    id,
    value: "0",
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    listeners,
    addEventListener(type, handler, options) {
      const values = listeners.get(type) || [];
      values.push({ handler, options });
      listeners.set(type, values);
    },
    removeEventListener(type, handler, options) {
      const values = listeners.get(type) || [];
      listeners.set(type, values.filter(value => (
        value.handler !== handler || value.options !== options
      )));
    },
    emit(type, event = {}) {
      for (const { handler } of listeners.get(type) || []) handler(event);
    },
  };
}

function fakeDocument() {
  const elements = new Map(ids.map(id => [id, element(id)]));
  const canvasWrap = element("canvasWrap");
  const oldTextWrap = element("oldTextWrap");
  const newTextWrap = element("newTextWrap");
  const document = Object.assign(element("document"), {
    getElementById: id => elements.get(id) || null,
    querySelector(selector) {
      return new Map([
        [".canvas-wrap", canvasWrap],
        [".text-pane.old .text-canvas-wrap", oldTextWrap],
        [".text-pane.new .text-canvas-wrap", newTextWrap],
      ]).get(selector) || null;
    },
    querySelectorAll: selector => [{ ...element(selector), dataset: {} }],
  });
  document.eventTargets = [document, canvasWrap, oldTextWrap, newTextWrap, ...elements.values()];
  return document;
}

function fakeDependencies(overrides = {}) {
  const controller = name => Object.freeze({ name });
  return {
    createTextRenderer: vi.fn(() => controller("textRenderer")),
    createViewerController: vi.fn(({ onTransform }) => {
      expect(() => onTransform()).not.toThrow();
      return controller("viewer");
    }),
    createBoxEditorView: vi.fn(() => ({ ...controller("boxView"), redraw() {}, refresh() {}, updateControls() {} })),
    createBoxEditorController: vi.fn(() => ({
      ...controller("boxEditor"), confirmDiscard: () => true, syncInvalidated() {},
      cancelDrag() {}, setEditMode() {}, draw() {},
    })),
    createVisualController: vi.fn(({ drawBoxes }) => {
      expect(() => drawBoxes()).not.toThrow();
      return controller("visual");
    }),
    createTextController: vi.fn(() => controller("text")),
    createExportController: vi.fn(() => ({ ...controller("export"), invalidateDocuments() {} })),
    createPdfExporter: vi.fn(() => controller("pdfExporter")),
    createDocumentController: vi.fn(({ onReady, onLoadAccepted, confirmDiscard }) => {
      expect(() => onReady()).not.toThrow();
      expect(() => onLoadAccepted({ documentGeneration: 1 })).not.toThrow();
      expect(confirmDiscard()).toBe(true);
      return controller("documents");
    }),
    createCanvas: vi.fn(), createWhiteCanvas: vi.fn(), downloadBlob: vi.fn(),
    pdfjsLib: { Util: { transform: vi.fn() } }, jsPDF: vi.fn(),
    renderDiffPage: vi.fn(), renderTogglePage: vi.fn(), extractPageTokens: vi.fn(),
    framePlan: vi.fn(), pageLabelText: vi.fn(), sequenceIndex: vi.fn(),
    canvasToRgba: vi.fn(), alignProbeScale: vi.fn(), downscaleCanvas: vi.fn(),
    pageSizePt: vi.fn(), renderPageCanvas: vi.fn(), rotateCanvas90: vi.fn(),
    invalidateDocuments: vi.fn(), invalidateDpi: vi.fn(), invalidateManualAlignment: vi.fn(),
    invalidatePageAlignment: vi.fn(), invalidateThreshold: vi.fn(), invalidateTolerance: vi.fn(),
    applyInvalidatingChange: vi.fn(() => true),
    ...overrides,
  };
}

test("createApp is the sole composition root and binds once after safe construction", () => {
  const calls = [];
  const bindControls = vi.fn(() => calls.push("bind"));
  const dependencies = fakeDependencies({ bindControls });
  const window = {
    confirm: vi.fn(() => true),
    console: { error: vi.fn() },
    getComputedStyle: () => ({ getPropertyValue: () => "#000" }),
  };

  const app = createApp({ document: fakeDocument(), window, dependencies });

  expect(Object.isFrozen(app)).toBe(true);
  expect(app.documentController.name).toBe("documents");
  expect(app.visualController.name).toBe("visual");
  expect(app.textController.name).toBe("text");
  expect(app.exportController.name).toBe("export");
  expect(bindControls).toHaveBeenCalledTimes(1);
  expect(calls).toEqual(["bind"]);
});

test("createApp connects manual-box allocation and edits to the real review controller", () => {
  const dependencies = fakeDependencies({
    bindControls: vi.fn(),
  });
  const window = {
    confirm: vi.fn(() => true),
    console: { error: vi.fn() },
    getComputedStyle: () => ({ getPropertyValue: () => "#000" }),
  };

  const document = fakeDocument();
  Object.assign(document.getElementById("out"), { width: 100, height: 200 });
  const app = createApp({ document, window, dependencies });
  app.reviewController.commitPage({ pageIndex: 0, boxes: [], width: 100, height: 200 });
  const { makeManualBox, onBoxesChanged } = dependencies.createBoxEditorController.mock.calls[0][0];
  const box = makeManualBox({ pageIndex: 0, box: { x: 10, y: 10, w: 20, h: 20 } });
  onBoxesChanged({ pageIndex: 0, boxes: [box], reason: "create" });
  expect(app.state.review.itemsByPage.get(0)[0]).toMatchObject({
    id: "change-1", kind: "changed", source: "manual", normalizedRect: { x: 0.1, y: 0.05 },
  });
});

test("discarding edits across different-sized pages preserves each page's normalized rectangles", () => {
  const dependencies = fakeDependencies({ bindControls: vi.fn(), createBoxEditorController });
  const window = { confirm: () => true, console: { error() {} }, getComputedStyle: () => ({ getPropertyValue: () => "#000" }) };
  const document = fakeDocument();
  Object.assign(document.getElementById("out"), { width: 1000, height: 500 });
  const app = createApp({ document, window, dependencies });
  const first = app.reviewController.commitPage({ pageIndex: 0, width: 1000, height: 500,
    boxes: [{ x: 100, y: 100, w: 200, h: 100, kind: "added" }] }).currentBoxes;
  const second = app.reviewController.commitPage({ pageIndex: 1, width: 2000, height: 1000,
    boxes: [{ x: 100, y: 100, w: 200, h: 100, kind: "added" }] }).currentBoxes;
  app.state.boxEditor.editsByPage.set(0, first.map(box => ({ ...box, x: 300 })));
  app.state.boxEditor.editsByPage.set(1, second.map(box => ({ ...box, x: 300 })));
  app.boxEditorController.clearEdits();
  expect(app.state.review.itemsByPage.get(0)[0].normalizedRect).toEqual({ x: 0.1, y: 0.2, w: 0.2, h: 0.2 });
  expect(app.state.review.itemsByPage.get(1)[0].normalizedRect).toEqual({ x: 0.05, y: 0.1, w: 0.1, h: 0.1 });
  expect(app.state.boxEditor.editsByPage.size).toBe(0);
});

test("editing without recorded page dimensions cannot borrow the visible canvas size", () => {
  const dependencies = fakeDependencies({ bindControls: vi.fn() });
  const window = { confirm: () => true, console: { error() {} }, getComputedStyle: () => ({ getPropertyValue: () => "#000" }) };
  const document = fakeDocument();
  Object.assign(document.getElementById("out"), { width: 100, height: 200 });
  const app = createApp({ document, window, dependencies });
  const { onBoxesChanged } = dependencies.createBoxEditorController.mock.calls[0][0];
  expect(() => onBoxesChanged({ pageIndex: 1, boxes: [], reason: "discard" })).toThrow("変更枠寸法がありません");
  expect(app.state.review.itemsByPage.has(1)).toBe(false);
});

test("index jobs use a third lane and accepted invalidation stops that lane", async () => {
  const lanes = [];
  const dependencies = fakeDependencies({
    bindControls: vi.fn(),
    applyInvalidatingChange,
    createWorkerLane: () => {
      const lane = { session: () => async () => lane, cancel: vi.fn() };
      lanes.push(lane);
      return lane;
    },
    renderDiffPage: async (snapshot, deps) => deps.computeDiff({}),
    renderChangeIndexPage: async (snapshot, deps) => {
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(await deps.computeDiff({})).toBe(lanes[2]);
      return { boxes: [], width: 100, height: 100 };
    },
  });
  const window = { confirm: () => true, console: { error() {} }, getComputedStyle: () => ({ getPropertyValue: () => "#000" }) };
  const app = createApp({ document: fakeDocument(), window, dependencies });
  app.state.documents.pages = 1;
  await app.reviewController.startIndex();
  expect(app.state.review.itemsByPage.get(0)).toEqual([]);
  const interactive = dependencies.createVisualController.mock.calls[0][0];
  expect(await interactive.renderDiffPage({})).toBe(lanes[0]);
  const exporter = dependencies.createExportController.mock.calls[0][0];
  expect(await exporter.createVisualRenderSession().render({ renderSnapshot: { mode: "diff" } })).toBe(lanes[1]);
  const before = lanes[2].cancel.mock.calls.length;
  const controls = dependencies.bindControls.mock.calls[0][0];
  controls.appController.commitThreshold();
  expect(lanes[2].cancel.mock.calls.length).toBeGreaterThan(before);
  expect(app.state.review.indexRunning).toBe(false);
});

test("export render session uses the toggle renderer when the snapshot mode is toggle", async () => {
  const dependencies = fakeDependencies({ bindControls: vi.fn() });
  const window = {
    confirm: vi.fn(() => true),
    console: { error: vi.fn() },
    getComputedStyle: () => ({ getPropertyValue: () => "#000" }),
  };
  createApp({ document: fakeDocument(), window, dependencies });
  const { createVisualRenderSession } = dependencies.createExportController.mock.calls[0][0];
  const session = createVisualRenderSession();
  dependencies.renderTogglePage.mockResolvedValue({ canvas: { id: "toggle" } });
  dependencies.renderDiffPage.mockResolvedValue({ canvas: { id: "diff" } });

  await session.render({ renderSnapshot: { mode: "toggle" } });
  expect(dependencies.renderTogglePage).toHaveBeenCalledTimes(1);
  expect(dependencies.renderDiffPage).not.toHaveBeenCalled();

  await session.render({ renderSnapshot: { mode: "diff" } });
  expect(dependencies.renderDiffPage).toHaveBeenCalledTimes(1);
});

test("runVisual starts the remaining-page index only after a committed page is fitted", async () => {
  const order = [];
  const dependencies = fakeDependencies({
    bindControls: vi.fn(),
    createViewerController: () => ({ fit: () => order.push("fit") }),
    createVisualController: () => ({ showPage: async () => {
      order.push("show");
      return { committed: true };
    } }),
    renderChangeIndexPage: async snapshot => {
      order.push(`index-${snapshot.pageIndex}`);
      return { boxes: [], width: 100, height: 100 };
    },
  });
  const window = { confirm: () => true, console: { error() {} }, getComputedStyle: () => ({ getPropertyValue: () => "#000" }) };
  const app = createApp({ document: fakeDocument(), window, dependencies });
  app.state.documents.pages = 3;
  const { appController } = dependencies.bindControls.mock.calls[0][0];
  await appController.runVisual();
  await vi.waitFor(() => expect(app.state.review.indexRunning).toBe(false));
  expect(order).toEqual(["show", "fit", "index-1", "index-2"]);
  app.state.visual.mode = "toggle";
  app.state.boxEditor.showBoxes = false;
  order.length = 0;
  await appController.runVisual();
  await vi.waitFor(() => expect(app.state.review.indexRunning).toBe(false));
  expect(order).toEqual(["show", "fit", "index-0", "index-1", "index-2"]);
  app.visualController.showPage = async () => ({ committed: false });
  order.length = 0;
  await appController.runVisual();
  expect(order).toEqual([]);
});

test("document acceptance cancels an in-flight index before PDF replacement finishes", async () => {
  let resolve;
  const dependencies = fakeDependencies({
    bindControls: vi.fn(),
    renderChangeIndexPage: () => new Promise(done => { resolve = done; }),
  });
  const window = { confirm: () => true, console: { error() {} }, getComputedStyle: () => ({ getPropertyValue: () => "#000" }) };
  const app = createApp({ document: fakeDocument(), window, dependencies });
  app.state.documents.pages = 1;
  const indexing = app.reviewController.startIndex();
  dependencies.createDocumentController.mock.calls[0][0].onLoadAccepted({ documentGeneration: 3 });
  resolve({ boxes: [], width: 100, height: 100 });
  await indexing;
  expect(app.state.review.itemsByPage.size).toBe(0);
  expect(app.state.review.indexRunning).toBe(false);
});

test("repeated createApp replaces the previous document event owners", () => {
  const document = fakeDocument();
  const window = Object.assign(element("window"), {
    confirm: vi.fn(() => true),
    console: { error: vi.fn(), log: vi.fn() },
    getComputedStyle: () => ({ getPropertyValue: () => "#000" }),
  });
  const previousViewer = { handleResize: vi.fn() };
  const latestViewer = { handleResize: vi.fn() };
  const previousTextRenderer = { handleResize: vi.fn() };
  const latestTextRenderer = { handleResize: vi.fn() };
  const viewers = [previousViewer, latestViewer];
  const textRenderers = [previousTextRenderer, latestTextRenderer];
  const dependencies = fakeDependencies({
    createViewerController: vi.fn(() => viewers.shift()),
    createTextRenderer: vi.fn(() => textRenderers.shift()),
  });

  createApp({ document, window, dependencies });
  createApp({ document, window, dependencies });
  window.emit("resize");

  expect(previousViewer.handleResize).not.toHaveBeenCalled();
  expect(previousTextRenderer.handleResize).not.toHaveBeenCalled();
  expect(latestViewer.handleResize).toHaveBeenCalledTimes(1);
  expect(latestTextRenderer.handleResize).toHaveBeenCalledTimes(1);
  for (const eventTarget of [window, ...document.eventTargets]) {
    for (const registrations of eventTarget.listeners.values()) {
      expect(registrations).toHaveLength(1);
    }
  }
});
