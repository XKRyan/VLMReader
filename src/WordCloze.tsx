import {useEffect,useRef,useState} from 'react';
import {CheckCircle2,Volume2,RotateCcw} from 'lucide-react';
import type {Entry,ClozeExercise,ClozeResult,ReviewRecord} from './types';
import {t,getUILanguage} from './i18n';

export default function WordCloze({entry,replaceEntry,onReviewed,onSpeak,onContinue,onAnswered,onSubmitting}:{entry:Entry;replaceEntry:(entry:Entry)=>void;onReviewed:(record:ReviewRecord)=>void;onSpeak:(text:string)=>void;onContinue:()=>void;onAnswered:()=>void;onSubmitting:(busy:boolean)=>void}){
  const [exercise,setExercise]=useState<ClozeExercise|null>(null),[answer,setAnswer]=useState(''),[result,setResult]=useState<ClozeResult|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0),[submitting,setSubmitting]=useState(false);
  const submittingRef=useRef(false),input=useRef<HTMLInputElement>(null),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    let current=true;setLoading(true);setError('');setExercise(null);setResult(null);setAnswer('');
    void window.mem.cloze(entry.id).then(data=>{if(current){replaceEntry(data.entry);setExercise(data.exercise);}}).catch(e=>{if(current)setError(e.message);}).finally(()=>{if(current){setLoading(false);setTimeout(()=>input.current?.focus(),0);}});
    return()=>{current=false;};
  },[entry.id,entry.text,entry.translation,entry.context,retry]);
  async function submit(){
    if(!exercise||result||submittingRef.current||!answer.trim())return;
    submittingRef.current=true;setSubmitting(true);onSubmitting(true);setError('');
    try{const data=await window.mem.answerCloze(entry.id,exercise.id,answer);if(alive.current){replaceEntry(data.entry);onReviewed(data.result.record);setResult(data.result);onAnswered();}}
    catch(e){if(alive.current)setError((e as Error).message);}
    finally{onSubmitting(false);submittingRef.current=false;if(alive.current)setSubmitting(false);}
  }
  const due=result?new Date(result.due).toLocaleString(getUILanguage()==='en'?'en-US':'zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';
  return <div className="flashcard word-cloze"><div className="flashcard-eyebrow">{t('句子填空')}<span>{exercise?.source==='original'?t('原句'):exercise?.repeated?t('旧例句复习'):t('DeepSeek 新例句')}</span></div>
    {loading?<div className="flashcard-front"><p role="status">{t('正在准备例句…')}</p><small>{t('首次原句答对后换新例句，偶尔复习旧句。')}</small></div>:exercise?<>
      <div className="flashcard-front"><div className="cloze-text">{exercise.masked}</div><input ref={input} autoFocus aria-label={t('填空答案')} placeholder={t('填写缺少的单词…')} value={answer} disabled={submitting||!!result} onChange={event=>setAnswer(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void submit();}}}/><p className="recall-prompt">{t('填入原词，提交后自动安排复习。')}</p></div>
      {result?<><div className="flashcard-back"><div className={'spelling-check '+(result.correct?'correct':'incorrect')} role="status"><CheckCircle2 size={16}/>{result.correct?t('答案正确'):t('答案不正确')} · {result.expected}</div><p className="cloze-due">{t('下次复习：')}{due}</p>{!result.correct&&<p>{t('你的答案：')}{answer}</p>}<div className="flashcard-translation">{entry.translation}</div><blockquote>{exercise.sentence}</blockquote>{exercise.translation&&<p>{exercise.translation}</p>}<button className="text-button" onClick={()=>onSpeak(exercise.sentence)}><Volume2 size={14}/>{t('听例句')}</button>{entry.context&&exercise.source!=='original'&&<details><summary>{t('查看原句')}</summary><blockquote>{entry.context}</blockquote></details>}</div><div className="reveal-area"><button className="primary" onClick={onContinue}>{t('继续')}</button></div></>:<div className="reveal-area"><button className="primary" disabled={submitting||!answer.trim()} onClick={()=>void submit()}>{t(submitting?'提交中…':'提交答案')}</button></div>}
    </>:null}
    {error&&<div className="reveal-area" role="alert"><p className="error-text">{t(error)}</p>{!exercise&&<button className="secondary" onClick={()=>setRetry(value=>value+1)}><RotateCcw size={15}/>{t('重新准备例句')}</button>}<small>{t('未提交成功，不计作答。')}</small></div>}
  </div>;
}
