# 変更箇所インスペクター統合 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 変更箇所一覧へ確認、枠編集、追加、削除、Undoを集約し、サイドバー開閉レールと拡大時の全体ミニマップを追加する。

**Architecture:** 変更枠の幾何情報を正本とし、レビュー情報と選択IDは`state.review`へ保持する。変更箇所一覧は利用者の操作要求をレビューコントローラへ渡し、枠編集コントローラとビューアコントローラが幾何操作と表示変換を分担する。ミニマップは表示済みCanvasを利用する独立コントローラと、DOMに依存しない座標変換関数に分ける。

**Tech Stack:** HTML、CSS、JavaScript ES modules、Canvas 2D、Pointer Events、Vitest 4.1.10、Playwright 1.62.1、Vite 8.2.1

**Spec:** `docs/superpowers/specs/2026-09-10-unified-change-review-editor-design.md`

## Global Constraints

- 成果物は`npm run build`が生成する単一の`dist/index.html`と同梱アセットであり、実行時に外部CDNを使用しない。
- PDF、変更枠、レビュー情報を外部へ送信しない。
- 図面の赤は削除、青は追加、グレーは共通という既存規約を変えない。
- 表示はCSS transform、PNGおよびPDF出力はCanvas実データという既存の分離を維持する。
- レビュー状態は`pending`と`confirmed`の2値だけとし、画面では「確認済み」チェックボックスとして表示する。
- 枠操作のUndo履歴はページ単位で新しい50件を保持する。
- コメント入力中のCtrl+Zは文字編集へ渡す。
- ミニマップ、選択枠、編集ハンドルはPNGおよびPDFへ出力しない。
- `index.html`の更新日を`UPDATED 2026-09-10`へ変更する。
- 実ブラウザ受け入れはChromium、Firefox、WebKitと、1280×800および820×900の表示で確認する。

## File Structure

### Create

- `src/features/viewer/minimap-geometry.js`：図面、表示領域、ミニマップ間の純粋な座標変換を提供する。
- `src/features/viewer/minimap-controller.js`：ミニマップCanvasの描画とPointer Eventsを扱う。
- `tests/unit/minimap-geometry.test.js`：ミニマップ座標変換の単体テストを置く。
- `tests/unit/minimap-controller.test.js`：表示条件、描画更新、ポインター操作の単体テストを置く。
- `tests/e2e/unified-change-inspector.spec.js`：統合後の利用者操作を実PDFで検証する。

### Modify

- `index.html`：旧編集ボタンを除去し、一覧操作、開閉レール、ミニマップのDOMを追加する。
- `src/app/state.js`：枠編集を`idle`、`edit`、`create`のモードで保持し、操作通知をレビュー状態へ追加する。
- `src/app/dom.js`：新しい必須DOM IDへ更新する。
- `src/app/bind-controls.js`：一覧操作、開閉レール、ミニマップのイベントを委譲する。
- `src/app/create-app.js`：レビュー、枠編集、ビューア、ミニマップを接続し、キーボード操作を更新する。
- `src/app/invalidation.js`：派生状態の破棄時に編集モードと未確定ドラッグを初期化する。
- `src/core/change-review/model.js`：レビュー集計を未確認と確認済みの2値へ変更する。
- `src/features/change-review/review-controller.js`：確認チェック、編集開始、削除、追加、ページ復帰要求を公開する。
- `src/features/change-review/review-view.js`：各項目のチェック、編集、削除と、上部の追加、復帰操作を描画する。
- `src/features/box-editor/box-editor-controller.js`：ID起点の編集、明示的な新規作成、ID指定削除、Undo可能な復帰を実装する。
- `src/features/box-editor/box-editor-view.js`：選択IDから編集枠を描き、編集モード別のカーソルを反映する。
- `src/features/export/export-controller.js`：出力スナップショットから画面専用の選択位置を除去する。
- `src/features/viewer/viewport.js`：ビューポート中心を保つリサイズ計算を追加する。
- `src/features/viewer/viewer-controller.js`：表示領域変更、指定図面座標への移動、変換通知を提供する。
- `src/features/text-review/text-controller.js`：テキスト比較への切替時に新しい枠編集終了APIを使う。
- `src/features/visual-diff/visual-controller.js`：ページ変更時に未確定操作を中止する。
- `src/styles/controls.css`：チェックボックス、項目操作、開閉レールの状態を整える。
- `src/styles/layout.css`：サイドバーと開閉レールのデスクトップおよび狭幅配置を定義する。
- `src/styles/viewer.css`：ミニマップと編集モード別カーソルを定義する。
- `tests/helpers/review-dom.js`：新しい一覧DOMをNodeテストへ提供する。
- `tests/unit/change-review-model.test.js`：2値集計へ更新する。
- `tests/unit/review-view.test.js`：チェック、編集、削除、表示状態を検証する。
- `tests/unit/bind-controls.test.js`：新しいイベント委譲を検証する。
- `tests/unit/state.test.js`：枠編集モードと通知状態を検証する。
- `tests/unit/viewport.test.js`：中心維持と指定座標移動を検証する。
- `tests/unit/box-editor-view.test.js`：選択IDとモード別描画を検証する。
- `tests/integration/review-controller.test.js`：編集、削除、追加要求の接続を検証する。
- `tests/integration/box-editor-controller.test.js`：ID起点の全枠操作とUndoを検証する。
- `tests/integration/create-app.test.js`：各コントローラの接続とキーボード優先順位を検証する。
- `tests/integration/export-controller.test.js`：枠編集状態変更後も出力スナップショットが不変であることを検証する。
- `tests/integration/text-controller.test.js`：テキスト比較切替時の編集終了を検証する。
- `tests/integration/visual-controller.test.js`：ページ描画と未確定操作の中止を新しい状態で検証する。
- `tests/unit/invalidation.test.js`：無効化後の編集状態を検証する。
- `tests/unit/dom-error-reporter.test.js`：必須DOM ID一覧を新しい画面構成へ追従させる。
- `tests/e2e/box-editing.spec.js`：旧ツールバー起点の操作を一覧起点へ更新する。
- `tests/e2e/baseline.spec.js`：手編集破棄確認を一覧編集と新規追加から開始する。
- `tests/e2e/change-review-list.spec.js`：状態選択をチェックボックスへ更新する。
- `tests/unit/documentation.test.js`：新しい操作説明と更新日を検証する。
- `README.md`：変更箇所インスペクターとキーボード操作を説明する。
- `C:/Users/yamaguchi/Documents/ws/PDF-Diff-Reviewer/local/図面差分ビューア_仕様書.md`：無視対象の正式仕様へ実装内容と変更履歴を反映する。

---

### Task 1: レビュー状態を確認チェックへ変更する

