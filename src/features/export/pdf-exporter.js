function points(canvas, dpi) {
  const scale = dpi / 72;
  return {
    width: canvas.width / scale,
    height: canvas.height / scale,
    orientation: canvas.width > canvas.height ? "l" : "p",
  };
}

export function createPdfExporter({ jsPDF }) {
  async function savePages({ pageCount, dpi, renderPage, filename, onPage }) {
    let pdf = null;
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      onPage?.(pageIndex, pageCount);
      const canvas = await renderPage(pageIndex);
      const image = canvas.toDataURL("image/png");
      const page = points(canvas, dpi);
      if (!pdf) {
        pdf = new jsPDF({
          orientation: page.orientation,
          unit: "pt",
          format: [page.width, page.height],
          compress: true,
        });
      } else {
        pdf.addPage([page.width, page.height], page.orientation);
      }
      pdf.addImage(image, "PNG", 0, 0, page.width, page.height);
    }
    if (!pdf) throw new Error("出力するページがありません");
    pdf.save(filename);
  }

  return {
    saveVisual: options => savePages(options),
    saveText: options => savePages(options),
  };
}
