# 変更箇所リスト実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 図面比較で検出した全ページの変更箇所を一覧化し、対象への移動、確認状態、対象外、コメント、サムネイル、再検出時の安全な状態引継ぎを提供する。

**Architecture:** 種類とIDを持つ変更枠を既存の枠編集機能へ通し、レビュー入力はIDをキーとする別状態へ保存する。現在ページの描画を優先し、全ページ索引は専用Workerレーンで順次処理する。比較条件が変わった場合は正規化座標を使った高確度の一対一照合だけを引き継ぐ。

**Tech Stack:** JavaScript ES Modules、Vite 8、Vitest 4、Playwright 1.62、Canvas 2D、Web Worker、pdf.js 3.11.174

**Spec:** `docs/superpowers/specs/2026-09-07-change-review-list-design.md`

## Global Constraints

- 図面比較だけを対象とし、テキスト比較モードのデータモデルと表示は変更しない。
- PDF、差分画像、レビュー情報を外部へ送信しない。
- 差分画像の赤、青、グレーと既存の変更枠形状を変えない。
- 画面上の枠はオーバーレイCanvasに描き、選択装飾をPNGおよびPDFへ出力しない。
- 対話描画、全ページ索引、PDF出力は別のWorkerレーンを使用する。
- 再検出時は設計書§8の全条件を満たす一対一対応だけにレビュー情報を引き継ぐ。
- PDF差し替え時はレビュー情報を初期化する。
- サムネイルは72 DPI相当、120×80 CSS pxとし、必要なページだけ遅延生成する。
- `index.html` を変更したコミットでは更新日を `2026-09-07` にする。
- 各タスクは失敗するテスト、最小実装、対象テスト成功、コミットの順で進める。

---

## File Structure

### 新規ファイル

- `src/core/change-review/model.js`：変更項目の正規化、並び順、集計、候補スコア、レビュー情報の引継ぎを行う純粋関数。
- `src/features/change-review/review-controller.js`：全ページ索引、選択、状態変更、コメント、枠編集同期、世代管理を担当する。
- `src/features/change-review/review-view.js`：右パネルのDOM描画、フォーカス維持、ページグループ、進捗、通知を担当する。
- `src/features/change-review/thumbnail-renderer.js`：72 DPI差分ページから変更枠のサムネイルを切り出す。
- `tests/unit/change-review-model.test.js`：レビュー項目と照合ロジックの単体テスト。
- `tests/unit/review-view.test.js`：パネルDOMの単体テスト。
- `tests/unit/thumbnail-renderer.test.js`：切り出し範囲と出力寸法の単体テスト。
- `tests/integration/review-controller.test.js`：索引、世代、レビュー操作、再検出、サムネイル要求の統合テスト。
- `tests/e2e/change-review-list.spec.js`：実PDFを使うレビュー操作と画面配置のE2Eテスト。

### 主な変更ファイル

- `src/core/change-boxes/detect.js`：連結成分へ追加、削除、変更の種類を付与する。
- `src/core/image-diff/diff-compute.js`：変更ブロックを種類付きビット値で記録する。
- `src/app/state.js`：`state.review` を追加する。
- `src/app/invalidation.js`：再検出用スナップショットとレビュー世代を管理する。
- `src/features/box-editor/box-editor-controller.js`：IDを保った編集とレビュー一覧同期を行う。
- `src/features/box-editor/box-editor-view.js`：一覧で選択した枠も画面上で強調する。
- `src/features/visual-diff/visual-controller.js`：描画結果の枠をレビューコントローラへコミットする。
- `src/features/visual-diff/visual-renderer.js`：全ページ索引用の枠だけを返す描画関数を追加する。
- `src/features/viewer/viewport.js`：矩形へフォーカスする純粋関数を追加する。
- `src/features/viewer/viewer-controller.js`：一覧選択時のフォーカス操作を公開する。
- `src/app/create-app.js`：レビュー機能と索引Workerレーンを構成する。
- `src/app/dom.js`、`src/app/bind-controls.js`：レビュー用DOMとイベントを接続する。
- `index.html`、`src/styles/layout.css`、`src/styles/controls.css`、`src/styles/viewer.css`：パネル、カード、ドロワー、選択枠を表示する。
- `README.md`、`local/図面差分ビューア_仕様書.md`：実装済み機能と操作を記録する。

---

### Task 1: 種類付き変更枠

**Files:**
- Modify: `src/core/change-boxes/detect.js`
- Modify: `src/core/image-diff/diff-compute.js`
- Test: `tests/unit/change-boxes.test.js`
- Test: `tests/unit/diff-compute.test.js`

**Interfaces:**
- Consumes: `computeDiff({oldData,newData,width,height,threshold,block,minBlocks})`
- Produces: `computeBoxes(flags, cols, rows, block, minBlocks) -> Array<{x,y,w,h,kind}>`
- Produces: `computeDiff(...).boxes` with `kind: "removed" | "added" | "changed"`

- [ ] **Step 1: 種類集約の失敗テストを書く**

```js
test("labels connected components from removed and added block bits", () => {
  const flags = Uint8Array.from([
    1, 1, 0, 2, 2,
    0, 1, 0, 0, 2,
    0, 0, 3, 0, 0,
  ]);

  expect(computeBoxes(flags, 5, 3, 10, 1)).toEqual([
    { x: 0, y: 0, w: 50, h: 30, kind: "changed" },
  ]);
});
```

既存2テストの期待値には `kind: "removed"` を追加する。

- [ ] **Step 2: 単体テストの失敗を確認する**

Run: `npx vitest run tests/unit/change-boxes.test.js tests/unit/diff-compute.test.js`

Expected: `kind` が返らないためFAIL。

- [ ] **Step 3: ブロック値と連結成分の種類集約を実装する**

```js
export const CHANGE_BITS = Object.freeze({ removed: 1, added: 2 });

function changeKind(bits) {
  if (bits === CHANGE_BITS.removed) return "removed";
  if (bits === CHANGE_BITS.added) return "added";
  return "changed";
}
```

`computeBoxes` の連結成分探索では `kindBits |= flags[cy * cols + cx]` を行い、返却する矩形へ `kind: changeKind(kindBits)` を加える。
膨張用配列は0または1のままにし、既存の連結形状を維持する。

