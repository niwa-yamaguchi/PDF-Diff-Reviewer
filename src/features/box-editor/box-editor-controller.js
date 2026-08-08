import { clampBox, normalizeRect } from "../../core/geometry/rectangles.js";
import { createBoxHistory } from "./box-history.js";

const HANDLE_SCREEN_PX = 5;
const MIN_DRAG_SCREEN_PX = 4;
const HANDLE_DIRS = [
  [-1, -1], [0, -1], [1, -1], [1, 0],
  [1, 1], [0, 1], [-1, 1], [-1, 0],
];
const HANDLE_CURSORS = [
  "nwse-resize", "ns-resize", "nesw-resize", "ew-resize",
  "nwse-resize", "ns-resize", "nesw-resize", "ew-resize",
];

function cloneBoxes(boxes) {
  return (boxes || []).map(box => ({ ...box }));
}

function handlePoints(box) {
  return [
    [box.x, box.y],
    [box.x + box.w / 2, box.y],
    [box.x + box.w, box.y],
    [box.x + box.w, box.y + box.h / 2],
    [box.x + box.w, box.y + box.h],
    [box.x + box.w / 2, box.y + box.h],
    [box.x, box.y + box.h],
    [box.x, box.y + box.h / 2],
  ];
}

export function createBoxEditorController({ state, dom, view, confirmDiscard }) {
  const refresh = () => {
    if (view.refresh) view.refresh();
    else view.redraw?.();
  };
  const scale = () => view.getScale?.() ?? view.getView?.().scale ?? 1;
  const frameSize = () => view.getFrameSize?.() ?? {
    width: dom.out?.width ?? 0,
    height: dom.out?.height ?? 0,
  };
  const pointFrom = event => view.toImagePoint ? view.toImagePoint(event) : { x: event.x, y: event.y };

  function historyFor(pageIndex) {
    let history = state.boxEditor.undoByPage.get(pageIndex);
    if (!history || typeof history.push !== "function" || typeof history.undo !== "function") {
      history = createBoxHistory(50);
      state.boxEditor.undoByPage.set(pageIndex, history);
    }
    return history;
  }

  function pushUndo(pageIndex, boxes) {
    historyFor(pageIndex).push(boxes);
  }

  function materializeEdits(pageIndex = state.documents.currentPage) {
    if (!state.boxEditor.editsByPage.has(pageIndex)) {
      const source = pageIndex === state.documents.currentPage
        ? state.boxEditor.currentBoxes
        : state.boxEditor.autoByPage.get(pageIndex);
      state.boxEditor.editsByPage.set(pageIndex, cloneBoxes(source));
    }
    const edits = state.boxEditor.editsByPage.get(pageIndex);
    if (pageIndex === state.documents.currentPage) state.boxEditor.currentBoxes = edits;
    return edits;
  }

  function hitBox(point) {
    const boxes = state.boxEditor.currentBoxes || [];
    for (let index = boxes.length - 1; index >= 0; index -= 1) {
      const box = boxes[index];
      if (
        point.x >= box.x && point.x <= box.x + box.w
        && point.y >= box.y && point.y <= box.y + box.h
      ) return index;
    }
    return -1;
  }

  function hitHandle(point) {
    const index = state.boxEditor.selectedIndex;
    const boxes = state.boxEditor.currentBoxes || [];
    if (index < 0 || index >= boxes.length) return -1;
    const radius = HANDLE_SCREEN_PX / scale();
    const points = handlePoints(boxes[index]);
    for (let handle = 0; handle < points.length; handle += 1) {
      if (
        Math.abs(point.x - points[handle][0]) <= radius
        && Math.abs(point.y - points[handle][1]) <= radius
      ) return handle;
    }
    return -1;
  }

  function releaseDrag(drag) {
    try { view.releasePointer?.(drag.pointerId); } catch (_) { /* capture may already be gone */ }
  }

  function cancelDrag(event) {
    const drag = state.boxEditor.drag;
    if (!drag) return false;
    if (event?.pointerId != null && event.pointerId !== drag.pointerId) return false;
    state.boxEditor.drag = null;
    releaseDrag(drag);
    refresh();
    return true;
  }

  function isTooSmall(box) {
    return box.w * scale() < MIN_DRAG_SCREEN_PX || box.h * scale() < MIN_DRAG_SCREEN_PX;
  }

  function pointerDown(event) {
    if (!state.boxEditor.editMode || event.button === 2) return false;
    event.preventDefault?.();
    const point = pointFrom(event);
    const pointerId = event.pointerId;
    const page = state.documents.currentPage;
    view.capturePointer?.(pointerId);

    const handle = hitHandle(point);
    if (handle >= 0) {
      const index = state.boxEditor.selectedIndex;
      state.boxEditor.drag = {
        kind: "resize", handle, i: index, page, pointerId,
        orig: { ...state.boxEditor.currentBoxes[index] }, preview: null,
      };
      refresh();
      return true;
    }

    const hit = hitBox(point);
    if (hit >= 0) {
      state.boxEditor.selectedIndex = hit;
      state.boxEditor.drag = {
        kind: "move", i: hit, page, pointerId,
        ox: point.x, oy: point.y,
        orig: { ...state.boxEditor.currentBoxes[hit] }, preview: null,
      };
    } else {
      state.boxEditor.selectedIndex = -1;
      state.boxEditor.drag = {
        kind: "create", page, pointerId,
        x0: point.x, y0: point.y, x1: point.x, y1: point.y,
      };
    }
    refresh();
    return true;
  }

  function pointerMove(event) {
    const drag = state.boxEditor.drag;
    if (!drag || event.pointerId !== drag.pointerId || drag.page !== state.documents.currentPage) return false;
    const point = pointFrom(event);
    const { width, height } = frameSize();
    if (drag.kind === "create") {
      drag.x1 = point.x;
      drag.y1 = point.y;
    } else if (drag.kind === "move") {
      const maxX = Math.max(0, width - drag.orig.w);
      const maxY = Math.max(0, height - drag.orig.h);
      drag.preview = {
        x: Math.min(Math.max(0, drag.orig.x + point.x - drag.ox), maxX),
        y: Math.min(Math.max(0, drag.orig.y + point.y - drag.oy), maxY),
        w: drag.orig.w,
        h: drag.orig.h,
      };
    } else if (drag.kind === "resize") {
      const [sx, sy] = HANDLE_DIRS[drag.handle];
      let { x, y, w, h } = drag.orig;
      if (sx < 0) { const right = x + w; x = point.x; w = right - x; }
      else if (sx > 0) w = point.x - x;
      if (sy < 0) { const bottom = y + h; y = point.y; h = bottom - y; }
      else if (sy > 0) h = point.y - y;
      drag.preview = clampBox(normalizeRect(x, y, x + w, y + h), width, height);
    }
    refresh();
    return true;
  }

  function pointerUp(event) {
    const drag = state.boxEditor.drag;
    if (!drag || event.pointerId !== drag.pointerId) return false;
    state.boxEditor.drag = null;
    releaseDrag(drag);
    if (drag.page !== state.documents.currentPage) {
      refresh();
      return false;
    }
    const page = drag.page;
    const { width, height } = frameSize();

    if (drag.kind === "create") {
      const box = clampBox(normalizeRect(drag.x0, drag.y0, drag.x1, drag.y1), width, height);
      if (!isTooSmall(box)) {
        pushUndo(page, state.boxEditor.currentBoxes || []);
        const edits = materializeEdits(page);
        edits.push(box);
        state.boxEditor.selectedIndex = edits.length - 1;
      }
    } else {
      const boxes = state.boxEditor.currentBoxes;
      if (drag.i >= 0 && boxes && drag.i < boxes.length) {
        const next = drag.preview;
        const changed = next && (
          next.x !== drag.orig.x || next.y !== drag.orig.y
          || next.w !== drag.orig.w || next.h !== drag.orig.h
        );
        if (changed && !(drag.kind === "resize" && isTooSmall(next))) {
          pushUndo(page, boxes);
          materializeEdits(page)[drag.i] = { ...next };
        }
      }
    }
    refresh();
    return true;
  }

  function pointerCancel(event) {
    return cancelDrag(event);
  }

  function setEditMode(on) {
    if (on && !state.visual.rendered) return false;
    if (!on) cancelDrag();
    state.boxEditor.editMode = !!on;
    state.boxEditor.selectedIndex = -1;
    if (on && !state.boxEditor.showBoxes) {
      state.boxEditor.showBoxes = true;
      dom.onBoxesShown?.();
    }
    if (!on) view.setCursor?.("");
    refresh();
    return true;
  }

  function toggleBoxes() {
    if (!state.visual.rendered) return false;
    state.boxEditor.showBoxes = !state.boxEditor.showBoxes;
    if (!state.boxEditor.showBoxes && state.boxEditor.editMode) setEditMode(false);
    if (state.boxEditor.showBoxes) {
      const page = state.documents.currentPage;
      if (!state.boxEditor.editsByPage.has(page) && state.boxEditor.autoByPage.has(page)) {
        state.boxEditor.currentBoxes = state.boxEditor.autoByPage.get(page);
      } else if (!state.boxEditor.editsByPage.has(page) && !state.boxEditor.autoByPage.has(page)) {
        dom.onBoxesShown?.();
      }
    }
    refresh();
    return true;
  }

  function undo() {
    cancelDrag();
    const page = state.documents.currentPage;
    const snapshot = state.boxEditor.undoByPage.get(page)?.undo?.();
    if (!snapshot) return false;
    state.boxEditor.editsByPage.set(page, cloneBoxes(snapshot));
    state.boxEditor.currentBoxes = state.boxEditor.editsByPage.get(page);
    state.boxEditor.selectedIndex = -1;
    refresh();
    return true;
  }

  function deleteSelected() {
    cancelDrag();
    const index = state.boxEditor.selectedIndex;
    const boxes = state.boxEditor.currentBoxes || [];
    if (index < 0 || index >= boxes.length) return false;
    const page = state.documents.currentPage;
    pushUndo(page, boxes);
    materializeEdits(page).splice(index, 1);
    state.boxEditor.selectedIndex = -1;
    refresh();
    return true;
  }

  function resetToAuto() {
    cancelDrag();
    const page = state.documents.currentPage;
    if (!state.boxEditor.editsByPage.has(page)) return false;
    state.boxEditor.editsByPage.delete(page);
    state.boxEditor.undoByPage.delete(page);
    state.boxEditor.selectedIndex = -1;
    if (state.boxEditor.autoByPage.has(page)) {
      state.boxEditor.currentBoxes = state.boxEditor.autoByPage.get(page);
      refresh();
    } else {
      dom.onAutoMissing?.();
    }
    return true;
  }

  function clearEdits() {
    cancelDrag();
    state.boxEditor.editsByPage.clear();
    state.boxEditor.undoByPage.clear();
    state.boxEditor.selectedIndex = -1;
    state.boxEditor.currentBoxes = state.boxEditor.autoByPage.get(state.documents.currentPage) ?? null;
    refresh();
  }

  function confirmDiscardEdits() {
    return state.boxEditor.editsByPage.size === 0 || confirmDiscard();
  }

  function syncInvalidated() {
    cancelDrag();
    state.boxEditor.selectedIndex = -1;
    refresh();
  }

  function clearSelection() {
    cancelDrag();
    state.boxEditor.selectedIndex = -1;
    refresh();
  }

  function updateCursor(event) {
    if (!state.boxEditor.editMode || state.boxEditor.drag) return;
    const point = pointFrom(event);
    const handle = hitHandle(point);
    view.setCursor?.(handle >= 0 ? HANDLE_CURSORS[handle] : hitBox(point) >= 0 ? "move" : "");
  }

  return {
    cancelDrag,
    hitBox,
    hitHandle,
    setEditMode,
    toggleBoxes,
    materializeEdits,
    undo,
    deleteSelected,
    pointerDown,
    pointerMove,
    pointerUp,
    pointerCancel,
    resetToAuto,
    clearEdits,
    confirmDiscard: confirmDiscardEdits,
    syncInvalidated,
    clearSelection,
    updateCursor,
  };
}
