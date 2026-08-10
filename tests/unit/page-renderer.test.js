import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  ALIGN_PROBE_LONG,
  alignProbeScale,
  downscaleCanvas,
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
