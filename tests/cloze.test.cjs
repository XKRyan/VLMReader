const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../electron/store.cjs'),{makeEntry}=require('../electron/core.cjs');
const {createClozeService,reusableExample,maskSentence}=require('../electron/cloze.cjs');
const {validateSentence}=require('../electron/review-examples.cjs');
const {validateDefinition}=require('../electron/ai-dictionary.cjs');
function fixture(t,context='A resilient learner keeps trying.'){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vlm-cloze-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new Store(dir),entry=makeEntry({text:'resilient',kind:'word',translation:'有韧性的',context});store.state.entries=[entry];store.save();let calls=0,clock=new Date('2026-10-13T04:00:00Z');
  const generate=async e=>({...validateSentence({sentence:`The resilient student completed exercise ${++calls} despite the challenge.`,translation:'有韧性的学生克服困难完成了练习。'},e),word:e.text,meaning:e.translation,language:e.language});
  const service=createClozeService(store,()=>'',{generate,random:()=>.9,now:()=>clock});
  return {store,entry,service,generate,calls:()=>calls,advance:()=>{clock=new Date(store.state.entries[0].card.due);}};
}
test('original must be correct before AI examples; grading is atomic, persistent and idempotent',async t=>{
  const f=fixture(t);let q=await f.service.prepare(f.entry.id);assert.equal(q.exercise.source,'original');assert.equal(f.calls(),0);
  assert.throws(()=>f.service.submit(f.entry.id,q.exercise.id,' '),/填写/);assert.equal(f.store.state.stats.reviews.length,0);
  const wrong=f.service.submit(f.entry.id,q.exercise.id,'fragile');assert.equal(wrong.result.record.rating,1);assert.equal(wrong.result.correct,false);
  assert.equal(f.service.submit(f.entry.id,q.exercise.id,'resilient').result.correct,false);assert.equal(f.store.state.stats.reviews.length,1);
  f.advance();q=await f.service.prepare(f.entry.id);assert.equal(q.exercise.source,'original');
  const good=f.service.submit(f.entry.id,q.exercise.id,' Resilient ');assert.equal(good.result.record.rating,3);
  f.advance();q=await f.service.prepare(f.entry.id);assert.equal(q.exercise.source,'generated');assert.equal(f.calls(),1);assert.equal(q.entry.context,f.entry.context);
  const restart=new Store(f.store.dir),resumed=createClozeService(restart,()=>'',{generate:()=>{throw Error('should not call API');}});
  assert.equal((await resumed.prepare(f.entry.id)).exercise.id,q.exercise.id);assert.equal(restart.state.stats.reviews.length,2);
  const previous=JSON.stringify(restart.state);restart.save=()=>{throw Error('disk full');};
  assert.throws(()=>resumed.submit(f.entry.id,q.exercise.id,'resilient'),/disk full/);assert.equal(JSON.stringify(restart.state),previous);
});
test('no usable original generates new examples and successful reviews extend FSRS intervals',async t=>{
  const f=fixture(t,'resilient'),sentences=new Set(),delays=[];
  for(let i=0;i<7;i++){const q=await f.service.prepare(f.entry.id);assert.equal(q.exercise.source,'generated');assert.ok(!sentences.has(q.exercise.sentence));sentences.add(q.exercise.sentence);
    const r=f.service.submit(f.entry.id,q.exercise.id,'resilient');delays.push(new Date(r.result.due)-new Date(r.result.record.time));f.advance();}
  assert.ok(delays.at(-1)>delays[2]);assert.equal(f.store.state.entries[0].clozePractice.correct,7);
});
test('generation failure and deletion or edits while generating never count or resurrect entries',async t=>{
  const f=fixture(t,'');let finish;const wait=createClozeService(f.store,()=>'',{generate:e=>new Promise(resolve=>{finish=()=>resolve({sentence:'A resilient student learns from every difficult task.',translation:'有韧性的学生从困难任务学习。',word:e.text,meaning:e.translation,language:e.language});})});
  const a=wait.prepare(f.entry.id),b=wait.prepare(f.entry.id);f.store.state.entries=[];finish();await assert.rejects(a,/不存在/);await assert.rejects(b,/不存在/);assert.equal(f.store.state.stats.reviews.length,0);
  f.store.state.entries=[f.entry];const changed=wait.prepare(f.entry.id);f.store.state.entries[0]={...f.entry,translation:'改过的释义'};finish();await assert.rejects(changed,/改变/);
  const fail=createClozeService(f.store,()=>'',{generate:()=>{throw Error('API unavailable');}});await assert.rejects(fail.prepare(f.entry.id),/unavailable/);assert.equal(f.store.state.stats.reviews.length,0);
});
test('recycled pool excludes last two examples and increases probability of prior mistakes',()=>{
  const state={examples:[{id:'old',shown:4,wrong:0},{id:'wrong',shown:4,wrong:4},{id:'recent',shown:2,wrong:2},{id:'latest',shown:1,wrong:0}],recent:['recent','latest']};
  assert.equal(reusableExample(state,()=>.5),null);let seq=[.1,.5];assert.equal(reusableExample(state,()=>seq.shift()).id,'wrong');
  assert.equal(reusableExample({examples:state.examples.slice(0,2),recent:[]},()=>0),null);
});
test('pool size stays bounded and duplicate generated sentences are rejected without scheduling',async t=>{
  const f=fixture(t,'');for(let i=0;i<15;i++){const q=await f.service.prepare(f.entry.id);f.service.submit(f.entry.id,q.exercise.id,'resilient');f.advance();}assert.equal(f.store.state.entries[0].clozePractice.examples.length,12);
  const previous=JSON.stringify(f.store.state);const old=f.store.state.entries[0].clozePractice.examples[0];const duplicate=createClozeService(f.store,()=>'',{random:()=>.9,generate:()=>old});await assert.rejects(duplicate.prepare(f.entry.id),/重复/);assert.equal(JSON.stringify(f.store.state),previous);
});
test('safe word boundaries, Chinese examples and fixed AI dictionary schema',()=>{
  assert.equal(maskSentence('Learning resilience takes time.',{text:'resilient',language:'en'}),null);
  assert.ok(maskSentence('I learn C++ every day.',{text:'C++',language:'en'}).includes('______'));
  assert.throws(()=>validateSentence({sentence:'A resilient student stays resilient every day.',translation:'重复'}, {text:'resilient',language:'en'}),/一次/);
  assert.ok(validateSentence({sentence:'每天坚持复习能够帮助我们记住新知识。',translation:'Daily revision helps us remember new knowledge.'},{text:'复习',language:'zh'}));
  assert.throws(()=>validateDefinition({phonetic:'',definition:'test',meanings:[{partOfSpeech:'n.',meaning:''}]},'test'),/格式/);
  const result=validateDefinition({phonetic:'test',definition:'an examination',meanings:[{partOfSpeech:'n.',meaning:'测试'}]},'test');assert.equal(result.translation,'n. 测试');
});
