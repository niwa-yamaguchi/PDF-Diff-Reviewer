import { fft2d, hannWindow, sampleBilinear } from "./fft.js";

export function warpAffine(src, N, angle, scale, tx, ty){
  const dst = new Float64Array(N*N).fill(255);
  const c = (N-1)/2;
  const cos=Math.cos(angle), sin=Math.sin(angle);
  const inv = 1/scale;
  for(let y=0;y<N;y++){
    for(let x=0;x<N;x++){
      const px = x - c - tx, py = y - c - ty;
      const sx = c + inv*( cos*px + sin*py);
      const sy = c + inv*(-sin*px + cos*py);
      dst[y*N+x] = sampleBilinear(src, N, N, sx, sy, 255);
    }
  }
  return dst;
}

export function magnitudeSpectrum(gray, N, win){
  const re = new Float64Array(N*N), im = new Float64Array(N*N);
  for(let i=0;i<N*N;i++) re[i] = gray[i]*win[i];
  fft2d(re, im, N, false);
  const mag = new Float64Array(N*N);
  const h = N>>1;
  for(let y=0;y<N;y++){
    const sy = (y+h)%N;
    for(let x=0;x<N;x++){
      const sx = (x+h)%N;
      mag[sy*N+sx] = Math.log(1 + Math.hypot(re[y*N+x], im[y*N+x]));
    }
  }
  return mag;
}

export function logPolar(mag, N, nRho, nTheta){
  const cx=N/2, cy=N/2;
  const rhoMax = N/2;
  const logBase = Math.exp(Math.log(rhoMax)/nRho);
  const out = new Float64Array(nRho*nTheta);
  for(let ri=0; ri<nRho; ri++){
    const rho = Math.pow(logBase, ri);
    for(let ti=0; ti<nTheta; ti++){
      const theta = Math.PI*ti/nTheta;
      const x = cx + rho*Math.cos(theta);
      const y = cy + rho*Math.sin(theta);
      out[ri*nTheta+ti] = sampleBilinear(mag, N, N, x, y, 0);
    }
  }
  return out;
}

export function phaseCorrelate(a, b, N){
  const ar=new Float64Array(N*N), ai=new Float64Array(N*N);
  const br=new Float64Array(N*N), bi=new Float64Array(N*N);
  ar.set(a); br.set(b);
  fft2d(ar, ai, N, false);
  fft2d(br, bi, N, false);
  const cr=new Float64Array(N*N), ci=new Float64Array(N*N);
  for(let i=0;i<N*N;i++){
    const re = ar[i]*br[i] + ai[i]*bi[i];
    const im = ai[i]*br[i] - ar[i]*bi[i];
    const mag = Math.hypot(re, im) || 1e-12;
    cr[i]=re/mag; ci[i]=im/mag;
  }
  fft2d(cr, ci, N, true);
  let peak=-Infinity, px=0, py=0;
  for(let y=0;y<N;y++) for(let x=0;x<N;x++){
    const v=cr[y*N+x];
    if(v>peak){ peak=v; px=x; py=y; }
  }
  let sum=0, sum2=0, cnt=0;
  for(let y=0;y<N;y++) for(let x=0;x<N;x++){
    const ddx=Math.min(((x-px)%N+N)%N, ((px-x)%N+N)%N);
    const ddy=Math.min(((y-py)%N+N)%N, ((py-y)%N+N)%N);
    if(ddx<=2 && ddy<=2) continue;
    const v=cr[y*N+x]; sum+=v; sum2+=v*v; cnt++;
  }
  const mean=sum/cnt;
  const std=Math.sqrt(Math.max(sum2/cnt - mean*mean, 1e-12));
  const psr=(peak-mean)/std;
  let sx=px, sy=py;
  if(sx>=N/2) sx-=N;
  if(sy>=N/2) sy-=N;
  const at = (x,y) => cr[(((y%N)+N)%N)*N + (((x%N)+N)%N)];
  const parab = (a,b,c) => {
    const d = a - 2*b + c;
    if(!(Math.abs(d) > 1e-12)) return 0;
    return Math.max(-0.5, Math.min(0.5, 0.5*(a-c)/d));
  };
  const sdx = parab(at(px-1,py), at(px,py), at(px+1,py));
  const sdy = parab(at(px,py-1), at(px,py), at(px,py+1));
  return { dx:sx, dy:sy, dxSub:sx+sdx, dySub:sy+sdy, peak, psr };
}

