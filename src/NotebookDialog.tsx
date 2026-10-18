import {useEffect,useRef,useState} from 'react';
import {BookOpen,Search,Trash2,X} from 'lucide-react';
import type {Notebook,State} from './types';
import {t} from './i18n';
export default function NotebookDialog({data,notebook,onClose,onSaved}:{data:State;notebook?:Notebook;onClose:()=>void;onSaved:(notebook?:Notebook)=>Promise<void>}){
  const [name,setName]=useState(notebook?.name||''),[kind,setKind]=useState<'personal'|'wordlist'>(notebook?.kind==='wordlist'?'wordlist':'personal'),[books,setBooks]=useState(new Set((notebook?.bookIds||[]).filter(id=>data.books.some(book=>book.id===id)))),[includeExisting,setIncludeExisting]=useState(false),[query,setQuery]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirmDelete,setConfirmDelete]=useState(false);
  const form=useRef<HTMLFormElement>(null),mutation=useRef(false);
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;return()=>previous?.focus();},[]);
  async function save(){
    if(mutation.current||!name.trim())return;mutation.current=true;setBusy(true);setError('');
    try{const input={name,bookIds:[...books],includeExisting,kind};const result=notebook?await window.mem.updateNotebook(notebook.id,input):await window.mem.createNotebook(input);await onSaved(result);onClose();}catch(e){setError((e as Error).message);}finally{mutation.current=false;setBusy(false);}
  }
  async function remove(){if(!notebook||mutation.current)return;mutation.current=true;setBusy(true);try{await window.mem.deleteNotebook(notebook.id);await onSaved();onClose();}catch(e){setError((e as Error).message);}finally{mutation.current=false;setBusy(false);}}
  const visible=data.books.filter(book=>book.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  return <div className="modal-backdrop"><form ref={form} className="modal notebook-dialog" role="dialog" aria-modal="true" aria-labelledby="notebook-title" onSubmit={event=>{event.preventDefault();void save();}} onKeyDown={event=>{
    if(event.key==='Escape'&&!busy){event.stopPropagation();if(confirmDelete)setConfirmDelete(false);else onClose();}
    if(event.key==='Tab'){const controls=[...form.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')],first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  }}><div className="add-word-heading"><h3 id="notebook-title">{t(confirmDelete?'删除词本？':notebook?'词本设置':'新建词本')}</h3><button type="button" className="icon-button" aria-label={t('关闭词本设置')} disabled={busy} onClick={onClose}><X size={18}/></button></div>
    {confirmDelete?<p>{t('只删除词本分区，生词和复习记录仍保留。')}</p>:<>
      <label className="notebook-name">{t('词本名称')}<input autoFocus aria-label={t('词本名称')} value={name} maxLength={60} placeholder={t('例如：英语阅读')} onChange={event=>setName(event.target.value)} disabled={busy}/></label>
      {!notebook?.system&&<div className="notebook-kind" role="radiogroup" aria-label={t('词本类型')}>{(['personal','wordlist'] as const).map(value=><label key={value} className={kind===value?'active':''}><input type="radio" name="notebook-kind" value={value} checked={kind===value} disabled={busy} onChange={()=>setKind(value)}/><span><strong>{t(value==='personal'?'我的生词本':'词表')}</strong><small>{t(value==='personal'?'阅读、查词时一个个加入的词；阅读时标出其中未复习的词。':'导入或既定的词表；复习时单独列出，不在阅读中标出。')}</small></span></label>)}</div>}
      <div className="notebook-sources-heading"><strong>{t('关联书架文档')}</strong><span>{books.size} {t('本')}</span></div><p className="muted notebook-help">{t('阅读时手动加入新词；文档关联多个词本时，选择目标词本。')}</p>
      <div className="shelf-search"><Search size={15}/><input aria-label={t('搜索关联文档')} value={query} placeholder={t('搜索书名…')} onChange={event=>setQuery(event.target.value)}/></div>
      <div className="notebook-source-list">{visible.length?visible.map(book=><label key={book.id}><input type="checkbox" aria-label={t('关联')+' '+book.title+' '+book.format.toUpperCase()} checked={books.has(book.id)} disabled={busy} onChange={()=>setBooks(previous=>{const next=new Set(previous);if(next.has(book.id))next.delete(book.id);else next.add(book.id);return next;})}/><BookOpen size={17}/><span>{book.title}</span><small>{book.format.toUpperCase()}</small></label>):<p className="muted">{t(data.books.length?'没有匹配的文档':'先在书架导入文档，也可以先建立空词本。')}</p>}</div>
      <label className="notebook-existing"><input type="checkbox" aria-label={t('同时收录已有生词')} checked={includeExisting} onChange={event=>setIncludeExisting(event.target.checked)} disabled={busy}/><span>{t('同时收录已有生词')}</span></label>
    </>}
    {error&&<div className="notebook-error" role="alert">{t(error)}</div>}
    <div className="notebook-dialog-actions">{notebook&&!confirmDelete&&<button type="button" className="text-button danger-text" disabled={busy} onClick={()=>setConfirmDelete(true)}><Trash2 size={14}/>{t('删除词本')}</button>}<div><button type="button" className="secondary" disabled={busy} onClick={()=>confirmDelete?setConfirmDelete(false):onClose()}>{t('取消')}</button>{confirmDelete?<button type="button" className="danger" disabled={busy} onClick={()=>void remove()}>{t('确认删除词本')}</button>:<button type="submit" className="primary" disabled={busy||!name.trim()}>{t(busy?'正在保存…':notebook?'保存词本':'创建词本')}</button>}</div></div>
  </form></div>;
}
