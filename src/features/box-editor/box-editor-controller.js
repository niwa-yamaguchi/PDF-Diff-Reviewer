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

export function createBoxEditorController({
  state,
  dom,
  view,
  confirmDiscard,
  confirmResetToAuto = () => true,
  onNotice,
  onBoxesChanged,
  onEditingChanged,
}) {
  const deletedEntriesById = new Map();
  let nextManualId = 1;
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

  function bumpRevision(pageIndex) {
    const current = state.boxEditor.revisionByPage.get(pageIndex) || 0;
    state.boxEditor.revisionByPage.set(pageIndex, current + 1);
  }

  function commitChange(pageIndex, reason, boxes = state.boxEditor.currentBoxes || []) {
    bumpRevision(pageIndex);
    onBoxesChanged?.({ pageIndex, boxes: cloneBoxes(boxes), reason });
  }

  function selectedBoxIndex(boxes = state.boxEditor.currentBoxes || []) {
    return boxes.findIndex(box => box.id === state.review.selectedId);
  }

  function cacheDeletedEntry(id) {
    const entry = state.review.entriesById.get(id)
      || state.review.pendingMigration?.entriesById.get(id);
    if (entry) deletedEntriesById.set(id, { ...entry });
  }

  function cacheLeavingEntries(boxes, remaining) {
    const remainingIds = new Set((remaining || []).map(box => box.id));
    for (const box of boxes || []) {
      if (!remainingIds.has(box.id)) cacheDeletedEntry(box.id);
    }
  }

  function restoreDeletedEntries(boxes) {
    for (const box of boxes || []) {
      const entry = deletedEntriesById.get(box.id);
      if (!entry || state.review.entriesById.has(box.id)) continue;
      state.review.entriesById.set(box.id, { ...entry });
      deletedEntriesById.delete(box.id);
    }
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
    const boxes = state.boxEditor.currentBoxes || [];
    const index = selectedBoxIndex(boxes);
    if (index < 0 || index >= boxes.length) return -1;
    const radius = HANDLE_SCREEN_PX / scale();
    const points = handlePoints(boxes[index]);
    for (let handle = 0; handle < points.length; handle += 1) {
      if (
        Math.abs(point.x - points[handle][0]) < radius
        && Math.abs(point.y - points[handle][1]) < radius
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

  function makeManualBox(rect) {
    return {
      ...rect,
      id: `manual-${nextManualId++}`,
      kind: "changed",
      source: "manual",
    };
  }

  function pointerDown(event) {
    if (event.button === 2) return false;
    const point = pointFrom(event);
    const pointerId = event.pointerId;
    const page = state.documents.currentPage;

    if (state.boxEditor.mode === "create") {
      event.preventDefault?.();
      view.capturePointer?.(pointerId);
      state.boxEditor.drag = {
        kind: "create", page, pointerId, i: -1,
        x0: point.x, y0: point.y, x1: point.x, y1: point.y,
      };
      refresh();
      return true;
    }

    if (state.boxEditor.mode !== "edit") return false;

    const handle = hitHandle(point);
    if (handle >= 0) {
      const index = selectedBoxIndex();
      event.preventDefault?.();
      view.capturePointer?.(pointerId);
      state.boxEditor.drag = {
        kind: "resize", handle, i: index, page, pointerId,
        orig: { ...state.boxEditor.currentBoxes[index] }, preview: null,
      };
      refresh();
      return true;
    }

    const hit = selectedBoxIndex();
    const selected = state.boxEditor.currentBoxes?.[hit];
    if (selected && point.x >= selected.x && point.x <= selected.x + selected.w
      && point.y >= selected.y && point.y <= selected.y + selected.h) {
      event.preventDefault?.();
      view.capturePointer?.(pointerId);
      state.boxEditor.drag = {
        kind: "move", i: hit, page, pointerId,
        ox: point.x, oy: point.y,
        orig: { ...selected }, preview: null,
      };
      refresh();
      return true;
    }
    return false;
  }

  function pointerMove(event) {
    const drag = state.boxEditor.drag;
    if (!drag || event.pointerId !== drag.pointerId || drag.page !== state.documents.currentPage) return false;
    const point = pointFrom(event);
    const { width, height } = frameSize();
    if (drag.kind === "move") {
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
    } else if (drag.kind === "create") {
      drag.x1 = point.x;
      drag.y1 = point.y;
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
      const rect = clampBox(normalizeRect(drag.x0, drag.y0, drag.x1, drag.y1), width, height);
      if (isTooSmall(rect)) {
        onNotice?.("枠が小さすぎます");
        state.boxEditor.mode = "idle";
        view.setCursor?.("");
        refresh();
        return true;
      }
      const created = makeManualBox(rect);
      const source = state.boxEditor.currentBoxes || [];
      pushUndo(page, source);
      materializeEdits(page).push(created);
      state.review.selectedId = created.id;
      state.boxEditor.mode = "edit";
      commitChange(page, "create");
      refresh();
      return true;
    }

    const boxes = state.boxEditor.currentBoxes;
    if (drag.i >= 0 && boxes && drag.i < boxes.length) {
      const next = drag.preview;
      const changed = next && (
        next.x !== drag.orig.x || next.y !== drag.orig.y
        || next.w !== drag.orig.w || next.h !== drag.orig.h
      );
      if (changed && !(drag.kind === "resize" && isTooSmall(next))) {
        pushUndo(page, boxes);
        materializeEdits(page)[drag.i] = { ...drag.orig, ...next };
        commitChange(page, drag.kind);
      }
    }
    refresh();
    return true;
  }

  function pointerCancel(event) {
    return cancelDrag(event);
  }

  function restoreShownBoxes() {
    const page = state.documents.currentPage;
    if (state.boxEditor.editsByPage.has(page)) return;
    if (state.boxEditor.autoByPage.has(page)) {
      state.boxEditor.currentBoxes = state.boxEditor.autoByPage.get(page);
    } else {
      dom.onBoxesShown?.();
    }
  }

  function startCreate() {
    cancelDrag();
    if (!state.visual.rendered) return false;
    state.boxEditor.mode = "create";
    state.boxEditor.showBoxes = true;
    state.review.selectedId = null;
    view.setCursor?.("crosshair");
    refresh();
    return true;
  }

  function startEdit(id) {
    cancelDrag();
    if (!state.visual.rendered
      || !(state.boxEditor.currentBoxes || []).some(box => box.id === id)) return false;
    state.review.selectedId = id;
    state.boxEditor.mode = "edit";
    if (!state.boxEditor.showBoxes) {
      state.boxEditor.showBoxes = true;
      restoreShownBoxes();
    }
    refresh();
    return true;
  }

  function stopEditing() {
    cancelDrag();
    state.boxEditor.mode = "idle";
    view.setCursor?.("");
    refresh();
    onEditingChanged?.();
    return true;
  }

  function toggleBoxes() {
    if (!state.visual.rendered) return false;
    state.boxEditor.showBoxes = !state.boxEditor.showBoxes;
    if (!state.boxEditor.showBoxes && state.boxEditor.mode !== "idle") stopEditing();
    if (state.boxEditor.showBoxes) restoreShownBoxes();
    refresh();
    return true;
  }

  function undo() {
    cancelDrag();
    const page = state.documents.currentPage;
    const snapshot = state.boxEditor.undoByPage.get(page)?.undo?.();
    if (!snapshot) return false;
    restoreDeletedEntries(snapshot);
    state.boxEditor.editsByPage.set(page, cloneBoxes(snapshot));
    state.boxEditor.currentBoxes = state.boxEditor.editsByPage.get(page);
    commitChange(page, "undo");
    refresh();
    return true;
  }

  function deleteById(id) {
    cancelDrag();
    const item = [...state.review.itemsByPage.values()].flat().find(value => value.id === id);
    if (!item) return false;
    const page = item.pageIndex;
    const source = state.boxEditor.editsByPage.get(page)
      || state.boxEditor.autoByPage.get(page) || [];
    const index = source.findIndex(box => box.id === id);
    if (index < 0) return false;
    cacheDeletedEntry(id);
    const deletedSelection = state.review.selectedId === id;
    pushUndo(page, source);
    const edits = materializeEdits(page);
    edits.splice(edits.findIndex(box => box.id === id), 1);
    commitChange(page, "delete", edits);
    if (deletedSelection) state.review.selectedId = null;
    if (deletedSelection && state.boxEditor.mode === "edit") stopEditing();
    else refresh();
    return true;
  }

  function resetToAuto() {
    cancelDrag();
    const page = state.documents.currentPage;
    const edits = state.boxEditor.editsByPage.get(page);
    if (!edits || !confirmResetToAuto()) return false;
    const autoBoxes = cloneBoxes(state.boxEditor.autoByPage.get(page) || []);
    cacheLeavingEntries(edits, autoBoxes);
    pushUndo(page, edits);
    state.boxEditor.editsByPage.delete(page);
    state.boxEditor.currentBoxes = autoBoxes;
    state.boxEditor.mode = "idle";
    restoreDeletedEntries(state.boxEditor.currentBoxes);
    commitChange(page, "reset", state.boxEditor.currentBoxes);
    refresh();
    return true;
  }

  function clearEdits() {
    cancelDrag();
    const editedPages = [...state.boxEditor.editsByPage.keys()];
    state.boxEditor.editsByPage.clear();
    state.boxEditor.undoByPage.clear();
    state.boxEditor.mode = "idle";
    state.boxEditor.currentBoxes = state.boxEditor.autoByPage.get(state.documents.currentPage) ?? null;
    for (const page of editedPages) {
      const autoBoxes = state.boxEditor.autoByPage.get(page) || [];
      restoreDeletedEntries(autoBoxes);
      commitChange(page, "discard", autoBoxes);
    }
    refresh();
  }

  function confirmDiscardEdits() {
    return state.boxEditor.editsByPage.size === 0 || confirmDiscard();
  }

  function syncInvalidated() {
    cancelDrag();
    state.boxEditor.mode = "idle";
    refresh();
  }

  function updateCursor(event) {
    if (state.boxEditor.mode !== "edit" || state.boxEditor.drag) return;
    const point = pointFrom(event);
    const handle = hitHandle(point);
    const index = selectedBoxIndex();
    const selected = state.boxEditor.currentBoxes?.[index];
    const inside = selected && point.x >= selected.x && point.x <= selected.x + selected.w
      && point.y >= selected.y && point.y <= selected.y + selected.h;
    view.setCursor?.(handle >= 0 ? HANDLE_CURSORS[handle] : inside ? "move" : "");
  }

  return {
    cancelDrag,
    hitBox,
    hitHandle,
    startCreate,
    startEdit,
    stopEditing,
    toggleBoxes,
    materializeEdits,
    undo,
    deleteById,
    pointerDown,
    pointerMove,
    pointerUp,
    pointerCancel,
    resetToAuto,
    clearEdits,
    confirmDiscard: confirmDiscardEdits,
    syncInvalidated,
    updateCursor,
  };
}
