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

test("preserves a reviewed box through moving, deleting and undo, and lists manual additions", async ({ page }) => {
  await page.goto("/");
  await page.locator("#fileOld").setInputFiles(fixture("old.pdf"));
  await page.locator("#fileNew").setInputFiles(fixture("new.pdf"));
  await page.locator("#run").click();
  await expect(page.locator("#reviewIndexStatus")).toContainText("分析完了");
  const cards = page.locator("[data-change-id]");
  const total = await cards.count();
  const id = await cards.first().getAttribute("data-change-id");
  const reviewed = page.locator(`[data-change-id="${id}"]`);
  await reviewed.locator("select").selectOption("confirmed");
  await reviewed.locator("textarea").fill("移動しても残すコメント");
  await reviewed.locator(".review-select").click();
  await page.locator("#boxEdit").click();
  const layer = await page.locator("#boxLayer").boundingBox();
  const center = { x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 24, center.y + 20, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator("#statBox")).toContainText("手編集");
  await expect(cards).toHaveCount(total);
  await expect(reviewed.locator("select")).toHaveValue("confirmed");
  await expect(reviewed.locator("textarea")).toHaveValue("移動しても残すコメント");
  await page.keyboard.press("Delete");
  await expect(reviewed).toHaveCount(0);
  await expect(cards).toHaveCount(total - 1);
  await page.keyboard.press("Control+z");
  await expect(cards).toHaveCount(total);
  await expect(reviewed.locator("select")).toHaveValue("confirmed");
  await expect(reviewed.locator("textarea")).toHaveValue("移動しても残すコメント");
  await page.locator("#zoomFit").click();
  const paper = await page.locator("#out").boundingBox();
  const ids = await cards.evaluateAll(nodes => nodes.map(node => node.dataset.changeId));
  await page.mouse.move(paper.x + paper.width * .65, paper.y + paper.height * .65);
  await page.mouse.down();
  await page.mouse.move(paper.x + paper.width * .8, paper.y + paper.height * .75, { steps: 5 });
  await page.mouse.up();
  await expect(cards).toHaveCount(total + 1);
  const newId = await cards.evaluateAll((nodes, prior) => nodes.map(node => node.dataset.changeId).find(id => !prior.includes(id)), ids);
  const added = page.locator(`[data-change-id="${newId}"]`);
  await expect(added.locator(".review-kind")).toHaveText("変更");
  await expect(added.locator("select")).toHaveValue("pending");
  await expect(added.locator("textarea")).toHaveValue("");
});
