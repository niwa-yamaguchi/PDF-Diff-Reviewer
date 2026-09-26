import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { jsPDF } from "jspdf";

const dir = dirname(fileURLToPath(import.meta.url));
await mkdir(dir, { recursive: true });

function makePdf(kind) {
  const pdf = new jsPDF({ unit: "pt", format: "a4", compress: true });
  pdf.setCreationDate(new Date("2020-01-01T00:00:00.000Z"));
  pdf.setFileId(kind === "old" ? "00000000000000000000000000000001" : "00000000000000000000000000000002");
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(16);
  pdf.text("PDF DIFF FIXTURE", 48, 48);
  pdf.rect(72, 90, 180, 80);
  pdf.text(kind === "old" ? "REV A" : "REV B", 90, 130);
  if (kind === "old") pdf.line(72, 210, 252, 210);
  else pdf.circle(162, 210, 24);
  pdf.addPage("a4", "portrait");
  pdf.text(kind === "old" ? "UNCHANGED PAGE" : "UNCHANGED PAGE", 48, 48);
  return Buffer.from(pdf.output("arraybuffer"));
}

await writeFile(join(dir, "old.pdf"), makePdf("old"));
await writeFile(join(dir, "new.pdf"), makePdf("new"));

function random(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// 共通の図枠・表題欄に、シートごとに異なる図形40個を1pt線で描く。改訂は先頭3図形を右へ60pt移動。
function drawSheet(pdf, sheet, revised) {
  const W = 1191;
  const H = 842;
  pdf.setLineWidth(1.5);
  pdf.rect(20, 20, W - 40, H - 40);
  pdf.rect(W - 320, H - 120, 300, 100);
  pdf.line(W - 320, H - 70, W - 20, H - 70);
  pdf.setFontSize(14);
  pdf.text("PDF DIFF FIXTURE", W - 305, H - 90);
  pdf.text(`SHEET ${sheet}`, W - 305, H - 40);
  pdf.setLineWidth(1);
  const next = random(sheet * 7919);
  for (let i = 0; i < 40; i += 1) {
    const x = 60 + next() * (W - 440) + (revised && i < 3 ? 60 : 0);
    const y = 60 + next() * (H - 220);
    const w = 20 + next() * 120;
    const h = 20 + next() * 80;
    if (i % 3 === 0) pdf.circle(x + w / 2, y + h / 2, Math.min(w, h) / 2);
    else if (i % 3 === 1) pdf.rect(x, y, w, h);
    else pdf.line(x, y, x + w, y + h);
  }
}

function makeSheets(fileId, sheets) {
  const pdf = new jsPDF({ unit: "pt", format: "a3", orientation: "landscape", compress: true });
  pdf.setCreationDate(new Date("2020-01-01T00:00:00.000Z"));
  pdf.setFileId(fileId);
  pdf.setFont("helvetica", "normal");
  sheets.forEach(({ sheet, revised = false }, index) => {
    if (index) pdf.addPage("a3", "landscape");
    drawSheet(pdf, sheet, revised);
  });
  return Buffer.from(pdf.output("arraybuffer"));
}

await writeFile(join(dir, "sheets-old.pdf"), makeSheets(
  "00000000000000000000000000000003",
  [1, 2, 3, 4, 5].map(sheet => ({ sheet })),
));
await writeFile(join(dir, "sheets-new.pdf"), makeSheets(
  "00000000000000000000000000000004",
  [{ sheet: 1 }, { sheet: 2 }, { sheet: 6 }, { sheet: 3, revised: true }, { sheet: 4 }, { sheet: 5 }],
));
