import DiffMatchPatch from "diff-match-patch";
import { flattenLines } from "./tokens.js";

function pushHiEntry(map, pageIndex, token, color){
  if(!map.has(pageIndex)) map.set(pageIndex, []);
  map.get(pageIndex).push({token, color});
}

function diffChunkLineCount(text){
  const n = text.split("\n").length;
  return text.endsWith("\n") ? n-1 : n;
}

function rangeOverlapsToken(tok, start, end){
  return tok.off < end && (tok.off + tok.str.length) > start;
}

export function buildTextHighlights(oldPages, newPages){
  const oldFlat = flattenLines(oldPages);
  const newFlat = flattenLines(newPages);
  const oldText = oldFlat.map(l=>l.text).join("\n");
  const newText = newFlat.map(l=>l.text).join("\n");

  const hi = {old:new Map(), new:new Map()};
  const dmp = new DiffMatchPatch();
  const a = dmp.diff_linesToChars_(oldText, newText);
  const diffs = dmp.diff_main(a.chars1, a.chars2, false);
  dmp.diff_charsToLines_(diffs, a.lineArray);

  const highlightLine = (flat, side, idx, color, rangeStart, rangeEnd) => {
    const line = flat[idx];
    for(const tok of line.tokens){
      if(rangeStart==null || rangeOverlapsToken(tok, rangeStart, rangeEnd)){
        pushHiEntry(hi[side], line.pageIndex, tok, color);
      }
    }
  };

  let oldIdx = 0, newIdx = 0;
  for(let i=0;i<diffs.length;i++){
    const op = diffs[i][0], text = diffs[i][1];
    const cnt = diffChunkLineCount(text);
    if(op===0){ oldIdx += cnt; newIdx += cnt; continue; }
    if(op===-1){
      const next = diffs[i+1];
      if(next && next[0]===1){
        const addCnt = diffChunkLineCount(next[1]);
        const n = Math.min(cnt, addCnt);
        for(let k=0;k<n;k++){
          const oldLine = oldFlat[oldIdx+k], newLine = newFlat[newIdx+k];
          const cdiffs = dmp.diff_main(oldLine.text, newLine.text);
          dmp.diff_cleanupSemantic(cdiffs);
          let oldPos=0, newPos=0;
          for(const part of cdiffs){
            const pop = part[0], ptext = part[1];
            if(pop===0){ oldPos+=ptext.length; newPos+=ptext.length; }
            else if(pop===-1){
              highlightLine(oldFlat, "old", oldIdx+k, "changed", oldPos, oldPos+ptext.length);
              oldPos += ptext.length;
            } else {
              highlightLine(newFlat, "new", newIdx+k, "changed", newPos, newPos+ptext.length);
              newPos += ptext.length;
            }
          }
        }
        for(let k=n;k<cnt;k++) highlightLine(oldFlat, "old", oldIdx+k, "removed", null);
        for(let k=n;k<addCnt;k++) highlightLine(newFlat, "new", newIdx+k, "added", null);
        oldIdx += cnt; newIdx += addCnt;
        i++;
        continue;
      }
      for(let k=0;k<cnt;k++) highlightLine(oldFlat, "old", oldIdx+k, "removed", null);
      oldIdx += cnt;
      continue;
    }
    if(op===1){
      for(let k=0;k<cnt;k++) highlightLine(newFlat, "new", newIdx+k, "added", null);
      newIdx += cnt;
    }
  }
  return hi;
}
