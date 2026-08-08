// PDF.js、CMap、標準フォントはローカルバンドルを使用する。
import { jsPDF } from "jspdf";
import { createCanvas, createWhiteCanvas } from "./platform/canvas.js";
import { downloadBlob } from "./platform/download.js";
import { pdfjsLib } from "./platform/pdfjs.js";
import {
  legendLayout,
  LG_BORDER_PT,
} from "./core/legend/layout.js";
import { createAppState } from "./app/state.js";
import {
  applyInvalidatingChange,
  invalidateDpi,
  invalidateManualAlignment,
  invalidatePageAlignment,
  invalidateThreshold,
  invalidateTolerance,
} from "./app/invalidation.js";
import { createDocumentController } from "./features/documents/document-controller.js";
import {
  framePlan,
  pageLabelText,
  sequenceIndex,
} from "./features/documents/page-layout.js";
import {
  canvasToGrayF,
  pageSizePt,
  renderPageCanvas,
  rotateCanvas90,
} from "./features/documents/page-renderer.js";
import { createViewerController } from "./features/viewer/viewer-controller.js";
import { createVisualController } from "./features/visual-diff/visual-controller.js";
import {
  DIFF_RGB,
  effectiveQuadrant,
  renderDiffPage,
} from "./features/visual-diff/visual-renderer.js";
import { renderTogglePage } from "./features/visual-diff/toggle-renderer.js";
import { createBoxEditorController } from "./features/box-editor/box-editor-controller.js";
import { createBoxEditorView } from "./features/box-editor/box-editor-view.js";
import { createTextController, extractPageTokens } from "./features/text-review/text-controller.js";
import { createTextRenderer } from "./features/text-review/text-renderer.js";

const state = createAppState();

const $ = id => document.getElementById(id);
const out = $("out"), octx = out.getContext("2d");
const boxLayer = $("boxLayer");
let boxEditorController;
let boxEditorView;
const TEXT_HI_COLORS = (() => {
  const styles = getComputedStyle(document.documentElement);
  return {
    removed: styles.getPropertyValue("--removed").trim(),
    added: styles.getPropertyValue("--added-text").trim(),
    changed: styles.getPropertyValue("--changed").trim(),
  };
})();
const textRenderer = createTextRenderer({
  state,
  dom: {
    oldTextCanvas: $("oldTextCanvas"),
    newTextCanvas: $("newTextCanvas"),
    oldWrap: document.querySelector(".text-pane.old .text-canvas-wrap"),
    newWrap: document.querySelector(".text-pane.new .text-canvas-wrap"),
    zoomIn: $("textZoomIn"),
    zoomOut: $("textZoomOut"),
    zoomFit: $("textZoomFit"),
    zoomOne: $("textZoom1"),
    window,
  },
  createCanvas,
  transform: pdfjsLib.Util.transform,
  colors: TEXT_HI_COLORS,
});
const textController = createTextController({
  state,
  dom: {
    textStatus: $("textStatus"),
    runText: $("runText"),
    dlTextPng: $("dlTextPng"),
    dlTextPdf: $("dlTextPdf"),
    textPageInd: $("textPageInd"),
    oldTextCanvas: $("oldTextCanvas"),
    newTextCanvas: $("newTextCanvas"),
    topVisual: $("topVisual"),
    topText: $("topText"),
    visualCtrl: $("visualCtrl"),
    textCtrl: $("textCtrl"),
    viewbar: $("viewbar"),
    canvasWrap: document.querySelector(".canvas-wrap"),
    textPanel: $("textPanel"),
    out,
    textPrev: $("textPrev"),
    textNext: $("textNext"),
    cancelBoxEdit: () => boxEditorController?.setEditMode(false),
    restoreVisual: () => {
      if (state.visual.rendered) out.style.display = "block";
      boxEditorView?.redraw();
    },
  },
  extractPageTokens,
  renderer: textRenderer,
  errorReporter: {
    report(error, message) {
      console.error(message, error);
      $("textStatus").textContent = message;
    },
  },
});
const documentController = createDocumentController({
  state,
  dom: {
    dropOld: $("dropOld"),
    dropNew: $("dropNew"),
    run: $("run"),
    runText: $("runText"),
    dlPng: $("dlPng"),
    dlPdf: $("dlPdf"),
    dlTextPng: $("dlTextPng"),
    dlTextPdf: $("dlTextPdf"),
    status: $("status"),
    textStatus: $("textStatus"),
  },
  pdf: pdfjsLib,
  errorReporter: {
    report(error, message) {
      console.error(message, error);
      $("status").textContent = message;
    },
  },
  onReady: () => boxEditorController.syncInvalidated(),
  confirmDiscard: () => boxEditorController.confirmDiscard(),
});
const visualRenderDependencies = Object.freeze({
  sequenceIndex,
  pageSizePt,
  framePlan,
  renderPageCanvas,
  rotateCanvas90,
  canvasToGrayF,
  createCanvas,
  createWhiteCanvas,
  pageLabelText,
});
const visualController = createVisualController({
  state,
  dom: {
    out,
    placeholder: $("ph"),
    status: $("status"),
    pageLabel: $("pageLabel"),
    statRm: $("statRm"),
    statAd: $("statAd"),
    statBox: $("statBox"),
    dlPng: $("dlPng"),
    dlPdf: $("dlPdf"),
    boxToggle: $("boxToggle"),
    sideOld: $("sideOld"),
    sideNew: $("sideNew"),
    cancelBoxDrag: () => boxEditorController.cancelDrag(),
    refreshBoxEditor: () => boxEditorView.refresh(),
    afterCommit() {
      updateAlignButtons();
      updateAlignReadout();
      updateManualAlignReadout();
      boxEditorView.updateControls();
    },
    reportError(error) {
      console.error("レンダリングに失敗しました", error);
      $("status").textContent = "レンダリングに失敗しました";
    },
  },
  renderDiffPage: snapshot => renderDiffPage(snapshot, visualRenderDependencies),
  renderTogglePage: snapshot => renderTogglePage(snapshot, visualRenderDependencies),
  drawBoxes: () => boxEditorView.redraw(),
});


