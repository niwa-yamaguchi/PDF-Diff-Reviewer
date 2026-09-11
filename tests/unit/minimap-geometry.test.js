import { expect, test } from "vitest";
import {
  containTransform,
  visibleContentRect,
  minimapPointToContent,
  centerViewOnPoint,
} from "../../src/features/viewer/minimap-geometry.js";

test("contains content inside the minimap bounds while preserving aspect ratio", () => {
  expect(containTransform(
    { width: 1000, height: 500 },
    { width: 180, height: 140 },
  )).toEqual({ scale: 0.18, x: 0, y: 25, width: 180, height: 90 });
});

test("maps the viewport back into content and clamps to the page", () => {
  expect(visibleContentRect(
    { scale: 2, tx: -400, ty: -100 },
    { width: 600, height: 400 },
    { width: 1000, height: 500 },
  )).toEqual({ x: 200, y: 50, w: 300, h: 200 });
});

test("converts a minimap point into content coordinates", () => {
  expect(minimapPointToContent(
    { x: 90, y: 70 },
    { scale: 0.18, x: 0, y: 25, width: 180, height: 90 },
    { width: 1000, height: 500 },
  )).toEqual({ x: 500, y: 250 });
});

test("centers on a point, clamps oversized axes, and centers undersized axes", () => {
  expect(centerViewOnPoint(
    { scale: 1, tx: 0, ty: 0 },
    { width: 600, height: 400 },
    { width: 200, height: 800 },
    { x: 0, y: 0 },
  )).toEqual({ scale: 1, tx: 200, ty: 0 });
  expect(centerViewOnPoint(
    { scale: 1, tx: 0, ty: 0 },
    { width: 600, height: 400 },
    { width: 200, height: 800 },
    { x: 100, y: 800 },
  )).toEqual({ scale: 1, tx: 200, ty: -400 });
});
