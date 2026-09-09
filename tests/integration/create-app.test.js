import { expect, test, vi } from "vitest";
import { createApp } from "../../src/app/create-app.js";
import { applyInvalidatingChange, invalidateDocuments, invalidateThreshold } from "../../src/app/invalidation.js";
import { createBoxEditorController } from "../../src/features/box-editor/box-editor-controller.js";
import { createVisualController } from "../../src/features/visual-diff/visual-controller.js";
import { createViewerController } from "../../src/features/viewer/viewer-controller.js";
import { createDocumentController } from "../../src/features/documents/document-controller.js";
import { reviewDom } from "../helpers/review-dom.js";
import { bindControls } from "../../src/app/bind-controls.js";

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
  const review = reviewDom();
  for (const [id, node] of Object.entries(review.dom)) elements.set(id, node);
  const canvasWrap = element("canvasWrap");
  const oldTextWrap = element("oldTextWrap");
  const newTextWrap = element("newTextWrap");
  const document = Object.assign(element("document"), {
    body: review.document.body,
    createElement: review.document.createElement,
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

// Break: omitting the view/controller bridge or using the interactive lane loses lazy background crops.
test("an opened review group renders its 72 DPI thumbnails using the index Worker lane", async () => {
  const lanes = [];
  const dependencies = fakeDependencies({ bindControls: vi.fn(),
    createWorkerLane: () => {
      const run = vi.fn(async () => ({}));
      const lane = { run, session: () => run, cancel() {} };
      lanes.push(lane);
      return lane;
    },
    createCanvas: (width, height) => ({ width, height,
      getContext: () => ({ drawImage() {}, fillRect() {} }), toDataURL: () => "data:image/png;base64,crop" }),
    renderDiffPage: vi.fn(async (snapshot, dependencies) => {
      await dependencies.computeDiff({ thumbnail: true });
      return { canvas: { width: 100, height: 100 } };
    }),
  });
  const document = fakeDocument();
  const window = { confirm: () => true, console: { error() {} }, getComputedStyle: () => ({ getPropertyValue: () => "#000" }) };
  const app = createApp({ document, window, dependencies });
  app.state.documents.pages = 2;
  app.reviewController.commitPage({ pageIndex: 1, width: 100, height: 100,
    boxes: [{ x: 10, y: 10, w: 20, h: 20, kind: "added" }] });
  app.reviewController.togglePanel(true);
  expect(dependencies.renderDiffPage).not.toHaveBeenCalled();
  window.addEventListener = () => {};
  window.removeEventListener = () => {};
  bindControls(dependencies.bindControls.mock.calls[0][0]);
  const group = document.getElementById("reviewList").querySelector("details");
  group.open = true;
  document.getElementById("reviewList").emit("toggle", { target: group });
  await vi.waitFor(() => expect(app.state.review.thumbnailsByPage.get(1)?.get("change-1"))
    .toBe("data:image/png;base64,crop"));
  expect(dependencies.renderDiffPage.mock.calls[0][0].comparison.dpi).toBe(72);
  expect(lanes.map(lane => lane.run.mock.calls.length)).toEqual([0, 0, 1]);
  expect(document.getElementById("reviewList").querySelector("img").src).toBe("data:image/png;base64,crop");
});

// Break: failing to open/render the panel on successful comparison leaves indexed work inaccessible.
test("visual success opens the panel and mode switches preserve review input and open state", async () => {
  let state;
  const dependencies = fakeDependencies({ bindControls: vi.fn(),
    createVisualController: ({ state: appState }) => {
      state = appState;
      return { showPage: async () => ({ committed: true }) };
    },
    createViewerController: () => ({ fit() {} }),
    createTextController: () => ({ setTopMode(mode) { state.ui.topMode = mode; } }),
    renderChangeIndexPage: async () => ({ boxes: [], width: 100, height: 100 }),
  });
  const document = fakeDocument();
  const window = { confirm: () => true, console: { error() {} }, getComputedStyle: () => ({ getPropertyValue: () => "#000" }) };
  const app = createApp({ document, window, dependencies });
  const { appController } = dependencies.bindControls.mock.calls[0][0];
  app.reviewController.commitPage({ pageIndex: 0, width: 100, height: 100,
    boxes: [{ x: 10, y: 10, w: 20, h: 20, kind: "added" }] });
  app.reviewController.setComment("change-1", "保管する入力");
  await appController.runVisual();
  expect(app.state.review.panelOpen).toBe(true);
  expect(document.getElementById("reviewPanel").hidden).toBe(false);
  expect(document.getElementById("reviewTotal").textContent).toBe("変更箇所 1件");
  await appController.setTopMode("text");
  expect(document.getElementById("reviewPanel").hidden).toBe(true);
  expect(app.state.review.panelOpen).toBe(true);
  expect(app.state.review.entriesById.get("change-1").comment).toBe("保管する入力");
  await appController.setTopMode("visual");
  expect(document.getElementById("reviewPanel").hidden).toBe(false);
  expect(document.getElementById("reviewList").querySelector('[data-review-comment="change-1"]').value).toBe("保管する入力");
  app.reviewController.togglePanel(false);
  app.visualController.showPage = async () => ({ committed: false });
  await appController.runVisual();
  expect(app.state.review.panelOpen).toBe(false);
});

// Break: rendering before document invalidation leaves old drawing reviews in the new document UI.
test("document replacement immediately refreshes the now-empty review panel", () => {
  const dependencies = fakeDependencies({ bindControls: vi.fn(), invalidateDocuments });
  const document = fakeDocument();
  const window = { confirm: () => true, console: { error() {} }, getComputedStyle: () => ({ getPropertyValue: () => "#000" }) };
  const app = createApp({ document, window, dependencies });
  app.reviewController.commitPage({ pageIndex: 0, width: 100, height: 100,
    boxes: [{ x: 10, y: 10, w: 20, h: 20, kind: "added" }] });
  app.reviewController.togglePanel(true);
  const documents = dependencies.createDocumentController.mock.calls[0][0];
  documents.invalidateDocuments(app.state);
  documents.onReady();
  expect(document.getElementById("reviewTotal").textContent).toBe("変更箇所 0件");
  expect(document.getElementById("reviewPanel").hidden).toBe(true);
});

// Break: stale review rows survive settings invalidation until a later render happens to commit.
test("accepted comparison settings remove invalidated rows while awaiting fresh comparison", () => {
  const dependencies = fakeDependencies({ bindControls: vi.fn(), applyInvalidatingChange, invalidateThreshold });
  const document = fakeDocument();
  const window = { confirm: () => true, console: { error() {} }, getComputedStyle: () => ({ getPropertyValue: () => "#000" }) };
  const app = createApp({ document, window, dependencies });
  app.reviewController.commitPage({ pageIndex: 0, width: 100, height: 100,
    boxes: [{ x: 10, y: 10, w: 20, h: 20, kind: "added" }] });
  const { appController } = dependencies.bindControls.mock.calls[0][0];
  appController.commitThreshold();
  expect(document.getElementById("reviewTotal").textContent).toBe("変更箇所 0件");
  expect(document.getElementById("reviewList").querySelectorAll("article")).toHaveLength(0);
});

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

function editableVisualApp(renderTogglePage, overrides = {}) {
  const document = fakeDocument();
  const out = document.getElementById("out");
  out.getContext = () => ({ clearRect() {}, drawImage() {} });
  const dependencies = fakeDependencies({
    bindControls: vi.fn(), createBoxEditorController, createVisualController, renderTogglePage,
    createBoxEditorView: () => ({
      refresh() {}, redraw() {}, updateControls() {},
      getFrameSize: () => ({ width: out.width, height: out.height }),
      getScale: () => 1,
    }),
    ...overrides,
  });
  Object.assign(document.querySelector(".canvas-wrap"), { clientWidth: 200, clientHeight: 200 });
  const window = { confirm: () => true, console: { error() {} }, getComputedStyle: () => ({ getPropertyValue: () => "#000" }) };
  const app = createApp({ document, window, dependencies });
  Object.assign(app.state.documents, { pages: 2, oldSequence: [0, 1], newSequence: [0, 1] });
  app.state.visual.mode = "toggle";
  app.state.boxEditor.showBoxes = false;
  return app;
}

function hiddenTogglePage(width = 100, height = 200) {
  return { canvas: { width, height }, boxes: [], autoBoxes: undefined,
    stats: { removed: "削除 —", added: "追加 —", boxes: "変更箇所 —" },
    status: "新旧切替", pageLabel: "1 / 2" };
}

const selectionBoxes = [
  { x: 10, y: 10, w: 20, h: 20, kind: "added" },
  { x: 60, y: 60, w: 20, h: 20, kind: "changed" },
];
const selectionPage = () => ({ ...hiddenTogglePage(), boxes: selectionBoxes, autoBoxes: selectionBoxes });
function selectionApp(render = async () => selectionPage()) {
  const app = editableVisualApp(render, { createViewerController });
  app.state.boxEditor.showBoxes = true;
  return app;
}
function clickBox(app, x, y) {
  app.boxEditorController.pointerDown({ x, y, pointerId: 1, button: 0 });
  app.boxEditorController.pointerUp({ pointerId: 1 });
}

// Break: list B leaves edit A selected, so Delete removes the wrong drawing change.
test("list selection replaces the edit selection before Delete on the same page", async () => {
  const app = selectionApp();
  await app.visualController.showPage(0);
  app.boxEditorController.setEditMode(true);
  clickBox(app, 20, 20);
  expect(app.state.boxEditor.selectedIndex).toBe(0);
  await app.reviewController.select("change-2");
  app.boxEditorController.deleteSelected();
  expect(app.state.boxEditor.currentBoxes.map(box => box.id)).toEqual(["change-1"]);
  expect(app.state.review.itemsByPage.get(0).map(item => item.id)).toEqual(["change-1"]);
  expect(app.state.boxEditor.editMode).toBe(true);
});

// Break: list selection either enters edit mode or fails to map the selected ID to current boxes.
test("list selection synchronizes the box ID without entering edit mode", async () => {
  const app = selectionApp();
  await app.visualController.showPage(0);
  await app.reviewController.select("change-2");
  expect(app.state.boxEditor.selectedIndex).toBe(1);
  expect(app.state.boxEditor.currentBoxes[app.state.boxEditor.selectedIndex].id).toBe("change-2");
  expect(app.state.boxEditor.editMode).toBe(false);
});

// Break: entering edit mode clears the list-selected ID, so the newly enabled Delete control has no target.
test("entering edit mode keeps the box selected from the list", async () => {
  const app = selectionApp();
  await app.visualController.showPage(0);
  await app.reviewController.select("change-2");
  app.boxEditorController.setEditMode(true);
  expect(app.state.boxEditor.currentBoxes[app.state.boxEditor.selectedIndex]?.id).toBe("change-2");
});

// Break: a diagram selection never reaches the review ID and leaves the wrong list row highlighted.
test("diagram selection updates the review row without moving the viewport", async () => {
  const app = selectionApp();
  await app.visualController.showPage(0);
  await app.reviewController.select("change-2");
  const transform = app.viewerController.getView();
  app.boxEditorController.setEditMode(true);
  clickBox(app, 20, 20);
  expect(app.state.review.selectedId).toBe("change-1");
  expect(app.viewerController.getView()).toEqual(transform);
});

// Break: a pending page change keeps the old Delete target, or its late completion restores an obsolete selection.
test("the last list selection wins a pending cross-page render and edit selection", async () => {
  let finish;
  const app = selectionApp(snapshot => snapshot.pageIndex === 1
    ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(selectionPage()));
  await app.visualController.showPage(0);
  app.reviewController.commitPage({ pageIndex: 1, width: 100, height: 200, boxes: [selectionBoxes[0]] });
  app.boxEditorController.setEditMode(true);
  clickBox(app, 20, 20);
  const stale = app.reviewController.select("change-3");
  const pendingSelection = app.state.boxEditor.selectedIndex;
  await app.reviewController.select("change-2");
  finish(selectionPage());
  expect(await stale).toBe(false);
  expect(pendingSelection).toBe(-1);
  expect(app.state.documents.currentPage).toBe(0);
  expect(app.state.review.selectedId).toBe("change-2");
  expect(app.state.boxEditor.currentBoxes[app.state.boxEditor.selectedIndex]?.id).toBe("change-2");
});

// Break: a delayed list navigation overwrites a more recent selection made in the visible drawing.
test("diagram selection supersedes a pending list navigation", async () => {
  let finish;
  const app = selectionApp(snapshot => snapshot.pageIndex === 1
    ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(selectionPage()));
  await app.visualController.showPage(0);
  app.reviewController.commitPage({ pageIndex: 1, width: 100, height: 200, boxes: [selectionBoxes[0]] });
  app.boxEditorController.setEditMode(true);
  const stale = app.reviewController.select("change-3");
  clickBox(app, 20, 20);
  finish(selectionPage());
  expect(await stale).toBe(false);
  expect(app.state.documents.currentPage).toBe(0);
  expect(app.state.review.selectedId).toBe("change-1");
  expect(app.state.boxEditor.currentBoxes[app.state.boxEditor.selectedIndex]?.id).toBe("change-1");
});

test("editing a hidden toggle page preserves saved automatic reviews during immediate manual creation", async () => {
  const autoBoxes = [{ x: 50, y: 100, w: 20, h: 40, kind: "added" }];
  const detected = { ...hiddenTogglePage(), boxes: autoBoxes, autoBoxes };
  let resolveDetection;
  const renderTogglePage = vi.fn().mockResolvedValueOnce(detected)
    .mockResolvedValueOnce(hiddenTogglePage())
    .mockImplementationOnce(() => new Promise(resolve => { resolveDetection = resolve; }));
  const app = editableVisualApp(renderTogglePage);
  app.state.boxEditor.showBoxes = true;
  await app.visualController.showPage(0);
  app.state.review.entriesById.set("change-1", { status: "confirmed", comment: "既存の確認記録" });
  app.boxEditorController.toggleBoxes();
  await app.visualController.showPage(0);
  expect(app.state.boxEditor.currentBoxes).toEqual([]);
  expect(app.state.review.itemsByPage.get(0)).toMatchObject([{ id: "change-1", source: "auto" }]);
  const savedAuto = app.state.boxEditor.autoByPage.get(0);
  const showing = vi.spyOn(app.visualController, "showPage");

  app.boxEditorController.setEditMode(true);
  app.boxEditorController.pointerDown({ x: 10, y: 20, pointerId: 1 });
  app.boxEditorController.pointerMove({ x: 30, y: 60, pointerId: 1 });
  app.boxEditorController.pointerUp({ pointerId: 1 });
  const immediateItems = app.state.review.itemsByPage.get(0);
  if (resolveDetection) {
    resolveDetection(detected);
    await showing.mock.results[0].value;
  }

  const expectedItems = [
    { id: "change-2", source: "manual", kind: "changed",
      normalizedRect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } },
    { id: "change-1", source: "auto", kind: "added",
      normalizedRect: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 } },
  ];
  expect(immediateItems).toMatchObject(expectedItems);
  expect(app.state.review.itemsByPage.get(0)).toMatchObject(expectedItems);
  expect(app.state.review.entriesById.get("change-1")).toEqual({ status: "confirmed", comment: "既存の確認記録" });
  expect(app.state.boxEditor.currentBoxes).toMatchObject([
    { id: "change-1", kind: "added", source: "auto" },
    { id: "change-2", kind: "changed", source: "manual" },
  ]);
  expect(savedAuto).toEqual([{ x: 50, y: 100, w: 20, h: 40, id: "change-1", kind: "added", source: "auto" }]);
  expect(app.state.boxEditor.currentBoxes).not.toBe(savedAuto);
  expect(app.state.boxEditor.currentBoxes[0]).not.toBe(savedAuto[0]);
  expect(app.state.boxEditor.autoByPage.get(0)).toBe(savedAuto);
  expect(showing).not.toHaveBeenCalled();
});