// 変更箇所の囲み枠（色・サイズ）に関する定数とヘルパ
const BOX_COLOR = "#ff9500";
const BOX_FILL  = "rgba(255,149,0,0.18)";
const rgbCss = c => "rgb("+c[0]+","+c[1]+","+c[2]+")";
const BOX_BASE_DPI = 150;

// 枠をフレーム座標のまま ctx へ描く純粋な描画関数（書き出し用）。lw は線幅(px)。
function drawBoxesTo(ctx, boxes, lw){
  if(!boxes || !boxes.length) return;
  ctx.save();
  ctx.fillStyle = BOX_FILL;
  ctx.strokeStyle = BOX_COLOR;
  ctx.lineWidth = lw;
  for(const b of boxes){
    ctx.fillRect(b.x, b.y, b.w, b.h);
    // 枠線が範囲外に出ないよう半線幅内側に寄せる
    const h = lw/2;
    ctx.strokeRect(b.x+h, b.y+h, Math.max(0,b.w-lw), Math.max(0,b.h-lw));
  }
  ctx.restore();
}
// 書き出し用の線幅。現行 drawBoxes と同じ式（DPIに比例）。
const exportBoxLineWidth = () => Math.max(2, Math.round(3 * state.comparison.dpi / BOX_BASE_DPI));

function flipSide(){
  visualController.flipToggleSide();
}

function setModeUI(){
  $("modeDiff").classList.toggle("active", state.visual.mode==="diff");
  $("modeToggle").classList.toggle("active", state.visual.mode==="toggle");
  $("toggleInd").style.display = state.visual.mode==="toggle" ? "flex" : "none";
  $("th").disabled = state.visual.mode==="toggle";
  $("boxToggle").disabled = !state.visual.rendered;
  boxEditorView.updateControls();
}

function updateAlignButtons(){
  const on = !!(state.documents.oldDoc && state.documents.newDoc) && state.visual.rendered;
  $("alignAddNew").disabled = !on;
  $("alignDelOld").disabled = !on;
  $("alignUndo").disabled  = !on || state.documents.alignmentOps.length === 0;
}

// 用紙合わせ（自動・常時）と自動整列（トグル）の状態を、推定値ではなく実測値で表示する。
function updateAlignReadout(){
  const el = $("alignReadout");
  const lines = [];
  const p = state.visual.currentPlan;
  if(p && p.normalized){
    // refSide が "old" なら旧版が基準＝新版を拡大している
    const grown = p.refSide === "old" ? "新版" : "旧版";
    lines.push(`用紙合わせ: ${grown}を×${p.ratio.toFixed(3)}で描画（自動）`);
  } else if(p && p.aspectMismatch){
    lines.push("用紙合わせ: 用紙の縦横比が違うため未適用");
  }
  const qm = state.comparison.quadrantManual.get(state.documents.currentPage);
  if(qm != null){
    lines.push(`向き: 手動 ${qm*90}°`);
  } else if(state.comparison.autoAlign){
    const qc = state.visual.quadrantCache.get(state.documents.currentPage);
    // 未推定・片側空白のときは行を出さない（autoAlign OFF も同様。「自動整列: OFF」の行で足りる）
    if(qc && !qc.blank){
      const qpct = v => Math.round(v*100)+"%";
      if(qc.applied) lines.push(`向き: 自動 ${qc.k*90}°（一致率 ${qpct(qc.scores[0])} → ${qpct(qc.scores[qc.k])}）`);
      else lines.push("向き: 0°（回転なし）");
    }
  }
  if(!state.comparison.autoAlign){
    lines.push("自動整列: OFF");
  } else {
    const a = state.visual.alignmentCache.get(state.documents.currentPage);
    if(!a){
      lines.push("自動整列: 推定待ち");
    } else if(a.blank){
      lines.push("自動整列: 片側が空白のため対象外");
    } else {
      const pct = v => Math.round(v*100)+"%";
      const sc = `一致率 ${pct(a.scoreBase)} → ${pct(a.scoreBest)}`;
      if(!a.applied){
        lines.push(`自動整列: ${sc}（改善せず・恒等のまま）`);
      } else if(a.method === "translate"){
        const sgn = v => (v>=0?"+":"")+v;
        const dx = Math.round(a.txFrac*out.width), dy = Math.round(a.tyFrac*out.height);
        lines.push(`自動整列: 平行移動 ${sgn(dx)},${sgn(dy)}px / ${sc}`);
      } else {
        const deg = (a.angle*180/Math.PI).toFixed(2);
        lines.push(`自動整列: θ=${a.angle>=0?"+":""}${deg}° ×${a.scale.toFixed(3)} / ${sc}`);
      }
    }
  }
  el.textContent = lines.join(" ／ ");
}

