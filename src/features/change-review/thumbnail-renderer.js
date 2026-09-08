export function cropChangeThumbnail({ source, normalizedRect, createCanvas,
  width = 120, height = 80, margin = 0.15 }) {
  const { x, y, w, h } = normalizedRect;
  const pixelX = x * source.width;
  const pixelY = y * source.height;
  const pixelWidth = w * source.width;
  const pixelHeight = h * source.height;
  const left = Math.max(0, pixelX - pixelWidth * margin);
  const top = Math.max(0, pixelY - pixelHeight * margin);
  const right = Math.min(source.width, pixelX + pixelWidth + pixelWidth * margin);
  const bottom = Math.min(source.height, pixelY + pixelHeight + pixelHeight * margin);
  const cropWidth = right - left;
  const cropHeight = bottom - top;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  if (cropWidth > 0 && cropHeight > 0) {
    const scale = Math.min(width / cropWidth, height / cropHeight);
    const drawnWidth = cropWidth * scale;
    const drawnHeight = cropHeight * scale;
    context.drawImage(source, left, top, cropWidth, cropHeight,
      (width - drawnWidth) / 2, (height - drawnHeight) / 2, drawnWidth, drawnHeight);
  }
  return canvas;
}
