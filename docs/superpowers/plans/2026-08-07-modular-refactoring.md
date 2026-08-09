# PDF差分レビューア モジュール分割 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 現行の画面、操作、計算結果、出力結果を変えずに、約3,348行の単一HTMLアプリを責務別のES Modulesへ分割し、自動テストと再現可能な静的ビルドを導入する。

**Architecture:** `main → app → features → core` の一方向依存にし、ブラウザ固有処理は `platform` へ隔離する。移行中も各コミットで動作可能な状態を維持し、最初に現行動作の特性テストを固定してから、純粋ロジック、PDF基盤、状態管理、画面機能の順に抽出する。

**Tech Stack:** Vanilla JavaScript、ES Modules、Vite 8.2.1、Vitest 4.1.10、Playwright 1.62.1、pdfjs-dist 3.11.174、jsPDF 2.5.1、diff-match-patch 1.0.5、vite-plugin-static-copy 4.1.1、Node.js 22.12以降の22系、npm。

## Global Constraints

- 正式設計は `docs/superpowers/specs/2026-08-07-modular-refactoring-design.md` とする。
- 利用者向けの画面、文言、色、操作、計算結果、出力結果を意図して変更しない。
- PDFファイル、差分結果、ログを外部へ送信しない。
- 本番環境はバックエンドを持たない静的サイトのままとする。
- 削除は赤 `#FF5B57`、追加は青 `#4D8DFF`、共通部分はグレー `#3C3C3C`、変更枠は `#FF9500` を維持する。
- DPIは72から300、既定150、インクしきい値は40から220、既定128を維持する。
- 表示はCSS `transform`、PNG/PDF出力はCanvas実データを使う分離を維持する。
- JavaScriptのまま移行し、TypeScript、React、Vue、状態管理ライブラリを導入しない。
- Web Worker化、OffscreenCanvas化、WebGL化、カラー差分、注釈機能を含めない。
- WindowsではPowerShell実行ポリシーを回避するため `npm` ではなく `npm.cmd` を使う。
- `package.json` の依存バージョンはすべて完全一致とし、`package-lock.json` をコミットする。
- `index.html` を変更するコミットでは、ヘッダーの更新日を実施日へ更新する。
- コード全体を一括フォーマットせず、抽出対象以外の行を整形しない。
- 各タスクの最後に `npm.cmd run test`、`npm.cmd run test:e2e`、`npm.cmd run build` を実行する。
- 実装開始前に現在の `.gitignore` の未コミット変更を確認し、`AGENTS.md` と `.playwright-mcp/` の追加を失わないようにする。
- 既存の利用者変更を同じコミットへ含めない。`.gitignore` の既存変更をコミットする場合は、実装開始前に利用者の承認を得る。

---

## Target File Map

| Path | Responsibility |
|---|---|
| `index.html` | DOM構造と `/src/main.js` の読込だけを保持する |
| `src/main.js` | CSS読込と `createApp()` の呼出しを行うcomposition root |
| `src/app/create-app.js` | 状態、DOM参照、各controllerを組み立てる |
| `src/app/state.js` | 状態の初期値とJSDoc型を定義する |
| `src/app/dom.js` | 必須DOM要素を一度だけ収集する |
| `src/app/invalidation.js` | 比較条件ごとのキャッシュ無効化を定義する |
| `src/app/error-reporter.js` | 利用者向けエラー表示と予期しない例外のconsole出力を集約する |
| `src/app/bind-controls.js` | DOMイベントを所有controllerの公開操作へ接続する |
| `src/core/geometry/rectangles.js` | 矩形の正規化とクランプを行う |
| `src/core/image-diff/luminance.js` | 輝度とインク判定を行う |
| `src/core/image-diff/masks.js` | マスク膨張と許容差付き差分を行う |
| `src/core/change-boxes/detect.js` | 差分ブロックから変更枠を検出する |
| `src/core/alignment/fft.js` | FFT、窓関数、双一次補間を提供する |
| `src/core/alignment/similarity.js` | Fourier-Mellin相似変換推定を行う |
| `src/core/alignment/quadrant.js` | 90度単位の回転推定を行う |
| `src/core/text-diff/tokens.js` | PDFテキスト片から行とトークンを構成する |
| `src/core/text-diff/xy-cut.js` | 多段組みの読み順を復元する |
| `src/core/text-diff/highlights.js` | 行差分と文字差分からハイライト記述を作る |
| `src/core/text-diff/tables.js` | 表領域を検出しセル単位の差分を適用する |
| `src/core/legend/layout.js` | 文字幅関数から凡例の幾何を計算する |
| `src/features/documents/document-controller.js` | 新旧PDFの読込と文書世代の更新を行う |
| `src/features/documents/page-renderer.js` | PDFページをCanvasへ描画する |
| `src/features/documents/page-layout.js` | 用紙サイズ正規化とページ対応を扱う |
| `src/features/visual-diff/visual-controller.js` | ビジュアル描画要求とstale結果の破棄を管理する |
| `src/features/visual-diff/visual-renderer.js` | 差分画像を生成して表示Canvasへ反映する |
| `src/features/visual-diff/toggle-renderer.js` | 新旧切替用Canvasを生成する |
| `src/features/viewer/viewport.js` | ズーム、パン、フィットの純粋な座標計算を行う |
| `src/features/viewer/viewer-controller.js` | ビジュアルビューアのDOMイベントを接続する |
| `src/features/box-editor/box-history.js` | ページ別Undo履歴を管理する |
| `src/features/box-editor/box-editor-controller.js` | 変更枠の選択、追加、移動、リサイズ、削除を管理する |
| `src/features/box-editor/box-editor-view.js` | 画面用オーバーレイCanvasへ変更枠を描く |
| `src/features/text-review/text-controller.js` | 抽出、差分、ページング、stale結果の破棄を管理する |
| `src/features/text-review/text-renderer.js` | PDFページとテキストハイライトをCanvasへ描く |
| `src/features/export/image-composer.js` | 差分画像、変更枠、凡例、テキスト旧新版を合成する |
| `src/features/export/pdf-exporter.js` | jsPDFへページ画像を追加して保存する |
| `src/features/export/export-controller.js` | PNG/PDF出力を画面状態から分離して実行する |
| `src/platform/pdfjs.js` | pdf.js、Worker、CMap、標準フォントURLを設定する |
| `src/platform/canvas.js` | Canvas生成と白背景初期化を提供する |
| `src/platform/download.js` | Blobとファイル名からブラウザダウンロードを開始する |
| `src/styles/*.css` | 現行CSSを責務別にそのまま保持する |
| `tests/fixtures/generate-fixtures.mjs` | 小さな新旧PDFを決定的に生成する |
| `tests/unit/` | core、state、invalidationのVitestを置く |
| `tests/integration/` | controllerと偽platformを組み合わせたVitestを置く |
| `tests/e2e/` | 実ブラウザによる主要操作のPlaywrightテストを置く |

## Shared Interfaces

後続タスクは次の名前と形を変更しない。

```js
/** @typedef {{x:number, y:number, w:number, h:number}} Box */
/** @typedef {{width:number, height:number, data:ImageData|null}} ImageFrame */
/** @typedef {{id:number, documentGeneration:number, pageIndex:number}} RenderTicket */
/** @typedef {{str:string, width:number, transform:number[], off:number}} TextToken */
/** @typedef {{text:string, tokens:TextToken[]}} TextLine */
/** @typedef {{old:Map<number, Array<{token:TextToken,color:string}>>, new:Map<number, Array<{token:TextToken,color:string}>>}} HighlightMap */

/**
 * @typedef {Object} ComparisonSnapshot
 * @property {RenderTicket} ticket
 * @property {number} dpi
 * @property {number} threshold
 * @property {number} tolerancePx
 * @property {number} dx
 * @property {number} dy
 * @property {number} manualAngle
 * @property {number} manualScale
 * @property {boolean} autoAlign
 */
```

---

### Task 1: Viteと回帰テストの土台

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `vite.config.js`
- Create: `vitest.config.js`
- Create: `playwright.config.js`
- Create: `tests/fixtures/generate-fixtures.mjs`
- Create: `tests/e2e/baseline.spec.js`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: 現行 `index.html` のDOM識別子 `fileOld`、`fileNew`、`run`、`out`、`status`、`pageLabel`。
- Produces: `npm.cmd run dev|test|test:e2e|build|preview` と `tests/fixtures/old.pdf`、`tests/fixtures/new.pdf`。

- [ ] **Step 1: 作業ツリーとNode.jsを確認する**

Run:

```powershell
git status --short
git diff -- .gitignore
node --version
npm.cmd --version
```

Expected: Node.jsは `v22.12.0` 以上かつ23未満。`.gitignore` に利用者変更が残っている場合は、その変更を破棄せず、承認されるまで同ファイルのコミットを保留する。

- [ ] **Step 2: 依存関係を完全一致で導入する**

Run:

