# 自動ページ対応付け Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新旧PDFのページ類似度から、ページの追加・削除を自動判定して既存のページ整列（空白スロット挿入）へ反映する。

**Architecture:** core に純粋計算（64×64 インクマスク・4方向 IoU・Needleman–Wunsch 型 DP・要約文）を置き、Worker のジョブ `pageSignature` / `pageMap` から呼ぶ。features/documents の `page-mapping-controller` が全ページを長辺 1024px で描画して Worker へ渡し、app が結果を `oldSequence` / `newSequence` に適用して `alignmentOps` に1件の Undo 操作として積む。

**Tech Stack:** 素の ES Modules / Vite / pdf.js 3.11.174 / jsPDF 2.5.1（フィクスチャ生成）/ Vitest / Playwright

**Spec:** `docs/superpowers/specs/2026-09-26-auto-page-mapping-design.md`

## Global Constraints

- PDFや解析結果を外部へ送信しない（アップロード・外部API・テレメトリ・実行時CDN禁止）。
- レイヤ境界: core は app/features/platform と `document`/`window` を参照しない。features は app と他 feature を import しない、`console.*` 禁止。workers は core のみ import。`addEventListener` は `src/app/bind-controls.js` だけが呼ぶ。
- index.html にインライン `<style>` / `<script>` / `on*` 属性を書かない。
- 対応付けはページ順を保つ挿入・削除のみ。ページ順の入れ替えは扱わない。
- 定数: `SIGNATURE_LONG_EDGE = 1024`、`SIGNATURE_GRID = 64`、`MATCH_MIN = 0.6`（τ）、`LOW_SIMILARITY = 0.8`。
- 表示文言（そのまま使う）:
  - 提案: `ページ数が異なります（旧 {n}／新 {m}）。自動でページ整列できます`
  - 実行中: `ページを解析中… {done}/{total}`
  - 変更なし: `変更はありませんでした`
  - 失敗: `{旧版|新版} P{n} の解析に失敗したため自動整列を中止しました`（ページ特定不可なら `自動整列に失敗しました`）
- Node.js 22.12 以上の 22 系。テストは `npm run test`、`npm run test:e2e`。
- ヘッダーの `UPDATED yyyy-mm-dd` と `tests/unit/documentation.test.js` の日付を実装日（2026-09-26）へ揃える。

## Review Focus

1. **PDF再読み込み中の自動整列** — 実行中に旧版か新版を差し替えたら、古い結果を適用せず、表示も残さない。→ Task 3（controller の stale テスト）、Task 4（`onLoadAccepted` でレーン中断と表示クリア）
2. **差分表示前に適用 → 「差分を表示」** — 描画前に整列しても、`pages` が新しいスロット数になり、ページ送りがずれない。→ Task 4 の integration テスト（`pages` を検証）
3. **自動整列の後に手動整列 → Undo を2回** — 1回目で手動分、2回目で自動分がそれぞれ正しく戻る。→ Task 4 の integration テスト
4. **細い線だけの図面** — 1pt の細線が2値化で消えずに類似度が分離する。→ Task 2 の校正 e2e（A3・1pt 線のフィクスチャ）
5. **手編集した変更枠がある状態で適用** — 確認ダイアログで拒否したら、並びも Undo 履歴も変えない。→ Task 4 の integration テスト

---

## File Structure

| ファイル | 種別 | 責務 |
|---|---|---|
| `src/core/page-mapping/page-mapping.js` | 新規 | マスク生成・類似度・DP・要約文 |
| `tests/unit/page-mapping.test.js` | 新規 | core の unit テスト |
| `tests/fixtures/generate-fixtures.mjs` | 変更 | A3 シート群フィクスチャ `sheets-old.pdf` / `sheets-new.pdf` を生成 |
| `.gitignore` | 変更 | 生成フィクスチャを除外 |
| `tests/e2e/page-mapping.spec.js` | 新規 | τ 校正（ブラウザ内描画）と操作フロー |
| `src/workers/diff-worker.js` | 変更 | ジョブ `pageSignature` / `pageMap` |
| `src/features/documents/page-mapping-controller.js` | 新規 | 全ページ描画・Worker 呼び出し・進捗・世代判定 |
| `tests/unit/page-mapping-controller.test.js` | 新規 | controller の unit テスト |
| `index.html` / `src/styles/controls.css` | 変更 | ボタン `#alignAuto`・表示欄 `#pageMapNotice` |
| `src/app/dom.js` / `src/app/bind-controls.js` / `src/app/create-app.js` | 変更 | 配線・提案・適用・Undo |
| `tests/unit/bind-controls.test.js` / `tests/integration/create-app.test.js` | 変更 | 配線と適用フローのテスト |
| `README.md` / `tests/unit/documentation.test.js` / `tests/e2e/baseline.spec.js-snapshots/*` | 変更 | 文書・日付・スナップショット |

---

### Task 1: core — ページマスク・類似度・対応付け・要約

**Files:**
- Create: `src/core/page-mapping/page-mapping.js`
- Test: `tests/unit/page-mapping.test.js`

