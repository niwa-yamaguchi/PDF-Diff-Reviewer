import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import viteConfig from "../../vite.config.js";

test("production entry has no runtime CDN dependency", async () => {
  const html = await readFile("index.html", "utf8");
  expect(html).not.toMatch(/cdnjs|jsdelivr/);
  const platform = await readFile("src/platform/pdfjs.js", "utf8");
  expect(platform).toContain("pdfjs-dist/build/pdf.js");
  expect(platform).toContain("pdf.worker.min.js?url");
});

test("makes jsPDF PDFObject output explicitly unsupported in the local bundle", () => {
  const plugin = viteConfig.plugins.find(
    ({ name }) => name === "keep-jspdf-pdfobject-local",
  );
  const source = [
    'case"pdfobjectnewwindow":var pdfObjectUrl="https://cdnjs.example/pdfobject.js";',
    'case"pdfjsnewwindow":return "keep PDF.js output";',
  ].join("");

  const transformed = plugin.transform(
    source,
    "/project/node_modules/jspdf/dist/jspdf.es.min.js",
  );

  expect(transformed).toContain('case"pdfobjectnewwindow":throw new Error(');
  expect(transformed).toContain("not supported in this local-only build");
  expect(transformed).not.toContain("cdnjs.example");
  expect(transformed).toContain('case"pdfjsnewwindow":return "keep PDF.js output";');
});
