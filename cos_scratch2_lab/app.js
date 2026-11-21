const $ = id => document.getElementById(id);
const startScreen = $("startScreen"), workspace = $("workspace"), workbar = $("workbar"), host = $("scratch-host");
const status = $("editorStatus"), gradeSelect = $("gradeSelect"), setSelect = $("setSelect"), questionNav = $("questionNav");
const SESSION_KEY = "cosScratch:activeSession", LAST_NAME_KEY = "cosScratch:lastName", STUDENTS_KEY = "cosScratch:students", HISTORY_KEY = "cosScratch:history";
const SESSIONS_KEY="cosScratch:studentSessions";
let studentSessions={},projectLoading=false,autoSaving=false,progressReady=false,loadedProjectKey=null,projectLoadVersion=0;
let savedProjectVersion=0,pendingDiskSaves=0,loadedBaseline=null;
const baselineCache=new Map();
const failedDiskSaves=new Set();
async function persistProgress(key,write){
  pendingDiskSaves++;
  try{const result=await write();failedDiskSaves.delete(key);return result;}
  catch(error){failedDiskSaves.add(key);throw error;}
  finally{pendingDiskSaves--;}
}
const MINUTES = {1:50,2:50,3:40,4:40}, QUESTIONS = Array.from({length:10},(_,i)=>i+1);
const sampleCache = new Map();
let selectedMode = "practice", session = null, editorApi = null, editorLoading = null, ticking = false, timerId = null, pendingProjectExport = null;

function localGet(key,fallback=null){try{const raw=localStorage.getItem(key);return raw===null?fallback:JSON.parse(raw);}catch{return fallback;}}
function localSet(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch(error){console.warn("진행 상태를 저장하지 못했습니다.",error);}}
function saveSession(){
  if(!session)return;
  session.updatedAt=Date.now();studentSessions[session.id]=session;
  localSet(SESSION_KEY,session);localSet(SESSIONS_KEY,studentSessions);
  persistProgress("session:"+session.id,()=>progressStore.save(session)).catch(error=>{$("saveHint").textContent="기록 저장 실패 · 서버 창을 확인하세요";console.error(error);});
}
function dataPath(kind,question){question=question||session.question;const ext=kind==="problem"?"pdf":"sb2";return "data/cos-samples/"+session.grade+"/set-"+session.set+"/"+kind+"/"+String(question).padStart(2,"0")+"."+ext;}
function answerKey(question){return session.id+":"+(question||session.question);}
function sampleKey(grade,set,question,kind){return grade+"/"+set+"/"+question+"/"+kind;}

