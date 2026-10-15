import {useEffect,useRef,useState} from 'react';
import {t} from './i18n';
export default function ReaderPanelResize({width,onChange,onCommit}:{width:number;onChange:(width:number)=>void;onCommit:(width:number)=>void}){
  const drag=useRef<{pointer:number;x:number;width:number;value:number}|null>(null),[dragging,setDragging]=useState(false);
  useEffect(()=>()=>document.documentElement.classList.remove('reader-panel-resizing'),[]);
  function limit(value:number,element:HTMLElement){const maximum=Math.min(760,(element.closest('.reader-columns')?.clientWidth||1080)-320);return Math.round(Math.max(280,Math.min(maximum,value)));}
  function finish(cancel=false){const current=drag.current;if(!current)return;drag.current=null;setDragging(false);document.documentElement.classList.remove('reader-panel-resizing');if(cancel)onChange(current.width);else onCommit(current.value);}
  return <div className={'reader-panel-resize'+(dragging?' is-dragging':'')} role="separator" aria-label={t('调整侧栏宽度')} aria-orientation="vertical" aria-valuemin={280} aria-valuemax={760} aria-valuenow={width} tabIndex={0} title={t('拖动调整侧栏宽度；双击恢复默认')}
    onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);drag.current={pointer:event.pointerId,x:event.clientX,width,value:width};setDragging(true);document.documentElement.classList.add('reader-panel-resizing');}}
    onPointerMove={event=>{const current=drag.current;if(!current||current.pointer!==event.pointerId)return;event.preventDefault();current.value=limit(current.width+current.x-event.clientX,event.currentTarget);onChange(current.value);}}
    onPointerUp={()=>finish()} onPointerCancel={()=>finish(true)} onLostPointerCapture={()=>finish()}
    onDoubleClick={event=>{const value=limit(360,event.currentTarget);onChange(value);onCommit(value);}}
    onKeyDown={event=>{if(event.key==='Escape'&&drag.current){event.preventDefault();finish(true);return;}if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();event.stopPropagation();const value=limit(event.key==='Home'?280:event.key==='End'?760:width+(event.key==='ArrowLeft'?20:-20),event.currentTarget);onChange(value);onCommit(value);}}><i/></div>;
}
