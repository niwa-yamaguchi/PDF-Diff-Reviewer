# Task 13 PNG/PDF出力機能: 引き継ぎレポート

## Status

IMPLEMENTATION COMPLETE

Base: `3758a4f`

Commit: `refactor: isolate export pipeline`（本レポートを含むTask 13 commit）

## TDD evidence

production module作成前に、composer、PDF exporter、export controllerの必須契約をテストへ固定した。

```powershell
npm.cmd run test -- tests/unit/image-composer.test.js tests/unit/pdf-exporter.test.js tests/integration/export-controller.test.js
```

REDは `3 files failed / 0 tests`。`image-composer.js`、`pdf-exporter.js`、`export-controller.js` が未存在という期待したimport failureだった。

最小実装後は `3 files / 13 tests passed`。自己監査で、diff/toggle PNGの凡例・filename、render/PDF/download失敗、保護対象DOM/view/cache、live state変更耐性を補強し、最終focusedは `3 files / 18 tests passed`、全Vitestは `25 files / 164 tests passed`。

初回GREENで3件の期待値不備を再現した。テキストNEWラベルの手計算Y座標が66ではなく78、450pxを150dpiからptへ戻すIEEE 754結果が216直値ではなく215.999...だった。production挙動は既存式と一致していたため、原因を確認してテストだけを正しい座標と`toBeCloseTo`へ修正した。

## Snapshot schema and async ownership

各public saveは最初の`await`前に単一のfrozen snapshotを作る。

- documents: old/new document参照、generation、pages/currentPage、old/new sequenceの複製
- comparison: DPI、しきい値、許容差、dx/dy、手動角度/倍率、自動整列、quadrant manual Mapの複製
- visual: mode/side、render/quadrant generation、current plan、toggle/page/alignment/quadrant cacheの複製
- box editor: show/current boxes、auto/manual/undo用Mapのうち出力入力となるauto/manual/revisionの複製、selected/drag値
- text: old/new documents、highlight Map/entry/tokenの複製、scale/page/total、extract/render generation
- UI: top mode

visual PDFの全ページへ同じroot snapshot identityを渡し、各ページ用の`mode: "diff"` render snapshotだけを値から派生する。text PNG/PDFも同じsnapshotのdocuments/highlights/scaleだけでoffscreen描画する。

visual/text別のowner session tokenを持ち、後発出力は最初のprior UI ownershipを継承する。完了時はsession identity、document generation、最後に自身が設定したstatus文字列を確認する。古い完了・古い失敗・document load・別処理によるstatus変更は、statusやbuttonを上書きしない。current処理は`try/catch/finally`でbusy classと元のbutton disabled値を復元する。

## Protected-state proof

export controllerは画面用`showPage()`を呼ばず、visualは`renderDiffPage(renderSnapshot, dependencies)`、textは`textRenderer.renderOffscreen({snapshot})`へlegacy composition rootから直接接続した。

integration testで次を確認した。

- multi-page visual PDF後も`autoByPage`のMap identityと全entry内容が同一
- out/text Canvas identity、寸法、pixel sentinel、transformが同一
- current page、selected box、drag、visual/text generations、visual cache Maps、current plan、manual/undo/revision Maps、current boxes、text extraction/highlights/view、mode/top mode、page/zoom/stat labelsが同一
- 1ページ目await後にlive DPI/document/sequence/showBoxes/manual boxes/text scale/highlightsを変更しても、2ページ目は開始時snapshotだけを参照
- manual page boxesがrenderer auto boxesより優先され、boxes offでは枠も変更枠凡例も出ず、auto/manual Mapへ書き戻さない
- current null Blob、visual PDF render、text render、download失敗は1回だけreportし、owned controlsを復元
- 後発PDF成功後の旧PDF失敗は成功statusとcontrolsを変更しない

static grepではexport modulesにon-screen `showPage`、画面Canvas寸法書換え、保護Map/generation/currentPageへの直接書込み、feature間importがなく、legacyの旧composer/handler定義も残っていない。

## Composition and output parity

