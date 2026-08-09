const MIN_SCALE = 0.05;
const MAX_SCALE = 40;
const FIT_MARGIN = 0.92;

function finitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

export function clampScale(scale) {
  return Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE);
}

export function zoomAt(view, factor, cx, cy) {
  const scale = clampScale(view.scale * factor);
  const ratio = scale / view.scale;
  return {
    scale,
    tx: cx - (cx - view.tx) * ratio,
    ty: cy - (cy - view.ty) * ratio,
  };
}

export function fitViewport(content, container) {
  if (
    !finitePositive(content?.width)
    || !finitePositive(content?.height)
    || !finitePositive(container?.width)
    || !finitePositive(container?.height)
  ) return null;

  const scale = Math.min(
    container.width / content.width,
    container.height / content.height,
  ) * FIT_MARGIN;
  return {
    scale,
    tx: (container.width - content.width * scale) / 2,
    ty: (container.height - content.height * scale) / 2,
  };
}
