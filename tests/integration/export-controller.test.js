import { describe, expect, test, vi } from "vitest";
import { createAppState } from "../../src/app/state.js";
import { createExportController } from "../../src/features/export/export-controller.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function classList() {
  const values = new Set();
  return {
    add: value => values.add(value),
    remove: value => values.delete(value),
    contains: value => values.has(value),
  };
}

function textElement(text = "") {
  return { textContent: text, classList: classList() };
}

function canvas(width = 20, height = 10, pixels = [1, 2, 3, 255]) {
  const context = {
    calls: [],
    save() {}, restore() {}, clearRect() {},
    drawImage(source, x, y) { this.calls.push(["drawImage", source, x, y]); },
    fillRect(...args) { this.calls.push(["fillRect", this.fillStyle, ...args]); },
    strokeRect(...args) { this.calls.push(["strokeRect", this.strokeStyle, this.lineWidth, ...args]); },
    fillText(...args) { this.calls.push(["fillText", this.fillStyle, ...args]); },
    measureText: text => ({ width: text.length * 8 }),
  };
  const result = {
    width,
    height,
    pixels: [...pixels],
    style: { transform: "translate(4px, 5px) scale(2)" },
    getContext: () => context,
    cloneNode: () => canvas(0, 0, []),
    toBlob(callback) { callback(new Blob(["png"], { type: "image/png" })); },
  };
  return result;
}

function committedVisualOutput(state) {
  return {
    ready: true,
    mode: state.visual.mode,
    pageIndex: state.documents.currentPage,
    revision: state.boxEditor.revisionByPage.get(state.documents.currentPage) || 0,
    documentGeneration: state.documents.generation,
  };
}

function harness(overrides = {}) {
  const state = createAppState();
  state.documents.oldDoc = { id: "old", numPages: 2 };
  state.documents.newDoc = { id: "new", numPages: 2 };
  state.documents.pages = 2;
  state.documents.oldSequence = [0, 1];
  state.documents.newSequence = [0, 1];
  state.documents.currentPage = 0;
  state.documents.generation = 9;
  state.comparison.dpi = 150;
  state.comparison.quadrantManual.set(0, 1);
  state.visual.rendered = true;
  state.visual.currentPlan = { normalized: true, ratio: 2 };
  state.visual.pageCache.set(0, { rm: 1 });
  state.visual.alignmentCache.set(0, { tx: 1 });
  state.visual.quadrantCache.set(0, { k: 1 });
  state.visual.toggleCache = { stable: true };
  state.boxEditor.currentBoxes = [{ x: 1, y: 2, w: 3, h: 4 }];
  state.boxEditor.autoByPage.set(0, [{ x: 5, y: 6, w: 7, h: 8 }]);
  state.boxEditor.editsByPage.set(1, [{ x: 11, y: 12, w: 13, h: 14 }]);
  state.boxEditor.revisionByPage.set(1, 3);
  state.boxEditor.selectedIndex = 0;
  state.boxEditor.drag = { kind: "move" };
  state.visual.output = committedVisualOutput(state);
  state.textReview.scale = 2;
  state.textReview.page = 0;
  state.textReview.highlights = {
    old: new Map([[0, [{ color: "removed", token: { str: "A" } }]]]),
    new: new Map([[1, [{ color: "added", token: { str: "B" } }]]]),
  };
  state.textReview.extraction = { old: [[{ text: "A" }]], new: [[{ text: "B" }]] };
  const dom = {
    out: canvas(20, 10, [9, 8, 7, 255]),
    oldTextCanvas: canvas(30, 40),
    newTextCanvas: canvas(31, 41),
    status: textElement("差分を表示中"),
    textStatus: textElement("テキスト差分を表示中"),
    pageLabel: textElement("1 / 2"),
    zoomLabel: textElement("200%"),
    statRm: textElement("削除 1"),
    statAd: textElement("追加 2"),
    statBox: textElement("変更箇所 1（手編集）"),
    dlPng: { disabled: false },
    dlPdf: { disabled: false },
    dlTextPng: { disabled: false },
    dlTextPdf: { disabled: false },
  };
  const renderVisualOffscreen = vi.fn(async () => ({ canvas: canvas(100, 200), boxes: [] }));
  const renderVisualSplitOffscreen = vi.fn(async () => ({
    sideCanvases: { old: canvas(100, 200), new: canvas(100, 200) },
    boxes: [],
  }));
  const visualRenderSessions = [];
  const dependencies = {
    state,
    dom,
    renderVisualOffscreen,
    renderVisualSplitOffscreen,
    visualRenderSessions,
    createVisualRenderSession: vi.fn(() => {
      const session = {
        renderDiff: (...args) => dependencies.renderVisualOffscreen(...args),
        renderSplit: (...args) => dependencies.renderVisualSplitOffscreen(...args),
        cancel: vi.fn(),
      };
      visualRenderSessions.push(session);
      return session;
    }),
    renderTextOffscreen: vi.fn(async () => canvas(100, 200)),
    pdfExporter: {
      saveVisual: vi.fn(async ({ pageCount, renderPage }) => {
        for (let page = 0; page < pageCount; page += 1) await renderPage(page);
      }),
      saveText: vi.fn(async ({ pageCount, renderPage }) => {
        for (let page = 0; page < pageCount; page += 1) await renderPage(page);
      }),
    },
    download: vi.fn(),
    errorReporter: { report: vi.fn() },
    textColors: { removed: "#ff5b57", added: "#2e9b55", changed: "#ffd43b" },
    ...overrides,
  };
  return { state, dom, dependencies, controller: createExportController(dependencies) };
}

