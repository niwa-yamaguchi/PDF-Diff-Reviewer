# 差分処理のWeb Worker化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 差分の画素処理と自動位置合わせをWeb Workerへ移し、300DPIの大判ページでもメインスレッドが固まらないようにする。

**Architecture:** 画素計算を `src/core/` の純関数へ切り出し、`src/workers/diff-worker.js` から呼ぶ。`visual-renderer.js` はWorkerを知らず、`dependencies` 経由の非同期関数（`computeDiff` / `computeAlignment` / `computeQuadrant`）を待つだけにする。Workerレーンを対話操作用とエクスポート用の2本に分け、対話操作側は `terminate()` で打ち切る。

**Tech Stack:** Vanilla JavaScript, ES Modules, Vite 8, Vitest 4, Playwright 1.62, モジュールWorker（`{ type: "module" }`）

## Global Constraints

- 成果物はブラウザ内で完結する。ファイルを外部送信する変更（アップロード、外部API、テレメトリ）は仕様違反。
- `src/core/**` は `app` / `features` / `platform` を import してはならず、`document` / `window` / `pdfjsLib` という語を含んではならない（`tests/unit/dependency-boundaries.test.js`）。
- `src/features/<name>/**` は `/app/` と他の feature ディレクトリを import してはならず、`console.log` / `warn` / `error` / `debug` を含んではならない（同上）。
- `addEventListener` は `src/app/bind-controls.js` 以外に書いてはならない（同上）。
- 差分の色は 共通 `[60, 60, 60]` / 削除 `[255, 91, 87]` / 追加 `[77, 141, 255]` から変えない。
- 変更枠の基準値は `BOX_BASE_DPI = 150`、`BOX_BASE = 16`、`BOX_MIN_BLOCKS = 2` から変えない。
- 同期処理へのフォールバックは実装しない。
- `index.html` を変更したら、ヘッダーの `UPDATED yyyy-mm-dd` を当日付けへ書き換える。`tests/unit/documentation.test.js` が同じ日付を検査しているので併せて更新する。
- テストの実行は `npm test`（Vitest）。E2Eは `npm run test:e2e`。ビルド確認は `npm run build`（postbuildで `tests/verify-dist.mjs` が走る）。

---

## File Structure

**新規**

| ファイル | 責務 |
|---|---|
| `src/core/image-diff/diff-compute.js` | 差分の画素計算（着色、膨張、変更枠検出）を行う純関数 |
| `src/core/alignment/align-compute.js` | RGBAバッファを入力とする位置合わせ計算 |
| `src/workers/diff-worker.js` | Workerのメッセージハンドラ。計算ロジックを持たない |
| `src/features/visual-diff/worker-lane.js` | Workerレーン。ジョブ管理、進捗中継、打ち切り |
| `src/platform/diff-worker.js` | モジュールWorkerの生成のみ |
| `tests/unit/diff-compute.test.js` | `diff-compute.js` の単体テスト |
| `tests/unit/align-compute.test.js` | `align-compute.js` の単体テスト |
| `tests/unit/worker-lane.test.js` | `worker-lane.js` の単体テスト（疑似Worker） |

**変更**

| ファイル | 変更内容 |
|---|---|
| `src/features/visual-diff/visual-renderer.js` | 画素ループを削除し、`dependencies` の非同期関数を待つ |
| `src/features/visual-diff/toggle-renderer.js` | `oldImage` の保持を削除し、変更枠計算を待つ |
| `src/features/visual-diff/visual-controller.js` | 描画開始時にレーンを打ち切り、進捗を表示する |
| `src/features/documents/page-renderer.js` | `canvasToGrayF` を廃止し `canvasToRgba` / `alignProbeScale` / `downscaleCanvas` を追加 |
| `src/app/create-app.js` | レーンを2本生成し、対話操作用とエクスポート用の描画依存を分けて注入する |
| `index.html` | `UPDATED` 日付 |
| `README.md` | 性能に関する記述 |

---

## Task 1: 差分の画素計算を純関数へ切り出す

`renderDiffPage` の二重ループと `computeChangeBoxesAligned` は同じ判定をしており、着色の有無だけが違う。1つの純関数へ統合する。この時点ではまだ同期呼び出しのままで、外から見た動作は変わらない。

**Files:**
- Create: `src/core/image-diff/diff-compute.js`
- Create: `tests/unit/diff-compute.test.js`
- Modify: `src/features/visual-diff/visual-renderer.js`

**Interfaces:**
- Consumes: `luminanceAt(data, offset)` from `src/core/image-diff/luminance.js`、`toleratedDiffMasks(oldMask, newMask, width, height, radius)` from `src/core/image-diff/masks.js`、`computeBoxes(flags, cols, rows, block, minBlocks)` from `src/core/change-boxes/detect.js`、`clampBoxes(boxes, width, height)` from `src/core/geometry/rectangles.js`
- Produces:
  - `DIFF_RGB` — `{ common: [60,60,60], removed: [255,91,87], added: [77,141,255] }`
  - `computeDiff(payload) → { image, removed, added, boxes }`
    - `payload`: `{ oldData, oldWidth, oldHeight, newData, width, height, threshold, radius, block, minBlocks, needsImage, needsBoxes, onProgress }`
    - `oldData` は `Uint8ClampedArray | null`（RGBA、`oldWidth × oldHeight`）
    - `newData` は `Uint8ClampedArray`（RGBA、`width × height`、位置合わせ適用済み）
    - `image` は `needsImage` が真のとき `Uint8ClampedArray`（RGBA、`width × height`）、偽のとき `null`
    - `removed` / `added` は画素数、`boxes` は `{ x, y, w, h }` の配列
    - `onProgress` は `(ratio) => void`。`ratio` は 0 以上 1 以下で単調増加

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/diff-compute.test.js`:

```js
import { expect, test } from "vitest";
import { DIFF_RGB, computeDiff } from "../../src/core/image-diff/diff-compute.js";

const rgba = values => new Uint8ClampedArray(values.flatMap(value => [value, value, value, 255]));

function base(overrides = {}) {
  return {
    oldData: rgba([0, 0, 255]),
    oldWidth: 3,
    oldHeight: 1,
    newData: rgba([0, 255, 0]),
    width: 3,
    height: 1,
    threshold: 128,
    radius: 0,
    block: 8,
    minBlocks: 2,
    needsImage: true,
    needsBoxes: true,
    ...overrides,
  };
}

test("colors common, removed and added pixels", () => {
  const result = computeDiff(base());

  expect([...result.image]).toEqual([
    60, 60, 60, 255,
    255, 91, 87, 255,
    77, 141, 255, 255,
  ]);
  expect(result.removed).toBe(1);
  expect(result.added).toBe(1);
});

test("leaves blank pixels white", () => {
  const result = computeDiff(base({
    oldData: rgba([255, 255, 255]),
    newData: rgba([255, 255, 255]),
  }));

  expect([...result.image]).toEqual([
    255, 255, 255, 255,
    255, 255, 255, 255,
    255, 255, 255, 255,
  ]);
  expect(result.removed).toBe(0);
  expect(result.added).toBe(0);
});

test("treats a missing old page as entirely added", () => {
  const result = computeDiff(base({ oldData: null, oldWidth: 0, oldHeight: 0 }));

  expect(result.removed).toBe(0);
  expect(result.added).toBe(2);
});