**Files:**
- Modify: `src/core/change-review/model.js`
- Modify: `src/features/change-review/review-controller.js`
- Modify: `src/features/change-review/review-view.js`
- Modify: `src/app/bind-controls.js`
- Modify: `tests/helpers/review-dom.js`
- Modify: `tests/unit/change-review-model.test.js`
- Modify: `tests/unit/invalidation.test.js`
- Modify: `tests/unit/review-view.test.js`
- Modify: `tests/unit/bind-controls.test.js`
- Modify: `tests/integration/review-controller.test.js`
- Modify: `tests/e2e/change-review-list.spec.js`

**Interfaces:**
- Consumes: `state.review.entriesById: Map<string, {status: "pending" | "confirmed", comment: string}>`
- Produces: `reviewController.setConfirmed(id: string, confirmed: boolean): void`
- Produces: `[data-review-confirmed="<changeId>"]`のネイティブチェックボックス

- [ ] **Step 1: 2値集計の失敗テストを書く**

`tests/unit/change-review-model.test.js`で`excluded`を有効状態として数えないことと、確認済みだけを完了へ数えることを固定する。

```js
expect(REVIEW_STATUS).toEqual({ pending: "pending", confirmed: "confirmed" });
const entries = new Map([
  ["a", { status: "confirmed", comment: "" }],
  ["b", { status: "excluded", comment: "" }],
]);
expect(summarizeReviews(items, entries)).toMatchObject({
  total: 2, confirmed: 1, pending: 1, complete: 1,
});
```

- [ ] **Step 2: 集計テストを実行して失敗を確認する**

Run: `npm test -- tests/unit/change-review-model.test.js`

Expected: `REVIEW_STATUS`に`excluded`が残り、完了件数が2になるためFAILする。

- [ ] **Step 3: レビューモデルを2値へ変更する**

`src/core/change-review/model.js`を次の規則へ変更する。

```js
export const REVIEW_STATUS = Object.freeze({
  pending: "pending",
  confirmed: "confirmed",
});

function emptySummary() {
  return { total: 0, pending: 0, confirmed: 0, complete: 0 };
}

function reviewStatus(entry) {
  return entry?.status === REVIEW_STATUS.confirmed
    ? REVIEW_STATUS.confirmed
    : REVIEW_STATUS.pending;
}

function countReview(summary, status) {
  summary.total += 1;
  summary[status] += 1;
  if (status === REVIEW_STATUS.confirmed) summary.complete += 1;
}
```

- [ ] **Step 4: コントローラと一覧をチェックボックスへ変更する**

`review-controller.js`の`setStatus`を次のAPIへ置き換える。

```js
function setConfirmed(id, confirmed) {
  updateEntry(id, { status: confirmed ? "confirmed" : "pending" });
}
```

`review-view.js`では`select`をラベル付きチェックボックスへ置き換える。

```js
const confirmedLabel = element("label", "review-confirmed-label");
const confirmed = element("input", "review-confirmed");
confirmed.type = "checkbox";
confirmed.dataset.reviewConfirmed = item.id;
confirmedLabel.append(confirmed, element("span", "", "確認済み"));
```

描画時は`confirmed.checked = entry.status === "confirmed"`とし、進捗文言を`確認済み ${summary.complete} / ${summary.total}`へ変更する。

再描画では`data-review-confirmed`を使ってフォーカス中のチェックボックスを特定し、既存のコメント欄と同様にDOMノードとフォーカスを維持する。

`bind-controls.js`は次の委譲だけを状態変更として扱う。

```js
const field = event.target.closest("[data-review-confirmed]");
if (field) reviewController.setConfirmed(field.dataset.reviewConfirmed, field.checked);
```

一覧クリックの除外対象へ`input`と`label`を加え、確認チェックだけで図面の拡大移動が起きないようにする。

- [ ] **Step 5: NodeテストをチェックボックスDOMへ更新する**

`review-view.test.js`では`select`と`option`の期待を削除し、次を検証する。

```js
const checkbox = dom.reviewList.querySelector('[data-review-confirmed="change-2"]');
expect(checkbox.type).toBe("checkbox");
expect(checkbox.checked).toBe(true);
expect(dom.reviewList.textContent).not.toContain("対象外");
```

`bind-controls.test.js`と`review-controller.test.js`では`setConfirmed("change-1", true)`が`confirmed`を保存し、`false`が`pending`を保存することを検証する。

`invalidation.test.js`とレビュー引継ぎテストの`excluded`フィクスチャは、完了項目なら`confirmed`、未完了項目なら`pending`へ置き換える。

- [ ] **Step 6: Chromium E2Eをチェックボックス操作へ更新する**

`change-review-list.spec.js`で`selectOption`を次の操作へ置き換える。

```js
const confirmed = cards.first().locator('[data-review-confirmed]');
await confirmed.check();
await expect(confirmed).toBeChecked();
await expect(page.locator("#reviewProgress")).toContainText(`確認済み 1 / ${total}`);
await expect(page.getByText("対象外", { exact: true })).toHaveCount(0);
```

- [ ] **Step 7: 対象テストを実行する**

Run: `npm test -- tests/unit/change-review-model.test.js tests/unit/review-view.test.js tests/unit/bind-controls.test.js tests/unit/invalidation.test.js tests/integration/review-controller.test.js`

Expected: 対象テストがすべてPASSする。

Run: `npm run test:e2e -- --project=chromium tests/e2e/change-review-list.spec.js`

Expected: Chromiumの変更箇所一覧テストがすべてPASSする。

- [ ] **Step 8: コミットする**

```bash
git add src/core/change-review/model.js src/features/change-review/review-controller.js src/features/change-review/review-view.js src/app/bind-controls.js tests/helpers/review-dom.js tests/unit/change-review-model.test.js tests/unit/review-view.test.js tests/unit/bind-controls.test.js tests/unit/invalidation.test.js tests/integration/review-controller.test.js tests/e2e/change-review-list.spec.js
git commit -m "feat: replace review status with confirmation checkbox"
```

---

### Task 2: 一覧項目から対象枠を編集して削除する

