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

test("renders with every external network request blocked", async ({ page }) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  await page.goto("/");
  await page.setInputFiles("#fileOld", join(fixtures, "old.pdf"));
  await page.setInputFiles("#fileNew", join(fixtures, "new.pdf"));
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText(/差分を表示中|差分がない/);
});

test("keeps the committed threshold and edited boxes when discard is cancelled", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles("#fileOld", join(fixtures, "old.pdf"));
  await page.setInputFiles("#fileNew", join(fixtures, "new.pdf"));
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("差分を表示中");

  await page.locator("#boxEdit").click();
  const layer = await page.locator("#boxLayer").boundingBox();
  expect(layer).not.toBeNull();
  await page.mouse.move(layer.x + layer.width * 0.72, layer.y + layer.height * 0.72);
  await page.mouse.down();
  await page.mouse.move(layer.x + layer.width * 0.84, layer.y + layer.height * 0.82);
  await page.mouse.up();
  await expect(page.locator("#statBox")).toContainText("（手編集）");

  const committedThreshold = await page.locator("#th").inputValue();
  const editedBoxStatus = await page.locator("#statBox").textContent();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.locator("#th").evaluate((slider) => {
    slider.value = "160";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    slider.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await expect(page.locator("#th")).toHaveValue(committedThreshold);
  await expect(page.locator("#thVal")).toHaveText(committedThreshold);
  await expect(page.locator("#statBox")).toHaveText(editedBoxStatus);
});

test("preserves the empty-state appearance", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveScreenshot("empty-state.png", { maxDiffPixelRatio: 0.005 });
});
