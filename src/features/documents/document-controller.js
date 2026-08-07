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

function closeReadyActions(state, dom) {
  state.visual.rendered = false;
  dom.run.disabled = true;
  dom.runText.disabled = true;
  dom.dlTextPng.disabled = true;
  dom.dlTextPdf.disabled = true;
}

export function createDocumentController({
  state,
  dom,
  pdf,
  errorReporter,
  onReady,
  confirmDiscard = () => true,
}) {
  const pendingGeneration = { old: null, new: null };
  const failed = { old: false, new: false };
  const hasPending = () => pendingGeneration.old != null || pendingGeneration.new != null;
  const hasFailure = () => failed.old || failed.new;

  async function load(side, file) {
    if (!confirmDiscard()) return false;

    state.documents.generation += 1;
    const generation = state.documents.generation;
    pendingGeneration[side] = generation;
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
      }
      return false;
    }

    if (!isCurrent()) return false;
    if (side === "old") {
      state.documents.oldDoc = doc;
      setDrop(dom.dropOld, file.name);
    } else {
      state.documents.newDoc = doc;
      setDrop(dom.dropNew, file.name);
    }
    invalidateDocuments(state, { advanceGeneration: false });
    pendingGeneration[side] = null;

    if (!hasPending() && !hasFailure() && state.documents.oldDoc && state.documents.newDoc) {
      prepareSequences(state, dom);
      onReady();
    }
    return true;
  }

  return { load };
}
