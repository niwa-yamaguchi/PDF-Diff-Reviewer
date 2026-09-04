import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import playwrightConfig from "../../playwright.config.js";

test("README documents the reproducible Vite and Cloudflare Pages workflow", async () => {
  const readme = await readFile("README.md", "utf8");
  for (const command of [
    "npm ci", "npm run dev", "npm run test", "npm run test:e2e",
    "npm run build", "npm run preview",
  ]) {
    expect(readme).toContain(command);
  }
  expect(readme).toContain("Node.js 22.12");
  expect(readme).toContain("Build command: `npm run build`");
  expect(readme).toContain("Build output directory: `dist`");
  expect(readme).toContain("Production branch: `main`");
  expect(readme).toMatch(/ブラウザ内.*外部.*送信しない/s);
  expect(readme).toMatch(/実行時.*CDN.*不要/s);
  for (const directory of ["src/app/", "src/features/", "src/core/", "src/platform/", "src/workers/"]) {
    expect(readme).toContain(directory);
  }
});

test("README documents the side-by-side review and export workflow", async () => {
  const readme = await readFile("README.md", "utf8");
  expect(readme).toMatch(/左右表示.*旧版（左）.*位置合わせ済み新版（右）/s);
  expect(readme).toMatch(/左右表示.*ズーム.*パン.*全体表示.*1:1.*ページ送り.*同期/s);
  expect(readme).toMatch(/左右表示.*変更枠.*両側.*常時.*差分表示.*編集/s);
  expect(readme).toMatch(/左右表示.*PNG.*現在ページ.*PDF.*全ページ.*フル解像度.*横並び/s);
  expect(readme).toMatch(/ブラウザ内.*外部.*送信しない/s);
});

test("Playwright runs the same suite in Chromium, Firefox, and WebKit", () => {
  expect(playwrightConfig.projects.map(({ name }) => name))
    .toEqual(["chromium", "firefox", "webkit"]);
});

test("Playwright pins its worker count instead of scaling with the host CPU", () => {
  expect(playwrightConfig.workers).toBeTypeOf("number");
  expect(playwrightConfig.workers).toBeGreaterThan(0);
  expect(playwrightConfig.workers).toBeLessThanOrEqual(4);
});

test("index is module-only and carries the final refactoring date", async () => {
  const html = await readFile("index.html", "utf8");
  expect(html).not.toMatch(/<style[\s>]/i);
  expect(html).not.toMatch(/<script(?![^>]*type="module")[^>]*>/i);
  expect(html).toContain('<script type="module" src="/src/main.js"></script>');
  expect(html).toContain("UPDATED 2026-09-04");
  expect(html).not.toContain("1ファイル運用");
  expect(html).not.toMatch(/\son\w+\s*=/i);
});

test("package scripts install all final browsers and validate built artifacts", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  expect(pkg.scripts["test:e2e:install"]).toBe("playwright install chromium firefox webkit");
  expect(pkg.scripts.build).toBe("vite build");
  expect(pkg.scripts.postbuild).toBe("node tests/verify-dist.mjs");
});
