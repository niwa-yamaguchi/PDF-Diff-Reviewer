import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

test("loads two PDFs and renders the current visual diff", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles("#fileOld", join(fixtures, "old.pdf"));
  await page.setInputFiles("#fileNew", join(fixtures, "new.pdf"));
  await expect(page.locator("#run")).toBeEnabled();
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText(/差分を表示中|差分なし/);
  await expect(page.locator("#out")).toBeVisible();
  await expect(page.locator("#pageLabel")).toContainText("1 / 2");
  const canvas = await page.locator("#out").evaluate((node) => ({
    width: node.width,
    height: node.height,
  }));
  expect(canvas).toEqual({ width: 1241, height: 1754 });
});

test("preserves the empty-state appearance", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveScreenshot("empty-state.png", { maxDiffPixelRatio: 0.005 });
});
