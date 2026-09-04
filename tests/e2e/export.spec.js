import { expect, test } from "@playwright/test";
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

  await expectDownload(page, "#dlPng", "side-by-side_p1.png", visualView);
  await expectDownload(page, "#dlPdf", "side-by-side.pdf", visualView);
});
