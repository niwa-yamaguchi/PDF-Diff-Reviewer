import { expect, test, vi } from "vitest";
import { createApp } from "../../src/app/create-app.js";

const ids = [
  "alignAddNew", "alignDelOld", "alignReadout", "alignUndo", "autoAlign",
  "boxDel", "boxEdit", "boxLayer", "boxReset", "boxToggle", "dlPdf", "dlPng",
  "dlTextPdf", "dlTextPng", "dpi", "dpiVal", "dropNew", "dropOld", "fileNew",
  "fileOld", "modeDiff", "modeSplit", "modeToggle", "newTextCanvas", "next", "nudgeReset",
  "oldTextCanvas", "out", "pageLabel", "ph", "prev", "quadReset", "rotReset",
  "run", "runText", "scaleReset", "sideNew", "sideOld", "statAd", "statBox",
  "statRm", "status", "textCtrl", "textNext", "textPageInd", "textPanel",
  "textPrev", "textStatus", "textZoom1", "textZoomFit", "textZoomIn", "textZoomOut",
  "th", "thVal", "toggleFlip", "toggleInd", "tolerance", "toleranceVal",
  "topText", "topVisual", "viewbar", "visualCtrl", "zoom1", "zoomFit", "zoomIn",
  "zoomLabel", "zoomOut", "visualSplitPanel", "splitOldCanvas", "splitNewCanvas",
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
  const splitOldWrap = element("splitOldWrap");
  const splitNewWrap = element("splitNewWrap");
  const oldTextWrap = element("oldTextWrap");
  const newTextWrap = element("newTextWrap");
  const document = Object.assign(element("document"), {
    getElementById: id => elements.get(id) || null,
    querySelector(selector) {
      return new Map([
        [".canvas-wrap", canvasWrap],
        [".visual-split-pane.old .visual-split-canvas-wrap", splitOldWrap],
        [".visual-split-pane.new .visual-split-canvas-wrap", splitNewWrap],
        [".text-pane.old .text-canvas-wrap", oldTextWrap],
        [".text-pane.new .text-canvas-wrap", newTextWrap],
      ]).get(selector) || null;
    },
    querySelectorAll: selector => [{ ...element(selector), dataset: {} }],
  });
  document.eventTargets = [
    document, canvasWrap, splitOldWrap, splitNewWrap, oldTextWrap, newTextWrap,
    ...elements.values(),
  ];
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
    createSplitViewerController: vi.fn(() => ({
      ...controller("splitViewer"),
      handleResize: vi.fn(),
    })),
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
    renderDiffPage: vi.fn(), renderTogglePage: vi.fn(), renderSplitPage: vi.fn(),
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
  expect(dependencies.createSplitViewerController).toHaveBeenCalledWith(expect.objectContaining({
    state: app.state,
    dom: expect.objectContaining({
      oldCanvas: expect.objectContaining({ id: "splitOldCanvas" }),
      newCanvas: expect.objectContaining({ id: "splitNewCanvas" }),
      oldWrap: expect.objectContaining({ id: "splitOldWrap" }),
      newWrap: expect.objectContaining({ id: "splitNewWrap" }),
    }),
  }));
  expect(dependencies.createVisualController).toHaveBeenCalledWith(expect.objectContaining({
    renderSplitPage: expect.any(Function),
  }));
  expect(bindControls).toHaveBeenCalledWith(expect.objectContaining({
    state: app.state,
    splitViewerController: expect.objectContaining({ name: "splitViewer" }),
  }));
  expect(bindControls).toHaveBeenCalledTimes(1);
  expect(calls).toEqual(["bind"]);
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

test("enters split with fit, preserves its view on paging, and can return to diff", async () => {
  let controls;
  const viewerController = {
    cancelPan: vi.fn(), fit: vi.fn(), handleResize: vi.fn(),
  };
  const splitViewerController = {
    cancelPan: vi.fn(), fit: vi.fn(), apply: vi.fn(), handleResize: vi.fn(),
  };
  const visualController = {
    showPage: vi.fn().mockResolvedValue({ committed: true }),
  };
  const boxEditorController = {
    confirmDiscard: () => true, syncInvalidated() {}, cancelDrag() {},
    setEditMode: vi.fn(), draw() {},
  };
  const dependencies = fakeDependencies({
    bindControls: vi.fn(args => { controls = args; }),
    createViewerController: vi.fn(() => viewerController),
    createSplitViewerController: vi.fn(() => splitViewerController),
    createVisualController: vi.fn(() => visualController),
    createBoxEditorController: vi.fn(() => boxEditorController),
  });
  const window = {
    confirm: vi.fn(() => true),
    console: { error: vi.fn(), log: vi.fn() },
    getComputedStyle: () => ({ getPropertyValue: () => "#000" }),
  };
  const app = createApp({ document: fakeDocument(), window, dependencies });
  app.state.documents.pages = 2;
  app.state.visual.rendered = true;

  await controls.appController.setSplitMode();

  expect(app.state.visual.mode).toBe("split");
  expect(boxEditorController.setEditMode).toHaveBeenCalledWith(false);
  expect(viewerController.cancelPan).toHaveBeenCalledOnce();
  expect(splitViewerController.fit).toHaveBeenCalledOnce();

  await controls.appController.nextVisualPage();
  expect(splitViewerController.apply).toHaveBeenCalledOnce();
  expect(splitViewerController.fit).toHaveBeenCalledOnce();

  await controls.appController.setDiffMode();
  expect(app.state.visual.mode).toBe("diff");
  expect(splitViewerController.cancelPan).toHaveBeenCalledOnce();
  expect(visualController.showPage).toHaveBeenLastCalledWith(0);
});
