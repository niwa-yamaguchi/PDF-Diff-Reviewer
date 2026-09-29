import DiffMatchPatch from "diff-match-patch";
import { flattenLines } from "./tokens.js";

function pushHiEntry(map, pageIndex, token, color, start=0, end=token.str.length){
  if(!map.has(pageIndex)) map.set(pageIndex, []);
  // start/end はトークン内の文字位置。トークン全体なら省き、描画側でトークン幅いっぱいに塗る。
  map.get(pageIndex).push(start<=0 && end>=token.str.length ? {token, color} : {token, color, start, end});
}

// 行のうち [start, end) の文字を着色する。範囲を省くと行全体。
// line.offs があればトークンの行内位置をそちらから取る（表のセルのようにトークンの off が別の行基準のとき）。
export function highlightLineRange(map, line, color, start=null, end=null){
  line.tokens.forEach((tok, i) => {
    if(start==null){ pushHiEntry(map, line.pageIndex, tok, color); return; }
    const off = line.offs ? line.offs[i] : tok.off;
    if(off >= end || off + tok.str.length <= start) return;
    pushHiEntry(map, line.pageIndex, tok, color, start-off, end-off);
  });
}

function diffChunkLineCount(text){
  const n = text.split("\n").length;
  return text.endsWith("\n") ? n-1 : n;
}

// 空白を除いた文字列と、その各文字の元の位置 [行, 行内の位置]、各行末の文字位置。
function stripLines(lines){
  let text = "";
  const at = [], ends = [];
  lines.forEach((line, k) => {
    for(let c=0;c<line.text.length;c++){
      if(/\s/.test(line.text[c])) continue;
      text += line.text[c];
      at.push([k, c]);
    }
    ends.push(text.length);
  });
  return {text, at, ends};
}

