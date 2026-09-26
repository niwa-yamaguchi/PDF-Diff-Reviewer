import { describe, expect, test, vi } from "vitest";
import { collectDom } from "../../src/app/dom.js";
import { createErrorReporter } from "../../src/app/error-reporter.js";

const ids = [
  "alignAddNew", "alignAuto", "alignDelOld", "alignReadout", "alignUndo", "autoAlign",
  "boxLayer", "boxToggle", "dlPdf", "dlPng",
  "dlTextPdf", "dlTextPng", "exportKind", "textExportKind", "dpi", "dpiVal", "dropNew", "dropOld", "fileNew",
  "fileOld", "modeDiff", "modeToggle", "newTextCanvas", "next", "nudgeReset",
  "oldTextCanvas", "out", "pageLabel", "ph", "prev", "quadReset", "rotReset",
  "run", "runText", "scaleReset", "sideNew", "sideOld", "statAd", "statBox",
  "statRm", "status", "textCtrl", "textNext", "textPageInd", "textPanel",
  "textPrev", "textStatus", "textZoom1", "textZoomFit", "textZoomIn", "textZoomOut",
  "th", "thVal", "toggleFlip", "toggleInd", "tolerance", "toleranceVal",
  "topText", "topVisual", "viewbar", "visualCtrl", "zoom1", "zoomFit", "zoomIn",
  "zoomLabel", "zoomOut",
  "reviewPanel", "reviewRail", "reviewRailToggle", "reviewBackdrop", "reviewPrev", "reviewNext",
  "reviewTotal", "reviewProgress", "reviewIndexStatus", "reviewNotice", "reviewList",
  "reviewAdd", "reviewReset",
  "minimap", "minimapCanvas", "pageMapNotice",
];

function fakeDocument({ missing, missingSelector } = {}) {
  const elements = new Map(ids.filter(id => id !== missing).map(id => [id, { id }]));
  const selectors = new Map([
    [".canvas-wrap", { id: "canvasWrap" }],
    [".text-pane.old .text-canvas-wrap", { id: "oldTextWrap" }],
    [".text-pane.new .text-canvas-wrap", { id: "newTextWrap" }],
  ]);
  const collections = new Map([
    [".nudge button[data-dx]", [{ dataset: { dx: "1" } }]],
    ["button[data-quad]", [{ dataset: { quad: "1" } }]],
    ["button[data-rot]", [{ dataset: { rot: "1" } }]],
    ["button[data-scale]", [{ dataset: { scale: "1" } }]],
  ]);
  return {
    getElementById: id => elements.get(id) || null,
    querySelector: selector => selectors.get(selector) || null,
    querySelectorAll: selector => selector === missingSelector ? [] : (collections.get(selector) || []),
  };
}

describe("collectDom", () => {
  // Break: omitting a required review host defers a startup failure until the first review update.
  test("rejects an absent review list at startup", () => {
    expect(() => collectDom(fakeDocument({ missing: "reviewList" })))
      .toThrow("Missing required element: reviewList");
  });
  test("collects every required control and freezes references and collections", () => {
    const dom = collectDom(fakeDocument());
    expect(Object.isFrozen(dom)).toBe(true);
    expect(Object.isFrozen(dom.nudgeButtons)).toBe(true);
    expect(dom.status.id).toBe("status");
    expect(dom.minimap.id).toBe("minimap");
    expect(dom.minimapCanvas.id).toBe("minimapCanvas");
    expect(dom.canvasWrap.id).toBe("canvasWrap");
    expect(dom.oldTextWrap.id).toBe("oldTextWrap");
    expect(dom.nudgeButtons).toHaveLength(1);
  });

  test("throws the exact missing required element error", () => {
    expect(() => collectDom(fakeDocument({ missing: "status" })))
      .toThrow(new Error("Missing required element: status"));
  });

  test("rejects a missing required query collection", () => {
    expect(() => collectDom(fakeDocument({ missingSelector: "button[data-quad]" })))
      .toThrow(new Error("Missing required element: quadButtons"));
  });
});

describe("createErrorReporter", () => {
  test("user messages do not log and report logs the original error once", () => {
    const status = { textContent: "" };
    const textStatus = { textContent: "" };
    const logger = { error: vi.fn() };
    const reporter = createErrorReporter({ status, textStatus }, logger);

    reporter.user("入力を確認してください");
    expect(status.textContent).toBe("入力を確認してください");
    expect(logger.error).not.toHaveBeenCalled();

    const cause = new Error("root cause");
    reporter.report(cause, "処理に失敗しました", textStatus);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(cause);
    expect(textStatus.textContent).toBe("処理に失敗しました");
    expect(status.textContent).toBe("入力を確認してください");
  });
});
