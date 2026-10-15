const {semanticDefinition}=require('../shared/review-cues.mjs');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const key=value=>String(value||'').normalize('NFKC').trim().toLowerCase();
function exchanges(row){const parts=String(row?.exchange||'').split('/').map(part=>{const i=part.indexOf(':');return [part.slice(0,i),part.slice(i+1)];});return new Map(parts);}
const forms=row=>[...exchanges(row)].filter(([code])=>['p','d','i','3','s','r','t'].includes(code)).flatMap(([,value])=>value.split(/[,;]+/).map(key));
function lemmaCandidates(word,row){
  const candidates=new Set(),parts=exchanges(row),explicit=parts.get('0');
  if(explicit)candidates.add(key(explicit));
  const reference=String(row?.translation||'').match(/\b([a-z][a-z'-]*)\s*的(?:过去式|过去分词|现在分词|复数|比较级|最高级)/i);if(reference)candidates.add(key(reference[1]));
  if(!/^[a-z'-]+$/.test(key(word)))return [...candidates];
  const w=key(word);
  if(w.endsWith('ies'))candidates.add(w.slice(0,-3)+'y');
  if(w.endsWith('ves')){candidates.add(w.slice(0,-3)+'f');candidates.add(w.slice(0,-3)+'fe');}
  if(w.endsWith('s')){candidates.add(w.slice(0,-1));candidates.add(w.slice(0,-2));}
  for(const suffix of ['ing','ed','er','est'])if(w.endsWith(suffix)){const base=w.slice(0,-suffix.length);candidates.add(base);candidates.add(base+'e');if(/(.)\1$/.test(base))candidates.add(base.slice(0,-1));}
  return [...candidates].filter(candidate=>candidate&&candidate!==w);
}
function lexicalLines(value){return semanticDefinition(value).split(/\r?\n/).map(line=>line.replace(/[（(][^()（）]*(?:过去式|分词|复数|比较级|最高级)[^()（）]*[)）]/g,'').trim()).filter(Boolean);}
const pos=line=>line.match(/^(n|v(?:t|i|bl)?|a|s|adj|adv|r)\.?\s+/i)?.[1].toLowerCase()||'';
const verbs=line=>pos(line).startsWith('v');
function normalizeRow(row,parent,original){
  if(!row)return null;
  const own=exchanges(row),lemma=parent?.word||'',codes=own.get('1')||'';
  const cueWords=[...new Set([row.word,original,lemma,...forms(row),...forms(parent)].map(key).filter(Boolean))].slice(0,32);
  if(!parent)return {...row,definition:semanticDefinition(row.definition),cueWords};
  const originalLines=lexicalLines(row.translation),baseLines=lexicalLines(parent.translation),originalDefinitions=lexicalLines(row.definition),baseDefinitions=lexicalLines(parent.definition);
  // A headword such as saw/lay has its own verb paradigm as well as an
  // irregular-parent relation. Keep its independent senses intact.
  const independent=['p','d','i','3'].some(code=>own.get(code)&&own.get(code).split(/[,;]+/).some(value=>key(value)!==key(row.word)&&!forms(parent).includes(key(value))));
  const verbForm=/[pdi3]/.test(codes)||forms(parent).includes(key(row.word))&&baseLines.some(verbs)&&!/[rt]/.test(codes);
  let translation=originalLines,definition=originalDefinitions;
  if(verbForm){
    const baseVerb=baseLines.filter(verbs),baseVerbDefinitions=baseDefinitions.filter(verbs);
    const ownRelevant=independent?originalLines:originalLines.filter(line=>verbs(line)||['a','adj','s'].includes(pos(line))||codes.includes('i')&&pos(line)==='n');
    translation=independent?[...ownRelevant,...baseVerb]:[...baseVerb,...ownRelevant];
    definition=[...baseVerbDefinitions,...originalDefinitions.filter(line=>independent||verbs(line)||['a','adj','s'].includes(pos(line))||codes.includes('i')&&pos(line)==='n')];
  }else{
    if(!translation.length)translation=baseLines;
    if(!definition.length)definition=baseDefinitions;
  }
  return {...row,original:original||row.word,lemma,cueWords,translation:[...new Set(translation)].join('\n')||row.translation,definition:[...new Set(definition)].join('\n')};
}
const repairable=entry=>entry.kind==='word'&&/^(?:ECDICT|WordNet)$/i.test(entry.source||'');
const repairFingerprint=entry=>crypto.createHash('sha256').update(JSON.stringify([entry.text,entry.kind,entry.source,entry.translation,entry.definition,entry.cueWords])).digest('hex');
function repairSource(dictionary){
  if(typeof dictionary.assets!=='string')return null;
  const stat=file=>{if(!file)return null;try{const info=fs.statSync(file,{bigint:true});return [path.resolve(file),String(info.size),String(info.mtimeNs),String(info.ino)];}catch{return [path.resolve(file),null];}};
  const custom=dictionary.custom;
  return crypto.createHash('sha256').update(JSON.stringify([1,stat(path.join(dictionary.assets,'dictionary.sqlite')),stat(path.join(dictionary.assets,'wordnet','wordnet.sqlite')),stat(custom?.file),stat(custom?.personalFile),custom?.revision||0,(custom?.catalog||[]).filter(item=>item.enabled).map(item=>stat(custom.dbFile(item.id)))])).digest('hex');
}
function readRepairCache(file,source){
  if(!file||!source)return {};
  try{if(fs.statSync(file).size>16*1024*1024)return {};const cache=JSON.parse(fs.readFileSync(file,'utf8'));if(cache.version===1&&cache.source===source&&cache.entries&&typeof cache.entries==='object'&&!Array.isArray(cache.entries))return cache.entries;}catch{}
  return {};
}
function writeRepairCache(file,source,entries){
  if(!file||!source)return;const temporary=file+'.'+crypto.randomUUID()+'.tmp';
  try{fs.writeFileSync(temporary,JSON.stringify({version:1,source,entries}));fs.renameSync(temporary,file);}catch{/* This disposable startup cache must never prevent learning or saving. */}finally{try{fs.unlinkSync(temporary);}catch{}}
}
async function repairDictionaryEntries(store,dictionary){
  const source=repairSource(dictionary),file=source&&typeof store.dir==='string'?path.join(store.dir,'dictionary-repair-cache.json'):null,cache=readRepairCache(file,source),checked=new Map(),plans=new Map();
  for(const entry of store.state.entries.map(entry=>({...entry,cueWords:Array.isArray(entry.cueWords)?[...entry.cueWords]:entry.cueWords}))){
    if(!repairable(entry))continue;
    const fingerprint=repairFingerprint(entry);if(cache[entry.id]===fingerprint){checked.set(entry.id,fingerprint);continue;}
    const raw=await dictionary.rawLookup(entry.text),found=await dictionary.lookup(entry.text);if(!raw||!found){checked.set(entry.id,fingerprint);continue;}
    const patch={cueWords:found.cueWords||[entry.text]};
    if(entry.translation===raw.translation||!entry.translation)patch.translation=found.translation||found.definition;
    if(entry.definition===raw.definition||!entry.definition)patch.definition=found.definition;
    checked.set(entry.id,repairFingerprint({...entry,...patch}));
    if(JSON.stringify(entry.cueWords||[])!==JSON.stringify(patch.cueWords)||patch.translation!==undefined&&patch.translation!==entry.translation||patch.definition!==undefined&&patch.definition!==entry.definition)plans.set(entry.id,{before:entry,patch});
  }
  let changed=0;
  const entries=store.state.entries.map(entry=>{const plan=plans.get(entry.id);if(!plan||entry.text!==plan.before.text||entry.kind!==plan.before.kind||entry.source!==plan.before.source)return entry;const patch={...plan.patch};for(const field of ['translation','definition','cueWords'])if(JSON.stringify(entry[field])!==JSON.stringify(plan.before[field]))delete patch[field];const next={...entry,...patch};if(repairFingerprint(next)===repairFingerprint(entry))return entry;changed++;return next;});
  if(changed)store.replaceState({...store.state,entries});
  // Only cache the exact lexical result that was checked and actually saved.
  // Reviews, notes and concurrent edits cannot become stale repair decisions.
  if(source&&repairSource(dictionary)===source){const next={};for(const entry of store.state.entries)if(repairable(entry)&&checked.get(entry.id)===repairFingerprint(entry))next[entry.id]=checked.get(entry.id);writeRepairCache(file,source,next);}
  return changed;
}
module.exports={lemmaCandidates,forms,normalizeRow,repairDictionaryEntries};
