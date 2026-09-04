# 図面比較・左右表示モード Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 図面比較へ旧版と位置合わせ済み新版を同期表示する第3モード「左右表示」を追加し、同じ構成でPNG/PDFを保存できるようにする。

**Architecture:** 既存の `prepareVisualPage` とWorkerレーンを再利用し、左右表示専用レンダラーが同一寸法の旧版・新版Canvasを生成する。単一Canvasビューアは維持し、左右表示には共有 `{scale, tx, ty}` を2枚へ適用する専用コントローラーを追加する。画面描画と全ページ出力は既存の対話レーン／出力レーンを分離したまま実行する。

**Tech Stack:** Vanilla JavaScript ES Modules、Vite 8.2.1、pdf.js 3.11.174、jsPDF 2.5.1、Vitest 4.1.10、Playwright 1.62.1、Canvas 2D、Pointer Events

## Global Constraints

- PDF、差分結果、ログを外部送信しない。処理はブラウザ内で完結させる。
- 既存の「差分」「新旧切替」「テキスト比較」を残し、「左右表示」を第3モードとして追加する。
- 左右表示は左をOLD、右を位置合わせ済みNEWとし、変更枠を両側へ常時表示する。
- 左右表示中は変更枠を編集できないが、差分モードで手編集した枠は左右と出力へ反映する。
- ズーム、パン、全体、1:1、ページ送りは左右で同期する。
- PNGは現在ページ、PDFは全ページをフル解像度の横並びで保存する。
- 単一CanvasのCSS transformとフル解像度出力の分離を維持する。
- 描画世代、文書世代、変更枠revisionで古い非同期結果を拒否する。
- 対話描画とPDF出力は別Workerレーンを使い、互いをキャンセルしない。
- 実装変更時に `index.html` の更新日を `2026-09-04` にする。

---

## File map

**Create**

- `src/core/change-boxes/draw.js`: フル解像度Canvasへ変更枠を描く純粋な描画関数。
- `src/features/visual-diff/split-renderer.js`: 共通フレームの旧版／新版を生成し、欠落表示と枠を描く。
- `src/features/viewer/split-viewer-controller.js`: 左右Canvasの同期ズーム／パン／フィットを管理する。
- `tests/unit/change-box-draw.test.js`: 変更枠描画の単体テスト。
- `tests/unit/split-renderer.test.js`: 左右レンダラーの単体テスト。
- `tests/unit/split-viewer-controller.test.js`: 同期ビューポートの単体テスト。
- `tests/e2e/visual-side-by-side.spec.js`: 左右表示の受け入れE2E。

**Modify**

- `src/app/state.js`: `visual.splitCache` と `visual.splitView` を追加する。
- `src/app/invalidation.js`: ページ描画条件変更時に `splitCache` を破棄する。
- `src/features/visual-diff/visual-renderer.js`: rawページキャッシュ識別子を新旧切替と左右表示で共有可能にする。
- `src/features/visual-diff/toggle-renderer.js`: 汎用化したrawキャッシュ関数名を使う。
- `src/features/visual-diff/visual-controller.js`: `split`レンダラー選択と左右Canvasの原子的コミットを追加する。
- `src/features/box-editor/box-editor-controller.js`: 左右表示中の編集と強調切替を防御的に拒否する。
- `src/features/box-editor/box-editor-view.js`: 左右表示中のボタン状態を固定する。
- `src/features/text-review/text-controller.js`: テキスト表示時に左右表示パネルも隠し、図面へ戻る際に正しい表面を復元する。
- `src/features/export/image-composer.js`: 横並び出力合成を追加し、変更枠描画を共有関数へ移す。
- `src/features/export/export-controller.js`: 左右表示PNG/PDFの分岐と固定スナップショットを追加する。
- `src/app/dom.js`: 左右表示DOMを収集する。
- `src/app/bind-controls.js`: 第3ボタン、左右ペイン、モード別ズーム委譲を結線する。
- `src/app/create-app.js`: 新レンダラー／ビューアを生成し、モード遷移と出力レーンへ注入する。
- `index.html`: 第3ボタン、左右ペイン、2枚のCanvas、更新日を追加する。
- `src/styles/viewer.css`: 左右ペインとラベルを定義する。
- `src/styles/controls.css`: 左右表示中の強調固定・編集無効状態を示す。
- `README.md`: 左右表示、同期操作、編集制約、出力を説明する。
- `local/図面差分ビューア_仕様書.md`: §5.2〜5.5と変更履歴を更新する。`local/` はgitignore対象のためコミットには含めない。
- 既存の関連Vitest／Playwrightファイル: 状態、無効化、DOM、イベント、controller、出力、回帰ケースを追加する。

---

### Task 1: 左右表示の状態と無効化契約

**Files:**
- Modify: `src/app/state.js`
- Modify: `src/app/invalidation.js`
- Test: `tests/unit/state.test.js`
- Test: `tests/unit/invalidation.test.js`

**Interfaces:**
- Produces: `state.visual.splitCache: null | SplitRawCache`
- Produces: `state.visual.splitView: { scale:number, tx:number, ty:number }`
- Consumes: 既存の `clearVisualDerived(state, flags)` と各invalidate関数

- [ ] **Step 1: 失敗する状態テストを追加する**

```js
test("creates independent split visual state", () => {
  const first = createAppState();
  const second = createAppState();

  expect(first.visual.splitCache).toBeNull();
  expect(first.visual.splitView).toEqual({ scale: 1, tx: 0, ty: 0 });
  first.visual.splitView.tx = 12;
  expect(second.visual.splitView).toEqual({ scale: 1, tx: 0, ty: 0 });
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run tests/unit/state.test.js`

Expected: `splitView` または `splitCache` が未定義のためFAIL。

- [ ] **Step 3: 最小の状態を追加する**

```js
visual: {
  mode: "diff",
  toggleSide: "old",
  toggleCache: null,
  splitCache: null,
  splitView: { scale: 1, tx: 0, ty: 0 },
  pageCache: new Map(),
  alignmentCache: new Map(),
  quadrantCache: new Map(),
  renderGeneration: 0,
  quadrantGeneration: 0,
  rendered: false,
  currentPlan: null,
},
```

- [ ] **Step 4: 失敗する無効化テストを追加する**

