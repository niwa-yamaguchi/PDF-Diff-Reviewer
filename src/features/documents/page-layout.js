const FRAME_RATIO_EPS = 0.002;
const FRAME_ASPECT_EPS = 0.01;

export function framePlan(oldSize, newSize, dpi) {
  const base = dpi / 72;
  const unchanged = {
    oldScale: base,
    newScale: base,
    frameScale: base,
    ratio: 1,
    normalized: false,
    aspectMismatch: false,
    refSide: null,
  };
  if (!oldSize || !newSize) return unchanged;
  if (!(oldSize.w > 0 && oldSize.h > 0 && newSize.w > 0 && newSize.h > 0)) {
    return unchanged;
  }

  const refIsOld = oldSize.w * oldSize.h >= newSize.w * newSize.h;
  const reference = refIsOld ? oldSize : newSize;
  const other = refIsOld ? newSize : oldSize;
  const widthRatio = reference.w / other.w;
  const heightRatio = reference.h / other.h;
  if (Math.abs(widthRatio - heightRatio) / Math.max(widthRatio, heightRatio) > FRAME_ASPECT_EPS) {
    return { ...unchanged, aspectMismatch: true };
  }

  const ratio = Math.min(widthRatio, heightRatio);
  if (Math.abs(ratio - 1) <= FRAME_RATIO_EPS) return unchanged;
  return {
    oldScale: refIsOld ? base : base * ratio,
    newScale: refIsOld ? base * ratio : base,
    frameScale: base,
    ratio,
    normalized: true,
    aspectMismatch: false,
    refSide: refIsOld ? "old" : "new",
  };
}

export function sequenceIndex(sequence, slot) {
  const value = sequence ? sequence[slot] : undefined;
  return value == null ? null : value;
}

export function pageLabelText(documents, index) {
  const oldIndex = sequenceIndex(documents.oldSequence, index);
  const newIndex = sequenceIndex(documents.newSequence, index);
  const oldLabel = oldIndex == null ? "旧 空白" : `旧P${oldIndex + 1}`;
  const newLabel = newIndex == null ? "新 空白" : `新P${newIndex + 1}`;
  return `${index + 1} / ${documents.pages}（${oldLabel} ↔ ${newLabel}）`;
}
