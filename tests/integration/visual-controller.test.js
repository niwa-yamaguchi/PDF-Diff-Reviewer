import { afterAll, expect, test, vi } from "vitest";
import { createAppState } from "../../src/app/state.js";
import { createVisualController } from "../../src/features/visual-diff/visual-controller.js";
import { createBoxEditorController } from "../../src/features/box-editor/box-editor-controller.js";
import {
  createVisualRawCacheIdentity,
  renderDiffPage,
  toggleCompletedCacheMatchesSnapshot,
  visualRawCacheMatchesSnapshot,
} from "../../src/features/visual-diff/visual-renderer.js";
import { renderTogglePage } from "../../src/features/visual-diff/toggle-renderer.js";
import { createWorkerLane } from "../../src/features/visual-diff/worker-lane.js";
import { computeDiff } from "../../src/core/image-diff/diff-compute.js";
import { computeAlignment, computeQuadrant } from "../../src/core/alignment/align-compute.js";

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

function toggleResult(pageIndex, side) {
  const rendered = result(pageIndex, "toggle");
  const canvas = { width: 100 + pageIndex, height: 200 + pageIndex, id: `toggle-${side}` };
  return {
    ...rendered,
    canvas,
    toggleCache: {
      idx: pageIndex,
      sideCanvases: { old: { id: "toggle-old" }, new: { id: "toggle-new" } },
    },
    status: `新旧切替（${side === "old" ? "OLD" : "NEW"}表示中）`,
  };
}

function splitResult(pageIndex) {
  const rendered = result(pageIndex, "split");
  return {
    ...rendered,
    canvas: undefined,
    sideCanvases: {
      old: { width: 100 + pageIndex, height: 200 + pageIndex, id: `split-old-${pageIndex}` },
      new: { width: 100 + pageIndex, height: 200 + pageIndex, id: `split-new-${pageIndex}` },
    },
    splitCache: { idx: pageIndex },
    status: "左右表示中",
  };
}

function activeClassList() {
  const values = new Set();
  return {
    toggle(name, active) {
      if (active) values.add(name);
      else values.delete(name);
    },
    contains: name => values.has(name),
  };
}

function textElement(initialText = "") {
  let textContent = initialText;
  let innerHTML = initialText;
  return {
    get textContent() {
      return textContent;
    },
    set textContent(value) {
      textContent = String(value);
      innerHTML = textContent;
    },
    get innerHTML() {
      return innerHTML;
    },
    set innerHTML(value) {
      innerHTML = String(value);
      textContent = innerHTML.replace(/<[^>]*>/g, "");
    },
  };
}

function harness({
  renderDiffPage = vi.fn(),
  renderTogglePage = vi.fn(),
  renderSplitPage = vi.fn(),
  createCanvas = (width, height) => {
    const canvas = { width, height, getContext: () => canvasContext, context: null };
    const canvasContext = {
      clearRect: vi.fn(),
      drawImage: vi.fn(source => { canvas.id = source.id; }),
    };
    canvas.context = canvasContext;
    return canvas;
  },
} = {}) {
  const state = createAppState();
  state.documents.oldDoc = { id: "old", numPages: 2 };
  state.documents.newDoc = { id: "new", numPages: 2 };
  state.documents.oldSequence = [0, 1];
  state.documents.newSequence = [0, 1];
  state.documents.pages = 2;
  state.documents.generation = 4;
  const context = { clearRect: vi.fn(), drawImage: vi.fn() };
  const splitOldContext = { clearRect: vi.fn(), drawImage: vi.fn() };
  const splitNewContext = { clearRect: vi.fn(), drawImage: vi.fn() };
  const dom = {
    out: { width: 10, height: 10, style: { display: "block" }, getContext: () => context },
    canvasWrap: { style: { display: "" } },
    visualSplitPanel: { style: { display: "none" } },
    splitOldCanvas: {
      width: 10, height: 10, style: {}, getContext: () => splitOldContext,
    },
    splitNewCanvas: {
      width: 10, height: 10, style: {}, getContext: () => splitNewContext,
    },
    placeholder: { style: { display: "none" } },
    status: textElement("stable"),
    pageLabel: { textContent: "1 / 2" },
    statRm: { textContent: "削除 9" },
    statAd: { textContent: "追加 8" },
    statBox: { textContent: "変更箇所 7" },
    dlPng: { disabled: false },
    dlPdf: { disabled: false },
    boxToggle: { disabled: false },
    sideOld: { classList: activeClassList() },
    sideNew: { classList: activeClassList() },
    reportError: vi.fn(),
    cancelRender: vi.fn(),
  };
  const drawBoxes = vi.fn();
  const controller = createVisualController({
    state,
    dom,
    renderDiffPage,
    renderTogglePage,
    renderSplitPage,
    createCanvas,
    drawBoxes,
  });
  return {
    state, dom, context, splitOldContext, splitNewContext, drawBoxes, controller,
    renderDiffPage, renderTogglePage, renderSplitPage,
  };
}

function controllerToggleCache(state, sideCanvases) {
  const rawIdentity = {
    documentGeneration: state.documents.generation,
    oldDoc: state.documents.oldDoc,
    newDoc: state.documents.newDoc,
    oldIndex: state.documents.oldSequence[state.documents.currentPage],
    newIndex: state.documents.newSequence[state.documents.currentPage],
    dpi: state.comparison.dpi,
    quadrant: 0,
    framePlan: { ...state.visual.currentPlan },
  };
  return {
    idx: state.documents.currentPage,
    rawIdentity,
    completedIdentity: { renderGeneration: state.visual.renderGeneration },
    sideCanvases,
  };
}

