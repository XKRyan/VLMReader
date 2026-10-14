import {useEffect} from 'react';
import type {RefObject} from 'react';
export function useReviewFocus(ref:RefObject<HTMLElement|null>,key:string,enabled:boolean){
  useEffect(()=>{if(!enabled)return;const timer=setTimeout(()=>{if(document.querySelector('[role="dialog"]'))return;ref.current?.focus({preventScroll:true});},0);return()=>clearTimeout(timer);},[key,enabled]);
}
export function hintShortcut(event:KeyboardEvent){
  return !event.isComposing&&!event.repeat&&!event.ctrlKey&&!event.metaKey&&(event.key==='F1'&&!event.altKey||event.altKey&&event.key.toLowerCase()==='h');
}
