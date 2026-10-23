const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {makeEntry,withReviewSkills,reviewEntry,undoReviewEntry}=require('../electron/core.cjs');
const {Store}=require('../electron/store.cjs');
const {createProductionService}=require('../electron/production.cjs');
const {nextReview,buildReviewQueue,reconcileReviewQueue,firstProductionReady,inReviewScope,METHOD_GAP,REVIEW_METHODS}=require('../shared/review-policy.mjs');
const start=Date.parse('2026-10-22T02:00:00Z'),settings={reviewMethods:REVIEW_METHODS,apiKeySet:true,newPerDay:0};
const word=()=>withReviewSkills(makeEntry({text:'write',translation:'书写',definition:'To form letters and words.',context:'I write notes.'},new Date(start)));
const pass=(entry,mode,time=start)=>reviewEntry(entry,3,new Date(time),mode);
const ready=()=>pass(pass(word(),'meaning'),'spelling');
const state=entry=>({entries:[entry],settings,stats:{reviews:[]},notebooks:[]});

test('first writing requires meaning plus successful cloze or spelling, not mere exposure or failure',()=>{
  let entry=word();assert.equal(firstProductionReady(entry,settings),false);
  entry=pass(entry,'meaning');assert.equal(firstProductionReady(entry,settings),false);
  entry=reviewEntry(entry,1,new Date(start),'spelling');assert.equal(firstProductionReady(entry,settings),false);
  entry=pass(entry,'cloze');assert.equal(firstProductionReady(entry,settings),true);
  entry.clozePractice={lastResult:{record:{hints:1}}};assert.equal(firstProductionReady(entry,settings),false);
  entry=pass(entry,'spelling');assert.equal(firstProductionReady(entry,settings),true);
  entry=reviewEntry(entry,1,new Date(start),'meaning');assert.equal(firstProductionReady(entry,settings),false);
});

test('specialist modes respect enabled prerequisites, writing-only remains directly available',()=>{
  assert.equal(nextReview(word(),{...settings,reviewMethods:['production']},start).mode,'production');
  const one=pass(word(),'meaning'),two=pass(one,'meaning',start+600000);
  assert.equal(firstProductionReady(one,{reviewMethods:['meaning','production']}),false);
  assert.equal(firstProductionReady(two,{reviewMethods:['meaning','production']}),true);
  assert.equal(firstProductionReady(pass(word(),'cloze'),{reviewMethods:['cloze','production']}),true);
  assert.equal(firstProductionReady(ready(),{reviewMethods:['meaning','production']}),true,'Disabling spelling must not erase its demonstrated foundation');
});

test('first writing wins over other due abilities only after the full cue gap, including early mode',()=>{
  const entry=ready(),before=JSON.stringify(entry);
  for(const time of [start,start+METHOD_GAP-1]){
    assert.ok(!buildReviewQueue(state(entry),'all','',time,true).some(task=>task.mode==='production'));
  }
  const task=nextReview(entry,settings,start+METHOD_GAP);
  assert.equal(task.mode,'production');assert.equal(task.firstProduction,true);
  assert.equal(task.isNew,false);assert.equal(JSON.stringify(entry),before);
  assert.equal(nextReview(entry,{...settings,apiKeySet:false},start+METHOD_GAP).mode==='production',false);
});

test('eligible writing survives graduated new-word scope, queue rebuild and undo without sibling grades',()=>{
  let entry=ready();entry.reviewSkills.meaning.card.state=2;entry.reviewSkills.spelling.card.state=2;
  assert.equal(inReviewScope(entry,'unreviewed',new Set(),settings),true);
  const queue=buildReviewQueue(state(entry),'all','unreviewed',start+METHOD_GAP);
  assert.equal(queue[0].mode,'production');
  assert.equal(reconcileReviewQueue(state(entry),[],0,'all','unreviewed',start+METHOD_GAP)[0].mode,'production');
  const before=entry.reviewSkills,graded=pass(entry,'production',start+METHOD_GAP);
  for(const mode of ['meaning','cloze','spelling'])assert.deepEqual(graded.reviewSkills[mode],before[mode]);
  assert.equal(inReviewScope(graded,'unreviewed',new Set(),settings),true,'First writing still has short consolidation steps');
  assert.equal(nextReview(undoReviewEntry(graded),settings,start+METHOD_GAP).firstProduction,true);
});

