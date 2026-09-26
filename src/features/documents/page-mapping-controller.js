import { SIGNATURE_LONG_EDGE } from "../../core/page-mapping/page-mapping.js";

const SIDES = Object.freeze(["old", "new"]);

function pageFailure(side, pageIndex, cause) {
  const label = side === "old" ? "旧版" : "新版";
  return Object.assign(new Error(`${label} P${pageIndex + 1} の解析に失敗しました`), { side, pageIndex, cause });
}

export function createPageMappingController({
  state, pageSizePt, renderPageCanvas, canvasToRgba, runJob, onProgress = () => {},
}) {
  async function signature(doc, pageIndex) {
    const size = await pageSizePt(doc, pageIndex);
    const canvas = await renderPageCanvas(doc, pageIndex, SIGNATURE_LONG_EDGE / Math.max(size.w, size.h));
    const { data, width, height } = canvasToRgba(canvas);
    canvas.width = 0;
    canvas.height = 0;
    return runJob("pageSignature", { data, width, height, threshold: state.comparison.threshold }, [data.buffer]);
  }

  async function run() {
    const generation = state.documents.generation;
    const stale = () => state.documents.generation !== generation;
    const docs = { old: state.documents.oldDoc, new: state.documents.newDoc };
    const masks = { old: [], new: [] };
    const total = docs.old.numPages + docs.new.numPages;
    let done = 0;
    for (const side of SIDES) {
      for (let pageIndex = 0; pageIndex < docs[side].numPages; pageIndex += 1) {
        try {
          masks[side].push(await signature(docs[side], pageIndex));
        } catch (error) {
          if (stale()) return null;
          throw pageFailure(side, pageIndex, error);
        }
        if (stale()) return null;
        done += 1;
        onProgress(done, total);
      }
    }
    try {
      const result = await runJob("pageMap", { oldMasks: masks.old, newMasks: masks.new });
      return stale() ? null : result;
    } catch (error) {
      if (stale()) return null;
      throw error;
    }
  }

  return { run };
}
