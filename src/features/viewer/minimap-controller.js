import { fitViewport } from "./viewport.js";
import {
  centerViewOnPoint,
  containTransform,
  minimapPointToContent,
  visibleContentRect,
} from "./minimap-geometry.js";

const MINI_WIDTH = 180;
const MINI_HEIGHT = 140;
const BOUNDS = Object.freeze({ width: MINI_WIDTH, height: MINI_HEIGHT });

export function createMinimapController({
  state,
  dom,
  colors,
  createCanvas,
  getView,
  applyView,
}) {
  const reduced = createCanvas(MINI_WIDTH, MINI_HEIGHT);
  const baseContext = reduced.getContext("2d");
  let hasSource = false;
  let dragging = false;

  function contentSize() {
    return { width: dom.source.width, height: dom.source.height };
  }

  function viewportSize() {
    return { width: dom.wrap.clientWidth, height: dom.wrap.clientHeight };
  }

  function isVisible(view, content, viewport) {
    const fit = fitViewport(content, viewport);
    return Boolean(fit && view.scale > fit.scale * 1.01 && state.visual.rendered);
  }

  function hide() {
    dom.root.hidden = true;
  }

  function eventPoint(event) {
    if (Number.isFinite(event.offsetX) && Number.isFinite(event.offsetY)) {
      return { x: event.offsetX, y: event.offsetY };
    }
    const rect = dom.canvas.getBoundingClientRect();
    const width = rect.width || MINI_WIDTH;
    const height = rect.height || MINI_HEIGHT;
    return {
      x: (event.clientX - rect.left) * (dom.canvas.width / width),
      y: (event.clientY - rect.top) * (dom.canvas.height / height),
    };
  }

  function stopEvent(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function captureTarget(event) {
    return event.currentTarget || dom.canvas;
  }

  function releaseCapture(event) {
    dragging = false;
    try { captureTarget(event).releasePointerCapture?.(event.pointerId); } catch (_) { /* already released */ }
  }

  function applyFromEvent(event) {
    const view = getView();
    const content = contentSize();
    const viewport = viewportSize();
    const mini = containTransform(content, BOUNDS);
    if (!mini) return;
    applyView(centerViewOnPoint(view, viewport, content, minimapPointToContent(eventPoint(event), mini, content)));
  }

  function selectedBox() {
    const id = state.review?.selectedId;
    if (!id) return null;
    return (state.boxEditor?.currentBoxes || []).find(box => box.id === id) || null;
  }

  function paintOverlays(view, content, viewport, mini) {
    const display = dom.canvas.getContext("2d");
    display.clearRect(0, 0, MINI_WIDTH, MINI_HEIGHT);
    display.drawImage(reduced, 0, 0);
    const visible = visibleContentRect(view, viewport, content);
    display.strokeStyle = colors.amber;
    display.lineWidth = 1;
    display.strokeRect(
      mini.x + visible.x * mini.scale,
      mini.y + visible.y * mini.scale,
      visible.w * mini.scale,
      visible.h * mini.scale,
    );
    const box = selectedBox();
    if (!box) return;
    display.strokeStyle = colors[box.kind] || colors.changed;
    display.lineWidth = 1;
    display.strokeRect(
      mini.x + box.x * mini.scale,
      mini.y + box.y * mini.scale,
      box.w * mini.scale,
      box.h * mini.scale,
    );
  }

  function refreshSource() {
    try {
      const view = getView();
      const content = contentSize();
      const viewport = viewportSize();
      const visible = isVisible(view, content, viewport);
      const mini = containTransform(content, BOUNDS);
      if (!state.visual.rendered || !mini || !baseContext) {
        hasSource = false;
        hide();
        return;
      }
      baseContext.clearRect(0, 0, MINI_WIDTH, MINI_HEIGHT);
      baseContext.fillStyle = "#fff";
      baseContext.fillRect(0, 0, MINI_WIDTH, MINI_HEIGHT);
      baseContext.drawImage(dom.source, mini.x, mini.y, mini.width, mini.height);
      hasSource = true;
      if (!visible) {
        hide();
        return;
      }
      dom.root.hidden = false;
      paintOverlays(view, content, viewport, mini);
    } catch (_) {
      hide();
    }
  }

  function render() {
    try {
      const view = getView();
      const content = contentSize();
      const viewport = viewportSize();
      const visible = isVisible(view, content, viewport);
      const mini = containTransform(content, BOUNDS);
      if (!visible || !mini || !hasSource) {
        hide();
        return;
      }
      dom.root.hidden = false;
      paintOverlays(view, content, viewport, mini);
    } catch (_) {
      hide();
    }
  }

  function pointerDown(event) {
    stopEvent(event);
    if (dom.root.hidden) return;
    dragging = true;
    try { captureTarget(event).setPointerCapture?.(event.pointerId); } catch (_) { /* unsupported */ }
    applyFromEvent(event);
  }

  function pointerMove(event) {
    stopEvent(event);
    if (!dragging) return;
    applyFromEvent(event);
  }

  function pointerUp(event) {
    stopEvent(event);
    releaseCapture(event);
  }

  function pointerCancel(event) {
    stopEvent(event);
    releaseCapture(event);
  }

  return { refreshSource, render, pointerDown, pointerMove, pointerUp, pointerCancel };
}
