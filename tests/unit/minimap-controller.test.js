import { expect, test, vi } from "vitest";
import { createMinimapController } from "../../src/features/viewer/minimap-controller.js";
import { fitViewport } from "../../src/features/viewer/viewport.js";

function drawingContext() {
  return {
    drawImage: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    stroke: vi.fn(),
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 1,
  };
}

function pointerAt(x, y, canvas) {
  return {
    offsetX: x,
    offsetY: y,
    clientX: x,
    clientY: y,
    pointerId: 1,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    currentTarget: canvas,
  };
}

function harness({ drawImageImpl } = {}) {
  const baseContext = drawingContext();
  if (drawImageImpl) baseContext.drawImage.mockImplementation(drawImageImpl);
  const displayContext = drawingContext();
  const createCanvas = vi.fn((width, height) => ({
    width,
    height,
    getContext: () => baseContext,
  }));
  const source = { width: 1000, height: 500 };
  const canvas = {
    width: 180,
    height: 140,
    getContext: () => displayContext,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 180, height: 140 }),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  };
  const wrap = { clientWidth: 500, clientHeight: 500 };
  const root = { hidden: true };
  const viewport = { width: wrap.clientWidth, height: wrap.clientHeight };
  const fitScale = fitViewport(source, viewport).scale;
  let view = { scale: fitScale, tx: 20, ty: 135 };
  const applyView = vi.fn(next => { view = { ...next }; });
  const state = {
    visual: { rendered: true },
    documents: { currentPage: 0 },
    review: { selectedId: null },
    boxEditor: { currentBoxes: [] },
  };
  const colors = {
    amber: "#f4b942",
    added: "#4d8dff",
    removed: "#ff5b57",
    changed: "#e8b500",
  };
  const controller = createMinimapController({
    state,
    dom: { root, canvas, source, wrap },
    colors,
    createCanvas,
    getView: () => ({ ...view }),
    applyView,
  });
  const viewer = {
    apply(next) { view = { ...next }; },
  };
  return {
    controller, state, view, applyView, viewer, fitScale, baseContext, displayContext,
    canvas, root, colors, pointerAt: (x, y) => pointerAt(x, y, canvas),
  };
}

test("hides until zoom exceeds fit, downscales once, then pans from a click", () => {
  const { controller, viewer, fitScale, applyView, baseContext, root, pointerAt } = harness();

  controller.render();
  expect(root.hidden).toBe(true);
  viewer.apply({ scale: fitScale * 1.02, tx: -10, ty: -20 });
  controller.refreshSource();
  expect(root.hidden).toBe(false);
  expect(baseContext.drawImage).toHaveBeenCalledWith(
    expect.objectContaining({ width: 1000, height: 500 }),
    0, 25, 180, 90,
  );
  controller.render();
  expect(baseContext.drawImage).toHaveBeenCalledTimes(1);
  controller.pointerDown(pointerAt(90, 70));
  expect(applyView).toHaveBeenCalledWith(expect.objectContaining({ scale: fitScale * 1.02 }));
});

test("draws the selected box in its kind color only when it is on the current page", () => {
  const { controller, viewer, fitScale, displayContext, state, colors } = harness();
  viewer.apply({ scale: fitScale * 1.02, tx: -10, ty: -20 });
  controller.refreshSource();
  displayContext.strokeRect.mockClear();
  state.review.selectedId = "change-1";
  state.boxEditor.currentBoxes = [
    { id: "change-1", x: 100, y: 50, w: 200, h: 100, kind: "added" },
  ];

  controller.render();
  expect(displayContext.strokeStyle).toBe(colors.added);
  expect(displayContext.strokeRect).toHaveBeenCalledWith(18, 34, 36, 18);

  displayContext.strokeRect.mockClear();
  state.review.selectedId = "change-other-page";
  controller.render();
  expect(displayContext.strokeRect).not.toHaveBeenCalledWith(18, 34, 36, 18);
});

test("hides after a draw failure without throwing into viewer interaction", () => {
  const { controller, viewer, fitScale, root } = harness({
    drawImageImpl: () => { throw new Error("tainted canvas"); },
  });
  viewer.apply({ scale: fitScale * 1.02, tx: -10, ty: -20 });
  expect(() => controller.refreshSource()).not.toThrow();
  expect(root.hidden).toBe(true);
});

test("pointer events stop viewer pan and release capture on up and cancel", () => {
  const { controller, viewer, fitScale, applyView, canvas, pointerAt } = harness();
  viewer.apply({ scale: fitScale * 1.02, tx: -10, ty: -20 });
  controller.refreshSource();
  const down = pointerAt(90, 70);
  controller.pointerDown(down);
  expect(down.preventDefault).toHaveBeenCalled();
  expect(down.stopPropagation).toHaveBeenCalled();
  expect(canvas.setPointerCapture).toHaveBeenCalledWith(1);
  applyView.mockClear();
  const move = pointerAt(40, 40);
  controller.pointerMove(move);
  expect(move.preventDefault).toHaveBeenCalled();
  expect(move.stopPropagation).toHaveBeenCalled();
  expect(applyView).toHaveBeenCalled();
  const up = pointerAt(40, 40);
  controller.pointerUp(up);
  expect(canvas.releasePointerCapture).toHaveBeenCalledWith(1);
  applyView.mockClear();
  controller.pointerMove(pointerAt(10, 10));
  expect(applyView).not.toHaveBeenCalled();
  controller.pointerDown(pointerAt(90, 70));
  const cancel = pointerAt(90, 70);
  controller.pointerCancel(cancel);
  expect(cancel.preventDefault).toHaveBeenCalled();
  expect(cancel.stopPropagation).toHaveBeenCalled();
  expect(canvas.releasePointerCapture).toHaveBeenCalledTimes(2);
});
