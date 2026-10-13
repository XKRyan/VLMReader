const crypto=require('node:crypto');
const {normalize,reviewEntry}=require('./core.cjs');
const {targetPattern,validateSentence,generateSentence}=require('./review-examples.cjs');
const answerKey=text=>normalize(text).replace(/[‘’]/g,"'").replace(/[“”]/g,'"').toLocaleLowerCase();
const fingerprint=entry=>crypto.createHash('sha256').update(JSON.stringify([entry.text,entry.translation,entry.language,entry.kind,entry.context])).digest('hex');
function maskSentence(sentence,entry){
  if(typeof sentence!=='string'||!entry.text?.trim())return null;
  const pattern=targetPattern(entry.text,entry.language);
  const matches=[...sentence.matchAll(pattern)];
  const masked=sentence.replace(pattern,'______');
  return matches.length>0&&/[\p{L}\p{N}]/u.test(masked.replace(/______/g,''))?masked:null;
}
function stateFor(entry){
  const old=entry.clozePractice||{};
  const examples=(Array.isArray(old.examples)?old.examples:[]).filter(example=>{
    if(!example||typeof example.id!=='string'||example.word!==entry.text||example.meaning!==entry.translation||example.language!==entry.language)return false;
    try{validateSentence(example,entry);return true;}catch{return false;}
  }).slice(-12);
  return {...old,examples,recent:(Array.isArray(old.recent)?old.recent:[]).slice(-2),attempts:Number.isInteger(old.attempts)?old.attempts:0,correct:Number.isInteger(old.correct)?old.correct:0};
}
// Most exercises are novel. Recycled examples avoid the last two questions and
// favour previous mistakes; a fixed-size pool prevents unbounded library growth.
function reusableExample(state,random=Math.random){
  const eligible=state.examples.filter(e=>e.shown>0&&!state.recent.includes(e.id));
  if(state.examples.length<3||!eligible.length||random()>=0.2)return null;
  const weights=eligible.map(e=>1+3*(e.wrong||0)/Math.max(1,e.shown));
  let pick=random()*weights.reduce((sum,w)=>sum+w,0);
  return eligible.find((_,i)=>(pick-=weights[i])<0)||eligible.at(-1);
}
function createClozeService(store,getKey,options={}){
  const pending=new Map(),generate=options.generate||generateSentence,random=options.random||Math.random,now=options.now||(()=>new Date());
  const find=id=>{const entry=store.state.entries.find(e=>e.id===id);if(!entry)throw Error('生词条目不存在');if(entry.kind!=='word')throw Error('句子填空例句仅适用于单词或短语');return entry;};
  async function prepare(id){
    const entry=find(id),snapshot=fingerprint(entry),state=stateFor(entry);
    if(state.active?.fingerprint===snapshot&&maskSentence(state.active.sentence,entry))return {entry,exercise:state.active};
    if(pending.has(id))return pending.get(id);
    const request=(async()=>{
      let example,source,masked;
      const original=normalize(entry.context);
      if(original&&state.originalPassedFingerprint!==snapshot&&(masked=maskSentence(original,entry))){
        example={sentence:original,translation:entry.contextTranslation||''};source='original';
      }else{
        example=reusableExample(state,random);source='generated';
        if(!example){
          for(let attempt=0;attempt<2;attempt++){
            const created=await generate({...entry},{...store.state.settings},getKey(),state.examples.map(e=>e.sentence));
            validateSentence(created,entry);
            if(answerKey(created.sentence)===answerKey(original)||state.examples.some(e=>answerKey(e.sentence)===answerKey(created.sentence)))continue;
            example={...created,id:crypto.randomUUID(),shown:0,wrong:0};break;
          }
          if(!example)throw Error('生成了重复例句，请重试');
          state.examples=[...state.examples,example].slice(-12);
        }
        masked=maskSentence(example.sentence,entry);
      }
      if(!masked)throw Error('这个句子无法用于填空，请重试');
      const current=find(id);
      if(fingerprint(current)!==snapshot)throw Error('词条已改变，请重新生成例句');
      const exercise={id:crypto.randomUUID(),sentence:example.sentence,translation:example.translation,target:entry.text,masked,source,exampleId:example.id||'',fingerprint:snapshot,createdAt:now().toISOString(),repeated:(example.shown||0)>0};
      const next={...current,clozePractice:{...state,active:exercise}};
      store.replaceState({...store.state,entries:store.state.entries.map(e=>e.id===id?next:e)});
      return {entry:next,exercise};
    })();
    pending.set(id,request);request.finally(()=>{if(pending.get(id)===request)pending.delete(id);}).catch(()=>{});
    return request;
  }
  function submit(id,exerciseId,answer){
    const entry=find(id),state=stateFor(entry);
    if(state.lastResult?.exerciseId===exerciseId)return {entry,result:state.lastResult};
    const exercise=state.active;
    if(!exercise||exercise.id!==exerciseId||exercise.fingerprint!==fingerprint(entry))throw Error('这道填空已失效，请重新加载');
    if(typeof answer!=='string'||!normalize(answer)||answer.length>150)throw Error('请先填写答案');
    const correct=answerKey(answer)===answerKey(exercise.target),rating=correct?3:1,time=now();
    const updated=reviewEntry(entry,rating,time);
    const record={entryId:id,rating,time:time.toISOString(),isNew:entry.card.reps===0,exerciseId};
    const result={exerciseId,correct,expected:exercise.target,due:new Date(updated.card.due).toISOString(),record};
    const examples=state.examples.map(example=>example.id===exercise.exampleId?{...example,shown:(example.shown||0)+1,wrong:(example.wrong||0)+(correct?0:1),lastAnsweredAt:time.toISOString()}:example);
    updated.clozePractice={...state,examples,active:null,attempts:state.attempts+1,correct:state.correct+(correct?1:0),recent:[...state.recent,exercise.exampleId||'original'].slice(-2),lastResult:result,...(correct&&exercise.source==='original'?{originalPassedFingerprint:fingerprint(entry)}:{})};
    // One atomic write commits the answer, source progression and FSRS schedule.
    store.replaceState({...store.state,entries:store.state.entries.map(e=>e.id===id?updated:e),stats:{...store.state.stats,reviews:[...store.state.stats.reviews,record]}});
    return {entry:updated,result};
  }
  return {prepare,submit};
}
module.exports={answerKey,maskSentence,reusableExample,createClozeService};
