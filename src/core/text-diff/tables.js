import DiffMatchPatch from "diff-match-patch";

const TABLE_ROWS_MIN = 3;
const TABLE_COLS_MIN = 2;
const TABLE_XQ = 8;

function clusterColumns(xs, tol){
  const sorted = xs.slice().sort((a,b)=>a-b);
  const clusters = [];
  for(const x of sorted){
    const last = clusters[clusters.length-1];
    if(last && x - last.max <= tol){ last.max=x; last.sum+=x; last.n++; }
    else clusters.push({max:x, sum:x, n:1});
  }
  return clusters.map(c=>c.sum/c.n);
}

export function detectTables(pageLines){
  if(!pageLines || pageLines.length < TABLE_ROWS_MIN) return [];
  const allX = [];
  for(const line of pageLines) for(const tok of line.tokens) allX.push(tok.transform[4]);
  if(!allX.length) return [];
  const cols = clusterColumns(allX, TABLE_XQ);
  if(cols.length < TABLE_COLS_MIN) return [];

  const nearestCol = x => {
    let best=0, bd=Infinity;
    for(let i=0;i<cols.length;i++){ const d=Math.abs(cols[i]-x); if(d<bd){ bd=d; best=i; } }
    return best;
  };
  const lineColSets = pageLines.map(line => {
    const set = new Set();
    for(const tok of line.tokens) set.add(nearestCol(tok.transform[4]));
    return set;
  });

  const tables = [];
  let runStart = -1, unionCols = new Set();
  const flushRun = end => {
    if(runStart>=0 && (end-runStart)>=TABLE_ROWS_MIN && unionCols.size>=TABLE_COLS_MIN){
      tables.push(buildTableFromRun(pageLines, runStart, end, [...unionCols].sort((x,y)=>x-y), nearestCol));
    }
    runStart = -1; unionCols = new Set();
  };
  for(let i=0;i<pageLines.length;i++){
    if(lineColSets[i].size >= TABLE_COLS_MIN){
      if(runStart<0) runStart = i;
      for(const c of lineColSets[i]) unionCols.add(c);
    } else flushRun(i);
  }
  flushRun(pageLines.length);
  return tables;
}

function buildTableFromRun(pageLines, rowStart, rowEnd, colIdxs, nearestCol){
  const colIndexMap = new Map(colIdxs.map((c,i)=>[c,i]));
  const rows = [];
  let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
  for(let r=rowStart;r<rowEnd;r++){
    const cells = colIdxs.map(()=>[]);
    for(const tok of pageLines[r].tokens){
      const ci = nearestCol(tok.transform[4]);
      if(colIndexMap.has(ci)) cells[colIndexMap.get(ci)].push(tok);
      const x = tok.transform[4], y = tok.transform[5];
      if(x<minX) minX=x; if(x>maxX) maxX=x;
      if(y<minY) minY=y; if(y>maxY) maxY=y;
    }
    rows.push(cells);
  }
  return {rows, rowCount:rows.length, colCount:colIdxs.length, box:{x0:minX,y0:minY,x1:maxX,y1:maxY}};
}

function tableCellText(cell){
  return cell.slice().sort((a,b)=>a.transform[4]-b.transform[4]).map(t=>t.str).join("").trim();
}

function pushHiEntry(map, pageIndex, token, color){
  if(!map.has(pageIndex)) map.set(pageIndex, []);
  map.get(pageIndex).push({token, color});
}

function insideBox(x, y, box){
  return x>=box.x0-1e-6 && x<=box.x1+1e-6 && y>=box.y0-1e-6 && y<=box.y1+1e-6;
}

function removeHighlightsInBox(map, pageIndex, box){
  const arr = map.get(pageIndex);
  if(!arr) return;
  map.set(pageIndex, arr.filter(({token}) => !insideBox(token.transform[4], token.transform[5], box)));
}

// 表の範囲に入る行単位の変更記録を外し、セル記録の差し込み位置（無ければ末尾）を返す。
function removeChangesInTables(changes, pageIndex, oldBox, newBox){
  let at = -1;
  for(let i=changes.length-1;i>=0;i--){
    const c = changes[i];
    const inOld = c.oldPage===pageIndex && c.oldAt && insideBox(c.oldAt[0], c.oldAt[1], oldBox);
    const inNew = c.newPage===pageIndex && c.newAt && insideBox(c.newAt[0], c.newAt[1], newBox);
    if(inOld || inNew){ changes.splice(i,1); at = i; }
  }
  return at < 0 ? changes.length : at;
}

function chunkRowCount(text){
  const n = text.split("\n").length;
  return text.endsWith("\n") ? n-1 : n;
}
function rowCells(row){ return row.map(tableCellText); }
function rowLabel(cells){ return cells.filter(Boolean).join(" "); }

