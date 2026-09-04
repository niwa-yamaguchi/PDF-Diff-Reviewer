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
    selectedIndex: 0,
    view: { scale: 2, tx: 5, ty: 7 },
    showBoxes: true,
    editMode: true,
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
    selectedIndex: -1,
    view: { scale: 2, tx: 10, ty: 20 },
    showBoxes: true,
    editMode: true,
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
    selectedIndex: -1,
    view: { scale: 2, tx: 10, ty: 20 },
    showBoxes: true,
    editMode: true,
    drag: { kind: "create", page: 0, x0: 10, y0: 20, x1: 5, y1: 8 },
    currentPage: 0,
    rendered: true,
    outputVisible: true,
  });
  expect(context.strokeRect).toHaveBeenCalledWith(20, 36, 10, 24);
  expect(visualContext.clearRect).not.toHaveBeenCalled();
  expect(visualContext.strokeRect).not.toHaveBeenCalled();
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
    selectedIndex: 0,
    view: { scale: 1, tx: 0, ty: 0 },
    editMode: true,
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
      currentBoxes: [], selectedIndex: -1, showBoxes: true,
      editMode: false, drag: null, editsByPage: new Map(),
    },
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
      boxEdit: { classList }, boxDelete: { style: {} }, boxReset: { style: {} },
    },
    getView: () => ({ scale: 2, tx: 10, ty: 20 }),
  });

  view.redraw();

  expect(canvas.width).toBe(640);
  expect(canvas.height).toBe(480);
  expect(context.clearRect).toHaveBeenCalledWith(0, 0, 640, 480);
});

test("the browser view converts native client coordinates even when PointerEvent exposes x and y aliases", () => {
  const { canvas } = canvasHarness();
  const classList = { toggle: vi.fn() };
  const view = createBoxEditorView({
    state: {
      documents: { currentPage: 0 }, visual: { mode: "diff", rendered: true },
      boxEditor: { currentBoxes: [], selectedIndex: -1, showBoxes: true, editMode: false, drag: null, editsByPage: new Map() },
    },
    dom: {
      canvas, out: { style: { display: "block" } },
      wrap: {
        clientWidth: 640, clientHeight: 480, style: {}, classList,
        getBoundingClientRect: () => ({ left: 100, top: 50 }),
      },
      statBox: { textContent: "" }, boxToggle: { classList },
      boxEdit: { classList }, boxDelete: { style: {} }, boxReset: { style: {} },
    },
    getView: () => ({ scale: 2, tx: 10, ty: 20 }),
  });

  expect(view.toImagePoint({ clientX: 150, clientY: 110, x: 150, y: 110 })).toEqual({ x: 20, y: 20 });
});

test("split mode forces the box toggle active and disables box controls without mutating preference", () => {
  const { canvas } = canvasHarness();
  const toggleClassList = { toggle: vi.fn() };
  const state = {
    documents: { currentPage: 0 },
    visual: { mode: "split", rendered: true },
    boxEditor: {
      currentBoxes: [], selectedIndex: -1, showBoxes: false,
      editMode: false, drag: null, editsByPage: new Map(),
    },
  };
  const dom = {
    canvas,
    out: { style: { display: "none" } },
    wrap: {
      clientWidth: 640, clientHeight: 480, style: {},
      classList: { toggle: vi.fn() },
    },
    statBox: { textContent: "" },
    boxToggle: { disabled: false, classList: toggleClassList },
    boxEdit: { disabled: false, classList: { toggle: vi.fn() } },
    boxDelete: { disabled: false, style: {} },
    boxReset: { disabled: false, style: {} },
  };
  const view = createBoxEditorView({
    state,
    dom,
    getView: () => ({ scale: 1, tx: 0, ty: 0 }),
  });

  view.updateControls();

  expect(dom.boxToggle.disabled).toBe(true);
  expect(dom.boxEdit.disabled).toBe(true);
  expect(toggleClassList.toggle).toHaveBeenCalledWith("active", true);
  expect(state.boxEditor.showBoxes).toBe(false);
});
