const activeBindings = new WeakMap();

export function bindControls({
  document,
  window,
  dom,
  appController,
  state,
  viewerController,
  splitViewerController,
  boxEditorController,
  textController,
  textRenderer,
  exportController,
}) {
  activeBindings.get(document)?.();

  const removals = [];
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    removals.push(() => target.removeEventListener(type, handler, options));
  };
  let active = true;
  const unbind = () => {
    if (!active) return;
    active = false;
    for (const remove of removals.reverse()) remove();
    if (activeBindings.get(document) === unbind) activeBindings.delete(document);
  };

  listen(document, "keydown", event => appController.handleKeyDown(event));
  listen(document, "keyup", event => appController.handleKeyUp(event));
  listen(window, "blur", event => appController.handleBlur(event));
  listen(window, "resize", event => {
    viewerController.handleResize(event);
    splitViewerController.handleResize(event);
    textRenderer.handleResize(event);
  });

  listen(dom.canvasWrap, "wheel", event => viewerController.handleWheel(event), { passive: false });
  listen(dom.canvasWrap, "pointerdown", event => viewerController.handlePointerDown(event));
  listen(dom.canvasWrap, "pointermove", event => {
    viewerController.handlePointerMove(event);
    boxEditorController.pointerMove(event);
    boxEditorController.updateCursor(event);
  });
  listen(dom.canvasWrap, "pointerup", event => {
    viewerController.handlePointerUp(event);
    boxEditorController.pointerUp(event);
  });
  listen(dom.canvasWrap, "pointercancel", event => {
    viewerController.handlePointerCancel(event);
    boxEditorController.pointerCancel(event);
  });
  listen(dom.canvasWrap, "dblclick", event => viewerController.handleDoubleClick(event));

  for (const wrap of [dom.splitOldWrap, dom.splitNewWrap]) {
    listen(wrap, "wheel", event => splitViewerController.handleWheel(wrap, event), { passive: false });
    listen(wrap, "pointerdown", event => splitViewerController.handlePointerDown(wrap, event));
    listen(wrap, "pointermove", event => splitViewerController.handlePointerMove(wrap, event));
    listen(wrap, "pointerup", event => splitViewerController.handlePointerUp(wrap, event));
    listen(wrap, "pointercancel", event => splitViewerController.handlePointerCancel(wrap, event));
  }

  const activeVisualViewer = () => (
    state.visual.mode === "split" ? splitViewerController : viewerController
  );
  listen(dom.zoomIn, "click", () => activeVisualViewer().zoomIn());
  listen(dom.zoomOut, "click", () => activeVisualViewer().zoomOut());
  listen(dom.zoomFit, "click", () => activeVisualViewer().fit());
  listen(dom.zoom1, "click", () => activeVisualViewer().zoomOne());

  for (const wrap of [dom.oldTextWrap, dom.newTextWrap]) {
    listen(wrap, "wheel", event => textRenderer.handleWheel(wrap, event), { passive: false });
    listen(wrap, "pointerdown", event => textRenderer.handlePointerDown(wrap, event));
    listen(wrap, "pointermove", event => textRenderer.handlePointerMove(wrap, event));
    listen(wrap, "pointerup", event => textRenderer.handlePointerUp(wrap, event));
    listen(wrap, "pointercancel", event => textRenderer.handlePointerCancel(wrap, event));
  }
  listen(dom.textZoomIn, "click", () => textRenderer.zoomIn());
  listen(dom.textZoomOut, "click", () => textRenderer.zoomOut());
  listen(dom.textZoomFit, "click", () => textRenderer.fitIfActive());
  listen(dom.textZoom1, "click", () => textRenderer.zoomOne());

  listen(dom.fileOld, "change", event => appController.loadFile("old", event));
  listen(dom.fileNew, "change", event => appController.loadFile("new", event));
  for (const [drop, side] of [[dom.dropOld, "old"], [dom.dropNew, "new"]]) {
    listen(drop, "dragover", event => appController.dragOver(drop, event));
    listen(drop, "dragleave", event => appController.dragLeave(drop, event));
    listen(drop, "drop", event => appController.dropFile(side, drop, event));
  }

  listen(dom.modeDiff, "click", () => appController.setDiffMode());
  listen(dom.modeToggle, "click", () => appController.setToggleMode());
  listen(dom.modeSplit, "click", () => appController.setSplitMode());
  listen(dom.toggleFlip, "click", () => appController.flipSide());
  listen(dom.boxToggle, "click", () => boxEditorController.toggleBoxes());
  listen(dom.boxEdit, "click", () => appController.toggleBoxEdit());
  listen(dom.boxDel, "click", () => boxEditorController.deleteSelected());
  listen(dom.boxReset, "click", () => boxEditorController.resetToAuto());

  listen(dom.dpi, "input", event => appController.previewRange("dpi", event));
  listen(dom.dpi, "change", event => appController.commitDpi(event));
  listen(dom.th, "input", event => appController.previewRange("th", event));
  listen(dom.th, "change", event => appController.commitThreshold(event));
  listen(dom.tolerance, "input", event => appController.previewRange("tolerance", event));
  listen(dom.tolerance, "change", event => appController.commitTolerance(event));

  for (const button of dom.nudgeButtons) {
    listen(button, "click", () => appController.nudge(button));
  }
  listen(dom.nudgeReset, "click", () => appController.resetNudge());
  for (const button of dom.quadButtons) {
    listen(button, "click", () => appController.rotateQuadrant(button));
  }
  listen(dom.quadReset, "click", () => appController.resetQuadrant());
  for (const button of dom.rotButtons) {
    listen(button, "click", () => appController.rotateFine(button));
  }
  listen(dom.rotReset, "click", () => appController.resetFineRotation());
  for (const button of dom.scaleButtons) {
    listen(button, "click", () => appController.scale(button));
  }
  listen(dom.scaleReset, "click", () => appController.resetScale());
  listen(dom.autoAlign, "change", event => appController.setAutoAlign(event));

  listen(dom.run, "click", () => appController.runVisual());
  listen(dom.alignAddNew, "click", () => appController.alignAddNew());
  listen(dom.alignDelOld, "click", () => appController.alignDeleteOld());
  listen(dom.alignUndo, "click", () => appController.undoAlignment());
  listen(dom.prev, "click", () => appController.previousVisualPage());
  listen(dom.next, "click", () => appController.nextVisualPage());

  listen(dom.runText, "click", () => textController.run());
  listen(dom.textPrev, "click", () => textController.previousPage());
  listen(dom.textNext, "click", () => textController.nextPage());
  listen(dom.topVisual, "click", () => textController.setTopMode("visual"));
  listen(dom.topText, "click", () => textController.setTopMode("text"));

  listen(dom.dlPng, "click", () => exportController.saveVisualPng());
  listen(dom.dlPdf, "click", () => exportController.saveVisualPdf());
  listen(dom.dlTextPng, "click", () => exportController.saveTextPng());
  listen(dom.dlTextPdf, "click", () => exportController.saveTextPdf());

  activeBindings.set(document, unbind);
  return unbind;
}
