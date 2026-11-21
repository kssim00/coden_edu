/* Disk storage is shared by every local server port. Browser data remains a backup. */
(() => {
  let queue = Promise.resolve();
  const deleted = new Set();
  let browserMode=false,browserDB,folderStore=null;
  function enableBrowser(){
    browserMode=true;folderStore=null;
    const notice=document.getElementById("storageNotice");
    if(notice){notice.hidden=false;notice.textContent="폴더 저장을 사용할 수 없어 이 브라우저에 저장합니다. 다음에도 같은 브라우저와 주소에서 이어서 할 수 있습니다.";}
  }
  function localSessions(){
    const all=JSON.parse(localStorage.getItem("cosScratch:studentSessions")||"{}");
    const active=JSON.parse(localStorage.getItem("cosScratch:activeSession")||"null");
    if(active?.id&&!all[active.id])all[active.id]=active;
    return all;
  }
  async function answerCache(key,value,write=false){
    if(!browserDB)browserDB=new Promise(resolve=>{
      let finished=false;const timer=setTimeout(()=>finish(null),1500);
      function finish(db){if(finished){db?.close();return;}finished=true;clearTimeout(timer);resolve(db);}
      try{const request=indexedDB.open("cos-scratch-student-work",1);
        request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains("answers"))request.result.createObjectStore("answers");};
        request.onsuccess=()=>finish(request.result);request.onerror=()=>finish(null);request.onblocked=()=>finish(null);
      }catch{finish(null);}
    });
    const db=await browserDB;
    if(db)return new Promise((resolve,reject)=>{
      const tx=db.transaction("answers",write?"readwrite":"readonly"),store=tx.objectStore("answers");
      const request=write?store.put(value,key):store.get(key);
      tx.oncomplete=()=>resolve(write?undefined:request.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    });
    const storageKey="cosScratch:fallbackAnswer:"+key;
    if(!write){const data=JSON.parse(localStorage.getItem(storageKey)||"null");if(!data||data.deleted)return data;return Uint8Array.from(atob(data),letter=>letter.charCodeAt(0));}
    if(value?.deleted){localStorage.setItem(storageKey,JSON.stringify(value));return;}
    const bytes=new Uint8Array(value);let binary="";
    for(let index=0;index<bytes.length;index+=32768)binary+=String.fromCharCode(...bytes.subarray(index,index+32768));
    localStorage.setItem(storageKey,JSON.stringify(btoa(binary)));
  }
  async function saveSession(value,body){
    let browserError;
    try{const all=localSessions();all[value.id]=JSON.parse(body);localStorage.setItem("cosScratch:studentSessions",JSON.stringify(all));}catch(error){browserError=error;}
    if(folderStore){try{return await folderStore.save(JSON.parse(body));}catch{enableBrowser();}}
    if(!browserMode){try{return await request("/api/sessions/"+encodeURIComponent(value.id),{method:"PUT",headers:{"Content-Type":"application/json"},body});}catch{enableBrowser();}}
    if(browserError)throw browserError;
  }
  async function fetchProgress(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try { return await fetch(path, {...options, cache: "no-store", signal: controller.signal}); }
    finally { clearTimeout(timer); }
  }
  async function request(path, options = {}) {
    const response = await fetchProgress(path, options);
    if (!response.ok) throw new Error("학생 기록을 저장하거나 불러오지 못했습니다. 서버 창을 확인해 주세요.");
    return response;
  }
  window.progressStore = {
    attachFolder(store) { folderStore=store;browserMode=true; },
    useBrowserStorage:enableBrowser,
    hasFolder() { return !!folderStore; },
    async legacyRecords() {
      if (!["127.0.0.1","localhost"].includes(location.hostname)) return []; // 웹(GitHub Pages) 배포본: 로컬 서버 기록 가져오기 생략
      return Promise.all(Array.from({length:9}, (_, index) => 8002 + index)
        .filter(port => String(port) !== location.port).map(port => new Promise(resolve => {
          const origin = "http://127.0.0.1:" + port;
          const frame = document.createElement("iframe"), token = crypto.randomUUID();
          frame.hidden = true;
          let timer;
          const finish = value => { clearTimeout(timer); removeEventListener("message", receive); frame.remove(); resolve(value); };
          const receive = event => {
            if (event.origin === origin && event.source === frame.contentWindow && event.data?.type === "cos-progress-records" && event.data.token === token)
              finish(event.data);
          };
          addEventListener("message", receive);
          timer = setTimeout(() => finish({sessions:[], answers:[]}), 1800);
          frame.onload = () => frame.contentWindow.postMessage({type:"cos-progress-import", token}, origin);
          frame.src = origin + "/legacy-progress.html";
          document.body.append(frame);
        })));
    },
    async list() {
      if(folderStore){try{return await folderStore.list();}catch{enableBrowser();}}
      if(!browserMode){try{return (await (await request("/api/progress")).json()).sessions;}catch{enableBrowser();}}
      return Object.values(localSessions());
    },
    save(value) {
      const body = JSON.stringify(value);
      const next = queue.catch(() => {}).then(() => saveSession(value,body));
      queue = next;
      return next;
    },
    flush() { return queue; },
    async getAnswer(key) {
      if(folderStore){
        try{
          const result=await folderStore.getAnswer(key);
          if(result.deleted){deleted.add(key);await answerCache(key,{deleted:true},true).catch(()=>{});return null;}
          if(result.bytes){deleted.delete(key);await answerCache(key,result.bytes.buffer,true).catch(()=>{});}
          return result.bytes;
        }catch{enableBrowser();}
      }
      if(!browserMode){
        try{
          const response=await fetchProgress("/api/answers/"+encodeURIComponent(key));
          if(response.status===410){deleted.add(key);await answerCache(key,{deleted:true},true).catch(()=>{});return null;}
          if(response.status===404)return null;
          if(!response.ok)throw new Error("Folder unavailable");
          const bytes=new Uint8Array(await response.arrayBuffer());deleted.delete(key);
          await answerCache(key,bytes.buffer,true).catch(()=>{});return bytes;
        }catch{enableBrowser();}
      }
      const saved=await answerCache(key);
      if(saved?.deleted){deleted.add(key);return null;}
      deleted.delete(key);return saved?new Uint8Array(saved):null;
    },
    wasDeleted(key) { return deleted.has(key); },
    async putAnswer(key, bytes) {
      let browserError;
      try{await answerCache(key,bytes.slice().buffer,true);deleted.delete(key);}catch(error){browserError=error;}
      if(folderStore){try{return await folderStore.putAnswer(key,bytes);}catch{enableBrowser();}}
      if(!browserMode){try{return await request("/api/answers/"+encodeURIComponent(key),{method:"PUT",headers:{"Content-Type":"application/octet-stream"},body:bytes});}catch{enableBrowser();}}
      if(browserError)throw browserError;
    },
    async deleteAnswer(key) {
      let browserError;
      try{await answerCache(key,{deleted:true},true);deleted.add(key);}catch(error){browserError=error;}
      if(folderStore){try{return await folderStore.deleteAnswer(key);}catch{enableBrowser();}}
      if(!browserMode){try{return await request("/api/answers/"+encodeURIComponent(key),{method:"DELETE"});}catch{enableBrowser();}}
      if(browserError)throw browserError;
    }

  };
})();
