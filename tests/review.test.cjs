const {test}=require('node:test'),assert=require('node:assert/strict');
const {clozeFor,sentenceTargets}=require('../src/review.ts');
const {makeEntry}=require('../electron/core.cjs');
test('sentence cloze leaves context visible and supports a chosen phrase',()=>{
  const e=makeEntry({text:'A resilient learner keeps trying.',kind:'sentence'});
  assert.equal(clozeFor({...e,reviewTarget:'keeps trying'}).text,'A resilient learner  ______ .');
  assert.ok(clozeFor(e).text.includes('learner'));assert.equal(clozeFor({...e,reviewTarget:e.text}).available,false);
});
test('cloze uses word boundaries so fragments and regular-expression symbols are safe',()=>{
  const e=makeEntry({text:'Hazel had a perfectly average intelligence.',kind:'sentence'});
  assert.ok(!sentenceTargets(e,[{text:'ctly',kind:'word'}]).includes('ctly'));
  assert.equal(clozeFor({...e,reviewTarget:'ctly'}).available,false);
  const term=makeEntry({text:'C++',kind:'word',context:'I am learning C++ this year.'});assert.ok(clozeFor(term).text.includes('______'));
});
test('Chinese cloze preserves the rest of the sentence',()=>{
  const e=makeEntry({text:'间隔复习有助于记住新知识。',kind:'sentence'});
  const c=clozeFor({...e,reviewTarget:'间隔复习'});assert.equal(c.available,true);assert.ok(c.text.includes('有助于记住新知识'));
});
