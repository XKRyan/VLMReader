import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import ePub from 'epubjs';
import {documentHtml} from './documentHtml';
import {wordOriginal} from './wordOriginal';
import MarkdownMedia from './MarkdownMedia';
import {t} from './i18n';
import {fontStack} from './fonts';
import {getPalette} from '../electron/palette.cjs';
import PdfDocument from './PdfDocument';
import ReaderAnnotations from './ReaderAnnotations';
import {onSelectionClick} from './selectionEvents';
import {sentenceFor,selectionFromDoc} from './selection';
import {annotationRange,rangeAtPoint,selectionStart} from './annotations';
import {paintHighlights,clearHighlights} from './highlights';
import {paintVocabulary} from './vocabularyMarks';
import {wordAt,interactiveTarget} from './wordAt';
export {sentenceFor} from './selection';
import type {Book,Settings,Mark,AnnotationPreview,SelectionInfo,ReaderMeta,ReaderControl,SearchHit} from './types';
pdfjs.GlobalWorkerOptions.workerSrc=pdfWorker;
function flattenToc(items:any[],depth=0):ReaderMeta['toc'] {return items.flatMap(item=>[{label:item.label?.trim()||item.title||'章节',href:item.href||'',depth},...flattenToc(item.subitems||[],depth+1)]);}
interface Props {onDocumentLink:(href:string)=>Promise<void>;onWordClick:(info:SelectionInfo)=>void;active:boolean;book:Book;settings:Settings;vocabulary:Set<string>;notes:Mark[];preview:AnnotationPreview|null;annotationId:string|null;onAnnotationOrder:(ids:string[])=>void;renderAnnotations:(ids:string[])=>React.ReactNode;onCloseAnnotations:()=>void;speechText:string;zoom:number;control:React.MutableRefObject<ReaderControl|null>;onNavigate:()=>void;onDismissSelection:()=>void;onMeta:(m:ReaderMeta)=>void;onProgress:(location:string|number,progress:number)=>void;onSelection:(s:SelectionInfo)=>void;onAnnotation:(mark:Mark)=>void;onError:(e:string)=>void;onTitle:(s:string)=>void}
export default function Reader(props:Props) {
  const {book,settings,control,onMeta,onProgress,onSelection,onError,onTitle}=props;
  const mount=useRef<HTMLDivElement>(null), current=useRef(props);current.current=props;
  const [media,setMedia]=useState<{src:string;alt:string}|null>(null);
  const [busy,setBusy]=useState(true),[html,setHtml]=useState(''),[pdfDoc,setPdfDoc]=useState<pdfjs.PDFDocumentProxy|null>(null),spokenBlock=useRef(-1),clickedWord=useRef<{doc:Document;text:string;time:number}|null>(null);
  const pdf=useRef<any>(null),epub=useRef<any>(null),rendition=useRef<any>(null),lastHover=useRef('');
  // Repaint vocabulary underlines when pages render, EPUB chapters load, or the word list or theme changes.
  useEffect(()=>{
    const root=container.current;if(!root)return;let timer:ReturnType<typeof setTimeout>|undefined;const hooked=new WeakSet<HTMLIFrameElement>();
    const paint=()=>{const color=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()||'#5c6cc7';paintVocabulary(root,props.vocabulary,color);
      for(const frame of root.querySelectorAll('iframe')){if(!hooked.has(frame)){hooked.add(frame);frame.addEventListener('load',schedule);}const body=frame.contentDocument?.body;if(body)paintVocabulary(body,props.vocabulary,color);}};
    const schedule=()=>{clearTimeout(timer);timer=setTimeout(paint,250);};
    const observer=new MutationObserver(schedule);observer.observe(root,{childList:true,subtree:true});schedule();
    return()=>{clearTimeout(timer);observer.disconnect();for(const frame of root.querySelectorAll('iframe'))frame.removeEventListener('load',schedule);};
  },[props.vocabulary,settings.theme,settings.colorThemes,html,pdfDoc]);
  const container=useRef<HTMLDivElement>(null),hoverTimer=useRef<ReturnType<typeof setTimeout>|null>(null),initialLocation=useRef(book.location);
  const busyRef=useRef(busy);busyRef.current=busy;
  const wheelState=useRef({delta:0,last:0,turn:0}),ranges=useRef(new Map<string,Range>()),epubRanges=useRef(new Map<Document,Map<string,Range>>());
  const previewRange=useRef<Range|null>(null),[annotationRevision,setAnnotationRevision]=useState(0);
  const original=book.format==='docx'&&!!book.wordOriginal;
  const markdownAnchor=useRef<string|null>(null);
  const loadedBook=useRef(''),switchAnchor=useRef<{text:string;start:number;offset:number}|null>(null);
  function capturePosition(){
    const root=mount.current,surface=container.current;if(!root||!surface)return null;
    const top=surface.getBoundingClientRect().top;
    const block=[...root.querySelectorAll('p,li,h1,h2,h3,td')].find(el=>el.textContent?.trim()&&el.getBoundingClientRect().bottom>top+12);
    if(!block)return null;const range=document.createRange();range.selectNodeContents(block);
    const anchor=selectionStart(root,range);
    return {text:range.toString().replace(/\s+/g,' ').trim().slice(0,120),start:anchor.start,offset:range.getBoundingClientRect().top-top};
  }
  function wheelPage(event:WheelEvent){
    if(!current.current.active||book.format!=='epub'||event.ctrlKey||Math.abs(event.deltaX)>Math.abs(event.deltaY)||!event.deltaY)return;
    event.preventDefault();const now=performance.now(),state=wheelState.current,direction=Math.sign(event.deltaY);if(busyRef.current||now-state.turn<500)return;
    if(now-state.last>180||Math.sign(state.delta)!==direction)state.delta=0;state.last=now;state.delta+=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?(container.current?.clientHeight||700):1);if(Math.abs(state.delta)<55)return;
    state.turn=now;state.delta=0;current.current.onNavigate();const r=rendition.current;if(r)void(direction>0?r.next():r.prev()).catch((e:Error)=>current.current.onError(e.message));
  }
  useEffect(()=>{const el=container.current;if(!el)return;el.addEventListener('wheel',wheelPage,{passive:false});return()=>el.removeEventListener('wheel',wheelPage);},[book.id]);
  function clearSelection(){document.getSelection()?.removeAllRanges();for(const item of rendition.current?.getContents()||[])item.document.getSelection()?.removeAllRanges();}
  function markText(){
    if(book.format==='pdf')return;
    const r=rendition.current;if(r){
      const contents=r.getContents(),documents=new Set<Document>(contents.map((content:any)=>content.document));
      for(const doc of epubRanges.current.keys())if(!documents.has(doc)){clearHighlights(doc);epubRanges.current.delete(doc);}
      for(const content of contents){const doc=content.document as Document,palette=getPalette(current.current.settings),next=new Map<string,Range>();
        doc.documentElement.style.setProperty('--paper',palette.paper);doc.documentElement.style.setProperty('--accent',palette.accent);
        for(const mark of current.current.notes)if(mark.cfi)try{if(new (ePub as any).CFI(mark.cfi).spinePos!==content.sectionIndex)continue;const range=content.range(mark.cfi);if(range)next.set(mark.id,range);}catch{/* A malformed imported CFI cannot stop reading. */}
        const preview=current.current.preview;let draftRange:Range|null=null;
        if(preview?.cfi)try{if(new (ePub as any).CFI(preview.cfi).spinePos===content.sectionIndex)draftRange=content.range(preview.cfi);}catch{/* A draft never prevents rendering the saved notes. */}
        if(draftRange)previewRange.current=draftRange;epubRanges.current.set(doc,next);paintHighlights(next,current.current.notes,doc,preview&&draftRange?{...preview,range:draftRange}:null);
      }if(!current.current.preview)previewRange.current=null;setAnnotationRevision(value=>value+1);return;
    }
    const next=new Map<string,Range>();if(mount.current)for(const mark of current.current.notes){const range=annotationRange(mount.current,mark);if(range)next.set(mark.id,range);}ranges.current=next;current.current.onAnnotationOrder([...next].sort((a,b)=>a[1].compareBoundaryPoints(Range.START_TO_START,b[1])).map(([id])=>id));
    const preview=current.current.preview,draftRange=preview&&mount.current?annotationRange(mount.current,preview):null;previewRange.current=draftRange;paintHighlights(next,current.current.notes,document,preview&&draftRange?{...preview,range:draftRange}:null);setAnnotationRevision(value=>value+1);
  }
  function locate(mark:Mark){textGo(mark.location);const range=ranges.current.get(mark.id),surface=container.current;if(range&&surface)surface.scrollTop+=range.getBoundingClientRect().top-surface.getBoundingClientRect().top-110;}
  function textGo(where:string|number){if(book.format==='md'&&typeof where==='string'){const id=where.replace(/^#/,''),target=mount.current?.querySelector('#'+CSS.escape(id));if(target){markdownAnchor.current=id;target.scrollIntoView({behavior:'smooth',block:'start'});return;}}if(book.format==='md')markdownAnchor.current=typeof where==='string'&&!/^\d/.test(where)?where.replace(/^#/,''):null;const el=container.current;if(!el)return;if(typeof where==='number'||/^\d+(\.\d+)?$/.test(where)){el.scrollTop=Number(where);return;}const found=mount.current?.querySelector('#'+CSS.escape(where.replace(/^#/,'')));found?.scrollIntoView({behavior:'smooth',block:'start'});}
  useEffect(()=>{
    let alive=true;markdownAnchor.current=null;if(loadedBook.current!==book.id)switchAnchor.current=null;loadedBook.current=book.id;
    setBusy(true);setHtml('');setPdfDoc(null);initialLocation.current=book.location;
    window.mem.readBook(book.id,original).then(async data=>{
      if(!alive)return;
      if(book.format==='pdf'){
        const doc=await pdfjs.getDocument({data:data.bytes!,cMapUrl:new URL('pdf-assets/cmaps/',document.baseURI).href,cMapPacked:true,standardFontDataUrl:new URL('pdf-assets/standard_fonts/',document.baseURI).href,wasmUrl:new URL('pdf-assets/wasm/',document.baseURI).href,useWorkerFetch:false}).promise;
        if(!alive){doc.destroy();return;}pdf.current=doc;setPdfDoc(doc);
        const outline=await doc.getOutline();const toc:ReaderMeta['toc']=[];
        async function walk(items:any[],depth=0){for(const item of items){let dest=item.dest;if(typeof dest==='string')dest=await doc.getDestination(dest);if(Array.isArray(dest)){const p=typeof dest[0]==='object'?await doc.getPageIndex(dest[0]):dest[0];toc.push({label:item.title,href:String(p+1),depth});}if(item.items)await walk(item.items,depth+1);}}
        if(outline)await walk(outline);if(alive)onMeta({index:Math.floor(Number(book.location))||1,count:doc.numPages,toc});
      }else if(book.format==='epub'){
        const b=ePub(data.bytes!.buffer as ArrayBuffer);epub.current=b;
        const metadata=await b.loaded.metadata;if(!alive)return;
        if(metadata.title&&book.title!==metadata.title)onTitle(metadata.title);
        const navigation=await b.loaded.navigation;void b.locations.generate(1600).catch(()=>{});
        const r:any=b.renderTo(mount.current!,{width:'100%',height:'100%',flow:'paginated',spread:'none',allowScriptedContent:false});rendition.current=r;
        r.hooks.content.register((contents:any)=>{contents.document.addEventListener('wheel',wheelPage,{passive:false});onSelectionClick(contents.document,(event,newSelection)=>{if(!current.current.active||newSelection)return;const id=rangeAtPoint(epubRanges.current.get(contents.document)||new Map(),event.clientX,event.clientY),note=current.current.notes.find(note=>note.id===id);if(note){current.current.onAnnotation(note);return;}const hit=!interactiveTarget(event.target)?wordAt(contents.document,event.clientX,event.clientY,contents.document.body,pointLocation,range=>contents.cfiFromRange(range)):null;if(!hit){current.current.onDismissSelection();return;}const native=contents.document.getSelection();native?.removeAllRanges();native?.addRange(hit.range);clickedWord.current={doc:contents.document,text:hit.info.text,time:Date.now()};current.current.onWordClick(hit.info);});contents.document.addEventListener('mousemove',(event:MouseEvent)=>hoverWord(contents.document,event.clientX,event.clientY,contents.document.body,range=>contents.cfiFromRange(range)));});
        r.on('selected',(cfi:string,contents:any)=>{if(!current.current.active)return;const clicked=clickedWord.current;if(clicked&&clicked.doc===contents.document&&Date.now()-clicked.time<1500&&contents.document.getSelection()?.toString().trim()===clicked.text){clickedWord.current=null;return;}const selection=selectionFromDoc(contents.document,contents.document.body.innerText,cfi,cfi);if(selection)current.current.onSelection(selection);});
        r.on('relocated',(loc:any)=>{if(!alive)return;markText();if(!current.current.active)return;current.current.onProgress(loc.start.cfi,b.locations.length()?b.locations.percentageFromCfi(loc.start.cfi):((loc.start.index||0)/Math.max(1,(b.spine as any).spineItems.length)));current.current.onMeta({index:loc.start.displayed.page,count:loc.start.displayed.total,toc:flattenToc(navigation.toc)});});
        const colors=getPalette(current.current.settings);
        r.themes.default({'body':{'font-family':fontStack(settings.readingFont,settings.fontFamily==='serif'),'font-size':settings.fontSize+'px','line-height':String(settings.lineHeight),color:colors.readingText,background:colors.paper,padding:'24px 44px !important'},'body *':{'font-family':'inherit !important'},'p':{'margin-bottom':'1em'},'a':{color:colors.accentText},'::selection':{background:colors.selection}});
        r.themes.fontSize(settings.fontSize+'px');await r.display(book.location||undefined);
        if(!alive)return;
        control.current={prev:()=>r.prev(),next:()=>r.next(),go:where=>r.display(String(where)),getText:()=>r.getContents().map((c:any)=>c.document.body.innerText).join('\n'),
          nextText:async()=>{const loc=r.currentLocation();const next=(b.spine as any).spineItems[(loc.start.index||0)+1];if(!next)return null;await r.display(next.href);return r.getContents().map((c:any)=>c.document.body.innerText).join('\n');},
          peekNextText:async()=>{const loc=r.currentLocation();const next=(b.spine as any).spineItems[(loc.start.index||0)+1];if(!next)return null;await next.load(b.load.bind(b));const text=next.document?.body?.textContent||null;next.unload();return text;},
          highlight:markText,clearSelection,locate:mark=>void r.display(mark.cfi||String(mark.location)),
          search:async q=>{const hits:SearchHit[]=[];if(!q)return hits;for(const item of (b.spine as any).spineItems){await item.load(b.load.bind(b));for(const hit of item.find(q))hits.push({label:'章节 '+(item.index+1),location:hit.cfi,excerpt:hit.excerpt});item.unload();if(hits.length>=80)break;}return hits.slice(0,80);}};
        markText();
      }else{
        let value=data.html||data.text||'';
        if(book.format==='txt')value=value.split(/\n\s*\n/).map(t=>'<p>'+t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')+'</p>').join('');
        const clean=book.format==='md'?await (await import('./markdown')).markdownHtml(value,data.resources):original?await wordOriginal(data.bytes!):documentHtml(value,data.resources);
        if(!alive)return;
        setHtml(clean);
        control.current={prepareViewChange:()=>{switchAnchor.current=capturePosition();},prev:()=>container.current?.scrollBy({top:-500,behavior:'smooth'}),next:()=>container.current?.scrollBy({top:500,behavior:'smooth'}),go:textGo,getText:()=>mount.current?.innerText||'',nextText:async()=>null,highlight:markText,clearSelection,locate,
          search:async q=>{const text=mount.current?.innerText||'';const hits:SearchHit[]=[];let at=0;while(q && (at=text.toLocaleLowerCase().indexOf(q.toLocaleLowerCase(),at))>=0&&hits.length<80){const proportion=at/Math.max(1,text.length);hits.push({label:'匹配 '+(hits.length+1),location:proportion*Math.max(0,(container.current?.scrollHeight||0)-(container.current?.clientHeight||0)),excerpt:text.slice(Math.max(0,at-60),at+140)});at+=q.length;}return hits;}};
      }
      if(alive)setBusy(false);
    }).catch(error=>{if(alive){setBusy(false);onError('文档无法打开：'+error.message);}});
    return()=>{alive=false;clearHighlights();for(const doc of epubRanges.current.keys())clearHighlights(doc);epubRanges.current.clear();if(hoverTimer.current)clearTimeout(hoverTimer.current);control.current=null;pdf.current?.destroy();pdf.current=null;rendition.current?.destroy();rendition.current=null;epub.current?.destroy();epub.current=null;};
  },[book.id,original]);
  useLayoutEffect(()=>{
    if(!html||!mount.current)return;
    const headings=[...mount.current.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    const toc=headings.map((el,i)=>{el.id=el.id||'section-'+i;return {label:el.textContent||'章节',href:el.id,depth:Number(el.tagName.slice(1))-1};});
    onMeta({index:1,count:1,toc});
    const surface=container.current,root=mount.current;
    let disposed=false;
    const restore=()=>{
      if(disposed||!surface)return;
      if(original)root.style.zoom=String(Math.min(1,Math.max(180,surface.clientWidth-32)/(root.offsetWidth||1))*props.zoom);
      const anchor=switchAnchor.current,range=anchor?annotationRange(root,anchor):null;
      if(range)surface.scrollTop+=range.getBoundingClientRect().top-surface.getBoundingClientRect().top-anchor!.offset;
      else if(typeof initialLocation.current==='string'&&(book.format==='md'||!/^\d/.test(initialLocation.current)))textGo(initialLocation.current);
      else surface.scrollTop=Number(initialLocation.current)||0;
      markText();
    };
    restore();const settledTop=surface?.scrollTop;
    // Do not override a user's scroll while fonts or images are loading.
    void Promise.all([document.fonts.ready,...Array.from(root.querySelectorAll('img')).map(img=>img.decode().catch(()=>{}))]).then(()=>requestAnimationFrame(()=>{if(surface?.scrollTop===settledTop)restore();}));
    markText();
    return()=>{disposed=true;};
  },[html]);
  useEffect(()=>{
    if(!original||!html||!container.current||!mount.current)return;
    const surface=container.current,root=mount.current;
    const resize=()=>{const width=root.offsetWidth||1;root.style.zoom=String(Math.min(1,Math.max(180,surface.clientWidth-32)/width)*props.zoom);setAnnotationRevision(value=>value+1);};
    const observer=new ResizeObserver(resize);observer.observe(surface);resize();
    return()=>{observer.disconnect();root.style.zoom='';};
  },[original,html,props.zoom]);
  useEffect(()=>{markText();},[props.notes,props.preview?.text,props.preview?.location,props.preview?.start,props.preview?.cfi,props.preview?.color,props.preview?.id]);
  useEffect(()=>{
    const r=rendition.current;if(!r)return;const colors=getPalette(settings);
    r.themes.default({'body':{color:colors.readingText,background:colors.paper,'font-family':fontStack(settings.readingFont,settings.fontFamily==='serif'),'line-height':String(settings.lineHeight),padding:'24px 44px !important'},'body *':{'font-family':'inherit !important'},'p':{'margin-bottom':'1em'},'a':{color:colors.accentText},'::selection':{background:colors.selection}});r.themes.fontSize(settings.fontSize+'px');markText();
  },[settings.theme,settings.colorThemes,settings.fontSize,settings.fontFamily,settings.readingFont,settings.lineHeight]);
  useEffect(()=>{
    const mountEl=mount.current;if(!mountEl)return;
    for(const el of mountEl.querySelectorAll('.speaking'))el.classList.remove('speaking');
    if(!props.speechText){spokenBlock.current=-1;return;}
    const blocks=[...mountEl.querySelectorAll('p,li,h1,h2,h3,blockquote')],has=(el:Element)=>!!el.textContent?.replace(/\s+/g,' ').includes(props.speechText);
    // Search forward from the paragraph being read: short cues such as "Mrs." also occur earlier in the text.
    let at=blocks.findIndex((el,index)=>index>=Math.max(0,spokenBlock.current)&&has(el));if(at<0)at=blocks.findIndex(has);if(at<0)return;
    blocks[at].classList.add('speaking');if(at!==spokenBlock.current)blocks[at].scrollIntoView({behavior:'smooth',block:'center'});spokenBlock.current=at;
  },[props.speechText]);
  useEffect(()=>{if(!props.active)return;const r=rendition.current;if(r&&book.location)void r.display(book.location).catch((error:Error)=>current.current.onError(error.message));},[props.active]);
  useEffect(()=>{
    if(book.format!=='md'||!html||!mount.current)return;let disposed=false,cleanup:(()=>void)|undefined;const root=mount.current;
    void import('./markdownEnhance').then(module=>{if(!disposed)cleanup=module.enhanceMarkdown(root,book.id,()=>{if(hoverTimer.current)clearTimeout(hoverTimer.current);const id=markdownAnchor.current,target=id?root.querySelector('#'+CSS.escape(id)):null,surface=container.current;if(target&&surface)surface.scrollTop+=target.getBoundingClientRect().top-surface.getBoundingClientRect().top-24;setAnnotationRevision(value=>value+1);});}).catch(error=>onError(error.message));
    return()=>{disposed=true;cleanup?.();};
  },[html,book.id]);
  function markdownClick(event:React.MouseEvent){
    if(book.format!=='md'||!(event.target instanceof Element))return;
    if(hoverTimer.current)clearTimeout(hoverTimer.current);const link=event.target.closest('a[href]');
    if(link){event.preventDefault();event.stopPropagation();if(event.detail>0&&window.getSelection()?.toString().trim())return;const href=link.getAttribute('href')||'';if(href.startsWith('#')){let id;try{id=decodeURIComponent(href.slice(1));}catch{id=href.slice(1);}if(!id){container.current?.scrollTo({top:0,behavior:'smooth'});return;}const target=mount.current?.querySelector('#'+CSS.escape(id));if(target){markdownAnchor.current=id;current.current.onDismissSelection();target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});target.setAttribute('tabindex','-1');(target as HTMLElement).focus({preventScroll:true});}else onError(t('找不到链接目标：')+id);}else void current.current.onDocumentLink(href);return;}
    const img=event.target.closest('img');if(img?.src&&img.naturalWidth){event.preventDefault();event.stopPropagation();setMedia({src:img.src,alt:img.alt});}
  }
  function onMouseUp(event:React.MouseEvent){
    if(book.format==='md'&&event.target instanceof Element&&(event.target.closest('button,summary,img,[data-ui]')||event.target.closest('a')&&window.getSelection()?.isCollapsed))return;
    if(book.format==='epub'||book.format==='pdf')return;const sel=window.getSelection();if(!sel?.anchorNode||!mount.current?.contains(sel.anchorNode))return;
    if(sel.isCollapsed){if(book.format==='md'&&event.target instanceof Element&&event.target.closest('.katex'))return;const id=rangeAtPoint(ranges.current,event.clientX,event.clientY),mark=current.current.notes.find(n=>n.id===id);if(mark){current.current.onAnnotation(mark);return;}
      // A plain click on a word looks it up; a click on blank space closes the selection.
      const hit=!interactiveTarget(event.target)&&mount.current?wordAt(document,event.clientX,event.clientY,mount.current,pointLocation):null;
      if(hit){sel.removeAllRanges();sel.addRange(hit.range);current.current.onWordClick(hit.info);}else current.current.onDismissSelection();return;}
    const info=selectionFromDoc(document,mount.current?.innerText||'',container.current?.scrollTop||0);if(info)onSelection(info);
  }
  // Hover, click and PDF/EPUB lookups resolve locations the same way.
  const pointLocation=(range:Range)=>book.format==='pdf'?Number(range.startContainer.parentElement?.closest<HTMLElement>('[data-pdf-page]')?.dataset.pdfPage)||1:container.current?.scrollTop||0;
  function hoverWord(doc:Document,x:number,y:number,scope:Element,cfiFor?:(range:Range)=>string){
    if(hoverTimer.current)clearTimeout(hoverTimer.current);
    if(!current.current.active||!current.current.settings.hoverTranslate||doc.getSelection()?.toString())return;
    hoverTimer.current=setTimeout(()=>{
      if(!current.current.active||!current.current.settings.hoverTranslate)return;
      const hit=wordAt(doc,x,y,scope,pointLocation,cfiFor);if(!hit)return;
      const {info}=hit,key=[info.location,info.start,info.text,info.context].join('|');
      if(lastHover.current===key)return;lastHover.current=key;
      current.current.onSelection(info);
    },700);
  }
  function onMouseMove(e:React.MouseEvent){if(interactiveTarget(e.target)||book.format==='md'&&e.target instanceof Element&&e.target.closest('img,summary,[data-ui],.katex')){if(hoverTimer.current)clearTimeout(hoverTimer.current);return;}if(book.format!=='epub'&&container.current)hoverWord(document,e.clientX,e.clientY,container.current);}
  function onScroll(){if(hoverTimer.current)clearTimeout(hoverTimer.current);if(busyRef.current||book.format==='epub'||book.format==='pdf')return;const el=container.current;if(el)onProgress(el.scrollTop,el.scrollTop/Math.max(1,el.scrollHeight-el.clientHeight));}
  return <div className="reader-document-area"><div className={'reader-surface '+(book.format==='epub'?'epub-surface':'')} ref={container} onPointerDown={()=>{markdownAnchor.current=null;}} onWheel={()=>{markdownAnchor.current=null;}} onKeyDown={event=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End',' '].includes(event.key))markdownAnchor.current=null;}} onClick={markdownClick} onScroll={onScroll} onMouseUp={onMouseUp} onMouseMove={onMouseMove}>
    {busy&&!(book.format==='pdf'&&pdfDoc)&&<div className="reader-loading"><span className="spinner"/>正在打开文档…</div>}
    {book.format==='pdf'?pdfDoc&&<PdfDocument onWordClick={info=>current.current.onWordClick(info)} doc={pdfDoc} book={book} settings={settings} zoom={props.zoom} notes={props.notes} preview={props.preview} onRanges={(next,draftRange)=>{ranges.current=next;previewRange.current=draftRange;current.current.onAnnotationOrder([...next].sort((a,b)=>a[1].compareBoundaryPoints(Range.START_TO_START,b[1])).map(([id])=>id));setAnnotationRevision(value=>value+1);}} speechText={props.speechText} surface={container} control={control} onMeta={onMeta} onProgress={onProgress} onSelection={onSelection} onAnnotation={props.onAnnotation} onNavigate={props.onNavigate} onDismissSelection={props.onDismissSelection} onError={onError}/>:<div ref={mount} data-annotation-root={book.format==='docx'||book.format==='md'?true:undefined} className={book.format==='epub'?'epub-document':original?'word-original':'prose'} style={original||book.format==='epub'||book.format==='pdf'&&!settings.pdfTextMode?undefined:{fontSize:settings.fontSize,lineHeight:settings.lineHeight,maxWidth:settings.contentWidth,fontFamily:fontStack(settings.readingFont,settings.fontFamily==='serif')}} dangerouslySetInnerHTML={html?{__html:html}:undefined}/>}
  </div><ReaderAnnotations surface={container} notes={props.notes} preview={props.preview} activeId={props.annotationId} revision={annotationRevision} getRanges={()=>({ranges:book.format==='epub'?new Map([...epubRanges.current.values()].flatMap(ranges=>[...ranges])):ranges.current,preview:previewRange.current})} onOpen={props.onAnnotation} onClose={props.onCloseAnnotations} render={props.renderAnnotations}/>{media&&<MarkdownMedia {...media} onClose={()=>setMedia(null)}/>}</div>;
}
