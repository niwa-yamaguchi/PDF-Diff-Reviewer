// PDF.js、CMap、標準フォントはローカルバンドルを使用する。
import { jsPDF } from "jspdf";
import { createCanvas, createWhiteCanvas } from "./platform/canvas.js";
import { downloadBlob } from "./platform/download.js";
import { pdfjsLib, PDF_DOCUMENT_OPTIONS } from "./platform/pdfjs.js";
import { clampBox, clampBoxes, normalizeRect as normRect } from "./core/geometry/rectangles.js";
import { luminanceAt as lum } from "./core/image-diff/luminance.js";
import { dilateMask, toleratedDiffMasks } from "./core/image-diff/masks.js";
import { computeBoxes } from "./core/change-boxes/detect.js";
import { bestAlignment } from "./core/alignment/similarity.js";
import { bestQuadrant } from "./core/alignment/quadrant.js";
import { assembleFromLeaves, reconstructLinesInItemOrder } from "./core/text-diff/tokens.js";
import { xyCut } from "./core/text-diff/xy-cut.js";
import { buildTextHighlights } from "./core/text-diff/highlights.js";
import { applyTableHighlights } from "./core/text-diff/tables.js";
import {
  legendLayout,
  LG_BORDER_PT,
} from "./core/legend/layout.js";
import { createAppState } from "./app/state.js";
import {
  applyInvalidatingChange,
  invalidateDocuments,
  invalidateDpi,
  invalidateManualAlignment,
  invalidatePageAlignment,
  invalidateThreshold,
  invalidateTolerance,
} from "./app/invalidation.js";

const state = createAppState();

const $ = id => document.getElementById(id);
const out = $("out"), octx = out.getContext("2d");
const boxLayer = $("boxLayer"), bctx = boxLayer.getContext("2d");

function setDrop(el, name){
  el.classList.add("set");
  el.querySelector(".fname").textContent = name;
}

async function loadPdf(file, which){
  if(!confirmDiscardBoxEdits()) return false;
  const doc = await pdfjsLib.getDocument({
    data: await file.arrayBuffer(),
    // CID方式（日本語等CJK）フォントのデコードにもローカルのCMap/標準フォントを使う。
    ...PDF_DOCUMENT_OPTIONS,
  }).promise;
  if(which==="old"){ state.documents.oldDoc = doc; setDrop($("dropOld"), file.name); }
  else { state.documents.newDoc = doc; setDrop($("dropNew"), file.name); }
  invalidateDocuments(state);
  syncInvalidatedBoxEditor();
  state.visual.rendered = false; // 差し替え後は「差分を表示」を再度押すまで調整コントロールで自動表示しない
  $("dlTextPng").disabled = true; $("dlTextPdf").disabled = true;
  if(state.documents.oldDoc && state.documents.newDoc){
    state.documents.oldSequence = Array.from({length:state.documents.oldDoc.numPages}, (_,i)=>i);
    state.documents.newSequence = Array.from({length:state.documents.newDoc.numPages}, (_,i)=>i);
    state.documents.alignmentOps = [];
    state.documents.pages = Math.max(state.documents.oldSequence.length, state.documents.newSequence.length);
    state.documents.currentPage = 0;
    $("run").disabled = false;
    $("runText").disabled = false;
    $("status").textContent = "準備完了 — 「差分を表示」を押してください";
    $("textStatus").textContent = "準備完了 — 「テキスト差分を表示」を押してください";
  }
  return true;
}

// ── 用紙サイズ正規化 ────────────────────────────────────────────
// 用紙サイズ違い(A4版↔A3版)の倍率は推定不要で、PDFのページ実寸(pt)から確定する。
// 大きい用紙を基準(dpi/72)にし、小さい用紙側だけを ratio 倍の高解像度で描くことで、
// 両版を「同一ピクセル寸法」に揃える。ベクタPDFなら両版とも劣化ゼロ。
// 用紙が同寸なら normalized=false で両方 dpi/72 となり、現行と完全一致する。
const FRAME_RATIO_EPS = 0.002;   // 用紙同寸とみなす倍率の許容（丸め差で毎回ワープしないため）
const FRAME_ASPECT_EPS = 0.01;   // 縦横比の不一致とみなす閾値

// ページ実寸(pt)。ページが無いスロット(空白/範囲外)は null。
// pdf.js はページオブジェクトを内部キャッシュするため、renderPageCanvas と
// 二重に getPage しても実質的な再取得コストは生じない。
async function pageSizePt(doc, idx){
  if(!doc || idx == null || idx >= doc.numPages) return null;
  const page = await doc.getPage(idx+1);
  const vp = page.getViewport({scale:1});
  return { w: vp.width, h: vp.height };
}

// 旧新のページ実寸から、両者が同一ピクセル寸法になる描画scaleを決める（純関数）。
// 縦横比が違う組（A4縦↔A3横など）は相似でないため正規化せず、警告フラグだけ立てる。
function framePlan(oldPt, newPt, dpi){
  const base = dpi/72;
  const none = { oldScale:base, newScale:base, frameScale:base, ratio:1,
                 normalized:false, aspectMismatch:false, refSide:null };
  if(!oldPt || !newPt) return none;
  if(!(oldPt.w>0 && oldPt.h>0 && newPt.w>0 && newPt.h>0)) return none;
  const refIsOld = (oldPt.w*oldPt.h) >= (newPt.w*newPt.h);
  const ref   = refIsOld ? oldPt : newPt;
  const other = refIsOld ? newPt : oldPt;
  const rw = ref.w/other.w, rh = ref.h/other.h;
  if(Math.abs(rw-rh)/Math.max(rw,rh) > FRAME_ASPECT_EPS){
    return { ...none, aspectMismatch:true };
  }
  const ratio = Math.min(rw, rh);
  if(Math.abs(ratio-1) <= FRAME_RATIO_EPS) return none;
  return {
    oldScale:  refIsOld ? base : base*ratio,
    newScale:  refIsOld ? base*ratio : base,
    frameScale: base,
    ratio, normalized:true, aspectMismatch:false,
    refSide: refIsOld ? "old" : "new"
  };
}

// PDFページ → 白背景のカラーCanvas（無い場合は null）
async function renderPageCanvas(doc, idx, scale){
  if(!doc || idx == null || idx >= doc.numPages) return null;
  const page = await doc.getPage(idx+1);
  const vp = page.getViewport({scale});
  const c = createWhiteCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const ctx = c.getContext("2d");
  await page.render({canvasContext:ctx, viewport:vp}).promise;
  return c;
}

// autoAlign ON かつ当ページ未推定なら、フーリエ・メリンで推定して alignCache に格納。
// oldC/newC はカラーCanvas。グレースケールFloat配列へ変換して estimateSimilarity に渡す。
function canvasToGrayF(c){
  if(!c) return null;
  const {width:w, height:h} = c;
  const d = c.getContext("2d").getImageData(0,0,w,h).data;
  const g = new Float64Array(w*h);
  for(let i=0,p=0;i<g.length;i++,p+=4) g[i] = 0.299*d[p] + 0.587*d[p+1] + 0.114*d[p+2];
  return { g, w, h };
}
// 象限判定用のプローブ描画の長辺px。本描画(state.comparison.dpi)とは独立の固定解像度にしてあるため、
// quadCache は dpi 非依存（＝dpi変更で破棄する必要がない）。
const QUAD_PROBE_LONG = 512;

// キャンバスの直角回転。k=0 は入力をそのまま返す（新規canvasを作らない）。
// これが「回転が絡まないペアでは現行と1画素も変わらない」ことの担保になっている。
// 直角かつ整数オフセットの回転はサンプル点が元画素の中心に厳密一致するため、
// setTransform 経由でも補間の影響を受けない（Task 4 のブラウザ実測で確認する）。
function rotateCanvas90(c, k){
  const kk = ((k % 4) + 4) % 4;
  if(!c || kk === 0) return c;
  const d = createWhiteCanvas(
    (kk === 2) ? c.width : c.height,
    (kk === 2) ? c.height : c.width,
  );
  const ctx = d.getContext("2d");
  // 未描画領域は透明黒のまま残るが、lum()/canvasToGrayF() はアルファを見ないため
  // 透明画素は輝度0＝インクとして誤認される。renderPageCanvas 等の他のcanvas生成箇所と
  // 同様に白で下地を敷いてから描く（回転で全面が埋まる場合でも一貫させておく）。
  ctx.imageSmoothingEnabled = false; // 直角回転の無損失性をブラウザ実装依存にしないため明示的に無効化
  if(kk === 1)      ctx.setTransform(0, 1, -1, 0, c.height, 0);          // 時計回り90°
  else if(kk === 2) ctx.setTransform(-1, 0, 0, -1, c.width, c.height);   // 180°
  else              ctx.setTransform(0, -1, 1, 0, 0, c.width);           // 時計回り270°
  ctx.drawImage(c, 0, 0);
  return d;
}

// autoAlign ON かつ当ページ未推定なら、低解像度プローブを描画して象限を推定しキャッシュする。
// oldPt/newPt は呼び出し側が pageSizePt で既に得ているものを渡す（再取得しない）。
async function ensureQuadEstimate(idx, oi, ni, oldPt, newPt){
  if(!state.comparison.autoAlign) return;
  if(state.visual.quadrantCache.has(idx)) return; // ページ別キャッシュ
  // 片側が空白スロットなら比較対象が無いので回さない（ensureAlignEstimate の blank 分岐と同じ扱い）
  // ここは await をまたがない早期書き込みなので世代ガードは不要。
  if(!oldPt || !newPt){
    state.visual.quadrantCache.set(idx, {k:0, scores:[1,0,0,0], applied:false, blank:true});
    return;
  }
  // 以降はプローブ描画で await をまたぐため、その間に loadPdf/refreshAfterAlign で
  // quadCache が破棄される（＝スロット→ページ対応が変わる）と、古い対応で算出した k を
  // 新しい対応のスロットへ書き戻してしまう。世代を捕捉し、書き込み直前に必ず照合する。
  const gen = state.visual.quadrantGeneration;
  const probeScale = pt => QUAD_PROBE_LONG / Math.max(pt.w, pt.h);
  const [oc, nc] = await Promise.all([
    renderPageCanvas(state.documents.oldDoc, oi, probeScale(oldPt)),
    renderPageCanvas(state.documents.newDoc, ni, probeScale(newPt))
  ]);
  if(gen !== state.visual.quadrantGeneration) return; // await中に世代が進んだので破棄（stale-write防止）。
  // これより下は同期処理のみなので再チェック不要。
  const O = canvasToGrayF(oc), Nw = canvasToGrayF(nc);
  if(!O || !Nw){
    state.visual.quadrantCache.set(idx, {k:0, scores:[1,0,0,0], applied:false, blank:true});
    return;
  }
  state.visual.quadrantCache.set(idx, bestQuadrant(O, Nw, state.comparison.threshold));
}

// 当ページに適用する直角回転量。手動上書きが最優先、次に自動推定、既定は0。
// 同期関数なので、呼び出し側は先に await ensureQuadEstimate(...) を済ませること。
function effectiveQuad(idx){
  const m = state.comparison.quadrantManual.get(idx);
  if(m != null) return m;
  if(!state.comparison.autoAlign) return 0;
  const q = state.visual.quadrantCache.get(idx);
  return (q && q.applied) ? q.k : 0;
}

function ensureAlignEstimate(idx, oldC, newC){
  if(!state.comparison.autoAlign) return;
  if(state.visual.alignmentCache.has(idx)) return; // ページ別キャッシュ
  const O = canvasToGrayF(oldC), Nw = canvasToGrayF(newC);
  // 片側が空白スロットなら比較対象が無いので恒等。スコアは定義上1だが、全面が追加/削除
  // として出るページで「一致率100%」と読ませないよう blank フラグで読み出しを分岐させる。
  if(!O || !Nw){
    state.visual.alignmentCache.set(idx, {angle:0,scale:1,txFrac:0,tyFrac:0,
      applied:false,method:"identity",scoreBase:1,scoreBest:1,blank:true});
    return;
  }
  state.visual.alignmentCache.set(idx, bestAlignment(O, Nw, state.comparison.threshold));
}

// alignCache の正規化パラメータ（new→old）から、現在Canvas寸法での適用可否と行列要素を返す。
// 自動推定値（ONかつ適用時）に手動角度・倍率を合成する（角度=加算、倍率=乗算）。
// 自動が無効/未適用のときは手動値のみが効く。手動値も既定(0/1)なら恒等（現行と完全一致）。
function alignMatrixFor(idx, oldW, oldH, newW, newH){
  const a = state.comparison.autoAlign ? state.visual.alignmentCache.get(idx) : null;
  const autoOn = !!(a && a.applied);
  const angle = (autoOn ? a.angle : 0) + state.comparison.manualAngle;
  const scale = (autoOn ? a.scale : 1) * state.comparison.manualScale;
  const Wc = Math.max(oldW, newW), Hc = Math.max(oldH, newH);
  const tx = autoOn ? a.txFrac*Wc : 0;
  const ty = autoOn ? a.tyFrac*Hc : 0;
  const applied = autoOn || state.comparison.manualAngle !== 0 || state.comparison.manualScale !== 1;
  return { angle, scale, tx, ty, applied };
}

