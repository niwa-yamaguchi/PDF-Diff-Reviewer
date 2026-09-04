import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const fixture = name => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

async function loadComparison(page) {
  await page.goto("/");
  await page.locator("#fileOld").setInputFiles(fixture("old.pdf"));
  await page.locator("#fileNew").setInputFiles(fixture("new.pdf"));
  await expect(page.locator("#run")).toBeEnabled();
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("差分を表示中");
}

async function transforms(page) {
  return Promise.all([
    page.locator("#splitOldCanvas").evaluate(canvas => canvas.style.transform),
    page.locator("#splitNewCanvas").evaluate(canvas => canvas.style.transform),
  ]);
}

async function dragPane(page, selector) {
  const pane = await page.locator(selector).boundingBox();
  expect(pane).not.toBeNull();
  const start = { x: pane.x + pane.width * 0.5, y: pane.y + pane.height * 0.5 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 24, start.y + 18);
  await page.mouse.up();
}

async function orangePixels(locator) {
  return locator.evaluate((canvas) => {
    const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index] === 255 && data[index + 1] === 149 && data[index + 2] === 0) count++;
    }
    return count;
  });
}

test("reviews aligned drawings side by side with synchronized navigation", async ({ page }) => {
  await loadComparison(page);
  await page.locator("#modeSplit").click();

  const panel = page.locator("#visualSplitPanel");
  const oldCanvas = page.locator("#splitOldCanvas");
  const newCanvas = page.locator("#splitNewCanvas");
  await expect(page.locator("#status")).toHaveText("左右表示中");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".visual-split-pane-label")).toHaveText(["OLD", "NEW"]);
  await expect(oldCanvas).toBeVisible();
  await expect(newCanvas).toBeVisible();
  await expect.poll(() => oldCanvas.evaluate(canvas => canvas.width)).toBeGreaterThan(10);
  const dimensions = await Promise.all([
    oldCanvas.evaluate(canvas => [canvas.width, canvas.height]),
    newCanvas.evaluate(canvas => [canvas.width, canvas.height]),
  ]);
  expect(dimensions[0]).toEqual(dimensions[1]);

  const initial = await transforms(page);
  await newCanvas.hover();
  await page.mouse.wheel(0, -120);
  await expect.poll(async () => {
    const [oldTransform, newTransform] = await transforms(page);
    return oldTransform === newTransform && oldTransform !== initial[0];
  }).toBe(true);

  for (const selector of [
    ".visual-split-pane.old .visual-split-canvas-wrap",
    ".visual-split-pane.new .visual-split-canvas-wrap",
  ]) {
    const before = await transforms(page);
    await dragPane(page, selector);
    await expect.poll(async () => {
      const [oldTransform, newTransform] = await transforms(page);
      return oldTransform === newTransform && oldTransform !== before[0];
    }).toBe(true);
  }

  await page.locator("#zoom1").click();
  await expect.poll(async () => {
    const [oldTransform, newTransform] = await transforms(page);
    return oldTransform === newTransform && oldTransform.includes("scale(1)");
  }).toBe(true);
  await page.locator("#zoomFit").click();
  await expect.poll(async () => {
    const [oldTransform, newTransform] = await transforms(page);
    return oldTransform === newTransform;
  }).toBe(true);

  await newCanvas.hover();
  await page.mouse.wheel(0, -120);
  const beforePage = await transforms(page);
  await page.locator("#next").click();
  await expect(page.locator("#pageLabel")).toContainText("2 / 2");
  await expect(page.locator("#status")).toHaveText(/左右表示中|差分なし/);
  await expect(panel).toBeVisible();
  await expect.poll(() => transforms(page)).toEqual(beforePage);

  await page.locator("#modeDiff").click();
  await expect(page.locator("#out")).toBeVisible();
  await expect(panel).toBeHidden();
  await expect(page.locator("#toggleInd")).toBeHidden();

  await page.locator("#modeToggle").click();
  await expect(page.locator("#out")).toBeVisible();
  await expect(panel).toBeHidden();
  await expect(page.locator("#toggleInd")).toBeVisible();

  await page.locator("#modeSplit").click();
  await expect(panel).toBeVisible();
  await expect(page.locator("#out")).toBeHidden();
  await expect(page.locator("#toggleInd")).toBeHidden();

  await page.locator("#topText").click();
  await expect(page.locator("#textPanel")).toBeVisible();
  await expect(panel).toBeHidden();
  await page.locator("#topVisual").click();
  await expect(panel).toBeVisible();
  await expect(page.locator("#out")).toBeHidden();

  await page.locator("#modeDiff").click();
  await expect(page.locator("#out")).toBeVisible();
  await expect(panel).toBeHidden();
  await expect(page.locator("#toggleInd")).toBeHidden();
});

