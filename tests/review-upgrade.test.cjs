const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,DEFAULTS}=require('../electron/store.cjs'),{makeEntry,withReviewSkills,reviewEntry,undoReviewEntry,vocabularyCsv}=require('../electron/core.cjs');
const {nextReview,buildReviewQueue,METHOD_GAP,REVIEW_METHODS}=require('../shared/review-policy.mjs');
const {createClozeService}=require('../electron/cloze.cjs'),{inflections,family,canVary}=require('../electron/word-forms.cjs'),{createWordDetails}=require('../electron/word-details.cjs');
const {createProductionService}=require('../electron/production.cjs');
const start=new Date('2026-10-13T04:00:00Z');
function fixture(t,text='write'){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vlm-review-upgrade-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(dir);store.state.entries=[withReviewSkills(makeEntry({text,translation:'书写',definition:'To form letters and words on a surface.',context:`I ${text} a short note every morning.`},start))];store.save();return {store,id:store.state.entries[0].id};}
test('meaning success never grants spelling, cloze or usage mastery; all enabled methods appear',()=>{
 let entry=withReviewSkills(makeEntry({text:'write',translation:'书写'},start)),now=+start;const settings={...DEFAULTS,reviewMethods:REVIEW_METHODS,apiKeySet:true},seen=new Set();
 for(let round=0;round<12;round++){const task=nextReview(entry,settings,now);now=Math.max(now,task.due);seen.add(task.mode);const before=entry.reviewSkills;entry=reviewEntry(entry,4,new Date(now),task.mode);for(const method of REVIEW_METHODS)if(method!==task.mode)assert.deepEqual(entry.reviewSkills[method],before[method]);}
 assert.deepEqual([...seen].sort(),[...REVIEW_METHODS].sort());assert.equal(Object.keys(entry.reviewSkills).length,4);
});
test('same skill relearns promptly, siblings are spaced, production without API is safely excluded',()=>{
 const entry=reviewEntry(withReviewSkills(makeEntry({text:'write',translation:'书写'},start)),1,start,'meaning');
 assert.equal(nextReview(entry,DEFAULTS,+start+60000).mode,'meaning');
 const both=reviewEntry(entry,1,start,'cloze');assert.equal(nextReview(both,DEFAULTS,+start).mode,'cloze');
 assert.deepEqual(undoReviewEntry(both).reviewSkills,entry.reviewSkills);
 const state={entries:[entry],settings:{...DEFAULTS,reviewMethods:['production'],apiKeySet:false},stats:{reviews:[]}};
 assert.equal(buildReviewQueue(state,'all','',+start+METHOD_GAP).length,0);assert.equal(nextReview(entry,state.settings,+start).blocked,true);assert.doesNotThrow(()=>vocabularyCsv(state.entries,state.settings));
});
test('English hints persist in order and assisted/revealed answers never count as independent mastery',async t=>{
 const {store,id}=fixture(t),service=createClozeService(store,()=>'',{now:()=>start});const q=await service.prepare(id);assert.deepEqual(q.exercise.hintStages,['english','meaning','initial']);
 for(let level=1;level<=3;level++){assert.equal(service.hint(id,q.exercise.id).exercise.hints,level);assert.equal(store.state.stats.reviews.length,0);}
 const resumed=createClozeService(new Store(store.dir),()=>'',{now:()=>start});assert.equal((await resumed.prepare(id)).exercise.hints,3);
 const answer=service.submit(id,q.exercise.id,'write');assert.equal(answer.result.correct,true);assert.equal(answer.result.assisted,true);assert.equal(answer.result.record.rating,1);assert.equal(answer.entry.clozePractice.unassistedStreak,0);assert.equal(answer.entry.reviewSkills.meaning.card.reps,0);
 const another=fixture(t);const reveal=createClozeService(another.store,()=>'',{now:()=>start}),first=await reveal.prepare(another.id);for(let i=0;i<3;i++)reveal.hint(another.id,first.exercise.id);assert.equal(reveal.hint(another.id,first.exercise.id).result.record.hints,4);
});
test('an original passage contributes one complete sentence with one blank, retaining the full source context',async t=>{
 const {store,id}=fixture(t);store.state.entries[0].context='Here is my routine. I write a short note every morning. I write again after lunch.';const original=store.state.entries[0].context,service=createClozeService(store,()=> '');const q=await service.prepare(id);assert.equal(q.exercise.sentence,'I write a short note every morning.');assert.equal(q.exercise.masked.match(/______/g).length,1);assert.equal(q.entry.context,original);
});
test('word forms distinguish inflections from derivations and are withheld on initial learning',async t=>{
 const found={word:'write',exchange:'p:wrote/d:written/i:writing/3:writes/0:write'},entry=makeEntry({text:'write',translation:'书写'},start);
 assert.deepEqual(inflections(found).forms.map(item=>item.word),['wrote','written','writing','writes']);assert.equal(family({word:'running',exchange:'0:run/i:running'},makeEntry({text:'running'},start)).length,0);assert.equal(canVary(entry,start),false);
 const {store,id}=fixture(t);store.state.entries[0].context='';let target;
 const generate=async(e,s,k,a,options)=>{target=options.target;return {word:e.text,meaning:e.translation,language:e.language,sentence:`I ${target} a long letter for exercise ${a.length}.`,translation:'我为练习写了一封长信。'};};
 const service=createClozeService(store,()=>'',{lookup:async()=>found,generate,random:()=>.1,now:()=>new Date(+start+86400001)}),q=await service.prepare(id);assert.equal(target,'write');
 service.submit(id,q.exercise.id,'write');let learned=reviewEntry(store.state.entries[0],3,new Date(+start+86400001),'cloze');learned.clozePractice={...learned.clozePractice,unassistedStreak:2,firstUnassistedAt:start.toISOString()};store.state.entries=[learned];
 assert.equal(canVary(learned,new Date(+start+86400001)),true);const writing=createProductionService(store,()=>'',undefined,()=>new Date(+start+86400001),{lookup:async()=>found});assert.ok((await writing.prepare(id)).exercise.allowedWords.includes('writes'));const variant=await service.prepare(id);assert.equal(variant.exercise.target,'wrote');const wrong=service.submit(id,variant.exercise.id,'write');assert.equal(wrong.result.record.rating,1);assert.match(wrong.result.reason,/词形/);assert.equal(wrong.entry.reviewSkills.spelling.card.reps,0);
});
test('library examples are preferred without an API, retain provenance, and avoid immediate context repetition',async t=>{
 const {store,id}=fixture(t);store.state.books=[{id:'book',title:'Source',format:'txt'}];let calls=0;
 const example={bookId:'book',bookTitle:'Source',location:0,sentence:'I write detailed notes to remember each experiment.'};
 const service=createClozeService(store,()=>'',{findExamples:async()=>[example],generate:()=>{calls++;throw Error('must not call');},random:()=>.9,now:()=>start});
 const first=await service.prepare(id);service.submit(id,first.exercise.id,'wrong');const next=await service.prepare(id);assert.equal(next.exercise.source,'library');assert.equal(next.exercise.bookId,'book');assert.notEqual(next.exercise.sentence,first.exercise.sentence);assert.equal(calls,0);
});
test('alternative decisions cache only the identical context and target; no silent grades on API failure',async t=>{
 const {store,id}=fixture(t);let calls=0;const service=createClozeService(store,()=>'',{judge:async()=>{calls++;return {neutral:true,reason:'该语境允许其他答案，目标词需补测。'};},now:()=>start});
 const q=await service.prepare(id);const oldKey=require('node:crypto').createHash('sha256').update(JSON.stringify([q.exercise.fingerprint,q.exercise.masked,'compose'])).digest('hex');store.state.entries[0].clozePractice.decisions=[{key:oldKey,neutral:false,reason:'Old incorrect policy'}];await service.submit(id,q.exercise.id,'compose');const before=store.state.entries[0];store.state.entries[0]={...before,clozePractice:{...before.clozePractice,active:{...q.exercise,id:'repeat'}}};await service.submit(id,'repeat','compose');assert.equal(calls,1);assert.equal(store.state.entries[0].reviewSkills.cloze.card.reps,0);
 store.state.entries[0]={...store.state.entries[0],clozePractice:{...store.state.entries[0].clozePractice,active:{...q.exercise,id:'new-context',masked:'Please ______ before leaving.'}}};await service.submit(id,'new-context','compose');assert.equal(calls,2);
});
test('word relations are opt-in, deduplicated, local across restarts, and bound to word sense/provider',async t=>{
 const {store}=fixture(t);let calls=0;const dictionary={lookup:async()=>({word:'write',exchange:'p:wrote'})},settings={apiBase:'http://localhost',apiModel:'test'},input={text:'write',translation:'书写',definition:'form letters'},result={synonyms:[{word:'compose',pos:'v.',meaning:'创作',note:'侧重内容创作'}],derivations:[{word:'writer',pos:'n.',meaning:'作家',note:'施事名词'}]},generate=async()=>{calls++;await new Promise(resolve=>setImmediate(resolve));return result;};
 let details=createWordDetails(dictionary,store.dir,()=>settings,()=>'',generate);assert.equal((await details(input)).cached,false);assert.equal(calls,0);await Promise.all([details(input,true),details(input,true)]);assert.equal(calls,1);
 details=createWordDetails(dictionary,store.dir,()=>settings,()=>'',()=>{throw Error('no call');});assert.equal((await details(input)).synonyms[0].word,'compose');assert.equal((await details({...input,translation:'创作'})).cached,false);
});
test('sentence writing persists drafts, grades a separate ability exactly once, and undoes only that ability',async t=>{
 const {store,id}=fixture(t);let calls=0;const service=createProductionService(store,()=>'',async()=>{calls++;await new Promise(resolve=>setImmediate(resolve));return {rating:3,feedback:'目标词使用自然。',corrected:'I write a short note every morning.'};},()=>start);
 const q=await service.prepare(id);service.draft(id,q.exercise.id,'I write a short note every morning.');assert.equal((await createProductionService(new Store(store.dir),()=> '').prepare(id)).exercise.draft,'I write a short note every morning.');
 const before=store.state.entries[0].reviewSkills;const [a,b]=await Promise.all([service.submit(id,q.exercise.id,q.entry.context),service.submit(id,q.exercise.id,q.entry.context)]);assert.deepEqual(a.result,b.result);assert.equal(calls,1);assert.equal(store.state.stats.reviews.length,1);assert.equal(a.entry.reviewSkills.production.card.reps,1);for(const mode of ['meaning','cloze','spelling'])assert.deepEqual(a.entry.reviewSkills[mode],before[mode]);assert.deepEqual(undoReviewEntry(a.entry).reviewSkills,before);
 await service.submit(id,q.exercise.id,'I write again.');assert.equal(calls,1);
});
test('sentence writing errors, missing target, deletion, and failed disk writes never grade or resurrect a word',async t=>{
 const {store,id}=fixture(t);const failing=createProductionService(store,()=>'',async()=>{throw Error('offline');}),q=await failing.prepare(id),before=JSON.stringify(store.state);assert.throws(()=>failing.submit(id,q.exercise.id,'This sentence has no target.'),/目标词/);await assert.rejects(failing.submit(id,q.exercise.id,'I write a letter.'),/offline/);assert.equal(JSON.stringify(store.state),before);
 const good=createProductionService(store,()=>'',async()=>({rating:3,feedback:'正确',corrected:'I write a letter.'}));const save=store.save;store.save=()=>{throw Error('disk full');};await assert.rejects(good.submit(id,q.exercise.id,'I write a letter.'),/disk full/);assert.equal(JSON.stringify(store.state),before);store.save=save;
 let finish;const delayed=createProductionService(store,()=>'',()=>new Promise(resolve=>finish=()=>resolve({rating:3,feedback:'正确',corrected:'I write a letter.'})));const pending=delayed.submit(id,q.exercise.id,'I write a letter.');store.state.entries=[];finish();await assert.rejects(pending,/请选择/);assert.equal(store.state.entries.length,0);assert.equal(store.state.stats.reviews.length,0);
});
test('provider-specific token-saving options do not leak into other compatible APIs',()=>{
 const {providerOptions}=require('../electron/translation.cjs');assert.deepEqual(providerOptions({apiBase:'https://api.deepseek.com/v1'}),{thinking:{type:'disabled'}});assert.deepEqual(providerOptions({apiBase:'https://api.openai.com/v1'}),{});assert.deepEqual(providerOptions({apiBase:'http://127.0.0.1:9000'}),{});assert.deepEqual(providerOptions({apiBase:'https://api.deepseek.com.example.test/v1'}),{});
});
