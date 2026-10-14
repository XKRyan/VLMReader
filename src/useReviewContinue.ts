import {useCallback,useEffect,useRef} from 'react';
export function useReviewContinue(ready:boolean,enabled:boolean,onContinue:()=>void){
  const advanced=useRef(false),button=useRef<HTMLButtonElement>(null);
  const next=useCallback(()=>{if(!ready||!enabled||advanced.current)return;advanced.current=true;onContinue();},[ready,enabled,onContinue]);
  useEffect(()=>{if(ready&&enabled)button.current?.focus({preventScroll:true});},[ready,enabled]);
  useEffect(()=>{if(!ready||!enabled)return;const handler=(event:KeyboardEvent)=>{
    if(event.key!=='Enter'||event.isComposing||event.altKey||event.ctrlKey||event.metaKey||event.defaultPrevented)return;
    const target=event.target instanceof Element?event.target:document.activeElement||document.body;if(target.closest('input,textarea,select,summary,[contenteditable="true"],[role="dialog"]'))return;
    const focused=target.closest('button');if(focused&&focused!==button.current)return;
    event.preventDefault();if(!event.repeat)next();
  };window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);},[ready,enabled,next]);
  return {button,next};
}
