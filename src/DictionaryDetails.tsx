import {useEffect,useRef,useState} from 'react';
import {Sparkles,Volume2} from 'lucide-react';
import type {DictionaryEntry,RichDictionary} from './types';
import {t} from './i18n';
import DictionaryArticles from './DictionaryArticles';
export default function DictionaryDetails({entry,aiAvailable,onSpeak,onLookup}:{entry:DictionaryEntry;aiAvailable:boolean;onSpeak?:(text:string)=>void;onLookup?:(word:string)=>void}){
  const [rich,setRich]=useState<RichDictionary|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),token=useRef(0),pending=useRef(false);
  useEffect(()=>{const id=++token.current;setRich(null);setError('');void window.mem.dictionaryRich(entry.word).then(result=>{if(id===token.current)setRich(result);}).catch(()=>{});return()=>{token.current++;};},[entry]);
  async function generate(){if(pending.current)return;pending.current=true;setBusy(true);setError('');const id=token.current;try{const result=await window.mem.dictionaryRich(entry.word,true);if(id===token.current)setRich(result);}catch(e){if(id===token.current)setError((e as Error).message);}finally{pending.current=false;setBusy(false);}}
  const lines=entry.domains?[]:entry.translation.split(/\n+|(?=\[(?:医|计|法|经|化|物|数|生|地|商)[^\]]*\])/).map(value=>value.trim()).filter(Boolean),professional=entry.domains?entry.domains.split(/\n+/).map(value=>value.trim()).filter(Boolean):lines.filter(value=>/^\[[^\]]+\]/.test(value));
  const examples=entry.examples||[],collocations=entry.collocations||[];
  const others=(entry.sections||[]).filter(section=>section!==entry&&!section.html&&section.source!==entry.source&&(section.translation||section.definition));
  return <div className="dictionary-details">
    {!!professional.length&&<details><summary>{t('专业释义')} <small>{t('离线词典')}</small></summary>{professional.map((value,index)=><p key={index}>{value}</p>)}</details>}
    {others.length>0&&<details><summary>{t('其他词典释义')}</summary>{others.map((section,index)=><section key={index}><h4>{t(section.source)}</h4><p className="dictionary-definition">{section.translation||section.definition}</p></section>)}</details>}
    {!!collocations.length&&<details><summary>{t('词组与搭配')} <small>{t('离线词典')}</small></summary><div className="dictionary-collocations">{collocations.map((item,index)=><div className="dictionary-collocation" key={index}><strong>{item.text}</strong>{item.translation&&<p>{item.translation}</p>}{item.source&&item.source!==entry.source&&<small className="source-caption">{t(item.source)}</small>}</div>)}</div></details>}
    {!!examples.length&&<details open><summary>{t('词典例句')} <small>{t('离线词典')}</small></summary><div className="dictionary-example-list">{examples.slice(0,8).map((item,index)=><div className="dictionary-example" key={index}><p>{item.text}</p>{item.translation&&<p className="muted">{item.translation}</p>}{onSpeak&&<button className="icon-button" aria-label={t('朗读例句')} onClick={()=>onSpeak(item.text)}><Volume2 size={15}/></button>}</div>)}</div></details>}
    <details open={!!rich}><summary>{t(/[\u3400-\u9fff]/.test(entry.word)?'英文表达与用法补充':'用法与专业释义补充')} <small>AI</small></summary>{rich?<><p className="source-caption">{t('AI 补充 · 已缓存，可核对后使用')}</p><p>{rich.overview}</p>{rich.professional.map((item,index)=><section key={index}><h4>{item.field} · {item.meaning}</h4><p>{item.usage}</p></section>)}{!!rich.collocations.length&&<><h4>{t('常见搭配')}</h4>{rich.collocations.map((item,index)=><div key={index}><strong>{item.phrase}</strong> · {item.translation}<p className="muted">{item.example}</p></div>)}</>}</>:<><p className="muted">{t('按需补充常用义、专业义与搭配，生成一次后本地保存。')}</p><button className="secondary compact" disabled={busy||!aiAvailable} onClick={()=>void generate()}><Sparkles size={15}/>{t(busy?'生成中…':'补充详细释义')}</button></>}{error&&<p role="alert" className="inline-error">{t(error)}</p>}</details>
    <DictionaryArticles entry={entry} onLookup={onLookup}/>
  </div>;
}