**Interfaces:**
- Consumes: `grayFromRgba(data, width, height) → { g, w, h }`（`src/core/alignment/align-compute.js`）、`inkMaskFromGray(gray, n, th)`・`downsampleMaskMax(mask, W, H, Wc, Hc, tw, th)`・`inkIoU(a, b, n)`（`src/core/alignment/similarity.js`）
- Produces:
  - `SIGNATURE_LONG_EDGE`, `SIGNATURE_GRID`, `MATCH_MIN`, `LOW_SIMILARITY`（number）
  - `pageSignature({ data, width, height, threshold }) → Uint8Array(64*64)`
  - `pageSimilarity(oldMask, newMask) → number`（0〜1）
  - `mapPages(oldMasks, newMasks, { matchMin } = {}) → { oldSequence: (number|null)[], newSequence: (number|null)[], similarity: (number|null)[] }`
  - `describeMapping({ oldSequence, newSequence, similarity }) → string`

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/page-mapping.test.js`:

```js
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
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run tests/unit/page-mapping.test.js`
Expected: FAIL（`page-mapping.js` が存在しない）

- [ ] **Step 3: 最小実装を書く**

`src/core/page-mapping/page-mapping.js`:

```js
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

export function pageSimilarity(oldMask, newMask) {
  const n = SIGNATURE_GRID;
  let best = 0;
  let rotated = newMask;
  for (let k = 0; k < 4; k += 1) {
    best = Math.max(best, inkIoU(oldMask, rotated, n * n));
    rotated = rotateMask(rotated, n);
  }
  return best;
}