test('recent writing does not repeat early or jump ahead of other due words',()=>{
  const entry=reviewEntry(ready(),1,new Date(start+METHOD_GAP),'production');
  const s=state(entry),current={entryId:entry.id,mode:'production',due:start+METHOD_GAP,isNew:false,learning:false};
  assert.equal(reconcileReviewQueue(s,[current],1,'all','',start+METHOD_GAP+1,false,false,true).length,1,'Again must wait for its actual due time even in early mode');
  const other=ready();s.entries.push(other);
  const queue=reconcileReviewQueue(s,[current],1,'all','',start+METHOD_GAP+60001,false,false);
  assert.equal(queue[1].entryId,other.id);assert.equal(queue[2].entryId,entry.id);
  assert.equal(entry.reviewSkills.production.card.reps,1,'Ordering must not grade again');
});

function fixture(t,judge){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vlm-first-writing-'));
  t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('vlm-first-writing-'));fs.rmSync(dir,{recursive:true,force:true});});
  const store=new Store(dir);store.state.entries=[ready()];store.save();let time=start+METHOD_GAP,calls=0;
  const service=()=>createProductionService(store,()=>'',async(...args)=>{calls++;return judge?judge(...args):{rating:3,feedback:'正确',corrected:args[1]};},()=>new Date(time));
  return {dir,store,id:store.state.entries[0].id,service,advance:ms=>{time+=ms;},now:()=>time,calls:()=>calls};
}

test('defer persists draft and eligibility without grading or AI and does not immediately reappear',async t=>{
  const f=fixture(t),s=f.service(),q=await s.prepare(f.id),before=JSON.stringify(q.entry.reviewSkills);
  s.draft(f.id,q.exercise.id,'I write notes.');s.defer(f.id,q.exercise.id);
  assert.equal(f.calls(),0);assert.equal(f.store.state.stats.reviews.length,0);
  const resumed=new Store(f.dir).state.entries[0];assert.equal(resumed.productionPractice.active.draft,'I write notes.');
  assert.equal(JSON.stringify(resumed.reviewSkills),before);
  assert.ok(!buildReviewQueue(state(resumed),'all','',f.now(),true).some(task=>task.mode==='production'));
  f.advance(METHOD_GAP);assert.equal(nextReview(resumed,settings,f.now()).firstProduction,true);
});

test('hint use persists on restart, caps grade and schedules independent writing in ten minutes',async t=>{
  const f=fixture(t),s=f.service(),q=await s.prepare(f.id);
  s.hint(f.id,q.exercise.id);s.draft(f.id,q.exercise.id,'I write notes.');
  const restored=new Store(f.dir).state.entries[0];assert.equal(restored.productionPractice.active.hints,1);
  assert.equal(f.calls(),0);assert.equal(restored.reviewSkills.production.card.reps,0);
  const [a,b]=await Promise.all([s.submit(f.id,q.exercise.id,'I write notes.'),s.submit(f.id,q.exercise.id,'I write notes.')]);
  assert.deepEqual(a.result,b.result);assert.equal(f.calls(),1);assert.equal(a.result.rating,1);assert.equal(a.result.assisted,true);assert.equal(a.result.record.hints,1);
  assert.equal(Date.parse(a.result.due),f.now()+600000);
  assert.equal(f.store.state.stats.reviews.length,1);
  f.advance(600000);assert.equal(nextReview(a.entry,settings,f.now()).mode,'production');
  const next=await s.prepare(f.id);assert.notEqual(next.exercise.id,q.exercise.id);assert.equal(next.exercise.hints||0,0);
  const independent=await s.submit(f.id,next.exercise.id,'I write letters.');assert.equal(independent.result.rating,3);assert.equal(independent.entry.productionPractice.retryAfter,null);
});

test('failed writes and AI errors preserve cards, draft, hints and pending first application',async t=>{
  const f=fixture(t,()=>{throw Error('offline');}),s=f.service(),q=await s.prepare(f.id),before=JSON.stringify(f.store.state);
  await assert.rejects(s.submit(f.id,q.exercise.id,'I write notes.'),/offline/);assert.equal(JSON.stringify(f.store.state),before);
  f.store.save=()=>{throw Error('disk full');};
  assert.throws(()=>s.hint(f.id,q.exercise.id),/disk full/);assert.equal(JSON.stringify(f.store.state),before);
  assert.throws(()=>s.defer(f.id,q.exercise.id),/disk full/);assert.equal(JSON.stringify(f.store.state),before);
});
