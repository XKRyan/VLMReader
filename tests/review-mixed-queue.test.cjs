const {test}=require('node:test'),assert=require('node:assert/strict');
const {makeEntry,withReviewSkills,reviewEntry}=require('../electron/core.cjs');
const {DEFAULTS}=require('../electron/store.cjs');
const {REVIEW_METHODS,METHOD_GAP,buildReviewQueue,nextReview,reconcileReviewQueue}=require('../shared/review-policy.mjs');
const now=Date.parse('2026-10-16T04:00:00Z'),yesterday=new Date(now-86400000);
const settings={...DEFAULTS,reviewMethods:REVIEW_METHODS,apiKeySet:true,newPerDay:2};
function dueWord(mode,index=0){
  let entry=withReviewSkills(makeEntry({text:'write',translation:'书写',context:'I write a short note every morning.'},yesterday));
  entry.id=mode+'-'+index;
  // A learner may already have an extensive backlog in one ability while
  // sentence writing is newly enabled and has never been graded.
  for(const trained of REVIEW_METHODS.slice(0,REVIEW_METHODS.indexOf(mode))){
    entry=reviewEntry(entry,4,yesterday,trained);
    entry.reviewSkills[trained].card.due=new Date(now+86400000).toISOString();
  }
  if(mode==='meaning')entry=reviewEntry(entry,3,new Date(+yesterday-index*60000),mode);
  // This lane represents a word whose first writing checkpoint is already done.
  if(mode==='spelling'){entry=reviewEntry(entry,4,yesterday,'production');entry.reviewSkills.production.card.due=new Date(now+86400000).toISOString();}
  return entry;
}
const stateFor=entries=>({entries,settings:{...settings},stats:{reviews:[]}});
test('an overdue recall backlog cannot hide enabled sentence-writing practice',()=>{
  const entries=[...Array.from({length:60},(_,i)=>dueWord('meaning',i)),dueWord('cloze'),dueWord('spelling'),dueWord('production')];
  const fresh=withReviewSkills(makeEntry({text:'candid',translation:'坦率的'},yesterday));entries.push(fresh);
  const state=stateFor(entries),before=JSON.stringify(state),queue=buildReviewQueue(state,'all','',now);
  assert.deepEqual(new Set(queue.slice(0,4).map(task=>task.mode)),new Set(REVIEW_METHODS));
  assert.ok(!queue.some(task=>task.entryId===fresh.id),'An unfinished learning backlog must hold new vocabulary back');
  assert.equal(new Set(queue.map(task=>task.entryId)).size,queue.length);
  const recall=queue.filter(task=>task.mode==='meaning'&&!task.isNew);
  assert.deepEqual(recall.map(task=>task.due),recall.map(task=>task.due).sort((a,b)=>a-b),'Urgency within each ability must be retained');
  assert.equal(JSON.stringify(state),before,'Mixing must not grade or rewrite any memory card');
});
test('writing introductions do not spend a second new-word allowance and remain spaced',()=>{
  const entry=dueWord('production'),state=stateFor([entry]);state.settings.newPerDay=0;
  const task=buildReviewQueue(state,'all','',now)[0];assert.equal(task.mode,'production');assert.equal(task.isNew,false);
  const justPractised=reviewEntry(entry,4,new Date(now),'spelling');
  assert.ok(nextReview(justPractised,settings,now).due>=now+METHOD_GAP);
  state.settings.apiKeySet=false;assert.ok(!buildReviewQueue(state,'all','',now).some(task=>task.mode==='production'));
  state.settings={...settings,reviewMethods:['meaning','cloze','spelling']};assert.ok(!buildReviewQueue(state,'all','',now).some(task=>task.mode==='production'));
});
test('ordinary Good ratings introduce every enabled ability without granting sibling mastery',()=>{
  let entry=withReviewSkills(makeEntry({text:'write',translation:'书写'},yesterday)),time=+yesterday;
  const seen=new Set(),practices=[];
  for(let round=0;round<12;round++){
    const task=nextReview(entry,settings,time);time=Math.max(time,task.due);
    const previous=practices.at(-1);if(previous&&previous.mode!==task.mode)assert.ok(time-previous.time>=METHOD_GAP);
    seen.add(task.mode);const before=entry.reviewSkills;entry=reviewEntry(entry,3,new Date(time),task.mode);
    for(const other of REVIEW_METHODS)if(other!==task.mode)assert.deepEqual(entry.reviewSkills[other],before[other]);
    practices.push({mode:task.mode,time});
  }
  assert.deepEqual(seen,new Set(REVIEW_METHODS));
});
test('changing enabled methods refreshes the pending queue without losing the active card',()=>{
  const state=stateFor([dueWord('meaning'),dueWord('cloze'),dueWord('spelling'),dueWord('production')]);
  const oldSettings={...state.settings,reviewMethods:['meaning','cloze','spelling']};
  const old=buildReviewQueue({...state,settings:oldSettings},'all','',now),current=old[0];
  assert.ok(!old.some(task=>task.mode==='production'));
  const refreshed=reconcileReviewQueue(state,old,0,'all','',now);
  assert.equal(refreshed[0],current,'An unfinished input or feedback must stay mounted');
  assert.ok(refreshed.slice(1).some(task=>task.mode==='production'));
  assert.ok(refreshed.findIndex(task=>task.mode==='production')<4,'A newly enabled ability joins the next mixed round');
  assert.equal(new Set(refreshed.map(task=>task.entryId)).size,refreshed.length);
});
test('reconciliation keeps completed progress and skips a disabled or removed active exercise',()=>{
  const state=stateFor([dueWord('meaning'),dueWord('cloze'),dueWord('spelling'),dueWord('production')]);
  const queue=buildReviewQueue(state,'all','',now),index=queue.findIndex(task=>task.mode==='production');
  state.settings.apiKeySet=false;
  const noApi=reconcileReviewQueue(state,queue,index,'all','',now);
  assert.deepEqual(noApi.slice(0,index),queue.slice(0,index));assert.ok(!noApi.slice(index).some(task=>task.mode==='production'));
  state.settings.apiKeySet=true;state.entries=state.entries.filter(entry=>entry.id!==queue[index].entryId);
  const deleted=reconcileReviewQueue(state,queue,index,'all','',now);assert.ok(!deleted.slice(index).some(task=>task.entryId===queue[index].entryId));
  const newlyReady=reconcileReviewQueue(stateFor([dueWord('production')]),[],0,'all','',now);assert.equal(newlyReady[0].mode,'production');
});
test('submitted feedback remains readable after its method or API is disabled',()=>{
  const entry=dueWord('production'),state=stateFor([entry]),queue=buildReviewQueue(state,'all','',now);
  state.settings.apiKeySet=false;state.settings.reviewMethods=['meaning'];
  assert.equal(reconcileReviewQueue(state,queue,0,'all','',now,true)[0],queue[0]);
  assert.equal(reconcileReviewQueue(state,queue,0,'all','',now).length,0,'The disabled method must leave after Continue');
});
test('undo reconciliation cannot restore an exercise whose method was disabled',()=>{
  const entry=dueWord('meaning'),other=dueWord('cloze'),state=stateFor([entry,other]);
  const original=buildReviewQueue(state,'all','',now);assert.equal(original[0].mode,'meaning');
  state.settings.reviewMethods=['cloze','spelling','production'];
  const reconciled=reconcileReviewQueue(state,original,0,'all','',now);
  assert.ok(reconciled.length);assert.ok(reconciled.every(task=>task.mode!=='meaning'));
});
