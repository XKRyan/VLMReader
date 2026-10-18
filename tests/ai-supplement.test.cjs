const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {CustomDictionaries}=require('../electron/custom-dictionaries.cjs'),{Dictionary}=require('../electron/dictionary.cjs');
const temp=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vlm-ai-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};

test('AI supplement entries persist, replace by word and can be deleted',t=>{
  const dir=temp(t),custom=new CustomDictionaries(dir);
  custom.saveAi({word:'bawled',lemma:'bawl',form:'过去式',translation:'v. 大声喊叫'});
  custom.saveAi({word:'Bawled',lemma:'bawl',form:'过去式',translation:'v. 大声喊叫；号哭'});
  assert.equal(custom.aiEntries().length,1);
  const reopened=new CustomDictionaries(dir);
  assert.equal(reopened.aiLookup('BAWLED').translation,'v. 大声喊叫；号哭');
  assert.equal(reopened.aiLookup('bawled').lemma,'bawl');
  reopened.deleteAi('bawled');
  assert.equal(new CustomDictionaries(dir).aiLookup('bawled'),null);
});

test('a damaged AI supplement file never blocks the user dictionaries',t=>{
  const dir=temp(t);fs.mkdirSync(path.join(dir,'dictionaries'));fs.writeFileSync(path.join(dir,'dictionaries','ai-supplement.json'),'{not json');
  const custom=new CustomDictionaries(dir);
  assert.equal(custom.problem,'');assert.deepEqual(custom.aiEntries(),[]);
});

test('lookup uses the AI supplement only when no dictionary has the word',async t=>{
  const dir=temp(t),dictionary=new Dictionary(path.resolve(__dirname,'../assets'),dir);t.after(()=>dictionary.close());
  dictionary.custom.saveAi({word:'vlmbawledzz',lemma:'vlmbawl',form:'过去式',translation:'v. 大声喊叫'});
  const found=await dictionary.lookup('vlmbawledzz');
  assert.equal(found.source,'AI 补充');assert.equal(found.translation,'v. 大声喊叫');assert.ok(found.cueWords.includes('vlmbawl'));
  dictionary.custom.saveAi({word:'resilient',translation:'AI 释义'});
  assert.notEqual((await dictionary.lookup('resilient')).source,'AI 补充');
});
