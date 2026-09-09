import { expect, test } from "vitest";
import {
  canInherit,
  createReviewItems,
  matchScore,
  pageKeyFor,
  reconcileReviewItems,
  sortReviewItems,
  summarizeReviews,
} from "../../src/core/change-review/model.js";

function rect(x, y, w, h) {
  return Object.freeze({ x, y, w, h });
}

function item(id, kind, normalizedRect, overrides = {}) {
  return Object.freeze({
    id,
    pageIndex: 0,
    pageKey: "old:0|new:0",
    rect: normalizedRect,
    normalizedRect,
    kind,
    source: "auto",
    ...overrides,
  });
}

function ids(...values) {
  let index = 0;
  return () => values[index++];
}

test("builds page keys from aligned source indexes and marks blank slots as null", () => {
  const documents = Object.freeze({
    oldSequence: Object.freeze([2, null]),
    newSequence: Object.freeze([4, 1]),
  });

  expect(pageKeyFor(documents, 0)).toBe("old:2|new:4");
  expect(pageKeyFor(documents, 1)).toBe("old:null|new:1");
  expect(pageKeyFor({ oldSequence: null }, 3)).toBe("old:null|new:null");
});

test("creates DPI-independent review items and summarizes terminal states", () => {
  let next = 1;
  const boxes = Object.freeze([
    Object.freeze({ x: 50, y: 100, w: 20, h: 10, kind: "added" }),
    Object.freeze({ x: 10, y: 10, w: 20, h: 20, kind: "removed" }),
  ]);
  const items = createReviewItems({
    boxes,
    pageIndex: 0,
    pageKey: "old:0|new:0",
    width: 100,
    height: 200,
    allocateId: () => `change-${next++}`,
    source: "auto",
  });
  const sorted = sortReviewItems(items);
  const entries = new Map([
    [sorted[0].id, { status: "confirmed", comment: "確認" }],
    [sorted[1].id, { status: "excluded", comment: "図枠" }],
  ]);

  expect(items.map(reviewItem => reviewItem.id)).toEqual(["change-1", "change-2"]);
  expect(sorted.map(reviewItem => reviewItem.id)).toEqual(["change-2", "change-1"]);
  expect(sorted[1]).toMatchObject({
    rect: { x: 50, y: 100, w: 20, h: 10 },
    normalizedRect: { x: 0.5, y: 0.5, w: 0.2, h: 0.05 },
    kind: "added",
    source: "auto",
  });
  expect(summarizeReviews(sorted, entries)).toEqual({
    total: 2,
    pending: 0,
    confirmed: 1,
    excluded: 1,
    complete: 2,
    byPage: new Map([[0, {
      total: 2,
      pending: 0,
      confirmed: 1,
      excluded: 1,
      complete: 2,
    }]]),
  });
  expect(boxes).toEqual([
    { x: 50, y: 100, w: 20, h: 10, kind: "added" },
    { x: 10, y: 10, w: 20, h: 20, kind: "removed" },
  ]);
});

test("sorts by page, then top-to-bottom and left-to-right without changing inputs", () => {
  const items = Object.freeze([
    item("p1-right", "added", rect(0.7, 0.1, 0.1, 0.1), { pageIndex: 1 }),
    item("p0-low", "removed", rect(0.1, 0.8, 0.1, 0.1)),
    item("p1-left", "changed", rect(0.2, 0.1, 0.1, 0.1), { pageIndex: 1 }),
  ]);

  const sorted = sortReviewItems(items);

  expect(sorted.map(reviewItem => reviewItem.id)).toEqual(["p0-low", "p1-left", "p1-right"]);
  expect(sorted).not.toBe(items);
  expect(items.map(reviewItem => reviewItem.id)).toEqual(["p1-right", "p0-low", "p1-left"]);
});