function updateManualAlignReadout(){
  const deg = state.comparison.manualAngle*180/Math.PI;
  $("rotReset").textContent = (deg>=0?"+":"")+deg.toFixed(1)+"°";
  $("scaleReset").textContent = (state.comparison.manualScale*100).toFixed(1)+"%";
  const manual = state.comparison.quadrantManual.has(state.documents.currentPage);
  $("quadReset").textContent = (effectiveQuadrant({comparison:state.comparison,pageIndex:state.documents.currentPage}, state.visual.quadrantCache)*90)+"°" + (manual ? "（手動）" : "");
}

// ── ズーム & パン ──
const wrap = document.querySelector(".canvas-wrap");
const hasImage = () => out.style.display !== "none";
let spaceHeld = false; // 枠編集モード中に Space を押している間はパンへ回す
const viewerController = createViewerController({
  state,
  dom: {
    wrap,
    out,
    zoomLabel: $("zoomLabel"),
    zoomIn: $("zoomIn"),
    zoomOut: $("zoomOut"),
    zoomFit: $("zoomFit"),
    zoomOne: $("zoom1"),
    hasImage,
    isSpaceHeld: () => spaceHeld,
    onBoxPointerDown: event => boxEditorController.pointerDown(event),
  },
  window,
  onTransform: () => boxEditorView.redraw(),
});
boxEditorView = createBoxEditorView({
  state,
  dom: {
    canvas: boxLayer,
    out,
    wrap,
    statBox: $("statBox"),
    boxToggle: $("boxToggle"),
    boxEdit: $("boxEdit"),
    boxDelete: $("boxDel"),
    boxReset: $("boxReset"),
  },
  getView: () => viewerController.getView(),
});
boxEditorController = createBoxEditorController({
  state,
  dom: {
    onBoxesShown() {
      const page = state.documents.currentPage;
      if (!state.boxEditor.editsByPage.has(page) && !state.boxEditor.autoByPage.has(page)) {
        visualController.showPage(page);
      }
    },
    onAutoMissing() {
      visualController.showPage(state.documents.currentPage);
    },
  },
  view: boxEditorView,
  confirmDiscard: () => confirm("手編集した変更枠があります。この操作で破棄されます。よろしいですか？"),
});

const confirmDiscardBoxEdits = () => boxEditorController.confirmDiscard();
const syncInvalidatedBoxEditor = () => boxEditorController.syncInvalidated();
function applyComparisonSettingChange(update, invalidate){
  const applied = applyInvalidatingChange(state, {
    confirmDiscard: confirmDiscardBoxEdits,
    update,
    invalidate,
  });
  if(applied) syncInvalidatedBoxEditor();
  return applied;
}

// 枠編集モードのドラッグは controller の pointerId/page gate を通す。
wrap.addEventListener("pointermove", event => boxEditorController.pointerMove(event));
wrap.addEventListener("pointermove", event => boxEditorController.updateCursor(event));
wrap.addEventListener("pointerup", event => boxEditorController.pointerUp(event));
wrap.addEventListener("pointercancel", event => boxEditorController.pointerCancel(event));

// ── モード切替（差分 / 新旧切替） ──
$("modeDiff").addEventListener("click", async ()=>{
  if(state.visual.mode==="diff" || !hasImage()) return;
  state.visual.mode="diff"; setModeUI();
  $("status").innerHTML='<span class="busy">差分を再計算中…</span>';
  if(state.documents.pages) await visualController.showPage(state.documents.currentPage);
});
$("modeToggle").addEventListener("click", async ()=>{
  if(state.visual.mode==="toggle" || !hasImage()) return;
  state.visual.mode="toggle"; setModeUI();
  if(state.documents.pages) await visualController.showPage(state.documents.currentPage);
});
$("toggleFlip").addEventListener("click", flipSide);
$("boxToggle").addEventListener("click", () => boxEditorController.toggleBoxes());
$("boxEdit").addEventListener("click", () => boxEditorController.setEditMode(!state.boxEditor.editMode));
$("boxDel").addEventListener("click", () => boxEditorController.deleteSelected());
// このページの手編集を破棄して自動算出の原本へ戻す。原本があるため差分の再計算は要らない。
$("boxReset").addEventListener("click", ()=>{
  boxEditorController.resetToAuto();
});

