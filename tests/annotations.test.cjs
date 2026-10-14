const test=require('node:test'),assert=require('node:assert/strict');
const {saveAnnotation,updateAnnotation,deleteAnnotation}=require('../electron/annotations.cjs');
function store(){return {state:{notes:[],entries:[{id:'keep'}]},replaceState(next){this.state=next;}};}
test('highlights are idempotent for the same anchor, retain existing notes, and distinguish repeated passages',()=>{
  const s=store(),input={bookId:'book',text:'Repeated sentence.',location:0,start:42,note:''};const mark=saveAnnotation(s,input);assert.equal(saveAnnotation(s,input).id,mark.id);assert.equal(s.state.notes.length,1);
  const annotated=saveAnnotation(s,{...input,note:'My note'});assert.equal(annotated.id,mark.id);assert.equal(saveAnnotation(s,input).note,'My note');assert.throws(()=>saveAnnotation(s,{...input,note:'Conflicting note'}),/已有批注/);
  saveAnnotation(s,{...input,start:100});assert.equal(s.state.notes.length,2);assert.deepEqual(s.state.entries,[{id:'keep'}]);
});
test('annotation add, update and delete leave memory untouched after a failed atomic write',()=>{
  const s=store(),mark=saveAnnotation(s,{bookId:'book',text:'Text',start:0,note:'Original'}),before=structuredClone(s.state);s.replaceState=()=>{throw Error('Disk full');};
  for(const operation of [()=>saveAnnotation(s,{bookId:'book',text:'Different',start:10}),()=>updateAnnotation(s,mark.id,{note:'Edit'}),()=>deleteAnnotation(s,mark.id)]){assert.throws(operation,/Disk full/);assert.deepEqual(s.state,before);}
});

test('PDF page anchors and EPUB CFIs distinguish equal text; reflow scroll changes do not duplicate HTML marks',()=>{
  const s=store();s.state.books=[{id:'pdf',format:'pdf'}];saveAnnotation(s,{bookId:'pdf',text:'Same',start:0,location:1});saveAnnotation(s,{bookId:'pdf',text:'Same',start:0,location:2});assert.equal(s.state.notes.length,2);
  saveAnnotation(s,{bookId:'epub',text:'Same',start:0,cfi:'chapter-a'});saveAnnotation(s,{bookId:'epub',text:'Same',start:0,cfi:'chapter-b'});assert.equal(s.state.notes.length,4);
  saveAnnotation(s,{bookId:'html',text:'Same',start:0,location:0});saveAnnotation(s,{bookId:'html',text:'Same',start:0,location:100});assert.equal(s.state.notes.length,5);
});
