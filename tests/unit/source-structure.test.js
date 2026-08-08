import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

describe("source structure", () => {
  test("index.html delegates styling and behavior to src/main.js", async () => {
    const html = await readFile("index.html", "utf8");
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/<script>(?:.|\n)*<\/script>/i);
    expect(html).toContain('<script type="module" src="/src/main.js"></script>');
    expect(html).toContain('href="/favicon.png"');
  });

  test("buildDiff rejects render results from an obsolete document generation", async () => {
    const source = await readFile("src/legacy-app.js", "utf8");
    const buildDiff = source.slice(
      source.indexOf("async function buildDiff"),
      source.indexOf("async function buildToggle"),
    );

    expect(buildDiff).toContain("const token = ++state.visual.renderGeneration;");
    expect(buildDiff).toContain("const documentGeneration = state.documents.generation;");
    expect(buildDiff.match(/if\(isStale\(\)\) return;/g)).toHaveLength(3);
  });
});