function protectedReferences(state, dom) {
  return {
    out: dom.out,
    outSize: [dom.out.width, dom.out.height],
    outPixels: [...dom.out.pixels],
    outTransform: dom.out.style.transform,
    oldTextCanvas: dom.oldTextCanvas,
    oldTextSize: [dom.oldTextCanvas.width, dom.oldTextCanvas.height],
    newTextCanvas: dom.newTextCanvas,
    newTextSize: [dom.newTextCanvas.width, dom.newTextCanvas.height],
    currentPage: state.documents.currentPage,
    documentPages: state.documents.pages,
    documentGeneration: state.documents.generation,
    oldSequence: state.documents.oldSequence,
    oldSequenceValue: [...state.documents.oldSequence],
    newSequence: state.documents.newSequence,
    newSequenceValue: [...state.documents.newSequence],
    quadrantManual: state.comparison.quadrantManual,
    selectedIndex: state.boxEditor.selectedIndex,
    drag: state.boxEditor.drag,
    visualGeneration: state.visual.renderGeneration,
    textRenderGeneration: state.textReview.renderGeneration,
    textExtractGeneration: state.textReview.extractGeneration,
    pageCache: state.visual.pageCache,
    alignmentCache: state.visual.alignmentCache,
    quadrantCache: state.visual.quadrantCache,
    toggleCache: state.visual.toggleCache,
    currentPlan: state.visual.currentPlan,
    visualRendered: state.visual.rendered,
    autoByPage: state.boxEditor.autoByPage,
    editsByPage: state.boxEditor.editsByPage,
    undoByPage: state.boxEditor.undoByPage,
    revisionByPage: state.boxEditor.revisionByPage,
    currentBoxes: state.boxEditor.currentBoxes,
    textHighlights: state.textReview.highlights,
    textExtraction: state.textReview.extraction,
    textView: state.textReview.view,
    textViewValue: { ...state.textReview.view },
    textPage: state.textReview.page,
    textScale: state.textReview.scale,
    mode: state.visual.mode,
    topMode: state.ui.topMode,
    appBusy: state.ui.busy,
    status: dom.status.textContent,
    pageLabel: dom.pageLabel.textContent,
    zoomLabel: dom.zoomLabel.textContent,
    statRm: dom.statRm.textContent,
    statAd: dom.statAd.textContent,
    statBox: dom.statBox.textContent,
  };
}

