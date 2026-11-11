/* 土器実測図トレース 本体 */
(()=>{
"use strict";
const SAMPLE_IMG=window.DOKI_SAMPLE_IMG||"";
const NS="http://www.w3.org/2000/svg";
const $=id=>document.getElementById(id);
const svg=$("svg"),world=$("world"),content=$("content"),overlay=$("overlay"),stage=$("stage");

const PT=25.4/72; // 1pt = 0.3528mm（内部はmmで保持）
const LAYER_DEFS=[
  {id:"break",  name:"割れの記号",     color:"#8e24aa", width:0.15*PT, dash:"solid", fill:false},
  {id:"adjust", name:"調整跡",         color:"#f08300", width:0.12*PT, dash:"solid", fill:false},
  {id:"center", name:"中心線",         color:"#808080", width:0.15*PT, dash:"solid", fill:false},
  {id:"ridge",  name:"稜線の高いところ", color:"#1565c0", width:0.2*PT,  dash:"dash",  fill:false},
  {id:"outline",name:"表面外枠",       color:"#16a34a", width:0.3*PT,  dash:"solid", fill:false},
  {id:"section",name:"断面",           color:"#e60012", width:0.5*PT,  dash:"solid", fill:false},
  {id:"scale",  name:"スケール",       color:"#e6b800", width:0.1,     dash:"solid", fill:false},
  {id:"text",   name:"文字",           color:"#000000", width:0.1,     dash:"solid", fill:false},
];
const freshLayers=()=>LAYER_DEFS.map(l=>({...l,visible:true,locked:false}));

const state={layers:freshLayers(),objects:[],active:"outline",pxPerMm:5.46,denom:3,
  img:null,imgRot:0,imgOpacity:0.5,imgVisible:true,colorMode:true,exportColor:true,widthUnit:"pt",sample:false,name:"trace"};
const view={z:1,tx:0,ty:0};
const ui={tool:"pen",sel:null,multi:[],nodesSel:[],drawing:null,drag:null,space:false,measure:[],cursor:null,alt:false};
let undoStack=[],redoStack=[];

/* ---------- helpers ---------- */
let uidN=0;const uid=()=>"o"+Date.now().toString(36)+(uidN++);
const K=()=>state.pxPerMm*state.denom; // 下図px／印刷mm
const layer=id=>state.layers.find(l=>l.id===id);
const obj=id=>state.objects.find(o=>o.id===id);
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const lerp=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const r2=v=>Math.round(v*100)/100;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let toastT;function toast(msg){const t=$("toast");t.textContent=msg;t.classList.add("show");clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove("show"),2600)}

function pathD(o,round){
  const n=o.nodes;if(!n.length)return"";const f=round?r2:v=>v;
  let d=`M${f(n[0].x)} ${f(n[0].y)}`;
  const seg=(a,b)=>{if(a.ho||b.hi){const c1=a.ho||a,c2=b.hi||b;return` C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(b.x)} ${f(b.y)}`}return` L${f(b.x)} ${f(b.y)}`};
  for(let i=1;i<n.length;i++)d+=seg(n[i-1],n[i]);
  if(o.closed&&n.length>1)d+=seg(n[n.length-1],n[0])+" Z";
  return d;
}
function dashArr(dash,w){
  const k=K();
  if(dash==="dash")return[2*k,1*k].map(r2).join(" ");
  if(dash==="dashdot")return[5*k,1*k,Math.max(w,0.3)*k,1*k].map(r2).join(" ");
  return"";
}
function pathMarkup(o,col,forExport){
  const k=K(),sw=r2(o.width*k),fill=(o.fill&&o.closed)?col:"none",da=dashArr(o.dash,o.width);
  const cap=o.dash==="solid"?"round":"butt";
  let s=`<path d="${pathD(o,true)}" fill="${fill}" stroke="${col}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="${cap}"${da?` stroke-dasharray="${da}"`:""}${forExport?"":` pointer-events="none"`}/>`;
  if(!forExport){
    s+=`<path class="hit" data-id="${o.id}" d="${pathD(o,true)}" fill="${fill==="none"?"none":"transparent"}" stroke="transparent" stroke-width="${r2(Math.max(sw,12/view.z))}"/>`;
  }
  return s;
}
const TXT_FONT="'Yu Gothic','YuGothic','Hiragino Sans','Meiryo',sans-serif";
const textLines=o=>String(o.text||"").split("\n");
function textBox(o){
  const fs=o.size*K(),ls=textLines(o);let w=0;
  for(const l of ls){let c=0;for(const ch of l)c+=ch.charCodeAt(0)>0x2E7F?1:0.6;w=Math.max(w,c)}
  w=Math.max(w*fs,fs*0.6);const h=ls.length*fs*1.25;
  const x=o.align==="middle"?o.x-w/2:o.align==="end"?o.x-w:o.x;return{x,y:o.y-fs*0.95,w,h:h}
}
function textMarkup(o,col,forExport){
  if(!forExport&&ui.editing===o.id)return"";
  const fs=o.size*K(),ls=textLines(o);let s="";
  if(!forExport){const b=textBox(o),m=2/view.z;s+=`<g data-id="${o.id}"><rect x="${r2(b.x-m)}" y="${r2(b.y-m)}" width="${r2(b.w+2*m)}" height="${r2(b.h+2*m)}" fill="transparent"/>`}
  s+=`<text x="${r2(o.x)}" y="${r2(o.y)}" font-family="${TXT_FONT}" font-size="${r2(fs)}" fill="${col}"${o.align&&o.align!=="start"?` text-anchor="${o.align}"`:""}${forExport?"":` pointer-events="none"`}>`+
    ls.map((l,i)=>`<tspan x="${r2(o.x)}" ${i?`dy="${r2(fs*1.25)}"`:`y="${r2(o.y)}"`}>${esc(l)||"\u00a0"}</tspan>`).join("")+`</text>`;
  if(!forExport)s+=`</g>`;
  return s;
}
function scaleMarkup(o,col,forExport){
  const k=K(),L=o.cm*10*state.pxPerMm,seg=L/o.cm,h=1.0*k,fs=(o.size||2.6)*k,sw=r2(0.1*k);
  let s=`<g transform="translate(${r2(o.x)} ${r2(o.y)})"${forExport?"":` data-id="${o.id}"`}>`;
  if(!forExport)s+=`<rect x="${r2(-2*k)}" y="${r2(-fs-2*k)}" width="${r2(L+4*k)}" height="${r2(h+fs+4*k)}" fill="transparent"/>`;
  for(let i=0;i<o.cm;i++)s+=`<rect x="${r2(i*seg)}" y="0" width="${r2(seg)}" height="${r2(h)}" fill="${i%2?"#ffffff":col}" stroke="${col}" stroke-width="${sw}"/>`;
  const ff=`font-family="Helvetica, Arial, sans-serif" font-size="${r2(fs)}" fill="${col}" text-anchor="middle"`;
  s+=`<text x="0" y="${r2(-0.8*k)}" ${ff}>${esc(o.l0??"0")}</text><text x="${r2(L)}" y="${r2(-0.8*k)}" ${ff}>${esc(o.l1??o.cm+"cm")}</text></g>`;
  return s;
}
function objMarkup(o,forExport){
  const L=layer(o.layer);const col=(forExport?state.exportColor:state.colorMode)?L.color:"#000000";
  return o.kind==="scale"?scaleMarkup(o,col,forExport):o.kind==="text"?textMarkup(o,col,forExport):pathMarkup(o,col,forExport);
}

/* ---------- render ---------- */
let rafQ=false;function render(){if(rafQ)return;rafQ=true;requestAnimationFrame(()=>{rafQ=false;draw()})}
function draw(){
  world.setAttribute("transform",`translate(${view.tx} ${view.ty}) scale(${view.z})`);
  const img=$("bgimg"),paper=$("paper");
  if(state.img){
    img.setAttribute("href",state.img.src);img.setAttribute("width",state.img.w);img.setAttribute("height",state.img.h);
    img.setAttribute("opacity",state.imgOpacity);img.style.display=state.imgVisible?"":"none";
    paper.setAttribute("width",state.img.w);paper.setAttribute("height",state.img.h);paper.style.display="";
    const rt=state.imgRot?`rotate(${state.imgRot} ${state.img.w/2} ${state.img.h/2})`:"";
    img.setAttribute("transform",rt);paper.setAttribute("transform",rt);$("maskimg").setAttribute("transform",rt);
  }else{img.style.display="none";$("maskimg").style.display="none";paper.setAttribute("width",1000);paper.setAttribute("height",1400);paper.removeAttribute("transform");}
  let html="";
  for(const L of state.layers){
    if(!L.visible)continue;
    const items=state.objects.filter(o=>o.layer===L.id);
    html+=`<g data-layer="${L.id}"${L.locked?` pointer-events="none"`:""}>`+items.map(o=>objMarkup(o,false)).join("")+`</g>`;
  }
  content.innerHTML=html;
  positionEditor();
  overlay.innerHTML=overlayMarkup();
  $("zLabel").textContent=Math.round(view.z*100)+"%";
  $("btnUndo").disabled=!undoStack.length;$("btnRedo").disabled=!redoStack.length;
}
function overlayMarkup(){
  pruneSel();
  const z=view.z,a=7/z,hr=3.6/z,lw=1/z;let s="";
  const anchor=(o,n,i,filled)=>`<rect data-oid="${o.id}" data-node="${i}" x="${n.x-a/2}" y="${n.y-a/2}" width="${a}" height="${a}" style="fill:${filled?"var(--sel)":"#ffffff"};stroke:var(--sel)" stroke-width="${lw}"/>`;
  const handle=(o,n,h,i,w)=>`<line x1="${n.x}" y1="${n.y}" x2="${h.x}" y2="${h.y}" style="stroke:var(--sel)" stroke-width="${lw}" pointer-events="none"/><circle data-oid="${o.id}" data-node="${i}" data-h="${w}" cx="${h.x}" cy="${h.y}" r="${hr}" style="fill:var(--sel);stroke:#ffffff" stroke-width="${lw}"/>`;
  for(const id of ui.multi){const sel=obj(id);if(!sel)continue;
    if(sel.kind==="path"){
      s+=`<path d="${pathD(sel)}" fill="none" style="stroke:var(--sel)" stroke-width="${1.2/z}" pointer-events="none"/>`;
      const drawing=ui.drawing===sel.id;
      if(ui.tool==="direct"||drawing){
        const n=sel.nodes,NN=n.length,show=new Set();
        const mine=ui.nodesSel.filter(q=>q.id===sel.id).map(q=>q.i);
        if(drawing&&NN)show.add(NN-1);
        for(const i of mine)show.add(i);
        if(!drawing)for(const i of mine){
          const pi=i-1>=0?i-1:(sel.closed?NN-1:-1),ni=i+1<NN?i+1:(sel.closed?0:-1);
          if(pi>=0&&n[pi].ho&&!show.has(pi))s+=handle(sel,n[pi],n[pi].ho,pi,"out");
          if(ni>=0&&n[ni].hi&&!show.has(ni))s+=handle(sel,n[ni],n[ni].hi,ni,"in");
        }
        for(const i of show){const q=n[i];if(!q)continue;if(q.hi)s+=handle(sel,q,q.hi,i,"in");if(q.ho)s+=handle(sel,q,q.ho,i,"out")}
        n.forEach((q,i)=>{s+=anchor(sel,q,i,mine.includes(i)||(drawing&&i===0&&NN>1))});
      }else{
        const b=bbox(sel.nodes),m=4/z;
        s+=`<rect x="${b.x-m}" y="${b.y-m}" width="${b.w+2*m}" height="${b.h+2*m}" fill="none" style="stroke:var(--sel)" stroke-width="${lw}" stroke-dasharray="${4/z} ${3/z}" pointer-events="none"/>`;
      }
      if(drawing&&ui.cursor&&!ui.drag&&N(sel)){
        const last=sel.nodes[sel.nodes.length-1],c=ui.shift?constrain(last,ui.cursor):ui.cursor;
        const d=last.ho?`M${last.x} ${last.y} C${last.ho.x} ${last.ho.y} ${c.x} ${c.y} ${c.x} ${c.y}`:`M${last.x} ${last.y} L${c.x} ${c.y}`;
        s+=`<path d="${d}" fill="none" style="stroke:var(--sel)" stroke-width="${lw}" stroke-dasharray="${3/z} ${3/z}" pointer-events="none"/>`;
        if(sel.nodes.length>=2&&dist(c,sel.nodes[0])*z<9)s+=`<circle cx="${sel.nodes[0].x}" cy="${sel.nodes[0].y}" r="${8/z}" fill="none" style="stroke:var(--sel)" stroke-width="${lw}" pointer-events="none"/>`;
      }
    }else{
      const b=objBBox(sel),m=3/z;
      s+=`<rect x="${b.x-m}" y="${b.y-m}" width="${b.w+2*m}" height="${b.h+2*m}" fill="none" style="stroke:var(--sel)" stroke-width="${lw}" stroke-dasharray="${4/z} ${3/z}" pointer-events="none"/>`;
    }
  }
  if(ui.drag&&(ui.drag.type==="rect"||ui.drag.type==="marquee")){const a=ui.drag.start,b=ui.drag.cur;
    s+=`<rect x="${Math.min(a.x,b.x)}" y="${Math.min(a.y,b.y)}" width="${Math.abs(b.x-a.x)}" height="${Math.abs(b.y-a.y)}" style="fill:var(--sel);fill-opacity:${ui.drag.type==="rect"?.08:.04};stroke:var(--sel)" stroke-width="${lw}" stroke-dasharray="${5/z} ${3/z}" pointer-events="none"/>`}
  if(ui.drag&&ui.drag.join){const t=ui.drag.join.at;
    s+=`<circle cx="${t.x}" cy="${t.y}" r="${9/z}" fill="none" stroke="#2e9d4f" stroke-width="${2/z}" pointer-events="none"/><circle cx="${t.x}" cy="${t.y}" r="${2.5/z}" fill="#2e9d4f" pointer-events="none"/>`}
  if(ui.measure.length){
    const [p,q]=ui.measure;const c=q||ui.cursor;
    if(c&&(ui.tool==="measure"||ui.tool==="level")||q)s+=`<line x1="${p.x}" y1="${p.y}" x2="${(q||c).x}" y2="${(q||c).y}" style="stroke:var(--warn)" stroke-width="${1.5/z}" pointer-events="none"/>`;
    for(const m of ui.measure)s+=`<circle cx="${m.x}" cy="${m.y}" r="${4/z}" style="fill:var(--warn)" pointer-events="none"/>`;
  }
  return s;
}
/* ---------- join ---------- */
function revPath(o){o.nodes=o.nodes.slice().reverse().map(n=>({...n,hi:n.ho,ho:n.hi}))}
function openEnds(exclude){
  const out=[];for(const o of selectable()){if(o.kind!=="path"||o.closed||o.nodes.length<2||o.id===exclude)continue;
    out.push({o,end:0,p:o.nodes[0]},{o,end:1,p:o.nodes[o.nodes.length-1]})}return out}
// 点qに近い他の線の端点（selfEnd!=nullなら自分の反対端も候補＝閉じる）
function nearestEnd(q,selfId,selfEnd){
  const tol=9/view.z;let best=null;
  for(const c of openEnds(selfId)){const dd=dist(q,c.p);if(dd<=tol&&(!best||dd<best.d))best={...c,d:dd}}
  if(selfEnd!=null){const o=obj(selfId);const other=selfEnd===0?o.nodes[o.nodes.length-1]:o.nodes[0];const dd=dist(q,other);
    if(dd<=tol&&(!best||dd<best.d))best={o,end:1-selfEnd,p:other,d:dd}}
  return best;
}
// aのaEnd側にbのbEnd側をつなぐ。a===bなら閉じる。tolPx以内の端は1点にまとめ、離れていれば直線でつなぐ
function joinPaths(a,aEnd,b,bEnd,tolPx){
  if(a===b){
    const f=a.nodes[0],l=a.nodes[a.nodes.length-1];
    if(dist(f,l)<=tolPx&&a.nodes.length>2){f.hi=l.hi;f.smooth=false;a.nodes.pop()}
    a.closed=true;return a;
  }
  if(aEnd===0)revPath(a);if(bEnd===1)revPath(b);
  const l=a.nodes[a.nodes.length-1],f=b.nodes[0];let rest=b.nodes;
  if(dist(l,f)<=tolPx){l.ho=f.ho?{...f.ho}:null;l.smooth=false;rest=b.nodes.slice(1)}
  a.nodes=a.nodes.concat(rest.map(n=>({...n,hi:n.hi&&{...n.hi},ho:n.ho&&{...n.ho}})));
  state.objects=state.objects.filter(x=>x!==b);
  return a;
}
function joinCommand(){
  finishPath();const tol=Math.max(0.5,0.05*state.pxPerMm);
  if(ui.tool==="direct"&&ui.nodesSel.length===2){
    const [p,q]=ui.nodesSel,a=obj(p.id),b=obj(q.id);
    const isEnd=(o,i)=>o&&o.kind==="path"&&!o.closed&&(i===0||i===o.nodes.length-1);
    if(!isEnd(a,p.i)||!isEnd(b,q.i)){toast("連結できるのは開いた線の端点どうしです");return}
    pushUndo();const r=joinPaths(a,p.i===0?0:1,b,q.i===0?0:1,tol);setSel([r.id]);ui.nodesSel=[];renderAll();
    toast(a===b?"線を閉じました":"2本の線を1本に連結しました");return;
  }
  const ps=selObjs().filter(o=>o.kind==="path"&&!o.closed&&o.nodes.length>=2);
  if(!ps.length){toast("連結する線（開いた線）を選択してください");return}
  pushUndo();
  if(ps.length===1){joinPaths(ps[0],1,ps[0],0,tol);setSel([ps[0].id]);renderAll();toast("線を閉じました");return}
  let a=ps.find(o=>o.id===ui.sel)||ps[0];let others=ps.filter(o=>o!==a);const n=others.length;
  while(others.length){let best=null;
    for(const b of others)for(const ae of [0,1])for(const be of [0,1]){
      const pa=ae?a.nodes[a.nodes.length-1]:a.nodes[0],pb=be?b.nodes[b.nodes.length-1]:b.nodes[0],dd=dist(pa,pb);
      if(!best||dd<best.d)best={b,ae,be,d:dd}}
    a=joinPaths(a,best.ae,best.b,best.be,tol);others=others.filter(o=>o!==best.b)}
  setSel([a.id]);ui.nodesSel=[];renderAll();toast(`${n+1}本の線を1本に連結しました`);
}
function autoJoin(){
  finishPath();
  const mm=parseFloat($("joinTol").value);if(!(mm>0)){toast("間隔（mm）を入れてください");return}
  const tol=mm*state.pxPerMm,merge=Math.max(0.5,0.05*state.pxPerMm);
  let pool=selObjs().filter(o=>o.kind==="path"&&!o.closed&&o.nodes.length>=2);
  if(pool.length<1){toast("連結する線を選択してください（Ctrl+Aですべて選択）");return}
  pushUndo();let joins=0,closes=0;
  for(;;){let best=null;
    for(let i=0;i<pool.length;i++){const a=pool[i];
      for(let j=i;j<pool.length;j++){const b=pool[j];if(a.layer!==b.layer)continue;
        for(const ae of [0,1])for(const be of [0,1]){
          if(a===b&&(ae===be||a.nodes.length<3))continue;
          const pa=ae?a.nodes[a.nodes.length-1]:a.nodes[0],pb=be?b.nodes[b.nodes.length-1]:b.nodes[0],dd=dist(pa,pb);
          if(dd<=tol&&(!best||dd<best.d))best={a,b,ae,be,d:dd}}}}
    if(!best)break;
    const r=joinPaths(best.a,best.ae,best.b,best.be,merge);
    if(best.a===best.b){closes++;pool=pool.filter(o=>o!==r)}else{joins++;pool=pool.filter(o=>o!==best.b)}
  }
  if(!joins&&!closes){undoStack.pop();toast(`${mm}mm以内で向かい合う端は見つかりませんでした`);return}
  pruneSel();renderAll();toast(`${joins}か所を連結${closes?`、${closes}本を閉じた線に`:""}しました（取り消しで戻せます）`);
}
$("btnJoin").onclick=joinCommand;$("btnAutoJoin").onclick=autoJoin;

/* ---------- selection ---------- */
const selObjs=()=>ui.multi.map(obj).filter(Boolean);
function setSel(ids){ui.multi=[...new Set(ids)].filter(id=>obj(id));ui.sel=ui.multi.length?ui.multi[ui.multi.length-1]:null;ui.nodesSel=ui.nodesSel.filter(n=>ui.multi.includes(n.id))}
function clearSel(){ui.multi=[];ui.sel=null;ui.nodesSel=[]}
function pruneSel(){
  ui.multi=ui.multi.filter(id=>obj(id));if(ui.sel&&!obj(ui.sel))ui.sel=null;
  if(ui.sel&&!ui.multi.includes(ui.sel))ui.multi.push(ui.sel);
  if(!ui.sel&&ui.multi.length)ui.sel=ui.multi[ui.multi.length-1];
  ui.nodesSel=ui.nodesSel.filter(n=>{const o=obj(n.id);return o&&o.kind==="path"&&o.nodes[n.i]&&ui.multi.includes(n.id)});
}
const nodeSel=(id,i)=>ui.nodesSel.some(n=>n.id===id&&n.i===i);
function objBBox(o){
  if(o.kind==="scale"){const k=K(),fs=(o.size||2.6)*k;return{x:o.x,y:o.y-fs-k,w:o.cm*10*state.pxPerMm,h:fs+2*k}}
  if(o.kind==="text")return textBox(o);
  return bbox(o.nodes);
}
function pathTouchesRect(o,x0,y0,x1,y1){
  const n=o.nodes,inR=q=>q.x>=x0&&q.x<=x1&&q.y>=y0&&q.y<=y1;
  if(n.some(inR))return true;
  const segs=o.closed?n.length:n.length-1;
  for(let s=0;s<segs;s++){const a=n[s],b=n[(s+1)%n.length];for(let k=1;k<16;k++)if(inR(cubic(a,a.ho||a,b.hi||b,b,k/16)))return true}
  return false;
}
function selectable(){return state.objects.filter(o=>{const L=layer(o.layer);return L&&L.visible&&!L.locked})}
function finishMarquee(d){
  const x0=Math.min(d.start.x,d.cur.x),x1=Math.max(d.start.x,d.cur.x),y0=Math.min(d.start.y,d.cur.y),y1=Math.max(d.start.y,d.cur.y);
  if((x1-x0)*view.z<3&&(y1-y0)*view.z<3)return;
  const objs=selectable();
  if(d.mode==="obj"){
    const hits=objs.filter(o=>{if(o.kind!=="path"){const b=objBBox(o);return b.x<=x1&&b.x+b.w>=x0&&b.y<=y1&&b.y+b.h>=y0}return pathTouchesRect(o,x0,y0,x1,y1)}).map(o=>o.id);
    setSel(d.add?[...d.base,...hits]:hits);ui.nodesSel=[];
  }else{
    const nodes=[];
    for(const o of objs){if(o.kind!=="path")continue;o.nodes.forEach((n,i)=>{if(n.x>=x0&&n.x<=x1&&n.y>=y0&&n.y<=y1)nodes.push({id:o.id,i})})}
    const ids=[...new Set(nodes.map(n=>n.id))];
    const base=d.add?d.baseNodes:[];
    const merged=[...base,...nodes.filter(n=>!base.some(b=>b.id===n.id&&b.i===n.i))];
    setSel(d.add?[...d.base,...ids]:ids);ui.nodesSel=merged.filter(n=>ui.multi.includes(n.id));
  }
}
const N=o=>o.nodes.length;
function bbox(ns){let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const n of ns){for(const p of [n,n.hi,n.ho]){if(!p)continue;x0=Math.min(x0,p.x);y0=Math.min(y0,p.y);x1=Math.max(x1,p.x);y1=Math.max(y1,p.y)}}return{x:x0,y:y0,w:x1-x0,h:y1-y0}}

