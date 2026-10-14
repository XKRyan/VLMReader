import {useRef,useState} from 'react';
import {BookOpen,Search,Sparkles,Plus,Volume2} from 'lucide-react';
import type {DictionaryEntry,Entry,State} from './types';
import {t} from './i18n';
import WordDetails from './WordDetails';
import DictionaryDetails from './DictionaryDetails';
import DictionaryManager from './DictionaryManager';
export default function DictionaryView({data,onAdded,onSpeak}:{data:State;onAdded:(entry:Entry)=>void;onSpeak:(text:string)=>void}){
  const [query,setQuery]=useState(''),[result,setResult]=useState<DictionaryEntry|null>(null),[example,setExample]=useState<{sentence:string;translation:string}|null>(null),[loading,setLoading]=useState(false),[generating,setGenerating]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false),[notebookId,setNotebookId]=useState('unfiled');
  const pending=useRef(false),examplePending=useRef(false),savePending=useRef(false),token=useRef(0);
  async function lookup(){
    if(!query.trim()||pending.current)return;pending.current=true;setLoading(true);setError('');setResult(null);setExample(null);setSaved(false);const current=++token.current;
    try{const local=await window.mem.lookup(query.trim());const found=local||await window.mem.lookupAI(query.trim());if(current===token.current)setResult(found);}
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
  return <div className="dictionary-page" role="region" aria-label={t('查单词')} tabIndex={0}><div className="page-heading"><div><h1>{t('查单词')}</h1><p>{t('离线词典优先，未收录时由 AI 补全。')}</p></div><DictionaryManager onChange={()=>{token.current++;setResult(null);setExample(null);setSaved(false);}}/></div><form className="dictionary-search" onSubmit={event=>{event.preventDefault();void lookup();}}><Search size={19}/><input autoFocus aria-label={t('要查询的单词')} placeholder={t('输入英文或中文词语')} maxLength={100} value={query} onChange={event=>setQuery(event.target.value)}/><button className="primary" disabled={loading||saving||!query.trim()} type="submit">{t(loading?'查询中…':'查询')}</button></form>
    {loading&&<p role="status">{t('正在查询词典，未收录时尝试 AI…')}</p>}{error&&<p className="inline-error" role="alert">{t(error)}</p>}
    {result&&<section className="dictionary-result"><div className="dictionary-title"><h2>{result.word}</h2><button className="icon-button" aria-label={t('朗读单词')} onClick={()=>onSpeak(result.word)}><Volume2 size={20}/></button><span className="badge">{t(result.source)}</span></div>{result.phonetic&&<p className="phonetic">/{result.phonetic.replace(/^\/|\/$/g,'')}/</p>}<div className="definition-block">{result.translation||result.definition}</div>{result.definition&&result.definition!==result.translation&&<details><summary>{t('完整英文释义')}</summary><p className="dictionary-definition">{result.definition}</p></details>}
      <DictionaryDetails entry={result} aiAvailable={data.settings.apiKeySet} onSpeak={onSpeak}/><WordDetails word={result.word} meaning={(result.translation||result.definition).slice(0,4000)} definition={result.definition} aiAvailable={data.settings.apiKeySet}/><div className="dictionary-examples"><div className="dictionary-section-title"><h3>{t('例句')}</h3><button className="secondary compact" disabled={generating||!data.settings.apiKeySet} onClick={()=>void generate()}><Sparkles size={15}/>{t(generating?'生成中…':example?'再生成一句':'生成 AI 例句')}</button></div>{example?<><blockquote>{example.sentence}</blockquote><p>{example.translation}</p></>:<p className="muted">{t(data.settings.apiKeySet?'例句按需生成，查询不会自动调用例句 API。':'填写 AI 密钥后，可选择生成例句。')}</p>}</div>
      <div className="dictionary-save"><select aria-label={t('加入哪个词本')} value={notebookId} disabled={saving} onChange={event=>{setNotebookId(event.target.value);setSaved(false);}}><option value="unfiled">{t('未归类')}</option>{data.notebooks.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="primary" disabled={saving||saved||generating} onClick={()=>void save()}><Plus size={16}/>{t(saving?'正在保存…':saved?'已保存':'加入词本')}</button></div>
    </section>}
  </div>;
}
