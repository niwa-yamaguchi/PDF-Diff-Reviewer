export function normalizeRect(x0, y0, x1, y1) {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

export function clampBox(box, width, height) {
  const x0 = Math.max(0, box.x), y0 = Math.max(0, box.y);
  const x1 = Math.min(width, box.x + box.w), y1 = Math.min(height, box.y + box.h);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

export function clampBoxes(boxes, width, height) {
  return boxes.map(box => {
    const x0 = Math.max(0, box.x), y0 = Math.max(0, box.y);
    const x1 = Math.min(width, box.x + box.w), y1 = Math.min(height, box.y + box.h);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }).filter(box => box.w > 0 && box.h > 0);
}
