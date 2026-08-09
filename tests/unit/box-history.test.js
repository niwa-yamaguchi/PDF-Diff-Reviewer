import { expect, test } from "vitest";
import { createBoxHistory } from "../../src/features/box-editor/box-history.js";

test("stores snapshots as clones and returns an independent clone on undo", () => {
  const history = createBoxHistory(50);
  const boxes = [{ x: 0, y: 0, w: 10, h: 10 }];
  history.push(boxes);
  boxes[0].x = 99;

  const restored = history.undo();
  expect(restored).toEqual([{ x: 0, y: 0, w: 10, h: 10 }]);
  restored[0].x = 77;
  expect(history.undo()).toBeNull();
});

test("keeps only the newest fifty snapshots and handles empty undo", () => {
  const history = createBoxHistory(50);
  for (let x = 0; x < 52; x += 1) {
    history.push([{ x, y: 0, w: 1, h: 1 }]);
  }

  expect(history.size).toBe(50);
  expect(history.undo()).toEqual([{ x: 51, y: 0, w: 1, h: 1 }]);
  for (let x = 50; x >= 3; x -= 1) history.undo();
  expect(history.undo()).toEqual([{ x: 2, y: 0, w: 1, h: 1 }]);
  expect(history.undo()).toBeNull();
});
