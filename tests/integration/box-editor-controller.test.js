import { describe, expect, test, vi } from "vitest";
import { createAppState } from "../../src/app/state.js";
import { createBoxEditorController } from "../../src/features/box-editor/box-editor-controller.js";

function harness({
  boxes = [],
  scale = 1,
  width = 100,
  height = 100,
  onBoxesChanged,
} = {}) {
  const state = createAppState();
  state.documents.currentPage = 0;
  state.visual.rendered = true;
  state.boxEditor.mode = "edit";
  const identified = boxes.map((box, index) => ({ id: `box-${index + 1}`, ...box }));
  state.boxEditor.currentBoxes = identified.map(box => ({ ...box }));
  state.boxEditor.autoByPage.set(0, identified.map(box => ({ ...box })));
  state.review.selectedId = identified[0]?.id ?? null;
  state.review.itemsByPage.set(0, identified.map(box => ({ ...box, pageIndex: 0 })));
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
  const controller = createBoxEditorController({
    state,
    dom: {},
    view,
    confirmDiscard,
    onBoxesChanged,
  });
  return { state, view, confirmDiscard, controller };
}

function drag(controller, from, to, pointerId = 1) {
  controller.pointerDown({ ...from, pointerId, button: 0, preventDefault() {} });
  controller.pointerMove({ ...to, pointerId });
  controller.pointerUp({ ...to, pointerId });
}

test("startEdit moves only the selected ID and ignores blank drags", () => {
  const boxes = [
    { id: "a", x: 10, y: 10, w: 20, h: 20 },
    { id: "b", x: 50, y: 50, w: 20, h: 20 },
  ];
  const { state, controller } = harness({ boxes });

  state.review.selectedId = "b";
  expect(controller.startEdit("b")).toBe(true);
  expect(state.boxEditor.mode).toBe("edit");
  drag(controller, { x: 65, y: 65 }, { x: 75, y: 70 });
  expect(state.boxEditor.currentBoxes).toEqual([
    { id: "a", x: 10, y: 10, w: 20, h: 20 },
    { id: "b", x: 60, y: 55, w: 20, h: 20 },
  ]);

  drag(controller, { x: 2, y: 2 }, { x: 20, y: 20 });
  expect(state.boxEditor.currentBoxes).toHaveLength(2);
});

test("deleteById updates only the hidden page history and publishes its list sync", () => {
  const visible = { id: "visible", x: 10, y: 10, w: 20, h: 20 };
  const hiddenA = { id: "hidden-a", x: 30, y: 30, w: 20, h: 20 };
  const hiddenB = { id: "hidden-b", x: 60, y: 60, w: 20, h: 20 };
  const onBoxesChanged = vi.fn();
  const { state, controller } = harness({ boxes: [visible], onBoxesChanged });
  const visibleBoxes = state.boxEditor.currentBoxes;
  state.boxEditor.autoByPage.set(1, [hiddenA, hiddenB]);
  state.review.itemsByPage.set(0, [{ ...visible, pageIndex: 0 }]);
  state.review.itemsByPage.set(1, [
    { ...hiddenA, pageIndex: 1 },
    { ...hiddenB, pageIndex: 1 },
  ]);

  expect(controller.deleteById("hidden-b")).toBe(true);

  expect(state.boxEditor.currentBoxes).toBe(visibleBoxes);
  expect(state.boxEditor.editsByPage.get(1)).toEqual([hiddenA]);
  expect(state.boxEditor.undoByPage.get(1).size).toBe(1);
  expect(state.boxEditor.undoByPage.has(0)).toBe(false);
  expect(state.boxEditor.revisionByPage.get(1)).toBe(1);
  expect(onBoxesChanged).toHaveBeenCalledOnce();
  expect(onBoxesChanged).toHaveBeenCalledWith({
    pageIndex: 1,
    boxes: [hiddenA],
    reason: "delete",
  });
});

test("preserves review metadata while moving and restoring a deleted reviewed box", () => {
  const onBoxesChanged = vi.fn();
  const reviewed = {
    x: 10, y: 10, w: 20, h: 20,
    id: "change-7", kind: "added", source: "auto",
  };
  const { state, controller } = harness({ boxes: [reviewed], onBoxesChanged });

  drag(controller, { x: 15, y: 15 }, { x: 30, y: 30 });
  expect(state.boxEditor.currentBoxes[0]).toMatchObject({
    id: "change-7", kind: "added", source: "auto",
  });
  expect(onBoxesChanged).toHaveBeenLastCalledWith({
    pageIndex: 0,
    boxes: [{ x: 25, y: 25, w: 20, h: 20, id: "change-7", kind: "added", source: "auto" }],
    reason: "move",
  });

  controller.deleteById("change-7");
  controller.undo();
  expect(state.boxEditor.currentBoxes[0]).toMatchObject({
    id: "change-7", kind: "added", source: "auto",
  });
  expect(onBoxesChanged).toHaveBeenLastCalledWith(expect.objectContaining({
    pageIndex: 0,
    boxes: [expect.objectContaining({ id: "change-7", kind: "added", source: "auto" })],
    reason: "undo",
  }));
});