describe("visual export snapshots", () => {
  test("renders every PDF page from one frozen snapshot and mutates no screen/cache/box state", async () => {
    const { state, dom, dependencies, controller } = harness();
    const before = protectedReferences(state, dom);
    const beforeAutoEntries = [...state.boxEditor.autoByPage].map(([page, boxes]) => [
      page,
      boxes.map(box => ({ ...box })),
    ]);
    const snapshots = [];
    dependencies.renderVisualOffscreen.mockImplementation(async ({ snapshot, pageIndex }) => {
      snapshots.push(snapshot);
      expect(snapshot.comparison.dpi).toBe(150);
      expect(snapshot.documents.oldSequence).toEqual([0, 1]);
      return { canvas: canvas(150 + pageIndex, 300), boxes: [{ x: pageIndex, y: 0, w: 4, h: 5 }] };
    });

    await controller.saveVisualPdf();

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toBe(snapshots[1]);
    expect(Object.isFrozen(snapshots[0])).toBe(true);
    expect(state.boxEditor.autoByPage).toBe(before.autoByPage);
    expect([...state.boxEditor.autoByPage]).toEqual(beforeAutoEntries);
    expect(state.boxEditor.editsByPage).toBe(before.editsByPage);
    expect({ ...protectedReferences(state, dom), status: before.status }).toEqual(before);
    expect(dom.status.textContent).toBe("PDFを保存しました");
  });

  test("renders every split PDF page offscreen from one frozen export snapshot", async () => {
    const { state, dom, dependencies, controller } = harness();
    state.visual.mode = "split";
    state.visual.splitCache = { idx: 0, screenOnly: true };
    dom.splitOldCanvas = { cloneNode: () => { throw new Error("screen OLD must not be used"); } };
    dom.splitNewCanvas = { cloneNode: () => { throw new Error("screen NEW must not be used"); } };
    const before = protectedReferences(state, dom);
    const renderInputs = [];
    const composed = [];
    dependencies.pdfExporter.saveVisual.mockImplementation(async ({ pageCount, renderPage }) => {
      for (let page = 0; page < pageCount; page += 1) composed.push(await renderPage(page));
    });
    dependencies.renderVisualSplitOffscreen.mockImplementation(async input => {
      renderInputs.push(input);
      if (input.pageIndex === 0) {
        state.visual.mode = "diff";
        state.comparison.dpi = 300;
        state.documents.oldSequence[1] = null;
        state.boxEditor.autoByPage.set(0, [{ x: 90, y: 90, w: 1, h: 1 }]);
        state.boxEditor.editsByPage.set(1, [{ x: 99, y: 99, w: 1, h: 1 }]);
      }
      return {
        sideCanvases: {
          old: canvas(100 + input.pageIndex, 200),
          new: canvas(100 + input.pageIndex, 200),
        },
        boxes: [{ x: input.pageIndex, y: 0, w: 2, h: 2 }],
      };
    });

    await controller.saveVisualPdf();

    expect(dependencies.pdfExporter.saveVisual).toHaveBeenCalledWith(expect.objectContaining({
      filename: "side-by-side.pdf",
      pageCount: 2,
      dpi: 150,
    }));
    expect(renderInputs).toHaveLength(2);
    expect(renderInputs[0].snapshot).toBe(renderInputs[1].snapshot);
    expect(renderInputs.map(input => input.pageIndex)).toEqual([0, 1]);
    expect(renderInputs.map(input => input.renderSnapshot.mode)).toEqual(["split", "split"]);
    expect(renderInputs.map(input => input.renderSnapshot.visual.splitCache)).toEqual([null, null]);
    expect(renderInputs[0].renderSnapshot.boxEditor).toMatchObject({
      showBoxes: true,
      manualBoxes: null,
      autoBoxes: [{ x: 5, y: 6, w: 7, h: 8 }],
    });
    expect(renderInputs[1].renderSnapshot.boxEditor).toMatchObject({
      showBoxes: true,
      manualBoxes: [{ x: 11, y: 12, w: 13, h: 14 }],
      autoBoxes: null,
    });
    expect(Object.isFrozen(renderInputs[0].renderSnapshot.boxEditor.autoBoxes)).toBe(true);
    expect(Object.isFrozen(renderInputs[0].renderSnapshot.boxEditor.autoBoxes[0])).toBe(true);
    expect(renderInputs[1].renderSnapshot.documents.oldSequence).toEqual([0, 1]);
    expect(renderInputs[1].renderSnapshot.comparison.dpi).toBe(150);
    expect(composed.map(item => [item.width, item.height])).toEqual([
      [202, 258],
      [204, 258],
    ]);
    expect(composed.map(item => item.getContext("2d").calls
      .filter(call => call[0] === "fillText").map(call => call[2])))
      .toEqual([["OLD", "NEW", "p 1 / 2"], ["OLD", "NEW", "p 2 / 2"]]);
    expect(composed.flatMap(item => item.getContext("2d").calls)
      .some(call => call[0] === "strokeRect")).toBe(false);
    expect(dom.out).toBe(before.out);
    expect(state.documents.currentPage).toBe(before.currentPage);
    expect(state.visual.pageCache).toBe(before.pageCache);
    expect(state.visual.alignmentCache).toBe(before.alignmentCache);
    expect(state.visual.quadrantCache).toBe(before.quadrantCache);
    expect(state.boxEditor.selectedIndex).toBe(before.selectedIndex);
    expect(state.boxEditor.drag).toBe(before.drag);
    expect(state.visual.splitCache).toEqual({ idx: 0, screenOnly: true });
    expect(dom.status.textContent).toBe("PDFを保存しました");
  });

  test("live settings, documents, boxes and text changes cannot alter later PDF render inputs", async () => {
    const { state, dependencies, controller } = harness();
    const snapshots = [];
    dependencies.renderVisualOffscreen.mockImplementation(async ({ snapshot, pageIndex }) => {
      snapshots.push(snapshot);
      if (pageIndex === 0) {
        state.comparison.dpi = 300;
        state.documents.oldDoc = { id: "replacement", numPages: 7 };
        state.documents.oldSequence[1] = null;
        state.boxEditor.showBoxes = false;
        state.boxEditor.editsByPage.set(1, [{ x: 99, y: 99, w: 1, h: 1 }]);
        state.textReview.scale = 8;
        state.textReview.highlights.old.clear();
      }
      expect(snapshot.comparison.dpi).toBe(150);
      expect(snapshot.documents.old.id).toBe("old");
      expect(snapshot.documents.oldSequence).toEqual([0, 1]);
      expect(snapshot.boxEditor.showBoxes).toBe(true);
      expect(snapshot.boxEditor.editsByPage.get(1)).toEqual([{ x: 11, y: 12, w: 13, h: 14 }]);
      expect(snapshot.scale).toBe(2);
      expect(snapshot.highlights.old.get(0)).toHaveLength(1);
      return { canvas: canvas(150, 300), boxes: [] };
    });

    await controller.saveVisualPdf();

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toBe(snapshots[1]);
  });

  test("exposes every snapshot Map as read-only without leaking its mutable backing Map", async () => {
    const { state, dependencies, controller } = harness();
    const seen = [];
    dependencies.renderVisualOffscreen.mockImplementation(async ({ snapshot, pageIndex }) => {
      const maps = [
        snapshot.comparison.quadrantManual,
        snapshot.visual.pageCache,
        snapshot.visual.alignmentCache,
        snapshot.visual.quadrantCache,
        snapshot.boxEditor.autoByPage,
        snapshot.boxEditor.editsByPage,
        snapshot.boxEditor.revisionByPage,
        snapshot.highlights.old,
        snapshot.highlights.new,
      ];
      for (const map of maps) {
        expect(Object.isFrozen(map)).toBe(true);
        expect(map.set).toBeUndefined();
        expect(map.delete).toBeUndefined();
        expect(map.clear).toBeUndefined();
        expect(() => map.set("sentinel", [])).toThrow(TypeError);
        expect(() => map.delete(0)).toThrow(TypeError);
        expect(() => map.clear()).toThrow(TypeError);
        expect([...map]).toEqual([...map.entries()]);
        expect([...map.keys()].length).toBe(map.size);
        expect([...map.values()].length).toBe(map.size);
        const iterated = [];
        map.forEach((value, key, owner) => iterated.push([key, value, owner]));
        expect(iterated.every(entry => entry[2] === map)).toBe(true);
      }
      const pair = snapshot.boxEditor.autoByPage.entries().next().value;
      pair[0] = 99;
      expect(snapshot.boxEditor.autoByPage.has(0)).toBe(true);
      expect(Object.isFrozen(snapshot.boxEditor.autoByPage.get(0))).toBe(true);
      seen.push(maps);
      return { canvas: canvas(100, 200), boxes: [] };
    });

    await controller.saveVisualPdf();

    expect(seen).toHaveLength(2);
    expect(state.boxEditor.autoByPage.has(0)).toBe(true);
    expect(state.boxEditor.autoByPage.has(99)).toBe(false);
  });

  test("manual page boxes override renderer boxes locally and boxes-off removes box overlay and legend", async () => {
    const { state, dependencies, controller } = harness();
    const composed = [];
    dependencies.pdfExporter.saveVisual.mockImplementation(async ({ pageCount, renderPage }) => {
      for (let page = 0; page < pageCount; page += 1) composed.push(await renderPage(page));
    });
    dependencies.renderVisualOffscreen.mockResolvedValue({
      canvas: canvas(200, 100),
      boxes: [{ x: 90, y: 90, w: 2, h: 2 }],
    });

    await controller.saveVisualPdf();
    const manualStroke = composed[1].getContext("2d").calls.find(call => call[0] === "strokeRect" && call[1] === "#ff9500");
    expect(manualStroke.slice(-4)).toEqual([12.5, 13.5, 10, 11]);
    expect(state.boxEditor.autoByPage.has(1)).toBe(false);

    state.boxEditor.showBoxes = false;
    composed.length = 0;
    await controller.saveVisualPdf();
    expect(composed.flatMap(item => item.getContext("2d").calls)
      .some(call => call[0] === "strokeRect" && call[1] === "#ff9500")).toBe(false);
    expect(composed.flatMap(item => item.getContext("2d").calls)
      .some(call => call[0] === "fillText" && call[2] === "変更枠")).toBe(false);
  });

  test("captures visual PNG pixels, filename, boxes and legend before Blob completion", async () => {
    const { state, dom, dependencies, controller } = harness();
    state.visual.mode = "toggle";
    state.visual.toggleSide = "old";
    state.visual.output = committedVisualOutput(state);
    const sourcePixels = [...dom.out.pixels];
    let blobCallback;
    dom.out.cloneNode = () => {
      const clone = canvas(0, 0, []);
      clone.toBlob = callback => { blobCallback = callback; };
      return clone;
    };

    const saving = controller.saveVisualPng();
    state.visual.toggleSide = "new";
    state.visual.mode = "diff";
    state.documents.currentPage = 1;
    blobCallback(new Blob(["png"]));
    await saving;

    expect(dom.out.pixels).toEqual(sourcePixels);
    expect(dependencies.download).toHaveBeenCalledWith(expect.any(Blob), "old_p1.png");
  });

  test("keeps diff and bare toggle PNG filenames and legend rules distinct", async () => {
    const { state, dom, dependencies, controller } = harness();
    const composed = [];
    dom.out.cloneNode = () => {
      const clone = canvas(0, 0, []);
      composed.push(clone);
      return clone;
    };

    await controller.saveVisualPng();
    expect(dependencies.download).toHaveBeenLastCalledWith(expect.any(Blob), "diff_p1.png");
    expect(composed[0].getContext("2d").calls
      .filter(call => call[0] === "fillText").map(call => call[2]))
      .toEqual(["共通", "削除（旧版のみ）", "追加（新版のみ）", "変更枠"]);

    state.visual.mode = "toggle";
    state.visual.toggleSide = "new";
    state.documents.currentPage = 1;
    state.boxEditor.showBoxes = false;
    state.visual.output = committedVisualOutput(state);
    await controller.saveVisualPng();
    expect(dependencies.download).toHaveBeenLastCalledWith(expect.any(Blob), "new_p2.png");
    expect(composed[1].getContext("2d").calls.some(call => call[0] === "fillText")).toBe(false);
    expect(composed[1].getContext("2d").calls.some(call => call[0] === "strokeRect")).toBe(false);
  });

  test("refuses PNG until the live visual output identity is committed", async () => {
    const { state, dom, dependencies, controller } = harness();
    state.visual.mode = "split";
    dom.splitOldCanvas = canvas(100, 200);
    dom.splitNewCanvas = canvas(100, 200);

    expect(await controller.saveVisualPng()).toBe(false);

    expect(dependencies.download).not.toHaveBeenCalled();
    expect(dependencies.errorReporter.report).not.toHaveBeenCalled();
    expect(dom.dlPng.disabled).toBe(false);
    expect(dom.status.textContent).toBe("差分を表示中");
    expect(dom.status.classList.contains("busy")).toBe(false);
  });

  test("saves a diff PNG after box edits without waiting for a new visual commit", async () => {
    const { state, dom, dependencies, controller } = harness();
    const composed = [];
    dom.out.cloneNode = () => {
      const clone = canvas(0, 0, []);
      composed.push(clone);
      return clone;
    };
    state.boxEditor.currentBoxes = [{ x: 10, y: 20, w: 100, h: 50 }];
    state.boxEditor.revisionByPage.set(0, 7);

    expect(await controller.saveVisualPng()).toBe(true);
    expect(dependencies.download).toHaveBeenCalledWith(expect.any(Blob), "diff_p1.png");
    expect(composed[0].getContext("2d").calls.some(call => (
      call[0] === "strokeRect" && call[1] === "#ff9500"
    ))).toBe(true);
  });

  test("refuses split PNG when the baked box revision does not match", async () => {
    const { state, dom, dependencies, controller } = harness();
    state.visual.mode = "split";
    state.visual.output = committedVisualOutput(state);
    state.boxEditor.revisionByPage.set(0, 1);
    dom.splitOldCanvas = canvas(100, 200);
    dom.splitNewCanvas = canvas(100, 200);

    expect(await controller.saveVisualPng()).toBe(false);
    expect(dependencies.download).not.toHaveBeenCalled();
    expect(dependencies.errorReporter.report).not.toHaveBeenCalled();
  });

  test("refuses PNG when the committed page does not match the current page", async () => {
    const { state, dependencies, controller } = harness();
    state.visual.output = committedVisualOutput(state);
    state.visual.output.pageIndex = 1;

    expect(await controller.saveVisualPng()).toBe(false);
    expect(dependencies.download).not.toHaveBeenCalled();
    expect(dependencies.errorReporter.report).not.toHaveBeenCalled();
  });

  test("saves the committed split page with a stable filename and frozen page number", async () => {
    const { state, dom, dependencies, controller } = harness();
    state.visual.mode = "split";
    state.visual.output = committedVisualOutput(state);
    dom.splitOldCanvas = canvas(100, 200);
    dom.splitNewCanvas = canvas(100, 200);

    const saving = controller.saveVisualPng();
    state.documents.currentPage = 1;
    await saving;

    expect(dependencies.download)
      .toHaveBeenCalledWith(expect.any(Blob), "side-by-side_p1.png");
  });

  test("clones split canvases before awaiting Blob and ignores later screen changes", async () => {
    const { state, dom, dependencies, controller } = harness();
    state.visual.mode = "split";
    state.visual.output = committedVisualOutput(state);
    state.documents.currentPage = 0;
    state.documents.pages = 2;
    state.comparison.dpi = 72;
    const oldPixels = [11, 12, 13, 255];
    const newPixels = [21, 22, 23, 255];
    dom.splitOldCanvas = canvas(10, 8, oldPixels);
    dom.splitNewCanvas = canvas(10, 8, newPixels);
    const newTransform = dom.splitNewCanvas.style.transform;
    let blobCallback;
    let outputCanvas;
    const makeClone = () => {
      const clone = canvas(0, 0, []);
      clone.cloneNode = makeClone;
      const context = clone.getContext("2d");
      const recordDraw = context.drawImage.bind(context);
      context.drawImage = (source, x, y) => {
        recordDraw(source, x, y);
        if (x === 0 && y === 0 && source.width === clone.width && source.height === clone.height) {
          clone.pixels = [...source.pixels];
        }
      };
      clone.toBlob = callback => {
        outputCanvas = clone;
        blobCallback = callback;
      };
      return clone;
    };
    dom.splitOldCanvas.cloneNode = makeClone;
    dom.splitNewCanvas.cloneNode = makeClone;

    const saving = controller.saveVisualPng();
    dom.splitOldCanvas.pixels.fill(0);
    dom.splitNewCanvas.pixels.fill(0);
    dom.splitOldCanvas.style.transform = "scale(9)";
    state.visual.mode = "diff";
    state.documents.currentPage = 1;
    state.documents.pages = 9;
    state.comparison.dpi = 300;
    blobCallback(new Blob(["png"]));
    await saving;

    expect(dependencies.download).toHaveBeenCalledWith(expect.any(Blob), "side-by-side_p1.png");
    expect(dom.splitOldCanvas.pixels).toEqual([0, 0, 0, 0]);
    expect(dom.splitNewCanvas.style.transform).toBe(newTransform);
    expect(dom.splitOldCanvas.style.transform).toBe("scale(9)");
    const images = outputCanvas.getContext("2d").calls.filter(call => call[0] === "drawImage");
    expect(images).toHaveLength(2);
    expect(images[0][1]).not.toBe(dom.splitOldCanvas);
    expect(images[1][1]).not.toBe(dom.splitNewCanvas);
    expect([...images[0][1].pixels]).toEqual(oldPixels);
    expect([...images[1][1].pixels]).toEqual(newPixels);
    expect(images[0].slice(2)).toEqual([0, 28]);
    expect(images[1].slice(2)).toEqual([11, 28]);
    expect([outputCanvas.width, outputCanvas.height]).toEqual([21, 36]);
    expect(outputCanvas.getContext("2d").calls.some(call => (
      call[0] === "strokeRect" && call[1] === "#ff9500"
    ))).toBe(false);
    expect(outputCanvas.getContext("2d").calls.some(call => (
      call[0] === "fillText" && call[2] === "共通"
    ))).toBe(false);
  });
});

