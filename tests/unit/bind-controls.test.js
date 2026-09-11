import { expect, test, vi } from "vitest";
import { bindControls } from "../../src/app/bind-controls.js";
import { createAppState } from "../../src/app/state.js";
import { createChangeReviewController } from "../../src/features/change-review/review-controller.js";
import { createChangeReviewView } from "../../src/features/change-review/review-view.js";
import { reviewDom } from "../helpers/review-dom.js";

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

// Break: toggle does not bubble, so listening without capture never requests opened page groups.
test("captures page toggles once and requests only visible opened review groups", () => {
  const dom = new Proxy({}, { get: (value, key) => {
    if (!(key in value)) value[key] = key.endsWith("Buttons") ? [] : target();
    return value[key];
  } });
  const reviewController = { requestPageThumbnails: vi.fn() };
  bindControls({ document: target(), window: target(), dom, reviewController });
  const registrations = dom.reviewList.listeners.get("toggle");
  expect(registrations).toHaveLength(1);
  expect(registrations[0].options).toBe(true);
  const group = { tagName: "DETAILS", dataset: { reviewPage: "2" }, open: true };
  dom.reviewList.emit("toggle", { target: group });
  expect(reviewController.requestPageThumbnails).toHaveBeenCalledExactlyOnceWith(2);
  group.open = false;
  dom.reviewList.emit("toggle", { target: group });
  group.open = true;
  dom.reviewPanel.hidden = true;
  dom.reviewList.emit("toggle", { target: group });
  expect(reviewController.requestPageThumbnails).toHaveBeenCalledTimes(1);
});

test("delegates item edit and delete before row selection", () => {
  const dom = new Proxy({}, { get: (value, key) => {
    if (!(key in value)) value[key] = key.endsWith("Buttons") ? [] : target();
    return value[key];
  } });
  const reviewController = new Proxy({}, { get: (value, key) => value[key] ||= vi.fn() });
  bindControls({ document: target(), window: target(), dom, reviewController });
  const article = { dataset: { changeId: "change-2" } };
  const edit = { dataset: { reviewEdit: "change-2" } };
  const remove = { dataset: { reviewDelete: "change-2" } };
  const emitAction = action => dom.reviewList.emit("click", {
    target: {
      closest(selector) {
        if (selector === "[data-review-edit]" && action === edit) return edit;
        if (selector === "[data-review-delete]" && action === remove) return remove;
        if (selector === "[data-change-id]") return article;
        return null;
      },
    },
  });

  emitAction(edit);
  emitAction(remove);

  expect(reviewController.edit).toHaveBeenCalledExactlyOnceWith("change-2");
  expect(reviewController.remove).toHaveBeenCalledExactlyOnceWith("change-2");
  expect(reviewController.select).not.toHaveBeenCalled();
});

test("delegates review add and reset to public review operations", () => {
  const dom = new Proxy({}, { get: (value, key) => {
    if (!(key in value)) value[key] = key.endsWith("Buttons") ? [] : target();
    return value[key];
  } });
  const reviewController = new Proxy({}, { get: (value, key) => value[key] ||= vi.fn() });
  bindControls({ document: target(), window: target(), dom, reviewController });

  dom.reviewAdd.emit("click");
  dom.reviewReset.emit("click");

  expect(reviewController.startCreate).toHaveBeenCalledOnce();
  expect(reviewController.resetCurrentPage).toHaveBeenCalledOnce();
});

