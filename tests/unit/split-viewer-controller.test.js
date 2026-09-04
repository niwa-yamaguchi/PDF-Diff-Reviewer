import { describe, expect, test, vi } from "vitest";
import { createAppState } from "../../src/app/state.js";
import { zoomAt } from "../../src/features/viewer/viewport.js";
import { createSplitViewerController } from "../../src/features/viewer/split-viewer-controller.js";

function classList() {
  const values = new Set();
  return {
    add: value => values.add(value),
    remove: value => values.delete(value),
    contains: value => values.has(value),
  };
}

function wrapStub({ clientWidth, clientHeight, left = 0, top = 0 }) {
  return {
    clientWidth,
    clientHeight,
    classList: classList(),
    getBoundingClientRect: () => ({ left, top }),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  };
}

function splitDom({
  oldWrap: [oldWidth, oldHeight],
  newWrap: [newWidth, newHeight],
  canvas: [width, height],
  oldRect = { left: 0, top: 0 },
  newRect = { left: 0, top: 0 },
}) {
  return {
    oldCanvas: { width, height, style: { transform: "" } },
    newCanvas: { width, height, style: { transform: "" } },
    oldWrap: wrapStub({ clientWidth: oldWidth, clientHeight: oldHeight, ...oldRect }),
    newWrap: wrapStub({ clientWidth: newWidth, clientHeight: newHeight, ...newRect }),
    zoomLabel: { textContent: "" },
  };
}

function activeSplitState() {
  const state = createAppState();
  state.ui.topMode = "visual";
  state.visual.mode = "split";
  state.visual.rendered = true;
  return state;
}

function wheelEvent({ clientX, clientY, deltaY }) {
  return { clientX, clientY, deltaY, preventDefault: vi.fn() };
}

function pointerEvent({ pointerId, clientX, clientY, button = 0 }) {
  return { pointerId, clientX, clientY, button };
}

function expectedTransform(view) {
  return `translate(${view.tx}px,${view.ty}px) scale(${view.scale})`;
}