export function resampleToN(gray, W, H, Wc, Hc, N){
  const out = new Float64Array(N*N).fill(255);
  for(let y=0;y<N;y++){
    const sy = y * Hc / N;
    for(let x=0;x<N;x++){
      const sx = x * Wc / N;
      out[y*N+x] = (sx <= W-1 && sy <= H-1) ? sampleBilinear(gray, W, H, sx, sy, 255) : 255;
    }
  }
  return out;
}

export function estimateSimilarity(oldGray, oldW, oldH, newGray, newW, newH, opts={}){
  const N = opts.N || 512;
  const minPsr = opts.minPsr ?? 30;
  const maxAngle = (opts.maxAngleDeg ?? 45) * Math.PI/180;
  const minScale = opts.minScale ?? 0.5, maxScale = opts.maxScale ?? 2.0;
  const NONE = { angle:0, scale:1, txFrac:0, tyFrac:0, conf:0, applied:false };

  const Wc = Math.max(oldW, newW), Hc = Math.max(oldH, newH);
  const oldN = resampleToN(oldGray, oldW, oldH, Wc, Hc, N);
  const newN = resampleToN(newGray, newW, newH, Wc, Hc, N);
  const win = hannWindow(N);
  const magO = magnitudeSpectrum(oldN, N, win);
  const magNw = magnitudeSpectrum(newN, N, win);
  const lpO = logPolar(magO, N, N, N);
  const lpN = logPolar(magNw, N, N, N);
  const rs = phaseCorrelate(lpO, lpN, N);
  const rhoMax = N/2, logBase = Math.exp(Math.log(rhoMax)/N);
  const angleStep = Math.PI / N;
  const thetaBase = rs.dx * angleStep;
  const scaleBase = Math.pow(logBase, rs.dy);

  const candidates = [];
  for(const th of [thetaBase, thetaBase + Math.PI, -thetaBase]){
    for(const sc of [scaleBase, 1/scaleBase]){
      candidates.push({ th, sc });
    }
  }
  let best = null;
  for(const {th, sc} of candidates){
    if(!(sc >= minScale && sc <= maxScale)) continue;
    if(Math.abs(((th+Math.PI)%(2*Math.PI)) - Math.PI) > maxAngle) continue;
    const warped = warpAffine(newN, N, -th, 1/sc, 0, 0);
    const tr = phaseCorrelate(oldN, warped, N);
    const conf = Math.min(rs.psr, tr.psr);
    if(!best || tr.peak > best.tr.peak){
      best = { th, sc, tr, conf };
    }
  }
  if(!best) return NONE;

  const angle = -best.th;
  const scale = 1/best.sc;
  const txFrac = best.tr.dx / N;
  const tyFrac = best.tr.dy / N;
  const applied = best.conf >= minPsr
    && scale >= minScale && scale <= maxScale
    && Math.abs(angle) <= maxAngle;
  return { angle, scale, txFrac, tyFrac, conf: best.conf, applied };
}

export function inkMaskFromGray(gray, n, th){
  const m = new Uint8Array(n);
  for(let i=0;i<n;i++) m[i] = gray[i] < th ? 1 : 0;
  return m;
}