test("binds controls once and delegates events to their owning public handlers", () => {
  const names = [
    "fileOld", "fileNew", "dropOld", "dropNew", "modeDiff", "modeToggle",
    "toggleFlip", "boxToggle", "boxEdit", "boxDel", "boxReset", "dpi", "th",
    "tolerance", "nudgeReset", "quadReset", "rotReset", "scaleReset", "autoAlign",
    "run", "alignAddNew", "alignDelOld", "alignUndo", "prev", "next", "dlPng",
    "dlPdf", "dlTextPng", "dlTextPdf", "runText", "textPrev", "textNext",
    "topVisual", "topText", "zoomIn", "zoomOut", "zoomFit", "zoom1",
    "textZoomIn", "textZoomOut", "textZoomFit", "textZoom1",
    "reviewRailToggle", "reviewBackdrop", "reviewPrev", "reviewNext", "reviewList",
    "reviewAdd", "reviewReset", "minimapCanvas",
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
  const minimapController = new Proxy({}, { get: (value, key) => value[key] ||= vi.fn() });

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
    minimapController,
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
  const mini = { pointerId: 9 };
  dom.minimapCanvas.emit("pointerdown", mini);
  expect(minimapController.pointerDown).toHaveBeenCalledWith(mini);
  dom.minimapCanvas.emit("pointermove", mini);
  expect(minimapController.pointerMove).toHaveBeenCalledWith(mini);
  dom.minimapCanvas.emit("pointerup", mini);
  expect(minimapController.pointerUp).toHaveBeenCalledWith(mini);
  dom.minimapCanvas.emit("pointercancel", mini);
  expect(minimapController.pointerCancel).toHaveBeenCalledWith(mini);
});

test("replaces every active event binding when the same document is bound again", () => {
  const names = [
    "fileOld", "fileNew", "dropOld", "dropNew", "modeDiff", "modeToggle",
    "toggleFlip", "boxToggle", "boxEdit", "boxDel", "boxReset", "dpi", "th",
    "tolerance", "nudgeReset", "quadReset", "rotReset", "scaleReset", "autoAlign",
    "run", "alignAddNew", "alignDelOld", "alignUndo", "prev", "next", "dlPng",
    "dlPdf", "dlTextPng", "dlTextPdf", "runText", "textPrev", "textNext",
    "topVisual", "topText", "zoomIn", "zoomOut", "zoomFit", "zoom1",
    "textZoomIn", "textZoomOut", "textZoomFit", "textZoom1",
    "reviewRailToggle", "reviewBackdrop", "reviewPrev", "reviewNext", "reviewList",
    "reviewAdd", "reviewReset", "minimapCanvas",
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
  const createOwners = () => ({
    appController: new Proxy({}, { get: (value, key) => value[key] ||= vi.fn() }),
    viewerController: new Proxy({}, { get: (value, key) => value[key] ||= vi.fn() }),
    boxEditorController: new Proxy({}, { get: (value, key) => value[key] ||= vi.fn() }),
    textController: new Proxy({}, { get: (value, key) => value[key] ||= vi.fn() }),
    textRenderer: new Proxy({}, { get: (value, key) => value[key] ||= vi.fn() }),
    exportController: new Proxy({}, { get: (value, key) => value[key] ||= vi.fn() }),
    minimapController: new Proxy({}, { get: (value, key) => value[key] ||= vi.fn() }),
  });
  const previous = createOwners();
  const latest = createOwners();

  bindControls({ document: documentTarget, window: windowTarget, dom, ...previous });
  bindControls({ document: documentTarget, window: windowTarget, dom, ...latest });

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

// Break: a missing delegated handler, duplicate listener, or input click selection loses/changes review work.
test("delegates review controls once to real review state while leaving text entry unselected", async () => {
  const { document: documentBoundary, dom: reviewElements } = reviewDom();
  const dom = new Proxy(reviewElements, { get: (value, key) => {
    if (!(key in value)) value[key] = key.endsWith("Buttons") ? [] : target();
    return value[key];
  } });
  const state = createAppState();
  state.visual.rendered = true;
  const view = createChangeReviewView({ state, dom, document: documentBoundary });
  const focus = [];
  const reviewController = createChangeReviewController({ state, onChanged: () => view.render(),
    focusRect: rect => focus.push(rect.x),
    showPage: async pageIndex => { state.documents.currentPage = pageIndex; return { committed: true }; },
    renderIndexPage: async () => ({ boxes: [], width: 100, height: 100 }),
  });
  reviewController.commitPage({ pageIndex: 0, width: 100, height: 100,
    boxes: [{ x: 10, y: 10, w: 20, h: 20, kind: "added" }, { x: 50, y: 10, w: 20, h: 20, kind: "removed" }] });
  const document = target();
  const owners = { document, window: target(), dom, reviewController,
    appController: { setTopMode(mode) { state.ui.topMode = mode; view.render(); } } };
  bindControls(owners);
  bindControls(owners);
  dom.reviewRailToggle.emit("click");
  expect(state.review.panelOpen).toBe(true);
  dom.reviewList.emit("click", { target: dom.reviewList.querySelector('[data-change-id="change-1"]').children[0].children[0] });
  await vi.waitFor(() => expect(state.review.selectedId).toBe("change-1"));
  expect(focus).toEqual([10]);
  const comment = dom.reviewList.querySelector('[data-review-comment="change-2"]');
  dom.reviewList.emit("click", { target: comment });
  expect(state.review.selectedId).toBe("change-1");
  comment.value = "入力を確認";
  dom.reviewList.emit("input", { target: comment });
  const confirmed = dom.reviewList.querySelector('[data-review-confirmed="change-2"]');
  confirmed.checked = true;
  dom.reviewList.emit("change", { target: confirmed });
  expect(state.review.entriesById.get("change-2")).toEqual({ status: "confirmed", comment: "入力を確認" });
  expect(dom.reviewProgress.textContent).toBe("確認済み 1 / 2　未確認 1件");
  dom.reviewList.emit("click", { target: confirmed });
  expect(state.review.selectedId).toBe("change-1");
  confirmed.checked = false;
  dom.reviewList.emit("change", { target: confirmed });
  expect(state.review.entriesById.get("change-2")).toEqual({ status: "pending", comment: "入力を確認" });
  dom.reviewNext.emit("click");
  await vi.waitFor(() => expect(state.review.selectedId).toBe("change-2"));
  dom.reviewPrev.emit("click");
  await vi.waitFor(() => expect(state.review.selectedId).toBe("change-1"));
  expect(state.review.entriesById.get("change-2")).toEqual({ status: "pending", comment: "入力を確認" });
  dom.reviewRailToggle.emit("click");
  expect(state.review.panelOpen).toBe(false);
  expect(state.review.entriesById.get("change-2")).toEqual({ status: "pending", comment: "入力を確認" });
  dom.reviewRailToggle.emit("click");
  expect(state.review.panelOpen).toBe(true);
  dom.reviewBackdrop.emit("click");
  expect(state.review.panelOpen).toBe(false);
  state.review.indexErrors.set(1, "error");
  view.render();
  dom.reviewList.emit("click", { target: dom.reviewList.querySelector('[data-review-retry="1"]') });
  await vi.waitFor(() => expect(state.review.indexErrors.size).toBe(0));
  dom.topText.emit("click");
  expect(state.ui.topMode).toBe("text");
  dom.topVisual.emit("click");
  expect(state.ui.topMode).toBe("visual");
  for (const type of ["click", "change", "input"]) expect(dom.reviewList.listeners.get(type)).toHaveLength(1);
});
