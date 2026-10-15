const test=require('node:test'),assert=require('node:assert/strict');
const {collectionDestination,collectedEntry}=require('../shared/collection.mjs');
test('a linked notebook is the default; explicit book choices persist and deleted choices safely fall back',()=>{
  const book={id:'book'},notebooks=[{id:'linked',bookIds:['book']},{id:'other',bookIds:[]}];
  assert.equal(collectionDestination(book,notebooks),'linked');
  assert.equal(collectionDestination({...book,collectionNotebookId:'other'},notebooks),'other');
  assert.equal(collectionDestination({...book,collectionNotebookId:'unfiled'},notebooks),'unfiled');
  assert.equal(collectionDestination({...book,collectionNotebookId:'deleted'},notebooks),'linked');
  assert.equal(collectionDestination(book,[...notebooks,{id:'second',bookIds:['book']}]),'');
  assert.equal(collectionDestination({id:'unlinked'},notebooks),'unfiled');
});
test('saved feedback follows the selected word and destination, including restored memberships',()=>{
  const entries=[{id:'word',text:'Resilient',notebookIds:['linked']}];
  assert.equal(collectedEntry(entries,' resilient ','linked')?.id,'word');
  assert.equal(collectedEntry(entries,'resilient','other'),null);
  assert.equal(collectedEntry(entries,'another','linked'),null);
  assert.equal(collectedEntry(entries,'resilient',''),null);
  assert.equal(collectedEntry(entries,'resilient','unfiled')?.id,'word');
  assert.equal(collectedEntry([{...entries[0],notebookIds:['other']}],'resilient','linked'),null);
});
