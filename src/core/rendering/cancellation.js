const CANCELLED = "RenderCancelled";

export function renderCancelledError() {
  const error = new Error("描画を打ち切りました");
  error.name = CANCELLED;
  return error;
}

export function isRenderCancelled(error) {
  return error?.name === CANCELLED;
}

export function createRenderCancellation() {
  let cancelled = false;
  const callbacks = new Set();
  return Object.freeze({
    get cancelled() { return cancelled; },
    onCancel(callback) {
      if (cancelled) {
        callback();
        return () => {};
      }
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      for (const callback of callbacks) callback();
      callbacks.clear();
    },
  });
}
