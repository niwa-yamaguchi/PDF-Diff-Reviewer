import { assembleFromLeaves, reconstructLinesInItemOrder } from "../../core/text-diff/tokens.js";
import { xyCut } from "../../core/text-diff/xy-cut.js";
import { buildTextHighlights } from "../../core/text-diff/highlights.js";
import { applyTableHighlights } from "../../core/text-diff/tables.js";

const XYCUT_MAX_DEPTH = 6;
const XYCUT_MIN_BLOCK_TOKENS = 2;
const COL_GAP_EM = 2.5;
const ROW_GAP_EM = 1.6;
const COL_MIN_SIDE_LINES = 3;

export async function extractPageTokens({
  doc,
  pageIndex,
  debugXYCut = false,
  onDebug = () => {},
}) {
  const page = await doc.getPage(pageIndex + 1);
  const content = await page.getTextContent();
  if (page.rotate % 180 !== 0) return reconstructLinesInItemOrder(content.items);

  const tokens = [];
  let verticalCount = 0;
  content.items.forEach((item, ordinal) => {
    if (!item.str || !item.str.trim()) return;
    const x0 = item.transform[4];
    const y0 = item.transform[5];
    const fontHeight = Math.hypot(item.transform[2], item.transform[3]);
    if (Math.abs(item.transform[1]) > Math.abs(item.transform[0])) verticalCount += 1;
    tokens.push({
      ord: ordinal,
      x0,
      x1: x0 + item.width,
      y0,
      y1: y0 + fontHeight,
      fh: fontHeight,
    });
  });

  if (tokens.length && verticalCount * 2 > tokens.length) {
    return reconstructLinesInItemOrder(content.items);
  }
  if (tokens.length < XYCUT_MIN_BLOCK_TOKENS) {
    return reconstructLinesInItemOrder(content.items);
  }

  const context = { hadVerticalCut: false };
  const leaves = xyCut(tokens, {
    maxDepth: XYCUT_MAX_DEPTH,
    minBlockTokens: XYCUT_MIN_BLOCK_TOKENS,
    colGapEm: COL_GAP_EM,
    rowGapEm: ROW_GAP_EM,
    colMinSideLines: COL_MIN_SIDE_LINES,
    context,
  });
  const result = context.hadVerticalCut
    ? assembleFromLeaves(content.items, leaves)
    : reconstructLinesInItemOrder(content.items);

  if (debugXYCut) {
    onDebug({
      pageIndex,
      leafSizes: leaves.map(leaf => leaf.length),
      hadVerticalCut: context.hadVerticalCut,
    });
  }
  return result;
}

function cloneHighlightMap(highlights) {
  if (!highlights) return null;
  return Object.freeze({
    old: new Map(highlights.old),
    new: new Map(highlights.new),
  });
}

function totalPages(documents) {
  return Math.max(documents.old?.numPages || 0, documents.new?.numPages || 0);
}

function copyCanvas(source, target) {
  target.width = source.width;
  target.height = source.height;
  const context = target.getContext("2d");
  context.clearRect?.(0, 0, target.width, target.height);
  context.drawImage(source, 0, 0);
}

