import DiffMatchPatch from "diff-match-patch";
import { detectTables } from "./tables.js";

// 行送りは本文で約1.6em、段落の間は2.5em前後。表の折り返し判定と同じ閾値で段落を区切る。
const PARA_GAP_EM = 1.85;
const FONT_TOL_EM = 0.1;
const CELL_SEP = "  ";
// 対応付けで同じ段落と見なす最低の一致率。これ未満の組は削除と新設に分ける。
const PAIR_MIN_SIMILARITY = 0.5;
// ponytail: 置換ブロック内の対応付けは m×n の文字diff。巨大なブロックでは添字順に組む。
const PAIR_MAX_CELLS = 40000;

const SENTENCE_END = /[。．.]\s*$/;
const pieceText = pieces => pieces.map(piece => piece.tok ? piece.tok.str : piece.text).join("");
const fontHeight = tok => Math.hypot(tok.transform[2], tok.transform[3]) || 1;

// ページごとの行を段落（表は1行）に分ける。段落は {page, lines}、lines は行ごとの「片」の並び。
// 片は {tok} か区切りの {text}。表の行はセルを1行に並べる。
// 文の途中でページが変わった段落は前のページの段落につなげ、pageEnd に最後のページを持つ。
function splitUnits(pages){
  const units = [];
  let carry = null;
  pages.forEach((lines, page) => {
    const first = units.length;
    const rowOf = new Map();
    for(const table of detectTables(lines)) for(const row of table.rows){
      const cells = row.filter(cell => cell.some(tok => tok.str.trim()));
      if(!cells.length) continue;
      const unit = {page, pageEnd:page, row:true, lines:[cells.flatMap((cell, i) => [...(i ? [{text:CELL_SEP}] : []), ...cell.map(tok => ({tok}))])]};
      for(const cell of cells) for(const tok of cell) rowOf.set(tok, unit);
    }
    const placed = new Set();
    let cur = null, prev = null;
    for(const line of lines){
      const tokens = line.tokens.filter(tok => tok.str);
      if(!tokens.some(tok => tok.str.trim())) continue;
      const row = rowOf.get(tokens.find(tok => tok.str.trim()));
      if(row){
        if(!placed.has(row)){ placed.add(row); units.push(row); }
        cur = prev = null;
        continue;
      }
      const y = tokens[0].transform[5], fh = fontHeight(tokens[0]);
      const pieces = tokens.map(tok => ({tok}));
      const gap = prev ? prev.y - y : -1;
      if(cur && Math.abs(prev.fh - fh) <= FONT_TOL_EM * fh && gap > 0 && gap <= PARA_GAP_EM * fh) cur.lines.push(pieces);
      else { cur = {page, pageEnd:page, fh, lines:[pieces]}; units.push(cur); }
      prev = {y, fh};
    }
    const head = units[first];
    if(carry && head && !head.row && Math.abs(carry.fh - head.fh) <= FONT_TOL_EM * head.fh){
      carry.lines.push(...head.lines);
      carry.pageEnd = page;
      units.splice(first, 1);
    }
    // 続くのは、最後の行が右端近くまで埋まり、文が終わっていない段落だけ。表のセルや見出しは句点が無くても短い。
    const rightOf = toks => Math.max(...toks.map(tok => tok.transform[4] + (tok.w || 0)));
    const tail = units[units.length-1];
    carry = null;
    if(!tail || tail.row || tail.pageEnd !== page) return;
    const tailLine = tail.lines[tail.lines.length-1];
    if(SENTENCE_END.test(pieceText(tailLine))) return;
    // 右端は最後の行以外から取る。比べる行が無ければつながない。
    const tailToks = new Set(tailLine.map(piece => piece.tok));
    const others = lines.filter(line => line.tokens.length && !line.tokens.some(tok => tailToks.has(tok)));
    if(!others.length) return;
    const pageRight = Math.max(...others.map(line => rightOf(line.tokens)));
    if(rightOf([...tailToks]) >= pageRight - 2 * tail.fh) carry = tail;
  });
  return units;
}

// トークンごとの着色 [{color, start, end}]。highlights の Map はページ→[{token, color, start?, end?}]。
function marksByToken(map){
  const marks = new Map();
  for(const entries of map.values()) for(const {token, color, start, end} of entries){
    if(!marks.has(token)) marks.set(token, []);
    marks.get(token).push({color, start: start ?? 0, end: end ?? token.str.length});
  }
  return marks;
}

// 段落を行ごとの [{text, style}] にする。style は plain か着色の色（removed/added/changed）。
function unitRuns(unit, marks){
  let changed = false;
  const lines = unit.lines.map(pieces => {
    const runs = [];
    const push = (text, style) => {
      const last = runs[runs.length-1];
      if(last && last.style === style) last.text += text;
      else runs.push({text, style});
    };
    for(const piece of pieces){
      if(piece.text != null){ push(piece.text, "plain"); continue; }
      const tokMarks = marks.get(piece.tok) || [];
      [...piece.tok.str].forEach((char, i) => {
        // 空白は塗らない。下線がセルの区切りまで伸びて変更の範囲が広く見えるため。
        const mark = char.trim() && tokMarks.find(m => i >= m.start && i < m.end);
        if(mark) changed = true;
        push(char, mark ? mark.color : "plain");
      });
    }
    return runs;
  });
  return {lines, changed};
}

