import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { jsPDF } from "jspdf";

const dir = dirname(fileURLToPath(import.meta.url));

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

export async function generateFixtures() {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "old.pdf"), makePdf("old"));
  await writeFile(join(dir, "new.pdf"), makePdf("new"));
}

export default generateFixtures;

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await generateFixtures();
}
