/* 自動トレース（細線化→ベクター化） */
const AutoTrace=(()=>{
"use strict";
function mask(data,W,H,x0,y0,w,h,o){
  const m=new Uint8Array(w*h);
  for(let y=0;y<h;y++){const Y=y0+y;if(Y<0||Y>=H)continue;
    for(let x=0;x<w;x++){const X=x0+x;if(X<0||X>=W)continue;const i=(Y*W+X)*4;
      const r=data[i],g=data[i+1],b=data[i+2];
      const d=o.grid?255-Math.max(r,g,b):255-(0.3*r+0.59*g+0.11*b);
      if(d>=o.thr)m[y*w+x]=1}}
  return m;
}
function morph(m,w,h,dil){
  const o=new Uint8Array(w*h);
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;
    let v=dil?0:1;
    for(let dy=-1;dy<=1&&(dil?!v:v);dy++)for(let dx=-1;dx<=1;dx++){const q=m[i+dy*w+dx];if(dil&&q){v=1;break}if(!dil&&!q){v=0;break}}
    o[i]=v}
  return o;
}
function removeSmall(m,w,h,minArea){
  const lab=new Int32Array(w*h),st=[];
  for(let s=0;s<w*h;s++){if(!m[s]||lab[s])continue;
    const comp=[];st.push(s);lab[s]=1;
    while(st.length){const i=st.pop();comp.push(i);const x=i%w,y=(i/w)|0;
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const X=x+dx,Y=y+dy;if(X<0||Y<0||X>=w||Y>=h)continue;const j=Y*w+X;if(m[j]&&!lab[j]){lab[j]=1;st.push(j)}}}
    if(comp.length<minArea)for(const i of comp)m[i]=0;
  }
  return m;
}
function thin(img,w,h){
  for(let x=0;x<w;x++){img[x]=0;img[(h-1)*w+x]=0}
  for(let y=0;y<h;y++){img[y*w]=0;img[y*w+w-1]=0}
  let pts=[];for(let i=0;i<w*h;i++)if(img[i])pts.push(i);
  const del=[];let changed=true;
  while(changed){changed=false;
    for(let step=0;step<2;step++){del.length=0;
      for(const i of pts){if(!img[i])continue;
        const p2=img[i-w],p3=img[i-w+1],p4=img[i+1],p5=img[i+w+1],p6=img[i+w],p7=img[i+w-1],p8=img[i-1],p9=img[i-w-1];
        const B=p2+p3+p4+p5+p6+p7+p8+p9;if(B<2||B>6)continue;
        const A=(!p2&&p3?1:0)+(!p3&&p4?1:0)+(!p4&&p5?1:0)+(!p5&&p6?1:0)+(!p6&&p7?1:0)+(!p7&&p8?1:0)+(!p8&&p9?1:0)+(!p9&&p2?1:0);
        if(A!==1)continue;
        if(step===0){if(p2&&p4&&p6)continue;if(p4&&p6&&p8)continue}
        else{if(p2&&p4&&p8)continue;if(p2&&p6&&p8)continue}
        del.push(i)}
      for(const i of del)img[i]=0;if(del.length)changed=true}
    pts=pts.filter(i=>img[i])}
  // 階段状の余分な画素を除去
  for(const i of pts){if(!img[i])continue;
    const n=img[i-w],e=img[i+1],s=img[i+w],wv=img[i-1];
    const cnt=n+e+s+wv+img[i-w+1]+img[i+w+1]+img[i+w-1]+img[i-w-1];
    if(cnt!==2)continue;
    if((n&&e)||(e&&s)||(s&&wv)||(wv&&n))img[i]=0}
  return img;
}
const NB=w=>[-w-1,-w,-w+1,-1,1,w-1,w,w+1];
function graph(sk,w,h){
  const nb=NB(w),N=w*h,deg=new Uint8Array(N);
  for(let i=w;i<N-w;i++){if(!sk[i])continue;let c=0;for(const d of nb)if(sk[i+d])c++;deg[i]=c}
  const isNode=i=>sk[i]&&deg[i]!==2;
  // 分岐点のかたまり
  const cl=new Int32Array(N).fill(-1),clusters=[];
  for(let i=0;i<N;i++){if(!sk[i]||deg[i]<3||cl[i]>=0)continue;
    const id=clusters.length,st=[i],mem=[];cl[i]=id;
    while(st.length){const p=st.pop();mem.push(p);for(const d of nb){const q=p+d;if(sk[q]&&deg[q]>=3&&cl[q]<0){cl[q]=id;st.push(q)}}}
    let sx=0,sy=0;for(const p of mem){sx+=p%w;sy+=(p/w)|0}
    clusters.push({x:sx/mem.length,y:sy/mem.length,ends:[]})}
  const vis=new Uint8Array(N),edges=[];
  const P=i=>[i%w,(i/w)|0];
  for(let i=0;i<N;i++){if(!isNode(i))continue;
    for(const d of nb){const q=i+d;if(!sk[q])continue;
      if(isNode(q)){continue}
      if(vis[q])continue;
      const path=[i,q];let prev=i,cur=q;vis[q]=1;
      for(;;){let nx=-1;
        for(const dd of nb){const r=cur+dd;if(r===prev||!sk[r])continue;if(isNode(r)&&r!==i||isNode(r)&&path.length>2){nx=r;break}}
        if(nx<0)for(const dd of nb){const r=cur+dd;if(r===prev||!sk[r]||vis[r]||isNode(r))continue;nx=r;break}
        if(nx<0)break;
        path.push(nx);if(isNode(nx))break;vis[nx]=1;prev=cur;cur=nx}
      edges.push({px:path.map(P),a:path[0],b:path[path.length-1],closed:false})}}
  for(let i=0;i<N;i++){if(!sk[i]||vis[i]||isNode(i))continue;
    const path=[i];vis[i]=1;let prev=-1,cur=i;
    for(;;){let nx=-1;for(const d of nb){const r=cur+d;if(r!==prev&&sk[r]&&!vis[r]){nx=r;break}}
      if(nx<0)break;vis[nx]=1;path.push(nx);prev=cur;cur=nx}
    edges.push({px:path.map(P),a:-1,b:-1,closed:path.length>8})}
  return{edges,clusters,cl,deg};
}
const len=px=>{let L=0;for(let k=1;k<px.length;k++)L+=Math.hypot(px[k][0]-px[k-1][0],px[k][1]-px[k-1][1]);return L};
function chains(G,o){
  const {edges,clusters,cl,deg}=G;
  // ひげの除去
  let alive=edges.filter(e=>{
    if(e.closed)return true;
    const L=len(e.px);
    const ja=e.a>=0&&cl[e.a]>=0,jb=e.b>=0&&cl[e.b]>=0;
    if(ja&&jb)return L>=1.5||cl[e.a]!==cl[e.b];
    if(ja||jb)return L>=o.spur;
    return L>=o.minLen*0.5;
  });
  // 分岐点で座標を中心に寄せ、端を登録
  alive.forEach((e,ei)=>{e.id=ei;e.link=[null,null];
    for(const side of [0,1]){const pix=side?e.b:e.a;if(pix<0||e.closed)continue;const c=cl[pix];if(c<0)continue;
      const C=clusters[c];const pt=side?e.px.length-1:0;e.px[pt]=[C.x,C.y];C.ends.push({e,side})}});
  // 直進する組を結ぶ
  const dir=(e,side)=>{const p=e.px,n=p.length;const k=Math.min(n-1,8);
    const a=side?p[n-1]:p[0],b=side?p[n-1-k]:p[k];const dx=a[0]-b[0],dy=a[1]-b[1],l=Math.hypot(dx,dy)||1;return[dx/l,dy/l]};
  const cosMax=-Math.cos(o.joinDeg*Math.PI/180);
  for(const C of clusters){
    const ends=C.ends.filter(x=>alive.includes(x.e));
    const cand=[];
    for(let i=0;i<ends.length;i++)for(let j=i+1;j<ends.length;j++){if(ends[i].e===ends[j].e)continue;
      const d1=dir(ends[i].e,ends[i].side),d2=dir(ends[j].e,ends[j].side),c=d1[0]*d2[0]+d1[1]*d2[1];
      if(c<=cosMax)cand.push([c,i,j])}
    cand.sort((a,b)=>a[0]-b[0]);const used=new Set();
    for(const [,i,j] of cand){if(used.has(i)||used.has(j))continue;used.add(i);used.add(j);
      const A=ends[i],B=ends[j];A.e.link[A.side]={e:B.e,side:B.side};B.e.link[B.side]={e:A.e,side:A.side}}
  }
  // つなげて長い線にする
  const done=new Set(),out=[];
  const walk=(e,fromSide)=>{ // fromSideから入り反対側へ
    let pts=[],cur=e,inSide=fromSide,closed=false;
    for(;;){done.add(cur);let seg=cur.px.slice();if(inSide===1)seg.reverse();
      if(pts.length)seg.shift();pts=pts.concat(seg);
      const outSide=1-inSide,lk=cur.link[outSide];
      if(!lk)break;if(lk.e===e){closed=true;break}if(done.has(lk.e))break;
      cur=lk.e;inSide=lk.side}
    return{pts,closed}};
  for(const e of alive){if(done.has(e))continue;
    if(e.closed){done.add(e);out.push({pts:e.px,closed:true});continue}
    if(e.link[0]&&e.link[1])continue;
    out.push(walk(e,e.link[0]?1:0))}
  for(const e of alive){if(done.has(e))continue;out.push(walk(e,0))}
  return out.filter(c=>len(c.pts)>=o.minLen||c.closed&&len(c.pts)>=o.minLen*0.5);
}
function rdp(pts,eps){
  if(pts.length<3)return pts.slice();
  const keep=new Uint8Array(pts.length);keep[0]=keep[pts.length-1]=1;const st=[[0,pts.length-1]];
  while(st.length){const [a,b]=st.pop();const A=pts[a],B=pts[b];const dx=B[0]-A[0],dy=B[1]-A[1],L=Math.hypot(dx,dy)||1;
    let md=0,mi=-1;for(let i=a+1;i<b;i++){const d=Math.abs((pts[i][0]-A[0])*dy-(pts[i][1]-A[1])*dx)/L;if(d>md){md=d;mi=i}}
    if(md>eps){keep[mi]=1;st.push([a,mi],[mi,b])}}
  return pts.filter((_,i)=>keep[i]);
}
function smoothPts(pts,closed){
  // 移動平均で鉛筆のゆらぎを抑える
  const n=pts.length;if(n<5)return pts;
  return pts.map((p,i)=>{if(!closed&&(i===0||i===n-1))return p;
    let sx=0,sy=0,c=0;for(let k=-2;k<=2;k++){let j=i+k;if(closed)j=(j+n)%n;else if(j<0||j>=n)continue;sx+=pts[j][0];sy+=pts[j][1];c++}
    return[sx/c,sy/c]});
}
function toNodes(pts,closed,cornerDeg){
  let p=pts;if(closed&&p.length>2&&Math.hypot(p[0][0]-p[p.length-1][0],p[0][1]-p[p.length-1][1])<1.5)p=p.slice(0,-1);
  const n=p.length,cMin=Math.cos(cornerDeg*Math.PI/180);
  return p.map((q,i)=>{const node={x:q[0],y:q[1],hi:null,ho:null,smooth:false};
    const pi=i>0?i-1:(closed?n-1:-1),ni=i<n-1?i+1:(closed?0:-1);if(pi<0||ni<0||n<3)return node;
    const a=p[pi],b=p[ni];const v1=[q[0]-a[0],q[1]-a[1]],v2=[b[0]-q[0],b[1]-q[1]];const l1=Math.hypot(...v1),l2=Math.hypot(...v2);if(!l1||!l2)return node;
    const c=(v1[0]*v2[0]+v1[1]*v2[1])/(l1*l2);if(c<cMin)return node;
    let tx=b[0]-a[0],ty=b[1]-a[1];const tl=Math.hypot(tx,ty)||1;tx/=tl;ty/=tl;
    node.hi={x:q[0]-tx*l1/3,y:q[1]-ty*l1/3};node.ho={x:q[0]+tx*l2/3,y:q[1]+ty*l2/3};node.smooth=true;return node});
}
// data:RGBA配列, 領域(x0,y0,w,h) → 画像座標の線の配列
function run(data,W,H,x0,y0,w,h,o){
  const x1=Math.min(W,Math.ceil(x0+w)),y1=Math.min(H,Math.ceil(y0+h));
  x0=Math.max(0,Math.floor(x0));y0=Math.max(0,Math.floor(y0));w=x1-x0;h=y1-y0;
  if(w<5||h<5)return[];
  let m=mask(data,W,H,x0,y0,w,h,o);
  if(o.close)m=morph(morph(m,w,h,true),w,h,false);
  removeSmall(m,w,h,o.minArea);
  thin(m,w,h);
  const G=graph(m,w,h);
  const cs=chains(G,o);
  return cs.map(c=>{const pts=smoothPts(c.pts,c.closed).map(q=>[q[0]+x0,q[1]+y0]);
    const s=rdp(c.closed?pts.concat([pts[0]]):pts,o.eps);
    return{pts:s,raw:pts,closed:c.closed}}).filter(c=>c.pts.length>=2);
}
return{run,toNodes,mask,rdp};
})();