/* ---------- panel ---------- */
const EYE='<svg viewBox="0 0 20 20" width="16" height="16"><path d="M1.5 10S5 4 10 4s8.5 6 8.5 6-3.5 6-8.5 6S1.5 10 1.5 10z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="10" cy="10" r="2.6" fill="currentColor"/></svg>';
const LOCK='<svg viewBox="0 0 20 20" width="15" height="15"><rect x="4" y="9" width="12" height="9" rx="1.5" fill="currentColor"/><path d="M6.5 9V6.5a3.5 3.5 0 017 0V9" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
function renderPanel(){
  $("secSample").hidden=!state.sample;
  const list=$("layerList");const hasSel=selObjs().length>0;
  list.innerHTML=[...state.layers].reverse().map(L=>{
    const c=state.objects.filter(o=>o.layer===L.id).length;
    return `<li data-layer="${L.id}" class="${L.id===state.active?"on":""}" draggable="${ui.renaming===L.id?"false":"true"}">
      <button type="button" class="ib" data-act="vis" aria-pressed="${L.visible}" title="表示／非表示" aria-label="${esc(L.name)}を表示">${EYE}</button>
      <button type="button" class="ib" data-act="lock" aria-pressed="${L.locked}" title="ロック" aria-label="${esc(L.name)}をロック">${LOCK}</button>
      <span class="sw" style="background:${L.color}"></span>
      ${ui.renaming===L.id?`<input class="rn" id="layerName" value="${esc(L.name)}" maxlength="40" aria-label="レイヤー名">`:`<span class="nm" title="ダブルクリックで名前変更">${esc(L.name)}${L.id===state.active?'<span class="tag">描画先</span>':""}</span>`}
      <span class="end">${hasSel?`<button type="button" class="mv" data-act="moveto" title="選択中のものを「${esc(L.name)}」へ移動" aria-label="選択中のものを${esc(L.name)}へ移動">←</button>`:""}<span class="cnt">${c}</span></span></li>`}).join("")+
    `<li data-layer="__img"><button type="button" class="ib" data-act="imgvis" aria-pressed="${state.imgVisible}" title="下図の表示" aria-label="下図を表示">${EYE}</button><span class="ib" style="display:inline-flex;align-items:center;justify-content:center">${LOCK}</span><span class="sw" style="background:var(--line)"></span><span>下図</span><span class="cnt">${state.img?state.img.w+"×"+state.img.h:"なし"}</span></li>`;
  const ai=state.layers.findIndex(l=>l.id===state.active);
  $("lUp").disabled=ai<0||ai>=state.layers.length-1;$("lDown").disabled=ai<=0;
  if(ui.renaming){const inp=$("layerName");if(inp&&document.activeElement!==inp){inp.focus();inp.select()}}
  const selPaths=selObjs().filter(o=>o.kind==="path");const sel=selPaths.find(o=>o.id===ui.sel)||selPaths[0];const isPath=!!sel;
  const src=isPath?sel:layer(state.active);
  $("styleTitle").textContent=isPath?(selPaths.length>1?`線の設定（選択中の線 ${selPaths.length}本）`:"線の設定（選択中の線）"):`線の設定（「${layer(state.active).name}」に描く線）`;
  $("stUnit").value=state.widthUnit;if(document.activeElement!==$("stWidth"))$("stWidth").value=fmtW(src.width);$("stDash").value=src.dash;$("stFill").checked=!!src.fill;
  const so=selObjs(),np=so.filter(o=>o.kind==="path").length,nt=so.filter(o=>o.kind==="text").length,ns=so.filter(o=>o.kind==="scale").length;
  $("secSel").hidden=!so.length;
  if(so.length){
    const lnames=[...new Set(so.map(o=>o.layer))].map(id=>layer(id)?.name||"").join("・");
    $("selInfo").textContent=[np&&`線${np}本`,nt&&`文字${nt}個`,ns&&`スケール${ns}個`].filter(Boolean).join("・")+`を選択中（現在のレイヤー：${lnames}）`;
    $("mvLayer").innerHTML=`<option value="">移動先を選ぶ…</option>`+[...state.layers].reverse().map(l=>`<option value="${l.id}">${esc(l.name)}</option>`).join("");
    const sc=so.find(o=>o.kind==="scale");$("scaleEdit").hidden=!sc;
    if(sc){const ae=document.activeElement;
      if(ae!==$("scL0"))$("scL0").value=sc.l0??"0";if(ae!==$("scL1"))$("scL1").value=sc.l1??`${sc.cm}cm`;
      if(ae!==$("scSize"))$("scSize").value=sc.size||2.6;$("scLen").value=String(sc.cm)}
  }
  const tsel=so.filter(o=>o.kind==="text"),tsrc=tsel.find(o=>o.id===ui.sel)||tsel[0]||txt;
  $("txtTitle").textContent=tsel.length?`文字（選択中の文字 ${tsel.length}個）`:"文字（これから入力する文字）";
  if(document.activeElement!==$("txSize"))$("txSize").value=tsrc.size;$("txAlign").value=tsrc.align||"start";
  $("imgOp").value=Math.round(state.imgOpacity*100);$("imgOpV").textContent=Math.round(state.imgOpacity*100)+"%";
  $("imgVis").checked=state.imgVisible;$("imgRot").value=r2(state.imgRot);$("colorMode").checked=state.colorMode;$("exportColor").checked=state.exportColor;
  $("pxmm").value=r2(state.pxPerMm);$("dpi").textContent=Math.round(state.pxPerMm*25.4);
  $("denom").value=String(state.denom);
  $("atThr").value=at.thr;$("atThrV").textContent=at.thr;$("atPrev").checked=at.preview;$("atGrid").checked=at.grid;$("atClose").checked=at.close;
  $("atSmooth").value=at.smooth;$("atSmoothV").textContent=at.smooth.toFixed(2)+" mm";$("atMin").value=at.minLen;
}
function renderAll(){renderPanel();render()}

