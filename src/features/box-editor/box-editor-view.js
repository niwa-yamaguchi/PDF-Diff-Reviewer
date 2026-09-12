import { normalizeRect } from "../../core/geometry/rectangles.js";

const BOX_COLOR = "#ff9500";
const BOX_FILL = "rgba(255,149,0,0.18)";
const HANDLE_SCREEN_PX = 5;

function handlePoints(x, y, width, height) {
  return [
    [x, y], [x + width / 2, y], [x + width, y], [x + width, y + height / 2],
    [x + width, y + height], [x + width / 2, y + height], [x, y + height], [x, y + height / 2],
  ];
}

export function drawBoxLayer({
  canvas,
  boxes = [],
  activeIndex = -1,
  focusedIndex = -1,
  view = { scale: 1, tx: 0, ty: 0 },
  showBoxes,
  editing,
  drag,
  currentPage,
  rendered = true,
  outputVisible = true,
  layerSize,
}) {
  const width = layerSize?.width ?? canvas.clientWidth;
  const height = layerSize?.height ?? canvas.clientHeight;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, width, height);
  if (!rendered || !outputVisible || !showBoxes) return;
  const activeDrag = drag && (currentPage == null || drag.page === currentPage) ? drag : null;
  if (!boxes.length && !activeDrag) return;

  const scale = view.scale;
  const preview = activeDrag?.preview || null;
  context.save();
  context.fillStyle = BOX_FILL;
  context.strokeStyle = BOX_COLOR;
  context.lineWidth = 2;
  boxes.forEach((box, index) => {
    const drawn = preview && activeDrag.i === index ? preview : box;
    const x = view.tx + drawn.x * scale;
    const y = view.ty + drawn.y * scale;
    const boxWidth = drawn.w * scale;
    const boxHeight = drawn.h * scale;
    context.fillRect(x, y, boxWidth, boxHeight);
    context.strokeRect(x + 1, y + 1, Math.max(0, boxWidth - 2), Math.max(0, boxHeight - 2));
  });

  if (focusedIndex >= 0 && focusedIndex < boxes.length) {
    const focused = preview && activeDrag.i === focusedIndex ? preview : boxes[focusedIndex];
    const x = view.tx + focused.x * scale;
    const y = view.ty + focused.y * scale;
    const boxWidth = focused.w * scale;
    const boxHeight = focused.h * scale;
    context.setLineDash([]);
    context.strokeStyle = "#fff";
    context.lineWidth = 2;
    context.strokeRect(x - 2, y - 2, boxWidth + 4, boxHeight + 4);
  }

  if (editing && activeIndex >= 0 && activeIndex < boxes.length) {
    const selected = preview && activeDrag.i === activeIndex ? preview : boxes[activeIndex];
    const x = view.tx + selected.x * scale;
    const y = view.ty + selected.y * scale;
    const boxWidth = selected.w * scale;
    const boxHeight = selected.h * scale;
    context.setLineDash([5, 4]);
    context.strokeStyle = "#fff";
    context.lineWidth = 1;
    context.strokeRect(x, y, boxWidth, boxHeight);
    context.setLineDash([]);
    for (const [handleX, handleY] of handlePoints(x, y, boxWidth, boxHeight)) {
      context.fillStyle = "#fff";
      context.fillRect(handleX - HANDLE_SCREEN_PX, handleY - HANDLE_SCREEN_PX, HANDLE_SCREEN_PX * 2, HANDLE_SCREEN_PX * 2);
      context.strokeStyle = BOX_COLOR;
      context.strokeRect(handleX - HANDLE_SCREEN_PX, handleY - HANDLE_SCREEN_PX, HANDLE_SCREEN_PX * 2, HANDLE_SCREEN_PX * 2);
    }
  }

  if (activeDrag?.kind === "create") {
    const box = normalizeRect(activeDrag.x0, activeDrag.y0, activeDrag.x1, activeDrag.y1);
    context.setLineDash([4, 3]);
    context.strokeStyle = BOX_COLOR;
    context.lineWidth = 2;
    context.strokeRect(
      view.tx + box.x * scale,
      view.ty + box.y * scale,
      box.w * scale,
      box.h * scale,
    );
    context.setLineDash([]);
  }
  context.restore();
}

export function createBoxEditorView({ state, dom, getView }) {
  function redraw() {
    const boxes = state.boxEditor.currentBoxes || [];
    const focusedIndex = boxes.findIndex(box => box.id === state.review?.selectedId);
    drawBoxLayer({
      canvas: dom.canvas,
      boxes,
      activeIndex: focusedIndex,
      focusedIndex,
      view: getView(),
      showBoxes: state.boxEditor.showBoxes,
      editing: state.boxEditor.mode === "edit",
      drag: state.boxEditor.drag,
      currentPage: state.documents.currentPage,
      rendered: state.visual.rendered,
      outputVisible: dom.out.style.display !== "none",
      layerSize: { width: dom.wrap.clientWidth, height: dom.wrap.clientHeight },
    });
  }

  function updateStat() {
    if (state.visual.mode === "toggle" && !state.boxEditor.showBoxes) {
      dom.statBox.textContent = "変更箇所 —";
      return;
    }
    const count = state.boxEditor.currentBoxes?.length || 0;
    const edited = state.boxEditor.editsByPage.has(state.documents.currentPage);
    dom.statBox.textContent = `変更箇所 ${count.toLocaleString()}${edited ? "（手編集）" : ""}`;
  }

  function updateControls() {
    const on = state.boxEditor.mode === "edit" || state.boxEditor.mode === "create";
    dom.wrap.classList.toggle("boxedit", on);
    dom.boxToggle.checked = state.boxEditor.showBoxes;
  }

  function refresh() {
    updateStat();
    updateControls();
    redraw();
  }

  return {
    redraw,
    refresh,
    updateStat,
    updateControls,
    toImagePoint(event) {
      if (Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
        const rect = dom.wrap.getBoundingClientRect();
        const view = getView();
        return {
          x: (event.clientX - rect.left - view.tx) / view.scale,
          y: (event.clientY - rect.top - view.ty) / view.scale,
        };
      }
      return { x: event.x, y: event.y };
    },
    getScale: () => getView().scale,
    getFrameSize: () => ({ width: dom.out.width, height: dom.out.height }),
    capturePointer: pointerId => dom.wrap.setPointerCapture(pointerId),
    releasePointer: pointerId => dom.wrap.releasePointerCapture(pointerId),
    setCursor: cursor => { dom.wrap.style.cursor = cursor; },
  };
}
