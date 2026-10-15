const crypto=require('node:crypto');
const HIGHLIGHT_COLORS=['yellow','green','blue','pink','purple','theme'];
function validateColor(color){if(!HIGHLIGHT_COLORS.includes(color))throw Error('高亮颜色无效');return color;}
function sameAnchor(a,b,pdf){return a.bookId===b.bookId&&a.text===b.text&&(a.cfi||b.cfi?a.cfi===b.cfi:Number.isFinite(a.start)&&Number.isFinite(b.start)?a.start===b.start&&(!pdf||String(a.location)===String(b.location)):String(a.location)===String(b.location));}
function saveAnnotation(store,input){
  if('color' in input)validateColor(input.color);
  const matches=store.state.notes.filter(note=>sameAnchor(note,input,store.state.books?.find(book=>book.id===input.bookId)?.format==='pdf'));
  const existing=input.newAnnotation&&input.note?matches.find(note=>note.note===input.note)||matches.find(note=>!note.note):matches[0];
  if(existing){if(input.note&&input.note!==existing.note){if(existing.note)throw Error('该位置已有批注，请编辑原批注');return updateAnnotation(store,existing.id,input);}if(input.color&&input.color!==existing.color)return updateAnnotation(store,existing.id,{color:input.color});return existing;}
  const {newAnnotation,...anchor}=input;
  const mark={...anchor,note:String(input.note||'').slice(0,12000),id:crypto.randomUUID(),createdAt:new Date().toISOString()};
  store.replaceState({...store.state,notes:[mark,...store.state.notes]});return mark;
}
function updateAnnotation(store,id,patch){
  const old=store.state.notes.find(note=>note.id===id);if(!old)throw Error('批注不存在');
  const color='color' in patch?{color:validateColor(patch.color)}:{};
  const mark={...old,...(typeof patch.note==='string'?{note:patch.note.slice(0,12000)}:{}),...color,updatedAt:new Date().toISOString()};
  store.replaceState({...store.state,notes:store.state.notes.map(note=>note.id===id?mark:note)});return mark;
}
function deleteAnnotation(store,id){store.replaceState({...store.state,notes:store.state.notes.filter(note=>note.id!==id)});}
module.exports={saveAnnotation,updateAnnotation,deleteAnnotation,validateColor};