```powershell
npm.cmd init -y
npm.cmd install --save-exact pdfjs-dist@3.11.174 jspdf@2.5.1 diff-match-patch@1.0.5
npm.cmd install --save-dev --save-exact vite@8.2.1 vitest@4.1.10 @playwright/test@1.62.1 vite-plugin-static-copy@4.1.1
```

Edit `package.json` so the relevant fields are exactly:

```json
{
  "type": "module",
  "engines": { "node": ">=22.12 <23" },
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "build": "vite build",
    "preview": "vite preview --host 127.0.0.1",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "node tests/fixtures/generate-fixtures.mjs && playwright test"
  }
}
```

- [ ] **Step 3: ViteとVitestの最小設定を書く**

Create `vite.config.js`:

```js
import { defineConfig } from "vite";

export default defineConfig({
  build: { outDir: "dist", emptyOutDir: true },
});
```

Create `vitest.config.js`:

```js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.js", "tests/integration/**/*.test.js"],
    passWithNoTests: true,
  },
});
```

- [ ] **Step 4: Playwright設定を書く**

Create `playwright.config.js`:

```js
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results",
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
  webServer: {
    command: "npm.cmd run dev -- --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
```

- [ ] **Step 5: 決定的なテストPDF生成器を書く**

Create `tests/fixtures/generate-fixtures.mjs`:

```js
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { jsPDF } from "jspdf";

const dir = dirname(fileURLToPath(import.meta.url));
await mkdir(dir, { recursive: true });

function makePdf(kind) {
  const pdf = new jsPDF({ unit: "pt", format: "a4", compress: true });
  pdf.setCreationDate(new Date("2020-01-01T00:00:00.000Z"));
  pdf.setFileId(kind === "old" ? "00000000000000000000000000000001" : "00000000000000000000000000000002");
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(16);
  pdf.text("PDF DIFF FIXTURE", 48, 48);
  pdf.rect(72, 90, 180, 80);
  pdf.text(kind === "old" ? "REV A" : "REV B", 90, 130);
  if (kind === "old") pdf.line(72, 210, 252, 210);
  else pdf.circle(162, 210, 24);
  pdf.addPage("a4", "portrait");
  pdf.text(kind === "old" ? "UNCHANGED PAGE" : "UNCHANGED PAGE", 48, 48);
  return Buffer.from(pdf.output("arraybuffer"));
}

await writeFile(join(dir, "old.pdf"), makePdf("old"));
await writeFile(join(dir, "new.pdf"), makePdf("new"));
```

- [ ] **Step 6: 現行動作のPlaywrightテストを書く**

Create `tests/e2e/baseline.spec.js`:

```js
import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

test("loads two PDFs and renders the current visual diff", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles("#fileOld", join(fixtures, "old.pdf"));
  await page.setInputFiles("#fileNew", join(fixtures, "new.pdf"));
  await expect(page.locator("#run")).toBeEnabled();
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText(/差分を表示中|差分なし/);
  await expect(page.locator("#out")).toBeVisible();
  await expect(page.locator("#pageLabel")).toContainText("1 / 2");
  const canvas = await page.locator("#out").evaluate((node) => ({
    width: node.width,
    height: node.height,
  }));
  expect(canvas).toEqual({ width: 1241, height: 1754 });
});

test("preserves the empty-state appearance", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveScreenshot("empty-state.png", { maxDiffPixelRatio: 0.005 });
});
```

- [ ] **Step 7: テストが現行アプリに対して通ることを確認する**

Run:

```powershell
npm.cmd run test
npm.cmd run test:e2e -- --update-snapshots
npm.cmd run test:e2e
npm.cmd run build
```

Expected: Vitestはテスト0件で成功、Playwrightは2件成功、`dist/index.html` が生成される。CDN依存はこのタスクでは維持する。

- [ ] **Step 8: 生成物をignoreし、タスクをコミットする**

Add these entries without deleting the existing ignore rules:

```gitignore
node_modules/
dist/
coverage/
test-results/
playwright-report/
tests/fixtures/old.pdf
tests/fixtures/new.pdf
```

Run:

```powershell
git add package.json package-lock.json vite.config.js vitest.config.js playwright.config.js tests/fixtures/generate-fixtures.mjs tests/e2e/baseline.spec.js tests/e2e/baseline.spec.js-snapshots
git add .gitignore
git diff --cached --check
git commit -m "test: establish refactoring baseline"
```

Expected: コミット対象は基盤、テスト、承認済みの `.gitignore` 変更だけ。

---

### Task 2: インラインCSSとJavaScriptの外出し

**Files:**
- Create: `src/main.js`
- Create: `src/legacy-app.js`
- Create: `src/styles/base.css`
- Create: `src/styles/layout.css`
- Create: `src/styles/controls.css`
- Create: `src/styles/viewer.css`
- Modify: `index.html`
- Create: `tests/unit/source-structure.test.js`

**Interfaces:**
- Consumes: Task 1のViteエントリーポイントと現行 `index.html`。
- Produces: `/src/main.js` を唯一のアプリケーションscriptとし、既存関数を同じ順序で保持する `src/legacy-app.js`。

- [ ] **Step 1: 構造テストを先に書く**

Create `tests/unit/source-structure.test.js`:

```js
import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

describe("source structure", () => {
  test("index.html delegates styling and behavior to src/main.js", async () => {
    const html = await readFile("index.html", "utf8");
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/<script>(?:.|\n)*<\/script>/i);
    expect(html).toContain('<script type="module" src="/src/main.js"></script>');
    expect(html).toContain('href="/favicon.png"');
  });
});
```

- [ ] **Step 2: テストが現状で失敗することを確認する**

Run:

```powershell
npm.cmd run test -- tests/unit/source-structure.test.js
```

Expected: `<style>` とインライン `<script>` が残っているためFAIL。

- [ ] **Step 3: CSSを既存コメント境界で移す**

Move selectors without changing declarations:

```text
base.css     : :root, *, html, body, typography, generic colors
layout.css   : header, main, aside, footer, responsive layout
controls.css : fields, buttons, sliders, pager, viewbar, status
viewer.css   : canvas-wrap, canvas, boxLayer, text-panel, text panes
```

Create `src/main.js`:

```js
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/controls.css";
import "./styles/viewer.css";
import "./legacy-app.js";
```

- [ ] **Step 4: インラインJavaScriptをそのまま移す**

Move the contents of the final `<script>` block to `src/legacy-app.js` without renaming functions or changing execution order.
Keep the CDN `<script src>` elements in `index.html` for this task.

Replace the removed style and application script with:

```html
<link rel="icon" type="image/png" href="/favicon.png">
<script type="module" src="/src/main.js"></script>
```

Change both embedded logo references to `/favicon.png` and set the header date to the implementation date.

- [ ] **Step 5: 構造テストと回帰テストを実行する**

Run:

```powershell
npm.cmd run test
npm.cmd run test:e2e
npm.cmd run build
```

Expected: 構造テストとPlaywright 2件が成功し、空画面スクリーンショット差分が許容値内。

- [ ] **Step 6: コミットする**

Run:

```powershell
git add index.html src tests/unit/source-structure.test.js
git diff --cached --check
git commit -m "refactor: extract inline assets from index"
```

---

### Task 3: 画像差分と変更枠の純粋ロジック

**Files:**
- Create: `src/core/geometry/rectangles.js`
- Create: `src/core/image-diff/luminance.js`
- Create: `src/core/image-diff/masks.js`
- Create: `src/core/change-boxes/detect.js`
- Create: `tests/unit/rectangles.test.js`
- Create: `tests/unit/image-masks.test.js`
- Create: `tests/unit/change-boxes.test.js`
- Modify: `src/legacy-app.js`

**Interfaces:**
- Produces: `normalizeRect(x0,y0,x1,y1)`, `clampBox(box,width,height)`, `clampBoxes(boxes,width,height)`, `luminanceAt(data,index)`, `isInk(data,index,threshold)`, `dilateMask(mask,width,height,radius)`, `toleratedDiffMasks(oldMask,newMask,width,height,radius)`, `computeBoxes(flags,cols,rows,block,minBlocks)`。

- [ ] **Step 1: 矩形とマスクの失敗テストを書く**

Create `tests/unit/rectangles.test.js`:

```js
import { expect, test } from "vitest";
import { normalizeRect, clampBox } from "../../src/core/geometry/rectangles.js";

test("normalizes reverse drag and clamps it to the canvas", () => {
  expect(normalizeRect(30, 20, 10, 5)).toEqual({ x: 10, y: 5, w: 20, h: 15 });
  expect(clampBox({ x: -4, y: 8, w: 20, h: 20 }, 12, 16))
    .toEqual({ x: 0, y: 8, w: 12, h: 8 });
});
```

Create `tests/unit/image-masks.test.js`:

```js
import { expect, test } from "vitest";
import { dilateMask, toleratedDiffMasks } from "../../src/core/image-diff/masks.js";

test("treats a one-pixel shift as equal inside radius one", () => {
  const oldMask = Uint8Array.from([0, 1, 0, 0, 0]);
  const newMask = Uint8Array.from([0, 0, 1, 0, 0]);
  expect([...dilateMask(oldMask, 5, 1, 1)]).toEqual([1, 1, 1, 0, 0]);
  const diff = toleratedDiffMasks(oldMask, newMask, 5, 1, 1);
  expect([...diff.removed]).toEqual([0, 0, 0, 0, 0]);
  expect([...diff.added]).toEqual([0, 0, 0, 0, 0]);
});
```