// 新版ページCanvas(newC)を旧版フレームへワープしたカラーCanvasを返す。
// setTransform に自動行列を積み、その上に手動 dx/dy を平行移動として合成する。
// 出力Canvas寸法は buildDiff/buildToggle 側で決めた width/height を使う。
function renderAlignedNewCanvas(newC, m, width, height){
  const c = createWhiteCanvas(width, height);
  const ctx = c.getContext("2d");
  if(!newC) return c;
  const ncx = newC.width/2, ncy = newC.height/2;
  if(m.applied){
    // dest = center(=そのまま原点系) + t + scale·R(angle)·(src-newCenter)
    // ここでは newCenter を回転中心にし、旧フレーム原点へ (ncx,ncy)+dx/dy でマップ
    const cos=Math.cos(m.angle)*m.scale, sin=Math.sin(m.angle)*m.scale;
    const e = ncx + m.tx + state.comparison.dx;
    const f = ncy + m.ty + state.comparison.dy;
    ctx.setTransform(cos, sin, -sin, cos, e - (cos*ncx - sin*ncy), f - (sin*ncx + cos*ncy));
    ctx.drawImage(newC, 0, 0);
    ctx.setTransform(1,0,0,1,0,0);
  } else {
    ctx.drawImage(newC, state.comparison.dx, state.comparison.dy); // 現行と同一（整数平行移動）
  }
  return c;
}

// applied=true 時、renderAlignedNewCanvas と同一の変換で newC の4隅を写像し、
// 変換後の外接矩形（宛先フレーム座標系）を返す。W/H拡張の判定にのみ使う。
function alignedNewBounds(newC, m){
  if(!newC || !m.applied) return null;
  const ncx = newC.width/2, ncy = newC.height/2;
  const cos = Math.cos(m.angle)*m.scale, sin = Math.sin(m.angle)*m.scale;
  const e = ncx + m.tx + state.comparison.dx - (cos*ncx - sin*ncy);
  const f = ncy + m.ty + state.comparison.dy - (sin*ncx + cos*ncy);
  const corners = [[0,0],[newC.width,0],[0,newC.height],[newC.width,newC.height]];
  let x1 = -Infinity, y1 = -Infinity;
  for(const [x,y] of corners){
    const px = cos*x - sin*y + e, py = sin*x + cos*y + f;
    if(px > x1) x1 = px;
    if(py > y1) y1 = py;
  }
  return { x1, y1 };
}

// スロット s の実ページ番号（0基点）。スペーサ(null)・範囲外は null。
function seqIdx(seq, s){ const v = seq ? seq[s] : undefined; return (v == null) ? null : v; }

// ページャ表示: "3 / 12（旧P3 ↔ 新P4）"。スペーサ側は「空白」。
function pageLabelText(idx){
  const o = seqIdx(state.documents.oldSequence, idx), n = seqIdx(state.documents.newSequence, idx);
  const os = (o == null) ? "旧 空白" : "旧P"+(o+1);
  const ns = (n == null) ? "新 空白" : "新P"+(n+1);
  return (idx+1)+" / "+state.documents.pages+"（"+os+" ↔ "+ns+"）";
}

// 変更箇所の囲み枠（色・サイズ）に関する定数とヘルパ
const BOX_COLOR = "#ff9500";
const BOX_FILL  = "rgba(255,149,0,0.18)";
// 差分の塗り色。buildDiff の画素ループと書き出し凡例が共有する唯一の定義。
// CSS変数 --common / --removed / --added とも一致させること（片方だけ変えない）。
const DIFF_RGB = {
  common:  [60, 60, 60],   // 旧新どちらにもインクあり
  removed: [255, 91, 87],  // 旧版のみ = 削除
  added:   [77, 141, 255], // 新版のみ = 追加
};
const rgbCss = c => "rgb("+c[0]+","+c[1]+","+c[2]+")";
const BOX_BASE_DPI = 150;
const BOX_BASE = 16;
const BOX_MIN_BLOCKS = 2;
function blockSize(){ return Math.max(4, Math.round(BOX_BASE * state.comparison.dpi / BOX_BASE_DPI)); }
function toleranceRadiusPx(){ return Math.round(state.comparison.tolerancePx * state.comparison.dpi / BOX_BASE_DPI); }

// 変更ブロックのフラグ格子から、かたまりごとの外接矩形(px)を返す純関数。
// 1ブロック膨張してからBFSで連結成分をラベリングする。

// 整列済み新版（作業フレームに配置済み）を旧版と同座標比較して変更枠を算出。
function computeChangeBoxesAligned(oimg, ow, oh, nAlignedImg, width, height){
  const th = state.comparison.threshold, block = blockSize();
  const cols = Math.ceil(width/block), rows = Math.ceil(height/block);
  const bflags = new Uint8Array(cols*rows);
  const radius = toleranceRadiusPx();
  if(radius>0){
    const oMask = new Uint8Array(width*height), nMask = new Uint8Array(width*height);
    for(let y=0;y<height;y++){
      for(let x=0;x<width;x++){
        const i=y*width+x;
        if(oimg && x<ow && y<oh) oMask[i] = lum(oimg.data,(y*ow+x)*4) < th ? 1 : 0;
        nMask[i] = lum(nAlignedImg.data,(y*width+x)*4) < th ? 1 : 0;
      }
    }
    const {removed, added} = toleratedDiffMasks(oMask, nMask, width, height, radius);
    for(let y=0;y<height;y++){
      for(let x=0;x<width;x++){
        const i=y*width+x;
        if(removed[i]||added[i]) bflags[((y/block)|0)*cols + ((x/block)|0)]=1;
      }
    }
  } else {
    for(let y=0;y<height;y++){
      for(let x=0;x<width;x++){
        let oInk=false;
        if(oimg && x<ow && y<oh) oInk = lum(oimg.data,(y*ow+x)*4) < th;
        const nInk = lum(nAlignedImg.data,(y*width+x)*4) < th;
        if(oInk !== nInk) bflags[((y/block)|0)*cols + ((x/block)|0)]=1;
      }
    }
  }
  const raw = computeBoxes(bflags, cols, rows, block, BOX_MIN_BLOCKS);
  return clampBoxes(raw, width, height);
}

// 枠をフレーム座標のまま ctx へ描く純粋な描画関数（書き出し用）。lw は線幅(px)。
function drawBoxesTo(ctx, boxes, lw){
  if(!boxes || !boxes.length) return;
  ctx.save();
  ctx.fillStyle = BOX_FILL;
  ctx.strokeStyle = BOX_COLOR;
  ctx.lineWidth = lw;
  for(const b of boxes){
    ctx.fillRect(b.x, b.y, b.w, b.h);
    // 枠線が範囲外に出ないよう半線幅内側に寄せる
    const h = lw/2;
    ctx.strokeRect(b.x+h, b.y+h, Math.max(0,b.w-lw), Math.max(0,b.h-lw));
  }
  ctx.restore();
}
// 書き出し用の線幅。現行 drawBoxes と同じ式（DPIに比例）。
const exportBoxLineWidth = () => Math.max(2, Math.round(3 * state.comparison.dpi / BOX_BASE_DPI));

let boxDrag = null; // ドラッグ中の枠操作。{kind:"create"|"move"|"resize", ...} か null
// マウスを押したままキー操作（取り消し/削除/モード終了）が割り込むと state.boxEditor.selectedIndex が
// -1 や別indexへ変わり得る。endBoxDrag 側で state.boxEditor.selectedIndex の妥当性を見て確定するのではなく、
// 割り込みが起きた時点でドラッグそのものを破棄する（原因側で止める）。
function cancelBoxDrag(){
  if(!boxDrag) return;
  boxDrag = null;
  drawBoxLayer(); // プレビューが残らないよう消す
}
const HANDLE = 5; // リサイズハンドルの半径（画面px固定。拡大率に依らず掴みやすさを一定にする）
// 8ハンドルの伸縮方向。handlePoints の並びと1対1で対応させること。
const HANDLE_DIRS = [[-1,-1],[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0]];
const HANDLE_CURSORS = ["nwse-resize","ns-resize","nesw-resize","ew-resize","nwse-resize","ns-resize","nesw-resize","ew-resize"];
// 8ハンドルの中心（画面座標）。左上から時計回り。
function handlePoints(x,y,w,h){
  return [[x,y],[x+w/2,y],[x+w,y],[x+w,y+h/2],[x+w,y+h],[x+w/2,y+h],[x,y+h],[x,y+h/2]];
}
// ポインタイベント→フレーム座標（out のピクセル座標）
function toFrame(e){
  const r = wrap.getBoundingClientRect();
  return {x:(e.clientX-r.left-view.tx)/view.scale, y:(e.clientY-r.top-view.ty)/view.scale};
}
// 手前(リスト後方)から探して最初に当たった枠のindex。無ければ -1。
function hitBox(p){
  const bs = state.boxEditor.currentBoxes || [];
  for(let i=bs.length-1;i>=0;i--){
    const b = bs[i];
    if(p.x>=b.x && p.x<=b.x+b.w && p.y>=b.y && p.y<=b.y+b.h) return i;
  }
  return -1;
}
// 選択枠のハンドルに当たっていればそのindex、外れていれば -1。判定は画面px基準。
function hitHandle(p){
  if(state.boxEditor.selectedIndex<0 || !state.boxEditor.currentBoxes || state.boxEditor.selectedIndex>=state.boxEditor.currentBoxes.length) return -1;
  const b = state.boxEditor.currentBoxes[state.boxEditor.selectedIndex], s = view.scale;
  const pts = handlePoints(b.x, b.y, b.w, b.h);
  const r = HANDLE/s; // 画面px半径をフレーム座標へ換算
  for(let i=0;i<pts.length;i++){
    if(Math.abs(p.x-pts[i][0])<=r && Math.abs(p.y-pts[i][1])<=r) return i;
  }
  return -1;
}
// 反転ドラッグ（右下→左上）を正の w/h へ正規化する

// 画面解像度のオーバーレイへ枠を描く。CSS transform は掛けず view 変換を自前で適用するため、
// 枠線は画面px固定になり拡大しても太らない。out の実データには一切触れない。
function drawBoxLayer(){
  const W = wrap.clientWidth, H = wrap.clientHeight;
  if(boxLayer.width !== W || boxLayer.height !== H){ boxLayer.width = W; boxLayer.height = H; }
  bctx.clearRect(0,0,W,H);
  if(!state.visual.rendered || out.style.display === "none") return;
  if(!state.boxEditor.showBoxes) return;
  const hasBoxes = state.boxEditor.currentBoxes && state.boxEditor.currentBoxes.length;
  if(!hasBoxes && !boxDrag) return;
  const s = view.scale;
  bctx.save();
  bctx.fillStyle = BOX_FILL;
  bctx.strokeStyle = BOX_COLOR;
  bctx.lineWidth = 2;
  // プレビューはドラッグ対象（boxDrag.i/page）に紐づける。選択（state.boxEditor.selectedIndex）とは別物 —
  // 非同期の再描画等で選択が変わってもドラッグ中のプレビュー位置がずれないようにするため。
  const prev = (boxDrag && boxDrag.preview && boxDrag.page===state.documents.currentPage) ? boxDrag.preview : null;
  const boxes = state.boxEditor.currentBoxes || [];
  for(let i=0;i<boxes.length;i++){
    const b = (prev && i===boxDrag.i) ? prev : boxes[i];
    const x = view.tx + b.x*s, y = view.ty + b.y*s, w = b.w*s, h = b.h*s;
    bctx.fillRect(x, y, w, h);
    bctx.strokeRect(x+1, y+1, Math.max(0,w-2), Math.max(0,h-2));
  }
  if(state.boxEditor.editMode && state.boxEditor.selectedIndex>=0 && state.boxEditor.selectedIndex<boxes.length){
    const b = (prev && boxDrag.i===state.boxEditor.selectedIndex) ? prev : boxes[state.boxEditor.selectedIndex];
    const x = view.tx + b.x*s, y = view.ty + b.y*s, w = b.w*s, h = b.h*s;
    bctx.setLineDash([5,4]);
    bctx.strokeStyle = "#fff"; bctx.lineWidth = 1;
    bctx.strokeRect(x, y, w, h);
    bctx.setLineDash([]);
    for(const [hx,hy] of handlePoints(x,y,w,h)){
      bctx.fillStyle = "#fff"; bctx.fillRect(hx-HANDLE, hy-HANDLE, HANDLE*2, HANDLE*2);
      bctx.strokeStyle = BOX_COLOR; bctx.strokeRect(hx-HANDLE, hy-HANDLE, HANDLE*2, HANDLE*2);
    }
  }
  if(boxDrag && boxDrag.kind==="create"){
    const r = normRect(boxDrag.x0, boxDrag.y0, boxDrag.x1, boxDrag.y1);
    bctx.setLineDash([4,3]);
    bctx.strokeStyle = BOX_COLOR; bctx.lineWidth = 2;
    bctx.strokeRect(view.tx + r.x*s, view.ty + r.y*s, r.w*s, r.h*s);
    bctx.setLineDash([]);
  }
  bctx.restore();
}

