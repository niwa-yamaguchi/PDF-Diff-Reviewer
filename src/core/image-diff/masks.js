export function dilateMask(mask, width, height, radius) {
  if (radius <= 0) return mask;
  const tmp = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    let cnt = 0;
    for (let x = -radius; x < width; x++) {
      const inX = x + radius;
      if (inX < width && mask[rowOff + inX]) cnt++;
      const outX = x - radius - 1;
      if (outX >= 0 && mask[rowOff + outX]) cnt--;
      if (x >= 0) tmp[rowOff + x] = cnt > 0 ? 1 : 0;
    }
  }
  const out = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    let cnt = 0;
    for (let y = -radius; y < height; y++) {
      const inY = y + radius;
      if (inY < height && tmp[inY * width + x]) cnt++;
      const outY = y - radius - 1;
      if (outY >= 0 && tmp[outY * width + x]) cnt--;
      if (y >= 0) out[y * width + x] = cnt > 0 ? 1 : 0;
    }
  }
  return out;
}

export function toleratedDiffMasks(oldMask, newMask, width, height, radius) {
  const oldDilated = dilateMask(oldMask, width, height, radius);
  const newDilated = dilateMask(newMask, width, height, radius);
  const n = width * height;
  const removed = new Uint8Array(n), added = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (oldMask[i] && !newDilated[i]) removed[i] = 1;
    else if (newMask[i] && !oldDilated[i]) added[i] = 1;
  }
  return { removed, added };
}
