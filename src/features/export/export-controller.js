import {
  composeTextExport,
  composeVisualExport,
  VISUAL_BOX_STYLE,
} from "./image-composer.js";

const VISUAL_COLORS = Object.freeze({
  common: "rgb(60,60,60)",
  removed: "rgb(255,91,87)",
  added: "rgb(77,141,255)",
});

function cloneValue(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map(cloneValue));
  const copy = {};
  for (const [key, child] of Object.entries(value)) copy[key] = cloneValue(child);
  return Object.freeze(copy);
}

function cloneMap(map, clone = cloneValue) {
  const backing = new Map([...map].map(([key, value]) => [key, clone(value)]));
  let readonly;
  readonly = {
    get size() { return backing.size; },
    get: key => backing.get(key),
    has: key => backing.has(key),
    entries: () => backing.entries(),
    keys: () => backing.keys(),
    values: () => backing.values(),
    forEach(callback, thisArg) {
      backing.forEach((value, key) => callback.call(thisArg, value, key, readonly));
    },
    [Symbol.iterator]: () => backing[Symbol.iterator](),
  };
  return Object.freeze(readonly);
}

function cloneHighlights(highlights) {
  if (!highlights) return null;
  return Object.freeze({
    old: cloneMap(highlights.old),
    new: cloneMap(highlights.new),
  });
}

function captureSnapshot(state) {
  const documents = Object.freeze({
    old: state.documents.oldDoc,
    new: state.documents.newDoc,
    oldDoc: state.documents.oldDoc,
    newDoc: state.documents.newDoc,
    pages: state.documents.pages,
    currentPage: state.documents.currentPage,
    generation: state.documents.generation,
    oldSequence: Object.freeze([...(state.documents.oldSequence || [])]),
    newSequence: Object.freeze([...(state.documents.newSequence || [])]),
  });
  const comparison = Object.freeze({
    dpi: state.comparison.dpi,
    threshold: state.comparison.threshold,
    tolerancePx: state.comparison.tolerancePx,
    dx: state.comparison.dx,
    dy: state.comparison.dy,
    manualAngle: state.comparison.manualAngle,
    manualScale: state.comparison.manualScale,
    autoAlign: state.comparison.autoAlign,
    quadrantManual: cloneMap(state.comparison.quadrantManual),
  });
  const visual = Object.freeze({
    mode: state.visual.mode,
    toggleSide: state.visual.toggleSide,
    renderGeneration: state.visual.renderGeneration,
    quadrantGeneration: state.visual.quadrantGeneration,
    currentPlan: cloneValue(state.visual.currentPlan),
    toggleCache: cloneValue(state.visual.toggleCache),
    pageCache: cloneMap(state.visual.pageCache),
    alignmentCache: cloneMap(state.visual.alignmentCache),
    quadrantCache: cloneMap(state.visual.quadrantCache),
  });
  const boxEditor = Object.freeze({
    showBoxes: Boolean(state.boxEditor.showBoxes),
    currentBoxes: cloneValue(state.boxEditor.currentBoxes || []),
    autoByPage: cloneMap(state.boxEditor.autoByPage),
    editsByPage: cloneMap(state.boxEditor.editsByPage),
    revisionByPage: cloneMap(state.boxEditor.revisionByPage),
    selectedIndex: state.boxEditor.selectedIndex,
    drag: cloneValue(state.boxEditor.drag),
  });
  const highlights = cloneHighlights(state.textReview.highlights);
  return Object.freeze({
    documents,
    comparison,
    visual,
    boxEditor,
    highlights,
    scale: state.textReview.scale,
    textPage: state.textReview.page,
    textTotal: Math.max(documents.old?.numPages || 0, documents.new?.numPages || 0),
    textRenderGeneration: state.textReview.renderGeneration,
    textExtractGeneration: state.textReview.extractGeneration,
    topMode: state.ui.topMode,
  });
}

function visualLegend(mode, showBoxes) {
  const items = [];
  if (mode !== "toggle") {
    items.push(
      { color: VISUAL_COLORS.common, label: "共通" },
      { color: VISUAL_COLORS.removed, label: "削除（旧版のみ）" },
      { color: VISUAL_COLORS.added, label: "追加（新版のみ）" },
    );
  }
  if (showBoxes) {
    items.push({
      stroke: VISUAL_BOX_STYLE.color,
      fill: VISUAL_BOX_STYLE.fill,
      label: "変更枠",
    });
  }
  return Object.freeze(items.map(item => Object.freeze(item)));
}

