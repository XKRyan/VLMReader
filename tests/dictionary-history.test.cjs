const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DictionaryHistory,LIMIT}=require('../electron/dictionary-history.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vlm-history-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
test('lookup history keeps the newest word once, survives a restart and clears',async t=>{
  const dir=fixture(t),history=new DictionaryHistory(dir);
  assert.deepEqual(history.list(),[]);
  history.add({word:'priority',source:'Longman',meaning:'most important'});
  history.add({word:'bank',source:'Longman'});
  history.add({word:'PRIORITY',source:'Longman',meaning:'updated meaning'});
  const items=history.list();
  assert.deepEqual(items.map(item=>item.word),['PRIORITY','bank']);
  assert.equal(items[0].meaning,'updated meaning');
  const restarted=new DictionaryHistory(dir);
  assert.deepEqual(restarted.list().map(item=>item.word),['PRIORITY','bank']);
  assert.deepEqual(restarted.clear(),[]);
  assert.deepEqual(new DictionaryHistory(dir).list(),[]);
});
test('history is bounded and ignores empty or malformed input',async t=>{
  const history=new DictionaryHistory(fixture(t));
  for(let index=0;index<LIMIT+15;index++)history.add({word:'word'+index});
  assert.equal(history.list().length,LIMIT);
  assert.equal(history.list()[0].word,'word'+(LIMIT+14));
  const before=history.list().length;
  history.add({word:'   '});history.add({});history.add({word:null});
  assert.equal(history.list().length,before);
});
test('an older over-long history file is trimmed to the new limit on load',async t=>{
  const dir=fixture(t);
  const many=Array.from({length:LIMIT+30},(_,index)=>({word:'w'+index,at:new Date().toISOString()}));
  fs.writeFileSync(path.join(dir,'dictionary-history.json'),JSON.stringify(many));
  const history=new DictionaryHistory(dir);
  assert.equal(history.list().length,LIMIT);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'dictionary-history.json'),'utf8')).length,LIMIT);
});
test('a damaged history file never blocks a lookup and is replaced on the next write',async t=>{
  const dir=fixture(t);
  fs.writeFileSync(path.join(dir,'dictionary-history.json'),'not json');
  const history=new DictionaryHistory(dir);
  assert.deepEqual(history.list(),[]);
  history.add({word:'resilient'});
  assert.deepEqual(new DictionaryHistory(dir).list().map(item=>item.word),['resilient']);
  fs.writeFileSync(path.join(dir,'dictionary-history.json'),JSON.stringify([{word:'ok',at:'x'},{word:'',at:'y'},{nope:1}]));
  assert.deepEqual(new DictionaryHistory(dir).list().map(item=>item.word),['ok']);
});
