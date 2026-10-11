const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../electron/store.cjs'),{makeEntry,reviewEntry}=require('../electron/core.cjs');
const {saveNotebook,collectMembership,deleteNotebook,assignEntries,mergeBackup}=require('../electron/notebooks.cjs');
function store(){const s=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'memreader-notebooks-')));s.state.books=[{id:'a',title:'A',hash:'aaa'},{id:'b',title:'B',hash:'bbb'}];return s;}
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
