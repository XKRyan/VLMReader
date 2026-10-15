import {useEffect,useRef,type RefObject} from 'react';

// Dialogs keep keyboard focus inside and return to the invoking control.
export function useDialogFocus(root:RefObject<HTMLElement|null>,active=true){
  const wasActive=useRef(false),opener=useRef<HTMLElement|null>(null);
  if(active&&!wasActive.current)opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
  wasActive.current=active;
  useEffect(()=>{
    const element=root.current;if(!active||!element)return;
    const dialog:HTMLElement=element,previous=opener.current;
    const focusable=()=>Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])')).filter(el=>el.getClientRects().length&&!el.closest('[inert]'));
    (dialog.querySelector<HTMLElement>('[data-dialog-initial]')||focusable()[0]||dialog).focus({preventScroll:true});
    function key(event:KeyboardEvent){
      if(event.key!=='Tab'||event.defaultPrevented||dialog.closest('[inert]')||getComputedStyle(dialog).visibility==='hidden')return;
      const items=focusable(),first=items[0],last=items.at(-1);
      if(!first){event.preventDefault();dialog.focus();return;}
      if(!items.includes(document.activeElement as HTMLElement)||event.shiftKey&&document.activeElement===first||!event.shiftKey&&document.activeElement===last){event.preventDefault();(event.shiftKey?last:first)?.focus();}
    }
    document.addEventListener('keydown',key,true);
    return()=>{document.removeEventListener('keydown',key,true);requestAnimationFrame(()=>{const next=Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).find(el=>!el.closest('[inert]')&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');if(!root.current?.isConnected&&previous?.isConnected&&!previous.closest('[inert]')&&(!next||next.contains(previous)))previous.focus({preventScroll:true});});};
  },[root,active]);
}
