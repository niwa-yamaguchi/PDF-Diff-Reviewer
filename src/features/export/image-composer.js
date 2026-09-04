import { CHANGE_BOX_STYLE, drawChangeBoxes } from "../../core/change-boxes/draw.js";
import { legendLayout, LG_BORDER_PT } from "../../core/legend/layout.js";
const LEGEND_MARGIN_PT = 10;
const TEXT_LEGEND_UNIT = 1.6;

function createLike(reference, width, height) {
  if (!reference?.cloneNode) throw new Error("出力用Canvasを作成できませんでした");
  const canvas = reference.cloneNode(false);
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function whiteCanvas(reference, width, height, destination) {
  const canvas = destination || createLike(reference, width, height);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  return canvas;
}

const contextMeasurer = context => (label, fontPx) => {
  context.save();
  context.font = `bold ${fontPx}px sans-serif`;
  const width = context.measureText(label).width;
  context.restore();
  return width;
};

function measureLegend(context, items, unit, options) {
  return legendLayout(items, unit, options, contextMeasurer(context));
}

function drawLegend(context, items, x, y, unit, options, measured) {
  if (!items?.length) return null;
  const layout = measured || measureLegend(context, items, unit, options);
  const borderWidth = Math.max(1, LG_BORDER_PT * unit);
  context.save();
  if (layout.chrome) {
    context.fillStyle = "rgba(255,255,255,0.92)";
    context.fillRect(x, y, layout.w, layout.h);
    context.strokeStyle = "#999";
    context.lineWidth = borderWidth;
    context.strokeRect(
      x + borderWidth / 2,
      y + borderWidth / 2,
      layout.w - borderWidth,
      layout.h - borderWidth,
    );
  }
  context.font = `bold ${layout.fontPx}px sans-serif`;
  context.textBaseline = "middle";
  context.textAlign = "left";
  const top = y + layout.pad;
  layout.parts.forEach((part, index) => {
    const item = items[index];
    if (item.color) {
      context.fillStyle = item.color;
      context.fillRect(x + part.swX, top, layout.swPx, layout.swPx);
    } else {
      context.fillStyle = item.fill;
      context.fillRect(x + part.swX, top, layout.swPx, layout.swPx);
      context.strokeStyle = item.stroke;
      context.lineWidth = borderWidth;
      context.strokeRect(
        x + part.swX + borderWidth / 2,
        top + borderWidth / 2,
        layout.swPx - borderWidth,
        layout.swPx - borderWidth,
      );
    }
    context.fillStyle = "#222";
    context.fillText(item.label, x + part.textX, top + layout.swPx / 2);
  });
  context.restore();
  return layout;
}

export function composeVisualExport({ source, boxes = [], legend = [], dpi, destination }) {
  if (!source) throw new Error("出力元Canvasがありません");
  const canvas = destination || createLike(source, 0, 0);
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext("2d");
  context.drawImage(source, 0, 0);
  drawChangeBoxes(context, boxes, dpi);
  if (legend.length) {
    const unit = dpi / 72;
    const margin = LEGEND_MARGIN_PT * unit;
    drawLegend(context, legend, margin, margin, unit);
  }
  return canvas;
}

export function composeTextExport({ oldCanvas, newCanvas, pageIndex, total, colors }) {
  const reference = oldCanvas || newCanvas;
  if (!reference) throw new Error("テキスト出力元Canvasがありません");
  const oldSource = oldCanvas || whiteCanvas(reference, newCanvas.width, newCanvas.height);
  const newSource = newCanvas || whiteCanvas(reference, oldCanvas.width, oldCanvas.height);
  const labelHeight = 28;
  const gap = 24;
  const width = Math.max(oldSource.width, newSource.width);
  const height = labelHeight + oldSource.height + gap + labelHeight + newSource.height;
  const canvas = whiteCanvas(reference, width, height);
  const context = canvas.getContext("2d");

  context.font = "bold 16px sans-serif";
  context.textBaseline = "middle";
  context.fillStyle = colors.removed;
  context.textAlign = "left";
  context.fillText("OLD", 4, labelHeight / 2);
  context.fillStyle = "#333";
  context.textAlign = "right";
  const pageText = `p ${pageIndex + 1} / ${total}`;
  context.fillText(pageText, width - 4, labelHeight / 2);

  const legendItems = [
    { color: colors.removed, label: "削除" },
    { color: colors.added, label: "追加" },
    { color: colors.changed, label: "変更" },
  ];
  const options = { chrome: false };
  const measured = measureLegend(context, legendItems, TEXT_LEGEND_UNIT, options);
  const legendX = 4 + context.measureText("OLD").width + 16;
  const legendLimit = width - 4 - context.measureText(pageText).width - 16;
  if (legendX + measured.w <= legendLimit) {
    drawLegend(
      context,
      legendItems,
      legendX,
      labelHeight / 2 - measured.h / 2,
      TEXT_LEGEND_UNIT,
      options,
      measured,
    );
  }

  context.drawImage(oldSource, (width - oldSource.width) / 2, labelHeight);
  const newLabelY = labelHeight + oldSource.height + gap;
  context.fillStyle = colors.added;
  context.textAlign = "left";
  context.fillText("NEW", 4, newLabelY + labelHeight / 2);
  context.drawImage(newSource, (width - newSource.width) / 2, newLabelY + labelHeight);
  return canvas;
}

function boxesOverlap(a, b) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function splitLabelLayout(context, {
  preferredFont,
  labelHeight,
  paneWidth,
  gap,
  canvasWidth,
  pad,
  pageText,
}) {
  const measure = (fontPx, text) => {
    context.font = `bold ${fontPx}px sans-serif`;
    return context.measureText(text).width;
  };
  const tryLayout = (fontPx, twoLine) => {
    const oldW = measure(fontPx, "OLD");
    const newW = measure(fontPx, "NEW");
    const pageW = measure(fontPx, pageText);
    const oldX = pad;
    const newX = paneWidth + gap + pad;
    const pageX = canvasWidth - pad;
    const oldY = twoLine ? fontPx / 2 : labelHeight / 2;
    const newY = oldY;
    const pageY = twoLine ? labelHeight - fontPx / 2 : labelHeight / 2;
    const boxes = [
      { left: oldX, right: oldX + oldW, top: oldY - fontPx / 2, bottom: oldY + fontPx / 2 },
      { left: newX, right: newX + newW, top: newY - fontPx / 2, bottom: newY + fontPx / 2 },
      { left: pageX - pageW, right: pageX, top: pageY - fontPx / 2, bottom: pageY + fontPx / 2 },
    ];
    if (boxes.some(box => box.top < 0 || box.bottom > labelHeight)) return null;
    if (boxes.some((box, index) => boxes.slice(index + 1).some(other => boxesOverlap(box, other)))) {
      return null;
    }
    return { fontPx, oldX, newX, pageX, oldY, newY, pageY };
  };

  const single = tryLayout(preferredFont, false);
  if (single) return single;
  const twoLineFont = Math.min(preferredFont, Math.max(8, Math.floor(labelHeight / 2)));
  for (let fontPx = twoLineFont; fontPx >= 8; fontPx -= 1) {
    const laid = tryLayout(fontPx, true);
    if (laid) return laid;
  }
  return tryLayout(8, true) || {
    fontPx: 8,
    oldX: pad,
    newX: paneWidth + gap + pad,
    pageX: canvasWidth - pad,
    oldY: 4,
    newY: 4,
    pageY: Math.max(4, labelHeight - 4),
  };
}

export function composeVisualSplitExport({
  oldCanvas,
  newCanvas,
  pageIndex,
  total,
  dpi,
  destination,
}) {
  const reference = oldCanvas || newCanvas;
  if (!reference) throw new Error("左右表示の出力元Canvasがありません");
  const width = Math.max(oldCanvas?.width || 0, newCanvas?.width || 0, 1);
  const height = Math.max(oldCanvas?.height || 0, newCanvas?.height || 0, 1);
  const labelHeight = Math.max(1, Math.round(28 * dpi / 72));
  const gap = Math.max(1, Math.round(dpi / 72));
  const safeDestination = destination
    && destination !== oldCanvas
    && destination !== newCanvas
    ? destination
    : undefined;
  const canvas = whiteCanvas(reference, width * 2 + gap, labelHeight + height, safeDestination);
  const context = canvas.getContext("2d");
  const pageText = `p ${pageIndex + 1} / ${total}`;
  const layout = splitLabelLayout(context, {
    preferredFont: Math.max(12, Math.round(16 * dpi / 72)),
    labelHeight,
    paneWidth: width,
    gap,
    canvasWidth: canvas.width,
    pad: 4,
    pageText,
  });
  context.font = `bold ${layout.fontPx}px sans-serif`;
  context.textBaseline = "middle";
  context.textAlign = "left";
  context.fillStyle = "#ff5b57";
  context.fillText("OLD", layout.oldX, layout.oldY);
  context.fillStyle = "#4d8dff";
  context.fillText("NEW", layout.newX, layout.newY);
  context.fillStyle = "#333";
  context.textAlign = "right";
  context.fillText(pageText, layout.pageX, layout.pageY);
  if (oldCanvas) context.drawImage(oldCanvas, 0, labelHeight);
  if (newCanvas) context.drawImage(newCanvas, width + gap, labelHeight);
  return canvas;
}

export const VISUAL_BOX_STYLE = CHANGE_BOX_STYLE;
