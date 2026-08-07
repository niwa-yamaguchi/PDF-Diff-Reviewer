import {
  downsampleMaskMax,
  inkIoU,
  inkMaskFromGray,
  phaseCorrelate,
  resampleToN,
  warpMask,
} from "./similarity.js";

const QUAD_N = 256;
const QUAD_MIN_GAIN  = 0.15;
const QUAD_MIN_RATIO = 1.02;

export function rotateGray90(g, W, H, k){
  const kk = ((k % 4) + 4) % 4;
  if(kk === 0) return { g, w:W, h:H };
  if(kk === 2){
    const out = new Float64Array(W*H);
    for(let y=0;y<H;y++) for(let x=0;x<W;x++) out[y*W+x] = g[(H-1-y)*W + (W-1-x)];
    return { g:out, w:W, h:H };
  }
  const w = H, h = W;
  const out = new Float64Array(w*h);
  if(kk === 1){
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) out[y*w+x] = g[(H-1-x)*W + y];
  } else {
    for(let y=0;y<h;y++) for(let x=0;x<w;x++) out[y*w+x] = g[x*W + (W-1-y)];
  }
  return { g:out, w, h };
}

export function quadrantScore(O, Nw, th, N){
  const oN = resampleToN(O.g,  O.w,  O.h,  O.w,  O.h,  N);
  const nN = resampleToN(Nw.g, Nw.w, Nw.h, Nw.w, Nw.h, N);
  const tr = phaseCorrelate(oN, nN, N);
  const oM = downsampleMaskMax(inkMaskFromGray(O.g,  O.w*O.h,  th), O.w,  O.h,  O.w,  O.h,  N, N);
  const nM = downsampleMaskMax(inkMaskFromGray(Nw.g, Nw.w*Nw.h, th), Nw.w, Nw.h, Nw.w, Nw.h, N, N);
  const warped = warpMask(nM, N, N, 0, 1, tr.dxSub, tr.dySub);
  return inkIoU(oM, warped, N*N);
}

export function bestQuadrant(O, Nw, th, opts={}){
  const N = opts.N || QUAD_N;
  const scores = [0,0,0,0];
  for(let k=0;k<4;k++){
    const R = rotateGray90(Nw.g, Nw.w, Nw.h, k);
    scores[k] = quadrantScore(O, R, th, N);
  }
  let bk = 0;
  for(let k=1;k<4;k++) if(scores[k] > scores[bk]) bk = k;
  const applied = bk !== 0
    && (scores[bk] - scores[0]) >= (opts.minGain ?? QUAD_MIN_GAIN)
    && scores[bk] >= scores[0] * (opts.minRatio ?? QUAD_MIN_RATIO);
  return { k: applied ? bk : 0, scores, applied };
}
