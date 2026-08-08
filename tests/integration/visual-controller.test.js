import { expect, test, vi } from "vitest";
import { createAppState } from "../../src/app/state.js";
import { createVisualController } from "../../src/features/visual-diff/visual-controller.js";
import { renderDiffPage } from "../../src/features/visual-diff/visual-renderer.js";
import { renderTogglePage } from "../../src/features/visual-diff/toggle-renderer.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function result(pageIndex, mode = "diff") {
  return {
    canvas: { width: 100 + pageIndex, height: 200 + pageIndex, id: `${mode}-${pageIndex}` },
    currentPlan: { pageIndex },
    alignmentCache: new Map([[pageIndex, { aligned: true }]]),
    quadrantCache: new Map([[pageIndex, { k: 0 }]]),
    toggleCache: mode === "toggle" ? { idx: pageIndex, sideCanvases: {} } : undefined,
    boxes: [{ x: pageIndex, y: 0, w: 1, h: 1 }],
    autoBoxes: [{ x: pageIndex, y: 0, w: 1, h: 1 }],
    cacheEntry: { rm: pageIndex + 1, ad: pageIndex + 2, bx: 1 },
    stats: mode === "diff"
      ? { removed: `削除 ${pageIndex + 1}`, added: `追加 ${pageIndex + 2}`, boxes: "変更箇所 1" }
      : { removed: "削除 —", added: "追加 —", boxes: "変更箇所 1" },
    status: mode === "diff" ? "差分を表示中" : "新旧切替（OLD表示中）",
    pageLabel: `${pageIndex + 1} / 2`,
  };
}

function harness({ renderDiffPage = vi.fn(), renderTogglePage = vi.fn() } = {}) {
  const state = createAppState();
  state.documents.oldDoc = { id: "old", numPages: 2 };
  state.documents.newDoc = { id: "new", numPages: 2 };
  state.documents.oldSequence = [0, 1];
  state.documents.newSequence = [0, 1];
  state.documents.pages = 2;
  state.documents.generation = 4;
  const context = { clearRect: vi.fn(), drawImage: vi.fn() };
  const dom = {
    out: { width: 10, height: 10, style: { display: "block" }, getContext: () => context },
    placeholder: { style: { display: "none" } },
    status: { innerHTML: "", textContent: "stable" },
    pageLabel: { textContent: "1 / 2" },
    statRm: { textContent: "削除 9" },
    statAd: { textContent: "追加 8" },
    statBox: { textContent: "変更箇所 7" },
    dlPng: { disabled: false },
    dlPdf: { disabled: false },
    boxToggle: { disabled: false },
    reportError: vi.fn(),
  };
  const drawBoxes = vi.fn();
  const controller = createVisualController({
    state,
    dom,
    renderDiffPage,
    renderTogglePage,
    drawBoxes,
  });
  return { state, dom, context, drawBoxes, controller, renderDiffPage, renderTogglePage };
}

test("commits only the latest page when an older render finishes last", async () => {
  const page0 = deferred();
  const page1 = deferred();
  const renderDiffPage = vi.fn(snapshot => snapshot.pageIndex === 0 ? page0.promise : page1.promise);
  const { state, context, controller } = harness({ renderDiffPage });

  const oldRender = controller.showPage(0);
  const newRender = controller.showPage(1);
  page1.resolve(result(1));

  expect(await newRender).toEqual({ committed: true });
  expect(state.documents.currentPage).toBe(1);
  expect(context.drawImage).toHaveBeenCalledOnce();
  expect(context.drawImage).toHaveBeenLastCalledWith(expect.objectContaining({ id: "diff-1" }), 0, 0);

  page0.resolve(result(0));
  expect(await oldRender).toEqual({ committed: false });
  expect(state.documents.currentPage).toBe(1);
  expect(context.drawImage).toHaveBeenCalledOnce();
  expect(state.visual.pageCache.has(0)).toBe(false);
  expect(state.visual.pageCache.get(1)).toEqual({ rm: 2, ad: 3, bx: 1 });
});