// 順序を保つ系列アラインメント。空白の挿入は0点、対応は (類似度 − τ) 点。
export function mapPages(oldMasks, newMasks, { matchMin = MATCH_MIN } = {}) {
  const m = oldMasks.length;
  const n = newMasks.length;
  const sim = oldMasks.map(oldMask => newMasks.map(newMask => pageSimilarity(oldMask, newMask)));
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
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run tests/unit/page-mapping.test.js tests/unit/dependency-boundaries.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/core/page-mapping/page-mapping.js tests/unit/page-mapping.test.js
git commit -m "feat: compute order-preserving page mapping from ink masks"
```

---

### Task 2: A3 シート群フィクスチャと τ の校正

**Files:**
- Modify: `tests/fixtures/generate-fixtures.mjs`
- Modify: `.gitignore`
- Create: `tests/e2e/page-mapping.spec.js`
- （校正結果によっては）Modify: `src/core/page-mapping/page-mapping.js` の `MATCH_MIN`

**Interfaces:**
- Consumes: Task 1 の `pageSignature`, `pageSimilarity`, `MATCH_MIN`, `SIGNATURE_LONG_EDGE`。`pdfjsLib`, `PDF_DOCUMENT_OPTIONS`（`/src/platform/pdfjs.js`）、`renderPageCanvas`, `canvasToRgba`（`/src/features/documents/page-renderer.js`）。e2e は Vite dev サーバ上で `/src/...` を動的 import できる。
- Produces: `tests/fixtures/sheets-old.pdf`（シート 1〜5）、`tests/fixtures/sheets-new.pdf`（シート 1, 2, 新規 6, 改訂 3, 4, 5）。正しい対応は旧 `[0,1,null,2,3,4]` ／新 `[0,1,2,3,4,5]`。

- [ ] **Step 1: フィクスチャ生成を追加する**

`tests/fixtures/generate-fixtures.mjs` の末尾（既存の `writeFile` 2行の後）に追加する:

```js
function random(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// 共通の図枠・表題欄に、シートごとに異なる図形40個を1pt線で描く。改訂は先頭3図形を右へ60pt移動。
function drawSheet(pdf, sheet, revised) {
  const W = 1191;
  const H = 842;
  pdf.setLineWidth(1.5);
  pdf.rect(20, 20, W - 40, H - 40);
  pdf.rect(W - 320, H - 120, 300, 100);
  pdf.line(W - 320, H - 70, W - 20, H - 70);
  pdf.setFontSize(14);
  pdf.text("PDF DIFF FIXTURE", W - 305, H - 90);
  pdf.text(`SHEET ${sheet}`, W - 305, H - 40);
  pdf.setLineWidth(1);
  const next = random(sheet * 7919);
  for (let i = 0; i < 40; i += 1) {
    const x = 60 + next() * (W - 440) + (revised && i < 3 ? 60 : 0);
    const y = 60 + next() * (H - 220);
    const w = 20 + next() * 120;
    const h = 20 + next() * 80;
    if (i % 3 === 0) pdf.circle(x + w / 2, y + h / 2, Math.min(w, h) / 2);
    else if (i % 3 === 1) pdf.rect(x, y, w, h);
    else pdf.line(x, y, x + w, y + h);
  }
}

function makeSheets(fileId, sheets) {
  const pdf = new jsPDF({ unit: "pt", format: "a3", orientation: "landscape", compress: true });
  pdf.setCreationDate(new Date("2020-01-01T00:00:00.000Z"));
  pdf.setFileId(fileId);
  pdf.setFont("helvetica", "normal");
  sheets.forEach(({ sheet, revised = false }, index) => {
    if (index) pdf.addPage("a3", "landscape");
    drawSheet(pdf, sheet, revised);
  });
  return Buffer.from(pdf.output("arraybuffer"));
}

await writeFile(join(dir, "sheets-old.pdf"), makeSheets(
  "00000000000000000000000000000003",
  [1, 2, 3, 4, 5].map(sheet => ({ sheet })),
));
await writeFile(join(dir, "sheets-new.pdf"), makeSheets(
  "00000000000000000000000000000004",
  [{ sheet: 1 }, { sheet: 2 }, { sheet: 6 }, { sheet: 3, revised: true }, { sheet: 4 }, { sheet: 5 }],
));
```

`.gitignore` の `tests/fixtures/new.pdf` の次の行に追加する:

```
tests/fixtures/sheets-old.pdf
tests/fixtures/sheets-new.pdf
```

Run: `node tests/fixtures/generate-fixtures.mjs && git status --short tests/fixtures`
Expected: `generate-fixtures.mjs` だけが変更として出る（PDF は ignore される）

- [ ] **Step 2: 校正 e2e を書く**

`tests/e2e/page-mapping.spec.js`:

```js
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const EXPECTED = [[0, 0], [1, 1], [2, 3], [3, 4], [4, 5]];

// Break: τ が図枠共有の別シートと改訂シートの間に無いと、自動整列が誤った組を作る。
test("MATCH_MIN separates revised sheets from other sheets sharing the frame", async ({ page }) => {
  await page.goto("/");
  const oldBytes = [...await readFile(join(fixtures, "sheets-old.pdf"))];
  const newBytes = [...await readFile(join(fixtures, "sheets-new.pdf"))];
  const matrix = await page.evaluate(async ({ oldBytes, newBytes }) => {
    const { pdfjsLib, PDF_DOCUMENT_OPTIONS } = await import("/src/platform/pdfjs.js");
    const { renderPageCanvas, canvasToRgba } = await import("/src/features/documents/page-renderer.js");
    const core = await import("/src/core/page-mapping/page-mapping.js");
    async function masks(bytes) {
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes), ...PDF_DOCUMENT_OPTIONS }).promise;
      const out = [];
      for (let index = 0; index < doc.numPages; index += 1) {
        const viewport = (await doc.getPage(index + 1)).getViewport({ scale: 1 });
        const scale = core.SIGNATURE_LONG_EDGE / Math.max(viewport.width, viewport.height);
        const { data, width, height } = canvasToRgba(await renderPageCanvas(doc, index, scale));
        out.push(core.pageSignature({ data, width, height, threshold: 128 }));
      }
      return out;
    }
    const oldMasks = await masks(oldBytes);
    const newMasks = await masks(newBytes);
    return {
      matchMin: core.MATCH_MIN,
      sim: oldMasks.map(o => newMasks.map(n => core.pageSimilarity(o, n))),
    };
  }, { oldBytes, newBytes });

  const same = EXPECTED.map(([o, n]) => matrix.sim[o][n]);
  const cross = matrix.sim.flatMap((row, o) => row.filter((_, n) => !EXPECTED.some(
    ([eo, en]) => eo === o && en === n,
  )));
  console.log(`same-sheet min=${Math.min(...same).toFixed(3)} cross-sheet max=${Math.max(...cross).toFixed(3)}`);
  expect(Math.max(...cross)).toBeLessThan(matrix.matchMin - 0.05);
  expect(Math.min(...same)).toBeGreaterThan(matrix.matchMin + 0.05);
});
```

- [ ] **Step 3: 校正を実行して τ を決める**

Run: `npx playwright test tests/e2e/page-mapping.spec.js --project=chromium`
Expected: PASS と、ログに `same-sheet min=… cross-sheet max=…` が出る。

- ログの2値の間に 0.6 が 0.05 以上の余白付きで入っていれば `MATCH_MIN` はそのまま。
- 入っていなければ `MATCH_MIN` を2値の中点（小数2桁に丸め）へ変更する。そのうえで `npx vitest run tests/unit/page-mapping.test.js` も通ることを確かめる。
- `same-sheet min` が 0.6 を大きく下回る（細線が消えている）ときは τ を下げない。実装者はここで止めて報告する。原因は `SIGNATURE_LONG_EDGE` か2値化にある。

続けて3ブラウザで確認する。
Run: `npx playwright test tests/e2e/page-mapping.spec.js`
Expected: chromium / firefox / webkit すべて PASS

- [ ] **Step 4: コミット**

```bash
git add tests/fixtures/generate-fixtures.mjs .gitignore tests/e2e/page-mapping.spec.js src/core/page-mapping/page-mapping.js
git commit -m "test: calibrate page mapping threshold on framed A3 sheets"
```

---

### Task 3: Worker ジョブとページ解析 controller

**Files:**
- Modify: `src/workers/diff-worker.js`
- Create: `src/features/documents/page-mapping-controller.js`
- Test: `tests/unit/page-mapping-controller.test.js`

**Interfaces:**
- Consumes: Task 1 の `pageSignature`, `mapPages`, `SIGNATURE_LONG_EDGE`
- Produces:
  - Worker ジョブ `"pageSignature"`（payload `{ data, width, height, threshold }` → `Uint8Array`）と `"pageMap"`（payload `{ oldMasks, newMasks }` → `mapPages` の戻り値）
  - `createPageMappingController({ state, pageSizePt, renderPageCanvas, canvasToRgba, runJob, onProgress }) → { run(): Promise<MappingResult|null> }`
    - `runJob(type, payload, transfer) → Promise`
    - `onProgress(done, total)`
    - 戻り値 `null` は世代が変わった（PDF差し替え）ことを示す
    - ページ失敗時は `Error` に `{ side: "old"|"new", pageIndex }` を付けて reject

- [ ] **Step 1: 失敗するテストを書く**

`tests/unit/page-mapping-controller.test.js`:

```js
import { expect, test, vi } from "vitest";
import { createPageMappingController } from "../../src/features/documents/page-mapping-controller.js";