// 変更箇所の件数表示。新旧切替モードで枠OFFのときだけ従来どおり「—」を出す。
function updateBoxStat(){
  if(state.visual.mode==="toggle" && !state.boxEditor.showBoxes){ $("statBox").textContent = "変更箇所 —"; return; }
  const n = state.boxEditor.currentBoxes ? state.boxEditor.currentBoxes.length : 0;
  const edited = state.boxEditor.editsByPage.has(state.documents.currentPage);
  $("statBox").textContent = "変更箇所 " + n.toLocaleString() + (edited ? "（手編集）" : "");
}

// 枠のON/OFF切替。Canvasへ焼かないためレイヤの描き直しだけで済む。
// 新旧切替モードで枠OFFのまま構築されたページだけは枠が未算出なので、ONにするとき再構築する。
function toggleBoxes(){
  if(!state.visual.rendered) return;
  state.boxEditor.showBoxes = !state.boxEditor.showBoxes;
  $("boxToggle").classList.toggle("active", state.boxEditor.showBoxes);
  if(!state.boxEditor.showBoxes && state.boxEditor.editMode) setBoxEditMode(false);
  if(state.boxEditor.showBoxes && !state.boxEditor.editsByPage.has(state.documents.currentPage) && !state.boxEditor.autoByPage.has(state.documents.currentPage)){
    show(state.documents.currentPage);   // 未算出のページのみ通常経路で算出させる
    return;
  }
  if(!state.boxEditor.editsByPage.has(state.documents.currentPage) && state.boxEditor.autoByPage.has(state.documents.currentPage)){
    state.boxEditor.currentBoxes = state.boxEditor.autoByPage.get(state.documents.currentPage);
  }
  updateBoxStat();
  drawBoxLayer();
}

// 無効化関数が枠キャッシュを捨てた後、選択状態と画面表示を同期する。
// （直後に再描画しない経路でも、古い枠・古い「（手編集）」表示を残さない。）
function syncInvalidatedBoxEditor(){
  state.boxEditor.selectedIndex = -1;
  updateBoxStat(); setBoxEditUI(); drawBoxLayer();
}
// 手編集した枠は差分の前提（DPI・しきい値・位置合わせ等）が変わると意味を失うため、
// 前提を変える操作の直前に確認して破棄する。
// 破棄を了承しなければ false を返し、呼び出し側は操作自体を中止すること。
function confirmDiscardBoxEdits(){
  return state.boxEditor.editsByPage.size === 0 ||
    confirm("手編集した変更枠があります。この操作で破棄されます。よろしいですか？");
}

function applyComparisonSettingChange(update, invalidate){
  const applied = applyInvalidatingChange(state, {
    confirmDiscard: confirmDiscardBoxEdits,
    update,
    invalidate,
  });
  if(applied) syncInvalidatedBoxEditor();
  return applied;
}

// 枠編集モードのボタン状態・カーソル・補助ボタンの出し入れ
function setBoxEditUI(){
  const on = state.boxEditor.editMode;
  $("boxEdit").disabled = !state.visual.rendered;
  $("boxEdit").classList.toggle("active", on);
  wrap.classList.toggle("boxedit", on);
  $("boxDel").style.display = on ? "" : "none";
  $("boxReset").style.display = on ? "" : "none";
  $("boxDel").disabled = state.boxEditor.selectedIndex < 0;
  $("boxReset").disabled = !state.boxEditor.editsByPage.has(state.documents.currentPage);
}
// 枠が見えないと編集できないため、ONにするとき強調がOFFなら自動でONにする。
function setBoxEditMode(on){
  if(on && !state.visual.rendered) return;
  state.boxEditor.editMode = on;
  // ONで入るときは進行中のドラッグは存在し得ないので、OFF時だけキャンセルすれば足りる。
  if(!on){ cancelBoxDrag(); wrap.style.cursor = ""; }
  state.boxEditor.selectedIndex = -1;
  if(on && !state.boxEditor.showBoxes){ toggleBoxes(); }
  setBoxEditUI();
  drawBoxLayer();
}

// 手編集リストを確定させる。初回は自動算出の枠を複製して materialize する。
// 以後 state.boxEditor.currentBoxes は editsByPage.get(cur) と同一の配列を指す。
function ensureBoxEdits(){
  const i = state.documents.currentPage;
  if(!state.boxEditor.editsByPage.has(i)){
    state.boxEditor.editsByPage.set(i, (state.boxEditor.currentBoxes||[]).map(b=>({...b})));
  }
  state.boxEditor.currentBoxes = state.boxEditor.editsByPage.get(i);
  return state.boxEditor.currentBoxes;
}
// 変更の直前に呼ぶ。現在の枠リストの複製を取り消しスタックへ積む（深さ50）。
function pushBoxUndo(){
  const i = state.documents.currentPage;
  if(!state.boxEditor.undoByPage.has(i)) state.boxEditor.undoByPage.set(i, []);
  const st = state.boxEditor.undoByPage.get(i);
  st.push((state.boxEditor.editsByPage.get(i) || state.boxEditor.currentBoxes || []).map(b=>({...b})));
  if(st.length>50) st.shift();
}
// 直前の編集を取り消す。取り消しで自動算出と同じ内容へ戻っても boxEdits は残る
// （＝「手編集」表示のまま）。完全に自動へ戻したいときは「自動検出に戻す」を使う。
function undoBoxEdit(){
  cancelBoxDrag(); // ドラッグ中に取り消しが割り込んだ場合、そのドラッグは無かったことにする
  const i = state.documents.currentPage, st = state.boxEditor.undoByPage.get(i);
  if(!st || !st.length) return;
  state.boxEditor.editsByPage.set(i, st.pop());
  state.boxEditor.currentBoxes = state.boxEditor.editsByPage.get(i);
  state.boxEditor.selectedIndex = -1;
  updateBoxStat(); setBoxEditUI(); drawBoxLayer();
}
// 選択中の枠を削除する
function deleteSelectedBox(){
  cancelBoxDrag(); // ドラッグ中に削除が割り込んだ場合、そのドラッグは無かったことにする
  if(state.boxEditor.selectedIndex<0) return;
  pushBoxUndo();
  const list = ensureBoxEdits();
  list.splice(state.boxEditor.selectedIndex,1);
  state.boxEditor.selectedIndex = -1;
  updateBoxStat(); setBoxEditUI(); drawBoxLayer();
}

// 新規作成・move/resize確定の最小サイズは画面px基準（フレームpx固定だと拡大表示時に
// 画面上は十分な大きさのドラッグでも「小さすぎ」判定で捨てられてしまうため）。
// フレーム座標の幅・高さに view.scale を掛けて画面pxへ直してから比較する。
const MIN_DRAG_SCREEN_PX = 4; // これ未満のドラッグ距離はクリック扱いで捨てる（画面px）。
function isDragTooSmall(w, h){ return w*view.scale < MIN_DRAG_SCREEN_PX || h*view.scale < MIN_DRAG_SCREEN_PX; }

// 編集モード中の押下。ハンドル→枠→背景の順に判定する。
function boxEditPointerDown(e){
  if(e.button===2) return; // 右クリック（コンテキストメニュー用）は枠編集の対象にしない
  e.preventDefault();
  wrap.setPointerCapture(e.pointerId);
  const p = toFrame(e);
  const hs = hitHandle(p);
  if(hs>=0){
    boxDrag = {kind:"resize", h:hs, i:state.boxEditor.selectedIndex, page:state.documents.currentPage, orig:{...state.boxEditor.currentBoxes[state.boxEditor.selectedIndex]}, preview:null};
    drawBoxLayer();
    return;
  }
  const hit = hitBox(p);
  if(hit>=0){
    state.boxEditor.selectedIndex = hit;
    boxDrag = {kind:"move", i:hit, page:state.documents.currentPage, ox:p.x, oy:p.y, orig:{...state.boxEditor.currentBoxes[hit]}, preview:null};
  } else {
    state.boxEditor.selectedIndex = -1;
    boxDrag = {kind:"create", x0:p.x, y0:p.y, x1:p.x, y1:p.y};
  }
  setBoxEditUI();
  drawBoxLayer();
}
// ドラッグ確定。小さすぎる作成はクリック扱いで捨てる。
// move/resize は「押した時点のあの枠」（d.i, d.page）に対する操作。確定時点の state.boxEditor.selectedIndex
// （非同期の show() やボタン操作で書き換わり得る）は見ない — cancelBoxDrag() で止めきれない
// 割り込み経路（DPI変更再描画中のドラッグ確定など）に対する二重の保険。
function endBoxDrag(e){
  if(!boxDrag) return;
  const d = boxDrag; boxDrag = null;
  try{ wrap.releasePointerCapture(e.pointerId); }catch(_){}
  if(d.kind==="create"){
    const r = normRect(d.x0, d.y0, d.x1, d.y1);
    if(isDragTooSmall(r.w, r.h)){ drawBoxLayer(); return; }
    pushBoxUndo();
    const list = ensureBoxEdits();
    list.push(clampBox(r, out.width, out.height));
    state.boxEditor.selectedIndex = list.length-1;
  }
  if(d.kind==="move" || d.kind==="resize"){
    // 対象ページが変わっている／対象indexがもう存在しないなら、このドラッグは確定させない。
    if(d.page!==state.documents.currentPage || d.i<0 || !state.boxEditor.currentBoxes || d.i>=state.boxEditor.currentBoxes.length){ drawBoxLayer(); return; }
    const nb = d.preview;
    const changed = nb && (nb.x!==d.orig.x || nb.y!==d.orig.y || nb.w!==d.orig.w || nb.h!==d.orig.h);
    // 動いていない（＝ただのクリック）なら取り消しスタックを汚さない。
    // リサイズで潰れた場合も確定せず元のまま残す。
    if(changed && !(d.kind==="resize" && isDragTooSmall(nb.w, nb.h))){
      pushBoxUndo();
      const list = ensureBoxEdits();
      list[d.i] = nb;
    }
  }
  updateBoxStat(); setBoxEditUI(); drawBoxLayer();
}

