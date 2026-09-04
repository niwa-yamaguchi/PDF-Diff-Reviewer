import { describe, expect, test, vi } from "vitest";
import { CHANGE_BOX_STYLE } from "../../src/core/change-boxes/draw.js";
import {
  composeTextExport,
  composeVisualExport,
  VISUAL_BOX_STYLE,
} from "../../src/features/export/image-composer.js";

class RecordingContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.calls = [];
    this.fillStyle = "#000";
    this.strokeStyle = "#000";
    this.lineWidth = 1;
    this.font = "";
    this.textAlign = "left";
    this.textBaseline = "alphabetic";
  }

  save() { this.calls.push(["save"]); }
  restore() { this.calls.push(["restore"]); }
  clearRect(...args) { this.calls.push(["clearRect", ...args]); }
  fillRect(...args) { this.calls.push(["fillRect", this.fillStyle, ...args]); }
  strokeRect(...args) {
    this.calls.push(["strokeRect", this.strokeStyle, this.lineWidth, ...args]);
  }
  fillText(...args) { this.calls.push(["fillText", this.fillStyle, ...args]); }
  measureText(text) { return { width: text.length * 8 }; }
  drawImage(source, x, y) {
    this.calls.push(["drawImage", source, x, y]);
    if (x === 0 && y === 0 && source.width === this.canvas.width && source.height === this.canvas.height) {
      this.canvas.pixels = [...source.pixels];
    }
  }
}

class RecordingCanvas {
  constructor(width, height, pixels = []) {
    this._width = width;
    this._height = height;
    this.pixels = pixels.length ? [...pixels] : new Array(width * height * 4).fill(255);
    this.context = new RecordingContext(this);
  }

  get width() { return this._width; }
  set width(value) {
    this._width = value;
    this.pixels = new Array(this._width * this._height * 4).fill(255);
    this.context = new RecordingContext(this);
  }
  get height() { return this._height; }
  set height(value) {
    this._height = value;
    this.pixels = new Array(this._width * this._height * 4).fill(255);
    this.context = new RecordingContext(this);
  }
  getContext() { return this.context; }
  cloneNode() { return new RecordingCanvas(0, 0); }
}

const visualLegend = [
  { color: "rgb(60,60,60)", label: "共通" },
  { stroke: "#ff9500", fill: "rgba(255,149,0,0.18)", label: "変更枠" },
];

describe("visual export composition", () => {
  test("re-exports shared change box style", () => {
    expect(VISUAL_BOX_STYLE).toBe(CHANGE_BOX_STYLE);
  });

  test("clones full-resolution source pixels and draws boxes without changing source", () => {
    const pixels = [1, 2, 3, 255, 4, 5, 6, 255];
    const source = new RecordingCanvas(2, 1, pixels);

    const result = composeVisualExport({
      source,
      boxes: [{ x: 0, y: 0, w: 2, h: 1 }],
      legend: visualLegend,
      dpi: 150,
    });

    expect(result).not.toBe(source);
    expect([result.width, result.height]).toEqual([2, 1]);
    expect(source.pixels).toEqual(pixels);
    expect(source.context.calls).toEqual([]);
    expect(result.context.calls).toContainEqual([
      "strokeRect", "#ff9500", 3, 1.5, 1.5, 0, 0,
    ]);
    expect(result.context.calls.some(call => call[0] === "fillText" && call[2] === "共通")).toBe(true);
  });

  test("reuses only the destination backing store and resets it to source dimensions", () => {
    const source = new RecordingCanvas(3, 2, new Array(24).fill(7));
    const destination = new RecordingCanvas(30, 20);

    const result = composeVisualExport({
      source,
      boxes: [],
      legend: [],
      dpi: 72,
      destination,
    });

    expect(result).toBe(destination);
    expect([destination.width, destination.height]).toEqual([3, 2]);
    expect(destination.pixels).toEqual(source.pixels);
  });
});

describe("text export composition", () => {
  const colors = { removed: "#ff5b57", added: "#2e9b55", changed: "#ffd43b" };

  test("uses a white fallback, centers both sides, and preserves OLD NEW and page labels", () => {
    const newCanvas = new RecordingCanvas(40, 12);
    const result = composeTextExport({
      oldCanvas: null,
      newCanvas,
      pageIndex: 1,
      total: 3,
      colors,
    });

    expect([result.width, result.height]).toEqual([40, 104]);
    const labels = result.context.calls.filter(call => call[0] === "fillText");
    expect(labels).toContainEqual(["fillText", colors.removed, "OLD", 4, 14]);
    expect(labels).toContainEqual(["fillText", "#333", "p 2 / 3", 36, 14]);
    expect(labels).toContainEqual(["fillText", colors.added, "NEW", 4, 78]);
    const images = result.context.calls.filter(call => call[0] === "drawImage");
    expect(images).toHaveLength(2);
    expect(images[0][1].pixels.every(value => value === 255)).toBe(true);
  });

  test("draws the text legend only when it fits between OLD and the page label", () => {
    const wide = composeTextExport({
      oldCanvas: new RecordingCanvas(500, 10),
      newCanvas: new RecordingCanvas(500, 10),
      pageIndex: 0,
      total: 2,
      colors,
    });
    const narrow = composeTextExport({
      oldCanvas: new RecordingCanvas(80, 10),
      newCanvas: new RecordingCanvas(80, 10),
      pageIndex: 0,
      total: 2,
      colors,
    });

    expect(wide.context.calls.some(call => call[0] === "fillText" && call[2] === "削除")).toBe(true);
    expect(narrow.context.calls.some(call => call[0] === "fillText" && call[2] === "削除")).toBe(false);
  });
});
