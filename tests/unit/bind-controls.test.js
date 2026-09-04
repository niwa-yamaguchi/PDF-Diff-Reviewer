import { expect, test, vi } from "vitest";
import { bindControls } from "../../src/app/bind-controls.js";

function target() {
  const listeners = new Map();
  return {
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

test("binds controls once and delegates events to their owning public handlers", () => {
  const names = [
    "fileOld", "fileNew", "dropOld", "dropNew", "modeDiff", "modeToggle", "modeSplit",
    "toggleFlip", "boxToggle", "boxEdit", "boxDel", "boxReset", "dpi", "th",
    "tolerance", "nudgeReset", "quadReset", "rotReset", "scaleReset", "autoAlign",
    "run", "alignAddNew", "alignDelOld", "alignUndo", "prev", "next", "dlPng",
    "dlPdf", "dlTextPng", "dlTextPdf", "runText", "textPrev", "textNext",
    "topVisual", "topText", "zoomIn", "zoomOut", "zoomFit", "zoom1",
    "textZoomIn", "textZoomOut", "textZoomFit", "textZoom1",
  ];
  const dom = Object.fromEntries(names.map(name => [name, target()]));
  Object.assign(dom, {
    canvasWrap: target(),
    splitOldWrap: target(),
    splitNewWrap: target(),
    oldTextWrap: target(),
    newTextWrap: target(),
    nudgeButtons: [target()],
    quadButtons: [target()],
    rotButtons: [target()],
    scaleButtons: [target()],
  });
  const documentTarget = target();
  const windowTarget = target();
  const appController = new Proxy({}, { get: (value, key) => value[key] ||= vi.fn() });
  const viewerController = new Proxy({}, { get: (value, key) => value[key] ||= vi.fn() });
  const splitViewerController = new Proxy({}, { get: (value, key) => value[key] ||= vi.fn() });
  const boxEditorController = new Proxy({}, { get: (value, key) => value[key] ||= vi.fn() });
  const textController = new Proxy({}, { get: (value, key) => value[key] ||= vi.fn() });
  const textRenderer = new Proxy({}, { get: (value, key) => value[key] ||= vi.fn() });
  const exportController = new Proxy({}, { get: (value, key) => value[key] ||= vi.fn() });

  bindControls({
    document: documentTarget,
    window: windowTarget,
    dom,
    appController,
    state: { visual: { mode: "diff" } },
    viewerController,
    splitViewerController,
    boxEditorController,
    textController,
    textRenderer,
    exportController,
  });

  for (const element of [documentTarget, windowTarget, ...Object.values(dom).flat()]) {
    if (!element?.listeners) continue;
    for (const registrations of element.listeners.values()) {
      expect(registrations).toHaveLength(1);
    }
  }

  const move = { pointerId: 7 };
  dom.canvasWrap.emit("pointermove", move);
  expect(viewerController.handlePointerMove).toHaveBeenCalledWith(move);
  expect(boxEditorController.pointerMove).toHaveBeenCalledWith(move);
  expect(boxEditorController.updateCursor).toHaveBeenCalledWith(move);

  dom.oldTextWrap.emit("wheel", move);
  expect(textRenderer.handleWheel).toHaveBeenCalledWith(dom.oldTextWrap, move);
  dom.dlPng.emit("click");
  expect(exportController.saveVisualPng).toHaveBeenCalledTimes(1);
  dom.modeDiff.emit("click");
  expect(appController.setDiffMode).toHaveBeenCalledTimes(1);
  dom.modeSplit.emit("click");
  expect(appController.setSplitMode).toHaveBeenCalledTimes(1);
  dom.splitNewWrap.emit("wheel", move);
  expect(splitViewerController.handleWheel).toHaveBeenCalledWith(dom.splitNewWrap, move);
  windowTarget.emit("resize");
  expect(viewerController.handleResize).toHaveBeenCalledTimes(1);
  expect(splitViewerController.handleResize).toHaveBeenCalledTimes(1);
  expect(textRenderer.handleResize).toHaveBeenCalledTimes(1);

  dom.zoomIn.emit("click");
  expect(viewerController.zoomIn).toHaveBeenCalledTimes(1);
  appController.setSplitMode.mockImplementation(() => {});
  const splitState = { visual: { mode: "split" } };
  const splitDom = dom;
  bindControls({
    document: documentTarget,
    window: windowTarget,
    dom: splitDom,
    appController,
    state: splitState,
    viewerController,
    splitViewerController,
    boxEditorController,
    textController,
    textRenderer,
    exportController,
  });
  dom.zoomIn.emit("click");
  expect(splitViewerController.zoomIn).toHaveBeenCalledTimes(1);
});

test("replaces every active event binding when the same document is bound again", () => {
  const names = [
    "fileOld", "fileNew", "dropOld", "dropNew", "modeDiff", "modeToggle", "modeSplit",
    "toggleFlip", "boxToggle", "boxEdit", "boxDel", "boxReset", "dpi", "th",
    "tolerance", "nudgeReset", "quadReset", "rotReset", "scaleReset", "autoAlign",
    "run", "alignAddNew", "alignDelOld", "alignUndo", "prev", "next", "dlPng",
    "dlPdf", "dlTextPng", "dlTextPdf", "runText", "textPrev", "textNext",
    "topVisual", "topText", "zoomIn", "zoomOut", "zoomFit", "zoom1",
    "textZoomIn", "textZoomOut", "textZoomFit", "textZoom1",
  ];
  const dom = Object.fromEntries(names.map(name => [name, target()]));
  Object.assign(dom, {
    canvasWrap: target(),
    splitOldWrap: target(),
    splitNewWrap: target(),
    oldTextWrap: target(),
    newTextWrap: target(),
    nudgeButtons: [target()],
    quadButtons: [target()],
    rotButtons: [target()],
    scaleButtons: [target()],
  });
  const documentTarget = target();
  const windowTarget = target();
  const createOwners = () => ({
    appController: new Proxy({}, { get: (value, key) => value[key] ||= vi.fn() }),
    viewerController: new Proxy({}, { get: (value, key) => value[key] ||= vi.fn() }),
    splitViewerController: new Proxy({}, { get: (value, key) => value[key] ||= vi.fn() }),
    boxEditorController: new Proxy({}, { get: (value, key) => value[key] ||= vi.fn() }),
    textController: new Proxy({}, { get: (value, key) => value[key] ||= vi.fn() }),
    textRenderer: new Proxy({}, { get: (value, key) => value[key] ||= vi.fn() }),
    exportController: new Proxy({}, { get: (value, key) => value[key] ||= vi.fn() }),
  });
  const previous = createOwners();
  const latest = createOwners();

  const state = { visual: { mode: "diff" } };
  bindControls({ document: documentTarget, window: windowTarget, dom, state, ...previous });
  bindControls({ document: documentTarget, window: windowTarget, dom, state, ...latest });

  for (const eventTarget of [documentTarget, windowTarget, ...Object.values(dom).flat()]) {
    if (!eventTarget?.listeners) continue;
    for (const registrations of eventTarget.listeners.values()) {
      expect(registrations).toHaveLength(1);
    }
  }

  documentTarget.emit("keydown", { code: "Space" });
  windowTarget.emit("resize");
  dom.canvasWrap.emit("pointermove", { pointerId: 3 });
  dom.nudgeButtons[0].emit("click");

  expect(previous.appController.handleKeyDown).not.toHaveBeenCalled();
  expect(previous.viewerController.handleResize).not.toHaveBeenCalled();
  expect(previous.boxEditorController.pointerMove).not.toHaveBeenCalled();
  expect(previous.appController.nudge).not.toHaveBeenCalled();
  expect(latest.appController.handleKeyDown).toHaveBeenCalledTimes(1);
  expect(latest.viewerController.handleResize).toHaveBeenCalledTimes(1);
  expect(latest.boxEditorController.pointerMove).toHaveBeenCalledTimes(1);
  expect(latest.appController.nudge).toHaveBeenCalledTimes(1);
});