```js
test.each([
  ["documents", invalidateDocuments],
  ["page alignment", invalidatePageAlignment],
  ["dpi", invalidateDpi],
])("%s invalidation clears split raw pages", (_label, invalidate) => {
  const state = createAppState();
  state.visual.splitCache = { idx: 0 };
  invalidate(state);
  expect(state.visual.splitCache).toBeNull();
});

test.each([
  ["threshold", invalidateThreshold],
  ["tolerance", invalidateTolerance],
  ["manual alignment", invalidateManualAlignment],
])("%s invalidation keeps raster pages reusable", (_label, invalidate) => {
  const state = createAppState();
  const cache = { idx: 0 };
  state.visual.splitCache = cache;
  invalidate(state);
  expect(state.visual.splitCache).toBe(cache);
});
```

- [ ] **Step 5: ページラスタ条件変更時だけsplitCacheを破棄する**

```js
if (pageRendering) {
  state.visual.toggleCache = null;
  state.visual.splitCache = null;
  state.visual.currentPlan = null;
}
```

- [ ] **Step 6: 対象テストを通す**

Run: `npx vitest run tests/unit/state.test.js tests/unit/invalidation.test.js`

Expected: 対象テストがすべてPASS。

- [ ] **Step 7: コミットする**

```bash
git add src/app/state.js src/app/invalidation.js tests/unit/state.test.js tests/unit/invalidation.test.js
git commit -m "feat: add split visual state"
```

---

### Task 2: フル解像度の変更枠描画を共有化

**Files:**
- Create: `src/core/change-boxes/draw.js`
- Modify: `src/features/export/image-composer.js`
- Create: `tests/unit/change-box-draw.test.js`
- Modify: `tests/unit/image-composer.test.js`

**Interfaces:**
- Produces: `drawChangeBoxes(context, boxes, dpi): void`
- Consumes: `{x:number,y:number,w:number,h:number}[]`
- Constraint: 入力Canvasとboxesを変更しない

- [ ] **Step 1: 失敗する描画テストを書く**

```js
test("draws dpi-scaled boxes without mutating input", () => {
  const boxes = [{ x: 1, y: 2, w: 10, h: 12 }];
  const context = {
    save: vi.fn(), restore: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(),
  };

  drawChangeBoxes(context, boxes, 150);

  expect(context.save).toHaveBeenCalledOnce();
  expect(context.fillStyle).toBe("rgba(255,149,0,0.18)");
  expect(context.strokeStyle).toBe("#ff9500");
  expect(context.lineWidth).toBe(3);
  expect(context.strokeRect).toHaveBeenCalledWith(2.5, 3.5, 7, 9);
  expect(boxes).toEqual([{ x: 1, y: 2, w: 10, h: 12 }]);
  expect(context.restore).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run tests/unit/change-box-draw.test.js`

Expected: `drawChangeBoxes` が存在しないためFAIL。

- [ ] **Step 3: 共有描画関数を実装する**

```js
const BOX_COLOR = "#ff9500";
const BOX_FILL = "rgba(255,149,0,0.18)";
const BOX_BASE_DPI = 150;

export function drawChangeBoxes(context, boxes = [], dpi = BOX_BASE_DPI) {
  if (!boxes.length) return;
  const lineWidth = Math.max(2, Math.round(3 * dpi / BOX_BASE_DPI));
  context.save();
  context.fillStyle = BOX_FILL;
  context.strokeStyle = BOX_COLOR;
  context.lineWidth = lineWidth;
  for (const box of boxes) {
    context.fillRect(box.x, box.y, box.w, box.h);
    const half = lineWidth / 2;
    context.strokeRect(
      box.x + half,
      box.y + half,
      Math.max(0, box.w - lineWidth),
      Math.max(0, box.h - lineWidth),
    );
  }
  context.restore();
}

export const CHANGE_BOX_STYLE = Object.freeze({ color: BOX_COLOR, fill: BOX_FILL });
```

- [ ] **Step 4: image-composerの既存処理を共有関数へ置換する**

```js
import {
  CHANGE_BOX_STYLE,
  drawChangeBoxes,
} from "../../core/change-boxes/draw.js";

// composeVisualExport 内
drawChangeBoxes(context, boxes, dpi);

export const VISUAL_BOX_STYLE = CHANGE_BOX_STYLE;
```

- [ ] **Step 5: 既存出力の画素契約を確認する**

Run: `npx vitest run tests/unit/change-box-draw.test.js tests/unit/image-composer.test.js tests/unit/dependency-boundaries.test.js`

Expected: 新規テストと既存出力テストがPASS。

- [ ] **Step 6: コミットする**

```bash
git add src/core/change-boxes/draw.js src/features/export/image-composer.js tests/unit/change-box-draw.test.js tests/unit/image-composer.test.js
git commit -m "refactor: share change box drawing"
```

---

### Task 3: 左右ページレンダラー

**Files:**
- Create: `src/features/visual-diff/split-renderer.js`
- Modify: `src/features/visual-diff/visual-renderer.js`
- Modify: `src/features/visual-diff/toggle-renderer.js`
- Create: `tests/unit/split-renderer.test.js`
- Modify: `tests/integration/visual-controller.test.js`

**Interfaces:**
- Produces: `renderSplitPage(snapshot, dependencies, {onProgress}): Promise<SplitRenderResult>`
- Produces: `SplitRenderResult.sideCanvases = { old:HTMLCanvasElement, new:HTMLCanvasElement }`
- Produces: `SplitRenderResult.splitCache` は枠を描いていないrawページだけを保持
- Consumes: `prepareVisualPage`、`computeChangeBoxesAligned`、`drawChangeBoxes`

- [ ] **Step 1: rawキャッシュ関数名の回帰テストを先に追加する**

```js
test("shares raw page identity without sharing completed toggle identity", () => {
  const snapshot = rendererSnapshot();
  const plan = { oldScale: 1, newScale: 1 };
  const identity = createVisualRawCacheIdentity(snapshot, 0, plan);
  const cache = { idx: 0, rawIdentity: identity };

  expect(visualRawCacheMatchesSnapshot(snapshot, cache, {
    quadrant: 0,
    framePlan: plan,
  })).toBe(true);
  expect(toggleCompletedCacheMatchesSnapshot(snapshot, cache)).toBe(false);
});
```

- [ ] **Step 2: `createToggleRawCacheIdentity` と `toggleRawCacheMatchesSnapshot` を汎用名へ変更する**

