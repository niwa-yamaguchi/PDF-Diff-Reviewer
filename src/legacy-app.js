// PDF.js、CMap、標準フォントはローカルバンドルを使用する。
import { jsPDF } from "jspdf";
import { createCanvas, createWhiteCanvas } from "./platform/canvas.js";
import { downloadBlob } from "./platform/download.js";
import { pdfjsLib } from "./platform/pdfjs.js";
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
  effectiveQuadrant,
  renderDiffPage,
} from "./features/visual-diff/visual-renderer.js";
import { renderTogglePage } from "./features/visual-diff/toggle-renderer.js";
import { createBoxEditorController } from "./features/box-editor/box-editor-controller.js";
import { createBoxEditorView } from "./features/box-editor/box-editor-view.js";
import { createTextController, extractPageTokens } from "./features/text-review/text-controller.js";
import { createTextRenderer } from "./features/text-review/text-renderer.js";
import { createExportController } from "./features/export/export-controller.js";
import { createPdfExporter } from "./features/export/pdf-exporter.js";

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
  onLoadAccepted: ({ documentGeneration }) => {
    textController.invalidateDocuments(documentGeneration);
    exportController.invalidateDocuments(documentGeneration);
  },
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

// 出力処理は画面Canvasを作業領域にせず、開始時snapshotとoffscreen rendererだけを使う。
const exportController = createExportController({
  state,
  dom: {
    out,
    oldTextCanvas: $("oldTextCanvas"),
    newTextCanvas: $("newTextCanvas"),
    status: $("status"),
    textStatus: $("textStatus"),
    dlPng: $("dlPng"),
    dlPdf: $("dlPdf"),
    dlTextPng: $("dlTextPng"),
    dlTextPdf: $("dlTextPdf"),
  },
  renderVisualOffscreen: ({ renderSnapshot }) => (
    renderDiffPage(renderSnapshot, visualRenderDependencies)
  ),
  renderTextOffscreen: ({ side, pageIndex, snapshot }) => (
    textRenderer.renderOffscreen({ side, pageIndex, snapshot })
  ),
  pdfExporter: createPdfExporter({ jsPDF }),
  download: downloadBlob,
  textColors: TEXT_HI_COLORS,
  errorReporter: {
    report(error, message, target) {
      console.error(message, error);
      target.textContent = message;
    },
  },
});
