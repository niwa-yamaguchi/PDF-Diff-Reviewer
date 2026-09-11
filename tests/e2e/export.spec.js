import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { expectDownload, pngSize } from "../helpers/export-download.js";

const fixture = name => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

async function visualView(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("#out");
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
      visualMode: document.querySelector("#modeDiff").className,
      dimensions: [canvas.width, canvas.height],
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

test("downloads visual and text PNG/PDF without changing either committed view", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await page.locator("#fileOld").setInputFiles(fixture("old.pdf"));
  await page.locator("#fileNew").setInputFiles(fixture("new.pdf"));
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("差分を表示中");

  await expectDownload(page, "#dlPng", "diff_p1.png", visualView);
  await expectDownload(page, "#dlPdf", "diff.pdf", visualView);

  await page.locator("#modeToggle").click();
  await expect(page.locator("#status")).toHaveText("新旧切替（OLD表示中）");
  const togglePng = await expectDownload(page, "#dlPng", "toggle_p1.png", visualView);
  const size = await pngSize(togglePng);
  expect(size.width).toBeGreaterThan(size.height);
  await expectDownload(page, "#dlPdf", "toggle.pdf", visualView);

  await page.locator("#topText").click();
  await page.locator("#runText").click();
  await expect(page.locator("#textStatus")).toHaveText("テキスト差分を表示中");
  await page.locator("#textZoomIn").click();

  await expectDownload(page, "#dlTextPng", "textdiff_p1.png", textView);
  await expectDownload(page, "#dlTextPdf", "textdiff.pdf", textView);
});
