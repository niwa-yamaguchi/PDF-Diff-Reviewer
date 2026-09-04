import { expect, test, vi } from "vitest";
import { createApp } from "../../src/app/create-app.js";
import { createTextController } from "../../src/features/text-review/text-controller.js";

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

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
  const classes = new Set();
  return {
    id,
    value: "0",
    dataset: {},
    style: {},
    classList: {
      add: value => classes.add(value),
      remove: value => classes.delete(value),
      toggle(value, force) {
        if (force === undefined ? !classes.has(value) : force) classes.add(value);
        else classes.delete(value);
      },
      contains: value => classes.has(value),
    },
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null;
    },
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
  const document = fakeDocument();
  const window = {
    confirm: vi.fn(() => true),
    console: { error: vi.fn(), log: vi.fn() },
    getComputedStyle: () => ({ getPropertyValue: () => "#000" }),
  };
  const app = createApp({ document, window, dependencies });
  app.state.documents.pages = 2;
  app.state.visual.rendered = true;

  await controls.appController.setSplitMode();

  expect(app.state.visual.mode).toBe("split");
  expect(document.getElementById("modeSplit").classList.contains("active")).toBe(true);
  expect(document.getElementById("modeSplit").getAttribute("aria-pressed")).toBe("true");
  expect(document.getElementById("modeDiff").getAttribute("aria-pressed")).toBe("false");
  expect(document.getElementById("modeToggle").getAttribute("aria-pressed")).toBe("false");
  expect(boxEditorController.setEditMode).toHaveBeenCalledWith(false);
  expect(viewerController.cancelPan).toHaveBeenCalledOnce();
  expect(splitViewerController.fit).toHaveBeenCalledOnce();

  await controls.appController.nextVisualPage();
  expect(splitViewerController.apply).toHaveBeenCalledOnce();
  expect(splitViewerController.fit).toHaveBeenCalledOnce();

  await controls.appController.setDiffMode();
  expect(app.state.visual.mode).toBe("diff");
  expect(document.getElementById("modeDiff").classList.contains("active")).toBe(true);
  expect(document.getElementById("modeDiff").getAttribute("aria-pressed")).toBe("true");
  expect(document.getElementById("modeSplit").getAttribute("aria-pressed")).toBe("false");
  expect(splitViewerController.cancelPan).toHaveBeenCalledOnce();
  expect(visualController.showPage).toHaveBeenLastCalledWith(0);

  await controls.appController.setSplitMode();
  expect(splitViewerController.fit).toHaveBeenCalledOnce();
  expect(splitViewerController.apply).toHaveBeenCalledTimes(2);

  await controls.appController.runVisual();
  expect(splitViewerController.fit).toHaveBeenCalledTimes(2);
});

test("rolls failed diff toggle and split transitions back to the last committed mode and surface", async () => {
  let controls;
  const visualController = { showPage: vi.fn().mockResolvedValue({ committed: false }) };
  const viewerController = { cancelPan: vi.fn(), handleResize: vi.fn() };
  const splitViewerController = {
    cancelPan: vi.fn(), fit: vi.fn(), apply: vi.fn(), handleResize: vi.fn(),
  };
  const dependencies = fakeDependencies({
    bindControls: vi.fn(args => { controls = args; }),
    createViewerController: vi.fn(() => viewerController),
    createSplitViewerController: vi.fn(() => splitViewerController),
    createVisualController: vi.fn(() => visualController),
  });
  const document = fakeDocument();
  const window = {
    confirm: vi.fn(() => true),
    console: { error: vi.fn(), log: vi.fn() },
    getComputedStyle: () => ({ getPropertyValue: () => "#000" }),
  };
  const app = createApp({ document, window, dependencies });
  app.state.documents.pages = 1;
  app.state.visual.rendered = true;
  const out = document.getElementById("out");
  const panel = document.getElementById("visualSplitPanel");
  const canvasWrap = document.querySelector(".canvas-wrap");
  out.style.display = "block";
  panel.style.display = "none";
  canvasWrap.style.display = "";
  document.getElementById("status").innerHTML = "prior status";

  await controls.appController.setToggleMode();
  expect(app.state.visual.mode).toBe("diff");
  expect(document.getElementById("modeDiff").classList.contains("active")).toBe(true);
  expect(out.style.display).toBe("block");
  expect(panel.style.display).toBe("none");
  expect(canvasWrap.style.display).toBe("");
  expect(document.getElementById("status").innerHTML).toBe("prior status");

  await controls.appController.setSplitMode();
  expect(app.state.visual.mode).toBe("diff");
  expect(out.style.display).toBe("block");
  expect(panel.style.display).toBe("none");
  expect(canvasWrap.style.display).toBe("");

  visualController.showPage.mockResolvedValueOnce({ committed: true });
  await controls.appController.setToggleMode();
  expect(app.state.visual.mode).toBe("toggle");
  visualController.showPage.mockResolvedValueOnce({ committed: false });
  await controls.appController.setDiffMode();
  expect(app.state.visual.mode).toBe("toggle");

  const staleResult = deferred();
  visualController.showPage
    .mockImplementationOnce(() => staleResult.promise)
    .mockResolvedValueOnce({ committed: true });
  const staleSplit = controls.appController.setSplitMode();
  expect(app.state.visual.mode).toBe("split");
  await controls.appController.setDiffMode();
  expect(app.state.visual.mode).toBe("diff");
  staleResult.resolve({ committed: false });
  await staleSplit;
  expect(app.state.visual.mode).toBe("diff");
});

