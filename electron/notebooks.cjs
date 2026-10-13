const crypto=require('node:crypto');
const {normalize,makeEntry}=require('./core.cjs');
function notebookIds(state,input){
  const explicit=input.notebookIds||[];
  if(!Array.isArray(explicit)||explicit.some(id=>typeof id!=='string'||!state.notebooks.some(book=>book.id===id)))throw Error('词本不存在');
  if(Object.hasOwn(input,'notebookIds'))return [...new Set(explicit)];
  const linked=state.notebooks.filter(book=>book.bookIds.includes(input.bookId)).map(book=>book.id);
  if(linked.length>1)throw Error('这份文档关联多个词本，请选择加入哪个词本');
  return linked;
}
function collectMembership(state,entry,input){entry.notebookIds=[...new Set([...(entry.notebookIds||[]),...notebookIds(state,input)])];return entry;}
function saveNotebook(store,input,id){
  const state=store.state,existing=id&&state.notebooks.find(book=>book.id===id);
  if(id&&!existing)throw Error('词本不存在');
  const name=normalize(input.name);
  if(!name||name.length>60)throw Error('词本名称需为 1–60 个字符');
  if(state.notebooks.some(book=>book.id!==id&&book.name.toLocaleLowerCase()===name.toLocaleLowerCase()))throw Error('已经有同名词本');
  if(!Array.isArray(input.bookIds)||input.bookIds.some(bookId=>!state.books.some(book=>book.id===bookId)))throw Error('请选择书架中的文档');
  const notebook={id:id||crypto.randomUUID(),createdAt:existing?.createdAt||new Date().toISOString(),name,bookIds:[...new Set(input.bookIds)]};
  const sources=new Set(notebook.bookIds);
  const entries=input.includeExisting?state.entries.map(entry=>sources.has(entry.bookId)||(entry.contexts||[]).some(context=>sources.has(context.bookId))?{...entry,notebookIds:[...new Set([...(entry.notebookIds||[]),notebook.id])]}:entry):state.entries;
  store.replaceState({...state,entries,notebooks:existing?state.notebooks.map(book=>book.id===id?notebook:book):[...state.notebooks,notebook]});
  return notebook;
}
function deleteNotebook(store,id){
  const state=store.state;if(!state.notebooks.some(book=>book.id===id))throw Error('词本不存在');
  store.replaceState({...state,notebooks:state.notebooks.filter(book=>book.id!==id),entries:state.entries.map(entry=>({...entry,notebookIds:(entry.notebookIds||[]).filter(bookId=>bookId!==id)}))});return true;
}
function assignEntries(store,id,ids,remove=false){
  const state=store.state;if(!state.notebooks.some(book=>book.id===id))throw Error('词本不存在');
  if(!Array.isArray(ids)||ids.some(entryId=>typeof entryId!=='string'||!state.entries.some(entry=>entry.id===entryId)))throw Error('生词条目不存在');
  const targets=new Set(ids);
  store.replaceState({...state,entries:state.entries.map(entry=>targets.has(entry.id)?{...entry,notebookIds:remove?(entry.notebookIds||[]).filter(value=>value!==id):[...new Set([...(entry.notebookIds||[]),id])]}:entry)});return true;
}
function mergeBackup(store,backup){
  if(!Array.isArray(backup?.entries))throw Error('这不是有效的 VLMReader 备份');
  const state=store.state,notebooks=[...state.notebooks],mapping=new Map();
  const sourceId=id=>state.books.find(book=>book.id===id||book.hash&&(Array.isArray(backup.books)?backup.books:[]).some(original=>original.id===id&&original.hash===book.hash))?.id;
  for(const original of Array.isArray(backup.notebooks)?backup.notebooks:[]){
    if(typeof original?.id!=='string'||typeof original.name!=='string')continue;
    const name=normalize(original.name).slice(0,60);if(!name)continue;
    const sources=[...new Set((Array.isArray(original.bookIds)?original.bookIds:[]).map(sourceId).filter(Boolean))];
    let group=notebooks.find(item=>item.name.toLocaleLowerCase()===name.toLocaleLowerCase());
    if(group){const next={...group,bookIds:[...new Set([...group.bookIds,...sources])]};notebooks[notebooks.indexOf(group)]=next;group=next;}
    else {group={id:crypto.randomUUID(),name,bookIds:sources,createdAt:new Date().toISOString()};notebooks.push(group);}
    mapping.set(original.id,group.id);
  }
  const entries=[...state.entries];let count=0;
  for(const original of backup.entries){
    if(typeof original?.text!=='string'||!normalize(original.text)||original.text.length>5000||!original.card||!Number.isFinite(new Date(original.card.due).getTime()))continue;
    const ids=[...new Set((Array.isArray(original.notebookIds)?original.notebookIds:[]).map(id=>mapping.get(id)).filter(Boolean))];
    const at=entries.findIndex(entry=>entry.text.toLocaleLowerCase()===normalize(original.text).toLocaleLowerCase());
    if(at>=0){entries[at]={...entries[at],notebookIds:[...new Set([...(entries[at].notebookIds||[]),...ids])]};continue;}
    const base=makeEntry(original),card=original.card;
    const valid=[0,1,2,3].includes(card.state)&&['reps','lapses','stability','difficulty','elapsed_days','scheduled_days'].every(key=>Number.isFinite(card[key])&&card[key]>=0)&&(!card.last_review||Number.isFinite(new Date(card.last_review).getTime()));
    const entry={...base,...original,id:base.id,text:base.text,notebookIds:ids,card:valid?card:base.card,history:valid&&Array.isArray(original.history)?original.history:[]};
    for(const key of ['translation','definition','phonetic','dictionaryWord','context','bookId','bookTitle','source','note'])entry[key]=typeof entry[key]==='string'?entry[key]:'';
    entry.contexts=Array.isArray(entry.contexts)?entry.contexts.filter(context=>context&&typeof context.context==='string'):[];
    entry.bookId=sourceId(entry.bookId)||entry.bookId;entry.contexts=entry.contexts.map(context=>({...context,bookId:sourceId(context.bookId)||context.bookId}));entries.push(entry);count++;
  }
  store.replaceState({...state,notebooks,entries});return count;
}
module.exports={notebookIds,collectMembership,saveNotebook,deleteNotebook,assignEntries,mergeBackup};