`computeDiff` のフラグ関数はビット値を受け取る。

```js
const flag = (x, y, bit) => {
  const index = Math.floor(y / block) * columns + Math.floor(x / block);
  flags[index] |= bit;
};
```

削除画素では `flag(x, y, CHANGE_BITS.removed)`、追加画素では `flag(x, y, CHANGE_BITS.added)` を呼ぶ。
許容値0と1以上の両経路を変更する。

- [ ] **Step 4: 差分画像と件数が変わらないテストを通す**

Run: `npx vitest run tests/unit/change-boxes.test.js tests/unit/diff-compute.test.js tests/integration/visual-controller.test.js`

Expected: 種類付き枠、従来のRGB、削除数、追加数がすべてPASS。

- [ ] **Step 5: コミットする**

```bash
git add src/core/change-boxes/detect.js src/core/image-diff/diff-compute.js tests/unit/change-boxes.test.js tests/unit/diff-compute.test.js
git commit -m "feat: classify visual change boxes"
```

---

### Task 2: レビュー項目と安全な引継ぎ

**Files:**
- Create: `src/core/change-review/model.js`
- Create: `tests/unit/change-review-model.test.js`

**Interfaces:**
- Produces: `pageKeyFor(documents, pageIndex) -> string`
- Produces: `createReviewItems({boxes,pageIndex,pageKey,width,height,allocateId,source}) -> ReviewItem[]`
- Produces: `sortReviewItems(items) -> ReviewItem[]`
- Produces: `summarizeReviews(items, entries) -> {total,pending,confirmed,excluded,complete,byPage}`
- Produces: `reconcileReviewItems({previousItems,nextItems,entries,allocateId}) -> {items,entries,summary}`

- [ ] **Step 1: 正規化、並び順、集計の失敗テストを書く**

```js
test("creates DPI-independent review items and summarizes terminal states", () => {
  let next = 1;
  const items = createReviewItems({
    boxes: [
      { x: 50, y: 100, w: 20, h: 10, kind: "added" },
      { x: 10, y: 10, w: 20, h: 20, kind: "removed" },
    ],
    pageIndex: 0,
    pageKey: "old:0|new:0",
    width: 100,
    height: 200,
    allocateId: () => `change-${next++}`,
    source: "auto",
  });
  const sorted = sortReviewItems(items);
  const entries = new Map([
    [sorted[0].id, { status: "confirmed", comment: "確認" }],
    [sorted[1].id, { status: "excluded", comment: "図枠" }],
  ]);

  expect(sorted[1].normalizedRect).toEqual({ x: 0.5, y: 0.5, w: 0.2, h: 0.05 });
  expect(summarizeReviews(sorted, entries)).toMatchObject({
    total: 2, pending: 0, confirmed: 1, excluded: 1, complete: 2,
  });
});
```

- [ ] **Step 2: 引継ぎ境界の失敗テストを書く**

```js
test("inherits only mutual high-confidence matches", () => {
  const previousItems = [item("old-a", "added", rect(0.10, 0.10, 0.20, 0.20))];
  const nextItems = [item(null, "added", rect(0.11, 0.10, 0.20, 0.20))];
  const entries = new Map([
    ["old-a", { status: "confirmed", comment: "R105" }],
  ]);

  const result = reconcileReviewItems({
    previousItems,
    nextItems,
    entries,
    allocateId: () => "new-a",
  });

  expect(result.items[0].id).toBe("old-a");
  expect(result.entries.get("old-a")).toEqual({ status: "confirmed", comment: "R105" });
  expect(result.summary).toEqual({ inherited: 1, reset: 0 });
});

test.each([
  ["kind changed", item(null, "removed", rect(0.11, 0.10, 0.20, 0.20))],
  ["low overlap", item(null, "added", rect(0.40, 0.40, 0.20, 0.20))],
])("resets %s", (label, nextItem) => {
  const result = reconcileReviewItems({
    previousItems: [item("old-a", "added", rect(0.10, 0.10, 0.20, 0.20))],
    nextItems: [nextItem],
    entries: new Map([["old-a", { status: "confirmed", comment: "確認" }]]),
    allocateId: () => "new-a",
  });
  expect(result.items[0].id).toBe("new-a");
  expect(result.entries.get("new-a")).toEqual({ status: "pending", comment: "" });
});
```

分割、結合、同点の第2候補、最良候補との差が0.10未満のケースも同ファイルへ加える。

- [ ] **Step 3: 失敗を確認する**

Run: `npx vitest run tests/unit/change-review-model.test.js`

Expected: `src/core/change-review/model.js` が存在しないためFAIL。

- [ ] **Step 4: 純粋関数を実装する**

```js
export const REVIEW_STATUS = Object.freeze({
  pending: "pending",
  confirmed: "confirmed",
  excluded: "excluded",
});

export function matchScore(left, right) {
  const overlap = intersectionOverUnion(left.normalizedRect, right.normalizedRect);
  const center = centerSimilarity(left.normalizedRect, right.normalizedRect, 0.25);
  const size = sizeSimilarity(left.normalizedRect, right.normalizedRect);
  return { overlap, value: 0.65 * overlap + 0.20 * center + 0.15 * size };
}

export function canInherit(best, second) {
  return best.overlap >= 0.50
    && best.value >= 0.72
    && (!second || best.value - second.value >= 0.10);
}
```

`reconcileReviewItems` は同じ `pageKey` と `kind` の候補だけを比較し、相互最良かつ `canInherit` を満たす組だけへ旧IDを割り当てる。
未対応の新項目には `allocateId()` を使い、`{status:"pending",comment:""}` を作る。
返却するMapは入力Mapを変更せず複製する。

- [ ] **Step 5: 単体テストを通す**

Run: `npx vitest run tests/unit/change-review-model.test.js`

Expected: 正規化、並び順、集計、引継ぎ、曖昧判定がPASS。

- [ ] **Step 6: コミットする**

```bash
git add src/core/change-review/model.js tests/unit/change-review-model.test.js
git commit -m "feat: add change review model"
```

---

### Task 3: レビュー状態と再検出スナップショット