**Files:**
- Modify: `src/app/state.js`
- Modify: `index.html`
- Modify: `src/app/dom.js`
- Modify: `src/app/bind-controls.js`
- Modify: `src/app/create-app.js`
- Modify: `src/app/invalidation.js`
- Modify: `src/features/change-review/review-controller.js`
- Modify: `src/features/change-review/review-view.js`
- Modify: `src/features/box-editor/box-editor-controller.js`
- Modify: `src/features/box-editor/box-editor-view.js`
- Modify: `src/features/export/export-controller.js`
- Modify: `src/features/viewer/viewer-controller.js`
- Modify: `src/features/text-review/text-controller.js`
- Modify: `src/styles/controls.css`
- Modify: `tests/integration/box-editor-controller.test.js`
- Modify: `tests/integration/create-app.test.js`
- Modify: `tests/integration/export-controller.test.js`
- Modify: `tests/integration/review-controller.test.js`
- Modify: `tests/integration/text-controller.test.js`
- Modify: `tests/integration/visual-controller.test.js`
- Modify: `tests/unit/box-editor-view.test.js`
- Modify: `tests/unit/bind-controls.test.js`
- Modify: `tests/unit/dom-error-reporter.test.js`
- Modify: `tests/unit/invalidation.test.js`
- Modify: `tests/unit/viewport.test.js`
- Modify: `tests/e2e/baseline.spec.js`
- Modify: `tests/e2e/box-editing.spec.js`
- Modify: `tests/e2e/change-review-list.spec.js`

**Interfaces:**
- Consumes: `state.review.selectedId: string | null`
- Produces: `state.boxEditor.mode: "idle" | "edit" | "create"`
- Produces: `boxEditorController.startEdit(id: string): boolean`
- Produces: `boxEditorController.stopEditing(): boolean`
- Produces: `boxEditorController.deleteById(id: string): boolean`
- Produces: `reviewController.edit(id: string): Promise<boolean>`
- Produces: `reviewController.remove(id: string): boolean`
- Produces: `state.review.actionNotice: string`
- Produces: `[data-review-edit]`と`[data-review-delete]`の項目操作

- [ ] **Step 1: ID起点編集の失敗テストを書く**

`box-editor-controller.test.js`へ、選択IDだけを移動でき、空白ドラッグでは枠を作らないテストを追加する。

```js
state.review.selectedId = "b";
expect(controller.startEdit("b")).toBe(true);
expect(state.boxEditor.mode).toBe("edit");
drag(controller, { x: 65, y: 65 }, { x: 75, y: 70 });
expect(state.boxEditor.currentBoxes).toEqual([
  { id: "a", x: 10, y: 10, w: 20, h: 20 },
  { id: "b", x: 60, y: 55, w: 20, h: 20 },
]);
drag(controller, { x: 2, y: 2 }, { x: 20, y: 20 });
expect(state.boxEditor.currentBoxes).toHaveLength(2);
```

同じテストファイルへ、非表示ページのID指定削除が該当ページの履歴と一覧同期だけを変更するテストを追加する。

- [ ] **Step 2: 編集コントローラテストを実行して失敗を確認する**

Run: `npm test -- tests/integration/box-editor-controller.test.js`

Expected: `startEdit`と`deleteById`が未定義のためFAILする。

- [ ] **Step 3: 枠編集状態を明示的なモードへ変更する**

`state.js`の`editMode`と`selectedIndex`を次へ置き換える。

```js
boxEditor: {
  showBoxes: true,
  currentBoxes: null,
  autoByPage: new Map(),
  editsByPage: new Map(),
  undoByPage: new Map(),
  revisionByPage: new Map(),
  mode: "idle",
  drag: null,
},
```

`box-editor-controller.js`では現在ページの選択位置をIDから求める。

```js
function selectedIndex(boxes = state.boxEditor.currentBoxes || []) {
  return boxes.findIndex(box => box.id === state.review.selectedId);
}

function startEdit(id) {
  cancelDrag();
  if (!state.visual.rendered || !(state.boxEditor.currentBoxes || []).some(box => box.id === id)) return false;
  state.review.selectedId = id;
  state.boxEditor.mode = "edit";
  state.boxEditor.showBoxes = true;
  refresh();
  return true;
}

function stopEditing() {
  cancelDrag();
  state.boxEditor.mode = "idle";
  view.setCursor?.("");
  refresh();
  return true;
}
```

`createReviewState()`へ`actionNotice: ""`を追加する。

`pointerDown`は`mode === "edit"`のとき、選択枠のハンドルまたは内部だけを操作対象とする。

他の枠または空白を押した場合は`false`を返し、新規作成へ移らない。

- [ ] **Step 4: ID指定削除を実装する**

ページと枠を全ページのレビュー項目から特定し、対象ページの枠配列へ削除を適用する。

```js
function deleteById(id) {
  cancelDrag();
  const item = [...state.review.itemsByPage.values()].flat().find(item => item.id === id);
  if (!item) return false;
  const page = item.pageIndex;
  const source = state.boxEditor.editsByPage.get(page) || state.boxEditor.autoByPage.get(page) || [];
  const index = source.findIndex(box => box.id === id);
  if (index < 0) return false;
  const deletedSelection = state.review.selectedId === id;
  pushUndo(page, source);
  const edits = materializeEdits(page);
  edits.splice(edits.findIndex(box => box.id === id), 1);
  commitChange(page, "delete", edits);
  if (deletedSelection) state.review.selectedId = null;
  if (deletedSelection && state.boxEditor.mode === "edit") stopEditing();
  return true;
}
```

`materializeEdits`と`commitChange`は非表示ページを更新しても`currentBoxes`を別ページの配列へ差し替えないように保つ。

- [ ] **Step 5: レビューコントローラへ編集と削除の要求を追加する**

依存として`beginBoxEdit`、`stopBoxEditing`、`deleteBox`を受け取る。

```js
async function edit(id) {
  if (state.boxEditor.mode === "edit" && state.review.selectedId === id) {
    stopBoxEditing?.();
    onChanged();
    return true;
  }
  stopBoxEditing?.();
  if (!await select(id, { preserveEdit: true })) return false;
  return beginBoxEdit?.(id) ?? false;
}

function remove(id) {
  const deleted = deleteBox?.(id) ?? false;
  if (deleted) {
    state.review.actionNotice = "変更箇所を削除しました。Ctrl+Zで元に戻せます";
    onChanged();
  }
  return deleted;
}
```

通常の`select(id)`、前後移動、別ページ表示は`stopBoxEditing()`を呼んでから選択する。

`edit(id)`から呼ぶ場合だけ`preserveEdit: true`を渡し、ページ表示完了後に対象IDの編集を開始する。

公開名は`edit`と`remove`とし、配列の`delete`演算子と混同しない。

既存の`selectBox`依存、`selectFromBox`、`boxEditorController.selectById`を削除する。

通常の一覧選択は`state.review.selectedId`を更新し、枠表示は同じIDから選択位置を導出する。

`review-view.js`は`actionNotice`がある場合に`reviewNotice`へ表示し、なければ既存の移行通知を表示する。

- [ ] **Step 6: 一覧へ編集と削除を追加して旧編集ボタンを除去する**

`review-view.js`の項目へ次を追加する。

