const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../electron/store.cjs'),{makeEntry,reviewEntry}=require('../electron/core.cjs');
const {notebookIds,saveNotebook,collectMembership,deleteNotebook,assignEntries,mergeBackup}=require('../electron/notebooks.cjs');
const {moveEntries}=require('../electron/notebooks.cjs');
function store(){const s=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'memreader-notebooks-')));s.state.books=[{id:'a',title:'A',hash:'aaa'},{id:'b',title:'B',hash:'bbb'}];return s;}
test('moving entries removes only the source membership even when the destination already contains them',()=>{
 const s=store(),a=saveNotebook(s,{name:'Math',bookIds:[]}),b=saveNotebook(s,{name:'Extra',bookIds:[]}),c=saveNotebook(s,{name:'Other',bookIds:[]});
 const entry=reviewEntry(reviewEntry(makeEntry({text:'scalene',translation:'不等边的',context:'A scalene triangle has three different sides.'}),3,new Date(),'meaning'),1,new Date(),'cloze');entry.notebookIds=[a.id,b.id,c.id];entry.note='Keep';s.state.entries=[entry];s.state.stats.reviews=[{entryId:entry.id,rating:3,mode:'meaning'}];s.save();const before=JSON.parse(JSON.stringify(s.state));
 assert.deepEqual(moveEntries(s,a.id,b.id,[entry.id,entry.id]),{moved:1,fromId:a.id,toId:b.id});assert.deepEqual(s.state.entries[0].notebookIds,[b.id,c.id]);
 assert.deepEqual(JSON.parse(JSON.stringify({...s.state.entries[0],notebookIds:before.entries[0].notebookIds})),before.entries[0]);assert.deepEqual(s.state.stats,before.stats);assert.deepEqual(new Store(s.dir).state.entries[0].notebookIds,[b.id,c.id]);
});
test('moving rejects ambiguous virtual sources, stale selections and same destinations without changing data',()=>{
 const s=store(),a=saveNotebook(s,{name:'First',bookIds:[]}),b=saveNotebook(s,{name:'Second',bookIds:[]});s.state.entries=[makeEntry({text:'retain',translation:'保留'})];s.save();const before=JSON.stringify(s.state),id=s.state.entries[0].id;
 for(const input of [['all',b.id,[id]],[a.id,a.id,[id]],[a.id,b.id,[id]],['unfiled','missing',[id]],['unfiled',b.id,['missing']]]){assert.throws(()=>moveEntries(s,...input));assert.equal(JSON.stringify(s.state),before);}
 moveEntries(s,'unfiled',b.id,[id]);assert.deepEqual(s.state.entries[0].notebookIds,[b.id]);
});
test('a failed move leaves memberships and review records intact on disk and in memory',()=>{
 const s=store(),a=saveNotebook(s,{name:'First',bookIds:[]}),b=saveNotebook(s,{name:'Second',bookIds:[]}),entry=makeEntry({text:'retain',translation:'保留'});entry.notebookIds=[a.id];s.state.entries=[entry];s.save();const before=JSON.stringify(s.state),disk=fs.readFileSync(s.file,'utf8');s.save=()=>{throw Error('disk full');};assert.throws(()=>moveEntries(s,a.id,b.id,[entry.id]),/disk full/);assert.equal(JSON.stringify(s.state),before);assert.equal(fs.readFileSync(s.file,'utf8'),disk);
});
test('explicit destination overrides source links; ambiguous sources require a choice',()=>{
  const s=store(),a=saveNotebook(s,{name:'First',bookIds:['a']}),b=saveNotebook(s,{name:'Second',bookIds:['a']});
  assert.throws(()=>notebookIds(s.state,{bookId:'a'}),/选择/);
  assert.deepEqual(notebookIds(s.state,{bookId:'a',notebookIds:[b.id]}),[b.id]);
  assert.deepEqual(notebookIds(s.state,{bookId:'a',notebookIds:[]}),[]);
  const entry=makeEntry({text:'keep',translation:'保留',notebookIds:[a.id]});entry.notebookIds=[a.id];collectMembership(s.state,entry,{bookId:'a',notebookIds:[b.id]});assert.deepEqual(entry.notebookIds,[a.id,b.id]);
});
test('linked sources, existing vocabulary opt-in and one word in multiple notebooks',()=>{
  const s=store(),entry=makeEntry({text:'resilient',translation:'有韧性',bookId:'a'});s.state.entries=[entry];
  const first=saveNotebook(s,{name:'Reading',bookIds:['a'],includeExisting:false});assert.deepEqual(entry.notebookIds,[]);
  collectMembership(s.state,entry,{bookId:'a'});assert.deepEqual(entry.notebookIds,[first.id]);
  const second=saveNotebook(s,{name:'Second',bookIds:['a','b'],includeExisting:true});assert.equal(s.state.entries[0].notebookIds.length,2);
  collectMembership(s.state,s.state.entries[0],{bookId:'b'});assert.equal(s.state.entries[0].notebookIds.length,2);
  const saved=new Store(s.dir).state;assert.equal(saved.notebooks.length,2);assert.deepEqual(saved.entries[0].notebookIds,[first.id,second.id]);
  assert.throws(()=>saveNotebook(s,{name:'reading',bookIds:[]}),/同名/);assert.throws(()=>saveNotebook(s,{name:'Unknown',bookIds:['missing']}),/文档/);
});
test('manual assignment and removing a notebook retain cards and review records',()=>{
  const s=store(),entry=reviewEntry(makeEntry({text:'retrieve',translation:'回忆'}),3);s.state.entries=[entry];s.state.stats.reviews=[{entryId:entry.id,rating:3}];
  const group=saveNotebook(s,{name:'Recall',bookIds:[]});assignEntries(s,group.id,[entry.id]);assert.deepEqual(s.state.entries[0].notebookIds,[group.id]);
  assignEntries(s,group.id,[entry.id],true);assert.deepEqual(s.state.entries[0].notebookIds,[]);assignEntries(s,group.id,[entry.id]);
  const before=JSON.stringify(s.state.entries[0].card);deleteNotebook(s,group.id);assert.equal(s.state.entries.length,1);assert.equal(JSON.stringify(s.state.entries[0].card),before);assert.equal(s.state.stats.reviews.length,1);
});
test('failed notebook saves roll back names, source rules and entry membership',()=>{
  const s=store();s.state.entries=[makeEntry({text:'keep',translation:'保留',bookId:'a'})];s.save();const before=JSON.stringify(s.state);s.save=()=>{throw Error('disk failure');};
  assert.throws(()=>saveNotebook(s,{name:'Fail',bookIds:['a'],includeExisting:true}),/disk/);assert.equal(JSON.stringify(s.state),before);
});
test('vocabulary backup restores notebooks, memberships and links by document hash',()=>{
  const a=store(),group=saveNotebook(a,{name:'Reading',bookIds:['a']});a.state.entries=[collectMembership(a.state,makeEntry({text:'lasting',translation:'持久',bookId:'a'}),{bookId:'a'})];a.save();
  const b=store();b.state.books[0].id='different-id';assert.equal(mergeBackup(b,JSON.parse(JSON.stringify(a.state))),1);
  assert.equal(b.state.notebooks[0].bookIds[0],'different-id');assert.deepEqual(b.state.entries[0].notebookIds,[b.state.notebooks[0].id]);assert.equal(b.state.entries[0].card.reps,0);
  assert.equal(mergeBackup(b,JSON.parse(JSON.stringify(a.state))),0);assert.equal(b.state.notebooks.length,1);assert.equal(b.state.entries.length,1);
});
test('backup retains independent review abilities and a renamed cloze notebook',()=>{
  const a=store(),group=saveNotebook(a,{name:'My sentence vocabulary',bookIds:[]});
  group.system='cloze';a.state.entries=[reviewEntry(reviewEntry(makeEntry({text:'steady',translation:'稳定的'}),3,new Date(),'meaning'),1,new Date(),'cloze')];
  a.state.entries[0].notebookIds=[group.id];
  const b=store();mergeBackup(b,JSON.parse(JSON.stringify(a.state)));
  assert.equal(b.state.notebooks[0].system,'cloze');
  assert.equal(b.state.entries[0].reviewSkills.meaning.card.reps,1);
  assert.equal(b.state.entries[0].reviewSkills.cloze.card.reps,1);
  assert.equal(b.state.entries[0].reviewSkills.spelling.card.reps,0);
  assert.deepEqual(b.state.entries[0].notebookIds,[b.state.notebooks[0].id]);
});