async function buildDiff(idx){
  $("status").innerHTML = '<span class="busy">レンダリング中…</span>';
  const oi = seqIdx(state.documents.oldSequence, idx), ni = seqIdx(state.documents.newSequence, idx);
  // 用紙サイズが違う場合、大きい用紙を基準に「同一ピクセル寸法」となる描画scaleを求める。
  // 同寸なら plan.oldScale === plan.newScale === dpi/72 で現行と完全一致。
  const [oldPt, newPt] = await Promise.all([
    pageSizePt(state.documents.oldDoc, oi),
    pageSizePt(state.documents.newDoc, ni)
  ]);
  // 直角成分を先に確定し、回転後の寸法で用紙合わせを決める。
  // これにより A4縦↔A4横 が framePlan の aspectMismatch に落ちなくなる。
  await ensureQuadEstimate(idx, oi, ni, oldPt, newPt);
  const quad = effectiveQuad(idx);
  const newPtR = (newPt && (quad % 2)) ? {w:newPt.h, h:newPt.w} : newPt;
  const plan = framePlan(oldPt, newPtR, state.comparison.dpi);
  state.visual.currentPlan = plan;
  const [oldC, newC0] = await Promise.all([
    renderPageCanvas(state.documents.oldDoc, oi, plan.oldScale),
    renderPageCanvas(state.documents.newDoc, ni, plan.newScale)
  ]);
  const newC = rotateCanvas90(newC0, quad); // quad=0 なら newC0 をそのまま返す（現行と同一）
  const ow = oldC?oldC.width:0, oh = oldC?oldC.height:0;
  const nw = newC?newC.width:0, nh = newC?newC.height:0;
  ensureAlignEstimate(idx, oldC, newC);
  const m = alignMatrixFor(idx, ow, oh, nw, nh);
  const warpedBounds = alignedNewBounds(newC, m);
  // 作業フレーム: 旧版矩形 ∪ 新版矩形(恒等時はdx/dy平行移動を考慮) ∪ ワープ後新版の外接矩形(適用時)。
  // 「正/遠い側だけ拡張」の既存規約は維持（負のdx/dyによる近い側のクリップは現行仕様のまま変更しない）。
  let W = Math.max(ow, nw + Math.max(0,state.comparison.dx)) || Math.max(ow,nw);
  let H = Math.max(oh, nh + Math.max(0,state.comparison.dy)) || Math.max(oh,nh);
  if(warpedBounds){ W = Math.max(W, Math.ceil(warpedBounds.x1)); H = Math.max(H, Math.ceil(warpedBounds.y1)); }
  const width  = Math.max(ow, nw, W, 1);
  const height = Math.max(oh, nh, H, 1);

  const alignedNewC = renderAlignedNewCanvas(newC, m, width, height);
  const oimg = oldC ? oldC.getContext("2d").getImageData(0,0,ow,oh) : null;
  const nAligned = alignedNewC.getContext("2d").getImageData(0,0,width,height);

  out.width = width; out.height = height;
  const res = octx.createImageData(width, height);
  const R = res.data; R.fill(255);

  const th = state.comparison.threshold;
  let rm=0, ad=0;
  // ループ内でプロパティ参照しないようローカルへ展開（DIFF_RGB が唯一の定義）
  const [cR,cG,cB] = DIFF_RGB.common, [rR,rG,rB] = DIFF_RGB.removed, [aR,aG,aB] = DIFF_RGB.added;
  const block = blockSize();
  const cols = Math.ceil(width/block), rows = Math.ceil(height/block);
  const bflags = new Uint8Array(cols*rows);
  const radius = toleranceRadiusPx();
  if(radius>0){
    // 位置ズレ許容あり: マスク構築 → 膨張 → 許容つき分類 の多段パス
    const oMask = new Uint8Array(width*height), nMask = new Uint8Array(width*height);
    for(let y=0;y<height;y++){
      for(let x=0;x<width;x++){
        const i=y*width+x;
        if(oimg && x<ow && y<oh) oMask[i] = lum(oimg.data,(y*ow+x)*4) < th ? 1 : 0;
        nMask[i] = lum(nAligned.data,(y*width+x)*4) < th ? 1 : 0;
      }
    }
    const {removed, added} = toleratedDiffMasks(oMask, nMask, width, height, radius);
    for(let y=0;y<height;y++){
      for(let x=0;x<width;x++){
        const i=y*width+x;
        if(oMask[i]||nMask[i]){
          const p=i*4;
          if(removed[i]){ R[p]=rR;R[p+1]=rG;R[p+2]=rB; rm++; bflags[((y/block)|0)*cols + ((x/block)|0)]=1; }
          else if(added[i]){ R[p]=aR;R[p+1]=aG;R[p+2]=aB; ad++; bflags[((y/block)|0)*cols + ((x/block)|0)]=1; }
          else { R[p]=cR;R[p+1]=cG;R[p+2]=cB; }
        }
      }
    }
  } else {
    // 位置ズレ許容なし(既定): 現行の単一ループ(後方互換・性能維持)
    for(let y=0;y<height;y++){
      for(let x=0;x<width;x++){
        let oInk=false;
        if(oimg && x<ow && y<oh){ oInk = lum(oimg.data,(y*ow+x)*4) < th; }
        // 整列済み新版は既に作業フレーム(width×height)へ配置済み → 同座標参照
        const nInk = lum(nAligned.data,(y*width+x)*4) < th;
        if(oInk||nInk){
          const p=(y*width+x)*4;
          if(oInk&&nInk){ R[p]=cR;R[p+1]=cG;R[p+2]=cB; }
          else if(oInk){ R[p]=rR;R[p+1]=rG;R[p+2]=rB; rm++; bflags[((y/block)|0)*cols + ((x/block)|0)]=1; }
          else { R[p]=aR;R[p+1]=aG;R[p+2]=aB; ad++; bflags[((y/block)|0)*cols + ((x/block)|0)]=1; }
        }
      }
    }
  }
  octx.putImageData(res,0,0);
  // 手編集済みページは自動算出の集約（computeBoxes / clampBoxes）を省く。
  // bflags 自体は差分の画素ループ内で立つため、ここでの分岐が省けるコストのすべて。
  if(state.boxEditor.editsByPage.has(idx)){
    state.boxEditor.currentBoxes = state.boxEditor.editsByPage.get(idx);
  } else {
    const raw = computeBoxes(bflags, cols, rows, block, BOX_MIN_BLOCKS);
    state.boxEditor.currentBoxes = clampBoxes(raw, width, height);
    state.boxEditor.autoByPage.set(idx, state.boxEditor.currentBoxes);
  }
  out.style.display="block"; $("ph").style.display="none"; state.visual.rendered=true;
  drawBoxLayer();
  state.visual.pageCache.set(idx, {rm, ad, bx: state.boxEditor.currentBoxes.length});
  $("statRm").textContent = "削除 "+rm.toLocaleString();
  $("statAd").textContent = "追加 "+ad.toLocaleString();
  updateBoxStat();
  $("status").textContent = (rm+ad===0) ? "差分なし" : "差分を表示中";
  $("pageLabel").textContent = pageLabelText(idx);
  $("dlPng").disabled=false; $("dlPdf").disabled=false;
  $("boxToggle").disabled=false;
}

// 新旧切替モード：旧・新それぞれのページCanvasをキャッシュし、選択中の版だけを描画する
async function buildToggle(idx){
  const token = ++state.visual.renderGeneration;
  const oi = seqIdx(state.documents.oldSequence, idx), ni = seqIdx(state.documents.newSequence, idx);
  // Canvasキャッシュにヒットしても読み出し表示に plan が要るため、キャッシュ判定より前に求める。
  const [oldPt, newPt] = await Promise.all([
    pageSizePt(state.documents.oldDoc, oi),
    pageSizePt(state.documents.newDoc, ni)
  ]);
  if(token !== state.visual.renderGeneration) return; // await を挟んだので割り込みチェック（stale-draw防止）
  await ensureQuadEstimate(idx, oi, ni, oldPt, newPt);
  if(token !== state.visual.renderGeneration) return; // 象限推定でも await を挟むため再チェック
  const quad = effectiveQuad(idx);
  const newPtR = (newPt && (quad % 2)) ? {w:newPt.h, h:newPt.w} : newPt;
  const plan = framePlan(oldPt, newPtR, state.comparison.dpi);
  state.visual.currentPlan = plan;
  if(!state.visual.toggleCache || state.visual.toggleCache.idx !== idx || state.visual.toggleCache.quad !== quad){
    $("status").innerHTML = '<span class="busy">レンダリング中…</span>';
    const [oldC, newC0] = await Promise.all([
      renderPageCanvas(state.documents.oldDoc, oi, plan.oldScale),
      renderPageCanvas(state.documents.newDoc, ni, plan.newScale)
    ]);
    if(token !== state.visual.renderGeneration) return; // 別の描画が割り込んだので破棄（stale-draw防止）
    const newC = rotateCanvas90(newC0, quad); // staleチェックの後に回す（無駄な回転を避ける）
    const ow = oldC?oldC.width:0, oh = oldC?oldC.height:0;
    const nw = newC?newC.width:0, nh = newC?newC.height:0;
    // 枠算出用に旧版のImageDataも保持（再取得コストを避ける。新版は整列後にのみ使うため保持不要）
    const oimg = oldC ? oldC.getContext("2d").getImageData(0,0,ow,oh) : null;
    state.visual.toggleCache = {idx, quad, oldC, newC, ow, oh, nw, nh, oimg};
  }
  const {ow, oh, nw, nh, oimg, oldC, newC} = state.visual.toggleCache;
  ensureAlignEstimate(idx, oldC, newC);
  const m = alignMatrixFor(idx, ow, oh, nw, nh);
  const warpedBounds = alignedNewBounds(newC, m);
  // 作業フレーム: 旧版矩形 ∪ 新版矩形(恒等時はdx/dy平行移動を考慮) ∪ ワープ後新版の外接矩形(適用時)。
  let W = Math.max(ow, nw+Math.max(0,state.comparison.dx)) || Math.max(ow,nw);
  let H = Math.max(oh, nh+Math.max(0,state.comparison.dy)) || Math.max(oh,nh);
  if(warpedBounds){ W = Math.max(W, Math.ceil(warpedBounds.x1)); H = Math.max(H, Math.ceil(warpedBounds.y1)); }
  const width  = Math.max(ow, nw, W, 1);
  const height = Math.max(oh, nh, H, 1);
  out.width = width; out.height = height;

  // 整列済み新版（枠算出・NEW表示の双方に使う）
  const alignedNewC = renderAlignedNewCanvas(newC, m, width, height);
  const nAlignedImg = alignedNewC.getContext("2d").getImageData(0,0,width,height);
  state.visual.toggleCache.alignedNewC = alignedNewC;
  // 枠算出: 旧版 ImageData と整列済み新版 ImageData を同座標で比較
  if(state.boxEditor.editsByPage.has(idx)){
    state.boxEditor.currentBoxes = state.boxEditor.editsByPage.get(idx);               // 手編集済み: 算出そのものを省く
  } else if(state.boxEditor.showBoxes){
    state.boxEditor.currentBoxes = computeChangeBoxesAligned(oimg, ow, oh, nAlignedImg, width, height);
    state.boxEditor.autoByPage.set(idx, state.boxEditor.currentBoxes);
  } else {
    state.boxEditor.currentBoxes = [];
  }

  drawToggleSide();

  $("pageLabel").textContent = pageLabelText(idx);
  $("statRm").textContent = "削除 —";
  $("statAd").textContent = "追加 —";
  updateBoxStat();
  $("status").textContent = "新旧切替（"+(state.visual.toggleSide==="old"?"OLD":"NEW")+"表示中）";
  $("dlPng").disabled=false; $("dlPdf").disabled=false;
  $("boxToggle").disabled=false;
}

// 選択中の版だけを out に描画（PDF再レンダ無し・瞬時）
function drawToggleSide(){
  const c = state.visual.toggleCache;
  if(!c) return;
  octx.clearRect(0,0,out.width,out.height);
  octx.fillStyle = "#fff"; octx.fillRect(0,0,out.width,out.height);
  const side = state.visual.toggleSide;
  const hasPage = side==="old" ? !!c.oldC : !!c.newC;
  if(hasPage){
    if(side==="old") octx.drawImage(c.oldC,0,0);
    else octx.drawImage(c.alignedNewC,0,0); // 整列＋dx/dy 焼き込み済み
  } else {
    octx.fillStyle = "#7f8f9e";
    octx.font = "20px sans-serif";
    octx.textAlign = "center"; octx.textBaseline = "middle";
    octx.fillText("この版にこのページはありません", out.width/2, out.height/2);
  }
  out.style.display="block"; $("ph").style.display="none"; state.visual.rendered=true;
  drawBoxLayer(); // 枠座標は旧/新どちらの表示にも整合する
  updateToggleIndicator();
}

function updateToggleIndicator(){
  $("sideOld").classList.toggle("active", state.visual.toggleSide==="old");
  $("sideNew").classList.toggle("active", state.visual.toggleSide==="new");
}

function flipSide(){
  state.visual.toggleSide = state.visual.toggleSide==="old" ? "new" : "old";
  drawToggleSide();
  $("status").textContent = "新旧切替（"+(state.visual.toggleSide==="old"?"OLD":"NEW")+"表示中）";
}

function setModeUI(){
  $("modeDiff").classList.toggle("active", state.visual.mode==="diff");
  $("modeToggle").classList.toggle("active", state.visual.mode==="toggle");
  $("toggleInd").style.display = state.visual.mode==="toggle" ? "flex" : "none";
  $("th").disabled = state.visual.mode==="toggle";
  $("boxToggle").disabled = !state.visual.rendered;
  setBoxEditUI();
}

function updateAlignButtons(){
  const on = !!(state.documents.oldDoc && state.documents.newDoc) && state.visual.rendered;
  $("alignAddNew").disabled = !on;
  $("alignDelOld").disabled = !on;
  $("alignUndo").disabled  = !on || state.documents.alignmentOps.length === 0;
}

// 用紙合わせ（自動・常時）と自動整列（トグル）の状態を、推定値ではなく実測値で表示する。
function updateAlignReadout(){
  const el = $("alignReadout");
  const lines = [];
  const p = state.visual.currentPlan;
  if(p && p.normalized){
    // refSide が "old" なら旧版が基準＝新版を拡大している
    const grown = p.refSide === "old" ? "新版" : "旧版";
    lines.push(`用紙合わせ: ${grown}を×${p.ratio.toFixed(3)}で描画（自動）`);
  } else if(p && p.aspectMismatch){
    lines.push("用紙合わせ: 用紙の縦横比が違うため未適用");
  }
  const qm = state.comparison.quadrantManual.get(state.documents.currentPage);
  if(qm != null){
    lines.push(`向き: 手動 ${qm*90}°`);
  } else if(state.comparison.autoAlign){
    const qc = state.visual.quadrantCache.get(state.documents.currentPage);
    // 未推定・片側空白のときは行を出さない（autoAlign OFF も同様。「自動整列: OFF」の行で足りる）
    if(qc && !qc.blank){
      const qpct = v => Math.round(v*100)+"%";
      if(qc.applied) lines.push(`向き: 自動 ${qc.k*90}°（一致率 ${qpct(qc.scores[0])} → ${qpct(qc.scores[qc.k])}）`);
      else lines.push("向き: 0°（回転なし）");
    }
  }
  if(!state.comparison.autoAlign){
    lines.push("自動整列: OFF");
  } else {
    const a = state.visual.alignmentCache.get(state.documents.currentPage);
    if(!a){
      lines.push("自動整列: 推定待ち");
    } else if(a.blank){
      lines.push("自動整列: 片側が空白のため対象外");
    } else {
      const pct = v => Math.round(v*100)+"%";
      const sc = `一致率 ${pct(a.scoreBase)} → ${pct(a.scoreBest)}`;
      if(!a.applied){
        lines.push(`自動整列: ${sc}（改善せず・恒等のまま）`);
      } else if(a.method === "translate"){
        const sgn = v => (v>=0?"+":"")+v;
        const dx = Math.round(a.txFrac*out.width), dy = Math.round(a.tyFrac*out.height);
        lines.push(`自動整列: 平行移動 ${sgn(dx)},${sgn(dy)}px / ${sc}`);
      } else {
        const deg = (a.angle*180/Math.PI).toFixed(2);
        lines.push(`自動整列: θ=${a.angle>=0?"+":""}${deg}° ×${a.scale.toFixed(3)} / ${sc}`);
      }
    }
  }
  el.textContent = lines.join(" ／ ");
}