export function createTextController({
  state,
  dom,
  extractPageTokens: extractTokens,
  renderer,
  errorReporter,
  onProgress = () => {},
  onDebug = () => {},
}) {
  let pendingSession = null;
  const currentExtraction = ticket => (
    ticket.id === state.textReview.extractGeneration
    && ticket.documentGeneration === state.documents.generation
  );
  const currentSession = session => (
    pendingSession === session
    && currentExtraction(session.extractionTicket)
  );
  const currentRender = snapshot => (
    snapshot.ticket.id === state.textReview.renderGeneration
    && snapshot.ticket.documentGeneration === state.documents.generation
    && state.ui.topMode === "text"
    && (!snapshot.session || (
      currentSession(snapshot.session)
      && snapshot.session.ready
    ))
  );

  function captureUi() {
    return {
      status: dom.textStatus.textContent,
      busy: dom.textStatus.classList.contains("busy"),
      pngDisabled: dom.dlTextPng.disabled,
      pdfDisabled: dom.dlTextPdf.disabled,
    };
  }

  function restoreUi(snapshot) {
    dom.textStatus.textContent = snapshot.status;
    if (snapshot.busy) dom.textStatus.classList.add("busy");
    else dom.textStatus.classList.remove("busy");
    dom.dlTextPng.disabled = snapshot.pngDisabled;
    dom.dlTextPdf.disabled = snapshot.pdfDisabled;
  }

  function abandonSession(session) {
    if (pendingSession !== session) return;
    pendingSession = null;
    dom.textStatus.classList.remove("busy");
  }

  function activeCandidate() {
    if (!pendingSession) return null;
    if (!currentSession(pendingSession)) {
      pendingSession = null;
      dom.textStatus.classList.remove("busy");
      return null;
    }
    return pendingSession.ready ? pendingSession : null;
  }

  function extractionSnapshot() {
    const id = ++state.textReview.extractGeneration;
    return Object.freeze({
      ticket: Object.freeze({ id, documentGeneration: state.documents.generation }),
      documents: Object.freeze({ old: state.documents.oldDoc, new: state.documents.newDoc }),
      scale: state.comparison.dpi / 72,
      debugXYCut: Boolean(state.textReview.debugXYCut),
    });
  }

  function renderSnapshot(pageIndex, session) {
    const id = ++state.textReview.renderGeneration;
    const ticket = Object.freeze({
      id,
      documentGeneration: state.documents.generation,
      pageIndex,
    });
    return Object.freeze({
      ticket,
      session,
      documents: session
        ? session.documents
        : Object.freeze({ old: state.documents.oldDoc, new: state.documents.newDoc }),
      scale: session ? session.scale : state.textReview.scale,
      highlights: cloneHighlightMap(session ? session.highlights : state.textReview.highlights),
    });
  }

  async function extractDocument(side, snapshot) {
    const document = snapshot.documents[side];
    if (!document) return [];
    const pages = [];
    for (let pageIndex = 0; pageIndex < document.numPages; pageIndex += 1) {
      const lines = await extractTokens({
        doc: document,
        pageIndex,
        debugXYCut: snapshot.debugXYCut,
        onDebug,
      });
      if (!currentExtraction(snapshot.ticket)) return null;
      pages.push(lines);
      const progress = { side, page: pageIndex + 1, total: document.numPages };
      onProgress(progress);
      dom.textStatus.textContent = `${side === "old" ? "旧版" : "新版"}: 抽出中…（${progress.page}/${progress.total}）`;
    }
    return pages;
  }

  async function showPage(pageIndex) {
    const session = activeCandidate();
    const documents = session?.documents || { old: state.documents.oldDoc, new: state.documents.newDoc };
    const total = totalPages(documents);
    const highlights = session?.highlights || state.textReview.highlights;
    if (!highlights || !total || pageIndex < 0 || pageIndex >= total) return false;
    if (session) session.requestedPage = pageIndex;
    const snapshot = renderSnapshot(pageIndex, session);
    try {
      const [oldCanvas, newCanvas] = await Promise.all([
        renderer.renderPage({ side: "old", pageIndex, snapshot }),
        renderer.renderPage({ side: "new", pageIndex, snapshot }),
      ]);
      if (!currentRender(snapshot)) {
        if (session && !currentSession(session)) abandonSession(session);
        return false;
      }
      copyCanvas(oldCanvas, dom.oldTextCanvas);
      copyCanvas(newCanvas, dom.newTextCanvas);
      if (session) {
        state.textReview.extraction = session.extraction;
        state.textReview.highlights = session.highlights;
        state.textReview.scale = session.scale;
      }
      state.textReview.page = pageIndex;
      dom.textPageInd.textContent = `${pageIndex + 1} / ${total}`;
      renderer.applyView();
      if (session) {
        renderer.fit();
        dom.dlTextPng.disabled = false;
        dom.dlTextPdf.disabled = false;
        dom.textStatus.textContent = "テキスト差分を表示中";
        dom.textStatus.classList.remove("busy");
        session.settled = true;
        pendingSession = null;
      }
      return true;
    } catch (error) {
      if (!currentRender(snapshot)) {
        if (session && !currentSession(session)) abandonSession(session);
        return false;
      }
      errorReporter.report(error, "テキスト描画に失敗しました");
      if (session) {
        session.failed = true;
        pendingSession = null;
        restoreUi(session.priorUi);
      }
      return false;
    }
  }

  async function run({ force = false } = {}) {
    const snapshot = extractionSnapshot();
    const priorUi = pendingSession?.priorUi || captureUi();
    const session = {
      extractionTicket: snapshot.ticket,
      documents: snapshot.documents,
      scale: snapshot.scale,
      priorUi,
      extraction: null,
      highlights: null,
      requestedPage: 0,
      ready: false,
      settled: false,
      failed: false,
    };
    pendingSession = session;
    dom.textStatus.classList.add("busy");
    dom.textStatus.textContent = "抽出中…";
    try {
      let extraction = state.textReview.extraction;
      if (force || !extraction) {
        const oldPages = await extractDocument("old", snapshot);
        if (!currentSession(session) || oldPages === null) {
          abandonSession(session);
          return false;
        }
        const newPages = await extractDocument("new", snapshot);
        if (!currentSession(session) || newPages === null) {
          abandonSession(session);
          return false;
        }
        extraction = { old: oldPages, new: newPages };
      }

      const hasText = extraction.old.some(page => page.some(line => line.text.trim()))
        || extraction.new.some(page => page.some(line => line.text.trim()));
      if (!currentSession(session)) {
        abandonSession(session);
        return false;
      }
      if (!hasText) {
        state.textReview.extraction = extraction;
        state.textReview.highlights = null;
        state.textReview.scale = snapshot.scale;
        state.textReview.page = 0;
        dom.dlTextPng.disabled = true;
        dom.dlTextPdf.disabled = true;
        dom.textStatus.textContent = "テキストレイヤがありません。図面比較で確認してください";
        dom.textStatus.classList.remove("busy");
        session.settled = true;
        pendingSession = null;
        return false;
      }

      const highlights = buildTextHighlights(extraction.old, extraction.new);
      applyTableHighlights(extraction.old, extraction.new, highlights);
      if (!currentSession(session)) {
        abandonSession(session);
        return false;
      }
      session.extraction = extraction;
      session.highlights = highlights;
      session.ready = true;

      const shown = await showPage(0);
      if (session.settled) return true;
      if (!currentSession(session)) {
        abandonSession(session);
        return false;
      }
      if (!shown) return false;
      return session.settled;
    } catch (error) {
      if (!currentSession(session)) {
        abandonSession(session);
        return false;
      }
      errorReporter.report(error, "テキスト抽出に失敗しました");
      session.failed = true;
      pendingSession = null;
      dom.textStatus.classList.remove("busy");
      return false;
    }
  }

  function cancelRender() {
    state.textReview.renderGeneration += 1;
    renderer.cancelPan?.();
  }

  async function setTopMode(mode) {
    if (mode !== "visual" && mode !== "text") return false;
    if (state.ui.topMode === mode) return true;
    cancelRender();
    if (mode === "text" && state.boxEditor.editMode) dom.cancelBoxEdit?.();
    state.ui.topMode = mode;
    const visual = mode === "visual";
    dom.topVisual.classList.toggle("active", visual);
    dom.topText.classList.toggle("active", !visual);
    dom.visualCtrl.style.display = visual ? "flex" : "none";
    dom.textCtrl.style.display = visual ? "none" : "flex";
    dom.viewbar.style.display = visual ? "flex" : "none";
    dom.canvasWrap.style.display = visual ? "" : "none";
    dom.textPanel.style.display = visual ? "none" : "flex";
    if (visual) {
      dom.restoreVisualSurface?.();
      return true;
    }
    dom.out.style.display = "none";
    dom.visualSplitPanel.style.display = "none";
    const session = activeCandidate();
    if (session) return showPage(session.requestedPage);
    if (state.textReview.highlights) return showPage(state.textReview.page);
    return true;
  }

  function renderOffscreen(side, pageIndex) {
    const snapshot = Object.freeze({
      ticket: Object.freeze({
        id: state.textReview.renderGeneration,
        documentGeneration: state.documents.generation,
        pageIndex,
      }),
      documents: Object.freeze({ old: state.documents.oldDoc, new: state.documents.newDoc }),
      scale: state.textReview.scale,
      highlights: cloneHighlightMap(state.textReview.highlights),
    });
    return renderer.renderOffscreen({ side, pageIndex, snapshot });
  }

  function invalidateDocuments(documentGeneration = state.documents.generation) {
    const session = pendingSession;
    if (!session) return false;
    if (session.extractionTicket.documentGeneration >= documentGeneration) return false;
    abandonSession(session);
    return true;
  }

  function previousPage() {
    if (state.ui.topMode === "text") {
      const page = activeCandidate()?.requestedPage ?? state.textReview.page;
      showPage(page - 1);
    }
  }

  function nextPage() {
    if (state.ui.topMode === "text") {
      const page = activeCandidate()?.requestedPage ?? state.textReview.page;
      showPage(page + 1);
    }
  }

  return {
    run,
    showPage,
    setTopMode,
    cancelRender,
    renderOffscreen,
    invalidateDocuments,
    previousPage,
    nextPage,
    totalPages: () => totalPages({ old: state.documents.oldDoc, new: state.documents.newDoc }),
  };
}
