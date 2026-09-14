import { expect, test, vi } from "vitest";
import {
  createBoxEditorView,
  drawBoxLayer,
} from "../../src/features/box-editor/box-editor-view.js";

function canvasHarness() {
  const context = {
    clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
    fillRect: vi.fn(), strokeRect: vi.fn(), setLineDash: vi.fn(),
  };
  const canvas = {
    width: 10,
    height: 10,
    clientWidth: 300,
    clientHeight: 200,
    getContext: () => context,
  };
  return { canvas, context };
}

test("sizes and clears the separate overlay then applies CSS-view coordinates with fixed-pixel handles", () => {
  const { canvas, context } = canvasHarness();

  drawBoxLayer({
    canvas,
    boxes: [{ x: 10, y: 20, w: 30, h: 40 }],
    activeIndex: 0,
    view: { scale: 2, tx: 5, ty: 7 },
    showBoxes: true,
    editing: true,
    drag: null,
    rendered: true,
    outputVisible: true,
  });

  expect(canvas.width).toBe(300);
  expect(canvas.height).toBe(200);
  expect(context.clearRect).toHaveBeenCalledWith(0, 0, 300, 200);
  expect(context.fillRect).toHaveBeenCalledWith(25, 47, 60, 80);
  expect(context.strokeRect).toHaveBeenCalledWith(26, 48, 58, 78);
  expect(context.fillRect).toHaveBeenCalledWith(20, 42, 10, 10);
});

test("draws move and create previews without touching the visual output canvas", () => {
  const { canvas, context } = canvasHarness();
  const visualContext = { clearRect: vi.fn(), strokeRect: vi.fn(), fillRect: vi.fn() };

  drawBoxLayer({
    canvas,
    boxes: [{ x: 1, y: 2, w: 3, h: 4 }],
    activeIndex: 0,
    view: { scale: 2, tx: 10, ty: 20 },
    showBoxes: true,
    editing: true,
    drag: { kind: "move", page: 0, i: 0, preview: { x: 5, y: 6, w: 7, h: 8 } },
    currentPage: 0,
    rendered: true,
    outputVisible: true,
  });
  expect(context.fillRect).toHaveBeenCalledWith(20, 32, 14, 16);

  context.strokeRect.mockClear();
  drawBoxLayer({
    canvas,
    boxes: [],
    activeIndex: -1,
    view: { scale: 2, tx: 10, ty: 20 },
    showBoxes: true,
    editing: true,
    drag: { kind: "create", page: 0, x0: 10, y0: 20, x1: 5, y1: 8 },
    currentPage: 0,
    rendered: true,
    outputVisible: true,
  });
  expect(context.strokeRect).toHaveBeenCalledWith(20, 36, 10, 24);
  expect(visualContext.clearRect).not.toHaveBeenCalled();
  expect(visualContext.strokeRect).not.toHaveBeenCalled();
});

test("draws review focus independently from edit selection and keeps handles on the edit selection", () => {
  const { canvas, context } = canvasHarness();

  drawBoxLayer({
    canvas,
    boxes: [
      { x: 10, y: 20, w: 30, h: 40, id: "change-1" },
      { x: 60, y: 70, w: 20, h: 10, id: "change-2" },
    ],
    activeIndex: 0,
    focusedIndex: 1,
    view: { scale: 1, tx: 0, ty: 0 },
    showBoxes: true,
    editing: true,
    drag: null,
    rendered: true,
    outputVisible: true,
  });

  expect(context.strokeRect).toHaveBeenCalledWith(58, 68, 24, 14);
  expect(context.fillRect).toHaveBeenCalledWith(5, 15, 10, 10);
  expect(context.fillRect).not.toHaveBeenCalledWith(55, 65, 10, 10);
});

test("labels boxes that have a review number, at a fixed screen font size", () => {
  const { canvas, context } = canvasHarness();
  Object.assign(context, { fillText: vi.fn(), measureText: text => ({ width: text.length * 6 }) });

  drawBoxLayer({
    canvas,
    boxes: [{ x: 10, y: 20, w: 30, h: 40, id: "change-1" }, { x: 1, y: 1, w: 2, h: 2 }],
    labels: new Map([["change-1", { number: 4, comment: "確認" }]]),
    view: { scale: 2, tx: 5, ty: 7 },
    showBoxes: true,
    editing: false,
    drag: null,
    rendered: true,
    outputVisible: true,
  });

  expect(context.fillText).toHaveBeenCalledOnce();
  expect(context.fillText.mock.calls[0][0]).toBe("4 確認");
  expect(context.font).toBe("bold 12px sans-serif");
});