function updateManualAlignReadout(){
  const deg = state.comparison.manualAngle*180/Math.PI;
  $("rotReset").textContent = (deg>=0?"+":"")+deg.toFixed(1)+"°";
  $("scaleReset").textContent = (state.comparison.manualScale*100).toFixed(1)+"%";
  const manual = state.comparison.quadrantManual.has(state.documents.currentPage);
  $("quadReset").textContent = (effectiveQuad(state.documents.currentPage)*90)+"°" + (manual ? "（手動）" : "");
}

async function refreshAfterAlign(){
  state.documents.pages = Math.max(state.documents.oldSequence.length, state.documents.newSequence.length);
  invalidatePageAlignment(state);
  syncInvalidatedBoxEditor();
  if(state.documents.currentPage > state.documents.pages - 1) state.documents.currentPage = state.documents.pages - 1; // 縮小時クランプ（show前に必須）
  if(state.documents.currentPage < 0) state.documents.currentPage = 0;
  await show(state.documents.currentPage);
}

async function show(idx){
  if(idx<0||idx>=state.documents.pages) return;
  state.documents.currentPage=idx;
  state.boxEditor.selectedIndex=-1; // ページが変われば選択は無効
  // 進行中のドラッグ（同一ページの再描画も含む）をここで確実に打ち切る。endBoxDrag側の
  // ガード（page/i検証）だけだと、awaitの間にstate.boxEditor.currentBoxesが同じページのまま「別の配列」へ
  // 差し替わるケース（DPI変更等の再描画）を素通りしてしまい、古いorig座標が新しい配列の
  // 同indexへ誤って書き込まれ得るため（原因側で止める＋確定側でも検証、の二重化）。
  cancelBoxDrag();
  if(state.visual.mode==="toggle") await buildToggle(idx); else await buildDiff(idx);
  updateAlignButtons();
  updateAlignReadout();
  updateManualAlignReadout();
  setBoxEditUI();
}

// ── ズーム & パン ──
const wrap = document.querySelector(".canvas-wrap");
const view = {scale:1, tx:0, ty:0};
const clampScale = s => Math.min(Math.max(s, 0.05), 40);
const hasImage = () => out.style.display !== "none";

function applyTransform(){
  out.style.transform = `translate(${view.tx}px,${view.ty}px) scale(${view.scale})`;
  $("zoomLabel").textContent = Math.round(view.scale*100)+"%";
  drawBoxLayer();
}
// キャンバス全体が枠に収まる倍率で中央表示
function fitView(){
  const W=wrap.clientWidth, H=wrap.clientHeight, cw=out.width, ch=out.height;
  if(!cw||!ch) return;
  const s = Math.min(W/cw, H/ch) * 0.92;
  view.scale=s; view.tx=(W-cw*s)/2; view.ty=(H-ch*s)/2;
  applyTransform();
}
// (cx,cy)=枠内座標 を固定点にしてズーム
function zoomAt(factor, cx, cy){
  const ns = clampScale(view.scale*factor), k = ns/view.scale;
  view.tx = cx-(cx-view.tx)*k;
  view.ty = cy-(cy-view.ty)*k;
  view.scale = ns; applyTransform();
}
const zoomCenter = f => zoomAt(f, wrap.clientWidth/2, wrap.clientHeight/2);

// ホイールで拡大縮小（ポインタ位置中心）
wrap.addEventListener("wheel", e=>{
  if(state.ui.topMode!=="visual") return;
  if(!hasImage()) return;
  e.preventDefault();
  const r = wrap.getBoundingClientRect();
  zoomAt(e.deltaY<0 ? 1.12 : 1/1.12, e.clientX-r.left, e.clientY-r.top);
}, {passive:false});

// ドラッグでパン
let panning=false, psx=0, psy=0, ptx=0, pty=0;
let spaceHeld = false; // 枠編集モード中に Space を押している間はパンへ回す
wrap.addEventListener("pointerdown", e=>{
  if(state.ui.topMode!=="visual") return;
  if(!hasImage()) return;
  if(state.boxEditor.editMode && !spaceHeld && e.button!==1){ boxEditPointerDown(e); return; }
  panning=true; wrap.classList.add("panning"); wrap.setPointerCapture(e.pointerId);
  psx=e.clientX; psy=e.clientY; ptx=view.tx; pty=view.ty;
});
wrap.addEventListener("pointermove", e=>{
  if(!panning) return;
  view.tx = ptx+(e.clientX-psx); view.ty = pty+(e.clientY-psy); applyTransform();
});
function endPan(e){
  if(!panning) return;
  panning=false; wrap.classList.remove("panning");
  try{ wrap.releasePointerCapture(e.pointerId); }catch(_){}
}
wrap.addEventListener("pointerup", endPan);
wrap.addEventListener("pointercancel", endPan);
// 枠編集モードのドラッグ（作成/移動/リサイズ）。パン用ハンドラとは boxDrag/panning のフラグで排他になる。
wrap.addEventListener("pointermove", e=>{
  if(!boxDrag) return;
  const p = toFrame(e);
  if(boxDrag.kind==="create"){
    boxDrag.x1=p.x; boxDrag.y1=p.y;
  } else if(boxDrag.kind==="move"){
    // 移動はサイズを変えない。枠ごとフレーム内へ収まるよう平行移動量の方をクランプする。
    const o = boxDrag.orig;
    const maxX = Math.max(0, out.width - o.w), maxY = Math.max(0, out.height - o.h);
    const nx = Math.min(Math.max(0, o.x + (p.x-boxDrag.ox)), maxX);
    const ny = Math.min(Math.max(0, o.y + (p.y-boxDrag.oy)), maxY);
    boxDrag.preview = {x:nx, y:ny, w:o.w, h:o.h};
  } else if(boxDrag.kind==="resize"){
    const [sx,sy] = HANDLE_DIRS[boxDrag.h];
    let {x,y,w,h} = boxDrag.orig;
    if(sx<0){ const r=x+w; x=p.x; w=r-x; } else if(sx>0){ w=p.x-x; }
    if(sy<0){ const b=y+h; y=p.y; h=b-y; } else if(sy>0){ h=p.y-y; }
    boxDrag.preview = clampBox(normRect(x, y, x+w, y+h), out.width, out.height);
  }
  drawBoxLayer();
});
// ドラッグしていないときのカーソル表示（ハンドル＝リサイズ方向、枠内＝move）
wrap.addEventListener("pointermove", e=>{
  if(!state.boxEditor.editMode || boxDrag) return;
  const p = toFrame(e);
  const hs = hitHandle(p);
  if(hs>=0){ wrap.style.cursor = HANDLE_CURSORS[hs]; return; }
  wrap.style.cursor = hitBox(p)>=0 ? "move" : "";
});
wrap.addEventListener("pointerup", endBoxDrag);
wrap.addEventListener("pointercancel", endBoxDrag);
wrap.addEventListener("dblclick", fitView); // ダブルクリックで全体表示に戻す
window.addEventListener("resize", drawBoxLayer); // レイヤは画面解像度なので寸法追従が要る

$("zoomIn").addEventListener("click", ()=>zoomCenter(1.25));
$("zoomOut").addEventListener("click", ()=>zoomCenter(1/1.25));
$("zoomFit").addEventListener("click", fitView);
$("zoom1").addEventListener("click", ()=>{ if(hasImage()) zoomCenter(1/view.scale); });

// ── モード切替（差分 / 新旧切替） ──
$("modeDiff").addEventListener("click", async ()=>{
  if(state.visual.mode==="diff" || !hasImage()) return;
  state.visual.mode="diff"; setModeUI();
  $("status").innerHTML='<span class="busy">差分を再計算中…</span>';
  if(state.documents.pages) await show(state.documents.currentPage);
});
$("modeToggle").addEventListener("click", async ()=>{
  if(state.visual.mode==="toggle" || !hasImage()) return;
  state.visual.mode="toggle"; setModeUI();
  if(state.documents.pages) await show(state.documents.currentPage);
});
$("toggleFlip").addEventListener("click", flipSide);
$("boxToggle").addEventListener("click", toggleBoxes);
$("boxEdit").addEventListener("click", ()=>setBoxEditMode(!state.boxEditor.editMode));
$("boxDel").addEventListener("click", deleteSelectedBox);
// このページの手編集を破棄して自動算出の原本へ戻す。原本があるため差分の再計算は要らない。
$("boxReset").addEventListener("click", ()=>{
  const i = state.documents.currentPage;
  if(!state.boxEditor.editsByPage.has(i)) return;
  state.boxEditor.editsByPage.delete(i);
  state.boxEditor.undoByPage.delete(i);
  state.boxEditor.selectedIndex = -1;
  if(state.boxEditor.autoByPage.has(i)){
    state.boxEditor.currentBoxes = state.boxEditor.autoByPage.get(i);
    updateBoxStat(); setBoxEditUI(); drawBoxLayer();
  } else {
    show(state.documents.currentPage); // 原本が無い場合だけ算出し直す
  }
});

// 文字入力中の要素にフォーカスがある間はショートカットキーを奪わないためのガード。複数のkeydownリスナーで共用する。
// BUTTONは対象外（ボタンにフォーカスが残っていてもE/Esc/Delete等は効かせたい）。
// ボタンの誤発火（Spaceキーでのクリック相当発火）はSpaceハンドラ側で個別にガードする。
function isTypingTarget(e){
  const tag = (e.target && e.target.tagName) || "";
  if(["INPUT","TEXTAREA","SELECT"].includes(tag)) return true;
  return !!(e.target && e.target.isContentEditable);
}

// Space キーで新旧切替（トグルモード時のみ）。枠編集モード中はパンの修飾キーとして使う。
// ボタンにフォーカスがある状態でSpaceを押すとボタンがクリック相当で発火してしまうため、ここだけ個別にBUTTONを除外する。
document.addEventListener("keydown", e=>{
  if(state.ui.topMode!=="visual") return;
  if(e.code!=="Space" || e.repeat) return;
  if(isTypingTarget(e)) return;
  if(e.target && e.target.tagName==="BUTTON") return;
  if(state.boxEditor.editMode){ spaceHeld = true; e.preventDefault(); return; }
  if(state.visual.mode==="toggle" && hasImage()){
    e.preventDefault();
    flipSide();
  }
});
document.addEventListener("keyup", e=>{ if(e.code==="Space") spaceHeld = false; });
window.addEventListener("blur", ()=>{ spaceHeld = false; }); // 押しっぱなし状態の取り残しを防ぐ

// 枠編集モードのキー操作。E=モード切替、Esc=選択解除→モード終了。
document.addEventListener("keydown", e=>{
  if(state.ui.topMode!=="visual") return;
  if(isTypingTarget(e)) return;
  if(e.key==="e" || e.key==="E"){
    // Ctrl+E・Alt+E等は別コマンド扱いにするため素通しする（Eは修飾キー無しの単独キー）。
    if(e.ctrlKey||e.metaKey||e.altKey) return;
    if(!state.visual.rendered) return;
    e.preventDefault();
    setBoxEditMode(!state.boxEditor.editMode);
    return;
  }
  if(!state.boxEditor.editMode) return;
  if(e.key==="Escape"){
    e.preventDefault();
    // 選択解除はここで直接 state.boxEditor.selectedIndex を変えるため、setBoxEditMode(false) を経由しない。
    // ドラッグ中に割り込んだ場合はここでもキャンセルしないと endBoxDrag が旧selで確定してしまう。
    if(state.boxEditor.selectedIndex>=0){ cancelBoxDrag(); state.boxEditor.selectedIndex=-1; setBoxEditUI(); drawBoxLayer(); }
    else setBoxEditMode(false);
    return;
  }
  if(e.key==="Delete" || e.key==="Backspace"){
    e.preventDefault();
    deleteSelectedBox();
    return;
  }
  if((e.ctrlKey||e.metaKey) && (e.key==="z"||e.key==="Z")){
    e.preventDefault();
    undoBoxEdit();
  }
});

