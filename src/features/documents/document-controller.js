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

export function createDocumentController({
  state,
  dom,
  pdf,
  errorReporter,
  onReady,
  confirmDiscard = () => true,
}) {
  const latestGeneration = { old: null, new: null };

  async function load(side, file) {
    if (!confirmDiscard()) return false;

    state.documents.generation += 1;
    const generation = state.documents.generation;
    latestGeneration[side] = generation;
    const isCurrent = () => latestGeneration[side] === generation;
    let doc;
    try {
      const data = await file.arrayBuffer();
      if (!isCurrent()) return false;
      doc = await pdf.getDocument({ data, ...PDF_DOCUMENT_OPTIONS }).promise;
    } catch (error) {
      if (isCurrent()) {
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
    state.visual.rendered = false;
    dom.dlTextPng.disabled = true;
    dom.dlTextPdf.disabled = true;

    if (state.documents.oldDoc && state.documents.newDoc) {
      prepareSequences(state, dom);
      onReady();
    }
    return true;
  }

  return { load };
}