test("publishes delete, reset-to-auto, and all-edit discard with page-local boxes", () => {
  const onBoxesChanged = vi.fn();
  const reviewed = {
    x: 10, y: 10, w: 20, h: 20,
    id: "change-1", kind: "removed", source: "auto",
  };
  const { state, controller } = harness({ boxes: [reviewed], onBoxesChanged });

  controller.deleteById("change-1");
  expect(onBoxesChanged).toHaveBeenLastCalledWith({ pageIndex: 0, boxes: [], reason: "delete" });

  controller.undo();
  controller.resetToAuto();
  expect(onBoxesChanged).toHaveBeenLastCalledWith({
    pageIndex: 0,
    boxes: [reviewed],
    reason: "reset",
  });

  state.boxEditor.editsByPage.set(0, [{ ...reviewed, x: 30 }]);
  state.boxEditor.editsByPage.set(1, [{
    x: 5, y: 5, w: 10, h: 10,
    id: "change-2", kind: "added", source: "auto",
  }]);
  state.boxEditor.autoByPage.set(1, [{
    x: 6, y: 6, w: 10, h: 10,
    id: "change-2", kind: "added", source: "auto",
  }]);
  controller.clearEdits();

  expect(onBoxesChanged).toHaveBeenCalledWith({
    pageIndex: 0,
    boxes: [reviewed],
    reason: "discard",
  });
  expect(onBoxesChanged).toHaveBeenLastCalledWith({
    pageIndex: 1,
    boxes: [{
      x: 6, y: 6, w: 10, h: 10,
      id: "change-2", kind: "added", source: "auto",
    }],
    reason: "discard",
  });
});

test("cancelled move cannot commit on a later pointerup", () => {
  const { state, controller } = harness({ boxes: [{ x: 10, y: 10, w: 20, h: 20 }] });

  controller.pointerDown({ x: 15, y: 15, pointerId: 1, button: 0, preventDefault() {} });
  controller.pointerMove({ x: 25, y: 25, pointerId: 1 });
  controller.cancelDrag();
  controller.pointerUp({ x: 50, y: 50, pointerId: 1 });

  expect(state.boxEditor.editsByPage.size).toBe(0);
  expect(state.boxEditor.drag).toBeNull();
});

test("clicking an unselected box or blank space does not change the edit target or history", () => {
  const { state, controller } = harness({ boxes: [
    { x: 10, y: 10, w: 50, h: 50 },
    { x: 20, y: 20, w: 50, h: 50 },
  ] });

  expect(controller.pointerDown({ x: 65, y: 65, pointerId: 1, button: 0, preventDefault() {} })).toBe(false);
  expect(controller.pointerDown({ x: 90, y: 90, pointerId: 2, button: 0, preventDefault() {} })).toBe(false);

  expect(state.review.selectedId).toBe("box-1");
  expect(state.boxEditor.drag).toBeNull();
  expect(state.boxEditor.editsByPage.size).toBe(0);
  expect(state.boxEditor.undoByPage.size).toBe(0);
  expect(state.boxEditor.revisionByPage.size).toBe(0);
});

test("moves a box without changing its size and clamps it inside the frame", () => {
  const { state, controller } = harness({ boxes: [{ x: 20, y: 30, w: 30, h: 20 }] });

  drag(controller, { x: 30, y: 40 }, { x: 200, y: 200 });

  expect(state.boxEditor.editsByPage.get(0)).toEqual([
    { id: "box-1", x: 70, y: 80, w: 30, h: 20 },
  ]);
  expect(state.boxEditor.undoByPage.get(0).size).toBe(1);
  expect(state.boxEditor.revisionByPage.get(0)).toBe(1);
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
    drag(controller, from, to);

    expect(state.boxEditor.editsByPage.get(0)).toEqual([{ id: "box-1", ...expected }]);
    expect(state.boxEditor.revisionByPage.get(0)).toBe(1);
  });
});

