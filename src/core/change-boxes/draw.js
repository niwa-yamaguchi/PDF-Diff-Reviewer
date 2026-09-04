const BOX_BASE_DPI = 150;

export const CHANGE_BOX_STYLE = Object.freeze({
  color: "#ff9500",
  fill: "rgba(255,149,0,0.18)",
});

export function drawChangeBoxes(context, boxes = [], dpi = BOX_BASE_DPI) {
  if (!boxes?.length) return;
  const lineWidth = Math.max(2, Math.round(3 * dpi / BOX_BASE_DPI));
  context.save();
  context.fillStyle = CHANGE_BOX_STYLE.fill;
  context.strokeStyle = CHANGE_BOX_STYLE.color;
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
}