```js
const actions = element("div", "review-actions");
const edit = element("button", "review-edit", "編集");
edit.dataset.reviewEdit = item.id;
const remove = element("button", "review-delete", "削除");
remove.dataset.reviewDelete = item.id;
actions.append(edit, remove);
```

編集対象では`article.classList.toggle("editing", editing)`を設定し、ボタン文言を「編集を終了」へ変える。

`index.html`から`#boxEdit`と`#boxDel`を削除し、`dom.js`と`box-editor-view.js`から対応する参照を削除する。

`bind-controls.js`では一覧クリックを次の優先順位で委譲する。

```js
const edit = event.target.closest("[data-review-edit]");
if (edit) { void reviewController.edit(edit.dataset.reviewEdit); return; }
const remove = event.target.closest("[data-review-delete]");
if (remove) { reviewController.remove(remove.dataset.reviewDelete); return; }
```

- [ ] **Step 7: ビューアとキーボード操作を新しいモードへ追従させる**

`viewer-controller.js`では枠編集がイベントを処理した場合だけパンを止める。

```js
if (state.boxEditor.mode !== "idle" && !spaceHeld && event.button !== 1) {
  if (dom.onBoxPointerDown?.(event)) return;
}
```

`create-app.js`から`E`キーの全体編集切替を削除する。

`Delete`は`mode === "edit"`かつ選択IDがある場合だけ`deleteById`へ渡し、`Esc`は`stopEditing`へ渡す。

`text-controller.js`と`visual-controller.js`は`setEditMode(false)`の代わりに`stopEditing()`を呼ぶ。

`toggleBoxes`、`clearEdits`、`syncInvalidated`も未確定ドラッグを中止して`mode = "idle"`へ戻す。

`invalidation.js`は枠派生状態を破棄するときに`mode = "idle"`と`drag = null`を設定する。

`export-controller.js`は出力に不要な`selectedIndex`をスナップショットから除去する。

関連する出力、無効化、テキスト比較、図面描画のテストデータを`mode`と選択IDへ更新する。

- [ ] **Step 8: 結合テストとE2Eを一覧起点へ更新する**

`create-app.test.js`では次の流れを検証する。

```js
await reviewController.edit("change-2");
expect(state.review.selectedId).toBe("change-2");
expect(state.boxEditor.mode).toBe("edit");
reviewController.remove("change-2");
expect(state.review.itemsByPage.get(0).some(item => item.id === "change-2")).toBe(false);
```

`box-editing.spec.js`は`#boxEdit`を押さず、対象行の`[data-review-edit]`を押して移動と八方向リサイズを検証する。

削除は`[data-review-delete]`と`Delete`キーの両方を検証する。

`baseline.spec.js`の手編集破棄確認は、一覧項目の編集または新規追加から手編集を作る流れへ更新する。

- [ ] **Step 9: 対象テストを実行する**

Run: `npm test -- tests/integration/box-editor-controller.test.js tests/integration/create-app.test.js tests/integration/export-controller.test.js tests/integration/review-controller.test.js tests/integration/text-controller.test.js tests/integration/visual-controller.test.js tests/unit/box-editor-view.test.js tests/unit/bind-controls.test.js tests/unit/dom-error-reporter.test.js tests/unit/invalidation.test.js tests/unit/state.test.js tests/unit/viewport.test.js`

Expected: 対象テストがすべてPASSする。

Run: `npm run test:e2e -- --project=chromium tests/e2e/box-editing.spec.js`

Expected: Chromiumで一覧起点の編集と削除がPASSする。

Run: `npm run test:e2e -- --project=chromium tests/e2e/baseline.spec.js`

Expected: Chromiumで手編集の破棄確認と既存表示の回帰テストがPASSする。

Run: `npm run test:e2e -- --project=chromium tests/e2e/change-review-list.spec.js`

Expected: Chromiumで一覧選択と編集状態の分離がPASSする。

- [ ] **Step 10: 廃止した状態とDOM IDの参照を検査する**

Run: `rg -n "state\\.boxEditor\\.(editMode|selectedIndex)|#boxEdit|#boxDel|selectFromBox|selectById" src tests index.html`

Expected: 該当する参照が0件である。

- [ ] **Step 11: コミットする**

```bash
git add index.html src/app/state.js src/app/dom.js src/app/bind-controls.js src/app/create-app.js src/app/invalidation.js src/features/change-review/review-controller.js src/features/change-review/review-view.js src/features/box-editor/box-editor-controller.js src/features/box-editor/box-editor-view.js src/features/export/export-controller.js src/features/viewer/viewer-controller.js src/features/text-review/text-controller.js src/features/visual-diff/visual-controller.js src/styles/controls.css tests/integration/box-editor-controller.test.js tests/integration/create-app.test.js tests/integration/export-controller.test.js tests/integration/review-controller.test.js tests/integration/text-controller.test.js tests/integration/visual-controller.test.js tests/unit/box-editor-view.test.js tests/unit/bind-controls.test.js tests/unit/dom-error-reporter.test.js tests/unit/invalidation.test.js tests/unit/state.test.js tests/unit/viewport.test.js tests/e2e/baseline.spec.js tests/e2e/box-editing.spec.js tests/e2e/change-review-list.spec.js
git commit -m "feat: edit and delete boxes from change list"
```

---

### Task 3: 新規追加とページ別Undoを一覧へ統合する

**Files:**
- Modify: `index.html`
- Modify: `src/app/state.js`
- Modify: `src/app/dom.js`
- Modify: `src/app/bind-controls.js`
- Modify: `src/app/create-app.js`
- Modify: `src/features/change-review/review-controller.js`
- Modify: `src/features/change-review/review-view.js`
- Modify: `src/features/box-editor/box-editor-controller.js`
- Modify: `src/features/box-editor/box-editor-view.js`
- Modify: `src/styles/controls.css`
- Modify: `tests/helpers/review-dom.js`
- Modify: `tests/integration/box-editor-controller.test.js`
- Modify: `tests/integration/create-app.test.js`
- Modify: `tests/unit/review-view.test.js`
- Modify: `tests/unit/bind-controls.test.js`
- Modify: `tests/unit/dom-error-reporter.test.js`
- Modify: `tests/e2e/box-editing.spec.js`

**Interfaces:**
- Consumes: `boxEditorController.startEdit(id)`とページ別`undoByPage`
- Produces: `boxEditorController.startCreate(): boolean`
- Produces: `boxEditorController.undo(): boolean`
- Produces: `boxEditorController.resetToAuto(): boolean`
- Produces: `reviewController.startCreate(): boolean`
- Produces: `reviewController.resetCurrentPage(): boolean`
- Consumes: `state.review.actionNotice: string`
- Produces: `#reviewAdd`と`#reviewReset`

- [ ] **Step 1: 新規作成と復帰Undoの失敗テストを書く**