**Files:**
- Modify: `src/app/state.js`
- Modify: `src/app/invalidation.js`
- Modify: `tests/unit/state.test.js`
- Modify: `tests/unit/invalidation.test.js`

**Interfaces:**
- Produces: `state.review`
- Produces: `captureReviewMigration(state) -> void`
- Produces: `resetReviewState(state) -> void`
- Consumes: Task 2の `sortReviewItems`

- [ ] **Step 1: 初期状態の失敗テストを書く**

```js
test("creates isolated review state", () => {
  const state = createAppState();
  expect(state.review).toMatchObject({
    selectedId: null,
    panelOpen: false,
    nextId: 1,
    indexGeneration: 0,
    indexRunning: false,
    indexedPages: 0,
    indexTotal: 0,
  });
  expect(state.review.itemsByPage).toBeInstanceOf(Map);
  expect(state.review.entriesById).toBeInstanceOf(Map);
  expect(state.review.indexErrors).toBeInstanceOf(Map);
  expect(state.review.thumbnailsByPage).toBeInstanceOf(Map);
});
```

- [ ] **Step 2: 無効化の失敗テストを書く**

```js
test("comparison invalidation preserves a migration snapshot but documents reset reviews", () => {
  const state = populatedState();
  state.review.itemsByPage.set(0, [reviewItem("change-1")]);
  state.review.entriesById.set("change-1", { status: "confirmed", comment: "確認" });

  invalidateThreshold(state);
  expect(state.review.pendingMigration.itemsByPage.get(0)[0].id).toBe("change-1");
  expect(state.review.itemsByPage.size).toBe(0);
  expect(state.review.indexGeneration).toBe(1);

  invalidateDocuments(state);
  expect(state.review.pendingMigration).toBeNull();
  expect(state.review.entriesById.size).toBe(0);
  expect(state.review.nextId).toBe(1);
});
```

- [ ] **Step 3: 失敗を確認する**

Run: `npx vitest run tests/unit/state.test.js tests/unit/invalidation.test.js`

Expected: `state.review` と移行関数が存在しないためFAIL。

- [ ] **Step 4: `state.review` を追加する**

```js
review: {
  itemsByPage: new Map(),
  entriesById: new Map(),
  selectedId: null,
  panelOpen: false,
  nextId: 1,
  indexGeneration: 0,
  indexRunning: false,
  indexedPages: 0,
  indexTotal: 0,
  indexErrors: new Map(),
  pendingMigration: null,
  migrationSummary: null,
  thumbnailsByPage: new Map(),
},
```

- [ ] **Step 5: 無効化を実装する**

`invalidateDpi`、`invalidateThreshold`、`invalidateTolerance`、`invalidateManualAlignment`、`invalidatePageAlignment` は枠を消す前にレビュー移行用スナップショットを作る。

```js
export function captureReviewMigration(state) {
  state.review.pendingMigration = {
    itemsByPage: new Map(
      [...state.review.itemsByPage].map(([page, items]) => [page, items.map(item => ({ ...item }))]),
    ),
    entriesById: new Map(
      [...state.review.entriesById].map(([id, entry]) => [id, { ...entry }]),
    ),
  };
  clearReviewIndex(state);
}
```

`clearReviewIndex` は項目、選択、進捗、エラー、サムネイルを消し、`indexGeneration` を増やすが、`entriesById` と `pendingMigration` は残す。
`invalidateDocuments` は `resetReviewState` を呼び、移行スナップショットを含むレビュー状態を初期化する。

- [ ] **Step 6: 無効化テストを通す**

Run: `npx vitest run tests/unit/state.test.js tests/unit/invalidation.test.js`

Expected: 比較条件では移行元が残り、PDF差し替えでは全レビュー情報が消える。

- [ ] **Step 7: コミットする**

```bash
git add src/app/state.js src/app/invalidation.js tests/unit/state.test.js tests/unit/invalidation.test.js
git commit -m "feat: preserve review migration snapshots"
```

---

### Task 4: 枠編集とレビューIDの同期

**Files:**
- Modify: `src/features/box-editor/box-editor-controller.js`
- Modify: `src/features/box-editor/box-editor-view.js`
- Modify: `src/app/create-app.js`
- Modify: `tests/integration/box-editor-controller.test.js`
- Modify: `tests/unit/box-editor-view.test.js`
- Modify: `tests/integration/create-app.test.js`

**Interfaces:**
- `createBoxEditorController` consumes `makeManualBox({pageIndex,box}) -> BoxWithId`
- `createBoxEditorController` consumes `onBoxesChanged({pageIndex,boxes,reason}) -> void`
- `drawBoxLayer` consumes `focusedIndex: number`
- Existing box shape becomes `{x,y,w,h,id,kind,source}` after review commit

- [ ] **Step 1: ID保持と通知の失敗テストを書く**

```js
test("preserves ids while moving and restoring a deleted reviewed box", () => {
  const onBoxesChanged = vi.fn();
  const reviewed = { x: 10, y: 10, w: 20, h: 20, id: "change-7", kind: "added", source: "auto" };
  const { state, controller } = harness({ boxes: [reviewed], onBoxesChanged });

  drag(controller, { x: 15, y: 15 }, { x: 30, y: 30 });
  expect(state.boxEditor.currentBoxes[0].id).toBe("change-7");

  state.boxEditor.selectedIndex = 0;
  controller.deleteSelected();
  controller.undo();
  expect(state.boxEditor.currentBoxes[0].id).toBe("change-7");
  expect(onBoxesChanged).toHaveBeenLastCalledWith(expect.objectContaining({ reason: "undo" }));
});
```

- [ ] **Step 2: 手動追加の失敗テストを書く**

```js
test("allocates a reviewed manual box once", () => {
  const makeManualBox = vi.fn(({ box }) => ({
    ...box, id: "change-9", kind: "changed", source: "manual",
  }));
  const { state, controller } = harness({ boxes: [], makeManualBox });

  drag(controller, { x: 10, y: 10 }, { x: 40, y: 40 });
  expect(makeManualBox).toHaveBeenCalledTimes(1);
  expect(state.boxEditor.currentBoxes[0]).toMatchObject({
    id: "change-9", kind: "changed", source: "manual",
  });
});
```

