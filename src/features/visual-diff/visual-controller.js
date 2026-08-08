import { toggleCompletedCacheMatchesSnapshot } from "./visual-renderer.js";

function frozenBoxes(boxes) {
  if (!boxes) return null;
  return Object.freeze(boxes.map(box => Object.freeze({ ...box })));
}

function createSnapshot(
  state,
  pageIndex,
  mode,
  toggleSide = state.visual.toggleSide,
) {
  const manualBoxes = state.boxEditor.editsByPage.get(pageIndex);
  return Object.freeze({
    pageIndex,
    mode,
    documents: Object.freeze({
      oldDoc: state.documents.oldDoc,
      newDoc: state.documents.newDoc,
      pages: state.documents.pages,
      generation: state.documents.generation,
      oldSequence: Object.freeze([...(state.documents.oldSequence || [])]),
      newSequence: Object.freeze([...(state.documents.newSequence || [])]),
    }),
    comparison: Object.freeze({
      dpi: state.comparison.dpi,
      threshold: state.comparison.threshold,
      tolerancePx: state.comparison.tolerancePx,
      dx: state.comparison.dx,
      dy: state.comparison.dy,
      manualAngle: state.comparison.manualAngle,
      manualScale: state.comparison.manualScale,
      autoAlign: state.comparison.autoAlign,
      quadrantManual: new Map(state.comparison.quadrantManual),
    }),
    visual: Object.freeze({
      toggleSide,
      toggleCache: state.visual.toggleCache,
      renderGeneration: state.visual.renderGeneration,
      currentPlan: state.visual.currentPlan
        ? Object.freeze({ ...state.visual.currentPlan })
        : null,
      alignmentCache: new Map(state.visual.alignmentCache),
      quadrantCache: new Map(state.visual.quadrantCache),
      quadrantGeneration: state.visual.quadrantGeneration,
    }),
    boxEditor: Object.freeze({
      showBoxes: state.boxEditor.showBoxes,
      manualBoxes: frozenBoxes(manualBoxes),
      revision: state.boxEditor.revisionByPage.get(pageIndex) || 0,
    }),
  });
}

function replaceMap(target, source) {
  if (!source) return;
  target.clear();
  for (const [key, value] of source) target.set(key, value);
}