function attachBoxEditor(state, dom) {
  state.visual.rendered = true;
  state.boxEditor.editMode = true;
  state.boxEditor.currentBoxes = [];
  state.boxEditor.autoByPage.set(0, []);
  const view = {
    toImagePoint: point => ({ x: point.x, y: point.y }),
    getScale: () => 1,
    getFrameSize: () => ({ width: 100, height: 100 }),
    capturePointer: vi.fn(),
    releasePointer: vi.fn(),
    refresh() {
      const boxes = state.boxEditor.currentBoxes || [];
      const edited = state.boxEditor.editsByPage.has(state.documents.currentPage);
      dom.statBox.textContent = `変更箇所 ${boxes.length}${edited ? "（手編集）" : ""}`;
    },
  };
  const controller = createBoxEditorController({
    state,
    dom: {},
    view,
    confirmDiscard: () => true,
  });
  dom.cancelBoxDrag = event => controller.cancelDrag(event);
  dom.refreshBoxEditor = () => view.refresh();
  return controller;
}

test("cancels a drag started during rendering immediately before committing the current result", async () => {
  const pending = deferred();
  const renderDiffPage = vi.fn(() => pending.promise);
  const { state, dom, controller: visualController } = harness({ renderDiffPage });
  const boxController = attachBoxEditor(state, dom);

  const rendering = visualController.showPage(0);
  boxController.pointerDown({ x: 10, y: 10, pointerId: 7, button: 0, preventDefault() {} });
  boxController.pointerMove({ x: 40, y: 40, pointerId: 7 });
  expect(state.boxEditor.drag).not.toBeNull();
  pending.resolve(result(0));

  expect(await rendering).toEqual({ committed: true });
  expect(state.boxEditor.drag).toBeNull();
  boxController.pointerUp({ x: 40, y: 40, pointerId: 7 });
  expect(state.boxEditor.editsByPage.size).toBe(0);
  expect(state.boxEditor.undoByPage.size).toBe(0);
});

test("commits a normal threshold render shell while preserving a newer manual box edit", async () => {
  const pending = deferred();
  const renderDiffPage = vi.fn(() => pending.promise);
  const { state, dom, context, controller: visualController } = harness({ renderDiffPage });
  const boxController = attachBoxEditor(state, dom);
  dom.dlPng.disabled = true;
  dom.dlPdf.disabled = true;
  dom.boxToggle.disabled = true;
  state.comparison.threshold = 42;

  const rendering = visualController.showPage(0);
  expect(renderDiffPage).toHaveBeenCalledWith(expect.objectContaining({
    comparison: expect.objectContaining({ threshold: 42 }),
  }), expect.objectContaining({ onProgress: expect.any(Function) }));
  boxController.pointerDown({ x: 10, y: 10, pointerId: 8, button: 0, preventDefault() {} });
  boxController.pointerMove({ x: 40, y: 40, pointerId: 8 });
  boxController.pointerUp({ x: 40, y: 40, pointerId: 8 });
  const editedBoxes = state.boxEditor.editsByPage.get(0);
  expect(editedBoxes).toEqual([{ x: 10, y: 10, w: 30, h: 30 }]);
  expect(state.boxEditor.revisionByPage.get(0)).toBe(1);
  expect(dom.statBox.textContent).toBe("変更箇所 1（手編集）");
  const rendered = result(0);
  pending.resolve(rendered);

  expect(await rendering).toEqual({ committed: true });
  expect(context.drawImage).toHaveBeenCalledWith(expect.objectContaining({ id: "diff-0" }), 0, 0);
  expect(state.boxEditor.editsByPage.get(0)).toBe(editedBoxes);
  expect(state.boxEditor.currentBoxes).toBe(editedBoxes);
  expect(state.boxEditor.selectedIndex).toBe(0);
  expect(state.boxEditor.undoByPage.get(0).size).toBe(1);
  expect(dom.statBox.textContent).toBe("変更箇所 1（手編集）");
  expect(state.visual.currentPlan).toBe(rendered.currentPlan);
  expect(state.visual.pageCache.get(0)).toBe(rendered.cacheEntry);
  expect(dom.pageLabel.textContent).toBe(rendered.pageLabel);
  expect(dom.statRm.textContent).toBe(rendered.stats.removed);
  expect(dom.statAd.textContent).toBe(rendered.stats.added);
  expect(dom.status.textContent).toBe(rendered.status);
  expect(dom.dlPng.disabled).toBe(false);
  expect(dom.dlPdf.disabled).toBe(false);
  expect(dom.boxToggle.disabled).toBe(false);
});

test("settles a pending toggle render after a manual edit without reverting its boxes or stat", async () => {
  const pending = deferred();
  const renderTogglePage = vi.fn(() => pending.promise);
  const { state, dom, context, controller: visualController } = harness({ renderTogglePage });
  const boxController = attachBoxEditor(state, dom);
  const originalAuto = state.boxEditor.autoByPage.get(0);
  state.visual.mode = "toggle";
  dom.dlPng.disabled = true;
  dom.dlPdf.disabled = true;
  dom.boxToggle.disabled = true;

  const rendering = visualController.showPage(0);
  boxController.pointerDown({ x: 10, y: 10, pointerId: 9, button: 0, preventDefault() {} });
  boxController.pointerMove({ x: 40, y: 40, pointerId: 9 });
  boxController.pointerUp({ x: 40, y: 40, pointerId: 9 });
  const editedBoxes = state.boxEditor.editsByPage.get(0);
  const rendered = result(0, "toggle");
  pending.resolve(rendered);

  expect(await rendering).toEqual({ committed: true });
  expect(context.drawImage).toHaveBeenCalledWith(expect.objectContaining({ id: "toggle-0" }), 0, 0);
  expect(dom.status.textContent).toBe("新旧切替（OLD表示中）");
  expect(dom.status.innerHTML).not.toContain("busy");
  expect(state.boxEditor.editsByPage.get(0)).toBe(editedBoxes);
  expect(state.boxEditor.currentBoxes).toBe(editedBoxes);
  expect(state.boxEditor.selectedIndex).toBe(0);
  expect(state.boxEditor.undoByPage.get(0).size).toBe(1);
  expect(state.boxEditor.autoByPage.get(0)).toBe(originalAuto);
  expect(dom.statBox.textContent).toBe("変更箇所 1（手編集）");
  expect(state.visual.currentPlan).toBe(rendered.currentPlan);
  expect(state.visual.toggleCache).toBe(rendered.toggleCache);
  expect(state.visual.pageCache.get(0)).toBe(rendered.cacheEntry);
  expect(dom.pageLabel.textContent).toBe(rendered.pageLabel);
  expect(dom.statRm.textContent).toBe(rendered.stats.removed);
  expect(dom.statAd.textContent).toBe(rendered.stats.added);
  expect(dom.dlPng.disabled).toBe(false);
  expect(dom.dlPdf.disabled).toBe(false);
  expect(dom.boxToggle.disabled).toBe(false);
  expect(dom.sideOld.classList.contains("active")).toBe(true);
  expect(dom.sideNew.classList.contains("active")).toBe(false);
});