- [ ] **Step 3: 失敗を確認する**

Run: `npx vitest run tests/integration/box-editor-controller.test.js tests/unit/box-editor-view.test.js tests/integration/create-app.test.js`

Expected: コールバック未対応と `focusedIndex` 未対応によりFAIL。

- [ ] **Step 4: 枠編集のコールバックを実装する**

```js
const commitChange = (pageIndex, reason) => {
  bumpRevision(pageIndex);
  onBoxesChanged?.({
    pageIndex,
    boxes: cloneBoxes(state.boxEditor.currentBoxes || []),
    reason,
  });
};
```

作成時だけ `makeManualBox` を通し、移動とリサイズではスプレッド複製によってID、種類、作成元を維持する。
削除、Undo、自動検出へ戻す、全編集破棄でも `onBoxesChanged` を呼ぶ。

- [ ] **Step 5: 一覧選択枠の描画を実装する**

`box-editor-view.js` は `state.review.selectedId` と一致する枠のインデックスを `focusedIndex` として `drawBoxLayer` へ渡す。
編集ハンドル用の `selectedIndex` と一覧フォーカス用の `focusedIndex` を別に扱う。

```js
const focusedIndex = boxes.findIndex(box => box.id === state.review.selectedId);
```

`focusedIndex` の枠には白い外周線を描き、編集ハンドルは従来どおり編集選択だけへ描く。

- [ ] **Step 6: 対象テストを通す**

Run: `npx vitest run tests/integration/box-editor-controller.test.js tests/unit/box-editor-view.test.js tests/integration/create-app.test.js`

Expected: ID保持、手動追加、削除、Undo、リセット、選択装飾がPASS。

- [ ] **Step 7: コミットする**

```bash
git add src/features/box-editor/box-editor-controller.js src/features/box-editor/box-editor-view.js src/app/create-app.js tests/integration/box-editor-controller.test.js tests/unit/box-editor-view.test.js tests/integration/create-app.test.js
git commit -m "feat: keep review ids through box editing"
```

---

### Task 5: 全ページ変更索引

**Files:**
- Create: `src/features/change-review/review-controller.js`
- Create: `tests/integration/review-controller.test.js`
- Modify: `src/features/visual-diff/visual-renderer.js`
- Modify: `src/features/visual-diff/visual-controller.js`
- Modify: `src/app/create-app.js`
- Modify: `src/app/invalidation.js`
- Modify: `tests/integration/visual-controller.test.js`
- Modify: `tests/integration/create-app.test.js`
- Modify: `tests/unit/invalidation.test.js`

**Interfaces:**
- Produces: `renderChangeIndexPage(snapshot, dependencies) -> {boxes,width,height}`
- Produces: `createChangeReviewController({state,renderIndexPage,cancelIndex,onChanged,reportError})`
- Produces: `createVisualSnapshot(state,pageIndex,mode,toggleSide) -> Readonly<VisualSnapshot>`
- Produces controller methods: `commitPage`, `startIndex`, `cancelIndex`, `syncEditedPage`, `allocateId`
- `createVisualController` consumes `commitReviewPage({pageIndex,boxes,autoBoxes,width,height}) -> {currentBoxes,autoBoxes}`

- [ ] **Step 1: ページコミットと引継ぎの失敗テストを書く**

```js
test("commits detected boxes and inherits a matching review entry", () => {
  const { state, controller } = harness();
  state.review.pendingMigration = migrationWithConfirmedItem();

  const committed = controller.commitPage({
    pageIndex: 0,
    pageKey: "old:0|new:0",
    boxes: [{ x: 11, y: 10, w: 20, h: 20, kind: "added" }],
    width: 100,
    height: 100,
    source: "auto",
  });

  expect(committed.currentBoxes[0].id).toBe("change-1");
  expect(state.review.entriesById.get("change-1").status).toBe("confirmed");
});
```

- [ ] **Step 2: 索引世代と継続処理の失敗テストを書く**

```js
test("indexes remaining pages sequentially and ignores an obsolete generation", async () => {
  const { state, renderIndexPage, controller } = harness({ pages: 3 });
  renderIndexPage
    .mockResolvedValueOnce(indexResult(1))
    .mockResolvedValueOnce(indexResult(2));

  const indexing = controller.startIndex({ skipPages: new Set([0]) });
  state.review.indexGeneration += 1;
  await indexing;

  expect(renderIndexPage).toHaveBeenCalledTimes(1);
  expect(state.review.itemsByPage.has(1)).toBe(false);
});

test("records one page error and continues with the next page", async () => {
  const { state, renderIndexPage, controller } = harness({ pages: 3 });
  renderIndexPage.mockRejectedValueOnce(new Error("page 1 failed"));
  renderIndexPage.mockResolvedValueOnce(indexResult(2));

  await controller.startIndex({ skipPages: new Set([0]) });

  expect(state.review.indexErrors.get(1)).toBe("page 1 failed");
  expect(state.review.itemsByPage.has(2)).toBe(true);
});
```

- [ ] **Step 3: 失敗を確認する**

Run: `npx vitest run tests/integration/review-controller.test.js tests/integration/visual-controller.test.js tests/integration/create-app.test.js`

Expected: レビューコントローラと索引描画が存在しないためFAIL。

- [ ] **Step 4: 枠だけを返す索引描画を実装する**

```js
export async function renderChangeIndexPage(snapshot, dependencies, options = {}) {
  const prepared = await prepareVisualPage(snapshot, dependencies, null, options.onProgress);
  const boxes = await computeChangeBoxesAligned(snapshot, prepared, dependencies, options);
  return { boxes, width: prepared.width, height: prepared.height };
}
```

索引は手編集枠のないページだけを自動計算する。
手編集済みページは `state.boxEditor.editsByPage` から `syncEditedPage` し、Workerを使わない。

- [ ] **Step 5: レビューコントローラを実装する**

`commitPage` はTask 2の `createReviewItems` と `reconcileReviewItems` を使い、枠へID、種類、作成元を付ける。
レビュー入力が存在しないIDには既定エントリを作る。
すべての移行対象ページを処理した時点で `pendingMigration` を破棄し、継承件数と未確認へ戻した件数を `migrationSummary` へ確定する。
移行元が存在しない最初の索引では `migrationSummary` を表示しない。

