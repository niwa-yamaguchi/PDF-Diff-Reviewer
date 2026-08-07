import { expect, test } from "vitest";
import { reconstructLinesInItemOrder } from "../../src/core/text-diff/tokens.js";

const item = (str, x, y) => ({ str, width: str.length * 5, transform: [10, 0, 0, 10, x, y] });

test("reconstructs lines by y and tokens by x", () => {
  const lines = reconstructLinesInItemOrder([
    item("B", 20, 100), item("A", 10, 100), item("C", 10, 80),
  ]);
  expect(lines.map((line) => line.text)).toEqual(["AB", "C"]);
});
