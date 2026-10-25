const FONT_FILE = "report-font.ttf";
const FONT_NAME = "report";

function points(canvas, dpi) {
  const scale = dpi / 72;
  return {
    width: canvas.width / scale,
    height: canvas.height / scale,
    orientation: canvas.width > canvas.height ? "l" : "p",
  };
}

// 画像の上に同じ位置で透明な文字を置き、検索・選択できるようにする（OCR済みPDFと同じ形）。
// run は画素単位の {text, x, y, size, w?, angle?, baseline?}。angle は時計回りのラジアン。
// w があれば字間で幅を合わせ、選択範囲が絵の文字からずれないようにする。
function addInvisibleText(pdf, runs, scale) {
  for (const run of runs) {
    pdf.setFontSize(run.size / scale);
    const options = { baseline: run.baseline || "alphabetic", renderingMode: "invisible" };
    if (run.angle) options.angle = -run.angle * 180 / Math.PI;
    if (run.w) options.charSpace = (run.w / scale - pdf.getTextWidth(run.text)) / [...run.text].length;
    pdf.text(run.text, run.x / scale, run.y / scale, options);
  }
}

export function createPdfExporter({ jsPDF, loadFont }) {
  async function savePages({ pageCount, dpi, renderPage, textRuns, filename, onPage }) {
    let pdf = null;
    const font = textRuns ? await loadFont() : null;
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
        if (font) {
          pdf.addFileToVFS(FONT_FILE, font);
          pdf.addFont(FONT_FILE, FONT_NAME, "normal");
          pdf.setFont(FONT_NAME, "normal");
        }
      } else {
        pdf.addPage([page.width, page.height], page.orientation);
      }
      pdf.addImage(image, "PNG", 0, 0, page.width, page.height);
      if (font) addInvisibleText(pdf, textRuns(pageIndex), dpi / 72);
    }
    if (!pdf) throw new Error("出力するページがありません");
    pdf.save(filename);
  }

  return {
    saveVisual: options => savePages(options),
    saveText: options => savePages(options),
  };
}
