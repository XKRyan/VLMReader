import {t} from './i18n';
export interface WordSelection {text:string;context:string;original:boolean;bookId?:string;bookTitle?:string;location?:string|number}
export default function WordSentence({text,context=text,original=false,source,onWord}:{text:string;context?:string;original?:boolean;source?:{bookId?:string;bookTitle?:string;location?:string|number};onWord:(selection:WordSelection)=>void}){
  const segments=[...new Intl.Segmenter(/[\u3400-\u9fff]/.test(text)?'zh':'en',{granularity:'word'}).segment(text)];
  return <span className="word-sentence">{segments.map((item,index)=>item.isWordLike&&/\p{L}/u.test(item.segment)?<button type="button" className="sentence-word" key={index} aria-label={t('查词')+' '+item.segment} onClick={()=>onWord({text:item.segment,context,original,bookId:source?.bookId,bookTitle:source?.bookTitle,location:source?.location})}>{item.segment}</button>:<span key={index}>{item.segment}</span>)}</span>;
}
