const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../electron/store.cjs'),{makeEntry}=require('../electron/core.cjs'),{saveNotebook}=require('../electron/notebooks.cjs');
const {wordlistIds,inNotebook,inferNotebookKind}=require('../shared/review-policy.mjs');
const word=(text,notebookIds,createdAt)=>({...makeEntry({kind:'word',text,translation:'义'}),notebookIds,...(createdAt?{createdAt}:{})});

test('a word belongs to the word lists only when every notebook holding it is a word list',()=>{
  const notebooks=[{id:'mine',kind:'personal'},{id:'sat',kind:'wordlist'}],lists=wordlistIds(notebooks);
  const own=word('own',['mine']),both=word('both',['mine','sat']),listed=word('listed',['sat']),unfiled=word('unfiled',[]);
  assert.deepEqual([own,both,listed,unfiled].filter(entry=>inNotebook(entry,'unreviewed',lists)).map(entry=>entry.text),['own','both','unfiled']);
  assert.deepEqual([own,both,listed,unfiled].filter(entry=>inNotebook(entry,'unreviewed-lists',lists)).map(entry=>entry.text),['listed']);
});

test('older notebooks are classified by how their words arrived',()=>{
  const start=Date.parse('2026-10-15T13:00:00Z'),at=minutes=>new Date(start+minutes*60000).toISOString();
  const bulk=Array.from({length:300},(_,i)=>word('b'+i,['list'],at(i/100)));
  const gradual=Array.from({length:40},(_,i)=>word('g'+i,['own'],at(i*60)));
  const small=Array.from({length:12},(_,i)=>word('s'+i,['small'],at(0)));
  const entries=[...bulk,...gradual,...small];
  assert.equal(inferNotebookKind({id:'list'},entries),'wordlist');
  assert.equal(inferNotebookKind({id:'own'},entries),'personal');
  assert.equal(inferNotebookKind({id:'small'},entries),'personal');
  assert.equal(inferNotebookKind({id:'list',system:'cloze'},entries),'personal');
});

test('the store classifies notebooks without a kind and keeps chosen kinds',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vlm-kinds-'));const seed=new Store(dir),when=new Date().toISOString();
  seed.state.notebooks=[{id:'list',name:'List',bookIds:[],createdAt:when},{id:'chosen',name:'Chosen',bookIds:[],createdAt:when,kind:'personal'}];
  seed.state.entries=Array.from({length:40},(_,i)=>word('w'+i,['list','chosen'],when));seed.save();
  const loaded=new Store(dir);
  assert.equal(loaded.state.notebooks.find(item=>item.id==='list').kind,'wordlist');
  assert.equal(loaded.state.notebooks.find(item=>item.id==='chosen').kind,'personal');
  fs.rmSync(dir,{recursive:true,force:true});
});

test('notebooks save a valid kind and reject an unknown one',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vlm-kinds-'));const store=new Store(dir);
  const created=saveNotebook(store,{name:'SAT',bookIds:[],kind:'wordlist'});assert.equal(created.kind,'wordlist');
  assert.equal(saveNotebook(store,{name:'SAT',bookIds:[]},created.id).kind,'wordlist');
  assert.equal(saveNotebook(store,{name:'Reading',bookIds:[]}).kind,'personal');
  assert.throws(()=>saveNotebook(store,{name:'Other',bookIds:[],kind:'mixed'}),/词本类型无效/);
  fs.rmSync(dir,{recursive:true,force:true});
});