`box-editor-controller.test.js`へ次のシナリオを追加する。

```js
expect(controller.startCreate()).toBe(true);
expect(state.boxEditor.mode).toBe("create");
drag(controller, { x: 70, y: 70 }, { x: 90, y: 90 });
expect(state.boxEditor.mode).toBe("edit");
expect(state.review.selectedId).toBe("manual-1");
expect(state.boxEditor.currentBoxes.at(-1)).toMatchObject({
  id: "manual-1", kind: "changed", source: "manual",
});
expect(controller.undo()).toBe(true);
expect(state.boxEditor.currentBoxes.some(box => box.id === "manual-1")).toBe(false);
```

同じページで手編集後に`resetToAuto()`を実行し、`undo()`で手編集枠とIDが戻ることも検証する。

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test -- tests/integration/box-editor-controller.test.js`

Expected: `startCreate`が未定義で、復帰処理が履歴を削除するためFAILする。

- [ ] **Step 3: 明示的な新規作成を実装する**

`box-editor-controller.js`へ次を追加する。

```js
function startCreate() {
  cancelDrag();
  if (!state.visual.rendered) return false;
  state.boxEditor.mode = "create";
  state.boxEditor.showBoxes = true;
  state.review.selectedId = null;
  view.setCursor?.("crosshair");
  refresh();
  return true;
}
```

`pointerDown`は`mode === "create"`のときだけ`kind: "create"`のドラッグを開始する。

作成成功時は`makeManualBox`が返したIDを`state.review.selectedId`へ設定し、`mode`を`edit`へ変更する。

最小寸法未満では変更せず、`onNotice("枠が小さすぎます")`を呼んで`idle`へ戻る。

- [ ] **Step 4: 自動検出への復帰をUndo可能にする**

`resetToAuto`は履歴を削除せず、現在の手編集枠を保存してから自動枠へ差し替える。

```js
function resetToAuto() {
  cancelDrag();
  const page = state.documents.currentPage;
  const edits = state.boxEditor.editsByPage.get(page);
  if (!edits || !confirmResetToAuto()) return false;
  pushUndo(page, edits);
  state.boxEditor.editsByPage.delete(page);
  state.boxEditor.currentBoxes = cloneBoxes(state.boxEditor.autoByPage.get(page) || []);
  state.boxEditor.mode = "idle";
  commitChange(page, "reset", state.boxEditor.currentBoxes);
  refresh();
  return true;
}
```

`undo()`は自動枠表示中でも履歴を取り出し、手編集配列として復元する。

- [ ] **Step 5: サイドバー上部へ追加と復帰の操作を置く**

`index.html`のレビュー操作領域へ次を追加し、旧`#boxReset`を削除する。

```html
<div class="review-tools">
  <button id="reviewAdd" disabled>＋ 新規変更箇所</button>
  <button id="reviewReset" disabled>このページを自動検出に戻す</button>
</div>
```

`review-view.js`は差分描画済みの場合だけ`reviewAdd`を有効にし、現在ページに手編集がある場合だけ`reviewReset`を有効にする。

`reviewNotice`には`actionNotice`を優先し、なければ既存の移行通知を表示する。

- [ ] **Step 6: 追加、復帰、Ctrl+Zを接続する**

`review-controller.js`へ`startCreate`と`resetCurrentPage`を追加し、`create-app.js`で枠編集コントローラへ接続する。

`bind-controls.js`は`#reviewAdd`と`#reviewReset`をそれぞれ公開操作へ渡す。

`create-app.js`のキー処理では、文字入力対象を除き、表示モード中のCtrl+Zを編集モードに関係なく`boxEditorController.undo()`へ渡す。

```js
if ((event.ctrlKey || event.metaKey) && (event.key === "z" || event.key === "Z")) {
  if (!state.visual.rendered) return;
  event.preventDefault();
  boxEditorController.undo();
  return;
}
```

`Esc`は`create`を中止し、`edit`を終了する。

- [ ] **Step 7: 結合テストとE2Eを追加する**

`create-app.test.js`でコメント入力中のCtrl+Zが枠Undoを呼ばず、削除ボタンからフォーカスが戻った後のCtrl+Zが削除を戻すことを検証する。

`box-editing.spec.js`へ次の利用者操作を追加する。

```js
await page.locator("#reviewAdd").click();
await dragInside(page.locator("#boxLayer"), .70, .70, .84, .82);
const manual = page.locator('[data-change-id]').filter({ hasText: "変更" }).last();
await expect(manual.locator('[data-review-confirmed]')).not.toBeChecked();
await manual.locator('[data-review-delete]').click();
await page.keyboard.press("Control+z");
await expect(manual).toBeVisible();
```

復帰確認を承認した後に手編集が消え、Ctrl+Zで同じIDとコメントが戻るシナリオも追加する。

- [ ] **Step 8: 対象テストを実行する**

Run: `npm test -- tests/integration/box-editor-controller.test.js tests/integration/create-app.test.js tests/unit/review-view.test.js tests/unit/bind-controls.test.js`

Expected: 対象テストがすべてPASSする。

Run: `npm run test:e2e -- --project=chromium tests/e2e/box-editing.spec.js`

Expected: Chromiumで新規追加、削除、復元、自動検出への復帰がPASSする。

- [ ] **Step 9: コミットする**

```bash
git add index.html src/app/state.js src/app/dom.js src/app/bind-controls.js src/app/create-app.js src/features/change-review/review-controller.js src/features/change-review/review-view.js src/features/box-editor/box-editor-controller.js src/features/box-editor/box-editor-view.js src/styles/controls.css tests/helpers/review-dom.js tests/integration/box-editor-controller.test.js tests/integration/create-app.test.js tests/unit/review-view.test.js tests/unit/bind-controls.test.js tests/unit/dom-error-reporter.test.js tests/e2e/box-editing.spec.js
git commit -m "feat: add changes and undo box operations from review panel"
```

---

### Task 4: サイドバーを境界レールで開閉する

**Files:**
- Modify: `index.html`
- Modify: `src/app/dom.js`
- Modify: `src/app/bind-controls.js`
- Modify: `src/app/create-app.js`
- Modify: `src/features/change-review/review-controller.js`
- Modify: `src/features/change-review/review-view.js`
- Modify: `src/features/viewer/viewport.js`
- Modify: `src/features/viewer/viewer-controller.js`
- Modify: `src/styles/layout.css`
- Modify: `src/styles/controls.css`
- Modify: `tests/helpers/review-dom.js`
- Modify: `tests/unit/review-view.test.js`
- Modify: `tests/unit/bind-controls.test.js`
- Modify: `tests/unit/dom-error-reporter.test.js`
- Modify: `tests/unit/viewport.test.js`
- Modify: `tests/integration/create-app.test.js`
- Modify: `tests/e2e/change-review-list.spec.js`