test("manual creation after an undetected toggle page commits while automatic detection is pending", async () => {
  let resolveDetection;
  const renderTogglePage = vi.fn().mockResolvedValueOnce(hiddenTogglePage())
    .mockImplementationOnce(() => new Promise(resolve => { resolveDetection = resolve; }));
  const app = editableVisualApp(renderTogglePage);
  expect(await app.visualController.showPage(0)).toEqual({ committed: true });
  expect(app.state.review.itemsByPage.has(0)).toBe(false);
  const showing = vi.spyOn(app.visualController, "showPage");
  app.boxEditorController.setEditMode(true);
  const detection = showing.mock.results[0].value;
  app.boxEditorController.pointerDown({ x: 10, y: 20, pointerId: 1 });
  app.boxEditorController.pointerMove({ x: 30, y: 60, pointerId: 1 });
  let creationError;
  try { app.boxEditorController.pointerUp({ pointerId: 1 }); }
  catch (error) { creationError = error; }
  const autoBoxes = [{ x: 0, y: 0, w: 10, h: 10, kind: "added" }];
  resolveDetection({ ...hiddenTogglePage(), boxes: autoBoxes, autoBoxes });
  expect(await detection).toEqual({ committed: true });
  expect(creationError).toBeUndefined();
  expect(app.state.review.itemsByPage.get(0)).toMatchObject([{
    id: "change-1", source: "manual", kind: "changed",
    normalizedRect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
  }]);
  expect(app.state.boxEditor.currentBoxes).toEqual(app.state.boxEditor.editsByPage.get(0));
  expect(app.state.boxEditor.autoByPage.has(0)).toBe(false);
});

