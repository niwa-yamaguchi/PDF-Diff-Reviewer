import { afterAll, expect, test, vi } from "vitest";
import { computeDiff } from "../../src/core/image-diff/diff-compute.js";
import { computeAlignment, computeQuadrant } from "../../src/core/alignment/align-compute.js";
import {
  createVisualRawCacheIdentity,
  visualRawCacheMatchesSnapshot,
} from "../../src/features/visual-diff/visual-renderer.js";
import { renderSplitPage } from "../../src/features/visual-diff/split-renderer.js";

class MemoryImageData {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

vi.stubGlobal("ImageData", MemoryImageData);
afterAll(() => vi.unstubAllGlobals());

class RecordingCanvas {
  constructor(width, height, pixels) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
    if (pixels) this.data.set(pixels);
    this.context = new RecordingContext(this);
  }

  getContext() {
    return this.context;
  }
}

class RecordingContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.calls = [];
    this.fillStyle = "#fff";
    this.strokeStyle = "#000";
    this.lineWidth = 1;
    this.font = "";
    this.textAlign = "start";
    this.textBaseline = "alphabetic";
  }

  save() { this.calls.push(["save"]); }
  restore() { this.calls.push(["restore"]); }
  setTransform() { this.calls.push(["setTransform"]); }
  fillText(text, x, y) { this.calls.push(["fillText", text, x, y]); }
  strokeRect(...args) { this.calls.push(["strokeRect", this.strokeStyle, ...args]); }

  fillRect(x = 0, y = 0, width = this.canvas.width, height = this.canvas.height) {
    this.calls.push(["fillRect", this.fillStyle, x, y, width, height]);
    const color = this.fillStyle === "#fff" || this.fillStyle === "#ffffff"
      ? [255, 255, 255, 255]
      : null;
    if (!color) return;
    const x1 = Math.max(0, Math.floor(x));
    const y1 = Math.max(0, Math.floor(y));
    const x2 = Math.min(this.canvas.width, Math.ceil(x + width));
    const y2 = Math.min(this.canvas.height, Math.ceil(y + height));
    for (let py = y1; py < y2; py += 1) {
      for (let px = x1; px < x2; px += 1) {
        this.canvas.data.set(color, (py * this.canvas.width + px) * 4);
      }
    }
  }

  getImageData(x, y, width, height) {
    return { width, height, data: new Uint8ClampedArray(this.canvas.data) };
  }

  putImageData(image) {
    this.canvas.data.set(image.data);
  }

  drawImage(source, dx = 0, dy = 0, dw = source.width, dh = source.height) {
    this.calls.push(["drawImage", source, dx, dy]);
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
}

const rgba = values => new Uint8ClampedArray(values.flatMap(value => [value, value, value, 255]));

function splitSnapshot({
  manualBoxes = null,
  autoBoxes = null,
  showBoxes = true,
  splitCache = null,
  comparison = {},
} = {}) {
  return Object.freeze({
    pageIndex: 0,
    mode: "split",
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
      ...comparison,
    }),
    visual: Object.freeze({
      toggleSide: "old",
      toggleCache: null,
      splitCache,
      renderGeneration: 1,
      currentPlan: null,
      alignmentCache: new Map(),
      quadrantCache: new Map(),
      quadrantGeneration: 0,
    }),
    boxEditor: Object.freeze({ showBoxes, manualBoxes, autoBoxes }),
  });
}

function detachAll(options) {
  for (const buffer of options?.transfer ?? []) {
    structuredClone(buffer, { transfer: [buffer] });
  }
}

function dependencies({ oldCanvas, newCanvas } = {}) {
  const defaultOld = oldCanvas === undefined
    ? new RecordingCanvas(3, 1, rgba([0, 60, 120]))
    : oldCanvas;
  const defaultNew = newCanvas === undefined
    ? new RecordingCanvas(3, 1, rgba([20, 80, 140]))
    : newCanvas;
  return {
    sequenceIndex: sequence => sequence[0],
    pageSizePt: vi.fn(async () => ({ w: 3, h: 1 })),
    framePlan: () => ({ oldScale: 1, newScale: 1, normalized: false }),
    renderPageCanvas: vi.fn(async doc => (doc.id === "old" ? defaultOld : defaultNew)),
    rotateCanvas90: canvas => canvas,
    canvasToRgba: canvas => (canvas
      ? { data: new Uint8ClampedArray(canvas.data), width: canvas.width, height: canvas.height }
      : null),
    alignProbeScale: () => 1,
    downscaleCanvas: canvas => canvas,
    computeDiff: vi.fn(async (payload, options) => {
      const result = computeDiff({ ...payload, onProgress: options?.onProgress });
      detachAll(options);
      return result;
    }),
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
    createCanvas: (width, height) => new RecordingCanvas(width, height),
    createWhiteCanvas: (width, height) => {
      const canvas = new RecordingCanvas(width, height);
      canvas.context.fillStyle = "#fff";
      canvas.context.fillRect(0, 0, width, height);
      return canvas;
    },
    pageLabelText: () => "1 / 1",
  };
}

test("returns equal frames and draws the same manual boxes on both sides", async () => {
  const snapshot = splitSnapshot({
    manualBoxes: [{ x: 1, y: 0, w: 2, h: 1 }],
    showBoxes: false,
  });
  const rendered = await renderSplitPage(snapshot, dependencies());

  expect([rendered.sideCanvases.old.width, rendered.sideCanvases.old.height])
    .toEqual([rendered.sideCanvases.new.width, rendered.sideCanvases.new.height]);
  expect(rendered.boxes).toEqual([{ x: 1, y: 0, w: 2, h: 1 }]);
  expect(rendered.autoBoxes).toBeUndefined();
  expect(rendered.sideCanvases.old.context.calls).toContainEqual(
    ["strokeRect", "#ff9500", expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number)],
  );
  expect(rendered.sideCanvases.new.context.calls).toContainEqual(
    ["strokeRect", "#ff9500", expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number)],
  );
});

