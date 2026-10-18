const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
// MDict (.mdx) keyword/record layout, cross-checked against the byte stream that
// writemdict (MIT) produces. Blocks are streamed so a 150 MB learner's
// dictionary never has to sit in memory as one 1.2 GB buffer. Encrypted keyword
// indexes are bypassed by walking the self-describing key blocks instead; DRM
// keys and MDD resource archives stay unsupported.
const DEFAULT_LIMIT=512*1024*1024,MAX_TEXT=512*1024*1024,MAX_ENTRIES=1000000,MAX_ARTICLE=4*1024*1024;
const broken=()=>Error('MDX 词典结构损坏或不受支持');
function bounds(buffer,offset,size){if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(size)||offset<0||size<0||offset+size>buffer.length)throw broken();}
function uint64(buffer,offset){bounds(buffer,offset,8);const value=buffer.readBigUInt64BE(offset);if(value>BigInt(Number.MAX_SAFE_INTEGER))throw broken();return Number(value);}
function header(buffer){
  bounds(buffer,0,4);
  const size=buffer.readUInt32BE(0);
  if(size<8||size>4096)throw broken();
  bounds(buffer,4,size+4);
  const text=buffer.subarray(4,4+size).toString('utf16le').replace(/^\uFEFF/,'');
  if(!/^<(Dictionary|Library_Data)\b/i.test(text))throw Error('这不是 MDX 词典');
  const attribute=name=>{const match=text.match(new RegExp(name+'="([^"]*)"','i'));return match?match[1].trim():'';};
  const encrypted=Number(attribute('Encrypted')||0);
  if(!Number.isInteger(encrypted)||encrypted<0||encrypted>3)throw broken();
  return {at:4+size+4,version:attribute('GeneratedByEngineVersion')||attribute('RequiredEngineVersion'),encoding:(attribute('Encoding')||'UTF-8').toUpperCase(),encrypted,title:attribute('Title'),description:attribute('Description')};
}
// Each block starts with a little-endian compression type and a big-endian
// Adler-32 of the decompressed payload.
function inflate(buffer,offset,compressed,decompressed){
  bounds(buffer,offset,compressed);
  if(compressed<8||decompressed<0||decompressed>MAX_TEXT)throw broken();
  const block=buffer.subarray(offset,offset+compressed),type=block.readUInt32LE(0),payload=block.subarray(8);
  let output;
  if(type===0)output=payload;
  else if(type===2)output=zlib.inflateSync(payload,{maxOutputLength:Math.max(decompressed,1)});
  else if(type===1)output=Buffer.from(require('./vendor/lzo1x.cjs').lzo1xDecompress(payload,decompressed));
  else throw broken();
  if(output.length!==decompressed)throw broken();
  return output;
}
// zlib reports how much input it consumed, which is what lets the key blocks be
// walked without the (possibly encrypted) block index.
function inflateAt(buffer,offset,end){
  if(offset+8>end)throw broken();
  if(buffer.readUInt32LE(offset)!==2)throw Error('加密索引的 MDX 目前只支持 zlib 压缩的键块');
  const result=zlib.inflateSync(buffer.subarray(offset+8,end),{info:true,maxOutputLength:MAX_TEXT});
  return {data:result.buffer,consumed:result.engine.bytesWritten+8};
}
function decode(buffer,encoding){
  const text=encoding==='UTF-16'?buffer.toString('utf16le'):buffer.toString('utf8');
  return text.replace(/\uFEFF/g,'').replace(/\0+$/,'');
}
const ENTITIES={'&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'",'&apos;':"'",'&ndash;':'–','&mdash;':'—','&hellip;':'…','&ldquo;':'“','&rdquo;':'”','&lsquo;':'‘','&rsquo;':'’'};
// LDOCE-family articles put real senses in span.sense > span.def, usage
// sentences in span.example and phrases in span.collocate. Thesaurus and
// word-family panels (span.exponent) describe *other* headwords, so they are
// skipped — otherwise "bank" would lead with "the part of a river where it joins
// the sea", which belongs to "mouth".
const IGNORED_CLASSES=new Set(['exponent','collgloss','thes']);
const VOID_TAGS=new Set(['br','img','hr','meta','link','input','source','wbr']);
const TAGS=/<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const CLASSES=/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const MAX_DEFINITIONS=12,MAX_EXAMPLES=12,MAX_COLLOCATIONS=10;
function unescape(value){
  return value
    .replace(/&#x([\da-f]+);/gi,(_,hex)=>String.fromCodePoint(parseInt(hex,16)))
    .replace(/&#(\d+);/g,(_,dec)=>String.fromCodePoint(Number(dec)))
    .replace(/&[a-z]+;/gi,entity=>ENTITIES[entity.toLowerCase()]??entity);
}
function inside(stack,name){return stack.some(frame=>frame.classes.has(name));}
function kindFor(tag,classes,stack){
  if(classes.has('def')&&inside(stack,'sense'))return 'definitions';
  if(classes.has('example')&&inside(stack,'sense'))return 'examples';
  if(tag==='li'&&inside(stack,'exas'))return 'examples';
  if((classes.has('collocate')||classes.has('collo'))&&!inside(stack,'example')&&!inside(stack,'def'))return 'collocations';
  if(classes.has('pron'))return 'phonetic';
  return null;
}
// Chinese-English dictionaries built from the 新世纪/汉英大 family use a list
// layout: entry_head, an h5 part-of-speech label, ol.info-list senses marked by
// i.number, div.info-cite sentence pairs and a 相关词条 list.
const HANYING_ITEM=/<h5\b[^>]*>[\s\S]*?<span class="bold">([\s\S]*?)<\/span>|<li\b[^>]*>([\s\S]*?)<\/li>/gi;
const HANYING_CITE=/<div class="info-cite"[^>]*>([\s\S]*?)<\/div>/gi;
function paragraphsOf(html){
  return [...String(html).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(match=>textOf(match[1])).filter(Boolean);
}
function extractHanying(html){
  const source=String(html==null?'':html);
  const definitions=[],examples=[],collocations=[],seen=new Set();
  let pos='',match;
  HANYING_ITEM.lastIndex=0;
  while((match=HANYING_ITEM.exec(source))){
    if(match[1]!==undefined){pos=textOf(match[1]).trim();continue;}
    const item=match[2]||'';
    const number=(item.match(/<i class="number">\s*(\d+)\s*<\/i>/i)||[])[1];
    const cites=[...item.matchAll(HANYING_CITE)].map(block=>paragraphsOf(block[1]));
    if(number){
      const head=item.split(/<div class="info-cite"/i)[0];
      const sense=paragraphsOf(head)[0]||textOf(head);
      if(sense&&definitions.length<MAX_DEFINITIONS){
        const line=`${pos?pos+' ':''}${number}. ${sense}`.trim();
        if(!seen.has(line)){seen.add(line);definitions.push(line);}
      }
    }else{
      const phrase=textOf(item).replace(/\s+/g,' ').trim();
      if(phrase.length>2&&phrase.length<=80&&collocations.length<MAX_COLLOCATIONS&&!seen.has('c:'+phrase)){
        seen.add('c:'+phrase);
        collocations.push({text:phrase,translation:''});
      }
    }
    for(const pair of cites){
      const zh=pair[0]||'',en=pair[1]||'';
      if(!zh||examples.length>=MAX_EXAMPLES)continue;
      const key='e:'+zh+'|'+en;
      if(seen.has(key))continue;
      seen.add(key);
      examples.push({text:zh,translation:en});
    }
  }
  return {definitions,examples,collocations,phonetic:'',gloss:definitions.join('\n')};
}
// LDOCE4-era bilingual files write attributes without quotes and mark senses
// with L_LI, the Chinese gloss with L_DEC and each example pair with
// L_EX (L_EEX English / L_CEX Chinese).
const L_POS=/<span class=L_POS>([\s\S]*?)<\/span>/gi;
const L_LI=/<span class=L_LI>\s*([\d.]+)\s*<\/span>/gi;
const L_EX=/<div class=L_EX[^>]*>([\s\S]*?)<\/div>/gi;
function extractShuangjie(html){
  const source=String(html==null?'':html);
  const definitions=[],examples=[],collocations=[],seen=new Set();
  const positions=[];
  let match;
  L_POS.lastIndex=0;
  while((match=L_POS.exec(source)))positions.push({at:match.index,pos:textOf(match[1]).trim()});
  const posAt=index=>{let found='';for(const entry of positions){if(entry.at>index)break;found=entry.pos;}return found;};
  const marks=[];
  L_LI.lastIndex=0;
  while((match=L_LI.exec(source)))marks.push({at:match.index,after:L_LI.lastIndex,number:match[1]});
  for(let i=0;i<marks.length&&definitions.length<MAX_DEFINITIONS;i++){
    const mark=marks[i];
    const window=source.slice(mark.after,Math.min(source.length,mark.after+1200));
    const chinese=(window.match(/<font class=L_DEC>([\s\S]*?)<\/font>/i)||[])[1]||'';
    const english=(window.match(/<font(?:\s[^>]*)?>([\s\S]*?)<\/font>/i)||[])[1]||'';
    const pos=posAt(mark.at);
    const englishText=textOf(english.replace(/<\/(?:i|b|em|strong|u|span|font|small)>/gi,'$& ')).replace(/\s+/g,' ').trim();
    const chineseText=textOf(chinese).replace(/\s+/g,' ').trim().replace(/[:：]\s*$/,'');
    if(!chineseText&&!/[a-z]{3}/i.test(englishText))continue;
    if(!englishText&&!chineseText)continue;
    const line=[pos?`[${pos}] `:'',`${mark.number} `,englishText,chineseText?` —— ${chineseText}`:''].join('').trim();
    if(!seen.has(line)){seen.add(line);definitions.push(line);}
  }
  L_EX.lastIndex=0;
  while((match=L_EX.exec(source))&&examples.length<MAX_EXAMPLES){
    const block=match[1];
    const english=textOf(((block.match(/<span class=L_EEX>([\s\S]*?)<\/span>/i)||[])[1])||'').replace(/\s+/g,' ').trim();
    const chinese=textOf(((block.match(/<span class=L_CEX>([\s\S]*?)<\/span>/i)||[])[1])||'').replace(/\s+/g,' ').trim();
    if(!english)continue;
    const key=english+'|'+chinese;
    if(seen.has('x:'+key))continue;
    seen.add('x:'+key);
    examples.push({text:english,translation:chinese});
  }
  const collocation=/<span class=L_CLC>([\s\S]*?)<\/span>/gi;
  while((match=collocation.exec(source))&&collocations.length<MAX_COLLOCATIONS){
    const value=textOf(match[1]).replace(/\s+/g,' ').trim();
    if(value.length>2&&value.length<=60&&!seen.has('c:'+value)){seen.add('c:'+value);collocations.push({text:value,translation:''});}
  }
  return {definitions,examples,collocations,phonetic:'',gloss:definitions.join('\n')};
}
function extractArticle(html){
  if(/class="info-list"/.test(String(html||'')))return extractHanying(html);
  if(/\bclass=L_(?:LI|EX|DEC)\b/.test(String(html||'')))return extractShuangjie(html);
  const source=String(html==null?'':html).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi,' ');
  const out={definitions:[],examples:[],collocations:[],phonetic:[]};
  const stack=[];
  const flush=frame=>{
    const text=unescape(frame.buffer.join('')).replace(/\s+/g,' ').trim().replace(/^[\s:;,]+|[\s:;,]+$/g,'');
    if(text&&out[frame.kind])out[frame.kind].push(text);
  };
  const text=value=>{
    if(!value||!value.trim())return;
    for(let i=stack.length-1;i>=0;i--){
      const frame=stack[i];
      if(frame.blocked)return;
      if(frame.kind){frame.buffer.push(value);return;}
    }
  };
  const close=tag=>{
    for(let i=stack.length-1;i>=0;i--){
      if(stack[i].tag===tag){
        for(let j=stack.length-1;j>=i;j--)flush(stack[j]);
        stack.length=i;
        return;
      }
    }
  };
  let last=0,match;
  TAGS.lastIndex=0;
  while((match=TAGS.exec(source))){
    text(source.slice(last,match.index));
    last=TAGS.lastIndex;
    const closing=match[1]==='/',tag=match[2].toLowerCase(),attributes=match[3]||'';
    if(closing){close(tag);continue;}
    if(VOID_TAGS.has(tag)||/\/$/.test(attributes))continue;
    const classes=new Set();
    const found=attributes.match(CLASSES);
    if(found)(found[1]??found[2]??'').split(/\s+/).filter(Boolean).forEach(name=>classes.add(name));
    const blocked=stack.some(frame=>frame.blocked)||[...classes].some(name=>IGNORED_CLASSES.has(name));
    stack.push({tag,classes,blocked,kind:blocked?null:kindFor(tag,classes,stack),buffer:[]});
    if(stack.length>200)stack.splice(0,stack.length-200);
  }
  text(source.slice(last));
  while(stack.length)flush(stack.pop());
  const unique=(values,min,max,limit)=>{
    const seen=new Set(),result=[];
    for(const value of values){
      const fold=value.toLowerCase();
      if(value.length>min&&value.length<=max&&!seen.has(fold)&&result.length<limit){seen.add(fold);result.push(value);}
    }
    return result;
  };
  const definitions=unique(out.definitions,3,600,MAX_DEFINITIONS);
  const examples=unique(out.examples,12,400,MAX_EXAMPLES);
  const collocations=unique(out.collocations.map(value=>value.split(/[►·]|\(=/)[0].replace(/[\s:;,]+$/,'')),3,60,MAX_COLLOCATIONS);
  return {
    definitions,
    examples:examples.map(item=>({text:item,translation:''})),
    collocations:collocations.map(item=>({text:item,translation:''})),
    phonetic:(out.phonetic[0]||'').replace(/^\/|\/$/g,'').trim(),
    gloss:definitions.length?definitions.map((value,index)=>`${index+1}. ${value}`).join('\n'):'',
  };
}
// A DOM parse of 52k articles takes minutes; imported MDX only needs readable
// text beside the preserved article, so entities and block tags are enough.
function textOf(html){
  return String(html==null?'':html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi,' ')
    .replace(/<br\s*\/?>/gi,'\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6]|blockquote|td)>/gi,'\n')
    .replace(/<[^>]+>/g,'')
    .replace(/&#x([\da-f]+);/gi,(_,hex)=>String.fromCodePoint(parseInt(hex,16)))
    .replace(/&#(\d+);/g,(_,dec)=>String.fromCodePoint(Number(dec)))
    .replace(/&[a-z]+;/gi,entity=>ENTITIES[entity.toLowerCase()]??entity)
    .replace(/\r/g,'')
    .replace(/[ \t\u00a0]{2,}/g,' ')
    .replace(/\n[ \t]+/g,'\n')
    .replace(/\n{3,}/g,'\n\n')
    .trim();
}
// The key block index stores each block's entry count, its first and last key
// (declared length excludes the trailing NUL) and the block sizes. Some writers
// omit the terminator from the byte stream, so both readings are parsed and the
// one that consumes the index and matches the advertised block bytes wins.
function blockIndex(index,count,version,total,width){
  const longSize=version==='1.2'?4:8,shortSize=version==='1.2'?1:2;
  const readLong=at=>version==='1.2'?index.readUInt32BE(at):uint64(index,at);
  const readShort=at=>version==='1.2'?index.readUInt8(at):index.readUInt16BE(at);
  const candidate=terminator=>{
    const blocks=[];let at=0;
    try{
      for(let i=0;i<count;i++){
        const entries=readLong(at);at+=longSize;
        const first=readShort(at);at+=shortSize;
        if(first>1024)throw broken();
        at+=first*width+terminator;
        const last=readShort(at);at+=shortSize;
        if(last>1024)throw broken();
        at+=last*width+terminator;
        const compressed=readLong(at);at+=longSize;
        const decompressed=readLong(at);at+=longSize;
        if(!Number.isSafeInteger(compressed)||!Number.isSafeInteger(decompressed)||compressed<=8||decompressed<=0||decompressed>MAX_TEXT)throw broken();
        blocks.push({entries,compressed,decompressed});
      }
    }catch{return null;}
    if(at!==index.length)return null;
    return blocks;
  };
  const modes=version==='1.2'?[0]:[width,0];
  let fallback=null;
  for(const terminator of modes){
    const blocks=candidate(terminator);
    if(!blocks)continue;
    if(blocks.reduce((sum,block)=>sum+block.compressed,0)===total)return blocks;
    fallback||=blocks;
  }
  if(fallback)return fallback;
  throw broken();
}
function readEntry(data,at,version,width,encoding){
  const entryOffset=version==='1.2'?data.readUInt32BE(at):uint64(data,at);
  at+=version==='1.2'?4:8;
  let end=at;
  if(width===2){while(end+1<data.length&&(data[end]||data[end+1]))end+=2;if(end+1>=data.length)throw broken();}
  else {end=data.indexOf(0,at);if(end<0)throw broken();}
  return {word:decode(data.subarray(at,end),encoding),offset:entryOffset,next:end+width};
}
function keys(buffer,start,count,version,total,encoding){
  const width=encoding==='UTF-16'?2:1;
  const index=version==='1.2'?buffer.subarray(start.at,start.at+start.compressed):inflate(buffer,start.at,start.compressed,start.decompressed);
  const blocks=blockIndex(index,count,version,total,width);
  let offset=start.at+start.compressed;
  const result=[];
  for(const block of blocks){
    const data=inflate(buffer,offset,block.compressed,block.decompressed);
    offset+=block.compressed;
    let at=0;
    for(let i=0;i<block.entries;i++){
      const entry=readEntry(data,at,version,width,encoding);
      result.push({word:entry.word,offset:entry.offset});
      at=entry.next;
    }
  }
  return {entries:result,next:offset};
}
// Walk the key blocks directly when the index cannot be read (encrypted index).
function scanKeys(buffer,start,count,version,total,encoding){
  const width=encoding==='UTF-16'?2:1,stop=start+total;
  if(stop>buffer.length)throw broken();
  const entries=[];let offset=start,blocks=0;
  while(offset<stop){
    const {data,consumed}=inflateAt(buffer,offset,stop);
    let at=0;
    while((version==='1.2'?at+4:at+8)<=data.length){
      const entry=readEntry(data,at,version,width,encoding);
      if(entry.word)entries.push({word:entry.word,offset:entry.offset});
      at=entry.next;
      if(entries.length>MAX_ENTRIES)throw broken();
    }
    offset+=consumed;
    if(++blocks>count)throw broken();
  }
  if(offset!==stop)throw broken();
  return {entries,next:stop};
}
function recordBlocks(buffer,start,version){
  const wide=version==='1.2'?4:8;
  const read=at=>wide===4?buffer.readUInt32BE(at):uint64(buffer,at);
  const count=read(start),total=read(start+wide),indexSize=read(start+wide*2);
  const indexAt=start+wide*4;
  if(!count||count>MAX_ENTRIES)throw broken();
  bounds(buffer,indexAt,indexSize);
  const blocks=[];let offset=indexAt+indexSize,cumulative=0;
  for(let i=0;i<count;i++){
    const compressed=read(indexAt+i*wide*2),decompressed=read(indexAt+i*wide*2+wide);
    if(!Number.isSafeInteger(compressed)||!Number.isSafeInteger(decompressed)||compressed<=8||decompressed<0||decompressed>MAX_TEXT)throw broken();
    bounds(buffer,offset,compressed);
    blocks.push({at:offset,compressed,decompressed,base:cumulative});
    offset+=compressed;cumulative+=decompressed;
  }
  return {blocks,total:cumulative};
}
function layout(buffer){
  const meta=header(buffer);
  if(meta.version&&!['1.2','2.0'].includes(meta.version))throw Error(`不支持的 MDX 版本 ${meta.version}`);
  if(meta.encrypted&1)throw Error('暂不支持需要注册密钥的 MDX 词典');
  const version=meta.version==='1.2'?'1.2':'2.0';
  let at=meta.at;
  const wide=version==='1.2'?4:8;
  const read=()=>{const value=wide===4?buffer.readUInt32BE(at):uint64(buffer,at);at+=wide;return value;};
  const keyCount=read(),entryCount=read(),indexDecompressed=read();
  let indexCompressed,blocksTotal;
  if(version==='1.2'){indexCompressed=indexDecompressed;blocksTotal=read();}
  else {indexCompressed=read();blocksTotal=read();at+=4;} // then the preamble Adler-32
  if(!keyCount||keyCount>MAX_ENTRIES||!entryCount||entryCount>MAX_ENTRIES||!indexCompressed)throw broken();
  const indexAt=at,keyStart=indexAt+indexCompressed;
  if(keyStart>buffer.length)throw broken();
  let indexed=null,scanned=false;
  // An encrypted index is normal for commercial dictionaries; the key blocks
  // themselves are still plain zlib, so they are walked directly instead.
  if(!(meta.encrypted&2)){
    try{indexed=keys(buffer,{at:indexAt,compressed:indexCompressed,decompressed:indexDecompressed},keyCount,version,blocksTotal,meta.encoding);}catch{indexed=null;}
    if(indexed&&indexed.entries.length!==entryCount)indexed=null;
  }
  if(!indexed){
    indexed=scanKeys(buffer,keyStart,keyCount,version,blocksTotal,meta.encoding);
    scanned=true;
    if(indexed.entries.length!==entryCount)throw broken();
  }
  const records=recordBlocks(buffer,indexed.next,version);
  return {meta,version,words:indexed.entries,records,scanned};
}
function streamMdx(file,{onRow,limit=DEFAULT_LIMIT}={}){
  if(typeof onRow!=='function')throw Error('MDX 导入需要逐条处理');
  const stat=fs.statSync(file);
  if(!stat.isFile())throw Error('词典文件不存在');
  if(stat.size>limit)throw Error(`MDX 词典需小于 ${Math.round(limit/1048576)} MB`);
  const buffer=fs.readFileSync(file);
  const {meta,version,words,records,scanned}=layout(buffer);
  let index=0,written=0;
  let carry=Buffer.alloc(0),carryStart=0;
  for(const block of records.blocks){
    if(index>=words.length)break;
    const data=inflate(buffer,block.at,block.compressed,block.decompressed);
    const window=carry.length?Buffer.concat([carry,data]):data;
    const windowStart=carry.length?carryStart:block.base;
    while(index<words.length){
      const start=words[index].offset;
      const end=index+1<words.length?words[index+1].offset:records.total;
      if(end<start||end>records.total)throw broken();
      if(end>windowStart+window.length)break;
      const article=decode(window.subarray(start-windowStart,end-windowStart),meta.encoding);
      if(article.length>MAX_ARTICLE)throw Error('词典原文过长');
      onRow({word:words[index].word,article});
      index++;written++;
    }
    if(index<words.length){
      const keep=words[index].offset-windowStart;
      carry=keep>0?window.subarray(keep):window;
      carryStart=windowStart+(keep>0?keep:0);
    }else{carry=Buffer.alloc(0);carryStart=0;}
  }
  if(index!==words.length)throw broken();
  if(!written)throw Error('MDX 词典没有可读取的词条');
  return {name:(meta.title||path.basename(file,path.extname(file))).slice(0,80),count:written,encrypted:meta.encrypted,scanned,version};
}
function readMdxDictionary(file,{validate,limit=DEFAULT_LIMIT}={}){
  const words=[];
  const info=streamMdx(file,{limit,onRow({word,article}){
    const parsed=extractArticle(article);
    const text=parsed.gloss||textOf(article);
    if(!text)return;
    words.push(validate({word,phonetic:parsed.phonetic,definition:text,translation:text,examples:parsed.examples,collocations:parsed.collocations,html:article}));
  }});
  if(!words.length)throw Error('MDX 词典没有可读取的词条');
  return {name:info.name,words};
}
module.exports={readMdxDictionary,streamMdx,extractArticle,textOf,header,DEFAULT_LIMIT};
