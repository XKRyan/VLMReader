import {useMemo} from 'react';
import DOMPurify from 'dompurify';
import type {DictionaryEntry} from './types';
import {t} from './i18n';

function articleHtml(raw:string,interactive:boolean){
  const template=document.createElement('template');
  template.innerHTML=DOMPurify.sanitize(raw,{
    ALLOWED_TAGS:['h1','h2','h3','h4','div','span','p','b','strong','i','em','u','sup','sub','small','br','hr','blockquote','ul','ol','li','table','tbody','thead','tr','td','th','a','font'],
    ALLOWED_ATTR:['color'],ALLOW_DATA_ATTR:false
  });
  for(const link of template.content.querySelectorAll('a')){
    const label=link.cloneNode(true) as HTMLElement;
    label.querySelectorAll('sup').forEach(node=>node.remove());
    const word=label.textContent?.replace(/\s+/g,' ').trim()||'';
    if(interactive&&word&&word.length<=150){
      link.setAttribute('data-dictionary-word',word);
      link.setAttribute('role','button');
      link.setAttribute('tabindex','0');
    }
  }
  return template.innerHTML;
}

export default function DictionaryArticles({entry,onLookup}:{
  entry:Pick<DictionaryEntry,'html'|'sections'|'word'|'source'>;
  onLookup?:(word:string)=>void;
}){
  const interactive=!!onLookup;
  const articles=useMemo(()=>{
    const seen=new Set<string>();
    return (entry.sections||[entry]).filter(section=>{
      if(!section.html||seen.has(section.html))return false;
      seen.add(section.html);return true;
    }).map(section=>({source:section.source,html:articleHtml(section.html!,interactive)}));
  },[entry.html,entry.sections,entry.source,interactive]);
  if(!articles.length)return null;
  function follow(target:EventTarget|null){
    const word=target instanceof Element?target.closest<HTMLElement>('[data-dictionary-word]')?.dataset.dictionaryWord:'';
    if(word)onLookup?.(word);
  }
  return <div className="dictionary-articles">{articles.map((article,index)=>
    <details className="dictionary-article" key={article.source+':'+index}>
      <summary>{article.source}<small>{t('完整词典原文')}</small></summary>
      <div className="dictionary-article-body"
        onClick={event=>{event.preventDefault();follow(event.target);}}
        onKeyDown={event=>{
          if((event.key==='Enter'||event.key===' ')&&event.target instanceof Element&&event.target.closest('[data-dictionary-word]')){
            event.preventDefault();follow(event.target);
          }
        }}
        dangerouslySetInnerHTML={{__html:article.html}}/>
    </details>)}</div>;
}
