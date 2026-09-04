import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const fixture = name => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

async function visualView(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("#out");
    const splitOld = document.querySelector("#splitOldCanvas");
    const splitNew = document.querySelector("#splitNewCanvas");
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let checksum = 0;
    for (let index = 0; index < data.length; index += 97) {
      checksum = (checksum + data[index] * (index + 1)) >>> 0;
    }
    return {
      page: document.querySelector("#pageLabel").textContent,
      zoom: document.querySelector("#zoomLabel").textContent,
      stats: ["#statRm", "#statAd", "#statBox"].map(selector => document.querySelector(selector).textContent),
      mode: document.querySelector("#topVisual").className,
      visualMode: ["#modeDiff", "#modeToggle", "#modeSplit"]
        .map(selector => document.querySelector(selector).className),
      dimensions: [canvas.width, canvas.height],
      split: [
        splitOld.width, splitOld.height, splitOld.style.transform,
        splitNew.width, splitNew.height, splitNew.style.transform,
      ],
      checksum,
    };
  });
}

async function textView(page) {
  return page.evaluate(() => {
    const oldCanvas = document.querySelector("#oldTextCanvas");
    const newCanvas = document.querySelector("#newTextCanvas");
    return {
      page: document.querySelector("#textPageInd").textContent,
      mode: document.querySelector("#topText").className,
      old: [oldCanvas.width, oldCanvas.height, oldCanvas.style.transform],
      next: [newCanvas.width, newCanvas.height, newCanvas.style.transform],
    };
  });
}

async function expectDownload(page, button, filename, capture) {
  const before = await capture(page);
  const pending = page.waitForEvent("download");
  await page.locator(button).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe(filename);
  await expect.poll(() => capture(page)).toEqual(before);
  return download;
}

async function downloadBytes(download) {
  const path = await download.path();
  expect(path).not.toBeNull();
  return readFile(path);
}

async function inspectSplitPng(page, download, { paneWidth, paneHeight, dpi }) {
  const bytes = await downloadBytes(download);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const gap = Math.max(1, Math.round(dpi / 72));
  const labelHeight = Math.max(1, Math.round(28 * dpi / 72));
  expect(width).toBe(paneWidth * 2 + gap);
  expect(height).toBe(labelHeight + paneHeight);

  const content = await page.evaluate(async ({ base64, paneWidth, paneHeight, gap, labelHeight }) => {
    const image = new Image();
    const loaded = new Promise((resolve, reject) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", () => reject(new Error("downloaded PNG did not decode")), {
        once: true,
      });
    });
    image.src = `data:image/png;base64,${base64}`;
    await loaded;

    const scan = (sourceX) => {
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 160;
      const context = canvas.getContext("2d");
      context.drawImage(
        image,
        sourceX,
        labelHeight,
        paneWidth,
        paneHeight,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let nonWhite = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (
          pixels[index + 3] > 0
          && (pixels[index] < 245 || pixels[index + 1] < 245 || pixels[index + 2] < 245)
        ) nonWhite++;
      }
      return nonWhite;
    };
    return {
      decoded: [image.naturalWidth, image.naturalHeight],
      oldNonWhite: scan(0),
      newNonWhite: scan(paneWidth + gap),
    };
  }, {
    base64: bytes.toString("base64"),
    paneWidth,
    paneHeight,
    gap,
    labelHeight,
  });
  expect(content.decoded).toEqual([width, height]);
  expect(content.oldNonWhite).toBeGreaterThan(20);
  expect(content.newNonWhite).toBeGreaterThan(20);
}

