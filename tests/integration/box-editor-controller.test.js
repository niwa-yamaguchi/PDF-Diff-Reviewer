import { describe, expect, test, vi } from "vitest";
import { createAppState } from "../../src/app/state.js";
import { createBoxEditorController } from "../../src/features/box-editor/box-editor-controller.js";

function harness({ boxes = [], scale = 1, width = 100, height = 100 } = {}) {
  const state = createAppState();
  state.documents.currentPage = 0;
  state.visual.rendered = true;
  state.boxEditor.editMode = true;
  state.boxEditor.currentBoxes = boxes.map(box => ({ ...box }));
  state.boxEditor.autoByPage.set(0, boxes.map(box => ({ ...box })));
  const view = {
    toImagePoint: point => ({ x: point.x, y: point.y }),
    getScale: () => scale,
    getFrameSize: () => ({ width, height }),
    redraw: vi.fn(),
    refresh: vi.fn(),
    setCursor: vi.fn(),
    capturePointer: vi.fn(),
    releasePointer: vi.fn(),
  };
  const confirmDiscard = vi.fn(() => true);
  const controller = createBoxEditorController({ state, dom: {}, view, confirmDiscard });
  return { state, view, confirmDiscard, controller };
}

function drag(controller, from, to, pointerId = 1) {
  controller.pointerDown({ ...from, pointerId, button: 0, preventDefault() {} });
  controller.pointerMove({ ...to, pointerId });
  controller.pointerUp({ ...to, pointerId });
}

test("cancelled create cannot commit on a later pointerup", () => {
  const { state, controller } = harness();

  controller.pointerDown({ x: 10, y: 10, pointerId: 1, button: 0, preventDefault() {} });
  controller.cancelDrag();
  controller.pointerUp({ x: 50, y: 50, pointerId: 1 });

  expect(state.boxEditor.editsByPage.size).toBe(0);
  expect(state.boxEditor.drag).toBeNull();
});

test("reverse create normalizes and clamps the committed box, then undo restores a clone", () => {
  const { state, controller } = harness({ boxes: [{ x: 1, y: 1, w: 5, h: 5 }] });

  drag(controller, { x: 120, y: 110 }, { x: 80, y: 70 });

  expect(state.boxEditor.editsByPage.get(0)).toEqual([
    { x: 1, y: 1, w: 5, h: 5 },
    { x: 80, y: 70, w: 20, h: 30 },
  ]);
  expect(state.boxEditor.selectedIndex).toBe(1);
  controller.undo();
  expect(state.boxEditor.editsByPage.get(0)).toEqual([{ x: 1, y: 1, w: 5, h: 5 }]);
  state.boxEditor.currentBoxes[0].x = 88;
  expect(state.boxEditor.autoByPage.get(0)[0].x).toBe(1);
});

test("selects the topmost box and a click without movement adds no undo snapshot", () => {
  const { state, controller } = harness({ boxes: [
    { x: 10, y: 10, w: 50, h: 50 },
    { x: 20, y: 20, w: 50, h: 50 },
  ] });

  controller.pointerDown({ x: 30, y: 30, pointerId: 1, button: 0, preventDefault() {} });
  controller.pointerUp({ x: 30, y: 30, pointerId: 1 });

  expect(state.boxEditor.selectedIndex).toBe(1);
  expect(state.boxEditor.editsByPage.size).toBe(0);
  expect(state.boxEditor.undoByPage.size).toBe(0);
});

test("moves a box without changing its size and clamps it inside the frame", () => {
  const { state, controller } = harness({ boxes: [{ x: 20, y: 30, w: 30, h: 20 }] });

  drag(controller, { x: 30, y: 40 }, { x: 200, y: 200 });

  expect(state.boxEditor.editsByPage.get(0)).toEqual([{ x: 70, y: 80, w: 30, h: 20 }]);
  expect(state.boxEditor.undoByPage.get(0).size).toBe(1);
});

describe.each([
  ["north-west", { x: 20, y: 20 }, { x: 10, y: 12 }, { x: 10, y: 12, w: 50, h: 48 }],
  ["north", { x: 40, y: 20 }, { x: 40, y: 12 }, { x: 20, y: 12, w: 40, h: 48 }],
  ["north-east", { x: 60, y: 20 }, { x: 70, y: 12 }, { x: 20, y: 12, w: 50, h: 48 }],
  ["east", { x: 60, y: 40 }, { x: 70, y: 40 }, { x: 20, y: 20, w: 50, h: 40 }],
  ["south-east", { x: 60, y: 60 }, { x: 70, y: 75 }, { x: 20, y: 20, w: 50, h: 55 }],
  ["south", { x: 40, y: 60 }, { x: 40, y: 75 }, { x: 20, y: 20, w: 40, h: 55 }],
  ["south-west", { x: 20, y: 60 }, { x: 10, y: 75 }, { x: 10, y: 20, w: 50, h: 55 }],
  ["west", { x: 20, y: 40 }, { x: 10, y: 40 }, { x: 10, y: 20, w: 50, h: 40 }],
])("resize handle", (name, from, to, expected) => {
  test(`${name} commits the expected normalized rectangle`, () => {
    const { state, controller } = harness({ boxes: [{ x: 20, y: 20, w: 40, h: 40 }] });
    state.boxEditor.selectedIndex = 0;

    drag(controller, from, to);

    expect(state.boxEditor.editsByPage.get(0)).toEqual([expected]);
  });
});

