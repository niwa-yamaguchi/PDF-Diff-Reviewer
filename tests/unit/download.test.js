import { afterEach, expect, test, vi } from "vitest";
import { downloadBlob } from "../../src/platform/download.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("revokes a download Blob URL after the next task", async () => {
  vi.useFakeTimers();
  const revokeObjectURL = vi.fn();
  const click = vi.fn();
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:download"),
    revokeObjectURL,
  });
  vi.stubGlobal("document", {
    createElement: vi.fn(() => ({ click })),
  });

  downloadBlob(new Blob(["image"]), "diff_p1.png");

  await Promise.resolve();
  expect(revokeObjectURL).not.toHaveBeenCalled();

  vi.runOnlyPendingTimers();
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:download");
});