- visual PNGはcommitted full-resolution sourceを同寸Canvasへ同期複製してからBlob化する。sourceの寸法/pixelを変更しない。
- toggle + boxes offは裸画像、toggle + boxes onは変更枠だけ、diffは共通/削除/追加とshowBoxes連動の変更枠凡例を出す。
- visual PDFは画面modeに関係なく全ページdiff。150dpi基準の既存box line width、DPI/72の凡例、pxからptへの換算、縦横orientation、`compress: true`、PNG addImage座標と`diff.pdf`を維持した。
- textはOLD/NEWを28px label bandと24px gapで縦積みし、横中央、missing side白fallback、ページラベル、凡例幅guard、既存3色を維持した。
- PNG filenameは`diff_pN.png`、`old_pN.png`、`new_pN.png`、`textdiff_pN.png`、PDFは`diff.pdf`/`textdiff.pdf`で、開始snapshotから決定する。
- platform download adapterとjsPDF dependency injectionを維持し、外部送信は追加していない。

## Verification

- focused final: `3 files / 18 tests passed`
- full Vitest final: `25 files / 164 tests passed`
- E2E: 9 casesすべて`ok`。新export caseは4 download filenameとvisual/text view不変を7.7秒で確認。その後は既知process-exit hangだけで120秒timeout。全case `ok`後は指示どおり再実行していない。
- build: success（`225 modules transformed`）。既知のpdf.js direct `eval`と500kB超chunk warningのみ。
- `git diff --check`: success（legacy line-ending warningのみ）。
- legacy duplicate export definitions/listeners: なし。
- export on-screen work-area access/protected-state writes/cross-feature imports: なし。
- E2E `debug.log`: DNSHosts warning 4行を確認後、削除済み。

## Concerns

- Playwright runnerのprocess-exit hangとbuild warningはTask 13以前から継続している。

## Review fix round 1

### RED and root causes

レビュー指摘2件をexport/document integrationで再現し、focusedは `48 tests / 4 failed` だった。

1. export開始時の一時disabled状態をdocument controllerがready snapshotへ先に保存していた。accepted-load callbackでexportを破棄しても、invalid PDF failureがその一時状態を復元し、旧exportはdocument generation mismatchでcleanupを行わないため、busy classとdisabled buttonが残り得た。
2. `Object.freeze(new Map(...))`はMap objectへのproperty追加を防ぐだけで、`set/delete/clear`は実行できた。renderer callbackがexport snapshotを書き換えると後続ページ入力が変化し得た。

追加REDは、invalid load failure statusを旧export完了後も維持しながらbusy/buttonをpriorへ戻す経路、successful loadのdocument-owned disabled維持、overlap token、全snapshot Mapのmutator非公開・読取API・backing非漏洩を固定した。

### Minimal fixes

- export controllerへ`invalidateDocuments(documentGeneration)`を追加した。
- active visual/text sessionのcaptured generationが通知世代より古い場合だけ、そのsessionのUI leaseをabandonする。status文字列には触れず、exportが所有したbusy classとbutton disabledだけをpriorへ戻す。
- overlap時はactiveな最新sessionだけが最初のprior UI leaseを持つため、1回だけ復元する。旧async completionはactive token mismatchでUIを変更しない。
- document controllerの順序を、generation増分、accepted callback、ready snapshot capture、ready action closeへ変更した。callbackのfirst-await前契約とatomic batch semanticsは維持した。
- legacy accepted callbackからtext controllerとexport controllerの両方へ同じdocument generationを通知する。
- snapshot Mapは内部Mapをclosureに隠したfrozen read-only iterable facadeへ変更した。`size/get/has/entries/keys/values/forEach/Symbol.iterator`だけを公開し、`set/delete/clear`は存在しない。値は従来どおりdeep clone/freezeされ、`new Map(readonlyFacade)`との互換も維持した。

### Verification

- focused export + document + text: `3 files / 48 tests passed`
- full Vitest: `25 files / 168 tests passed`
- E2E: 9 casesすべて`ok`。新export caseを含めた後、既知process-exit hangだけで120秒timeout。全case `ok`後は再実行していない。
- E2E `debug.log`: DNSHosts warning 4行を確認後、削除済み。