test("commits a render shell after reset-to-auto without restoring the old manual snapshot", async () => {
  const pending = deferred();
  const renderDiffPage = vi.fn(() => pending.promise);
  const { state, dom, context, controller: visualController } = harness({ renderDiffPage });
  const boxController = attachBoxEditor(state, dom);
  const automaticBoxes = [{ x: 2, y: 2, w: 8, h: 8 }];
  const manualBoxes = [{ x: 20, y: 20, w: 30, h: 30 }];
  state.boxEditor.autoByPage.set(0, automaticBoxes);
  state.boxEditor.editsByPage.set(0, manualBoxes);
  state.boxEditor.currentBoxes = manualBoxes;
  dom.statBox.textContent = "変更箇所 1（手編集）";

  const rendering = visualController.showPage(0);
  boxController.resetToAuto();
  pending.resolve({
    ...result(0),
    boxes: manualBoxes.map(box => ({ ...box })),
    autoBoxes: undefined,
    stats: { removed: "削除 1", added: "追加 2", boxes: "変更箇所 1（手編集）" },
  });

  expect(await rendering).toEqual({ committed: true });
  expect(context.drawImage).toHaveBeenCalledOnce();
  expect(state.boxEditor.editsByPage.has(0)).toBe(false);
  expect(state.boxEditor.currentBoxes).toBe(automaticBoxes);
  expect(state.boxEditor.undoByPage.has(0)).toBe(false);
  expect(dom.statBox.textContent).toBe("変更箇所 1");
  expect(dom.status.textContent).toBe("差分を表示中");
});

test("still discards the whole result when the captured mode is genuinely stale", async () => {
  const pending = deferred();
  const renderDiffPage = vi.fn(() => pending.promise);
  const { state, dom, context, controller } = harness({ renderDiffPage });

  const rendering = controller.showPage(0);
  state.visual.mode = "toggle";
  dom.status.textContent = "mode changed";
  pending.resolve(result(0));

  expect(await rendering).toEqual({ committed: false });
  expect(context.drawImage).not.toHaveBeenCalled();
  expect(dom.status.textContent).toBe("mode changed");
});

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

test("cancels the previous render before starting a new one", async () => {
  const first = deferred();
  const renderDiffPage = vi.fn()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce(result(1));
  const { controller, dom } = harness({ renderDiffPage });

  const pending = controller.showPage(0);
  expect(dom.cancelRender).toHaveBeenCalledTimes(1);

  const second = controller.showPage(1);
  expect(dom.cancelRender).toHaveBeenCalledTimes(2);

  const cancelled = new Error("描画を打ち切りました");
  cancelled.name = "RenderCancelled";
  first.reject(cancelled);

  await expect(pending).resolves.toMatchObject({ committed: false });
  await expect(second).resolves.toMatchObject({ committed: true });
  expect(dom.reportError).not.toHaveBeenCalled();
});

test("shows each rendering phase in the status line", async () => {
  const pending = deferred();
  let report;
  const renderDiffPage = vi.fn((snapshot, options) => {
    report = options.onProgress;
    return pending.promise;
  });
  const { controller, dom } = harness({ renderDiffPage });

  const running = controller.showPage(0);
  report({ phase: "render" });
  expect(dom.status.textContent).toBe("ページを描画中…");
  report({ phase: "align" });
  expect(dom.status.textContent).toBe("位置合わせ中…");
  report({ phase: "diff", ratio: 0.45 });
  expect(dom.status.textContent).toBe("差分を計算中… 45%");

  pending.resolve(result(0));
  await running;
  expect(dom.status.textContent).toBe("差分を表示中");
});

test("ignores progress from a superseded render", async () => {
  const first = deferred();
  const reports = [];
  const renderDiffPage = vi.fn((snapshot, options) => {
    reports.push(options.onProgress);
    return reports.length === 1 ? first.promise : Promise.resolve(result(1));
  });
  const { controller, dom } = harness({ renderDiffPage });

  const stale = controller.showPage(0);
  const fresh = controller.showPage(1);
  await fresh;

  reports[0]({ phase: "diff", ratio: 0.9 });
  expect(dom.status.textContent).toBe("差分を表示中");

  first.resolve(result(0));
  await stale;
});

class FakeLaneWorker {
  constructor(registry) {
    this.posted = [];
    this.terminated = false;
    this.onmessage = null;
    registry.push(this);
  }

