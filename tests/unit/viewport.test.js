import { describe, expect, test, vi } from "vitest";
import {
  fitViewport,
  zoomAt,
} from "../../src/features/viewer/viewport.js";
import { createViewerController } from "../../src/features/viewer/viewer-controller.js";

function eventTarget(properties = {}) {
  const listeners = new Map();
  return {
    ...properties,
    addEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      entries.push(listener);
      listeners.set(type, entries);
    },
    emit(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener(event);
    },
  };
}

function classList() {
  const values = new Set();
  return {
    add: value => values.add(value),
    remove: value => values.delete(value),
    contains: value => values.has(value),
  };
}

function viewerHarness() {
  const wrap = eventTarget({
    clientWidth: 500,
    clientHeight: 500,
    classList: classList(),
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  });
  const out = { width: 1000, height: 500, style: { display: "block", transform: "" } };
  const zoomLabel = { textContent: "" };
  const windowTarget = eventTarget();
  const onTransform = vi.fn();
  const state = {
    ui: { topMode: "visual" },
    boxEditor: { editMode: false },
  };
  const controller = createViewerController({
    state,
    dom: { wrap, out, zoomLabel },
    window: windowTarget,
    onTransform,
  });
  return { controller, state, wrap, out, zoomLabel, windowTarget, onTransform };
}

describe("viewport geometry", () => {
  test("zooms around the requested cursor point without mutating the input", () => {
    const view = { scale: 1, tx: 0, ty: 0 };

    expect(zoomAt(view, 2, 100, 50)).toEqual({ scale: 2, tx: -100, ty: -50 });
    expect(view).toEqual({ scale: 1, tx: 0, ty: 0 });
  });

  test("clamps zoom to the legacy 5% through 4000% range", () => {
    expect(zoomAt({ scale: 1, tx: 0, ty: 0 }, 100, 0, 0).scale).toBe(40);
    expect(zoomAt({ scale: 1, tx: 0, ty: 0 }, 0.001, 0, 0).scale).toBe(0.05);
  });

  test("fits content with the legacy 92% margin and centers it", () => {
    expect(fitViewport(
      { width: 1000, height: 500 },
      { width: 500, height: 500 },
    )).toEqual({ scale: 0.46, tx: 20, ty: 135 });
  });

  test.each([
    [{ width: 0, height: 500 }, { width: 500, height: 500 }],
    [{ width: 1000, height: 0 }, { width: 500, height: 500 }],
    [{ width: 1000, height: 500 }, { width: 0, height: 500 }],
  ])("does not invent a transform for empty content or containers", (content, container) => {
    expect(fitViewport(content, container)).toBeNull();
  });
});

describe("viewer controller", () => {
  test("returns defensive view copies and applies the fitted transform", () => {
    const { controller, out, zoomLabel, onTransform } = viewerHarness();

    controller.fit();

    expect(out.style.transform).toBe("translate(20px,135px) scale(0.46)");
    expect(zoomLabel.textContent).toBe("46%");
    expect(onTransform).toHaveBeenLastCalledWith({ scale: 0.46, tx: 20, ty: 135 });
    const leaked = controller.getView();
    leaked.scale = 99;
    expect(controller.getView()).toEqual({ scale: 0.46, tx: 20, ty: 135 });
  });

  test("pans on pointer movement, cancels capture, and publishes transforms", () => {
    const { controller, wrap, onTransform } = viewerHarness();
    const down = { pointerId: 7, button: 0, clientX: 100, clientY: 80 };

    controller.handlePointerDown(down);
    controller.handlePointerMove({ pointerId: 7, clientX: 130, clientY: 100 });

    expect(controller.getView()).toEqual({ scale: 1, tx: 30, ty: 20 });
    expect(onTransform).toHaveBeenLastCalledWith({ scale: 1, tx: 30, ty: 20 });
    expect(wrap.classList.contains("panning")).toBe(true);
    controller.handlePointerCancel({ pointerId: 7 });
    expect(wrap.classList.contains("panning")).toBe(false);
    expect(wrap.releasePointerCapture).toHaveBeenCalledWith(7);

    controller.handlePointerMove({ pointerId: 7, clientX: 160, clientY: 120 });
    expect(controller.getView()).toEqual({ scale: 1, tx: 30, ty: 20 });
  });

  test("keeps the current view when resize requests an overlay refresh", () => {
    const { controller, out, onTransform } = viewerHarness();
    controller.fit();
    onTransform.mockClear();

    controller.handleResize({ type: "resize" });

    expect(controller.getView()).toEqual({ scale: 0.46, tx: 20, ty: 135 });
    expect(out.style.transform).toBe("translate(20px,135px) scale(0.46)");
    expect(onTransform).toHaveBeenCalledWith({ scale: 0.46, tx: 20, ty: 135 });
  });
});