test("discards a pending result when the document generation changes", async () => {
  const pending = deferred();
  const renderDiffPage = vi.fn(() => pending.promise);
  const { state, context, controller } = harness({ renderDiffPage });

  const rendering = controller.showPage(1);
  state.documents.generation += 1;
  pending.resolve(result(1));

  expect(await rendering).toEqual({ committed: false });
  expect(state.documents.currentPage).toBe(0);
  expect(context.drawImage).not.toHaveBeenCalled();
  expect(state.visual.pageCache.size).toBe(0);
});

test("selects the renderer from the captured visual mode", async () => {
  const renderDiffPage = vi.fn(async snapshot => result(snapshot.pageIndex, "diff"));
  const renderTogglePage = vi.fn(async snapshot => result(snapshot.pageIndex, "toggle"));
  const { state, controller } = harness({ renderDiffPage, renderTogglePage });

  await controller.showPage(0);
  state.visual.mode = "toggle";
  await controller.showPage(1);

  expect(renderDiffPage).toHaveBeenCalledOnce();
  expect(renderTogglePage).toHaveBeenCalledOnce();
  expect(Object.isFrozen(renderDiffPage.mock.calls[0][0])).toBe(true);
  expect(Object.isFrozen(renderDiffPage.mock.calls[0][0].comparison)).toBe(true);
});

test("reports a current renderer failure without replacing the prior committed page", async () => {
  const error = new Error("render failed");
  const renderDiffPage = vi.fn(async () => { throw error; });
  const { state, dom, context, drawBoxes, controller } = harness({ renderDiffPage });
  state.documents.currentPage = 1;
  state.boxEditor.selectedIndex = 3;

  const outcome = await controller.showPage(0);

  expect(outcome).toEqual({ committed: false, error });
  expect(state.documents.currentPage).toBe(1);
  expect(state.boxEditor.selectedIndex).toBe(3);
  expect(dom.out).toMatchObject({ width: 10, height: 10 });
  expect(context.drawImage).not.toHaveBeenCalled();
  expect(drawBoxes).not.toHaveBeenCalled();
  expect(dom.reportError).toHaveBeenCalledWith(error);
});

test("suppresses a stale rejection after a newer page commits", async () => {
  const oldPage = deferred();
  const renderDiffPage = vi.fn(snapshot => (
    snapshot.pageIndex === 0 ? oldPage.promise : Promise.resolve(result(1))
  ));
  const { state, dom, controller } = harness({ renderDiffPage });

  const stale = controller.showPage(0);
  expect(await controller.showPage(1)).toEqual({ committed: true });
  oldPage.reject(new Error("late failure"));

  expect(await stale).toEqual({ committed: false });
  expect(state.documents.currentPage).toBe(1);
  expect(dom.status.textContent).toBe("差分を表示中");
  expect(dom.reportError).not.toHaveBeenCalled();
});

test("updates the full-resolution output for export without changing the reviewed page", async () => {
  const renderDiffPage = vi.fn(async snapshot => result(snapshot.pageIndex));
  const { state, dom, controller } = harness({ renderDiffPage });
  state.documents.currentPage = 0;
  state.boxEditor.selectedIndex = 4;

  expect(await controller.showPage(1, { mode: "diff", updateCurrentPage: false }))
    .toEqual({ committed: true });

  expect(state.documents.currentPage).toBe(0);
  expect(state.boxEditor.selectedIndex).toBe(4);
  expect(dom.out).toMatchObject({ width: 101, height: 201 });
});

test("redraws a committed toggle side immediately without invoking a renderer", () => {
  const renderDiffPage = vi.fn();
  const renderTogglePage = vi.fn();
  const { state, context, drawBoxes, controller } = harness({ renderDiffPage, renderTogglePage });
  const newCanvas = { width: 320, height: 240, id: "new-side" };
  state.visual.toggleSide = "new";
  state.visual.toggleCache = { sideCanvases: { old: {}, new: newCanvas } };

  expect(controller.redrawToggleSide()).toBe(true);

  expect(context.drawImage).toHaveBeenCalledWith(newCanvas, 0, 0);
  expect(drawBoxes).toHaveBeenCalledOnce();
  expect(renderDiffPage).not.toHaveBeenCalled();
  expect(renderTogglePage).not.toHaveBeenCalled();
});

