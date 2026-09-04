import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

async function runDiff(page) {
  await page.goto("/");
  await page.setInputFiles("#fileOld", join(fixtures, "old.pdf"));
  await page.setInputFiles("#fileNew", join(fixtures, "new.pdf"));
  await expect(page.locator("#run")).toBeEnabled();
  await page.locator("#run").click();
  await expect(page.locator("#status")).toHaveText("差分を表示中");
  await expect(page.locator("#pageLabel")).toContainText("1 / 2");
}

test("starts the newer page render when a page is sent during a running render", async ({ page }) => {
  test.setTimeout(120_000);
  await runDiff(page);

  // 1つのタスクで2回送る。1回目の描画はまだラスタライズ中で、
  // Workerレーンにも到達していない段階で2回目が始まる。
  await page.evaluate(() => {
    document.querySelector("#next").click();
    document.querySelector("#next").click();
  });

  await expect(page.locator("#pageLabel")).toContainText("2 / 2");
  await expect(page.locator("#status")).toHaveText(/差分を表示中|差分なし/);
  await expect(page.locator("#status")).not.toContainText("失敗");
  await expect(page.locator("#out")).toBeVisible();
});

test("keeps a running PDF export alive while pages are sent", async ({ page }) => {
  test.setTimeout(180_000);
  await runDiff(page);

  const pending = page.waitForEvent("download");
  // 出力の開始とページ送りを同じタスクで起こし、出力が確実に実行中である
  // 状態で対話操作レーンを使わせる。
  await page.evaluate(() => {
    document.querySelector("#dlPdf").click();
    document.querySelector("#next").click();
  });
  await expect(page.locator("#pageLabel")).toContainText("2 / 2", { timeout: 30_000 });
  await expect(page.locator("#out")).toBeVisible();

  const download = await pending;
  expect(download.suggestedFilename()).toBe("diff.pdf");
  await expect(page.locator("#status")).not.toContainText("PDFの保存に失敗しました");
});

test("keeps a running side-by-side PDF export alive while pages are sent", async ({ page }) => {
  test.setTimeout(180_000);
  await runDiff(page);
  await page.locator("#modeSplit").click();
  await expect(page.locator("#status")).toHaveText("左右表示中");

  const pending = page.waitForEvent("download");
  await page.evaluate(() => {
    document.querySelector("#dlPdf").click();
    document.querySelector("#next").click();
  });
  await expect(page.locator("#pageLabel")).toContainText("2 / 2", { timeout: 30_000 });
  await expect(page.locator("#visualSplitPanel")).toBeVisible();

  const download = await pending;
  expect(download.suggestedFilename()).toBe("side-by-side.pdf");
  await expect(page.locator("#status")).not.toContainText("PDFの保存に失敗しました");
});