test("skips the image when needsImage is false", () => {
  const result = computeDiff(base({ needsImage: false }));

  expect(result.image).toBeNull();
  expect(result.removed).toBe(1);
  expect(result.added).toBe(1);
});

test("skips boxes when needsBoxes is false", () => {
  const result = computeDiff(base({
    width: 32,
    height: 32,
    oldWidth: 32,
    oldHeight: 32,
    oldData: new Uint8ClampedArray(32 * 32 * 4),
    newData: new Uint8ClampedArray(32 * 32 * 4).fill(255),
    needsBoxes: false,
  }));

  expect(result.boxes).toEqual([]);
});

test("finds a change box around a solid removed area", () => {
  const width = 32;
  const height = 32;
  const oldData = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < 20; y += 1) {
    for (let x = 0; x < 20; x += 1) {
      const pixel = (y * width + x) * 4;
      oldData[pixel] = 0;
      oldData[pixel + 1] = 0;
      oldData[pixel + 2] = 0;
    }
  }
  const newData = new Uint8ClampedArray(width * height * 4).fill(255);

  const result = computeDiff(base({
    oldData,
    oldWidth: width,
    oldHeight: height,
    newData,
    width,
    height,
  }));

  expect(result.boxes).toHaveLength(1);
  expect(result.boxes[0]).toMatchObject({ x: 0, y: 0 });
  expect(result.boxes[0].w).toBeGreaterThanOrEqual(20);
});

test("tolerates a shifted line when the radius covers the shift", () => {
  const width = 8;
  const height = 3;
  const oldData = new Uint8ClampedArray(width * height * 4).fill(255);
  const newData = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y += 1) {
    const oldPixel = (y * width + 2) * 4;
    oldData[oldPixel] = 0;
    oldData[oldPixel + 1] = 0;
    oldData[oldPixel + 2] = 0;
    const newPixel = (y * width + 3) * 4;
    newData[newPixel] = 0;
    newData[newPixel + 1] = 0;
    newData[newPixel + 2] = 0;
  }

  const strict = computeDiff(base({
    oldData, oldWidth: width, oldHeight: height, newData, width, height, radius: 0,
  }));
  const tolerant = computeDiff(base({
    oldData, oldWidth: width, oldHeight: height, newData, width, height, radius: 1,
  }));

  expect(strict.removed + strict.added).toBeGreaterThan(0);
  expect(tolerant.removed + tolerant.added).toBe(0);
});

test("reports monotonically increasing progress ending at one", () => {
  const ratios = [];
  computeDiff(base({
    width: 4,
    height: 64,
    oldWidth: 4,
    oldHeight: 64,
    oldData: new Uint8ClampedArray(4 * 64 * 4),
    newData: new Uint8ClampedArray(4 * 64 * 4).fill(255),
    onProgress: ratio => ratios.push(ratio),
  }));

  expect(ratios.length).toBeGreaterThan(0);
  expect(ratios.at(-1)).toBe(1);
  expect([...ratios].sort((a, b) => a - b)).toEqual(ratios);
});

test("exposes the diff palette", () => {
  expect(DIFF_RGB.common).toEqual([60, 60, 60]);
  expect(DIFF_RGB.removed).toEqual([255, 91, 87]);
  expect(DIFF_RGB.added).toEqual([77, 141, 255]);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run tests/unit/diff-compute.test.js`
Expected: FAIL（`Failed to resolve import "../../src/core/image-diff/diff-compute.js"`）

- [ ] **Step 3: `diff-compute.js` を実装する**

`src/core/image-diff/diff-compute.js`:

```js
import { computeBoxes } from "../change-boxes/detect.js";
import { clampBoxes } from "../geometry/rectangles.js";
import { luminanceAt } from "./luminance.js";
import { toleratedDiffMasks } from "./masks.js";

export const DIFF_RGB = Object.freeze({
  common: Object.freeze([60, 60, 60]),
  removed: Object.freeze([255, 91, 87]),
  added: Object.freeze([77, 141, 255]),
});

const PROGRESS_STEPS = 20;
const MASK_PHASE = 0.4;
const DILATE_PHASE = 0.6;

function progressReporter(onProgress) {
  if (!onProgress) return () => {};
  let reported = -1;
  return ratio => {
    const clamped = Math.min(1, Math.max(0, ratio));
    const step = Math.round(clamped * PROGRESS_STEPS);
    if (step <= reported) return;
    reported = step;
    onProgress(step / PROGRESS_STEPS);
  };
}

function paint(image, index, [red, green, blue]) {
  if (!image) return;
  const pixel = index * 4;
  image[pixel] = red;
  image[pixel + 1] = green;
  image[pixel + 2] = blue;
}

export function computeDiff({
  oldData = null,
  oldWidth = 0,
  oldHeight = 0,
  newData,
  width,
  height,
  threshold,
  radius = 0,
  block,
  minBlocks,
  needsImage = true,
  needsBoxes = true,
  onProgress = null,
}) {
  const report = progressReporter(onProgress);
  const columns = Math.ceil(width / block);
  const rows = Math.ceil(height / block);
  const flags = new Uint8Array(columns * rows);
  const image = needsImage ? new Uint8ClampedArray(width * height * 4) : null;
  if (image) image.fill(255);
  let removedCount = 0;
  let addedCount = 0;

  const flag = (x, y) => {
    flags[Math.floor(y / block) * columns + Math.floor(x / block)] = 1;
  };

  if (radius > 0) {
    const oldMask = new Uint8Array(width * height);
    const newMask = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (oldData && x < oldWidth && y < oldHeight) {
          oldMask[index] = luminanceAt(oldData, (y * oldWidth + x) * 4) < threshold ? 1 : 0;
        }
        newMask[index] = luminanceAt(newData, index * 4) < threshold ? 1 : 0;
      }
      report(((y + 1) / height) * MASK_PHASE);
    }
    const { removed, added } = toleratedDiffMasks(oldMask, newMask, width, height, radius);
    report(DILATE_PHASE);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (!(oldMask[index] || newMask[index])) continue;
        if (removed[index]) {
          paint(image, index, DIFF_RGB.removed);
          removedCount += 1;
          flag(x, y);
        } else if (added[index]) {
          paint(image, index, DIFF_RGB.added);
          addedCount += 1;
          flag(x, y);
        } else {
          paint(image, index, DIFF_RGB.common);
        }
      }
      report(DILATE_PHASE + ((y + 1) / height) * (1 - DILATE_PHASE));
    }
  } else {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const oldInk = !!oldData
          && x < oldWidth
          && y < oldHeight
          && luminanceAt(oldData, (y * oldWidth + x) * 4) < threshold;
        const newInk = luminanceAt(newData, (y * width + x) * 4) < threshold;
        if (!(oldInk || newInk)) continue;
        const index = y * width + x;
        if (oldInk && newInk) {
          paint(image, index, DIFF_RGB.common);
        } else if (oldInk) {
          paint(image, index, DIFF_RGB.removed);
          removedCount += 1;
          flag(x, y);
        } else {
          paint(image, index, DIFF_RGB.added);
          addedCount += 1;
          flag(x, y);
        }
      }
      report((y + 1) / height);
    }
  }

  report(1);
  return {
    image,
    removed: removedCount,
    added: addedCount,
    boxes: needsBoxes
      ? clampBoxes(computeBoxes(flags, columns, rows, block, minBlocks), width, height)
      : [],
  };
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run tests/unit/diff-compute.test.js`
Expected: PASS（9件）

- [ ] **Step 5: `visual-renderer.js` を `computeDiff` へ載せ替える**

`src/features/visual-diff/visual-renderer.js` の import を差し替える。

削除する import:

```js
import { luminanceAt } from "../../core/image-diff/luminance.js";
import { toleratedDiffMasks } from "../../core/image-diff/masks.js";
```

追加する import:

```js
import { DIFF_RGB, computeDiff } from "../../core/image-diff/diff-compute.js";
```

既存の `export const DIFF_RGB = Object.freeze({ ... });` の定義（13-17行目）を削除し、末尾の再エクスポートへまとめる。ファイル末尾の `export { boxStat };` を次へ置き換える。

```js
export { DIFF_RGB, boxStat };
```

`computeChangeBoxesAligned` の本体を次へ置き換える。

```js
export function computeChangeBoxesAligned(snapshot, prepared) {
  const { comparison } = snapshot;
  return computeDiff({
    oldData: prepared.oldImage?.data ?? null,
    oldWidth: prepared.oldWidth,
    oldHeight: prepared.oldHeight,
    newData: prepared.alignedNewImage.data,
    width: prepared.width,
    height: prepared.height,
    threshold: comparison.threshold,
    radius: toleranceRadiusPx(comparison),
    block: blockSize(comparison),
    minBlocks: BOX_MIN_BLOCKS,
    needsImage: false,
    needsBoxes: true,
  }).boxes;
}
```

`renderDiffPage` の `const canvas = ...` から `context.putImageData(image, 0, 0);` までを次へ置き換える。

```js
  const canvas = dependencies.createCanvas(prepared.width, prepared.height);
  const context = canvas.getContext("2d");
  const needsBoxes = snapshot.boxEditor.manualBoxes == null;
  const computed = computeDiff({
    oldData: prepared.oldImage?.data ?? null,
    oldWidth: prepared.oldWidth,
    oldHeight: prepared.oldHeight,
    newData: prepared.alignedNewImage.data,
    width: prepared.width,
    height: prepared.height,
    threshold: snapshot.comparison.threshold,
    radius: toleranceRadiusPx(snapshot.comparison),
    block: blockSize(snapshot.comparison),
    minBlocks: BOX_MIN_BLOCKS,
    needsImage: true,
    needsBoxes,
  });
  const image = context.createImageData(prepared.width, prepared.height);
  image.data.set(computed.image);
  context.putImageData(image, 0, 0);
  const removedCount = computed.removed;
  const addedCount = computed.added;
  const autoBoxes = needsBoxes ? computed.boxes : undefined;