```js
async function startIndex({ skipPages = new Set() } = {}) {
  const generation = ++state.review.indexGeneration;
  state.review.indexRunning = true;
  state.review.indexTotal = state.documents.pages;
  for (let pageIndex = 0; pageIndex < state.documents.pages; pageIndex += 1) {
    if (generation !== state.review.indexGeneration) break;
    if (skipPages.has(pageIndex)) {
      state.review.indexedPages += 1;
      continue;
    }
    await indexOnePage(pageIndex, generation);
  }
  if (generation === state.review.indexGeneration) state.review.indexRunning = false;
  onChanged();
}
```

`indexOnePage` はページ単位の例外を捕捉し、キャンセル例外だけはループ終了として扱う。

- [ ] **Step 6: 第3のWorkerレーンを構成する**

`create-app.js` で `indexLane` を生成し、`renderChangeIndexPage` 専用の依存関係を作る。

```js
const indexLane = deps.createWorkerLane({ createWorker: deps.createDiffWorker });
const indexRenderDependencies = () => Object.freeze({
  ...sharedRenderDependencies,
  ...laneCompute(indexLane),
});
```

`visual-controller.js` の既存 `createSnapshot` は `createVisualSnapshot` としてexportし、対話描画と索引描画で同じ凍結スナップショットを使う。
`create-app.js` が `renderIndexPage(pageIndex)` の中で `createVisualSnapshot(state,pageIndex,"diff")` を作り、`renderChangeIndexPage` へ渡す。

比較条件と文書の無効化では `reviewController.cancelIndex()` と `indexLane.cancel()` を呼ぶ。
出力レーンと対話描画レーンは変更しない。

- [ ] **Step 7: 対話描画の枠コミットを接続する**

`visual-controller.js` の `commitResult` は、枠を状態へ入れる直前に `commitReviewPage` を呼ぶ。

```js
const committed = commitReviewPage({
  pageIndex: snapshot.pageIndex,
  pageKey: pageKeyFor(snapshot.documents, snapshot.pageIndex),
  boxes: result.boxes || [],
  autoBoxes: result.autoBoxes,
  width: result.canvas.width,
  height: result.canvas.height,
});
```

返された `committed.currentBoxes` と `committed.autoBoxes` を `state.boxEditor` へ保存する。
`runVisual` は最初のページを表示してフィットした後、現在ページを除外して `startIndex` を開始する。

- [ ] **Step 8: 対象テストを通す**

Run: `npx vitest run tests/integration/review-controller.test.js tests/integration/visual-controller.test.js tests/integration/create-app.test.js tests/unit/invalidation.test.js tests/unit/worker-lane.test.js`

Expected: 順次索引、世代拒否、ページ別失敗、3レーン分離、対話描画からの枠コミットがPASS。

- [ ] **Step 9: コミットする**

```bash
git add src/features/change-review/review-controller.js src/features/visual-diff/visual-renderer.js src/features/visual-diff/visual-controller.js src/app/create-app.js src/app/invalidation.js tests/integration/review-controller.test.js tests/integration/visual-controller.test.js tests/integration/create-app.test.js tests/unit/invalidation.test.js tests/unit/worker-lane.test.js
git commit -m "feat: index visual changes across pages"
```

---

### Task 6: 変更箇所パネルとナビゲーション

**Files:**
- Create: `src/features/change-review/review-view.js`
- Create: `tests/unit/review-view.test.js`
- Modify: `src/features/change-review/review-controller.js`
- Modify: `tests/integration/review-controller.test.js`
- Modify: `src/features/viewer/viewport.js`
- Modify: `src/features/viewer/viewer-controller.js`
- Modify: `tests/unit/viewport.test.js`
- Modify: `index.html`
- Modify: `src/styles/layout.css`
- Modify: `src/styles/controls.css`
- Modify: `src/styles/viewer.css`
- Modify: `src/app/dom.js`
- Modify: `src/app/bind-controls.js`
- Modify: `src/app/create-app.js`
- Modify: `tests/unit/dom-error-reporter.test.js`
- Modify: `tests/unit/bind-controls.test.js`
- Modify: `tests/integration/create-app.test.js`

**Interfaces:**
- Produces: `focusRectViewport(rect, container, {padding,maxScale}) -> {scale,tx,ty}`
- `viewerController.focusRect(rect, {padding:0.25,maxScale:4})`
- Review controller methods: `select`, `selectPrevious`, `selectNext`, `setStatus`, `setComment`, `togglePanel`
- Review view method: `render({preserveCommentFocus:true})`

- [ ] **Step 1: 矩形フォーカスの失敗テストを書く**

```js
test("focuses a rectangle with padding and caps automatic scale", () => {
  expect(focusRectViewport(
    { x: 40, y: 30, w: 20, h: 10 },
    { width: 200, height: 100 },
    { padding: 0.25, maxScale: 4 },
  )).toEqual({ scale: 4, tx: -100, ty: -90 });
});
```

期待値は対象枠中心 `(50,35)` を表示領域中心 `(100,50)` へ置く式 `tx=100-50*scale`、`ty=50-35*scale` から求める。

- [ ] **Step 2: レビュー操作の失敗テストを書く**

```js
test("selects changes across page boundaries and persists review input", async () => {
  const { state, showPage, focusRect, controller } = navigationHarness();
  state.review.itemsByPage.set(0, [reviewItem("change-1", 0)]);
  state.review.itemsByPage.set(1, [reviewItem("change-2", 1)]);

  await controller.select("change-2");
  expect(showPage).toHaveBeenCalledWith(1);
  expect(focusRect).toHaveBeenCalledWith(expect.any(Object), { padding: 0.25, maxScale: 4 });

  controller.setStatus("change-2", "confirmed");
  controller.setComment("change-2", "抵抗値を確認");
  expect(state.review.entriesById.get("change-2")).toEqual({
    status: "confirmed", comment: "抵抗値を確認",
  });
});
```

- [ ] **Step 3: パネル描画の失敗テストを書く**

