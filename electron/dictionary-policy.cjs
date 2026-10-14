const {semanticDefinition}=require('../shared/review-cues.mjs');
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
async function repairDictionaryEntries(store,dictionary){
  const plans=new Map();
  for(const entry of store.state.entries.map(entry=>({...entry}))){
    if(entry.kind!=='word'||!/^(?:ECDICT|WordNet)$/i.test(entry.source||''))continue;
    const raw=await dictionary.rawLookup(entry.text),found=await dictionary.lookup(entry.text);if(!raw||!found)continue;
    const patch={cueWords:found.cueWords||[entry.text]};
    if(entry.translation===raw.translation||!entry.translation)patch.translation=found.translation||found.definition;
    if(entry.definition===raw.definition||!entry.definition)patch.definition=found.definition;
    if(JSON.stringify(entry.cueWords||[])!==JSON.stringify(patch.cueWords)||patch.translation!==undefined&&patch.translation!==entry.translation||patch.definition!==undefined&&patch.definition!==entry.definition)plans.set(entry.id,{before:entry,patch});
  }
  let changed=0;
  const entries=store.state.entries.map(entry=>{const plan=plans.get(entry.id);if(!plan||entry.text!==plan.before.text)return entry;const patch={...plan.patch};for(const field of ['translation','definition'])if(entry[field]!==plan.before[field])delete patch[field];changed++;return {...entry,...patch};});
  if(changed)store.replaceState({...store.state,entries});
  return changed;
}
module.exports={lemmaCandidates,forms,normalizeRow,repairDictionaryEntries};