$("layerList").addEventListener("click",e=>{
  if(e.target.tagName==="INPUT")return;
  const li=e.target.closest("li");if(!li)return;const id=li.dataset.layer;const act=e.target.closest("[data-act]")?.dataset.act;
  if(id==="__img"){if(act==="imgvis"){state.imgVisible=!state.imgVisible;renderAll()}return}
  const L=layer(id);
  if(act==="moveto"){moveSelTo(id);return}
  if(act==="vis"){pushUndo();L.visible=!L.visible;if(!L.visible&&ui.sel&&obj(ui.sel)?.layer===id){clearSel()}}
  else if(act==="lock"){pushUndo();L.locked=!L.locked;if(L.locked&&ui.sel&&obj(ui.sel)?.layer===id){clearSel()}}
  else{if(id==="scale"){toast("スケールは「配置」ボタンで置きます");return}finishPath();state.active=id;clearSel()}
  renderAll();
});
function constrain(o,p){const dx=p.x-o.x,dy=p.y-o.y,a=Math.round(Math.atan2(dy,dx)/(Math.PI/4))*(Math.PI/4),l=dx*Math.cos(a)+dy*Math.sin(a);return{x:o.x+l*Math.cos(a),y:o.y+l*Math.sin(a)}}
function firstDrawable(){const l=[...state.layers].reverse().find(l=>l.id!=="scale");return l?l.id:null}
const NEW_COLORS=["#0f8a8a","#b8860b","#6d4c41","#c2185b","#455a64","#558b2f","#e65100"];
function startRename(id){finishPath();ui.renaming=id;renderPanel()}
function commitRename(save){
  const id=ui.renaming;if(!id)return;const inp=$("layerName");ui.renaming=null;
  const L=layer(id);const v=inp?inp.value.trim():"";
  if(save&&L&&v&&v!==L.name){pushUndo();L.name=v;toast(`レイヤー名を「${v}」にしました`)}
  renderAll();
}
$("layerList").addEventListener("dblclick",e=>{const li=e.target.closest("li");if(!li||li.dataset.layer==="__img"||e.target.closest("[data-act]"))return;startRename(li.dataset.layer)});
$("layerList").addEventListener("keydown",e=>{if(e.target.id!=="layerName")return;if(e.key==="Enter"){e.preventDefault();commitRename(true)}else if(e.key==="Escape"){e.preventDefault();commitRename(false)}});
$("layerList").addEventListener("focusout",e=>{if(e.target.id==="layerName"&&ui.renaming)commitRename(true)});
$("lRen").onclick=()=>{if(state.active)startRename(state.active)};
$("lAdd").onclick=()=>{
  finishPath();pushUndo();
  let n=1;while(state.layers.some(l=>l.name==="レイヤー "+n))n++;
  const col=NEW_COLORS[(state.layers.length)%NEW_COLORS.length];
  const L={id:"L"+uid(),name:"レイヤー "+n,color:col,width:0.15*PT,dash:"solid",fill:false,visible:true,locked:false};
  const i=state.layers.findIndex(l=>l.id===state.active);
  state.layers.splice(i<0?state.layers.length:i+1,0,L);
  state.active=L.id;clearSel();ui.renaming=L.id;renderAll();
};
function moveLayer(dir){
  const i=state.layers.findIndex(l=>l.id===state.active),j=i+dir;
  if(i<0||j<0||j>=state.layers.length)return;
  pushUndo();const [L]=state.layers.splice(i,1);state.layers.splice(j,0,L);renderAll();
}
$("lUp").onclick=()=>moveLayer(1);$("lDown").onclick=()=>moveLayer(-1);
let delArm=0;
$("lDel").onclick=()=>{
  const b=$("lDel"),L=layer(state.active);if(!L)return;
  if(state.layers.filter(l=>l.id!=="scale").length<=1){toast("描画用のレイヤーは最低1つ必要です");return}
  const cnt=state.objects.filter(o=>o.layer===L.id).length;
  if(cnt&&Date.now()-delArm>3000){delArm=Date.now();b.textContent=`もう一度押すと削除（線${cnt}本も消えます）`;b.classList.add("danger");
    setTimeout(()=>{b.textContent="削除";b.classList.remove("danger")},3000);return}
  delArm=0;b.textContent="削除";b.classList.remove("danger");
  finishPath();pushUndo();
  const i=state.layers.indexOf(L);
  state.layers.splice(i,1);state.objects=state.objects.filter(o=>o.layer!==L.id);
  if(ui.sel&&!obj(ui.sel)){clearSel()}
  const below=state.layers.slice(0,i).reverse().find(l=>l.id!=="scale");
  state.active=below?below.id:firstDrawable();
  renderAll();toast(`レイヤー「${L.name}」を削除しました（取り消しで戻せます）`);
};
let dragLayer=null;
const list=$("layerList");
list.addEventListener("dragstart",e=>{const li=e.target.closest&&e.target.closest("li");if(!li||li.dataset.layer==="__img"){e.preventDefault();return}
  dragLayer=li.dataset.layer;li.classList.add("dragging");e.dataTransfer.effectAllowed="move";try{e.dataTransfer.setData("text/plain",dragLayer)}catch(_){}});
