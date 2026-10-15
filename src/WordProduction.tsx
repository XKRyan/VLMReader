import {useEffect,useRef,useState} from 'react';
import type {Entry,ProductionExercise,ProductionResult,ReviewRecord} from './types';
import {t,getUILanguage} from './i18n';
import WordSentence from './WordSentence';
import type {WordSelection} from './WordSentence';
import {useReviewContinue} from './useReviewContinue';
import {useReviewFocus} from './useReviewFocus';
const pendingDraftWrites=new Map<string,Promise<void>>();
export default function WordProduction({entry,enabled,replaceEntry,onReviewed,onContinue,onAnswered,onSubmitting,onWord}:{entry:Entry;enabled:boolean;replaceEntry:(entry:Entry)=>void;onReviewed:(record:ReviewRecord)=>void;onContinue:()=>void;onAnswered:()=>void;onSubmitting:(busy:boolean)=>void;onWord:(selection:WordSelection)=>void}){
  const [exercise,setExercise]=useState<ProductionExercise|null>(null),[answer,setAnswer]=useState(''),[result,setResult]=useState<ProductionResult|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const lock=useRef(false),alive=useRef(true),draft=useRef<{entryId:string;exerciseId:string;text:string;saved:string;finished:boolean}|null>(null),draftWrites=useRef(Promise.resolve());const continuing=useReviewContinue(!!result,enabled&&!busy,onContinue);
  const input=useRef<HTMLTextAreaElement>(null);useReviewFocus(input,entry.id,enabled&&!busy&&!result&&!!exercise);
  function flushDraft(){
    const session=draft.current;if(!session||session.finished||session.text===session.saved)return draftWrites.current;
    // Read the latest text when this serialized write runs. A slower previous
    // acknowledgement must not overwrite newer characters or revive a grade.
    draftWrites.current=draftWrites.current.then(async()=>{
      if(session.finished||session.text===session.saved)return;
      const text=session.text;await window.mem.productionDraft(session.entryId,session.exerciseId,text);session.saved=text;
    }).catch(error=>{if(alive.current&&draft.current===session)setError(error.message);});
    const pending=draftWrites.current;pendingDraftWrites.set(session.entryId,pending);
    void pending.finally(()=>{if(pendingDraftWrites.get(session.entryId)===pending)pendingDraftWrites.delete(session.entryId);});
    return draftWrites.current;
  }
  useEffect(()=>{alive.current=true;const flush=()=>flushDraft();window.addEventListener('pagehide',flush);return()=>{alive.current=false;window.removeEventListener('pagehide',flush);flushDraft();};},[]);
  useEffect(()=>{let current=true;void(async()=>{while(pendingDraftWrites.has(entry.id))await pendingDraftWrites.get(entry.id);if(!current)return;const data=await window.mem.production(entry.id);if(current){replaceEntry(data.entry);setExercise(data.exercise);setAnswer(data.exercise.draft);draft.current={entryId:entry.id,exerciseId:data.exercise.id,text:data.exercise.draft,saved:data.exercise.draft,finished:false};}})().catch(error=>{if(current)setError(error.message);});return()=>{current=false;};},[entry.id]);
  useEffect(()=>{if(!enabled)flushDraft();},[enabled]);
  useEffect(()=>{if(!exercise||result||busy||draft.current?.saved===answer)return;const timer=setTimeout(flushDraft,400);return()=>clearTimeout(timer);},[answer,exercise?.id,result,busy]);
  async function submit(){if(!exercise||!answer.trim()||result||lock.current)return;lock.current=true;setBusy(true);onSubmitting(true);setError('');try{await flushDraft();const data=await window.mem.answerProduction(entry.id,exercise.id,answer);if(draft.current?.exerciseId===exercise.id)draft.current.finished=true;if(alive.current){replaceEntry(data.entry);onReviewed(data.result.record);setResult(data.result);setError('');onAnswered();}}catch(error){if(alive.current)setError((error as Error).message);}finally{lock.current=false;onSubmitting(false);if(alive.current)setBusy(false);}}
  return <div className="flashcard word-production"><div className="flashcard-eyebrow">{t('造句练习')}<span>{t('AI 批改')}</span></div><div className="flashcard-front"><h2>{entry.text}</h2><p className="spell-definition">{entry.translation}</p>{!result&&<><textarea ref={input} autoFocus aria-label={t('造句答案')} maxLength={500} value={answer} disabled={busy||!exercise} placeholder={t('用目标词写一个完整的句子…')} onChange={event=>{const text=event.target.value;if(draft.current)draft.current.text=text;setAnswer(text);}} onBlur={flushDraft} onKeyDown={event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&!event.nativeEvent.isComposing){event.preventDefault();if(!event.repeat)void submit();}}}/><small>{t(exercise?.allowedWords&&exercise.allowedWords.length>1?'已学词形也可使用；批改检查词义、搭配和语法。':'先练显示的词形；批改检查词义、搭配和语法。')}</small></>}</div>
    {result?<><div className="flashcard-back"><div className={'spelling-check '+(result.rating===1?'incorrect':'correct')} role="status">{t(result.rating===1?'需要再练':result.rating===2?'用词正确 · 语法需改进':'造句正确')}</div><p>{result.feedback}</p><div className="section-label">{t('你的句子')}</div><blockquote><WordSentence text={result.sentence} onWord={onWord}/></blockquote>{result.corrected!==result.sentence&&<><div className="section-label">{t('修改建议')}</div><blockquote><WordSentence text={result.corrected} onWord={onWord}/></blockquote></>}<p>{t('下次造句：')}{new Date(result.due).toLocaleString(getUILanguage()==='en'?'en-US':'zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</p></div><div className="reveal-area"><button ref={continuing.button} className="primary" onClick={continuing.next}>{t('继续')}</button></div></>:<div className="reveal-area"><button className="primary" disabled={busy||!exercise||!answer.trim()} onClick={()=>void submit()}>{t(busy?'批改中…':'提交造句')}</button></div>}{error&&<p className="error-text" role="alert">{t(error)}<small>{t('未提交成功，不计作答。')}</small></p>}
  </div>;
}
