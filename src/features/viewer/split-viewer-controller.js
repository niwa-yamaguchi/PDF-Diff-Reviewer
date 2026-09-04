import { fitViewport, zoomAt } from "./viewport.js";

export function createSplitViewerController({ state, dom }) {
  let view = { ...state.visual.splitView };
  let pan = null;
  const canvases = [dom.oldCanvas, dom.newCanvas];
  const wraps = [dom.oldWrap, dom.newWrap];
  const active = () => state.ui.topMode === "visual"
    && state.visual.mode === "split"
    && state.visual.rendered;
  const copy = () => ({ ...view });

  function apply(next = view) {
    view = { ...next };
    state.visual.splitView = copy();
    const transform = `translate(${view.tx}px,${view.ty}px) scale(${view.scale})`;
    for (const canvas of canvases) canvas.style.transform = transform;
    dom.zoomLabel.textContent = `${Math.round(view.scale * 100)}%`;
    return copy();
  }

  function fit() {
    const width = Math.min(...wraps.map(wrap => wrap.clientWidth));
    const height = Math.min(...wraps.map(wrap => wrap.clientHeight));
    const fitted = fitViewport(
      { width: dom.oldCanvas.width, height: dom.oldCanvas.height },
      { width, height },
    );
    return fitted ? apply(fitted) : copy();
  }

  function zoomAtPoint(factor, wrap, event) {
    if (!active()) return copy();
    const rect = wrap.getBoundingClientRect();
    return apply(zoomAt(view, factor, event.clientX - rect.left, event.clientY - rect.top));
  }

  function handleWheel(wrap, event) {
    if (!wraps.includes(wrap) || !active()) return;
    event.preventDefault();
    zoomAtPoint(event.deltaY < 0 ? 1.12 : 1 / 1.12, wrap, event);
  }

  function handlePointerDown(wrap, event) {
    if (!wraps.includes(wrap) || !active() || pan) return;
    pan = {
      owner: wrap, pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY,
      startTx: view.tx, startTy: view.ty,
    };
    wrap.classList.add("panning");
    wrap.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(_wrap, event) {
    if (!pan || event.pointerId !== pan.pointerId) return;
    if (!active()) {
      cancelPan(event);
      return;
    }
    apply({
      ...view,
      tx: pan.startTx + event.clientX - pan.startX,
      ty: pan.startTy + event.clientY - pan.startY,
    });
  }

  function cancelPan(event) {
    if (!pan || (event?.pointerId != null && event.pointerId !== pan.pointerId)) return;
    const { owner, pointerId } = pan;
    pan = null;
    owner.classList.remove("panning");
    try { owner.releasePointerCapture(pointerId); } catch (_) { /* capture may be gone */ }
  }

  const zoomCenter = factor => {
    const wrap = dom.oldWrap;
    return zoomAtPoint(factor, wrap, {
      clientX: wrap.getBoundingClientRect().left + wrap.clientWidth / 2,
      clientY: wrap.getBoundingClientRect().top + wrap.clientHeight / 2,
    });
  };

  return {
    apply, fit, getView: copy,
    zoomIn: () => zoomCenter(1.25),
    zoomOut: () => zoomCenter(1 / 1.25),
    zoomOne: () => zoomCenter(1 / view.scale),
    cancelPan,
    handleWheel, handlePointerDown, handlePointerMove,
    handlePointerUp: (_wrap, event) => cancelPan(event),
    handlePointerCancel: (_wrap, event) => cancelPan(event),
    handleResize: () => { if (active()) apply(); },
  };
}