function visualRenderSnapshot(snapshot, pageIndex) {
  const manualBoxes = snapshot.boxEditor.editsByPage.get(pageIndex);
  return Object.freeze({
    pageIndex,
    mode: "diff",
    documents: snapshot.documents,
    comparison: snapshot.comparison,
    visual: Object.freeze({
      toggleSide: snapshot.visual.toggleSide,
      toggleCache: snapshot.visual.toggleCache,
      renderGeneration: snapshot.visual.renderGeneration,
      currentPlan: snapshot.visual.currentPlan,
      alignmentCache: snapshot.visual.alignmentCache,
      quadrantCache: snapshot.visual.quadrantCache,
      quadrantGeneration: snapshot.visual.quadrantGeneration,
    }),
    boxEditor: Object.freeze({
      showBoxes: snapshot.boxEditor.showBoxes,
      manualBoxes: manualBoxes ?? null,
      revision: snapshot.boxEditor.revisionByPage.get(pageIndex) || 0,
    }),
  });
}

function toBlob(canvas) {
  return new Promise((resolve, reject) => {
    try {
      const pending = canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error("PNG Blobを作成できませんでした"));
      }, "image/png");
      pending?.catch?.(reject);
    } catch (error) {
      reject(error);
    }
  });
}

export function createExportController({
  state,
  dom,
  createVisualRenderSession,
  renderTextOffscreen,
  pdfExporter,
  download,
  errorReporter,
  textColors,
}) {
  let requestId = 0;
  const active = { visual: null, text: null };

  function channelUi(channel) {
    return channel === "visual"
      ? { status: dom.status, buttons: [dom.dlPng, dom.dlPdf] }
      : { status: dom.textStatus, buttons: [dom.dlTextPng, dom.dlTextPdf] };
  }

  function start(channel, snapshot, busyText) {
    const ui = channelUi(channel);
    const inherited = active[channel]?.prior;
    const prior = inherited || {
      text: ui.status.textContent,
      busy: ui.status.classList?.contains?.("busy") || false,
      disabled: ui.buttons.map(button => button.disabled),
    };
    const session = {
      id: ++requestId,
      channel,
      snapshot,
      ui,
      prior,
      lastStatus: busyText,
      renderSession: null,
    };
    active[channel] = session;
    ui.status.textContent = busyText;
    ui.status.classList?.add?.("busy");
    ui.buttons.forEach(button => { button.disabled = true; });
    return session;
  }

  function owns(session) {
    return active[session.channel] === session
      && state.documents.generation === session.snapshot.documents.generation
      && session.ui.status.textContent === session.lastStatus;
  }

  function setOwnedStatus(session, text) {
    if (!owns(session)) return false;
    session.ui.status.textContent = text;
    session.lastStatus = text;
    return true;
  }

  function fail(session, error, message) {
    if (!owns(session)) return;
    errorReporter.report(error, message, session.ui.status);
    session.lastStatus = session.ui.status.textContent;
  }

  function finish(session) {
    if (active[session.channel] !== session) return;
    active[session.channel] = null;
    if (
      state.documents.generation !== session.snapshot.documents.generation
      || session.ui.status.textContent !== session.lastStatus
    ) return;
    if (session.prior.busy) session.ui.status.classList?.add?.("busy");
    else session.ui.status.classList?.remove?.("busy");
    session.ui.buttons.forEach((button, index) => {
      button.disabled = session.prior.disabled[index];
    });
  }

  function abandon(session) {
    if (active[session.channel] !== session) return false;
    active[session.channel] = null;
    session.renderSession?.cancel();
    if (session.prior.busy) session.ui.status.classList?.add?.("busy");
    else session.ui.status.classList?.remove?.("busy");
    session.ui.buttons.forEach((button, index) => {
      button.disabled = session.prior.disabled[index];
    });
    return true;
  }

  function invalidateDocuments(documentGeneration = state.documents.generation) {
    let invalidated = false;
    for (const channel of ["visual", "text"]) {
      const session = active[channel];
      if (
        session
        && session.snapshot.documents.generation < documentGeneration
      ) {
        invalidated = abandon(session) || invalidated;
      }
    }
    return invalidated;
  }

  async function saveVisualPng() {
    const snapshot = captureSnapshot(state);
    const session = start("visual", snapshot, "PNG生成中…");
    const filename = snapshot.visual.mode === "toggle"
      ? `${snapshot.visual.toggleSide === "new" ? "new" : "old"}_p${snapshot.documents.currentPage + 1}.png`
      : `diff_p${snapshot.documents.currentPage + 1}.png`;
    try {
      const boxes = snapshot.boxEditor.showBoxes ? snapshot.boxEditor.currentBoxes : [];
      const composed = composeVisualExport({
        source: dom.out,
        boxes,
        legend: visualLegend(snapshot.visual.mode, snapshot.boxEditor.showBoxes),
        dpi: snapshot.comparison.dpi,
      });
      const blob = await toBlob(composed);
      await download(blob, filename);
      setOwnedStatus(session, session.prior.text);
      return true;
    } catch (error) {
      fail(session, error, "PNGの保存に失敗しました");
      return false;
    } finally {
      finish(session);
    }
  }

  async function saveVisualPdf() {
    const snapshot = captureSnapshot(state);
    const session = start("visual", snapshot, "PDF生成中…");
    session.renderSession = createVisualRenderSession();
    try {
      await pdfExporter.saveVisual({
        pageCount: snapshot.documents.pages,
        dpi: snapshot.comparison.dpi,
        filename: "diff.pdf",
        renderPage: async pageIndex => {
          const result = await session.renderSession.render({
            snapshot,
            pageIndex,
            renderSnapshot: visualRenderSnapshot(snapshot, pageIndex),
          });
          const manual = snapshot.boxEditor.editsByPage.get(pageIndex);
          const boxes = !snapshot.boxEditor.showBoxes ? [] : (manual ?? result.boxes ?? []);
          return composeVisualExport({
            source: result.canvas,
            boxes,
            legend: visualLegend("diff", snapshot.boxEditor.showBoxes),
            dpi: snapshot.comparison.dpi,
          });
        },
      });
      setOwnedStatus(session, "PDFを保存しました");
      return true;
    } catch (error) {
      fail(session, error, "PDFの保存に失敗しました");
      return false;
    } finally {
      finish(session);
    }
  }

  async function renderTextPage(snapshot, pageIndex) {
    const [oldCanvas, newCanvas] = await Promise.all([
      renderTextOffscreen({ side: "old", pageIndex, snapshot }),
      renderTextOffscreen({ side: "new", pageIndex, snapshot }),
    ]);
    return composeTextExport({
      oldCanvas,
      newCanvas,
      pageIndex,
      total: snapshot.textTotal,
      colors: textColors,
    });
  }

  async function saveTextPng() {
    const snapshot = captureSnapshot(state);
    if (snapshot.topMode !== "text" || !snapshot.highlights) return false;
    const session = start("text", snapshot, "PNG生成中…");
    const filename = `textdiff_p${snapshot.textPage + 1}.png`;
    try {
      const canvas = await renderTextPage(snapshot, snapshot.textPage);
      const blob = await toBlob(canvas);
      await download(blob, filename);
      setOwnedStatus(session, "テキスト差分を表示中");
      return true;
    } catch (error) {
      fail(session, error, "PNGの保存に失敗しました");
      return false;
    } finally {
      finish(session);
    }
  }

  async function saveTextPdf() {
    const snapshot = captureSnapshot(state);
    if (snapshot.topMode !== "text" || !snapshot.highlights) return false;
    const session = start("text", snapshot, "PDF生成中…（1/" + snapshot.textTotal + "）");
    try {
      await pdfExporter.saveText({
        pageCount: snapshot.textTotal,
        dpi: snapshot.comparison.dpi,
        filename: "textdiff.pdf",
        onPage(pageIndex, total) {
          setOwnedStatus(session, `PDF生成中…（${pageIndex + 1}/${total}）`);
        },
        renderPage: pageIndex => renderTextPage(snapshot, pageIndex),
      });
      setOwnedStatus(session, "PDFを保存しました");
      return true;
    } catch (error) {
      fail(session, error, "PDFの保存に失敗しました");
      return false;
    } finally {
      finish(session);
    }
  }

  return {
    saveVisualPng,
    saveVisualPdf,
    saveTextPng,
    saveTextPdf,
    invalidateDocuments,
  };
}
