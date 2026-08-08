import { access, readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  }))).flat();
}

const files = await filesUnder("dist");
if (files.some(path => extname(path) === ".map")) {
  throw new Error("Production dist must not contain source maps.");
}
for (const required of ["dist/pdfjs/cmaps", "dist/pdfjs/standard_fonts"]) {
  await access(required);
}
const worker = files.find(path => /pdf\.worker\.min-[^/\\]+\.js$/.test(path));
if (!worker) throw new Error("Production dist is missing the local pdf.js worker.");
for (const path of files.filter(path => /\.(?:html|css|js)$/.test(path))) {
  const source = await readFile(path, "utf8");
  if (/cdnjs|jsdelivr/i.test(source)) {
    throw new Error(`Production dist contains a runtime CDN URL: ${path}`);
  }
}
