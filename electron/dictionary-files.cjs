const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {DOMParser}=require('@xmldom/xmldom');
const LIMIT=128*1024*1024;
const key=value=>String(value||'').normalize('NFKC').trim().toLowerCase();
function text(value){return String(value||'').replace(/\\n/g,'\n').replace(/\r/g,'').trim();}
function plain(value){
  const xml=new DOMParser({errorHandler:()=>{}}).parseFromString('<root>'+String(value).replace(/&(?!#\d+;|#x[\da-f]+;|amp;|lt;|gt;|quot;|apos;)/gi,'&amp;')+'</root>','text/xml');
  for(const tag of ['script','style'])for(const node of Array.from(xml.getElementsByTagName(tag)))node.parentNode?.removeChild(node);
  for(const tag of ['br','p','div','li','tr','def','ex'])for(const node of Array.from(xml.getElementsByTagName(tag)))node.appendChild(xml.createTextNode('\n'));
  return text(xml.documentElement?.textContent||'').replace(/\n{3,}/g,'\n\n');
}
function csv(text,delimiter){
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(quoted||!cell)quoted=!quoted;else cell+=c;}else if(c===delimiter&&!quoted){row.push(cell);cell='';}else if(/[\r\n]/.test(c)&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell='';}else cell+=c;}
  if(quoted)throw Error('CSV 引号没有闭合');row.push(cell);if(row.some(Boolean))rows.push(row);return rows;
}
function read(file,compressed=false){
  const stat=fs.statSync(file);if(!stat.isFile()||stat.size>LIMIT)throw Error('词典文件需小于 128 MB');
  const data=fs.readFileSync(file);return compressed?zlib.gunzipSync(data,{maxOutputLength:512*1024*1024}):data;
}
function validate(item){
  if(!item||typeof item!=='object')throw Error('词典条目格式无效');
  const word=text(item.word||item.text).normalize('NFKC');
  if(!word||word.length>150||/[\r\n\0]/.test(word))throw Error('词条需为 1–150 个字符');
  const row={word,phonetic:text(item.phonetic),translation:text(item.translation||item.meaning),definition:text(item.definition),exchange:text(item.exchange),tags:text(item.tags||item.tag),examples:[],collocations:[]};
  if(item.html){if(typeof item.html!=='string'||item.html.length>4*1024*1024)throw Error('词典原文过长');row.html=item.html;}
  for(const field of ['translation','definition'])if(row[field].length>64000)throw Error('单条释义过长');
  for(const field of ['examples','collocations']){
    const items=item[field]||[];if(!Array.isArray(items)||items.length>100)throw Error('例句或搭配格式无效');
    row[field]=items.map(value=>typeof value==='string'?{text:text(value),translation:''}:{text:text(value?.text||value?.sentence||value?.phrase),translation:text(value?.translation)});
    if(row[field].some(value=>!value.text||value.text.length>4000||value.translation.length>4000))throw Error('例句或搭配格式无效');
  }
  if(!row.translation&&!row.definition)throw Error('请填写中文或英文释义');return row;
}
function fields(buffer,sequence){
  let position=0;const result=[];for(let i=0;position<buffer.length;i++){
    const type=sequence?sequence[i]:String.fromCharCode(buffer[position++]);if(!type||!/[A-Za-z]/.test(type))throw Error('StarDict 字段格式无效');
    let end;if(sequence&&i===sequence.length-1)end=buffer.length;
    else if(type===type.toLowerCase()){end=buffer.indexOf(0,position);if(end<0)throw Error('StarDict 字段缺少结束符');}
    else {if(position+4>buffer.length)throw Error('StarDict 字段越界');const size=buffer.readUInt32BE(position);position+=4;end=position+size;}
    if(end>buffer.length)throw Error('StarDict 字段越界');
    if(type===type.toLowerCase())result.push({type,value:buffer.subarray(position,end).toString('utf8')});
    position=end+(sequence&&i===sequence.length-1?0:type===type.toLowerCase()?1:0);
  }return result;
}
function readStarDict(file){
  const meta=read(file).toString('utf8').replace(/^\uFEFF/,'').split(/\r?\n/);if(meta.shift()!=="StarDict's dict ifo file")throw Error('这不是 StarDict 词典');
  const info={};for(const line of meta){const i=line.indexOf('=');if(i>0)info[line.slice(0,i).trim()]=line.slice(i+1).trim();}
  if(!['2.4.2','3.0.0'].includes(info.version))throw Error('不支持的 StarDict 版本');
  if(info.idxoffsetbits&&!['32','64'].includes(info.idxoffsetbits))throw Error('StarDict 索引格式无效');
  const base=file.slice(0,-4),idx=fs.existsSync(base+'.idx')?read(base+'.idx'):read(base+'.idx.gz',true),data=fs.existsSync(base+'.dict')?read(base+'.dict'):read(base+'.dict.dz',true);
  if(Number(info.idxfilesize)!==idx.length)throw Error('StarDict 索引大小不符');
  const words=[],bits=info.idxoffsetbits==='64'?8:4;let position=0;
  while(position<idx.length){
    const end=idx.indexOf(0,position);if(end<0||end+1+bits+4>idx.length)throw Error('StarDict 索引损坏');
    const word=idx.subarray(position,end).toString('utf8');position=end+1;
    const offset=bits===8?Number(idx.readBigUInt64BE(position)):idx.readUInt32BE(position),size=idx.readUInt32BE(position+bits);position+=bits+4;
    if(!Number.isSafeInteger(offset)||offset+size>data.length)throw Error('StarDict 条目越界');
    const values=fields(data.subarray(offset,offset+size),info.sametypesequence),meanings=values.filter(v=>!['t','y','r'].includes(v.type)).map(v=>['h','g','x','k'].includes(v.type)?plain(v.value):text(v.value)).filter(Boolean);
    if(!meanings.length)throw Error('StarDict 条目没有可读取的文字释义');
    words.push(validate({word,translation:meanings.join('\n\n'),phonetic:values.filter(v=>['t','y'].includes(v.type)).map(v=>v.value).join(' / ')}));
  }
  if(Number(info.wordcount)!==words.length)throw Error('StarDict 词条数量不符');
  if(fs.existsSync(base+'.syn')){
    const syn=read(base+'.syn');position=0;let count=0;
    while(position<syn.length){const end=syn.indexOf(0,position);if(end<0||end+5>syn.length)throw Error('StarDict 别名索引损坏');const word=syn.subarray(position,end).toString('utf8'),index=syn.readUInt32BE(end+1);position=end+5;if(index>=Number(info.wordcount))throw Error('StarDict 别名越界');words.push({...words[index],word});count++;}
    if(info.synwordcount&&Number(info.synwordcount)!==count)throw Error('StarDict 别名数量不符');
  }
  return {name:info.bookname||path.basename(base),words};
}
function readDictionary(file){
  const ext=path.extname(file).toLowerCase();if(ext==='.ifo')return readStarDict(file);
  if(ext==='.mobi')return require('./mobi-dictionary.cjs').readMobiDictionary(file,{plain,validate,key});
  const content=read(file).toString('utf8').replace(/^\uFEFF/,'');let items,name=path.basename(file,ext);
  if(ext==='.json'){const parsed=JSON.parse(content);items=Array.isArray(parsed)?parsed:parsed.entries;name=parsed.name||name;}
  else if(['.csv','.tsv'].includes(ext)){
    const rows=csv(content,ext==='.tsv'?'\t':','),header=rows.shift()?.map(v=>key(v))||[],aliases={word:['word','text','单词','词条'],translation:['translation','meaning','中文','释义'],definition:['definition','english definition','英英释义'],phonetic:['phonetic','音标'],exchange:['exchange','变形'],tags:['tags','tag','标签'],example:['example','sentence','例句'],exampleTranslation:['exampletranslation','例句译文'],collocation:['collocation','搭配']},positions={};for(const [field,keys]of Object.entries(aliases))positions[field]=header.findIndex(value=>keys.includes(value));
    if(positions.word<0)throw Error('词典表格需要 word（词条）列');
    items=rows.map(row=>{const item=Object.fromEntries(Object.entries(positions).map(([field,index])=>[field,index<0?'':row[index]||'']));item.examples=item.example?[{text:item.example,translation:item.exampleTranslation}]:[];item.collocations=item.collocation?[item.collocation]:[];return item;});
  }else throw Error('支持 CSV、TSV、JSON、StarDict（.ifo）和 MOBI 词典');
  if(!Array.isArray(items)||!items.length||items.length>1000000)throw Error('词典需包含 1–1000000 个条目');
  return {name:String(name).slice(0,80),words:items.map(validate)};
}
module.exports={key,text,plain,csv,validate,readDictionary,readStarDict};
