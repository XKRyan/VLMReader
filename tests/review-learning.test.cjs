const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {makeEntry,withReviewSkills,studyEntry,reviewEntry,reviewIntervals,undoReviewEntry}=require('../electron/core.cjs');
const {Store,DEFAULTS}=require('../electron/store.cjs');
const {buildReviewQueue,nextReview,reconcileReviewQueue,isUnreviewed,NEW_BATCH,METHOD_GAP}=require('../shared/review-policy.mjs');
const now=Date.parse('2026-10-18T04:00:00Z'),minute=60000;
const fresh=()=>withReviewSkills(makeEntry({text:'candid',translation:'坦率的',definition:'Honest and direct.',context:'A candid answer helps us.'},new Date(now)));
const stateFor=entries=>({entries,notebooks:[],stats:{reviews:[]},settings:{...DEFAULTS,reviewMethods:['meaning'],newPerDay:20}});

test('initial study persists without inventing recall success, lapses or history',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vlm-learning-')),store=new Store(dir),entry=fresh();
  const learned=studyEntry(entry,new Date(now));
  assert.deepEqual(learned.reviewSkills,entry.reviewSkills);assert.deepEqual(learned.history,[]);
  assert.equal(learned.card.reps,0);assert.equal(learned.card.lapses,0);assert.equal(isUnreviewed(learned),false);
  assert.equal(studyEntry(learned,new Date(now+minute)),learned,'Retry must not postpone due time');
  store.state.entries=[learned];store.save();const restored=new Store(dir).state.entries[0];
  assert.deepEqual(restored.initialLearning,learned.initialLearning);assert.equal(nextReview(restored,DEFAULTS,now).due,now+minute);
  assert.equal(new Store(dir).state.stats.reviews.length,0);
});

test('initial studies consume one daily new-word slot, never an extra slot on first recall',()=>{
  const learned=studyEntry(fresh(),new Date(now)),state=stateFor([learned,fresh()]);state.settings.newPerDay=1;
  // The recall step is queued right away (it matures in a minute); the second
  // word is not, because the only daily slot is already spent.
  const immediate=buildReviewQueue(state,'all','',now);
  assert.equal(immediate.length,1);assert.equal(immediate[0].isNew,false);
  let queue=buildReviewQueue(state,'all','',now+minute);assert.equal(queue.length,1);assert.equal(queue[0].isNew,false);
  state.entries[0]=reviewEntry(learned,3,new Date(now+minute));state.stats.reviews.push({entryId:learned.id,isNew:false,time:new Date(now+minute).toISOString()});
  assert.equal(buildReviewQueue(state,'all','',now+2*minute).length,0);
  state.settings.newPerDay=0;assert.equal(buildReviewQueue(state,'all','',now+11*minute)[0].entryId,learned.id);
});

test('the batch size is a setting; the default keeps the five-word rhythm',()=>{
  const entries=Array.from({length:12},fresh);
  assert.equal(buildReviewQueue(stateFor(entries),'all','',now).length,NEW_BATCH,'default batch stays 5');
  const wider=stateFor(entries);wider.settings.newBatch=8;
  assert.equal(buildReviewQueue(wider,'all','',now).length,8);
  const single=stateFor(entries);single.settings.newBatch=1;
  assert.equal(buildReviewQueue(single,'all','',now).length,1);
  const daily=stateFor(entries);daily.settings.newBatch=8;daily.settings.newPerDay=3;
  assert.equal(buildReviewQueue(daily,'all','',now).length,3,'the daily limit still wins');
});

test('a five-word batch hands over to the next batch instead of parking the session',()=>{
  const state=stateFor(Array.from({length:12},fresh));assert.equal(buildReviewQueue(state,'all','',now).length,NEW_BATCH);
  state.entries=state.entries.map((entry,i)=>i<NEW_BATCH?studyEntry(entry,new Date(now)):entry);
  // The one-minute recall is imminent, so it is already queued: no dead minute.
  assert.equal(buildReviewQueue(state,'all','',now+minute-1).length,NEW_BATCH);
  assert.ok(buildReviewQueue(state,'all','',now+minute-1).every(task=>task.learning));
  assert.equal(buildReviewQueue(state,'all','',now+minute).length,NEW_BATCH);
  state.entries=state.entries.map((entry,i)=>i<NEW_BATCH?reviewEntry(entry,3,new Date(now+minute)):entry);
  // The ten-minute step is far away, so the sitting continues with new words
  // rather than showing an empty page for nine minutes.
  const handedOver=buildReviewQueue(JSON.parse(JSON.stringify(state)),'all','',now+2*minute);
  assert.equal(handedOver.length,NEW_BATCH);
  assert.ok(handedOver.every(task=>task.stage==='study'),'no future review may be pulled forward');
  assert.equal(buildReviewQueue(state,'all','',now+11*minute).length,NEW_BATCH,'the matured steps come back');
});

