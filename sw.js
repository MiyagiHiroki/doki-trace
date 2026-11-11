/* 土器実測図トレース Service Worker
   アプリを更新したら VERSION を変えてください（利用者の端末のキャッシュが入れ替わります）。 */
const VERSION="doki-trace-v1.0.1";
const APP_FILES=["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "manual.pdf"];
self.addEventListener("install",e=>{
  e.waitUntil(caches.open(VERSION).then(c=>c.addAll(APP_FILES)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch",e=>{
  const req=e.request;if(req.method!=="GET")return;
  const url=new URL(req.url);
  const isFont=url.hostname==="fonts.googleapis.com"||url.hostname==="fonts.gstatic.com";
  if(url.origin!==location.origin&&!isFont)return;
  // ネットにつながっていれば最新を取り、つながらなければ保存しておいた版を使う
  e.respondWith(fetch(req).then(res=>{
    if(res&&(res.ok||res.type==="opaque")){const copy=res.clone();caches.open(VERSION).then(c=>c.put(req,copy));}
    return res;
  }).catch(()=>caches.match(req,{ignoreSearch:true}).then(r=>r||(req.mode==="navigate"?caches.match("index.html"):undefined))));
});