async function inspectSplitPdf(page, download, {
  paneWidth,
  paneHeight,
  dpi,
  pageCount,
}) {
  const bytes = await downloadBytes(download);
  const gap = Math.max(1, Math.round(dpi / 72));
  const labelHeight = Math.max(1, Math.round(28 * dpi / 72));
  const expectedWidthPx = paneWidth * 2 + gap;
  const expectedHeightPx = labelHeight + paneHeight;
  const expectedWidthPt = expectedWidthPx * 72 / dpi;
  const expectedHeightPt = expectedHeightPx * 72 / dpi;
  const inspected = await page.evaluate(async ({
    base64,
    dpi,
    paneWidth,
    gap,
    labelHeight,
  }) => {
    const { pdfjsLib, PDF_DOCUMENT_OPTIONS } = await import("/src/platform/pdfjs.js");
    const binary = atob(base64);
    const data = Uint8Array.from(binary, character => character.charCodeAt(0));
    const loadingTask = pdfjsLib.getDocument({ ...PDF_DOCUMENT_OPTIONS, data });
    const pdfDocument = await loadingTask.promise;
    const pages = [];
    try {
      for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber++) {
        const pdfPage = await pdfDocument.getPage(pageNumber);
        const viewport = pdfPage.getViewport({ scale: 1 });
        const operators = await pdfPage.getOperatorList();
        const imageSizes = operators.fnArray.flatMap((operator, index) => (
          operator === pdfjsLib.OPS.paintImageXObject
            ? [[operators.argsArray[index][1], operators.argsArray[index][2]]]
            : []
        ));

        const renderScale = 0.5;
        const rendered = pdfPage.getViewport({ scale: renderScale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(rendered.width);
        canvas.height = Math.ceil(rendered.height);
        const context = canvas.getContext("2d");
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        await pdfPage.render({ canvasContext: context, viewport: rendered }).promise;
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const contentTop = Math.ceil(labelHeight * 72 / dpi * renderScale);
        const oldRight = Math.floor(paneWidth * 72 / dpi * renderScale);
        const newLeft = Math.ceil((paneWidth + gap) * 72 / dpi * renderScale);
        const countNonWhite = (left, right) => {
          let count = 0;
          for (let y = contentTop; y < canvas.height; y++) {
            for (let x = left; x < right; x++) {
              const offset = (y * canvas.width + x) * 4;
              if (
                pixels[offset] < 245
                || pixels[offset + 1] < 245
                || pixels[offset + 2] < 245
              ) count++;
            }
          }
          return count;
        };
        pages.push({
          viewport: [viewport.width, viewport.height],
          oldNonWhite: countNonWhite(0, oldRight),
          newNonWhite: countNonWhite(newLeft, canvas.width),
          imageSizes,
        });
        pdfPage.cleanup();
      }
      return { pageCount: pdfDocument.numPages, pages };
    } finally {
      await pdfDocument.destroy();
    }
  }, {
    base64: bytes.toString("base64"),
    dpi,
    paneWidth,
    gap,
    labelHeight,
  });

  expect(inspected.pageCount).toBe(pageCount);
  expect(inspected.pages).toHaveLength(pageCount);
  for (const pdfPage of inspected.pages) {
    expect(pdfPage.viewport[0]).toBeCloseTo(expectedWidthPt, 1);
    expect(pdfPage.viewport[1]).toBeCloseTo(expectedHeightPt, 1);
    expect(pdfPage.oldNonWhite).toBeGreaterThan(20);
    expect(pdfPage.newNonWhite).toBeGreaterThan(20);
    expect(pdfPage.imageSizes).toContainEqual([expectedWidthPx, expectedHeightPx]);
  }
}

test("downloads visual and text PNG/PDF without changing either committed view", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.locator("#fileOld").setInputFiles(fixture("old.pdf"));
  await page.locator("#fileNew").setInputFiles(fixture("new.pdf"));
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("差分を表示中");

  await expectDownload(page, "#dlPng", "diff_p1.png", visualView);
  await expectDownload(page, "#dlPdf", "diff.pdf", visualView);

  await page.locator("#topText").click();
  await page.locator("#runText").click();
  await expect(page.locator("#textStatus")).toHaveText("テキスト差分を表示中");
  await page.locator("#textZoomIn").click();

  await expectDownload(page, "#dlTextPng", "textdiff_p1.png", textView);
  await expectDownload(page, "#dlTextPdf", "textdiff.pdf", textView);
});

test("downloads full-resolution side-by-side PNG/PDF without changing the split review", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await page.locator("#fileOld").setInputFiles(fixture("old.pdf"));
  await page.locator("#fileNew").setInputFiles(fixture("new.pdf"));
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("差分を表示中");
  await page.locator("#modeSplit").click();
  await expect(page.locator("#status")).toHaveText("左右表示中");
  await page.locator("#splitNewCanvas").hover();
  await page.mouse.wheel(0, -120);
  await expect.poll(async () => {
    const view = await visualView(page);
    return view.split[2] === view.split[5] && view.split[2].includes("scale(");
  }).toBe(true);

  const source = await page.evaluate(() => {
    const canvas = document.querySelector("#splitOldCanvas");
    return {
      paneWidth: canvas.width,
      paneHeight: canvas.height,
      dpi: Number(document.querySelector("#dpi").value),
      pageCount: Number(document.querySelector("#pageLabel").textContent.match(/\/\s*(\d+)/)[1]),
    };
  });
  const png = await expectDownload(
    page,
    "#dlPng",
    "side-by-side_p1.png",
    visualView,
  );
  await inspectSplitPng(page, png, source);

  const pdf = await expectDownload(page, "#dlPdf", "side-by-side.pdf", visualView);
  await inspectSplitPdf(page, pdf, source);
});
