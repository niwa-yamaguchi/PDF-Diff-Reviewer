const CANCELLED = "RenderCancelled";

function cancelledError() {
  const error = new Error("描画を打ち切りました");
  error.name = CANCELLED;
  return error;
}

export function isRenderCancelled(error) {
  return error?.name === CANCELLED;
}

export function createWorkerLane({ createWorker }) {
  let worker = null;
  let pending = null;
  let nextId = 1;

  function destroy() {
    worker?.terminate();
    worker = null;
  }

  function settleWithError(error) {
    const job = pending;
    pending = null;
    destroy();
    job?.reject(error);
  }

  function handleMessage({ data }) {
    if (!pending || data?.id !== pending.id) return;
    if (data.type === "progress") {
      pending.onProgress?.(data.ratio);
      return;
    }
    const job = pending;
    pending = null;
    if (data.type === "error") job.reject(new Error(data.message));
    else job.resolve(data.result);
  }

  function handleFailure(event) {
    settleWithError(new Error(event?.message || "Workerの実行に失敗しました"));
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = createWorker();
    worker.onmessage = handleMessage;
    worker.onerror = handleFailure;
    worker.onmessageerror = handleFailure;
    return worker;
  }

  function run(type, payload, { transfer = [], onProgress = null } = {}) {
    if (pending) throw new Error("Worker lane is busy");
    const id = nextId;
    nextId += 1;
    const target = ensureWorker();
    return new Promise((resolve, reject) => {
      pending = { id, resolve, reject, onProgress };
      target.postMessage({ id, type, payload }, transfer);
    });
  }

  function cancel() {
    if (!pending) return;
    settleWithError(cancelledError());
  }

  return { run, cancel, dispose: destroy };
}
