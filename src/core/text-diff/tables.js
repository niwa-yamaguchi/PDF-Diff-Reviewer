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

function removeHighlightsInBox(map, pageIndex, box){
  const arr = map.get(pageIndex);
  if(!arr) return;
  map.set(pageIndex, arr.filter(({token}) => {
    const x = token.transform[4], y = token.transform[5];
    const inside = x>=box.x0-1e-6 && x<=box.x1+1e-6 && y>=box.y0-1e-6 && y<=box.y1+1e-6;
    return !inside;
  }));
}

function applyTableDiff(oldTable, newTable, pageIndex, hi){
  if(oldTable.rowCount !== newTable.rowCount || oldTable.colCount !== newTable.colCount) return;
  removeHighlightsInBox(hi.old, pageIndex, oldTable.box);
  removeHighlightsInBox(hi.new, pageIndex, newTable.box);
  for(let r=0;r<oldTable.rowCount;r++){
    for(let c=0;c<oldTable.colCount;c++){
      const oldCell = oldTable.rows[r][c], newCell = newTable.rows[r][c];
      const oldStr = tableCellText(oldCell), newStr = tableCellText(newCell);
      if(oldStr === newStr) continue;
      if(oldStr && !newStr){
        for(const tok of oldCell) pushHiEntry(hi.old, pageIndex, tok, "removed");
      } else if(!oldStr && newStr){
        for(const tok of newCell) pushHiEntry(hi.new, pageIndex, tok, "added");
      } else {
        for(const tok of oldCell) pushHiEntry(hi.old, pageIndex, tok, "changed");
        for(const tok of newCell) pushHiEntry(hi.new, pageIndex, tok, "changed");
      }
    }
  }
}

export function applyTableHighlights(oldPages, newPages, hi){
  const maxPages = Math.max(oldPages.length, newPages.length);
  for(let p=0;p<maxPages;p++){
    const oldTables = detectTables(oldPages[p] || []);
    const newTables = detectTables(newPages[p] || []);
    const n = Math.min(oldTables.length, newTables.length);
    for(let i=0;i<n;i++) applyTableDiff(oldTables[i], newTables[i], p, hi);
  }
  return hi;
}
