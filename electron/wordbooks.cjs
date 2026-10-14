const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),JSZip=require('jszip');
const {DOMParser}=require('@xmldom/xmldom'),{readText}=require('./document-files.cjs'),{normalize,makeEntry,withReviewSkills}=require('./core.cjs');
function csvRows(text,delimiter=','){
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(quoted||!cell)quoted=!quoted;else cell+=c;}else if(c===delimiter&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(value=>value.trim()))rows.push(row);row=[];cell='';}else cell+=c;}
 if(quoted)throw Error('CSV 引号没有闭合');row.push(cell);if(row.some(value=>value.trim()))rows.push(row);return rows;
}
const columns={text:['word','text','单词','内容','词汇'],translation:['translation','meaning','中文','中文释义','释义','译文'],definition:['definition','english definition','完整英文释义','英英释义'],context:['context','sentence','example','原句','例句'],contextTranslation:['contexttranslation','sentence translation','例句译文']};
function fromRows(rows){
 if(!rows.length)return [];
 const header=rows[0].map(value=>String(value||'').replace(/^\uFEFF/,'').trim().toLowerCase()),positions={};for(const [field,aliases]of Object.entries(columns))positions[field]=header.findIndex(value=>aliases.includes(value));
 const hasHeader=positions.text>=0;if(!hasHeader){positions.text=0;positions.translation=1;positions.definition=-1;positions.context=2;positions.contextTranslation=-1;}
 const kind=header.findIndex(value=>['kind','type','类型'].includes(value));
 return rows.slice(hasHeader?1:0).filter(row=>!hasHeader||kind<0||!row[kind]||['word','单词','词'].includes(row[kind])).map(row=>Object.fromEntries(Object.entries(positions).map(([field,index])=>[field,index<0?'':String(row[index]||'')])));
}
function cleanWords(input){
 if(!Array.isArray(input)||input.length>20000)throw Error('词书最多包含 20000 个条目');const words=[],seen=new Set();let skipped=0;
 for(const item of input){const raw=typeof item==='string'?{text:item}:item;if(!raw||typeof(raw.text||raw.word)!=='string'){skipped++;continue;}const text=normalize(raw.text||raw.word).replace(/^\uFEFF/,'');
  if(!text||text.length>100||!/[\p{L}]/u.test(text)||/[\n。！？.!?]/.test(text)||text.split(/\s+/).length>6){skipped++;continue;}
  const key=text.toLowerCase();if(seen.has(key)){skipped++;continue;}seen.add(key);const word={text};for(const field of ['translation','definition','context','contextTranslation'])word[field]=typeof raw[field]==='string'?raw[field].trim().slice(0,field==='context'?12000:4000):'';if(!word.translation&&typeof raw.meaning==='string')word.translation=raw.meaning.trim().slice(0,4000);words.push(word);
 }
 if(!words.length)throw Error('没有识别到可导入的单词');return {words,skipped};
}
async function xlsxRows(file){
 const zip=await JSZip.loadAsync(fs.readFileSync(file)),parser=new DOMParser(),xml=async name=>{const part=zip.file(name);if(!part)return null;const text=await part.async('string');if(text.length>30_000_000)throw Error('表格解压后过大');return parser.parseFromString(text,'text/xml');};
 const shared=await xml('xl/sharedStrings.xml'),strings=shared?Array.from(shared.getElementsByTagName('si')).map(node=>node.textContent):[];
 const workbook=await xml('xl/workbook.xml'),rel=await xml('xl/_rels/workbook.xml.rels'),first=workbook?.getElementsByTagName('sheet')[0],rid=first?.getAttribute('r:id'),ref=rel&&Array.from(rel.getElementsByTagName('Relationship')).find(item=>item.getAttribute('Id')===rid),target=ref?.getAttribute('Target');
 const sheet=await xml(target?path.posix.normalize(target.startsWith('/')?target.slice(1):'xl/'+target):'xl/worksheets/sheet1.xml');if(!sheet)throw Error('表格没有可读取的工作表');
 return Array.from(sheet.getElementsByTagName('row')).map(node=>{const row=[];for(const cell of Array.from(node.getElementsByTagName('c'))){const letters=cell.getAttribute('r').match(/^[A-Z]+/)?.[0]||'A',index=[...letters].reduce((value,c)=>value*26+c.charCodeAt(0)-64,0)-1;if(index>30)continue;const value=cell.getElementsByTagName('v')[0]?.textContent||'';row[index]=cell.getAttribute('t')==='s'?strings[Number(value)]||'':cell.getAttribute('t')==='inlineStr'?cell.getElementsByTagName('is')[0]?.textContent||'':value;}return row;});
}
async function readWordbook(file){
 if(!file||fs.statSync(file).size>8*1024*1024)throw Error('词书文件需小于 8 MB');const format=path.extname(file).slice(1).toLowerCase();let rows;
 if(format==='xlsx')rows=fromRows(await xlsxRows(file));else {const text=readText(file).replace(/^\uFEFF/,'');if(format==='json'){const raw=JSON.parse(text);rows=Array.isArray(raw)?raw:raw.words||raw.entries?.filter(entry=>entry.kind!=='sentence');}else if(format==='csv'||format==='tsv')rows=fromRows(csvRows(text,format==='tsv'?'\t':','));else if(format==='txt')rows=text.split(/\r?\n/).filter(line=>line.trim()&&!line.trim().startsWith('#')).map(line=>{const [word,translation='',context='']=line.split(/\t|\s+-\s+/);return {text:word,translation,context};});else throw Error('支持 CSV、TSV、TXT、XLSX 和 JSON 词书');}
 return {...cleanWords(rows),name:path.basename(file,path.extname(file))};
}
function createWordbookService(store,dictionary,assets,onChanged=()=>{}){
 const plans=new Map(),pending=new Map();
 const manifest=()=>JSON.parse(fs.readFileSync(path.join(assets,'wordbooks','index.json'),'utf8'));
 async function preview(input={}){
  let plan;if(input.builtin){const info=manifest().find(book=>book.id===input.builtin);if(!info)throw Error('内置词书不存在');plan={...cleanWords(JSON.parse(fs.readFileSync(path.join(assets,'wordbooks',info.id+'.json'),'utf8'))),name:info.name,description:info.description};}else plan=await readWordbook(input.path);
  const token=crypto.randomUUID();for(const [key,value]of plans)if(Date.now()-value.created>1800000)plans.delete(key);while(plans.size>=3)plans.delete(plans.keys().next().value);plans.set(token,{...plan,created:Date.now()});
  const sample=await Promise.all(plan.words.slice(0,8).map(async word=>{const found=await dictionary.lookup(word.text).catch(()=>null);return {text:word.text,translation:word.translation||found?.translation||found?.definition||''};}));return {token,name:plan.name,description:plan.description||'',count:plan.words.length,skipped:plan.skipped,sample};
 }
 function commit(token,input={}){
  if(pending.has(token))return pending.get(token);const plan=plans.get(token);if(!plan||Date.now()-plan.created>1800000)throw Error('导入预览已过期，请重新选择词书');
  const job=(async()=>{let name=normalize(input.name||plan.name);if(!name||name.length>60)throw Error('词本名称需为 1–60 个字符');
   if(input.notebookId&&!store.state.notebooks.some(book=>book.id===input.notebookId))throw Error('词本不存在');
   const prepared=[];for(let i=0;i<plan.words.length;i++){const word=plan.words[i],found=await dictionary.lookup(word.text).catch(()=>null);prepared.push({...word,translation:word.translation||found?.translation||found?.definition||'',definition:word.definition||found?.definition||'',phonetic:found?.phonetic||'',dictionaryWord:found?.word||'',cueWords:found?.cueWords||[],source:word.translation?'词书':found?.source||'词书'});if(i%100===0)await new Promise(resolve=>setImmediate(resolve));}
   const state=store.state;let notebook=input.notebookId?state.notebooks.find(book=>book.id===input.notebookId):state.notebooks.find(book=>book.name.toLowerCase()===name.toLowerCase());if(input.notebookId&&!notebook)throw Error('词本已移除');
   notebook||={id:crypto.randomUUID(),name,bookIds:[],createdAt:new Date().toISOString()};const entries=[...state.entries],positions=new Map(entries.map((entry,index)=>[entry.text.toLowerCase(),index]));let added=0,existing=0,pendingCount=0;
   for(const word of prepared){const at=positions.get(word.text.toLowerCase());if(at!==undefined){const entry=entries[at],update={...entry,notebookIds:[...new Set([...(entry.notebookIds||[]),notebook.id])]};for(const field of ['translation','definition','phonetic','context','contextTranslation'])if(!update[field]&&word[field])update[field]=word[field];update.status=update.translation?'ready':'pending';entries[at]=update;existing++;if(!update.translation)pendingCount++;}else{const entry=withReviewSkills(makeEntry({...word,kind:'word',bookTitle:name}));entry.notebookIds=[notebook.id];positions.set(word.text.toLowerCase(),entries.length);entries.push(entry);added++;if(!entry.translation)pendingCount++;}}
   store.replaceState({...state,entries,notebooks:state.notebooks.some(book=>book.id===notebook.id)?state.notebooks:[...state.notebooks,notebook]});plans.delete(token);onChanged();return {notebook,added,existing,pending:pendingCount,total:prepared.length};
  })();pending.set(token,job);job.finally(()=>pending.delete(token)).catch(()=>{});return job;
 }
 return {list:manifest,preview,commit};
}
module.exports={csvRows,cleanWords,readWordbook,createWordbookService};