test("computes automatic boxes once and marks a missing side", async () => {
  const deps = dependencies({ oldCanvas: null });
  const rendered = await renderSplitPage(splitSnapshot(), deps);

  expect(deps.computeDiff).toHaveBeenCalledOnce();
  expect(rendered.sideCanvases.old.context.calls)
    .toContainEqual(expect.arrayContaining(["fillText", "この版にこのページはありません"]));
  expect(rendered.autoBoxes).toEqual(rendered.boxes);
});

test("uses existing automatic boxes before computing new ones", async () => {
  const autoBoxes = [{ x: 0, y: 0, w: 2, h: 1 }];
  const deps = dependencies();
  const rendered = await renderSplitPage(splitSnapshot({ autoBoxes }), deps);

  expect(deps.computeDiff).not.toHaveBeenCalled();
  expect(rendered.boxes).toEqual(autoBoxes);
  expect(rendered.autoBoxes).toBeUndefined();
});

test("prefers manual boxes over existing automatic boxes", async () => {
  const deps = dependencies();
  const rendered = await renderSplitPage(splitSnapshot({
    manualBoxes: [{ x: 1, y: 0, w: 1, h: 1 }],
    autoBoxes: [{ x: 0, y: 0, w: 3, h: 1 }],
  }), deps);

  expect(deps.computeDiff).not.toHaveBeenCalled();
  expect(rendered.boxes).toEqual([{ x: 1, y: 0, w: 1, h: 1 }]);
  expect(rendered.autoBoxes).toBeUndefined();
});

test("reuses raw page canvases after threshold and offset changes but rebuilds aligned NEW", async () => {
  const deps = dependencies();
  const firstSnapshot = splitSnapshot();
  const first = await renderSplitPage(firstSnapshot, deps);
  const changed = Object.freeze({
    ...firstSnapshot,
    comparison: Object.freeze({
      ...firstSnapshot.comparison,
      threshold: 200,
      dx: 2,
      dy: 1,
      tolerancePx: 3,
    }),
    visual: Object.freeze({
      ...firstSnapshot.visual,
      splitCache: first.splitCache,
    }),
  });

  const second = await renderSplitPage(changed, deps);

  expect(deps.renderPageCanvas).toHaveBeenCalledTimes(2);
  expect(second.splitCache.oldCanvas).toBe(first.splitCache.oldCanvas);
  expect(second.splitCache.newCanvas).toBe(first.splitCache.newCanvas);
  expect(second.splitCache.alignedNewCanvas).not.toBe(first.splitCache.alignedNewCanvas);
  expect(deps.computeDiff).toHaveBeenCalledTimes(2);
});

test("does not paint change boxes onto raw page canvases or split cache", async () => {
  const oldCanvas = new RecordingCanvas(3, 1, rgba([0, 60, 120]));
  const newCanvas = new RecordingCanvas(3, 1, rgba([20, 80, 140]));
  const oldPixels = [...oldCanvas.data];
  const newPixels = [...newCanvas.data];
  const deps = dependencies({ oldCanvas, newCanvas });

  const rendered = await renderSplitPage(splitSnapshot({
    manualBoxes: [{ x: 1, y: 0, w: 2, h: 1 }],
  }), deps);

  expect([...oldCanvas.data]).toEqual(oldPixels);
  expect([...newCanvas.data]).toEqual(newPixels);
  expect([...rendered.splitCache.oldCanvas.data]).toEqual(oldPixels);
  expect([...rendered.splitCache.newCanvas.data]).toEqual(newPixels);
  expect(rendered.splitCache.oldCanvas).toBe(oldCanvas);
  expect(rendered.splitCache.newCanvas).toBe(newCanvas);
  expect(rendered.splitCache.alignedNewCanvas.context.calls.some(call => call[0] === "strokeRect"))
    .toBe(false);
  expect(rendered.sideCanvases.old).not.toBe(rendered.splitCache.oldCanvas);
  expect(rendered.sideCanvases.new).not.toBe(rendered.splitCache.alignedNewCanvas);
});

test("reports split stats and stores an unadorned raw identity", async () => {
  const snapshot = splitSnapshot({
    manualBoxes: [{ x: 1, y: 0, w: 2, h: 1 }],
  });
  const rendered = await renderSplitPage(snapshot, dependencies());
  const identity = createVisualRawCacheIdentity(
    snapshot,
    0,
    rendered.currentPlan,
  );

  expect(rendered.stats).toEqual({
    removed: "削除 —",
    added: "追加 —",
    boxes: "変更箇所 1（手編集）",
  });
  expect(rendered.status).toBe("左右表示中");
  expect(rendered.pageLabel).toBe("1 / 1");
  expect(rendered.splitCache.rawIdentity).toEqual(identity);
  expect(visualRawCacheMatchesSnapshot(snapshot, rendered.splitCache, {
    quadrant: 0,
    framePlan: rendered.currentPlan,
  })).toBe(true);
});

test("propagates existing render align and diff stages", async () => {
  const deps = dependencies();
  const base = splitSnapshot();
  const snapshot = Object.freeze({
    ...base,
    comparison: Object.freeze({ ...base.comparison, autoAlign: true }),
  });
  const reports = [];

  await renderSplitPage(snapshot, deps, {
    onProgress: value => reports.push(value),
  });

  expect(reports.some(value => value.phase === "render")).toBe(true);
  expect(reports.some(value => value.phase === "align")).toBe(true);
  expect(reports.some(value => value.phase === "diff")).toBe(true);
});