test("stale undetected renders cannot register dimensions for a page that never committed", async () => {
  let resolveStale;
  const renderTogglePage = vi.fn()
    .mockImplementationOnce(() => new Promise(resolve => { resolveStale = resolve; }))
    .mockResolvedValueOnce(hiddenTogglePage(200, 400));
  const app = editableVisualApp(renderTogglePage);
  const stale = app.visualController.showPage(0);
  await app.visualController.showPage(1);
  resolveStale(hiddenTogglePage(1000, 2000));
  expect(await stale).toEqual({ committed: false });
  expect(app.state.review.itemsByPage.size).toBe(0);
  expect(() => app.reviewController.syncEditedPage({ pageIndex: 0, boxes: [] })).toThrow("変更枠寸法がありません");
  const edited = app.reviewController.syncEditedPage({ pageIndex: 1,
    boxes: [{ x: 20, y: 40, w: 40, h: 80, kind: "changed" }] });
  expect(edited.currentBoxes).toHaveLength(1);
  expect(app.state.review.itemsByPage.get(1)[0].normalizedRect).toEqual({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
});

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

function interruptedIndexApp() {
  let finishStale;
  const renderChangeIndexPage = vi.fn()
    .mockImplementationOnce(() => new Promise(resolve => { finishStale = resolve; }))
    .mockImplementation(async () => ({ boxes: [selectionBoxes[0]], width: 100, height: 200 }));
  const document = fakeDocument();
  for (const side of ["Old", "New"]) document.getElementById(`drop${side}`).querySelector = () => ({});
  const dependencies = fakeDependencies({ bindControls: vi.fn(), createDocumentController,
    invalidateDocuments, renderChangeIndexPage,
    pdfjsLib: { Util: { transform() {} }, getDocument: () => ({ promise: Promise.resolve({ numPages: 3 }) }) },
  });
  const window = { confirm: () => true, console: { error() {} }, getComputedStyle: () => ({ getPropertyValue: () => "#000" }) };
  const app = createApp({ document, window, dependencies });
  Object.assign(app.state.documents, { pages: 3, oldSequence: [0, 1, 2], newSequence: [0, 1, 2],
    oldDoc: { numPages: 3 }, newDoc: { numPages: 3 } });
  app.state.visual.rendered = true;
  app.reviewController.commitPage({ pageIndex: 0, width: 100, height: 200, boxes: [selectionBoxes[0]] });
  app.reviewController.setStatus("change-1", "confirmed");
  app.reviewController.setComment("change-1", "前の文書の確認記録");
  const indexing = app.reviewController.startIndex({ skipPages: new Set([0]) });
  return { app, document, indexing, renderChangeIndexPage,
    finishStale: () => finishStale({ boxes: [{ ...selectionBoxes[0], x: 77 }], width: 100, height: 200 }) };
}

// Break: a failed PDF replacement restores the drawing but strands a 1/3 index and labels it complete.
test("failed PDF replacement resumes unfinished indexing on the retained documents", async () => {
  const { app, document, indexing, renderChangeIndexPage, finishStale } = interruptedIndexApp();
  const oldNewDoc = app.state.documents.newDoc;
  expect(app.state.review.indexedPages).toBe(1);
  expect(app.state.review.indexRunning).toBe(true);
  expect(await app.documentController.load("new", {
    name: "broken.pdf", arrayBuffer: async () => { throw new Error("broken replacement"); },
  })).toBe(false);
  finishStale();
  await indexing;
  await vi.waitFor(() => expect(app.state.review.itemsByPage.size).toBe(3));
  await vi.waitFor(() => expect(app.state.review.indexRunning).toBe(false));
  expect(app.state.documents.newDoc).toBe(oldNewDoc);
  expect(app.state.visual.rendered).toBe(true);
  expect(renderChangeIndexPage.mock.calls.map(([snapshot]) => snapshot.pageIndex)).toEqual([1, 1, 2]);
  expect(app.state.review.itemsByPage.get(1)[0].rect.x).toBe(10);
  expect(app.state.review.entriesById.get("change-1")).toEqual({ status: "confirmed", comment: "前の文書の確認記録" });
  expect(document.getElementById("reviewIndexStatus").textContent).toBe("分析完了 3 / 3 ページ");
});

// Break: reusing the failure-resume path for a successful replacement leaks old reviews and index results.
test("successful PDF replacement resets reviews and rejects the canceled index", async () => {
  const { app, indexing, renderChangeIndexPage, finishStale } = interruptedIndexApp();
  const oldNewDoc = app.state.documents.newDoc;
  expect(await app.documentController.load("new", {
    name: "replacement.pdf", arrayBuffer: async () => new ArrayBuffer(1),
  })).toBe(true);
  finishStale();
  await indexing;
  expect(app.state.documents.newDoc).not.toBe(oldNewDoc);
  expect(app.state.review.itemsByPage.size).toBe(0);
  expect(app.state.review.entriesById.size).toBe(0);
  expect(app.state.review.indexTotal).toBe(0);
  expect(app.state.review.indexRunning).toBe(false);
  expect(renderChangeIndexPage).toHaveBeenCalledTimes(1);
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