const idbPromise=new Promise(resolve=>{
  let finished=false;
  const finish=db=>{if(finished){if(db)db.close();return;}finished=true;clearTimeout(timer);resolve(db);};
  const timer=setTimeout(()=>finish(null),1500);
  try{
    if(!("indexedDB" in window)){finish(null);return;}
    const request=indexedDB.open("cos-scratch-student-work",1);
    request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains("answers"))request.result.createObjectStore("answers");};
    request.onsuccess=()=>finish(request.result);request.onerror=()=>finish(null);request.onblocked=()=>finish(null);
  }catch(error){console.warn("브라우저 보조 저장소를 사용할 수 없습니다. 컴퓨터에 저장합니다.",error);finish(null);}
});
async function saveAnswerBytes(key,bytes){
  return persistProgress("answer:"+key,async()=>{
    await progressStore.putAnswer(key,bytes);
    const db=await idbPromise;if(!db)return;
    try{
      const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
      await new Promise((resolve,reject)=>{const tx=db.transaction("answers","readwrite");tx.objectStore("answers").put(buffer,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
    }catch(error){console.warn("브라우저 보조 저장 실패 (컴퓨터 저장 완료)",error);}
  });
}
async function getAnswerBytes(key){
  const saved=await progressStore.getAnswer(key);
  if(saved)return saved;
  if(progressStore.wasDeleted(key))return null;
  const db=await idbPromise;if(!db)return null;
  const local=await new Promise((resolve,reject)=>{const req=db.transaction("answers","readonly").objectStore("answers").get(key);req.onsuccess=()=>resolve(req.result?new Uint8Array(req.result):null);req.onerror=()=>reject(req.error);});
  if(local)await progressStore.putAnswer(key,local);
  return local;
}
async function deleteAnswerBytes(key){
  return persistProgress("answer:"+key,async()=>{
    await progressStore.deleteAnswer(key);
    const db=await idbPromise;if(!db)return;
    try{
      await new Promise((resolve,reject)=>{const tx=db.transaction("answers","readwrite");tx.objectStore("answers").delete(key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
    }catch(error){console.warn("브라우저 보조 저장소 정리 실패",error);}
  });
}
function toBase64(bytes){let binary="";for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));return btoa(binary);}
function fromBase64(encoded){const binary=atob(encoded.replace(/\s/g,"")),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes;}

async function ensureEditor(){
  if(editorApi)return;if(editorLoading)return editorLoading;
  editorLoading=(async()=>{
    status.textContent="Scratch 2.0 편집기 준비 중…";host.replaceChildren();
    const swfUrl=new URL("editor/scratch-scratch2-editor.swf",location.href);
    localStorage.setItem(swfUrl.hostname+swfUrl.pathname+"/Scratch","AL8AAAAhVENTTwAEAAAAAAAHU2NyYXRjaAAAAAMJbGFuZwYFa28A");
    const player=window.RufflePlayer.newest().createPlayer();player.style.width="100%";player.style.height="100%";host.appendChild(player);
    const loaded=new Promise(resolve=>player.addEventListener("loadeddata",resolve,{once:true}));
    editorApi=player.ruffle();
    await editorApi.load({url:"editor/scratch-scratch2-editor.swf?v=json-save-22",allowScriptAccess:true,base:new URL("./editor/locale-ko-default17/",location.href).href,parameters:{}});
    await Promise.race([loaded,new Promise(resolve=>setTimeout(resolve,12000))]);
    await new Promise(resolve=>setTimeout(resolve,800));status.textContent="Scratch 편집기 준비 완료";
  })().catch(error=>{editorLoading=null;editorApi=null;status.textContent="편집기를 불러오지 못했습니다. 새로고침해 주세요.";console.error(error);throw error;});
  return editorLoading;
}
async function originalProject(q){
  const url=dataPath("starter",q);
  if(!baselineCache.has(url))baselineCache.set(url,(async()=>{const response=await fetch(url);if(!response.ok)throw new Error("시작 프로젝트를 읽지 못했습니다.");const bytes=new Uint8Array(await response.arrayBuffer());return {bytes,...await SnapshotCodec.baseline(bytes)};})().catch(error=>{baselineCache.delete(url);throw error;}));
  return baselineCache.get(url);
}
async function openProject(bytes){
  if(!editorApi||!bytes)return;
  const restored=await SnapshotCodec.restore(bytes,loadedBaseline);
  editorApi.callExternalInterface("ASopenProjectFromData",toBase64(restored));
  const deadline=Date.now()+20000;
  while(editorApi.callExternalInterface("ASisProjectLoading")){
    if(Date.now()>deadline)throw new Error("풀이를 불러오는 시간이 초과되었습니다.");
    await new Promise(resolve=>setTimeout(resolve,30));
  }
}
window.JSwillDownload=()=>true;
window.JSloadID=()=>loadCurrentProject("starter");
window.JSeditorReady=()=>{if(session)loadCurrentProject("starter");};
window.gotZipBase64=content=>{if(editorApi)editorApi.callExternalInterface("ASopenProjectFromData",content);};
window.JSdownloadSB2=(encoded,filename)=>{
  try{
    const bytes=fromBase64(encoded);
    if(session){
      const savedSessionId=session.id,savedQuestion=session.question,key=answerKey(savedQuestion);
      requestProjectExport(savedQuestion).then(async()=>{saveSession();
        $("saveHint").textContent="문제 "+savedQuestion+" 저장 완료";$("editorStatus").textContent="풀이 저장 완료";updateQuestionNav();
      }).catch(error=>{$("saveHint").textContent="브라우저 저장에 실패했습니다. 내려받은 .sb2 파일을 직접 불러오세요.";console.error(error);});
    }
    const link=document.createElement("a");link.href="data:application/octet-stream;base64,"+encoded;link.download=filename||"scratch-project.sb2";link.click();
  }catch(error){console.error("SB2 저장 처리 실패",error);}
};
window.JSreceiveProjectJSON=text=>{
  const request=pendingProjectExport;if(!request)return;
  pendingProjectExport=null;clearTimeout(request.timeout);
  try{
    const bytes=new TextEncoder().encode(text);SnapshotCodec.snapshot(bytes);
    const key=request.sessionId+":"+request.question;
    const saving=saveAnswerBytes(key,bytes).then(()=>{
      if(loadedProjectKey===key&&projectLoadVersion===request.loadVersion)savedProjectVersion=request.editVersion;
      updateQuestionNav();
    });
    if(request.waitForSave)saving.then(()=>request.resolve(bytes)).catch(request.reject);
    else{saving.catch(error=>{$("saveHint").textContent="채점 완료 · 풀이 저장 실패";console.error(error);});request.resolve(bytes);}
  }catch(error){request.reject(error);}
};
// Older editors and downloaded SB2 imports remain readable.
window.JSreceiveProjectData=encoded=>{
  const request=pendingProjectExport;if(!request)return;
  pendingProjectExport=null;clearTimeout(request.timeout);
  const bytes=fromBase64(encoded);
  saveAnswerBytes(request.sessionId+":"+request.question,bytes).then(()=>request.resolve(bytes)).catch(request.reject);
};
function requestProjectExport(question,waitForSave=true){
  if(!session||!editorApi)return Promise.reject(new Error("Scratch 편집기가 아직 준비되지 않았습니다."));
  if(projectLoading||loadedProjectKey!==answerKey(question))return Promise.reject(new Error("문제의 풀이를 불러오는 중입니다. 잠시 후 다시 시도해 주세요."));
  if(pendingProjectExport)return pendingProjectExport.sessionId===session.id&&pendingProjectExport.question===(question||session.question)?pendingProjectExport.promise:Promise.reject(new Error("현재 프로젝트를 가져오는 중입니다. 잠시 기다려 주세요."));
  const request={sessionId:session.id,question:question||session.question,editVersion:Number(editorApi.callExternalInterface("ASgetProjectEditVersion")),loadVersion:projectLoadVersion,waitForSave,resolve:null,reject:null,timeout:null};
  const promise=new Promise((resolve,reject)=>{
    request.resolve=resolve;request.reject=reject;
    request.timeout=setTimeout(()=>{if(pendingProjectExport===request){pendingProjectExport=null;reject(new Error("Scratch 편집기에서 프로젝트를 가져오지 못했습니다. 새로고침 후 다시 시도해 주세요."));}},20000);
    pendingProjectExport=request;
    try{editorApi.callExternalInterface("ASexportProjectJSON",loadedBaseline?.known||"{}");}
    catch(error){pendingProjectExport=null;clearTimeout(request.timeout);reject(error);}
  });
  request.promise=promise;return promise;
}
async function loadCurrentProject(kind){
  if(!session||!editorApi)return;
  projectLoading=true;
  const q=session.question,key=answerKey(q),version=++projectLoadVersion;
  loadedProjectKey=null;
  try{
    const baseline=await originalProject(q);
    let bytes=kind==="answer"?null:await getAnswerBytes(answerKey(q));
    const hasSaved=!!bytes;
    if(kind==="answer"||!bytes){
      if(kind!=="answer")bytes=baseline.bytes;
      else{
      const response=await fetch(dataPath("answer",q));
      if(!response.ok)throw new Error("문제 "+q+"의 "+(kind==="answer"?"정답":"시작")+" 프로젝트를 찾지 못했습니다.");
      bytes=new Uint8Array(await response.arrayBuffer());
      }
    }
    if(version!==projectLoadVersion||!session||answerKey()!==key)return;
    loadedBaseline=baseline;savedProjectVersion=0;await openProject(bytes);loadedProjectKey=key;
    if(kind==="answer"){
      $("editorStatus").textContent="정답 프로젝트를 열었습니다. 다시 풀려면 ‘이 문제 다시 풀기’를 누르세요.";
    }else{
      $("editorStatus").textContent=hasSaved?"저장된 내 풀이를 불러왔습니다.":"시작 프로젝트를 불러왔습니다.";
    }
  }catch(error){$("editorStatus").textContent=error.message;console.error(error);}
  finally{if(version===projectLoadVersion)projectLoading=false;}
}
async function loadScratchAndQuestion(){try{await ensureEditor();await loadQuestion();}catch{}}

let setupInitialized=false,setupTouched=false;
function fillSetup(){
  if(!setupInitialized){
  gradeSelect.innerHTML="";
  for(let grade=1;grade<=4;grade++){const option=document.createElement("option");option.value=String(grade);option.textContent="COS "+grade+"급";gradeSelect.append(option);}
  gradeSelect.value="3";fillSets();gradeSelect.addEventListener("change",()=>{fillSets();refreshResume();});
  $("studentInput").value=localGet(LAST_NAME_KEY,"");
  }
  if(setupInitialized&&!setupTouched)$("studentInput").value=localGet(LAST_NAME_KEY,"");
  $("studentNames").replaceChildren();
  [...new Set([...localGet(STUDENTS_KEY,[]),...Object.values(studentSessions).map(item=>item.student)])].forEach(name=>{const option=document.createElement("option");option.value=name;$("studentNames").append(option);});
  const last=Object.values(studentSessions).filter(item=>item.student===$("studentInput").value.trim()).sort((a,b)=>(b.updatedAt||b.createdAt)-(a.updatedAt||a.createdAt))[0];
  if(last&&!setupTouched){gradeSelect.value=String(last.grade);fillSets();setSelect.value=String(last.set);setMode(last.mode==="exam"?"exam":"practice");}
  if(!setupInitialized){
  gradeSelect.addEventListener("change",()=>setupTouched=true);setSelect.addEventListener("change",()=>setupTouched=true);
  $("studentInput").addEventListener("input",()=>{
    setupTouched=true;
    const latest=Object.values(studentSessions).filter(item=>item.student===$("studentInput").value.trim()).sort((a,b)=>(b.updatedAt||b.createdAt)-(a.updatedAt||a.createdAt))[0];
    if(latest){gradeSelect.value=String(latest.grade);fillSets();setSelect.value=String(latest.set);setMode(latest.mode==="exam"?"exam":"practice");}
    refreshResume();
  });setSelect.addEventListener("change",refreshResume);
  setupInitialized=true;
  }
  refreshResume();
}
function fillSets(){setSelect.innerHTML="";for(let set=1;set<=3;set++){const option=document.createElement("option");option.value=String(set);option.textContent="샘플 "+set;setSelect.append(option);}}
function refreshResume(){
  const saved=findStudentSession();
  const box=$("resumeBox"),button=$("resumeButton");
  if(saved){
    const count=Object.values(saved.scores||{}).filter(item=>item.score===100).length;
    box.hidden=false;box.textContent=saved.student+" · "+saved.grade+"급 샘플 "+saved.set+" · "+count+"/10문제 완료 · 마지막 "+saved.question+"번 문제";
    button.hidden=false;
  }else{box.hidden=true;button.hidden=true;}
  $("startButton").textContent=saved?"새로 시작":selectedMode==="exam"?"시험 준비":"연습 시작";
}
function findStudentSession(){
  const name=$("studentInput").value.trim();
  return Object.values(studentSessions).filter(item=>item.student===name&&Number(item.grade)===Number(gradeSelect.value)&&Number(item.set)===Number(setSelect.value)&&(item.mode==="exam"?"exam":"practice")===selectedMode)
    .sort((a,b)=>(b.updatedAt||b.createdAt)-(a.updatedAt||a.createdAt))[0]||null;
}
function setMode(mode){
  selectedMode=mode;
  [["practiceMode","practice"],["examMode","exam"]].forEach(pair=>{const button=$(pair[0]),active=pair[1]===mode;button.classList.toggle("selected",active);button.setAttribute("aria-pressed",String(active));});
  $("startButton").textContent=mode==="exam"?"시험 준비":"연습 시작";
  refreshResume();
}
$("practiceMode").addEventListener("click",()=>setMode("practice"));
$("examMode").addEventListener("click",()=>setMode("exam"));
function newSession(mode){
  const student=$("studentInput").value.trim();
  if(!student){$("startError").textContent="이름을 입력해 주세요."; $("studentInput").focus();return;}
  if(!progressReady)return;
  const old=findStudentSession();
  if(old&&!confirm("이 학생의 저장된 풀이가 있습니다. 이어서 하려면 취소 후 ‘이어서 하기’를 누르세요. 새 풀이를 시작할까요?"))return;
  const names=localGet(STUDENTS_KEY,[]);if(!names.includes(student))localSet(STUDENTS_KEY,names.concat(student).slice(-100));
  localSet(LAST_NAME_KEY,student);
  pendingProjectExport=null;
  session={id:Date.now()+"-"+Math.random().toString(36).slice(2,8),student:student,grade:Number(gradeSelect.value),set:Number(setSelect.value),mode:mode,phase:mode==="exam"?"exam":"practice",question:1,deadline:null,started:false,scores:{},wrongCounts:{},attempts:{},retryQuestions:[],retryIndex:0,createdAt:Date.now()};
  saveSession();enterWorkspace();
}
async function enterWorkspace(){
  document.body.classList.add("in-workspace");startScreen.hidden=true;workspace.hidden=false;workbar.hidden=false;$("homeButton").hidden=false;
  $("studentLabel").textContent=session.student;
  $("modeLabel").textContent=(session.mode==="exam"?"시험":session.mode==="retry"?"오답 복습":"연습")+" · "+session.grade+"급 샘플 "+session.set;
  $("headerContext").textContent=session.grade+"급 · 샘플 "+session.set;
  $("examGate").hidden=session.mode!=="exam"||!!session.started;
  $("gateText").textContent="COS "+session.grade+"급 샘플 "+session.set+" · 10문제 · "+MINUTES[session.grade]+"분";
  await ensureEditor();editorApi.callExternalInterface("ASsetSmallStage",true);await loadQuestion();updateControls();
  if(session.mode==="exam"&&session.started)startTimer();
}
$("startButton").addEventListener("click",()=>{$("startError").textContent="";newSession(selectedMode);});
$("resumeButton").addEventListener("click",async()=>{
  session=findStudentSession();if(!session){refreshResume();return;}
  localSet(LAST_NAME_KEY,session.student);selectedMode=session.mode==="exam"?"exam":"practice";
  if(session.mode!=="exam"&&(session.phase==="results"||session.phase==="done")){
    session.phase=session.mode==="retry"?"retry":"practice";saveSession();
  }
  await enterWorkspace();
});
$("gateStart").addEventListener("click",()=>{if(!session)return;session.started=true;session.deadline=Date.now()+MINUTES[session.grade]*60000;saveSession();$("examGate").hidden=true;startTimer();});
function loadQuestion(){
  if(!session)return;
  const q=session.question;$("questionTitle").textContent="문제 "+q;$("questionEyebrow").textContent="COS "+session.grade+"급 · 샘플 "+session.set;
  window.questionPdfViewer.load(dataPath("problem",q));
  $("questionScore").textContent=session.scores[q]?session.scores[q].score+"점":"미채점";
  $("saveHint").textContent="채점하기를 누르면 현재 블록을 바로 채점합니다";
  $("answerButton").disabled=session.mode==="exam"||(session.wrongCounts[q]||0)<2;
  updateQuestionNav();updateControls();return loadCurrentProject("starter");
}
function currentList(){return session&&session.mode==="retry"?session.retryQuestions:QUESTIONS;}
function updateQuestionNav(){
  if(!session)return;questionNav.replaceChildren();
  QUESTIONS.forEach(q=>{const button=document.createElement("button");button.type="button";button.textContent=String(q);button.setAttribute("aria-label","문제 "+q);
    button.classList.toggle("current",q===session.question);
    if(session.scores[q]){
      const correct=session.scores[q].score===100;
      const firstTry=correct&&(session.attempts?.[q]||1)===1&&!(session.wrongCounts?.[q]>0);
      button.classList.add(correct?"correct":"incorrect");
      if(firstTry)button.classList.add("first-try");
      const status=correct?(firstTry?"첫 채점 정답, 동그라미 2개":"재도전 정답, 동그라미 1개"):"오답, X";
      button.setAttribute("aria-label","문제 "+q+", "+status);
      button.title=status;
    }
    if(session.mode==="retry"&&!session.retryQuestions.includes(q))button.disabled=true;
    button.addEventListener("click",()=>selectQuestion(q));questionNav.append(button);
  });
}
async function selectQuestion(q){
  if(!session||(session.mode==="retry"&&!session.retryQuestions.includes(q))||q===session.question)return;
  try{await requestProjectExport(session.question);}catch(error){showMessage("문제를 이동하지 못했습니다",error.message||"현재 풀이를 저장하지 못했습니다.");return;}
  session.question=q;saveSession();await loadQuestion();
}
function updateControls(){
  if(!session)return;
  const exam=session.mode==="exam",practice=session.mode==="practice",retry=session.mode==="retry",results=session.phase==="results";
  $("timerLabel").hidden=!exam;$("redoButton").hidden=exam||results;$("answerButton").hidden=exam||results;
  $("gradeButton").hidden=exam||results;$("nextButton").hidden=results;
  $("finishButton").hidden=!exam||retry||results;
  if(retry)$("nextButton").textContent=session.retryQuestions.indexOf(session.question)>=session.retryQuestions.length-1?"복습 결과":"다음 오답";
  else $("nextButton").textContent=session.question===10?"마지막 문제":"다음 문제";
  $("finishButton").textContent="시험 제출";$("gradeButton").textContent="채점하기";
  $("answerButton").disabled=(session.wrongCounts[session.question]||0)<2;
}
$("nextButton").addEventListener("click",async()=>{
  if(!session)return;
  if(session.mode==="retry"){const i=session.retryQuestions.indexOf(session.question);if(i>=session.retryQuestions.length-1){showFinalResults("오답 복습 결과");return;}await selectQuestion(session.retryQuestions[i+1]);return;}
  if(session.question<10)await selectQuestion(session.question+1);else finishSet(session.mode==="exam"?"시험 결과":"연습 결과");
});
$("finishButton").addEventListener("click",()=>finishSet(session&&session.mode==="exam"?"시험 결과":"연습 결과"));
$("homeButton").addEventListener("click",leaveWorkspace);
$("moreButton").addEventListener("click",event=>{event.stopPropagation();const menu=$("moreMenu");menu.hidden=!menu.hidden;$("moreButton").setAttribute("aria-expanded",String(!menu.hidden));});
document.addEventListener("click",event=>{if(!event.target.closest(".more-wrap")){ $("moreMenu").hidden=true;$("moreButton").setAttribute("aria-expanded","false"); }});
$("moreMenu").addEventListener("click",event=>{if(event.target.closest("button")){ $("moreMenu").hidden=true;$("moreButton").setAttribute("aria-expanded","false"); }});
async function leaveWorkspace(){
  if(session&&session.phase!=="results"&&session.phase!=="done"){
    try{await requestProjectExport(session.question);}catch(error){showMessage("풀이를 저장하지 못했습니다",error.message);return;}
  }
  saveSession();
  try{await progressStore.flush();}catch(error){showMessage("기록을 저장하지 못했습니다",error.message);return;}
  document.body.classList.remove("in-workspace");workspace.hidden=true;workbar.hidden=true;startScreen.hidden=false;$("homeButton").hidden=true;$("examGate").hidden=true;$("moreMenu").hidden=true;$("moreButton").setAttribute("aria-expanded","false");refreshResume();
}

async function parseSb2(input){
  const snapshot=SnapshotCodec.snapshot(input instanceof Uint8Array?input:new Uint8Array(input));if(snapshot)return snapshot.project;
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let eocd=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){if(view.getUint32(i,true)===0x06054b50){eocd=i;break;}}
  if(eocd<0)throw new Error("SB2 ZIP 끝부분을 찾지 못했습니다.");
  const entries=view.getUint16(eocd+10,true);let cursor=view.getUint32(eocd+16,true);const decoder=new TextDecoder();
  for(let i=0;i<entries;i++){
    if(view.getUint32(cursor,true)!==0x02014b50)throw new Error("SB2 파일 형식이 올바르지 않습니다.");
    const method=view.getUint16(cursor+10,true),compressedSize=view.getUint32(cursor+20,true),nameLength=view.getUint16(cursor+28,true),extraLength=view.getUint16(cursor+30,true),commentLength=view.getUint16(cursor+32,true),localOffset=view.getUint32(cursor+42,true);
    const name=decoder.decode(bytes.subarray(cursor+46,cursor+46+nameLength));
    if(name==="project.json"){
      const start=localOffset+30+view.getUint16(localOffset+26,true)+view.getUint16(localOffset+28,true),compressed=bytes.slice(start,start+compressedSize);let data;
      if(method===0)data=compressed;else if(method===8)data=new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());else throw new Error("지원하지 않는 SB2 압축 방식입니다.");
      return JSON.parse(decoder.decode(data));
    }
    cursor+=46+nameLength+extraLength+commentLength;
  }
  throw new Error("SB2 안에서 project.json을 찾지 못했습니다.");
}
function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==="object"){const out={};Object.keys(value).sort().forEach(key=>{if(["id","spriteInfo","indexInLibrary"].indexOf(key)<0)out[key]=stable(value[key]);});return out;}
  return value;
}
function normalizeScripts(scripts){return(scripts||[]).map(script=>stable(Array.isArray(script)&&Array.isArray(script[2])?script[2]:script)).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));}
function normalizeCostumes(items){return(items||[]).map(item=>({name:item.costumeName||item.name||"",md5:item.baseLayerMD5||item.md5ext||"",bitmapResolution:item.bitmapResolution||1,rotationCenterX:item.rotationCenterX||0,rotationCenterY:item.rotationCenterY||0}));}
function normalizeSounds(items){return(items||[]).map(item=>({name:item.soundName||item.name||"",md5:item.md5||item.md5ext||"",rate:item.rate||0,sampleCount:item.sampleCount||0}));}
function normalizeVariables(items){
  if(Array.isArray(items))return items.map(item=>({name:item.name||"",value:item.value,isPersistent:!!item.isPersistent})).sort((a,b)=>a.name.localeCompare(b.name));
  return stable(items||{});
}
const FIELD_LABELS={scripts:"스크립트/블록",scratchX:"x 좌표",scratchY:"y 좌표",scale:"크기",direction:"방향",rotationStyle:"회전 방식",visible:"보이기/숨기기",currentCostumeIndex:"선택한 모양",costumes:"모양 목록",sounds:"소리",variables:"변수",lists:"리스트",tempoBPM:"박자"};
const BLOCK_LABELS={
  "forward:":"{0}만큼 움직이기","heading:":"{0}° 방향 보기","pointTowards:":"{0} 쪽 보기","bounceOffEdge":"벽에 닿으면 튕기기","setRotationStyle":"회전 방식을 {0}(으)로 정하기",
  "wait:elapsed:from:":"{0}초 기다리기","broadcast:":"{0} 신호 보내기","stopScripts":"{0} 멈추기","doAsk":"{0} 묻고 기다리기",
  "startScene":"배경을 {0}(으)로 바꾸기","startSceneAndWait":"배경을 {0}(으)로 바꾸고 기다리기","goBackByLayers:":"{0}번째로 물러나기","comeToFront":"맨 앞으로 순서 바꾸기",
  "setGraphicEffect:to:":"{0} 효과를 {1}(으)로 정하기","changeGraphicEffect:by:":"{0} 효과를 {1}만큼 바꾸기","filterReset":"그래픽 효과 지우기",
  "append:toList:":"{1} 리스트에 {0} 추가하기","deleteLine:ofList:":"{1} 리스트의 {0}번째 항목 삭제하기","setLine:ofList:to:":"{1} 리스트의 {0}번째 항목을 {2}(으)로 바꾸기","insert:at:ofList:":"{2} 리스트의 {1}번째에 {0} 넣기",
  "putPenDown":"펜 내리기","putPenUp":"펜 올리기","clearPenTrails":"지우기","stampCostume":"도장찍기","penSize:":"펜 굵기를 {0}(으)로 정하기","changePenSizeBy:":"펜 굵기를 {0}만큼 바꾸기","penColor:":"펜 색깔을 {0}(으)로 정하기","changePenHueBy:":"펜 색깔을 {0}만큼 바꾸기","setPenHueTo:":"펜 색깔을 {0}(으)로 정하기",
  "think:duration:elapsed:from:":"{0}을(를) {1}초 동안 생각하기","doPlaySoundAndWait":"{0} 끝까지 재생하기","timerReset":"타이머 초기화",
  hide:"숨기기",show:"보이기",lookLike:"모양 바꾸기",nextCostume:"다음 모양으로 바꾸기",previousCostume:"이전 모양으로 바꾸기",
  "lookLike:":"모양을 {0}(으)로 바꾸기","nextCostume":"다음 모양으로 바꾸기","previousCostume":"이전 모양으로 바꾸기",
  "gotoX:y:":"x: {0}, y: {1} 위치로 이동하기","gotoSpriteOrMouse:":"{0} 위치로 이동하기","glideSecs:toX:y:elapsed:from:":"{0}초 동안 x: {1}, y: {2}로 움직이기",
  "changeXposBy:":"x 좌표를 {0}만큼 바꾸기","xpos:":"x 좌표를 {0}(으)로 정하기","changeYposBy:":"y 좌표를 {0}만큼 바꾸기","ypos:":"y 좌표를 {0}(으)로 정하기",
  "setSizeTo:":"크기를 {0}%로 정하기","changeSizeBy:":"크기를 {0}만큼 바꾸기","setHeadingTo:":"방향을 {0}°로 정하기","turnRight:":"시계 방향으로 {0}° 돌기","turnLeft:":"반시계 방향으로 {0}° 돌기",
  "doForever":"무한 반복하기","doRepeat":"{0}번 반복하기","doIf":"만약 조건이 참이라면","doIfElse":"만약 조건이 참이라면","doUntil":"조건이 참이 될 때까지 반복하기","doWaitUntil":"조건이 참이 될 때까지 기다리기","doWait:elapsed:from:":"{0}초 기다리기",
  "doBroadcastAndWait":"{0} 신호 보내고 기다리기","doBroadcast":"{0} 신호 보내기","whenGreenFlag":"시작하기 버튼을 클릭했을 때","whenClicked":"오브젝트를 클릭했을 때","whenIReceive":"{0} 신호를 받았을 때","whenKeyPressed":"{0} 키를 눌렀을 때","whenCloned":"복제되었을 때",
  "setVar:to:":"{0}을(를) {1}(으)로 정하기","changeVar:by:":"{0}을(를) {1}만큼 바꾸기","createCloneOf":"{0} 복제하기","deleteClone":"이 복제본 삭제하기","nextCostume":"다음 모양으로 바꾸기",
  "say:":"{0} 말하기","say:duration:elapsed:from:":"{0}을(를) {1}초 동안 말하기","think:":"{0} 생각하기","playSound:":"{0} 재생하기","stopAllSounds":"모든 소리 끄기"
};
function blockLabel(block){
  if(!Array.isArray(block)||!block.length)return "블록";
  const opcode=String(block[0]);
  if(opcode==="createCloneOf")return ((block[1]==="_myself_"||block[1]==="myself"||block[1]==null)?"나 자신":String(block[1]))+" 복제하기";
  if(opcode==="doIf"||opcode==="doIfElse")return "만약 "+expressionLabel(block[1])+"(이)라면";
  if(opcode==="doUntil"||opcode==="doWaitUntil")return expressionLabel(block[1])+"(이) 될 때까지 "+(opcode==="doUntil"?"반복하기":"기다리기");
  if(opcode==="procDef")return "정의하기: "+String(block[1]||"");
  if(opcode==="call") {let index=2;return String(block[1]||"추가 블록").replace(/%[nsb]/g,()=>"["+expressionLabel(block[index++])+"]");}
  const template=BLOCK_LABELS[opcode];
  return template?template.replace(/\{(\d+)\}/g,(_,index)=>expressionLabel(block[Number(index)+1])):expressionLabel(block);
}
function expressionLabel(value){
  if(!Array.isArray(value))return ({_mouse_:"마우스 포인터",_edge_:"벽",_myself_:"나 자신",space:"스페이스",all:"모두","this script":"이 스크립트","other scripts in sprite":"이 스프라이트의 다른 스크립트","left-right":"왼쪽-오른쪽",normal:"회전하기",none:"회전하지 않기",color:"색깔",ghost:"투명도",fisheye:"어안 렌즈",whirl:"소용돌이",pixelate:"픽셀화",mosaic:"모자이크",brightness:"밝기"})[value]??String(value??"빈 값");
  const op=value[0],arg=index=>expressionLabel(value[index]);
  if(op==="readVariable")return String(value[1]||"변수");
  if(op==="getParam")return String(value[1]||"입력값");
  if(op==="concatenate:with:"||op==="join")return "["+arg(1)+"]와 ["+arg(2)+"] 결합하기";
  if(op==="randomFrom:to:")return "("+arg(1)+"부터 "+arg(2)+" 사이의 난수)";
  if(op==="getAttribute:of:")return arg(2)+"의 "+(({"costume #":"모양 번호","costume name":"모양 이름","backdrop #":"배경 번호","backdrop name":"배경 이름","x position":"x 좌표","y position":"y 좌표",direction:"방향",size:"크기",volume:"음량"})[value[1]]||arg(1));
  if(op==="letter:of:"||op==="letterOf")return "["+arg(2)+"]의 "+arg(1)+"번째 글자";
  if(op==="stringLength:")return "["+arg(1)+"]의 길이";
  if(op==="getLine:ofList:")return arg(2)+" 리스트의 "+arg(1)+"번째 항목";
  if(op==="lineCountOfList:")return arg(1)+" 리스트의 길이";
  if(op==="list:contains:")return arg(1)+" 리스트에 "+arg(2)+"이(가) 포함되어 있는가";
  if(op==="touching:")return arg(1)+"에 닿았는가";
  if(op==="touchingColor:")return arg(1)+" 색에 닿았는가";
  if(op==="distanceTo:")return arg(1)+"까지의 거리";
  if(op==="mousePressed")return "마우스를 클릭했는가";
  if(op==="answer")return "대답";
  if(op==="timer")return "타이머";
  if(op==="volume")return "음량";
  if(op==="computeFunction:of:")return arg(2)+"의 "+(({abs:"절댓값",floor:"버림",ceiling:"올림",sqrt:"제곱근",sin:"사인",cos:"코사인",tan:"탄젠트",asin:"아크사인",acos:"아크코사인",atan:"아크탄젠트",ln:"자연로그",log:"로그","e ^":"e의 거듭제곱","10 ^":"10의 거듭제곱"})[value[1]]||arg(1));
  if(op==="rounded")return arg(1)+" 반올림";
  if(op==="costumeIndex")return "모양 번호";
  if(op==="xpos")return "x 좌표";if(op==="ypos")return "y 좌표";if(op==="direction")return "방향";if(op==="size")return "크기";
  if(op==="mouseX")return "마우스 x 좌표";if(op==="mouseY")return "마우스 y 좌표";if(op==="keyPressed:")return arg(1)+" 키가 눌렸는가";
  const operators={"=":"=","<":"<",">":">","&":" 그리고 ","|":" 또는 ","+":"+","-":"−","*":"×","/":"÷","%":" 나머지 ",join:" 와 ",letterOf:"번째 글자",contains:"포함하는가"};
  if(operators[op])return op==="&"||op==="|"?arg(1)+operators[op]+arg(2):op==="letterOf"?arg(2)+"번째 글자("+arg(1)+")":arg(1)+" "+operators[op]+" "+arg(2);
  if(op==="not")return arg(1)+"이(가) 아니다";
  if(BLOCK_LABELS[op])return BLOCK_LABELS[op].replace(/\{(\d+)\}/g,(_,index)=>arg(Number(index)+1));
  return "추가 블록 (입력값: "+value.slice(1).map(part=>expressionLabel(part)).join(", ")+")";
}
function eventLabel(block){
  if(!Array.isArray(block))return "시작 블록";
  const opcode=block[0];
  if(opcode==="whenGreenFlag")return "시작하기 버튼 클릭 시";
  if(opcode==="whenClicked")return "오브젝트를 클릭했을 때";
  if(opcode==="whenIReceive")return String(block[1]||"신호")+" 신호를 받았을 때";
  if(opcode==="whenKeyPressed")return expressionLabel(block[1])+" 키를 눌렀을 때";
  if(opcode==="whenCloned")return "복제되었을 때";
  return blockLabel(block);
}
function compatibleBlocks(a,b,allowedVariables=[]){
  if(!a||!b)return false;
  return a[0]===b[0]||(allowedVariables.includes(a[1])&&a[1]===b[1]&&["setVar:to:","changeVar:by:"].includes(a[0])&&["setVar:to:","changeVar:by:"].includes(b[0]));
}
function equivalentAssignments(expected,actual,allowedVariables=[]){
  return expected?.[0]!==actual?.[0]&&compatibleBlocks(expected,actual,allowedVariables)&&allowedVariables.includes(expected[1])&&same(stable(expected[2]),stable(actual[2]));
}
const NESTED_BLOCKS={doForever:[1],doRepeat:[2],doIf:[2],doIfElse:[2,3],doUntil:[2],doRepeatUntil:[2],doWhile:[2],doForLoop:[3]};
function blockHeader(block,costumes=[]){
  if(!Array.isArray(block))return block;
  const copy=block.map(value=>Array.isArray(value)?stable(value):value);
  if(block[0]==="lookLike:"&&typeof block[1]==="string"){
    const index=(costumes||[]).findIndex(costume=>(costume.costumeName||costume.name)===block[1]);
    if(index>=0)copy[1]="costume-id:"+String(costumes[index].baseLayerID??index);
  }
  (NESTED_BLOCKS[block[0]]||[]).forEach(index=>{if(index<copy.length)copy[index]=null;});
  return stable(copy);
}
function lcsBlockMatches(list,reference){
  const dp=Array.from({length:list.length+1},()=>Array(reference.length+1).fill(0)),matches=Array(list.length).fill(null);
  for(let i=list.length-1;i>=0;i--)for(let j=reference.length-1;j>=0;j--)dp[i][j]=list[i]?.[0]===reference[j]?.[0]?1+dp[i+1][j+1]:Math.max(dp[i+1][j],dp[i][j+1]);
  let i=0,j=0;while(i<list.length&&j<reference.length){if(list[i]?.[0]===reference[j]?.[0]){matches[i]=reference[j];i++;j++;}else if(dp[i+1][j]>=dp[i][j+1])i++;else j++;}
  return matches;
}
function compareBlockLists(expected=[],actual=[],expectedCostumes=[],actualCostumes=[],baseline=[],baselineCostumes=[],allowedVariables=[]){
  const rows=[],baselineMatches=lcsBlockMatches(expected,baseline),dp=Array.from({length:expected.length+1},()=>Array(actual.length+1).fill(0)),matchedActual=new Set();
  for(let i=expected.length-1;i>=0;i--)for(let j=actual.length-1;j>=0;j--)dp[i][j]=compatibleBlocks(expected[i],actual[j],allowedVariables)?1+dp[i+1][j+1]:Math.max(dp[i+1][j],dp[i][j+1]);
  let i=0,j=0;
  while(i<expected.length||j<actual.length){
    const exp=expected[i],act=actual[j];
    if(exp&&act&&compatibleBlocks(exp,act,allowedVariables)){
      const expNested=NESTED_BLOCKS[exp[0]]||[],actNested=NESTED_BLOCKS[act[0]]||[],base=baselineMatches[i];
      const exact=same(blockHeader(exp,expectedCostumes),blockHeader(act,actualCostumes));
      const equivalent=!exact&&equivalentAssignments(exp,act,allowedVariables);
      const headersMatch=exact||equivalent;
      const changed=!base||!same(blockHeader(exp,expectedCostumes),blockHeader(base,baselineCostumes));matchedActual.add(j);
      rows.push({label:equivalent?blockLabel(act):blockLabel(exp),actualLabel:blockLabel(act),ok:headersMatch,criterion:changed,alias:equivalent||headersMatch&&exp[0]==="lookLike:"&&String(exp[1])!==String(act[1]),aliasNote:equivalent?"정답의 ‘"+blockLabel(exp)+"’와 같은 계산 결과를 만드는 풀이로 인정했습니다.":headersMatch&&exp[0]==="lookLike:"&&String(exp[1])!==String(act[1])?`답안 파일의 모양 이름 '${exp[1]}'과 시작 파일의 모양 이름 '${act[1]}'은 같은 그림으로 인정했습니다.`:"",children:expNested.map((position,n)=>compareBlockLists(Array.isArray(exp[position])?exp[position]:[],Array.isArray(act[actNested[n]])?act[actNested[n]]:[],expectedCostumes,actualCostumes,Array.isArray(base?.[position])?base[position]:[],baselineCostumes,allowedVariables)).flat()});i++;j++;continue;
    }
    if(exp&&(!act||dp[i+1][j]>=dp[i][j+1])){const base=baselineMatches[i],expNested=NESTED_BLOCKS[exp[0]]||[];rows.push({label:blockLabel(exp),actualLabel:"",ok:false,criterion:!base||!same(blockHeader(exp,expectedCostumes),blockHeader(base,baselineCostumes)),children:expNested.flatMap(position=>compareBlockLists(Array.isArray(exp[position])?exp[position]:[],[],expectedCostumes,actualCostumes,Array.isArray(base?.[position])?base[position]:[],baselineCostumes,allowedVariables))});i++;continue;}
    matchedActual.add(j);j++;
  }
  const deletedBaseline=baseline.filter((_,index)=>!lcsBlockMatches(expected,baseline).some(match=>match===baseline[index]));
  deletedBaseline.forEach(block=>{
    const index=actual.findIndex((candidate,candidateIndex)=>!matchedActual.has(candidateIndex)&&candidate?.[0]===block?.[0]&&same(blockHeader(candidate,actualCostumes),blockHeader(block,baselineCostumes)));
    const found=index>=0?actual[index]:null;if(found)matchedActual.add(index);
    rows.push({label:"삭제: "+blockLabel(block),actualLabel:found?blockLabel(found):"",ok:!found,criterion:true,extra:!!found});
  });
  actual.forEach((block,index)=>{if(!matchedActual.has(index))rows.push({label:"기준에 없는 블록",actualLabel:blockLabel(block),ok:false,criterion:true,extra:true});});
  return rows;
}
function blockRowsOk(rows){return rows.every(row=>row.ok&&blockRowsOk(row.children||[]));}
function blockCriterionStats(rows){let correct=0,total=0;rows.forEach(row=>{if(row.criterion){total++;if(row.ok)correct++;}const nested=blockCriterionStats(row.children||[]);correct+=nested.correct;total+=nested.total;});return{correct,total};}
function checkCriterionStats(check){
  if(check.scriptEvents){let correct=0,total=0;check.scriptEvents.forEach(event=>{if(event.triggerCheck){total++;if(event.triggerCheck.ok)correct++;}const blocks=blockCriterionStats(event.blocks);correct+=blocks.correct;total+=blocks.total;});return{correct,total};}
  return{correct:check.ok?1:0,total:1};
}
function checksCriterionStats(checks){return checks.reduce((sum,check)=>{const stats=checkCriterionStats(check);sum.correct+=stats.correct;sum.total+=stats.total;return sum;},{correct:0,total:0});}
function makeScriptFeedback(expectedScripts=[],actualScripts=[],includeExtras=true,baselineScripts=[],expectedObject=null,actualObject=null,baselineObject=null,assignmentAlternatives=[]){
  const unused=actualScripts.slice(),events=[];
  expectedScripts.forEach(script=>{
    const expectedBlocks=Array.isArray(script?.[2])?script[2]:[],trigger=expectedBlocks[0],opcode=trigger?.[0];
    let index=unused.findIndex(candidate=>candidate?.[2]?.[0]?.[0]===opcode&&same(stable(candidate[2][0]),stable(trigger)));
    if(index<0)index=unused.findIndex(candidate=>candidate?.[2]?.[0]?.[0]===opcode);
    const actual=index>=0?unused.splice(index,1)[0]:null,actualBlocks=Array.isArray(actual?.[2])?actual[2]:[];
    const baseline=baselineScripts.find(previous=>same(stable(previous?.[2]?.[0]),stable(trigger)));
    const triggerChanged=!baseline||!same(stable(baseline?.[2]?.[0]),stable(trigger));
    const triggerCheck=triggerChanged?{ok:!!actual&&same(stable(actualBlocks[0]),stable(trigger)),label:"시작 조건: "+eventLabel(trigger),actual:actual?eventLabel(actualBlocks[0]):"시작 조건 없음"}:null;
    const allowedVariables=opcode==="procDef"?assignmentAlternatives.filter(rule=>rule.procedure===trigger[1]).map(rule=>rule.variable):[];
    const blocks=compareBlockLists(expectedBlocks.slice(1),actualBlocks.slice(1),expectedObject?.costumes||[],actualObject?.costumes||[],Array.isArray(baseline?.[2])?baseline[2].slice(1):[],baselineObject?.costumes||[],allowedVariables);
    const blockStats=blockCriterionStats(blocks);
    events.push({label:eventLabel(trigger),ok:(!triggerCheck||triggerCheck.ok)&&blockStats.correct===blockStats.total,triggerCheck,blocks:blocks});
  });
  if(includeExtras)unused.forEach(script=>events.push({label:"기준에 없는 스크립트",ok:false,triggerCheck:null,blocks:compareBlockLists([],Array.isArray(script?.[2])?script[2].slice(1):[],[],actualObject?.costumes||[])}));
  return events;
}
function changedScriptsFromBaseline(baseline=[],target=[]){
  const unused=baseline.slice();
  return target.filter(script=>{
    const trigger=script?.[2]?.[0];
    const index=unused.findIndex(previous=>same(stable(previous?.[2]?.[0]),stable(trigger)));
    if(index<0)return true;
    const previous=unused.splice(index,1)[0];
    return !same(normalizeScripts([previous]),normalizeScripts([script]));
  });
}
function scriptRubricScope(starter,answer){
  const starts=mapObjects(starter),targets=mapObjects(answer),objects={};let hasScriptCriteria=false;
  targets.forEach((target,name)=>{
    const original=starts.get(name);if(!original)return;
    if(changedScriptsFromBaseline(original.scripts,target.scripts).length){objects[name]=["scripts"];hasScriptCriteria=true;}
  });
  const stageScripts=changedScriptsFromBaseline(starter.scripts,answer.scripts);
  return hasScriptCriteria||stageScripts.length?{objects:objects,stage:stageScripts.length?["scripts"]:[],hasScriptCriteria:true}:null;
}
// Explicit exceptions only: a required block must remain required in other questions.
const QUESTION_ASSIGNMENT_ALTERNATIVES={
  "2/1/5":[{objectName:"고양이",procedure:"계산 %n",variable:"결과"}]
};
function questionRubricScope(starter,answer,grade,set,question){
  const scope=scriptRubricScope(starter,answer);
  const alternatives=QUESTION_ASSIGNMENT_ALTERNATIVES[[grade,set,question].join("/")];
  return scope&&alternatives?{...scope,assignmentAlternatives:alternatives}:scope;
}
function displayFieldValue(field,value,object){
  if(value===null||value===undefined)return "없음";
  if(field==="visible")return value?"보이기":"숨기기";
  if(field==="direction")return value+"°";
  if(field==="scale")return value+"%";
  if(field==="scratchX"||field==="scratchY")return value+" 위치";
  if(field==="currentCostumeIndex")return object?.costumes?.[Number(value)-1]?.costumeName||object?.costumes?.[Number(value)-1]?.name||("모양 "+value);
  if(field==="rotationStyle")return ({normal:"자유 회전","left-right":"좌우 회전",none:"회전 안 함"})[value]||String(value);
  if(field==="tempoBPM")return value+" BPM";
  if(field==="costumes")return (value||[]).map(item=>item.costumeName||item.name||"모양").join(", ")||"모양 없음";
  if(field==="sounds")return (value||[]).map(item=>item.soundName||item.name||"소리").join(", ")||"소리 없음";
  if(field==="variables"||field==="lists")return Array.isArray(value)?(value.map(item=>item.name||item[0]||"").filter(Boolean).join(", ")||"없음"):(Object.keys(value||{}).join(", ")||"없음");
  return typeof value==="object"?"내용 확인":String(value);
}
function normalizeField(field,value){
  if(field==="scripts")return normalizeScripts(value);if(field==="costumes")return normalizeCostumes(value);if(field==="sounds")return normalizeSounds(value);if(field==="variables"||field==="lists")return normalizeVariables(value);return stable(value);
}
function objectKey(object,index){return object.objName||"이름 없는 오브젝트 "+(index+1);}
function mapObjects(project){const result=new Map();(project.children||[]).forEach((object,index)=>{if(object&&typeof object==="object")result.set(objectKey(object,index),object);});return result;}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function normalizeObject(object){
  const result={};Object.keys(object).sort().forEach(field=>{if(["id","spriteInfo","indexInLibrary"].indexOf(field)>=0)return;result[field]=normalizeField(field,object[field]);});return result;
}
function normalizeProject(project){
  const copy={};["variables","lists","scripts","tempoBPM"].forEach(field=>copy[field]=normalizeField(field,project[field]));
  copy.children=[...mapObjects(project).entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(entry=>[entry[0],normalizeObject(entry[1])]);return copy;
}
function gradeProjects(starter,answer,student,scope=null){
  const checks=[],fields=["scripts","scratchX","scratchY","scale","direction","rotationStyle","visible","currentCostumeIndex","costumes","sounds","variables","lists","tempoBPM"];
  const starts=mapObjects(starter),targets=mapObjects(answer),students=mapObjects(student);
  targets.forEach((target,name)=>{
    if(scope&&!Object.hasOwn(scope.objects||{},name))return;
    const original=starts.get(name),submitted=students.get(name);
    if(!original){checks.push({label:name+" 오브젝트 추가",objectName:name,field:"object",ok:!!submitted,expected:"가져오기",actual:submitted?"가져옴":"없음"});return;}
    const objectFields=scope?(scope.objects[name]||[]):fields;
    if(!submitted){objectFields.forEach(field=>{if(!same(normalizeField(field,original[field]),normalizeField(field,target[field]))){const expectedScripts=field==="scripts"&&scope?changedScriptsFromBaseline(original.scripts,target.scripts):target.scripts;checks.push({label:name+" · "+(FIELD_LABELS[field]||field),objectName:name,field,ok:false,expected:field==="scripts"?null:displayFieldValue(field,target[field],target),actual:"오브젝트가 없습니다",scriptEvents:field==="scripts"?makeScriptFeedback(expectedScripts,[],!scope,original.scripts,target,null,original,(scope?.assignmentAlternatives||[]).filter(rule=>rule.objectName===name)):null});}});return;}
    objectFields.forEach(field=>{if(!same(normalizeField(field,original[field]),normalizeField(field,target[field]))){const expectedScripts=field==="scripts"&&scope?changedScriptsFromBaseline(original.scripts,target.scripts):target.scripts;const scriptEvents=field==="scripts"?makeScriptFeedback(expectedScripts,submitted.scripts,!scope,original.scripts,target,submitted,original,(scope?.assignmentAlternatives||[]).filter(rule=>rule.objectName===name)):null;const value={label:name+" · "+(FIELD_LABELS[field]||field),objectName:name,field,ok:field==="scripts"&&scope?scriptEvents.length>0&&scriptEvents.every(event=>event.ok):same(normalizeField(field,submitted[field]),normalizeField(field,target[field]))};if(field==="scripts")value.scriptEvents=scriptEvents;else{value.expected=displayFieldValue(field,target[field],target);value.actual=displayFieldValue(field,submitted[field],submitted);}checks.push(value);}});
  });
  starts.forEach((_,name)=>{if(!scope&&!targets.has(name))checks.push({label:name+" 오브젝트 삭제",objectName:name,field:"object",ok:!students.has(name),expected:"삭제",actual:students.has(name)?"남아 있음":"삭제됨"});});
  (scope?(scope.stage||[]):["scripts","variables","lists","tempoBPM"]).forEach(field=>{if(!same(normalizeField(field,starter[field]),normalizeField(field,answer[field]))){const value={label:"무대 · "+(FIELD_LABELS[field]||field),objectName:"무대",field,ok:same(normalizeField(field,student[field]),normalizeField(field,answer[field]))};if(field==="scripts")value.scriptEvents=makeScriptFeedback(answer.scripts,student.scripts,!scope,starter.scripts,answer,student,starter);else{value.expected=displayFieldValue(field,answer[field],answer);value.actual=displayFieldValue(field,student[field],student);}checks.push(value);}});
  if(!checks.length)checks.push({label:"프로젝트 내용",ok:same(normalizeProject(student),normalizeProject(answer))});
  const stats=checksCriterionStats(checks),total=stats.total||checks.length,correct=stats.total?stats.correct:checks.filter(item=>item.ok).length;return{score:Math.round(correct/total*100),correct:correct,total:total,checks:checks};
}
async function fetchSampleProject(kind,q){
  const key=sampleKey(session.grade,session.set,q,kind);if(sampleCache.has(key))return sampleCache.get(key);
  const response=await fetch(dataPath(kind,q));if(!response.ok)throw new Error("문제 "+q+" 자료를 불러오지 못했습니다.");
  const project=await parseSb2(new Uint8Array(await response.arrayBuffer()));sampleCache.set(key,project);return project;
}
async function gradeOne(q,projectBytes=null){
  const bytes=projectBytes||await getAnswerBytes(answerKey(q));
  if(!bytes)return{score:0,correct:0,total:1,checks:[{label:"저장한 .sb2 답안",ok:false}]};
  const loaded=await Promise.all([fetchSampleProject("starter",q),fetchSampleProject("answer",q),parseSb2(bytes)]);
  const result=gradeProjects(loaded[0],loaded[1],loaded[2],questionRubricScope(loaded[0],loaded[1],session.grade,session.set,q));
  await orderChecksByProblem(result.checks,q);
  return result;
}
const problemTextCache=new Map();
async function orderChecksByProblem(checks,q){
  const url=dataPath("problem",q),order=window.problemPages?.[url]?.subjectOrder||[];
  const rank=name=>{const index=order.indexOf(name);return index<0?Infinity:index;};
  checks.sort((a,b)=>{const x=rank(a.objectName),y=rank(b.objectName);return x===y?0:x<y?-1:1;});
}
function gradingOnlyBlocks(blocks){
  return (blocks||[]).flatMap(block=>{
    const children=gradingOnlyBlocks(block.children);
    return block.criterion===false&&!block.extra?children:[{...block,children}];
  });
}
function gradingOnlyChecks(checks){
  return checks.flatMap(check=>{
    if(!check.scriptEvents)return [check];
    const scriptEvents=check.scriptEvents.map(event=>({...event,blocks:gradingOnlyBlocks(event.blocks)}))
      .filter(event=>event.triggerCheck||event.blocks.length);
    return scriptEvents.length?[{...check,scriptEvents}]:[];
  });
}
async function gradeCurrent(question,projectBytes=null){
  if(!session)return;
  const q=Number.isInteger(question)?question:session.question;
  $("gradeButton").disabled=true;
  try{
    $("saveHint").textContent="현재 블록 채점 중…";
    const bytes=projectBytes||await requestProjectExport(q,false),graded=await gradeOne(q,bytes);session.scores[q]=graded;
    session.attempts[q]=(session.attempts[q]||0)+1;
    if(graded.score<100)session.wrongCounts[q]=(session.wrongCounts[q]||0)+1;
    saveSession();if(session.question===q)$("questionScore").textContent=graded.score+"점";$("saveHint").textContent="현재 풀이 채점 완료";updateQuestionNav();updateControls();showQuestionResult(q,graded);
    if(graded.score===100)celebratePerfectScore();
  }catch(error){$("saveHint").textContent="채점에 실패했습니다";showMessage("채점을 완료하지 못했습니다",error.message||"Scratch 프로젝트를 읽지 못했습니다.");console.error(error);}
  finally{$("gradeButton").disabled=false;}
}
$("gradeButton").addEventListener("click",()=>gradeCurrent());
$("answerButton").addEventListener("click",async()=>{
  if((session.wrongCounts[session.question]||0)<2)return;
  if(!confirm("정답 프로젝트를 열면 저장하지 않은 풀이가 바뀝니다. 계속할까요?"))return;
  await loadCurrentProject("answer");
});
$("redoButton").addEventListener("click",async()=>{
  if(!confirm("이 문제의 풀이와 현재 점수를 지우고 시작 상태로 되돌릴까요? 이전 채점 횟수는 유지됩니다."))return;
  await deleteAnswerBytes(answerKey());delete session.scores[session.question];
  saveSession();await loadCurrentProject("starter");updateQuestionNav();updateControls();$("questionScore").textContent="미채점";
});
$("answerFile").addEventListener("change",async event=>{
  const file=event.target.files&&event.target.files[0];if(!file||!session)return;
  try{const savedSessionId=session.id,savedQuestion=session.question,bytes=new Uint8Array(await file.arrayBuffer());await saveAnswerBytes(answerKey(savedQuestion),bytes);$("saveHint").textContent="풀이 파일 저장 완료";$("editorStatus").textContent="가져온 풀이 저장 완료";const shouldGrade=session.id===savedSessionId&&session.mode!=="exam";if(shouldGrade)await gradeCurrent(savedQuestion,bytes);}
  catch(error){showMessage("답안 파일을 불러오지 못했습니다",error.message);}
  event.target.value="";updateQuestionNav();
});
function showMessage(title,message){
  $("resultTitle").textContent=title;$("resultSummary").className="result-summary";$("resultSummary").textContent=message;$("resultRows").replaceChildren();$("resultActions").replaceChildren();
  const close=document.createElement("button");close.className="secondary";close.textContent="확인";close.addEventListener("click",()=>$("resultOverlay").hidden=true);$("resultActions").append(close);$("resultOverlay").hidden=false;
}
function fillResultRows(results){
  const container=$("resultRows");container.replaceChildren();
  const multi=results.length>1,firstWrong=results.findIndex(item=>item.score<100);
  results.forEach((item,index)=>{
    const checks=gradingOnlyChecks(item.checks||[]),stats=checksCriterionStats(checks),correct=stats.correct,total=stats.total||checks.length;
    const card=multi?document.createElement("details"):document.createElement("article");card.className="result-question-card";
    if(multi)card.open=index===firstWrong;
    const head=multi?document.createElement("summary"):document.createElement("div");head.className="result-question-head";
    const title=document.createElement("strong");title.textContent=item.q+"번 문제 · 맞은 블록 "+correct+"/"+total;
    const score=document.createElement("span");score.className="result-score-badge "+(item.score===100?"pass":"fail");score.textContent=item.score+"점";head.append(title,score);if(multi)card.append(head);
    const subjects=new Map();checks.forEach(check=>{const name=check.objectName||check.label.split(" · ")[0]||"프로젝트";if(!subjects.has(name))subjects.set(name,[]);subjects.get(name).push(check);});
    let subjectIndex=0;
    subjects.forEach((subjectChecks,name)=>{
      const subject=document.createElement("section");subject.className="result-subject-card";
      const subjectColors=["#328f87","#586fc1","#9a5eb2","#b77928","#347ea8","#b65c79"];
      const subjectColor=({"망치":"#586fc1","못":"#328f87"})[name]||subjectColors[subjectIndex%subjectColors.length];
      subject.style.setProperty("--subject-color",subjectColor);
      const subjectHead=document.createElement("div");subjectHead.className="result-subject-head";
      const indexBadge=document.createElement("span");indexBadge.className="result-subject-index";indexBadge.textContent=String(++subjectIndex).padStart(2,"0");
      const subjectName=document.createElement("div");subjectName.className="result-subject-name";
      const kind=document.createElement("small");kind.textContent=name==="무대"?"무대":"스프라이트";
      const nameText=document.createElement("strong");nameText.textContent=name;subjectName.append(kind,nameText);
      const subjectStats=checksCriterionStats(subjectChecks),subjectCorrect=subjectStats.correct,subjectTotal=subjectStats.total||subjectChecks.length;
      const badge=document.createElement("span");badge.className="result-subject-badge "+(subjectCorrect===subjectTotal?"pass":"fail");badge.textContent=subjectCorrect===subjectTotal?"모두 정답 · "+subjectCorrect+"/"+subjectTotal:("확인 필요 "+(subjectTotal-subjectCorrect)+"개 · "+subjectCorrect+"/"+subjectTotal);
      subjectHead.append(indexBadge,subjectName,badge);subject.append(subjectHead);
      const fieldChecks=subjectChecks.filter(check=>!check.scriptEvents);
      if(fieldChecks.length){
        const section=document.createElement("section");section.className="result-event-section";
        const sectionHead=document.createElement("div");sectionHead.className="result-event-head";sectionHead.textContent=subjectChecks.some(check=>check.scriptEvents)?"오브젝트 속성":"확인 항목";section.append(sectionHead);
        const list=document.createElement("div");list.className="result-check-list";
        fieldChecks.forEach(check=>{
          const row=document.createElement("div");row.className="result-check-row "+(check.ok?"correct":"incorrect");
          const mark=document.createElement("span");mark.className="result-check-mark";mark.textContent=check.ok?"✓":"×";
          const text=document.createElement("div");text.className="result-check-text";const label=document.createElement("strong");label.textContent=check.field&&FIELD_LABELS[check.field]?FIELD_LABELS[check.field]:check.label.replace(name+" · ","");text.append(label);
          if(check.expected!==undefined||check.actual!==undefined){const values=document.createElement("small");values.textContent="정답: "+(check.expected??"없음")+" · 현재: "+(check.actual??"없음");text.append(values);}
          row.append(mark,text);list.append(row);
        });
        section.append(list);subject.append(section);
      }
      subjectChecks.filter(check=>check.scriptEvents).forEach(check=>check.scriptEvents.forEach(event=>{
        const eventSection=document.createElement("details");eventSection.className="result-event-section "+(event.ok?"all-correct":"has-errors");eventSection.open=true;
        const sectionHead=document.createElement("summary");sectionHead.className="result-event-head";
        const eventName=document.createElement("strong");eventName.textContent=event.label;sectionHead.append(eventName);eventSection.append(sectionHead);
        const list=document.createElement("div");list.className="result-block-tree";
        if(event.triggerCheck){const row=document.createElement("div");row.className="result-check-row block-row "+(event.triggerCheck.ok?"correct":"incorrect");const mark=document.createElement("span");mark.className="result-check-mark";mark.textContent=event.triggerCheck.ok?"✓":"×";const text=document.createElement("div");text.className="result-check-text";const label=document.createElement("strong");label.textContent=event.triggerCheck.label;text.append(label);if(!event.triggerCheck.ok){const actual=document.createElement("small");actual.textContent="현재: "+event.triggerCheck.actual;text.append(actual);}row.append(mark,text);list.append(row);}
        if(!event.blocks.length){const empty=document.createElement("div");empty.className="result-check-row incorrect";empty.textContent="실행할 블록이 없습니다.";list.append(empty);}
        const renderBlock=(block,parent)=>{
          const context=block.criterion===false&&!block.extra;
          const row=document.createElement("div");row.className="result-check-row block-row "+(context?"context":block.ok?"correct":"incorrect");
          const mark=document.createElement("span");mark.className="result-check-mark";mark.textContent=context?"·":block.ok?"✓":"×";
          const text=document.createElement("div");text.className="result-check-text";const label=document.createElement("strong");label.textContent=block.extra?(block.label.startsWith("삭제:")?block.label:"추가된 블록: "+block.actualLabel):block.label;text.append(label);
          if(!block.ok&&!block.extra){const actual=document.createElement("small");actual.textContent=block.actualLabel?"현재: "+block.actualLabel:"현재 블록 없음";text.append(actual);}
          if(block.alias){const alias=document.createElement("small");alias.textContent=block.aliasNote;text.append(alias);}
          row.append(mark,text);parent.append(row);
          if(block.children?.length){const nested=document.createElement("div");nested.className="result-block-nested";block.children.forEach(child=>renderBlock(child,nested));parent.append(nested);}
        };
        event.blocks.forEach(block=>renderBlock(block,list));eventSection.append(list);subject.append(eventSection);
      }));
      card.append(subject);
    });
    if(!checks.length){const empty=document.createElement("p");empty.className="result-empty";empty.textContent="채점 기준을 찾지 못했습니다.";card.append(empty);}
    container.append(card);
  });
}
function showQuestionResult(q,result){
  $("resultTitle").textContent="문제 "+q+" 채점 결과";$("resultSummary").className="result-summary result-score-summary";$("resultSummary").textContent=result.score+"점";fillResultRows([{q:q,score:result.score,checks:result.checks}]);
  $("resultActions").replaceChildren();const close=document.createElement("button");close.className="result-close-button";close.textContent="닫기";close.addEventListener("click",()=>$("resultOverlay").hidden=true);$("resultActions").append(close);$("resultRows").scrollTop=0;$("resultOverlay").hidden=false;
}
async function finishSet(title,expired){
  if(!session||session.phase==="results")return;
  if(session.mode==="exam"&&!expired&&!confirm("시험을 제출하고 결과를 확인할까요?"))return;
  $("finishButton").disabled=true;$("nextButton").disabled=true;
  try{
    await requestProjectExport(session.question);
    const results=[];for(const q of QUESTIONS)results.push({q:q,...await gradeOne(q)});
    session.scores=Object.fromEntries(results.map(item=>[item.q,{score:item.score,correct:item.correct,total:item.total,checks:item.checks}]));
    session.phase="results";session.finishedAt=Date.now();saveSession();ticking=false;if(timerId!==null){clearInterval(timerId);timerId=null;}
    const score=Math.round(results.reduce((sum,item)=>sum+item.score,0)/results.length);
    const history=localGet(HISTORY_KEY,[]);history.push({id:session.id,student:session.student,grade:session.grade,set:session.set,mode:session.mode,score:score,finishedAt:session.finishedAt,results:results.map(item=>({q:item.q,score:item.score}))});localSet(HISTORY_KEY,history.slice(-300));
    showSetResults(title,results,score);
    if(results.every(item=>item.score===100))celebratePerfectScore();
  }catch(error){showMessage("세트 채점 오류",error.message);console.error(error);}
  finally{$("finishButton").disabled=false;$("nextButton").disabled=false;}
}
function showFinalResults(title){
  const results=currentList().map(q=>({q:q,...(session.scores[q]||{score:0,correct:0,total:1,checks:[]})}));
  const score=Math.round(results.reduce((sum,item)=>sum+item.score,0)/Math.max(1,results.length));showSetResults(title,results,score);
}
function showSetResults(title,results,score){
  $("resultTitle").textContent=title;$("resultSummary").className="result-summary";$("resultSummary").textContent=session.student+" · COS "+session.grade+"급 샘플 "+session.set+" · 평균 "+score+"점";fillResultRows(results);$("resultActions").replaceChildren();
  const wrong=results.filter(item=>item.score<100).map(item=>item.q);
  if(wrong.length){const retry=document.createElement("button");retry.className="primary";retry.textContent="오답 "+wrong.length+"문제 다시 풀기";retry.addEventListener("click",()=>beginRetry(wrong));$("resultActions").append(retry);}
  const home=document.createElement("button");home.className="dark";home.textContent="처음 화면";home.addEventListener("click",()=>{$("resultOverlay").hidden=true;leaveWorkspace();});$("resultActions").append(home);$("resultOverlay").hidden=false;
}
async function beginRetry(wrong){
  session.mode="retry";session.phase="retry";session.retryQuestions=wrong;session.retryIndex=0;session.question=wrong[0];saveSession();$("resultOverlay").hidden=true;await enterWorkspace();
}
function startTimer(){
  if(timerId!==null)return;ticking=true;
  const tick=()=>{
    if(!session||session.mode!=="exam"||!session.deadline)return;
    if(session.phase==="results"){ticking=false;if(timerId!==null){clearInterval(timerId);timerId=null;}return;}
    const left=Math.max(0,Math.ceil((session.deadline-Date.now())/1000));$("timer").textContent=String(Math.floor(left/60)).padStart(2,"0")+":"+String(left%60).padStart(2,"0");
    if(left<=0){ticking=false;if(timerId!==null){clearInterval(timerId);timerId=null;}finishSet("시간 종료 · 시험 결과",true);}
  };
  tick();timerId=setInterval(tick,1000);
}
function downloadHistory(){
  const history=localGet(HISTORY_KEY,[]),blob=new Blob([JSON.stringify(history,null,2)],{type:"application/json"});
  const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download="cos-scratch-records.json";link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}
$("closeResults").addEventListener("click",()=>$("resultOverlay").hidden=true);
let dragDivider=false;
$("paneDivider").addEventListener("pointerdown",event=>{if(event.button!==0)return;dragDivider=true;$("paneDivider").classList.add("dragging");$("paneDivider").setPointerCapture(event.pointerId);});
$("paneDivider").addEventListener("pointermove",event=>{if(!dragDivider)return;const box=workspace.getBoundingClientRect(),percent=(event.clientX-box.left)/(box.width-8)*100,width=Math.max(18,Math.min(42,percent));workspace.style.setProperty("--question-width",width+"%");$("paneDivider").setAttribute("aria-valuenow",String(Math.round(width)));});
$("paneDivider").addEventListener("pointerup",event=>{dragDivider=false;$("paneDivider").classList.remove("dragging");if($("paneDivider").hasPointerCapture(event.pointerId))$("paneDivider").releasePointerCapture(event.pointerId);});
$("paneDivider").addEventListener("keydown",event=>{if(["ArrowLeft","ArrowRight"].indexOf(event.key)<0)return;event.preventDefault();const current=parseFloat(getComputedStyle(workspace).getPropertyValue("--question-width")),width=Math.max(18,Math.min(42,current+(event.key==="ArrowRight"?2:-2)));workspace.style.setProperty("--question-width",width+"%");$("paneDivider").setAttribute("aria-valuenow",String(Math.round(width)));});
window.reloadStudentProgress=async()=>{
  const records=await progressStore.list();studentSessions=Object.fromEntries(records.map(item=>[item.id,item]));
  localSet(SESSIONS_KEY,studentSessions);fillSetup();
};
let folderInitialized=false;
async function initializeProgress(){
  $("startButton").disabled=true;$("resumeButton").disabled=true;$("retryProgress").hidden=true;$("startError").textContent="";
  try{
    const remote=await progressStore.list();
    studentSessions=Object.fromEntries(remote.map(item=>[item.id,item]));
    const local=localGet(SESSIONS_KEY,{}),active=localGet(SESSION_KEY);
    if(active?.id)local[active.id]=active;
    const legacy=localGet("cosScratch:legacyImportDone",false)?[]:await progressStore.legacyRecords().catch(error=>{console.warn("이전 주소의 기록 가져오기를 건너뜁니다.",error);return [];});
    for(const source of legacy)for(const value of source.sessions||[]){
      if(value?.id&&(!local[value.id]||(value.updatedAt||value.createdAt||0)>(local[value.id].updatedAt||local[value.id].createdAt||0)))local[value.id]=value;
    }
    for(const value of Object.values(local)){
      if(!studentSessions[value.id]||(value.updatedAt||value.createdAt||0)>(studentSessions[value.id].updatedAt||studentSessions[value.id].createdAt||0)){
        await progressStore.save(value);studentSessions[value.id]=value;
      }
    }
    // Move this browser's older SB2 backups to disk once, without replacing newer disk work.
    const db=await idbPromise;
    const entries=db&&!localGet("cosScratch:answerImportDone",false)?await new Promise((resolve,reject)=>{
      const tx=db.transaction("answers","readonly"),store=tx.objectStore("answers"),all=[];
      const cursor=store.openCursor();cursor.onsuccess=()=>{const item=cursor.result;if(item){all.push([item.key,item.value]);item.continue();}else resolve(all);};cursor.onerror=()=>reject(cursor.error);
    }).catch(error=>{console.warn("브라우저 이전 기록 읽기 실패",error);return [];}):[];
    for(const [key,buffer] of entries)if(!await progressStore.getAnswer(key)&&!progressStore.wasDeleted(key))await progressStore.putAnswer(key,new Uint8Array(buffer));
    for(const source of legacy)for(const [key,buffer] of source.answers||[])if(!await progressStore.getAnswer(key)&&!progressStore.wasDeleted(key))await progressStore.putAnswer(key,new Uint8Array(buffer));
    localSet("cosScratch:legacyImportDone",true);localSet("cosScratch:answerImportDone",true);
    if(!localGet(LAST_NAME_KEY)){
      const latest=Object.values(studentSessions).sort((a,b)=>(b.updatedAt||b.createdAt)-(a.updatedAt||a.createdAt))[0];
      if(latest)localSet(LAST_NAME_KEY,latest.student);
    }
    localSet(SESSIONS_KEY,studentSessions);progressReady=true;fillSetup();
    $("startButton").disabled=false;$("resumeButton").disabled=false;
    if(!folderInitialized&&window.scratchRecordFolder){folderInitialized=true;await scratchRecordFolder.initialize();}
  }catch(error){$("startError").textContent=location.protocol==="file:"?"index.html을 직접 열지 말고, 압축을 모두 푼 폴더의 start.bat을 실행해 주세요.":"저장 서버에 연결하지 못했습니다. 서버 창을 확인하거나 start.bat을 다시 실행한 뒤 ‘기록 다시 불러오기’를 누르세요.";$("retryProgress").hidden=false;console.error(error);}
}
setInterval(async()=>{
  if(!progressReady||!session||workspace.hidden||document.hidden||projectLoading||autoSaving||pendingDiskSaves||pendingProjectExport||!editorApi||loadedProjectKey!==answerKey()||session.phase==="results"||session.phase==="done"||(session.mode==="exam"&&!session.started))return;
  if(Number(editorApi.callExternalInterface("ASgetProjectEditVersion"))===savedProjectVersion)return;
  autoSaving=true;
  try{await requestProjectExport(session.question);saveSession();await progressStore.flush();$("saveHint").textContent="자동 저장 완료";}
  catch(error){$("saveHint").textContent="자동 저장 실패 · 서버 창을 확인하세요";console.error(error);}
  finally{autoSaving=false;}
},15000);
function shouldWarnBeforeClose(){
  if(pendingDiskSaves||failedDiskSaves.size||pendingProjectExport)return true;
  if(workspace.hidden||!session||!editorApi||projectLoading||!loadedProjectKey)return false;
  try{
    const version=Number(editorApi.callExternalInterface("ASgetProjectEditVersion"));
    return !Number.isFinite(version)||version!==savedProjectVersion;
  }catch{return true;}
}
window.addEventListener("beforeunload",event=>{
  if(shouldWarnBeforeClose()){
    event.preventDefault();event.returnValue="";
  }
});
$("retryProgress").addEventListener("click",initializeProgress);
fillSetup();
initializeProgress();

