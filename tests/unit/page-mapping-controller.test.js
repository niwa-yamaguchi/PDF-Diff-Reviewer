import { expect, test, vi } from "vitest";
import { createPageMappingController } from "../../src/features/documents/page-mapping-controller.js";

function setup({ runJob, renderPageCanvas } = {}) {
  const state = {
    documents: { generation: 1, oldDoc: { numPages: 2 }, newDoc: { numPages: 3 } },
    comparison: { threshold: 140 },
  };
  const canvases = [];
  const mapping = { oldSequence: [0, 1, null], newSequence: [0, 1, 2], similarity: [1, 1, null] };
  const deps = {
    state,
    pageSizePt: vi.fn(async () => ({ w: 1191, h: 842 })),
    renderPageCanvas: renderPageCanvas || vi.fn(async () => {
      const canvas = { width: 10, height: 7 };
      canvases.push(canvas);
      return canvas;
    }),
    canvasToRgba: vi.fn(canvas => ({
      data: new Uint8ClampedArray(canvas.width * canvas.height * 4), width: canvas.width, height: canvas.height,
    })),
    runJob: runJob || vi.fn(async type => (type === "pageSignature" ? new Uint8Array(1) : mapping)),
    onProgress: vi.fn(),
  };
  return { ...deps, canvases, mapping, controller: createPageMappingController(deps) };
}

test("renders every page at the signature scale and maps them in one Worker job", async () => {
  const { controller, state, renderPageCanvas, runJob, onProgress, canvases, mapping } = setup();
  await expect(controller.run()).resolves.toBe(mapping);
  expect(renderPageCanvas.mock.calls.map(([doc, index, scale]) => [doc, index, scale])).toEqual([
    [state.documents.oldDoc, 0, 1024 / 1191], [state.documents.oldDoc, 1, 1024 / 1191],
    [state.documents.newDoc, 0, 1024 / 1191], [state.documents.newDoc, 1, 1024 / 1191],
    [state.documents.newDoc, 2, 1024 / 1191],
  ]);
  const [type, payload, transfer] = runJob.mock.calls[0];
  expect(type).toBe("pageSignature");
  expect(payload.threshold).toBe(140);
  expect(transfer).toEqual([payload.data.buffer]);
  expect(canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true);
  expect(onProgress.mock.calls).toEqual([[1, 5], [2, 5], [3, 5], [4, 5], [5, 5]]);
  const [lastType, lastPayload] = runJob.mock.calls.at(-1);
  expect(lastType).toBe("pageMap");
  expect(lastPayload.oldMasks).toHaveLength(2);
  expect(lastPayload.newMasks).toHaveLength(3);
});

test("a failing page rejects with its side and page index", async () => {
  const renderPageCanvas = vi.fn(async (doc, index) => {
    if (doc.numPages === 3 && index === 1) throw new Error("broken page");
    return { width: 10, height: 7 };
  });
  const { controller } = setup({ renderPageCanvas });
  await expect(controller.run()).rejects.toMatchObject({ side: "new", pageIndex: 1 });
});

// Break: 差し替え後に古いPDFの対応付けを適用すると、新しいPDFの整列が壊れる。
test("a document generation change mid-run resolves null without mapping", async () => {
  const { controller, state, runJob } = setup();
  runJob.mockImplementation(async type => {
    state.documents.generation += 1;
    return type === "pageSignature" ? new Uint8Array(1) : {};
  });
  await expect(controller.run()).resolves.toBeNull();
  expect(runJob.mock.calls.some(([type]) => type === "pageMap")).toBe(false);
});

test("a failure caused by document replacement resolves null instead of reporting", async () => {
  const { controller, state, runJob } = setup();
  runJob.mockImplementation(async () => {
    state.documents.generation += 1;
    throw new Error("cancelled");
  });
  await expect(controller.run()).resolves.toBeNull();
});

// Break: 差し替えが settleBatch を経て generation を戻さないまま新しい文書を差し込むと、
// 古い解析結果が新しい文書に適用されてしまう。
test("a document swap mid-run without a generation bump resolves null without mapping", async () => {
  const { controller, state, runJob } = setup();
  const replacementNewDoc = { numPages: 3 };
  runJob.mockImplementation(async type => {
    state.documents.newDoc = replacementNewDoc;
    return type === "pageSignature" ? new Uint8Array(1) : {};
  });
  await expect(controller.run()).resolves.toBeNull();
  expect(runJob.mock.calls.some(([type]) => type === "pageMap")).toBe(false);
});