// 行の並びどうしを、連結し空白を除いて文字単位で比べる。行を添字で組むと折り返し位置が
// ずれただけの行が全て変更になり、文間の空白の有無だけでも変更になるため。
// ranges は変わった文字の [行, 行内の開始, 終了]、sync は両側の行末が一致区間の同じ文字位置に来る行数の組。
export function diffStrippedLines(oldLines, newLines, dmp=new DiffMatchPatch()){
  const o = stripLines(oldLines), n = stripLines(newLines);
  const cdiffs = dmp.diff_main(o.text, n.text);
  dmp.diff_cleanupSemantic(cdiffs);
  const ranges = {old:[], new:[]};
  const collect = (out, s, from, to) => {
    for(let p=from;p<to;){
      const [k, c] = s.at[p];
      let end = c+1;
      for(p++; p<to && s.at[p][0]===k; p++) end = s.at[p][1]+1;
      out.push([k, c, end]);
    }
  };
  const sync = [[0, 0]];
  let oldPos = 0, newPos = 0;
  for(const [pop, ptext] of cdiffs){
    const len = ptext.length;
    if(pop===0){
      let j = sync[sync.length-1][1];
      for(let k=sync[sync.length-1][0]; k<oldLines.length; k++){
        if(o.ends[k] < oldPos) continue;
        if(o.ends[k] > oldPos+len) break;
        const target = newPos + o.ends[k] - oldPos;
        while(j < newLines.length && n.ends[j] < target) j++;
        if(j < newLines.length && n.ends[j]===target) sync.push([k+1, j+1]);
      }
      oldPos += len; newPos += len;
    } else if(pop===-1){
      collect(ranges.old, o, oldPos, oldPos+len);
      oldPos += len;
    } else {
      collect(ranges.new, n, newPos, newPos+len);
      newPos += len;
    }
  }
  sync.push([oldLines.length, newLines.length]);
  return {ranges, sync};
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

  const highlightLine = (flat, side, idx, color, rangeStart, rangeEnd) =>
    highlightLineRange(hi[side], flat[idx], color, rangeStart, rangeEnd);
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
      // collapseMovedRows が着色を取り消すための手がかり。同関数が最後に削除する。
      oldTokens: oldLine ? oldLine.tokens : [], newTokens: newLine ? newLine.tokens : [],
    });
  };
  const markWhole = (side, idx, kind) => {
    const flat = side==="old" ? oldFlat : newFlat;
    highlightLine(flat, side, idx, kind, null);
    pushChange(kind, side==="old" ? flat[idx] : null, side==="new" ? flat[idx] : null);
  };

  const joinLines = (flat, start, count) => {
    const lines = flat.slice(start, start+count);
    return lines.length ? {text:lines.map(l=>l.text).join(""), pageIndex:lines[0].pageIndex, tokens:lines.flatMap(l=>l.tokens)} : null;
  };
  const diffBlock = (oldStart, oldCnt, newStart, newCnt) => {
    const {ranges, sync} = diffStrippedLines(oldFlat.slice(oldStart, oldStart+oldCnt), newFlat.slice(newStart, newStart+newCnt), dmp);
    const marked = {old:new Array(oldCnt).fill(false), new:new Array(newCnt).fill(false)};
    // 文字の着色は旧版から消えた文字を削除、新版に入った文字を追加とする。置き換えも両側にそれぞれ塗る。
    for(const [k, c, e] of ranges.old){ highlightLine(oldFlat, "old", oldStart+k, "removed", c, e); marked.old[k] = true; }
    for(const [k, c, e] of ranges.new){ highlightLine(newFlat, "new", newStart+k, "added", c, e); marked.new[k] = true; }
    // 行数が揃う区間は行ごとに記録する。表の行が末尾まで変わると区切りが見つからず、1件にまとまってしまうため。
    const segments = [];
    for(let s=1;s<sync.length;s++){
      const [a0, b0] = sync[s-1], [a1, b1] = sync[s];
      if(a1-a0 === b1-b0) for(let k=0;k<a1-a0;k++) segments.push([a0+k, b0+k, a0+k+1, b0+k+1]);
      else segments.push([a0, b0, a1, b1]);
    }
    for(const [a0, b0, a1, b1] of segments){
      if(!marked.old.slice(a0, a1).some(Boolean) && !marked.new.slice(b0, b1).some(Boolean)) continue;
      const oldLine = joinLines(oldFlat, oldStart+a0, a1-a0), newLine = joinLines(newFlat, newStart+b0, b1-b0);
      if(oldLine && newLine){
        const parts = dmp.diff_main(oldLine.text, newLine.text);
        dmp.diff_cleanupSemantic(parts);
        pushChange("changed", oldLine, newLine, parts.map(d => [d[0], d[1]]));
      } else {
        pushChange(oldLine ? "removed" : "added", oldLine, newLine);
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
        diffBlock(oldIdx, cnt, newIdx, addCnt);
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

// 表ごとに列の切れ目が変わると同じ行でも空白位置がずれるため、照合は空白を除いて行う。
const moveKey = text => text.replace(/\s+/g, "");

function dropHighlights(map, pageIndex, tokens){
  if(pageIndex == null || !tokens || !tokens.length) return;
  const arr = map.get(pageIndex);
  if(!arr) return;
  const drop = new Set(tokens);
  map.set(pageIndex, arr.filter(entry => !drop.has(entry.token)));
}

// 行の挿入でページ送りが変わると、内容が同じ行でも「削除＋追加」になる。差分の最小編集としては
// 正しいが、レビュー上は変更ではないので、同一内容の削除／追加を1対1で組にして取り消す。
export function collapseMovedRows(hi){
  const pending = new Map();
  hi.changes.forEach((change, index) => {
    if(change.kind !== "added") return;
    const key = moveKey(change.newText);
    if(!key) return;
    if(!pending.has(key)) pending.set(key, []);
    pending.get(key).push(index);
  });
  const dropped = new Set();
  hi.changes.forEach((change, index) => {
    if(change.kind !== "removed") return;
    const queue = pending.get(moveKey(change.oldText));
    if(!queue || !queue.length) return;
    const match = hi.changes[queue.shift()];
    dropped.add(change); dropped.add(match);
    dropHighlights(hi.old, change.oldPage, change.oldTokens);
    dropHighlights(hi.new, match.newPage, match.newTokens);
  });
  hi.changes = hi.changes.filter(change => !dropped.has(change));
  for(const change of hi.changes){ delete change.oldTokens; delete change.newTokens; }
  return hi;
}
