const REQUIRED_IDS = Object.freeze([
  "alignAddNew", "alignDelOld", "alignReadout", "alignUndo", "autoAlign",
  "boxLayer", "boxToggle", "dlPdf", "dlPng",
  "dlTextPdf", "dlTextPng", "dpi", "dpiVal", "dropNew", "dropOld", "fileNew",
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
]);

function required(value, name) {
  if (!value) throw new Error(`Missing required element: ${name}`);
  return value;
}

function requiredCollection(document, selector, name) {
  const values = [...document.querySelectorAll(selector)];
  if (values.length === 0) throw new Error(`Missing required element: ${name}`);
  return Object.freeze(values);
}

export function collectDom(document) {
  const dom = {};
  for (const id of REQUIRED_IDS) {
    dom[id] = required(document.getElementById(id), id);
  }
  dom.canvasWrap = required(document.querySelector(".canvas-wrap"), "canvasWrap");
  dom.oldTextWrap = required(
    document.querySelector(".text-pane.old .text-canvas-wrap"),
    "oldTextWrap",
  );
  dom.newTextWrap = required(
    document.querySelector(".text-pane.new .text-canvas-wrap"),
    "newTextWrap",
  );
  dom.nudgeButtons = requiredCollection(document, ".nudge button[data-dx]", "nudgeButtons");
  dom.quadButtons = requiredCollection(document, "button[data-quad]", "quadButtons");
  dom.rotButtons = requiredCollection(document, "button[data-rot]", "rotButtons");
  dom.scaleButtons = requiredCollection(document, "button[data-scale]", "scaleButtons");
  return Object.freeze(dom);
}
