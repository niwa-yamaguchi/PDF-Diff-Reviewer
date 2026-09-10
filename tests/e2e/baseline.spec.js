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

  await expect(page.locator("#reviewIndexStatus")).toContainText("分析完了");
  await page.locator('[data-review-page="0"] [data-review-edit]').first().click();
  const layer = await page.locator("#boxLayer").boundingBox();
  expect(layer).not.toBeNull();
  await page.mouse.move(layer.x + layer.width / 2, layer.y + layer.height / 2);
  await page.mouse.down();
  await page.mouse.move(layer.x + layer.width / 2 + 24, layer.y + layer.height / 2 + 20);
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

test("cancels PDF replacement before changing document state or edited boxes", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles("#fileOld", join(fixtures, "old.pdf"));
  await page.setInputFiles("#fileNew", join(fixtures, "new.pdf"));
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("差分を表示中");

  await expect(page.locator("#reviewIndexStatus")).toContainText("分析完了");
  await page.locator('[data-review-page="0"] [data-review-edit]').first().click();
  const layer = await page.locator("#boxLayer").boundingBox();
  expect(layer).not.toBeNull();
  await page.mouse.move(layer.x + layer.width / 2, layer.y + layer.height / 2);
  await page.mouse.down();
  await page.mouse.move(layer.x + layer.width / 2 + 24, layer.y + layer.height / 2 + 20);
  await page.mouse.up();
  await expect(page.locator("#statBox")).toContainText("（手編集）");

  const before = {
    oldName: await page.locator("#dropOld .fname").textContent(),
    pageLabel: await page.locator("#pageLabel").textContent(),
    status: await page.locator("#status").textContent(),
    threshold: await page.locator("#th").inputValue(),
    boxes: await page.locator("#statBox").textContent(),
  };
  const dialogs = [];
  async function dismissReplacement(file) {
    const dialogPromise = page.waitForEvent("dialog");
    const selectionPromise = page.setInputFiles("#fileOld", file);
    const dialog = await dialogPromise;
    dialogs.push(dialog.message());
    await dialog.dismiss();
    await selectionPromise;
  }

  const replacement = join(fixtures, "new.pdf");
  await dismissReplacement(replacement);
  await expect(page.locator("#fileOld")).toHaveValue("");
  await expect(page.locator("#dropOld .fname")).toHaveText(before.oldName);
  await expect(page.locator("#pageLabel")).toHaveText(before.pageLabel);
  await expect(page.locator("#status")).toHaveText(before.status);
  await expect(page.locator("#th")).toHaveValue(before.threshold);
  await expect(page.locator("#statBox")).toHaveText(before.boxes);

  await dismissReplacement(replacement);
  expect(dialogs).toEqual([
    "手編集した変更枠があります。この操作で破棄されます。よろしいですか？",
    "手編集した変更枠があります。この操作で破棄されます。よろしいですか？",
  ]);
});

test("renders both visual modes without changing the current box result", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles("#fileOld", join(fixtures, "old.pdf"));
  await page.setInputFiles("#fileNew", join(fixtures, "new.pdf"));
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("差分を表示中");
  const boxStatus = await page.locator("#statBox").textContent();

  await page.locator("#modeToggle").click();
  await expect(page.locator("#modeToggle")).toHaveClass(/active/);
  await expect(page.locator("#status")).toContainText("新旧切替");
  await expect(page.locator("#out")).toBeVisible();
  await expect(page.locator("#statBox")).toHaveText(boxStatus);

  await page.locator("#modeDiff").click();
  await expect(page.locator("#modeDiff")).toHaveClass(/active/);
  await expect(page.locator("#status")).toHaveText("差分を表示中");
  await expect(page.locator("#out")).toBeVisible();
  await expect(page.locator("#statBox")).toHaveText(boxStatus);
});

test("preserves the empty-state appearance", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveScreenshot("empty-state.png", { maxDiffPixelRatio: 0.005 });
});