test("counts missing and unknown review statuses as pending globally and by page", () => {
  const items = [
    item("missing", "added", rect(0, 0, 0.1, 0.1)),
    item("unknown", "removed", rect(0, 0, 0.1, 0.1), { pageIndex: 2 }),
    item("done", "changed", rect(0, 0, 0.1, 0.1), { pageIndex: 2 }),
  ];
  const entries = new Map([
    ["unknown", { status: "reviewing", comment: "" }],
    ["done", { status: "confirmed", comment: "" }],
  ]);

  expect(summarizeReviews(items, entries)).toEqual({
    total: 3,
    pending: 2,
    confirmed: 1,
    excluded: 0,
    complete: 1,
    byPage: new Map([
      [0, { total: 1, pending: 1, confirmed: 0, excluded: 0, complete: 0 }],
      [2, { total: 2, pending: 1, confirmed: 1, excluded: 0, complete: 1 }],
    ]),
  });
});

test("computes the specified overlap, center and size weighted match score", () => {
  const score = matchScore(
    item("left", "added", rect(0, 0, 0.2, 0.2)),
    item("right", "added", rect(0.1, 0, 0.2, 0.2)),
  );

  expect(score.overlap).toBeCloseTo(1 / 3, 10);
  expect(score.value).toBeCloseTo(0.4866666667, 10);
});

test("accepts only the inclusive IoU, score and second-candidate-gap boundaries", () => {
  expect(canInherit({ overlap: 0.50, value: 0.72 }, { overlap: 0.9, value: 0.62 })).toBe(true);
  expect(canInherit({ overlap: 0.4999, value: 1 }, null)).toBe(false);
  expect(canInherit({ overlap: 1, value: 0.7199 }, null)).toBe(false);
  expect(canInherit({ overlap: 1, value: 0.72 }, { overlap: 1, value: 0.6201 })).toBe(false);
});

test("inherits only mutual high-confidence matches without changing input items or entries", () => {
  const oldEntry = Object.freeze({ status: "confirmed", comment: "R105" });
  const previousItems = Object.freeze([
    item("old-a", "added", rect(0.10, 0.10, 0.20, 0.20)),
  ]);
  const nextItems = Object.freeze([
    item(null, "added", rect(0.11, 0.10, 0.20, 0.20)),
  ]);
  const entries = new Map([["old-a", oldEntry]]);

  const result = reconcileReviewItems({
    previousItems,
    nextItems,
    entries,
    allocateId: () => "new-a",
  });

  expect(result.items[0].id).toBe("old-a");
  expect(result.entries).not.toBe(entries);
  expect(result.entries.get("old-a")).toEqual({ status: "confirmed", comment: "R105" });
  expect(result.summary).toEqual({ inherited: 1, reset: 0 });
  expect(previousItems[0].id).toBe("old-a");
  expect(nextItems[0].id).toBeNull();
  expect(entries).toEqual(new Map([["old-a", oldEntry]]));
});

test.each([
  ["kind changed", item(null, "removed", rect(0.11, 0.10, 0.20, 0.20))],
  ["page key changed", item(null, "added", rect(0.11, 0.10, 0.20, 0.20), { pageKey: "old:1|new:1" })],
  ["low overlap", item(null, "added", rect(0.40, 0.40, 0.20, 0.20))],
  ["score below 0.72", item(null, "added", rect(0.12, 0.12, 0.16, 0.16))],
])("resets %s", (_label, nextItem) => {
  const result = reconcileReviewItems({
    previousItems: [item("old-a", "added", rect(0.10, 0.10, 0.20, 0.20))],
    nextItems: [nextItem],
    entries: new Map([["old-a", { status: "confirmed", comment: "確認" }]]),
    allocateId: () => "new-a",
  });

  expect(result.items[0].id).toBe("new-a");
  expect(result.entries.get("new-a")).toEqual({ status: "pending", comment: "" });
  expect(result.summary).toEqual({ inherited: 0, reset: 1 });
});

