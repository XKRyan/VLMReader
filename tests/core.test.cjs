const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Store}=require('../electron/store.cjs');
const {makeEntry,reviewEntry,reviewIntervals,vocabularyCsv}=require('../electron/core.cjs');
const {Dictionary}=require('../electron/dictionary.cjs');
const {translate,validateBase}=require('../electron/translation.cjs');
test('selection keeps complete sentence and classifies English / Chinese',()=>{
  const e=makeEntry({text:' resilient ',context:'A resilient learner tries again.',translation:'有韧性的'});
  assert.equal(e.kind,'word');assert.equal(e.context,'A resilient learner tries again.');
  assert.equal(makeEntry({text:'Learning requires patience.'}).kind,'sentence');
  assert.equal(makeEntry({text:'记忆'}).language,'zh');
});
test('FSRS schedules successful recall later than a lapse, preserving history',()=>{
  const now=new Date('2026-10-10T00:00:00Z'),e=makeEntry({text:'retrieve',translation:'回忆'},now);
  const good=reviewEntry(e,3,now),again=reviewEntry(e,1,now);
  assert.ok(new Date(good.card.due)>new Date(again.card.due));assert.equal(good.card.reps,1);assert.equal(good.history.length,1);assert.equal(e.card.reps,0);
  assert.equal(reviewIntervals(e,now).length,4);assert.throws(()=>reviewEntry(e,0,now));
});
test('atomic storage recovers from a damaged file using last backup',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'memreader-store-'));
  const s=new Store(dir);s.state.entries=[makeEntry({text:'test',translation:'测试'})];s.save();s.save();
  fs.writeFileSync(path.join(dir,'library.json'),'broken');const recovered=new Store(dir);
  assert.equal(recovered.state.entries[0].text,'test');
});
test('batch deletion removes only selected vocabulary and associated review records',()=>{
  const s=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'memreader-delete-')));
  const entries=['alpha','beta','gamma'].map(text=>reviewEntry(makeEntry({text,translation:'释义',context:'Original context.'}),3));
  s.state.entries=entries;s.state.stats.reviews=entries.map(e=>({entryId:e.id,rating:3,time:new Date().toISOString(),isNew:true}));s.state.stats.minutes=42;
  s.state.books=[{id:'book',title:'Keep this book'}];s.state.notes=[{id:'note',text:'Keep this note'}];s.save();
  assert.throws(()=>s.deleteEntries([entries[0].id,null]),/选择/);assert.equal(s.state.entries.length,3);
  assert.equal(s.deleteEntries([entries[0].id,entries[1].id,entries[0].id,'missing']),2);
  const saved=new Store(s.dir).state;assert.deepEqual(saved.entries,JSON.parse(JSON.stringify([entries[2]])));
  assert.equal(saved.stats.reviews.length,1);assert.equal(saved.stats.reviews[0].entryId,entries[2].id);
  assert.equal(saved.stats.minutes,42);assert.equal(saved.books[0].id,'book');assert.equal(saved.notes[0].id,'note');
  assert.equal(s.deleteEntries([]),0);assert.equal(s.deleteEntries([entries[0].id]),0);
});
test('failed deletion restores in-memory entries and review records',()=>{
  const s=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'memreader-delete-fail-'))),e=makeEntry({text:'retain',translation:'保留'});
  s.state.entries=[e];s.state.stats.reviews=[{entryId:e.id,rating:3}];s.save();s.save=()=>{throw Error('write failed');};
  assert.throws(()=>s.deleteEntries([e.id]),/write failed/);assert.equal(s.state.entries[0].id,e.id);assert.equal(s.state.stats.reviews[0].entryId,e.id);
  assert.equal(new Store(s.dir).state.entries[0].id,e.id);
});
test('older libraries receive a larger interface size without changing their reading settings',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'memreader-font-'));
  fs.writeFileSync(path.join(dir,'library.json'),JSON.stringify({settings:{fontSize:24,uiFont:'Arial',language:'en'}}));
  const s=new Store(dir);assert.equal(s.state.settings.uiFontSize,16);assert.equal(s.state.settings.fontSize,24);assert.equal(s.state.settings.uiFont,'Arial');assert.equal(s.state.settings.language,'en');
  s.state.settings.uiFontSize=20;s.save();assert.equal(new Store(dir).state.settings.uiFontSize,20);
});
test('CSV preserves quotes, commas, line breaks and both definitions',()=>{
  const e=makeEntry({text:'word',translation:'n. 词\n语言',definition:'a "unit", of language',context:'A word, in context.'});
  const csv=vocabularyCsv([e]);assert.ok(csv.startsWith('\ufeff'));assert.ok(csv.includes('a ""unit"", of language'));assert.ok(csv.includes('A word, in context.'));
});
test('real offline dictionaries return English, inflection and Chinese senses',async()=>{
  const d=new Dictionary(path.join(__dirname,'..','assets'));
  for(const term of ['resilient','writing','mit','记忆','學習']){
    const found=await d.lookup(term);assert.ok(found,term+' missing');assert.ok(found.translation||found.definition,term+' lacks definition');
  }
  assert.equal(await d.lookup('This is a whole sentence, not a word.'),null);
});
test('translation validates transport and fails clearly without a key',async()=>{
  assert.equal(validateBase('https://api.deepseek.com/'),'https://api.deepseek.com');assert.throws(()=>validateBase('http://example.com'));
  await assert.rejects(()=>translate('test','',{apiBase:'https://api.deepseek.com'},''),/密钥/);
});
