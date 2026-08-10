import { jsPDF } from "jspdf";
import { collectDom } from "./dom.js";
import { createErrorReporter } from "./error-reporter.js";
import { bindControls } from "./bind-controls.js";
import { createAppState } from "./state.js";
import {
  applyInvalidatingChange,
  invalidateDocuments,
  invalidateDpi,
  invalidateManualAlignment,
  invalidatePageAlignment,
  invalidateThreshold,
  invalidateTolerance,
} from "./invalidation.js";
import { createCanvas, createWhiteCanvas } from "../platform/canvas.js";
import { downloadBlob } from "../platform/download.js";
import { pdfjsLib } from "../platform/pdfjs.js";
import { createDocumentController } from "../features/documents/document-controller.js";
import { framePlan, pageLabelText, sequenceIndex } from "../features/documents/page-layout.js";
import {
  alignProbeScale,
  canvasToRgba,
  downscaleCanvas,
  pageSizePt,
  renderPageCanvas,
  rotateCanvas90,
} from "../features/documents/page-renderer.js";
import { createDiffWorker } from "../platform/diff-worker.js";
import { createWorkerLane } from "../features/visual-diff/worker-lane.js";
import { createViewerController } from "../features/viewer/viewer-controller.js";
import { createVisualController } from "../features/visual-diff/visual-controller.js";
import { effectiveQuadrant, renderDiffPage } from "../features/visual-diff/visual-renderer.js";
import { renderTogglePage } from "../features/visual-diff/toggle-renderer.js";
import { createBoxEditorController } from "../features/box-editor/box-editor-controller.js";
import { createBoxEditorView } from "../features/box-editor/box-editor-view.js";
import { createTextController, extractPageTokens } from "../features/text-review/text-controller.js";
import { createTextRenderer } from "../features/text-review/text-renderer.js";
import { createExportController } from "../features/export/export-controller.js";
import { createPdfExporter } from "../features/export/pdf-exporter.js";

const DEFAULT_DEPENDENCIES = Object.freeze({
  bindControls,
  createAppState,
  createErrorReporter,
  createCanvas,
  createWhiteCanvas,
  downloadBlob,
  pdfjsLib,
  jsPDF,
  createDocumentController,
  framePlan,
  pageLabelText,
  sequenceIndex,
  alignProbeScale,
  canvasToRgba,
  createDiffWorker,
  createWorkerLane,
  downscaleCanvas,
  pageSizePt,
  renderPageCanvas,
  rotateCanvas90,
  createViewerController,
  createVisualController,
  effectiveQuadrant,
  renderDiffPage,
  renderTogglePage,
  createBoxEditorController,
  createBoxEditorView,
  createTextController,
  extractPageTokens,
  createTextRenderer,
  createExportController,
  createPdfExporter,
  applyInvalidatingChange,
  invalidateDocuments,
  invalidateDpi,
  invalidateManualAlignment,
  invalidatePageAlignment,
  invalidateThreshold,
  invalidateTolerance,
});

