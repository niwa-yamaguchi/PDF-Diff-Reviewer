import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expectDownload, pngSize } from "../helpers/export-download.js";

const fixture = name => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
const acceptanceDir = fileURLToPath(new URL(
  "../../.superpowers/sdd/2026-09-10-unified-change-review-editor/acceptance/",
  import.meta.url,
));

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

async function exportView(page) {
  return page.evaluate(() => ({
    minimapHidden: document.querySelector("#minimap").hidden,
    transform: document.querySelector("#out").style.transform,
    out: [document.querySelector("#out").width, document.querySelector("#out").height],
    mini: [document.querySelector("#minimapCanvas").width, document.querySelector("#minimapCanvas").height],
  }));
}

test("names review controls and keeps the minimap out of PNG export", async ({ page }) => {
  await loadReview(page);
  await expect(page.locator("#reviewRailToggle")).toHaveAttribute("aria-label", "変更箇所を閉じる");
  await expect(page.locator("[data-review-confirmed]").first()).toHaveAccessibleName(/確認済み/);
  await page.locator("[data-review-edit]").first().focus();
  await expect(page.locator("[data-review-edit]").first()).toBeFocused();

  await page.locator("[data-review-thumbnail]").first().click();
  await expect(page.locator("#minimap")).toBeVisible();
  const view = await exportView(page);
  expect(view.minimapHidden).toBe(false);
  const download = await expectDownload(page, "#dlPng", "diff_p1.png", exportView);
  const size = await pngSize(download);
  expect(size).toEqual({ width: view.out[0], height: view.out[1] });
  expect(size).not.toEqual({ width: view.mini[0], height: view.mini[1] });
});

test("captures unified inspector acceptance screenshots", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "acceptance shots are captured once on Chromium");
  await mkdir(acceptanceDir, { recursive: true });
  const shot = name => page.screenshot({ path: `${acceptanceDir}${name}`, fullPage: true });
  const noOverflow = async () => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  };

  await page.setViewportSize({ width: 1280, height: 800 });
  await loadReview(page);
  const card = page.locator("[data-change-id]").first();
  await expect(card.locator("[data-review-confirmed]")).toBeVisible();
  await expect(card.locator("[data-review-edit]")).toHaveText("編集");
  await expect(card.locator("[data-review-delete]")).toHaveText("削除");
  await noOverflow();
  await shot("1280-sidebar-open.png");

  await page.locator("#reviewRailToggle").click();
  await expect(page.locator("#reviewPanel")).toBeHidden();
  await expect(page.locator("#reviewRailToggle")).toHaveText("«");
  await noOverflow();
  await shot("1280-sidebar-closed.png");
  await page.locator("#reviewRailToggle").click();
  await expect(page.locator("#reviewPanel")).toBeVisible();

  await card.locator("[data-review-edit]").click();
  await expect(card).toHaveClass(/editing/);
  await expect(page.locator("#boxLayer")).toBeVisible();
  await noOverflow();
  await shot("1280-eight-handles.png");
  await page.keyboard.press("Escape");
  await expect(card).not.toHaveClass(/editing/);

  await page.locator("#reviewAdd").click();
  await expect(page.locator(".canvas-wrap")).toHaveCSS("cursor", "crosshair");
  const wrap = await page.locator(".canvas-wrap").boundingBox();
  await page.mouse.move(wrap.x + 90, wrap.y + 80);
  await page.mouse.down();
  await page.mouse.move(wrap.x + 220, wrap.y + 180, { steps: 4 });
  await noOverflow();
  await shot("1280-create-preview.png");
  await page.mouse.up();
  await page.keyboard.press("Escape");

  await page.locator("[data-review-thumbnail]").first().click();
  await expect(page.locator("#minimap")).toBeVisible();
  await noOverflow();
  await shot("1280-minimap.png");

  await page.setViewportSize({ width: 820, height: 900 });
  await expect(page.locator("#reviewPanel")).toBeVisible();
  await expect(page.locator("#minimap")).toBeVisible();
  const mini = await page.locator("#minimap").boundingBox();
  const panel = await page.locator("#reviewPanel").boundingBox();
  expect(mini.x + mini.width).toBeLessThanOrEqual(panel.x + 1);
  await noOverflow();
  await shot("820-drawer-minimap.png");
});