```js
test("renders progress, page groups, kinds, states and comments", () => {
  const { state, dom, view } = viewHarness();
  seedTwoReviewedItems(state);
  view.render();

  expect(dom.reviewTotal.textContent).toBe("変更箇所 2件");
  expect(dom.reviewProgress.textContent).toContain("完了 1 / 2");
  expect(dom.reviewList.querySelectorAll("[data-change-id]")).toHaveLength(2);
  expect(dom.reviewList.textContent).toContain("追加");
  expect(dom.reviewList.textContent).toContain("抵抗値を確認");
});
```

- [ ] **Step 4: 失敗を確認する**

Run: `npx vitest run tests/unit/viewport.test.js tests/unit/review-view.test.js tests/integration/review-controller.test.js tests/unit/bind-controls.test.js tests/integration/create-app.test.js`

Expected: フォーカス関数、レビュー表示、操作メソッドが存在しないためFAIL。

- [ ] **Step 5: ビューポートとナビゲーションを実装する**

```js
export function focusRectViewport(rect, container, { padding = 0.25, maxScale = 4 } = {}) {
  const paddedWidth = rect.w * (1 + padding * 2);
  const paddedHeight = rect.h * (1 + padding * 2);
  const scale = clampScale(Math.min(
    container.width / paddedWidth,
    container.height / paddedHeight,
    maxScale,
  ));
  return {
    scale,
    tx: container.width / 2 - (rect.x + rect.w / 2) * scale,
    ty: container.height / 2 - (rect.y + rect.h / 2) * scale,
  };
}
```

`select` は選択チケットを増やし、必要なら `showPage(pageIndex)` を待つ。
待機中に別項目が選ばれた場合は古い選択をフォーカスしない。
前後移動はTask 2の表示順を使い、両端で循環する。

- [ ] **Step 6: 右パネルのHTMLとCSSを追加する**

`index.html` の `.view` と同じ `main` グリッド内へ `<aside id="reviewPanel">` を追加し、ツールバーへ開閉ボタン `#reviewToggle` を追加する。

```html
<aside id="reviewPanel" class="review-panel" aria-label="変更箇所">
  <div class="review-head">
    <div><strong id="reviewTotal">変更箇所 0件</strong><span id="reviewIndexStatus"></span></div>
    <button id="reviewClose" aria-label="変更箇所を閉じる">×</button>
  </div>
  <div id="reviewProgress">完了 0 / 0　未確認 0件</div>
  <div class="review-nav">
    <button id="reviewPrev">← 前の変更</button>
    <button id="reviewNext">次の変更 →</button>
  </div>
  <div id="reviewNotice" role="status"></div>
  <div id="reviewList"></div>
</aside>
<button id="reviewBackdrop" aria-label="変更箇所を閉じる"></button>
```

デスクトップは `288px minmax(0,1fr) 320px`、パネル閉鎖時は `288px minmax(0,1fr) 0` とする。
1100px未満ではパネルを右側固定のドロワーにし、背景ボタンを表示する。

- [ ] **Step 7: DOMを安全に描画する**

`review-view.js` はページ見出しへ `<details>`、項目へ `<article data-change-id>` を作る。
コメントは `innerHTML` へ連結せず、`textarea.value` と `textContent` で設定する。
再描画前にフォーカス中の変更ID、selectionStart、selectionEndを退避し、再描画後に同じコメント欄へ戻す。

状態選択は次の固定値を使う。

```html
<select data-review-status="change-1">
  <option value="pending">未確認</option>
  <option value="confirmed">確認済み</option>
  <option value="excluded">対象外</option>
</select>
```

- [ ] **Step 8: イベント委譲とアプリ構成を接続する**

`bind-controls.js` は `#reviewList` の `click`、`change`、`input` を1本ずつ登録し、`data-change-id` と `data-review-status` からレビューコントローラへ渡す。
開閉、前、次、ページ再試行も同じコントローラへ接続する。
差分表示成功後は `state.review.panelOpen = true` として表示を更新する。
テキスト比較へ切り替えた場合はパネルを隠すが、開閉状態と入力内容を残す。

- [ ] **Step 9: 対象テストを通す**

Run: `npx vitest run tests/unit/viewport.test.js tests/unit/review-view.test.js tests/integration/review-controller.test.js tests/unit/dom-error-reporter.test.js tests/unit/bind-controls.test.js tests/integration/create-app.test.js tests/unit/box-editor-view.test.js`

Expected: パネル、集計、状態、コメント、前後移動、ページ移動、選択枠、入力フォーカス維持がPASS。

- [ ] **Step 10: コミットする**

```bash
git add index.html src/styles/layout.css src/styles/controls.css src/styles/viewer.css src/app/dom.js src/app/bind-controls.js src/app/create-app.js src/features/change-review/review-view.js src/features/change-review/review-controller.js src/features/viewer/viewport.js src/features/viewer/viewer-controller.js tests/unit/review-view.test.js tests/integration/review-controller.test.js tests/unit/viewport.test.js tests/unit/dom-error-reporter.test.js tests/unit/bind-controls.test.js tests/integration/create-app.test.js tests/unit/box-editor-view.test.js
git commit -m "feat: add change review panel"
```

---

### Task 7: 遅延サムネイル

**Files:**
- Create: `src/features/change-review/thumbnail-renderer.js`
- Create: `tests/unit/thumbnail-renderer.test.js`
- Modify: `src/features/change-review/review-controller.js`
- Modify: `src/features/change-review/review-view.js`
- Modify: `src/app/create-app.js`
- Modify: `tests/integration/review-controller.test.js`
- Modify: `tests/unit/review-view.test.js`
- Modify: `tests/integration/create-app.test.js`

**Interfaces:**
- Produces: `cropChangeThumbnail({source,normalizedRect,createCanvas,width:120,height:80,margin:0.15}) -> canvas`
- Review controller method: `requestPageThumbnails(pageIndex) -> Promise<void>`
- Reuses: Task 5の索引Workerレーンを索引完了後に逐次使用する

- [ ] **Step 1: 切り出しの失敗テストを書く**

