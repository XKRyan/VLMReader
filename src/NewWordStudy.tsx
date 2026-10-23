import {useRef} from 'react';
import {Volume2} from 'lucide-react';
import type {Entry} from './types';
import {t} from './i18n';
import {useReviewFocus} from './useReviewFocus';
import WordSentence from './WordSentence';
import type {WordSelection} from './WordSentence';
import {semanticDefinition} from '../shared/review-cues.mjs';

export default function NewWordStudy({entry,meaning,ready,active,busy,onStudy,onSpeak,onWord}:{entry:Entry;meaning:string;ready:boolean;active:boolean;busy:boolean;onStudy:()=>void;onSpeak:(text:string)=>void;onWord:(selection:WordSelection)=>void}) {
  const button=useRef<HTMLButtonElement>(null);
  const definition=semanticDefinition(entry.definition),brief=definition.split('\n').slice(0,2).join('\n');
  useReviewFocus(button,entry.id,active&&ready&&!busy);
  return <div className="flashcard new-word-study">
    <div className="flashcard-eyebrow">{t('新词学习')}<span>{t('先理解，再回忆')}</span></div>
    <div className="flashcard-front"><h2>{entry.text}</h2>{entry.phonetic&&<span className="phonetic">/{entry.phonetic}/</span>}<button className="icon-button" aria-label={t('朗读复习内容')} onClick={()=>onSpeak(entry.text)}><Volume2 size={20}/></button></div>
    <div className="flashcard-back">
      {brief&&<p className="study-definition">{brief}</p>}{definition!==brief&&<details><summary>{t('完整英文释义')}</summary><p>{definition}</p></details>}
      <div className="flashcard-translation">{ready?meaning:'…'}</div>
      {entry.context&&<><blockquote><WordSentence text={entry.context} source={entry} original onWord={onWord}/></blockquote><button className="text-button" onClick={()=>onSpeak(entry.context)}><Volume2 size={14}/>{t('听原句')}</button>{entry.contextTranslation&&<p>{entry.contextTranslation}</p>}</>}
      <p className="recall-prompt">{t('读懂释义，听一遍发音，用例句理解这个词。稍后会隐藏答案，让你独立回忆。')}</p>
    </div>
    <div className="reveal-area"><button ref={button} className="primary" disabled={busy||!ready} onKeyDown={event=>{if(event.repeat&&['Enter',' '].includes(event.key))event.preventDefault();}} onClick={onStudy}>{t('学好了，稍后回忆')}</button><small>{t('约 1 分钟后开始回忆；看过释义不计作答对。')}</small></div>
  </div>;
}