// ── イベント ──
$("fileOld").addEventListener("change",async e=>{
  const file=e.target.files[0];
  if(!file) return;
  try { await loadPdf(file,"old"); }
  finally { e.target.value=""; }
});
$("fileNew").addEventListener("change",async e=>{
  const file=e.target.files[0];
  if(!file) return;
  try { await loadPdf(file,"new"); }
  finally { e.target.value=""; }
});
["dropOld","dropNew"].forEach(id=>{
  const el=$(id), which=id==="dropOld"?"old":"new";
  el.addEventListener("dragover",e=>{e.preventDefault();el.style.borderColor="var(--signal)";});
  el.addEventListener("dragleave",()=>el.style.borderColor="");
  el.addEventListener("drop",e=>{e.preventDefault();el.style.borderColor="";
    const f=e.dataTransfer.files[0]; if(f&&f.type==="application/pdf") loadPdf(f,which);});
});

// レンジ入力はラベルだけを先行更新し、state は change 時の破棄確認後に確定する。
// 破棄を拒否したときは確定済みの値から value / ラベルだけを戻す。
["dpi","th","tolerance"].forEach(id=>{ $(id).dataset.committed = $(id).value; });
function restoreCommittedRange(el, labelId){
  el.value = el.dataset.committed;
  $(labelId).textContent = el.value;
}

$("dpi").addEventListener("input",e=>{$("dpiVal").textContent=e.target.value;});
$("dpi").addEventListener("change",async()=>{
  const el = $("dpi");
  const next = +el.value;
  if(!applyComparisonSettingChange(
    ()=>{ state.comparison.dpi = next; },
    invalidateDpi,
  )){
    restoreCommittedRange(el, "dpiVal");
    return;
  }
  el.dataset.committed = el.value;
  if(state.visual.rendered){await show(state.documents.currentPage); fitView();}
});
$("th").addEventListener("input",e=>{$("thVal").textContent=e.target.value;});
$("th").addEventListener("change",()=>{
  const el = $("th");
  const next = +el.value;
  if(!applyComparisonSettingChange(
    ()=>{ state.comparison.threshold = next; },
    invalidateThreshold,
  )){
    restoreCommittedRange(el, "thVal");
    return;
  }
  el.dataset.committed = el.value;
  if(state.visual.mode==="diff" && state.visual.rendered)show(state.documents.currentPage);
});
$("tolerance").addEventListener("input",e=>{$("toleranceVal").textContent=e.target.value;});
$("tolerance").addEventListener("change",()=>{
  const el = $("tolerance");
  const next = +el.value;
  if(!applyComparisonSettingChange(
    ()=>{ state.comparison.tolerancePx = next; },
    invalidateTolerance,
  )){
    restoreCommittedRange(el, "toleranceVal");
    return;
  }
  el.dataset.committed = el.value;
  if(!state.visual.rendered) return;
  if(state.visual.mode==="toggle") buildToggle(state.documents.currentPage); else show(state.documents.currentPage);
});

document.querySelectorAll(".nudge button[data-dx]").forEach(b=>{
  b.addEventListener("click",()=>{
    if(!applyComparisonSettingChange(()=>{
      state.comparison.dx+=(+b.dataset.dx); state.comparison.dy+=(+b.dataset.dy);
    }, invalidateManualAlignment)) return;
    $("nudgeReset").textContent=state.comparison.dx+","+state.comparison.dy;
    if(!state.visual.rendered) return;
    if(state.visual.mode==="toggle") buildToggle(state.documents.currentPage); else show(state.documents.currentPage);
  });
});
$("nudgeReset").addEventListener("click",()=>{
  if(!applyComparisonSettingChange(()=>{
    state.comparison.dx=0;state.comparison.dy=0;
  }, invalidateManualAlignment)) return;
  $("nudgeReset").textContent="0,0";
  if(!state.visual.rendered) return;
  if(state.visual.mode==="toggle") buildToggle(state.documents.currentPage); else show(state.documents.currentPage);
});
// 向き（直角回転）。押した時点で手動上書きが確定し、当ページの自動推定より優先される。
// k が変わるとページ描画・位置合わせ・差分・枠が変わるため、DPI変更と同じ範囲を無効化する。
document.querySelectorAll("button[data-quad]").forEach(b=>{
  b.addEventListener("click", async ()=>{
    if(!applyComparisonSettingChange(()=>{
      const cur = effectiveQuad(state.documents.currentPage);
      state.comparison.quadrantManual.set(state.documents.currentPage, ((cur + (+b.dataset.quad)) % 4 + 4) % 4);
    }, invalidateDpi)) return;
    updateManualAlignReadout();
    if(!state.visual.rendered) return;
    // buildToggle() 自体は updateAlignReadout() を呼ばない（show() 経由のときのみ呼ばれる）ため、
    // トグルモードでも「向き」表示を更新できるよう await して同期させる（autoAlign の change ハンドラと同じ対処）。
    if(state.visual.mode==="toggle"){ await buildToggle(state.documents.currentPage); updateAlignReadout(); }
    else await show(state.documents.currentPage);
  });
});
$("quadReset").addEventListener("click", async ()=>{
  if(!state.comparison.quadrantManual.has(state.documents.currentPage)) return; // 既に自動
  if(!applyComparisonSettingChange(()=>{
    state.comparison.quadrantManual.delete(state.documents.currentPage);        // 自動判定へ戻す
  }, invalidateDpi)) return;
  updateManualAlignReadout();
  if(!state.visual.rendered) return;
  // 同上（data-quad ハンドラと同じ理由でトグルモードのみ明示的に読み出しを更新する）。
  if(state.visual.mode==="toggle"){ await buildToggle(state.documents.currentPage); updateAlignReadout(); }
  else await show(state.documents.currentPage);
});
document.querySelectorAll("button[data-rot]").forEach(b=>{
  b.addEventListener("click",()=>{
    if(!applyComparisonSettingChange(()=>{
      state.comparison.manualAngle += (+b.dataset.rot) * 0.1 * Math.PI/180;
    }, invalidateDpi)) return;
    updateManualAlignReadout();
    if(!state.visual.rendered) return;
    if(state.visual.mode==="toggle") buildToggle(state.documents.currentPage); else show(state.documents.currentPage);
  });
});
$("rotReset").addEventListener("click",()=>{
  if(!applyComparisonSettingChange(()=>{
    state.comparison.manualAngle = 0;
  }, invalidateDpi)) return;
  updateManualAlignReadout();
  if(!state.visual.rendered) return;
  if(state.visual.mode==="toggle") buildToggle(state.documents.currentPage); else show(state.documents.currentPage);
});
document.querySelectorAll("button[data-scale]").forEach(b=>{
  b.addEventListener("click",()=>{
    if(!applyComparisonSettingChange(()=>{
      state.comparison.manualScale = Math.max(0.1, state.comparison.manualScale + (+b.dataset.scale) * 0.001);
    }, invalidateDpi)) return;
    updateManualAlignReadout();
    if(!state.visual.rendered) return;
    if(state.visual.mode==="toggle") buildToggle(state.documents.currentPage); else show(state.documents.currentPage);
  });
});
$("scaleReset").addEventListener("click",()=>{
  if(!applyComparisonSettingChange(()=>{
    state.comparison.manualScale = 1;
  }, invalidateDpi)) return;
  updateManualAlignReadout();
  if(!state.visual.rendered) return;
  if(state.visual.mode==="toggle") buildToggle(state.documents.currentPage); else show(state.documents.currentPage);
});
$("autoAlign").addEventListener("change", async e=>{
  const next = e.target.checked;
  if(!applyComparisonSettingChange(()=>{
    state.comparison.autoAlign = next;
  }, invalidateThreshold)){ e.target.checked = !next; return; }
  if(!state.visual.rendered){ updateAlignReadout(); return; }
  // buildToggle() 自体は updateAlignReadout() を呼ばない（show() 経由のときのみ呼ばれる）ため、
  // トグルモードでも推定完了後に読み出しを更新できるよう await して同期させる。
  if(state.visual.mode==="toggle") await buildToggle(state.documents.currentPage);
  else await show(state.documents.currentPage);
  updateAlignReadout();
});

$("run").addEventListener("click",async()=>{
  $("modeDiff").disabled=false; $("modeToggle").disabled=false;
  await show(0); fitView();
});
$("alignAddNew").addEventListener("click", async ()=>{
  if(!state.visual.rendered) return;
  if(!confirmDiscardBoxEdits()) return;
  state.documents.oldSequence.splice(state.documents.currentPage, 0, null); // 旧側に空白 → 新ページが全面追加(青)に
  state.documents.alignmentOps.push({side:"old", slot:state.documents.currentPage});
  await refreshAfterAlign();
});
$("alignDelOld").addEventListener("click", async ()=>{
  if(!state.visual.rendered) return;
  if(!confirmDiscardBoxEdits()) return;
  state.documents.newSequence.splice(state.documents.currentPage, 0, null); // 新側に空白 → 旧ページが全面削除(赤)に
  state.documents.alignmentOps.push({side:"new", slot:state.documents.currentPage});
  await refreshAfterAlign();
});
$("alignUndo").addEventListener("click", async ()=>{
  const op = state.documents.alignmentOps[state.documents.alignmentOps.length-1]; // pop ではなく覗き見。ゲート拒否時に何も書き換えないため
  if(!op) return;
  if(!confirmDiscardBoxEdits()) return;
  state.documents.alignmentOps.pop();
  const seq = op.side === "old" ? state.documents.oldSequence : state.documents.newSequence;
  if(seq[op.slot] === null) seq.splice(op.slot, 1); // 念のため null を確認して除去
  await refreshAfterAlign();
});
$("prev").addEventListener("click",()=>show(state.documents.currentPage-1));
$("next").addEventListener("click",()=>show(state.documents.currentPage+1));

// ── 書き出し用の凡例 ──
// 画面表示のCanvas(out)には描かない（画面はヘッダーのHTML凡例が担う）。書き出し時に
// 複製したCanvasへだけ重ねるため、パン/ズームやPDFの用紙寸法には影響しない。
// レイアウト定数は全てpt。unit(=1ptあたりのpx数)を掛けてpxへ変換するので、DPIを
// 上げても紙面上の凡例の大きさは変わらない。
// 実測用: 呼び出し側のctx状態を壊さないようsave/restoreで包む
const ctxMeasurer = ctx => (label, fontPx) => {
  ctx.save();
  ctx.font = "bold " + fontPx + "px sans-serif";
  const w = ctx.measureText(label).width;
  ctx.restore();
  return w;
};

// 描画せずレイアウト一式を返す（配置の衝突判定用）。返り値はそのまま drawLegend の
// pre 引数へ渡せる。こうしないと「幅ガードで測った寸法」と「実際に描く寸法」が
// 別計算になり、将来 legendLayout に状態依存が入ったとき両者がズレる。
function measureLegend(ctx, items, unit, opts){
  return legendLayout(items, unit, opts, ctxMeasurer(ctx));
}

// (x,y)を凡例ボックスの左上として描画する。
// pre に measureLegend の返り値を渡すとレイアウト計算と文字幅実測を再利用する。
function drawLegend(ctx, items, x, y, unit, opts, pre){
  const L = pre || legendLayout(items, unit, opts, ctxMeasurer(ctx));
  // DPI下限72(=unit 1.0)では常に1px以上になるため現状は発火しないが、
  // 将来DPI下限を下げたときに枠線が消えるのを防ぐ保険
  const bw = Math.max(1, LG_BORDER_PT * unit);
  ctx.save();
  if(L.chrome){
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillRect(x, y, L.w, L.h);
    ctx.strokeStyle = "#999";
    ctx.lineWidth = bw;
    ctx.strokeRect(x + bw/2, y + bw/2, L.w - bw, L.h - bw); // 枠線を内側へ寄せる
  }
  ctx.font = "bold " + L.fontPx + "px sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const top = y + L.pad;
  L.parts.forEach((p, i) => {
    const it = items[i];
    if(it.color){
      ctx.fillStyle = it.color;
      ctx.fillRect(x + p.swX, top, L.swPx, L.swPx);
    } else {
      ctx.fillStyle = it.fill;
      ctx.fillRect(x + p.swX, top, L.swPx, L.swPx);
      ctx.strokeStyle = it.stroke;
      ctx.lineWidth = bw;
      ctx.strokeRect(x + p.swX + bw/2, top + bw/2, L.swPx - bw, L.swPx - bw);
    }
    ctx.fillStyle = "#222";
    ctx.fillText(it.label, x + p.textX, top + L.swPx/2);
  });
  ctx.restore();
  return L;
}

const LG_MARGIN_PT = 10; // 凡例ボックスの左上マージン

