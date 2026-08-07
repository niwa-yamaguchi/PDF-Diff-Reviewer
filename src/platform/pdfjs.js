import * as pdfjsLib from "pdfjs-dist/build/pdf.js";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.js?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

const base = import.meta.env.BASE_URL;
export const PDF_DOCUMENT_OPTIONS = Object.freeze({
  cMapUrl: `${base}pdfjs/cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `${base}pdfjs/standard_fonts/`,
});

export { pdfjsLib };