test("does not inherit a one-to-many split", () => {
  const result = reconcileReviewItems({
    previousItems: [item("old-a", "added", rect(0.10, 0.10, 0.20, 0.20))],
    nextItems: [
      item(null, "added", rect(0.10, 0.10, 0.10, 0.20)),
      item(null, "added", rect(0.20, 0.10, 0.10, 0.20)),
    ],
    entries: new Map([["old-a", { status: "confirmed", comment: "split" }]]),
    allocateId: ids("new-left", "new-right"),
  });

  expect(result.items.map(reviewItem => reviewItem.id)).toEqual(["new-left", "new-right"]);
  expect(result.summary).toEqual({ inherited: 0, reset: 2 });
});

test("does not inherit a many-to-one merge", () => {
  const result = reconcileReviewItems({
    previousItems: [
      item("old-left", "added", rect(0.10, 0.10, 0.10, 0.20)),
      item("old-right", "added", rect(0.20, 0.10, 0.10, 0.20)),
    ],
    nextItems: [item(null, "added", rect(0.10, 0.10, 0.20, 0.20))],
    entries: new Map([
      ["old-left", { status: "confirmed", comment: "left" }],
      ["old-right", { status: "excluded", comment: "right" }],
    ]),
    allocateId: () => "new-merged",
  });

  expect(result.items[0].id).toBe("new-merged");
  expect(result.summary).toEqual({ inherited: 0, reset: 1 });
});

test("does not inherit the high-scoring side of an asymmetric 95/5 split", () => {
  const result = reconcileReviewItems({
    previousItems: [item("old-a", "added", rect(0.10, 0.10, 0.20, 0.20))],
    nextItems: [
      item(null, "added", rect(0.10, 0.10, 0.19, 0.20)),
      item(null, "added", rect(0.29, 0.10, 0.01, 0.20)),
    ],
    entries: new Map([["old-a", { status: "confirmed", comment: "asymmetric split" }]]),
    allocateId: ids("new-major", "new-sliver"),
  });

  expect(result.items.map(reviewItem => reviewItem.id)).toEqual(["new-major", "new-sliver"]);
  expect(result.entries.get("new-major")).toEqual({ status: "pending", comment: "" });
  expect(result.summary).toEqual({ inherited: 0, reset: 2 });
});

test("does not inherit the high-scoring side of an asymmetric 95/5 merge", () => {
  const result = reconcileReviewItems({
    previousItems: [
      item("old-major", "added", rect(0.10, 0.10, 0.19, 0.20)),
      item("old-sliver", "added", rect(0.29, 0.10, 0.01, 0.20)),
    ],
    nextItems: [item(null, "added", rect(0.10, 0.10, 0.20, 0.20))],
    entries: new Map([
      ["old-major", { status: "confirmed", comment: "major" }],
      ["old-sliver", { status: "excluded", comment: "sliver" }],
    ]),
    allocateId: () => "new-merged",
  });

  expect(result.items[0].id).toBe("new-merged");
  expect(result.entries.get("new-merged")).toEqual({ status: "pending", comment: "" });
  expect(result.summary).toEqual({ inherited: 0, reset: 1 });
});

// Break: restricting split geometry to the same kind transfers a confirmed review to only part of the change.
test("resets every item in an asymmetric mixed-kind split", () => {
  const result = reconcileReviewItems({
    previousItems: [item("old-a", "changed", rect(0.10, 0.10, 0.20, 0.20))],
    nextItems: [
      item(null, "changed", rect(0.10, 0.10, 0.19, 0.20)),
      item(null, "added", rect(0.29, 0.10, 0.01, 0.20)),
    ],
    entries: new Map([["old-a", { status: "confirmed", comment: "whole change" }]]),
    allocateId: ids("new-major", "new-sliver"),
  });

  expect(result.items.map(reviewItem => reviewItem.id)).toEqual(["new-major", "new-sliver"]);
  expect(result.items.map(reviewItem => result.entries.get(reviewItem.id))).toEqual([
    { status: "pending", comment: "" }, { status: "pending", comment: "" },
  ]);
  expect(result.summary).toEqual({ inherited: 0, reset: 2 });
});

