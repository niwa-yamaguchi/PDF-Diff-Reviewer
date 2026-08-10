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
});

test("Playwright runs the same suite in Chromium, Firefox, and WebKit", () => {
  expect(playwrightConfig.projects.map(({ name }) => name))
    .toEqual(["chromium", "firefox", "webkit"]);
});

test("index is module-only and carries the final refactoring date", async () => {
  const html = await readFile("index.html", "utf8");
  expect(html).not.toMatch(/<style[\s>]/i);
  expect(html).not.toMatch(/<script(?![^>]*type="module")[^>]*>/i);
  expect(html).toContain('<script type="module" src="/src/main.js"></script>');
  expect(html).toContain("UPDATED 2026-08-10");
  expect(html).not.toContain("1ファイル運用");
  expect(html).not.toMatch(/\son\w+\s*=/i);
});

test("package scripts install all final browsers and validate built artifacts", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  expect(pkg.scripts["test:e2e:install"]).toBe("playwright install chromium firefox webkit");
  expect(pkg.scripts.build).toBe("vite build");
  expect(pkg.scripts.postbuild).toBe("node tests/verify-dist.mjs");
});
