import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

function keepJsPdfPdfObjectLocal() {
  return {
    name: "keep-jspdf-pdfobject-local",
    transform(code, id) {
      if (!id.endsWith("jspdf.es.min.js")) return null;
      const start = code.indexOf('case"pdfobjectnewwindow":');
      const end = code.indexOf('case"pdfjsnewwindow":', start);
      if (start === -1 || end === -1) {
        throw new Error("Could not disable jsPDF PDFObject output safely.");
      }
      const unsupported = [
        'case"pdfobjectnewwindow":throw new Error(',
        '"The jsPDF pdfobjectnewwindow output is not supported in this local-only build.");',
      ].join("");
      return `${code.slice(0, start)}${unsupported}${code.slice(end)}`;
    },
  };
}

export default defineConfig({
  build: { outDir: "dist", emptyOutDir: true },
  plugins: [
    keepJsPdfPdfObjectLocal(),
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/pdfjs-dist/cmaps/*",
          dest: "pdfjs/cmaps",
          rename: { stripBase: true },
        },
        {
          src: "node_modules/pdfjs-dist/standard_fonts/*",
          dest: "pdfjs/standard_fonts",
          rename: { stripBase: true },
        },
      ],
    }),
  ],
});
