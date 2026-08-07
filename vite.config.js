import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

function keepJsPdfPdfObjectLocal() {
  return {
    name: "keep-jspdf-pdfobject-local",
    transform(code, id) {
      if (!id.endsWith("jspdf.es.min.js")) return null;
      return code.replace(
        "https://cdnjs.cloudflare.com/ajax/libs/pdfobject/2.1.1/pdfobject.min.js",
        "/pdfobject.min.js",
      );
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
