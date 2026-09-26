import { computeAlignment, computeQuadrant } from "../core/alignment/align-compute.js";
import { computeDiff } from "../core/image-diff/diff-compute.js";
import { mapPages, pageSignature } from "../core/page-mapping/page-mapping.js";

function runDiff(id, payload) {
  const result = computeDiff({
    ...payload,
    onProgress: ratio => self.postMessage({ id, type: "progress", ratio }),
  });
  const transfer = result.image ? [result.image.buffer] : [];
  return { result, transfer };
}

const HANDLERS = {
  diff: runDiff,
  align: (id, payload) => ({ result: computeAlignment(payload), transfer: [] }),
  quadrant: (id, payload) => ({ result: computeQuadrant(payload), transfer: [] }),
  pageSignature: (id, payload) => {
    const mask = pageSignature(payload);
    return { result: mask, transfer: [mask.buffer] };
  },
  pageMap: (id, payload) => ({ result: mapPages(payload.oldMasks, payload.newMasks), transfer: [] }),
};

self.onmessage = ({ data }) => {
  const { id, type, payload } = data;
  const handler = HANDLERS[type];
  if (!handler) {
    self.postMessage({ id, type: "error", message: `未知のジョブ種別です: ${type}` });
    return;
  }
  try {
    const { result, transfer } = handler(id, payload);
    self.postMessage({ id, type: "done", result }, transfer);
  } catch (error) {
    self.postMessage({ id, type: "error", message: error?.message || String(error) });
  }
};
