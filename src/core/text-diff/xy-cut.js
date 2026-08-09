const XYCUT_MAX_DEPTH = 6;
const XYCUT_MIN_BLOCK_TOKENS = 2;
const COL_GAP_EM = 2.5;
const ROW_GAP_EM = 1.6;
const COL_MIN_SIDE_LINES = 3;

function unionGaps(intervals){
  if(intervals.length < 2) return [];
  const sorted = intervals.slice().sort((a,b)=>a[0]-b[0]);
  const gaps = [];
  let curEnd = sorted[0][1];
  for(let i=1;i<sorted.length;i++){
    const lo = sorted[i][0], hi = sorted[i][1];
    if(lo > curEnd){ gaps.push({lo:curEnd, hi:lo, size:lo-curEnd}); curEnd = hi; }
    else if(hi > curEnd){ curEnd = hi; }
  }
  return gaps;
}
function medianFh(tokens){
  const fhs = tokens.map(t=>t.fh).filter(v=>v>0).sort((a,b)=>a-b);
  if(!fhs.length) return 0;
  const m = fhs.length >> 1;
  return fhs.length % 2 ? fhs[m] : (fhs[m-1]+fhs[m]) / 2;
}
function distinctRowCount(tokens, q){
  if(q <= 0) return tokens.length;
  const s = new Set();
  for(const t of tokens) s.add(Math.round(t.y0 / q));
  return s.size;
}
function minOrd(leafList){
  let m = Infinity;
  for(const leaf of leafList) for(const t of leaf) if(t.ord < m) m = t.ord;
  return m;
}
function orderByMinOrd(groups){
  return groups.map(g=>({g,key:minOrd(g)})).sort((a,b)=>a.key-b.key).flatMap(x=>x.g);
}

export function xyCut(tokens, options={}){
  const maxDepth = options.maxDepth ?? XYCUT_MAX_DEPTH;
  const minBlockTokens = options.minBlockTokens ?? XYCUT_MIN_BLOCK_TOKENS;
  const colGapEm = options.colGapEm ?? COL_GAP_EM;
  const rowGapEm = options.rowGapEm ?? ROW_GAP_EM;
  const colMinSideLines = options.colMinSideLines ?? COL_MIN_SIDE_LINES;
  const context = options.context || {hadVerticalCut:false};
  const cut = (block, depth) => {
    if(block.length < minBlockTokens || depth >= maxDepth) return [block];
    const fh = medianFh(block);
    if(fh <= 0) return [block];
    const q = fh / 2;
    let bestCol = null;
    for(const g of unionGaps(block.map(t=>[t.x0, t.x1]))){
      if(g.size < colGapEm * fh) continue;
      const mid = (g.lo + g.hi) / 2;
      const left = block.filter(t => t.x0 < mid);
      const right = block.filter(t => t.x0 >= mid);
      if(distinctRowCount(left, q) < colMinSideLines) continue;
      if(distinctRowCount(right, q) < colMinSideLines) continue;
      if(!bestCol || g.size > bestCol.size) bestCol = {size:g.size, left, right};
    }
    let bestRow = null;
    for(const g of unionGaps(block.map(t=>[t.y0, t.y1]))){
      if(g.size < rowGapEm * fh) continue;
      if(!bestRow || g.size > bestRow.size) bestRow = {size:g.size, mid:(g.lo+g.hi)/2};
    }
    const colScore = bestCol ? bestCol.size / fh : -1;
    const rowScore = bestRow ? bestRow.size / fh : -1;
    if(colScore < 0 && rowScore < 0) return [block];
    if(rowScore >= colScore && bestRow){
      const top = block.filter(t => t.y0 >= bestRow.mid);
      const bot = block.filter(t => t.y0 < bestRow.mid);
      return orderByMinOrd([cut(top, depth+1), cut(bot, depth+1)]);
    }
    context.hadVerticalCut = true;
    const childL = cut(bestCol.left, depth+1);
    const childR = cut(bestCol.right, depth+1);
    return [...childL, ...childR];
  };
  return cut(tokens, 0);
}