// Break: ignoring a merged sliver of another kind marks the combined change as already confirmed.
test("resets an asymmetric mixed-kind merge", () => {
  const result = reconcileReviewItems({
    previousItems: [
      item("old-major", "changed", rect(0.10, 0.10, 0.19, 0.20)),
      item("old-sliver", "removed", rect(0.29, 0.10, 0.01, 0.20)),
    ],
    nextItems: [item(null, "changed", rect(0.10, 0.10, 0.20, 0.20))],
    entries: new Map([
      ["old-major", { status: "confirmed", comment: "major" }],
      ["old-sliver", { status: "excluded", comment: "sliver" }],
    ]),
    allocateId: () => "new-merged",
  });

  expect(result.items[0].id).toBe("new-merged");
  expect(result.entries.get("new-merged")).toEqual({ status: "pending", comment: "" });
  expect(result.summary).toEqual({ inherited: 0, reset: 1 });
});

// Break: counting overlaps from unrelated pages discards an otherwise unambiguous review.
test("ignores other page keys when checking mixed-kind geometry", () => {
  const result = reconcileReviewItems({
    previousItems: [item("old-a", "changed", rect(0.10, 0.10, 0.20, 0.20))],
    nextItems: [
      item(null, "changed", rect(0.10, 0.10, 0.20, 0.20)),
      item(null, "added", rect(0.29, 0.10, 0.01, 0.20), { pageKey: "old:1|new:1" }),
    ],
    entries: new Map([["old-a", { status: "confirmed", comment: "same page" }]]),
    allocateId: () => "new-other-page",
  });

  expect(result.items.map(reviewItem => reviewItem.id)).toEqual(["old-a", "new-other-page"]);
  expect(result.entries.get("old-a")).toEqual({ status: "confirmed", comment: "same page" });
});

test("rejects a tied second candidate", () => {
  const sameRect = rect(0.10, 0.10, 0.20, 0.20);
  const result = reconcileReviewItems({
    previousItems: [
      item("old-a", "added", sameRect),
      item("old-b", "added", sameRect),
    ],
    nextItems: [item(null, "added", sameRect)],
    entries: new Map([
      ["old-a", { status: "confirmed", comment: "A" }],
      ["old-b", { status: "confirmed", comment: "B" }],
    ]),
    allocateId: () => "new-tied",
  });

  expect(result.items[0].id).toBe("new-tied");
  expect(result.summary).toEqual({ inherited: 0, reset: 1 });
});

test("rejects a mutual best match when the second-candidate gap is under 0.10", () => {
  const result = reconcileReviewItems({
    previousItems: [item("old-a", "added", rect(0.10, 0.10, 0.20, 0.20))],
    nextItems: [
      item(null, "added", rect(0.10, 0.10, 0.20, 0.20)),
      item(null, "added", rect(0.11, 0.10, 0.20, 0.20)),
    ],
    entries: new Map([["old-a", { status: "confirmed", comment: "ambiguous" }]]),
    allocateId: ids("new-best", "new-second"),
  });

  expect(result.items.map(reviewItem => reviewItem.id)).toEqual(["new-best", "new-second"]);
  expect(result.summary).toEqual({ inherited: 0, reset: 2 });
});

test("resets non-mutual candidates when one old item intersects both new items", () => {
  const result = reconcileReviewItems({
    previousItems: [item("old-a", "added", rect(0.10, 0.10, 0.20, 0.20))],
    nextItems: [
      item(null, "added", rect(0.12, 0.10, 0.20, 0.20)),
      item(null, "added", rect(0.10, 0.10, 0.20, 0.20)),
    ],
    entries: new Map([["old-a", { status: "confirmed", comment: "mutual" }]]),
    allocateId: ids("new-first", "new-second"),
  });

  expect(result.items.map(reviewItem => reviewItem.id)).toEqual(["new-first", "new-second"]);
  expect(result.summary).toEqual({ inherited: 0, reset: 2 });
});
