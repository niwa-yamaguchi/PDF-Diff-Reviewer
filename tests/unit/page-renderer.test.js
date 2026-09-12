import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  ALIGN_PROBE_LONG,
  alignProbeScale,
  downscaleCanvas,
  renderPageCanvas,
} from "../../src/features/documents/page-renderer.js";

function fakeCanvas(width, height) {
  const context = {
    fillStyle: "#fff",
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  };
  return { width, height, getContext: () => context, context };
}

describe("alignProbeScale", () => {
  test("derives one shared scale from the largest edge across every canvas", () => {
    const oldCanvas = fakeCanvas(2000, 1000);
    const newCanvas = fakeCanvas(800, 3000);

    const scale = alignProbeScale([oldCanvas, newCanvas]);

    expect(scale).toBeCloseTo(ALIGN_PROBE_LONG / 3000, 10);
  });

  test("returns 1 when every canvas already fits within the probe size", () => {
    const oldCanvas = fakeCanvas(400, 300);
    const newCanvas = fakeCanvas(500, 200);

    expect(alignProbeScale([oldCanvas, newCanvas])).toBe(1);
  });

  test("returns 1 exactly at the probe boundary", () => {
    const canvas = fakeCanvas(ALIGN_PROBE_LONG, ALIGN_PROBE_LONG);

    expect(alignProbeScale([canvas])).toBe(1);
  });

  test("skips null entries without throwing", () => {
    const newCanvas = fakeCanvas(600, 200);

    expect(() => alignProbeScale([null, newCanvas])).not.toThrow();
    expect(alignProbeScale([null, newCanvas])).toBeCloseTo(ALIGN_PROBE_LONG / 600, 10);
  });

  test("returns 1 when every entry is null", () => {
    expect(alignProbeScale([null, null])).toBe(1);
  });
});

describe("downscaleCanvas", () => {
  let created;

  beforeEach(() => {
    created = [];
    vi.stubGlobal("document", {
      createElement: () => {
        const canvas = fakeCanvas(0, 0);
        created.push(canvas);
        return canvas;
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("passes the original canvas through unchanged when scale is 1", () => {
    const canvas = fakeCanvas(800, 600);

    const result = downscaleCanvas(canvas, 1);

    expect(result).toBe(canvas);
    expect(created).toHaveLength(0);
  });

  test("passes the original canvas through unchanged when scale is greater than 1", () => {
    const canvas = fakeCanvas(800, 600);

    const result = downscaleCanvas(canvas, 1.5);

    expect(result).toBe(canvas);
    expect(created).toHaveLength(0);
  });

  test("creates a new canvas sized by round(width*scale) / round(height*scale)", () => {
    const canvas = fakeCanvas(801, 599);

    const result = downscaleCanvas(canvas, 0.5);

    expect(result).not.toBe(canvas);
    expect(result.width).toBe(Math.round(801 * 0.5));
    expect(result.height).toBe(Math.round(599 * 0.5));
    expect(created).toHaveLength(1);
  });

  test("clamps the downscaled size to a minimum of 1x1", () => {
    const canvas = fakeCanvas(1, 1);

    const result = downscaleCanvas(canvas, 0.001);

    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
  });
});

describe("renderPageCanvas cancellation", () => {
  beforeEach(() => {
    vi.stubGlobal("document", { createElement: () => fakeCanvas(0, 0) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("registers the PDF.js RenderTask so stale rasterization can be cancelled", async () => {
    let cancelRegistered;
    const cancellation = {
      cancelled: false,
      onCancel: vi.fn(callback => {
        cancelRegistered = callback;
        return () => {};
      }),
    };
    const renderTask = { promise: new Promise(() => {}), cancel: vi.fn() };
    const page = {
      getViewport: vi.fn(() => ({ width: 20, height: 10 })),
      render: vi.fn(() => renderTask),
    };
    const doc = { numPages: 1, getPage: vi.fn(async () => page) };

    void renderPageCanvas(doc, 0, 2, { cancellation });
    await vi.waitFor(() => expect(page.render).toHaveBeenCalledTimes(1));

    expect(cancellation.onCancel).toHaveBeenCalledTimes(1);
    cancelRegistered();
    expect(renderTask.cancel).toHaveBeenCalledTimes(1);
  });

  test("normalizes PDF.js cancellation so the visual controller treats it as intentional", async () => {
    let cancelRegistered;
    let rejectRender;
    const renderTask = {
      promise: new Promise((_, reject) => { rejectRender = reject; }),
      cancel: vi.fn(() => rejectRender(Object.assign(new Error("cancelled"), {
        name: "RenderingCancelledException",
      }))),
    };
    const cancellation = {
      cancelled: false,
      onCancel(callback) {
        cancelRegistered = callback;
        return () => {};
      },
    };
    const page = {
      getViewport: () => ({ width: 20, height: 10 }),
      render: () => renderTask,
    };
    const doc = { numPages: 1, getPage: async () => page };

    const rendering = renderPageCanvas(doc, 0, 2, { cancellation });
    await vi.waitFor(() => expect(cancelRegistered).toBeTypeOf("function"));
    cancellation.cancelled = true;
    cancelRegistered();

    await expect(rendering).rejects.toMatchObject({ name: "RenderCancelled" });
  });

  test("does not allocate a canvas for work cancelled before PDF page lookup", async () => {
    const doc = { numPages: 1, getPage: vi.fn() };
    const cancellation = { cancelled: true, onCancel: vi.fn() };

    await expect(renderPageCanvas(doc, 0, 2, { cancellation }))
      .rejects.toMatchObject({ name: "RenderCancelled" });
    expect(doc.getPage).not.toHaveBeenCalled();
  });
});
