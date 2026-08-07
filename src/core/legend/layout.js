export const LG_FONT_PT = 8;
export const LG_SWATCH_PT = 8;
export const LG_GAP_ITEM_PT = 10;
export const LG_GAP_SW_PT = 4;
export const LG_PAD_PT = 6;
export const LG_BORDER_PT = 1;

export function legendLayout(items, unit, options, measureWidth) {
  const chrome = !(options && options.chrome === false);
  const fontPx = LG_FONT_PT * unit;
  const swPx = LG_SWATCH_PT * unit;
  const gapItem = LG_GAP_ITEM_PT * unit;
  const gapSw = LG_GAP_SW_PT * unit;
  const pad = chrome ? LG_PAD_PT * unit : 0;
  let cx = pad;
  const parts = [];
  items.forEach((item, index) => {
    if (index) cx += gapItem;
    const textW = measureWidth(item.label, fontPx);
    parts.push({ swX: cx, textX: cx + swPx + gapSw });
    cx += swPx + gapSw + textW;
  });
  return { w: cx + pad, h: swPx + pad * 2, fontPx, swPx, pad, chrome, parts };
}
