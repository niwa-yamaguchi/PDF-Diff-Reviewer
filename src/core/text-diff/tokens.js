export function reconstructLinesInItemOrder(items){
  const lines = [];
  const TOL = 2.5;
  let cur = null;
  const flush = () => {
    if(cur && cur.parts.length){
      const sorted = cur.parts.slice().sort((a,b)=>a.x-b.x);
      let text = "";
      const tokens = [];
      for(const p of sorted){
        tokens.push({str:p.str, off:text.length, transform:p.transform.slice(), w:p.w});
        text += p.str;
      }
      lines.push({text:text.replace(/\s+$/, ""), tokens});
    }
    cur = null;
  };
  for(const it of items){
    const y = it.transform[5];
    if(cur===null || Math.abs(cur.y-y) > TOL){ flush(); cur = {y, parts:[]}; }
    if(it.str) cur.parts.push({x:it.transform[4], str:it.str, transform:it.transform, w:it.width});
    if(it.hasEOL){ flush(); cur = null; }
  }
  flush();
  return lines;
}

export function assembleFromLeaves(items, leaves){
  const boxes = leaves.map(leaf => {
    let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
    for(const t of leaf){ if(t.x0<x0)x0=t.x0; if(t.x1>x1)x1=t.x1; if(t.y0<y0)y0=t.y0; if(t.y1>y1)y1=t.y1; }
    return {x0,x1,y0,y1};
  });
  const buckets = leaves.map(()=>[]);
  for(const it of items){
    const px = it.transform[4], py = it.transform[5];
    let bi = -1;
    for(let i=0;i<boxes.length;i++){
      const b = boxes[i];
      if(px>=b.x0 && px<=b.x1 && py>=b.y0 && py<=b.y1){ bi=i; break; }
    }
    if(bi < 0){
      let bd = Infinity;
      for(let i=0;i<boxes.length;i++){
        const b = boxes[i];
        const dx = Math.max(b.x0-px, 0, px-b.x1), dy = Math.max(b.y0-py, 0, py-b.y1);
        const d = dx*dx + dy*dy;
        if(d < bd){ bd = d; bi = i; }
      }
    }
    buckets[bi < 0 ? 0 : bi].push(it);
  }
  const lines = [];
  for(const bucket of buckets){
    for(const ln of reconstructLinesInItemOrder(bucket)) lines.push(ln);
  }
  return lines;
}

export function flattenLines(pages){
  const flat = [];
  pages.forEach((pageLines, pageIndex) => {
    pageLines.forEach(line => flat.push({text:line.text, pageIndex, tokens:line.tokens}));
  });
  return flat;
}