describe("text export snapshots", () => {
  test("keeps documents, highlights, scale and page stable across PDF awaits without touching the text view", async () => {
    const { state, dom, dependencies, controller } = harness();
    state.ui.topMode = "text";
    const before = protectedReferences(state, dom);
    const calls = [];
    dependencies.renderTextOffscreen.mockImplementation(async ({ side, pageIndex, snapshot }) => {
      calls.push({ side, pageIndex, snapshot });
      if (side === "new" && pageIndex === 0) {
        state.documents.oldDoc = { id: "replacement", numPages: 8 };
        state.textReview.scale = 9;
        state.textReview.page = 1;
        state.textReview.highlights.old.clear();
      }
      expect(snapshot.documents.old.id).toBe("old");
      expect(snapshot.scale).toBe(2);
      expect(snapshot.highlights.old.get(0)).toHaveLength(1);
      return canvas(100, 200);
    });

    await controller.saveTextPdf();

    expect(new Set(calls.map(call => call.snapshot)).size).toBe(1);
    expect(calls).toHaveLength(4);
    expect(dom.oldTextCanvas).toBe(before.oldTextCanvas);
    expect(dom.newTextCanvas).toBe(before.newTextCanvas);
    expect([dom.oldTextCanvas.width, dom.oldTextCanvas.height]).toEqual(before.oldTextSize);
    expect([dom.newTextCanvas.width, dom.newTextCanvas.height]).toEqual(before.newTextSize);
    expect(state.textReview.renderGeneration).toBe(before.textRenderGeneration);
    expect(state.textReview.extractGeneration).toBe(before.textExtractGeneration);
  });
});