```

続く `const boxes = ...` を次へ置き換える。

```js
  const boxes = needsBoxes
    ? autoBoxes
    : snapshot.boxEditor.manualBoxes.map(box => ({ ...box }));
```

不要になった `blockSize` / `columns` / `rows` / `flags` / `radius` / 色の分解代入・`removedCount` / `addedCount` の `let` 宣言を `renderDiffPage` から削除する。

- [ ] **Step 6: 全テストが通ることを確認する**

Run: `npm test`
Expected: PASS（既存185件 + 新規9件）。既存の期待値は一切変更しない。

- [ ] **Step 7: コミット**

```bash
git add src/core/image-diff/diff-compute.js tests/unit/diff-compute.test.js src/features/visual-diff/visual-renderer.js
git commit -m "refactor(diff): 差分の画素計算を純関数へ切り出す"
```

---

## Task 2: 位置合わせをRGBA入力へ変え、縮小をWorkerの手前で済ませる

`canvasToGrayF` はページ全体を `Float64Array` へ展開するが、`bestAlignment` は内部で必ず512程度へ縮小している。縮小をcanvasの描画で先に済ませ、小さなRGBAだけを扱う。

**重要:** 新旧のcanvasは**同じ倍率**で縮小しなければならない。`bestAlignment` は新旧の相対的な寸法差を手がかりにしており、別々の倍率で縮小すると幾何が壊れる。

**Files:**
- Create: `src/core/alignment/align-compute.js`
- Create: `tests/unit/align-compute.test.js`
- Modify: `src/features/documents/page-renderer.js`
- Modify: `src/features/visual-diff/visual-renderer.js`
- Modify: `src/app/create-app.js`
- Modify: `tests/integration/visual-controller.test.js`

**Interfaces:**
- Consumes: `bestAlignment(O, Nw, th)` from `src/core/alignment/similarity.js`、`bestQuadrant(O, Nw, th, opts)` from `src/core/alignment/quadrant.js`。どちらも `{ g: Float64Array, w, h }` 形式を取る。
- Produces:
  - `grayFromRgba(data, width, height) → { g, w, h }`
  - `computeAlignment({ oldData, oldWidth, oldHeight, newData, newWidth, newHeight, threshold }) → { angle, scale, txFrac, tyFrac, applied, method, scoreBase, scoreBest }`
  - `computeQuadrant({ oldData, oldWidth, oldHeight, newData, newWidth, newHeight, threshold }) → { k, scores, applied }`
  - `canvasToRgba(canvas) → { data, width, height } | null`
  - `alignProbeScale(canvases, longEdge) → number`（0より大きく1以下）
  - `downscaleCanvas(canvas, scale) → canvas`（`scale >= 1` のとき元のcanvasをそのまま返す）
  - `ALIGN_PROBE_LONG = 512`

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/align-compute.test.js`:

```js
import { expect, test } from "vitest";
import {
  computeAlignment,
  computeQuadrant,
  grayFromRgba,
} from "../../src/core/alignment/align-compute.js";

function inkCanvas(width, height, draw) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  draw((x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const pixel = (y * width + x) * 4;
    data[pixel] = 0;
    data[pixel + 1] = 0;
    data[pixel + 2] = 0;
  });
  return { data, width, height };
}

test("converts RGBA to a luminance grid", () => {
  const data = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);

  const gray = grayFromRgba(data, 2, 1);

  expect(gray.w).toBe(2);
  expect(gray.h).toBe(1);
  expect(gray.g[0]).toBeCloseTo(0, 6);
  expect(gray.g[1]).toBeCloseTo(255, 6);
});

test("reports no alignment for identical pages", () => {
  const page = inkCanvas(64, 64, set => {
    for (let y = 10; y < 50; y += 1) set(20, y);
    for (let x = 20; x < 44; x += 1) set(x, 10);
  });

  const result = computeAlignment({
    oldData: page.data,
    oldWidth: page.width,
    oldHeight: page.height,
    newData: page.data,
    newWidth: page.width,
    newHeight: page.height,
    threshold: 128,
  });

  expect(result.applied).toBe(false);
  expect(result.method).toBe("identity");
});

test("detects a horizontal shift between pages", () => {
  const original = inkCanvas(64, 64, set => {
    for (let y = 10; y < 50; y += 1) set(20, y);
    for (let x = 20; x < 44; x += 1) set(x, 10);
  });
  const shifted = inkCanvas(64, 64, set => {
    for (let y = 10; y < 50; y += 1) set(28, y);
    for (let x = 28; x < 52; x += 1) set(x, 10);
  });

  const result = computeAlignment({
    oldData: original.data,
    oldWidth: 64,
    oldHeight: 64,
    newData: shifted.data,
    newWidth: 64,
    newHeight: 64,
    threshold: 128,
  });

  expect(result.applied).toBe(true);
  expect(result.txFrac).toBeLessThan(0);
});

test("keeps the upright quadrant for identical pages", () => {
  const page = inkCanvas(64, 64, set => {
    for (let x = 8; x < 40; x += 1) set(x, 12);
  });

  const result = computeQuadrant({
    oldData: page.data,
    oldWidth: 64,
    oldHeight: 64,
    newData: page.data,
    newWidth: 64,
    newHeight: 64,
    threshold: 128,
  });

  expect(result.k).toBe(0);
  expect(result.applied).toBe(false);
  expect(result.scores).toHaveLength(4);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run tests/unit/align-compute.test.js`