test.each([
  { rendered: false, outputVisible: true, showBoxes: true },
  { rendered: true, outputVisible: false, showBoxes: true },
  { rendered: true, outputVisible: true, showBoxes: false },
])("clears but does not draw when visibility gate is closed: %o", gates => {
  const { canvas, context } = canvasHarness();
  drawBoxLayer({
    canvas,
    boxes: [{ x: 1, y: 2, w: 3, h: 4 }],
    activeIndex: 0,
    view: { scale: 1, tx: 0, ty: 0 },
    editing: true,
    drag: null,
    ...gates,
  });
  expect(context.clearRect).toHaveBeenCalledOnce();
  expect(context.fillRect).not.toHaveBeenCalled();
  expect(context.strokeRect).not.toHaveBeenCalled();
});

test("the browser view sizes the overlay from its wrap instead of the initial canvas bitmap", () => {
  const { canvas, context } = canvasHarness();
  canvas.clientWidth = 10;
  canvas.clientHeight = 10;
  const state = {
    documents: { currentPage: 0 },
    visual: { mode: "diff", rendered: true },
    boxEditor: {
      currentBoxes: [], showBoxes: true,
      mode: "idle", drag: null, editsByPage: new Map(),
    },
    review: { selectedId: null },
  };
  const classList = { toggle: vi.fn() };
  const view = createBoxEditorView({
    state,
    dom: {
      canvas,
      out: { style: { display: "block" } },
      wrap: {
        clientWidth: 640, clientHeight: 480, style: {}, classList,
        getBoundingClientRect: () => ({ left: 100, top: 50 }),
      },
      statBox: { textContent: "" }, boxToggle: { classList },
      boxReset: { style: {} },
    },
    getView: () => ({ scale: 2, tx: 10, ty: 20 }),
  });

  view.redraw();

  expect(canvas.width).toBe(640);
  expect(canvas.height).toBe(480);
  expect(context.clearRect).toHaveBeenCalledWith(0, 0, 640, 480);
});

test("the browser view maps the selected review id to the focused box", () => {
  const { canvas, context } = canvasHarness();
  const classList = { toggle: vi.fn() };
  const state = {
    documents: { currentPage: 0 },
    visual: { mode: "diff", rendered: true },
    boxEditor: {
      currentBoxes: [
        { x: 10, y: 10, w: 10, h: 10, id: "change-1" },
        { x: 50, y: 60, w: 20, h: 30, id: "change-2" },
      ],
      showBoxes: true,
      mode: "idle",
      drag: null,
      editsByPage: new Map(),
    },
    review: { selectedId: "change-2" },
  };
  const view = createBoxEditorView({
    state,
    dom: {
      canvas,
      out: { style: { display: "block" } },
      wrap: {
        clientWidth: 300, clientHeight: 200, style: {}, classList,
        getBoundingClientRect: () => ({ left: 0, top: 0 }),
      },
      statBox: { textContent: "" }, boxToggle: { classList }, boxReset: { style: {} },
    },
    getView: () => ({ scale: 1, tx: 0, ty: 0 }),
  });

  view.redraw();

  expect(context.strokeRect).toHaveBeenCalledWith(48, 58, 24, 34);
});

test("the browser view converts native client coordinates even when PointerEvent exposes x and y aliases", () => {
  const { canvas } = canvasHarness();
  const classList = { toggle: vi.fn() };
  const view = createBoxEditorView({
    state: {
      documents: { currentPage: 0 }, visual: { mode: "diff", rendered: true },
      boxEditor: { currentBoxes: [], showBoxes: true, mode: "idle", drag: null, editsByPage: new Map() },
      review: { selectedId: null },
    },
    dom: {
      canvas, out: { style: { display: "block" } },
      wrap: {
        clientWidth: 640, clientHeight: 480, style: {}, classList,
        getBoundingClientRect: () => ({ left: 100, top: 50 }),
      },
      statBox: { textContent: "" }, boxToggle: { classList }, boxReset: { style: {} },
    },
    getView: () => ({ scale: 2, tx: 10, ty: 20 }),
  });

  expect(view.toImagePoint({ clientX: 150, clientY: 110, x: 150, y: 110 })).toEqual({ x: 20, y: 20 });
});

// Break: styling a button as active does not expose the actual on/off state of the checkbox.
test("reflects change-box visibility in the highlight checkbox", () => {
  const { canvas } = canvasHarness();
  const state = {
    documents: { currentPage: 0 }, visual: { mode: "diff", rendered: true },
    boxEditor: { currentBoxes: [], showBoxes: false, mode: "idle", drag: null, editsByPage: new Map() },
    review: { selectedId: null },
  };
  const boxToggle = { checked: true, disabled: false, classList: { toggle() {} } };
  const view = createBoxEditorView({
    state,
    dom: {
      canvas, out: { style: { display: "block" } },
      wrap: { clientWidth: 640, clientHeight: 480, style: {}, classList: { toggle() {} } },
      statBox: { textContent: "" }, boxToggle, boxReset: { style: {} },
    },
    getView: () => ({ scale: 1, tx: 0, ty: 0 }),
  });

  view.refresh();
  expect(boxToggle.checked).toBe(false);
  state.boxEditor.showBoxes = true;
  view.refresh();
  expect(boxToggle.checked).toBe(true);
});
