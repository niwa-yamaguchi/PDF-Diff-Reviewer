import { invalidateDocuments } from "../../app/invalidation.js";
import { PDF_DOCUMENT_OPTIONS } from "../../platform/pdfjs.js";

function setDrop(dropTarget, name) {
  dropTarget.classList.add("set");
  dropTarget.querySelector(".fname").textContent = name;
}

function prepareSequences(state, dom) {
  state.documents.oldSequence = Array.from(
    { length: state.documents.oldDoc.numPages },
    (_, index) => index,
  );
  state.documents.newSequence = Array.from(
    { length: state.documents.newDoc.numPages },
    (_, index) => index,
  );
  state.documents.alignmentOps = [];
  state.documents.pages = Math.max(
    state.documents.oldSequence.length,
    state.documents.newSequence.length,
  );
  state.documents.currentPage = 0;
  dom.run.disabled = false;
  dom.runText.disabled = false;
  dom.status.textContent = "準備完了 — 「差分を表示」を押してください";
  dom.textStatus.textContent = "準備完了 — 「テキスト差分を表示」を押してください";
}

function setDisabled(control, disabled) {
  if (control) control.disabled = disabled;
}

function closeReadyActions(state, dom) {
  state.visual.rendered = false;
  dom.run.disabled = true;
  dom.runText.disabled = true;
  setDisabled(dom.dlPng, true);
  setDisabled(dom.dlPdf, true);
  dom.dlTextPng.disabled = true;
  dom.dlTextPdf.disabled = true;
}

function captureReadyState(state, dom) {
  return {
    rendered: state.visual.rendered,
    runDisabled: dom.run.disabled,
    runTextDisabled: dom.runText.disabled,
    dlPngDisabled: dom.dlPng?.disabled,
    dlPdfDisabled: dom.dlPdf?.disabled,
    dlTextPngDisabled: dom.dlTextPng.disabled,
    dlTextPdfDisabled: dom.dlTextPdf.disabled,
  };
}

function restoreReadyState(state, dom, snapshot) {
  state.visual.rendered = snapshot.rendered;
  dom.run.disabled = snapshot.runDisabled;
  dom.runText.disabled = snapshot.runTextDisabled;
  setDisabled(dom.dlPng, snapshot.dlPngDisabled);
  setDisabled(dom.dlPdf, snapshot.dlPdfDisabled);
  dom.dlTextPng.disabled = snapshot.dlTextPngDisabled;
  dom.dlTextPdf.disabled = snapshot.dlTextPdfDisabled;
}

export function createDocumentController({
  state,
  dom,
  pdf,
  errorReporter,
  onReady,
  onLoadAccepted = () => {},
  confirmDiscard = () => true,
}) {
  const pendingGeneration = { old: null, new: null };
  const staged = { old: null, new: null };
  const failed = { old: false, new: false };
  let readySnapshot = null;
  const hasPending = () => pendingGeneration.old != null || pendingGeneration.new != null;
  const hasStaged = () => staged.old != null || staged.new != null;
  const hasFailure = () => failed.old || failed.new;

  function resolveStage(entry, result) {
    if (!entry?.resolve) return;
    entry.resolve(result);
    entry.resolve = null;
  }

  function resolveStaged(result) {
    resolveStage(staged.old, result);
    resolveStage(staged.new, result);
  }

  function clearBatch() {
    staged.old = null;
    staged.new = null;
    failed.old = false;
    failed.new = false;
    readySnapshot = null;
  }

  function settleBatch() {
    if (hasPending()) return;
    if (hasFailure()) {
      restoreReadyState(state, dom, readySnapshot);
      resolveStaged(false);
      if (!hasStaged()) clearBatch();
      return;
    }
    if (!hasStaged()) {
      restoreReadyState(state, dom, readySnapshot);
      clearBatch();
      return;
    }

    if (staged.old) {
      state.documents.oldDoc = staged.old.doc;
      setDrop(dom.dropOld, staged.old.fileName);
    }
    if (staged.new) {
      state.documents.newDoc = staged.new.doc;
      setDrop(dom.dropNew, staged.new.fileName);
    }
    invalidateDocuments(state, { advanceGeneration: false });
    closeReadyActions(state, dom);
    if (state.documents.oldDoc && state.documents.newDoc) {
      prepareSequences(state, dom);
      onReady();
    }
    resolveStaged(true);
    clearBatch();
  }

  async function load(side, file) {
    if (!confirmDiscard()) return false;

    if (hasFailure() && !hasPending() && hasStaged() && !failed[side]) {
      resolveStaged(false);
      clearBatch();
    }
    state.documents.generation += 1;
    const generation = state.documents.generation;
    onLoadAccepted({ side, documentGeneration: generation });
    if (readySnapshot == null) readySnapshot = captureReadyState(state, dom);
    pendingGeneration[side] = generation;
    resolveStage(staged[side], false);
    staged[side] = null;
    failed[side] = false;
    const isCurrent = () => pendingGeneration[side] === generation;
    closeReadyActions(state, dom);
    let doc;
    try {
      const data = await file.arrayBuffer();
      if (!isCurrent()) return false;
      doc = await pdf.getDocument({ data, ...PDF_DOCUMENT_OPTIONS }).promise;
    } catch (error) {
      if (isCurrent()) {
        pendingGeneration[side] = null;
        failed[side] = true;
        errorReporter.report(error, "PDFの読み込みに失敗しました");
        settleBatch();
      }
      return false;
    }

    if (!isCurrent()) return false;
    let resolve;
    const result = new Promise((resolveResult) => {
      resolve = resolveResult;
    });
    staged[side] = { doc, fileName: file.name, resolve };
    pendingGeneration[side] = null;
    settleBatch();
    return result;
  }

  return { load };
}
