import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const fixture = name => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

async function loadReview(page) {
  await page.goto("/");
  await page.locator("#fileOld").setInputFiles(fixture("old.pdf"));
  await page.locator("#fileNew").setInputFiles(fixture("new.pdf"));
  await page.locator("#run").click();
  await expect(page.locator("#reviewPanel")).toBeVisible();
  await expect(page.locator("#reviewIndexStatus")).toContainText("分析完了");
  await expect(page.locator("[data-change-id]").first()).toBeVisible();
}

test("shows the overview minimap after thumbnail zoom and hides it when fitted", async ({ page }) => {
  await loadReview(page);
  await page.locator("[data-review-thumbnail]").first().click();
  await expect(page.locator("#minimap")).toBeVisible();
  const before = await page.locator("#out").evaluate(node => node.style.transform);
  await page.locator("#minimapCanvas").click({ position: { x: 150, y: 110 } });
  await expect.poll(() => page.locator("#out").evaluate(node => node.style.transform)).not.toBe(before);
  await page.locator("#zoomFit").click();
  await expect(page.locator("#minimap")).toBeHidden();
});

test("drags the minimap with repeated transforms and stays clear of the narrow drawer", async ({ page }) => {
  await loadReview(page);
  await page.locator("[data-review-thumbnail]").first().click();
  await expect(page.locator("#minimap")).toBeVisible();
  const canvas = page.locator("#minimapCanvas");
  const box = await canvas.boundingBox();
  const transform = () => page.locator("#out").evaluate(node => node.style.transform);
  const seen = new Set([await transform()]);
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  for (const [dx, dy] of [[30, 20], [50, 40], [80, 70]]) {
    await page.mouse.move(box.x + dx, box.y + dy, { steps: 2 });
    seen.add(await transform());
  }
  await page.mouse.up();
  expect(seen.size).toBeGreaterThan(2);

  await page.setViewportSize({ width: 820, height: 900 });
  await expect(page.locator("#reviewPanel")).toBeVisible();
  await expect(page.locator("#minimap")).toBeVisible();
  const mini = await page.locator("#minimap").boundingBox();
  const panel = await page.locator("#reviewPanel").boundingBox();
  expect(mini.x + mini.width).toBeLessThanOrEqual(panel.x + 1);
  expect(await page.locator("#minimap").evaluate(node => getComputedStyle(node).left)).toBe("14px");
  expect(mini.x).toBeLessThan(panel.x);
});
