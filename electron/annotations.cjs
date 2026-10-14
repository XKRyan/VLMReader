const crypto=require('node:crypto');
function sameAnchor(a,b,pdf){return a.bookId===b.bookId&&a.text===b.text&&(a.cfi||b.cfi?a.cfi===b.cfi:Number.isFinite(a.start)&&Number.isFinite(b.start)?a.start===b.start&&(!pdf||String(a.location)===String(b.location)):String(a.location)===String(b.location));}
function saveAnnotation(store,input){
  const existing=store.state.notes.find(note=>sameAnchor(note,input,store.state.books?.find(book=>book.id===input.bookId)?.format==='pdf'));
  if(existing){if(input.note&&input.note!==existing.note){if(existing.note)throw Error('该位置已有批注，请编辑原批注');return updateAnnotation(store,existing.id,input);}return existing;}
  const mark={...input,note:String(input.note||'').slice(0,12000),id:crypto.randomUUID(),createdAt:new Date().toISOString()};
  store.replaceState({...store.state,notes:[mark,...store.state.notes]});return mark;
}
function updateAnnotation(store,id,patch){
  const old=store.state.notes.find(note=>note.id===id);if(!old)throw Error('批注不存在');
  const mark={...old,...(typeof patch.note==='string'?{note:patch.note.slice(0,12000)}:{}),updatedAt:new Date().toISOString()};
  store.replaceState({...store.state,notes:store.state.notes.map(note=>note.id===id?mark:note)});return mark;
}
function deleteAnnotation(store,id){store.replaceState({...store.state,notes:store.state.notes.filter(note=>note.id!==id)});}
module.exports={saveAnnotation,updateAnnotation,deleteAnnotation};