**Interfaces:**
- Consumes: `reviewController.togglePanel(open?: boolean)`
- Produces: `#reviewRailToggle`と`aria-expanded`
- Produces: `viewerController.handleResize(): {scale: number, tx: number, ty: number}`
- Produces: `preserveViewportCenter(view, oldViewport, newViewport): View`

- [ ] **Step 1: ビューポート維持とレール表示の失敗テストを書く**

`viewport.test.js`へ、拡大中のページ中心を新しい表示領域でも維持するテストを追加する。

```js
expect(preserveViewportCenter(
  { scale: 2, tx: -300, ty: -100 },
  { width: 800, height: 600 },
  { width: 500, height: 600 },
)).toEqual({ scale: 2, tx: -450, ty: -100 });
```

`review-view.test.js`へ、閉状態で`«`と「変更箇所を開く」、開状態で`»`と「変更箇所を閉じる」を表示するテストを追加する。

- [ ] **Step 2: 対象テストを実行して失敗を確認する**

Run: `npm test -- tests/unit/viewport.test.js tests/unit/review-view.test.js`

Expected: `preserveViewportCenter`と`reviewRailToggle`が未定義のためFAILする。

- [ ] **Step 3: ビューポート中心維持を実装する**

`viewport.js`へ次を追加する。

```js
export function preserveViewportCenter(view, oldViewport, newViewport) {
  const pageCenter = {
    x: (oldViewport.width / 2 - view.tx) / view.scale,
    y: (oldViewport.height / 2 - view.ty) / view.scale,
  };
  return {
    scale: view.scale,
    tx: newViewport.width / 2 - pageCenter.x * view.scale,
    ty: newViewport.height / 2 - pageCenter.y * view.scale,
  };
}
```

`viewer-controller.js`は直前の表示領域寸法を保持する。

リサイズ前の表示が`fitViewport`と1%以内で一致する場合は`fit()`を呼び、それ以外は`preserveViewportCenter`の結果を`apply()`する。

- [ ] **Step 4: 開閉レールのDOMと表示を実装する**

`index.html`から`#reviewToggle`と`#reviewClose`を削除し、図面ビューとレビューサイドバーの間へ次を追加する。

```html
<div id="reviewRail" class="review-rail">
  <button id="reviewRailToggle" aria-controls="reviewPanel" aria-expanded="false"
    aria-label="変更箇所を開く">«</button>
</div>
```

`review-view.js`は表示状態に応じてボタン文言、`aria-label`、`aria-expanded`を更新する。

テキスト比較モードでは`reviewRail.hidden = true`とし、視覚比較へ戻ったら開閉状態を復元する。

- [ ] **Step 5: デスクトップと狭幅の配置を実装する**

`layout.css`のグリッドを次の四列へ変更する。

```css
main{grid-template-columns:288px minmax(0,1fr) 28px 0}
.review-open main{grid-template-columns:288px minmax(0,1fr) 28px 320px}
.review-rail{grid-column:3;position:relative;background:var(--panel);border-left:1px solid var(--line)}
.review-panel{grid-column:4}
```

1099px以下ではサイドバーを右ドロワーにし、レールをサイドバー左端へ固定する。

閉状態では`right:0`、開状態では`right:min(320px, calc(100vw - 44px))`とする。

サイドバー幅は`min(320px, calc(100vw - 44px))`とし、レールの操作領域を残す。

- [ ] **Step 6: 開閉と編集終了を接続する**

`bind-controls.js`は`reviewRailToggle`と背景押下を`togglePanel`へ渡す。

`review-controller.js`はパネルを閉じる前に注入された`stopBoxEditing()`を呼ぶ。

`create-app.js`は開閉描画後の`requestAnimationFrame`で`viewerController.handleResize()`を呼び、デスクトップの表示中心を補正する。

編集状態ではないときの`Esc`は、狭幅ドロワーが開いている場合だけ閉じる。

- [ ] **Step 7: レスポンシブE2Eを更新する**

`change-review-list.spec.js`の1280pxと820pxのケースで次を検証する。

```js
await expect(page.locator("#reviewRailToggle")).toHaveText("»");
await page.locator("#reviewRailToggle").click();
await expect(page.locator("#reviewPanel")).toBeHidden();
await expect(page.locator("#reviewRailToggle")).toHaveText("«");
await page.locator("#reviewRailToggle").click();
await expect(page.locator("#reviewPanel")).toBeVisible();
```

1280pxでは拡大中の図面中心が開閉前後で一致し、820pxでは横スクロールが発生せず背景押下で閉じることを検証する。

- [ ] **Step 8: 対象テストを実行する**

Run: `npm test -- tests/unit/viewport.test.js tests/unit/review-view.test.js tests/unit/bind-controls.test.js tests/integration/create-app.test.js`

Expected: 対象テストがすべてPASSする。

Run: `npm run test:e2e -- --project=chromium tests/e2e/change-review-list.spec.js`

Expected: Chromiumの1280pxと820pxで開閉と表示維持がPASSする。

- [ ] **Step 9: コミットする**

```bash
git add index.html src/app/dom.js src/app/bind-controls.js src/app/create-app.js src/features/change-review/review-controller.js src/features/change-review/review-view.js src/features/viewer/viewport.js src/features/viewer/viewer-controller.js src/styles/layout.css src/styles/controls.css tests/helpers/review-dom.js tests/unit/review-view.test.js tests/unit/bind-controls.test.js tests/unit/dom-error-reporter.test.js tests/unit/viewport.test.js tests/integration/create-app.test.js tests/e2e/change-review-list.spec.js
git commit -m "feat: toggle change review from sidebar rail"
```

---

### Task 5: 拡大時の全体ミニマップを追加する

**Files:**
- Create: `src/features/viewer/minimap-geometry.js`
- Create: `src/features/viewer/minimap-controller.js`
- Create: `tests/unit/minimap-geometry.test.js`
- Create: `tests/unit/minimap-controller.test.js`
- Create: `tests/e2e/unified-change-inspector.spec.js`
- Modify: `index.html`
- Modify: `src/app/dom.js`
- Modify: `src/app/bind-controls.js`
- Modify: `src/app/create-app.js`
- Modify: `src/features/viewer/viewer-controller.js`
- Modify: `src/styles/viewer.css`
- Modify: `tests/unit/dependency-boundaries.test.js`
- Modify: `tests/unit/dom-error-reporter.test.js`