test("too-small create and resize plus right-click do not materialize edits or history", () => {
  const created = harness({ scale: 2 });
  drag(created.controller, { x: 10, y: 10 }, { x: 11, y: 20 });
  created.controller.pointerDown({ x: 10, y: 10, pointerId: 2, button: 2, preventDefault() {} });
  expect(created.state.boxEditor.editsByPage.size).toBe(0);
  expect(created.state.boxEditor.undoByPage.size).toBe(0);

  const resized = harness({ boxes: [{ x: 20, y: 20, w: 40, h: 40 }], scale: 1 });
  resized.state.boxEditor.selectedIndex = 0;
  drag(resized.controller, { x: 60, y: 40 }, { x: 22, y: 40 });
  expect(resized.state.boxEditor.editsByPage.size).toBe(0);
  expect(resized.state.boxEditor.currentBoxes).toEqual([{ x: 20, y: 20, w: 40, h: 40 }]);
});

test("ignores movement, pointerup, and cancellation from another pointer", () => {
  const { state, controller } = harness();
  controller.pointerDown({ x: 10, y: 10, pointerId: 7, button: 0, preventDefault() {} });

  controller.pointerMove({ x: 50, y: 50, pointerId: 8 });
  controller.pointerCancel({ pointerId: 8 });
  controller.pointerUp({ x: 50, y: 50, pointerId: 8 });

  expect(state.boxEditor.drag).toMatchObject({ pointerId: 7, x1: 10, y1: 10 });
  expect(state.boxEditor.editsByPage.size).toBe(0);
  controller.pointerMove({ x: 50, y: 50, pointerId: 7 });
  controller.pointerUp({ x: 50, y: 50, pointerId: 7 });
  expect(state.boxEditor.editsByPage.get(0)).toEqual([{ x: 10, y: 10, w: 40, h: 40 }]);
});

test("does not commit a create or target operation after the page changes", () => {
  const created = harness();
  created.controller.pointerDown({ x: 10, y: 10, pointerId: 1, button: 0, preventDefault() {} });
  created.controller.pointerMove({ x: 50, y: 50, pointerId: 1 });
  created.state.documents.currentPage = 1;
  created.controller.pointerUp({ x: 50, y: 50, pointerId: 1 });
  expect(created.state.boxEditor.editsByPage.size).toBe(0);

  const moved = harness({ boxes: [{ x: 10, y: 10, w: 20, h: 20 }] });
  moved.controller.pointerDown({ x: 15, y: 15, pointerId: 2, button: 0, preventDefault() {} });
  moved.controller.pointerMove({ x: 40, y: 40, pointerId: 2 });
  moved.state.documents.currentPage = 1;
  moved.controller.pointerUp({ x: 40, y: 40, pointerId: 2 });
  expect(moved.state.boxEditor.editsByPage.size).toBe(0);
});

test("delete, undo, reset-to-auto, and page histories remain page-local", () => {
  const { state, controller } = harness({ boxes: [{ x: 10, y: 10, w: 20, h: 20 }] });
  state.boxEditor.selectedIndex = 0;
  controller.deleteSelected();
  expect(state.boxEditor.editsByPage.get(0)).toEqual([]);
  controller.undo();
  expect(state.boxEditor.editsByPage.get(0)).toEqual([{ x: 10, y: 10, w: 20, h: 20 }]);

  state.documents.currentPage = 1;
  state.boxEditor.currentBoxes = [];
  state.boxEditor.autoByPage.set(1, []);
  drag(controller, { x: 40, y: 40 }, { x: 60, y: 60 }, 2);
  expect(state.boxEditor.undoByPage.get(1).size).toBe(1);
  controller.undo();
  expect(state.boxEditor.editsByPage.get(1)).toEqual([]);
  expect(state.boxEditor.editsByPage.get(0)).toEqual([{ x: 10, y: 10, w: 20, h: 20 }]);

  state.documents.currentPage = 0;
  state.boxEditor.currentBoxes = state.boxEditor.editsByPage.get(0);
  expect(controller.resetToAuto()).toBe(true);
  expect(state.boxEditor.editsByPage.has(0)).toBe(false);
  expect(state.boxEditor.undoByPage.has(0)).toBe(false);
  expect(state.boxEditor.currentBoxes).toBe(state.boxEditor.autoByPage.get(0));
});

test("discard confirmation and clear edits preserve cancellation and clear all derived editor state", () => {
  const { state, controller, confirmDiscard } = harness({ boxes: [] });
  state.boxEditor.editsByPage.set(0, []);
  confirmDiscard.mockReturnValue(false);
  expect(controller.confirmDiscard()).toBe(false);
  expect(state.boxEditor.editsByPage.has(0)).toBe(true);

  confirmDiscard.mockReturnValue(true);
  expect(controller.confirmDiscard()).toBe(true);
  controller.clearEdits();
  expect(state.boxEditor.editsByPage.size).toBe(0);
  expect(state.boxEditor.undoByPage.size).toBe(0);
  expect(state.boxEditor.selectedIndex).toBe(-1);
  expect(state.boxEditor.drag).toBeNull();
});
