import { expect, test, vi } from "vitest";
import { createWorkerLane, isRenderCancelled } from "../../src/features/visual-diff/worker-lane.js";

class FakeWorker {
  constructor(registry) {
    this.posted = [];
    this.terminated = false;
    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;
    registry.push(this);
  }

  postMessage(message) {
    this.posted.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  emit(data) {
    this.onmessage?.({ data });
  }
}

function lane() {
  const workers = [];
  const createWorker = vi.fn(() => new FakeWorker(workers));
  return { workers, createWorker, subject: createWorkerLane({ createWorker }) };
}

test("creates the worker lazily on the first job", () => {
  const { createWorker, subject } = lane();

  expect(createWorker).not.toHaveBeenCalled();
  subject.run("diff", { width: 1 });
  expect(createWorker).toHaveBeenCalledTimes(1);
});

test("resolves a job with the returned result", async () => {
  const { workers, subject } = lane();

  const running = subject.run("diff", { width: 1 });
  const { id } = workers[0].posted[0];
  workers[0].emit({ id, type: "done", result: { removed: 3 } });

  await expect(running).resolves.toEqual({ removed: 3 });
});

test("forwards the payload and transfer list to the worker", () => {
  const { workers, subject } = lane();
  const buffer = new ArrayBuffer(8);

  subject.run("diff", { buffer }, { transfer: [buffer] });

  expect(workers[0].posted[0]).toMatchObject({ type: "diff", payload: { buffer } });
  expect(workers[0].posted).toHaveLength(1);
});

test("relays progress without settling the job", async () => {
  const { workers, subject } = lane();
  const onProgress = vi.fn();

  const running = subject.run("diff", {}, { onProgress });
  const { id } = workers[0].posted[0];
  workers[0].emit({ id, type: "progress", ratio: 0.5 });
  workers[0].emit({ id, type: "done", result: "ok" });

  expect(onProgress).toHaveBeenCalledWith(0.5);
  await expect(running).resolves.toBe("ok");
});

test("ignores messages carrying a stale job id", async () => {
  const { workers, subject } = lane();
  const onProgress = vi.fn();

  const running = subject.run("diff", {}, { onProgress });
  const { id } = workers[0].posted[0];
  workers[0].emit({ id: id + 99, type: "progress", ratio: 0.9 });
  workers[0].emit({ id, type: "done", result: "ok" });

  expect(onProgress).not.toHaveBeenCalled();
  await expect(running).resolves.toBe("ok");
});

test("rejects a job reported as failed", async () => {
  const { workers, subject } = lane();

  const running = subject.run("diff", {});
  const { id } = workers[0].posted[0];
  workers[0].emit({ id, type: "error", message: "boom" });

  await expect(running).rejects.toThrow("boom");
});

test("terminates the worker and rejects on cancel", async () => {
  const { workers, subject } = lane();

  const running = subject.run("diff", {});
  subject.cancel();

  expect(workers[0].terminated).toBe(true);
  await expect(running).rejects.toSatisfy(isRenderCancelled);
});

test("starts a fresh worker after a cancel", async () => {
  const { workers, createWorker, subject } = lane();

  const cancelled = subject.run("diff", {});
  subject.cancel();
  await expect(cancelled).rejects.toSatisfy(isRenderCancelled);

  const running = subject.run("diff", {});
  expect(createWorker).toHaveBeenCalledTimes(2);
  const { id } = workers[1].posted[0];
  workers[1].emit({ id, type: "done", result: "second" });
  await expect(running).resolves.toBe("second");
});

test("does nothing when cancelling an idle lane", () => {
  const { workers, subject } = lane();

  expect(() => subject.cancel()).not.toThrow();
  expect(workers).toHaveLength(0);
});

test("rejects the running job when the worker reports an error", async () => {
  const { workers, subject } = lane();

  const running = subject.run("diff", {});
  workers[0].onerror?.({ message: "worker crashed" });

  await expect(running).rejects.toThrow("worker crashed");
  expect(workers[0].terminated).toBe(true);
});

test("refuses a second job while one is running without throwing synchronously", async () => {
  const { subject } = lane();

  subject.run("diff", {});

  const refused = subject.run("diff", {});
  expect(refused).toBeInstanceOf(Promise);
  await expect(refused).rejects.toSatisfy(isRenderCancelled);
});

test("rejects a job from a session opened before a cancel", async () => {
  const { workers, subject } = lane();
  const stale = subject.session();

  subject.cancel();

  await expect(stale("diff", {})).rejects.toSatisfy(isRenderCancelled);
  expect(workers).toHaveLength(0);
});

test("lets the session opened after a cancel take the lane", async () => {
  const { workers, subject } = lane();
  const stale = subject.session();
  subject.cancel();
  const fresh = subject.session();

  const refused = stale("diff", { page: 0 });
  const running = fresh("diff", { page: 1 });

  await expect(refused).rejects.toSatisfy(isRenderCancelled);
  expect(workers).toHaveLength(1);
  expect(workers[0].posted[0].payload).toEqual({ page: 1 });
  const { id } = workers[0].posted[0];
  workers[0].emit({ id, type: "done", result: "fresh" });
  await expect(running).resolves.toBe("fresh");
});

test("keeps forwarding the transfer list through a session", () => {
  const { workers, subject } = lane();
  const buffer = new ArrayBuffer(8);

  subject.session()("diff", { buffer }, { transfer: [buffer] });

  expect(workers[0].posted[0]).toMatchObject({ type: "diff", payload: { buffer } });
});