function setup({ runJob, renderPageCanvas } = {}) {
  const state = {
    documents: { generation: 1, oldDoc: { numPages: 2 }, newDoc: { numPages: 3 } },
    comparison: { threshold: 140 },
  };
  const canvases = [];
  const mapping = { oldSequence: [0, 1, null], newSequence: [0, 1, 2], similarity: [1, 1, null] };
  const deps = {
    state,
    pageSizePt: vi.fn(async () => ({ w: 1191, h: 842 })),
    renderPageCanvas: renderPageCanvas || vi.fn(async () => {
      const canvas = { width: 10, height: 7 };
      canvases.push(canvas);
      return canvas;
    }),
    canvasToRgba: vi.fn(canvas => ({
      data: new Uint8ClampedArray(canvas.width * canvas.height * 4), width: canvas.width, height: canvas.height,
    })),
    runJob: runJob || vi.fn(async type => (type === "pageSignature" ? new Uint8Array(1) : mapping)),
    onProgress: vi.fn(),
  };
  return { ...deps, canvases, mapping, controller: createPageMappingController(deps) };
}

test("renders every page at the signature scale and maps them in one Worker job", async () => {
  const { controller, state, renderPageCanvas, runJob, onProgress, canvases, mapping } = setup();
  await expect(controller.run()).resolves.toBe(mapping);
  expect(renderPageCanvas.mock.calls.map(([doc, index, scale]) => [doc, index, scale])).toEqual([
    [state.documents.oldDoc, 0, 1024 / 1191], [state.documents.oldDoc, 1, 1024 / 1191],
    [state.documents.newDoc, 0, 1024 / 1191], [state.documents.newDoc, 1, 1024 / 1191],
    [state.documents.newDoc, 2, 1024 / 1191],
  ]);
  const [type, payload, transfer] = runJob.mock.calls[0];
  expect(type).toBe("pageSignature");
  expect(payload.threshold).toBe(140);
  expect(transfer).toEqual([payload.data.buffer]);
  expect(canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true);
  expect(onProgress.mock.calls).toEqual([[1, 5], [2, 5], [3, 5], [4, 5], [5, 5]]);
  const [lastType, lastPayload] = runJob.mock.calls.at(-1);
  expect(lastType).toBe("pageMap");
  expect(lastPayload.oldMasks).toHaveLength(2);
  expect(lastPayload.newMasks).toHaveLength(3);
});

test("a failing page rejects with its side and page index", async () => {
  const renderPageCanvas = vi.fn(async (doc, index) => {
    if (doc.numPages === 3 && index === 1) throw new Error("broken page");
    return { width: 10, height: 7 };
  });
  const { controller } = setup({ renderPageCanvas });
  await expect(controller.run()).rejects.toMatchObject({ side: "new", pageIndex: 1 });
});

// Break: 差し替え後に古いPDFの対応付けを適用すると、新しいPDFの整列が壊れる。
test("a document generation change mid-run resolves null without mapping", async () => {
  const { controller, state, runJob } = setup();
  runJob.mockImplementation(async type => {
    state.documents.generation += 1;
    return type === "pageSignature" ? new Uint8Array(1) : {};
  });
  await expect(controller.run()).resolves.toBeNull();
  expect(runJob.mock.calls.some(([type]) => type === "pageMap")).toBe(false);
});

