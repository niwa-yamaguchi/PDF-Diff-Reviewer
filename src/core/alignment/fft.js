export function fft1d(re, im, inverse){
  const n = re.length;
  for(let i=1, j=0; i<n; i++){
    let bit = n >> 1;
    for(; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if(i < j){ const tr=re[i];re[i]=re[j];re[j]=tr; const ti=im[i];im[i]=im[j];im[j]=ti; }
  }
  for(let len=2; len<=n; len<<=1){
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for(let i=0;i<n;i+=len){
      let cwr=1, cwi=0;
      for(let k=0;k<half;k++){
        const a = i+k, b = i+k+half;
        const vr = re[b]*cwr - im[b]*cwi;
        const vi = re[b]*cwi + im[b]*cwr;
        re[b]=re[a]-vr; im[b]=im[a]-vi;
        re[a]+=vr; im[a]+=vi;
        const ncwr = cwr*wr - cwi*wi; cwi = cwr*wi + cwi*wr; cwr = ncwr;
      }
    }
  }
  if(inverse){ for(let i=0;i<n;i++){ re[i]/=n; im[i]/=n; } }
}

export function fft2d(re, im, N, inverse){
  const rr = new Float64Array(N), ri = new Float64Array(N);
  for(let y=0;y<N;y++){
    const off = y*N;
    for(let x=0;x<N;x++){ rr[x]=re[off+x]; ri[x]=im[off+x]; }
    fft1d(rr, ri, inverse);
    for(let x=0;x<N;x++){ re[off+x]=rr[x]; im[off+x]=ri[x]; }
  }
  const cr = new Float64Array(N), ci = new Float64Array(N);
  for(let x=0;x<N;x++){
    for(let y=0;y<N;y++){ cr[y]=re[y*N+x]; ci[y]=im[y*N+x]; }
    fft1d(cr, ci, inverse);
    for(let y=0;y<N;y++){ re[y*N+x]=cr[y]; im[y*N+x]=ci[y]; }
  }
}

export function hannWindow(N){
  const w1 = new Float64Array(N);
  for(let i=0;i<N;i++) w1[i] = 0.5*(1 - Math.cos(2*Math.PI*i/(N-1)));
  const w = new Float64Array(N*N);
  for(let y=0;y<N;y++) for(let x=0;x<N;x++) w[y*N+x] = w1[y]*w1[x];
  return w;
}

export function sampleBilinear(g, W, H, x, y, fill){
  if(x<0 || y<0 || x>W-1 || y>H-1) return fill;
  const x0=Math.floor(x), y0=Math.floor(y);
  const x1=Math.min(x0+1,W-1), y1=Math.min(y0+1,H-1);
  const fx=x-x0, fy=y-y0;
  const a=g[y0*W+x0], b=g[y0*W+x1], c=g[y1*W+x0], d=g[y1*W+x1];
  return a*(1-fx)*(1-fy) + b*fx*(1-fy) + c*(1-fx)*fy + d*fx*fy;
}
