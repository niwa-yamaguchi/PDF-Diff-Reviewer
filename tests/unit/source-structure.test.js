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
});