Create `tests/unit/change-boxes.test.js`:

```js
import { expect, test } from "vitest";
import { computeBoxes } from "../../src/core/change-boxes/detect.js";

test("groups adjacent changed blocks and filters single-block noise", () => {
  const flags = Uint8Array.from([
    1, 1, 0, 0, 0, 0,
    0, 1, 0, 0, 0, 1,
    0, 0, 0, 0, 0, 0,
  ]);
  expect(computeBoxes(flags, 6, 3, 10, 2)).toEqual([
    { x: 0, y: 0, w: 30, h: 30 },
  ]);
});
```

- [ ] **Step 2: テストがモジュール未作成で失敗することを確認する**

Run:

```powershell
npm.cmd run test -- tests/unit/rectangles.test.js tests/unit/image-masks.test.js tests/unit/change-boxes.test.js
```

Expected: import先が存在しないためFAIL。

- [ ] **Step 3: 現行関数を純粋モジュールへ移す**

Export mapping:

```js
// rectangles.js
export { normalizeRect, clampBox, clampBoxes };

// luminance.js
export function luminanceAt(data, index) {
  return data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
}
export const isInk = (data, index, threshold) => luminanceAt(data, index) < threshold;

// masks.js
export { dilateMask, toleratedDiffMasks };

// detect.js
export { computeBoxes };
```

Move `normRect`, `clampBox`, `clampBoxes`, `lum`, `dilateMask`, `toleratedDiffMasks`, `computeBoxes` from `legacy-app.js` and import them at the top.
Keep state-dependent wrappers `blockSize`, `toleranceRadiusPx`, `computeChangeBoxesAligned` in `legacy-app.js`.

- [ ] **Step 4: 単体テストと全回帰を実行する**

Run:

```powershell
npm.cmd run test
npm.cmd run test:e2e
npm.cmd run build
```

Expected: 全テスト成功。差分画素数、変更枠、画面表示はTask 1の基準から変化しない。

- [ ] **Step 5: コミットする**

```powershell
git add src/core src/legacy-app.js tests/unit
git diff --cached --check
git commit -m "refactor: extract image diff primitives"
```

---

### Task 4: 自動位置合わせコア

**Files:**
- Create: `src/core/alignment/fft.js`
- Create: `src/core/alignment/similarity.js`
- Create: `src/core/alignment/quadrant.js`
- Create: `tests/unit/alignment.test.js`
- Modify: `src/legacy-app.js`

**Interfaces:**
- Produces: `fft1d`, `fft2d`, `hannWindow`, `sampleBilinear`, `phaseCorrelate`, `estimateSimilarity`, `bestAlignment`, `rotateGray90`, `bestQuadrant`。

- [ ] **Step 1: 位相相関と回転の失敗テストを書く**

Create `tests/unit/alignment.test.js`:

```js
import { expect, test } from "vitest";
import { phaseCorrelate } from "../../src/core/alignment/similarity.js";
import { rotateGray90 } from "../../src/core/alignment/quadrant.js";

test("phase correlation returns the translation that moves new onto old", () => {
  const size = 8;
  const oldImage = new Float64Array(size * size);
  const newImage = new Float64Array(size * size);
  oldImage[3 * size + 2] = 255;
  newImage[2 * size + 4] = 255;
  const result = phaseCorrelate(oldImage, newImage, size);
  expect(result.dx).toBe(-2);
  expect(result.dy).toBe(1);
});

test("rotates a rectangular grayscale image clockwise", () => {
  const result = rotateGray90(Float64Array.from([1, 2, 3, 4, 5, 6]), 3, 2, 1);
  expect(result.w).toBe(2);
  expect(result.h).toBe(3);
  expect([...result.g]).toEqual([4, 1, 5, 2, 6, 3]);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run:

```powershell
npm.cmd run test -- tests/unit/alignment.test.js
```

Expected: import先が存在しないためFAIL。

- [ ] **Step 3: 現行位置合わせ関数を依存順に移す**

Move exactly these functions:

```text
fft.js:
  fft1d, fft2d, hannWindow, sampleBilinear

similarity.js:
  warpAffine, magnitudeSpectrum, logPolar, phaseCorrelate,
  resampleToN, estimateSimilarity, inkMaskFromGray,
  downsampleMaskMax, inkIoU, warpMask, bestAlignment

quadrant.js:
  rotateGray90, quadrantScore, bestQuadrant
```

Add explicit imports between the three modules and import the public functions from `legacy-app.js`.
Do not change `estimateSimilarity` defaults `N=512`, `minPsr=30`, `maxAngleDeg=45`, `minScale=0.5`, `maxScale=2.0`.

- [ ] **Step 4: 単体テストと全回帰を実行する**

```powershell
npm.cmd run test
npm.cmd run test:e2e
npm.cmd run build
```

Expected: 全テスト成功。自動位置合わせのON/OFFと手動補正が従来どおり動く。

- [ ] **Step 5: コミットする**

```powershell
git add src/core/alignment src/legacy-app.js tests/unit/alignment.test.js
git diff --cached --check
git commit -m "refactor: extract alignment core"
```

---

### Task 5: テキスト差分コア

**Files:**
- Create: `src/core/text-diff/tokens.js`
- Create: `src/core/text-diff/xy-cut.js`
- Create: `src/core/text-diff/highlights.js`
- Create: `src/core/text-diff/tables.js`
- Create: `tests/unit/text-tokens.test.js`
- Create: `tests/unit/text-highlights.test.js`
- Create: `tests/unit/text-tables.test.js`
- Modify: `src/legacy-app.js`

**Interfaces:**
- Produces: `reconstructLinesInItemOrder(items)`, `xyCut(tokens,options)`, `assembleFromLeaves(items,leaves)`, `flattenLines(pages)`, `buildTextHighlights(oldPages,newPages)`, `detectTables(pageLines)`, `applyTableHighlights(oldPages,newPages,highlights)`。

- [ ] **Step 1: 行再構成とハイライトの失敗テストを書く**

Create `tests/unit/text-tokens.test.js`:

```js
import { expect, test } from "vitest";
import { reconstructLinesInItemOrder } from "../../src/core/text-diff/tokens.js";

const item = (str, x, y) => ({ str, width: str.length * 5, transform: [10, 0, 0, 10, x, y] });

test("reconstructs lines by y and tokens by x", () => {
  const lines = reconstructLinesInItemOrder([
    item("B", 20, 100), item("A", 10, 100), item("C", 10, 80),
  ]);
  expect(lines.map((line) => line.text)).toEqual(["AB", "C"]);
});
```

Create `tests/unit/text-highlights.test.js`:

```js
import { expect, test } from "vitest";
import { buildTextHighlights } from "../../src/core/text-diff/highlights.js";

const token = (str, off) => ({ str, off, width: str.length, transform: [1, 0, 0, 1, off, 0] });

