import { expect, test, vi } from "vitest";
import { createPdfExporter } from "../../src/features/export/pdf-exporter.js";

test.each([
  ["saveVisual", "diff.pdf"],
  ["saveText", "textdiff.pdf"],
])("%s preserves page dimensions, orientation, compression and filename", async (method, filename) => {
  const instances = [];
  function JsPdf(options) {
    this.options = options;
    this.addPage = vi.fn();
    this.addImage = vi.fn();
    this.save = vi.fn();
    instances.push(this);
  }
  const pages = [
    { width: 150, height: 300, toDataURL: vi.fn(() => "portrait") },
    { width: 450, height: 150, toDataURL: vi.fn(() => "landscape") },
  ];
  const renderPage = vi.fn(index => pages[index]);
  const exporter = createPdfExporter({ jsPDF: JsPdf });

  await exporter[method]({ pageCount: 2, dpi: 150, renderPage, filename });

  expect(instances).toHaveLength(1);
  expect(instances[0].options).toEqual({
    orientation: "p", unit: "pt", format: [72, 144], compress: true,
  });
  const [secondFormat, secondOrientation] = instances[0].addPage.mock.calls[0];
  expect(secondFormat[0]).toBeCloseTo(216);
  expect(secondFormat[1]).toBeCloseTo(72);
  expect(secondOrientation).toBe("l");
  expect(instances[0].addImage).toHaveBeenNthCalledWith(1, "portrait", "PNG", 0, 0, 72, 144);
  const secondImage = instances[0].addImage.mock.calls[1];
  expect(secondImage.slice(0, 5)).toEqual(["landscape", "PNG", 0, 0, expect.any(Number)]);
  expect(secondImage[4]).toBeCloseTo(216);
  expect(secondImage[5]).toBeCloseTo(72);
  expect(instances[0].save).toHaveBeenCalledWith(filename);
  expect(renderPage).toHaveBeenCalledTimes(2);
});

test("overlays invisible text in the bundled font when text runs are given", async () => {
  const calls = [];
  function JsPdf() {
    for (const name of ["addPage", "addImage", "save", "addFileToVFS", "addFont", "setFont", "setFontSize", "text"]) {
      this[name] = vi.fn((...args) => calls.push([name, ...args]));
    }
  }
  const loadFont = vi.fn(async () => "\x00\x01\x00\x00font");
  const exporter = createPdfExporter({ jsPDF: JsPdf, loadFont });

  await exporter.saveText({
    pageCount: 1,
    dpi: 144,
    renderPage: () => ({ width: 200, height: 400, toDataURL: () => "png" }),
    textRuns: () => [{ text: "変更点", x: 20, y: 40, size: 24 }],
    filename: "textreport.pdf",
  });

  expect(calls.map(([name]) => name)).toEqual(["addFileToVFS", "addFont", "setFont", "addImage", "setFontSize", "text", "save"]);
  expect(calls[0][2]).toBe("\x00\x01\x00\x00font");
  expect(calls.find(([name]) => name === "setFontSize")[1]).toBe(12);
  expect(calls.find(([name]) => name === "text").slice(1)).toEqual(["変更点", 10, 20, { baseline: "middle", renderingMode: "invisible" }]);
});

test("propagates page rendering and PDF errors without saving a partial document", async () => {
  const save = vi.fn();
  function JsPdf() {
    this.addPage = vi.fn();
    this.addImage = vi.fn();
    this.save = save;
  }
  const exporter = createPdfExporter({ jsPDF: JsPdf });

  await expect(exporter.saveVisual({
    pageCount: 2,
    dpi: 150,
    renderPage: index => index === 0
      ? { width: 10, height: 10, toDataURL: () => "ok" }
      : Promise.reject(new Error("render failed")),
    filename: "diff.pdf",
  })).rejects.toThrow("render failed");
  expect(save).not.toHaveBeenCalled();
});