// 図面比較の凡例項目。色は buildDiff が実際に塗る DIFF_RGB と同じ定義から作る。
// 引数 kind は「書き出す画像の中身」であって state.visual.mode ではない。dlPdf は切替モード中に
// 押されてもループ内で buildDiff を呼ぶため中身は差分画像であり "diff" を渡す。
// state.visual.mode を関数内で直接読むと、この経路で凡例が「変更枠」だけになり誤りになる。
function diffLegendItems(kind){
  const items = [];
  // 切替モードの画像は旧版/新版そのもの。共通/削除/追加の3色は実在しないので出さない。
  if(kind !== "toggle") items.push(
    {color: rgbCss(DIFF_RGB.common),  label: "共通"},
    {color: rgbCss(DIFF_RGB.removed), label: "削除（旧版のみ）"},
    {color: rgbCss(DIFF_RGB.added),   label: "追加（新版のみ）"},
  );
  // 枠を出していないときに「変更枠」だけ凡例に残ると誤解を招くので連動させる
  if(state.boxEditor.showBoxes) items.push({stroke: BOX_COLOR, fill: BOX_FILL, label: "変更枠"});
  return items;
}

// src と同寸のCanvasへ複製し、複製側にだけ凡例を重ねて返す。src は変更しない。
// 寸法を変えないので、PDFの用紙寸法(wPt/hPt)は従来と一致する。
// dest を渡すとそのCanvasを使い回す（全ページPDFで巨大なバッキングストアを毎ページ
// 確保しないため）。width/height の再代入でCanvasは自動クリアされる。
function exportCanvasWithLegend(src, kind, dest){
  const c = dest || createCanvas(0, 0);
  c.width = src.width; c.height = src.height;
  const ctx = c.getContext("2d");
  ctx.drawImage(src, 0, 0);
  if(state.boxEditor.showBoxes) drawBoxesTo(ctx, state.boxEditor.currentBoxes, exportBoxLineWidth());
  const unit = state.comparison.dpi / 72;
  const m = LG_MARGIN_PT * unit;
  drawLegend(ctx, diffLegendItems(kind), m, m, unit);
  return c;
}

$("dlPng").addEventListener("click",()=>{
  // 切替モードの画像で説明を要する色はオレンジの変更枠だけ。枠OFFなら凡例は不要なので
  // out をそのまま出す。それ以外（差分モード全般／切替モードで枠ON）は凡例を重ねる。
  const bare = state.visual.mode==="toggle" && !state.boxEditor.showBoxes;
  const shot = bare ? out : exportCanvasWithLegend(out, state.visual.mode);
  shot.toBlob(b=>{
    const name = state.visual.mode==="toggle"
      ? (state.visual.toggleSide==="new" ? "new_p"+(state.documents.currentPage+1)+".png" : "old_p"+(state.documents.currentPage+1)+".png")
      : "diff_p"+(state.documents.currentPage+1)+".png";
    downloadBlob(b, name);
  });
});

$("dlPdf").addEventListener("click",async()=>{
  $("status").innerHTML='<span class="busy">PDF生成中…</span>';
  let pdf=null;
  const scratch=createCanvas(0, 0); // 全ページで使い回す複製先（毎ページ確保するとピークメモリが倍になる）
  // dlPdf は state.visual.mode に関わらず全ページを buildDiff で描くため、ループ内で書き込まれる
  // state.boxEditor.autoByPage は差分アルゴリズム由来の値になる。これは書き出し専用の一時的な結果であり
  // 画面表示（新旧切替モード等）の自動枠を汚してはいけないため、ループの前にMap内容を
  // 退避して空にし、終了後に同じMapへ戻す。
  const savedBoxAuto = new Map(state.boxEditor.autoByPage);
  state.boxEditor.autoByPage.clear();
  for(let i=0;i<state.documents.pages;i++){
    await buildDiff(i);
    // dlPdf は state.visual.mode に関わらず buildDiff で差分を描くため、常に差分用の凡例を付ける
    const shot=exportCanvasWithLegend(out, "diff", scratch);
    const img=shot.toDataURL("image/png");
    const w=shot.width, h=shot.height;
    // Canvasはdpi/72倍のpx。ページ実寸(pt)に戻して渡す。
    // 用紙サイズ正規化時も「基準ページ(大きい用紙)は必ず dpi/72 で描画する」(framePlan の
    // frameScale)ため、フレーム寸法を dpi/72 で割ると基準ページのpt実寸が得られる。式は不変。
    const scale=state.comparison.dpi/72, wPt=w/scale, hPt=h/scale;
    const orient = w>h ? "l":"p";
    if(i===0){ pdf=new jsPDF({orientation:orient,unit:"pt",format:[wPt,hPt],compress:true}); }
    else { pdf.addPage([wPt,hPt],orient); }
    pdf.addImage(img,"PNG",0,0,wPt,hPt);
  }
  state.boxEditor.autoByPage.clear();
  for(const [pageIndex, boxes] of savedBoxAuto) state.boxEditor.autoByPage.set(pageIndex, boxes);
  pdf.save("diff.pdf");
  await show(state.documents.currentPage);
  $("status").textContent="PDFを保存しました";
});

// ── トップモード切替（図面比較 / テキスト比較） ──
function applyTopMode(){
  const visual = state.ui.topMode==="visual";
  if(!visual && state.boxEditor.editMode) setBoxEditMode(false);
  $("topVisual").classList.toggle("active", visual);
  $("topText").classList.toggle("active", !visual);
  $("visualCtrl").style.display = visual ? "flex" : "none";
  $("textCtrl").style.display = visual ? "none" : "flex";
  $("viewbar").style.display = visual ? "flex" : "none";
  document.querySelector(".canvas-wrap").style.display = visual ? "" : "none";
  $("textPanel").style.display = visual ? "none" : "flex";
  if(visual){
    if(state.visual.rendered) out.style.display = "block"; // 描画済みならCanvas表示を復元
    // テキストモード中は .canvas-wrap が display:none で幅0のため、resizeイベントで
    // boxLayer が0×0に潰れている。visual復帰時にここで寸法を取り直して枠を出し直す。
    drawBoxLayer();
  } else { out.style.display = "none"; } // hasImage() 誤判定・パン/ズームの誤発火を防ぐ
  if(!visual && state.textReview.highlights){
    // テキスト側は描画済みハイライトがあれば現在ページを再描画（往復時の表示復元）
    const gen = ++state.textReview.renderGeneration; // 旧新2ペインへ同一世代を渡す
    Promise.all([renderTextPage("old", state.textReview.page, gen), renderTextPage("new", state.textReview.page, gen)])
      .then(applyTextTransform);
  }
}
$("topVisual").addEventListener("click", ()=>{
  if(state.ui.topMode==="visual") return;
  state.ui.topMode="visual"; applyTopMode();
});
$("topText").addEventListener("click", ()=>{
  if(state.ui.topMode==="text") return;
  state.ui.topMode="text"; applyTopMode();
});

// ── テキスト差分モード（ページ上ハイライト方式） ──

// ハイライト色（CSS変数から取得。--removed は図面モードと共用、他はテキスト専用変数）
const TEXT_HI_COLORS = (() => {
  const cs = getComputedStyle(document.documentElement);
  return {
    removed: cs.getPropertyValue("--removed").trim(),
    added:   cs.getPropertyValue("--added-text").trim(),
    changed: cs.getPropertyValue("--changed").trim(),
  };
})();

// 1ページ分のテキストを行単位に再構成（Y座標でグルーピング→X座標順に連結）。
// トークンは box化せず item.transform（6要素）と item.width を保持（scale/viewport非依存）。
// content.items 相当の配列を現行ロジックで行再構成（空str/hasEOL/TOL/末尾トリムを現行同様に処理）
function logXYCutBlocks(idx, leaves, hadVerticalCut){
  console.log(`[XYCut] page ${idx+1}: leaves=${leaves.length} hadVerticalCut=${hadVerticalCut}`,
    leaves.map(l => l.length));
}

async function extractPageTokenLines(doc, idx){
  const page = await doc.getPage(idx+1);
  const content = await page.getTextContent();

  // 前処理ゲート: 回転ページは現行動作（横書き前提が崩れるため）
  if(page.rotate % 180 !== 0) return reconstructLinesInItemOrder(content.items);

  // 非空トークン化（ord=content.items内の添字を保持）
  // 空白のみitem（pdf.jsが段間ギャップを表す" "等）は幾何解析から除外。これを含めると
  // ガターが空白itemで橋渡しされ和集合ギャップが消え、縦カット(段分割)を取りこぼす。
  // 行の再構成(reconstructLinesInItemOrder)は全item(空白含む)を使うため出力・非回帰には不影響。
  const toks = [];
  let vcount = 0;
  content.items.forEach((it, ord) => {
    if(!it.str || !it.str.trim()) return;
    const x0 = it.transform[4], y0 = it.transform[5];
    const fh = Math.hypot(it.transform[2], it.transform[3]);
    if(Math.abs(it.transform[1]) > Math.abs(it.transform[0])) vcount++;
    toks.push({ord, x0, x1:x0 + it.width, y0, y1:y0 + fh, fh});
  });

  // 縦書き主体ページは現行動作
  if(toks.length && vcount * 2 > toks.length) return reconstructLinesInItemOrder(content.items);
  if(toks.length < XYCUT_MIN_BLOCK_TOKENS) return reconstructLinesInItemOrder(content.items);

  const ctx = {hadVerticalCut:false};
  const leaves = xyCut(toks, {
    maxDepth: XYCUT_MAX_DEPTH,
    minBlockTokens: XYCUT_MIN_BLOCK_TOKENS,
    colGapEm: COL_GAP_EM,
    rowGapEm: ROW_GAP_EM,
    colMinSideLines: COL_MIN_SIDE_LINES,
    context: ctx,
  });

  // 列存在ゲート: 縦カット無しは現行動作（バイト一致・非回帰）。有りは葉ごと再構成。
  const result = ctx.hadVerticalCut
    ? assembleFromLeaves(content.items, leaves)
    : reconstructLinesInItemOrder(content.items);

  if(state.textReview.debugXYCut) logXYCutBlocks(idx, leaves, ctx.hadVerticalCut);
  return result;
}

// 文書全体を位置つきでページ配列として取得（[pageLines, ...]）
async function extractDocTokens(doc, label){
  if(!doc) return [];
  const pages = [];
  for(let i=0;i<doc.numPages;i++){
    pages.push(await extractPageTokenLines(doc, i));
    $("textStatus").textContent = label+"抽出中…（"+(i+1)+"/"+doc.numPages+"）";
  }
  return pages;
}

// ── XY-cut 多段組み読み順復元（フェーズ3）定数 ──
const XYCUT_MAX_DEPTH        = 6;   // 再帰深度上限
const XYCUT_MIN_BLOCK_TOKENS = 2;   // これ未満は分割せず葉に
const COL_GAP_EM             = 2.5; // 縦カット(段)最小ガター幅 ÷ フォント高
const ROW_GAP_EM             = 1.6; // 横カット最小空白高 ÷ フォント高
const COL_MIN_SIDE_LINES     = 3;   // 段分割は両側に≥3行(量子化Y種類)を要求

// ── 描画 ──

// pdf.js textlayer と同じ単位分離でトークンのAABBを求め、色枠を焼き込む
function drawTokenHighlight(ctx, vp, token, colorKey){
  const tx = pdfjsLib.Util.transform(vp.transform, token.transform);
  const advLen = Math.hypot(tx[0], tx[1]) || 1;
  const ux = tx[0]/advLen, uy = tx[1]/advLen; // 送り方向単位ベクトル
  const wid = token.w * vp.scale;             // 幅は item.width×scale（token.transformには掛けない）
  const descFrac = 0.2;                       // ディセント分の余白
  const p0x = tx[4] - tx[2]*descFrac, p0y = tx[5] - tx[3]*descFrac;
  const vx = tx[2]*(1+descFrac), vy = tx[3]*(1+descFrac); // 縦方向ベクトル（アセント方向、高さ=hypot(tx[2],tx[3])基準）
  const p1x = p0x + ux*wid, p1y = p0y + uy*wid;
  const p2x = p0x + vx, p2y = p0y + vy;
  const p3x = p1x + vx, p3y = p1y + vy;
  const xs=[p0x,p1x,p2x,p3x], ys=[p0y,p1y,p2y,p3y];
  const minX=Math.min(...xs), maxX=Math.max(...xs), minY=Math.min(...ys), maxY=Math.max(...ys);
  const color = TEXT_HI_COLORS[colorKey] || "#fff";
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = color;
  ctx.fillRect(minX, minY, maxX-minX, maxY-minY);
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(minX+0.5, minY+0.5, Math.max(maxX-minX-1,0), Math.max(maxY-minY-1,0));
  ctx.restore();
}