test("a failure caused by document replacement resolves null instead of reporting", async () => {
  const { controller, state, runJob } = setup();
  runJob.mockImplementation(async () => {
    state.documents.generation += 1;
    throw new Error("cancelled");
  });
  await expect(controller.run()).resolves.toBeNull();
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run tests/unit/page-mapping-controller.test.js`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: controller を実装する**

`src/features/documents/page-mapping-controller.js`:

```js
import { SIGNATURE_LONG_EDGE } from "../../core/page-mapping/page-mapping.js";

const SIDES = Object.freeze(["old", "new"]);

function pageFailure(side, pageIndex, cause) {
  const label = side === "old" ? "旧版" : "新版";
  return Object.assign(new Error(`${label} P${pageIndex + 1} の解析に失敗しました`), { side, pageIndex, cause });
}

export function createPageMappingController({
  state, pageSizePt, renderPageCanvas, canvasToRgba, runJob, onProgress = () => {},
}) {
  async function signature(doc, pageIndex) {
    const size = await pageSizePt(doc, pageIndex);
    const canvas = await renderPageCanvas(doc, pageIndex, SIGNATURE_LONG_EDGE / Math.max(size.w, size.h));
    const { data, width, height } = canvasToRgba(canvas);
    canvas.width = 0;
    canvas.height = 0;
    return runJob("pageSignature", { data, width, height, threshold: state.comparison.threshold }, [data.buffer]);
  }

  async function run() {
    const generation = state.documents.generation;
    const stale = () => state.documents.generation !== generation;
    const docs = { old: state.documents.oldDoc, new: state.documents.newDoc };
    const masks = { old: [], new: [] };
    const total = docs.old.numPages + docs.new.numPages;
    let done = 0;
    for (const side of SIDES) {
      for (let pageIndex = 0; pageIndex < docs[side].numPages; pageIndex += 1) {
        try {
          masks[side].push(await signature(docs[side], pageIndex));
        } catch (error) {
          if (stale()) return null;
          throw pageFailure(side, pageIndex, error);
        }
        if (stale()) return null;
        done += 1;
        onProgress(done, total);
      }
    }
    try {
      const result = await runJob("pageMap", { oldMasks: masks.old, newMasks: masks.new });
      return stale() ? null : result;
    } catch (error) {
      if (stale()) return null;
      throw error;
    }
  }

  return { run };
}
```

- [ ] **Step 4: Worker にジョブを追加する**

`src/workers/diff-worker.js` の import に追加する:

```js
import { mapPages, pageSignature } from "../core/page-mapping/page-mapping.js";
```

`HANDLERS` に追加する:

```js
  pageSignature: (id, payload) => {
    const mask = pageSignature(payload);
    return { result: mask, transfer: [mask.buffer] };
  },
  pageMap: (id, payload) => ({ result: mapPages(payload.oldMasks, payload.newMasks), transfer: [] }),
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `npx vitest run tests/unit/page-mapping-controller.test.js tests/unit/dependency-boundaries.test.js`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add src/workers/diff-worker.js src/features/documents/page-mapping-controller.js tests/unit/page-mapping-controller.test.js
git commit -m "feat: analyze every page for automatic page mapping off the main thread"
```

---

### Task 4: UI と app の配線（提案・適用・Undo）

**Files:**
- Modify: `index.html`（「ページ整列」欄、ヘッダー日付）
- Modify: `src/styles/controls.css:76-83`
- Modify: `src/app/dom.js:1-2`（`REQUIRED_IDS`）
- Modify: `src/app/bind-controls.js:150-152`
- Modify: `src/app/create-app.js`
- Modify: `tests/unit/bind-controls.test.js`（2か所の `names`）
- Modify: `tests/integration/create-app.test.js`
- Modify: `tests/unit/documentation.test.js:40,53`（日付）

**Interfaces:**
- Consumes: Task 1 の `describeMapping`、Task 3 の `createPageMappingController`、Worker ジョブ名
- Produces: `appController.autoMapPages()`、DOM id `alignAuto` / `pageMapNotice`、CSS クラス `suggest`、`alignmentOps` の要素 `{ kind: "auto", oldSequence, newSequence }`

- [ ] **Step 1: 失敗する integration テストを書く**

`tests/integration/create-app.test.js`:

1. 先頭の `ids` 配列の `"alignAddNew",` の前に `"alignAuto",` を加え、`"zoomLabel", "zoomOut", "minimap", "minimapCanvas",` の後に `"pageMapNotice",` を加える。
2. `fakeDependencies` の返り値に次を加える:

```js
    createPageMappingController: vi.fn(() => ({ run: vi.fn(async () => null) })),
```

3. ファイル末尾に追加する:

```js
function pageMappingApp({ run, confirm = () => true } = {}) {
  const document = fakeDocument();
  const toggles = [];
  document.getElementById("alignAuto").classList = { toggle: (name, on) => toggles.push([name, on]) };
  const dependencies = fakeDependencies({
    bindControls: vi.fn(),
    createPageMappingController: vi.fn(() => ({ run })),
    createBoxEditorController: vi.fn(() => ({
      confirmDiscard: confirm, syncInvalidated() {}, cancelDrag() {}, startEdit: () => true,
      stopEditing() {}, deleteById: () => true, draw() {},
    })),
  });
  const window = { confirm: () => true, console: { error: vi.fn() }, getComputedStyle: () => ({ getPropertyValue: () => "#000" }) };
  const app = createApp({ document, window, dependencies });
  Object.assign(app.state.documents, {
    oldDoc: { numPages: 3 }, newDoc: { numPages: 4 }, pages: 4,
    oldSequence: [0, 1, 2], newSequence: [0, 1, 2, 3], alignmentOps: [],
  });
  const { appController } = dependencies.bindControls.mock.calls[0][0];
  const { onReady } = dependencies.createDocumentController.mock.calls[0][0];
  return { app, appController, onReady, document, toggles, window, dependencies };
}

const inserted = { oldSequence: [0, 1, null, 2], newSequence: [0, 1, 2, 3], similarity: [1, 1, null, 0.62] };

test("loading documents with different page counts suggests automatic page mapping", () => {
  const { onReady, document, toggles } = pageMappingApp({ run: vi.fn() });
  onReady();
  expect(document.getElementById("pageMapNotice").textContent)
    .toBe("ページ数が異なります（旧 3／新 4）。自動でページ整列できます");
  expect(toggles.at(-1)).toEqual(["suggest", true]);
  expect(document.getElementById("alignAuto").disabled).toBe(false);
});

test("automatic page mapping applies before rendering and one undo restores the previous order", async () => {
  const { app, appController, document, toggles } = pageMappingApp({ run: vi.fn(async () => inserted) });
  await appController.autoMapPages();
  expect(app.state.documents.oldSequence).toEqual([0, 1, null, 2]);
  expect(app.state.documents.pages).toBe(4);
  expect(app.state.documents.alignmentOps).toEqual([
    { kind: "auto", oldSequence: [0, 1, 2], newSequence: [0, 1, 2, 3] },
  ]);
  expect(document.getElementById("pageMapNotice").textContent)
    .toBe("新 P3 を追加と判定。類似度が低い対応：スロット 4（62%）");
  expect(toggles.at(-1)).toEqual(["suggest", false]);
  expect(document.getElementById("alignUndo").disabled).toBe(false);

  await appController.undoAlignment();
  expect(app.state.documents.oldSequence).toEqual([0, 1, 2]);
  expect(app.state.documents.newSequence).toEqual([0, 1, 2, 3]);
  expect(app.state.documents.alignmentOps).toEqual([]);
});

// Break: 自動整列の後の手動整列を Undo すると、自動整列の結果まで巻き戻る。
test("manual alignment after auto mapping undoes one layer at a time", async () => {
  const { app, appController } = pageMappingApp({ run: vi.fn(async () => inserted) });
  await appController.autoMapPages();
  app.state.documents.newSequence.splice(1, 0, null);
  app.state.documents.alignmentOps.push({ side: "new", slot: 1 });
  await appController.undoAlignment();
  expect(app.state.documents.newSequence).toEqual([0, 1, 2, 3]);
  expect(app.state.documents.oldSequence).toEqual([0, 1, null, 2]);
  await appController.undoAlignment();
  expect(app.state.documents.oldSequence).toEqual([0, 1, 2]);
});

test("a mapping equal to the current order records nothing", async () => {
  const run = vi.fn(async () => ({ oldSequence: [0, 1, 2], newSequence: [0, 1, 2, 3], similarity: [] }));
  const { app, appController, document } = pageMappingApp({ run });
  await appController.autoMapPages();
  expect(app.state.documents.alignmentOps).toEqual([]);
  expect(document.getElementById("pageMapNotice").textContent).toBe("変更はありませんでした");
});

test("declining to discard edited boxes leaves the order and history unchanged", async () => {
  const { app, appController } = pageMappingApp({ run: vi.fn(async () => inserted), confirm: () => false });
  await appController.autoMapPages();
  expect(app.state.documents.oldSequence).toEqual([0, 1, 2]);
  expect(app.state.documents.alignmentOps).toEqual([]);
});

test("a page failure aborts without changing the order", async () => {
  const failure = Object.assign(new Error("broken"), { side: "new", pageIndex: 6 });
  const { app, appController, document, window } = pageMappingApp({ run: vi.fn(async () => { throw failure; }) });
  await appController.autoMapPages();
  expect(app.state.documents.oldSequence).toEqual([0, 1, 2]);
  expect(document.getElementById("pageMapNotice").textContent)
    .toBe("新版 P7 の解析に失敗したため自動整列を中止しました");
  expect(window.console.error).toHaveBeenCalled();
  expect(document.getElementById("alignAuto").disabled).toBe(false);
});

test("a stale mapping result is discarded silently", async () => {
  const { app, appController } = pageMappingApp({ run: vi.fn(async () => null) });
  await appController.autoMapPages();
  expect(app.state.documents.oldSequence).toEqual([0, 1, 2]);
  expect(app.state.documents.alignmentOps).toEqual([]);
});
```

`tests/unit/bind-controls.test.js` の2つの `names` 配列で `"run", "alignAddNew",` を `"run", "alignAuto", "alignAddNew",` に変え、1つ目のテスト（`binds controls once and delegates…`）の `dom.modeDiff.emit("click");` の直前に追加する:

```js
  dom.alignAuto.emit("click");
  expect(appController.autoMapPages).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run tests/integration/create-app.test.js tests/unit/bind-controls.test.js`
Expected: FAIL（`autoMapPages` 未定義、`alignAuto` 未バインド）

- [ ] **Step 3: マークアップと CSS**

`index.html` の「ページ整列」欄の `<div class="alignpad">` の直後に追加する:

```html
          <button id="alignAuto" class="full" disabled title="全ページの類似度から新旧ページの対応を求め、空白を挿入して整列">自動でページ整列</button>
          <span id="pageMapNotice" class="full pagemap-notice" role="status"></span>
```

`src/styles/controls.css` の `.alignpad .full{grid-column:1 / -1}` の次の行に追加する:

```css
  .alignpad button.suggest{border-color:var(--signal);color:var(--signal)}
  .pagemap-notice{font-size:10px;color:var(--muted);line-height:1.4}
  .pagemap-notice:empty{display:none}
```

`src/app/dom.js` の `REQUIRED_IDS` の先頭行を `"alignAddNew", "alignAuto", "alignDelOld", "alignReadout", "alignUndo", "autoAlign",` にし、`"minimap", "minimapCanvas",` の行を `"minimap", "minimapCanvas", "pageMapNotice",` にする。

`src/app/bind-controls.js` の `listen(dom.alignAddNew, …)` の前に追加する:

```js
  listen(dom.alignAuto, "click", () => appController.autoMapPages());
```

- [ ] **Step 4: create-app を配線する**

`src/app/create-app.js` を次のように変更する。

(a) import に追加する（`createDocumentController` の import の次）:

```js
import { createPageMappingController } from "../features/documents/page-mapping-controller.js";
import { describeMapping } from "../core/page-mapping/page-mapping.js";
```

(b) `DEFAULT_DEPENDENCIES` の `createDocumentController,` の次に `createPageMappingController,` を加える。

(c) `withMaximumDpi` の後にモジュールレベル関数を加える:

```js
const sameSequence = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
```

(d) `createApp` 冒頭の `let backgroundResumeTimer = null;` の次に加える（`onReady` が構築中に呼ばれるので、TDZ を避けるためここで宣言する）:

```js
  let pageMapRunning = false;
```

(e) `updateAlignButtons` を置き換え、直後に表示関数を加える:

```js
  function updateAlignButtons() {
    const loaded = Boolean(state.documents.oldDoc && state.documents.newDoc);
    const on = loaded && state.visual.rendered && !pageMapRunning;
    dom.alignAuto.disabled = !loaded || pageMapRunning;
    dom.alignAddNew.disabled = !on;
    dom.alignDelOld.disabled = !on;
    dom.alignUndo.disabled = !loaded || pageMapRunning || state.documents.alignmentOps.length === 0;
  }

  function showPageMapNotice(text, { suggest = false } = {}) {
    dom.pageMapNotice.textContent = text;
    dom.alignAuto.classList.toggle("suggest", suggest);
  }
```

(f) `const indexLane = …` の次に加える:

```js
  const pageMapLane = deps.createWorkerLane({ createWorker: deps.createDiffWorker });
  const pageMappingController = deps.createPageMappingController({
    state,
    pageSizePt: deps.pageSizePt,
    renderPageCanvas: deps.renderPageCanvas,
    canvasToRgba: deps.canvasToRgba,
    runJob: (type, payload, transfer) => pageMapLane.run(type, payload, { transfer }),
    onProgress: (done, total) => showPageMapNotice(`ページを解析中… ${done}/${total}`),
  });
```

(g) `createDocumentController` に渡す `onReady` と `onLoadAccepted` を置き換える:

```js
    onReady() {
      boxEditorController?.syncInvalidated?.();
      reviewView.render({ preserveCommentFocus: true });
      updateAlignButtons();
      const { oldDoc, newDoc } = state.documents;
      if (oldDoc && newDoc && oldDoc.numPages !== newDoc.numPages) {
        showPageMapNotice(
          `ページ数が異なります（旧 ${oldDoc.numPages}／新 ${newDoc.numPages}）。自動でページ整列できます`,
          { suggest: true },
        );
      }
    },
    onLoadAccepted: ({ documentGeneration }) => {
      reviewController.cancelIndex();
      pageMapLane.cancel();
      showPageMapNotice("");
      textController?.invalidateDocuments?.(documentGeneration);
      exportController?.invalidateDocuments?.(documentGeneration);
    },
```

(h) `syncInvalidatedBoxEditor` の定義の後に、整列変更後の再計算をまとめる関数を加える:

```js
  async function refreshPageAlignment() {
    if (!state.visual.rendered) {
      reviewController.cancelIndex();
      deps.invalidatePageAlignment(state);
      state.documents.pages = Math.max(
        state.documents.oldSequence.length,
        state.documents.newSequence.length,
      );
      state.documents.currentPage = 0;
      updateAlignButtons();
      return;
    }
    await visualController.refreshAfterAlign({
      invalidatePageAlignment: state => {
        reviewController.cancelIndex();
        deps.invalidatePageAlignment(state);
      },
      syncInvalidatedBoxEditor,
    });
  }
```

(i) `appController` の `alignAddNew` / `alignDeleteOld` / `undoAlignment` を置き換え、`autoMapPages` を加える:

```js
    async autoMapPages() {
      if (pageMapRunning || !state.documents.oldDoc || !state.documents.newDoc) return;
      pageMapRunning = true;
      updateAlignButtons();
      showPageMapNotice("ページを解析中…");
      let result;
      try {
        result = await pageMappingController.run();
      } catch (error) {
        window.console.error("自動ページ整列", error);
        showPageMapNotice(error?.pageIndex == null
          ? "自動整列に失敗しました"
          : `${error.side === "old" ? "旧版" : "新版"} P${error.pageIndex + 1} の解析に失敗したため自動整列を中止しました`);
        return;
      } finally {
        pageMapRunning = false;
        updateAlignButtons();
      }
      if (!result) return;
      const { oldSequence, newSequence } = state.documents;
      if (sameSequence(result.oldSequence, oldSequence) && sameSequence(result.newSequence, newSequence)) {
        showPageMapNotice("変更はありませんでした");
        return;
      }
      if (!confirmDiscardBoxEdits()) {
        showPageMapNotice("");
        return;
      }
      state.documents.alignmentOps.push({
        kind: "auto", oldSequence: [...oldSequence], newSequence: [...newSequence],
      });
      state.documents.oldSequence = [...result.oldSequence];
      state.documents.newSequence = [...result.newSequence];
      showPageMapNotice(describeMapping(result));
      await refreshPageAlignment();
    },
    async alignAddNew() {
      if (!state.visual.rendered || !confirmDiscardBoxEdits()) return;
      state.documents.oldSequence.splice(state.documents.currentPage, 0, null);
      state.documents.alignmentOps.push({ side: "old", slot: state.documents.currentPage });
      await refreshPageAlignment();
    },
    async alignDeleteOld() {
      if (!state.visual.rendered || !confirmDiscardBoxEdits()) return;
      state.documents.newSequence.splice(state.documents.currentPage, 0, null);
      state.documents.alignmentOps.push({ side: "new", slot: state.documents.currentPage });
      await refreshPageAlignment();
    },
    async undoAlignment() {
      const operation = state.documents.alignmentOps[state.documents.alignmentOps.length - 1];
      if (!operation || pageMapRunning || !confirmDiscardBoxEdits()) return;
      state.documents.alignmentOps.pop();
      if (operation.kind === "auto") {
        state.documents.oldSequence = operation.oldSequence;
        state.documents.newSequence = operation.newSequence;
      } else {
        const sequence = operation.side === "old"
          ? state.documents.oldSequence
          : state.documents.newSequence;
        if (sequence[operation.slot] === null) sequence.splice(operation.slot, 1);
      }
      showPageMapNotice("");
      await refreshPageAlignment();
    },
```

- [ ] **Step 5: ヘッダー日付を更新する**

`index.html` の `UPDATED 2026-09-25` を `UPDATED 2026-09-26` にする。`tests/unit/documentation.test.js` の2か所の `"UPDATED 2026-09-25"` も `"UPDATED 2026-09-26"` にする。

- [ ] **Step 6: 全 unit / integration テストを通す**

Run: `npm run test`
Expected: PASS（全件）。既存テストが `alignUndo` の無効条件の変更で落ちた場合は、新しい条件（読み込み済み・非実行中・操作あり）に合わせて期待値を直す。

- [ ] **Step 7: コミット**

```bash
git add index.html src/styles/controls.css src/app/dom.js src/app/bind-controls.js src/app/create-app.js tests/unit/bind-controls.test.js tests/integration/create-app.test.js tests/unit/documentation.test.js
git commit -m "feat: suggest and apply automatic page mapping with one-step undo"
```

---

### Task 5: 操作フロー e2e・スナップショット・README

**Files:**
- Modify: `tests/e2e/page-mapping.spec.js`
- Modify: `tests/e2e/baseline.spec.js-snapshots/empty-state-{chromium,firefox,webkit}-win32.png`
- Modify: `README.md:48`

**Interfaces:**
- Consumes: Task 2 のフィクスチャ、Task 4 の `#alignAuto` / `#pageMapNotice` / `#run` / `#pageLabel`

- [ ] **Step 1: 操作フロー e2e を追加する**

`tests/e2e/page-mapping.spec.js` の末尾に追加する:

```js
test("suggests, applies and undoes automatic page mapping", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles("#fileOld", join(fixtures, "sheets-old.pdf"));
  await page.setInputFiles("#fileNew", join(fixtures, "sheets-new.pdf"));
  await expect(page.locator("#pageMapNotice"))
    .toHaveText("ページ数が異なります（旧 5／新 6）。自動でページ整列できます");
  await expect(page.locator("#alignAuto")).toHaveClass(/suggest/);

  await page.locator("#alignAuto").click();
  await expect(page.locator("#pageMapNotice")).toContainText("新 P3 を追加と判定", { timeout: 60_000 });
  await expect(page.locator("#pageMapNotice")).not.toContainText("削除");

  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText(/差分を表示中|差分がない/);
  await expect(page.locator("#pageLabel")).toContainText("1 / 6");

  await page.locator("#alignUndo").click();
  await expect(page.locator("#pageLabel")).toContainText("1 / 6");
  await expect(page.locator("#alignUndo")).toBeDisabled();
});
```

（Undo 後も旧5／新6ページなので、スロット数は6のまま。ずれた並びに戻り、Undo 履歴が空になって「↩ 取り消す」が無効になることを確かめている。）

- [ ] **Step 2: e2e を実行する**

Run: `npm run test:e2e -- tests/e2e/page-mapping.spec.js`
Expected: 3ブラウザで PASS

- [ ] **Step 3: ベースラインスナップショットを更新する**

Run: `npx playwright test tests/e2e/baseline.spec.js --update-snapshots`
Expected: `empty-state-*.png` の3枚が更新される。更新した画像を開き、「ページ整列」欄の先頭に無効状態の「自動でページ整列」ボタンが増えただけであることを目視で確認する。

- [ ] **Step 4: README を更新する**

`README.md` の「ページ整列」の行（48行目）を次に置き換える:

```markdown
- **ページ整列**：改訂でページが追加・削除されて番号がずれた場合、片側に空白ページを挿入して以降を再整列（1手ずつ取り消し可／PDFを読み込み直すとリセット）
  - 「自動でページ整列」で全ページの類似度（インクの重なり、90°単位の回転も考慮）から追加・削除されたページを判定し、まとめて整列する。旧版と新版のページ数が違うときは読み込み時に提案する
  - 結果は「旧 P3 を削除、新 P4 を追加と判定」のように要約し、類似度が低い対応も示す。「↩ 取り消す」1回で適用前に戻せる。ページ順の入れ替えは扱わず、削除＋追加として表示される
```

- [ ] **Step 5: 全テストを通す**

Run: `npm run test && npm run test:e2e && npm run build`
Expected: すべて PASS。build の `postbuild` 検証も通る。

- [ ] **Step 6: コミット**

```bash
git add tests/e2e/page-mapping.spec.js tests/e2e/baseline.spec.js-snapshots README.md
git commit -m "test: cover the automatic page mapping flow end to end"
```
