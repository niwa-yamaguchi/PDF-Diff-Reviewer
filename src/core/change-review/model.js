export const REVIEW_STATUS = Object.freeze({
  pending: "pending",
  confirmed: "confirmed",
  excluded: "excluded",
});

const EMPTY_REVIEW = Object.freeze({ status: REVIEW_STATUS.pending, comment: "" });

function sequenceIndex(sequence, pageIndex) {
  return sequence?.[pageIndex] ?? null;
}

export function pageKeyFor(documents, pageIndex) {
  const oldIndex = sequenceIndex(documents.oldSequence, pageIndex);
  const newIndex = sequenceIndex(documents.newSequence, pageIndex);
  return `old:${oldIndex ?? "null"}|new:${newIndex ?? "null"}`;
}

export function createReviewItems({
  boxes,
  pageIndex,
  pageKey,
  width,
  height,
  allocateId,
  source,
}) {
  return boxes.map(box => {
    const rect = { x: box.x, y: box.y, w: box.w, h: box.h };
    return {
      id: allocateId(),
      pageIndex,
      pageKey,
      rect,
      normalizedRect: {
        x: rect.x / width,
        y: rect.y / height,
        w: rect.w / width,
        h: rect.h / height,
      },
      kind: box.kind,
      source,
    };
  });
}

export function sortReviewItems(items) {
  return [...items].sort((left, right) => left.pageIndex - right.pageIndex
    || left.normalizedRect.y - right.normalizedRect.y
    || left.normalizedRect.x - right.normalizedRect.x);
}

function emptySummary() {
  return { total: 0, pending: 0, confirmed: 0, excluded: 0, complete: 0 };
}

function reviewStatus(entry) {
  return entry?.status === REVIEW_STATUS.confirmed || entry?.status === REVIEW_STATUS.excluded
    ? entry.status
    : REVIEW_STATUS.pending;
}

function countReview(summary, status) {
  summary.total += 1;
  summary[status] += 1;
  if (status !== REVIEW_STATUS.pending) summary.complete += 1;
}

export function summarizeReviews(items, entries) {
  const summary = { ...emptySummary(), byPage: new Map() };
  for (const item of items) {
    const status = reviewStatus(entries.get(item.id));
    countReview(summary, status);
    const pageSummary = summary.byPage.get(item.pageIndex) || emptySummary();
    countReview(pageSummary, status);
    summary.byPage.set(item.pageIndex, pageSummary);
  }
  return summary;
}

function area(rect) {
  return Math.max(0, rect.w) * Math.max(0, rect.h);
}

function intersectionOverUnion(left, right) {
  const intersectionWidth = Math.max(0,
    Math.min(left.x + left.w, right.x + right.w) - Math.max(left.x, right.x));
  const intersectionHeight = Math.max(0,
    Math.min(left.y + left.h, right.y + right.h) - Math.max(left.y, right.y));
  const intersection = intersectionWidth * intersectionHeight;
  const union = area(left) + area(right) - intersection;
  return union > 0 ? intersection / union : 0;
}

function centerSimilarity(left, right, maximumDistance) {
  const leftX = left.x + left.w / 2;
  const leftY = left.y + left.h / 2;
  const rightX = right.x + right.w / 2;
  const rightY = right.y + right.h / 2;
  const distance = Math.hypot(leftX - rightX, leftY - rightY);
  return Math.max(0, 1 - distance / maximumDistance);
}

function sizeSimilarity(left, right) {
  const leftArea = area(left);
  const rightArea = area(right);
  const larger = Math.max(leftArea, rightArea);
  return larger > 0 ? Math.min(leftArea, rightArea) / larger : 0;
}

export function matchScore(left, right) {
  const overlap = intersectionOverUnion(left.normalizedRect, right.normalizedRect);
  const center = centerSimilarity(left.normalizedRect, right.normalizedRect, 0.25);
  const size = sizeSimilarity(left.normalizedRect, right.normalizedRect);
  return { overlap, value: 0.65 * overlap + 0.20 * center + 0.15 * size };
}

export function canInherit(best, second) {
  return best.overlap >= 0.50
    && best.value >= 0.72
    && (!second || best.value - second.value + Number.EPSILON >= 0.10);
}

function rankedCandidates(previousItems, nextItems) {
  const byPrevious = previousItems.map(() => []);
  const byNext = nextItems.map(() => []);
  const overlapsByPrevious = previousItems.map(() => 0);
  const overlapsByNext = nextItems.map(() => 0);

  previousItems.forEach((previousItem, previousIndex) => {
    nextItems.forEach((nextItem, nextIndex) => {
      if (previousItem.pageKey !== nextItem.pageKey) return;
      const score = matchScore(previousItem, nextItem);
      // Splits and merges can change kind; only the inheritance ranking requires the same kind.
      if (score.overlap > 0) {
        overlapsByPrevious[previousIndex] += 1;
        overlapsByNext[nextIndex] += 1;
      }
      if (previousItem.kind !== nextItem.kind) return;
      const candidate = {
        previousIndex,
        nextIndex,
        score,
      };
      byPrevious[previousIndex].push(candidate);
      byNext[nextIndex].push(candidate);
    });
  });

  const byDescendingScore = (left, right) => right.score.value - left.score.value;
  byPrevious.forEach(candidates => candidates.sort(byDescendingScore));
  byNext.forEach(candidates => candidates.sort(byDescendingScore));
  return { byPrevious, byNext, overlapsByPrevious, overlapsByNext };
}

export function reconcileReviewItems({ previousItems, nextItems, entries, allocateId }) {
  const candidates = rankedCandidates(previousItems, nextItems);
  const nextEntries = new Map(entries);
  let inherited = 0;
  let reset = 0;

  const items = nextItems.map((nextItem, nextIndex) => {
    const nextRanked = candidates.byNext[nextIndex];
    const best = nextRanked[0];
    if (best) {
      const previousRanked = candidates.byPrevious[best.previousIndex];
      const isMutualBest = previousRanked[0]?.nextIndex === nextIndex;
      const clearForNext = canInherit(best.score, nextRanked[1]?.score);
      const clearForPrevious = canInherit(best.score, previousRanked[1]?.score);
      const isSplit = candidates.overlapsByPrevious[best.previousIndex] > 1;
      const isMerge = candidates.overlapsByNext[nextIndex] > 1;
      if (isMutualBest && clearForNext && clearForPrevious && !isSplit && !isMerge) {
        inherited += 1;
        return { ...nextItem, id: previousItems[best.previousIndex].id };
      }
    }

    const id = allocateId();
    nextEntries.set(id, { ...EMPTY_REVIEW });
    reset += 1;
    return { ...nextItem, id };
  });

  return { items, entries: nextEntries, summary: { inherited, reset } };
}
