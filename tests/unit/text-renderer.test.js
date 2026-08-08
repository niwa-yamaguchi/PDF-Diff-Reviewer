import { describe, expect, test, vi } from "vitest";
import {
  createTextRenderer,
  drawTokenHighlight,
  renderTextPage,
  renderTextPageOffscreen,
} from "../../src/features/text-review/text-renderer.js";

function classList() {
  const values = new Set();
  return {
    add: vi.fn(value => values.add(value)),
    remove: vi.fn(value => values.delete(value)),
    contains: value => values.has(value),
  };
}

function eventTarget({ width = 800, height = 600 } = {}) {
  const handlers = new Map();
  return {
    clientWidth: width,
    clientHeight: height,
    classList: classList(),
    addEventListener: vi.fn((type, handler) => handlers.set(type, handler)),
    emit(type, event = {}) { return handlers.get(type)?.(event); },
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  };
}

function canvas(width = 10, height = 10) {
  const context = {
    save: vi.fn(), restore: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(),
    clearRect: vi.fn(), drawImage: vi.fn(),
  };
  return { width, height, style: {}, getContext: () => context, context };
}

function page({ width = 100, height = 200, renderPromise = Promise.resolve() } = {}) {
  const viewport = { width, height, scale: 2, transform: [2, 0, 0, -2, 0, height] };
  return {
    getViewport: vi.fn(() => viewport),
    render: vi.fn(() => ({ promise: renderPromise })),
    viewport,
  };
}

function snapshot(overrides = {}) {
  return {
    ticket: { id: 1, documentGeneration: 2, pageIndex: 0 },
    documents: { old: { numPages: 1 }, new: { numPages: 1 } },
    scale: 2,
    highlights: { old: new Map(), new: new Map() },
    ...overrides,
  };
}

const transform = (left, right) => [
  left[0] * right[0] + left[2] * right[1],
  left[1] * right[0] + left[3] * right[1],
  left[0] * right[2] + left[2] * right[3],
  left[1] * right[2] + left[3] * right[3],
  left[0] * right[4] + left[2] * right[5] + left[4],
  left[1] * right[4] + left[3] * right[5] + left[5],
];
const colors = { removed: "#ff5b57", added: "#2e9b55", changed: "#ffd43b" };

describe("text page rendering", () => {
  test("draws exact highlight geometry and color", () => {
    const target = canvas();
    const viewport = { scale: 2, transform: [2, 0, 0, 2, 0, 0] };
    const token = { str: "AB", w: 10, transform: [1, 0, 0, 5, 3, 4], off: 0 };

    drawTokenHighlight({ context: target.context, viewport, token, colorKey: "removed", transform, colors });

    expect(target.context.fillStyle).toBe("#ff5b57");
    expect(target.context.fillRect).toHaveBeenCalledWith(6, 6, 20, 12);
    expect(target.context.strokeRect).toHaveBeenCalledWith(6.5, 6.5, 19, 11);
  });

  test("renders a page and highlights into only the provided canvas", async () => {
    const target = canvas();
    const pdfPage = page();
    const document = { numPages: 1, getPage: vi.fn().mockResolvedValue(pdfPage) };
    const token = { str: "A", w: 5, transform: [1, 0, 0, 5, 2, 3], off: 0 };
    const highlights = { old: new Map([[0, [{ token, color: "changed" }]]]), new: new Map() };

    const result = await renderTextPage({
      side: "old",
      pageIndex: 0,
      snapshot: snapshot({ documents: { old: document, new: null }, highlights }),
      canvas: target,
      transform,
      colors,
    });

    expect(result).toBe(target);
    expect(target.width).toBe(100);
    expect(target.height).toBe(200);
    expect(pdfPage.render).toHaveBeenCalledWith({ canvasContext: target.context, viewport: pdfPage.viewport });
    expect(target.context.fillStyle).toBe("#ffd43b");
  });

  test("returns a 10x10 white placeholder for a missing side or page", async () => {
    const target = canvas(50, 60);
    const result = await renderTextPage({
      side: "new", pageIndex: 4, snapshot: snapshot(), canvas: target, transform, colors,
    });
    expect(result).toBe(target);
    expect(target.width).toBe(10);
    expect(target.height).toBe(10);
    expect(target.context.fillStyle).toBe("#fff");
    expect(target.context.fillRect).toHaveBeenCalledWith(0, 0, 10, 10);
  });

  test("offscreen rendering allocates a separate canvas and mutates no screen/state inputs", async () => {
    const screen = canvas(33, 44);
    const created = canvas();
    const createCanvas = vi.fn(() => created);
    const pdfPage = page({ width: 120, height: 160 });
    const document = { numPages: 1, getPage: vi.fn().mockResolvedValue(pdfPage) };
    const stateSentinel = Object.freeze({ page: 3, generation: 9, view: Object.freeze({ scale: 4, tx: 5, ty: 6 }) });
    const shot = snapshot({ documents: { old: document, new: null }, stateSentinel });

    const result = await renderTextPageOffscreen({
      side: "old", pageIndex: 0, snapshot: shot, createCanvas, transform, colors,
    });

    expect(result).toBe(created);
    expect(result).not.toBe(screen);
    expect(screen).toMatchObject({ width: 33, height: 44 });
    expect(shot.stateSentinel).toEqual({ page: 3, generation: 9, view: { scale: 4, tx: 5, ty: 6 } });
    expect(createCanvas).toHaveBeenCalledWith(120, 160);
  });
});

