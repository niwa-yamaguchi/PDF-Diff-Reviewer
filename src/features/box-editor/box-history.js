function cloneBoxes(boxes) {
  return (boxes || []).map(box => ({ ...box }));
}

export function createBoxHistory(limit = 50) {
  const capacity = Number.isInteger(limit) && limit > 0 ? limit : 50;
  const snapshots = [];

  return {
    get size() {
      return snapshots.length;
    },
    push(boxes) {
      snapshots.push(cloneBoxes(boxes));
      if (snapshots.length > capacity) snapshots.shift();
    },
    undo() {
      const snapshot = snapshots.pop();
      return snapshot ? cloneBoxes(snapshot) : null;
    },
  };
}