test.each([
  { target: "split", prior: "diff" },
  { target: "diff", prior: "split" },
])(
  "a pending set$target mode rollback preserves text mode and the prior $prior visual state",
  async ({ target, prior }) => {
    let controls;
    const pending = deferred();
    const visualController = {
      showPage: vi.fn().mockResolvedValue({ committed: true }),
    };
    const viewerController = { cancelPan: vi.fn(), handleResize: vi.fn() };
    const splitViewerController = {
      cancelPan: vi.fn(), fit: vi.fn(), apply: vi.fn(), handleResize: vi.fn(),
    };
    const dependencies = fakeDependencies({
      bindControls: vi.fn(args => { controls = args; }),
      createViewerController: vi.fn(() => viewerController),
      createSplitViewerController: vi.fn(() => splitViewerController),
      createTextController: vi.fn(createTextController),
      createVisualController: vi.fn(() => visualController),
    });
    const document = fakeDocument();
    const window = {
      confirm: vi.fn(() => true),
      console: { error: vi.fn(), log: vi.fn() },
      getComputedStyle: () => ({ getPropertyValue: () => "#000" }),
    };
    const app = createApp({ document, window, dependencies });
    app.state.documents.pages = 1;
    app.state.visual.rendered = true;
    if (prior === "split") await controls.appController.setSplitMode();

    visualController.showPage.mockImplementationOnce(() => pending.promise);
    const transition = target === "split"
      ? controls.appController.setSplitMode()
      : controls.appController.setDiffMode();
    await app.textController.setTopMode("text");
    pending.resolve({ committed: false });

    expect(await transition).toEqual({ committed: false });
    expect(app.state.ui.topMode).toBe("text");
    expect(document.getElementById("textPanel").style.display).toBe("flex");
    expect(document.querySelector(".canvas-wrap").style.display).toBe("none");
    expect(document.getElementById("out").style.display).toBe("none");
    expect(document.getElementById("visualSplitPanel").style.display).toBe("none");
    expect(app.state.visual.mode).toBe(prior);
    expect(document.getElementById(`mode${prior === "split" ? "Split" : "Diff"}`)
      .classList.contains("active")).toBe(true);
  },
);

test("the E key still uses the controller gate and cannot enter editing in split mode", () => {
  let controls;
  const setEditMode = vi.fn(() => false);
  const dependencies = fakeDependencies({
    bindControls: vi.fn(args => { controls = args; }),
    createBoxEditorController: vi.fn(() => ({
      confirmDiscard: () => true, syncInvalidated() {}, cancelDrag() {},
      setEditMode, draw() {},
    })),
  });
  const window = {
    confirm: vi.fn(() => true),
    console: { error: vi.fn(), log: vi.fn() },
    getComputedStyle: () => ({ getPropertyValue: () => "#000" }),
  };
  const app = createApp({ document: fakeDocument(), window, dependencies });
  app.state.visual.rendered = true;
  app.state.visual.mode = "split";
  app.state.boxEditor.editMode = false;
  const event = {
    key: "E", target: { tagName: "DIV" }, preventDefault: vi.fn(),
  };

  controls.appController.handleKeyDown(event);

  expect(setEditMode).toHaveBeenCalledWith(true);
  expect(app.state.boxEditor.editMode).toBe(false);
  expect(event.preventDefault).toHaveBeenCalledOnce();
});

test("text-to-visual restoration exposes only the surface for the committed visual mode", () => {
  let textDom;
  const dependencies = fakeDependencies({
    bindControls: vi.fn(),
    createTextController: vi.fn(({ dom }) => {
      textDom = dom;
      return Object.freeze({ name: "text" });
    }),
  });
  const document = fakeDocument();
  const window = {
    confirm: vi.fn(() => true),
    console: { error: vi.fn(), log: vi.fn() },
    getComputedStyle: () => ({ getPropertyValue: () => "#000" }),
  };
  const app = createApp({ document, window, dependencies });
  app.state.visual.rendered = true;
  app.state.visual.mode = "split";

  textDom.restoreVisualSurface();
  expect(document.querySelector(".canvas-wrap").style.display).toBe("none");
  expect(document.getElementById("out").style.display).toBe("none");
  expect(document.getElementById("visualSplitPanel").style.display).toBe("flex");

  app.state.visual.mode = "diff";
  textDom.restoreVisualSurface();
  expect(document.querySelector(".canvas-wrap").style.display).toBe("");
  expect(document.getElementById("out").style.display).toBe("block");
  expect(document.getElementById("visualSplitPanel").style.display).toBe("none");
});
