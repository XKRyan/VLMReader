const crypto=require('node:crypto');
const {normalize,reviewEntry}=require('./core.cjs');
const {targetPattern,validateSentence,generateSentence}=require('./review-examples.cjs');
const {judgeAnswer,plausibleAnswer}=require('./answer-judge.cjs');
const {isUnreviewed}=require('../shared/review-policy.mjs');
const {family,canVary}=require('./word-forms.cjs');
const answerKey=text=>normalize(text).replace(/[‘’]/g,"'").replace(/[“”]/g,'"').toLocaleLowerCase();
const fingerprint=entry=>crypto.createHash('sha256').update(JSON.stringify([entry.text,entry.translation,entry.language,entry.kind,entry.context])).digest('hex');
function maskSentence(sentence,entry){
  if(typeof sentence!=='string'||!entry.text?.trim())return null;
  const pattern=targetPattern(entry.text,entry.language);
  const matches=[...sentence.matchAll(pattern)];
  const masked=sentence.replace(pattern,'______');
  return matches.length>0&&/[\p{L}\p{N}]/u.test(masked.replace(/______/g,''))?masked:null;
}
function originalSentence(entry){
  return [...new Intl.Segmenter(entry.language,{granularity:'sentence'}).segment(normalize(entry.context))].map(part=>part.segment.trim()).find(sentence=>sentence.length<=500&&[...sentence.matchAll(targetPattern(entry.text,entry.language))].length===1&&maskSentence(sentence,entry))||'';
}
function stateFor(entry){
  const old=entry.clozePractice||{};
  const examples=(Array.isArray(old.examples)?old.examples:[]).filter(example=>{
    if(!example||typeof example.id!=='string'||example.word!==entry.text||example.meaning!==entry.translation||example.language!==entry.language)return false;
    try{validateSentence({...example,translation:example.translation||'本地例句'},entry,example.target||entry.text);return true;}catch{return false;}
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
  const pending=new Map(),submissions=new Map(),generate=options.generate||generateSentence,judge=options.judge||judgeAnswer,random=options.random||Math.random,now=options.now||(()=>new Date());
  const find=id=>{const entry=store.state.entries.find(e=>e.id===id);if(!entry)throw Error('生词条目不存在');if(entry.kind!=='word')throw Error('句子填空例句仅适用于单词或短语');return entry;};
  async function prepare(id){
    const entry=find(id),snapshot=fingerprint(entry),state=stateFor(entry);
    if(state.active?.fingerprint===snapshot&&maskSentence(state.active.sentence,{...entry,text:state.active.target})){
      if(entry.language!=='en')return {entry,exercise:state.active};
      const found=!entry.definition&&options.lookup?await options.lookup(entry.text).catch(()=>null):null,definition=entry.definition||found?.definition||'',current=find(id),active=current.clozePractice?.active;
      if(fingerprint(current)!==snapshot||active?.id!==state.active.id)throw Error('词条已改变，请重新加载');
      const hintStages=active.hints?active.hintStages:definition?['english','meaning','initial']:active.hintStages;
      if(current.definition===definition&&JSON.stringify(active.hintStages)===JSON.stringify(hintStages))return {entry:current,exercise:active};
      const exercise={...active,...(hintStages?{hintStages}:{})},next={...current,definition,clozePractice:{...current.clozePractice,active:exercise}};store.replaceState({...store.state,entries:store.state.entries.map(item=>item.id===id?next:item)});return {entry:next,exercise};
    }
    if(pending.has(id))return pending.get(id);
    const request=(async()=>{
      let example,source,masked;
      const found=options.lookup?await Promise.resolve(options.lookup(entry.text)).catch(()=>null):null;
      const forms=family(found,entry),definition=entry.definition?.trim()||found?.definition||'',varied=canVary(entry,now());
      state.examples=state.examples.filter(example=>example.source!=='library'||store.state.books.some(book=>book.id===example.bookId));
      const original=originalSentence(entry);
      if(original&&state.attempts===0&&(masked=maskSentence(original,entry))){
        example={id:'original',sentence:original,translation:entry.contextTranslation||'',word:entry.text,meaning:entry.translation,language:entry.language,target:entry.text,source:'original',shown:0,wrong:0};source='original';state.examples=[...state.examples.filter(item=>item.id!=='original'),example].slice(-12);
      }else{
        example=reusableExample({...state,examples:state.examples.filter(item=>varied||!item.target||answerKey(item.target)===answerKey(entry.text))},random);
        if(example)source=example.source||'generated';
        if(!example){
          const library=options.findExamples?await options.findExamples(entry):entry.libraryExamples||[];
          const available=library.filter(item=>maskSentence(item.sentence,entry)&&answerKey(item.sentence)!==answerKey(original)&&!state.examples.some(old=>answerKey(old.sentence)===answerKey(item.sentence)));
          if(available.length){example={...available[0],id:crypto.createHash('sha256').update(available[0].bookId+available[0].sentence).digest('hex'),translation:'',target:entry.text,word:entry.text,meaning:entry.translation,language:entry.language,source:'library',shown:0,wrong:0};source='library';state.examples=[...state.examples,example].slice(-12);}
        }
        if(!example){
          const variant=varied&&forms.length&&random()<.25?forms[Math.min(forms.length-1,Math.floor(random()*forms.length))]:null,target=variant?.word||entry.text;
          for(let attempt=0;attempt<2;attempt++){
            const created=await generate({...entry},{...store.state.settings},getKey(),state.examples.map(e=>e.sentence),{target});
            validateSentence(created,entry,target);
            if(answerKey(created.sentence)===answerKey(original)||state.examples.some(e=>answerKey(e.sentence)===answerKey(created.sentence)))continue;
            example={...created,target,source:'generated',id:crypto.randomUUID(),shown:0,wrong:0};source='generated';break;
          }
          if(!example)throw Error('生成了重复例句，请重试');
          state.examples=[...state.examples,example].slice(-12);
        }
        masked=maskSentence(example.sentence,{...entry,text:example.target||entry.text});
      }
      if(!masked)throw Error('这个句子无法用于填空，请重试');
      const current=find(id);
      if(fingerprint(current)!==snapshot)throw Error('词条已改变，请重新生成例句');
      const hintStages=entry.language==='en'&&definition.trim()?['english','meaning','initial']:['meaning','initial'];
      const exercise={id:crypto.randomUUID(),sentence:example.sentence,translation:example.translation,target:example.target||entry.text,masked,source,exampleId:example.id||'',fingerprint:snapshot,createdAt:now().toISOString(),repeated:(example.shown||0)>0,hints:0,hintStages,alternatives:example.alternatives||[],family:[entry.text,...forms.map(item=>item.word)],...(source==='library'?{bookId:example.bookId,bookTitle:example.bookTitle,location:example.location}:{})};
      const next={...current,definition:current.definition||definition,clozePractice:{...state,active:exercise}};
      store.replaceState({...store.state,entries:store.state.entries.map(e=>e.id===id?next:e)});
      return {entry:next,exercise};
    })();
    pending.set(id,request);request.finally(()=>{if(pending.get(id)===request)pending.delete(id);}).catch(()=>{});
    return request;
  }
  function commit(id,exerciseId,answer,decision={},revealed=false){
    const entry=find(id),state=stateFor(entry);
    if(state.lastResult?.exerciseId===exerciseId)return {entry,result:state.lastResult};
    const exercise=state.active;
    if(!exercise||exercise.id!==exerciseId||exercise.fingerprint!==fingerprint(entry))throw Error('这道填空已失效，请重新加载');
    const correct=!revealed&&answerKey(answer)===answerKey(exercise.target),neutral=!revealed&&!correct&&decision.neutral===true;
    const assisted=correct&&!!exercise.hints,rating=neutral?0:correct&&!assisted?3:1,time=now();
    const updated=neutral?{...entry}:reviewEntry(entry,rating,time,'cloze');
    const record={entryId:id,mode:'cloze',rating,time:time.toISOString(),isNew:isUnreviewed(entry),exerciseId,outcome:neutral?'neutral':correct?'correct':'incorrect',hints:revealed?(exercise.hintStages?.length||2)+1:exercise.hints||0};
    const due=neutral?new Date(time.getTime()+10*60*1000).toISOString():new Date(updated.reviewSkills.cloze.card.due).toISOString();
    const result={exerciseId,correct,assisted,outcome:record.outcome,reason:decision.reason||'',revealed,expected:exercise.target,due,record};
    const examples=state.examples.map(example=>example.id===exercise.exampleId?{...example,shown:(example.shown||0)+1,wrong:(example.wrong||0)+(correct||neutral?0:1),lastAnsweredAt:time.toISOString()}:example);
    const decisions=decision.cacheKey?[...(state.decisions||[]).filter(item=>item.key!==decision.cacheKey),{key:decision.cacheKey,neutral:decision.neutral,reason:decision.reason}].slice(-40):state.decisions||[];
    const success=correct&&!assisted;
    updated.clozePractice={...state,examples,decisions,active:null,attempts:state.attempts+1,correct:state.correct+(correct?1:0),unassistedStreak:success?(state.unassistedStreak||0)+1:neutral?(state.unassistedStreak||0):0,firstUnassistedAt:state.firstUnassistedAt||(success?time.toISOString():null),neutral:(state.neutral||0)+(neutral?1:0),retryAfter:neutral?due:null,recent:[...state.recent,exercise.exampleId||'original'].slice(-2),lastResult:result,...(success&&exercise.source==='original'?{originalPassedFingerprint:fingerprint(entry)}:{})};
    // One atomic write commits the answer, source progression and FSRS schedule.
    store.replaceState({...store.state,entries:store.state.entries.map(e=>e.id===id?updated:e),stats:{...store.state.stats,reviews:[...store.state.stats.reviews,record]}});
    return {entry:updated,result};
  }
  function submit(id,exerciseId,answer){
    const entry=find(id),state=stateFor(entry);
    if(state.lastResult?.exerciseId===exerciseId)return {entry,result:state.lastResult};
    const exercise=state.active;
    if(!exercise||exercise.id!==exerciseId||exercise.fingerprint!==fingerprint(entry))throw Error('这道填空已失效，请重新加载');
    if(typeof answer!=='string'||!normalize(answer)||answer.length>150)throw Error('请先填写答案');
    if(submissions.has(exerciseId))return submissions.get(exerciseId);
    const key=answerKey(answer);
    if(key===answerKey(exercise.target))return commit(id,exerciseId,answer);
    if((exercise.family||[]).some(word=>answerKey(word)===key))return commit(id,exerciseId,answer,{reason:'词义相关，但本句需要的词形是 '+exercise.target+'。'});
    if((exercise.alternatives||[]).some(word=>answerKey(word)===key))return commit(id,exerciseId,answer,{neutral:true,reason:'这个替代词适合本句；稍后再练目标词。'});
    const cacheKey=crypto.createHash('sha256').update(JSON.stringify([2,exercise.fingerprint,exercise.masked,key])).digest('hex');
    const cached=(state.decisions||[]).find(item=>item.key===cacheKey);
    if(cached)return commit(id,exerciseId,answer,cached);
    if(!plausibleAnswer(answer,entry.language)||!options.lookup&&!options.judge)return commit(id,exerciseId,answer);
    const task=(async()=>{
      if(options.lookup&&!await options.lookup(answer))return commit(id,exerciseId,answer);
      const decision=await judge({...entry},exercise,normalize(answer),{...store.state.settings},getKey());
      return commit(id,exerciseId,answer,{...decision,cacheKey});
    })();
    submissions.set(exerciseId,task);task.finally(()=>submissions.delete(exerciseId)).catch(()=>{});return task;
  }
  function hint(id,exerciseId){
    const entry=find(id),state=stateFor(entry);
    if(state.lastResult?.exerciseId===exerciseId)return {entry,exercise:null,result:state.lastResult};
    const exercise=state.active;
    if(!exercise||exercise.id!==exerciseId||exercise.fingerprint!==fingerprint(entry))throw Error('这道填空已失效，请重新加载');
    if(submissions.has(exerciseId))throw Error('正在判定答案，请稍后');
    if((exercise.hints||0)>=(exercise.hintStages?.length||2))return {...commit(id,exerciseId,'',{},true),exercise:null};
    const nextExercise={...exercise,hints:(exercise.hints||0)+1},next={...entry,clozePractice:{...state,active:nextExercise}};
    store.replaceState({...store.state,entries:store.state.entries.map(e=>e.id===id?next:e)});
    return {entry:next,exercise:nextExercise,result:null};
  }
  return {prepare,submit,hint};
}
module.exports={answerKey,maskSentence,reusableExample,createClozeService};