```js
test("crops a normalized rectangle with margin into a 120 by 80 thumbnail", () => {
  const source = recordingCanvas(1000, 500);
  const result = cropChangeThumbnail({
    source,
    normalizedRect: { x: 0.40, y: 0.20, w: 0.20, h: 0.20 },
    createCanvas: recordingCanvas,
  });

  expect([result.width, result.height]).toEqual([120, 80]);
  expect(result.context.drawImage).toHaveBeenCalledWith(
    source, 370, 85, 260, 130, 0, 10, 120, 60,
  );
});
```

切り出し範囲は元画像へクランプし、余白部分は白で塗る。

- [ ] **Step 2: 遅延生成とキャッシュの失敗テストを書く**

```js
test("renders one 72 DPI page for all thumbnails in an opened group", async () => {
  const { state, renderThumbnailPage, controller } = thumbnailHarness();
  state.review.itemsByPage.set(1, [
    reviewItem("change-2", 1),
    reviewItem("change-3", 1),
  ]);

  await controller.requestPageThumbnails(1);
  await controller.requestPageThumbnails(1);

  expect(renderThumbnailPage).toHaveBeenCalledTimes(1);
  expect(renderThumbnailPage.mock.calls[0][0].comparison.dpi).toBe(72);
  expect(state.review.thumbnailsByPage.get(1).size).toBe(2);
});
```

- [ ] **Step 3: 失敗を確認する**

Run: `npx vitest run tests/unit/thumbnail-renderer.test.js tests/integration/review-controller.test.js tests/unit/review-view.test.js`

Expected: サムネイル関数と要求メソッドが存在しないためFAIL。

- [ ] **Step 4: 切り出し関数を実装する**

`cropChangeThumbnail` は正規化矩形へ15%の余白を加え、元画像範囲に収める。
縦横比を保って120×80へ縮小し、余白を白で塗る。
返却Canvasから `toDataURL("image/png")` を1回だけ呼び、一覧ではデータURLを使う。

- [ ] **Step 5: 72 DPIページ描画を実装する**

元の比較設定を変更せず、凍結スナップショットのDPIとピクセル単位の手動移動だけを縮小する。

```js
const ratio = 72 / snapshot.comparison.dpi;
const thumbnailSnapshot = Object.freeze({
  ...snapshot,
  comparison: Object.freeze({
    ...snapshot.comparison,
    dpi: 72,
    dx: snapshot.comparison.dx * ratio,
    dy: snapshot.comparison.dy * ratio,
  }),
});
```

索引処理中の要求はページ番号をSetへ積み、索引完了後に小さいページ番号から処理する。
同じページが処理中またはキャッシュ済みなら重複描画しない。
失敗時はページキャッシュへ `{error:true}` を保存し、表示へプレースホルダーを渡す。

- [ ] **Step 6: ページグループの開閉へ接続する**

現在ページのグループは初期状態で開く。
`<details>` の `toggle` イベントで開いたページだけ `requestPageThumbnails(pageIndex)` を呼ぶ。
画像生成中は120×80のスケルトン、失敗時は「画像なし」を表示する。

- [ ] **Step 7: 対象テストを通す**

Run: `npx vitest run tests/unit/thumbnail-renderer.test.js tests/integration/review-controller.test.js tests/unit/review-view.test.js tests/integration/create-app.test.js tests/unit/worker-lane.test.js`

Expected: 1ページ1描画、複数枠切り出し、キャッシュ、索引との直列化、失敗プレースホルダーがPASS。

- [ ] **Step 8: コミットする**

```bash
git add src/features/change-review/thumbnail-renderer.js src/features/change-review/review-controller.js src/features/change-review/review-view.js src/app/create-app.js tests/unit/thumbnail-renderer.test.js tests/integration/review-controller.test.js tests/unit/review-view.test.js tests/integration/create-app.test.js
git commit -m "feat: add lazy change thumbnails"
```

---

### Task 8: 実ブラウザ受け入れ、文書、全体検証

**Files:**
- Create: `tests/e2e/change-review-list.spec.js`
- Modify: `tests/e2e/box-editing.spec.js`
- Modify: `tests/e2e/rendering-lanes.spec.js`
- Modify: `tests/unit/documentation.test.js`
- Modify: `README.md`
- Modify: `local/図面差分ビューア_仕様書.md`
- Modify: `index.html`

**Interfaces:**
- User-visible: 「変更箇所」パネル、全件数、完了数、未確認数、前後移動、状態、コメント、サムネイル
- Status: `未確認`、`確認済み`、`対象外`
- Notice: `レビュー{n}件を継承し、{m}件を未確認へ戻しました`

- [ ] **Step 1: 主要E2Eを追加する**

```js
test("reviews all visual changes from the change list", async ({ page }) => {
  await page.goto("/");
  await page.locator("#fileOld").setInputFiles(fixture("old.pdf"));
  await page.locator("#fileNew").setInputFiles(fixture("new.pdf"));
  await page.locator("#run").click();

  await expect(page.locator("#reviewPanel")).toBeVisible();
  await expect(page.locator("#reviewIndexStatus")).toContainText("分析完了");
  const cards = page.locator("[data-change-id]");
  await expect(cards.first()).toBeVisible();

  await cards.first().locator("select").selectOption("confirmed");
  await cards.first().locator("textarea").fill("R105の抵抗値を確認");
  await expect(page.locator("#reviewProgress")).toContainText("完了 1 /");

  await page.locator("#reviewNext").click();
  await expect(cards.nth(1)).toHaveAttribute("aria-current", "true");
  await expect(page.locator("#boxLayer")).toBeVisible();
});
```

fixtureの検出件数に依存する固定値は使わず、カード数と進捗の分母が一致することを評価する。

- [ ] **Step 2: 状態保持と引継ぎのE2Eを追加する**

確認済みとコメントを入力してページを往復し、入力が残ることを確認する。
しきい値を小幅に変更して再検出を待ち、継承通知と状態保持を確認する。
枠が変化する大幅なしきい値変更では、新規または曖昧な項目が未確認になることを確認する。

- [ ] **Step 3: 枠編集とUndoのE2Eを拡張する**

`tests/e2e/box-editing.spec.js` で確認済み枠を移動し、一覧の状態とコメントが残ることを確認する。
削除で一覧から消え、`Control+z` で同じ内容を持つ項目が戻ることを確認する。
手動追加枠が「変更」「未確認」として増えることを確認する。

