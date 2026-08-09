import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const fixture = name => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

test("creates, deletes and restores a manual change box", async ({ page }) => {
  await page.goto("/");
  await page.locator("#fileOld").setInputFiles(fixture("old.pdf"));
  await page.locator("#fileNew").setInputFiles(fixture("new.pdf"));
  await page.locator("#run").click();
  await expect(page.locator("#status")).toContainText("差分");
  await page.locator("#boxEdit").click();

  const layer = await page.locator("#boxLayer").boundingBox();
  expect(layer).not.toBeNull();
  const before = await page.locator("#statBox").textContent();
  await page.mouse.move(layer.x + layer.width * 0.72, layer.y + layer.height * 0.72);
  await page.mouse.down();
  await page.mouse.move(layer.x + layer.width * 0.84, layer.y + layer.height * 0.82);
  await page.mouse.up();
  await expect.poll(() => page.locator("#statBox").textContent()).not.toBe(before);
  const afterCreate = await page.locator("#statBox").textContent();

  await page.keyboard.press("Delete");
  await expect.poll(() => page.locator("#statBox").textContent()).not.toBe(afterCreate);
  const afterDelete = await page.locator("#statBox").textContent();

  await page.keyboard.press("Control+z");
  await expect.poll(() => page.locator("#statBox").textContent()).not.toBe(afterDelete);
  await expect(page.locator("#statBox")).toHaveText(afterCreate);
});