export function createVisualController({
  state,
  dom,
  renderDiffPage,
  renderTogglePage,
  drawBoxes,
}) {
  let activeInteractiveTicket = null;
  let pendingFlip = null;

  function isCurrent(ticket, snapshot, updateCurrentPage, commitToggleSide) {
    return ticket.id === state.visual.renderGeneration
      && ticket.documentGeneration === state.documents.generation
      && (!updateCurrentPage || snapshot.mode === state.visual.mode)
      && (
        !updateCurrentPage
        || snapshot.mode !== "toggle"
        || (commitToggleSide
          ? pendingFlip?.ticketId === ticket.id
            && pendingFlip.target === snapshot.visual.toggleSide
          : snapshot.visual.toggleSide === state.visual.toggleSide)
      );
  }

  function boxesAreCurrent(snapshot) {
    return snapshot.boxEditor.revision
      === (state.boxEditor.revisionByPage.get(snapshot.pageIndex) || 0);
  }

  function finishInteractive(ticket) {
    if (activeInteractiveTicket === ticket.id) activeInteractiveTicket = null;
    if (pendingFlip?.ticketId === ticket.id) pendingFlip = null;
  }

  function commitCanvas(canvas) {
    dom.out.width = canvas.width;
    dom.out.height = canvas.height;
    const context = dom.out.getContext("2d");
    context.clearRect(0, 0, dom.out.width, dom.out.height);
    context.drawImage(canvas, 0, 0);
    dom.out.style.display = "block";
    dom.placeholder.style.display = "none";
  }

  function updateToggleIndicator() {
    dom.sideOld?.classList.toggle("active", state.visual.toggleSide === "old");
    dom.sideNew?.classList.toggle("active", state.visual.toggleSide === "new");
  }

  function commitResult(
    result,
    snapshot,
    updateCurrentPage,
    commitToggleSide,
    commitBoxes,
  ) {
    if (commitToggleSide) state.visual.toggleSide = snapshot.visual.toggleSide;
    commitCanvas(result.canvas);
    state.visual.currentPlan = result.currentPlan;
    replaceMap(state.visual.alignmentCache, result.alignmentCache);
    replaceMap(state.visual.quadrantCache, result.quadrantCache);
    if (Object.hasOwn(result, "toggleCache")) state.visual.toggleCache = result.toggleCache;
    if (result.quadrantGeneration != null) {
      state.visual.quadrantGeneration = result.quadrantGeneration;
    }
    if (commitBoxes) {
      state.boxEditor.currentBoxes = result.boxes || [];
      if (result.autoBoxes !== undefined) {
        state.boxEditor.autoByPage.set(snapshot.pageIndex, result.autoBoxes);
      }
    }
    if (result.cacheEntry) state.visual.pageCache.set(snapshot.pageIndex, result.cacheEntry);
    if (updateCurrentPage) state.documents.currentPage = snapshot.pageIndex;
    if (commitBoxes && updateCurrentPage) state.boxEditor.selectedIndex = -1;
    state.visual.rendered = true;
    if (commitBoxes) drawBoxes();
    dom.pageLabel.textContent = result.pageLabel;
    dom.statRm.textContent = result.stats.removed;
    dom.statAd.textContent = result.stats.added;
    if (commitBoxes) dom.statBox.textContent = result.stats.boxes;
    dom.status.textContent = result.status;
    dom.dlPng.disabled = false;
    dom.dlPdf.disabled = false;
    dom.boxToggle.disabled = false;
    updateToggleIndicator();
    if (!commitBoxes) dom.refreshBoxEditor?.();
    if (updateCurrentPage) dom.afterCommit?.();
  }

  async function showPage(
    pageIndex,
    {
      mode = state.visual.mode,
      updateCurrentPage = true,
      toggleSide = state.visual.toggleSide,
      commitToggleSide = false,
    } = {},
  ) {
    if (pageIndex < 0 || pageIndex >= state.documents.pages) return { committed: false };
    const ticket = Object.freeze({
      id: ++state.visual.renderGeneration,
      documentGeneration: state.documents.generation,
      pageIndex,
    });
    const snapshot = createSnapshot(state, pageIndex, mode, toggleSide);
    if (updateCurrentPage) {
      activeInteractiveTicket = ticket.id;
      pendingFlip = commitToggleSide
        ? { ticketId: ticket.id, target: toggleSide }
        : null;
    }
    dom.cancelBoxDrag?.();
    dom.status.innerHTML = '<span class="busy">レンダリング中…</span>';
    const renderer = mode === "toggle" ? renderTogglePage : renderDiffPage;
    let result;
    try {
      result = await renderer(snapshot);
    } catch (error) {
      if (!isCurrent(ticket, snapshot, updateCurrentPage, commitToggleSide)) {
        finishInteractive(ticket);
        return { committed: false };
      }
      dom.reportError?.(error);
      finishInteractive(ticket);
      return { committed: false, error };
    }
    if (!isCurrent(ticket, snapshot, updateCurrentPage, commitToggleSide)) {
      finishInteractive(ticket);
      return { committed: false };
    }
    dom.cancelBoxDrag?.();
    commitResult(
      result,
      snapshot,
      updateCurrentPage,
      commitToggleSide,
      boxesAreCurrent(snapshot),
    );
    finishInteractive(ticket);
    return { committed: true };
  }

  function redrawToggleSide() {
    const canvas = state.visual.toggleCache?.sideCanvases?.[state.visual.toggleSide];
    if (!canvas) return false;
    commitCanvas(canvas);
    drawBoxes();
    updateToggleIndicator();
    dom.status.textContent = `新旧切替（${state.visual.toggleSide === "old" ? "OLD" : "NEW"}表示中）`;
    return true;
  }

  async function flipToggleSide() {
    const baseSide = pendingFlip?.target ?? state.visual.toggleSide;
    const targetSide = baseSide === "old" ? "new" : "old";
    const snapshot = createSnapshot(
      state,
      state.documents.currentPage,
      state.visual.mode,
      targetSide,
    );
    if (
      activeInteractiveTicket == null
      && snapshot.mode === "toggle"
      && toggleCompletedCacheMatchesSnapshot(snapshot, snapshot.visual.toggleCache)
      && snapshot.visual.toggleCache.sideCanvases?.[snapshot.visual.toggleSide]
    ) {
      state.visual.toggleSide = targetSide;
      redrawToggleSide();
      return { committed: true };
    }
    return showPage(state.documents.currentPage, {
      mode: state.visual.mode,
      toggleSide: targetSide,
      commitToggleSide: true,
    });
  }

  async function refreshAfterAlign({
    invalidatePageAlignment,
    syncInvalidatedBoxEditor,
  }) {
    state.documents.pages = Math.max(
      state.documents.oldSequence.length,
      state.documents.newSequence.length,
    );
    invalidatePageAlignment(state);
    syncInvalidatedBoxEditor();
    state.documents.currentPage = Math.min(
      Math.max(state.documents.currentPage, 0),
      Math.max(state.documents.pages - 1, 0),
    );
    return showPage(state.documents.currentPage);
  }

  return { showPage, flipToggleSide, refreshAfterAlign };
}