- [ ] **Step 4: Workerレーン競合のE2Eを追加する**

索引中にページ送りとPNG保存を行い、対話描画が完了して索引も再開することを確認する。
PDF出力中に変更一覧を操作し、出力と索引が互いをキャンセルしないことを確認する。

- [ ] **Step 5: Chromiumで対象E2Eを通す**

Run: `npx playwright test tests/e2e/change-review-list.spec.js tests/e2e/box-editing.spec.js tests/e2e/rendering-lanes.spec.js --project=chromium`

Expected: 一覧、移動、レビュー入力、引継ぎ、枠編集、レーン分離がPASS。

- [ ] **Step 6: デスクトップ表示を実ブラウザで確認する**

Chromiumで1280×800を使用し、次を確認する。

- 右パネルが320px前後で表示され、左設定パネルと図面ビューアを覆わない。
- コメント欄へ日本語を入力してもカード幅が崩れない。
- 選択項目と白い外周線の枠が一致する。
- ページ見出しを開いたときだけサムネイルが表示される。
- パネルを閉じると図面ビューアが空いた幅を使う。

- [ ] **Step 7: 狭幅表示を実ブラウザで確認する**

Chromiumで820×900を使用し、次を確認する。

- 変更箇所パネルが右ドロワーとして表示される。
- 背景または閉じるボタンでドロワーを閉じられる。
- 状態選択、コメント、前後移動を横スクロールなしで操作できる。
- ドロワーを閉じた後にズームとパンが動作する。

- [ ] **Step 8: READMEと正式仕様を更新する**

READMEへ変更箇所一覧、状態、コメント、前後移動、遅延サムネイル、再検出時の高確度引継ぎを追加する。
`local/図面差分ビューア_仕様書.md` の現行機能、表示制御、レビュー機能、変更履歴へ同じ挙動を記録する。
レビュー情報が現段階ではメモリ上だけに存在し、ファイル保存は次の改善項目であることを明記する。

- [ ] **Step 9: 更新日を変更する**

```html
<span class="sub">PDF OVERLAY DIFF · UPDATED 2026-09-07</span>
```

- [ ] **Step 10: 単体テストと統合テストを全件実行する**

Run: `npm test`

Expected: Vitest全件PASS。

- [ ] **Step 11: ビルドと配布物検証を実行する**

Run: `npm run build`

Expected: Vite buildと `tests/verify-dist.mjs` がexit code 0。

- [ ] **Step 12: Chromium E2Eを全件実行する**

Run: `npx playwright test --project=chromium`

Expected: Chromium全件PASS。

- [ ] **Step 13: 全対応ブラウザE2Eを実行する**

Run: `npm run test:e2e`

Expected: Chromium、Firefox、WebKitがすべてPASS。

- [ ] **Step 14: 差分と文書整合を確認する**

Run: `git diff --check`

Expected: 出力なし、exit code 0。

Run: `npx vitest run tests/unit/documentation.test.js tests/unit/source-structure.test.js tests/unit/dependency-boundaries.test.js`

Expected: 更新日、モジュール境界、依存方向がPASS。

- [ ] **Step 15: E2Eと文書をコミットする**

```bash
git add README.md index.html tests/e2e/change-review-list.spec.js tests/e2e/box-editing.spec.js tests/e2e/rendering-lanes.spec.js tests/unit/documentation.test.js
git commit -m "docs: document change review workflow"
```

`local/図面差分ビューア_仕様書.md` はgitignore対象なので通常のコミットには含めず、作業ツリーに残して更新内容を報告する。

---

## Spec Coverage

- 図面比較だけを対象とする範囲：Global Constraints、Task 6、Task 8
- 右パネル、開閉、狭幅ドロワー：Task 6、Task 8
- 全件数、完了数、未確認数、ページ別件数：Task 2、Task 5、Task 6、Task 8
- 追加、削除、変更の種類：Task 1、Task 6、Task 8
- 確認済み、対象外、コメント：Task 2、Task 6、Task 8
- 全ページ索引と進捗、失敗継続：Task 5、Task 8
- 前後移動、ページ移動、自動ズーム：Task 6、Task 8
- 選択枠の画面強調と出力除外：Task 4、Task 6、Task 8
- 手編集、削除、Undo、自動検出への復帰：Task 4、Task 8
- 高確度だけを対象とする自動引継ぎ：Task 2、Task 3、Task 5、Task 8
- PDF差し替え時の初期化：Task 3、Task 5
- 遅延サムネイルと失敗時の継続：Task 7、Task 8
- 対話、索引、出力のWorkerレーン分離：Task 5、Task 7、Task 8
- 外部送信なし、文書、更新日：Global Constraints、Task 8

## Review Gates

- Task 1では種類ビットの膨張が連結形状を変えていないことを、従来テストの矩形座標で確認する。
- Task 2では相互最良、最低IoU、最低スコア、第2候補との差を別々のテストで固定する。
- Task 3では比較条件変更とPDF差し替えを区別し、文書差し替えへ古いレビューを渡さない。
- Task 4ではレビューIDを枠の配列インデックスとして扱わない。削除や表示順変更でインデックスは変わる。
- Task 5では索引結果を世代確認後にだけコミットし、停止済みWorkerの結果を受け入れない。
- Task 5では全ページのフル解像度Canvasを保持しない。索引結果は枠と寸法だけを保存する。
- Task 6ではコメントをHTML文字列へ埋め込まず、DOMの `value` または `textContent` を使う。
- Task 6では一覧選択と枠編集モードを混同しない。一覧選択だけでは編集モードへ入らない。
- Task 7では72 DPI用の `dx` と `dy` を比率変換し、アプリ本体の比較設定を変更しない。
- Task 7では索引レーンが使用中のときにサムネイル処理を同じレーンへ同時投入しない。
- Task 8ではDOMとNodeテストだけで画面受け入れを完了扱いにせず、実ブラウザでデスクトップと狭幅を確認する。
- 全タスクで既存の差分、新旧切替、テキスト比較、PNG、PDF出力の回帰を確認する。