// 行を添字で組むと1行の挿入で以降が全てズレるため、行の内容で対応付けてから比較する。
// 対応が取れた行は {old, new} の組、片側だけの行は相手が null になる。
function alignRows(oldRows, newRows){
  const dmp = new DiffMatchPatch();
  const keys = rows => rows.map(r => rowCells(r).join("\t")).join("\n");
  const a = dmp.diff_linesToChars_(keys(oldRows), keys(newRows));
  const diffs = dmp.diff_main(a.chars1, a.chars2, false);
  dmp.diff_charsToLines_(diffs, a.lineArray);
  const pairs = [];
  let oi = 0, ni = 0;
  for(let i=0;i<diffs.length;i++){
    const op = diffs[i][0], cnt = chunkRowCount(diffs[i][1]);
    if(op===0){ oi += cnt; ni += cnt; continue; }
    if(op===-1){
      const next = diffs[i+1];
      const addCnt = next && next[0]===1 ? chunkRowCount(next[1]) : 0;
      const n = Math.min(cnt, addCnt);
      for(let k=0;k<n;k++) pairs.push({old:oi+k, new:ni+k});
      for(let k=n;k<cnt;k++) pairs.push({old:oi+k, new:null});
      for(let k=n;k<addCnt;k++) pairs.push({old:null, new:ni+k});
      oi += cnt; ni += addCnt;
      if(addCnt) i++;
      continue;
    }
    for(let k=0;k<cnt;k++) pairs.push({old:null, new:ni+k});
    ni += cnt;
  }
  return pairs;
}

// 着色はセル単位。差があったかだけを返し、記録は呼び出し側が行単位でまとめる。
function markCellPair(oldCell, newCell, pageIndex, hi){
  const oldStr = tableCellText(oldCell), newStr = tableCellText(newCell);
  if(oldStr === newStr) return false;
  const kind = !newStr ? "removed" : !oldStr ? "added" : "changed";
  if(kind!=="added") for(const tok of oldCell) pushHiEntry(hi.old, pageIndex, tok, kind);
  if(kind!=="removed") for(const tok of newCell) pushHiEntry(hi.new, pageIndex, tok, kind);
  return true;
}

// 1行の変更をセルごとの記録に割ると "*" や "3" だけの記録が並んでどの部品か分からなくなる。
// 記録は行につき1件、本文は行テキストで作る。
function diffRowPair(oldRow, newRow, pageIndex, hi, out){
  let differs = false;
  for(let c=0;c<oldRow.length;c++){
    if(markCellPair(oldRow[c], newRow[c], pageIndex, hi)) differs = true;
  }
  if(!differs) return;
  const oldText = rowLabel(rowCells(oldRow)), newText = rowLabel(rowCells(newRow));
  if(oldText === newText) return;
  const kind = !newText ? "removed" : !oldText ? "added" : "changed";
  let parts = [];
  if(kind === "changed"){
    const dmp = new DiffMatchPatch();
    const cdiffs = dmp.diff_main(oldText, newText);
    dmp.diff_cleanupSemantic(cdiffs);
    parts = cdiffs.map(d => [d[0], d[1]]);
  }
  out.push({
    kind, oldText, newText, parts,
    oldPage: oldText ? pageIndex : null, newPage: newText ? pageIndex : null,
  });
}

function diffWholeRow(row, side, pageIndex, hi, out){
  const label = rowLabel(rowCells(row));
  if(!label) return;
  const kind = side==="old" ? "removed" : "added";
  for(const cell of row) for(const tok of cell) pushHiEntry(hi[side], pageIndex, tok, kind);
  out.push({
    kind, oldText: side==="old" ? label : "", newText: side==="new" ? label : "",
    parts: [],
    oldPage: side==="old" ? pageIndex : null, newPage: side==="new" ? pageIndex : null,
  });
}

function applyTableDiff(oldTable, newTable, pageIndex, hi){
  if(oldTable.colCount !== newTable.colCount) return;
  removeHighlightsInBox(hi.old, pageIndex, oldTable.box);
  removeHighlightsInBox(hi.new, pageIndex, newTable.box);
  const changes = hi.changes;
  const at = removeChangesInTables(changes, pageIndex, oldTable.box, newTable.box);
  const records = [];
  for(const pair of alignRows(oldTable.rows, newTable.rows)){
    if(pair.old !== null && pair.new !== null){
      diffRowPair(oldTable.rows[pair.old], newTable.rows[pair.new], pageIndex, hi, records);
      continue;
    }
    const side = pair.old !== null ? "old" : "new";
    const row = side==="old" ? oldTable.rows[pair.old] : newTable.rows[pair.new];
    diffWholeRow(row, side, pageIndex, hi, records);
  }
  changes.splice(at, 0, ...records);
}

function overlapArea(a, b){
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

// 表も添字で組むと片側に表が増えただけで全部ズレる。列数が一致し、ページ上で最も重なる表同士を組む。
// 相手が見つからない表は触らず、行diffの着色をそのまま残す。
export function applyTableHighlights(oldPages, newPages, hi){
  const maxPages = Math.max(oldPages.length, newPages.length);
  for(let p=0;p<maxPages;p++){
    const oldTables = detectTables(oldPages[p] || []);
    const newTables = detectTables(newPages[p] || []);
    const used = new Set();
    for(const oldTable of oldTables){
      let best = -1, bestArea = 0;
      newTables.forEach((newTable, i) => {
        if(used.has(i) || newTable.colCount !== oldTable.colCount) return;
        const area = overlapArea(oldTable.box, newTable.box);
        if(area > bestArea){ bestArea = area; best = i; }
      });
      if(best < 0) continue;
      used.add(best);
      applyTableDiff(oldTable, newTables[best], p, hi);
    }
  }
  return hi;
}
