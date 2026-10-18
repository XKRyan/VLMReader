import {useEffect,useRef,useState} from 'react';
import {Layers3,NotebookPen,CheckCircle2,Check,RotateCcw,Keyboard,Volume2,Settings2} from 'lucide-react';
import type {State,Entry,Settings,ReviewRecord} from './types';
import {t,getUILanguage} from './i18n';
import WordCloze from './WordCloze';
import WordProduction from './WordProduction';
import WordSentence from './WordSentence';
import type {WordSelection} from './WordSentence';
import ReviewLookup from './ReviewLookup';
import {clozeFor} from './review';
import {useReviewFocus,hintShortcut} from './useReviewFocus';
import {maskCue} from '../shared/review-cues.mjs';
import {buildReviewQueue,reconcileReviewQueue,nextReview,inNotebook,isUnreviewed,wordlistIds} from '../shared/review-policy.mjs';
import type {ReviewTask} from '../shared/review-policy.mjs';
const labels={meaning:'回忆词义',cloze:'句子填空',spelling:'拼写回忆',production:'造句练习'};
const answerKey=(text:string)=>text.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase();
function relativeInterval(due:string){const seconds=(new Date(due).getTime()-Date.now())/1000;return seconds<60?t('稍后'):seconds<3600?Math.round(seconds/60)+' '+t('分钟'):seconds<86400?Math.round(seconds/3600)+' '+t('小时'):Math.round(seconds/86400)+' '+t('天');}
interface Props {active?:boolean;initialNotebook?:string;data:State;replaceEntry:(e:Entry)=>void;onError:(s:string)=>void;onSpeak:(s:string)=>void;onVocabulary:()=>void;onSettings:()=>void;onRefresh:()=>Promise<void>;onReviewed:(r:ReviewRecord)=>void;onUndoStat:(id:string)=>void;saveSettings:(s:Partial<Settings>)=>Promise<Settings>}
export default function ReviewView({active=true,initialNotebook='',data,replaceEntry,onError,onSpeak,onVocabulary,onSettings,onRefresh,onReviewed,onUndoStat,saveSettings}:Props){
  const [notebookId,setNotebookId]=useState(initialNotebook),[filter,setFilter]=useState('all');
  const makeQueue=(kind=filter,scope=notebookId)=>buildReviewQueue(data,kind,scope);
  const [queue,setQueue]=useState<ReviewTask[]>(()=>makeQueue()),[index,setIndex]=useState(0),[revealed,setRevealed]=useState(false),[typed,setTyped]=useState(''),[intervals,setIntervals]=useState<{rating:number;due:string}[]>([]),[lastId,setLastId]=useState(''),[busy,setBusy]=useState(false),[autoDone,setAutoDone]=useState(false),[clock,setClock]=useState(Date.now());
  const [lookup,setLookup]=useState<WordSelection|null>(null);
  const mutation=useRef(false),scroll=useRef<HTMLDivElement>(null);
  const currentData=useRef(data);currentData.current=data;
  const configuration=JSON.stringify([data.settings.reviewMethods,data.settings.apiKeySet,data.settings.sentenceReviewMode,data.settings.newPerDay]);
  const appliedConfiguration=useRef(configuration);
  const answerInput=useRef<HTMLInputElement>(null),revealButton=useRef<HTMLButtonElement>(null);
  const task=queue[index],entry=data.entries.find(e=>e.id===task?.entryId),sentence=entry?.kind==='sentence',mode=task?.mode||'meaning',automatic=!!entry&&!sentence&&(mode==='cloze'||mode==='production');
  const cloze=entry?clozeFor(entry,data.entries):{text:'',target:'',available:false},writing=mode==='spelling'||mode==='cloze'&&cloze.available,expected=mode==='cloze'?cloze.target:entry?.text||'';
  const focusKey=(entry?.id||'')+':'+index+':'+mode;
  useReviewFocus(answerInput,focusKey,active&&!!entry&&!automatic&&writing&&!revealed&&!busy&&!lookup);
  useReviewFocus(revealButton,focusKey,active&&!!entry&&!automatic&&!writing&&!revealed&&!busy&&!lookup);
  // Recall cards can show the user's own dictionaries instead of the gloss saved at import time.
  const glossWanted=!!entry&&!sentence&&data.settings.reviewCustomDictionary!==false&&(mode==='meaning'||mode==='spelling');
  const [gloss,setGloss]=useState<{id:string;translation:string;source:string}|null>(null);
  useEffect(()=>{if(!entry||!glossWanted){setGloss(null);return;}let alive=true;const id=entry.id;setGloss(null);void window.mem.customGloss(entry.text).then(found=>{if(alive)setGloss({id,translation:found?.translation||'',source:found?.source||''});}).catch(()=>{if(alive)setGloss({id,translation:'',source:''});});return()=>{alive=false;};},[entry?.id,entry?.text,glossWanted]);
  const glossReady=!glossWanted||gloss?.id===entry?.id,customMeaning=glossWanted&&gloss?.id===entry?.id&&gloss.translation?gloss:null,meaning=customMeaning?.translation||entry?.translation||'';
  const today=data.stats.reviews.filter(r=>new Date(r.time).toLocaleDateString()===new Date().toLocaleDateString()).length;
  useEffect(()=>{let alive=true;setAutoDone(false);setRevealed(false);setTyped('');setIntervals([]);setLookup(null);scroll.current?.scrollTo(0,0);if(entry&&!automatic)void window.mem.intervals(entry.id,mode).then(result=>{if(alive)setIntervals(result);}).catch(e=>{if(alive)onError(e.message);});return()=>{alive=false;};},[entry?.id,index,mode]);
  useEffect(()=>{
    if(busy||appliedConfiguration.current===configuration)return;
    appliedConfiguration.current=configuration;
    setQueue(previous=>reconcileReviewQueue(data,previous,index,filter,notebookId,Date.now(),autoDone));
  },[configuration,busy,index,filter,notebookId]);
  const upcoming=data.entries.filter(e=>!e.suspended&&e.translation&&inNotebook(e,notebookId,wordlistIds(data.notebooks))&&(filter==='all'||e.kind===filter)).map(e=>nextReview(e,data.settings,clock)).filter(task=>!task.blocked&&Number.isFinite(task.due)&&!task.isNew&&task.due>clock).sort((a,b)=>a.due-b.due)[0];
  useEffect(()=>{
    if(!active||entry||busy)return;
    const ready=makeQueue();if(ready.length){setQueue(previous=>[...previous.slice(0,index),...ready]);return;}
    const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);
  },[active,entry?.id,index,busy,data.entries,data.settings,filter,notebookId,clock]);
  function reset(kind=filter,scope=notebookId){setQueue(makeQueue(kind,scope));setIndex(0);setLastId('');}
  async function rate(rating:number){
    if(!entry||automatic||mutation.current||!revealed||writing&&rating>1&&answerKey(typed)!==answerKey(expected))return;mutation.current=true;setBusy(true);
    try{const isNew=isUnreviewed(entry),result=await window.mem.review(entry.id,rating,mode);replaceEntry(result);onReviewed({entryId:entry.id,mode,rating,time:result.updatedAt||new Date().toISOString(),isNew});setLastId(entry.id);setIndex(i=>i+1);}
    catch(e){onError((e as Error).message);}finally{mutation.current=false;setBusy(false);}
  }
  async function undo(){if(!lastId||mutation.current)return;mutation.current=true;setBusy(true);try{
    const restored=await window.mem.undoReview(lastId),latest=currentData.current,reviews=[...latest.stats.reviews],record=reviews.findLastIndex(review=>review.entryId===lastId);
    if(record>=0)reviews.splice(record,1);
    const next={...latest,entries:latest.entries.map(item=>item.id===restored.id?restored:item),stats:{...latest.stats,reviews}},previous=Math.max(0,index-1);
    replaceEntry(restored);onUndoStat(lastId);setQueue(tasks=>reconcileReviewQueue(next,tasks,previous,filter,notebookId));setIndex(previous);setLastId('');
  }catch(e){onError((e as Error).message);}finally{mutation.current=false;setBusy(false);}}
  useEffect(()=>{const handler=(event:KeyboardEvent)=>{
    if(!active||automatic||lookup||busy||event.defaultPrevented||event.isComposing||event.ctrlKey||event.metaKey)return;
    const target=event.target instanceof Element?event.target:document.activeElement||document.body;
    if(entry&&!revealed&&hintShortcut(event)&&!target.closest('select,[role="dialog"]')){event.preventDefault();setRevealed(true);return;}
    if(event.altKey||target.closest('input,textarea,select,summary,[role="dialog"],[contenteditable="true"]'))return;
    if(entry&&revealed&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)){
      const buttons=Array.from(scroll.current?.querySelectorAll<HTMLButtonElement>('.ratings button:not(:disabled)')||[]),focused=target.closest('button');
      if(focused&&!buttons.includes(focused as HTMLButtonElement)||!buttons.length)return;
      event.preventDefault();const at=buttons.indexOf(document.activeElement as HTMLButtonElement),delta=event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:1;
      const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:at<0?0:(at+delta+buttons.length)%buttons.length;buttons[next].focus({preventScroll:true});return;
    }
    if(event.repeat){if(event.key==='Enter'||event.code==='Space')event.preventDefault();return;}
    if(event.key==='Enter'&&entry&&!target.closest('button')){event.preventDefault();if(!revealed)setRevealed(true);else void rate(writing&&answerKey(typed)!==answerKey(expected)?1:3);}
    if(event.code==='Space'&&entry&&!target.closest('button')){event.preventDefault();setRevealed(true);}
    if(revealed&&['1','2','3','4'].includes(event.key)){event.preventDefault();void rate(+event.key);}
  };window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);},[active,entry?.id,revealed,busy,automatic,lookup,typed,expected,mode]);
  useEffect(()=>{if(active&&entry&&!automatic&&revealed)scroll.current?.querySelector<HTMLButtonElement>('.ratings .'+(writing&&answerKey(typed)!==answerKey(expected)?'again':'good'))?.focus({preventScroll:true});},[active,entry?.id,revealed,mode]);
  return <div className="review-page"><div className="page-heading"><h1>{t('复习')}</h1><div className="review-heading-actions"><span>{t('今日练习')} {today}</span><button className="secondary compact" onClick={onSettings}><Settings2 size={15}/>{t('复习设置')}</button><button className="secondary compact" onClick={onVocabulary}><NotebookPen size={15}/>{t('生词本')}</button></div></div>
    <div className="review-kind-filter"><select aria-label={t('选择复习词本')} disabled={busy} value={notebookId} onChange={event=>{setNotebookId(event.target.value);reset(filter,event.target.value);}}><option value="">{t('全部词条')}</option><option value="unreviewed">{t('未复习')}</option><option value="unreviewed-lists">{t('词表未复习')}</option><option value="unfiled">{t('未归类')}</option>{data.notebooks.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select><select aria-label={t('复习内容')} disabled={busy} value={filter} onChange={event=>{setFilter(event.target.value);reset(event.target.value);}}><option value="all">{t('全部条目')}</option><option value="word">{t('单词')}</option><option value="sentence">{t('句子')}</option></select></div>
    {data.settings.reviewMethods.includes('production')&&!data.settings.apiKeySet&&<p className="review-method-notice" role="status">{t('造句练习已开启；配置 AI 密钥后才会安排。')} <button className="text-button" onClick={onSettings}>{t('打开翻译设置')}</button></p>}
    <div className="review-session-top"><div className="session-counter"><Layers3 size={17}/><span>{t('本轮复习')}</span><strong>{Math.min(index,queue.length)} / {queue.length}</strong></div>{sentence&&<div className="segmented">{['meaning','cloze'].map(id=><button key={id} disabled={busy} className={mode===id?'active':''} onClick={()=>{setQueue(tasks=>tasks.map((task,i)=>i===index?{...task,mode:id as 'meaning'|'cloze'}:task));void saveSettings({sentenceReviewMode:id as 'meaning'|'cloze'}).catch(()=>{});}}>{t(id==='meaning'?'回忆句意':'关键词填空')}</button>)}</div>}</div><div className="session-progress"><span style={{width:(queue.length?index/queue.length:0)*100+'%'}}/></div>
    <div className="review-card-scroll" ref={scroll}>
      {entry?automatic?mode==='production'?<WordProduction key={entry.id+':'+index} entry={entry} enabled={active&&!lookup} replaceEntry={replaceEntry} onReviewed={onReviewed} onContinue={()=>setIndex(i=>i+1)} onAnswered={()=>{setAutoDone(true);setLastId('');}} onSubmitting={setBusy} onWord={setLookup}/>:<WordCloze key={entry.id+':'+index} entry={entry} keyboardEnabled={active&&!lookup} replaceEntry={replaceEntry} onReviewed={onReviewed} onSpeak={onSpeak} onContinue={()=>setIndex(i=>i+1)} onAnswered={()=>{setAutoDone(true);setLastId('');}} onSubmitting={setBusy} onWord={setLookup}/>:<div className="flashcard"><div className="flashcard-eyebrow">{t(sentence?'句子':labels[mode])}<span>{t(isUnreviewed(entry)?'初次学习':'间隔复习')}</span></div><div className="flashcard-front">
        {writing?<>{mode==='cloze'?<div className="cloze-text">{cloze.text}</div>:<p className="spell-definition">{glossReady?maskCue(meaning,[entry.text,...(entry.cueWords||[])])||t('请根据语义回忆完整词形'):'…'}</p>}<input ref={answerInput} aria-label={t(mode==='spelling'?'拼写答案':'填空答案')} placeholder={t(mode==='spelling'?'尝试写出原词…':'尝试补上关键词…')} value={typed} disabled={revealed||busy} onChange={event=>setTyped(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing){event.preventDefault();if(!event.repeat&&!event.ctrlKey&&!event.metaKey&&!event.altKey)setRevealed(true);}}}/></>:<><h2 className={sentence?'sentence':''}>{entry.text}</h2>{entry.phonetic&&<span className="phonetic">/{entry.phonetic}/</span>}<button className="icon-button" aria-label={t('朗读复习内容')} onClick={()=>onSpeak(entry.text)}><Volume2 size={20}/></button></>}
        {!revealed&&<p className="recall-prompt">{t(writing?'先写出你记得的，再检查答案。':sentence?'用自己的话回忆整句意思；不必逐字背诵。':'试着回忆它的意思。')}</p>}
      </div>{revealed?<><div className="flashcard-back"><div className="answer-label"><CheckCircle2 size={15}/>{t('答案')}</div>{writing&&<div className={'spelling-check '+(answerKey(typed)===answerKey(expected)?'correct':'incorrect')}>{t(answerKey(typed)===answerKey(expected)?'答案正确':'答案不正确')} · {expected}</div>}<div className="flashcard-translation">{meaning}</div>{customMeaning&&<p className="source-caption gloss-source">{customMeaning.source}</p>}{entry.definition&&<details><summary>{t('完整英文释义')}</summary><p>{entry.definition}</p></details>}{entry.context&&<blockquote><WordSentence text={entry.context} original source={entry} onWord={setLookup}/></blockquote>}{entry.context&&<button className="text-button" onClick={()=>onSpeak(entry.context)}><Volume2 size={14}/>{t('听原句')}</button>}{entry.note&&<p className="memory-note">{entry.note}</p>}<small>{entry.bookTitle} {entry.source&&'· '+entry.source}</small></div><div className="ratings" role="group" aria-label={t('复习评分')}>{[{rating:1,label:'重学',cls:'again'},{rating:2,label:'困难',cls:'hard'},{rating:3,label:'记得',cls:'good'},{rating:4,label:'轻松',cls:'easy'}].map(rating=><button key={rating.rating} className={rating.cls} disabled={busy||writing&&rating.rating>1&&answerKey(typed)!==answerKey(expected)} onClick={()=>void rate(rating.rating)}><span>{t(rating.label)}<kbd>{rating.rating}</kbd></span><small>{intervals.find(item=>item.rating===rating.rating)?relativeInterval(intervals.find(item=>item.rating===rating.rating)!.due):''}</small></button>)}</div></>:<div className="reveal-area"><button ref={revealButton} className="primary" title="F1 / Alt+H" onClick={()=>setRevealed(true)}>{t('显示答案')}</button></div>}</div>
      :<div className="review-complete"><div className="complete-mark"><Check size={30}/></div><h2>{t(queue.length?'这一轮，完成了。':'现在没有待复习的条目。')}</h2><p>{t(data.entries.some(e=>!e.translation)?'部分条目还没有译文，补全后就能开始复习。':'继续阅读，新遇见的词会在这里等你。重学的条目会在安排的时间再次出现。')}</p><p className="review-wait" role="status">{upcoming?t('下次复习：')+new Date(upcoming.due).toLocaleString(getUILanguage()==='en'?'en-US':'zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):''}</p><button className="primary" onClick={()=>reset()}><RotateCcw size={16}/>{t('重新检查到期条目')}</button></div>}
    </div>
    <div className="review-bottom">{automatic?<span><Keyboard size={14}/>{t(autoDone?'Enter 继续':mode==='production'?'Ctrl+Enter 提交造句':'Enter 提交答案 · F1 / Alt+H 提示')}</span>:<><button className="text-button" disabled={!lastId||busy} onClick={()=>void undo()}><RotateCcw size={14}/>{t('撤销上一次评分')}</button><span><Keyboard size={14}/>{t('Enter 显示答案／继续 · 方向键选择 · 1–4 评分')}</span></>}{entry?.reviewSkills&&<span className="review-skill-status">{(['meaning','cloze','spelling','production'] as const).map(id=><span key={id} title={(entry.reviewSkills![id]?.card.reps||0)?new Date(entry.reviewSkills![id]!.card.due).toLocaleString():t('未复习')}>{t(labels[id])} {(entry.reviewSkills![id]?.card.reps||0)}</span>)}</span>}</div>
    {lookup&&entry&&<ReviewLookup active={active} key={lookup.text+lookup.context} selection={lookup} entry={entry} data={data} onClose={()=>setLookup(null)} onSpeak={onSpeak} onAdded={replaceEntry} onRefresh={onRefresh}/>}
  </div>;
}
