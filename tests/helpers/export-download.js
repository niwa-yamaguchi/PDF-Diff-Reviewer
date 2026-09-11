import { expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

export async function expectDownload(page, button, filename, capture) {
  const before = await capture(page);
  const pending = page.waitForEvent("download");
  await page.locator(button).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe(filename);
  await expect.poll(() => capture(page)).toEqual(before);
  return download;
}

export async function pngSize(download) {
  const buffer = await readFile(await download.path());
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}