```js
export function createVisualRawCacheIdentity(snapshot, quadrant, framePlan) {
  return Object.freeze({
    documentGeneration: snapshot.documents.generation,
    oldDoc: snapshot.documents.oldDoc,
    newDoc: snapshot.documents.newDoc,
    oldIndex: snapshot.documents.oldSequence[snapshot.pageIndex] ?? null,
    newIndex: snapshot.documents.newSequence[snapshot.pageIndex] ?? null,
    dpi: snapshot.comparison.dpi,
    quadrant,
    framePlan: Object.freeze({ ...framePlan }),
  });
}
```

`toggle-renderer.js` のimportと呼び出しも新しい名前へ揃える。completed identityは新旧切替専用のまま維持する。

- [ ] **Step 3: 失敗する左右レンダラーテストを書く**

```js
test("returns equal frames and draws the same manual boxes on both sides", async () => {
  const snapshot = splitSnapshot({
    manualBoxes: [{ x: 1, y: 0, w: 2, h: 1 }],
    showBoxes: false,
  });
  const rendered = await renderSplitPage(snapshot, dependencies());

  expect([rendered.sideCanvases.old.width, rendered.sideCanvases.old.height])
    .toEqual([rendered.sideCanvases.new.width, rendered.sideCanvases.new.height]);
  expect(rendered.boxes).toEqual([{ x: 1, y: 0, w: 2, h: 1 }]);
  expect(rendered.sideCanvases.old.context.calls).toContainEqual(
    ["strokeRect", "#ff9500", expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number)],
  );
  expect(rendered.sideCanvases.new.context.calls).toContainEqual(
    ["strokeRect", "#ff9500", expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number)],
  );
});

test("computes automatic boxes once and marks a missing side", async () => {
  const deps = dependencies({ oldCanvas: null });
  const rendered = await renderSplitPage(splitSnapshot(), deps);

  expect(deps.computeDiff).toHaveBeenCalledOnce();
  expect(rendered.sideCanvases.old.context.calls)
    .toContainEqual(expect.arrayContaining(["fillText", "この版にこのページはありません"]));
  expect(rendered.autoBoxes).toEqual(rendered.boxes);
});
```

- [ ] **Step 4: 失敗を確認する**

Run: `npx vitest run tests/unit/split-renderer.test.js`

Expected: `split-renderer.js` が存在しないためFAIL。

- [ ] **Step 5: 左右レンダラーを実装する**

```js
import { drawChangeBoxes } from "../../core/change-boxes/draw.js";
import {
  boxStat,
  computeChangeBoxesAligned,
  createVisualRawCacheIdentity,
  prepareVisualPage,
} from "./visual-renderer.js";

function sideFrame(source, width, height, boxes, dpi, dependencies) {
  const canvas = dependencies.createWhiteCanvas(width, height);
  const context = canvas.getContext("2d");
  if (source) {
    context.drawImage(source, 0, 0);
  } else {
    context.fillStyle = "#7f8f9e";
    context.font = "20px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("この版にこのページはありません", width / 2, height / 2);
  }
  drawChangeBoxes(context, boxes, dpi);
  return canvas;
}

export async function renderSplitPage(snapshot, dependencies, { onProgress = null } = {}) {
  const cached = snapshot.visual.splitCache?.idx === snapshot.pageIndex
    ? snapshot.visual.splitCache
    : null;
  const prepared = await prepareVisualPage(snapshot, dependencies, cached, onProgress);
  let boxes = snapshot.boxEditor.manualBoxes || snapshot.boxEditor.autoBoxes;
  let autoBoxes;
  if (!boxes) {
    boxes = await computeChangeBoxesAligned(snapshot, prepared, dependencies, { onProgress });
    autoBoxes = boxes;
  }
  const oldSource = prepared.oldCanvas
    ? sideFrame(prepared.oldCanvas, prepared.width, prepared.height, boxes, snapshot.comparison.dpi, dependencies)
    : sideFrame(null, prepared.width, prepared.height, boxes, snapshot.comparison.dpi, dependencies);
  const newSource = prepared.newCanvas
    ? sideFrame(prepared.alignedNewCanvas, prepared.width, prepared.height, boxes, snapshot.comparison.dpi, dependencies)
    : sideFrame(null, prepared.width, prepared.height, boxes, snapshot.comparison.dpi, dependencies);
  const splitCache = {
    idx: snapshot.pageIndex,
    rawIdentity: createVisualRawCacheIdentity(snapshot, prepared.quadrant, prepared.currentPlan),
    oldCanvas: prepared.oldCanvas,
    newCanvas: prepared.newCanvas,
    alignedNewCanvas: prepared.alignedNewCanvas,
    width: prepared.width,
    height: prepared.height,
  };
  return {
    sideCanvases: { old: oldSource, new: newSource },
    splitCache,
    currentPlan: prepared.currentPlan,
    alignmentCache: prepared.alignmentCache,
    quadrantCache: prepared.quadrantCache,
    quadrantGeneration: snapshot.visual.quadrantGeneration,
    boxes,
    autoBoxes,
    stats: { removed: "削除 —", added: "追加 —", boxes: boxStat(snapshot, boxes) },
    status: "左右表示中",
    pageLabel: dependencies.pageLabelText(snapshot.documents, snapshot.pageIndex),
  };
}
```

実装時は `snapshot.boxEditor.autoBoxes` を `createSnapshot` へ凍結コピーで追加し、`prepareVisualPage` のrawキャッシュ判定を `visualRawCacheMatchesSnapshot` に合わせる。

- [ ] **Step 6: レンダラーと既存新旧切替を通す**

Run: `npx vitest run tests/unit/split-renderer.test.js tests/integration/visual-controller.test.js`

Expected: 左右レンダラーと既存toggleキャッシュテストがPASS。

- [ ] **Step 7: コミットする**

```bash
git add src/features/visual-diff/split-renderer.js src/features/visual-diff/visual-renderer.js src/features/visual-diff/toggle-renderer.js tests/unit/split-renderer.test.js tests/integration/visual-controller.test.js
git commit -m "feat: render aligned side by side pages"
```

---

### Task 4: 左右同期ビューポート

**Files:**
- Create: `src/features/viewer/split-viewer-controller.js`
- Create: `tests/unit/split-viewer-controller.test.js`
- Test: `tests/unit/viewport.test.js`

