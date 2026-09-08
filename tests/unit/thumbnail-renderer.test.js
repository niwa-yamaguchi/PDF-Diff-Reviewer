import { expect, test, vi } from "vitest";
import { cropChangeThumbnail } from "../../src/features/change-review/thumbnail-renderer.js";

function recordingCanvas(width, height) {
  const context = { fillRect: vi.fn(), drawImage: vi.fn() };
  return { width, height, context, getContext: () => context };
}

// Break: incorrect crop margins or stretching loses surrounding drawing context.
test("crops with 15 percent margin and preserves aspect ratio in a white 120 by 80 canvas", () => {
  const source = recordingCanvas(1000, 500);
  const result = cropChangeThumbnail({ source,
    normalizedRect: { x: 0.4, y: 0.2, w: 0.2, h: 0.2 }, createCanvas: recordingCanvas });
  expect([result.width, result.height]).toEqual([120, 80]);
  expect(result.context.fillStyle).toBe("#fff");
  expect(result.context.fillRect).toHaveBeenCalledWith(0, 0, 120, 80);
  expect(result.context.drawImage).toHaveBeenCalledWith(source, 370, 85, 260, 130, 0, 10, 120, 60);
});

// Break: sampling beyond the source leaves inconsistent padding at page edges.
test("clamps all edges to the image bounds and centers a tall crop", () => {
  const source = recordingCanvas(100, 200);
  const result = cropChangeThumbnail({ source,
    normalizedRect: { x: 0, y: 0, w: 1, h: 1 }, createCanvas: recordingCanvas });
  expect(result.context.drawImage).toHaveBeenCalledWith(source, 0, 0, 100, 200, 40, 0, 40, 80);
});
