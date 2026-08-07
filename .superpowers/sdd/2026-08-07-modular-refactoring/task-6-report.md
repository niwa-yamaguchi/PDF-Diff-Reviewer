# Task 6: 凡例レイアウト抽出レポート

## TDD Evidence

1. `tests/unit/legend-layout.test.js` を先に追加した。
2. `npm.cmd run test -- tests/unit/legend-layout.test.js` は `Cannot find module '../../src/core/legend/layout.js'` で RED を確認した。
3. `src/core/legend/layout.js` に `legendLayout` と `LG_*` 定数を抽出後、同じ focused test が GREEN になった。
4. テストは注入測定器 `(label) => label.length * 10` を使い、`w: 64`、`h: 8`、各 swatch/text 座標を手計算のリテラルで検証する。

## 変更

- `src/core/legend/layout.js` を新設。DOM、Canvas context、state、pdf.js に依存しない純粋な幾何計算にした。
- `src/legacy-app.js` は `legendLayout` と描画時の `LG_BORDER_PT` を core から import する。
- `ctxMeasurer`、`measureLegend`、`drawLegend` は Canvas context を使うため legacy に残した。
- 数値、計算順、chrome の既定判定、戻り値の形状は既存実装と同一である。

## テスト

- focused Vitest: 1 file / 1 test passed
- full Vitest: 9 files / 20 tests passed
- E2E: 通常 sandbox 実行は CDN の pdf.js が読み込めず `pdfjsLib is not defined` で失敗。承認付き再実行では 2 / 2 passed。
- build: `npm.cmd run build` passed
- `git diff --check`: passed

## セルフレビュー

- core module の依存語を検索し、DOM、Canvas context、state、pdf.js 参照がないことを確認した。
- legacy 側の呼び出しシグネチャは維持され、PNG/PDF とテキスト表示の凡例描画経路はいずれも同じレイアウト値を利用する。

## 懸念

- なし。E2E の通常 sandbox 失敗は外部 CDN のネットワーク制限であり、承認付きブラウザ実行で回帰なしを確認済み。
