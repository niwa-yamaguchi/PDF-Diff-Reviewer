# Task 14 Composition root・最終回帰: 引き継ぎレポート

## Status

COMPLETE

Base: `6fac4b7`

Firefox headlessはこの実行環境のSWGL制約でblank pageも起動完了しなかったが、rootがheadful代替でblank smokeと全9 caseを完了した。root側の独立実サンプル受入も完了し、実装・受入条件をすべて満たした。

## TDD evidence

production変更前に次のREDを確認した。

- `tests/unit/dependency-boundaries.test.js`: 5件中4件FAIL。`legacy-app.js`存在、document featureからappへの逆依存、listener分散、main未移行をそれぞれ再現した。
- `tests/unit/dom-error-reporter.test.js`: `src/app/dom.js`未存在のimport failure。
- `tests/unit/bind-controls.test.js`: `src/app/bind-controls.js`未存在のimport failure。
- `tests/integration/create-app.test.js`: `src/app/create-app.js`未存在のimport failure。
- `tests/unit/documentation.test.js`: README、Playwright 3 project、index日付、package scriptsの4件すべてFAIL。

最小実装後のfocused GREENは次のとおり。

- DOM/error reporter: 3/3
- bindControls: 1/1
- composition smoke: 1/1
- dependency boundaries: 5/5
- documentation/config: 4/4
- viewer/text listener migration: 17/17

初回E2Eで全操作が起動前に止まった。Viteのbrowser stackから`bind-controls.js:44`を特定し、HTMLの実IDが`zoom1`/`textZoom1`なのにbinderとunit harnessが`zoomOne`/`textZoomOne`を使っていたことを根因と確認した。先にunit harnessを実DOM名へ変更してREDを再現し、binderを修正してGREENを確認した。

## Composition and dependency proof

- `src/main.js`は4 CSS import、`createApp` import、`createApp({ document, window })`の1回呼出だけ。
- `createApp`だけがstate、DOM、platform、renderer、全controller、error reporterを生成する。
- viewer→box view、box→visual、document→text/exportの循環callbackはlate-bound optional closureで解決する。composition smokeはfactory構築中にcallbackを同期実行してもundefined controllerへアクセスしないことを確認した。
- `createApp`はテスト/デバッグ用のfrozen public app objectを返す。
- `legacy-app.js`を削除した。
- document featureの`invalidateDocuments` app importをdependency injectionへ変更した。
- static boundary testはcoreのapp/features/platform/browser global依存なし、feature→appなし、別feature directoryへのimportなしを確認する。
- source grepは`window.pdfjsLib`、`window.jspdf`、global `diff_match_patch`が0件。
- feature内のglobal `console.log/error/warn/debug`も0件。既存XY-cut debug出力はinjected `window.console` callbackをcomposition rootから渡して維持した。

## Listener ownership map

全`addEventListener`は`src/app/bind-controls.js`の共通`listen()` 1箇所だけになった。

- visual canvas wheel/pointer/dblclick/resize/zoom → viewer controller public handlers
- box pointer/edit/delete/reset → box editor controller public handlers
- text canvas wheel/pointer/resize/zoom → text renderer public handlers
- text run/page/top-mode → text controller public handlers
- visual/text downloads → export controller public save methods
- file/drop、keyboard、comparison settings、alignment、visual mode/page → createApp内app coordinator public handlers

同一target/typeを重複登録しないこと、代表イベントがownerへ1回だけ委譲されることをunit testで確認した。

## DOM and error handling

- `collectDom(document)`は使用する全ID、visual/text wrap、nudge/quad/rotation/scale collectionを一度だけ収集し、objectとcollectionをfreezeする。必須collectionが空の場合も初期化時に拒否する。
- 必須要素欠落時は`Error("Missing required element: <id>")`を投げる。
- `createErrorReporter(dom, logger)`の`user`は画面だけを更新し、`report`は元errorを1回だけloggerへ渡して安全な日本語messageをvisualまたは明示されたtext statusへ表示する。
- 外部telemetry/network loggingは追加していない。

## Documentation and configuration

- READMEをVite/ES Modules/`dist/`運用へ更新し、`npm ci`、`npm run dev`、`npm run test`、`npm run test:e2e`、`npm run build`、`npm run preview`を記載した。
- Node.js 22.12以上の22系、ブラウザ内完結、外部送信なし、runtime CDN不要、source layout、Cloudflare Pagesのbuild command/output/production branchを記載した。
- `index.html`の旧1ファイルcommentを削除し、日付を`2026-08-09`へ更新した。
- Playwright projectをChromium/Firefox/WebKitへ拡張し、install helperも3 browserへ更新した。
- `npm run build`後に`tests/verify-dist.mjs`を自動実行する`postbuild`を追加した。
- main repoのignored正式仕様`local/図面差分ビューア_仕様書.md` §3/§9をVite source、`dist/` deployment、browser-only privacy、runtime CDN不要へ更新し、§7の旧CDN/CSP記述も同一オリジンWorkerへ整合させた。ignoredのままでありstage対象外。
- `AGENTS.md`は既存のlocal-agent-file ignore方針を優先するroot指示により作成・追跡していない。Task 14 briefのtracked追加要求は撤回された。

