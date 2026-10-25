// 2次元のアフィン行列 [a, b, c, d, e, f]（Canvas の setTransform・pdf.js の transform と同じ並び）。

// left ∘ right（right を先に掛ける）。
export function composeAffine([a1, b1, c1, d1, e1, f1], [a2, b2, c2, d2, e2, f2]) {
  return [
    a1 * a2 + c1 * b2, b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2, b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1,
  ];
}