const unitKey = unit => unit.lines.flat().map(piece => piece.tok ? piece.tok.str : "").join("").replace(/\s+/g, "");

// 一致した文字数を短い側の長さで割る。段落に文を足しただけなら1に近くなる。
function similarity(dmp, a, b){
  const len = Math.min(a.length, b.length);
  if(!len) return 0;
  const diffs = dmp.diff_main(a, b, false);
  dmp.diff_cleanupSemantic(diffs);
  return diffs.reduce((sum, [op, text]) => sum + (op === 0 ? text.length : 0), 0) / len;
}

// 置換ブロック内の段落を、順序を保ったまま一致率の合計が最大になるように組む。
function pairBlock(dmp, oldKeys, newKeys){
  const m = oldKeys.length, n = newKeys.length;
  if(m * n > PAIR_MAX_CELLS){
    const k = Math.min(m, n);
    return [...Array(k)].map((_, i) => [i, i]);
  }
  const sim = oldKeys.map(a => newKeys.map(b => similarity(dmp, a, b)));
  const best = [...Array(m+1)].map(() => new Array(n+1).fill(0));
  for(let i=m-1;i>=0;i--) for(let j=n-1;j>=0;j--){
    const take = sim[i][j] >= PAIR_MIN_SIMILARITY ? sim[i][j] + best[i+1][j+1] : -1;
    best[i][j] = Math.max(take, best[i+1][j], best[i][j+1]);
  }
  const pairs = [];
  for(let i=0, j=0; i<m && j<n;){
    if(sim[i][j] >= PAIR_MIN_SIMILARITY && best[i][j] === sim[i][j] + best[i+1][j+1]){ pairs.push([i, j]); i++; j++; }
    else if(best[i][j] === best[i+1][j]) i++;
    else j++;
  }
  return pairs;
}

// 新旧の段落を対応付けた並び [{old, new}]。片側だけの段落は相手が null。
function alignUnits(oldUnits, newUnits){
  const dmp = new DiffMatchPatch();
  const oldKeys = oldUnits.map(unitKey), newKeys = newUnits.map(unitKey);
  const a = dmp.diff_linesToChars_(oldKeys.join("\n"), newKeys.join("\n"));
  const diffs = dmp.diff_main(a.chars1, a.chars2, false);
  const out = [];
  let oi = 0, ni = 0, delCnt = 0, addCnt = 0;
  const flush = () => {
    const pairs = pairBlock(dmp, oldKeys.slice(oi, oi+delCnt), newKeys.slice(ni, ni+addCnt));
    let i = 0, j = 0;
    for(const [pi, pj] of [...pairs, [delCnt, addCnt]]){
      for(; i<pi; i++) out.push({old:oldUnits[oi+i], new:null});
      for(; j<pj; j++) out.push({old:null, new:newUnits[ni+j]});
      if(pi < delCnt) out.push({old:oldUnits[oi+pi], new:newUnits[ni+pj]});
      i = pi+1; j = pj+1;
    }
    oi += delCnt; ni += addCnt; delCnt = addCnt = 0;
  };
  for(const [op, chars] of diffs){
    if(op === 0){
      flush();
      for(let k=0;k<chars.length;k++) out.push({old:oldUnits[oi+k], new:newUnits[ni+k]});
      oi += chars.length; ni += chars.length;
    } else if(op === -1) delCnt += chars.length;
    else addCnt += chars.length;
  }
  flush();
  return out;
}

// 着色のある段落だけを、新旧の組にして返す。着色は highlights（画面と同じ差分）をそのまま使う。
// 返す項目は {kind, oldPage, oldPageEnd, newPage, newPageEnd, oldLines, newLines}。片側が無ければその側は null。
export function buildParagraphReport(extraction, highlights){
  if(!extraction || !highlights) return [];
  const oldMarks = marksByToken(highlights.old), newMarks = marksByToken(highlights.new);
  const items = [];
  for(const pair of alignUnits(splitUnits(extraction.old || []), splitUnits(extraction.new || []))){
    const o = pair.old && unitRuns(pair.old, oldMarks);
    const n = pair.new && unitRuns(pair.new, newMarks);
    if(!(o?.changed || n?.changed)) continue;
    items.push({
      kind: !o ? "added" : !n ? "removed" : "changed",
      oldPage: pair.old ? pair.old.page : null,
      newPage: pair.new ? pair.new.page : null,
      oldPageEnd: pair.old ? pair.old.pageEnd : null,
      newPageEnd: pair.new ? pair.new.pageEnd : null,
      oldLines: o ? o.lines : null,
      newLines: n ? n.lines : null,
    });
  }
  return items;
}
