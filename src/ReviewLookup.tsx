import {useEffect,useRef,useState} from 'react';
import {X,Plus,Volume2,Check} from 'lucide-react';
import type {DictionaryEntry,Entry,State} from './types';
import {t} from './i18n';
import type {WordSelection} from './WordSentence';
import WordDetails from './WordDetails';
export default function ReviewLookup({selection,entry,data,onClose,onSpeak,onAdded,onRefresh}:{selection:WordSelection;entry:Entry;data:State;onClose:()=>void;onSpeak:(text:string)=>void;onAdded:(entry:Entry)=>void;onRefresh:()=>Promise<void>}){
  const [found,setFound]=useState<DictionaryEntry|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[target,setTarget]=useState('__cloze__'),[saving,setSaving]=useState(false),[saved,setSaved]=useState(false),lock=useRef(false);
  const panel=useRef<HTMLElement>(null),closeButton=useRef<HTMLButtonElement>(null),close=useRef(onClose);close.current=onClose;
  useEffect(()=>{
    const before=document.activeElement;closeButton.current?.focus({preventScroll:true});
    const handler=(event:KeyboardEvent)=>{
      if(event.isComposing)return;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!lock.current)close.current();return;}
      if(event.key!=='Tab')return;
      const controls=Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled),summary,[tabindex="0"]')||[]).filter(item=>item.getClientRects().length);
      if(!controls.length)return;
      const first=controls[0],last=controls[controls.length-1];
      if(event.shiftKey&&(document.activeElement===first||!panel.current?.contains(document.activeElement))){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||!panel.current?.contains(document.activeElement))){event.preventDefault();first.focus();}
    };
    window.addEventListener('keydown',handler,true);
    return()=>{window.removeEventListener('keydown',handler,true);if(before instanceof HTMLElement&&before.isConnected)before.focus({preventScroll:true});};
  },[]);
  useEffect(()=>{let alive=true;void window.mem.lookup(selection.text).then(async result=>result||await window.mem.lookupAI(selection.text)).then(result=>{if(alive)setFound(result);}).catch(error=>{if(alive)setError(error.message);}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[selection.text]);
  async function save(){if(!found||lock.current)return;lock.current=true;setSaving(true);setError('');try{const id=target==='__cloze__'?(await window.mem.clozeNotebook()).id:target;const result=await window.mem.collect({text:selection.text,kind:'word',context:selection.context,bookId:selection.original?(selection.bookId||entry.bookId):'',bookTitle:selection.original?(selection.bookTitle||entry.bookTitle):'句子填空',location:selection.location||'',translation:found.translation||found.definition,definition:found.definition,phonetic:found.phonetic,source:found.source,notebookIds:id?[id]:[]});onAdded(result);await onRefresh();setSaved(true);}catch(error){setError((error as Error).message);}finally{lock.current=false;setSaving(false);}}
  return <aside ref={panel} className="review-lookup" role="dialog" aria-modal="true" aria-label={t('填空查词')}><div className="panel-heading"><strong>{selection.text}</strong><button ref={closeButton} className="icon-button" aria-label={t('关闭查词')} onClick={onClose}><X size={18}/></button></div>{loading?<p role="status">{t('正在查询…')}</p>:found?<><button className="icon-button" aria-label={t('朗读条目')} onClick={()=>onSpeak(selection.text)}><Volume2 size={18}/></button>{found.phonetic&&<span className="phonetic">/{found.phonetic}/</span>}<p className="definition-block">{found.translation||found.definition}</p>{found.definition&&<details><summary>{t('完整英文释义')}</summary><p>{found.definition}</p></details>}<WordDetails word={selection.text} meaning={found.translation||found.definition} definition={found.definition} aiAvailable={data.settings.apiKeySet}/><label className="collection-target">{t('加入哪个词本')}<select aria-label={t('填空查词加入词本')} value={target} onChange={event=>{setTarget(event.target.value);setSaved(false);}}><option value="__cloze__">{data.notebooks.find(item=>item.system==='cloze'||item.name==='句子填空')?.name||t('句子填空')}</option><option value="">{t('未归类')}</option>{data.notebooks.filter(item=>item.system!=='cloze'&&item.name!=='句子填空').map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="primary compact" disabled={saving||saved} onClick={()=>void save()}>{saved?<Check size={15}/>:<Plus size={15}/>} {t(saved?'已保存':saving?'正在保存…':'加入词本')}</button></>:null}{error&&<p className="error-text" role="alert">{t(error)}</p>}</aside>;
}