const clearDrop=()=>list.querySelectorAll("li").forEach(x=>x.classList.remove("drop-before","drop-after","dragging"));
list.addEventListener("dragover",e=>{if(!dragLayer)return;const li=e.target.closest("li");if(!li||li.dataset.layer==="__img")return;e.preventDefault();e.stopPropagation();
  const r=li.getBoundingClientRect(),before=e.clientY<r.top+r.height/2;
  list.querySelectorAll("li").forEach(x=>x.classList.remove("drop-before","drop-after"));li.classList.add(before?"drop-before":"drop-after")});
list.addEventListener("drop",e=>{if(!dragLayer)return;e.preventDefault();e.stopPropagation();const li=e.target.closest("li");const src=dragLayer;dragLayer=null;clearDrop();
  if(!li||li.dataset.layer==="__img"||li.dataset.layer===src)return;
  const r=li.getBoundingClientRect(),before=e.clientY<r.top+r.height/2;
  const disp=[...state.layers].reverse().map(l=>l.id).filter(id=>id!==src);
  let k=disp.indexOf(li.dataset.layer);if(!before)k++;disp.splice(k,0,src);
  pushUndo();const map=Object.fromEntries(state.layers.map(l=>[l.id,l]));state.layers=disp.reverse().map(id=>map[id]);renderAll()});
list.addEventListener("dragend",()=>{dragLayer=null;clearDrop()});
function onStyle(prop,val){
  const ps=selObjs().filter(o=>o.kind==="path");
  if(ps.length){pushUndo();ps.forEach(o=>o[prop]=val)}else{layer(state.active)[prop]=val}
  renderAll();
}
const fmtW=mm=>state.widthUnit==="pt"?String(Math.round(mm/PT*1000)/1000):String(Math.round(mm*1000)/1000);
$("stWidth").addEventListener("change",e=>{const v=parseFloat(e.target.value);if(v>0)onStyle("width",state.widthUnit==="pt"?v*PT:v)});
$("stUnit").addEventListener("change",e=>{const u=e.target.value;if(document.activeElement===$("stWidth"))$("stWidth").blur();state.widthUnit=u;renderPanel()});
$("stDash").addEventListener("change",e=>onStyle("dash",e.target.value));
$("stFill").addEventListener("change",e=>onStyle("fill",e.target.checked));
$("imgOp").addEventListener("input",e=>{state.imgOpacity=e.target.value/100;$("imgOpV").textContent=e.target.value+"%";render()});
$("imgVis").addEventListener("change",e=>{state.imgVisible=e.target.checked;renderAll()});
$("colorMode").addEventListener("change",e=>{state.colorMode=e.target.checked;render()});
$("exportColor").addEventListener("change",e=>{state.exportColor=e.target.checked});
$("pxmm").addEventListener("change",e=>{const v=parseFloat(e.target.value);if(v>0){state.pxPerMm=v;state.sample=false;renderAll()}});
$("denom").addEventListener("change",e=>{state.denom=parseInt(e.target.value,10);renderAll()});
$("mApply").addEventListener("click",()=>{
  const [p,q]=ui.measure;const mm=parseFloat($("mMm").value);if(!p||!q||!(mm>0))return;
  state.pxPerMm=dist(p,q)/mm;ui.measure=[];$("measureBox").hidden=true;state.sample=false;
  renderAll();toast(`縮尺を ${r2(state.pxPerMm)} px/mm（約${Math.round(state.pxPerMm*25.4)} dpi）に設定しました`);
});

function rotateImg(delta,abs){
  if(!state.img){toast("先に下図を開いてください");return}
  pushUndo();
  let v=abs!=null?abs:state.imgRot+delta;v=((v%360)+540)%360-180;if(Math.abs(v+180)<1e-9)v=180;
  state.imgRot=Math.round(v*100)/100;renderAll();
  const msg=`下図を ${r2(state.imgRot)}° にしました`;
  toast(state.objects.length&&!state.sample?msg+"（描いた線は回転しません）":msg);
}
$("rotM90").onclick=()=>rotateImg(-90);$("rotP90").onclick=()=>rotateImg(90);
$("rotM").onclick=()=>rotateImg(-0.5);$("rotP").onclick=()=>rotateImg(0.5);
$("rotReset").onclick=()=>rotateImg(0,0);
$("btnLevel").onclick=()=>setTool(ui.tool==="level"?(ui.prevTool||"pen"):"level");
$("imgRot").addEventListener("change",e=>{const v=parseFloat(e.target.value);if(isFinite(v))rotateImg(0,v);else renderPanel()});

/* ---------- auto trace ---------- */
const at={thr:45,grid:true,close:true,smooth:0.25,minLen:1.5,preview:false};
let pixCache=null;
async function getPixels(){
  if(!state.img)return null;if(pixCache&&pixCache.src===state.img.src)return pixCache;
  const im=new Image();await new Promise((res,rej)=>{im.onload=res;im.onerror=rej;im.src=state.img.src});
  const c=document.createElement("canvas");c.width=state.img.w;c.height=state.img.h;
  const g=c.getContext("2d",{willReadFrequently:true});g.drawImage(im,0,0);
  pixCache={src:state.img.src,W:c.width,H:c.height,data:g.getImageData(0,0,c.width,c.height).data};return pixCache;
}
function rotPt(x,y,deg){const c=state.img,cx=c.w/2,cy=c.h/2,a=deg*Math.PI/180,co=Math.cos(a),si=Math.sin(a),dx=x-cx,dy=y-cy;return[cx+dx*co-dy*si,cy+dx*si+dy*co]}
const imgToWorld=(x,y)=>rotPt(x,y,state.imgRot),worldToImg=(x,y)=>rotPt(x,y,-state.imgRot);
function traceOpts(){const k=state.pxPerMm;return{grid:at.grid,thr:at.thr,close:at.close,minArea:Math.max(6,Math.round(0.4*k*k)),spur:1.0*k,minLen:at.minLen*k,eps:Math.max(0.3,at.smooth*k),joinDeg:40}}
const polyLen=s=>{let L=0;for(let i=1;i<s.length;i++)L+=Math.hypot(s[i][0]-s[i-1][0],s[i][1]-s[i-1][1]);return L};
function newPathFromPts(s,closed,L){
  let pts=s;if(closed&&pts.length>2&&Math.hypot(pts[0][0]-pts[pts.length-1][0],pts[0][1]-pts[pts.length-1][1])<0.5)pts=pts.slice(0,-1);
  return{id:uid(),kind:"path",layer:L.id,nodes:AutoTrace.toNodes(pts,closed,50),closed:closed&&pts.length>2,width:L.width,dash:L.dash,fill:L.fill}}
