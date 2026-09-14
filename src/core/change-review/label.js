import { sortReviewItems } from "./model.js";

// Map of review item id -> { number, comment }; numbers follow the change list order.
export function reviewLabels(itemsByPage, entriesById) {
  const items = sortReviewItems([...(itemsByPage?.values() || [])].flat());
  return new Map(items.map((item, index) => [item.id, {
    number: index + 1,
    comment: (entriesById?.get(item.id)?.comment || "").replace(/\s+/g, " ").trim(),
  }]));
}

// Draws "number comment" on a filled tag just above (x, y), or just inside when there is no room above.
export function drawChangeLabel(context, { number, comment }, { x, y, fontPx, maxWidth, color }) {
  const pad = Math.max(2, Math.round(fontPx * 0.3));
  const height = fontPx + pad * 2;
  const limit = Math.max(fontPx, maxWidth - pad * 2);
  context.save();
  context.font = `bold ${fontPx}px sans-serif`;
  let chars = [...(comment ? `${number} ${comment}` : String(number))];
  if (context.measureText(chars.join("")).width > limit) {
    while (chars.length > 1 && context.measureText(`${chars.join("")}…`).width > limit) chars.pop();
    chars.push("…");
  }
  const text = chars.join("");
  const top = y >= height ? y - height : y;
  context.fillStyle = color;
  context.fillRect(x, top, context.measureText(text).width + pad * 2, height);
  context.fillStyle = "#1a1206";
  context.textBaseline = "middle";
  context.textAlign = "left";
  context.fillText(text, x + pad, top + height / 2);
  context.restore();
}