test("invalidates alignment and clamps the page before refreshing reordered slots", async () => {
  const renderDiffPage = vi.fn(async snapshot => result(snapshot.pageIndex));
  const { state, controller } = harness({ renderDiffPage });
  state.documents.oldSequence = [0];
  state.documents.newSequence = [0];
  state.documents.pages = 2;
  state.documents.currentPage = 1;
  const invalidatePageAlignment = vi.fn(target => {
    target.visual.renderGeneration += 1;
    target.visual.pageCache.clear();
  });
  const syncInvalidatedBoxEditor = vi.fn();

  expect(await controller.refreshAfterAlign({
    invalidatePageAlignment,
    syncInvalidatedBoxEditor,
  })).toEqual({ committed: true });

  expect(state.documents.pages).toBe(1);
  expect(state.documents.currentPage).toBe(0);
  expect(invalidatePageAlignment).toHaveBeenCalledWith(state);
  expect(syncInvalidatedBoxEditor).toHaveBeenCalledOnce();
  expect(renderDiffPage).toHaveBeenCalledWith(expect.objectContaining({ pageIndex: 0 }));
});

class MemoryCanvas {
  constructor(width, height, pixels) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
    if (pixels) this.data.set(pixels);
    this.context = new MemoryContext(this);
  }

  getContext() {
    return this.context;
  }
}

class MemoryContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.fillStyle = "#fff";
  }

  createImageData(width, height) {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
  }

  getImageData(x, y, width, height) {
    return { width, height, data: new Uint8ClampedArray(this.canvas.data) };
  }

  putImageData(image) {
    this.canvas.data.set(image.data);
  }

  fillRect() {
    for (let index = 0; index < this.canvas.data.length; index += 4) {
      this.canvas.data[index] = 255;
      this.canvas.data[index + 1] = 255;
      this.canvas.data[index + 2] = 255;
      this.canvas.data[index + 3] = 255;
    }
  }

  drawImage(source, dx = 0, dy = 0) {
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        const targetX = x + dx;
        const targetY = y + dy;
        if (targetX < 0 || targetY < 0 || targetX >= this.canvas.width || targetY >= this.canvas.height) continue;
        const sourceOffset = (y * source.width + x) * 4;
        const targetOffset = (targetY * this.canvas.width + targetX) * 4;
        this.canvas.data.set(source.data.subarray(sourceOffset, sourceOffset + 4), targetOffset);
      }
    }
  }

  setTransform() {}

  clearRect() {
    this.canvas.data.fill(0);
  }

  fillText() {}
}

const rgba = values => new Uint8ClampedArray(values.flatMap(value => [value, value, value, 255]));

function rendererSnapshot({ side = "old", toggleCache = null } = {}) {
  return Object.freeze({
    pageIndex: 0,
    mode: "diff",
    documents: Object.freeze({
      oldDoc: { id: "old", numPages: 1 },
      newDoc: { id: "new", numPages: 1 },
      pages: 1,
      generation: 1,
      oldSequence: Object.freeze([0]),
      newSequence: Object.freeze([0]),
    }),
    comparison: Object.freeze({
      dpi: 72,
      threshold: 128,
      tolerancePx: 0,
      dx: 0,
      dy: 0,
      manualAngle: 0,
      manualScale: 1,
      autoAlign: false,
      quadrantManual: new Map(),
    }),
    visual: Object.freeze({
      toggleSide: side,
      toggleCache,
      alignmentCache: new Map(),
      quadrantCache: new Map(),
      quadrantGeneration: 0,
    }),
    boxEditor: Object.freeze({ showBoxes: true, manualBoxes: null }),
  });
}

function rendererDependencies(oldCanvas, newCanvas) {
  return {
    sequenceIndex: sequence => sequence[0],
    pageSizePt: vi.fn(async () => ({ w: 3, h: 1 })),
    framePlan: () => ({ oldScale: 1, newScale: 1, normalized: false }),
    renderPageCanvas: vi.fn(async doc => doc.id === "old" ? oldCanvas : newCanvas),
    rotateCanvas90: canvas => canvas,
    canvasToGrayF: vi.fn(),
    createCanvas: (width, height) => new MemoryCanvas(width, height),
    createWhiteCanvas: (width, height) => {
      const canvas = new MemoryCanvas(width, height);
      canvas.context.fillRect(0, 0, width, height);
      return canvas;
    },
    pageLabelText: () => "1 / 1",
  };
}