Expected: FAIL（`Failed to resolve import "../../src/core/alignment/align-compute.js"`）

- [ ] **Step 3: `align-compute.js` を実装する**

`src/core/alignment/align-compute.js`:

```js
import { bestQuadrant } from "./quadrant.js";
import { bestAlignment } from "./similarity.js";

export function grayFromRgba(data, width, height) {
  const gray = new Float64Array(width * height);
  for (let index = 0, pixel = 0; index < gray.length; index += 1, pixel += 4) {
    gray[index] = 0.299 * data[pixel] + 0.587 * data[pixel + 1] + 0.114 * data[pixel + 2];
  }
  return { g: gray, w: width, h: height };
}

function pair({ oldData, oldWidth, oldHeight, newData, newWidth, newHeight }) {
  return [
    grayFromRgba(oldData, oldWidth, oldHeight),
    grayFromRgba(newData, newWidth, newHeight),
  ];
}

export function computeAlignment(payload) {
  const [oldGray, newGray] = pair(payload);
  return bestAlignment(oldGray, newGray, payload.threshold);
}

export function computeQuadrant(payload) {
  const [oldGray, newGray] = pair(payload);
  return bestQuadrant(oldGray, newGray, payload.threshold);
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run tests/unit/align-compute.test.js`
Expected: PASS（4件）

- [ ] **Step 5: `page-renderer.js` の canvas ヘルパを差し替える**

`src/features/documents/page-renderer.js` の `canvasToGrayF`（20-29行目）を削除し、次を追加する。

```js
export const ALIGN_PROBE_LONG = 512;

export function canvasToRgba(canvas) {
  if (!canvas) return null;
  const { width, height } = canvas;
  const { data } = canvas.getContext("2d").getImageData(0, 0, width, height);
  return { data, width, height };
}

export function alignProbeScale(canvases, longEdge = ALIGN_PROBE_LONG) {
  let long = 0;
  for (const canvas of canvases) {
    if (!canvas) continue;
    long = Math.max(long, canvas.width, canvas.height);
  }
  return long > longEdge ? longEdge / long : 1;
}

export function downscaleCanvas(canvas, scale) {
  if (!canvas || scale >= 1) return canvas;
  const target = createWhiteCanvas(
    Math.max(1, Math.round(canvas.width * scale)),
    Math.max(1, Math.round(canvas.height * scale)),
  );
  const context = target.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(canvas, 0, 0, target.width, target.height);
  return target;
}
```

- [ ] **Step 6: `visual-renderer.js` の位置合わせ呼び出しを差し替える**

`ensureQuadrant` の中で `dependencies.canvasToGrayF` を使っている箇所（39-45行目）を次へ置き換える。

```js
  const oldRgba = dependencies.canvasToRgba(oldCanvas);
  const newRgba = dependencies.canvasToRgba(newCanvas);
  if (!oldRgba || !newRgba) {
    cache.set(pageIndex, { k: 0, scores: [1, 0, 0, 0], applied: false, blank: true });
    return;
  }
  cache.set(pageIndex, dependencies.computeQuadrant({
    oldData: oldRgba.data,
    oldWidth: oldRgba.width,
    oldHeight: oldRgba.height,
    newData: newRgba.data,
    newWidth: newRgba.width,
    newHeight: newRgba.height,
    threshold: comparison.threshold,
  }));
```

`ensureAlignment`（107-129行目）を次へ置き換える。共通倍率で縮小してから渡す点が要点である。

```js
function ensureAlignment(snapshot, oldCanvas, newCanvas, cache, dependencies) {
  if (!snapshot.comparison.autoAlign || cache.has(snapshot.pageIndex)) return;
  const scale = dependencies.alignProbeScale([oldCanvas, newCanvas]);
  const oldRgba = dependencies.canvasToRgba(dependencies.downscaleCanvas(oldCanvas, scale));
  const newRgba = dependencies.canvasToRgba(dependencies.downscaleCanvas(newCanvas, scale));
  if (!oldRgba || !newRgba) {
    cache.set(snapshot.pageIndex, {
      angle: 0,
      scale: 1,
      txFrac: 0,
      tyFrac: 0,
      applied: false,
      method: "identity",
      scoreBase: 1,
      scoreBest: 1,
      blank: true,
    });
    return;
  }
  cache.set(snapshot.pageIndex, dependencies.computeAlignment({
    oldData: oldRgba.data,
    oldWidth: oldRgba.width,
    oldHeight: oldRgba.height,
    newData: newRgba.data,
    newWidth: newRgba.width,
    newHeight: newRgba.height,
    threshold: snapshot.comparison.threshold,
  }));
}
```

- [ ] **Step 7: `create-app.js` の依存を差し替える**

`src/app/create-app.js` の import（20-25行目）を次へ変える。

```js
import {
  alignProbeScale,
  canvasToRgba,
  downscaleCanvas,
  pageSizePt,
  renderPageCanvas,
  rotateCanvas90,
} from "../features/documents/page-renderer.js";
```

`computeAlignment` と `computeQuadrant` の import を追加する。

```js
import { computeAlignment, computeQuadrant } from "../core/alignment/align-compute.js";
```

`DEFAULT_DEPENDENCIES` の `canvasToGrayF,`（50行目）を次へ置き換える。

```js
  alignProbeScale,
  canvasToRgba,
  computeAlignment,
  computeQuadrant,
  downscaleCanvas,
```

`visualRenderDependencies`（242-252行目）の `canvasToGrayF: deps.canvasToGrayF,` を次へ置き換える。

```js
    alignProbeScale: deps.alignProbeScale,
    canvasToRgba: deps.canvasToRgba,
    computeAlignment: deps.computeAlignment,
    computeQuadrant: deps.computeQuadrant,
    downscaleCanvas: deps.downscaleCanvas,
```

- [ ] **Step 8: テスト用の疑似canvasを縮小描画に対応させる**

`tests/integration/visual-controller.test.js` の `MemoryContext.drawImage`（619-630行目）は3引数しか受け取らない。縮小描画（9引数のうち5引数形）に対応させる。既存の呼び出しを壊さないよう、幅と高さが省略された場合は元の寸法を使う。

```js
  drawImage(source, dx = 0, dy = 0, dw = source.width, dh = source.height) {
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
```

同ファイルの `rendererDependencies`（678-694行目）の `canvasToGrayF: vi.fn(),` を次へ置き換える。

```js
    canvasToRgba: canvas => (canvas
      ? { data: new Uint8ClampedArray(canvas.data), width: canvas.width, height: canvas.height }
      : null),
    alignProbeScale: () => 1,
    downscaleCanvas: canvas => canvas,
    computeAlignment: vi.fn(),
    computeQuadrant: vi.fn(),
```

- [ ] **Step 9: 全テストが通ることを確認する**