// 文字入力中の要素にフォーカスがある間はショートカットキーを奪わないためのガード。複数のkeydownリスナーで共用する。
// BUTTONは対象外（ボタンにフォーカスが残っていてもE/Esc/Delete等は効かせたい）。
// ボタンの誤発火（Spaceキーでのクリック相当発火）はSpaceハンドラ側で個別にガードする。
function isTypingTarget(e){
  const tag = (e.target && e.target.tagName) || "";
  if(["INPUT","TEXTAREA","SELECT"].includes(tag)) return true;
  return !!(e.target && e.target.isContentEditable);
}

// Space キーで新旧切替（トグルモード時のみ）。枠編集モード中はパンの修飾キーとして使う。
// ボタンにフォーカスがある状態でSpaceを押すとボタンがクリック相当で発火してしまうため、ここだけ個別にBUTTONを除外する。
document.addEventListener("keydown", e=>{
  if(state.ui.topMode!=="visual") return;
  if(e.code!=="Space" || e.repeat) return;
  if(isTypingTarget(e)) return;
  if(e.target && e.target.tagName==="BUTTON") return;
  if(state.boxEditor.editMode){ spaceHeld = true; e.preventDefault(); return; }
  if(state.visual.mode==="toggle" && hasImage()){
    e.preventDefault();
    flipSide();
  }
});
document.addEventListener("keyup", e=>{ if(e.code==="Space") spaceHeld = false; });
window.addEventListener("blur", ()=>{ spaceHeld = false; }); // 押しっぱなし状態の取り残しを防ぐ

// 枠編集モードのキー操作。E=モード切替、Esc=選択解除→モード終了。
document.addEventListener("keydown", e=>{
  if(state.ui.topMode!=="visual") return;
  if(isTypingTarget(e)) return;
  if(e.key==="e" || e.key==="E"){
    // Ctrl+E・Alt+E等は別コマンド扱いにするため素通しする（Eは修飾キー無しの単独キー）。
    if(e.ctrlKey||e.metaKey||e.altKey) return;
    if(!state.visual.rendered) return;
    e.preventDefault();
    boxEditorController.setEditMode(!state.boxEditor.editMode);
    return;
  }
  if(!state.boxEditor.editMode) return;
  if(e.key==="Escape"){
    e.preventDefault();
    if(state.boxEditor.selectedIndex>=0) boxEditorController.clearSelection();
    else boxEditorController.setEditMode(false);
    return;
  }
  if(e.key==="Delete" || e.key==="Backspace"){
    e.preventDefault();
    boxEditorController.deleteSelected();
    return;
  }
  if((e.ctrlKey||e.metaKey) && (e.key==="z"||e.key==="Z")){
    e.preventDefault();
    boxEditorController.undo();
  }
});

// ── イベント ──
$("fileOld").addEventListener("change",async e=>{
  const file=e.target.files[0];
  if(!file) return;
  try { await documentController.load("old", file); }
  finally { e.target.value=""; }
});
$("fileNew").addEventListener("change",async e=>{
  const file=e.target.files[0];
  if(!file) return;
  try { await documentController.load("new", file); }
  finally { e.target.value=""; }
});
["dropOld","dropNew"].forEach(id=>{
  const el=$(id), which=id==="dropOld"?"old":"new";
  el.addEventListener("dragover",e=>{e.preventDefault();el.style.borderColor="var(--signal)";});
  el.addEventListener("dragleave",()=>el.style.borderColor="");
  el.addEventListener("drop",e=>{e.preventDefault();el.style.borderColor="";
    const f=e.dataTransfer.files[0]; if(f&&f.type==="application/pdf") documentController.load(which,f);});
});

// レンジ入力はラベルだけを先行更新し、state は change 時の破棄確認後に確定する。
// 破棄を拒否したときは確定済みの値から value / ラベルだけを戻す。
["dpi","th","tolerance"].forEach(id=>{ $(id).dataset.committed = $(id).value; });
function restoreCommittedRange(el, labelId){
  el.value = el.dataset.committed;
  $(labelId).textContent = el.value;
}

$("dpi").addEventListener("input",e=>{$("dpiVal").textContent=e.target.value;});
$("dpi").addEventListener("change",async()=>{
  const el = $("dpi");
  const next = +el.value;
  if(!applyComparisonSettingChange(
    ()=>{ state.comparison.dpi = next; },
    invalidateDpi,
  )){
    restoreCommittedRange(el, "dpiVal");
    return;
  }
  el.dataset.committed = el.value;
  if(state.visual.rendered){await visualController.showPage(state.documents.currentPage); viewerController.fit();}
});
$("th").addEventListener("input",e=>{$("thVal").textContent=e.target.value;});
$("th").addEventListener("change",()=>{
  const el = $("th");
  const next = +el.value;
  if(!applyComparisonSettingChange(
    ()=>{ state.comparison.threshold = next; },
    invalidateThreshold,
  )){
    restoreCommittedRange(el, "thVal");
    return;
  }
  el.dataset.committed = el.value;
  if(state.visual.mode==="diff" && state.visual.rendered)visualController.showPage(state.documents.currentPage);
});
$("tolerance").addEventListener("input",e=>{$("toleranceVal").textContent=e.target.value;});
$("tolerance").addEventListener("change",()=>{
  const el = $("tolerance");
  const next = +el.value;
  if(!applyComparisonSettingChange(
    ()=>{ state.comparison.tolerancePx = next; },
    invalidateTolerance,
  )){
    restoreCommittedRange(el, "toleranceVal");
    return;
  }
  el.dataset.committed = el.value;
  if(!state.visual.rendered) return;
  visualController.showPage(state.documents.currentPage);
});