function autoReady(){
  if(!state.img){toast("先に下図を開いてください");return false}
  const L=layer(state.active);if(!L||!L.visible||L.locked){toast(`描画先「${L?L.name:""}」が非表示かロック中です`);return false}
  return true;
}
const tick=()=>new Promise(r=>setTimeout(r,20));
function busy(on){stage.classList.toggle("busy",on);$("hint").textContent=on?"処理中…":HINTS[ui.tool]}
async function traceRect(a,b){
  const x0=Math.min(a.x,b.x),x1=Math.max(a.x,b.x),y0=Math.min(a.y,b.y),y1=Math.max(a.y,b.y);
  if((x1-x0)*view.z<6||(y1-y0)*view.z<6){toast("ドラッグして範囲を囲んでください");return}
  busy(true);
  try{
    const P=await getPixels();await tick();
    const cs=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(([x,y])=>worldToImg(x,y));
    const ix0=Math.min(...cs.map(c=>c[0])),iy0=Math.min(...cs.map(c=>c[1])),ix1=Math.max(...cs.map(c=>c[0])),iy1=Math.max(...cs.map(c=>c[1]));
    const res=AutoTrace.run(P.data,P.W,P.H,ix0,iy0,ix1-ix0,iy1-iy0,traceOpts());
    const k=state.pxPerMm,eps=Math.max(0.3,at.smooth*k),L=layer(state.active),made=[];
    const inside=q=>q[0]>=x0&&q[0]<=x1&&q[1]>=y0&&q[1]<=y1;
    for(const c of res){
      const w=c.raw.map(q=>imgToWorld(q[0],q[1]));let pieces;
      if(!state.imgRot)pieces=[{pts:w,closed:c.closed}];
      else{pieces=[];let cur=[];for(const q of w){if(inside(q))cur.push(q);else{if(cur.length>1)pieces.push({pts:cur,closed:false});cur=[]}}
        if(cur.length>1)pieces.push({pts:cur,closed:c.closed&&cur.length===w.length})}
      for(const pc of pieces){const s=AutoTrace.rdp(pc.closed?pc.pts.concat([pc.pts[0]]):pc.pts,eps);
        if(s.length<2||polyLen(s)<at.minLen*k*(pc.closed?0.5:1))continue;made.push(newPathFromPts(s,pc.closed,L))}
    }
    if(!made.length){toast("範囲内に線が見つかりませんでした。「線の濃さ」を左へ動かすと薄い線も拾います");return}
    pushUndo();state.objects.push(...made);clearSel();renderAll();
    toast(`${made.length}本の線を「${L.name}」に作成しました（取り消しで一括で戻せます）`);
  }catch(err){toast("自動トレースに失敗しました："+(err&&err.message||err))}
  finally{busy(false)}
}
async function traceLine(p){
  busy(true);
  try{
    const P=await getPixels();await tick();
    const [qx,qy]=worldToImg(p.x,p.y);const tol=Math.max(3,10/view.z);
    let R=150,best=null;
    for(let it=0;it<7;it++){
      const res=AutoTrace.run(P.data,P.W,P.H,qx-R,qy-R,2*R,2*R,traceOpts());
      let bd=Infinity;best=null;
      for(const c of res)for(const q of c.raw){const d=Math.hypot(q[0]-qx,q[1]-qy);if(d<bd){bd=d;best=c}}
      if(!best||bd>tol){best=null;break}
      const bx0=Math.max(0,Math.floor(qx-R)),by0=Math.max(0,Math.floor(qy-R)),bx1=Math.min(P.W,Math.ceil(qx+R)),by1=Math.min(P.H,Math.ceil(qy+R));
      const ends=best.closed?[]:[best.raw[0],best.raw[best.raw.length-1]];
      const touches=ends.some(q=>(bx0>0&&q[0]-bx0<5)||(bx1<P.W&&bx1-q[0]<5)||(by0>0&&q[1]-by0<5)||(by1<P.H&&by1-q[1]<5));
      if(!touches||(bx0===0&&by0===0&&bx1===P.W&&by1===P.H))break;
      R*=2.2;
    }
    if(!best){toast("クリックした位置に鉛筆の線が見つかりません。線の真上をクリックするか、「線の濃さ」を左へ動かしてください");return}
    const w=best.raw.map(q=>imgToWorld(q[0],q[1]));
    const s=AutoTrace.rdp(best.closed?w.concat([w[0]]):w,Math.max(0.3,at.smooth*state.pxPerMm));
    if(s.length<2){toast("線が短すぎます");return}
    const o=newPathFromPts(s,best.closed,layer(state.active));
    pushUndo();state.objects.push(o);setSel([o.id]);ui.nodesSel=[];renderAll();
    toast(`線を1本作成しました（点${o.nodes.length}個${o.closed?"・閉じた線":""}）`);
  }catch(err){toast("自動トレースに失敗しました："+(err&&err.message||err))}
  finally{busy(false)}
}
let maskTimer;
function updateMask(){
  clearTimeout(maskTimer);
  maskTimer=setTimeout(async()=>{
    const mi=$("maskimg");
    if(!at.preview||!state.img){mi.style.display="none";return}
    try{
      const P=await getPixels();const m=AutoTrace.mask(P.data,P.W,P.H,0,0,P.W,P.H,traceOpts());
      const c=document.createElement("canvas");c.width=P.W;c.height=P.H;const g=c.getContext("2d");
      const id=g.createImageData(P.W,P.H),d=id.data;
      for(let i=0;i<m.length;i++)if(m[i]){const j=i*4;d[j]=225;d[j+1]=30;d[j+2]=30;d[j+3]=210}
      g.putImageData(id,0,0);
      mi.setAttribute("href",c.toDataURL("image/png"));mi.setAttribute("width",P.W);mi.setAttribute("height",P.H);
      mi.style.display=state.imgVisible?"":"none";render();
    }catch(err){mi.style.display="none"}
  },150);
}
$("atThr").addEventListener("input",e=>{at.thr=+e.target.value;$("atThrV").textContent=at.thr;updateMask()});
$("atPrev").addEventListener("change",e=>{at.preview=e.target.checked;updateMask()});
$("atGrid").addEventListener("change",e=>{at.grid=e.target.checked;updateMask()});
$("atClose").addEventListener("change",e=>{at.close=e.target.checked});
$("atSmooth").addEventListener("input",e=>{at.smooth=+e.target.value;$("atSmoothV").textContent=at.smooth.toFixed(2)+" mm"});
$("atMin").addEventListener("change",e=>{const v=parseFloat(e.target.value);if(v>=0)at.minLen=v});

/* ---------- move to layer ---------- */
function moveSelTo(id){
  const so=selObjs(),L=layer(id);if(!so.length||!L)return;
  if(so.every(o=>o.layer===id)){toast(`すでに「${L.name}」にあります`);return}
  pushUndo();so.forEach(o=>o.layer=id);
  let note="";if(!L.visible){L.visible=true;note="（非表示だったので表示しました）"}
  if(L.locked){clearSel();note="（ロック中のレイヤーなので選択を解除しました）"}
  renderAll();toast(`${so.length}個を「${L.name}」へ移動しました${note}`);
}
$("mvLayer").addEventListener("change",e=>{const v=e.target.value;if(v)moveSelTo(v)});

/* ---------- text ---------- */
const txt={size:3,align:"start"};
const ta=$("txed");
function ensureTextLayer(){
  let L=layer("text");
  if(!L){L={...LAYER_DEFS.find(l=>l.id==="text"),visible:true,locked:false};state.layers.push(L)}
  return L;
}
function sizeEditor(){
  const ls=ta.value.split("\n");let w=0;for(const l of ls){let c=0;for(const ch of l)c+=ch.charCodeAt(0)>0x2E7F?1:0.6;w=Math.max(w,c)}
  ta.rows=Math.max(1,ls.length);ta.style.width=(w+1.2)+"em";
}
function positionEditor(){
  if(!ui.editing){return}
  const o=obj(ui.editing);if(!o){ta.hidden=true;ui.editing=null;return}
  const fs=o.size*K()*view.z;
  ta.style.fontSize=fs+"px";ta.style.textAlign=o.align==="middle"?"center":o.align==="end"?"right":"left";
  ta.style.transform=o.align==="middle"?"translateX(-50%)":o.align==="end"?"translateX(-100%)":"none";
  const x=o.x*view.z+view.tx,y=o.y*view.z+view.ty;
  ta.style.left=(x-(o.align==="end"?-3:o.align==="middle"?0:3))+"px";ta.style.top=(y-fs*1.03-2)+"px";
  sizeEditor();
}
function startTextEdit(id,isNew){
  if(ui.editing)commitTextEdit();
  const o=obj(id);if(!o)return;
  ui.editing=id;ui.editNew=isNew;setSel([id]);
  ta.value=o.text||"";ta.hidden=false;positionEditor();render();renderPanel();
  setTimeout(()=>{ta.focus();const n=ta.value.length;ta.setSelectionRange(n,n)},0);
}
function commitTextEdit(){
  const id=ui.editing;if(!id)return;
  const o=obj(id),v=ta.value.replace(/[ \t\n]+$/,"");
  ui.editing=null;ta.hidden=true;
  if(document.activeElement===ta)ta.blur();
  if(o){
    if(!v.trim()){
      if(ui.editNew){state.objects=state.objects.filter(x=>x!==o);undoStack.pop()}
      else{pushUndo();state.objects=state.objects.filter(x=>x!==o)}
      clearSel();
    }else if(v!==o.text){if(!ui.editNew)pushUndo();o.text=v;setSel([o.id])}
  }
  ui.editNew=false;renderAll();
}
function createText(p){
  pushUndo();
  const L=ensureTextLayer();
  if(!L.visible||L.locked){undoStack.pop();toast(`「${L.name}」レイヤーが非表示かロック中です`);renderAll();return}
  const o={id:uid(),kind:"text",layer:L.id,x:p.x,y:p.y,text:"",size:txt.size,align:txt.align};
  state.objects.push(o);startTextEdit(o.id,true);
}
ta.addEventListener("input",sizeEditor);
ta.addEventListener("keydown",e=>{
  if(e.key==="Escape"||(e.key==="Enter"&&(e.ctrlKey||e.metaKey))){e.preventDefault();commitTextEdit()}
  e.stopPropagation();
});
ta.addEventListener("blur",()=>{if(ui.editing)commitTextEdit()});
ta.addEventListener("pointerdown",e=>e.stopPropagation());
$("txSize").addEventListener("change",e=>{const v=parseFloat(e.target.value);if(!(v>0))return;
  const ts=selObjs().filter(o=>o.kind==="text");if(ts.length){pushUndo();ts.forEach(o=>o.size=v)}else txt.size=v;renderAll()});
$("txAlign").addEventListener("change",e=>{const v=e.target.value;
  const ts=selObjs().filter(o=>o.kind==="text");if(ts.length){pushUndo();ts.forEach(o=>o.align=v)}else txt.align=v;renderAll()});
// スケールの文字
let scPre=null;
for(const id of ["scL0","scL1","scSize"]){
  $(id).addEventListener("focus",()=>{scPre=snap()});
  $(id).addEventListener("input",e=>{
    const scs=selObjs().filter(o=>o.kind==="scale");if(!scs.length)return;
    if(id==="scSize"){const v=parseFloat(e.target.value);if(!(v>0))return;scs.forEach(o=>o.size=v)}
    else scs.forEach(o=>o[id==="scL0"?"l0":"l1"]=e.target.value);
    render();
  });
  $(id).addEventListener("change",()=>{if(scPre&&scPre!==snap()){undoStack.push(scPre);redoStack=[];renderAll()}scPre=snap()});
  $(id).addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();e.target.blur()}});
}
$("scLen").addEventListener("change",e=>{
  const cm=parseInt(e.target.value,10);const scs=selObjs().filter(o=>o.kind==="scale");if(!scs.length)return;pushUndo();
  scs.forEach(o=>{if(o.l1===undefined||o.l1===`${o.cm}cm`)delete o.l1;o.cm=cm});renderAll();
});

/* ---------- undo ---------- */
const snap=()=>JSON.stringify({objects:state.objects,layers:state.layers,imgRot:state.imgRot});
function pushUndo(){undoStack.push(snap());if(undoStack.length>300)undoStack.shift();redoStack=[];}
function restore(s){const d=JSON.parse(s);state.objects=d.objects;state.layers=d.layers;state.imgRot=d.imgRot||0;if(!layer(state.active))state.active=firstDrawable();
  if(ui.drawing&&!obj(ui.drawing))ui.drawing=null;if(ui.sel&&!obj(ui.sel))clearSel();renderAll()}
function undo(){if(!undoStack.length)return;redoStack.push(snap());restore(undoStack.pop())}
function redo(){if(!redoStack.length)return;undoStack.push(snap());restore(redoStack.pop())}
$("btnUndo").onclick=undo;$("btnRedo").onclick=redo;

