const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

function finitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

function clampAxis(offset, scaledSize, viewportSize) {
  if (scaledSize <= viewportSize) return (viewportSize - scaledSize) / 2;
  return clamp(offset, viewportSize - scaledSize, 0);
}

export function containTransform(content, bounds) {
  if (
    !finitePositive(content?.width)
    || !finitePositive(content?.height)
    || !finitePositive(bounds?.width)
    || !finitePositive(bounds?.height)
  ) return null;
  const scale = Math.min(bounds.width / content.width, bounds.height / content.height);
  const width = content.width * scale;
  const height = content.height * scale;
  return {
    scale,
    x: (bounds.width - width) / 2,
    y: (bounds.height - height) / 2,
    width,
    height,
  };
}

export function visibleContentRect(view, viewport, content) {
  const x0 = (0 - view.tx) / view.scale;
  const y0 = (0 - view.ty) / view.scale;
  const x1 = (viewport.width - view.tx) / view.scale;
  const y1 = (viewport.height - view.ty) / view.scale;
  const left = clamp(Math.min(x0, x1), 0, content.width);
  const top = clamp(Math.min(y0, y1), 0, content.height);
  const right = clamp(Math.max(x0, x1), 0, content.width);
  const bottom = clamp(Math.max(y0, y1), 0, content.height);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function minimapPointToContent(point, transform, content) {
  return {
    x: clamp((point.x - transform.x) / transform.scale, 0, content.width),
    y: clamp((point.y - transform.y) / transform.scale, 0, content.height),
  };
}

export function centerViewOnPoint(view, viewport, content, point) {
  const tx = viewport.width / 2 - point.x * view.scale;
  const ty = viewport.height / 2 - point.y * view.scale;
  return {
    scale: view.scale,
    tx: clampAxis(tx, content.width * view.scale, viewport.width),
    ty: clampAxis(ty, content.height * view.scale, viewport.height),
  };
}