test("renders the exact legacy common removed and added pixels offscreen", async () => {
  const oldCanvas = new MemoryCanvas(3, 1, rgba([0, 0, 255]));
  const newCanvas = new MemoryCanvas(3, 1, rgba([0, 255, 0]));
  const dependencies = rendererDependencies(oldCanvas, newCanvas);

  const rendered = await renderDiffPage(rendererSnapshot(), dependencies);

  expect([...rendered.canvas.data]).toEqual([
    60, 60, 60, 255,
    255, 91, 87, 255,
    77, 141, 255, 255,
  ]);
  expect(rendered.cacheEntry).toEqual({ rm: 1, ad: 1, bx: rendered.boxes.length });
  expect(rendered.status).toBe("差分を表示中");
});

test("requests old and new page dimensions concurrently", async () => {
  const oldCanvas = new MemoryCanvas(3, 1, rgba([0, 0, 255]));
  const newCanvas = new MemoryCanvas(3, 1, rgba([0, 255, 0]));
  const dependencies = rendererDependencies(oldCanvas, newCanvas);
  const oldSize = deferred();
  dependencies.pageSizePt = vi.fn(doc => (
    doc.id === "old" ? oldSize.promise : Promise.resolve({ w: 3, h: 1 })
  ));

  const rendering = renderDiffPage(rendererSnapshot(), dependencies);
  await Promise.resolve();

  expect(dependencies.pageSizePt).toHaveBeenCalledTimes(2);
  oldSize.resolve({ w: 3, h: 1 });
  await rendering;
});

test("renders both toggle sides offscreen and reuses the page-canvas cache", async () => {
  const oldCanvas = new MemoryCanvas(3, 1, rgba([0, 60, 120]));
  const newCanvas = new MemoryCanvas(3, 1, rgba([20, 80, 140]));
  const dependencies = rendererDependencies(oldCanvas, newCanvas);

  const first = await renderTogglePage(rendererSnapshot(), dependencies);
  expect([...first.toggleCache.sideCanvases.old.data]).toEqual([...oldCanvas.data]);
  expect([...first.toggleCache.sideCanvases.new.data]).toEqual([...newCanvas.data]);
  expect(first.canvas).toBe(first.toggleCache.sideCanvases.old);
  expect(dependencies.renderPageCanvas).toHaveBeenCalledTimes(2);

  const second = await renderTogglePage(
    rendererSnapshot({ side: "new", toggleCache: first.toggleCache }),
    dependencies,
  );
  expect([...second.canvas.data]).toEqual([...first.toggleCache.sideCanvases.new.data]);
  expect(dependencies.renderPageCanvas).toHaveBeenCalledTimes(2);
});

test("does not reuse toggle page canvases when the effective automatic quadrant changed", async () => {
  const oldCanvas = new MemoryCanvas(3, 1, rgba([0, 60, 120]));
  const newCanvas = new MemoryCanvas(3, 1, rgba([20, 80, 140]));
  const dependencies = rendererDependencies(oldCanvas, newCanvas);
  dependencies.rotateCanvas90 = vi.fn(canvas => canvas);
  const first = await renderTogglePage(rendererSnapshot(), dependencies);
  const base = rendererSnapshot({ toggleCache: first.toggleCache });
  const changed = Object.freeze({
    ...base,
    comparison: Object.freeze({ ...base.comparison, autoAlign: true }),
    visual: Object.freeze({
      ...base.visual,
      quadrantCache: new Map([[0, { k: 1, applied: true }]]),
      alignmentCache: new Map([[0, { applied: false }]]),
    }),
  });

  await renderTogglePage(changed, dependencies);

  expect(dependencies.renderPageCanvas).toHaveBeenCalledTimes(4);
  expect(dependencies.rotateCanvas90).toHaveBeenLastCalledWith(newCanvas, 1);
});
