import { describe, expect, test } from "vitest";
import {
  CHANGE_BOX_STYLE,
  drawChangeBoxes,
} from "../../src/core/change-boxes/draw.js";

class RecordingContext {
  constructor() {
    this.calls = [];
    this.fillStyle = "#000";
    this.strokeStyle = "#000";
    this.lineWidth = 1;
  }

  save() { this.calls.push(["save"]); }
  restore() { this.calls.push(["restore"]); }
  fillRect(...args) { this.calls.push(["fillRect", this.fillStyle, ...args]); }
  strokeRect(...args) {
    this.calls.push(["strokeRect", this.strokeStyle, this.lineWidth, ...args]);
  }
}

describe("CHANGE_BOX_STYLE", () => {
  test("exposes frozen orange stroke and fill colors", () => {
    expect(CHANGE_BOX_STYLE).toEqual({
      color: "#ff9500",
      fill: "rgba(255,149,0,0.18)",
    });
    expect(Object.isFrozen(CHANGE_BOX_STYLE)).toBe(true);
  });
});

describe("drawChangeBoxes", () => {
  test("draws nothing when boxes is empty", () => {
    const context = new RecordingContext();
    drawChangeBoxes(context, [], 150);
    expect(context.calls).toEqual([]);
  });

  test("draws fill and inset stroke at 150 dpi with save/restore isolation", () => {
    const context = new RecordingContext();
    const boxes = [{ x: 10, y: 20, w: 100, h: 50 }];
    drawChangeBoxes(context, boxes, 150);

    expect(context.calls).toEqual([
      ["save"],
      ["fillRect", "rgba(255,149,0,0.18)", 10, 20, 100, 50],
      ["strokeRect", "#ff9500", 3, 11.5, 21.5, 97, 47],
      ["restore"],
    ]);
  });

  test("scales line width with dpi", () => {
    const context = new RecordingContext();
    drawChangeBoxes(context, [{ x: 0, y: 0, w: 20, h: 20 }], 300);

    expect(context.calls).toContainEqual([
      "strokeRect", "#ff9500", 6, 3, 3, 14, 14,
    ]);
  });

  test("uses minimum line width of 2 at low dpi", () => {
    const context = new RecordingContext();
    drawChangeBoxes(context, [{ x: 0, y: 0, w: 10, h: 10 }], 72);

    expect(context.calls).toContainEqual([
      "strokeRect", "#ff9500", 2, 1, 1, 8, 8,
    ]);
  });

  test("draws every box with the same fill and inset stroke", () => {
    const context = new RecordingContext();
    drawChangeBoxes(context, [
      { x: 10, y: 20, w: 100, h: 50 },
      { x: 0, y: 0, w: 8, h: 8 },
    ], 150);

    expect(context.calls.filter(call => call[0] === "fillRect")).toEqual([
      ["fillRect", "rgba(255,149,0,0.18)", 10, 20, 100, 50],
      ["fillRect", "rgba(255,149,0,0.18)", 0, 0, 8, 8],
    ]);
    expect(context.calls.filter(call => call[0] === "strokeRect")).toEqual([
      ["strokeRect", "#ff9500", 3, 11.5, 21.5, 97, 47],
      ["strokeRect", "#ff9500", 3, 1.5, 1.5, 5, 5],
    ]);
  });

  test("does not mutate boxes", () => {
    const context = new RecordingContext();
    const boxes = [{ x: 1, y: 2, w: 3, h: 4 }];
    const snapshot = JSON.stringify(boxes);
    drawChangeBoxes(context, boxes, 150);
    expect(JSON.stringify(boxes)).toBe(snapshot);
  });

  test("defaults boxes to empty and dpi to 150", () => {
    const context = new RecordingContext();
    drawChangeBoxes(context);
    expect(context.calls).toEqual([]);
  });
});
