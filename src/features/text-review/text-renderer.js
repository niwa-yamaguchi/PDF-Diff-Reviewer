const PLACEHOLDER_SIZE = 10;
const MIN_SCALE = 0.05;
const MAX_SCALE = 40;

function clampScale(scale) {
  return Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE);
}

function fitViewport(content, container) {
  if (
    !Number.isFinite(content?.width) || content.width <= 0
    || !Number.isFinite(content?.height) || content.height <= 0
    || !Number.isFinite(container?.width) || container.width <= 0
    || !Number.isFinite(container?.height) || container.height <= 0
  ) return null;
  const scale = Math.min(
    container.width / content.width,
    container.height / content.height,
  ) * 0.92;
  return {
    scale,
    tx: (container.width - content.width * scale) / 2,
    ty: (container.height - content.height * scale) / 2,
  };
}

function zoomViewportAt(view, factor, cx, cy) {
  const scale = clampScale(view.scale * factor);
  const ratio = scale / view.scale;
  return {
    scale,
    tx: cx - (cx - view.tx) * ratio,
    ty: cy - (cy - view.ty) * ratio,
  };
}

function fillWhite(canvas) {
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  return context;
}

function sideDocument(snapshot, side) {
  return snapshot.documents?.[side] ?? null;
}

function sideHighlights(snapshot, side, pageIndex) {
  return snapshot.highlights?.[side]?.get(pageIndex) ?? null;
}

export function drawTokenHighlight({ context, viewport, token, colorKey, transform, colors }) {
  const tx = transform(viewport.transform, token.transform);
  const advanceLength = Math.hypot(tx[0], tx[1]) || 1;
  const ux = tx[0] / advanceLength;
  const uy = tx[1] / advanceLength;
  const width = token.w * viewport.scale;
  const descentFraction = 0.2;
  const p0x = tx[4] - tx[2] * descentFraction;
  const p0y = tx[5] - tx[3] * descentFraction;
  const vx = tx[2] * (1 + descentFraction);
  const vy = tx[3] * (1 + descentFraction);
  const p1x = p0x + ux * width;
  const p1y = p0y + uy * width;
  const p2x = p0x + vx;
  const p2y = p0y + vy;
  const p3x = p1x + vx;
  const p3y = p1y + vy;
  const xs = [p0x, p1x, p2x, p3x];
  const ys = [p0y, p1y, p2y, p3y];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const color = colors[colorKey] || "#fff";

  context.save();
  context.globalAlpha = 0.28;
  context.fillStyle = color;
  context.fillRect(minX, minY, maxX - minX, maxY - minY);
  context.globalAlpha = 0.9;
  context.strokeStyle = color;
  context.lineWidth = 1;
  context.strokeRect(
    minX + 0.5,
    minY + 0.5,
    Math.max(maxX - minX - 1, 0),
    Math.max(maxY - minY - 1, 0),
  );
  context.restore();
}

export async function renderTextPage({
  side,
  pageIndex,
  snapshot,
  canvas,
  transform,
  colors,
}) {
  const doc = sideDocument(snapshot, side);
  if (!doc || pageIndex < 0 || pageIndex >= doc.numPages) {
    canvas.width = PLACEHOLDER_SIZE;
    canvas.height = PLACEHOLDER_SIZE;
    fillWhite(canvas);
    return canvas;
  }

  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: snapshot.scale });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = fillWhite(canvas);
  await page.render({ canvasContext: context, viewport }).promise;

  const entries = sideHighlights(snapshot, side, pageIndex);
  if (entries) {
    for (const { token, color } of entries) {
      drawTokenHighlight({ context, viewport, token, colorKey: color, transform, colors });
    }
  }
  return canvas;
}

export async function renderTextPageOffscreen({
  side,
  pageIndex,
  snapshot,
  createCanvas,
  transform,
  colors,
}) {
  const doc = sideDocument(snapshot, side);
  if (!doc || pageIndex < 0 || pageIndex >= doc.numPages) return null;
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: snapshot.scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = fillWhite(canvas);
  await page.render({ canvasContext: context, viewport }).promise;
  const entries = sideHighlights(snapshot, side, pageIndex);
  if (entries) {
    for (const { token, color } of entries) {
      drawTokenHighlight({ context, viewport, token, colorKey: color, transform, colors });
    }
  }
  return canvas;
}

