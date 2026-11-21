/* Pre-rendered, trimmed problem images: no PDF parsing or pixel scan at runtime. */
(() => {
  const wrap=document.getElementById("questionPdf"),label=document.getElementById("pdfZoomLabel");
  const minus=document.getElementById("pdfZoomOut"),plus=document.getElementById("pdfZoomIn");
  const cache=new Map();let zoom=1,generation=0,pages=[],resizeTimer;
  function updateSize(){
    const width=Math.max(1,wrap.clientWidth*zoom);
    for(const page of pages){page.image.style.width=width+"px";page.image.style.height=width*page.height/page.width+"px";}
    label.textContent=Math.round(zoom*100)+"%";minus.disabled=zoom<=0.5;plus.disabled=zoom>=3;
  }
  function setZoom(value){const previous=zoom;zoom=Math.max(0.5,Math.min(3,Math.round(value*100)/100));wrap.scrollTop*=zoom/previous;updateSize();}
  minus.addEventListener("click",()=>setZoom(zoom-0.1));plus.addEventListener("click",()=>setZoom(zoom+0.1));
  document.getElementById("pdfFitWidth").addEventListener("click",()=>{setZoom(1);wrap.scrollLeft=0;});
  new ResizeObserver(()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(updateSize,50);}).observe(wrap);
  function imagePage(page,index){
    const image=document.createElement("img");image.alt="문제지 "+(index+1)+"페이지";
    image.width=page.width;image.height=page.height;image.decoding="async";
    const ready=new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error("문제지 이미지를 읽지 못했습니다."));});
    image.src=page.src;return {...page,image,ready};
  }
  window.questionPdfViewer={async load(url){
    const current=++generation,key=url.split("#")[0];pages=[];wrap.replaceChildren();wrap.scrollTop=wrap.scrollLeft=0;
    const message=document.createElement("p");message.setAttribute("role","status");message.textContent="문제지를 불러오는 중…";wrap.append(message);
    try{
      const metadata=window.problemPages?.[key];if(!metadata?.pages?.length)throw new Error("문제지 이미지 목록이 없습니다.");
      let entry=cache.get(key);if(entry)cache.delete(key);else entry=metadata.pages.map(imagePage);
      cache.set(key,entry);while(cache.size>3)cache.delete(cache.keys().next().value);
      pages=entry;for(const page of pages)wrap.append(page.image);updateSize();
      await pages[0].ready;if(current!==generation)return;message.remove();
      await Promise.all(pages.map(page=>page.ready));
    }catch(error){
      if(current!==generation)return;cache.delete(key);console.error("문제지 이미지 로드 실패",error);
      message.textContent="문제지를 불러오지 못했습니다. ";
      const link=document.createElement("a");link.href=key;link.target="_blank";link.rel="noopener";link.textContent="원본 PDF 열기";message.append(link);wrap.prepend(message);
    }
  }};
  updateSize();
})();
