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

async function splitCanvasState(page) {
  return page.evaluate(() => {
    const inspect = (selector) => {
      const canvas = document.querySelector(selector);
      const { data } = canvas.getContext("2d").getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      );
      let checksum = 2166136261;
      for (let index = 0; index < data.length; index += 97) {
        checksum ^= data[index];
        checksum = Math.imul(checksum, 16777619);
      }
      return {
        dimensions: [canvas.width, canvas.height],
        checksum: checksum >>> 0,
      };
    };
    return {
      page: document.querySelector("#pageLabel").textContent,
      old: inspect("#splitOldCanvas"),
      new: inspect("#splitNewCanvas"),
    };
  });
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
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    let nextWorkerId = 1;
    window.__workerJobs = [];
    window.Worker = class InstrumentedWorker extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.__testWorkerId = nextWorkerId++;
      }

      postMessage(...args) {
        window.__workerJobs.push({
          workerId: this.__testWorkerId,
          type: args[0]?.type || null,
        });
        return super.postMessage(...args);
      }
    };
  });
  await runDiff(page);
  await page.locator("#modeSplit").click();
  await expect(page.locator("#status")).toHaveText("左右表示中");
  await page.locator("#next").click();
  await expect(page.locator("#pageLabel")).toContainText("2 / 2");
  for (const total of [3, 4, 5]) {
    await page.locator("#alignDelOld").click();
    await expect(page.locator("#pageLabel")).toContainText(`2 / ${total}`, {
      timeout: 30_000,
    });
    await expect(page.locator("#status")).toHaveText("左右表示中");
  }
  await page.locator("#prev").click();
  await expect(page.locator("#pageLabel")).toContainText("1 / 5", { timeout: 30_000 });
  const before = await splitCanvasState(page);

  let downloadStarted = false;
  const pending = page.waitForEvent("download").then((download) => {
    downloadStarted = true;
    return download;
  });
  await page.evaluate(() => {
    document.querySelector("#dlPdf").click();
    document.querySelector("#next").click();
  });
  await expect.poll(async () => {
    const current = await splitCanvasState(page);
    return current.page.includes("2 / 5")
      && current.old.dimensions.every(value => value > 10)
      && current.new.dimensions.every(value => value > 10)
      && current.old.checksum !== before.old.checksum
      && current.new.checksum !== before.new.checksum;
  }, { timeout: 30_000 }).toBe(true);
  expect(downloadStarted).toBe(false);
  const after = await splitCanvasState(page);
  expect(after.old.dimensions).toEqual(before.old.dimensions);
  expect(after.new.dimensions).toEqual(before.new.dimensions);
  await expect(page.locator("#visualSplitPanel")).toBeVisible();

  const download = await pending;
  expect(download.suggestedFilename()).toBe("side-by-side.pdf");
  expect(await download.path()).not.toBeNull();
  const workerIds = await page.evaluate(() => (
    [...new Set(
      window.__workerJobs
        .filter(job => ["diff", "align", "quadrant"].includes(job.type))
        .map(job => job.workerId),
    )]
  ));
  expect(workerIds.length).toBeGreaterThanOrEqual(2);
  await expect(page.locator("#status")).not.toContainText("PDFの保存に失敗しました");
});