test("marks changed characters on both sides", () => {
  const oldPages = [[{ text: "REV A", tokens: [token("REV A", 0)] }]];
  const newPages = [[{ text: "REV B", tokens: [token("REV B", 0)] }]];
  const hi = buildTextHighlights(oldPages, newPages);
  expect(hi.old.get(0)[0].color).toBe("changed");
  expect(hi.new.get(0)[0].color).toBe("changed");
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```powershell
npm.cmd run test -- tests/unit/text-tokens.test.js tests/unit/text-highlights.test.js
```

Expected: import先が存在しないためFAIL。

- [ ] **Step 3: 純粋関数を四つのモジュールへ移す**

Change the state-dependent signatures to the following public contracts and copy the current algorithms from `src/legacy-app.js` without changing comparisons or constants:

```text
xyCut(tokens, depth, context)
  → xyCut(tokens, options)
  options defaults: maxDepth=6, minBlockTokens=2, colGapEm=2.5,
                    rowGapEm=1.6, colMinSideLines=3

buildTextHighlights()
  → buildTextHighlights(oldPages, newPages)

applyTableHighlights(highlights)
  → applyTableHighlights(oldPages, newPages, highlights)
  return value: the same highlights object
```

Import `DiffMatchPatch` from `diff-match-patch` inside `highlights.js` and instantiate it inside `buildTextHighlights`.
Keep `extractPageTokenLines`, `extractDocTokens`, `drawTokenHighlight` in `legacy-app.js` because they still depend on pdf.js or Canvas.

- [ ] **Step 4: 表差分テストを追加する**

Create `tests/unit/text-tables.test.js`:

```js
import { expect, test } from "vitest";
import { applyTableHighlights, detectTables } from "../../src/core/text-diff/tables.js";

const tok = (str, x, y) => ({ str, off: 0, width: str.length * 5, transform: [10, 0, 0, 10, x, y] });
const lines = (middleRight) => [
  { text: "A1 B1", tokens: [tok("A1", 10, 90), tok("B1", 100, 90)] },
  { text: `A2 ${middleRight}`, tokens: [tok("A2", 10, 70), tok(middleRight, 100, 70)] },
  { text: "A3 B3", tokens: [tok("A3", 10, 50), tok("B3", 100, 50)] },
];

test("detects a three-row table and replaces row highlights with cell highlights", () => {
  const oldLines = lines("B2");
  const newLines = lines("B2 changed");
  const tables = detectTables(oldLines);
  expect(tables).toHaveLength(1);
  expect(tables[0]).toMatchObject({ rowCount: 3, colCount: 2 });

  const hi = { old: new Map(), new: new Map() };
  applyTableHighlights([oldLines], [newLines], hi);
  expect(hi.old.get(0).some((entry) => entry.color === "changed")).toBe(true);
  expect(hi.new.get(0).some((entry) => entry.color === "changed")).toBe(true);
});
```

- [ ] **Step 5: 全テストとビルドを実行する**

```powershell
npm.cmd run test
npm.cmd run test:e2e
npm.cmd run build
```

Expected: 全テスト成功。テキスト比較fixtureの `REV A` と `REV B` が変更色で表示される。

- [ ] **Step 6: コミットする**

```powershell
git add src/core/text-diff src/legacy-app.js tests/unit/text-*.test.js
git diff --cached --check
git commit -m "refactor: extract text diff core"
```

---

### Task 6: 凡例レイアウト

**Files:**
- Create: `src/core/legend/layout.js`
- Create: `tests/unit/legend-layout.test.js`
- Modify: `src/legacy-app.js`

**Interfaces:**
- Produces: `legendLayout(items,unit,options,measureWidth)`。

- [ ] **Step 1: 失敗テストを書く**

Create `tests/unit/legend-layout.test.js`:

```js
import { expect, test } from "vitest";
import { legendLayout } from "../../src/core/legend/layout.js";

test("returns deterministic geometry from the injected text measurer", () => {
  const layout = legendLayout(
    [{ label: "A", color: "red" }, { label: "BB", color: "blue" }],
    1,
    { chrome: false },
    (label) => label.length * 10,
  );
  expect(layout.chrome).toBe(false);
  expect(layout.parts).toHaveLength(2);
  expect(layout.parts[1].swX).toBeGreaterThan(layout.parts[0].textX);
  expect(layout.w).toBeGreaterThan(30);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```powershell
npm.cmd run test -- tests/unit/legend-layout.test.js
```

Expected: import先が存在しないためFAIL。

- [ ] **Step 3: `legendLayout` と定数だけをcoreへ移す**

`ctxMeasurer`, `measureLegend`, `drawLegend` remain in `legacy-app.js` because they use CanvasRenderingContext2D.
Import `legendLayout` from the new module and retain `LG_FONT_PT`, `LG_SWATCH_PT`, `LG_GAP_ITEM_PT`, `LG_GAP_SW_PT`, `LG_PAD_PT`, `LG_BORDER_PT` with the function so output geometry is unchanged.

- [ ] **Step 4: 回帰確認してコミットする**

```powershell
npm.cmd run test
npm.cmd run test:e2e
npm.cmd run build
git add src/core/legend src/legacy-app.js tests/unit/legend-layout.test.js
git diff --cached --check
git commit -m "refactor: extract legend layout"
```

---

### Task 7: npm実行時依存とPDF.js基盤

**Files:**
- Create: `src/platform/pdfjs.js`
- Create: `src/platform/canvas.js`
- Create: `src/platform/download.js`
- Modify: `vite.config.js`
- Modify: `src/legacy-app.js`
- Modify: `index.html`
- Create: `tests/unit/platform-source.test.js`
- Modify: `tests/e2e/baseline.spec.js`

**Interfaces:**
- Produces: `pdfjsLib`, `PDF_DOCUMENT_OPTIONS`, `createCanvas(width,height)`, `createWhiteCanvas(width,height)`, `downloadBlob(blob,filename)`。

- [ ] **Step 1: CDN禁止の構造テストを書く**

Create `tests/unit/platform-source.test.js`:

```js
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

test("production entry has no runtime CDN dependency", async () => {
  const html = await readFile("index.html", "utf8");
  expect(html).not.toMatch(/cdnjs|jsdelivr/);
  const platform = await readFile("src/platform/pdfjs.js", "utf8");
  expect(platform).toContain("pdfjs-dist/build/pdf.js");
  expect(platform).toContain("pdf.worker.min.js?url");
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```powershell
npm.cmd run test -- tests/unit/platform-source.test.js
```

Expected: CDN `<script>` とCDN Worker URLが残っているためFAIL。

- [ ] **Step 3: PDF.js adapterと静的資産コピーを実装する**

Create `src/platform/pdfjs.js`:

```js
import * as pdfjsLib from "pdfjs-dist/build/pdf.js";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.js?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const base = import.meta.env.BASE_URL;
export const PDF_DOCUMENT_OPTIONS = Object.freeze({
  cMapUrl: `${base}pdfjs/cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${base}pdfjs/standard_fonts/`,
});

export { pdfjsLib };
```

Extend `vite.config.js`:

```js
import { viteStaticCopy } from "vite-plugin-static-copy";

plugins: [
  viteStaticCopy({
    targets: [
      { src: "node_modules/pdfjs-dist/cmaps/*", dest: "pdfjs/cmaps" },
      { src: "node_modules/pdfjs-dist/standard_fonts/*", dest: "pdfjs/standard_fonts" },
    ],
  }),
],
```

- [ ] **Step 4: Canvasとdownload adapterを実装する**

```js
// src/platform/canvas.js
export function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function createWhiteCanvas(width, height) {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  return canvas;
}

// src/platform/download.js
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  queueMicrotask(() => URL.revokeObjectURL(url));
}
```

- [ ] **Step 5: legacy appをnpm importへ切り替える**

At the top of `src/legacy-app.js`:

```js
import { jsPDF } from "jspdf";
import { pdfjsLib, PDF_DOCUMENT_OPTIONS } from "./platform/pdfjs.js";
import { downloadBlob } from "./platform/download.js";
```

Delete the Blob Worker IIFE and the three CDN `<script>` elements.
Change `loadPdf` to call:

```js
pdfjsLib.getDocument({ data: await file.arrayBuffer(), ...PDF_DOCUMENT_OPTIONS }).promise;
```

Replace both `window.jspdf` reads with the imported `jsPDF`.
Replace anchor-based Blob downloads with `downloadBlob` without changing filenames.

- [ ] **Step 6: 外部ネットワークを遮断したE2Eを追加する**

Add to `tests/e2e/baseline.spec.js`:

```js
test("renders with every external network request blocked", async ({ page }) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  await page.goto("/");
  await page.setInputFiles("#fileOld", join(fixtures, "old.pdf"));
  await page.setInputFiles("#fileNew", join(fixtures, "new.pdf"));
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText(/差分を表示中|差分なし/);
});
```

- [ ] **Step 7: テスト、成果物、ライセンスを確認する**

```powershell
npm.cmd run test
npm.cmd run test:e2e
npm.cmd run build
Get-ChildItem -Recurse dist\pdfjs | Select-Object FullName
```

Expected: `dist/pdfjs/cmaps` と `dist/pdfjs/standard_fonts` が存在し、外部ネットワーク遮断テストが成功する。

- [ ] **Step 8: コミットする**

```powershell
git add index.html vite.config.js src/platform src/legacy-app.js tests
git diff --cached --check
git commit -m "refactor: bundle browser runtime dependencies"
```

---

### Task 8: 状態スライスと無効化規則

**Files:**
- Create: `src/app/state.js`
- Create: `src/app/invalidation.js`
- Create: `tests/unit/state.test.js`
- Create: `tests/unit/invalidation.test.js`
- Modify: `src/legacy-app.js`

**Interfaces:**
- Produces: `createAppState()`, `invalidateDocuments(state)`, `invalidatePageAlignment(state)`, `invalidateDpi(state)`, `invalidateThreshold(state)`, `invalidateTolerance(state)`, `invalidateManualAlignment(state)`, `invalidateBoxDetection(state)`。

- [ ] **Step 1: 初期状態と無効化の失敗テストを書く**

Create `tests/unit/state.test.js`:

```js
import { expect, test } from "vitest";
import { createAppState } from "../../src/app/state.js";

test("creates isolated state slices with current defaults", () => {
  const state = createAppState();
  expect(state.comparison).toMatchObject({ dpi: 150, threshold: 128, tolerancePx: 0, dx: 0, dy: 0 });
  expect(state.documents).toMatchObject({ oldDoc: null, newDoc: null, pages: 0, currentPage: 0 });
  expect(state.boxEditor).toMatchObject({ showBoxes: true, editMode: false, selectedIndex: -1 });
  expect(state.textReview.view).toEqual({ scale: 1, tx: 0, ty: 0 });
});
```

Create `tests/unit/invalidation.test.js`:

```js
import { expect, test } from "vitest";
import { createAppState } from "../../src/app/state.js";
import { invalidateThreshold } from "../../src/app/invalidation.js";

test("threshold invalidation clears derived visual and edited boxes but not text extraction", () => {
  const state = createAppState();
  state.visual.pageCache.set(0, { removed: 1, added: 2 });
  state.visual.alignmentCache.set(0, { applied: true });
  state.boxEditor.autoByPage.set(0, [{ x: 0, y: 0, w: 1, h: 1 }]);
  state.boxEditor.editsByPage.set(0, [{ x: 1, y: 1, w: 1, h: 1 }]);
  state.textReview.extraction = { old: [], new: [] };
  invalidateThreshold(state);
  expect(state.visual.pageCache.size).toBe(0);
  expect(state.visual.alignmentCache.size).toBe(0);
  expect(state.boxEditor.autoByPage.size).toBe(0);
  expect(state.boxEditor.editsByPage.size).toBe(0);
  expect(state.textReview.extraction).not.toBeNull();
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```powershell
npm.cmd run test -- tests/unit/state.test.js tests/unit/invalidation.test.js
```

Expected: modules not found.

- [ ] **Step 3: 状態の初期値を実装する**

Create `createAppState()` with these top-level slices:

```js
return {
  documents: { oldDoc: null, newDoc: null, pages: 0, currentPage: 0, oldSequence: null, newSequence: null, alignmentOps: [], generation: 0 },
  comparison: { dpi: 150, threshold: 128, tolerancePx: 0, dx: 0, dy: 0, manualAngle: 0, manualScale: 1, autoAlign: false, quadrantManual: new Map() },
  visual: { mode: "diff", toggleSide: "old", toggleCache: null, pageCache: new Map(), alignmentCache: new Map(), quadrantCache: new Map(), renderGeneration: 0, quadrantGeneration: 0, rendered: false, currentPlan: null },
  boxEditor: { showBoxes: true, currentBoxes: null, autoByPage: new Map(), editsByPage: new Map(), undoByPage: new Map(), editMode: false, selectedIndex: -1, drag: null },
  textReview: { scale: null, extraction: null, highlights: null, page: 0, view: { scale: 1, tx: 0, ty: 0 }, extractGeneration: 0, renderGeneration: 0, debugXYCut: false },
  ui: { topMode: "visual", busy: null },
};
```

- [ ] **Step 4: 無効化関数を実装する**

All invalidation functions mutate only the supplied `state` and increment the relevant generation counters.
Use a shared internal helper:

```js
function clearVisualDerived(state, { alignment, quadrant, boxes }) {
  state.visual.pageCache.clear();
  state.visual.toggleCache = null;
  state.visual.renderGeneration += 1;
  if (alignment) state.visual.alignmentCache.clear();
  if (quadrant) {
    state.visual.quadrantCache.clear();
    state.visual.quadrantGeneration += 1;
  }
  if (boxes) {
    state.boxEditor.autoByPage.clear();
    state.boxEditor.editsByPage.clear();
    state.boxEditor.undoByPage.clear();
    state.boxEditor.currentBoxes = null;
  }
}
```

Implement each public function according to the invalidation matrix in design section 9.

- [ ] **Step 5: `legacy-app.js` のflat state参照をslice参照へ置換する**

Representative mapping:

```text
state.oldDoc            → state.documents.oldDoc
state.cur               → state.documents.currentPage
state.dpi               → state.comparison.dpi
state.th                → state.comparison.threshold
state.cache             → state.visual.pageCache
state.renderToken       → state.visual.renderGeneration
state.boxAuto           → state.boxEditor.autoByPage
state.boxEdits          → state.boxEditor.editsByPage
state.textCache         → state.textReview.extraction
state.textRenderToken   → state.textReview.renderGeneration
state.topMode           → state.ui.topMode
```

Replace ad hoc cache resets in event handlers with the named invalidation functions.
Keep the existing confirmation call before invalidation that clears edited boxes.

- [ ] **Step 6: 全回帰を実行する**

```powershell
npm.cmd run test
npm.cmd run test:e2e
npm.cmd run build
```

Expected: all tests pass and no direct top-level legacy state properties remain.

- [ ] **Step 7: 残存flat state参照を機械確認してコミットする**

```powershell
rg -n "state\.(oldDoc|newDoc|cur|dpi|th|cache|boxAuto|boxEdits|textCache|topMode)\b" src
```

Expected: no matches.

```powershell
git add src/app/state.js src/app/invalidation.js src/legacy-app.js tests/unit
git diff --cached --check
git commit -m "refactor: separate application state slices"
```

---

### Task 9: PDF文書とページ描画機能

**Files:**
- Create: `src/features/documents/document-controller.js`
- Create: `src/features/documents/page-renderer.js`
- Create: `src/features/documents/page-layout.js`
- Create: `tests/unit/page-layout.test.js`
- Create: `tests/integration/document-controller.test.js`
- Modify: `src/legacy-app.js`

**Interfaces:**
- Produces: `createDocumentController({state,dom,pdf,errorReporter,onReady})`, `renderPageCanvas(doc,pageIndex,scale)`, `pageSizePt(doc,pageIndex)`, `framePlan(oldSize,newSize,dpi)`, `sequenceIndex(sequence,slot)`, `pageLabelText(documents,index)`。

- [ ] **Step 1: page layoutの失敗テストを書く**

```js
import { expect, test } from "vitest";
import { framePlan, sequenceIndex } from "../../src/features/documents/page-layout.js";

test("uses the larger page as the normalized output frame", () => {
  const plan = framePlan({ w: 100, h: 200 }, { w: 200, h: 400 }, 144);
  expect(plan).toMatchObject({
    oldScale: 4,
    newScale: 2,
    frameScale: 2,
    ratio: 2,
    normalized: true,
    aspectMismatch: false,
    refSide: "new",
  });
});

test("maps null page spacers without converting them to zero", () => {
  expect(sequenceIndex([0, null, 1], 1)).toBeNull();
  expect(sequenceIndex([0, null, 1], 2)).toBe(1);
});
```

- [ ] **Step 2: document controllerの失敗テストを書く**

Create `tests/integration/document-controller.test.js`:

```js
import { expect, test, vi } from "vitest";
import { createAppState } from "../../src/app/state.js";
import { createDocumentController } from "../../src/features/documents/document-controller.js";

const drop = () => ({
  classList: { add: vi.fn() },
  querySelector: vi.fn(() => ({ textContent: "" })),
});

test("commits each document and announces readiness after both sides load", async () => {
  const state = createAppState();
  const oldDoc = { numPages: 2 };
  const newDoc = { numPages: 2 };
  const pdf = {
    getDocument: vi.fn()
      .mockReturnValueOnce({ promise: Promise.resolve(oldDoc) })
      .mockReturnValueOnce({ promise: Promise.resolve(newDoc) }),
  };
  const dom = {
    dropOld: drop(), dropNew: drop(),
    run: { disabled: true }, runText: { disabled: true },
    dlTextPng: { disabled: false }, dlTextPdf: { disabled: false },
    status: { textContent: "" }, textStatus: { textContent: "" },
  };
  const onReady = vi.fn();
  const controller = createDocumentController({
    state,
    dom,
    pdf,
    errorReporter: { report: vi.fn() },
    onReady,
  });
  const fakeFile = { name: "fixture.pdf", arrayBuffer: vi.fn(async () => new ArrayBuffer(8)) };

  await controller.load("old", fakeFile);
  expect(state.documents.oldDoc).toBe(oldDoc);
  expect(state.documents.generation).toBe(1);
  expect(onReady).not.toHaveBeenCalled();

  await controller.load("new", fakeFile);
  expect(state.documents.newDoc).toBe(newDoc);
  expect(state.documents.generation).toBe(2);
  expect(onReady).toHaveBeenCalledOnce();
});
```

- [ ] **Step 3: テストが失敗することを確認する**

```powershell
npm.cmd run test -- tests/unit/page-layout.test.js tests/integration/document-controller.test.js
```

- [ ] **Step 4: 現行関数を抽出する**

Move:

```text
document-controller.js: loadPdf behavior and file-name/status updates
page-renderer.js: pageSizePt, renderPageCanvas, canvasToGrayF, rotateCanvas90
page-layout.js: framePlan, seqIdx, pageLabelText pure form
```

The controller must increment `state.documents.generation` before awaiting pdf.js and discard a resolved document when the captured generation no longer matches.
Wrap `file.arrayBuffer()` and `pdf.getDocument()` in `try/catch`; report the current-generation failure with `errorReporter.report(error, "PDFの読み込みに失敗しました")` and return `false`.
Return `true` only after the selected document and file name are committed to state and DOM.

- [ ] **Step 5: legacy event handlersをcontrollerへ接続する**

Replace both file input handlers and drag/drop calls with:

```js
documentController.load("old", file);
documentController.load("new", file);
```

- [ ] **Step 6: 回帰確認してコミットする**

```powershell
npm.cmd run test
npm.cmd run test:e2e
npm.cmd run build
git add src/features/documents src/legacy-app.js tests
git diff --cached --check
git commit -m "refactor: extract PDF document handling"
```

---

### Task 10: ビジュアル描画とビューア

**Files:**
- Create: `src/features/viewer/viewport.js`
- Create: `src/features/viewer/viewer-controller.js`
- Create: `src/features/visual-diff/visual-controller.js`
- Create: `src/features/visual-diff/visual-renderer.js`
- Create: `src/features/visual-diff/toggle-renderer.js`
- Create: `tests/unit/viewport.test.js`
- Create: `tests/integration/visual-controller.test.js`
- Modify: `src/legacy-app.js`

**Interfaces:**
- Produces: `zoomAt(view,factor,cx,cy)`, `fitViewport(content,container)`, `createViewerController({state,dom,window,onTransform})`, `createVisualController({state,dom,renderDiffPage,renderTogglePage,drawBoxes})`, `renderDiffPage(snapshot,dependencies)`, `renderTogglePage(snapshot,dependencies)`。

- [ ] **Step 1: viewportの失敗テストを書く**

```js
import { expect, test } from "vitest";
import { zoomAt, fitViewport } from "../../src/features/viewer/viewport.js";

test("keeps the pointer world position fixed while zooming", () => {
  expect(zoomAt({ scale: 1, tx: 0, ty: 0 }, 2, 100, 50))
    .toEqual({ scale: 2, tx: -100, ty: -50 });
});

test("fits content with the existing 92 percent margin", () => {
  expect(fitViewport({ width: 1000, height: 500 }, { width: 500, height: 500 }))
    .toEqual({ scale: 0.46, tx: 20, ty: 135 });
});
```

- [ ] **Step 2: stale描画の失敗テストを書く**

Create `tests/integration/visual-controller.test.js`:

```js
import { expect, test, vi } from "vitest";
import { createAppState } from "../../src/app/state.js";
import { createVisualController } from "../../src/features/visual-diff/visual-controller.js";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test("does not commit an older page after a newer render finishes", async () => {
  const state = createAppState();
  state.documents.pages = 2;
  state.documents.generation = 1;
  const page0 = deferred();
  const page1 = deferred();
  const renderDiffPage = vi.fn((snapshot) => snapshot.ticket.pageIndex === 0 ? page0.promise : page1.promise);
  const dom = {
    out: { dataset: {}, style: {}, width: 0, height: 0 },
    pageLabel: { textContent: "" }, status: { textContent: "", innerHTML: "" },
    statRm: { textContent: "" }, statAd: { textContent: "" },
  };
  const controller = createVisualController({
    state,
    dom,
    renderDiffPage,
    renderTogglePage: vi.fn(),
    drawBoxes: vi.fn(),
  });

  const first = controller.showPage(0);
  const second = controller.showPage(1);
  page1.resolve({ pageIndex: 1, width: 10, height: 10, removed: 0, added: 1, boxes: [] });
  await second;
  page0.resolve({ pageIndex: 0, width: 10, height: 10, removed: 1, added: 0, boxes: [] });
  await first;

  expect(dom.out.dataset.pageIndex).toBe("1");
  expect(state.documents.currentPage).toBe(1);
});
```

- [ ] **Step 3: テストが失敗することを確認する**

```powershell
npm.cmd run test -- tests/unit/viewport.test.js tests/integration/visual-controller.test.js
```

- [ ] **Step 4: ビューア計算とDOMイベントを抽出する**

Move `applyTransform`, `fitView`, `zoomAt`, `zoomCenter`, pan pointer handlers, wheel handler, double-click fit, and resize handling.
`viewport.js` remains DOM-free; `viewer-controller.js` owns DOM listeners and exposes:

```js
return { apply, fit, zoomCenter, cancelPan, getView: () => ({ ...view }) };
```

- [ ] **Step 5: ビジュアル描画をsnapshot入力へ変更する**

`createVisualController.showPage(pageIndex)` must:

```js
const ticket = {
  id: ++state.visual.renderGeneration,
  documentGeneration: state.documents.generation,
  pageIndex,
};
const snapshot = createComparisonSnapshot(state, ticket);
const result = state.visual.mode === "diff"
  ? await renderDiffPage(snapshot, dependencies)
  : await renderTogglePage(snapshot, dependencies);
if (!isCurrentTicket(state, ticket)) return { committed: false };
commitVisualResult(state, dom, result);
return { committed: true };
```

Move `buildDiff`, `buildToggle`, `drawToggleSide`, `show`, `refreshAfterAlign` into the visual feature without changing pixel formulas or alignment calls.

- [ ] **Step 6: 回帰確認してコミットする**

```powershell
npm.cmd run test
npm.cmd run test:e2e
npm.cmd run build
git add src/features/viewer src/features/visual-diff src/legacy-app.js tests
git diff --cached --check
git commit -m "refactor: extract visual rendering controllers"
```

---

### Task 11: 変更枠エディター

**Files:**
- Create: `src/features/box-editor/box-history.js`
- Create: `src/features/box-editor/box-editor-controller.js`
- Create: `src/features/box-editor/box-editor-view.js`
- Create: `tests/unit/box-history.test.js`
- Create: `tests/integration/box-editor-controller.test.js`
- Create: `tests/e2e/box-editing.spec.js`
- Modify: `src/legacy-app.js`

**Interfaces:**
- Produces: `createBoxHistory(limit=50)`, `createBoxEditorController({state,dom,view,confirmDiscard})`, `drawBoxLayer({canvas,boxes,selectedIndex,view,showBoxes,editMode})`。

- [ ] **Step 1: Undo履歴の失敗テストを書く**

```js
import { expect, test } from "vitest";
import { createBoxHistory } from "../../src/features/box-editor/box-history.js";

test("stores clones and limits history to fifty entries", () => {
  const history = createBoxHistory(50);
  const boxes = [{ x: 0, y: 0, w: 10, h: 10 }];
  history.push(boxes);
  boxes[0].x = 99;
  expect(history.undo()).toEqual([{ x: 0, y: 0, w: 10, h: 10 }]);
});
```

- [ ] **Step 2: ドラッグ割込みの失敗テストを書く**

Create `tests/integration/box-editor-controller.test.js`:

```js
import { expect, test, vi } from "vitest";
import { createAppState } from "../../src/app/state.js";
import { createBoxEditorController } from "../../src/features/box-editor/box-editor-controller.js";

test("cancelled drag cannot commit on a later pointerup", () => {
  const state = createAppState();
  state.documents.currentPage = 0;
  state.boxEditor.editMode = true;
  const controller = createBoxEditorController({
    state,
    dom: {
      boxEdit: { classList: { toggle: vi.fn() } },
      boxDel: { disabled: true },
      boxReset: { disabled: true },
      statBox: { textContent: "" },
    },
    view: {
      toImagePoint: (point) => point,
      redraw: vi.fn(),
    },
    confirmDiscard: vi.fn(() => true),
  });

  controller.pointerDown({ x: 10, y: 10, pointerId: 1 });
  controller.cancelDrag();
  controller.pointerUp({ x: 50, y: 50, pointerId: 1 });

  expect(state.boxEditor.editsByPage.size).toBe(0);
  expect(state.boxEditor.drag).toBeNull();
});
```

- [ ] **Step 3: テストが失敗することを確認する**

```powershell
npm.cmd run test -- tests/unit/box-history.test.js tests/integration/box-editor-controller.test.js
```

- [ ] **Step 4: 現行枠編集関数をcontrollerとviewへ移す**

Move to controller:

```text
cancelBoxDrag, hitBox, hitHandle, setBoxEditMode, ensureBoxEdits,
pushBoxUndo, undoBoxEdit, deleteSelectedBox, boxEditPointerDown,
endBoxDrag, clearBoxEdits, confirmDiscardBoxEdits
```

Move `drawBoxLayer`, handle point drawing, button state updates, and stat updates to view.
Keep automatic boxes in `autoByPage`, manual boxes in `editsByPage`, and drag draft only in `state.boxEditor.drag`.

- [ ] **Step 5: ブラウザ操作テストを書く**

Create `tests/e2e/box-editing.spec.js`:

```js
import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const fixture = (name) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

test("creates, deletes and restores a manual change box", async ({ page }) => {
  await page.goto("/");
  await page.locator("#fileOld").setInputFiles(fixture("old.pdf"));
  await page.locator("#fileNew").setInputFiles(fixture("new.pdf"));
  await page.locator("#run").click();
  await expect(page.locator("#status")).toContainText("差分");
  await page.locator("#boxEdit").click();

  const layer = await page.locator("#boxLayer").boundingBox();
  expect(layer).not.toBeNull();
  const before = await page.locator("#statBox").textContent();
  await page.mouse.move(layer.x + layer.width * 0.72, layer.y + layer.height * 0.72);
  await page.mouse.down();
  await page.mouse.move(layer.x + layer.width * 0.84, layer.y + layer.height * 0.82);
  await page.mouse.up();
  await expect.poll(() => page.locator("#statBox").textContent()).not.toBe(before);
  const afterCreate = await page.locator("#statBox").textContent();

  await page.keyboard.press("Delete");
  await expect.poll(() => page.locator("#statBox").textContent()).not.toBe(afterCreate);
  const afterDelete = await page.locator("#statBox").textContent();

  await page.keyboard.press("Control+z");
  await expect.poll(() => page.locator("#statBox").textContent()).not.toBe(afterDelete);
  await expect(page.locator("#statBox")).toHaveText(afterCreate);
});
```

- [ ] **Step 6: 回帰確認してコミットする**

```powershell
npm.cmd run test
npm.cmd run test:e2e
npm.cmd run build
git add src/features/box-editor src/legacy-app.js tests
git diff --cached --check
git commit -m "refactor: extract change box editor"
```

---

### Task 12: テキストレビュー機能

**Files:**
- Create: `src/features/text-review/text-controller.js`
- Create: `src/features/text-review/text-renderer.js`
- Create: `tests/integration/text-controller.test.js`
- Create: `tests/e2e/text-review.spec.js`
- Modify: `src/legacy-app.js`

**Interfaces:**
- Produces: `extractPageTokens({doc,pageIndex,debugXYCut,onDebug})`, `createTextController({state,dom,extractPageTokens,renderer,errorReporter})`, `renderTextPage({side,pageIndex,snapshot,canvas})`, `renderTextPageOffscreen({side,pageIndex,snapshot})`。

- [ ] **Step 1: stale抽出の失敗テストを書く**

Create `tests/integration/text-controller.test.js`:

```js
import { expect, test, vi } from "vitest";
import { createAppState } from "../../src/app/state.js";
import { createTextController } from "../../src/features/text-review/text-controller.js";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test("only the newest text extraction commits", async () => {
  const state = createAppState();
  state.documents.oldDoc = { numPages: 1 };
  state.documents.newDoc = { numPages: 1 };
  const firstOld = deferred();
  const firstNew = deferred();
  const secondOld = deferred();
  const secondNew = deferred();
  const runs = [firstOld, firstNew, secondOld, secondNew];
  const extractPageTokens = vi.fn(() => runs.shift().promise);
  const controller = createTextController({
    state,
    dom: { textStatus: { textContent: "" } },
    extractPageTokens,
    renderer: { show: vi.fn() },
    errorReporter: { report: vi.fn() },
  });

  const first = controller.run();
  const second = controller.run();
  secondOld.resolve([{ text: "new old-side" }]);
  secondNew.resolve([{ text: "new new-side" }]);
  await second;
  firstOld.resolve([{ text: "stale old-side" }]);
  firstNew.resolve([{ text: "stale new-side" }]);
  await first;

  expect(state.textReview.extraction).toEqual({
    old: [[{ text: "new old-side" }]],
    new: [[{ text: "new new-side" }]],
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```powershell
npm.cmd run test -- tests/integration/text-controller.test.js
```

- [ ] **Step 3: 抽出、描画、ビュー操作を分離する**

Move to controller:

```text
extractPageTokenLines orchestration, extractDocTokens, runTextDiff,
showTextPage, text page buttons, top-mode restoration
```

Move to renderer:

```text
drawTokenHighlight, renderTextPage, renderTextPageOffscreen,
applyTextTransform, fitTextView, textZoomAt, textZoomCenter,
text pointer and wheel handling
```

Pass `debugXYCut` as an argument to extraction and pass progress updates as `onProgress({side,page,total})` rather than writing DOM from core functions.

- [ ] **Step 4: テキスト比較E2Eを書く**

Create `tests/e2e/text-review.spec.js`:

```js
import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const fixture = (name) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

test("extracts and displays the text comparison", async ({ page }) => {
  await page.goto("/");
  await page.locator("#fileOld").setInputFiles(fixture("old.pdf"));
  await page.locator("#fileNew").setInputFiles(fixture("new.pdf"));
  await page.locator("#topText").click();
  await page.locator("#runText").click();

  await expect(page.locator("#textStatus")).toHaveText("テキスト差分を表示中");
  await expect(page.locator("#oldTextCanvas")).toBeVisible();
  await expect(page.locator("#newTextCanvas")).toBeVisible();
  await expect.poll(() => page.locator("#oldTextCanvas").evaluate((canvas) => canvas.width))
    .toBeGreaterThan(10);
  await expect.poll(() => page.locator("#newTextCanvas").evaluate((canvas) => canvas.width))
    .toBeGreaterThan(10);
});
```

- [ ] **Step 5: 回帰確認してコミットする**

```powershell
npm.cmd run test
npm.cmd run test:e2e
npm.cmd run build
git add src/features/text-review src/legacy-app.js tests
git diff --cached --check
git commit -m "refactor: extract text review controller"
```

---

### Task 13: PNG/PDF出力機能

**Files:**
- Create: `src/features/export/image-composer.js`
- Create: `src/features/export/pdf-exporter.js`
- Create: `src/features/export/export-controller.js`
- Create: `tests/unit/image-composer.test.js`
- Create: `tests/integration/export-controller.test.js`
- Create: `tests/e2e/export.spec.js`
- Modify: `src/legacy-app.js`

**Interfaces:**
- Produces: `composeVisualExport({source,boxes,legend,dpi,destination})`, `composeTextExport({oldCanvas,newCanvas,pageIndex,total,colors})`, `createPdfExporter({jsPDF})`, `createExportController({state,dom,renderVisualOffscreen,renderTextOffscreen,pdfExporter,download,errorReporter})`。

- [ ] **Step 1: 画面状態を変更しない出力の失敗テストを書く**

```js
import { expect, test, vi } from "vitest";
import { createAppState } from "../../src/app/state.js";
import { createExportController } from "../../src/features/export/export-controller.js";

test("PDF export does not replace visual box caches", async () => {
  const fakeCanvas = { width: 10, height: 10 };
  const originalAuto = new Map([[0, [{ x: 1, y: 2, w: 3, h: 4 }]]]);
  const state = createAppState();
  state.documents.pages = 2;
  state.boxEditor.autoByPage = originalAuto;
  const controller = createExportController({
    state,
    dom: {
      status: { textContent: "" },
      dlPng: { disabled: false },
      dlPdf: { disabled: false },
      dlTextPng: { disabled: false },
      dlTextPdf: { disabled: false },
    },
    renderVisualOffscreen: vi.fn(async () => ({ canvas: fakeCanvas, boxes: [] })),
    renderTextOffscreen: vi.fn(),
    pdfExporter: { saveVisual: vi.fn(async () => {}) },
    download: vi.fn(),
    errorReporter: { report: vi.fn() },
  });
  await controller.saveVisualPdf();
  expect(state.boxEditor.autoByPage).toBe(originalAuto);
  expect(state.boxEditor.autoByPage.get(0)).toEqual([{ x: 1, y: 2, w: 3, h: 4 }]);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```powershell
npm.cmd run test -- tests/integration/export-controller.test.js
```

- [ ] **Step 3: 合成処理を値入力へ変更する**

Move `drawLegend`, `measureLegend`, `drawBoxesTo`, `exportCanvasWithLegend`, `composeTextExport` into `image-composer.js`.
Replace every direct `state` read with explicit arguments.

The visual composer must clone the source Canvas before drawing boxes and legend:

```js
const canvas = destination ?? createCanvas(source.width, source.height);
canvas.width = source.width;
canvas.height = source.height;
const context = canvas.getContext("2d");
context.drawImage(source, 0, 0);
drawBoxes(context, boxes, boxLineWidth);
drawLegend(context, legendItems, margin, margin, dpi / 72);
return canvas;
```

- [ ] **Step 4: controllerをtry/finally付きで実装する**

Each public save method captures a snapshot before awaiting and restores only busy UI state in `finally`:

```js
async function saveVisualPdf() {
  const snapshot = createExportSnapshot(state);
  setBusy("PDF生成中…");
  try {
    await pdfExporter.saveVisual(snapshot);
    setStatus("PDFを保存しました");
  } catch (error) {
    errorReporter.report(error, "PDFの保存に失敗しました");
  } finally {
    clearBusy();
  }
}
```

Do not call the on-screen `showPage()` after export.

- [ ] **Step 5: ダウンロードE2Eを書く**

Create `tests/e2e/export.spec.js`:

```js
import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const fixture = (name) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

async function expectDownload(page, button, filename) {
  const before = await page.locator("#pageLabel, #zoomLabel, #statBox").allTextContents();
  const modeBefore = await page.locator("#topVisual").getAttribute("class");
  const downloadPromise = page.waitForEvent("download");
  await page.locator(button).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(filename);
  expect(await page.locator("#pageLabel, #zoomLabel, #statBox").allTextContents()).toEqual(before);
  expect(await page.locator("#topVisual").getAttribute("class")).toBe(modeBefore);
}

test("downloads visual and text PNG/PDF without changing the view", async ({ page }) => {
  await page.goto("/");
  await page.locator("#fileOld").setInputFiles(fixture("old.pdf"));
  await page.locator("#fileNew").setInputFiles(fixture("new.pdf"));
  await page.locator("#run").click();
  await expect(page.locator("#status")).toContainText("差分");

  await expectDownload(page, "#dlPng", "diff_p1.png");
  await expectDownload(page, "#dlPdf", "diff.pdf");

  await page.locator("#topText").click();
  await page.locator("#runText").click();
  await expect(page.locator("#textStatus")).toHaveText("テキスト差分を表示中");
  await expectDownload(page, "#dlTextPng", "textdiff_p1.png");
  await expectDownload(page, "#dlTextPdf", "textdiff.pdf");
});
```

- [ ] **Step 6: 回帰確認してコミットする**

```powershell
npm.cmd run test
npm.cmd run test:e2e
npm.cmd run build
git add src/features/export src/legacy-app.js tests
git diff --cached --check
git commit -m "refactor: isolate export pipeline"
```

---

### Task 14: Composition root、エラー処理、文書、最終回帰

**Files:**
- Create: `src/app/dom.js`
- Create: `src/app/error-reporter.js`
- Create: `src/app/bind-controls.js`
- Create: `src/app/create-app.js`
- Modify: `src/main.js`
- Delete: `src/legacy-app.js`
- Modify: `README.md`
- Modify: `local/図面差分ビューア_仕様書.md`
- Modify: `index.html`
- Create: `tests/unit/dependency-boundaries.test.js`
- Modify: `playwright.config.js`

**Interfaces:**
- Produces: `collectDom(document)`, `createErrorReporter(dom,console)`, `createApp({document,window})`, `main.js` composition root。

- [ ] **Step 1: 依存境界とlegacy削除の失敗テストを書く**

Create `tests/unit/dependency-boundaries.test.js`:

```js
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";

async function filesUnder(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  }))).flat();
}

test("core imports neither app, features, platform nor browser globals", async () => {
  for (const path of await filesUnder("src/core")) {
    const source = await readFile(path, "utf8");
    expect(source).not.toMatch(/from\s+["'][^"']*(app|features|platform)\//);
    expect(source).not.toMatch(/\b(document|window|pdfjsLib)\b/);
  }
});

test("migration bridge has been removed", async () => {
  const files = await filesUnder("src");
  expect(files.map((path) => path.replaceAll("\\", "/"))).not.toContain("src/legacy-app.js");
});
```

- [ ] **Step 2: テストがlegacy fileで失敗することを確認する**

```powershell
npm.cmd run test -- tests/unit/dependency-boundaries.test.js
```

Expected: `src/legacy-app.js` still exists.

- [ ] **Step 3: DOM収集とエラー表示を実装する**

`collectDom(document)` returns a frozen object with all IDs used by controllers and throws `Error("Missing required element: <id>")` for a missing element.

`createErrorReporter` exposes:

```js
return {
  user(message) { dom.status.textContent = message; },
  report(error, message) {
    logger.error(error);
    dom.status.textContent = message;
  },
};
```

Text-specific operations pass `dom.textStatus` as their status target rather than reaching into the reporter from core.

- [ ] **Step 4: `createApp` を唯一の組立場所にする**

Create `src/app/bind-controls.js` with one exported `bindControls(controllers)` function.
Move every remaining `addEventListener` call into that function and call only the public methods of the owning controller.

Create `src/app/create-app.js`:

```js
export function createApp({ document, window }) {
  const dom = collectDom(document);
  const state = createAppState();
  const errorReporter = createErrorReporter(dom, console);
  let boxEditorController;
  let visualController;
  const documentController = createDocumentController({
    state,
    dom,
    pdf: pdfjsLib,
    errorReporter,
    onReady: () => visualController?.documentsReady(),
  });
  const viewerController = createViewerController({
    state,
    dom,
    window,
    onTransform: () => boxEditorController?.draw(),
  });
  boxEditorController = createBoxEditorController({
    state,
    dom,
    view: viewerController,
    confirmDiscard: () => window.confirm("手編集した変更枠があります。この操作で破棄されます。よろしいですか？"),
  });
  visualController = createVisualController({
    state,
    dom,
    renderDiffPage,
    renderTogglePage,
    drawBoxes: () => boxEditorController.draw(),
  });
  const textController = createTextController({
    state,
    dom,
    extractPageTokens,
    renderer: {
      renderPage: renderTextPage,
      renderOffscreen: renderTextPageOffscreen,
    },
    errorReporter,
  });
  const pdfExporter = createPdfExporter({ jsPDF });
  const exportController = createExportController({
    state,
    dom,
    renderVisualOffscreen: visualController.renderOffscreen,
    renderTextOffscreen: textController.renderOffscreen,
    pdfExporter,
    download: downloadBlob,
    errorReporter,
  });

  bindControls({ state, dom, documentController, visualController, viewerController, boxEditorController, textController, exportController });
  return Object.freeze({ state, documentController, visualController, textController, exportController });
}
```

Create `src/main.js` so it imports CSS and calls `createApp({document,window})` after imports.
Move the remaining event binding and small UI helpers from `legacy-app.js` into `create-app.js` or the owning controller, then delete `legacy-app.js`.

- [ ] **Step 5: READMEと正式仕様書を更新する**

README must contain exact commands:

```text
npm ci
npm run dev
npm run test
npm run test:e2e
npm run build
npm run preview
```

Replace Cloudflare Pages settings with:

```text
Build command: npm run build
Build output directory: dist
Production branch: main
```

Update the formal specification sections 3 and 9 from single-file/no-build operation to Vite source modules and `dist/` static deployment.
Retain the browser-only privacy requirement and note that runtime CDN access is no longer required.

- [ ] **Step 6: 全ブラウザ最終回帰を有効にする**

Extend `playwright.config.js` projects:

```js
projects: [
  { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  { name: "webkit", use: { ...devices["Desktop Safari"] } },
],
```

Run:

```powershell
npx.cmd playwright install chromium firefox webkit
npm.cmd run test
npm.cmd run test:e2e
npm.cmd run build
```

Expected: all Vitest suites and Chromium, Firefox, WebKit Playwright projects pass; `dist/` contains no source maps unless explicitly enabled and contains no CDN URLs.

- [ ] **Step 7: ソース構造を機械確認する**

```powershell
rg -n "<style|<script" index.html
rg -n "cdnjs|jsdelivr" index.html src dist
rg -n "window\.(pdfjsLib|jspdf)|\bdiff_match_patch\b" src
rg -n "from [\"'][^\"']*(app|features|platform)/" src/core
```

Expected: all commands return no matches except the module script search may show `/src/main.js` only.

- [ ] **Step 8: 実サンプルPDFで受入確認する**

Using the existing ignored files under `local/`, verify manually:

```text
1. 旧版と新版を読み込み、各ページの差分を表示する。
2. DPI、しきい値、許容差を変更し、手編集枠の破棄確認を確認する。
3. 自動位置合わせ、90度回転、手動移動、回転、縮尺を確認する。
4. ページ整列とUndoを確認する。
5. 変更枠の追加、移動、リサイズ、削除、Undoを確認する。
6. 差分と新旧切替を同じズーム位置で確認する。
7. テキスト比較、ページ送り、同期ズームを確認する。
8. 図面PNG、図面PDF、テキストPNG、テキストPDFを開いて内容を確認する。
9. ブラウザのNetworkパネルでPDFファイルの外部送信がないことを確認する。
```

- [ ] **Step 9: 最終コミット前の差分を確認する**

```powershell
git status --short
git diff --check
git diff --stat
git diff -- index.html README.md src tests package.json vite.config.js playwright.config.js
```

Confirm that ignored `local/` samples, `.playwright-mcp/`, editor settings, and unrelated `.gitignore` changes are not staged.

- [ ] **Step 10: 最終コミットを作る**

```powershell
git add index.html README.md src tests package.json package-lock.json vite.config.js vitest.config.js playwright.config.js
git diff --cached --check
git commit -m "refactor: complete modular application structure"
```

`local/図面差分ビューア_仕様書.md` は `.gitignore` の方針どおりローカル更新だけに留め、最終報告で更新済みであることを明記する。

---

## Final Acceptance Checklist

- [ ] `index.html` contains no inline CSS or inline application JavaScript.
- [ ] `src/legacy-app.js` no longer exists.
- [ ] `src/core` imports no `app`, `features`, `platform`, DOM, Canvas element, or pdf.js APIs.
- [ ] Feature modules do not import one another; `create-app.js` coordinates them.
- [ ] All runtime library versions and development tool versions are exact in `package.json` and `package-lock.json`.
- [ ] Production output contains pdf.js Worker, CMap, and standard font assets locally.
- [ ] Production output contains no cdnjs or jsDelivr runtime URL.
- [ ] Visual and text stale-render tests pass.
- [ ] Cache invalidation matrix has direct unit coverage.
- [ ] Export tests prove that screen state and box caches are unchanged.
- [ ] Chromium, Firefox, and WebKit browser suites pass.
- [ ] `npm.cmd run build` produces a deployable `dist/` directory.
- [ ] README and the formal specification describe the Vite workflow and Cloudflare `dist/` deployment.
- [ ] The manual real-PDF checklist passes without an intentional behavior change.
