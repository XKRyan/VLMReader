import {useEffect,useRef,useState,type ReactNode} from 'react';
import {MessageSquare,PenLine,X} from 'lucide-react';
import type {AnnotationPreview,Mark} from './types';
import {layoutAnnotationMarkers,type MarkerAnchor} from '../shared/annotation-layout.mjs';
import {highlightInk} from './highlights';
import {t} from './i18n';
type Ranges={ranges:Map<string,Range>;preview:Range|null};
export default function ReaderAnnotations({surface,notes,preview,activeId,revision,getRanges,onOpen,onClose,render}:{surface:React.RefObject<HTMLDivElement|null>;notes:Mark[];preview:AnnotationPreview|null;activeId:string|null;revision:number;getRanges:()=>Ranges;onOpen:(note:Mark)=>void;onClose:()=>void;render:(ids:string[])=>ReactNode}){
  const [groups,setGroups]=useState<MarkerAnchor[]>([]),[anchor,setAnchor]=useState<{top:number;visible:boolean}|null>(null),[height,setHeight]=useState(600);
  const identities=useRef(new WeakMap<Element,string>()),serial=useRef(0),positions=useRef(new Map<string,number>()),measuredHeight=useRef(600),current=useRef({notes,preview,activeId,getRanges});current.current={notes,preview,activeId,getRanges};
  const expanded=!!preview||!!activeId&&notes.some(note=>note.id===activeId),column=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const root=surface.current;if(!root)return;let frame=0,preserve=false;
    function measure(){
      const root=surface.current;if(!root)return;const bounds=root.getBoundingClientRect(),state=current.current,found=new Map<string,MarkerAnchor>(),{ranges,preview:previewRange}=state.getRanges();
      function include(range:Range,id:string|null,draft:boolean){
        if(!range.startContainer.isConnected)return;const element=range.startContainer.nodeType===1?range.startContainer as Element:range.startContainer.parentElement;if(!element)return;
        const block=element.closest('p,li,h1,h2,h3,h4,blockquote,td')||element,rect=block.getBoundingClientRect(),textRect=[...range.getClientRects()].find(rect=>rect.width&&rect.height);if(!textRect)return;
        const frameElement=range.startContainer.ownerDocument?.defaultView?.frameElement,frameRect=frameElement?.getBoundingClientRect(),offset=frameRect?.top||0;
        if(textRect.right+(frameRect?.left||0)<=bounds.left||textRect.left+(frameRect?.left||0)>=bounds.right)return;
        let key=identities.current.get(block);if(!key){key=String(++serial.current);identities.current.set(block,key);}
        const top=(block.closest('.textLayer')?textRect.top:rect.top)+offset-bounds.top,bottom=(block.closest('.textLayer')?textRect.bottom:rect.bottom)+offset-bounds.top;
        const previous=found.get(key);if(previous){if(id)previous.ids.push(id);previous.draft||=draft;}else found.set(key,{key,ids:id?[id]:[],draft,top,bottom});
      }
      for(const note of state.notes){if(!note.note?.trim()&&note.id!==state.activeId&&note.id!==state.preview?.id)continue;const range=ranges.get(note.id);if(range)include(range,note.id,false);}
      if(previewRange)include(previewRange,null,true);
      const candidates=[...found.values()],active=candidates.find(group=>state.preview?group.draft:group.ids.includes(state.activeId||''));
      const anchorId=state.preview?.id||state.activeId||'draft',previousTop=positions.current.get(anchorId);
      if(preserve&&active){const target=previousTop!==undefined?previousTop>=0&&previousTop<measuredHeight.current?Math.min(previousTop,Math.max(8,root.clientHeight-80)):active.top:active.top<0||active.top>root.clientHeight-40?Math.min(180,root.clientHeight/3):active.top,difference=active.top-target;
        if(Math.abs(difference)>1){const before=root.scrollTop;root.scrollTop+=difference;if(root.scrollTop!==before){preserve=false;frame=requestAnimationFrame(measure);return;}}}
      preserve=false;measuredHeight.current=root.clientHeight;for(const group of candidates){for(const id of group.ids)positions.current.set(id,group.top);if(group.draft)positions.current.set('draft',group.top);}
      setHeight(root.clientHeight);setGroups(layoutAnnotationMarkers(candidates,root.clientHeight));const nextAnchor=active?{top:active.top,visible:active.bottom>0&&active.top<root.clientHeight}:null;
      setAnchor(previous=>JSON.stringify(previous)===JSON.stringify(nextAnchor)?previous:nextAnchor);
    }
    const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);},reflow=()=>{preserve=true;schedule();};
    const resize=new ResizeObserver(reflow);resize.observe(root);if(root.firstElementChild)resize.observe(root.firstElementChild);
    const mutation=new MutationObserver(reflow);mutation.observe(root,{childList:true,subtree:true});root.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',reflow);reflow();
    return()=>{cancelAnimationFrame(frame);resize.disconnect();mutation.disconnect();root.removeEventListener('scroll',schedule);window.removeEventListener('resize',reflow);};
  },[surface,notes,preview?.text,preview?.location,preview?.start,preview?.cfi,preview?.color,preview?.id,activeId,revision,expanded]);
  const activeGroup=groups.find(group=>preview?group.draft:group.ids.includes(activeId||'')),ids=activeGroup?.ids||(preview?.id?[preview.id]:activeId?[activeId]:[]),top=Math.max(8,Math.min(anchor?.top||8,Math.max(8,height-Math.min(480,height-16))));
  return <><div className={'annotation-gutter'+(!preview&&!activeId&&!notes.some(note=>note.note?.trim())?' is-empty':'')} data-reader-annotations="true" aria-label={t('段落批注')}>
    {groups.map((group,index)=>{const marks=notes.filter(note=>group.ids.includes(note.id)),count=marks.filter(note=>note.note?.trim()).length,active=!!preview&&group.draft||!!activeId&&group.ids.includes(activeId);return <button type="button" key={group.key} className={'annotation-marker'+(active?' is-active':'')+(group.draft?' is-draft':'')} style={{top:group.top,color:highlightInk(marks[0]?.color||preview?.color)}} data-note-ids={group.ids.join(',')} aria-label={t(group.draft&&!count?'未保存批注':'查看此处批注')+(count?' · '+count:'')} aria-expanded={active&&expanded} title={marks.map(note=>note.note||note.text).join('\n').slice(0,260)||t('未保存批注')} onClick={()=>{if(active&&expanded)onClose();else if(marks[0])onOpen(marks[0]);}} onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const buttons=event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('.annotation-marker');buttons?.[Math.max(0,Math.min(groups.length-1,index+(event.key==='ArrowDown'?1:-1)))]?.focus();}}}>{group.draft&&!count?<PenLine size={15}/>:<MessageSquare size={15}/>}<span>{count||''}</span></button>;})}
  </div>{expanded&&<aside className="annotation-margin-column" data-reader-annotations="true" aria-label={t('段落批注详情')} ref={column}><section className="annotation-margin-card" style={{top,maxHeight:Math.max(160,height-top-8),visibility:!anchor||anchor.visible||preview?'visible':'hidden'}}><header><strong>{t(preview?'编辑批注':'此处批注')}{!preview&&ids.length>1&&<small>{ids.length}</small>}</strong><button className="icon-button" aria-label={t(preview?'关闭批注编辑':'关闭段落批注')} onClick={onClose}><X size={17}/></button></header>{render(ids)}</section></aside>}</>;
}
