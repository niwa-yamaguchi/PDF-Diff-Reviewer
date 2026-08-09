import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const fixture = name => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

test("extracts and displays the text comparison", async ({ page }) => {
  await page.goto("/");
  await page.locator("#fileOld").setInputFiles(fixture("old.pdf"));
  await page.locator("#fileNew").setInputFiles(fixture("new.pdf"));
  await page.locator("#topText").click();
  await page.locator("#runText").click();

  await expect(page.locator("#textStatus")).toHaveText("テキスト差分を表示中");
  await expect(page.locator("#oldTextCanvas")).toBeVisible();
  await expect(page.locator("#newTextCanvas")).toBeVisible();
  await expect.poll(() => page.locator("#oldTextCanvas").evaluate(canvas => canvas.width)).toBeGreaterThan(10);
  await expect.poll(() => page.locator("#newTextCanvas").evaluate(canvas => canvas.width)).toBeGreaterThan(10);

  await page.locator("#textNext").click();
  await expect(page.locator("#textPageInd")).toHaveText("2 / 2");
  await page.locator("#textZoomIn").click();
  const transformed = await page.locator("#oldTextCanvas").evaluate(canvas => canvas.style.transform);
  await page.locator("#topVisual").click();
  await page.locator("#topText").click();
  await expect(page.locator("#textPageInd")).toHaveText("2 / 2");
  await expect.poll(() => page.locator("#oldTextCanvas").evaluate(canvas => canvas.style.transform)).toBe(transformed);
});