document.querySelectorAll(".nudge button[data-dx]").forEach(b=>{
  b.addEventListener("click",()=>{
    if(!applyComparisonSettingChange(()=>{
      state.comparison.dx+=(+b.dataset.dx); state.comparison.dy+=(+b.dataset.dy);
    }, invalidateManualAlignment)) return;
    $("nudgeReset").textContent=state.comparison.dx+","+state.comparison.dy;
    if(!state.visual.rendered) return;
    visualController.showPage(state.documents.currentPage);
  });
});
$("nudgeReset").addEventListener("click",()=>{
  if(!applyComparisonSettingChange(()=>{
    state.comparison.dx=0;state.comparison.dy=0;
  }, invalidateManualAlignment)) return;
  $("nudgeReset").textContent="0,0";
  if(!state.visual.rendered) return;
  visualController.showPage(state.documents.currentPage);
});
// 向き（直角回転）。押した時点で手動上書きが確定し、当ページの自動推定より優先される。
// k が変わるとページ描画・位置合わせ・差分・枠が変わるため、DPI変更と同じ範囲を無効化する。
document.querySelectorAll("button[data-quad]").forEach(b=>{
  b.addEventListener("click", async ()=>{
    if(!applyComparisonSettingChange(()=>{
      const cur = effectiveQuadrant({comparison:state.comparison,pageIndex:state.documents.currentPage}, state.visual.quadrantCache);
      state.comparison.quadrantManual.set(state.documents.currentPage, ((cur + (+b.dataset.quad)) % 4 + 4) % 4);
    }, invalidateDpi)) return;
    updateManualAlignReadout();
    if(!state.visual.rendered) return;
    // コントローラーの commit 後に読み出しも同期されるため、ここでは描画完了を待つ。
    await visualController.showPage(state.documents.currentPage);
  });
});
$("quadReset").addEventListener("click", async ()=>{
  if(!state.comparison.quadrantManual.has(state.documents.currentPage)) return; // 既に自動
  if(!applyComparisonSettingChange(()=>{
    state.comparison.quadrantManual.delete(state.documents.currentPage);        // 自動判定へ戻す
  }, invalidateDpi)) return;
  updateManualAlignReadout();
  if(!state.visual.rendered) return;
  // 同上（data-quad ハンドラと同じ理由でトグルモードのみ明示的に読み出しを更新する）。
  await visualController.showPage(state.documents.currentPage);
});
document.querySelectorAll("button[data-rot]").forEach(b=>{
  b.addEventListener("click",()=>{
    if(!applyComparisonSettingChange(()=>{
      state.comparison.manualAngle += (+b.dataset.rot) * 0.1 * Math.PI/180;
    }, invalidateDpi)) return;
    updateManualAlignReadout();
    if(!state.visual.rendered) return;
    visualController.showPage(state.documents.currentPage);
  });
});
$("rotReset").addEventListener("click",()=>{
  if(!applyComparisonSettingChange(()=>{
    state.comparison.manualAngle = 0;
  }, invalidateDpi)) return;
  updateManualAlignReadout();
  if(!state.visual.rendered) return;
  visualController.showPage(state.documents.currentPage);
});
document.querySelectorAll("button[data-scale]").forEach(b=>{
  b.addEventListener("click",()=>{
    if(!applyComparisonSettingChange(()=>{
      state.comparison.manualScale = Math.max(0.1, state.comparison.manualScale + (+b.dataset.scale) * 0.001);
    }, invalidateDpi)) return;
    updateManualAlignReadout();
    if(!state.visual.rendered) return;
    visualController.showPage(state.documents.currentPage);
  });
});
$("scaleReset").addEventListener("click",()=>{
  if(!applyComparisonSettingChange(()=>{
    state.comparison.manualScale = 1;
  }, invalidateDpi)) return;
  updateManualAlignReadout();
  if(!state.visual.rendered) return;
  visualController.showPage(state.documents.currentPage);
});
$("autoAlign").addEventListener("change", async e=>{
  const next = e.target.checked;
  if(!applyComparisonSettingChange(()=>{
    state.comparison.autoAlign = next;
  }, invalidateThreshold)){ e.target.checked = !next; return; }
  if(!state.visual.rendered){ updateAlignReadout(); return; }
  // コントローラーの commit 後に読み出しも同期されるため、推定完了を待つ。
  await visualController.showPage(state.documents.currentPage);
});

