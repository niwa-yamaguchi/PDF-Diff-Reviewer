const PLACEHOLDER = Object.freeze({ added: "（新設）", removed: "（削除）" });
// 箇条書きの頭。段落の中でもここだけは改行を残す。
const LIST_HEAD = /^\s*(\d+[.．)）]|[(（]\d+[)）]|[・●■◆※▪-])/;

function pageLabel(side, page, pageEnd) {
  if (page == null) return null;
  return `${side} p${page + 1}${pageEnd != null && pageEnd !== page ? `–${pageEnd + 1}` : ""}`;
}

// 元の行は欄の幅とは関係なく折り返されているので、箇条書きの頭以外はつなげる。
// 英数字どうしが行をまたぐときだけ空白を挟む。
function joinParagraphLines(lines) {
  const out = [];
  for (const runs of lines) {
    const text = runs.map(run => run.text).join("");
    const last = out[out.length - 1];
    if (!last || LIST_HEAD.test(text)) {
      out.push(runs.map(run => ({ ...run })));
      continue;
    }
    const tail = last[last.length - 1]?.text || "";
    if (/[A-Za-z0-9]$/.test(tail) && /^[A-Za-z0-9]/.test(text)) last.push({ text: " ", style: "plain" });
    last.push(...runs.map(run => ({ ...run })));
  }
  return out;
}

// 行頭に来ない約物。欄の右端からはみ出させて前の行に残す（ぶら下げ）。
// どれも字面が字送りの左半分にあるので、はみ出しは欄の余白（0.5em）に収まる。
const NO_LINE_START = /[、。，．,.)）」』】〕]/;

// 日本語は空白で区切れないので1文字単位で折り返す。
function wrapRuns(runs, measure, maxWidth) {
  const lines = [[]];
  let x = 0;
  for (const { text, style } of runs) {
    for (const char of text) {
      const w = measure(char);
      if (x > 0 && x + w > maxWidth && !(NO_LINE_START.test(char) && x <= maxWidth)) {
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

function columnLines(lines, placeholder, measure, width) {
  if (!lines) return [[{ text: placeholder, style: "meta", x: 0, w: measure(placeholder) }]];
  return joinParagraphLines(lines).flatMap(runs => wrapRuns(runs, measure, width));
}

// 段落ごとの変更を「No.・頁｜新｜旧」の表に並べる。height が有限ならページ分けし、
// 収まらない行は次のページへ続け、ページごとに見出し行を付ける。
export function layoutTextReport(entries, measure, { width, height = Infinity, fontPx }) {
  const lineH = Math.round(fontPx * 1.6);
  const margin = fontPx * 4;
  const pad = Math.round(fontPx * 0.5);
  const top = margin + lineH * 2;
  const bottom = height - margin;
  const noW = Math.ceil(measure("旧 p00–00")) + pad * 2;
  const textW = Math.floor((width - margin * 2 - noW) / 2);
  const cols = [
    { x: margin, w: noW },
    { x: margin + noW, w: textW },
    { x: margin + noW + textW, w: textW },
  ];
  const pages = [];
  let page = null;
  let y = top;
  const box = (col, h, head = false) => page.items.push({ type: "box", x: col.x, y, w: col.w, h, head });
  const text = (col, line, lineY) => {
    for (const segment of line) page.items.push({ type: "run", ...segment, x: col.x + pad + segment.x, y: lineY });
  };
  const newPage = () => {
    page = { items: [] };
    pages.push(page);
    y = top;
    const headH = lineH + pad * 2;
    ["No.・頁", "新", "旧"].forEach((label, i) => {
      box(cols[i], headH, true);
      const w = measure(label);
      page.items.push({ type: "run", text: label, style: "head", x: cols[i].x + (cols[i].w - w) / 2, y: y + pad, w });
    });
    y += headH;
  };

  entries.forEach((entry, index) => {
    const no = [`${entry.number ?? index + 1}`, pageLabel("新", entry.newPage, entry.newPageEnd), pageLabel("旧", entry.oldPage, entry.oldPageEnd)]
      .filter(Boolean)
      .map(label => [{ text: label, style: "meta", x: 0, w: measure(label) }]);
    const columns = [
      no,
      columnLines(entry.newLines, PLACEHOLDER.removed, measure, textW - pad * 2),
      columnLines(entry.oldLines, PLACEHOLDER.added, measure, textW - pad * 2),
    ];
    const total = Math.max(...columns.map(lines => lines.length));
    for (let done = 0; done < total;) {
      // 見出しの直後でなければ、本文が2行入らないページには置かない。
      const fit = Math.floor((bottom - y - pad * 2) / lineH);
      if (!page || (fit < Math.min(2, total - done) && y > top + lineH * 2)) { newPage(); continue; }
      const take = Math.max(1, Math.min(total - done, fit));
      const h = take * lineH + pad * 2;
      columns.forEach((lines, i) => {
        box(cols[i], h);
        lines.slice(done, done + take).forEach((line, k) => text(cols[i], line, y + pad + k * lineH));
      });
      y += h;
      done += take;
    }
  });

  if (!entries.length) {
    newPage();
    page.items.push({ type: "run", x: margin, y: y + pad, text: "テキスト差分はありません", style: "plain" });
    y += lineH + pad * 2;
  }
  return { pages, width, height: Number.isFinite(height) ? height : y + margin, fontPx, lineH, margin };
}
