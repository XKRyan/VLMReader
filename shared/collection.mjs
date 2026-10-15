const wordKey=text=>String(text||'').normalize('NFKC').replace(/\s+/g,' ').trim().toLocaleLowerCase();
export function collectionDestination(book,notebooks){
  const preferred=book?.collectionNotebookId;
  if(preferred==='unfiled'||notebooks.some(item=>item.id===preferred))return preferred;
  const linked=notebooks.filter(item=>item.bookIds.includes(book?.id));
  return linked.length===1?linked[0].id:linked.length>1?'':'unfiled';
}
export function collectedEntry(entries,text,destination){
  if(!destination)return null;
  const key=wordKey(text);
  return entries.find(entry=>wordKey(entry.text)===key&&(destination==='unfiled'||entry.notebookIds.includes(destination)))||null;
}
