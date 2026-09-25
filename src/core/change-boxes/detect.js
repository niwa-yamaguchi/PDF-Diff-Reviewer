export const CHANGE_BITS = Object.freeze({ removed: 1, added: 2 });

function changeKind(bits) {
  if (bits === CHANGE_BITS.removed) return "removed";
  if (bits === CHANGE_BITS.added) return "added";
  return "changed";
}

export function computeBoxes(flags, counts, cols, rows, block, minPixels) {
  const DIRS4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const dil = new Uint8Array(cols * rows);
  const offs = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!flags[r * cols + c]) continue;
      for (const [dr, dc] of offs) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
        dil[nr * cols + nc] = 1;
      }
    }
  }
  const seen = new Uint8Array(cols * rows);
  const boxes = [];
  const qx = new Int32Array(cols * rows), qy = new Int32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!dil[i] || seen[i]) continue;
      let head = 0, tail = 0;
      qx[tail] = c; qy[tail] = r; tail++; seen[i] = 1;
      let minC = c, maxC = c, minR = r, maxR = r, changedPixels = 0, kindBits = 0;
      while (head < tail) {
        const cx = qx[head], cy = qy[head]; head++;
        const bits = flags[cy * cols + cx];
        if (bits) { changedPixels += counts[cy * cols + cx]; kindBits |= bits; }
        if (cx < minC) minC = cx; if (cx > maxC) maxC = cx;
        if (cy < minR) minR = cy; if (cy > maxR) maxR = cy;
        for (const [dx, dy] of DIRS4) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const ni = ny * cols + nx;
          if (dil[ni] && !seen[ni]) { seen[ni] = 1; qx[tail] = nx; qy[tail] = ny; tail++; }
        }
      }
      if (changedPixels < minPixels) continue;
      boxes.push({
        x: minC * block,
        y: minR * block,
        w: (maxC - minC + 1) * block,
        h: (maxR - minR + 1) * block,
        kind: changeKind(kindBits),
      });
    }
  }
  return boxes;
}
