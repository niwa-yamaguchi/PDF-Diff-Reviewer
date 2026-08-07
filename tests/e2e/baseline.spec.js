import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

test("renders added and removed diff pixels for different PDFs", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles("#fileOld", join(fixtures, "old.pdf"));
  await page.setInputFiles("#fileNew", join(fixtures, "new.pdf"));
  await expect(page.locator("#run")).toBeEnabled();
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("差分を表示中");
  await expect(page.locator("#out")).toBeVisible();
  await expect(page.locator("#pageLabel")).toContainText("1 / 2");
  const diffPixels = await page.locator("#out").evaluate((node) => {
    const { data } = node.getContext("2d").getImageData(0, 0, node.width, node.height);
    let removed = 0;
    let added = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] === 255 && data[i + 1] === 91 && data[i + 2] === 87) removed++;
      if (data[i] === 77 && data[i + 1] === 141 && data[i + 2] === 255) added++;
    }
    return { removed, added };
  });
  expect(diffPixels.removed).toBeGreaterThan(0);
  expect(diffPixels.added).toBeGreaterThan(0);
});

test("preserves the empty-state appearance", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveScreenshot("empty-state.png", { maxDiffPixelRatio: 0.005 });
});