describe("shared text viewport", () => {
  function harness() {
    const state = {
      ui: { topMode: "text" },
      textReview: { highlights: { old: new Map(), new: new Map() }, view: { scale: 1, tx: 0, ty: 0 } },
    };
    const oldCanvas = canvas(100, 200);
    const newCanvas = canvas(200, 100);
    const oldWrap = eventTarget({ width: 400, height: 300 });
    const newWrap = eventTarget({ width: 400, height: 300 });
    const renderer = createTextRenderer({
      state,
      dom: { oldTextCanvas: oldCanvas, newTextCanvas: newCanvas, oldWrap, newWrap },
      createCanvas: () => canvas(),
      transform,
      colors,
    });
    return { state, oldCanvas, newCanvas, oldWrap, newWrap, renderer };
  }

  test("centers dimension mismatch in a shared world and fits to 92 percent", () => {
    const { state, oldCanvas, newCanvas, renderer } = harness();
    const fitted = renderer.fit();
    expect(fitted.scale).toBeCloseTo(1.38);
    expect(fitted).toMatchObject({ tx: 62, ty: 12 });
    expect(oldCanvas.style.transform).toBe(`translate(${62 + 50 * fitted.scale}px,12px) scale(${fitted.scale})`);
    expect(newCanvas.style.transform).toBe(`translate(62px,${12 + 50 * fitted.scale}px) scale(${fitted.scale})`);
    expect(state.textReview.view).toEqual(fitted);
  });

  test("clamps cursor-centered zoom and returns defensive view copies", () => {
    const { renderer } = harness();
    renderer.zoomAt(1000, 20, 30);
    expect(renderer.getView().scale).toBe(40);
    renderer.zoomAt(0.000001, 20, 30);
    const first = renderer.getView();
    expect(first.scale).toBe(0.05);
    first.tx = 999;
    expect(renderer.getView().tx).not.toBe(999);
  });

  test("pan is pointer-bound and gated by text mode and highlights", () => {
    const { state, oldWrap, newWrap, renderer } = harness();
    renderer.handlePointerDown(oldWrap, { pointerId: 3, clientX: 10, clientY: 20 });
    renderer.handlePointerDown(newWrap, { pointerId: 4, clientX: 100, clientY: 200 });
    expect(newWrap.classList.contains("panning")).toBe(false);
    renderer.handlePointerMove(oldWrap, { pointerId: 4, clientX: 100, clientY: 200 });
    expect(renderer.getView()).toEqual({ scale: 1, tx: 0, ty: 0 });
    renderer.handlePointerMove(oldWrap, { pointerId: 3, clientX: 30, clientY: 50 });
    expect(renderer.getView()).toEqual({ scale: 1, tx: 20, ty: 30 });
    renderer.handlePointerUp(oldWrap, { pointerId: 4 });
    expect(oldWrap.classList.contains("panning")).toBe(true);
    renderer.handlePointerCancel(oldWrap, { pointerId: 3 });
    expect(oldWrap.classList.contains("panning")).toBe(false);

    state.ui.topMode = "visual";
    renderer.handlePointerDown(oldWrap, { pointerId: 5, clientX: 0, clientY: 0 });
    expect(oldWrap.classList.contains("panning")).toBe(false);
    state.ui.topMode = "text";
    state.textReview.highlights = null;
    renderer.handlePointerDown(oldWrap, { pointerId: 6, clientX: 0, clientY: 0 });
    expect(oldWrap.classList.contains("panning")).toBe(false);
  });

  test("wheel zoom is cursor-centered only in active highlighted text mode", () => {
    const { state, oldWrap, renderer } = harness();
    const preventDefault = vi.fn();
    renderer.handleWheel(oldWrap, { deltaY: -1, clientX: 110, clientY: 220, preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    const zoomed = renderer.getView();
    expect(zoomed.scale).toBeCloseTo(1.12);
    expect(zoomed.tx).toBeCloseTo(-12);
    expect(zoomed.ty).toBeCloseTo(-24);
    state.ui.topMode = "visual";
    renderer.handleWheel(oldWrap, { deltaY: -1, clientX: 110, clientY: 220, preventDefault });
    expect(renderer.getView().scale).toBe(1.12);
  });
});