test("shows manual boxes on both sides and keeps editing in diff mode", async ({ page }) => {
  await loadComparison(page);
  await page.locator("#modeSplit").click();
  await expect(page.locator("#status")).toHaveText("左右表示中");
  const baseline = await Promise.all([
    orangePixels(page.locator("#splitOldCanvas")),
    orangePixels(page.locator("#splitNewCanvas")),
  ]);

  await page.locator("#modeDiff").click();
  await expect(page.locator("#status")).toHaveText("差分を表示中");
  await page.locator("#boxEdit").click();
  const drawing = await page.locator("#out").boundingBox();
  expect(drawing).not.toBeNull();
  await page.mouse.move(drawing.x + drawing.width * 0.72, drawing.y + drawing.height * 0.72);
  await page.mouse.down();
  await page.mouse.move(drawing.x + drawing.width * 0.84, drawing.y + drawing.height * 0.82);
  await page.mouse.up();
  await expect(page.locator("#statBox")).toContainText("（手編集）");

  await page.locator("#modeSplit").click();
  await expect(page.locator("#status")).toHaveText("左右表示中");
  await expect.poll(() => orangePixels(page.locator("#splitOldCanvas"))).toBeGreaterThan(baseline[0]);
  await expect.poll(() => orangePixels(page.locator("#splitNewCanvas"))).toBeGreaterThan(baseline[1]);
  await expect(page.locator("#boxToggle")).toBeDisabled();
  await expect(page.locator("#boxToggle")).toHaveClass(/active/);
  await expect(page.locator("#boxEdit")).toBeDisabled();
  await page.keyboard.press("E");
  await expect(page.locator("#boxEdit")).not.toHaveClass(/active/);
  await expect(page.locator(".canvas-wrap")).not.toHaveClass(/boxedit/);

  await page.locator("#modeDiff").click();
  await expect(page.locator("#boxEdit")).toBeEnabled();
  await page.locator("#boxEdit").click();
  await expect(page.locator("#boxEdit")).toHaveClass(/active/);
});

test("renders a stable missing-page marker on the empty side", async ({ page }) => {
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.fillText;
    window.__canvasFillText = [];
    CanvasRenderingContext2D.prototype.fillText = function instrumentedFillText(text, ...args) {
      window.__canvasFillText.push(String(text));
      return original.call(this, text, ...args);
    };
  });
  await loadComparison(page);
  await page.locator("#modeSplit").click();
  await expect(page.locator("#status")).toHaveText("左右表示中");

  await page.locator("#alignAddNew").click();
  await expect(page.locator("#pageLabel")).toContainText("旧 空白");
  await expect(page.locator("#visualSplitPanel")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    window.__canvasFillText.filter(text => text === "この版にこのページはありません").length
  ))).toBeGreaterThan(0);
  const corner = await page.locator("#splitOldCanvas").evaluate((canvas) => (
    [...canvas.getContext("2d").getImageData(0, 0, 1, 1).data]
  ));
  expect(corner).toEqual([255, 255, 255, 255]);
});
