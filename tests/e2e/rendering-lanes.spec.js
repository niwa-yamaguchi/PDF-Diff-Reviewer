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
  await expect(page.locator("#pageLabel")).toContainText("2 / 2");
  await expect(page.locator("#out")).toBeVisible();

  const download = await pending;
  expect(download.suggestedFilename()).toBe("diff.pdf");
  await expect(page.locator("#status")).not.toContainText("PDFの保存に失敗しました");
});

async function holdIndexWorker(page) {
  // Hold only submission to the second real diff Worker (index lane). Rendering
  // and output still use real PDF.js, Canvas and Worker results throughout.
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    let diffWorkers = 0;
    window.indexJobs = [];
    window.holdIndex = true;
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        this.isIndex = String(url).includes("/workers/diff-worker.js") && ++diffWorkers === 2;
      }
      postMessage(...args) {
        if (this.isIndex && window.holdIndex) window.indexJobs.push(() => super.postMessage(...args));
        else super.postMessage(...args);
      }
    };
    window.releaseIndex = () => {
      window.holdIndex = false;
      for (const job of window.indexJobs.splice(0)) job();
    };
  });
}

test("finishes interactive PNG saving and resumes an index held during page navigation", async ({ page }) => {
  await holdIndexWorker(page);
  await runDiff(page);
  await expect.poll(() => page.evaluate(() => window.indexJobs.length)).toBeGreaterThan(0);
  await expect(page.locator("#reviewIndexStatus")).toContainText("索引作成中");
  await page.locator("#next").click();
  await expect(page.locator("#pageLabel")).toContainText("2 / 2");
  await expect(page.locator("#status")).toHaveText("差分なし");
  const pending = page.waitForEvent("download");
  await page.locator("#dlPng").click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  expect(await download.failure()).toBeNull();
  await page.evaluate(() => window.releaseIndex());
  await expect(page.locator("#reviewIndexStatus")).toHaveText("分析完了 2 / 2 ページ");
  await expect(page.locator("[data-change-id]").first()).toBeVisible();
});

test("keeps PDF export, review input and indexing alive together", async ({ page }) => {
  await holdIndexWorker(page);
  await runDiff(page);
  await expect.poll(() => page.evaluate(() => window.indexJobs.length)).toBeGreaterThan(0);
  const pending = page.waitForEvent("download");
  await page.evaluate(() => {
    document.querySelector("#dlPdf").click();
    document.querySelector("#reviewNext").click();
    window.releaseIndex();
  });
  const selected = page.locator('[data-change-id][aria-current="true"]');
  await selected.locator("select").selectOption("confirmed");
  await selected.locator("textarea").fill("PDF出力中に確認");
  const download = await pending;
  expect(download.suggestedFilename()).toBe("diff.pdf");
  expect(await download.failure()).toBeNull();
  await expect(page.locator("#reviewIndexStatus")).toHaveText("分析完了 2 / 2 ページ");
  await expect(selected.locator("select")).toHaveValue("confirmed");
  await expect(selected.locator("textarea")).toHaveValue("PDF出力中に確認");
  await expect(page.locator("#reviewProgress")).toContainText("完了 1 /");
});