Run: `npm test`
Expected: PASS。`canvasToGrayF` を参照している箇所が残っていればここで落ちるので、`npx vitest run` の出力にある該当ファイルを同じ方針で直す。

- [ ] **Step 10: `canvasToGrayF` の残存を確認する**

Run: `git grep -n canvasToGrayF -- src tests`
Expected: 出力なし

- [ ] **Step 11: コミット**

```bash
git add src/core/alignment/align-compute.js tests/unit/align-compute.test.js src/features/documents/page-renderer.js src/features/visual-diff/visual-renderer.js src/app/create-app.js tests/integration/visual-controller.test.js
git commit -m "refactor(align): 位置合わせをRGBA入力へ変え縮小を前段で済ませる"
```

---

## Task 3: Workerレーンを実装する

Workerの生成、ジョブの対応付け、進捗の中継、`terminate()` による打ち切りを担う。Workerそのものには依存させず、生成関数を注入して疑似Workerでテストする。

**Files:**
- Create: `src/features/visual-diff/worker-lane.js`
- Create: `tests/unit/worker-lane.test.js`

**Interfaces:**
- Produces:
  - `createWorkerLane({ createWorker }) → { run, cancel, dispose }`
    - `run(type, payload, { transfer, onProgress }) → Promise<result>`
    - `cancel()` — 実行中のジョブを `RenderCancelled` で棄却し、Workerを破棄する
    - `dispose()` — Workerを破棄する（棄却は伴わない）
  - `isRenderCancelled(error) → boolean`
  - Workerへ送るメッセージ: `{ id, type, payload }`
  - Workerから受けるメッセージ: `{ id, type: "progress", ratio }` / `{ id, type: "done", result }` / `{ id, type: "error", message }`

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/worker-lane.test.js`:

```js
import { expect, test, vi } from "vitest";
import { createWorkerLane, isRenderCancelled } from "../../src/features/visual-diff/worker-lane.js";

class FakeWorker {
  constructor(registry) {
    this.posted = [];
    this.terminated = false;
    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;
    registry.push(this);
  }

