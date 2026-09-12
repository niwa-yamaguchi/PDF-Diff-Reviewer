import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { jsPDF } from "jspdf";

const fixture = name => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

async function loadReview(page, { multipage = false } = {}) {
  await page.goto("/");
  for (const side of ["Old", "New"]) {
    if (!multipage) {
      await page.locator(`#file${side}`).setInputFiles(fixture(`${side.toLowerCase()}.pdf`));
      continue;
    }
    // Actual PDF pages: a dark change survives small thresholds, a light change
    // appears only above 180 and must never inherit an unrelated review.
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    for (let index = 0; index < 3; index++) {
      if (index) pdf.addPage();
      pdf.text(`DRAWING ${index + 1}`, 40, 40);
      if (side === "Old") pdf.rect(80, 110, 50, 35, "F");
      else {
        pdf.circle(100, 125, 25, "F");
        pdf.setFillColor(180);
        pdf.rect(240, 260, 90, 50, "F");
        pdf.setFillColor(0);
      }
    }
    await page.locator(`#file${side}`).setInputFiles({ name: `${side}.pdf`, mimeType: "application/pdf",
      buffer: Buffer.from(pdf.output("arraybuffer")) });
  }
  await page.locator("#run").click();
  await expect(page.locator("#reviewPanel")).toBeVisible();
  await expect(page.locator("#reviewIndexStatus")).toContainText("分析完了");
  await expect(page.locator("[data-change-id]").first()).toBeVisible();
}

test("reviews all visual changes from the change list", async ({ page }) => {
  await loadReview(page);
  const cards = page.locator("[data-change-id]");
  const total = await cards.count();
  expect(total).toBeGreaterThan(1);
  await expect(page.locator("#reviewTotal")).toHaveText(`変更箇所 ${total}件`);
  await expect(page.locator("#reviewProgress")).toHaveText(`確認済み 0 / ${total}　未確認 ${total}件`);
  await cards.first().locator(".review-select").click();
  const confirmed = cards.first().locator("[data-review-confirmed]");
  await confirmed.check();
  await expect(confirmed).toBeChecked();
  await cards.first().locator("textarea").fill("R105の抵抗値を確認");
  await expect(page.locator("#reviewProgress")).toContainText(`確認済み 1 / ${total}`);
  await expect(page.getByText("対象外", { exact: true })).toHaveCount(0);
  await page.locator("#reviewNext").click();
  await expect(cards.nth(1)).toHaveAttribute("aria-current", "true");
  await expect(page.locator("#boxLayer")).toBeVisible();
  await expect(cards.nth(1)).not.toHaveClass(/editing/);
  await expect(cards.nth(1).locator("[data-review-edit]")).toHaveText("編集");
  await expect(cards.nth(1).locator("[data-review-confirmed]")).not.toBeChecked();
  await page.locator("#reviewPrev").click();
  await expect(cards.first()).toHaveAttribute("aria-current", "true");
  await page.locator("#next").click();
  await expect(page.locator("#pageLabel")).toContainText("2 / 2");
  await page.locator("#prev").click();
  await expect(page.locator("#pageLabel")).toContainText("1 / 2");
  await expect(cards.first().locator("[data-review-confirmed]")).toBeChecked();
  await expect(cards.first().locator("textarea")).toHaveValue("R105の抵抗値を確認");
});

// Break: leaving the highlight control in the viewer toolbar separates it from the change-list workflow.
test("keeps the change highlight control inside the review panel", async ({ page }) => {
  await loadReview(page);
  const highlight = page.locator("#reviewPanel #boxToggle");

  await expect(highlight).toBeVisible();
  await expect(highlight).toHaveClass(/active/);
  await highlight.click();
  await expect(highlight).not.toHaveClass(/active/);
});

// Break: page-local numbering gives a different identifier to the visible row and its accessible controls.
test("numbers changes continuously across all pages", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await loadReview(page, { multipage: true });
  const cards = page.locator("[data-change-id]");
  const count = await cards.count();
  expect(count).toBeGreaterThanOrEqual(3);
  await expect(page.locator(".review-number")).toHaveText(Array.from({ length: count }, (_, index) => String(index + 1)));
  for (const group of await page.locator("[data-review-page]").all()) {
    if (!await group.evaluate(node => node.open)) await group.locator("summary").click();
  }
  for (const [index, card] of (await cards.all()).entries()) {
    const pageIndex = await card.evaluate(node => Number(node.closest("[data-review-page]").dataset.reviewPage));
    const label = `ページ ${pageIndex + 1} 変更 ${index + 1}`;
    await expect(card.locator(".review-select")).toHaveAttribute("aria-label", `${label}を表示`);
    await expect(card.locator("[data-review-confirmed]")).toHaveAttribute("data-review-confirmed", await card.getAttribute("data-change-id"));
    await expect(card.locator("[data-review-confirmed]")).toHaveAccessibleName("確認済み");
    await expect(card.locator("textarea")).toHaveAttribute("aria-label", `${label}のコメント`);
    await expect(card.locator("img")).toHaveAttribute("alt", `${label}の差分画像`);
  }
  await page.screenshot({ path: testInfo.outputPath("global-change-numbers.png"), fullPage: true });
});

