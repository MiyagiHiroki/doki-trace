/* オフライン対応（Service Worker）の登録。https または localhost でのみ動作 */
if("serviceWorker" in navigator && (location.protocol==="https:"||location.hostname==="localhost"||location.hostname==="127.0.0.1")){
  window.addEventListener("load",()=>{navigator.serviceWorker.register("./sw.js").catch(err=>console.warn("Service Worker の登録に失敗:",err));});
}