/* ---------- tools ---------- */
const HINTS={
  pen:"Shift：水平・垂直・45°　クリック：角の点　ドラッグ：曲線の点（Altで片側だけ）　始点をクリック：閉じる　Enter／ダブルクリック：終了　Backspace：1点戻す",
  direct:"点をクリック：選択　Shift＋クリック：点を追加・解除　空いた所をドラッグ：囲んだ点を選択　点をドラッグ：まとめて移動（Shiftで水平・垂直・45°）　ハンドル：曲がり具合（Altで片側だけ）　Alt＋点：角⇄曲線　端点を別の線の端点に重ねる：連結　線をダブルクリック：点を追加　Delete：点を削除",
  select:"クリック：選択　Shift＋クリック：追加・解除　空いた所をドラッグ：囲んで選択　Ctrl+A：すべて選択　Ctrl+J：連結　ドラッグ：移動（Shiftで水平・垂直、端を重ねると連結）　ダブルクリック：文字・スケールの文字を修正　矢印キー：微調整　Delete：削除",
  text:"クリック：文字を入力（Enterで改行、Esc／別の場所をクリックで確定）　入力済みの文字をクリック：修正　入力先は「文字」レイヤー",
  hand:"ドラッグ：表示位置を移動（他のツールでもスペースキーを押しながらドラッグで移動）　ホイール：拡大縮小",
  autoRect:"ドラッグで範囲を囲む → 範囲内の鉛筆線をまとめて「描画先」レイヤーに線として作成　結果はダイレクト選択（A）で修正",
  autoLine:"鉛筆の線をクリック → その1本をたどって線を作成（交差では直進する方へ進む）　結果はダイレクト選択（A）で修正",
  level:"水平（または垂直）にしたい線の上で、離れた2点をクリック（方眼線や口縁の線など）",
  measure:"下図の方眼で離れた2点をクリック → 右の欄に実寸（mm）を入れて「適用」",
};
function setTool(t){
  if(ui.editing)commitTextEdit();
  if(t!=="pen")finishPath();
  if(t==="level"&&ui.tool!=="level")ui.prevTool=ui.tool;
  ui.tool=t;stage.dataset.tool=t;
  document.querySelectorAll(".tools [data-tool]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.tool===t)));
  if(t!=="measure"&&t!=="level"){ui.measure=[]}if(t!=="measure")$("measureBox").hidden=true;
  if(t==="level"){if(!state.img){toast("先に下図を開いてください");t=ui.prevTool||"pen";ui.tool=t;stage.dataset.tool=t}ui.measure=[]}
  $("btnLevel").setAttribute("aria-pressed",String(ui.tool==="level"));
  if(t!=="direct")ui.nodesSel=[];
  $("hint").textContent=HINTS[t];render();
}
document.querySelectorAll(".tools [data-tool]").forEach(b=>b.addEventListener("click",()=>setTool(b.dataset.tool)));

function finishPath(){
  if(!ui.drawing)return;const o=obj(ui.drawing);ui.drawing=null;
  if(o&&o.nodes.length<2){state.objects=state.objects.filter(x=>x!==o);clearSel()}
  renderAll();
}
function placeScale(){
  const L=layer("scale");L.visible=true;L.locked=false;
  const cm=parseInt($("scaleCm").value,10);
  const r=svg.getBoundingClientRect();
  const c={x:(r.width/2-view.tx)/view.z,y:(r.height*0.8-view.ty)/view.z};
  pushUndo();finishPath();
  const o={id:uid(),kind:"scale",layer:"scale",x:c.x-cm*5*state.pxPerMm,y:c.y,cm};
  state.objects.push(o);setSel([o.id]);setTool("select");renderAll();toast(`${cm}cm のスケールを配置しました。選択ツールで移動できます`);
}
$("btnScale").onclick=placeScale;$("btnScale2").onclick=placeScale;

/* ---------- pointer ---------- */
function toWorld(e){const r=svg.getBoundingClientRect();return{x:(e.clientX-r.left-view.tx)/view.z,y:(e.clientY-r.top-view.ty)/view.z}}
svg.addEventListener("pointerdown",e=>{
  const p=toWorld(e);
  if(ui.editing)commitTextEdit();
  if(e.button===1||ui.tool==="hand"||ui.space){
    ui.drag={type:"pan",sx:e.clientX,sy:e.clientY,tx:view.tx,ty:view.ty};stage.classList.add("grabbing");
    svg.setPointerCapture(e.pointerId);e.preventDefault();return;
  }
  if(e.button!==0)return;
  svg.setPointerCapture(e.pointerId);
  const t=e.target;const hit=t.closest&&t.closest("[data-id]");
  if(ui.tool==="pen"){penDown(p,e)}
  else if(ui.tool==="select"){
    if(hit){const id=hit.dataset.id;let toggleOff=null;
      if(e.shiftKey){if(ui.multi.includes(id))toggleOff=id;else setSel([...ui.multi,id])}
      else if(!ui.multi.includes(id))setSel([id]);
      else ui.sel=id;
      ui.nodesSel=[];pushUndo();
      ui.drag={type:"move",start:p,orig:ui.multi.map(x=>JSON.parse(JSON.stringify(obj(x)))),moved:false,toggleOff};
    }else{
      if(!e.shiftKey)clearSel();
      ui.drag={type:"marquee",mode:"obj",start:p,cur:p,add:e.shiftKey,base:[...ui.multi]};
    }
    renderPanel();
  }
  else if(ui.tool==="direct"){
    const oid=t.dataset&&t.dataset.oid,o=oid&&obj(oid);
    if(o&&t.dataset.h!=null){const i=+t.dataset.node;pushUndo();ui.sel=o.id;ui.drag={type:"handle",oid:o.id,i,which:t.dataset.h,moved:false}}
    else if(o&&t.dataset.node!=null){const i=+t.dataset.node;ui.sel=o.id;
      if(e.altKey){pushUndo();ui.nodesSel=[{id:o.id,i}];ui.drag={type:"pull",oid:o.id,i,start:p,moved:false}}
      else{let toggleOff=null;
        if(e.shiftKey){if(nodeSel(o.id,i))toggleOff={id:o.id,i};else ui.nodesSel=[...ui.nodesSel,{id:o.id,i}]}
        else if(!nodeSel(o.id,i))ui.nodesSel=[{id:o.id,i}];
        pushUndo();
        ui.drag={type:"nodes",start:p,orig:ui.nodesSel.map(q=>({id:q.id,i:q.i,n:JSON.parse(JSON.stringify(obj(q.id).nodes[q.i]))})),moved:false,toggleOff};
      }
    }
    else if(hit){const h=obj(hit.dataset.id);
      if(e.shiftKey){if(!ui.multi.includes(h.id))setSel([...ui.multi,h.id]);else ui.sel=h.id}
      else{if(!ui.multi.includes(h.id))setSel([h.id]);else ui.sel=h.id;ui.nodesSel=[]}
      if(h.kind!=="path"){pushUndo();ui.drag={type:"move",start:p,orig:[JSON.parse(JSON.stringify(h))],moved:false,toggleOff:null}}
    }
    else{
      if(!e.shiftKey)clearSel();
      ui.drag={type:"marquee",mode:"node",start:p,cur:p,add:e.shiftKey,base:[...ui.multi],baseNodes:[...ui.nodesSel]};
    }
    renderPanel();
  }
  else if(ui.tool==="text"){
    const ho=hit&&obj(hit.dataset.id);
    if(ho&&ho.kind==="text")startTextEdit(ho.id,false);else createText(p);
  }
  else if(ui.tool==="autoRect"){if(autoReady())ui.drag={type:"rect",start:p,cur:p}}
  else if(ui.tool==="autoLine"){if(autoReady())traceLine(p)}
  else if(ui.tool==="level"){
    if(ui.measure.length>=2)ui.measure=[];
    ui.measure.push(p);
    if(ui.measure.length===2){
      const [a,b]=ui.measure;let ang=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;
      while(ang>90)ang-=180;while(ang<=-90)ang+=180;
      if(ang>45)ang-=90;else if(ang<-45)ang+=90;
      ui.measure=[];
      if(dist(a,b)*view.z<10){toast("2点が近すぎます。離れた2点をクリックしてください");}
      else{rotateImg(-ang);setTool(ui.prevTool||"pen");}
    }
  }
  else if(ui.tool==="measure"){
    if(ui.measure.length>=2)ui.measure=[];
    ui.measure.push(p);
    if(ui.measure.length===2){$("measureBox").hidden=false;$("mPx").textContent=r2(dist(ui.measure[0],ui.measure[1]));$("mMm").focus();$("mMm").select()}
    else $("measureBox").hidden=true;
  }
  render();
});
function penDown(p,e){
  const L=layer(state.active);
  if(!L.visible||L.locked){toast(`「${L.name}」レイヤーが非表示かロック中です`);return}
  let o=ui.drawing&&obj(ui.drawing);
  if(o&&o.nodes.length>=2&&dist(p,o.nodes[0])*view.z<9){pushUndo();o.closed=true;finishPath();setSel([o.id]);renderAll();return}
  if(e.shiftKey&&o&&o.nodes.length)p=constrain(o.nodes[o.nodes.length-1],p);
  pushUndo();
  if(!o){o={id:uid(),kind:"path",layer:L.id,nodes:[],closed:false,width:L.width,dash:L.dash,fill:L.fill};state.objects.push(o);ui.drawing=o.id;setSel([o.id]);}
  o.nodes.push({x:p.x,y:p.y,hi:null,ho:null,smooth:false});
  ui.drag={type:"penhandle",i:o.nodes.length-1,start:p,moved:true};
  renderPanel();
}
window.addEventListener("pointermove",e=>{
  const r=svg.getBoundingClientRect();
  const inside=e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;
  let p=toWorld(e);
  if(inside||ui.drag){ui.cursor=p;$("coords").textContent=`X ${(p.x/state.pxPerMm).toFixed(1)} mm　Y ${(p.y/state.pxPerMm).toFixed(1)} mm（実寸）`}
  if(ui.shift!==e.shiftKey)ui.shift=e.shiftKey;
  const d=ui.drag;if(!d){if(ui.drawing||ui.tool==="measure"||ui.tool==="level")render();return}
  if(d.type==="pan"){view.tx=d.tx+e.clientX-d.sx;view.ty=d.ty+e.clientY-d.sy;render();return}
  if(d.type==="rect"||d.type==="marquee"){d.cur=p;render();return}
  const thr=3/view.z;
  const sh=(g,dx,dy)=>({...g,x:g.x+dx,y:g.y+dy,hi:g.hi&&{x:g.hi.x+dx,y:g.hi.y+dy},ho:g.ho&&{x:g.ho.x+dx,y:g.ho.y+dy}});
  if(d.type==="move"){
    if(e.shiftKey)p=constrain(d.start,p);
    const dx=p.x-d.start.x,dy=p.y-d.start.y;if(Math.hypot(dx,dy)>thr*0.5)d.moved=true;
    let ddx=dx,ddy=dy;d.join=null;
    if(d.orig.length===1&&d.orig[0].kind==="path"&&!d.orig[0].closed&&!e.altKey){
      const g=d.orig[0],ends=[[0,g.nodes[0]],[1,g.nodes[g.nodes.length-1]]];let best=null;
      for(const [end,n] of ends){const q={x:n.x+dx,y:n.y+dy};const t=nearestEnd(q,g.id,null);if(t&&(!best||t.d<best.t.d))best={end,n,t}}
      if(best){ddx=best.t.p.x-best.n.x;ddy=best.t.p.y-best.n.y;d.join={aId:g.id,aEnd:best.end,bId:best.t.o.id,bEnd:best.t.end,at:best.t.p}}
    }
    for(const g of d.orig){const o=obj(g.id);if(!o)continue;
      if(o.kind!=="path"){o.x=g.x+ddx;o.y=g.y+ddy}else o.nodes=g.nodes.map(n=>sh(n,ddx,ddy))}
    render();return;
  }
  if(d.type==="nodes"){
    if(e.shiftKey)p=constrain(d.start,p);
    const dx=p.x-d.start.x,dy=p.y-d.start.y;if(Math.hypot(dx,dy)>thr*0.5)d.moved=true;
    let ddx=dx,ddy=dy;d.join=null;
    if(d.orig.length===1&&!e.altKey){const q=d.orig[0],o=obj(q.id);
      if(o&&o.kind==="path"&&!o.closed&&o.nodes.length>=2&&(q.i===0||q.i===o.nodes.length-1)){
        const end=q.i===0?0:1,np={x:q.n.x+dx,y:q.n.y+dy};
        const t=nearestEnd(np,o.id,o.nodes.length>=3?end:null);
        if(t){ddx=t.p.x-q.n.x;ddy=t.p.y-q.n.y;d.join={aId:o.id,aEnd:end,bId:t.o.id,bEnd:t.end,at:t.p}}}}
    for(const q of d.orig){const o=obj(q.id);if(o&&o.nodes[q.i])o.nodes[q.i]=sh(q.n,ddx,ddy)}
    render();return;
  }
  const o=obj(d.oid||ui.sel);if(!o)return;
  if(e.shiftKey&&(d.type==="penhandle"||d.type==="handle"||d.type==="pull")){const n=o.nodes[d.i];if(n)p=constrain(n,p)}
  if(d.type==="penhandle"){
    const n=o.nodes[d.i];if(!n)return;
    if(dist(p,d.start)>thr||n.ho){n.ho={x:p.x,y:p.y};if(!e.altKey){n.hi={x:2*n.x-p.x,y:2*n.y-p.y};n.smooth=true}else n.smooth=false}
  }else if(d.type==="handle"){
    d.moved=true;const n=o.nodes[d.i];const key=d.which==="in"?"hi":"ho",oth=d.which==="in"?"ho":"hi";
    n[key]={x:p.x,y:p.y};if(e.altKey)n.smooth=false;
    if(n.smooth&&n[oth]){const len=dist(n[oth],n),dx=n.x-p.x,dy=n.y-p.y,l=Math.hypot(dx,dy)||1;n[oth]={x:n.x+dx/l*len,y:n.y+dy/l*len}}
  }else if(d.type==="pull"){
    const n=o.nodes[d.i];if(dist(p,d.start)>thr){d.moved=true;n.ho={x:p.x,y:p.y};n.hi={x:2*n.x-p.x,y:2*n.y-p.y};n.smooth=true}
  }
  render();
});
window.addEventListener("pointerup",e=>{
  const d=ui.drag;if(!d)return;ui.drag=null;stage.classList.remove("grabbing");
  if(d.type==="rect"){render();traceRect(d.start,d.cur);return}
  if(d.type==="marquee"){finishMarquee(d);renderAll();return}
  if(d.type==="pull"&&!d.moved){const o=obj(d.oid);const n=o&&o.nodes[d.i];if(n){if(n.hi||n.ho){n.hi=null;n.ho=null;n.smooth=false;d.moved=true}}}
  if((d.type==="move"||d.type==="nodes")&&d.moved&&d.join){
    const a=obj(d.join.aId),b=obj(d.join.bId);
    if(a&&b){const r=joinPaths(a,d.join.aEnd,b,d.join.bEnd,0.01);setSel([r.id]);ui.nodesSel=[];
      toast(a===b?"線を閉じました":"2本の線を1本に連結しました")}
    renderAll();return;
  }
  if(d.type==="move"&&!d.moved&&d.toggleOff)setSel(ui.multi.filter(x=>x!==d.toggleOff));
  if(d.type==="nodes"&&!d.moved&&d.toggleOff)ui.nodesSel=ui.nodesSel.filter(q=>!(q.id===d.toggleOff.id&&q.i===d.toggleOff.i));
  if(["move","nodes","handle","pull"].includes(d.type)&&!d.moved)undoStack.pop();
  renderAll();
});
svg.addEventListener("dblclick",e=>{
  if(ui.tool==="pen"&&ui.drawing){
    const o=obj(ui.drawing);
    if(o&&o.nodes.length>=2){const a=o.nodes[o.nodes.length-1],b=o.nodes[o.nodes.length-2];if(dist(a,b)*view.z<6){o.nodes.pop();if(!b.ho&&a.ho){b.ho=a.ho;b.hi=a.hi}undoStack.pop()}}
    finishPath();return;
  }
  if(ui.tool==="select"||ui.tool==="direct"){
    const el=document.elementFromPoint(e.clientX,e.clientY);const hit=el&&el.closest&&el.closest("[data-id]");
    const o=hit&&obj(hit.dataset.id);
    if(o&&o.kind==="text"){startTextEdit(o.id,false);return}
    if(o&&o.kind==="scale"){setSel([o.id]);renderAll();setTimeout(()=>{const i=$("scL1");i.focus();i.select()},0);return}
  }
  if(ui.tool==="direct"){
    const el=document.elementFromPoint(e.clientX,e.clientY);const hit=el&&el.closest&&el.closest("[data-id]");
    if(!hit)return;const o=obj(hit.dataset.id);if(!o||o.kind!=="path")return;
    insertNode(o,toWorld(e));
  }
});
function cubic(P0,P1,P2,P3,t){const u=1-t;return{x:u*u*u*P0.x+3*u*u*t*P1.x+3*u*t*t*P2.x+t*t*t*P3.x,y:u*u*u*P0.y+3*u*u*t*P1.y+3*u*t*t*P2.y+t*t*t*P3.y}}
function insertNode(o,p){
  const n=o.nodes,segs=o.closed?n.length:n.length-1;let best={d:Infinity};
  for(let s=0;s<segs;s++){const a=n[s],b=n[(s+1)%n.length];
    for(let k=1;k<40;k++){const t=k/40,q=cubic(a,a.ho||a,b.hi||b,b,t),dd=dist(q,p);if(dd<best.d)best={d:dd,s,t}}}
  if(best.d*view.z>14)return;
  pushUndo();
  const a=n[best.s],b=n[(best.s+1)%n.length],t=best.t;
  const P1=a.ho||a,P2=b.hi||b;
  const A=lerp(a,P1,t),B=lerp(P1,P2,t),C=lerp(P2,b,t),D=lerp(A,B,t),E=lerp(B,C,t),F=lerp(D,E,t);
  let nn;
  if(a.ho||b.hi){if(a.ho)a.ho=A;if(b.hi)b.hi=C;nn={x:F.x,y:F.y,hi:D,ho:E,smooth:true}}
  else nn={x:F.x,y:F.y,hi:null,ho:null,smooth:false};
  n.splice(best.s+1,0,nn);if(!ui.multi.includes(o.id))setSel([...ui.multi,o.id]);ui.sel=o.id;ui.nodesSel=[{id:o.id,i:best.s+1}];renderAll();
}
svg.addEventListener("wheel",e=>{e.preventDefault();const r=svg.getBoundingClientRect();zoomAt(Math.exp(-e.deltaY*0.0015),e.clientX-r.left,e.clientY-r.top)},{passive:false});
function zoomAt(f,cx,cy){const z=Math.min(40,Math.max(0.05,view.z*f));const wx=(cx-view.tx)/view.z,wy=(cy-view.ty)/view.z;view.z=z;view.tx=cx-wx*z;view.ty=cy-wy*z;render()}
function zoomCenter(f){const r=svg.getBoundingClientRect();zoomAt(f,r.width/2,r.height/2)}
function fit(){
  const r=svg.getBoundingClientRect();let b;
  if(state.img){const W=state.img.w,H=state.img.h,a=state.imgRot*Math.PI/180,c=Math.abs(Math.cos(a)),s=Math.abs(Math.sin(a)),bw=W*c+H*s,bh=W*s+H*c;b={x:W/2-bw/2,y:H/2-bh/2,w:bw,h:bh}}
  else{const bb=content.getBBox();b=bb.width?{x:bb.x,y:bb.y,w:bb.width,h:bb.height}:{x:0,y:0,w:1000,h:1400}}
  const z=Math.min(r.width/b.w,r.height/b.h)*0.94;view.z=z;view.tx=(r.width-b.w*z)/2-b.x*z;view.ty=(r.height-b.h*z)/2-b.y*z;render();
}
$("zIn").onclick=()=>zoomCenter(1.25);$("zOut").onclick=()=>zoomCenter(0.8);$("zFit").onclick=fit;

/* ---------- keyboard ---------- */
window.addEventListener("keydown",e=>{
  if(e.key==="Shift"&&!ui.shift){ui.shift=true;render()}
  if(e.target.matches&&e.target.matches("input,select,textarea"))return;
  const k=e.key.toLowerCase(),mod=e.ctrlKey||e.metaKey;
  if(mod&&k==="z"){e.preventDefault();e.shiftKey?redo():undo();return}
  if(mod&&k==="y"){e.preventDefault();redo();return}
  if(mod&&k==="s"){e.preventDefault();saveProject();return}
  if(mod&&k==="j"){e.preventDefault();joinCommand();return}
  if(mod&&k==="a"){e.preventDefault();finishPath();setSel(selectable().map(o=>o.id));if(ui.tool!=="select"&&ui.tool!=="direct")setTool("select");renderAll();return}
  if(mod&&(k==="="||k==="+"||k===";")){e.preventDefault();zoomCenter(1.25);return}
  if(mod&&k==="-"){e.preventDefault();zoomCenter(0.8);return}
  if(mod&&k==="0"){e.preventDefault();fit();return}
  if(mod)return;
  if(e.code==="Space"){e.preventDefault();if(!ui.space){ui.space=true;stage.classList.add("panning")}return}
  if(k==="enter"||k==="escape"){if(ui.drawing)finishPath();else if(k==="escape"){clearSel();ui.measure=[];$("measureBox").hidden=true;renderAll()}return}
  if(k==="delete"||k==="backspace"){e.preventDefault();delAction();return}
  const arrows={arrowleft:[-1,0],arrowright:[1,0],arrowup:[0,-1],arrowdown:[0,1]};
  if(arrows[k]&&ui.multi.length){e.preventDefault();const s=e.shiftKey?10:1,[dx,dy]=arrows[k].map(v=>v*s/view.z);pushUndo();
    const mv=n=>{n.x+=dx;n.y+=dy;if(n.hi){n.hi.x+=dx;n.hi.y+=dy}if(n.ho){n.ho.x+=dx;n.ho.y+=dy}};
    if(ui.tool==="direct"&&ui.nodesSel.length){for(const q of ui.nodesSel){const o=obj(q.id);if(o&&o.nodes[q.i])mv(o.nodes[q.i])}}
    else for(const o of selObjs()){if(o.kind!=="path"){o.x+=dx;o.y+=dy}else o.nodes.forEach(mv)}
    render();return}

  const map={v:"select",a:"direct",p:"pen",h:"hand",m:"measure",t:"text",r:"autoRect",l:"autoLine"};if(map[k])setTool(map[k]);
});
window.addEventListener("keyup",e=>{if(e.key==="Shift"){ui.shift=false;render()}if(e.code==="Space"){ui.space=false;stage.classList.remove("panning")}});
function delAction(){
  if(ui.drawing){const o=obj(ui.drawing);pushUndo();o.nodes.pop();if(!o.nodes.length){state.objects=state.objects.filter(x=>x!==o);ui.drawing=null;clearSel()}renderAll();return}
  if(!ui.multi.length)return;pushUndo();
  if(ui.tool==="direct"&&ui.nodesSel.length){
    const by={};for(const q of ui.nodesSel)(by[q.id]=by[q.id]||[]).push(q.i);
    let removed=0;
    for(const id in by){const o=obj(id);if(!o||o.kind!=="path")continue;const rm=new Set(by[id]);o.nodes=o.nodes.filter((_,i)=>!rm.has(i));removed+=rm.size;
      if(o.nodes.length<2)state.objects=state.objects.filter(x=>x!==o);else if(o.closed&&o.nodes.length<3)o.closed=false}
    ui.nodesSel=[];pruneSel();toast(`点を${removed}個削除しました`);
  }else{const ids=new Set(ui.multi);const c=ids.size;state.objects=state.objects.filter(o=>!ids.has(o.id));clearSel();toast(`${c}本を削除しました`)}
  renderAll();
}

/* ---------- files ---------- */
async function saveFile(name,text,mime){
  try{
    if(window.claude&&typeof window.claude.use==="function"){
      const dl=await window.claude.use("downloads");
      if(dl){await dl.save({filename:name,data:text});toast(`${name} を保存しました`);return}
    }
  }catch(err){if(err&&err.code==="declined"){toast("保存を取り消しました");return}toast("この画面では保存できませんでした："+(err&&err.message||""));return}
  const blob=new Blob([text],{type:mime});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),3000);toast(`${name} を保存しました`);
}
const stamp=()=>{const d=new Date(),p=v=>String(v).padStart(2,"0");return`${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`};
function exportSVG(){
  if(ui.editing)commitTextEdit();finishPath();
  const vis=state.layers.filter(L=>L.visible);
  const items=state.objects.filter(o=>vis.some(L=>L.id===o.layer));
  if(!items.length){toast("書き出す線がありません");return}
  const bb=content.getBBox();const k=K(),m=3*k;
  const x=bb.x-m,y=bb.y-m,w=bb.width+2*m,h=bb.height+2*m;
  let s=`<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${r2(w/k)}mm" height="${r2(h/k)}mm" viewBox="${r2(x)} ${r2(y)} ${r2(w)} ${r2(h)}">\n`;
  s+=`<!-- 土器実測図トレース 書き出し / 仕上がり縮尺 1/${state.denom} / 下図 ${r2(state.pxPerMm)} px/mm -->\n`;
  const used=new Set();const gid=name=>{let b=String(name).trim().replace(/[\s"'<>&#]+/g,"_")||"layer";if(!/^[A-Za-z_\u00C0-\uFFFF]/.test(b))b="L_"+b;let g=b,i=2;while(used.has(g))g=b+"_"+i++;used.add(g);return g};
  for(const L of vis){const its=items.filter(o=>o.layer===L.id);if(!its.length)continue;
    s+=`<g id="${esc(gid(L.name))}" data-name="${esc(L.name)}">\n`+its.map(o=>objMarkup(o,true)).join("\n")+`\n</g>\n`}
  s+=`</svg>\n`;
  saveFile(`${state.name}_${stamp()}.svg`,s,"image/svg+xml");
}
function saveProject(){
  if(ui.editing)commitTextEdit();finishPath();
  const data={app:"土器実測図トレース",version:1,pxPerMm:state.pxPerMm,denom:state.denom,imgOpacity:state.imgOpacity,imgRot:state.imgRot,widthUnit:state.widthUnit,exportColor:state.exportColor,
    layers:state.layers,objects:state.objects,active:state.active,name:state.name,img:state.img};
  saveFile(`${state.name}_${stamp()}.json`,JSON.stringify(data),"application/json");
}
$("btnExport").onclick=exportSVG;$("btnSave").onclick=saveProject;

function readDpi(buf){
  const b=new Uint8Array(buf);
  if(b[0]===0xFF&&b[1]===0xD8){let i=2;while(i<b.length-10){if(b[i]!==0xFF)break;const mk=b[i+1],len=(b[i+2]<<8)|b[i+3];
      if(mk===0xE0&&b[i+4]===0x4A&&b[i+5]===0x46){const u=b[i+11],xd=(b[i+12]<<8)|b[i+13];if(u===1&&xd>1)return xd;if(u===2&&xd>1)return xd*2.54;return null}
      i+=2+len}return null}
  if(b[0]===0x89&&b[1]===0x50){let i=8;while(i<b.length-12){const len=(b[i]<<24|b[i+1]<<16|b[i+2]<<8|b[i+3])>>>0,ty=String.fromCharCode(b[i+4],b[i+5],b[i+6],b[i+7]);
      if(ty==="pHYs"){const ppu=(b[i+8]<<24|b[i+9]<<16|b[i+10]<<8|b[i+11])>>>0;if(b[i+16]===1&&ppu>0)return ppu*0.0254;return null}if(ty==="IDAT")return null;i+=12+len}}
  return null;
}
async function loadImageFile(f){
  const buf=await f.arrayBuffer();const dpi=readDpi(buf);
  const src=await new Promise((res,rej)=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.onerror=rej;fr.readAsDataURL(f)});
  const im=new Image();await new Promise((res,rej)=>{im.onload=res;im.onerror=rej;im.src=src});
  const hadSample=state.sample;
  if(hadSample){state.objects=[];state.sample=false;undoStack=[];redoStack=[]}
  clearSel();ui.drawing=null;
  state.img={src,w:im.naturalWidth,h:im.naturalHeight};state.imgRot=0;state.name=f.name.replace(/\.[^.]+$/,"")||"trace";
  if(dpi){state.pxPerMm=dpi/25.4;toast(`解像度 ${Math.round(dpi)} dpi を画像から読み取りました。方眼で目盛合わせすると確実です`)}
  else toast("画像に解像度の情報がありません。目盛合わせ（M）で縮尺を設定してください");
  renderAll();requestAnimationFrame(fit);updateMask();
}
async function loadProjectFile(f){
  try{const d=JSON.parse(await f.text());if(!Array.isArray(d.objects))throw 0;
    Object.assign(state,{pxPerMm:d.pxPerMm||state.pxPerMm,denom:d.denom||3,imgOpacity:d.imgOpacity??0.5,imgRot:d.imgRot||0,widthUnit:d.widthUnit||"pt",exportColor:d.exportColor??false,layers:d.layers||freshLayers(),objects:d.objects,active:d.active||"outline",name:d.name||"trace",img:d.img||null,sample:false});
    clearSel();ui.drawing=null;undoStack=[];redoStack=[];ensureTextLayer();renderAll();requestAnimationFrame(fit);updateMask();toast("作業ファイルを開きました");
  }catch(err){toast("作業ファイルを読み込めませんでした。このツールで保存したJSONか確認してください")}
}
$("fileImg").addEventListener("change",e=>{const f=e.target.files[0];if(f)loadImageFile(f).catch(()=>toast("画像を読み込めませんでした"));e.target.value=""});
$("fileProj").addEventListener("change",e=>{const f=e.target.files[0];if(f)loadProjectFile(f);e.target.value=""});
stage.addEventListener("dragover",e=>{e.preventDefault();$("drop").hidden=false});
stage.addEventListener("dragleave",e=>{if(!stage.contains(e.relatedTarget))$("drop").hidden=true});
stage.addEventListener("drop",e=>{e.preventDefault();$("drop").hidden=true;const f=e.dataTransfer.files[0];if(!f)return;
  if(/\.json$/i.test(f.name))loadProjectFile(f);else if(/^image\//.test(f.type))loadImageFile(f).catch(()=>toast("画像を読み込めませんでした"));else toast("JPG・PNG・JSONのファイルを使ってください")});

let newArm=0;
$("btnNew").onclick=()=>{
  const b=$("btnNew");
  if(state.objects.length&&Date.now()-newArm>3000){newArm=Date.now();b.textContent="もう一度押すと消去";b.classList.add("danger");setTimeout(()=>{b.textContent="新規";b.classList.remove("danger")},3000);return}
  b.textContent="新規";b.classList.remove("danger");newArm=0;
  pushUndo();state.objects=[];state.img=null;state.imgRot=0;state.sample=false;state.layers=freshLayers();state.active="outline";clearSel();ui.drawing=null;
  renderAll();requestAnimationFrame(fit);toast("新規にしました。「下図を開く」から画像を読み込んでください");
};
$("btnClearSample").onclick=()=>{pushUndo();state.objects=[];state.sample=false;clearSel();renderAll();toast("作例の線を消しました。下図はそのまま残しています")};

/* ---------- sample ---------- */
function smooth(pts,corners,closed){
  const n=pts.length;return pts.map((p,i)=>{
    const node={x:p[0],y:p[1],hi:null,ho:null,smooth:false};
    if(corners.includes(i))return node;
    const pi=i>0?i-1:(closed?n-1:null),ni=i<n-1?i+1:(closed?0:null);if(pi==null||ni==null)return node;
    const a=pts[pi],b=pts[ni],tx=(b[0]-a[0])/6,ty=(b[1]-a[1])/6;
    node.hi={x:p[0]-tx,y:p[1]-ty};node.ho={x:p[0]+tx,y:p[1]+ty};node.smooth=true;return node});
}
function mk(layerId,pts,corners=[],closed=false){const L=layer(layerId);return{id:uid(),kind:"path",layer:layerId,nodes:smooth(pts,corners,closed),closed,width:L.width,dash:L.dash,fill:L.fill}}
function loadSample(){
  state.img={src:SAMPLE_IMG,w:600,h:800};state.name="sample";state.sample=true;
  state.objects=[
    mk("center",[[356.5,350],[356.5,610]]),
    mk("outline",[[202.5,362.5],[200.5,384],[193,410],[157.5,457.5],[158.5,500],[161,523],[176,556],[200,586]],[0,3]),
    mk("outline",[[202.5,362],[356.5,362]]),
    mk("outline",[[356.5,359],[489,359]]),
    mk("ridge",[[193,410],[356.5,410]]),
    mk("ridge",[[157.5,457.5],[356.5,457.5]]),
    mk("ridge",[[356.5,390],[487.5,390]]),
    mk("section",[[489,359],[510,359],[515,368],[520,395],[540,417],[557,450],[560,482],[560,507],[550,530],[530,560],[517,581],[507,581],[525,550],[540,520],[541,482],[535,450],[520,425],[500,405],[487.5,385],[485,367]],[0,1,10,11],true),
    {id:uid(),kind:"scale",layer:"scale",x:200,y:672,cm:5},
  ];
}

/* ---------- boot ---------- */
loadSample();setTool("pen");renderAll();
const ro=new ResizeObserver(()=>{if(!ro.done){ro.done=true;fit()}});ro.observe(svg);
})();