test("inherits only matching reviews after threshold redetection", async ({ page }) => {
  await loadReview(page, { multipage: true });
  const first = page.locator("[data-change-id]").first();
  const id = await first.getAttribute("data-change-id");
  await first.locator("[data-review-confirmed]").check();
  await first.locator("textarea").fill("薄い追加図形とは別の確認");
  const changeThreshold = async value => {
    await page.locator("#th").fill(String(value));
    await page.locator("#th").dispatchEvent("change");
    await expect(page.locator("#reviewNotice")).toHaveText(/レビュー\d+件を継承し、\d+件を未確認へ戻しました/);
    await expect(page.locator("#status")).toHaveText("差分を表示中");
  };
  await changeThreshold(129);
  const inherited = page.locator(`[data-change-id="${id}"]`);
  await expect(inherited.locator("[data-review-confirmed]")).toBeChecked();
  await expect(inherited.locator("textarea")).toHaveValue("薄い追加図形とは別の確認");
  const beforeIds = await page.locator("[data-change-id]").evaluateAll(nodes => nodes.map(node => node.dataset.changeId));
  await changeThreshold(220);
  await expect.poll(async () => page.locator("[data-change-id]").count()).toBeGreaterThan(beforeIds.length);
  const newCards = page.locator("[data-change-id]").filter({ has: page.locator(".review-kind.added") });
  expect(await newCards.count()).toBeGreaterThan(0);
  for (const card of await newCards.all()) {
    await expect(card.locator("[data-review-confirmed]")).not.toBeChecked();
    await expect(card.locator("textarea")).toHaveValue("");
  }
});

test("renders thumbnails only for opened pages and selects across pages", async ({ page }) => {
  await loadReview(page, { multipage: true });
  const firstPage = page.locator('[data-review-page="0"]');
  const secondPage = page.locator('[data-review-page="1"]');
  await expect(firstPage.locator("img").first()).toBeVisible();
  await expect(secondPage).not.toHaveAttribute("open");
  await expect(secondPage.locator("img")).toHaveCount(0);
  await secondPage.locator("summary").click();
  await expect(secondPage.locator("img").first()).toBeVisible();
  await expect(page.locator('[data-review-page="2"] img')).toHaveCount(0);
  await secondPage.locator(".review-select").first().click();
  await expect(page.locator("#pageLabel")).toContainText("2 / 3");
  await expect(secondPage.locator("article").first()).toHaveAttribute("aria-current", "true");
  await page.locator("#reviewPrev").click();
  await expect(page.locator("#pageLabel")).toContainText("1 / 3");
  const selected = page.locator('[data-change-id][aria-current="true"]');
  await expect.poll(async () => selected.evaluate((row, list) => {
    const rowBounds = row.getBoundingClientRect();
    const listBounds = list.getBoundingClientRect();
    return rowBounds.top >= listBounds.top && rowBounds.bottom <= listBounds.bottom;
  }, await page.locator("#reviewList").elementHandle())).toBe(true);
});