**Interfaces:**
- Produces: `createSplitViewerController({state,dom})`
- Public methods: `apply`, `fit`, `zoomIn`, `zoomOut`, `zoomOne`, `handleWheel`, `handlePointerDown`, `handlePointerMove`, `handlePointerUp`, `handlePointerCancel`, `handleResize`, `getView`
- Consumes: `state.visual.splitView` と `viewport.js` の `fitViewport` / `zoomAt`

- [ ] **Step 1: 失敗する同期テストを書く**

```js
test("applies one transform to both canvases and fits the smaller wrap", () => {
  const state = createAppState();
  state.ui.topMode = "visual";
  state.visual.mode = "split";
  state.visual.rendered = true;
  const dom = splitDom({ oldWrap: [400, 300], newWrap: [360, 280], canvas: [1000, 800] });
  const controller = createSplitViewerController({ state, dom });

  controller.fit();

  expect(dom.oldCanvas.style.transform).toBe(dom.newCanvas.style.transform);
  expect(controller.getView().scale).toBeCloseTo(Math.min(360 / 1000, 280 / 800) * 0.92);
});

test("zooms and pans from either pane while keeping transforms equal", () => {
  const state = activeSplitState();
  const dom = splitDom({ oldWrap: [400, 300], newWrap: [400, 300], canvas: [1000, 800] });
  const controller = createSplitViewerController({ state, dom });

  controller.handleWheel(dom.newWrap, wheelEvent({ clientX: 100, clientY: 80, deltaY: -1 }));
  controller.handlePointerDown(dom.oldWrap, pointerEvent({ pointerId: 7, clientX: 10, clientY: 20 }));
  controller.handlePointerMove(dom.oldWrap, pointerEvent({ pointerId: 7, clientX: 40, clientY: 60 }));

  expect(dom.oldCanvas.style.transform).toBe(dom.newCanvas.style.transform);
  expect(controller.getView()).toMatchObject({ tx: expect.any(Number), ty: expect.any(Number) });
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run tests/unit/split-viewer-controller.test.js`

Expected: module not foundでFAIL。

- [ ] **Step 3: 同期コントローラーを実装する**

```js
import { fitViewport, zoomAt } from "./viewport.js";

export function createSplitViewerController({ state, dom }) {
  let view = { ...state.visual.splitView };
  let pan = null;
  const canvases = [dom.oldCanvas, dom.newCanvas];
  const wraps = [dom.oldWrap, dom.newWrap];
  const active = () => state.ui.topMode === "visual"
    && state.visual.mode === "split"
    && state.visual.rendered;
  const copy = () => ({ ...view });

  function apply(next = view) {
    view = { ...next };
    state.visual.splitView = copy();
    const transform = `translate(${view.tx}px,${view.ty}px) scale(${view.scale})`;
    for (const canvas of canvases) canvas.style.transform = transform;
    dom.zoomLabel.textContent = `${Math.round(view.scale * 100)}%`;
    return copy();
  }

  function fit() {
    const width = Math.min(...wraps.map(wrap => wrap.clientWidth));
    const height = Math.min(...wraps.map(wrap => wrap.clientHeight));
    const fitted = fitViewport(
      { width: dom.oldCanvas.width, height: dom.oldCanvas.height },
      { width, height },
    );
    return fitted ? apply(fitted) : copy();
  }

  function zoomAtPoint(factor, wrap, event) {
    if (!active()) return copy();
    const rect = wrap.getBoundingClientRect();
    return apply(zoomAt(view, factor, event.clientX - rect.left, event.clientY - rect.top));
  }

  function handleWheel(wrap, event) {
    if (!wraps.includes(wrap) || !active()) return;
    event.preventDefault();
    zoomAtPoint(event.deltaY < 0 ? 1.12 : 1 / 1.12, wrap, event);
  }

  function handlePointerDown(wrap, event) {
    if (!wraps.includes(wrap) || !active() || pan) return;
    pan = {
      owner: wrap, pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY,
      startTx: view.tx, startTy: view.ty,
    };
    wrap.classList.add("panning");
    wrap.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(_wrap, event) {
    if (!pan || event.pointerId !== pan.pointerId) return;
    apply({
      ...view,
      tx: pan.startTx + event.clientX - pan.startX,
      ty: pan.startTy + event.clientY - pan.startY,
    });
  }

  function cancelPan(event) {
    if (!pan || (event?.pointerId != null && event.pointerId !== pan.pointerId)) return;
    const { owner, pointerId } = pan;
    pan = null;
    owner.classList.remove("panning");
    try { owner.releasePointerCapture(pointerId); } catch (_) { /* capture may be gone */ }
  }

  const zoomCenter = factor => {
    const wrap = dom.oldWrap;
    return zoomAtPoint(factor, wrap, {
      clientX: wrap.getBoundingClientRect().left + wrap.clientWidth / 2,
      clientY: wrap.getBoundingClientRect().top + wrap.clientHeight / 2,
    });
  };

  return {
    apply, fit, getView: copy,
    zoomIn: () => zoomCenter(1.25),
    zoomOut: () => zoomCenter(1 / 1.25),
    zoomOne: () => zoomCenter(1 / view.scale),
    cancelPan,
    handleWheel, handlePointerDown, handlePointerMove,
    handlePointerUp: (_wrap, event) => cancelPan(event),
    handlePointerCancel: (_wrap, event) => cancelPan(event),
    handleResize: () => apply(),
  };
}
```

- [ ] **Step 4: 境界値とpointer captureのテストを追加して通す**

Run: `npx vitest run tests/unit/split-viewer-controller.test.js tests/unit/viewport.test.js`

Expected: 5%〜4000%制限、左右イベント、release所有者、fit、1:1がPASS。

- [ ] **Step 5: コミットする**

```bash
git add src/features/viewer/split-viewer-controller.js tests/unit/split-viewer-controller.test.js
git commit -m "feat: synchronize side by side viewport"
```

---

### Task 5: DOM・イベント・モード遷移・原子的コミット

**Files:**
- Modify: `index.html`
- Modify: `src/styles/viewer.css`
- Modify: `src/styles/controls.css`
- Modify: `src/app/dom.js`
- Modify: `src/app/bind-controls.js`
- Modify: `src/app/create-app.js`
- Modify: `src/features/visual-diff/visual-controller.js`
- Modify: `src/features/box-editor/box-editor-controller.js`
- Modify: `src/features/box-editor/box-editor-view.js`
- Modify: `src/features/text-review/text-controller.js`
- Test: `tests/unit/dom-error-reporter.test.js`
- Test: `tests/unit/bind-controls.test.js`
- Test: `tests/integration/create-app.test.js`
- Test: `tests/integration/visual-controller.test.js`
- Test: `tests/integration/box-editor-controller.test.js`
- Test: `tests/unit/box-editor-view.test.js`
- Test: `tests/integration/text-controller.test.js`

