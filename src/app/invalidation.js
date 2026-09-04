function clearBoxes(state) {
  state.boxEditor.autoByPage.clear();
  state.boxEditor.editsByPage.clear();
  state.boxEditor.undoByPage.clear();
  state.boxEditor.revisionByPage.clear();
  state.boxEditor.currentBoxes = null;
}

function clearVisualDerived(state, { pageRendering, alignment, quadrant, boxes }) {
  state.visual.pageCache.clear();
  state.visual.renderGeneration += 1;
  if (pageRendering) {
    state.visual.toggleCache = null;
    state.visual.currentPlan = null;
    state.visual.splitCache = null;
  }
  if (alignment) state.visual.alignmentCache.clear();
  if (quadrant) {
    state.visual.quadrantCache.clear();
    state.comparison.quadrantManual.clear();
    state.visual.quadrantGeneration += 1;
  }
  if (boxes) clearBoxes(state);
}

export function applyInvalidatingChange(state, { confirmDiscard, update, invalidate }) {
  if (!confirmDiscard()) return false;
  update();
  invalidate(state);
  return true;
}

export function invalidateDocuments(state, { advanceGeneration = true } = {}) {
  clearVisualDerived(state, { pageRendering: true, alignment: true, quadrant: true, boxes: true });
  if (advanceGeneration) state.documents.generation += 1;
  state.textReview.scale = null;
  state.textReview.extraction = null;
  state.textReview.highlights = null;
  state.textReview.page = 0;
  state.textReview.extractGeneration += 1;
  state.textReview.renderGeneration += 1;
}

export function invalidatePageAlignment(state) {
  clearVisualDerived(state, { pageRendering: true, alignment: true, quadrant: true, boxes: true });
}

export function invalidateDpi(state) {
  clearVisualDerived(state, { pageRendering: true, alignment: true, quadrant: false, boxes: true });
}

export function invalidateThreshold(state) {
  clearVisualDerived(state, { pageRendering: false, alignment: true, quadrant: false, boxes: true });
}

export function invalidateTolerance(state) {
  clearVisualDerived(state, { pageRendering: false, alignment: false, quadrant: false, boxes: true });
}

export function invalidateManualAlignment(state) {
  clearVisualDerived(state, { pageRendering: false, alignment: false, quadrant: false, boxes: true });
}

export function invalidateBoxDetection(state) {
  clearBoxes(state);
}
