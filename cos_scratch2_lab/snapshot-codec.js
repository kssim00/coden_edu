/* JSON work records reuse original media; only newly edited media is embedded. */
(() => {
  const encoder=new TextEncoder(),decoder=new TextDecoder();
  function snapshot(bytes){
    if(!bytes||bytes[0]!==123)return null;
    const value=JSON.parse(decoder.decode(bytes));
    if(value.format!=="cos-scratch-snapshot"||value.version!==1||!value.project||!Array.isArray(value.assets))throw new Error("풀이 JSON 형식이 올바르지 않습니다.");
    return value;
  }
  async function unzip(bytes){
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),files={};let end=bytes.length-22;
    while(end>=0&&view.getUint32(end,true)!==0x06054b50)end--;
    if(end<0)throw new Error("SB2 ZIP 형식이 올바르지 않습니다.");
    let cursor=view.getUint32(end+16,true);
    for(let i=0;i<view.getUint16(end+10,true);i++){
      const method=view.getUint16(cursor+10,true),length=view.getUint32(cursor+20,true),nameLength=view.getUint16(cursor+28,true),offset=view.getUint32(cursor+42,true);
      const name=decoder.decode(bytes.subarray(cursor+46,cursor+46+nameLength));
      const start=offset+30+view.getUint16(offset+26,true)+view.getUint16(offset+28,true),data=bytes.slice(start,start+length);
      files[name]=method===0?data:method===8?new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer()):null;
      if(!files[name])throw new Error("지원하지 않는 SB2 압축입니다.");
      cursor+=46+nameLength+view.getUint16(cursor+30,true)+view.getUint16(cursor+32,true);
    }
    return files;
  }
  async function baseline(bytes){
    const files=await unzip(bytes),project=JSON.parse(decoder.decode(files["project.json"])),assets={};
    function add(md5,id){if(!md5)return;const ext=md5.slice(md5.lastIndexOf(".")),data=files[String(id)+ext]||files[md5];if(data)assets[md5]=data;}
    for(const object of [project,...(project.children||[])]){
      for(const costume of object.costumes||[]){add(costume.baseLayerMD5,costume.baseLayerID);add(costume.textLayerMD5,costume.textLayerID);}
      for(const sound of object.sounds||[])add(sound.md5,sound.soundID);
    }
    if(project.penLayerMD5)add(project.penLayerMD5,project.penLayerID);
    return {project,assets,known:JSON.stringify(Object.fromEntries(Object.keys(assets).map(key=>[key,true])))};
  }
  const crcTable=Uint32Array.from({length:256},(_,i)=>{for(let bit=0;bit<8;bit++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
  function crc(data){let value=0xffffffff;for(const byte of data)value=crcTable[(value^byte)&255]^(value>>>8);return (value^0xffffffff)>>>0;}
  function zip(files){
    const locals=[],centrals=[];let offset=0,centralLength=0;
    for(const [name,data] of Object.entries(files)){
      const filename=encoder.encode(name),checksum=crc(data),local=new Uint8Array(30+filename.length+data.length),l=new DataView(local.buffer);
      l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x800,true);l.setUint32(14,checksum,true);l.setUint32(18,data.length,true);l.setUint32(22,data.length,true);l.setUint16(26,filename.length,true);local.set(filename,30);local.set(data,30+filename.length);
      const central=new Uint8Array(46+filename.length),c=new DataView(central.buffer);
      c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint32(16,checksum,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,filename.length,true);c.setUint32(42,offset,true);central.set(filename,46);
      locals.push(local);centrals.push(central);offset+=local.length;centralLength+=central.length;
    }
    const result=new Uint8Array(offset+centralLength+22);let position=0;
    for(const part of [...locals,...centrals]){result.set(part,position);position+=part.length;}
    const end=new DataView(result.buffer,position,22);end.setUint32(0,0x06054b50,true);end.setUint16(8,locals.length,true);end.setUint16(10,locals.length,true);end.setUint32(12,centralLength,true);end.setUint32(16,offset,true);
    return result;
  }
  async function restore(bytes,original){
    const value=snapshot(bytes);if(!value)return bytes;
    const files={"project.json":encoder.encode(JSON.stringify(value.project))};
    for(const asset of value.assets){
      const data=asset.data!=null?Uint8Array.from(atob(asset.data),letter=>letter.charCodeAt(0)):original.assets[asset.md5];
      if(!data)throw new Error("풀이의 그림·소리 자료를 찾지 못했습니다: "+asset.md5);
      files[asset.name]=data;
    }
    return zip(files);
  }
  const api={snapshot,baseline,restore,unzip,zip};
  if(typeof module!=="undefined")module.exports=api;
  else window.SnapshotCodec=api;
})();