for (const button of ["#alignAddNew", "#alignDelOld"]) {
  test(`reindexes all pages after ${button} and alignment undo`, async ({ page }) => {
    await loadReview(page, { multipage: true });
    await page.locator(button).click();
    await expect(page.locator("#reviewIndexStatus")).toHaveText("分析完了 4 / 4 ページ");
    await expect(page.locator("[data-review-page]")).toHaveCount(4);
    await expect(page.locator("#reviewNotice")).toHaveText(/レビュー\d+件を継承し、\d+件を未確認へ戻しました/);
    await page.locator("#alignUndo").click({ force: true });
    await expect(page.locator("#reviewIndexStatus")).toHaveText("分析完了 3 / 3 ページ");
    await expect(page.locator("[data-review-page]")).toHaveCount(3);
    const total = await page.locator("[data-change-id]").count();
    await expect(page.locator("#reviewTotal")).toHaveText(`変更箇所 ${total}件`);
  });
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 820, height: 900 }]) {
  test(`keeps the review usable at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await loadReview(page, { multipage: true });
    const panel = page.locator("#reviewPanel");
    const card = page.locator("[data-change-id]").first();
    await card.locator(".review-select").click();
    const confirmed = card.locator("[data-review-confirmed]");
    await confirmed.check();
    const comment = card.locator("textarea");
    await comment.focus();
    // Exercise the browser's composition path on Chromium, including repeated
    // provisional updates. Other engines still verify continuous Japanese input.
    if (testInfo.project.name === "chromium") {
      const session = await page.context().newCDPSession(page);
      for (const text of ["へん", "変更", "変更箇所", "変更箇所を確認"]) {
        await session.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
        await expect(comment).toBeFocused();
      }
      await session.send("Input.insertText", { text: "変更箇所を確認" });
      await session.detach();
    } else await page.keyboard.insertText("変更箇所を確認");
    await page.keyboard.insertText("。抵抗値と配線を続けて入力しました。");
    await expect(comment).toHaveValue("変更箇所を確認。抵抗値と配線を続けて入力しました。");
    await expect(comment).toBeFocused();
    await expect(confirmed).toBeVisible();
    await expect(confirmed).toHaveAccessibleName("確認済み");
    expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const bounds = await panel.boundingBox();
    expect(bounds.width).toBeCloseTo(320, 0);
    const wrap = page.locator(".canvas-wrap");
    expect((await wrap.boundingBox()).height).toBeGreaterThan(200);
    expect((await page.locator("#pageLabel").boundingBox()).height).toBeLessThan(45);
    const selectedFrame = await page.locator("#boxLayer").evaluate(canvas => {
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let white = 0, orange = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] < 250) continue;
        if (pixels[i] === 255 && pixels[i + 1] === 255 && pixels[i + 2] === 255) white++;
        if (pixels[i] === 255 && pixels[i + 1] === 149 && pixels[i + 2] === 0) orange++;
      }
      return { white, orange };
    });
    expect(selectedFrame.white).toBeGreaterThan(0);
    expect(selectedFrame.orange).toBeGreaterThan(0);
    const beforeWidth = (await wrap.boundingBox()).width;
    if (viewport.width === 1280) expect(bounds.x).toBeGreaterThanOrEqual((await wrap.boundingBox()).x + beforeWidth);
    await expect(page.locator("#reviewRailToggle")).toHaveText("»");
    await page.locator("#reviewRailToggle").click();
    await expect(page.locator("#reviewPanel")).toBeHidden();
    await expect(page.locator("#reviewRailToggle")).toHaveText("«");
    await page.locator("#reviewRailToggle").click();
    await expect(page.locator("#reviewPanel")).toBeVisible();
    const pageCenter = () => page.evaluate(() => {
      const wrapNode = document.querySelector(".canvas-wrap");
      const out = document.getElementById("out");
      const match = out.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\) scale\(([\d.]+)\)/);
      const tx = Number(match[1]);
      const ty = Number(match[2]);
      const scale = Number(match[3]);
      return { x: (wrapNode.clientWidth / 2 - tx) / scale, y: (wrapNode.clientHeight / 2 - ty) / scale };
    });
    const waitFrame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (viewport.width === 1280) {
      const transform = () => page.locator("#out").evaluate(node => node.style.transform);
      const beforeZoom = await transform();
      await page.locator("#zoomIn").click();
      await expect.poll(transform).not.toBe(beforeZoom);
      const centerBefore = await pageCenter();
      await page.locator("#reviewRailToggle").click();
      await expect(page.locator("#reviewPanel")).toBeHidden();
      await waitFrame();
      const centerClosed = await pageCenter();
      expect(centerClosed.x).toBeCloseTo(centerBefore.x, 1);
      expect(centerClosed.y).toBeCloseTo(centerBefore.y, 1);
      await page.locator("#reviewRailToggle").click();
      await expect(page.locator("#reviewPanel")).toBeVisible();
      await waitFrame();
      const centerOpened = await pageCenter();
      expect(centerOpened.x).toBeCloseTo(centerBefore.x, 1);
      expect(centerOpened.y).toBeCloseTo(centerBefore.y, 1);
    }
    await page.screenshot({ path: testInfo.outputPath(`review-${viewport.width}.png`), fullPage: true });
    await testInfo.attach(`review-${viewport.width}`, { path: testInfo.outputPath(`review-${viewport.width}.png`), contentType: "image/png" });
    if (viewport.width === 820) await page.locator("#reviewBackdrop").click({ position: { x: 30, y: 300 } });
    else await page.locator("#reviewRailToggle").click();
    await expect(panel).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (viewport.width === 1280) expect((await wrap.boundingBox()).width).toBeGreaterThan(beforeWidth);
    const transform = () => page.locator("#out").evaluate(node => node.style.transform);
    const beforeZoom = await transform();
    await page.locator("#zoomIn").click();
    await expect.poll(transform).not.toBe(beforeZoom);
    const beforePan = await transform();
    const box = await wrap.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 35, { steps: 5 });
    await page.mouse.up();
    await expect.poll(transform).not.toBe(beforePan);
    await page.screenshot({ path: testInfo.outputPath(`review-closed-${viewport.width}.png`), fullPage: true });
  });
}
