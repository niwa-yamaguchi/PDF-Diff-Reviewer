export function createDiffWorker() {
  return new Worker(new URL("../workers/diff-worker.js", import.meta.url), {
    type: "module",
  });
}