$("run").addEventListener("click",async()=>{
  $("modeDiff").disabled=false; $("modeToggle").disabled=false;
  await visualController.showPage(0); viewerController.fit();
});
$("alignAddNew").addEventListener("click", async ()=>{
  if(!state.visual.rendered) return;
  if(!confirmDiscardBoxEdits()) return;
  state.documents.oldSequence.splice(state.documents.currentPage, 0, null); // 旧側に空白 → 新ページが全面追加(青)に
  state.documents.alignmentOps.push({side:"old", slot:state.documents.currentPage});
  await visualController.refreshAfterAlign({invalidatePageAlignment, syncInvalidatedBoxEditor});
});
$("alignDelOld").addEventListener("click", async ()=>{
  if(!state.visual.rendered) return;
  if(!confirmDiscardBoxEdits()) return;
  state.documents.newSequence.splice(state.documents.currentPage, 0, null); // 新側に空白 → 旧ページが全面削除(赤)に
  state.documents.alignmentOps.push({side:"new", slot:state.documents.currentPage});
  await visualController.refreshAfterAlign({invalidatePageAlignment, syncInvalidatedBoxEditor});
});
$("alignUndo").addEventListener("click", async ()=>{
  const op = state.documents.alignmentOps[state.documents.alignmentOps.length-1]; // pop ではなく覗き見。ゲート拒否時に何も書き換えないため
  if(!op) return;
  if(!confirmDiscardBoxEdits()) return;
  state.documents.alignmentOps.pop();
  const seq = op.side === "old" ? state.documents.oldSequence : state.documents.newSequence;
  if(seq[op.slot] === null) seq.splice(op.slot, 1); // 念のため null を確認して除去
  await visualController.refreshAfterAlign({invalidatePageAlignment, syncInvalidatedBoxEditor});
});
$("prev").addEventListener("click",()=>visualController.showPage(state.documents.currentPage-1));
$("next").addEventListener("click",()=>visualController.showPage(state.documents.currentPage+1));

// ── 書き出し用の凡例 ──
// 画面表示のCanvas(out)には描かない（画面はヘッダーのHTML凡例が担う）。書き出し時に
// 複製したCanvasへだけ重ねるため、パン/ズームやPDFの用紙寸法には影響しない。
// レイアウト定数は全てpt。unit(=1ptあたりのpx数)を掛けてpxへ変換するので、DPIを
// 上げても紙面上の凡例の大きさは変わらない。
// 実測用: 呼び出し側のctx状態を壊さないようsave/restoreで包む
const ctxMeasurer = ctx => (label, fontPx) => {
  ctx.save();
  ctx.font = "bold " + fontPx + "px sans-serif";
  const w = ctx.measureText(label).width;
  ctx.restore();
  return w;
};

// 描画せずレイアウト一式を返す（配置の衝突判定用）。返り値はそのまま drawLegend の
// pre 引数へ渡せる。こうしないと「幅ガードで測った寸法」と「実際に描く寸法」が
// 別計算になり、将来 legendLayout に状態依存が入ったとき両者がズレる。
function measureLegend(ctx, items, unit, opts){
  return legendLayout(items, unit, opts, ctxMeasurer(ctx));
}

// (x,y)を凡例ボックスの左上として描画する。
// pre に measureLegend の返り値を渡すとレイアウト計算と文字幅実測を再利用する。
function drawLegend(ctx, items, x, y, unit, opts, pre){
  const L = pre || legendLayout(items, unit, opts, ctxMeasurer(ctx));
  // DPI下限72(=unit 1.0)では常に1px以上になるため現状は発火しないが、
  // 将来DPI下限を下げたときに枠線が消えるのを防ぐ保険
  const bw = Math.max(1, LG_BORDER_PT * unit);
  ctx.save();
  if(L.chrome){
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillRect(x, y, L.w, L.h);
    ctx.strokeStyle = "#999";
    ctx.lineWidth = bw;
    ctx.strokeRect(x + bw/2, y + bw/2, L.w - bw, L.h - bw); // 枠線を内側へ寄せる
  }
  ctx.font = "bold " + L.fontPx + "px sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const top = y + L.pad;
  L.parts.forEach((p, i) => {
    const it = items[i];
    if(it.color){
      ctx.fillStyle = it.color;
      ctx.fillRect(x + p.swX, top, L.swPx, L.swPx);
    } else {
      ctx.fillStyle = it.fill;
      ctx.fillRect(x + p.swX, top, L.swPx, L.swPx);
      ctx.strokeStyle = it.stroke;
      ctx.lineWidth = bw;
      ctx.strokeRect(x + p.swX + bw/2, top + bw/2, L.swPx - bw, L.swPx - bw);
    }
    ctx.fillStyle = "#222";
    ctx.fillText(it.label, x + p.textX, top + L.swPx/2);
  });
  ctx.restore();
  return L;
}

const LG_MARGIN_PT = 10; // 凡例ボックスの左上マージン

