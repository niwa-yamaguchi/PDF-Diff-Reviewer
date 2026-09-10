import { fitViewport, focusRectViewport, preserveViewportCenter, zoomAt } from "./viewport.js";

export function createViewerController({ state, dom, window, onTransform = () => {} }) {
  let view = { scale: 1, tx: 0, ty: 0 };
  let pan = null;
  let lastViewport = viewportSize();

  const hasImage = () => (
    typeof dom.hasImage === "function"
      ? dom.hasImage()
      : dom.out.style.display !== "none"
  );
  const visualIsActive = () => state.ui.topMode === "visual";
  const copyView = () => ({ ...view });

  function viewportSize() {
    return { width: dom.wrap.clientWidth, height: dom.wrap.clientHeight };
  }

  function viewportIsLaidOut(size) {
    return Number.isFinite(size?.width) && size.width > 0
      && Number.isFinite(size?.height) && size.height > 0;
  }

  function viewsWithinPercent(current, fitted, percent = 0.01) {
    if (!fitted) return false;
    const scaleTol = Math.max(Math.abs(fitted.scale), Math.abs(current.scale)) * percent;
    const txTol = Math.max(1, Math.abs(fitted.tx), Math.abs(current.tx)) * percent;
    const tyTol = Math.max(1, Math.abs(fitted.ty), Math.abs(current.ty)) * percent;
    return Math.abs(current.scale - fitted.scale) <= scaleTol
      && Math.abs(current.tx - fitted.tx) <= txTol
      && Math.abs(current.ty - fitted.ty) <= tyTol;
  }

  function apply(nextView = view) {
    view = { ...nextView };
    const size = viewportSize();
    if (viewportIsLaidOut(size)) lastViewport = size;
    dom.out.style.transform = `translate(${view.tx}px,${view.ty}px) scale(${view.scale})`;
    dom.zoomLabel.textContent = `${Math.round(view.scale * 100)}%`;
    onTransform(copyView());
    return copyView();
  }

  function fit() {
    const fitted = fitViewport(
      { width: dom.out.width, height: dom.out.height },
      { width: dom.wrap.clientWidth, height: dom.wrap.clientHeight },
    );
    return fitted ? apply(fitted) : copyView();
  }

  function zoomAtPoint(factor, cx, cy) {
    if (!hasImage()) return copyView();
    return apply(zoomAt(view, factor, cx, cy));
  }

  function zoomCenter(factor) {
    return zoomAtPoint(factor, dom.wrap.clientWidth / 2, dom.wrap.clientHeight / 2);
  }

  function cancelPan(event) {
    if (!pan) return;
    const pointerId = event?.pointerId ?? pan.pointerId;
    pan = null;
    dom.wrap.classList.remove("panning");
    try { dom.wrap.releasePointerCapture(pointerId); } catch (_) { /* capture may already be gone */ }
  }

  function handleWheel(event) {
    if (!visualIsActive() || !hasImage()) return;
    event.preventDefault();
    const rect = dom.wrap.getBoundingClientRect();
    zoomAtPoint(
      event.deltaY < 0 ? 1.12 : 1 / 1.12,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
  }

  function handlePointerDown(event) {
    if (!visualIsActive() || !hasImage()) return;
    const spaceHeld = typeof dom.isSpaceHeld === "function" && dom.isSpaceHeld();
    if (state.boxEditor.mode !== "idle" && !spaceHeld && event.button !== 1) {
      if (dom.onBoxPointerDown?.(event)) return;
    }
    pan = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startTx: view.tx,
      startTy: view.ty,
    };
    dom.wrap.classList.add("panning");
    dom.wrap.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event) {
    if (!pan) return;
    apply({
      ...view,
      tx: pan.startTx + (event.clientX - pan.startX),
      ty: pan.startTy + (event.clientY - pan.startY),
    });
  }

  function zoomOne() {
    if (hasImage()) zoomCenter(1 / view.scale);
  }

  return {
    apply,
    fit,
    focusRect: (rect, options) => apply(focusRectViewport(rect,
      { width: dom.wrap.clientWidth, height: dom.wrap.clientHeight }, options)),
    zoomCenter,
    zoomIn: () => zoomCenter(1.25),
    zoomOut: () => zoomCenter(1 / 1.25),
    zoomOne,
    cancelPan,
    handleWheel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp: cancelPan,
    handlePointerCancel: cancelPan,
    handleDoubleClick: fit,
    handleResize() {
      const newViewport = viewportSize();
      if (!viewportIsLaidOut(newViewport)) return copyView();
      const oldViewport = viewportIsLaidOut(lastViewport) ? lastViewport : newViewport;
      if (!hasImage()) return apply();
      const content = { width: dom.out.width, height: dom.out.height };
      const fitted = fitViewport(content, oldViewport);
      const next = viewsWithinPercent(view, fitted)
        ? fitViewport(content, newViewport)
        : preserveViewportCenter(view, oldViewport, newViewport);
      return next ? apply(next) : copyView();
    },
    getView: copyView,
  };
}