export function createApp({ document, window, dependencies = {} }) {
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  const dom = collectDom(document);
  const state = deps.createAppState();
  const errorReporter = deps.createErrorReporter(dom, window.console);
  const textErrorReporter = Object.freeze({
    user: message => errorReporter.user(message, dom.textStatus),
    report: (error, message) => errorReporter.report(error, message, dom.textStatus),
  });
  const out = dom.out;
  let boxEditorController;
  let boxEditorView;
  let visualController;
  let textController;
  let exportController;
  let documentController;
  let spaceHeld = false;

  const textColors = (() => {
    const styles = window.getComputedStyle(document.documentElement);
    return Object.freeze({
      removed: styles.getPropertyValue("--removed").trim(),
      added: styles.getPropertyValue("--added-text").trim(),
      changed: styles.getPropertyValue("--changed").trim(),
    });
  })();

  const textRenderer = deps.createTextRenderer({
    state,
    dom: {
      oldTextCanvas: dom.oldTextCanvas,
      newTextCanvas: dom.newTextCanvas,
      oldWrap: dom.oldTextWrap,
      newWrap: dom.newTextWrap,
    },
    createCanvas: deps.createCanvas,
    transform: deps.pdfjsLib.Util.transform,
    colors: textColors,
  });

  const hasImage = () => out.style.display !== "none";
  const viewerController = deps.createViewerController({
    state,
    dom: {
      wrap: dom.canvasWrap,
      out,
      zoomLabel: dom.zoomLabel,
      hasImage,
      isSpaceHeld: () => spaceHeld,
      onBoxPointerDown: event => boxEditorController?.pointerDown?.(event),
    },
    window,
    onTransform: () => boxEditorView?.redraw?.(),
  });

  boxEditorView = deps.createBoxEditorView({
    state,
    dom: {
      canvas: dom.boxLayer,
      out,
      wrap: dom.canvasWrap,
      statBox: dom.statBox,
      boxToggle: dom.boxToggle,
      boxEdit: dom.boxEdit,
      boxDelete: dom.boxDel,
      boxReset: dom.boxReset,
    },
    getView: () => viewerController.getView(),
  });

  boxEditorController = deps.createBoxEditorController({
    state,
    dom: {
      onBoxesShown() {
        const page = state.documents.currentPage;
        if (!state.boxEditor.editsByPage.has(page) && !state.boxEditor.autoByPage.has(page)) {
          visualController?.showPage?.(page);
        }
      },
      onAutoMissing() {
        visualController?.showPage?.(state.documents.currentPage);
      },
    },
    view: boxEditorView,
    confirmDiscard: () => window.confirm(
      "手編集した変更枠があります。この操作で破棄されます。よろしいですか？",
    ),
  });

  function updateAlignButtons() {
    const on = Boolean(state.documents.oldDoc && state.documents.newDoc) && state.visual.rendered;
    dom.alignAddNew.disabled = !on;
    dom.alignDelOld.disabled = !on;
    dom.alignUndo.disabled = !on || state.documents.alignmentOps.length === 0;
  }

  function updateAlignReadout() {
    const lines = [];
    const plan = state.visual.currentPlan;
    if (plan?.normalized) {
      const grown = plan.refSide === "old" ? "新版" : "旧版";
      lines.push(`用紙合わせ: ${grown}を×${plan.ratio.toFixed(3)}で描画（自動）`);
    } else if (plan?.aspectMismatch) {
      lines.push("用紙合わせ: 用紙の縦横比が違うため未適用");
    }
    const manualQuadrant = state.comparison.quadrantManual.get(state.documents.currentPage);
    if (manualQuadrant != null) {
      lines.push(`向き: 手動 ${manualQuadrant * 90}°`);
    } else if (state.comparison.autoAlign) {
      const quadrant = state.visual.quadrantCache.get(state.documents.currentPage);
      if (quadrant && !quadrant.blank) {
        const percent = value => `${Math.round(value * 100)}%`;
        if (quadrant.applied) {
          lines.push(`向き: 自動 ${quadrant.k * 90}°（一致率 ${percent(quadrant.scores[0])} → ${percent(quadrant.scores[quadrant.k])}）`);
        } else {
          lines.push("向き: 0°（回転なし）");
        }
      }
    }
    if (!state.comparison.autoAlign) {
      lines.push("自動整列: OFF");
    } else {
      const alignment = state.visual.alignmentCache.get(state.documents.currentPage);
      if (!alignment) {
        lines.push("自動整列: 推定待ち");
      } else if (alignment.blank) {
        lines.push("自動整列: 片側が空白のため対象外");
      } else {
        const percent = value => `${Math.round(value * 100)}%`;
        const score = `一致率 ${percent(alignment.scoreBase)} → ${percent(alignment.scoreBest)}`;
        if (!alignment.applied) {
          lines.push(`自動整列: ${score}（改善せず・恒等のまま）`);
        } else if (alignment.method === "translate") {
          const signed = value => `${value >= 0 ? "+" : ""}${value}`;
          const dx = Math.round(alignment.txFrac * out.width);
          const dy = Math.round(alignment.tyFrac * out.height);
          lines.push(`自動整列: 平行移動 ${signed(dx)},${signed(dy)}px / ${score}`);
        } else {
          const degrees = (alignment.angle * 180 / Math.PI).toFixed(2);
          lines.push(`自動整列: θ=${alignment.angle >= 0 ? "+" : ""}${degrees}° ×${alignment.scale.toFixed(3)} / ${score}`);
        }
      }
    }
    dom.alignReadout.textContent = lines.join(" ／ ");
  }

  function updateManualAlignReadout() {
    const degrees = state.comparison.manualAngle * 180 / Math.PI;
    dom.rotReset.textContent = `${degrees >= 0 ? "+" : ""}${degrees.toFixed(1)}°`;
    dom.scaleReset.textContent = `${(state.comparison.manualScale * 100).toFixed(1)}%`;
    const manual = state.comparison.quadrantManual.has(state.documents.currentPage);
    const quadrant = deps.effectiveQuadrant(
      { comparison: state.comparison, pageIndex: state.documents.currentPage },
      state.visual.quadrantCache,
    );
    dom.quadReset.textContent = `${quadrant * 90}°${manual ? "（手動）" : ""}`;
  }

  function setModeUi() {
    dom.modeDiff.classList.toggle("active", state.visual.mode === "diff");
    dom.modeToggle.classList.toggle("active", state.visual.mode === "toggle");
    dom.toggleInd.style.display = state.visual.mode === "toggle" ? "flex" : "none";
    dom.th.disabled = state.visual.mode === "toggle";
    dom.boxToggle.disabled = !state.visual.rendered;
    boxEditorView.updateControls();
  }

  const interactiveLane = deps.createWorkerLane({ createWorker: deps.createDiffWorker });
  const exportLane = deps.createWorkerLane({ createWorker: deps.createDiffWorker });

  // 描画1回につき1セッション。cancel() 以前に始まった描画からのジョブは
  // レーンへ到達した時点で RenderCancelled となり、現行の描画がレーンを取れる。
  const laneCompute = lane => {
    const run = lane.session();
    return Object.freeze({
      computeDiff: (payload, options) => run("diff", payload, options),
      computeAlignment: (payload, options) => run("align", payload, options),
      computeQuadrant: (payload, options) => run("quadrant", payload, options),
    });
  };

  const sharedRenderDependencies = Object.freeze({
    sequenceIndex: deps.sequenceIndex,
    pageSizePt: deps.pageSizePt,
    framePlan: deps.framePlan,
    renderPageCanvas: deps.renderPageCanvas,
    rotateCanvas90: deps.rotateCanvas90,
    canvasToRgba: deps.canvasToRgba,
    alignProbeScale: deps.alignProbeScale,
    downscaleCanvas: deps.downscaleCanvas,
    createCanvas: deps.createCanvas,
    createWhiteCanvas: deps.createWhiteCanvas,
    pageLabelText: deps.pageLabelText,
  });

  const visualRenderDependencies = () => Object.freeze({
    ...sharedRenderDependencies,
    ...laneCompute(interactiveLane),
  });

  const exportRenderDependencies = () => Object.freeze({
    ...sharedRenderDependencies,
    ...laneCompute(exportLane),
  });

  visualController = deps.createVisualController({
    state,
    dom: {
      out,
      placeholder: dom.ph,
      status: dom.status,
      pageLabel: dom.pageLabel,
      statRm: dom.statRm,
      statAd: dom.statAd,
      statBox: dom.statBox,
      dlPng: dom.dlPng,
      dlPdf: dom.dlPdf,
      boxToggle: dom.boxToggle,
      sideOld: dom.sideOld,
      sideNew: dom.sideNew,
      cancelBoxDrag: () => boxEditorController?.cancelDrag?.(),
      cancelRender: () => interactiveLane.cancel(),
      refreshBoxEditor: () => boxEditorView?.refresh?.(),
      afterCommit() {
        updateAlignButtons();
        updateAlignReadout();
        updateManualAlignReadout();
        boxEditorView?.updateControls?.();
      },
      reportError: error => errorReporter.report(error, "レンダリングに失敗しました"),
    },
    renderDiffPage: (snapshot, options) => (
      deps.renderDiffPage(snapshot, visualRenderDependencies(), options)
    ),
    renderTogglePage: (snapshot, options) => (
      deps.renderTogglePage(snapshot, visualRenderDependencies(), options)
    ),
    drawBoxes: () => boxEditorView?.redraw?.(),
  });

  textController = deps.createTextController({
    state,
    dom: {
      textStatus: dom.textStatus,
      runText: dom.runText,
      dlTextPng: dom.dlTextPng,
      dlTextPdf: dom.dlTextPdf,
      textPageInd: dom.textPageInd,
      oldTextCanvas: dom.oldTextCanvas,
      newTextCanvas: dom.newTextCanvas,
      topVisual: dom.topVisual,
      topText: dom.topText,
      visualCtrl: dom.visualCtrl,
      textCtrl: dom.textCtrl,
      viewbar: dom.viewbar,
      canvasWrap: dom.canvasWrap,
      textPanel: dom.textPanel,
      out,
      textPrev: dom.textPrev,
      textNext: dom.textNext,
      cancelBoxEdit: () => boxEditorController?.setEditMode?.(false),
      restoreVisual: () => {
        if (state.visual.rendered) out.style.display = "block";
        boxEditorView?.redraw?.();
      },
    },
    extractPageTokens: deps.extractPageTokens,
    renderer: textRenderer,
    errorReporter: textErrorReporter,
    onDebug: value => window.console.log(
      `[XYCut] page ${value.pageIndex + 1}: leaves=${value.leafSizes.length} hadVerticalCut=${value.hadVerticalCut}`,
      value.leafSizes,
    ),
  });

  exportController = deps.createExportController({
    state,
    dom: {
      out,
      oldTextCanvas: dom.oldTextCanvas,
      newTextCanvas: dom.newTextCanvas,
      status: dom.status,
      textStatus: dom.textStatus,
      dlPng: dom.dlPng,
      dlPdf: dom.dlPdf,
      dlTextPng: dom.dlTextPng,
      dlTextPdf: dom.dlTextPdf,
    },
    // 1回のPDF出力で1セッション。読み込み直しで打ち切られた出力ループが
    // 次の出力からレーンを奪わないようにする。
    createVisualRenderSession: () => {
      const dependencies = exportRenderDependencies();
      return Object.freeze({
        render: ({ renderSnapshot }) => deps.renderDiffPage(renderSnapshot, dependencies),
        cancel: () => exportLane.cancel(),
      });
    },
    renderTextOffscreen: ({ side, pageIndex, snapshot }) => (
      textRenderer.renderOffscreen({ side, pageIndex, snapshot })
    ),
    pdfExporter: deps.createPdfExporter({ jsPDF: deps.jsPDF }),
    download: deps.downloadBlob,
    textColors,
    errorReporter,
  });

  documentController = deps.createDocumentController({
    state,
    dom: {
      dropOld: dom.dropOld,
      dropNew: dom.dropNew,
      run: dom.run,
      runText: dom.runText,
      dlPng: dom.dlPng,
      dlPdf: dom.dlPdf,
      dlTextPng: dom.dlTextPng,
      dlTextPdf: dom.dlTextPdf,
      status: dom.status,
      textStatus: dom.textStatus,
    },
    pdf: deps.pdfjsLib,
    errorReporter,
    invalidateDocuments: deps.invalidateDocuments,
    onReady: () => boxEditorController?.syncInvalidated?.(),
    onLoadAccepted: ({ documentGeneration }) => {
      textController?.invalidateDocuments?.(documentGeneration);
      exportController?.invalidateDocuments?.(documentGeneration);
    },
    confirmDiscard: () => boxEditorController?.confirmDiscard?.() ?? true,
  });

  const confirmDiscardBoxEdits = () => boxEditorController.confirmDiscard();
  const syncInvalidatedBoxEditor = () => boxEditorController.syncInvalidated();
  function applyComparisonSettingChange(update, invalidate) {
    const applied = deps.applyInvalidatingChange(state, {
      confirmDiscard: confirmDiscardBoxEdits,
      update,
      invalidate,
    });
    if (applied) syncInvalidatedBoxEditor();
    return applied;
  }

  function restoreCommittedRange(element, label) {
    element.value = element.dataset.committed;
    label.textContent = element.value;
  }

  function isTypingTarget(event) {
    const tag = event.target?.tagName || "";
    return ["INPUT", "TEXTAREA", "SELECT"].includes(tag) || Boolean(event.target?.isContentEditable);
  }

  const appController = Object.freeze({
    async loadFile(side, event) {
      const file = event.target.files[0];
      if (!file) return;
      try {
        await documentController.load(side, file);
      } finally {
        event.target.value = "";
      }
    },
    dragOver(drop, event) {
      event.preventDefault();
      drop.style.borderColor = "var(--signal)";
    },
    dragLeave(drop) {
      drop.style.borderColor = "";
    },
    dropFile(side, drop, event) {
      event.preventDefault();
      drop.style.borderColor = "";
      const file = event.dataTransfer.files[0];
      if (file?.type === "application/pdf") documentController.load(side, file);
    },
    async setDiffMode() {
      if (state.visual.mode === "diff" || !hasImage()) return;
      state.visual.mode = "diff";
      setModeUi();
      dom.status.innerHTML = '<span class="busy">差分を再計算中…</span>';
      if (state.documents.pages) await visualController.showPage(state.documents.currentPage);
    },
    async setToggleMode() {
      if (state.visual.mode === "toggle" || !hasImage()) return;
      state.visual.mode = "toggle";
      setModeUi();
      if (state.documents.pages) await visualController.showPage(state.documents.currentPage);
    },
    flipSide: () => visualController.flipToggleSide(),
    toggleBoxEdit: () => boxEditorController.setEditMode(!state.boxEditor.editMode),
    handleKeyDown(event) {
      if (state.ui.topMode !== "visual" || isTypingTarget(event)) return;
      if (event.code === "Space" && !event.repeat && event.target?.tagName !== "BUTTON") {
        if (state.boxEditor.editMode) {
          spaceHeld = true;
          event.preventDefault();
          return;
        }
        if (state.visual.mode === "toggle" && hasImage()) {
          event.preventDefault();
          visualController.flipToggleSide();
        }
        return;
      }
      if (event.key === "e" || event.key === "E") {
        if (event.ctrlKey || event.metaKey || event.altKey || !state.visual.rendered) return;
        event.preventDefault();
        boxEditorController.setEditMode(!state.boxEditor.editMode);
        return;
      }
      if (!state.boxEditor.editMode) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (state.boxEditor.selectedIndex >= 0) boxEditorController.clearSelection();
        else boxEditorController.setEditMode(false);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        boxEditorController.deleteSelected();
      } else if ((event.ctrlKey || event.metaKey) && (event.key === "z" || event.key === "Z")) {
        event.preventDefault();
        boxEditorController.undo();
      }
    },
    handleKeyUp(event) {
      if (event.code === "Space") spaceHeld = false;
    },
    handleBlur() {
      spaceHeld = false;
    },
    previewRange(kind, event) {
      const labels = { dpi: dom.dpiVal, th: dom.thVal, tolerance: dom.toleranceVal };
      labels[kind].textContent = event.target.value;
    },
    async commitDpi() {
      const next = +dom.dpi.value;
      if (!applyComparisonSettingChange(() => { state.comparison.dpi = next; }, deps.invalidateDpi)) {
        restoreCommittedRange(dom.dpi, dom.dpiVal);
        return;
      }
      dom.dpi.dataset.committed = dom.dpi.value;
      if (state.visual.rendered) {
        await visualController.showPage(state.documents.currentPage);
        viewerController.fit();
      }
    },
    commitThreshold() {
      const next = +dom.th.value;
      if (!applyComparisonSettingChange(() => { state.comparison.threshold = next; }, deps.invalidateThreshold)) {
        restoreCommittedRange(dom.th, dom.thVal);
        return;
      }
      dom.th.dataset.committed = dom.th.value;
      if (state.visual.mode === "diff" && state.visual.rendered) {
        visualController.showPage(state.documents.currentPage);
      }
    },
    commitTolerance() {
      const next = +dom.tolerance.value;
      if (!applyComparisonSettingChange(() => { state.comparison.tolerancePx = next; }, deps.invalidateTolerance)) {
        restoreCommittedRange(dom.tolerance, dom.toleranceVal);
        return;
      }
      dom.tolerance.dataset.committed = dom.tolerance.value;
      if (state.visual.rendered) visualController.showPage(state.documents.currentPage);
    },
    nudge(button) {
      if (!applyComparisonSettingChange(() => {
        state.comparison.dx += +button.dataset.dx;
        state.comparison.dy += +button.dataset.dy;
      }, deps.invalidateManualAlignment)) return;
      dom.nudgeReset.textContent = `${state.comparison.dx},${state.comparison.dy}`;
      if (state.visual.rendered) visualController.showPage(state.documents.currentPage);
    },
    resetNudge() {
      if (!applyComparisonSettingChange(() => {
        state.comparison.dx = 0;
        state.comparison.dy = 0;
      }, deps.invalidateManualAlignment)) return;
      dom.nudgeReset.textContent = "0,0";
      if (state.visual.rendered) visualController.showPage(state.documents.currentPage);
    },
    async rotateQuadrant(button) {
      if (!applyComparisonSettingChange(() => {
        const current = deps.effectiveQuadrant(
          { comparison: state.comparison, pageIndex: state.documents.currentPage },
          state.visual.quadrantCache,
        );
        state.comparison.quadrantManual.set(
          state.documents.currentPage,
          ((current + +button.dataset.quad) % 4 + 4) % 4,
        );
      }, deps.invalidateDpi)) return;
      updateManualAlignReadout();
      if (state.visual.rendered) await visualController.showPage(state.documents.currentPage);
    },
    async resetQuadrant() {
      if (!state.comparison.quadrantManual.has(state.documents.currentPage)) return;
      if (!applyComparisonSettingChange(() => {
        state.comparison.quadrantManual.delete(state.documents.currentPage);
      }, deps.invalidateDpi)) return;
      updateManualAlignReadout();
      if (state.visual.rendered) await visualController.showPage(state.documents.currentPage);
    },
    rotateFine(button) {
      if (!applyComparisonSettingChange(() => {
        state.comparison.manualAngle += +button.dataset.rot * 0.1 * Math.PI / 180;
      }, deps.invalidateDpi)) return;
      updateManualAlignReadout();
      if (state.visual.rendered) visualController.showPage(state.documents.currentPage);
    },
    resetFineRotation() {
      if (!applyComparisonSettingChange(() => { state.comparison.manualAngle = 0; }, deps.invalidateDpi)) return;
      updateManualAlignReadout();
      if (state.visual.rendered) visualController.showPage(state.documents.currentPage);
    },
    scale(button) {
      if (!applyComparisonSettingChange(() => {
        state.comparison.manualScale = Math.max(
          0.1,
          state.comparison.manualScale + +button.dataset.scale * 0.001,
        );
      }, deps.invalidateDpi)) return;
      updateManualAlignReadout();
      if (state.visual.rendered) visualController.showPage(state.documents.currentPage);
    },
    resetScale() {
      if (!applyComparisonSettingChange(() => { state.comparison.manualScale = 1; }, deps.invalidateDpi)) return;
      updateManualAlignReadout();
      if (state.visual.rendered) visualController.showPage(state.documents.currentPage);
    },
    async setAutoAlign(event) {
      const next = event.target.checked;
      if (!applyComparisonSettingChange(() => { state.comparison.autoAlign = next; }, deps.invalidateThreshold)) {
        event.target.checked = !next;
        return;
      }
      if (!state.visual.rendered) {
        updateAlignReadout();
        return;
      }
      await visualController.showPage(state.documents.currentPage);
    },
    async runVisual() {
      dom.modeDiff.disabled = false;
      dom.modeToggle.disabled = false;
      await visualController.showPage(0);
      viewerController.fit();
    },
    async alignAddNew() {
      if (!state.visual.rendered || !confirmDiscardBoxEdits()) return;
      state.documents.oldSequence.splice(state.documents.currentPage, 0, null);
      state.documents.alignmentOps.push({ side: "old", slot: state.documents.currentPage });
      await visualController.refreshAfterAlign({
        invalidatePageAlignment: deps.invalidatePageAlignment,
        syncInvalidatedBoxEditor,
      });
    },
    async alignDeleteOld() {
      if (!state.visual.rendered || !confirmDiscardBoxEdits()) return;
      state.documents.newSequence.splice(state.documents.currentPage, 0, null);
      state.documents.alignmentOps.push({ side: "new", slot: state.documents.currentPage });
      await visualController.refreshAfterAlign({
        invalidatePageAlignment: deps.invalidatePageAlignment,
        syncInvalidatedBoxEditor,
      });
    },
    async undoAlignment() {
      const operation = state.documents.alignmentOps[state.documents.alignmentOps.length - 1];
      if (!operation || !confirmDiscardBoxEdits()) return;
      state.documents.alignmentOps.pop();
      const sequence = operation.side === "old"
        ? state.documents.oldSequence
        : state.documents.newSequence;
      if (sequence[operation.slot] === null) sequence.splice(operation.slot, 1);
      await visualController.refreshAfterAlign({
        invalidatePageAlignment: deps.invalidatePageAlignment,
        syncInvalidatedBoxEditor,
      });
    },
    previousVisualPage: () => visualController.showPage(state.documents.currentPage - 1),
    nextVisualPage: () => visualController.showPage(state.documents.currentPage + 1),
  });

  for (const range of [dom.dpi, dom.th, dom.tolerance]) {
    range.dataset.committed = range.value;
  }

  deps.bindControls({
    document,
    window,
    dom,
    appController,
    viewerController,
    boxEditorController,
    textController,
    textRenderer,
    exportController,
  });

  return Object.freeze({
    state,
    documentController,
    visualController,
    viewerController,
    boxEditorController,
    textController,
    textRenderer,
    exportController,
  });
}