// 図面比較の凡例項目。色は buildDiff が実際に塗る DIFF_RGB と同じ定義から作る。
// 引数 kind は「書き出す画像の中身」であって state.visual.mode ではない。dlPdf は切替モード中に
// 押されてもループ内で buildDiff を呼ぶため中身は差分画像であり "diff" を渡す。
// state.visual.mode を関数内で直接読むと、この経路で凡例が「変更枠」だけになり誤りになる。
function diffLegendItems(kind){
  const items = [];
  // 切替モードの画像は旧版/新版そのもの。共通/削除/追加の3色は実在しないので出さない。
  if(kind !== "toggle") items.push(
    {color: rgbCss(DIFF_RGB.common),  label: "共通"},
    {color: rgbCss(DIFF_RGB.removed), label: "削除（旧版のみ）"},
    {color: rgbCss(DIFF_RGB.added),   label: "追加（新版のみ）"},
  );
  // 枠を出していないときに「変更枠」だけ凡例に残ると誤解を招くので連動させる
  if(state.boxEditor.showBoxes) items.push({stroke: BOX_COLOR, fill: BOX_FILL, label: "変更枠"});
  return items;
}

// src と同寸のCanvasへ複製し、複製側にだけ凡例を重ねて返す。src は変更しない。
// 寸法を変えないので、PDFの用紙寸法(wPt/hPt)は従来と一致する。
// dest を渡すとそのCanvasを使い回す（全ページPDFで巨大なバッキングストアを毎ページ
// 確保しないため）。width/height の再代入でCanvasは自動クリアされる。
function exportCanvasWithLegend(src, kind, dest){
  const c = dest || createCanvas(0, 0);
  c.width = src.width; c.height = src.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(src, 0, 0);
  if(state.boxEditor.showBoxes) drawBoxesTo(ctx, state.boxEditor.currentBoxes, exportBoxLineWidth());
  const unit = state.comparison.dpi / 72;
  const m = LG_MARGIN_PT * unit;
  drawLegend(ctx, diffLegendItems(kind), m, m, unit);
  return c;
}

$("dlPng").addEventListener("click",()=>{
  // 切替モードの画像で説明を要する色はオレンジの変更枠だけ。枠OFFなら凡例は不要なので
  // out をそのまま出す。それ以外（差分モード全般／切替モードで枠ON）は凡例を重ねる。
  const bare = state.visual.mode==="toggle" && !state.boxEditor.showBoxes;
  const shot = bare ? out : exportCanvasWithLegend(out, state.visual.mode);
  shot.toBlob(b=>{
    const name = state.visual.mode==="toggle"
      ? (state.visual.toggleSide==="new" ? "new_p"+(state.documents.currentPage+1)+".png" : "old_p"+(state.documents.currentPage+1)+".png")
      : "diff_p"+(state.documents.currentPage+1)+".png";
    downloadBlob(b, name);
  });
});

$("dlPdf").addEventListener("click",async()=>{
  $("status").innerHTML='<span class="busy">PDF生成中…</span>';
  let pdf=null;
  const scratch=createCanvas(0, 0); // 全ページで使い回す複製先（毎ページ確保するとピークメモリが倍になる）
  // dlPdf は state.visual.mode に関わらず全ページを buildDiff で描くため、ループ内で書き込まれる
  // state.boxEditor.autoByPage は差分アルゴリズム由来の値になる。これは書き出し専用の一時的な結果であり
  // 画面表示（新旧切替モード等）の自動枠を汚してはいけないため、ループの前にMap内容を
  // 退避して空にし、終了後に同じMapへ戻す。
  const savedBoxAuto = new Map(state.boxEditor.autoByPage);
  state.boxEditor.autoByPage.clear();
  for(let i=0;i<state.documents.pages;i++){
    const rendered = await visualController.showPage(i, {mode:"diff", updateCurrentPage:false});
    if(!rendered.committed) throw rendered.error || new Error("差分ページを描画できませんでした");
    // dlPdf は state.visual.mode に関わらず差分レンダラーを使うため、常に差分用の凡例を付ける
    const shot=exportCanvasWithLegend(out, "diff", scratch);
    const img=shot.toDataURL("image/png");
    const w=shot.width, h=shot.height;
    // Canvasはdpi/72倍のpx。ページ実寸(pt)に戻して渡す。
    // 用紙サイズ正規化時も「基準ページ(大きい用紙)は必ず dpi/72 で描画する」(framePlan の
    // frameScale)ため、フレーム寸法を dpi/72 で割ると基準ページのpt実寸が得られる。式は不変。
    const scale=state.comparison.dpi/72, wPt=w/scale, hPt=h/scale;
    const orient = w>h ? "l":"p";
    if(i===0){ pdf=new jsPDF({orientation:orient,unit:"pt",format:[wPt,hPt],compress:true}); }
    else { pdf.addPage([wPt,hPt],orient); }
    pdf.addImage(img,"PNG",0,0,wPt,hPt);
  }
  state.boxEditor.autoByPage.clear();
  for(const [pageIndex, boxes] of savedBoxAuto) state.boxEditor.autoByPage.set(pageIndex, boxes);
  pdf.save("diff.pdf");
  await visualController.showPage(state.documents.currentPage);
  $("status").textContent="PDFを保存しました";
});