function worldSize(dom) {
  return {
    width: Math.max(dom.oldTextCanvas.width || 0, dom.newTextCanvas.width || 0, 1),
    height: Math.max(dom.oldTextCanvas.height || 0, dom.newTextCanvas.height || 0, 1),
  };
}

export function createTextRenderer({ state, dom, createCanvas, transform, colors }) {
  let view = { ...state.textReview.view };
  let pan = null;
  const wraps = [dom.oldWrap, dom.newWrap].filter(Boolean);
  const copyView = () => ({ ...view });
  const active = () => state.ui.topMode === "text" && Boolean(state.textReview.highlights);

  function applyView(next = view) {
    view = { ...next };
    state.textReview.view = copyView();
    const world = worldSize(dom);
    for (const canvas of [dom.oldTextCanvas, dom.newTextCanvas]) {
      const offsetX = (world.width - canvas.width) / 2;
      const offsetY = (world.height - canvas.height) / 2;
      canvas.style.transform = `translate(${view.tx + offsetX * view.scale}px,${view.ty + offsetY * view.scale}px) scale(${view.scale})`;
    }
    return copyView();
  }

  function fit() {
    const world = worldSize(dom);
    const wrap = dom.oldWrap;
    const fitted = fitViewport(
      world,
      { width: wrap?.clientWidth, height: wrap?.clientHeight },
    );
    return fitted ? applyView(fitted) : copyView();
  }

  function zoomAt(factor, cx, cy) {
    return applyView(zoomViewportAt(view, factor, cx, cy));
  }

  function zoomCenter(factor) {
    const wrap = dom.oldWrap;
    return zoomAt(factor, wrap.clientWidth / 2, wrap.clientHeight / 2);
  }

  function cancelPan(event) {
    if (!pan) return;
    if (event?.pointerId != null && event.pointerId !== pan.pointerId) return;
    const { owner, pointerId } = pan;
    pan = null;
    owner.classList.remove("panning");
    try { owner.releasePointerCapture(pointerId); } catch (_) { /* capture may already be gone */ }
  }

  function handleWheel(wrap, event) {
    if (!wraps.includes(wrap) || !active()) return;
    event.preventDefault();
    const rect = wrap.getBoundingClientRect();
    zoomAt(
      event.deltaY < 0 ? 1.12 : 1 / 1.12,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
  }

  function handlePointerDown(wrap, event) {
    if (!wraps.includes(wrap) || !active() || pan) return;
    pan = {
      owner: wrap,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startTx: view.tx,
      startTy: view.ty,
    };
    wrap.classList.add("panning");
    wrap.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(_wrap, event) {
    if (!pan || !active() || event.pointerId !== pan.pointerId) return;
    applyView({
      ...view,
      tx: pan.startTx + event.clientX - pan.startX,
      ty: pan.startTy + event.clientY - pan.startY,
    });
  }

  function zoomIfActive(factor) {
    if (active()) zoomCenter(factor);
  }

  return {
    renderPage({ side, pageIndex, snapshot }) {
      const scratch = createCanvas(PLACEHOLDER_SIZE, PLACEHOLDER_SIZE);
      return renderTextPage({ side, pageIndex, snapshot, canvas: scratch, transform, colors });
    },
    renderOffscreen({ side, pageIndex, snapshot }) {
      return renderTextPageOffscreen({ side, pageIndex, snapshot, createCanvas, transform, colors });
    },
    applyView,
    fit,
    zoomAt,
    zoomCenter,
    cancelPan,
    zoomIn: () => zoomIfActive(1.25),
    zoomOut: () => zoomIfActive(1 / 1.25),
    zoomOne: () => zoomIfActive(1 / view.scale),
    fitIfActive: () => { if (active()) fit(); },
    handleWheel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp: (_wrap, event) => cancelPan(event),
    handlePointerCancel: (_wrap, event) => cancelPan(event),
    handleResize: () => applyView(),
    getView: copyView,
  };
}