**Interfaces:**
- Produces DOM IDs: `modeSplit`, `visualSplitPanel`, `splitOldCanvas`, `splitNewCanvas`
- Produces DOM selectors: `.visual-split-pane.old .visual-split-canvas-wrap` と `.visual-split-pane.new .visual-split-canvas-wrap`
- Produces app handler: `appController.setSplitMode()`
- `createVisualController` consumes `renderSplitPage` and commits `sideCanvases` only after ticket validation

- [ ] **Step 1: DOMとイベントの失敗テストを追加する**

```js
dom.modeSplit.emit("click");
expect(appController.setSplitMode).toHaveBeenCalledOnce();

dom.splitNewWrap.emit("wheel", move);
expect(splitViewerController.handleWheel).toHaveBeenCalledWith(dom.splitNewWrap, move);

windowTarget.emit("resize");
expect(splitViewerController.handleResize).toHaveBeenCalledOnce();
```

`tests/integration/create-app.test.js` の `ids` と `querySelector` mapにも新要素を追加し、`createSplitViewerController` と `renderSplitPage` の依存注入を検証する。

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run tests/unit/dom-error-reporter.test.js tests/unit/bind-controls.test.js tests/integration/create-app.test.js`

Expected: 新DOMと依存が未定義のためFAIL。

- [ ] **Step 3: HTMLへ第3モードと左右ペインを追加する**

```html
<button id="modeDiff" class="active" disabled title="差分表示">差分</button>
<button id="modeToggle" disabled title="新旧切替表示">新旧切替</button>
<button id="modeSplit" disabled title="旧版と新版を左右表示">左右表示</button>
```

```html
<div class="visual-split-panel" id="visualSplitPanel" style="display:none">
  <div class="visual-split-pane old">
    <div class="visual-split-pane-label" style="color:var(--removed)">OLD</div>
    <div class="visual-split-canvas-wrap">
      <canvas id="splitOldCanvas" width="10" height="10"></canvas>
    </div>
  </div>
  <div class="visual-split-pane new">
    <div class="visual-split-pane-label" style="color:var(--added)">NEW</div>
    <div class="visual-split-canvas-wrap">
      <canvas id="splitNewCanvas" width="10" height="10"></canvas>
    </div>
  </div>
