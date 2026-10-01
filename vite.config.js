import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

// Bundling strips the libraries' own license headers, so collect the license
// texts of every npm package that ends up in the output into one file.
function thirdPartyLicenses() {
  return {
    name: "third-party-licenses",
    generateBundle(_, bundle) {
      const packages = new Map();
      for (const chunk of Object.values(bundle)) {
        for (const id of chunk.moduleIds ?? []) {
          const match = id.replaceAll("\\", "/").match(/^.*\/node_modules\/(?:@[^/]+\/)?[^/]+/);
          if (match) packages.set(match[0], null);
        }
      }
      const sections = [...packages.keys()].map((dir) => {
        const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        const texts = readdirSync(dir)
          .filter((name) => /^(licen[cs]e|notice|copying)/i.test(name))
          .map((name) => readFileSync(join(dir, name), "utf8").trim());
        if (!texts.length) throw new Error(`No license file found for ${pkg.name}.`);
        return `${pkg.name}@${pkg.version} (${pkg.license})\n\n${texts.join("\n\n")}`;
      }).sort();
      this.emitFile({
        type: "asset",
        fileName: "THIRD_PARTY_LICENSES.txt",
        source: `${sections.join(`\n\n${"=".repeat(72)}\n\n`)}\n`,
      });
    },
  };
}

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
    thirdPartyLicenses(),
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