test("too-small resize and right-click do not materialize edits or history", () => {
  const resized = harness({ boxes: [{ x: 20, y: 20, w: 40, h: 40 }], scale: 1 });
  resized.controller.pointerDown({ x: 30, y: 30, pointerId: 2, button: 2, preventDefault() {} });
  drag(resized.controller, { x: 60, y: 40 }, { x: 22, y: 40 });
  expect(resized.state.boxEditor.editsByPage.size).toBe(0);
  expect(resized.state.boxEditor.currentBoxes).toEqual([
    { id: "box-1", x: 20, y: 20, w: 40, h: 40 },
  ]);
  expect(resized.state.boxEditor.revisionByPage.size).toBe(0);
});

test("ignores movement, pointerup, and cancellation from another pointer", () => {
  const { state, controller } = harness({ boxes: [{ x: 10, y: 10, w: 20, h: 20 }] });
  controller.pointerDown({ x: 15, y: 15, pointerId: 7, button: 0, preventDefault() {} });

  controller.pointerMove({ x: 50, y: 50, pointerId: 8 });
  controller.pointerCancel({ pointerId: 8 });
  controller.pointerUp({ x: 50, y: 50, pointerId: 8 });

  expect(state.boxEditor.drag).toMatchObject({ pointerId: 7, kind: "move" });
  expect(state.boxEditor.editsByPage.size).toBe(0);
  controller.pointerMove({ x: 50, y: 50, pointerId: 7 });
  controller.pointerUp({ x: 50, y: 50, pointerId: 7 });
  expect(state.boxEditor.editsByPage.get(0)).toEqual([
    { id: "box-1", x: 45, y: 45, w: 20, h: 20 },
  ]);
  expect(state.boxEditor.revisionByPage.get(0)).toBe(1);
});

test("does not commit a target operation after the page changes", () => {
  const moved = harness({ boxes: [{ x: 10, y: 10, w: 20, h: 20 }] });
  moved.controller.pointerDown({ x: 15, y: 15, pointerId: 2, button: 0, preventDefault() {} });
  moved.controller.pointerMove({ x: 40, y: 40, pointerId: 2 });
  moved.state.documents.currentPage = 1;
  moved.controller.pointerUp({ x: 40, y: 40, pointerId: 2 });
  expect(moved.state.boxEditor.editsByPage.size).toBe(0);
  expect(moved.state.boxEditor.revisionByPage.size).toBe(0);
});

test("delete, undo, reset-to-auto, and page histories remain page-local", () => {
  const { state, controller } = harness({ boxes: [{ x: 10, y: 10, w: 20, h: 20 }] });
  controller.deleteById("box-1");
  expect(state.boxEditor.editsByPage.get(0)).toEqual([]);
  expect(state.boxEditor.revisionByPage.get(0)).toBe(1);
  controller.undo();
  expect(state.boxEditor.editsByPage.get(0)).toEqual([
    { id: "box-1", x: 10, y: 10, w: 20, h: 20 },
  ]);
  expect(state.boxEditor.revisionByPage.get(0)).toBe(2);

  state.documents.currentPage = 1;
  state.boxEditor.currentBoxes = [{ id: "box-2", x: 40, y: 40, w: 20, h: 20 }];
  state.boxEditor.autoByPage.set(1, [{ id: "box-2", x: 40, y: 40, w: 20, h: 20 }]);
  state.review.itemsByPage.set(1, [{ id: "box-2", pageIndex: 1, x: 40, y: 40, w: 20, h: 20 }]);
  expect(controller.startEdit("box-2")).toBe(true);
  drag(controller, { x: 50, y: 50 }, { x: 60, y: 60 }, 2);
  expect(state.boxEditor.undoByPage.get(1).size).toBe(1);
  expect(state.boxEditor.revisionByPage.get(1)).toBe(1);
  controller.undo();
  expect(state.boxEditor.editsByPage.get(1)).toEqual([
    { id: "box-2", x: 40, y: 40, w: 20, h: 20 },
  ]);
  expect(state.boxEditor.revisionByPage.get(1)).toBe(2);
  expect(state.boxEditor.editsByPage.get(0)).toEqual([
    { id: "box-1", x: 10, y: 10, w: 20, h: 20 },
  ]);

  state.documents.currentPage = 0;
  state.boxEditor.currentBoxes = state.boxEditor.editsByPage.get(0);
  expect(controller.resetToAuto()).toBe(true);
  expect(state.boxEditor.editsByPage.has(0)).toBe(false);
  expect(state.boxEditor.undoByPage.has(0)).toBe(false);
  expect(state.boxEditor.currentBoxes).toBe(state.boxEditor.autoByPage.get(0));
  expect(state.boxEditor.revisionByPage.get(0)).toBe(3);
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
  expect(state.boxEditor.mode).toBe("idle");
  expect(state.boxEditor.drag).toBeNull();
  expect(state.boxEditor.revisionByPage.get(0)).toBe(1);
});
