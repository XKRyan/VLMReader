const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {makeEntry,withReviewSkills,reviewEntry,undoReviewEntry}=require('../electron/core.cjs');
const {Store,DEFAULTS}=require('../electron/store.cjs');
const {nextReview,buildReviewQueue,isUnreviewed,METHOD_GAP}=require('../shared/review-policy.mjs');
const {createClozeService}=require('../electron/cloze.cjs');
const start=new Date('2026-10-13T04:00:00Z');
function word(){return withReviewSkills(makeEntry({text:'resilient',kind:'word',translation:'有韧性的',context:'A resilient learner keeps trying.'},start));}
function fixture(t,options={}){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vlm-policy-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(dir);store.state.entries=[word()];let time=start;let generated=0;const service=createClozeService(store,()=>'',{now:()=>time,random:()=>.9,generate:async e=>({word:e.text,meaning:e.translation,language:e.language,sentence:`The resilient learner completed another exercise ${++generated} yesterday.`,translation:'这位学习者昨天完成了练习。'}),...options});return {store,service,id:store.state.entries[0].id,advance:minutes=>{time=new Date(time.getTime()+minutes*60000);}};}
test('each method has a separate FSRS card and undo restores only the affected skill',()=>{
  const original=word(),meaning=reviewEntry(original,3,start,'meaning');assert.equal(meaning.reviewSkills.meaning.card.reps,1);assert.equal(meaning.reviewSkills.cloze.card.reps,0);
  const cloze=reviewEntry(meaning,1,new Date(start.getTime()+METHOD_GAP),'cloze');assert.deepEqual(cloze.reviewSkills.meaning,meaning.reviewSkills.meaning);assert.equal(cloze.reviewSkills.cloze.card.reps,1);assert.equal(cloze.card.reps,2);
  const spelling=reviewEntry(cloze,4,new Date(start.getTime()+METHOD_GAP*2),'spelling');assert.equal(spelling.reviewSkills.spelling.card.reps,1);assert.deepEqual(undoReviewEntry(spelling).reviewSkills,cloze.reviewSkills);
});
test('mixed queue honors enabled methods, spreads introductions and emits each word once',()=>{
  const original=word();assert.equal(nextReview(original,DEFAULTS,+start).mode,'meaning');assert.equal(nextReview(original,{reviewMethods:['cloze']},+start).mode,'cloze');
  const learned=reviewEntry(original,4,start,'meaning');const next=nextReview(learned,DEFAULTS,+start);assert.ok(next.due>=+start+METHOD_GAP);
  assert.ok(['cloze','spelling'].includes(nextReview(learned,DEFAULTS,+start+METHOD_GAP).mode));
  const state={entries:[original,learned],settings:{...DEFAULTS,newPerDay:1},stats:{reviews:[]}};state.entries[1]={...learned,id:'other'};assert.equal(buildReviewQueue(state,'all','',+start).length,1);
  const queue=buildReviewQueue(state,'all','',+start+METHOD_GAP);assert.equal(new Set(queue.map(task=>task.entryId)).size,queue.length);
  state.stats.reviews=[{entryId:original.id,time:start.toISOString(),isNew:true},{entryId:original.id,time:start.toISOString(),isNew:true}];assert.ok(!buildReviewQueue(state,'all','',+start).some(task=>task.isNew));
});
test('old combined progress is preserved once rather than copied into all abilities',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vlm-migrate-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const original=makeEntry({text:'candid',translation:'坦率的'},start);original.card.reps=4;original.card.stability=2.4;
  fs.writeFileSync(path.join(dir,'library.json'),JSON.stringify({entries:[original],stats:{reviews:[{entryId:original.id,exerciseId:'old-cloze'}]},settings:{reviewMethods:[]}}));
  const store=new Store(dir),entry=store.state.entries[0];assert.equal(entry.reviewSkills.cloze.card.reps,4);assert.equal(entry.reviewSkills.meaning.card.reps,0);assert.equal(entry.reviewSkills.spelling.card.reps,0);assert.deepEqual(entry.card,JSON.parse(JSON.stringify(original.card)));assert.deepEqual(store.state.settings.reviewMethods,['meaning']);
});
test('three persisted hints give meaning, initial letter, then one automatic Again grade',async t=>{
  const f=fixture(t);const q=await f.service.prepare(f.id);assert.equal(f.service.hint(f.id,q.exercise.id).exercise.hints,1);assert.equal(f.store.state.stats.reviews.length,0);
  const resumed=createClozeService(new Store(f.store.dir),()=>'',{now:()=>start});assert.equal((await resumed.prepare(f.id)).exercise.hints,1);
  assert.equal(f.service.hint(f.id,q.exercise.id).exercise.hints,2);const revealed=f.service.hint(f.id,q.exercise.id);assert.equal(revealed.result.record.rating,1);assert.equal(revealed.result.revealed,true);assert.equal(revealed.entry.clozePractice.correct,0);
  f.service.hint(f.id,q.exercise.id);assert.equal(f.store.state.stats.reviews.length,1);assert.equal(revealed.entry.reviewSkills.meaning.card.reps,0);
});
test('hint-assisted correct answers require relearning rather than inflating unassisted recall',async t=>{
  const f=fixture(t),q=await f.service.prepare(f.id);f.service.hint(f.id,q.exercise.id);const result=f.service.submit(f.id,q.exercise.id,'resilient');assert.equal(result.result.record.rating,1);assert.equal(result.result.correct,true);assert.equal(result.result.assisted,true);assert.equal(result.entry.clozePractice.unassistedStreak,0);
});
test('valid synonyms are neutral, cached and deferred without changing mastery',async t=>{
  let calls=0;const f=fixture(t,{judge:async()=>{calls++;return {neutral:true,reason:'本句可替换。'};}}),q=await f.service.prepare(f.id),before=JSON.stringify(f.store.state.entries[0].reviewSkills);
  const [a,b]=await Promise.all([f.service.submit(f.id,q.exercise.id,'tough'),f.service.submit(f.id,q.exercise.id,'tough')]);assert.equal(a.result.outcome,'neutral');assert.deepEqual(a.result,b.result);assert.equal(calls,1);assert.equal(f.store.state.stats.reviews.length,1);assert.equal(JSON.stringify(a.entry.reviewSkills),before);assert.equal(a.result.record.rating,0);assert.ok(!isUnreviewed(a.entry));assert.equal(nextReview(a.entry,DEFAULTS,+start).due,+start+600000);assert.ok(!a.entry.clozePractice.originalPassedFingerprint);
  f.advance(10);const again=await f.service.prepare(f.id);assert.notEqual(again.exercise.sentence,q.exercise.sentence);await f.service.submit(f.id,again.exercise.id,'tough');assert.equal(calls,2);assert.equal(f.store.state.entries[0].reviewSkills.cloze.card.reps,0);
});
test('explicitly incompatible answers remain wrong; judge failure does not grade',async t=>{
  const f=fixture(t,{judge:async()=>({neutral:false,reason:'反义词。'})}),q=await f.service.prepare(f.id);assert.equal((await f.service.submit(f.id,q.exercise.id,'fragile')).result.record.rating,1);
  f.advance(10);const other=await f.service.prepare(f.id),failed=createClozeService(f.store,()=>'',{judge:async()=>{throw Error('offline');}}),before=JSON.stringify(f.store.state);
  await assert.rejects(failed.submit(f.id,other.exercise.id,'tough'),/offline/);assert.equal(JSON.stringify(f.store.state),before);
});
test('generated alternatives are checked with zero extra API calls',async t=>{
  let calls=0;const f=fixture(t,{generate:async entry=>({word:entry.text,meaning:entry.translation,language:entry.language,sentence:'A resilient student can handle this difficult task.',translation:'有韧性的学生能应对困难任务。',alternatives:['tough']}),judge:async()=>{calls++;throw Error('must not call');}});f.store.state.entries[0].context='';
  const q=await f.service.prepare(f.id);assert.equal(f.service.submit(f.id,q.exercise.id,'tough').result.outcome,'neutral');assert.equal(calls,0);
});
test('failed hint and answer writes roll back the exercise, card and stats',async t=>{
  const f=fixture(t),q=await f.service.prepare(f.id),before=JSON.stringify(f.store.state);f.store.save=()=>{throw Error('disk full');};assert.throws(()=>f.service.hint(f.id,q.exercise.id),/disk full/);assert.throws(()=>f.service.submit(f.id,q.exercise.id,'resilient'),/disk full/);assert.equal(JSON.stringify(f.store.state),before);
});
