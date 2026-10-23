import {useEffect,useRef,useState} from 'react';
import {BookOpen,Search,Sparkles,Plus,Volume2,History} from 'lucide-react';
import type {DictionaryEntry,Entry,LookupHistoryItem,State} from './types';
import {t} from './i18n';
import WordDetails from './WordDetails';
import DictionaryDetails from './DictionaryDetails';
import DictionaryManager from './DictionaryManager';
export default function DictionaryView({data,onAdded,onSpeak,saveSettings}:{data:State;onAdded:(entry:Entry)=>void;onSpeak:(text:string)=>void;saveSettings?:(patch:Partial<State['settings']>)=>Promise<State['settings']>}){
  const [query,setQuery]=useState(''),[result,setResult]=useState<DictionaryEntry|null>(null),[example,setExample]=useState<{sentence:string;translation:string}|null>(null),[loading,setLoading]=useState(false),[generating,setGenerating]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[notebookId,setNotebookId]=useState('unfiled'),[history,setHistory]=useState<LookupHistoryItem[]>([]),[correction,setCorrection]=useState<{from:string;to:string}|null>(null);
  useEffect(()=>{let live=true;void window.mem.dictionaryHistory().then(items=>{if(live)setHistory(items);}).catch(()=>{});return()=>{live=false;};},[]);
  const pending=useRef(false),examplePending=useRef(false),savePending=useRef(false),token=useRef(0);
  async function lookup(value=query){
    if(!value.trim()||pending.current)return;const typed=value.trim();setQuery(value);pending.current=true;setLoading(true);setError('');setResult(null);setExample(null);setSaved(false);setCorrection(null);const current=++token.current;
    try{
      // A typo should not be "translated": ask for a spelling hint first, use it
      // whether or not a doubtful local entry exists, and only then fall back to
      // the AI, which may correct the word as well.
      let found=await window.mem.lookup(typed),corrected='';
      const suggestion=await window.mem.suggest(typed);
      if(suggestion&&suggestion.word&&suggestion.word.toLowerCase()!==typed.toLowerCase()){
        const better=await window.mem.lookup(suggestion.word);
        if(better){found=better;corrected=suggestion.word;}
      }
      if(!found){
        found=await window.mem.lookupAI(corrected||typed);
        if(found&&found.corrected)corrected=found.corrected;
      }
      if(current!==token.current)return;
      setResult(found);
      if(corrected&&corrected.toLowerCase()!==typed.toLowerCase())setCorrection({from:typed,to:corrected});
      if(found)void window.mem.recordLookup({word:found.word||typed,source:found.source,meaning:(found.translation||found.definition||'').replace(/\s+/g,' ').slice(0,160)}).then(items=>{if(current===token.current)setHistory(items);}).catch(()=>{});
    }
    catch(e){if(current===token.current)setError((e as Error).message);}finally{pending.current=false;setLoading(false);}
  }
  async function generate(){
    if(!result||examplePending.current)return;examplePending.current=true;setGenerating(true);setError('');const current=token.current;
    try{const generated=await window.mem.dictionaryExample({text:result.word,translation:result.translation||result.definition,definition:result.definition});if(current===token.current){setExample(generated);setSaved(false);}}
    catch(e){if(current===token.current)setError((e as Error).message);}finally{examplePending.current=false;setGenerating(false);}
  }
  async function save(){
    if(!result||savePending.current)return;savePending.current=true;setSaving(true);setError('');const current=token.current;
    try{const entry=await window.mem.collect({text:result.word,kind:'word',context:example?.sentence||'',contextTranslation:example?.translation||'',location:'',bookId:'',bookTitle:'',notebookIds:notebookId==='unfiled'?[]:[notebookId],translation:result.translation||result.definition,definition:result.definition,phonetic:result.phonetic,source:result.source});onAdded(entry);if(current===token.current)setSaved(true);}
    catch(e){if(current===token.current)setError((e as Error).message);}finally{savePending.current=false;setSaving(false);}
  }
  return <div className="dictionary-page" role="region" aria-label={t('查单词')} tabIndex={0}><div className="page-heading"><div><h1>{t('查单词')}</h1><p>{t('离线词典优先，未收录时由 AI 补全。')}</p></div><DictionaryManager settings={data.settings} saveSettings={saveSettings} onChange={()=>{token.current++;setResult(null);setExample(null);setSaved(false);}}/></div><form className="dictionary-search" onSubmit={event=>{event.preventDefault();void lookup();}}><Search size={19}/><input autoFocus aria-label={t('要查询的单词')} placeholder={t('输入英文或中文词语')} maxLength={100} value={query} onChange={event=>setQuery(event.target.value)}/><button className="primary" disabled={loading||saving||!query.trim()} type="submit">{t(loading?'查询中…':'查询')}</button></form>
    {!query.trim()&&!!history.length&&<div className="lookup-history" role="group" aria-label={t('最近查词')}><div className="lookup-history-head"><span className="lookup-history-label"><History size={13}/>{t('最近查词')}</span><button type="button" className="lookup-history-clear" onClick={()=>{void window.mem.clearLookupHistory().then(setHistory).catch(()=>{});}}>{t('清空')}</button></div><div className="lookup-history-list">{history.map(item=><button key={item.word} type="button" className="lookup-history-row" title={item.meaning||item.word} onClick={()=>void lookup(item.word)}><span className="lookup-history-word">{item.word}</span>{!!item.meaning&&<span className="lookup-history-meaning">{item.meaning}</span>}</button>)}</div></div>}
    {loading&&<p role="status">{t('正在查询词典，未收录时尝试 AI…')}</p>}{error&&<p className="inline-error" role="alert">{t(error)}</p>}{correction&&<p className="dictionary-correction" role="status">{t('已更正拼写')}：{correction.from} → <strong>{correction.to}</strong></p>}
    {result&&<section className="dictionary-result"><div className="dictionary-title"><h2>{result.word}</h2><button className="icon-button" aria-label={t('朗读单词')} onClick={()=>onSpeak(result.word)}><Volume2 size={20}/></button><div className="dictionary-title-actions"><select aria-label={t('加入哪个词本')} value={notebookId} disabled={saving} onChange={event=>{setNotebookId(event.target.value);setSaved(false);}}><option value="unfiled">{t('未归类')}</option>{data.notebooks.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="primary compact" disabled={saving||saved||generating} onClick={()=>void save()}><Plus size={15}/>{t(saving?'正在保存…':saved?'已保存':'加入词本')}</button><span className="badge">{t(result.source)}</span></div></div>{result.phonetic&&<p className="phonetic">/{result.phonetic.replace(/^\/|\/$/g,'')}/</p>}{!!(result.collins||result.oxford||result.rank)&&<p className="dictionary-meta">{!!result.collins&&<span className="stars" title={t('柯林斯星级')}>{'★'.repeat(Math.max(1,Math.min(5,result.collins)))}<small>COLLINS</small></span>}{!!result.oxford&&<span>Oxford 3000</span>}{!!result.rank&&<span>{t('词频')} #{result.rank}</span>}</p>}<div className="definition-block">{result.translation||result.definition}</div>{result.source.startsWith('AI')&&result.translation&&result.definition&&result.definition!==result.translation&&<p className="ai-english"><span>EN</span>{result.definition}</p>}{!result.translation&&!['ecdict','cedict'].some(source=>(data.settings.dictionarySources||[]).includes(source))&&<p className="muted dictionary-hint">{t('未启用中文词典，当前只显示英文释义。')}</p>}{result.translation&&result.definition&&result.definition!==result.translation&&<details><summary>{t('完整英文释义')}</summary><p className="dictionary-definition">{result.definition}</p></details>}
      {/[\u3400-\u9fff]/.test(result.word)&&<div className="dictionary-english-targets"><span>{t('英文表达')}</span>{[...new Set(result.translation.split(/[;,\n]/).map(word=>word.trim().replace(/^to /,'')))].filter(word=>/^[a-z][a-z '’-]{0,60}$/i.test(word)).slice(0,6).map(word=><button key={word} className="secondary compact" onClick={()=>void lookup(word)}>{word}</button>)}</div>}
      <DictionaryDetails entry={result} aiAvailable={data.settings.apiKeySet} onSpeak={onSpeak} onLookup={word=>void lookup(word)}/><WordDetails word={result.word} meaning={(result.translation||result.definition).slice(0,4000)} definition={result.definition} aiAvailable={data.settings.apiKeySet}/><div className="dictionary-examples"><div className="dictionary-section-title"><h3>{t('例句')}</h3><button className="secondary compact" disabled={generating||!data.settings.apiKeySet} onClick={()=>void generate()}><Sparkles size={15}/>{t(generating?'生成中…':example?'再生成一句':'生成 AI 例句')}</button></div>{example?<><blockquote>{example.sentence}</blockquote><p>{example.translation}</p></>:<p className="muted">{t(data.settings.apiKeySet?'例句按需生成，查询不会自动调用例句 API。':'填写 AI 密钥后，可选择生成例句。')}</p>}</div>
    </section>}
  </div>;
}