// 指定側・ページを描画し、ハイライトを焼き込む（再入ガードでstale-draw防止）
// gen は呼び出し側が採番する世代トークン（旧新2ペインへ同一世代を渡し、互いを無効化しないようにする）
async function renderTextPage(side, pageIndex, gen){
  const doc = side==="old" ? state.documents.oldDoc : state.documents.newDoc;
  const canvas = side==="old" ? $("oldTextCanvas") : $("newTextCanvas");
  const ctx = canvas.getContext("2d");
  if(!doc || pageIndex>=doc.numPages){
    canvas.width = 10; canvas.height = 10;
    ctx.fillStyle = "#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
    return;
  }
  const page = await doc.getPage(pageIndex+1);
  const vp = page.getViewport({scale: state.textReview.scale});
  if(gen !== state.textReview.renderGeneration) return;
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
  ctx.fillStyle = "#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
  await page.render({canvasContext:ctx, viewport:vp}).promise;
  if(gen !== state.textReview.renderGeneration) return; // 別世代の描画が割り込んだので着色せず終了

  const entries = state.textReview.highlights && state.textReview.highlights[side] ? state.textReview.highlights[side].get(pageIndex) : null;
  if(entries) for(const {token:tok, color} of entries) drawTokenHighlight(ctx, vp, tok, color);
}

// 出力用：オンスクリーンCanvas/再入ガードに触れず、指定ページを別Canvasへ描画（無ければnull）
async function renderTextPageOffscreen(side, pageIndex){
  const doc = side==="old" ? state.documents.oldDoc : state.documents.newDoc;
  if(!doc || pageIndex>=doc.numPages) return null;
  const page = await doc.getPage(pageIndex+1);
  const vp = page.getViewport({scale: state.textReview.scale});
  const canvas = createWhiteCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const ctx = canvas.getContext("2d");
  await page.render({canvasContext:ctx, viewport:vp}).promise;

  const entries = state.textReview.highlights && state.textReview.highlights[side] ? state.textReview.highlights[side].get(pageIndex) : null;
  if(entries) for(const {token:tok, color} of entries) drawTokenHighlight(ctx, vp, tok, color);
  return canvas;
}

// テキスト比較のラベル帯(高さ28px・フォント16px固定)に収まる凡例のスケール。
// 図面側の state.comparison.dpi/72 とは別系統の固定値（帯もフォントもDPIに依存しないため）。
const TEXT_LG_UNIT = 1.6;

// 旧(上)・新(下)を各ラベル帯付きで縦積み合成（等倍・非伸縮、横中央寄せ）（ページ無し側は白Canvasで代替）
function composeTextExport(oldC, newC, pageIndex, total){
  const fallback = (w,h) => createWhiteCanvas(w, h);
  if(!oldC) oldC = fallback(newC.width, newC.height);
  if(!newC) newC = fallback(oldC.width, oldC.height);

  const labelH = 28, gap = 24;
  const W = Math.max(oldC.width, newC.width);
  const H = labelH + oldC.height + gap + labelH + newC.height;
  const canvas = createWhiteCanvas(W, H);
  const ctx = canvas.getContext("2d");

  ctx.font = "bold 16px sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillStyle = TEXT_HI_COLORS.removed;
  ctx.textAlign = "left";
  ctx.fillText("OLD", 4, labelH/2);
  ctx.fillStyle = "#333";
  ctx.textAlign = "right";
  const pageText = "p "+(pageIndex+1)+" / "+total;
  ctx.fillText(pageText, W-4, labelH/2);

  // 凡例は最上部の帯にのみ。帯は既に白地なので下地・枠(chrome)は描かない。
  // OLDラベルの右に置き、ページ番号と重なるほど幅が無ければ描画を諦める。
  const lgItems = [
    {color: TEXT_HI_COLORS.removed, label: "削除"},
    {color: TEXT_HI_COLORS.added,   label: "追加"},
    {color: TEXT_HI_COLORS.changed, label: "変更"},
  ];
  const lgOpts = {chrome: false};
  const lg = measureLegend(ctx, lgItems, TEXT_LG_UNIT, lgOpts);
  const lgX = 4 + ctx.measureText("OLD").width + 16;
  const lgLimit = W - 4 - ctx.measureText(pageText).width - 16;
  if(lgX + lg.w <= lgLimit){
    // 幅ガードで使った lg をそのまま渡し、描画側で同じレイアウトを再計算させない
    drawLegend(ctx, lgItems, lgX, labelH/2 - lg.h/2, TEXT_LG_UNIT, lgOpts, lg);
  }

  ctx.drawImage(oldC, (W-oldC.width)/2, labelH);

  const newLabelY = labelH + oldC.height + gap;
  ctx.fillStyle = TEXT_HI_COLORS.added;
  ctx.textAlign = "left";
  ctx.fillText("NEW", 4, newLabelY + labelH/2);
  ctx.drawImage(newC, (W-newC.width)/2, newLabelY + labelH);
  return canvas;
}

// ── ズーム/パン/ページング（旧新共有ビュー・topMode==="text"限定） ──

function textTotalPages(){
  return Math.max(state.documents.oldDoc?state.documents.oldDoc.numPages:0, state.documents.newDoc?state.documents.newDoc.numPages:0);
}

// 両ペイン共通のワールド寸法（旧新のCanvas実寸の最大値。寸法差は中央寄せで吸収）
function textWorldSize(){
  const oldC = $("oldTextCanvas"), newC = $("newTextCanvas");
  return { W: Math.max(oldC.width||0, newC.width||0, 1), H: Math.max(oldC.height||0, newC.height||0, 1) };
}

function applyTextTransform(){
  const {W,H} = textWorldSize();
  const v = state.textReview.view;
  [$("oldTextCanvas"), $("newTextCanvas")].forEach(c=>{
    const offX = (W-c.width)/2, offY = (H-c.height)/2;
    c.style.transform = `translate(${v.tx+offX*v.scale}px, ${v.ty+offY*v.scale}px) scale(${v.scale})`;
  });
}

function fitTextView(){
  const {W,H} = textWorldSize();
  const wrapEl = document.querySelector(".text-pane.old .text-canvas-wrap");
  const Ww = wrapEl.clientWidth, Wh = wrapEl.clientHeight;
  if(!W || !H || !Ww || !Wh) return;
  const s = Math.min(Ww/W, Wh/H) * 0.92;
  state.textReview.view.scale = s;
  state.textReview.view.tx = (Ww-W*s)/2;
  state.textReview.view.ty = (Wh-H*s)/2;
  applyTextTransform();
}

const clampTextScale = s => Math.min(Math.max(s, 0.05), 40);
function textZoomAt(factor, cx, cy){
  const v = state.textReview.view;
  const ns = clampTextScale(v.scale*factor), k = ns/v.scale;
  v.tx = cx-(cx-v.tx)*k; v.ty = cy-(cy-v.ty)*k; v.scale = ns;
  applyTextTransform();
}
function textZoomCenter(factor){
  const wrapEl = document.querySelector(".text-pane.old .text-canvas-wrap");
  textZoomAt(factor, wrapEl.clientWidth/2, wrapEl.clientHeight/2);
}

async function showTextPage(idx){
  const total = textTotalPages();
  if(!total || idx<0 || idx>=total) return;
  state.textReview.page = idx;
  $("textPageInd").textContent = (idx+1)+" / "+total;
  const gen = ++state.textReview.renderGeneration; // 旧新2ペインへ同一世代を渡し、互いのstale-drawガードで潰し合わないようにする
  await Promise.all([renderTextPage("old", idx, gen), renderTextPage("new", idx, gen)]);
  applyTextTransform();
}

document.querySelectorAll(".text-canvas-wrap").forEach(wrapEl=>{
  wrapEl.addEventListener("wheel", e=>{
    if(state.ui.topMode!=="text") return;
    if(!state.textReview.highlights) return;
    e.preventDefault();
    const r = wrapEl.getBoundingClientRect();
    textZoomAt(e.deltaY<0 ? 1.12 : 1/1.12, e.clientX-r.left, e.clientY-r.top);
  }, {passive:false});
});

let textPanning=false, tpsx=0, tpsy=0, tptx=0, tpty=0;
document.querySelectorAll(".text-canvas-wrap").forEach(wrapEl=>{
  wrapEl.addEventListener("pointerdown", e=>{
    if(state.ui.topMode!=="text") return;
    if(!state.textReview.highlights) return;
    textPanning=true; wrapEl.classList.add("panning"); wrapEl.setPointerCapture(e.pointerId);
    tpsx=e.clientX; tpsy=e.clientY; tptx=state.textReview.view.tx; tpty=state.textReview.view.ty;
  });
  wrapEl.addEventListener("pointermove", e=>{
    if(state.ui.topMode!=="text") return;
    if(!textPanning) return;
    state.textReview.view.tx = tptx+(e.clientX-tpsx); state.textReview.view.ty = tpty+(e.clientY-tpsy);
    applyTextTransform();
  });
  const endTextPan = e=>{
    if(!textPanning) return;
    textPanning=false; wrapEl.classList.remove("panning");
    try{ wrapEl.releasePointerCapture(e.pointerId); }catch(_){}
  };
  wrapEl.addEventListener("pointerup", endTextPan);
  wrapEl.addEventListener("pointercancel", endTextPan);
});

$("textPrev").addEventListener("click", ()=>{ if(state.ui.topMode!=="text") return; showTextPage(state.textReview.page-1); });
$("textNext").addEventListener("click", ()=>{ if(state.ui.topMode!=="text") return; showTextPage(state.textReview.page+1); });
$("textZoomIn").addEventListener("click", ()=>{ if(state.ui.topMode!=="text") return; if(state.textReview.highlights) textZoomCenter(1.25); });
$("textZoomOut").addEventListener("click", ()=>{ if(state.ui.topMode!=="text") return; if(state.textReview.highlights) textZoomCenter(1/1.25); });
$("textZoomFit").addEventListener("click", ()=>{ if(state.ui.topMode!=="text") return; if(state.textReview.highlights) fitTextView(); });
$("textZoom1").addEventListener("click", ()=>{ if(state.ui.topMode!=="text") return; if(state.textReview.highlights) textZoomCenter(1/state.textReview.view.scale); });

async function runTextDiff(){
  const token = ++state.textReview.extractGeneration;
  $("textStatus").classList.add("busy");
  $("textStatus").textContent = "抽出中…";

  if(!state.textReview.extraction){
    const oldPages = await extractDocTokens(state.documents.oldDoc, "旧版: ");
    if(token !== state.textReview.extractGeneration) return; // 別の抽出が割り込んだので破棄
    const newPages = await extractDocTokens(state.documents.newDoc, "新版: ");
    if(token !== state.textReview.extractGeneration) return;
    state.textReview.extraction = {old:oldPages, new:newPages};
  }
  $("textStatus").classList.remove("busy");

  const hasText = state.textReview.extraction.old.some(p=>p.some(l=>l.text.trim())) ||
                  state.textReview.extraction.new.some(p=>p.some(l=>l.text.trim()));
  if(!hasText){
    $("textStatus").textContent = "テキストレイヤがありません。図面比較で確認してください";
    return;
  }

  const hi = buildTextHighlights(state.textReview.extraction.old, state.textReview.extraction.new);
  applyTableHighlights(state.textReview.extraction.old, state.textReview.extraction.new, hi);
  state.textReview.highlights = hi;
  state.textReview.scale = state.comparison.dpi/72;
  state.textReview.page = 0;

  await showTextPage(0);
  fitTextView();
  $("dlTextPng").disabled = false; $("dlTextPdf").disabled = false;
  $("textStatus").textContent = "テキスト差分を表示中";
}

$("runText").addEventListener("click", runTextDiff);

$("dlTextPng").addEventListener("click", async()=>{
  if(state.ui.topMode!=="text" || !state.textReview.highlights) return;
  $("textStatus").textContent = "PNG生成中…";
  const idx = state.textReview.page, total = textTotalPages();
  const [oldC, newC] = await Promise.all([
    renderTextPageOffscreen("old", idx),
    renderTextPageOffscreen("new", idx),
  ]);
  const canvas = composeTextExport(oldC, newC, idx, total);
  canvas.toBlob(b=>{
    downloadBlob(b, "textdiff_p"+(idx+1)+".png");
    $("textStatus").textContent = "テキスト差分を表示中";
  });
});

$("dlTextPdf").addEventListener("click", async()=>{
  if(state.ui.topMode!=="text" || !state.textReview.highlights) return;
  const total = textTotalPages();
  let pdf=null;
  for(let i=0;i<total;i++){
    $("textStatus").innerHTML = '<span class="busy">PDF生成中…（'+(i+1)+"/"+total+"）</span>";
    const [oldC, newC] = await Promise.all([
      renderTextPageOffscreen("old", i),
      renderTextPageOffscreen("new", i),
    ]);
    const canvas = composeTextExport(oldC, newC, i, total);
    const img = canvas.toDataURL("image/png");
    const w = canvas.width, h = canvas.height;
    const scale=state.comparison.dpi/72, wPt=w/scale, hPt=h/scale; // Canvasはdpi/72倍のpx。ページ実寸(pt)に戻して渡す
    const orient = w>h ? "l":"p";
    if(i===0){ pdf=new jsPDF({orientation:orient,unit:"pt",format:[wPt,hPt],compress:true}); }
    else { pdf.addPage([wPt,hPt],orient); }
    pdf.addImage(img,"PNG",0,0,wPt,hPt);
  }
  pdf.save("textdiff.pdf");
  $("textStatus").textContent = "PDFを保存しました";
});
