import {useEffect,useRef,useState} from 'react';
import {Sparkles} from 'lucide-react';
import type {WordRelations} from './types';
import {t} from './i18n';
export default function WordDetails({word,meaning,definition='',aiAvailable}:{word:string;meaning:string;definition?:string;aiAvailable:boolean}){
  const [data,setData]=useState<WordRelations|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');const token=useRef(0),lock=useRef(false);
  useEffect(()=>{const current=++token.current;setData(null);setError('');void window.mem.wordDetails({text:word,translation:meaning,definition}).then(result=>{if(current===token.current)setData(result);}).catch(()=>{});return()=>{token.current++;};},[word,meaning,definition]);
  async function generate(){if(lock.current)return;lock.current=true;setBusy(true);setError('');const current=token.current;try{const result=await window.mem.wordDetails({text:word,translation:meaning,definition},true);if(current===token.current)setData(result);}catch(error){if(current===token.current)setError((error as Error).message);}finally{lock.current=false;setBusy(false);}}
  return <div className="word-details">{data?.lemma&&<p className="lemma">{t('原形：')}{data.lemma}</p>}{!!data?.forms.length&&<details><summary>{t('词形变化')} <small>{t('离线词典')}</small></summary><div className="word-forms">{data.forms.map(form=><span key={form.code+form.word}><small>{t(form.label)}</small><strong>{form.word}</strong></span>)}</div></details>}
    <details><summary>{t('同／近义词与派生词')}</summary>{data&&(data.cached||data.synonyms.length)?<><p className="muted">{t(data.cached?'AI 词典补充 · 近义词需按语境区分':'WordNet · 同义词按具体词义区分')}</p>{[{title:'同／近义词',items:data.synonyms},{title:'派生词',items:data.derivations}].map(group=><div className="relation-group" key={group.title}><h4>{t(group.title)}</h4>{group.items.length?group.items.map(item=><p key={item.word}><strong>{item.word}</strong> <small>{item.pos}</small> · {item.meaning}<span>{item.note}</span></p>):<p className="muted">{t('暂无可靠条目')}</p>}</div>)}</>:<><p className="muted">{t('按需生成一次并在本地缓存，不影响原词的复习进度。')}</p></>}{!data?.cached&&<button className="secondary compact" disabled={busy||!aiAvailable} onClick={()=>void generate()}><Sparkles size={14}/>{t(busy?'生成中…':'补充词汇关系')}</button>}{error&&<p role="alert" className="error-text">{t(error)}</p>}</details>
  </div>;
}
