import { expect, test } from "vitest";
import { legendLayout } from "../../src/core/legend/layout.js";

test("returns deterministic geometry from the injected text measurer", () => {
  const layout = legendLayout(
    [{ label: "A", color: "red" }, { label: "BB", color: "blue" }],
    1,
    { chrome: false },
    (label) => label.length * 10,
  );
  expect(layout).toEqual({
    w: 64,
    h: 8,
    fontPx: 8,
    swPx: 8,
    pad: 0,
    chrome: false,
    parts: [
      { swX: 0, textX: 12 },
      { swX: 32, textX: 44 },
    ],
  });
  expect(layout.parts[1].swX).toBeGreaterThan(layout.parts[0].textX);
  expect(layout.w).toBeGreaterThan(30);
});