// テキスト比較のラベル帯(高さ28px・フォント16px固定)に収まる凡例のスケール。
// 図面側の state.comparison.dpi/72 とは別系統の固定値（帯もフォントもDPIに依存しないため）。
const TEXT_LG_UNIT = 1.6;

// 旧(上)・新(下)を各ラベル帯付きで縦積み合成（等倍・非伸縮、横中央寄せ）（ページ無し側は白Canvasで代替）
function composeTextExport(oldC, newC, pageIndex, total){
  const fallback = (w,h) => createWhiteCanvas(w, h);
  if(!oldC) oldC = fallback(newC.width, newC.height);
  if(!newC) newC = fallback(oldC.width, oldC.height);

  const labelH = 28, gap = 24;
  const W = Math.max(oldC.width, newC.width);
  const H = labelH + oldC.height + gap + labelH + newC.height;
  const canvas = createWhiteCanvas(W, H);
  const ctx = canvas.getContext("2d");

  ctx.font = "bold 16px sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillStyle = TEXT_HI_COLORS.removed;
  ctx.textAlign = "left";
  ctx.fillText("OLD", 4, labelH/2);
  ctx.fillStyle = "#333";
  ctx.textAlign = "right";
  const pageText = "p "+(pageIndex+1)+" / "+total;
  ctx.fillText(pageText, W-4, labelH/2);

  // 凡例は最上部の帯にのみ。帯は既に白地なので下地・枠(chrome)は描かない。
  // OLDラベルの右に置き、ページ番号と重なるほど幅が無ければ描画を諦める。
  const lgItems = [
    {color: TEXT_HI_COLORS.removed, label: "削除"},
    {color: TEXT_HI_COLORS.added,   label: "追加"},
    {color: TEXT_HI_COLORS.changed, label: "変更"},
  ];
  const lgOpts = {chrome: false};
  const lg = measureLegend(ctx, lgItems, TEXT_LG_UNIT, lgOpts);
  const lgX = 4 + ctx.measureText("OLD").width + 16;
  const lgLimit = W - 4 - ctx.measureText(pageText).width - 16;
  if(lgX + lg.w <= lgLimit){
    // 幅ガードで使った lg をそのまま渡し、描画側で同じレイアウトを再計算させない
    drawLegend(ctx, lgItems, lgX, labelH/2 - lg.h/2, TEXT_LG_UNIT, lgOpts, lg);
  }

  ctx.drawImage(oldC, (W-oldC.width)/2, labelH);

  const newLabelY = labelH + oldC.height + gap;
  ctx.fillStyle = TEXT_HI_COLORS.added;
  ctx.textAlign = "left";
  ctx.fillText("NEW", 4, newLabelY + labelH/2);
  ctx.drawImage(newC, (W-newC.width)/2, newLabelY + labelH);
  return canvas;
}

$("dlTextPng").addEventListener("click", async()=>{
  if(state.ui.topMode!=="text" || !state.textReview.highlights) return;
  $("textStatus").textContent = "PNG生成中…";
  const idx = state.textReview.page, total = textController.totalPages();
  const [oldC, newC] = await Promise.all([
    textController.renderOffscreen("old", idx),
    textController.renderOffscreen("new", idx),
  ]);
  const canvas = composeTextExport(oldC, newC, idx, total);
  canvas.toBlob(b=>{
    downloadBlob(b, "textdiff_p"+(idx+1)+".png");
    $("textStatus").textContent = "テキスト差分を表示中";
  });
});

$("dlTextPdf").addEventListener("click", async()=>{
  if(state.ui.topMode!=="text" || !state.textReview.highlights) return;
  const total = textController.totalPages();
  let pdf=null;
  for(let i=0;i<total;i++){
    $("textStatus").innerHTML = '<span class="busy">PDF生成中…（'+(i+1)+"/"+total+"）</span>";
    const [oldC, newC] = await Promise.all([
      textController.renderOffscreen("old", i),
      textController.renderOffscreen("new", i),
    ]);
    const canvas = composeTextExport(oldC, newC, i, total);
    const img = canvas.toDataURL("image/png");
    const w = canvas.width, h = canvas.height;
    const scale=state.comparison.dpi/72, wPt=w/scale, hPt=h/scale; // Canvasはdpi/72倍のpx。ページ実寸(pt)に戻して渡す
    const orient = w>h ? "l":"p";
    if(i===0){ pdf=new jsPDF({orientation:orient,unit:"pt",format:[wPt,hPt],compress:true}); }
    else { pdf.addPage([wPt,hPt],orient); }
    pdf.addImage(img,"PNG",0,0,wPt,hPt);
  }
  pdf.save("textdiff.pdf");
  $("textStatus").textContent = "PDFを保存しました";
});