  postMessage(message) {
    this.posted.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  emit(data) {
    this.onmessage?.({ data });
  }
}

function lane() {
  const workers = [];
  const createWorker = vi.fn(() => new FakeWorker(workers));
  return { workers, createWorker, subject: createWorkerLane({ createWorker }) };
}

test("creates the worker lazily on the first job", () => {
  const { createWorker, subject } = lane();

  expect(createWorker).not.toHaveBeenCalled();
  subject.run("diff", { width: 1 });
  expect(createWorker).toHaveBeenCalledTimes(1);
});

test("resolves a job with the returned result", async () => {
  const { workers, subject } = lane();

  const running = subject.run("diff", { width: 1 });
  const { id } = workers[0].posted[0];
  workers[0].emit({ id, type: "done", result: { removed: 3 } });

  await expect(running).resolves.toEqual({ removed: 3 });
});

test("forwards the payload and transfer list to the worker", () => {
  const { workers, subject } = lane();
  const buffer = new ArrayBuffer(8);

  subject.run("diff", { buffer }, { transfer: [buffer] });

  expect(workers[0].posted[0]).toMatchObject({ type: "diff", payload: { buffer } });
  expect(workers[0].posted).toHaveLength(1);
});

test("relays progress without settling the job", async () => {
  const { workers, subject } = lane();
  const onProgress = vi.fn();

  const running = subject.run("diff", {}, { onProgress });
  const { id } = workers[0].posted[0];
  workers[0].emit({ id, type: "progress", ratio: 0.5 });
  workers[0].emit({ id, type: "done", result: "ok" });

  expect(onProgress).toHaveBeenCalledWith(0.5);
  await expect(running).resolves.toBe("ok");
});

test("ignores messages carrying a stale job id", async () => {
  const { workers, subject } = lane();
  const onProgress = vi.fn();

  const running = subject.run("diff", {}, { onProgress });
  const { id } = workers[0].posted[0];
  workers[0].emit({ id: id + 99, type: "progress", ratio: 0.9 });
  workers[0].emit({ id, type: "done", result: "ok" });

  expect(onProgress).not.toHaveBeenCalled();
  await expect(running).resolves.toBe("ok");
});

test("rejects a job reported as failed", async () => {
  const { workers, subject } = lane();

  const running = subject.run("diff", {});
  const { id } = workers[0].posted[0];
  workers[0].emit({ id, type: "error", message: "boom" });

  await expect(running).rejects.toThrow("boom");
});

test("terminates the worker and rejects on cancel", async () => {
  const { workers, subject } = lane();

  const running = subject.run("diff", {});
  subject.cancel();

  expect(workers[0].terminated).toBe(true);
  await expect(running).rejects.toSatisfy(isRenderCancelled);
});

test("starts a fresh worker after a cancel", async () => {
  const { workers, createWorker, subject } = lane();

  const cancelled = subject.run("diff", {});
  subject.cancel();
  await expect(cancelled).rejects.toSatisfy(isRenderCancelled);

  const running = subject.run("diff", {});
  expect(createWorker).toHaveBeenCalledTimes(2);
  const { id } = workers[1].posted[0];
  workers[1].emit({ id, type: "done", result: "second" });
  await expect(running).resolves.toBe("second");
});

test("does nothing when cancelling an idle lane", () => {
  const { workers, subject } = lane();

  expect(() => subject.cancel()).not.toThrow();
  expect(workers).toHaveLength(0);
});

test("rejects the running job when the worker reports an error", async () => {
  const { workers, subject } = lane();

  const running = subject.run("diff", {});
  workers[0].onerror?.({ message: "worker crashed" });

  await expect(running).rejects.toThrow("worker crashed");
  expect(workers[0].terminated).toBe(true);
});

test("refuses to start a second job while one is running", () => {
  const { subject } = lane();

  subject.run("diff", {});

  expect(() => subject.run("diff", {})).toThrow(/busy/i);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run tests/unit/worker-lane.test.js`
Expected: FAIL（`Failed to resolve import "../../src/features/visual-diff/worker-lane.js"`）

- [ ] **Step 3: `worker-lane.js` を実装する**

`src/features/visual-diff/worker-lane.js`:

```js
const CANCELLED = "RenderCancelled";

function cancelledError() {
  const error = new Error("描画を打ち切りました");
  error.name = CANCELLED;
  return error;
}

export function isRenderCancelled(error) {
  return error?.name === CANCELLED;
}

export function createWorkerLane({ createWorker }) {
  let worker = null;
  let pending = null;
  let nextId = 1;

  function destroy() {
    worker?.terminate();
    worker = null;
  }

  function settleWithError(error) {
    const job = pending;
    pending = null;
    destroy();
    job?.reject(error);
  }

  function handleMessage({ data }) {
    if (!pending || data?.id !== pending.id) return;
    if (data.type === "progress") {
      pending.onProgress?.(data.ratio);
      return;
    }
    const job = pending;
    pending = null;
    if (data.type === "error") job.reject(new Error(data.message));
    else job.resolve(data.result);
  }

  function handleFailure(event) {
    settleWithError(new Error(event?.message || "Workerの実行に失敗しました"));
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = createWorker();
    worker.onmessage = handleMessage;
    worker.onerror = handleFailure;
    worker.onmessageerror = handleFailure;
    return worker;
  }

  function run(type, payload, { transfer = [], onProgress = null } = {}) {
    if (pending) throw new Error("Worker lane is busy");
    const id = nextId;
    nextId += 1;
    const target = ensureWorker();
    return new Promise((resolve, reject) => {
      pending = { id, resolve, reject, onProgress };
      target.postMessage({ id, type, payload }, transfer);
    });
  }

  function cancel() {
    if (!pending) return;
    settleWithError(cancelledError());
  }

  return { run, cancel, dispose: destroy };
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run tests/unit/worker-lane.test.js`
Expected: PASS（11件）

- [ ] **Step 5: コミット**

```bash
git add src/features/visual-diff/worker-lane.js tests/unit/worker-lane.test.js
git commit -m "feat(worker): 差分計算用のWorkerレーンを追加"
```

---

## Task 4: Workerを組み込んで描画を非同期化する

計算をWorkerへ移し、`visual-renderer.js` の呼び出しを `await` にする。対話操作用とエクスポート用でレーンを分ける。

**Files:**
- Create: `src/workers/diff-worker.js`
- Create: `src/platform/diff-worker.js`
- Modify: `src/features/visual-diff/visual-renderer.js`
- Modify: `src/features/visual-diff/toggle-renderer.js`
- Modify: `src/app/create-app.js`
- Modify: `tests/integration/visual-controller.test.js`

**Interfaces:**
- Consumes: `computeDiff` / `computeAlignment` / `computeQuadrant`（Task 1、Task 2）、`createWorkerLane`（Task 3）
- Produces:
  - `createDiffWorker() → Worker`（`src/platform/diff-worker.js`）
  - Workerが受け付けるジョブ種別: `"diff"` / `"align"` / `"quadrant"`
  - `dependencies.computeDiff(payload, { transfer, onProgress }) → Promise<{ image, removed, added, boxes }>`
  - `dependencies.computeAlignment(payload, { transfer }) → Promise<alignment>`
  - `dependencies.computeQuadrant(payload, { transfer }) → Promise<quadrant>`

- [ ] **Step 1: Workerのメッセージハンドラを書く**

`src/workers/diff-worker.js`:

```js
import { computeAlignment, computeQuadrant } from "../core/alignment/align-compute.js";
import { computeDiff } from "../core/image-diff/diff-compute.js";

function runDiff(id, payload) {
  const result = computeDiff({
    ...payload,
    onProgress: ratio => self.postMessage({ id, type: "progress", ratio }),
  });
  const transfer = result.image ? [result.image.buffer] : [];
  return { result, transfer };
}

const HANDLERS = {
  diff: runDiff,
  align: (id, payload) => ({ result: computeAlignment(payload), transfer: [] }),
  quadrant: (id, payload) => ({ result: computeQuadrant(payload), transfer: [] }),
};

self.onmessage = ({ data }) => {
  const { id, type, payload } = data;
  const handler = HANDLERS[type];
  if (!handler) {
    self.postMessage({ id, type: "error", message: `未知のジョブ種別です: ${type}` });
    return;
  }
  try {
    const { result, transfer } = handler(id, payload);
    self.postMessage({ id, type: "done", result }, transfer);
  } catch (error) {
    self.postMessage({ id, type: "error", message: error?.message || String(error) });
  }
};
```

- [ ] **Step 2: Worker生成をplatformへ置く**

`src/platform/diff-worker.js`:

```js
export function createDiffWorker() {
  return new Worker(new URL("../workers/diff-worker.js", import.meta.url), {
    type: "module",
  });
}
```

- [ ] **Step 3: `visual-renderer.js` の呼び出しを非同期化する**

まず import を整理する。Task 1 で追加した `computeDiff` の直接 import を外し、`DIFF_RGB` だけを残す。計算は `dependencies` 経由に変わるためである。

```js
import { DIFF_RGB } from "../../core/image-diff/diff-compute.js";
```

`ensureQuadrant` の `cache.set(pageIndex, dependencies.computeQuadrant({ ... }));` を `await` へ変える。`ensureQuadrant` はすでに `async` である。

```js
  cache.set(pageIndex, await dependencies.computeQuadrant({
    oldData: oldRgba.data,
    oldWidth: oldRgba.width,
    oldHeight: oldRgba.height,
    newData: newRgba.data,
    newWidth: newRgba.width,
    newHeight: newRgba.height,
    threshold: comparison.threshold,
  }, { transfer: [oldRgba.data.buffer, newRgba.data.buffer] }));
```

`ensureAlignment` を `async function` にし、同様に `await` と `transfer` を加える。

```js
  cache.set(snapshot.pageIndex, await dependencies.computeAlignment({
    oldData: oldRgba.data,
    oldWidth: oldRgba.width,
    oldHeight: oldRgba.height,
    newData: newRgba.data,
    newWidth: newRgba.width,
    newHeight: newRgba.height,
    threshold: snapshot.comparison.threshold,
  }, { transfer: [oldRgba.data.buffer, newRgba.data.buffer] }));
```

`prepareVisualPage` の `ensureAlignment(...)` 呼び出しを `await ensureAlignment(...)` へ変える。

`computeChangeBoxesAligned` を `async` にし、`await dependencies.computeDiff(...)` を返す形へ変える。`prepared.oldImage` と `prepared.alignedNewImage` のバッファは転送する。

```js
export async function computeChangeBoxesAligned(snapshot, prepared, dependencies) {
  const { comparison } = snapshot;
  const oldData = prepared.oldImage?.data ?? null;
  const newData = prepared.alignedNewImage.data;
  const transfer = [newData.buffer];
  if (oldData) transfer.push(oldData.buffer);
  const computed = await dependencies.computeDiff({
    oldData,
    oldWidth: prepared.oldWidth,
    oldHeight: prepared.oldHeight,
    newData,
    width: prepared.width,
    height: prepared.height,
    threshold: comparison.threshold,
    radius: toleranceRadiusPx(comparison),
    block: blockSize(comparison),
    minBlocks: BOX_MIN_BLOCKS,
    needsImage: false,
    needsBoxes: true,
  }, { transfer });
  return computed.boxes;
}
```

`renderDiffPage` の `computeDiff(...)` 呼び出しを同じ形（`await` と `transfer`）へ変え、`options` から進捗を受け取れるようにする。関数シグネチャを次へ変える。

```js
export async function renderDiffPage(snapshot, dependencies, { onProgress = null } = {}) {
```

`prepareVisualPage` にも `onProgress` を渡し、段階を報告する。`prepareVisualPage` のシグネチャを次へ変える。

```js
export async function prepareVisualPage(snapshot, dependencies, cachedPages = null, onProgress = null) {
```

`prepareVisualPage` の冒頭で `onProgress?.({ phase: "render" })` を呼び、`ensureAlignment` の直前で `onProgress?.({ phase: "align" })` を呼ぶ。

`renderDiffPage` の `computeDiff` 呼び出しでは次を渡す。

```js
  }, { transfer, onProgress: ratio => onProgress?.({ phase: "diff", ratio }) });
```

- [ ] **Step 4: `toggle-renderer.js` を追従させる**

`renderTogglePage` の `pageCache` から `oldImage: prepared.oldImage,`（49行目）を削除する。

`boxes` の算出を `await` へ変える。

```js
  const boxes = snapshot.boxEditor.manualBoxes != null
    ? snapshot.boxEditor.manualBoxes.map(box => ({ ...box }))
    : snapshot.boxEditor.showBoxes
      ? await computeChangeBoxesAligned(snapshot, prepared, dependencies)
      : [];
```

`renderTogglePage` のシグネチャに `options` を足し、`prepareVisualPage` へ渡す。

```js
export async function renderTogglePage(snapshot, dependencies, { onProgress = null } = {}) {
  const previous = snapshot.visual.toggleCache;
  const cachedPages = previous?.idx === snapshot.pageIndex ? previous : null;
  const prepared = await prepareVisualPage(snapshot, dependencies, cachedPages, onProgress);
```

- [ ] **Step 5: `create-app.js` でレーンを2本用意する**

import を追加する。

```js
import { createDiffWorker } from "../platform/diff-worker.js";
import { createWorkerLane } from "../features/visual-diff/worker-lane.js";
```

`DEFAULT_DEPENDENCIES` へ `createDiffWorker` と `createWorkerLane` を足し、`computeAlignment` / `computeQuadrant` の直接 import は削除する（Workerが担うため）。

`visualRenderDependencies` の直前へレーンと計算関数を用意する。

```js
  const interactiveLane = deps.createWorkerLane({ createWorker: deps.createDiffWorker });
  const exportLane = deps.createWorkerLane({ createWorker: deps.createDiffWorker });

  const laneCompute = lane => Object.freeze({
    computeDiff: (payload, options) => lane.run("diff", payload, options),
    computeAlignment: (payload, options) => lane.run("align", payload, options),
    computeQuadrant: (payload, options) => lane.run("quadrant", payload, options),
  });

  const sharedRenderDependencies = Object.freeze({
    sequenceIndex: deps.sequenceIndex,
    pageSizePt: deps.pageSizePt,
    framePlan: deps.framePlan,
    renderPageCanvas: deps.renderPageCanvas,
    rotateCanvas90: deps.rotateCanvas90,
    canvasToRgba: deps.canvasToRgba,
    alignProbeScale: deps.alignProbeScale,
    downscaleCanvas: deps.downscaleCanvas,
    createCanvas: deps.createCanvas,
    createWhiteCanvas: deps.createWhiteCanvas,
    pageLabelText: deps.pageLabelText,
  });

  const visualRenderDependencies = Object.freeze({
    ...sharedRenderDependencies,
    ...laneCompute(interactiveLane),
  });

  const exportRenderDependencies = Object.freeze({
    ...sharedRenderDependencies,
    ...laneCompute(exportLane),
  });
```

`createVisualController` へ渡す関数を、進捗を通す形へ変える。

```js
    renderDiffPage: (snapshot, options) => deps.renderDiffPage(snapshot, visualRenderDependencies, options),
    renderTogglePage: (snapshot, options) => deps.renderTogglePage(snapshot, visualRenderDependencies, options),
```

`createExportController` の `renderVisualOffscreen`（332-334行目）をエクスポート用レーンへ向ける。

```js
    renderVisualOffscreen: ({ renderSnapshot }) => (
      deps.renderDiffPage(renderSnapshot, exportRenderDependencies)
    ),
```

- [ ] **Step 6: 統合テストへ同期アダプタを注入する**

`tests/integration/visual-controller.test.js` の import へ core の関数を足す。

```js
import { computeDiff } from "../../src/core/image-diff/diff-compute.js";
import { computeAlignment, computeQuadrant } from "../../src/core/alignment/align-compute.js";
```

`rendererDependencies` の `computeAlignment: vi.fn(),` / `computeQuadrant: vi.fn(),` を、core を直接呼ぶアダプタへ置き換える。

```js
    computeDiff: async payload => computeDiff(payload),
    computeAlignment: async payload => computeAlignment(payload),
    computeQuadrant: async payload => computeQuadrant(payload),
```

- [ ] **Step 7: 全テストが通ることを確認する**

Run: `npm test`
Expected: PASS。`renderDiffPage` の画素の期待値（`tests/integration/visual-controller.test.js` の「renders the exact legacy common removed and added pixels offscreen」）が**変更なしで通る**ことが、差分アルゴリズムを変えていない証拠になる。落ちた場合は期待値を書き換えず、実装側を直す。

- [ ] **Step 8: 境界テストを確認する**

Run: `npx vitest run tests/unit/dependency-boundaries.test.js`
Expected: PASS。`src/core/**` に `self` は現れず（Workerのハンドラは `src/workers/` にある）、`src/features/visual-diff/worker-lane.js` は他の feature を import していない。

- [ ] **Step 9: ビルドが通ることを確認する**

Run: `npm run build`
Expected: 成功。`dist/assets/` にWorkerのチャンクが生成され、`tests/verify-dist.mjs` がCDN URLとソースマップの不在を確認して終了する。

- [ ] **Step 10: コミット**

```bash
git add src/workers/diff-worker.js src/platform/diff-worker.js src/features/visual-diff/visual-renderer.js src/features/visual-diff/toggle-renderer.js src/app/create-app.js tests/integration/visual-controller.test.js
git commit -m "feat(worker): 差分計算と位置合わせをWorkerへ移す"
```

---

## Task 5: 描画開始時に前のジョブを打ち切る

**Files:**
- Modify: `src/features/visual-diff/visual-controller.js`
- Modify: `src/app/create-app.js`
- Modify: `tests/integration/visual-controller.test.js`

**Interfaces:**
- Consumes: `lane.cancel()`（Task 3）、`isRenderCancelled(error)`（Task 3）
- Produces: `dom.cancelRender` — `createVisualController` の `dom` が受け取る任意の関数。`showPage` の開始時に呼ばれる。

- [ ] **Step 1: 失敗するテストを書く**

`tests/integration/visual-controller.test.js` の `harness` の `dom` へ `cancelRender: vi.fn(),` を足し、次のテストを追加する（既存の `test("commits only the latest page when an older render finishes last", ...)` の直後）。

```js
test("cancels the previous render before starting a new one", async () => {
  const first = deferred();
  const renderDiffPage = vi.fn()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce(result(1));
  const { controller, dom } = harness({ renderDiffPage });

  const pending = controller.showPage(0);
  expect(dom.cancelRender).toHaveBeenCalledTimes(1);

  const second = controller.showPage(1);
  expect(dom.cancelRender).toHaveBeenCalledTimes(2);

  const cancelled = new Error("描画を打ち切りました");
  cancelled.name = "RenderCancelled";
  first.reject(cancelled);

  await expect(pending).resolves.toMatchObject({ committed: false });
  await expect(second).resolves.toMatchObject({ committed: true });
  expect(dom.reportError).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run tests/integration/visual-controller.test.js -t "cancels the previous render"`
Expected: FAIL（`expected "spy" to be called 1 times, but got 0 times`）

- [ ] **Step 3: `visual-controller.js` へ打ち切りを組み込む**

`showPage` の中で、`dom.cancelBoxDrag?.();` の直前に一行足す。

```js
    dom.cancelRender?.();
```

置き場所は `const ticket = ...` より前、つまり `if (pageIndex < 0 || pageIndex >= state.documents.pages) return { committed: false };` の直後とする。範囲外のページ指定で既存の描画を壊さないためである。

打ち切られたジョブの棄却は、通常は既存の `catch` の中の `isCurrent` 判定が偽になるため握りつぶされる。ただしこれは「打ち切りの直後に必ず新しい描画世代が始まっている」という前提に依存しており、状態の変化に対して脆い。打ち切りそのものを明示的に扱うため、`catch` を次のように変える。

ファイル冒頭の import へ足す。

```js
import { isRenderCancelled } from "./worker-lane.js";
```

`catch (error) { ... }` の中の `dom.reportError?.(error);` を次へ置き換える。

```js
      if (!isRenderCancelled(error)) dom.reportError?.(error);
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run tests/integration/visual-controller.test.js`
Expected: PASS。`dom.reportError` は呼ばれない。

- [ ] **Step 5: `create-app.js` で配線する**

`createVisualController` へ渡す `dom` へ次を足す（`cancelBoxDrag` の隣）。

```js
      cancelRender: () => interactiveLane.cancel(),
```

- [ ] **Step 6: 全テストが通ることを確認する**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: コミット**

```bash
git add src/features/visual-diff/visual-controller.js src/app/create-app.js tests/integration/visual-controller.test.js
git commit -m "feat(worker): 新しい描画の開始時に前のジョブを打ち切る"
```

---

## Task 6: 進捗を表示する

**Files:**
- Modify: `src/features/visual-diff/visual-controller.js`
- Modify: `tests/integration/visual-controller.test.js`

**Interfaces:**
- Consumes: `renderDiffPage(snapshot, { onProgress })` / `renderTogglePage(snapshot, { onProgress })`（Task 4 で `create-app.js` が第2引数に `options` を通すようにしてある）
- Produces: `dom.status.innerHTML` が段階に応じて `ページを描画中…` / `位置合わせ中…` / `差分を計算中… NN%` を表示する

- [ ] **Step 1: 失敗するテストを書く**

`tests/integration/visual-controller.test.js` へ追加する。

```js
test("shows each rendering phase in the status line", async () => {
  const pending = deferred();
  let report;
  const renderDiffPage = vi.fn((snapshot, options) => {
    report = options.onProgress;
    return pending.promise;
  });
  const { controller, dom } = harness({ renderDiffPage });

  const running = controller.showPage(0);
  report({ phase: "render" });
  expect(dom.status.textContent).toBe("ページを描画中…");
  report({ phase: "align" });
  expect(dom.status.textContent).toBe("位置合わせ中…");
  report({ phase: "diff", ratio: 0.45 });
  expect(dom.status.textContent).toBe("差分を計算中… 45%");

  pending.resolve(result(0));
  await running;
  expect(dom.status.textContent).toBe("差分を表示中");
});

test("ignores progress from a superseded render", async () => {
  const first = deferred();
  const reports = [];
  const renderDiffPage = vi.fn((snapshot, options) => {
    reports.push(options.onProgress);
    return reports.length === 1 ? first.promise : Promise.resolve(result(1));
  });
  const { controller, dom } = harness({ renderDiffPage });

  const stale = controller.showPage(0);
  const fresh = controller.showPage(1);
  await fresh;

  reports[0]({ phase: "diff", ratio: 0.9 });
  expect(dom.status.textContent).toBe("差分を表示中");

  first.resolve(result(0));
  await stale;
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run tests/integration/visual-controller.test.js -t "rendering phase"`
Expected: FAIL（`options.onProgress` が `undefined` のため `TypeError`）

- [ ] **Step 3: `visual-controller.js` へ進捗表示を組み込む**

`showPage` の中の `dom.status.innerHTML = '<span class="busy">レンダリング中…</span>';` を残したうえで、その直後へ進捗ハンドラを定義する。

```js
    const phaseLabel = ({ phase, ratio }) => {
      if (phase === "render") return "ページを描画中…";
      if (phase === "align") return "位置合わせ中…";
      return `差分を計算中… ${Math.round((ratio ?? 0) * 100)}%`;
    };
    const onProgress = value => {
      if (!isCurrent(ticket, snapshot, updateCurrentPage, commitToggleSide)) return;
      dom.status.innerHTML = `<span class="busy">${phaseLabel(value)}</span>`;
    };
```

`renderer` の呼び出しへ渡す。

```js
      result = await renderer(snapshot, { onProgress });
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run tests/integration/visual-controller.test.js`
Expected: PASS

- [ ] **Step 5: 全テストが通ることを確認する**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add src/features/visual-diff/visual-controller.js tests/integration/visual-controller.test.js
git commit -m "feat(worker): 描画の進捗を段階と百分率で表示する"
```

---

## Task 7: ブラウザで確認し、文書を更新する

**Files:**
- Modify: `index.html`
- Modify: `tests/unit/documentation.test.js`
- Modify: `README.md`
- Modify: `tests/e2e/baseline.spec.js-snapshots/*`（差分が出た場合のみ）

- [ ] **Step 1: E2Eを実行する**

Run: `npm run test:e2e`
Expected: PASS

失敗した場合、まずスナップショット差分の画像（`test-results/` 配下）を開いて内容を確認する。自動位置合わせの縮小経路が変わったことによる軽微な差であれば `npx playwright test --update-snapshots` で更新してよい。差分の色や変更枠の位置が変わっている場合は実装の誤りなので、更新せずに直す。

- [ ] **Step 2: 開発サーバで実機確認する**

Run: `npm run dev`

ブラウザで次を確認する。

1. 300DPIで大きめのPDFを2つ読み込み、比較を実行する。処理中にステータスが `位置合わせ中…` から `差分を計算中… NN%` へ進む。
2. 処理中にページ送りを押すと、進行中の計算が止まって新しいページの描画が始まる。
3. PDF出力の実行中にページを送っても、出力が完了する。
4. 新旧切替モードで差分モードと同じ変更枠が出る。

- [ ] **Step 3: `index.html` の更新日を書き換える**

`<span class="sub">PDF OVERLAY DIFF · UPDATED yyyy-mm-dd</span>` を作業当日の日付へ書き換える。

- [ ] **Step 4: `documentation.test.js` の日付を合わせる**

`expect(html).toContain("UPDATED yyyy-mm-dd");` を同じ日付へ書き換える。

- [ ] **Step 5: READMEへ性能に関する記述を足す**

`README.md` の機能一覧（「解像度 DPI・インク判定しきい値の調整」の項目の近く）へ次の2行を加える。

```markdown
- 差分の画素処理と自動位置合わせはWeb Workerで実行され、計算中も画面操作を受け付ける
  - 処理中にページを切り替えると、進行中の計算は打ち切られて新しいページの描画が始まる
```

- [ ] **Step 6: 全テストが通ることを確認する**

Run: `npm test && npm run build`
Expected: どちらもPASS

- [ ] **Step 7: コミット**

```bash
git add index.html tests/unit/documentation.test.js README.md tests/e2e
git commit -m "docs(worker): Worker化に伴う文書と更新日を反映"
```

---

## 完了確認

計画のすべてのタスクを終えたら、仕様書の完了条件（`docs/superpowers/specs/2026-08-10-diff-worker-design.md` 第11章）を1件ずつ照合する。

- 300DPIの大判ページで進捗表示が更新され、ページ送りが受け付けられる — Task 6 Step 2 の実機確認
- 描画中のページ送りで実行中のジョブが打ち切られる — Task 5、Task 7 Step 2 の実機確認
- PDF出力中にページを送っても出力が中断されない — Task 4 のレーン分離、Task 7 Step 2 の実機確認
- 自動位置合わせのgray配列とRGBAがページ解像度に依存しない — Task 2
- 差分の色、集計、変更枠が現行と一致する — Task 4 Step 7（既存の期待値を変更せずに通ること）
- 単体、統合、E2Eがすべて通る — Task 7 Step 6
