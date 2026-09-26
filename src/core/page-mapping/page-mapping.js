import { grayFromRgba } from "../alignment/align-compute.js";
import { downsampleMaskMax, inkIoU, inkMaskFromGray } from "../alignment/similarity.js";

export const SIGNATURE_LONG_EDGE = 1024;
export const SIGNATURE_GRID = 64;
// ponytail: 合成データ（共通図枠のA3シート群）で決めた値。実図面で誤判定が出たらここを調整する。
export const MATCH_MIN = 0.6;
export const LOW_SIMILARITY = 0.8;

export function pageSignature({ data, width, height, threshold }) {
  const { g } = grayFromRgba(data, width, height);
  const mask = inkMaskFromGray(g, width * height, threshold);
  return downsampleMaskMax(mask, width, height, width, height, SIGNATURE_GRID, SIGNATURE_GRID);
}

function rotateMask(mask, n) {
  const out = new Uint8Array(n * n);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) out[x * n + (n - 1 - y)] = mask[y * n + x];
  }
  return out;
}

// 90°刻みの4回転を1回だけ作る。mapPages は同じ新マスクを旧マスク全件と
// 比較するので、ここを呼ぶ側でマスクごとに使い回す。
function maskRotations(mask, n) {
  const rotations = [mask];
  for (let k = 1; k < 4; k += 1) rotations.push(rotateMask(rotations[k - 1], n));
  return rotations;
}

function bestRotatedSimilarity(oldMask, rotations, n) {
  let best = 0;
  for (const rotated of rotations) best = Math.max(best, inkIoU(oldMask, rotated, n * n));
  return best;
}

export function pageSimilarity(oldMask, newMask) {
  const n = SIGNATURE_GRID;
  return bestRotatedSimilarity(oldMask, maskRotations(newMask, n), n);
}

// 順序を保つ系列アラインメント。空白の挿入は0点、対応は (類似度 − τ) 点。
export function mapPages(oldMasks, newMasks, { matchMin = MATCH_MIN } = {}) {
  const m = oldMasks.length;
  const n = newMasks.length;
  const grid = SIGNATURE_GRID;
  const newRotations = newMasks.map(mask => maskRotations(mask, grid));
  const sim = oldMasks.map(oldMask => newRotations.map(
    rotations => bestRotatedSimilarity(oldMask, rotations, grid),
  ));
  const score = Array.from({ length: m + 1 }, () => new Float64Array(n + 1));
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      score[i][j] = Math.max(
        score[i - 1][j - 1] + sim[i - 1][j - 1] - matchMin,
        score[i - 1][j],
        score[i][j - 1],
      );
    }
  }
  const oldSequence = [];
  const newSequence = [];
  const similarity = [];
  let i = m;
  let j = n;
  // 逆向きにたどる。同点は対応を優先し、隣接する削除と追加は順方向で削除が先になるよう追加から拾う。
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && score[i][j] === score[i - 1][j - 1] + sim[i - 1][j - 1] - matchMin) {
      oldSequence.push(i - 1);
      newSequence.push(j - 1);
      similarity.push(sim[i - 1][j - 1]);
      i -= 1;
      j -= 1;
    } else if (j > 0 && score[i][j] === score[i][j - 1]) {
      oldSequence.push(null);
      newSequence.push(j - 1);
      similarity.push(null);
      j -= 1;
    } else {
      oldSequence.push(i - 1);
      newSequence.push(null);
      similarity.push(null);
      i -= 1;
    }
  }
  return {
    oldSequence: oldSequence.reverse(),
    newSequence: newSequence.reverse(),
    similarity: similarity.reverse(),
  };
}

export function describeMapping({ oldSequence, newSequence, similarity }) {
  const removed = [];
  const added = [];
  const low = [];
  oldSequence.forEach((oldIndex, slot) => {
    const newIndex = newSequence[slot];
    if (newIndex == null) removed.push(`旧 P${oldIndex + 1}`);
    else if (oldIndex == null) added.push(`新 P${newIndex + 1}`);
    else if (similarity[slot] < LOW_SIMILARITY) {
      low.push(`スロット ${slot + 1}（${Math.round(similarity[slot] * 100)}%）`);
    }
  });
  const parts = [];
  if (removed.length) parts.push(`${removed.join("・")} を削除`);
  if (added.length) parts.push(`${added.join("・")} を追加`);
  let text = parts.length ? `${parts.join("、")}と判定` : "ページの追加・削除はありません";
  if (low.length) text += `。類似度が低い対応：${low.join("、")}`;
  return text;
}