describe("createSplitViewerController", () => {
  test("applies one transform to both canvases and fits the smaller wrap", () => {
    const state = createAppState();
    state.ui.topMode = "visual";
    state.visual.mode = "split";
    state.visual.rendered = true;
    const dom = splitDom({ oldWrap: [400, 300], newWrap: [360, 280], canvas: [1000, 800] });
    const controller = createSplitViewerController({ state, dom });

    controller.fit();

    expect(dom.oldCanvas.style.transform).toBe(dom.newCanvas.style.transform);
    const scale = Math.min(360 / 1000, 280 / 800) * 0.92;
    expect(controller.getView()).toEqual({
      scale,
      tx: (360 - 1000 * scale) / 2,
      ty: (280 - 800 * scale) / 2,
    });
    expect(dom.zoomLabel.textContent).toBe(`${Math.round(controller.getView().scale * 100)}%`);
    expect(state.visual.splitView).toEqual(controller.getView());
  });

  test("zooms and pans from either pane while keeping transforms equal", () => {
    const state = activeSplitState();
    const dom = splitDom({ oldWrap: [400, 300], newWrap: [400, 300], canvas: [1000, 800] });
    const controller = createSplitViewerController({ state, dom });

    controller.handleWheel(dom.newWrap, wheelEvent({ clientX: 100, clientY: 80, deltaY: -1 }));
    controller.handlePointerDown(dom.oldWrap, pointerEvent({ pointerId: 7, clientX: 10, clientY: 20 }));
    controller.handlePointerMove(dom.oldWrap, pointerEvent({ pointerId: 7, clientX: 40, clientY: 60 }));

    expect(dom.oldCanvas.style.transform).toBe(dom.newCanvas.style.transform);
    expect(controller.getView()).toMatchObject({ tx: expect.any(Number), ty: expect.any(Number) });
  });

  test("copies splitView from state and writes value copies back", () => {
    const state = activeSplitState();
    state.visual.splitView = { scale: 2, tx: 12, ty: 8 };
    const dom = splitDom({ oldWrap: [400, 300], newWrap: [400, 300], canvas: [1000, 800] });
    const controller = createSplitViewerController({ state, dom });

    state.visual.splitView.tx = 99;
    const leaked = controller.getView();
    leaked.scale = 99;
    controller.apply();

    expect(controller.getView()).toEqual({ scale: 2, tx: 12, ty: 8 });
    expect(state.visual.splitView).toEqual({ scale: 2, tx: 12, ty: 8 });
    state.visual.splitView.ty = 50;
    expect(controller.getView().ty).toBe(8);
  });

  test("zooms around the pointer in the operated wrap", () => {
    const state = activeSplitState();
    const dom = splitDom({
      oldWrap: [400, 300],
      newWrap: [400, 300],
      canvas: [1000, 800],
      newRect: { left: 400, top: 10 },
    });
    const controller = createSplitViewerController({ state, dom });
    const event = wheelEvent({ clientX: 500, clientY: 80, deltaY: -1 });

    controller.handleWheel(dom.newWrap, event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(controller.getView()).toEqual(zoomAt({ scale: 1, tx: 0, ty: 0 }, 1.12, 100, 70));
    expect(dom.oldCanvas.style.transform).toBe(expectedTransform(controller.getView()));
    expect(dom.newCanvas.style.transform).toBe(dom.oldCanvas.style.transform);
  });

  test("zoom buttons use the OLD wrap center at 1.25 and restore 1:1 scale", () => {
    const state = activeSplitState();
    const dom = splitDom({
      oldWrap: [400, 300],
      newWrap: [400, 300],
      canvas: [1000, 800],
      oldRect: { left: 0, top: 0 },
      newRect: { left: 400, top: 0 },
    });
    const controller = createSplitViewerController({ state, dom });

    controller.zoomIn();
    expect(controller.getView()).toEqual(zoomAt({ scale: 1, tx: 0, ty: 0 }, 1.25, 200, 150));

    controller.zoomOut();
    expect(controller.getView().scale).toBeCloseTo(1);

    controller.zoomIn();
    controller.zoomOne();
    expect(controller.getView().scale).toBe(1);
    expect(dom.oldCanvas.style.transform).toBe(dom.newCanvas.style.transform);
  });

  test("clamps zoom through the existing 5% to 4000% viewport limits", () => {
    const state = activeSplitState();
    const dom = splitDom({ oldWrap: [400, 300], newWrap: [400, 300], canvas: [1000, 800] });
    const controller = createSplitViewerController({ state, dom });

    controller.apply({ scale: 39, tx: 0, ty: 0 });
    controller.zoomIn();
    expect(controller.getView().scale).toBe(40);

    controller.apply({ scale: 0.06, tx: 0, ty: 0 });
    controller.zoomOut();
    expect(controller.getView().scale).toBe(0.05);
  });

  test("owns and releases pointer capture on the wrap that started the pan", () => {
    const state = activeSplitState();
    const dom = splitDom({ oldWrap: [400, 300], newWrap: [400, 300], canvas: [1000, 800] });
    const controller = createSplitViewerController({ state, dom });

    controller.handlePointerDown(dom.newWrap, pointerEvent({ pointerId: 7, clientX: 10, clientY: 20 }));
    expect(dom.newWrap.setPointerCapture).toHaveBeenCalledWith(7);
    expect(dom.oldWrap.setPointerCapture).not.toHaveBeenCalled();
    expect(dom.newWrap.classList.contains("panning")).toBe(true);

    controller.handlePointerMove(dom.oldWrap, pointerEvent({ pointerId: 7, clientX: 25, clientY: 30 }));
    expect(controller.getView()).toEqual({ scale: 1, tx: 15, ty: 10 });
    expect(dom.oldCanvas.style.transform).toBe(dom.newCanvas.style.transform);

    controller.handlePointerUp(dom.oldWrap, pointerEvent({ pointerId: 7, clientX: 25, clientY: 30 }));
    expect(dom.newWrap.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(dom.oldWrap.releasePointerCapture).not.toHaveBeenCalled();
    expect(dom.newWrap.classList.contains("panning")).toBe(false);
  });

  test("ignores other pointers until the owning pointer is cancelled", () => {
    const state = activeSplitState();
    const dom = splitDom({ oldWrap: [400, 300], newWrap: [400, 300], canvas: [1000, 800] });
    const controller = createSplitViewerController({ state, dom });

    controller.handlePointerDown(dom.oldWrap, pointerEvent({ pointerId: 7, clientX: 10, clientY: 20 }));
    controller.handlePointerDown(dom.newWrap, pointerEvent({ pointerId: 8, clientX: 40, clientY: 60 }));
    controller.handlePointerMove(dom.newWrap, pointerEvent({ pointerId: 8, clientX: 80, clientY: 90 }));
    controller.handlePointerUp(dom.newWrap, pointerEvent({ pointerId: 8, clientX: 80, clientY: 90 }));

    expect(controller.getView()).toEqual({ scale: 1, tx: 0, ty: 0 });
    expect(dom.oldWrap.classList.contains("panning")).toBe(true);
    expect(dom.newWrap.setPointerCapture).not.toHaveBeenCalled();

    controller.handlePointerMove(dom.oldWrap, pointerEvent({ pointerId: 7, clientX: 18, clientY: 24 }));
    expect(controller.getView()).toEqual({ scale: 1, tx: 8, ty: 4 });

    controller.cancelPan();
    expect(dom.oldWrap.classList.contains("panning")).toBe(false);
    expect(dom.oldWrap.releasePointerCapture).toHaveBeenCalledWith(7);
  });

  test("resize reapplies the current view without fitting, and apply keeps view for page changes", () => {
    const state = activeSplitState();
    const dom = splitDom({ oldWrap: [400, 300], newWrap: [360, 280], canvas: [1000, 800] });
    const controller = createSplitViewerController({ state, dom });
    controller.apply({ scale: 2, tx: 30, ty: 40 });

    dom.oldWrap.clientWidth = 200;
    dom.newWrap.clientWidth = 180;
    controller.handleResize();

    expect(controller.getView()).toEqual({ scale: 2, tx: 30, ty: 40 });
    expect(dom.oldCanvas.style.transform).toBe("translate(30px,40px) scale(2)");
    expect(dom.newCanvas.style.transform).toBe(dom.oldCanvas.style.transform);

    controller.apply();
    expect(controller.getView()).toEqual({ scale: 2, tx: 30, ty: 40 });

    controller.fit();
    expect(controller.getView().scale).toBeCloseTo(Math.min(180 / 1000, 280 / 800) * 0.92);
  });

  test("does not reapply on resize when split view is not active", () => {
    const state = activeSplitState();
    const dom = splitDom({ oldWrap: [400, 300], newWrap: [400, 300], canvas: [1000, 800] });
    const controller = createSplitViewerController({ state, dom });
    controller.apply({ scale: 2, tx: 30, ty: 40 });

    state.visual.mode = "diff";
    dom.zoomLabel.textContent = "46%";
    controller.handleResize();

    expect(dom.zoomLabel.textContent).toBe("46%");
    expect(controller.getView()).toEqual({ scale: 2, tx: 30, ty: 40 });
    expect(dom.oldCanvas.style.transform).toBe("translate(30px,40px) scale(2)");
  });

  test("cancels pan without moving when the split view becomes inactive", () => {
    const state = activeSplitState();
    const dom = splitDom({ oldWrap: [400, 300], newWrap: [400, 300], canvas: [1000, 800] });
    const controller = createSplitViewerController({ state, dom });

    controller.handlePointerDown(dom.newWrap, pointerEvent({ pointerId: 7, clientX: 10, clientY: 20 }));
    state.ui.topMode = "text";
    controller.handlePointerMove(dom.newWrap, pointerEvent({ pointerId: 7, clientX: 40, clientY: 60 }));

    expect(controller.getView()).toEqual({ scale: 1, tx: 0, ty: 0 });
    expect(dom.newWrap.classList.contains("panning")).toBe(false);
    expect(dom.newWrap.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(dom.oldWrap.releasePointerCapture).not.toHaveBeenCalled();

    state.ui.topMode = "visual";
    controller.handlePointerMove(dom.newWrap, pointerEvent({ pointerId: 7, clientX: 80, clientY: 90 }));
    expect(controller.getView()).toEqual({ scale: 1, tx: 0, ty: 0 });
  });

  test("ignores wheel and zoom when split view is not active", () => {
    const state = activeSplitState();
    state.visual.rendered = false;
    const dom = splitDom({ oldWrap: [400, 300], newWrap: [400, 300], canvas: [1000, 800] });
    const controller = createSplitViewerController({ state, dom });
    const event = wheelEvent({ clientX: 100, clientY: 80, deltaY: -1 });

    controller.handleWheel(dom.oldWrap, event);
    controller.zoomIn();
    controller.handlePointerDown(dom.oldWrap, pointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(controller.getView()).toEqual({ scale: 1, tx: 0, ty: 0 });
    expect(dom.oldWrap.setPointerCapture).not.toHaveBeenCalled();

    state.visual.rendered = true;
    state.visual.mode = "diff";
    controller.zoomIn();
    expect(controller.getView().scale).toBe(1);

    state.visual.mode = "split";
    state.ui.topMode = "text";
    controller.zoomIn();
    expect(controller.getView().scale).toBe(1);
  });
});
