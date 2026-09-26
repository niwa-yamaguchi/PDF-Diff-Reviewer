import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const EXPECTED = [[0, 0], [1, 1], [2, 3], [3, 4], [4, 5]];

// Break: τ が図枠共有の別シートと改訂シートの間に無いと、自動整列が誤った組を作る。
test("MATCH_MIN separates revised sheets from other sheets sharing the frame", async ({ page }) => {
  await page.goto("/");
  const oldBytes = [...await readFile(join(fixtures, "sheets-old.pdf"))];
  const newBytes = [...await readFile(join(fixtures, "sheets-new.pdf"))];
  const matrix = await page.evaluate(async ({ oldBytes, newBytes }) => {
    const { pdfjsLib, PDF_DOCUMENT_OPTIONS } = await import("/src/platform/pdfjs.js");
    const { renderPageCanvas, canvasToRgba } = await import("/src/features/documents/page-renderer.js");
    const core = await import("/src/core/page-mapping/page-mapping.js");
    async function masks(bytes) {
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes), ...PDF_DOCUMENT_OPTIONS }).promise;
      const out = [];
      for (let index = 0; index < doc.numPages; index += 1) {
        const viewport = (await doc.getPage(index + 1)).getViewport({ scale: 1 });
        const scale = core.SIGNATURE_LONG_EDGE / Math.max(viewport.width, viewport.height);
        const { data, width, height } = canvasToRgba(await renderPageCanvas(doc, index, scale));
        out.push(core.pageSignature({ data, width, height, threshold: 128 }));
      }
      return out;
    }
    const oldMasks = await masks(oldBytes);
    const newMasks = await masks(newBytes);
    return {
      matchMin: core.MATCH_MIN,
      sim: oldMasks.map(o => newMasks.map(n => core.pageSimilarity(o, n))),
    };
  }, { oldBytes, newBytes });

  const same = EXPECTED.map(([o, n]) => matrix.sim[o][n]);
  const cross = matrix.sim.flatMap((row, o) => row.filter((_, n) => !EXPECTED.some(
    ([eo, en]) => eo === o && en === n,
  )));
  console.log(`same-sheet min=${Math.min(...same).toFixed(3)} cross-sheet max=${Math.max(...cross).toFixed(3)}`);
  expect(Math.max(...cross)).toBeLessThan(matrix.matchMin - 0.05);
  expect(Math.min(...same)).toBeGreaterThan(matrix.matchMin + 0.05);
});

test("suggests, applies and undoes automatic page mapping", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles("#fileOld", join(fixtures, "sheets-old.pdf"));
  await page.setInputFiles("#fileNew", join(fixtures, "sheets-new.pdf"));
  await expect(page.locator("#pageMapNotice"))
    .toHaveText("ページ数が異なります（旧 5／新 6）。自動でページ整列できます");
  await expect(page.locator("#alignAuto")).toHaveClass(/suggest/);

  await page.locator("#alignAuto").click();
  await expect(page.locator("#pageMapNotice")).toContainText("新 P3 を追加と判定", { timeout: 60_000 });
  await expect(page.locator("#pageMapNotice")).not.toContainText("削除");

  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText(/差分を表示中|差分なし/);
  await expect(page.locator("#pageLabel")).toContainText("1 / 6");

  await page.locator("#alignUndo").click();
  await expect(page.locator("#pageLabel")).toContainText("1 / 6");
  await expect(page.locator("#alignUndo")).toBeDisabled();
});