</div>
```

- [ ] **Step 4: 50/50レイアウトを追加する**

```css
.visual-split-panel{flex:1;display:flex;overflow:hidden;min-height:0}
.visual-split-pane{flex:1 1 50%;display:flex;flex-direction:column;min-width:0;border-right:1px solid var(--line)}
.visual-split-pane:last-child{border-right:none}
.visual-split-pane-label{font-family:var(--mono);font-size:10.5px;letter-spacing:.12em;padding:6px 12px;border-bottom:1px solid var(--line);background:var(--panel)}
.visual-split-canvas-wrap{flex:1;overflow:hidden;position:relative;background:var(--ink);cursor:grab;touch-action:none}
.visual-split-canvas-wrap.panning{cursor:grabbing}
.visual-split-canvas-wrap canvas{position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform;background:#fff;box-shadow:0 8px 40px rgba(0,0,0,.55);image-rendering:crisp-edges}
```

- [ ] **Step 5: controllerの失敗テストを追加する**

```js
test("commits both split canvases atomically and rejects an older split result", async () => {
  const stale = deferred();
  const renderSplitPage = vi.fn(snapshot => (
    snapshot.pageIndex === 0 ? stale.promise : Promise.resolve(splitResult(1))
  ));
  const { state, dom, controller } = harness({ renderSplitPage });
  state.visual.mode = "split";

  const oldPage = controller.showPage(0);
  expect(await controller.showPage(1)).toEqual({ committed: true });
  stale.resolve(splitResult(0));
  expect(await oldPage).toEqual({ committed: false });

  expect(dom.splitOldContext.drawImage).toHaveBeenCalledOnce();
  expect(dom.splitNewContext.drawImage).toHaveBeenCalledOnce();
  expect(state.documents.currentPage).toBe(1);
});
```

- [ ] **Step 6: visual controllerへsplit snapshot・renderer・commitを追加する**

```js
const renderer = mode === "toggle"
  ? renderTogglePage
  : mode === "split"
    ? renderSplitPage
    : renderDiffPage;
```

```js
function commitSplitCanvases(sideCanvases) {
  for (const [side, target] of [["old", dom.splitOldCanvas], ["new", dom.splitNewCanvas]]) {
    const source = sideCanvases[side];
    target.width = source.width;
    target.height = source.height;
    const context = target.getContext("2d");
    context.clearRect(0, 0, target.width, target.height);
    context.drawImage(source, 0, 0);
  }
  dom.out.style.display = "none";
  dom.visualSplitPanel.style.display = "flex";
  dom.placeholder.style.display = "none";
}
```

`commitResult` は `snapshot.mode === "split"` のときだけこの関数を使い、`result.splitCache`、boxes、stats、pageLabelを同じticket内で更新する。片側をawaitの前にDOMへ描かない。

- [ ] **Step 7: モード遷移と操作委譲を実装する**

```js
async setSplitMode() {
  if (state.visual.mode === "split" || !state.visual.rendered) return;
  boxEditorController.setEditMode(false);
  state.visual.mode = "split";
  setModeUi();
  const shown = await visualController.showPage(state.documents.currentPage);
  if (shown.committed) splitViewerController.fit();
},
```

`setDiffMode` と `setToggleMode` も `out.style.display` に依存する `hasImage()` ではなく `state.visual.rendered` を遷移条件にする。splitでは `out` が非表示になるため、この変更がないとsplitから既存モードへ戻れない。モード切替時は遷移元viewerのpanを `cancelPan()` で終了する。

共通ズームボタンは `state.visual.mode === "split" ? splitViewerController : viewerController` へ委譲する。左右wrapperのwheel/pointerはsplit viewerだけへ渡し、単一Canvasのbox pointer handlerへ渡さない。

- [ ] **Step 8: 左右表示中の変更枠操作をcontrollerでも拒否する**

```js
function setEditMode(on) {
  if (on && (state.visual.mode === "split" || !state.visual.rendered)) return false;
  // existing body
}

function toggleBoxes() {
  if (state.visual.mode === "split" || !state.visual.rendered) return false;
  // existing body
}
```

`box-editor-view.js` はsplit中 `boxToggle` をactiveかつdisabled、`boxEdit` をdisabledにし、`showBoxes` 自体は変更しない。

- [ ] **Step 9: テキスト表示との排他を実装する**

`text-controller.js` へ `visualSplitPanel` と `restoreVisualSurface` callbackを渡す。text遷移時は単一Canvasとsplit panelを隠し、visual復帰時はcallbackが現在のvisual modeに対応する表面だけを復元する。

```js
if (visual) {
  dom.restoreVisualSurface?.();
  return true;
}
dom.out.style.display = "none";
dom.visualSplitPanel.style.display = "none";
```

- [ ] **Step 10: 対象テストを通す**

Run: `npx vitest run tests/unit/dom-error-reporter.test.js tests/unit/bind-controls.test.js tests/integration/create-app.test.js tests/integration/visual-controller.test.js tests/integration/box-editor-controller.test.js tests/unit/box-editor-view.test.js tests/integration/text-controller.test.js`

Expected: DOM、イベント、原子的commit、編集禁止、text往復がPASS。

- [ ] **Step 11: コミットする**

```bash
git add index.html src/styles/viewer.css src/styles/controls.css src/app/dom.js src/app/bind-controls.js src/app/create-app.js src/features/visual-diff/visual-controller.js src/features/box-editor/box-editor-controller.js src/features/box-editor/box-editor-view.js src/features/text-review/text-controller.js tests/unit/dom-error-reporter.test.js tests/unit/bind-controls.test.js tests/integration/create-app.test.js tests/integration/visual-controller.test.js tests/integration/box-editor-controller.test.js tests/unit/box-editor-view.test.js tests/integration/text-controller.test.js
git commit -m "feat: add side by side visual mode"
```

---

### Task 6: 横並びPNG合成と保存

**Files:**
- Modify: `src/features/export/image-composer.js`
- Modify: `src/features/export/export-controller.js`
- Modify: `src/app/create-app.js`
- Test: `tests/unit/image-composer.test.js`
- Test: `tests/integration/export-controller.test.js`

**Interfaces:**
- Produces: `composeVisualSplitExport({oldCanvas,newCanvas,pageIndex,total,dpi})`
- Produces filename: `side-by-side_p{n}.png`
- Consumes: DOM上の枠描画済み `splitOldCanvas` / `splitNewCanvas`

- [ ] **Step 1: 失敗する横並び合成テストを書く**

```js
test("composes OLD and NEW horizontally with page label without touching sources", () => {
  const oldCanvas = new RecordingCanvas(40, 20, new Array(3200).fill(7));
  const newCanvas = new RecordingCanvas(40, 20, new Array(3200).fill(9));
  const oldPixels = [...oldCanvas.pixels];
  const newPixels = [...newCanvas.pixels];

  const result = composeVisualSplitExport({
    oldCanvas, newCanvas, pageIndex: 1, total: 3, dpi: 72,
  });

  expect([result.width, result.height]).toEqual([81, 48]);
  expect(result.context.calls).toContainEqual(["fillText", "#ff5b57", "OLD", 4, 14]);
  expect(result.context.calls).toContainEqual(["fillText", "#4d8dff", "NEW", 45, 14]);
  expect(result.context.calls).toContainEqual(["fillText", "#333", "p 2 / 3", 77, 14]);
  expect(oldCanvas.pixels).toEqual(oldPixels);
  expect(newCanvas.pixels).toEqual(newPixels);
});
```

72 DPIではラベル帯28px、中央間隔1pxとする。高DPIではそれぞれ `Math.max(1, Math.round(pt * dpi / 72))` で比例させる。

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run tests/unit/image-composer.test.js`

Expected: `composeVisualSplitExport` が存在しないためFAIL。

- [ ] **Step 3: 横並び合成を実装する**

```js
export function composeVisualSplitExport({
  oldCanvas,
  newCanvas,
  pageIndex,
  total,
  dpi,
}) {
  const reference = oldCanvas || newCanvas;
  if (!reference) throw new Error("左右表示の出力元Canvasがありません");
  const width = Math.max(oldCanvas?.width || 0, newCanvas?.width || 0, 1);
  const height = Math.max(oldCanvas?.height || 0, newCanvas?.height || 0, 1);
  const labelHeight = Math.max(1, Math.round(28 * dpi / 72));
  const gap = Math.max(1, Math.round(dpi / 72));
  const canvas = whiteCanvas(reference, width * 2 + gap, labelHeight + height);
  const context = canvas.getContext("2d");
  context.font = `bold ${Math.max(12, Math.round(16 * dpi / 72))}px sans-serif`;
  context.textBaseline = "middle";
  context.textAlign = "left";
  context.fillStyle = "#ff5b57";
  context.fillText("OLD", 4, labelHeight / 2);
  context.fillStyle = "#4d8dff";
  context.fillText("NEW", width + gap + 4, labelHeight / 2);
  context.fillStyle = "#333";
  context.textAlign = "right";
  context.fillText(`p ${pageIndex + 1} / ${total}`, canvas.width - 4, labelHeight / 2);
  if (oldCanvas) context.drawImage(oldCanvas, 0, labelHeight);
  if (newCanvas) context.drawImage(newCanvas, width + gap, labelHeight);
  return canvas;
}
```

- [ ] **Step 4: PNG分岐の失敗テストを書く**

```js
test("saves the committed split page with a stable filename and frozen page number", async () => {
  const { state, dom, dependencies, controller } = harness();
  state.visual.mode = "split";
  dom.splitOldCanvas = canvas(100, 200);
  dom.splitNewCanvas = canvas(100, 200);

  const saving = controller.saveVisualPng();
  state.documents.currentPage = 1;
  await saving;

  expect(dependencies.download)
    .toHaveBeenCalledWith(expect.any(Blob), "side-by-side_p1.png");
});
```

- [ ] **Step 5: export controllerへPNG分岐を追加する**

```js
if (snapshot.visual.mode === "split") {
  const composed = composeVisualSplitExport({
    oldCanvas: dom.splitOldCanvas,
    newCanvas: dom.splitNewCanvas,
    pageIndex: snapshot.documents.currentPage,
    total: snapshot.documents.pages,
    dpi: snapshot.comparison.dpi,
  });
  const blob = await toBlob(composed);
  await download(blob, `side-by-side_p${snapshot.documents.currentPage + 1}.png`);
  setOwnedStatus(session, session.prior.text);
  return true;
}
```

- [ ] **Step 6: PNGと既存出力テストを通す**

Run: `npx vitest run tests/unit/image-composer.test.js tests/integration/export-controller.test.js`

Expected: split PNGと既存diff/toggle/text出力がPASS。

- [ ] **Step 7: コミットする**

```bash
git add src/features/export/image-composer.js src/features/export/export-controller.js src/app/create-app.js tests/unit/image-composer.test.js tests/integration/export-controller.test.js
git commit -m "feat: export side by side png"
```

---

### Task 7: 全ページ左右表示PDF

**Files:**
- Modify: `src/features/export/export-controller.js`
- Modify: `src/app/create-app.js`
- Test: `tests/integration/export-controller.test.js`
- Test: `tests/unit/pdf-exporter.test.js`
- Test: `tests/unit/worker-lane.test.js`

**Interfaces:**
- `createVisualRenderSession()` produces `renderDiff({renderSnapshot})` と `renderSplit({renderSnapshot})`
- Split PDF filename: `side-by-side.pdf`
- Split PDF page source: `composeVisualSplitExport(result.sideCanvases...)`

- [ ] **Step 1: 失敗するsplit PDFテストを書く**

```js
test("renders every split PDF page on the export session without mutating screen state", async () => {
  const { state, dom, dependencies, controller } = harness();
  state.visual.mode = "split";
  const before = protectedReferences(state, dom);
  dependencies.renderVisualSplitOffscreen = vi.fn(async ({ pageIndex }) => ({
    sideCanvases: { old: canvas(100, 200), new: canvas(100, 200) },
    boxes: [{ x: pageIndex, y: 0, w: 2, h: 2 }],
  }));

  await controller.saveVisualPdf();

  expect(dependencies.renderVisualSplitOffscreen).toHaveBeenCalledTimes(2);
  expect(dependencies.pdfExporter.saveVisual).toHaveBeenCalledWith(
    expect.objectContaining({ filename: "side-by-side.pdf", pageCount: 2 }),
  );
  expect({ ...protectedReferences(state, dom), status: before.status }).toEqual(before);
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run tests/integration/export-controller.test.js`

Expected: export sessionに `renderSplit` がないためFAIL。

- [ ] **Step 3: 出力レーンのsessionへsplit rendererを追加する**

```js
createVisualRenderSession: () => {
  const dependencies = exportRenderDependencies();
  return Object.freeze({
    renderDiff: ({ renderSnapshot }) => deps.renderDiffPage(renderSnapshot, dependencies),
    renderSplit: ({ renderSnapshot }) => deps.renderSplitPage(renderSnapshot, dependencies),
    cancel: () => exportLane.cancel(),
  });
},
```

- [ ] **Step 4: PDFのモード分岐を実装する**

```js
const split = snapshot.visual.mode === "split";
await pdfExporter.saveVisual({
  pageCount: snapshot.documents.pages,
  dpi: snapshot.comparison.dpi,
  filename: split ? "side-by-side.pdf" : "diff.pdf",
  renderPage: async pageIndex => {
    const renderSnapshot = visualRenderSnapshot(snapshot, pageIndex, split ? "split" : "diff");
    if (split) {
      const result = await session.renderSession.renderSplit({ snapshot, pageIndex, renderSnapshot });
      return composeVisualSplitExport({
        ...result.sideCanvases,
        oldCanvas: result.sideCanvases.old,
        newCanvas: result.sideCanvases.new,
        pageIndex,
        total: snapshot.documents.pages,
        dpi: snapshot.comparison.dpi,
      });
    }
    const result = await session.renderSession.renderDiff({ snapshot, pageIndex, renderSnapshot });
    const manual = snapshot.boxEditor.editsByPage.get(pageIndex);
    return composeVisualExport({
      source: result.canvas,
      boxes: snapshot.boxEditor.showBoxes ? (manual ?? result.boxes ?? []) : [],
      legend: visualLegend("diff", snapshot.boxEditor.showBoxes),
      dpi: snapshot.comparison.dpi,
    });
  },
});
```

`visualRenderSnapshot` はmode引数を受け、split時は `showBoxes:true`、`autoBoxes` を凍結コピー、`splitCache:null` として画面キャッシュを使わない。

- [ ] **Step 5: 文書再読込キャンセルとレーン分離を確認する**

Run: `npx vitest run tests/integration/export-controller.test.js tests/unit/pdf-exporter.test.js tests/unit/worker-lane.test.js`

Expected: 全ページsplit出力、横長比率、文書invalidatorによるcancel、interactive lane非干渉がPASS。

- [ ] **Step 6: コミットする**

```bash
git add src/features/export/export-controller.js src/app/create-app.js tests/integration/export-controller.test.js tests/unit/pdf-exporter.test.js
git commit -m "feat: export side by side pdf"
```

---

### Task 8: E2E・文書・全体検証

**Files:**
- Create: `tests/e2e/visual-side-by-side.spec.js`
- Modify: `tests/e2e/baseline.spec.js`
- Modify: `tests/e2e/box-editing.spec.js`
- Modify: `tests/e2e/export.spec.js`
- Modify: `tests/e2e/rendering-lanes.spec.js`
- Modify: `tests/unit/documentation.test.js`
- Modify: `README.md`
- Modify: `local/図面差分ビューア_仕様書.md`
- Modify: `index.html`

**Interfaces:**
- User-visible: 「左右表示」ボタン、OLD/NEWラベル、同期transform
- Downloads: `side-by-side_p1.png`、`side-by-side.pdf`
- Documentation: 同期操作、常時変更枠、編集禁止、ブラウザ内完結

- [ ] **Step 1: 主要E2Eを追加する**

```js
test("reviews aligned drawings side by side with synchronized navigation", async ({ page }) => {
  await loadComparison(page);
  await page.getByRole("button", { name: "差分を表示" }).click();
  await page.getByRole("button", { name: "左右表示" }).click();

  const oldCanvas = page.locator("#splitOldCanvas");
  const newCanvas = page.locator("#splitNewCanvas");
  await expect(page.locator("#visualSplitPanel")).toBeVisible();
  await expect(oldCanvas).toBeVisible();
  await expect(newCanvas).toBeVisible();

  await newCanvas.hover();
  await page.mouse.wheel(0, -120);
  await expect.poll(async () => Promise.all([
    oldCanvas.evaluate(node => node.style.transform),
    newCanvas.evaluate(node => node.style.transform),
  ])).toSatisfy(([oldTransform, newTransform]) => (
    oldTransform === newTransform && oldTransform.includes("scale(")
  ));

  await page.getByRole("button", { name: "1:1" }).click();
  await expect.poll(() => oldCanvas.evaluate(node => node.style.transform))
    .toContain("scale(1)");
});
```

既存fixture helper名へ合わせて `loadComparison` のimportまたはローカルhelperを定義する。ページ送り後もtransformが同じ値で維持されること、モードを `差分 → 新旧切替 → 左右表示 → 差分` と往復できることを同ファイルへ追加する。

- [ ] **Step 2: 変更枠と編集禁止のE2Eを追加する**

差分モードで枠を手編集し、左右表示へ移動後に両Canvasの枠画素が更新されることを確認する。左右表示中は「変更点を強調」がactiveかつdisabled、「枠を編集」がdisabled、Eキーでedit modeへ入らないことを確認し、差分へ戻ると編集可能になることを確認する。

- [ ] **Step 3: PNG/PDFとレーン競合のE2Eを追加する**

```js
const png = page.waitForEvent("download");
await page.getByRole("button", { name: "現在ページをPNG保存" }).click();
expect((await png).suggestedFilename()).toBe("side-by-side_p1.png");

const pdf = page.waitForEvent("download");
await page.getByRole("button", { name: "全ページをPDF保存" }).click();
expect((await pdf).suggestedFilename()).toBe("side-by-side.pdf");
```

PDF生成中にページ送りしても画面描画が成功し、出力がキャンセルされないケースを `rendering-lanes.spec.js` へ追加する。

- [ ] **Step 4: ChromiumでE2Eの失敗を確認して実装漏れを修正する**

Run: `npx playwright test tests/e2e/visual-side-by-side.spec.js tests/e2e/baseline.spec.js tests/e2e/box-editing.spec.js tests/e2e/export.spec.js tests/e2e/rendering-lanes.spec.js --project=chromium`

Expected: 新規ケースを含めすべてPASS。

- [ ] **Step 5: READMEと正式仕様を更新する**

READMEへ次を明記する。

```markdown
- **左右表示**: 図面比較で旧版（左）と位置合わせ済み新版（右）を同時表示します。ズーム、パン、全体表示、1:1、ページ送りは同期します。
- 左右表示では変更枠を両側へ常時表示します。枠の編集は差分表示へ戻って行います。
- 左右表示中のPNG/PDF保存は、旧版と新版をフル解像度で横並びに出力します。
```

`local/図面差分ビューア_仕様書.md` の表示制御、変更枠、出力、変更履歴へ同じ実装済み挙動を記録する。外部送信なしの制約を変更しない。

- [ ] **Step 6: 更新日を変更する**

```html
<span class="sub">PDF OVERLAY DIFF · UPDATED 2026-09-04</span>
```

- [ ] **Step 7: 文書テストと全単体・統合テストを実行する**

Run: `npm test`

Expected: Vitest全件PASS。

- [ ] **Step 8: ビルドと配布物検証を実行する**

Run: `npm run build`

Expected: Vite buildと `tests/verify-dist.mjs` がexit code 0。

- [ ] **Step 9: Chromium E2Eを全件実行する**

Run: `npx playwright test --project=chromium`

Expected: Chromium全件PASS。

- [ ] **Step 10: 全対応ブラウザE2Eを実行する**

Run: `npm run test:e2e`

Expected: Chromium、Firefox、WebKitがすべてPASS。

- [ ] **Step 11: lint診断と差分を確認する**

Run: `git diff --check`

Expected: 出力なし、exit code 0。IDE diagnosticsでも変更ファイルに新規エラーがない。

- [ ] **Step 12: 文書とE2Eをコミットする**

```bash
git add README.md index.html tests/e2e/visual-side-by-side.spec.js tests/e2e/baseline.spec.js tests/e2e/box-editing.spec.js tests/e2e/export.spec.js tests/e2e/rendering-lanes.spec.js tests/unit/documentation.test.js
git commit -m "docs: document side by side review mode"
```

`local/図面差分ビューア_仕様書.md` はgitignore対象のため、作業ツリーには残すが通常のコミット対象にしない。

---

## Spec coverage

- 第3モードと既存2モード維持: Task 1、5、8
- 旧版／位置合わせ済み新版の同一フレーム: Task 3
- 両側の変更枠、手編集優先、常時表示: Task 2、3、5、8
- 同期ズーム／パン／全体／1:1／ページ送り: Task 4、5、8
- 左右表示中の編集禁止と設定保持: Task 5、8
- 欠落ページ表示: Task 3、8
- PNG横並び保存: Task 6、8
- PDF全ページ横並び保存: Task 7、8
- 古い描画結果の拒否: Task 5、8
- 対話／出力Workerレーン分離: Task 7、8
- テキスト比較との表示排他: Task 5、8
- 外部送信なし、文書、更新日: Task 8

## Implementation risks to check at every review gate

- `ImageData.data.buffer` はWorker転送後にdetachedになるため、キャッシュへ `ImageData` を保存しない。
- `splitCache` には枠描画済みCanvasを保存しない。手編集revision変更時に古い枠を再表示しないため、装飾は毎回表示用コピーへ行う。
- 左右Canvasは世代確認後に連続してDOMへコピーし、片側だけ古いページを残さない。
- `showBoxes` をsplit進入時に書き換えない。強制ONは表示とrendererの挙動だけに限定する。
- `setEditMode` と `toggleBoxes` はUI無効化だけでなくcontrollerでもsplitを拒否する。
- splitのfitは左右wrapperの小さい実表示領域を使う。
- Pointer Captureはpointerdownしたwrapperだけが所有・解放する。
- text modeへ移る際に単一Canvasとsplit panelの両方を隠す。
- PNG/PDF合成はCSS transformを読まず、Canvas bitmapだけを使う。
- PDFはexport laneのsessionを使い、interactive laneへ処理を流さない。
- 大判・高DPIでは横並びCanvasが一時的に約2倍の面積になるため、ページごとの一時Canvasを配列へ保持し続けない。