## Automated verification

Fresh final results before report:

- `npm.cmd run test`: 30 files / 183 tests passed。
- `npm.cmd run build`: 228 modules transformed、static copy 185 items、postbuild artifact validator passed。
- build既知warning: pdf.jsのdirect `eval`、500kB超chunkのみ。
- Chromium: 9/9 cases `ok`。その後の既知runner-exit hangだけで150秒timeout。
- WebKit: 9/9 cases `ok`（`--update-snapshots`）。その後の既知runner-exit hangだけで150秒timeout。
- WebKit empty-state baseline `empty-state-webkit-win32.png`を生成した。
- Firefox headless: app suite以前にblank `data:text/html,ok` launch smokeが30秒timeout。`RenderCompositorSWGL failed mapping default framebuffer`を再現した。
- Firefox headless切り分け: default、`MOZ_WEBRENDER=0`、webrender/software user prefs無効化、headless width/height明示のすべてで同じblank launch failure。アプリへ到達しない環境/browser launch問題と判定した。
- Firefox headful代替（root実施）: blank smoke成功、workers=1の全9 caseが9/9 `ok`、exit 0（24.9秒）。Firefox empty-state baseline `empty-state-firefox-win32.png`を生成した。

## Build artifact and static inspection

- `dist/` source maps: 0
- local pdf.js Worker: 1
- local CMap: 169 files
- local standard fonts: 16 files
- `cdnjs|jsdelivr` in index/src/dist: 0
- index script/style search: `/src/main.js` module script 1行だけ
- core boundary import matches: 0
- feature→app import matches: 0
- `addEventListener`はbinder内の共通登録行だけ
- package.json/package-lock rootは完全一致: pdfjs-dist 3.11.174、jsPDF 2.5.1、diff-match-patch 1.0.5、Vite 8.2.1、Vitest 4.1.10、Playwright 1.62.1、vite-plugin-static-copy 4.1.1

## Actual sample and privacy acceptance

Ignored `auto-alignment_sample_A.pdf` / `auto-alignment_sample_B.pdf`をChromiumのbounded Playwright acceptanceで確認した。実PDF読込、赤/青pixelを含む差分表示、新旧切替とNEW flip、自動位置合わせ、手動1px移動、0.1°回転、0.1%拡大、visual PNG downloadを確認し、外部requestは0件だった（1/1 passed、7.1秒）。検証用temporary specと`debug.log`は削除済み。

さらに実回路図`E-00697_計測基板_回路図.pdf` / `E-00697A_計測基板_回路図.pdf`で、ページ整列の空白挿入+Undo、manual box作成、しきい値変更の破棄確認cancel、text差分+zoom、4 downloadを確認した。PNGはsignature、PDFは`%PDF` headerとfilenameを実download streamから検査し、外部requestは0件だった（1/1 passed、9.6秒）。temporary specと`debug.log`は削除済み。

同じ実回路図でDPI 144、しきい値130、許容差1の再描画、90度回転+自動復帰、manual boxのcreate/move/resize/delete/Undoを追加確認した（1/1 passed、4.5秒）。初回のmove確認は全自動枠を含むoverlay外接矩形を指標にしたため変化を検出できなかったが、root cause確認後にoverlay pixel checksumへ検証指標を直し、同じ操作でpassした。production変更はない。temporary specと`debug.log`は削除済み。

rootの独立in-app Browser受入では、実サンプルA/BをUIから読み込み、差分Canvas `1241x1754`、削除79,132 pixel、追加74,649 pixel、変更box 3件をDOMとスクリーンショットで確認した。自動整列結果は向き0°、`θ +0.00°`、`×1.044`で、一致率は17%から58%へ改善した。テキスト比較では左右Canvasの削除・追加強調を目視確認した。画面console error/warnは0件、script/link資産は`127.0.0.1`上のVite、favicon、mainのみで外部runtime接続はなかった。受入用temporary PDFとdevelopment serverは確認後に削除・停止した。

固定fixtureのChromium/WebKit external-network-block testは、全外部requestをblockしてもPDF読込と差分表示が成功した。

## Known environment constraints

1. headless Firefox SWGL制約、headless Chromium/WebKit runner-exit hang、build warningはアプリのcase failureとは分離して記録する。
2. WebKit/Firefox baselineは意図したtracked test artifact。`test-results/`、`debug.log`、`dist/`、fixtures generated PDFsはcommit対象外。
