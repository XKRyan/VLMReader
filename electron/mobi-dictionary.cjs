const fs=require('node:fs'),path=require('node:path');
// MOBI7 record/index layout, cross-checked with Kindling (MIT).
// No dictionary content or external executable is bundled with this parser.
const MAX_TEXT=256*1024*1024,MAX_ARTICLE=4*1024*1024;
const broken=()=>Error('MOBI 词典结构损坏或不受支持');
function bounds(buffer,offset,size){if(!Number.isSafeInteger(offset)||offset<0||size<0||offset+size>buffer.length)throw broken();}
function uint(buffer,offset,size=4){bounds(buffer,offset,size);return size===2?buffer.readUInt16BE(offset):buffer.readUInt32BE(offset);}
function variable(buffer,state,end=buffer.length){let value=0;for(let i=0;i<5;i++){if(state.at>=end)throw broken();const c=buffer[state.at++];value=value*128+(c&127);if(c&128){if(value>0xffffffff)throw broken();return value;}}throw broken();}
function palmDoc(buffer,capacity){
 const out=Buffer.allocUnsafe(capacity);let at=0;
 const put=value=>{if(at>=out.length)throw broken();out[at++]=value;};
 for(let i=0;i<buffer.length;){const c=buffer[i++];
  if(c>0&&c<9){bounds(buffer,i,c);for(let j=0;j<c;j++)put(buffer[i++]);}
  else if(c>=128&&c<192){bounds(buffer,i,1);const pair=((c&63)<<8)|buffer[i++],distance=pair>>3;if(!distance||distance>at)throw broken();for(let j=0;j<(pair&7)+3;j++)put(out[at-distance]);}
  else if(c>=192){put(32);put(c^128);}else put(c);
 }return out.subarray(0,at);
}
function withoutTrailers(buffer,flags){
 let end=buffer.length;
 for(let bit=1;bit<16;bit++)if(flags&(1<<bit)){
  let size=0,done=false,used=0;
  for(let i=0;i<4&&end-i>0;i++){const c=buffer[end-i-1];size+=(c&127)*2**(i*7);used++;if(c&128){done=true;break;}}
  if(!done||size<used||size>end)throw broken();end-=size;
 }
 if(flags&1){if(!end)throw broken();end-=(buffer[end-1]&3)+1;if(end<0)throw broken();}
 return buffer.subarray(0,end);
}
function schema(meta){
 const at=uint(meta,4);bounds(meta,at,12);if(meta.toString('ascii',at,at+4)!=='TAGX')throw broken();
 const length=uint(meta,at+4),controls=uint(meta,at+8);bounds(meta,at,length);if(length<12||(length-12)%4||!controls||controls>8)throw broken();
 const tags=[];for(let p=at+12;p<at+length;p+=4)tags.push([...meta.subarray(p,p+4)]);
 return {controls,tags};
}
function tags(buffer,start,end,definition){
 bounds(buffer,start,definition.controls);if(start+definition.controls>end)throw broken();
 const control=buffer.subarray(start,start+definition.controls),cursor={at:start+definition.controls},pending=[],result={};let index=0;
 for(const [tag,multiplier,mask,last]of definition.tags){
  if(last){index++;continue;}if(!mask)continue;if(index>=control.length||!multiplier)throw broken();
  const slot=control[index]&mask;if(!slot)continue;
  const shift=Math.log2(mask&-mask),count=slot>>shift;
  pending.push(slot===mask&&(mask&(mask-1))?{tag,bytes:variable(buffer,cursor,end)}:{tag,count:count*multiplier});
 }
 for(const item of pending){const values=[];if(item.bytes!==undefined){const stop=cursor.at+item.bytes;if(stop>end)throw broken();while(cursor.at<stop){values.push(variable(buffer,cursor,stop));if(values.length>4096)throw broken();}}else{if(item.count>4096)throw broken();for(let i=0;i<item.count;i++)values.push(variable(buffer,cursor,end));}result[item.tag]=values;}
 return result;
}
function labelDecoder(meta,textEncoding){
 const encoding=uint(meta,28);let table=null,width=0;
 if(meta.length>=192){const count=uint(meta,168),offset=uint(meta,176);if(count){if(count>65536||uint(meta,164)>1)throw broken();bounds(meta,offset,4+count*2);if(meta.toString('ascii',offset,offset+4)!=='ORDT')throw broken();table=Array.from({length:count},(_,i)=>uint(meta,offset+4+i*2,2));width=uint(meta,164)===1?1:2;}}
 const decode=new TextDecoder((encoding===1252||encoding===0xffffffff&&textEncoding===1252)?'windows-1252':'utf-8',{fatal:true});
 return bytes=>{
  if(table){if(bytes.length%width)throw broken();let word='';for(let i=0;i<bytes.length;i+=width){const code=width===1?bytes[i]:uint(bytes,i,2);word+=String.fromCharCode(code<table.length?table[code]:code);}return word;}
  if(encoding===65002){if(bytes.length%2)throw broken();let word='';for(let i=0;i<bytes.length;i+=2)word+=String.fromCharCode(uint(bytes,i,2));return word;}
  return decode.decode(bytes);
 };
}
function indexEntries(record,index,textEncoding){
 const meta=record(index);if(meta.toString('ascii',0,4)!=='INDX')throw broken();const definition=schema(meta),decode=labelDecoder(meta,textEncoding),count=uint(meta,24),expected=uint(meta,36),rows=[];
 if(!count||count>65535||expected>1000000)throw broken();
 for(let i=1;i<=count;i++){
  const leaf=record(index+i);if(leaf.toString('ascii',0,4)!=='INDX')throw broken();const table=uint(leaf,20),entries=uint(leaf,24);bounds(leaf,table,4+entries*2);if(leaf.toString('ascii',table,table+4)!=='IDXT')throw broken();
  for(let j=0;j<entries;j++){
   const at=uint(leaf,table+4+j*2,2),end=j+1<entries?uint(leaf,table+6+j*2,2):table;if(at>=end||end>table)throw broken();
   const length=leaf[at];bounds(leaf,at+1,length);if(at+1+length>end)throw broken();const fields=tags(leaf,at+1+length,end,definition);
   if(fields[1]?.length!==1||fields[2]&&fields[2].length!==1)throw broken();rows.push({word:decode(leaf.subarray(at+1,at+1+length)),start:fields[1][0],length:fields[2]?.[0]});if(rows.length>1000000)throw broken();
  }
 }
 if(rows.length!==expected)throw broken();return rows;
}
function readMobiDictionary(file,{plain,validate,key}){
 const stat=fs.statSync(file);if(!stat.isFile()||stat.size>128*1024*1024)throw Error('词典文件需小于 128 MB');const buffer=fs.readFileSync(file);bounds(buffer,0,86);
 if(buffer.toString('ascii',60,68)!=='BOOKMOBI')throw Error('这不是 MOBI 词典');
 const count=uint(buffer,76,2);bounds(buffer,78,count*8);const offsets=Array.from({length:count},(_,i)=>uint(buffer,78+i*8));offsets.push(buffer.length);
 if(!count||offsets[0]<78+count*8||offsets.some((offset,i)=>offset>buffer.length||i&&offset<offsets[i-1]))throw broken();
 const record=i=>{if(!Number.isInteger(i)||i<0||i>=count)throw broken();return buffer.subarray(offsets[i],offsets[i+1]);},header=record(0);bounds(header,0,116);
 if(uint(header,12,2))throw Error('这份 MOBI 词典已加密，无法直接导入');
 if(header.toString('ascii',16,20)!=='MOBI')throw broken();const headerLength=uint(header,20);bounds(header,16,headerLength);
 if(uint(header,36)>7)throw Error('目前支持 MOBI7 词典，请使用 MOBI7 或 StarDict 文件');
 const compression=uint(header,0,2);if(![1,2].includes(compression))throw Error('目前支持未压缩或 PalmDOC 压缩的 MOBI 词典');
 const textCount=uint(header,8,2),declared=uint(header,4),recordSize=uint(header,10,2)||4096,encoding=uint(header,28),index=uint(header,40),flags=headerLength>=228?uint(header,242,2):0;
 if(![65001,1252].includes(encoding))throw Error('MOBI 词典文字编码暂不支持');if(index===0xffffffff||!index)throw Error('这个 MOBI 没有词条索引，请从词典文件导入');
 if(!textCount||textCount>=count||declared>MAX_TEXT)throw broken();const chunks=[];let bytes=0;
 for(let i=1;i<=textCount;i++){const source=withoutTrailers(record(i),flags),chunk=compression===2?palmDoc(source,Math.max(recordSize*2,16384)):source;bytes+=chunk.length;if(bytes>MAX_TEXT)throw broken();chunks.push(chunk);}
 // Some Creator dictionaries under-report their final, non-entry footer.
 if(bytes<declared||bytes>declared+recordSize*2)throw broken();const text=Buffer.concat(chunks,bytes),decode=new TextDecoder(encoding===1252?'windows-1252':'utf-8',{fatal:true}),indexed=indexEntries(record,index,encoding),positions=[...new Set(indexed.map(row=>row.start))].sort((a,b)=>a-b),next=new Map(positions.map((value,i)=>[value,positions[i+1]??text.length]));
 const words=new Map(),articles=new Map();
 for(const row of indexed){
  const length=row.length??next.get(row.start)-row.start;if(length>MAX_ARTICLE||!length)throw broken();bounds(text,row.start,length);
  const articleId=row.start+':'+length;let article=articles.get(articleId);
  if(!article){const html=decode.decode(text.subarray(row.start,row.start+length)),full=plain(html),definition=full.split(/(?:Usage Note|Word History|Synonyms)\s*:/i)[0].trim().slice(0,60000),phonetic=full.slice(0,300).match(/\(([^()\n]{1,90})\)/)?.[1]||'';article={html,definition:definition||full.slice(0,60000),phonetic};articles.set(articleId,article);}
  const word=row.word.normalize('NFKC').trim(),id=key(word);if(!word||word.length>150||/[\r\n\0]/.test(word))throw broken();const existing=words.get(id);
  if(existing){if(!existing.articleIds.has(articleId)){existing.html+='\n<hr/>\n'+article.html;existing.definition=(existing.definition+'\n\n'+article.definition).slice(0,60000);existing.articleIds.add(articleId);if(existing.html.length>MAX_ARTICLE)throw broken();}continue;}
  words.set(id,{...article,word,translation:'',articleIds:new Set([articleId])});
 }
 const titleOffset=uint(header,84),titleLength=uint(header,88);bounds(header,titleOffset,titleLength);const name=titleLength?decode.decode(header.subarray(titleOffset,titleOffset+titleLength)):path.basename(file,path.extname(file));
 return {name:name.slice(0,80),words:[...words.values()].map(({articleIds,...row})=>validate(row))};
}
module.exports={readMobiDictionary,palmDoc,withoutTrailers};
