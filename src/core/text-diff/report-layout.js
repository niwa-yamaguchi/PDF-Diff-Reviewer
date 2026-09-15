const KIND_LABELS = Object.freeze({ changed: "変更", removed: "削除", added: "追加" });

function pageText(change) {
  const side = page => (page == null ? "—" : `p${page + 1}`);
  return `旧 ${side(change.oldPage)} → 新 ${side(change.newPage)}`;
}

function runsOf(change) {
  if (change.kind === "removed") return [{ text: change.oldText, style: "removed" }];
  if (change.kind === "added") return [{ text: change.newText, style: "added" }];
  return change.parts.map(([op, text]) => ({
    text,
    style: op < 0 ? "removed" : op > 0 ? "added" : "plain",
  }));
}

// 日本語は空白で区切れないので1文字単位で折り返す。
function wrapRuns(runs, measure, maxWidth) {
  const lines = [[]];
  let x = 0;
  for (const { text, style } of runs) {
    for (const char of text) {
      const w = measure(char);
      if (x > 0 && x + w > maxWidth) {
        lines.push([]);
        x = 0;
      }
      const line = lines[lines.length - 1];
      const last = line[line.length - 1];
      if (last?.style === style) {
        last.text += char;
        last.w += w;
      } else {
        line.push({ text: char, style, x, w });
      }
      x += w;
    }
  }
  return lines;
}

// 変更記録を「種類バッジ＋ページ見出し」と色分けした本文行に並べる。height が有限ならページ分けする。
export function layoutTextReport(changes, measure, { width, height = Infinity, fontPx }) {
  const lineH = Math.round(fontPx * 1.6);
  const margin = fontPx * 4;
  const top = margin + lineH * 2;
  const bottom = height - margin;
  const pages = [];
  let page = null;
  let y = top;
  const reserve = needed => {
    if (page && (y + needed <= bottom || !page.items.length)) return;
    page = { items: [] };
    pages.push(page);
    y = top;
  };

  changes.forEach((change, index) => {
    // 見出しだけがページ末尾に取り残されないよう、本文1行分も合わせて確保する。
    reserve(lineH * 2);
    const label = KIND_LABELS[change.kind];
    const badgeW = measure(label) + fontPx;
    page.items.push(
      { type: "badge", x: margin, y, w: badgeW, text: label, kind: change.kind },
      { type: "run", x: margin + badgeW + fontPx / 2, y, text: `#${change.number ?? index + 1}  ${pageText(change)}`, style: "meta" },
    );
    y += lineH;
    for (const segments of wrapRuns(runsOf(change), measure, width - margin * 2)) {
      reserve(lineH);
      for (const segment of segments) {
        page.items.push({ type: "run", ...segment, x: margin + segment.x, y });
      }
      y += lineH;
    }
    y += lineH / 2;
  });

  if (!pages.length) {
    reserve(lineH);
    page.items.push({ type: "run", x: margin, y, text: "テキスト差分はありません", style: "plain" });
    y += lineH;
  }
  return { pages, width, height: Number.isFinite(height) ? height : y + margin, fontPx, lineH, margin };
}
