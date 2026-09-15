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

  const hi = {old:new Map(), new:new Map(), changes:[]};
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
  // 差分レポート用の変更記録。表の中の行は applyTableHighlights がセル単位の記録に差し替える。
  const firstTokenAt = line => line?.tokens[0] ? [line.tokens[0].transform[4], line.tokens[0].transform[5]] : null;
  const pushChange = (kind, oldLine, newLine, parts=[]) => {
    const oldText = oldLine?.text ?? "", newText = newLine?.text ?? "";
    if(!oldText.trim() && !newText.trim()) return;
    // 末尾に改行の無い最終行は行差分で別行扱いになり、同じ文字列同士が組になることがある。
    if(kind==="changed" && oldText===newText) return;
    hi.changes.push({
      kind, oldText, newText, parts,
      oldPage: oldLine ? oldLine.pageIndex : null, newPage: newLine ? newLine.pageIndex : null,
      oldAt: firstTokenAt(oldLine), newAt: firstTokenAt(newLine),
    });
  };
  const markWhole = (side, idx, kind) => {
    const flat = side==="old" ? oldFlat : newFlat;
    highlightLine(flat, side, idx, kind, null);
    pushChange(kind, side==="old" ? flat[idx] : null, side==="new" ? flat[idx] : null);
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
          pushChange("changed", oldLine, newLine, cdiffs.map(d => [d[0], d[1]]));
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
        for(let k=n;k<cnt;k++) markWhole("old", oldIdx+k, "removed");
        for(let k=n;k<addCnt;k++) markWhole("new", newIdx+k, "added");
        oldIdx += cnt; newIdx += addCnt;
        i++;
        continue;
      }
      for(let k=0;k<cnt;k++) markWhole("old", oldIdx+k, "removed");
      oldIdx += cnt;
      continue;
    }
    if(op===1){
      for(let k=0;k<cnt;k++) markWhole("new", newIdx+k, "added");
      newIdx += cnt;
    }
  }
  return hi;
}
