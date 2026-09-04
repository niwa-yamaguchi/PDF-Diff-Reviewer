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

export const VISUAL_BOX_STYLE = CHANGE_BOX_STYLE;
