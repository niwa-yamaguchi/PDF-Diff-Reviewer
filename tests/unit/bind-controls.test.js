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
    emit(type, event = {}) {
      for (const { handler } of listeners.get(type) || []) handler(event);
    },
  };
}

test("binds controls once and delegates events to their owning public handlers", () => {
  const names = [
    "fileOld", "fileNew", "dropOld", "dropNew", "modeDiff", "modeToggle",
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
  const boxEditorController = new Proxy({}, { get: (value, key) => value[key] ||= vi.fn() });
  const textController = new Proxy({}, { get: (value, key) => value[key] ||= vi.fn() });
  const textRenderer = new Proxy({}, { get: (value, key) => value[key] ||= vi.fn() });
  const exportController = new Proxy({}, { get: (value, key) => value[key] ||= vi.fn() });

  bindControls({
    document: documentTarget,
    window: windowTarget,
    dom,
    appController,
    viewerController,
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
  windowTarget.emit("resize");
  expect(viewerController.handleResize).toHaveBeenCalledTimes(1);
  expect(textRenderer.handleResize).toHaveBeenCalledTimes(1);
});
