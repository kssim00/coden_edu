/* User-selected folder storage. No connection or permission is required to practice. */
(() => {
  const button=document.getElementById("connectRecordFolder");
  const notice=document.getElementById("storageNotice");
  let remembered=null,busy=false;
  const tell=text=>{notice.hidden=false;notice.textContent=text;};
  const safe=value=>String(value).normalize("NFC").replace(/[<>:"/\\|?*\u0000-\u001f]/g,"_").replace(/[. ]+$/g,"").slice(0,80)||"student";
  async function write(directory,name,value){
    const file=await directory.getFileHandle(name,{create:true});
    const stream=await file.createWritable();
    try{await stream.write(value);await stream.close();}catch(error){try{await stream.abort();}catch{}throw error;}
  }
  async function documentIn(directory){
    const file=await directory.getFileHandle("진행.json");
    const doc=JSON.parse(await (await file.getFile()).text());
    if(doc.version!==1||!doc.session?.id||!doc.session.student)throw new Error("학생 기록 파일 형식이 올바르지 않습니다.");
    return doc;
  }
  function createStore(root){
    let chain=Promise.resolve();
    const directories=new Map(),documents=new Map();
    async function students(create=false){
      try{return await root.getDirectoryHandle("학생기록",{create});}
      catch(error){if(error.name==="NotFoundError")return null;throw error;}
    }
    async function list(){
      await chain;
      const parent=await students(),sessions=[];
      if(!parent)return sessions;
      for await(const child of parent.values()){
        if(child.kind!=="directory")continue;
        try{const doc=await documentIn(child);directories.set(doc.session.id,child);documents.set(doc.session.id,doc);sessions.push(doc.session);}
        catch(error){if(error.name!=="NotFoundError")throw error;}
      }
      return sessions;
    }
    const serialize=work=>{const result=chain.catch(()=>{}).then(work);chain=result.catch(()=>{});return result;};
    async function directory(id){
      if(!directories.has(id))await list();
      const dir=directories.get(id);if(!dir)throw new Error("학생의 진행 기록이 없습니다.");return dir;
    }
    function answerId(key){
      const split=key.lastIndexOf(":"),id=key.slice(0,split),q=Number(key.slice(split+1));
      if(split<1||!Number.isInteger(q)||q<1||q>10)throw new Error("풀이 번호가 올바르지 않습니다.");
      return {id,q,name:String(q).padStart(2,"0")};
    }
    return {
      list,
      async probe(){const name=".cos-scratch-test-"+crypto.randomUUID();await write(root,name,"COS Scratch folder access");await root.removeEntry(name);},
      async save(session){
        // Discover existing folders before entering the serialized writer.
        if(!directories.has(session.id))await list();
        return serialize(async()=>{
          let dir=directories.get(session.id);
          if(!dir){const parent=await students(true);dir=await parent.getDirectoryHandle(safe(session.student)+"_"+safe(session.id),{create:true});directories.set(session.id,dir);}
          let previous=documents.get(session.id);try{if(!previous)previous=await documentIn(dir);}catch(error){if(error.name!=="NotFoundError")throw error;}
          const doc={version:1,session,deletedAnswers:previous?.deletedAnswers||[]};
          await write(dir,"진행.json",JSON.stringify(doc));documents.set(session.id,doc);
        });
      },
      async getAnswer(key){
        await chain;const {id,q,name}=answerId(key),dir=await directory(id),doc=documents.get(id)||await documentIn(dir);
        if((doc.deletedAnswers||[]).includes(q))return {bytes:null,deleted:true};
        for(const ext of [".json",".sb2"]){
          try{return {bytes:new Uint8Array(await (await (await dir.getFileHandle(name+ext)).getFile()).arrayBuffer()),deleted:false};}
          catch(error){if(error.name!=="NotFoundError")throw error;}
        }
        return {bytes:null,deleted:false};
      },
      async putAnswer(key,bytes){
        const {id,q,name}=answerId(key),dir=await directory(id);
        return serialize(async()=>{
          await write(dir,name+(bytes[0]===123?".json":".sb2"),bytes);
          const doc=documents.get(id)||await documentIn(dir);
          if((doc.deletedAnswers||[]).includes(q)){
            doc.deletedAnswers=doc.deletedAnswers.filter(value=>value!==q);
            await write(dir,"진행.json",JSON.stringify(doc));documents.set(id,doc);
          }
        });
      },
      async deleteAnswer(key){
        const {id,q,name}=answerId(key),dir=await directory(id);
        return serialize(async()=>{
          const doc=documents.get(id)||await documentIn(dir);doc.deletedAnswers=[...new Set([...(doc.deletedAnswers||[]),q])];
          await write(dir,"진행.json",JSON.stringify(doc));documents.set(id,doc);
          for(const ext of [".json",".sb2"]){try{await dir.removeEntry(name+ext);}catch(error){if(error.name!=="NotFoundError")throw error;}}
        });
      }
    };
  }
  async function handles(){
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open("cos-scratch-record-folder",1);
      request.onupgradeneeded=()=>request.result.createObjectStore("handles");
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
  }
  async function remember(handle){
    const db=await handles();
    try{await new Promise((resolve,reject)=>{const tx=db.transaction("handles","readwrite");tx.objectStore("handles").put(handle,"folder");tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
    finally{db.close();}
  }
  async function recall(){
    try{const db=await handles();return await new Promise((resolve,reject)=>{const tx=db.transaction("handles"),req=tx.objectStore("handles").get("folder");tx.oncomplete=()=>{db.close();resolve(req.result||null);};tx.onerror=()=>{db.close();reject(tx.error);};});}
    catch{return null;}
  }
  function setBusy(value){
    busy=value;button.disabled=value;
    document.getElementById("startButton").disabled=value;
    document.getElementById("resumeButton").disabled=value;
  }
  async function connect(handle,restore=false){
    setBusy(true);
    try{
      await progressStore.flush();
      const target=createStore(handle);await target.probe();
      const existing=await target.list(),byId=new Map(existing.map(item=>[item.id,item]));
      const local=await progressStore.list();
      tell("기존 학생 기록을 연결하는 중…");
      for(const item of local){
        const saved=byId.get(item.id);
        if(saved&&(saved.updatedAt||saved.createdAt||0)>=(item.updatedAt||item.createdAt||0))continue;
        await target.save(item);
        for(let q=1;q<=10;q++){
          const key=item.id+":"+q,bytes=await progressStore.getAnswer(key);
          if(progressStore.wasDeleted(key))await target.deleteAnswer(key);
          else if(bytes)await target.putAnswer(key,bytes);
        }
      }
      progressStore.attachFolder(target);remembered=handle;
      button.textContent="저장 폴더 변경";
      try{await remember(handle);}catch{tell("폴더에 저장하지만 폴더 연결 정보는 기억하지 못했습니다.");}
      await window.reloadStudentProgress();
      tell("저장 폴더 연결됨 · "+handle.name+" / 학생기록");
      return true;
    }catch(error){
      progressStore.useBrowserStorage();tell("폴더 연결 실패 · 이 브라우저에 저장합니다. "+(error.message||""));
      return false;
    }finally{setBusy(false);}
  }
  async function reconnect(){
    if(!remembered)return false;
    try{
      // Must run directly from a button click, before any other asynchronous work.
      if(await remembered.requestPermission({mode:"readwrite"})==="granted")return connect(remembered,true);
    }catch{}
    remembered=null;button.textContent="저장 폴더 연결";
    progressStore.useBrowserStorage();tell("폴더 접근이 허용되지 않아 이 브라우저에 저장합니다.");return false;
  }
  function permissionDialog(){
    const dialog=document.createElement("dialog");dialog.id="recordFolderPermission";
    const title=document.createElement("h2");title.textContent="저장 폴더 접근 허용";
    const text=document.createElement("p");text.textContent="기억한 폴더 ‘"+remembered.name+"’에 학생 기록을 저장하려면 접근을 허용해 주세요.";
    const allow=document.createElement("button");allow.id="allowRecordFolder";allow.className="primary";allow.textContent="접근 허용";
    const local=document.createElement("button");local.id="useBrowserRecords";local.textContent="이번에는 브라우저 저장";
    allow.onclick=()=>{const result=reconnect();dialog.close();dialog.remove();return result;};
    const useLocal=()=>{progressStore.useBrowserStorage();tell("이번 실행은 이 브라우저에 저장합니다.");};
    local.onclick=()=>{useLocal();dialog.close();dialog.remove();};dialog.oncancel=useLocal;
    dialog.append(title,text,allow,local);document.body.append(dialog);dialog.showModal();
  }
  button.onclick=async()=>{
    if(busy)return;
    if(remembered&&!progressStore.hasFolder())return reconnect();
    if(!window.showDirectoryPicker){tell("폴더 선택은 Chrome 또는 Edge에서 사용할 수 있습니다. 현재 브라우저 저장은 계속 사용할 수 있습니다.");return;}
    try{await connect(await showDirectoryPicker({mode:"readwrite",id:"cos-scratch-records"}));}
    catch(error){if(error.name!=="AbortError")tell("폴더 선택 실패 · 브라우저 저장을 계속 사용합니다.");}
  };
  window.scratchRecordFolder={
    createStore,
    async initialize(){
      remembered=await recall();if(!remembered)return;
      try{
        if(await remembered.queryPermission({mode:"readwrite"})==="granted")await connect(remembered,true);
        else{button.textContent="이전 폴더 다시 연결";progressStore.useBrowserStorage();permissionDialog();}
      }catch{button.textContent="이전 폴더 다시 연결";progressStore.useBrowserStorage();}
    }
  };
})();