**Interfaces:**
- Consumes: `viewerController.getView()`と`viewerController.apply(view)`
- Produces: `containTransform(content: Size, bounds: Size): MiniTransform | null`
- Produces: `visibleContentRect(view: View, viewport: Size, content: Size): Rect`
- Produces: `minimapPointToContent(point: Point, transform: MiniTransform, content: Size): Point`
- Produces: `centerViewOnPoint(view: View, viewport: Size, content: Size, point: Point): View`
- Produces: `createMinimapController({state, dom, colors, createCanvas, getView, applyView}): MinimapController`
- Produces: `minimapController.refreshSource(): void`と`minimapController.render(): void`

- [ ] **Step 1: ミニマップ座標変換の失敗テストを書く**

`tests/unit/minimap-geometry.test.js`へ次を追加する。

```js
expect(containTransform(
  { width: 1000, height: 500 },
  { width: 180, height: 140 },
)).toEqual({ scale: 0.18, x: 0, y: 25, width: 180, height: 90 });

expect(visibleContentRect(
  { scale: 2, tx: -400, ty: -100 },
  { width: 600, height: 400 },
  { width: 1000, height: 500 },
)).toEqual({ x: 200, y: 50, w: 300, h: 200 });

expect(minimapPointToContent(
  { x: 90, y: 70 },
  { scale: 0.18, x: 0, y: 25, width: 180, height: 90 },
  { width: 1000, height: 500 },
)).toEqual({ x: 500, y: 250 });
```

`centerViewOnPoint`ではページがビューより大きい軸を端までに制限し、小さい軸を中央へ置くケースを検証する。

- [ ] **Step 2: 座標変換テストを実行して失敗を確認する**

Run: `npm test -- tests/unit/minimap-geometry.test.js`

Expected: `minimap-geometry.js`が存在しないためFAILする。

- [ ] **Step 3: 純粋な座標変換を実装する**

`minimap-geometry.js`へ次の境界処理を実装する。

```js
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function clampAxis(offset, scaledSize, viewportSize) {
  if (scaledSize <= viewportSize) return (viewportSize - scaledSize) / 2;
  return clamp(offset, viewportSize - scaledSize, 0);
}

export function centerViewOnPoint(view, viewport, content, point) {
  const tx = viewport.width / 2 - point.x * view.scale;
  const ty = viewport.height / 2 - point.y * view.scale;
  return {
    scale: view.scale,
    tx: clampAxis(tx, content.width * view.scale, viewport.width),
    ty: clampAxis(ty, content.height * view.scale, viewport.height),
  };
}
```

`containTransform`は縦横比を維持し、`visibleContentRect`はビューポート四辺を逆変換して図面範囲へ制限する。

- [ ] **Step 4: ミニマップコントローラの失敗テストを書く**

`tests/unit/minimap-controller.test.js`で次を検証する。

```js
controller.render();
expect(dom.root.hidden).toBe(true);
viewer.apply({ scale: fitScale * 1.02, tx: -10, ty: -20 });
controller.refreshSource();
expect(dom.root.hidden).toBe(false);
expect(baseContext.drawImage).toHaveBeenCalledWith(dom.source, 0, 25, 180, 90);
controller.render();
expect(baseContext.drawImage).toHaveBeenCalledTimes(1);
controller.pointerDown(pointerAt(90, 70));
expect(applyView).toHaveBeenCalledWith(expect.objectContaining({ scale: fitScale * 1.02 }));
```

選択中の変更枠が現在ページにある場合だけ種別色の線を描くことも検証する。

`drawImage`が例外を投げた場合はルートを隠し、例外をビューア操作へ伝播させないことも検証する。

- [ ] **Step 5: ミニマップコントローラを実装する**

`createMinimapController`は`colors`として琥珀、追加、削除、変更の色を受け取り、最大180×140 CSS pxで表示済み`#out`を内部の縮小Canvasへ描く。

全体表示倍率との差が1%以下ならルートを隠す。

```js
const fit = fitViewport(content, viewport);
const visible = Boolean(fit && view.scale > fit.scale * 1.01 && state.visual.rendered);
dom.root.hidden = !visible;
if (!visible) return;
const mini = containTransform(content, { width: 180, height: 140 });
baseContext.drawImage(dom.source, mini.x, mini.y, mini.width, mini.height);
```

`refreshSource()`だけが表示済みCanvasから縮小画像を作り、`render()`は縮小画像を表示用Canvasへ複写して表示範囲と選択枠を重ねる。

ズームとパンによる`render()`の連続呼び出しでは、高解像度の表示済みCanvasを再縮小しない。

ポインター押下時はミニマップ座標を図面座標へ変換し、`centerViewOnPoint`の結果を`applyView`へ渡す。

ドラッグ中は同じ変換を連続適用し、`pointerup`と`pointercancel`でキャプチャを解放する。

各ポインターイベントで`preventDefault()`と`stopPropagation()`を呼び、背後の図面パンと枠編集を開始させない。

描画に失敗した場合は`try`と`catch`でルートを隠し、次の変換通知で再描画を試す。

- [ ] **Step 6: DOMとアプリ接続を追加する**

`index.html`の`.canvas-wrap`へ次を追加する。

```html
<div id="minimap" class="minimap" hidden>
  <canvas id="minimapCanvas" width="180" height="140"
    aria-label="ページ全体。クリックまたはドラッグで表示位置を移動"></canvas>
</div>
```

`dom.js`へ`minimap`と`minimapCanvas`を追加する。

`create-app.js`でミニマップコントローラを生成し、ビューアの`onTransform`から`boxEditorView.redraw()`と`minimapController.render()`を呼ぶ。

色は`getComputedStyle(document.documentElement)`から既存CSS変数を読み、`colors`依存へ渡す。

ページ描画と新旧切替のCanvas更新後は`refreshSource()`を呼ぶ。

一覧選択とサイドバー開閉後は`render()`だけを呼ぶ。

`bind-controls.js`は`minimapCanvas`の`pointerdown`、`pointermove`、`pointerup`、`pointercancel`をミニマップコントローラへ委譲する。

`dependency-boundaries.test.js`へ、ミニマップ座標変換が`src/app/`やDOMへ依存しない検査を追加する。

- [ ] **Step 7: ミニマップの外観と狭幅配置を実装する**

`viewer.css`へ次を追加する。

```css
.minimap{position:absolute;right:14px;bottom:14px;z-index:6;padding:4px;background:var(--panel);border:1px solid var(--line-bright)}
.minimap canvas{display:block;width:180px;height:140px;cursor:crosshair;touch-action:none}
.minimap[hidden]{display:none}
@media(max-width:1099px){.minimap{right:auto;left:14px}}
```

琥珀色の表示範囲線と種別色の選択線は既存CSS変数から取得し、JavaScriptへ新しい色定数を重複させない。

- [ ] **Step 8: 実PDFのミニマップE2Eを書く**

`unified-change-inspector.spec.js`へ次のシナリオを追加する。

