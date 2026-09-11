import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { expect, test } from "vitest";

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  }))).flat();
}

test("core imports neither app, features, platform nor browser globals", async () => {
  for (const path of await filesUnder("src/core")) {
    if (extname(path) !== ".js") continue;
    const source = await readFile(path, "utf8");
    expect(source, path).not.toMatch(/from\s+["'][^"']*(?:app|features|platform)\//);
    expect(source, path).not.toMatch(/\b(?:document|window|pdfjsLib)\b/);
  }
});

test("feature modules do not import app or another feature directory", async () => {
  for (const path of await filesUnder("src/features")) {
    if (extname(path) !== ".js") continue;
    const source = await readFile(path, "utf8");
    expect(source, path).not.toMatch(/from\s+["'][^"']*\/app\//);
    expect(source, path).not.toMatch(/\bconsole\.(?:log|warn|error|debug)\b/);
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      const owner = relative("src/features", path).split(/[\\/]/)[0];
      const imported = match[1].startsWith(".")
        ? resolve(dirname(path), match[1]).replaceAll("\\", "/")
        : match[1];
      if (!imported.includes("/features/")) continue;
      expect(imported, path).toContain(`/features/${owner}/`);
    }
  }
});

test("workers import core only and stay free of browser document globals", async () => {
  const paths = (await filesUnder("src/workers")).filter(path => extname(path) === ".js");
  expect(paths.length).toBeGreaterThan(0);
  for (const path of paths) {
    const source = await readFile(path, "utf8");
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      expect(match[1], path).toMatch(/^\.\.\/core\//);
    }
    expect(source, path).not.toMatch(/\b(?:document|window|pdfjsLib)\b/);
  }
});

test("minimap geometry stays free of app and DOM imports", async () => {
  const source = await readFile("src/features/viewer/minimap-geometry.js", "utf8");
  expect(source).not.toMatch(/from\s+["'][^"']*\/app\//);
  expect(source).not.toMatch(/\b(?:document|window|documentElement)\b/);
});

test("migration bridge has been removed", async () => {
  await expect(access("src/legacy-app.js", constants.F_OK)).rejects.toThrow();
});

test("event listeners are registered only by bind-controls", async () => {
  for (const path of await filesUnder("src")) {
    if (extname(path) !== ".js") continue;
    const normalized = path.replaceAll("\\", "/");
    const source = await readFile(path, "utf8");
    if (normalized === "src/app/bind-controls.js") continue;
    expect(source, normalized).not.toContain("addEventListener");
  }
});

test("main is a thin, single startup entrypoint", async () => {
  const source = await readFile("src/main.js", "utf8");
  expect(source.match(/createApp\s*\(/g)).toHaveLength(1);
  expect(source).toMatch(/createApp\s*\(\s*\{\s*document\s*,\s*window\s*\}\s*\)/);
  expect(source).not.toContain("legacy-app");
});
