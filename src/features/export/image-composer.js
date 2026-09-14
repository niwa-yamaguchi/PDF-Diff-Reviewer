import { legendLayout, LG_BORDER_PT } from "../../core/legend/layout.js";
import { drawChangeLabel } from "../../core/change-review/label.js";

const BOX_COLOR = "#ff9500";
const BOX_FILL = "rgba(255,149,0,0.18)";
const BOX_BASE_DPI = 150;
const LEGEND_MARGIN_PT = 10;
const TEXT_LEGEND_UNIT = 1.6;

function createLike(reference, width, height) {
  if (!reference?.cloneNode) throw new Error("出力用Canvasを作成できませんでした");
  const canvas = reference.cloneNode(false);
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function whiteCanvas(reference, width, height) {
  const canvas = createLike(reference, width, height);
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

function drawBoxLabels(context, boxes, dpi, labels) {
  const fontPx = Math.max(12, Math.round(9 * dpi / 72));
  for (const box of boxes) {
    const label = labels?.get(box.id);
    if (!label) continue;
    drawChangeLabel(context, label, {
      x: box.x, y: box.y, fontPx, maxWidth: Math.max(box.w, fontPx * 20), color: BOX_COLOR,
    });
  }
}

function drawBoxes(context, boxes, dpi, labels) {
  if (!boxes?.length) return;
  const lineWidth = Math.max(2, Math.round(3 * dpi / BOX_BASE_DPI));
  context.save();
  context.fillStyle = BOX_FILL;
  context.strokeStyle = BOX_COLOR;
  context.lineWidth = lineWidth;
  for (const box of boxes) {
    context.fillRect(box.x, box.y, box.w, box.h);
    const half = lineWidth / 2;
    context.strokeRect(
      box.x + half,
      box.y + half,
      Math.max(0, box.w - lineWidth),
      Math.max(0, box.h - lineWidth),
    );
  }
  context.restore();
  drawBoxLabels(context, boxes, dpi, labels);
}

export function composeVisualExport({ source, boxes = [], labels, legend = [], dpi, destination }) {
  if (!source) throw new Error("出力元Canvasがありません");
  const canvas = destination || createLike(source, 0, 0);
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext("2d");
  context.drawImage(source, 0, 0);
  drawBoxes(context, boxes, dpi, labels);
  if (legend.length) {
    const unit = dpi / 72;
    const margin = LEGEND_MARGIN_PT * unit;
    drawLegend(context, legend, margin, margin, unit);
  }
  return canvas;
}

export function togglePairLayout(width, height) {
  return width > height ? "vertical" : "horizontal";
}

function toggleLabelMetrics(dpi) {
  const unit = dpi / 72;
  return {
    unit,
    fontPx: Math.max(12, Math.round(8 * unit)),
    labelHeight: Math.max(24, Math.round(14 * unit)),
    gap: Math.max(12, Math.round(8 * unit)),
    pad: Math.max(4, Math.round(4 * unit)),
  };
}

function drawPane(context, source, x, y, cellW, cellH, boxes, dpi, labels) {
  const ox = x + (cellW - source.width) / 2;
  const oy = y + (cellH - source.height) / 2;
  context.drawImage(source, ox, oy);
  if (!boxes?.length) return;
  drawBoxes(context, boxes.map(box => ({
    id: box.id,
    x: box.x + ox,
    y: box.y + oy,
    w: box.w,
    h: box.h,
  })), dpi, labels);
}

function drawToggleHeader(context, {
  label, color, pageText, legend, x, y, width, metrics,
}) {
  const { fontPx, labelHeight, pad, unit } = metrics;
  context.save();
  context.font = `bold ${fontPx}px sans-serif`;
  context.textBaseline = "middle";
  context.textAlign = "left";
  context.fillStyle = color;
  context.fillText(label, x + pad, y + labelHeight / 2);
  if (pageText) {
    context.fillStyle = "#333";
    context.textAlign = "right";
    context.fillText(pageText, x + width - pad, y + labelHeight / 2);
  }
  if (legend?.length) {
    const options = { chrome: false };
    const measured = measureLegend(context, legend, unit, options);
    const legendX = x + pad + context.measureText(label).width + pad * 4;
    const legendLimit = pageText
      ? x + width - pad - context.measureText(pageText).width - pad * 4
      : x + width - pad;
    if (legendX + measured.w <= legendLimit) {
      drawLegend(
        context,
        legend,
        legendX,
        y + labelHeight / 2 - measured.h / 2,
        unit,
        options,
        measured,
      );
    }
  }
  context.restore();
}

export function composeToggleExport({
  oldCanvas,
  newCanvas,
  boxes = [],
  labels,
  legend = [],
  dpi,
  colors,
  pageIndex,
  total,
  destination,
}) {
  const reference = oldCanvas || newCanvas;
  if (!reference) throw new Error("出力元Canvasがありません");
  const oldSource = oldCanvas || whiteCanvas(reference, newCanvas.width, newCanvas.height);
  const newSource = newCanvas || whiteCanvas(reference, oldCanvas.width, oldCanvas.height);
  const cellW = Math.max(oldSource.width, newSource.width);
  const cellH = Math.max(oldSource.height, newSource.height);
  const layout = togglePairLayout(cellW, cellH);
  const metrics = toggleLabelMetrics(dpi);
  const pageText = `p ${pageIndex + 1} / ${total}`;
  const width = layout === "horizontal" ? cellW * 2 + metrics.gap : cellW;
  const height = layout === "horizontal"
    ? metrics.labelHeight + cellH
    : metrics.labelHeight * 2 + cellH * 2 + metrics.gap;
  const canvas = destination || createLike(reference, 0, 0);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);

  if (layout === "horizontal") {
    drawToggleHeader(context, {
      label: "OLD", color: colors.removed, legend,
      x: 0, y: 0, width: cellW, metrics,
    });
    drawToggleHeader(context, {
      label: "NEW", color: colors.added, pageText,
      x: cellW + metrics.gap, y: 0, width: cellW, metrics,
    });
    drawPane(context, oldSource, 0, metrics.labelHeight, cellW, cellH, boxes, dpi, labels);
    drawPane(context, newSource, cellW + metrics.gap, metrics.labelHeight, cellW, cellH, boxes, dpi, labels);
  } else {
    drawToggleHeader(context, {
      label: "OLD", color: colors.removed, pageText, legend,
      x: 0, y: 0, width, metrics,
    });
    drawPane(context, oldSource, 0, metrics.labelHeight, cellW, cellH, boxes, dpi, labels);
    const newY = metrics.labelHeight + cellH + metrics.gap;
    drawToggleHeader(context, {
      label: "NEW", color: colors.added,
      x: 0, y: newY, width, metrics,
    });
    drawPane(context, newSource, 0, newY + metrics.labelHeight, cellW, cellH, boxes, dpi, labels);
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
  const cellW = Math.max(oldSource.width, newSource.width);
  const horizontal = togglePairLayout(cellW, Math.max(oldSource.height, newSource.height)) === "horizontal";
  const width = horizontal ? cellW * 2 + gap : cellW;
  const height = horizontal
    ? labelHeight + Math.max(oldSource.height, newSource.height)
    : labelHeight + oldSource.height + gap + labelHeight + newSource.height;
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
  const legendLimit = horizontal
    ? cellW - 4
    : width - 4 - context.measureText(pageText).width - 16;
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

  context.drawImage(oldSource, (cellW - oldSource.width) / 2, labelHeight);
  const newX = horizontal ? cellW + gap : 0;
  const newLabelY = horizontal ? 0 : labelHeight + oldSource.height + gap;
  context.fillStyle = colors.added;
  context.textAlign = "left";
  context.fillText("NEW", newX + 4, newLabelY + labelHeight / 2);
  context.drawImage(newSource, newX + (cellW - newSource.width) / 2, newLabelY + labelHeight);
  return canvas;
}

export const VISUAL_BOX_STYLE = Object.freeze({ color: BOX_COLOR, fill: BOX_FILL });