test('a lapsed mature word relearns at one and ten minutes before returning to FSRS days',()=>{
  let entry=reviewEntry(fresh(),4,new Date(now-10*86400000));
  const original=entry,again=reviewEntry(entry,1,new Date(now));
  assert.equal(+again.reviewSkills.meaning.card.due,now+minute);assert.equal(again.reviewSkills.meaning.card.state,3);
  const good=reviewEntry(again,3,new Date(now+minute));assert.equal(+good.reviewSkills.meaning.card.due,now+11*minute);assert.equal(good.reviewSkills.meaning.card.state,3);
  entry=reviewEntry(good,3,new Date(now+11*minute));assert.equal(entry.reviewSkills.meaning.card.state,2);
  assert.deepEqual(undoReviewEntry(again).reviewSkills,original.reviewSkills);
  assert.equal(reviewIntervals(original,new Date(now))[0].due,again.reviewSkills.meaning.card.due.toISOString());
});

test('new-word scope retains pending initial recall and does not reset daily usage on navigation',()=>{
  const entry=studyEntry(fresh(),new Date(now)),state=stateFor([entry]);
  assert.equal(buildReviewQueue(state,'word','unreviewed',now+minute)[0].entryId,entry.id);
  state.entries[0]=reviewEntry(entry,3,new Date(now+minute));
  assert.equal(buildReviewQueue(state,'word','unreviewed',now+11*minute)[0].entryId,entry.id);
  state.entries[0]=reviewEntry(state.entries[0],3,new Date(now+11*minute));
  assert.equal(buildReviewQueue(state,'word','unreviewed',now+24*60*minute).length,0);
});

test('an introduced word cannot skip learning with Easy and keeps independent abilities',()=>{
  let entry=studyEntry(fresh(),new Date(now));assert.throws(()=>reviewEntry(entry,4,new Date(now+minute)),/短期回忆/);
  const original=entry.reviewSkills;entry=reviewEntry(entry,3,new Date(now+minute));entry=reviewEntry(entry,3,new Date(now+11*minute));
  assert.equal(entry.reviewSkills.meaning.card.state,2);
  for(const mode of ['cloze','spelling','production'])assert.deepEqual(entry.reviewSkills[mode],original[mode]);
  const task=nextReview(entry,{...DEFAULTS,apiKeySet:true},now+11*minute+METHOD_GAP);assert.notEqual(task.mode,'meaning');
});

test('advancing returns newly due learning without preserving stale future cards',()=>{
  const state=stateFor([fresh(),fresh()]);let queue=buildReviewQueue(state,'all','',now);
  state.entries[0]=studyEntry(state.entries[0],new Date(now));state.entries[1]=studyEntry(state.entries[1],new Date(now));
  // Both presentations are done, so both recall steps take their place at once;
  // the stale "study" card does not linger.
  queue=reconcileReviewQueue(state,queue,1,'all','',now,false,false);
  assert.equal(queue.length,3);assert.ok(queue.slice(1).every(task=>task.learning&&!task.stage));
  queue=reconcileReviewQueue(state,queue,1,'all','',now+minute,false,false);
  assert.equal(queue.length,3);assert.ok(queue.slice(1).every(task=>task.learning&&!task.stage));
  const saved=queue[1];assert.equal(reconcileReviewQueue(state,queue,1,'all','',now+2*minute,true)[1],saved);
});

test('neutral answers retry even a mature cloze card without waiting for its distant FSRS due',()=>{
  const entry=reviewEntry(fresh(),4,new Date(now),'cloze');entry.clozePractice={attempts:1,retryAfter:new Date(now+10*minute).toISOString(),lastResult:{record:{time:new Date(now).toISOString()}}};
  const task=nextReview(entry,{...DEFAULTS,reviewMethods:['cloze']},now);
  assert.equal(task.learning,true);assert.equal(task.due,now+10*minute);
});

test('neutral cloze feedback also spaces an introduced but ungraded sibling ability',()=>{
  const entry=studyEntry(fresh(),new Date(now));entry.clozePractice={attempts:1,retryAfter:new Date(now+11*minute).toISOString(),lastResult:{record:{time:new Date(now+minute).toISOString()}}};
  const task=nextReview(entry,DEFAULTS,now+2*minute);assert.equal(task.mode,'cloze');assert.equal(task.due,now+11*minute);
});