export function downsampleMaskMax(mask, W, H, Wc, Hc, tw, th){
  const out = new Uint8Array(tw*th);
  for(let ty=0; ty<th; ty++){
    const y0 = Math.floor(ty*Hc/th);
    const y1 = Math.min(H, Math.max(y0+1, Math.floor((ty+1)*Hc/th)));
    for(let tx=0; tx<tw; tx++){
      const x0 = Math.floor(tx*Wc/tw);
      const x1 = Math.min(W, Math.max(x0+1, Math.floor((tx+1)*Wc/tw)));
      let v = 0;
      for(let y=y0; y<y1 && !v; y++){
        if(y>=H) break;
        const row = y*W;
        for(let x=x0; x<x1; x++){
          if(x>=W) break;
          if(mask[row+x]){ v=1; break; }
        }
      }
      out[ty*tw+tx] = v;
    }
  }
  return out;
}

export function inkIoU(a, b, n){
  let inter=0, uni=0;
  for(let i=0;i<n;i++){
    const x=a[i], y=b[i];
    if(x|y){ uni++; if(x&y) inter++; }
  }
  return uni===0 ? 1 : inter/uni;
}

export function warpMask(mask, W, H, angle, scale, tx, ty){
  const out = new Uint8Array(W*H);
  const cx=(W-1)/2, cy=(H-1)/2;
  const cos=Math.cos(angle), sin=Math.sin(angle), inv=1/scale;
  for(let y=0;y<H;y++){
    for(let x=0;x<W;x++){
      const px = x - cx - tx, py = y - cy - ty;
      const sx = Math.round(cx + inv*( cos*px + sin*py));
      const sy = Math.round(cy + inv*(-sin*px + cos*py));
      if(sx>=0 && sx<W && sy>=0 && sy<H) out[y*W+x] = mask[sy*W+sx];
    }
  }
  return out;
}

const SCORE_N = 512;
const SCORE_MIN_GAIN = 0.02;
const SCORE_MIN_RATIO = 1.02;

export function bestAlignment(O, Nw, th){
  const Wc = Math.max(O.w, Nw.w), Hc = Math.max(O.h, Nw.h);
  const long = Math.max(Wc, Hc);
  const gw = Math.max(8, Math.round(SCORE_N * Wc / long));
  const gh = Math.max(8, Math.round(SCORE_N * Hc / long));
  const oM = downsampleMaskMax(inkMaskFromGray(O.g,  O.w*O.h,  th), O.w,  O.h,  Wc, Hc, gw, gh);
  const nM = downsampleMaskMax(inkMaskFromGray(Nw.g, Nw.w*Nw.h, th), Nw.w, Nw.h, Wc, Hc, gw, gh);
  const n = gw*gh;

  const cands = [{ angle:0, scale:1, txFrac:0, tyFrac:0, method:"identity" }];
  const FN = 512;
  const oN = resampleToN(O.g,  O.w,  O.h,  Wc, Hc, FN);
  const nN = resampleToN(Nw.g, Nw.w, Nw.h, Wc, Hc, FN);
  const tr = phaseCorrelate(oN, nN, FN);
  cands.push({ angle:0, scale:1, txFrac: tr.dxSub/FN, tyFrac: tr.dySub/FN, method:"translate" });
  cands.push({ angle:0, scale:1, txFrac:-tr.dxSub/FN, tyFrac:-tr.dySub/FN, method:"translate" });
  const fmt = estimateSimilarity(O.g, O.w, O.h, Nw.g, Nw.w, Nw.h);
  cands.push({ angle:fmt.angle, scale:fmt.scale, txFrac:fmt.txFrac, tyFrac:fmt.tyFrac, method:"fmt" });

  let base = 0, best = null;
  for(const c of cands){
    const warped = warpMask(nM, gw, gh, c.angle, c.scale, c.txFrac*gw, c.tyFrac*gh);
    const s = inkIoU(oM, warped, n);
    if(c.method === "identity") base = s;
    if(!best || s > best.score) best = { c, score:s };
  }
  const applied = best.c.method !== "identity"
    && (best.score - base) >= SCORE_MIN_GAIN
    && best.score >= base * SCORE_MIN_RATIO;
  const chosen = applied ? best.c : cands[0];
  return {
    angle: chosen.angle, scale: chosen.scale, txFrac: chosen.txFrac, tyFrac: chosen.tyFrac,
    applied, method: chosen.method, scoreBase: base, scoreBest: best.score
  };
}
