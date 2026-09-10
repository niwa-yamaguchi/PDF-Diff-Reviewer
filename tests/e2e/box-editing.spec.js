import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";

const fixture = name => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

async function loadReview(page) {
  await page.goto("/");
  await page.locator("#fileOld").setInputFiles(fixture("old.pdf"));
  await page.locator("#fileNew").setInputFiles(fixture("new.pdf"));
  await page.locator("#run").click();
  await expect(page.locator("#reviewIndexStatus")).toContainText("分析完了");
  await expect(page.locator('[data-review-page="0"] [data-change-id]').first()).toBeVisible();
}

async function editHandleFrame(page) {
  const pixels = await page.locator("#boxLayer").evaluate(canvas => {
    const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const offset = (y * canvas.width + x) * 4;
        if (data[offset] !== 255 || data[offset + 1] !== 255
          || data[offset + 2] !== 255 || data[offset + 3] < 250) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    return { minX, minY, maxX, maxY };
  });
  expect(pixels.maxX).toBeGreaterThan(pixels.minX);
  expect(pixels.maxY).toBeGreaterThan(pixels.minY);
  const layer = await page.locator("#boxLayer").boundingBox();
  const left = layer.x + pixels.minX + 5;
  const right = layer.x + pixels.maxX - 5;
  const top = layer.y + pixels.minY + 5;
  const bottom = layer.y + pixels.maxY - 5;
  return { left, right, top, bottom, midX: (left + right) / 2, midY: (top + bottom) / 2 };
}

async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

test("moves the list-selected box and resizes it from all eight handles", async ({ page }, testInfo) => {
  await loadReview(page);
  const cards = page.locator('[data-review-page="0"] [data-change-id]');
  const total = await cards.count();
  const edited = cards.first();
  await edited.locator("[data-review-edit]").click();
  await expect(edited).toHaveClass(/editing/);
  await expect(edited.locator("[data-review-edit]")).toHaveText("編集を終了");
  await page.keyboard.press("Escape");
  await expect(edited).not.toHaveClass(/editing/);
  await expect(edited.locator("[data-review-edit]")).toHaveText("編集");
  await edited.locator("[data-review-edit]").click();

  const beforeMove = await editHandleFrame(page);
  await drag(page, { x: beforeMove.midX, y: beforeMove.midY },
    { x: beforeMove.midX + 24, y: beforeMove.midY + 20 });
  await expect(page.locator("#statBox")).toContainText("手編集");
  const afterMove = await editHandleFrame(page);
  expect(afterMove.midX).toBeGreaterThan(beforeMove.midX + 12);
  expect(afterMove.midY).toBeGreaterThan(beforeMove.midY + 10);

  const handles = [
    ["north-west", frame => ({ x: frame.left, y: frame.top }), -12, -12],
    ["north", frame => ({ x: frame.midX, y: frame.top }), 0, -12],
    ["north-east", frame => ({ x: frame.right, y: frame.top }), 12, -12],
    ["east", frame => ({ x: frame.right, y: frame.midY }), 12, 0],
    ["south-east", frame => ({ x: frame.right, y: frame.bottom }), 12, 12],
    ["south", frame => ({ x: frame.midX, y: frame.bottom }), 0, 12],
    ["south-west", frame => ({ x: frame.left, y: frame.bottom }), -12, 12],
    ["west", frame => ({ x: frame.left, y: frame.midY }), -12, 0],
  ];
  for (const [name, point, dx, dy] of handles) {
    const before = await editHandleFrame(page);
    const start = point(before);
    await drag(page, start, { x: start.x + dx, y: start.y + dy });
    const after = await editHandleFrame(page);
    if (dx < 0) expect(after.left, name).toBeLessThan(before.left - 5);
    if (dx > 0) expect(after.right, name).toBeGreaterThan(before.right + 5);
    if (dy < 0) expect(after.top, name).toBeLessThan(before.top - 5);
    if (dy > 0) expect(after.bottom, name).toBeGreaterThan(before.bottom + 5);
  }

  await expect(cards).toHaveCount(total);
  await page.screenshot({ path: testInfo.outputPath("list-item-editing.png"), fullPage: true });
});

test("deletes from the list and with Delete, then restores reviewed metadata with Undo", async ({ page }) => {
  await loadReview(page);
  const cards = page.locator('[data-review-page="0"] [data-change-id]');
  const total = await cards.count();
  expect(total).toBeGreaterThan(1);

  const secondId = await cards.nth(1).getAttribute("data-change-id");
  await cards.nth(1).locator("[data-review-delete]").click();
  await expect(page.locator(`[data-change-id="${secondId}"]`)).toHaveCount(0);
  await expect(cards).toHaveCount(total - 1);
  await expect(page.locator("#reviewNotice")).toContainText("Ctrl+Z");

  const firstId = await cards.first().getAttribute("data-change-id");
  const reviewed = page.locator(`[data-change-id="${firstId}"]`);
  await reviewed.locator("[data-review-confirmed]").check();
  await reviewed.locator("textarea").fill("削除後も戻すコメント");
  await reviewed.locator("[data-review-edit]").click();
  await page.keyboard.press("Delete");
  await expect(reviewed).toHaveCount(0);
  await expect(cards).toHaveCount(total - 2);

  await page.keyboard.press("Control+z");
  await expect(reviewed).toHaveCount(1);
  await expect(reviewed.locator("[data-review-confirmed]")).toBeChecked();
  await expect(reviewed.locator("textarea")).toHaveValue("削除後も戻すコメント");
});
