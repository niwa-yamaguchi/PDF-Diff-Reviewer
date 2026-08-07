import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

test("production entry has no runtime CDN dependency", async () => {
  const html = await readFile("index.html", "utf8");
  expect(html).not.toMatch(/cdnjs|jsdelivr/);
  const platform = await readFile("src/platform/pdfjs.js", "utf8");
  expect(platform).toContain("pdfjs-dist/build/pdf.js");
  expect(platform).toContain("pdf.worker.min.js?url");
});
