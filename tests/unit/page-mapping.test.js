import { expect, test } from "vitest";
import {
  LOW_SIMILARITY, MATCH_MIN, SIGNATURE_GRID,
  describeMapping, mapPages, pageSignature, pageSimilarity,
} from "../../src/core/page-mapping/page-mapping.js";

const N = SIGNATURE_GRID;

function randomMask(seed, density = 0.25) {
  let s = seed >>> 0;
  const mask = new Uint8Array(N * N);
  for (let i = 0; i < mask.length; i += 1) {
    s = (s * 1664525 + 1013904223) >>> 0;
    mask[i] = s / 2 ** 32 < density ? 1 : 0;
  }
  return mask;
}

// 部分改訂: 約2%のセルを反転する
function revise(mask) {
  const out = Uint8Array.from(mask);
  for (let i = 0; i < out.length; i += 50) out[i] ^= 1;
  return out;
}

function rotate90(mask) {
  const out = new Uint8Array(N * N);
  for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) out[x * N + (N - 1 - y)] = mask[y * N + x];
  return out;
}

const [A, B, C, D, X, Y] = [1, 2, 3, 4, 99, 98].map(seed => randomMask(seed));
const map = (oldMasks, newMasks) => {
  const { oldSequence, newSequence } = mapPages(oldMasks, newMasks);
  return { oldSequence, newSequence };
};

test("pageSignature max-pools ink pixels into a 64x64 grid", () => {
  const width = 128;
  const height = 64;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const [x, y] of [[0, 0], [127, 63]]) data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
  const mask = pageSignature({ data, width, height, threshold: 128 });
  expect(mask).toHaveLength(N * N);
  expect(mask[0]).toBe(1);
  expect(mask[N * N - 1]).toBe(1);
  expect(mask.reduce((sum, value) => sum + value, 0)).toBe(2);
});

test("similarity separates revised copies, rotations and unrelated pages", () => {
  expect(pageSimilarity(A, A)).toBe(1);
  expect(pageSimilarity(A, rotate90(A))).toBe(1);
  expect(pageSimilarity(A, revise(A))).toBeGreaterThanOrEqual(LOW_SIMILARITY);
  expect(pageSimilarity(A, B)).toBeLessThan(MATCH_MIN);
  expect(pageSimilarity(new Uint8Array(N * N), new Uint8Array(N * N))).toBe(1);
  expect(pageSimilarity(A, new Uint8Array(N * N))).toBe(0);
});

test("equal page counts keep the identity order", () => {
  const result = mapPages([A, B, C], [revise(A), revise(B), revise(C)]);
  expect(result.oldSequence).toEqual([0, 1, 2]);
  expect(result.newSequence).toEqual([0, 1, 2]);
  expect(result.similarity.every(value => value >= LOW_SIMILARITY)).toBe(true);
});

test("a page inserted in the middle leaves an old blank slot", () => {
  expect(map([A, B, C], [A, B, X, C])).toEqual({
    oldSequence: [0, 1, null, 2], newSequence: [0, 1, 2, 3],
  });
});

test("a page deleted in the middle leaves a new blank slot", () => {
  expect(map([A, B, C, D], [A, C, D])).toEqual({
    oldSequence: [0, 1, 2, 3], newSequence: [0, null, 1, 2],
  });
});

test("head insertion and tail deletion are both detected", () => {
  expect(map([A, B, C, D], [X, A, B, C])).toEqual({
    oldSequence: [null, 0, 1, 2, 3], newSequence: [0, 1, 2, 3, null],
  });
});

test("a replaced page becomes delete then add", () => {
  expect(map([A, B, C], [A, X, C])).toEqual({
    oldSequence: [0, 1, null, 2], newSequence: [0, null, 1, 2],
  });
});

test("all-dissimilar pages become delete-all then add-all", () => {
  expect(map([A, B], [X, Y])).toEqual({
    oldSequence: [0, 1, null, null], newSequence: [null, null, 0, 1],
  });
});

test("a page rotated by 90 degrees still matches", () => {
  expect(map([A, B], [A, rotate90(B)])).toEqual({ oldSequence: [0, 1], newSequence: [0, 1] });
});

test("an empty side maps every page as added", () => {
  expect(map([], [A])).toEqual({ oldSequence: [null], newSequence: [0] });
});

test("describeMapping names deletions, additions and low-similarity slots", () => {
  expect(describeMapping({
    oldSequence: [0, 1, null, 2], newSequence: [0, null, 1, 2], similarity: [1, null, null, 0.62],
  })).toBe("旧 P2 を削除、新 P2 を追加と判定。類似度が低い対応：スロット 4（62%）");
  expect(describeMapping({
    oldSequence: [0, 1], newSequence: [0, 1], similarity: [0.95, 0.9],
  })).toBe("ページの追加・削除はありません");
});