  postMessage(message) {
    this.posted.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  emit(data) {
    this.onmessage?.({ data });
  }
}

test("does not report an error when a second render starts while the worker lane is still busy", async () => {
  const workers = [];
  const lane = createWorkerLane({ createWorker: () => new FakeLaneWorker(workers) });
  const renderDiffPage = vi.fn(async snapshot => {
    await lane.run("diff", { pageIndex: snapshot.pageIndex });
    return result(snapshot.pageIndex);
  });
  const { controller, dom } = harness({ renderDiffPage });
  dom.cancelRender = () => lane.cancel();

  const pending = controller.showPage(0);
  expect(workers).toHaveLength(1);
  const second = controller.showPage(1);

  expect(workers).toHaveLength(2);
  expect(workers[0].terminated).toBe(true);
  const { id } = workers[1].posted[0];
  workers[1].emit({ id, type: "done", result: null });

  await expect(pending).resolves.toMatchObject({ committed: false });
  await expect(second).resolves.toMatchObject({ committed: true });
  expect(dom.reportError).not.toHaveBeenCalled();
});

// create-app と同じ配り方。描画1回につき1セッションを取る。
function laneRenderDependencies(lane) {
  const run = lane.session();
  return { computeDiff: (payload, options) => run("diff", payload, options) };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test("cancels a render that only reaches the worker lane after a newer render started", async () => {
  const workers = [];
  const lane = createWorkerLane({ createWorker: () => new FakeLaneWorker(workers) });
  const rasterized = [deferred(), deferred()];
  const render = vi.fn(async (snapshot, dependencies) => {
    await rasterized[snapshot.pageIndex].promise;
    await dependencies.computeDiff({ pageIndex: snapshot.pageIndex });
    return result(snapshot.pageIndex);
  });
  const { controller, dom } = harness({
    renderDiffPage: (snapshot, options) => render(snapshot, laneRenderDependencies(lane), options),
  });
  dom.cancelRender = () => lane.cancel();

  const stale = controller.showPage(0);
  const fresh = controller.showPage(1);
  expect(workers).toHaveLength(0);

  // 古い描画のラスタライズが先に終わってもレーンは奪われない。
  rasterized[0].resolve();
  await flush();
  expect(workers).toHaveLength(0);
  await expect(stale).resolves.toMatchObject({ committed: false });

  rasterized[1].resolve();
  await flush();
  expect(workers).toHaveLength(1);
  expect(workers[0].posted[0].payload).toEqual({ pageIndex: 1 });
  const { id } = workers[0].posted[0];
  workers[0].emit({ id, type: "done", result: null });

  await expect(fresh).resolves.toMatchObject({ committed: true });
  expect(dom.reportError).not.toHaveBeenCalled();
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

test("commits both split canvases atomically and rejects an older split result", async () => {
  const stale = deferred();
  const renderSplitPage = vi.fn(snapshot => (
    snapshot.pageIndex === 0 ? stale.promise : Promise.resolve(splitResult(1))
  ));
  const {
    state, dom, context, splitOldContext, splitNewContext, controller,
  } = harness({ renderSplitPage });
  state.visual.mode = "split";

  const oldPage = controller.showPage(0);
  expect(await controller.showPage(1)).toEqual({ committed: true });
  stale.resolve(splitResult(0));
  expect(await oldPage).toEqual({ committed: false });

  expect(context.drawImage).not.toHaveBeenCalled();
  expect(splitOldContext.drawImage).toHaveBeenCalledOnce();
  expect(splitNewContext.drawImage).toHaveBeenCalledOnce();
  expect(state.documents.currentPage).toBe(1);
  expect(state.visual.splitCache).toEqual({ idx: 1 });
  expect(dom.out.style.display).toBe("none");
  expect(dom.canvasWrap.style.display).toBe("none");
  expect(dom.visualSplitPanel.style.display).toBe("flex");
  expect(dom.status.textContent).toBe("左右表示中");
});

test("captures a frozen current-page auto box snapshot for split rendering", async () => {
  const renderSplitPage = vi.fn(async snapshot => {
    expect(Object.isFrozen(snapshot.boxEditor.autoBoxes)).toBe(true);
    expect(Object.isFrozen(snapshot.boxEditor.autoBoxes[0])).toBe(true);
    return splitResult(snapshot.pageIndex);
  });
  const { state, controller } = harness({ renderSplitPage });
  state.visual.mode = "split";
  state.boxEditor.autoByPage.set(0, [{ x: 1, y: 2, w: 3, h: 4 }]);

  await controller.showPage(0);

  expect(renderSplitPage).toHaveBeenCalledWith(
    expect.objectContaining({
      visual: expect.objectContaining({ splitCache: null }),
      boxEditor: expect.objectContaining({
        autoBoxes: [{ x: 1, y: 2, w: 3, h: 4 }],
      }),
    }),
    expect.objectContaining({ onProgress: expect.any(Function) }),
  );
});

test("a current split failure preserves both canvases, page, cache, and status", async () => {
  const error = new Error("split failed");
  const renderSplitPage = vi.fn(async () => { throw error; });
  const {
    state, dom, splitOldContext, splitNewContext, controller,
  } = harness({ renderSplitPage });
  state.visual.mode = "split";
  state.documents.currentPage = 1;
  state.visual.splitCache = { idx: 1, stable: true };
  dom.status.textContent = "stable split";

  expect(await controller.showPage(0)).toEqual({ committed: false, error });

  expect(state.documents.currentPage).toBe(1);
  expect(state.visual.splitCache).toEqual({ idx: 1, stable: true });
  expect(splitOldContext.drawImage).not.toHaveBeenCalled();
  expect(splitNewContext.drawImage).not.toHaveBeenCalled();
  expect(dom.status.textContent).toBe("stable split");
});

test.each(["diff", "split"])(
  "a pending %s render cannot commit after text mode becomes active",
  async mode => {
    const pending = deferred();
    const renderer = vi.fn(() => pending.promise);
    const options = mode === "split"
      ? { renderSplitPage: renderer }
      : { renderDiffPage: renderer };
    const {
      state, dom, context, splitOldContext, splitNewContext, controller,
    } = harness(options);
    state.visual.mode = mode;
    state.documents.currentPage = 1;
    state.visual.pageCache.set(1, { stable: true });
    state.visual.splitCache = { idx: 1, stable: true };

    const rendering = controller.showPage(0);
    state.ui.topMode = "text";
    dom.canvasWrap.style.display = "none";
    dom.out.style.display = "none";
    dom.visualSplitPanel.style.display = "none";
    dom.status.textContent = "テキスト差分を表示中";
    pending.resolve(mode === "split" ? splitResult(0) : result(0));

    expect(await rendering).toEqual({ committed: false });
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(splitOldContext.drawImage).not.toHaveBeenCalled();
    expect(splitNewContext.drawImage).not.toHaveBeenCalled();
    expect(dom.canvasWrap.style.display).toBe("none");
    expect(dom.visualSplitPanel.style.display).toBe("none");
    expect(dom.status.textContent).toBe("テキスト差分を表示中");
    expect(state.documents.currentPage).toBe(1);
    expect(state.visual.pageCache).toEqual(new Map([[1, { stable: true }]]));
    expect(state.visual.splitCache).toEqual({ idx: 1, stable: true });
  },
);

test("an offscreen visual render can still commit while text mode is active", async () => {
  const renderDiffPage = vi.fn(async snapshot => result(snapshot.pageIndex));
  const { state, controller } = harness({ renderDiffPage });
  state.ui.topMode = "text";
  state.documents.currentPage = 0;

  expect(await controller.showPage(1, { mode: "diff", updateCurrentPage: false }))
    .toEqual({ committed: true });

  expect(state.documents.currentPage).toBe(0);
});

test("rejects the whole split result when staging either source canvas fails", async () => {
  const error = new Error("new staging copy failed");
  let created = 0;
  const createCanvas = vi.fn((width, height) => {
    created += 1;
    const stagingContext = {
      clearRect: vi.fn(),
      drawImage: created === 2 ? vi.fn(() => { throw error; }) : vi.fn(),
    };
    return { width, height, getContext: () => stagingContext };
  });
  const {
    state, dom, splitOldContext, splitNewContext, controller,
  } = harness({
    renderSplitPage: vi.fn(async () => splitResult(0)),
    createCanvas,
  });
  state.visual.mode = "split";
  state.visual.splitCache = { idx: 1, stable: true };
  dom.status.textContent = "prior split";

  expect(await controller.showPage(0)).toEqual({ committed: false, error });

  expect(splitOldContext.drawImage).not.toHaveBeenCalled();
  expect(splitNewContext.drawImage).not.toHaveBeenCalled();
  expect(state.visual.splitCache).toEqual({ idx: 1, stable: true });
  expect(dom.status.textContent).toBe("prior split");
});

test("rolls both split targets back when the second target reflection fails", async () => {
  const error = new Error("new target failed");
  const {
    state, dom, splitOldContext, splitNewContext, controller,
  } = harness({ renderSplitPage: vi.fn(async () => splitResult(0)) });
  state.visual.mode = "split";
  dom.splitOldCanvas.width = 31;
  dom.splitOldCanvas.height = 41;
  dom.splitNewCanvas.width = 32;
  dom.splitNewCanvas.height = 42;
  splitNewContext.drawImage
    .mockImplementationOnce(() => { throw error; })
    .mockImplementation(() => {});
  dom.status.textContent = "prior pair";

  expect(await controller.showPage(0)).toEqual({ committed: false, error });

  expect(dom.splitOldCanvas).toMatchObject({ width: 31, height: 41 });
  expect(dom.splitNewCanvas).toMatchObject({ width: 32, height: 42 });
  expect(splitOldContext.drawImage).toHaveBeenCalledTimes(2);
  expect(splitNewContext.drawImage).toHaveBeenCalledTimes(2);
  expect(dom.status.textContent).toBe("prior pair");
});

test("rejects a split result whose baked box revision became stale", async () => {
  const pending = deferred();
  const {
    state, dom, splitOldContext, splitNewContext, controller,
  } = harness({ renderSplitPage: vi.fn(() => pending.promise) });
  state.visual.mode = "split";
  state.documents.currentPage = 1;
  state.visual.splitCache = { idx: 1, stable: true };
  dom.status.textContent = "newer boxes";

  const rendering = controller.showPage(0);
  state.boxEditor.revisionByPage.set(0, 1);
  pending.resolve(splitResult(0));

  expect(await rendering).toEqual({ committed: false });
  expect(splitOldContext.drawImage).not.toHaveBeenCalled();
  expect(splitNewContext.drawImage).not.toHaveBeenCalled();
  expect(state.documents.currentPage).toBe(1);
  expect(state.visual.splitCache).toEqual({ idx: 1, stable: true });
  expect(dom.status.textContent).toBe("newer boxes");
});

test.each(["diff", "toggle"])("restores the single surface after committing %s", async mode => {
  const renderer = vi.fn(async snapshot => result(snapshot.pageIndex, mode));
  const options = mode === "toggle"
    ? { renderTogglePage: renderer }
    : { renderDiffPage: renderer };
  const { state, dom, controller } = harness(options);
  state.visual.mode = mode;
  dom.canvasWrap.style.display = "none";
  dom.visualSplitPanel.style.display = "flex";

  expect(await controller.showPage(0)).toEqual({ committed: true });

  expect(dom.canvasWrap.style.display).toBe("");
  expect(dom.out.style.display).toBe("block");
  expect(dom.visualSplitPanel.style.display).toBe("none");
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

test("keeps canvas status indicator and state on the new side when the old side resolves late", async () => {
  const oldSide = deferred();
  const renderTogglePage = vi.fn(snapshot => (
    snapshot.visual.toggleSide === "old"
      ? oldSide.promise
      : Promise.resolve(toggleResult(snapshot.pageIndex, "new"))
  ));
  const { state, dom, context, controller } = harness({ renderTogglePage });
  state.visual.mode = "toggle";
  state.visual.toggleSide = "old";

  const staleOldRender = controller.showPage(0);
  const flipped = controller.flipToggleSide();

  expect(await flipped).toEqual({ committed: true });
  oldSide.resolve(toggleResult(0, "old"));
  expect(await staleOldRender).toEqual({ committed: false });
  expect(state.visual.toggleSide).toBe("new");
  expect(context.drawImage).toHaveBeenCalledOnce();
  expect(context.drawImage).toHaveBeenCalledWith(
    expect.objectContaining({ id: "toggle-new" }),
    0,
    0,
  );
  expect(dom.status.textContent).toBe("新旧切替（NEW表示中）");
  expect(dom.sideNew.classList.contains("active")).toBe(true);
  expect(dom.sideOld.classList.contains("active")).toBe(false);
});

test("flips a fully matching committed toggle cache without invoking a renderer", async () => {
  const renderDiffPage = vi.fn();
  const renderTogglePage = vi.fn();
  const { state, context, drawBoxes, controller } = harness({ renderDiffPage, renderTogglePage });
  state.visual.mode = "toggle";
  state.visual.toggleSide = "old";
  state.visual.currentPlan = { oldScale: 1, newScale: 1 };
  const newCanvas = { width: 320, height: 240, id: "new-side" };
  state.visual.toggleCache = controllerToggleCache(
    state,
    { old: {}, new: newCanvas },
  );

  expect(await controller.flipToggleSide()).toEqual({ committed: true });

  expect(state.visual.toggleSide).toBe("new");
  expect(context.drawImage).toHaveBeenCalledWith(
    expect.objectContaining({ id: "new-side" }),
    0,
    0,
  );
  expect(drawBoxes).toHaveBeenCalledOnce();
  expect(renderDiffPage).not.toHaveBeenCalled();
  expect(renderTogglePage).not.toHaveBeenCalled();
});

test.each([
  ["manual nudge", state => { state.comparison.dx += 1; }],
  ["tolerance", state => { state.comparison.tolerancePx += 1; }],
  ["threshold", state => { state.comparison.threshold += 1; }],
  ["automatic alignment", state => { state.comparison.autoAlign = true; }],
])("renders the flipped side with new settings while a %s render is pending", async (_label, change) => {
  const renders = [];
  const renderTogglePage = vi.fn(snapshot => {
    const pending = deferred();
    renders.push({ snapshot, pending });
    return pending.promise;
  });
  const { state, dom, context, controller } = harness({ renderTogglePage });
  state.visual.mode = "toggle";
  state.visual.toggleSide = "old";
  state.visual.currentPlan = { oldScale: 1, newScale: 1 };
  const staleNewCanvas = { width: 320, height: 240, id: "stale-new-side" };
  state.visual.toggleCache = controllerToggleCache(
    state,
    { old: { id: "stale-old-side" }, new: staleNewCanvas },
  );
  change(state);
  state.visual.renderGeneration += 1;

  const staleSettingsRender = controller.showPage(0);
  const flipped = controller.flipToggleSide();
  await Promise.resolve();

  expect(state.visual.toggleSide).toBe("old");
  expect(renderTogglePage).toHaveBeenCalledTimes(2);
  expect(renders[1].snapshot.visual.toggleSide).toBe("new");
  expect(context.drawImage).not.toHaveBeenCalledWith(staleNewCanvas, 0, 0);

  renders[1].pending.resolve(toggleResult(0, "new"));
  expect(await flipped).toEqual({ committed: true });
  renders[0].pending.resolve(toggleResult(0, "old"));
  expect(await staleSettingsRender).toEqual({ committed: false });
  expect(state.visual.toggleSide).toBe("new");
  expect(context.drawImage).toHaveBeenCalledOnce();
  expect(context.drawImage).toHaveBeenCalledWith(
    expect.objectContaining({ id: "toggle-new" }),
    0,
    0,
  );
  expect(dom.status.textContent).toBe("新旧切替（NEW表示中）");
});

test("keeps the committed side when the current flipped-side renderer rejects", async () => {
  const error = new Error("new side failed");
  const renderTogglePage = vi.fn(async () => { throw error; });
  const { state, dom, context, controller } = harness({ renderTogglePage });
  state.visual.mode = "toggle";
  state.visual.toggleSide = "old";
  dom.sideOld.classList.toggle("active", true);

  const outcome = await controller.flipToggleSide();

  expect(outcome).toEqual({ committed: false, error });
  expect(state.visual.toggleSide).toBe("old");
  expect(context.drawImage).not.toHaveBeenCalled();
  expect(dom.sideOld.classList.contains("active")).toBe(true);
  expect(dom.sideNew.classList.contains("active")).toBe(false);
});

test("does not let a stale rejection roll back a newer double flip", async () => {
  const first = deferred();
  const second = deferred();
  const renderTogglePage = vi.fn(snapshot => (
    snapshot.visual.toggleSide === "new" ? first.promise : second.promise
  ));
  const { state, dom, controller } = harness({ renderTogglePage });
  state.visual.mode = "toggle";
  state.visual.toggleSide = "old";

  const flipToNew = controller.flipToggleSide();
  const flipBackToOld = controller.flipToggleSide();
  first.reject(new Error("stale new side failure"));

  expect(await flipToNew).toEqual({ committed: false });
  expect(state.visual.toggleSide).toBe("old");
  expect(dom.reportError).not.toHaveBeenCalled();

  second.resolve(toggleResult(0, "old"));
  expect(await flipBackToOld).toEqual({ committed: true });
  expect(state.visual.toggleSide).toBe("old");
  expect(dom.status.textContent).toBe("新旧切替（OLD表示中）");
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
  expect(renderDiffPage).toHaveBeenCalledWith(
    expect.objectContaining({ pageIndex: 0 }),
    expect.objectContaining({ onProgress: expect.any(Function) }),
  );
});

// Node には ImageData が無い。renderDiffPage は結果バッファを再確保せず
// そのまま包むため、包み先の最小実装を用意する。
class MemoryImageData {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

vi.stubGlobal("ImageData", MemoryImageData);
afterAll(() => vi.unstubAllGlobals());

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

  drawImage(source, dx = 0, dy = 0, dw = source.width, dh = source.height) {
    const scaleX = source.width / dw;
    const scaleY = source.height / dh;
    for (let y = 0; y < dh; y += 1) {
      for (let x = 0; x < dw; x += 1) {
        const targetX = x + dx;
        const targetY = y + dy;
        if (targetX < 0 || targetY < 0 || targetX >= this.canvas.width || targetY >= this.canvas.height) continue;
        const sourceX = Math.min(source.width - 1, Math.floor(x * scaleX));
        const sourceY = Math.min(source.height - 1, Math.floor(y * scaleY));
        const sourceOffset = (sourceY * source.width + sourceX) * 4;
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
      renderGeneration: 1,
      alignmentCache: new Map(),
      quadrantCache: new Map(),
      quadrantGeneration: 0,
    }),
    boxEditor: Object.freeze({ showBoxes: true, manualBoxes: null }),
  });
}

function detachAll(options) {
  for (const buffer of options?.transfer ?? []) {
    structuredClone(buffer, { transfer: [buffer] });
  }
}

function rendererDependencies(oldCanvas, newCanvas) {
  return {
    sequenceIndex: sequence => sequence[0],
    pageSizePt: vi.fn(async () => ({ w: 3, h: 1 })),
    framePlan: () => ({ oldScale: 1, newScale: 1, normalized: false }),
    renderPageCanvas: vi.fn(async doc => doc.id === "old" ? oldCanvas : newCanvas),
    rotateCanvas90: canvas => canvas,
    canvasToRgba: canvas => (canvas
      ? { data: new Uint8ClampedArray(canvas.data), width: canvas.width, height: canvas.height }
      : null),
    alignProbeScale: () => 1,
    downscaleCanvas: canvas => canvas,
    computeDiff: async (payload, options) => {
      const result = computeDiff({ ...payload, onProgress: options?.onProgress });
      detachAll(options);
      return result;
    },
    computeAlignment: async (payload, options) => {
      const result = computeAlignment(payload);
      detachAll(options);
      return result;
    },
    computeQuadrant: async (payload, options) => {
      const result = computeQuadrant(payload);
      detachAll(options);
      return result;
    },
    createCanvas: (width, height) => new MemoryCanvas(width, height),
    createWhiteCanvas: (width, height) => {
      const canvas = new MemoryCanvas(width, height);
      canvas.context.fillRect(0, 0, width, height);
      return canvas;
    },
    pageLabelText: () => "1 / 1",
  };
}

test("shares raw page identity without sharing completed toggle identity", () => {
  const snapshot = rendererSnapshot();
  const plan = { oldScale: 1, newScale: 1 };
  const identity = createVisualRawCacheIdentity(snapshot, 0, plan);
  const cache = { idx: 0, rawIdentity: identity };

  expect(visualRawCacheMatchesSnapshot(snapshot, cache, {
    quadrant: 0,
    framePlan: plan,
  })).toBe(true);
  expect(toggleCompletedCacheMatchesSnapshot(snapshot, cache)).toBe(false);
});

test.each([
  ["document generation", base => ({
    documents: Object.freeze({ ...base.documents, generation: base.documents.generation + 1 }),
  })],
  ["document identity", base => ({
    documents: Object.freeze({ ...base.documents, oldDoc: { ...base.documents.oldDoc } }),
  })],
  ["page sequence mapping", base => ({
    documents: Object.freeze({ ...base.documents, oldSequence: Object.freeze([1]) }),
  })],
  ["DPI", base => ({
    comparison: Object.freeze({ ...base.comparison, dpi: 144 }),
  })],
])("raw visual identity rejects %s changes", (_label, mutate) => {
  const snapshot = rendererSnapshot();
  const plan = { oldScale: 1, newScale: 1 };
  const cache = {
    idx: 0,
    rawIdentity: createVisualRawCacheIdentity(snapshot, 0, plan),
  };
  const changed = Object.freeze({ ...snapshot, ...mutate(snapshot) });

  expect(visualRawCacheMatchesSnapshot(changed, cache, {
    quadrant: 0,
    framePlan: plan,
  })).toBe(false);
});

test("raw visual identity ignores threshold tolerance and offsets", () => {
  const snapshot = rendererSnapshot();
  const plan = { oldScale: 1, newScale: 1 };
  const cache = {
    idx: 0,
    rawIdentity: createVisualRawCacheIdentity(snapshot, 0, plan),
  };
  const changed = Object.freeze({
    ...snapshot,
    comparison: Object.freeze({
      ...snapshot.comparison,
      threshold: 200,
      tolerancePx: 4,
      dx: 3,
      dy: 1,
    }),
  });

  expect(visualRawCacheMatchesSnapshot(changed, cache, {
    quadrant: 0,
    framePlan: plan,
  })).toBe(true);
});

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

test("puts the computed buffer straight onto the canvas without a second full-size copy", async () => {
  const oldCanvas = new MemoryCanvas(3, 1, rgba([0, 0, 255]));
  const newCanvas = new MemoryCanvas(3, 1, rgba([0, 255, 0]));
  const dependencies = rendererDependencies(oldCanvas, newCanvas);
  const compute = dependencies.computeDiff;
  let computedImage = null;
  dependencies.computeDiff = async (payload, options) => {
    const computed = await compute(payload, options);
    computedImage = computed.image;
    return computed;
  };
  const placed = [];
  dependencies.createCanvas = (width, height) => {
    const canvas = new MemoryCanvas(width, height);
    const put = canvas.context.putImageData.bind(canvas.context);
    canvas.context.putImageData = (image, x, y) => {
      placed.push(image);
      put(image, x, y);
    };
    return canvas;
  };

  await renderDiffPage(rendererSnapshot(), dependencies);

  expect(placed).toHaveLength(1);
  expect(placed[0]).toBeInstanceOf(MemoryImageData);
  expect(placed[0].data).toBe(computedImage);
  expect([placed[0].width, placed[0].height]).toEqual([3, 1]);
});

test("skips the alignment phase report while automatic alignment is off", async () => {
  const oldCanvas = new MemoryCanvas(3, 1, rgba([0, 0, 255]));
  const newCanvas = new MemoryCanvas(3, 1, rgba([0, 255, 0]));
  const dependencies = rendererDependencies(oldCanvas, newCanvas);
  const phases = [];

  await renderDiffPage(rendererSnapshot(), dependencies, {
    onProgress: value => phases.push(value.phase),
  });

  expect(phases).toContain("render");
  expect(phases).not.toContain("align");
  expect(phases).toContain("diff");
});

test("reports the alignment phase while automatic alignment is on", async () => {
  const oldCanvas = new MemoryCanvas(3, 1, rgba([0, 0, 255]));
  const newCanvas = new MemoryCanvas(3, 1, rgba([0, 255, 0]));
  const dependencies = rendererDependencies(oldCanvas, newCanvas);
  const base = rendererSnapshot();
  const snapshot = Object.freeze({
    ...base,
    comparison: Object.freeze({ ...base.comparison, autoAlign: true }),
  });
  const phases = [];

  await renderDiffPage(snapshot, dependencies, {
    onProgress: value => phases.push(value.phase),
  });

  expect(phases).toContain("align");
});

test("reports diff progress while the toggle mode computes its change boxes", async () => {
  const oldCanvas = new MemoryCanvas(3, 1, rgba([0, 60, 120]));
  const newCanvas = new MemoryCanvas(3, 1, rgba([20, 80, 140]));
  const dependencies = rendererDependencies(oldCanvas, newCanvas);
  const reports = [];

  await renderTogglePage(rendererSnapshot(), dependencies, {
    onProgress: value => reports.push(value),
  });

  const diffReports = reports.filter(value => value.phase === "diff");
  expect(diffReports.length).toBeGreaterThan(0);
  expect(diffReports.at(-1).ratio).toBe(1);
  expect(reports.some(value => value.phase === "align")).toBe(false);
});

test("applies one shared downscale factor to both canvases before alignment", async () => {
  const oldCanvas = new MemoryCanvas(3, 1, rgba([0, 0, 255]));
  const newCanvas = new MemoryCanvas(3, 1, rgba([0, 255, 0]));
  const dependencies = rendererDependencies(oldCanvas, newCanvas);
  dependencies.alignProbeScale = vi.fn(() => 0.5);
  dependencies.downscaleCanvas = vi.fn(canvas => canvas);
  dependencies.computeAlignment = vi.fn(() => ({
    angle: 0, scale: 1, txFrac: 0, tyFrac: 0, applied: false,
    method: "identity", scoreBase: 1, scoreBest: 1,
  }));
  const base = rendererSnapshot();
  const snapshot = Object.freeze({
    ...base,
    comparison: Object.freeze({ ...base.comparison, autoAlign: true }),
  });

  await renderDiffPage(snapshot, dependencies);

  expect(dependencies.alignProbeScale).toHaveBeenCalledTimes(1);
  expect(dependencies.alignProbeScale).toHaveBeenCalledWith([oldCanvas, newCanvas]);

  expect(dependencies.downscaleCanvas).toHaveBeenCalledTimes(2);
  const [oldCall, newCall] = dependencies.downscaleCanvas.mock.calls;
  expect(oldCall).toEqual([oldCanvas, 0.5]);
  expect(newCall).toEqual([newCanvas, 0.5]);
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
  const base = rendererSnapshot();

  const first = await renderTogglePage(base, dependencies);
  expect([...first.toggleCache.sideCanvases.old.data]).toEqual([...oldCanvas.data]);
  expect([...first.toggleCache.sideCanvases.new.data]).toEqual([...newCanvas.data]);
  expect(first.canvas).toBe(first.toggleCache.sideCanvases.old);
  expect(dependencies.renderPageCanvas).toHaveBeenCalledTimes(2);

  const secondSnapshot = Object.freeze({
    ...base,
    visual: Object.freeze({
      ...base.visual,
      toggleSide: "new",
      toggleCache: first.toggleCache,
    }),
  });
  const second = await renderTogglePage(secondSnapshot, dependencies);
  expect([...second.canvas.data]).toEqual([...first.toggleCache.sideCanvases.new.data]);
  expect(dependencies.renderPageCanvas).toHaveBeenCalledTimes(2);
});

test.each([
  ["document generation and identity", base => ({
    documents: Object.freeze({
      ...base.documents,
      generation: base.documents.generation + 1,
      oldDoc: { ...base.documents.oldDoc },
      newDoc: { ...base.documents.newDoc },
    }),
  })],
  ["DPI and frame plan", base => ({
    comparison: Object.freeze({ ...base.comparison, dpi: 144 }),
  })],
  ["page sequence mapping", base => ({
    documents: Object.freeze({
      ...base.documents,
      oldSequence: Object.freeze([1]),
    }),
  })],
])("rerenders toggle page canvases after %s changes", async (label, mutate) => {
  const oldCanvas = new MemoryCanvas(3, 1, rgba([0, 60, 120]));
  const newCanvas = new MemoryCanvas(3, 1, rgba([20, 80, 140]));
  const replacementOld = new MemoryCanvas(3, 1, rgba([10, 70, 130]));
  const replacementNew = new MemoryCanvas(3, 1, rgba([30, 90, 150]));
  const dependencies = rendererDependencies(oldCanvas, newCanvas);
  let activeOld = oldCanvas;
  let activeNew = newCanvas;
  dependencies.framePlan = (oldSize, newSize, dpi) => ({
    oldScale: dpi / 72,
    newScale: dpi / 72,
    normalized: false,
  });
  dependencies.renderPageCanvas = vi.fn(async doc => (
    doc.id === "old" ? activeOld : activeNew
  ));
  const base = rendererSnapshot();
  const first = await renderTogglePage(base, dependencies);
  activeOld = replacementOld;
  activeNew = replacementNew;
  const changed = Object.freeze({
    ...base,
    ...mutate(base),
    visual: Object.freeze({ ...base.visual, toggleCache: first.toggleCache }),
  });

  const second = await renderTogglePage(changed, dependencies);

  expect(dependencies.renderPageCanvas).toHaveBeenCalledTimes(4);
  expect(second.toggleCache.oldCanvas).toBe(replacementOld);
  expect(second.toggleCache.newCanvas).toBe(replacementNew);
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