```js
await loadReview(page);
await page.locator('[data-review-thumbnail]').first().click();
await expect(page.locator("#minimap")).toBeVisible();
const before = await page.locator("#out").evaluate(node => node.style.transform);
await page.locator("#minimapCanvas").click({ position: { x: 150, y: 110 } });
await expect.poll(() => page.locator("#out").evaluate(node => node.style.transform)).not.toBe(before);
await page.locator("#zoomFit").click();
await expect(page.locator("#minimap")).toBeHidden();
```

ドラッグでも複数回の変換通知が発生し、サイドバー表示中の820px幅でミニマップがサイドバーに隠れないことを検証する。

- [ ] **Step 9: 対象テストを実行する**

Run: `npm test -- tests/unit/minimap-geometry.test.js tests/unit/minimap-controller.test.js tests/unit/viewport.test.js tests/unit/dependency-boundaries.test.js tests/integration/create-app.test.js`

Expected: 対象テストがすべてPASSする。

Run: `npm run test:e2e -- --project=chromium tests/e2e/unified-change-inspector.spec.js`

Expected: Chromiumでミニマップの表示、クリック、ドラッグ、非表示がPASSする。

- [ ] **Step 10: コミットする**

```bash
git add index.html src/app/dom.js src/app/bind-controls.js src/app/create-app.js src/features/viewer/minimap-geometry.js src/features/viewer/minimap-controller.js src/features/viewer/viewer-controller.js src/styles/viewer.css tests/unit/minimap-geometry.test.js tests/unit/minimap-controller.test.js tests/unit/dependency-boundaries.test.js tests/unit/dom-error-reporter.test.js tests/integration/create-app.test.js tests/e2e/unified-change-inspector.spec.js
git commit -m "feat: add overview minimap for zoomed changes"
```

---

### Task 6: 文書更新と全ブラウザ受け入れを完了する

**Files:**
- Modify: `README.md`
- Modify: `index.html`
- Modify: `tests/unit/documentation.test.js`
- Modify: `tests/e2e/unified-change-inspector.spec.js`
- Modify outside Git: `C:/Users/yamaguchi/Documents/ws/PDF-Diff-Reviewer/local/図面差分ビューア_仕様書.md`

**Interfaces:**
- Consumes: Task 1からTask 5までの完成UIと公開操作
- Produces: 利用者向け操作説明、正式仕様、全テストと実ブラウザの受け入れ証拠

- [ ] **Step 1: 文書要件の失敗テストを書く**

`documentation.test.js`のレビュー説明テストを次へ更新する。

```js
for (const term of [
  "変更箇所", "確認済み", "コメント", "編集", "削除",
  "新規変更箇所", "Ctrl+Z", "ミニマップ", "メモリ上",
]) expect(readme).toContain(term);
expect(readme).not.toContain("対象外");
expect(html).toContain("UPDATED 2026-09-10");
```

- [ ] **Step 2: 文書テストを実行して失敗を確認する**

Run: `npm test -- tests/unit/documentation.test.js`

Expected: READMEに新しい操作説明がなく、更新日が古いためFAILする。

- [ ] **Step 3: READMEと更新日を変更する**

READMEの変更箇所レビュー手順を次の順序で説明する。

1. サイドバーを`«`と`»`で開閉する。
2. サムネイルから変更箇所を表示する。
3. 確認済みチェックとコメントを入力する。
4. 編集で枠を移動または八方向へリサイズする。
5. 新規変更箇所をドラッグで追加する。
6. 不要な変更箇所を削除し、Ctrl+Zで戻す。
7. 拡大中はミニマップでページ内を移動する。

「対象外」の説明を削除し、レビュー情報がメモリ上だけに存在する境界は維持する。

`index.html`のヘッダーを`UPDATED 2026-09-10`へ変更する。

- [ ] **Step 4: 正式仕様を更新する**

`C:/Users/yamaguchi/Documents/ws/PDF-Diff-Reviewer/local/図面差分ビューア_仕様書.md`へ、承認済み設計の次を反映する。

- 変更箇所一覧と枠編集の統合
- 確認チェックと「対象外」の廃止
- 編集、削除、新規追加、自動検出への復帰
- ページ別Ctrl+Z
- 開閉レール
- 拡大時の全体ミニマップ
- 2026-09-10の変更履歴

このファイルは`.gitignore`対象なのでステージングしない。

- [ ] **Step 5: 統合E2Eへアクセシビリティと出力境界を追加する**

`unified-change-inspector.spec.js`で次を検証する。

```js
await expect(page.locator("#reviewRailToggle")).toHaveAttribute("aria-label", "変更箇所を閉じる");
await expect(page.locator('[data-review-confirmed]').first()).toHaveAccessibleName(/確認済み/);
await page.locator('[data-review-edit]').first().focus();
await expect(page.locator('[data-review-edit]').first()).toBeFocused();
```

PNG保存前後でミニマップの可視状態と図面のtransformが変わらず、ダウンロード画像へミニマップCanvasを合成していないことを既存出力テストと合わせて確認する。

- [ ] **Step 6: 全Vitestとビルドを実行する**

Run: `npm test`

Expected: 全VitestがPASSする。

Run: `npm run build`

Expected: Viteビルドと`tests/verify-dist.mjs`がPASSし、`dist/index.html`が生成される。

- [ ] **Step 7: 全Playwrightを実行する**

Run: `npm run test:e2e`

Expected: Chromium、Firefox、WebKitの全E2EがPASSする。

- [ ] **Step 8: 実ブラウザ表示を確認する**

Run: `npm run dev -- --port 4173`

1280×800と820×900で旧版と新版の実PDFを読み込み、次の画面を確認する。

- サイドバーを開いた状態と閉じた状態
- 確認チェック、編集、削除が並ぶ一覧項目
- 八つのハンドルを表示した編集状態
- 新規作成中の十字カーソルとプレビュー枠
- サムネイル選択後のミニマップ
- 狭幅ドロワーと左下ミニマップの非重複

Playwrightのスクリーンショットを受け入れ証拠として保存し、図面、操作部品、ミニマップの欠けと横スクロールがないことを目視確認する。

- [ ] **Step 9: 文書と最終E2Eをコミットする**

```bash
git add README.md index.html tests/unit/documentation.test.js tests/e2e/unified-change-inspector.spec.js
git commit -m "docs: document unified change review workflow"
```

- [ ] **Step 10: 最終状態を確認する**

Run: `git status --short --branch`

Expected: Git管理対象の作業ツリーがクリーンで、`feat/change-review-list`が実装コミット分だけリモートより先行している。

Run: `git log --oneline -8`

Expected: 設計、計画、確認チェック、一覧編集、追加とUndo、開閉レール、ミニマップ、文書更新の履歴を確認できる。
