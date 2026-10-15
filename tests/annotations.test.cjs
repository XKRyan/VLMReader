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

test('an explicit additional annotation can share an anchor without replacing an existing note or duplicating a repeated save',()=>{
 const s=store(),input={bookId:'book',text:'A shared passage.',location:1,start:10,color:'green'};
 const first=saveAnnotation(s,{...input,note:'First explanation'}),second=saveAnnotation(s,{...input,note:'Another explanation',newAnnotation:true});assert.notEqual(first.id,second.id);assert.equal(s.state.notes.length,2);assert.equal(first.note,'First explanation');assert.equal(second.newAnnotation,undefined);assert.equal(saveAnnotation(s,{...input,note:'Another explanation',newAnnotation:true}).id,second.id);
 const inner=saveAnnotation(s,{bookId:'book',text:'shared',start:12,location:1,note:'A word note',color:'purple',newAnnotation:true});assert.equal(s.state.notes.length,3);deleteAnnotation(s,inner.id);assert.equal(s.state.notes.length,2);assert.ok(s.state.notes.some(note=>note.id===first.id));
});

test('PDF page anchors and EPUB CFIs distinguish equal text; reflow scroll changes do not duplicate HTML marks',()=>{
  const s=store();s.state.books=[{id:'pdf',format:'pdf'}];saveAnnotation(s,{bookId:'pdf',text:'Same',start:0,location:1});saveAnnotation(s,{bookId:'pdf',text:'Same',start:0,location:2});assert.equal(s.state.notes.length,2);
  saveAnnotation(s,{bookId:'epub',text:'Same',start:0,cfi:'chapter-a'});saveAnnotation(s,{bookId:'epub',text:'Same',start:0,cfi:'chapter-b'});assert.equal(s.state.notes.length,4);
  saveAnnotation(s,{bookId:'html',text:'Same',start:0,location:0});saveAnnotation(s,{bookId:'html',text:'Same',start:0,location:100});assert.equal(s.state.notes.length,5);
});

test('recoloring a highlight keeps its anchor, note and ID, while invalid colors never change stored data',()=>{
  const s=store(),mark=saveAnnotation(s,{bookId:'book',text:'Text',location:1,start:0,note:'Keep my note',color:'yellow'});
  const recolored=saveAnnotation(s,{bookId:'book',text:'Text',location:1,start:0,note:'',color:'green'});
  assert.equal(recolored.id,mark.id);assert.equal(recolored.note,'Keep my note');assert.equal(recolored.color,'green');assert.equal(s.state.notes.length,1);
  const before=structuredClone(s.state);
  for(const invalid of ['red','#ff0000',null,{},undefined]){
    assert.throws(()=>updateAnnotation(s,mark.id,{color:invalid}),/颜色无效/);
    assert.throws(()=>saveAnnotation(s,{bookId:'book',text:'Other',color:invalid}),/颜色无效/);
    assert.deepEqual(s.state,before);
  }
  const edited=updateAnnotation(s,mark.id,{note:'Edited',color:'blue',bookId:'unrelated',start:9});
  assert.equal(edited.color,'blue');assert.equal(edited.bookId,'book');assert.equal(edited.start,0);
  const legacy=saveAnnotation(s,{bookId:'book',text:'Legacy',location:2,note:'Old note'});
  assert.equal(legacy.color,undefined);assert.equal(updateAnnotation(s,legacy.id,{note:'Legacy edit'}).color,undefined);
});
