import { fitViewport, zoomAt } from "./viewport.js";

export function createViewerController({ state, dom, window, onTransform = () => {} }) {
  let view = { scale: 1, tx: 0, ty: 0 };
  let pan = null;

  const hasImage = () => (
    typeof dom.hasImage === "function"
      ? dom.hasImage()
      : dom.out.style.display !== "none"
  );
  const visualIsActive = () => state.ui.topMode === "visual";
  const copyView = () => ({ ...view });

  function apply(nextView = view) {
    view = { ...nextView };
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

  dom.wrap.addEventListener("wheel", event => {
    if (!visualIsActive() || !hasImage()) return;
    event.preventDefault();
    const rect = dom.wrap.getBoundingClientRect();
    zoomAtPoint(
      event.deltaY < 0 ? 1.12 : 1 / 1.12,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
  }, { passive: false });

  dom.wrap.addEventListener("pointerdown", event => {
    if (!visualIsActive() || !hasImage()) return;
    const spaceHeld = typeof dom.isSpaceHeld === "function" && dom.isSpaceHeld();
    if (state.boxEditor.editMode && !spaceHeld && event.button !== 1) {
      dom.onBoxPointerDown?.(event);
      return;
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
  });

  dom.wrap.addEventListener("pointermove", event => {
    if (!pan) return;
    apply({
      ...view,
      tx: pan.startTx + (event.clientX - pan.startX),
      ty: pan.startTy + (event.clientY - pan.startY),
    });
  });
  dom.wrap.addEventListener("pointerup", cancelPan);
  dom.wrap.addEventListener("pointercancel", cancelPan);
  dom.wrap.addEventListener("dblclick", fit);
  window.addEventListener("resize", () => apply());

  dom.zoomIn?.addEventListener("click", () => zoomCenter(1.25));
  dom.zoomOut?.addEventListener("click", () => zoomCenter(1 / 1.25));
  dom.zoomFit?.addEventListener("click", fit);
  dom.zoomOne?.addEventListener("click", () => {
    if (hasImage()) zoomCenter(1 / view.scale);
  });

  return {
    apply,
    fit,
    zoomCenter,
    cancelPan,
    getView: copyView,
  };
}