describe("export error and overlap ownership", () => {
  test("reports a current null Blob once and restores its buttons", async () => {
    const { dom, dependencies, controller } = harness();
    dom.out.cloneNode = () => ({
      ...canvas(0, 0, []),
      toBlob(callback) { callback(null); },
    });

    await controller.saveVisualPng();

    expect(dependencies.errorReporter.report).toHaveBeenCalledTimes(1);
    expect(dependencies.errorReporter.report).toHaveBeenCalledWith(
      expect.any(Error), "PNGの保存に失敗しました", dom.status,
    );
    expect(dom.dlPng.disabled).toBe(false);
    expect(dom.dlPdf.disabled).toBe(false);
  });

  test("abandons a delayed visual PNG download after document invalidation without reporting an error", async () => {
    const { state, dom, dependencies, controller } = harness();
    let blobCallback;
    dom.out.cloneNode = () => {
      const clone = canvas(0, 0, []);
      clone.toBlob = callback => { blobCallback = callback; };
      return clone;
    };

    const saving = controller.saveVisualPng();
    expect(controller.invalidateDocuments(10)).toBe(true);
    state.documents.generation = 10;
    dom.status.textContent = "PDFの読み込みに失敗しました";
    blobCallback(new Blob(["png"]));
    await saving;

    expect(dependencies.download).not.toHaveBeenCalled();
    expect(dependencies.errorReporter.report).not.toHaveBeenCalled();
    expect(dom.status.textContent).toBe("PDFの読み込みに失敗しました");
    expect(dom.dlPng.disabled).toBe(false);
  });

  test("reports a split PNG Blob failure once and restores owned buttons", async () => {
    const { state, dom, dependencies, controller } = harness();
    state.visual.mode = "split";
    state.visual.output = committedVisualOutput(state);
    const makeClone = () => {
      const clone = canvas(0, 0, []);
      clone.cloneNode = makeClone;
      clone.toBlob = callback => { callback(null); };
      return clone;
    };
    dom.splitOldCanvas = canvas(10, 8);
    dom.splitNewCanvas = canvas(10, 8);
    dom.splitOldCanvas.cloneNode = makeClone;
    dom.splitNewCanvas.cloneNode = makeClone;

    await controller.saveVisualPng();

    expect(dependencies.errorReporter.report).toHaveBeenCalledTimes(1);
    expect(dependencies.errorReporter.report).toHaveBeenCalledWith(
      expect.any(Error), "PNGの保存に失敗しました", dom.status,
    );
    expect(dom.dlPng.disabled).toBe(false);
    expect(dom.dlPdf.disabled).toBe(false);
  });

  test("reports a null split PDF render once and restores owned buttons", async () => {
    const { state, dom, dependencies, controller } = harness();
    state.visual.mode = "split";
    dependencies.renderVisualSplitOffscreen.mockResolvedValue(null);

    expect(await controller.saveVisualPdf()).toBe(false);

    expect(dependencies.errorReporter.report).toHaveBeenCalledTimes(1);
    expect(dependencies.errorReporter.report).toHaveBeenCalledWith(
      expect.any(Error), "PDFの保存に失敗しました", dom.status,
    );
    expect(dom.dlPng.disabled).toBe(false);
    expect(dom.dlPdf.disabled).toBe(false);
  });

  test("an older rejection cannot overwrite the newer success or re-own controls", async () => {
    const first = deferred();
    const second = deferred();
    let invocation = 0;
    const { dom, dependencies, controller } = harness({
      pdfExporter: {
        saveVisual: vi.fn(() => (++invocation === 1 ? first.promise : second.promise)),
        saveText: vi.fn(),
      },
    });

    const older = controller.saveVisualPdf();
    const newer = controller.saveVisualPdf();
    second.resolve();
    await newer;
    first.reject(new Error("old failure"));
    await older;

    expect(dom.status.textContent).toBe("PDFを保存しました");
    expect(dom.dlPng.disabled).toBe(false);
    expect(dom.dlPdf.disabled).toBe(false);
    expect(dependencies.errorReporter.report).not.toHaveBeenCalled();
  });

  test("document invalidation abandons a pending export UI lease while preserving later load failure status", async () => {
    const pending = deferred();
    const { dom, controller } = harness({
      pdfExporter: { saveVisual: vi.fn(() => pending.promise), saveText: vi.fn() },
    });

    const saving = controller.saveVisualPdf();
    expect(dom.dlPng.disabled).toBe(true);
    expect(dom.status.classList.contains("busy")).toBe(true);

    expect(controller.invalidateDocuments(10)).toBe(true);
    expect(dom.status.textContent).toBe("PDF生成中…");
    expect(dom.status.classList.contains("busy")).toBe(false);
    expect(dom.dlPng.disabled).toBe(false);
    expect(dom.dlPdf.disabled).toBe(false);
    dom.status.textContent = "PDFの読み込みに失敗しました";

    pending.resolve();
    await saving;
    expect(dom.status.textContent).toBe("PDFの読み込みに失敗しました");
    expect(dom.status.classList.contains("busy")).toBe(false);
    expect(dom.dlPng.disabled).toBe(false);
    expect(dom.dlPdf.disabled).toBe(false);
  });

  test("document invalidation cancels the abandoned export render session and the next export opens a fresh one", async () => {
    const pending = deferred();
    const { dependencies, controller } = harness({
      pdfExporter: { saveVisual: vi.fn(() => pending.promise), saveText: vi.fn() },
    });

    const saving = controller.saveVisualPdf();
    expect(dependencies.visualRenderSessions).toHaveLength(1);
    expect(dependencies.visualRenderSessions[0].cancel).not.toHaveBeenCalled();

    expect(controller.invalidateDocuments(10)).toBe(true);
    expect(dependencies.visualRenderSessions[0].cancel).toHaveBeenCalledTimes(1);

    pending.resolve();
    await saving;

    await controller.saveVisualPdf();
    expect(dependencies.visualRenderSessions).toHaveLength(2);
    expect(dependencies.visualRenderSessions[1]).not.toBe(dependencies.visualRenderSessions[0]);
    expect(dependencies.visualRenderSessions[1].cancel).not.toHaveBeenCalled();
  });

  test("document-owned disabled state survives old export completion and overlapping export tokens", async () => {
    const first = deferred();
    const second = deferred();
    let call = 0;
    const { dom, controller } = harness({
      pdfExporter: {
        saveVisual: vi.fn(() => (++call === 1 ? first.promise : second.promise)),
        saveText: vi.fn(),
      },
    });

    const older = controller.saveVisualPdf();
    const newer = controller.saveVisualPdf();
    expect(controller.invalidateDocuments(10)).toBe(true);
    dom.status.textContent = "準備完了 — 「差分を表示」を押してください";
    dom.dlPng.disabled = true;
    dom.dlPdf.disabled = true;

    second.resolve();
    await newer;
    first.resolve();
    await older;

    expect(dom.status.textContent).toBe("準備完了 — 「差分を表示」を押してください");
    expect(dom.dlPng.disabled).toBe(true);
    expect(dom.dlPdf.disabled).toBe(true);
    expect(controller.invalidateDocuments(9)).toBe(false);
  });

  test.each([
    ["visual PDF render", "visual", "PDFの保存に失敗しました"],
    ["text PNG render", "text", "PNGの保存に失敗しました"],
    ["visual PNG download", "download", "PNGの保存に失敗しました"],
  ])("%s failure reports once, restores owned controls, and leaves protected state intact", async (_name, kind, message) => {
    const { state, dom, dependencies, controller } = harness();
    const before = protectedReferences(state, dom);
    if (kind === "visual") dependencies.pdfExporter.saveVisual.mockRejectedValue(new Error("pdf"));
    if (kind === "text") {
      state.ui.topMode = "text";
      dependencies.renderTextOffscreen.mockRejectedValue(new Error("text render"));
    }
    if (kind === "download") dependencies.download.mockRejectedValue(new Error("download"));

    if (kind === "visual") await controller.saveVisualPdf();
    else if (kind === "text") await controller.saveTextPng();
    else await controller.saveVisualPng();

    const status = kind === "text" ? dom.textStatus : dom.status;
    expect(dependencies.errorReporter.report).toHaveBeenCalledTimes(1);
    expect(dependencies.errorReporter.report).toHaveBeenCalledWith(expect.any(Error), message, status);
    expect(dom.dlPng.disabled).toBe(false);
    expect(dom.dlPdf.disabled).toBe(false);
    expect(dom.dlTextPng.disabled).toBe(false);
    expect(dom.dlTextPdf.disabled).toBe(false);
    expect({ ...protectedReferences(state, dom), topMode: before.topMode, mode: before.mode, status: before.status }).toEqual(before);
  });
});
