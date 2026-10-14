import {useEffect,useRef,useState} from 'react';
import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import ePub from 'epubjs';
import {documentHtml} from './documentHtml';
import {marked} from 'marked';
import {fontStack} from './fonts';
import {getPalette} from '../electron/palette.cjs';
import PdfDocument from './PdfDocument';
import {sentenceFor,selectionFromDoc,selectWholeSentence} from './selection';
import {annotationRange,rangeAtPoint,selectionStart} from './annotations';
import {paintHighlights,clearHighlights,highlightFill} from './highlights';
export {sentenceFor} from './selection';
import type {Book,Settings,Mark,SelectionInfo,ReaderMeta,ReaderControl,SearchHit} from './types';
pdfjs.GlobalWorkerOptions.workerSrc=pdfWorker;
function flattenToc(items:any[],depth=0):ReaderMeta['toc'] {return items.flatMap(item=>[{label:item.label?.trim()||item.title||'章节',href:item.href||'',depth},...flattenToc(item.subitems||[],depth+1)]);}
interface Props {book:Book;settings:Settings;notes:Mark[];speechText:string;zoom:number;control:React.MutableRefObject<ReaderControl|null>;onNavigate:()=>void;onMeta:(m:ReaderMeta)=>void;onProgress:(location:string|number,progress:number)=>void;onSelection:(s:SelectionInfo)=>void;onAnnotation:(mark:Mark)=>void;onError:(e:string)=>void;onTitle:(s:string)=>void}
export default function Reader(props:Props) {
  const {book,settings,control,onMeta,onProgress,onSelection,onError,onTitle}=props;
  const mount=useRef<HTMLDivElement>(null), current=useRef(props);current.current=props;
  const [busy,setBusy]=useState(true),[html,setHtml]=useState(''),[pdfDoc,setPdfDoc]=useState<pdfjs.PDFDocumentProxy|null>(null);
  const pdf=useRef<any>(null),epub=useRef<any>(null),rendition=useRef<any>(null),lastHover=useRef('');
  const container=useRef<HTMLDivElement>(null),hoverTimer=useRef<ReturnType<typeof setTimeout>|null>(null),initialLocation=useRef(book.location);
  const busyRef=useRef(busy);busyRef.current=busy;
  const wheelState=useRef({delta:0,last:0,turn:0}),ranges=useRef(new Map<string,Range>()),epubHighlights=useRef(new Set<string>()),selectionDocument=useRef<Document|null>(null);
  function wheelPage(event:WheelEvent){
    if(book.format!=='epub'||event.ctrlKey||Math.abs(event.deltaX)>Math.abs(event.deltaY)||!event.deltaY)return;
    event.preventDefault();const now=performance.now(),state=wheelState.current,direction=Math.sign(event.deltaY);if(busyRef.current||now-state.turn<500)return;
    if(now-state.last>180||Math.sign(state.delta)!==direction)state.delta=0;state.last=now;state.delta+=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?(container.current?.clientHeight||700):1);if(Math.abs(state.delta)<55)return;
    state.turn=now;state.delta=0;current.current.onNavigate();const r=rendition.current;if(r)void(direction>0?r.next():r.prev()).catch((e:Error)=>current.current.onError(e.message));
  }
  useEffect(()=>{const el=container.current;if(!el)return;el.addEventListener('wheel',wheelPage,{passive:false});return()=>el.removeEventListener('wheel',wheelPage);},[book.id]);
  function markText(){
    if(book.format==='pdf')return;
    const r=rendition.current;if(r){for(const cfi of epubHighlights.current)r.annotations.remove(cfi,'highlight');epubHighlights.current.clear();for(const mark of current.current.notes)if(mark.cfi){r.annotations.highlight(mark.cfi,{id:mark.id},()=>{const note=current.current.notes.find(n=>n.id===mark.id);if(note)current.current.onAnnotation(note);},'book-highlight',{fill:highlightFill(mark.color)||getPalette(current.current.settings).accent,'fill-opacity':'0.32','mix-blend-mode':current.current.settings.theme==='night'?'screen':'multiply'});epubHighlights.current.add(mark.cfi);}return;}
    const next=new Map<string,Range>();if(mount.current)for(const mark of current.current.notes){const range=annotationRange(mount.current,mark);if(range)next.set(mark.id,range);}ranges.current=next;paintHighlights(next,current.current.notes);
  }
  function locate(mark:Mark){textGo(mark.location);const range=ranges.current.get(mark.id),surface=container.current;if(range&&surface)surface.scrollTop+=range.getBoundingClientRect().top-surface.getBoundingClientRect().top-110;}
  function textGo(where:string|number){const el=container.current;if(!el)return;if(typeof where==='number'||/^\d+(\.\d+)?$/.test(where)){el.scrollTop=Number(where);return;}const found=mount.current?.querySelector('#'+CSS.escape(where.replace(/^#/,'')));found?.scrollIntoView({behavior:'smooth',block:'start'});}
  useEffect(()=>{
    let alive=true;setBusy(true);setHtml('');setPdfDoc(null);initialLocation.current=book.location;
    window.mem.readBook(book.id).then(async data=>{
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
        r.hooks.content.register((contents:any)=>{contents.document.addEventListener('wheel',wheelPage,{passive:false});contents.document.addEventListener('keydown',(event:KeyboardEvent)=>{if(!event.defaultPrevented&&!event.isComposing&&event.altKey&&event.key.toLowerCase()==='s'&&!contents.document.activeElement?.closest('input,textarea,[contenteditable]')){event.preventDefault();selectionDocument.current=contents.document;selectSentence();}});contents.document.addEventListener('mousemove',(event:MouseEvent)=>hoverWord(contents.document,event.clientX,event.clientY,contents.document.body,range=>contents.cfiFromRange(range)));});
        r.on('selected',(cfi:string,contents:any)=>{const selection=selectionFromDoc(contents.document,contents.document.body.innerText,cfi,cfi);if(selection){selectionDocument.current=contents.document;current.current.onSelection(selection);}});
        r.on('relocated',(loc:any)=>{if(!alive)return;current.current.onProgress(loc.start.cfi,b.locations.length()?b.locations.percentageFromCfi(loc.start.cfi):((loc.start.index||0)/Math.max(1,(b.spine as any).spineItems.length)));current.current.onMeta({index:loc.start.displayed.page,count:loc.start.displayed.total,toc:flattenToc(navigation.toc)});});
        const colors=getPalette(current.current.settings);
        r.themes.default({'body':{'font-family':fontStack(settings.readingFont,settings.fontFamily==='serif'),'font-size':settings.fontSize+'px','line-height':String(settings.lineHeight),color:colors.readingText,background:colors.paper,padding:'24px 44px !important'},'body *':{'font-family':'inherit !important'},'p':{'margin-bottom':'1em'},'a':{color:colors.accentText},'::selection':{background:colors.selection}});
        r.themes.fontSize(settings.fontSize+'px');await r.display(book.location||undefined);
        if(!alive)return;
        control.current={prev:()=>r.prev(),next:()=>r.next(),go:where=>r.display(String(where)),getText:()=>r.getContents().map((c:any)=>c.document.body.innerText).join('\n'),
          nextText:async()=>{const loc=r.currentLocation();const next=(b.spine as any).spineItems[(loc.start.index||0)+1];if(!next)return null;await r.display(next.href);return r.getContents().map((c:any)=>c.document.body.innerText).join('\n');},
          peekNextText:async()=>{const loc=r.currentLocation();const next=(b.spine as any).spineItems[(loc.start.index||0)+1];if(!next)return null;await next.load(b.load.bind(b));const text=next.document?.body?.textContent||null;next.unload();return text;},
          highlight:markText,selectSentence,locate:mark=>void r.display(mark.cfi||String(mark.location)),
          search:async q=>{const hits:SearchHit[]=[];if(!q)return hits;for(const item of (b.spine as any).spineItems){await item.load(b.load.bind(b));for(const hit of item.find(q))hits.push({label:'章节 '+(item.index+1),location:hit.cfi,excerpt:hit.excerpt});item.unload();if(hits.length>=80)break;}return hits.slice(0,80);}};
        markText();
      }else{
        let value=data.html||data.text||'';
        if(book.format==='txt')value=value.split(/\n\s*\n/).map(t=>'<p>'+t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')+'</p>').join('');
        if(book.format==='md')value=await marked(value);
        const clean=documentHtml(value,data.resources);
        setHtml(clean);
        control.current={prev:()=>container.current?.scrollBy({top:-500,behavior:'smooth'}),next:()=>container.current?.scrollBy({top:500,behavior:'smooth'}),go:textGo,getText:()=>mount.current?.innerText||'',nextText:async()=>null,highlight:markText,selectSentence,locate,
          search:async q=>{const text=mount.current?.innerText||'';const hits:SearchHit[]=[];let at=0;while(q && (at=text.toLocaleLowerCase().indexOf(q.toLocaleLowerCase(),at))>=0&&hits.length<80){const proportion=at/Math.max(1,text.length);hits.push({label:'匹配 '+(hits.length+1),location:proportion*Math.max(0,(container.current?.scrollHeight||0)-(container.current?.clientHeight||0)),excerpt:text.slice(Math.max(0,at-60),at+140)});at+=q.length;}return hits;}};
      }
      if(alive)setBusy(false);
    }).catch(error=>{if(alive){setBusy(false);onError('文档无法打开：'+error.message);}});
    return()=>{alive=false;clearHighlights();epubHighlights.current.clear();if(hoverTimer.current)clearTimeout(hoverTimer.current);control.current=null;pdf.current?.destroy();pdf.current=null;rendition.current?.destroy();rendition.current=null;epub.current?.destroy();epub.current=null;};
  },[book.id]);
  useEffect(()=>{
    if(!html||!mount.current)return;
    const headings=[...mount.current.querySelectorAll('h1,h2,h3')];
    const toc=headings.map((el,i)=>{el.id=el.id||'section-'+i;return {label:el.textContent||'章节',href:el.id,depth:Number(el.tagName.slice(1))-1};});
    onMeta({index:1,count:1,toc});
    if(container.current)container.current.scrollTop=Number(initialLocation.current)||0;
    markText();
  },[html]);
  useEffect(()=>{markText();},[props.notes]);
  useEffect(()=>{
    const r=rendition.current;if(!r)return;const colors=getPalette(settings);
    r.themes.default({'body':{color:colors.readingText,background:colors.paper,'font-family':fontStack(settings.readingFont,settings.fontFamily==='serif'),'line-height':String(settings.lineHeight),padding:'24px 44px !important'},'body *':{'font-family':'inherit !important'},'p':{'margin-bottom':'1em'},'a':{color:colors.accentText},'::selection':{background:colors.selection}});r.themes.fontSize(settings.fontSize+'px');
  },[settings.theme,settings.colorThemes,settings.fontSize,settings.fontFamily,settings.readingFont,settings.lineHeight]);
  useEffect(()=>{
    const mountEl=mount.current;if(!mountEl)return;
    for(const el of mountEl.querySelectorAll('.speaking'))el.classList.remove('speaking');
    if(!props.speechText)return;
    const blocks=mountEl.querySelectorAll('p,li,h1,h2,h3,blockquote');const found=[...blocks].find(el=>el.textContent?.replace(/\s+/g,' ').includes(props.speechText));
    if(found){found.classList.add('speaking');found.scrollIntoView({behavior:'smooth',block:'center'});}
  },[props.speechText]);
  function selectSentence(){
    const doc=selectionDocument.current||document,range=selectWholeSentence(doc);if(!range)return;
    const contents=rendition.current?.getContents().find((item:any)=>item.document===doc),cfi=contents?.cfiFromRange(range);
    const info=selectionFromDoc(doc,mount.current?.innerText||'',cfi||container.current?.scrollTop||0,cfi);if(info)current.current.onSelection(info);
  }
  function onMouseUp(event:React.MouseEvent){
    if(book.format==='epub'||book.format==='pdf')return;const sel=window.getSelection();if(!sel?.anchorNode||!mount.current?.contains(sel.anchorNode))return;
    if(sel.isCollapsed){const id=rangeAtPoint(ranges.current,event.clientX,event.clientY),mark=current.current.notes.find(n=>n.id===id);if(mark)current.current.onAnnotation(mark);return;}
    const info=selectionFromDoc(document,mount.current?.innerText||'',container.current?.scrollTop||0);if(info){selectionDocument.current=document;onSelection(info);}
  }
  function hoverWord(doc:Document,x:number,y:number,scope:Element,cfiFor?:(range:Range)=>string){
    if(hoverTimer.current)clearTimeout(hoverTimer.current);
    if(!current.current.settings.hoverTranslate||doc.getSelection()?.toString())return;
    hoverTimer.current=setTimeout(()=>{
      if(!current.current.settings.hoverTranslate)return;
      const caret=(doc as any).caretRangeFromPoint(x,y) as Range|null;if(!caret||caret.startContainer.nodeType!==3||!scope.contains(caret.startContainer))return;
      const text=caret.startContainer.textContent||'',offset=caret.startOffset;const seg=new Intl.Segmenter(/[\u3400-\u9fff]/.test(text)?'zh':'en',{granularity:'word'});
      const word=[...seg.segment(text)].find(s=>s.isWordLike&&offset>=s.index&&offset<s.index+s.segment.length);if(!word)return;
      const range=doc.createRange();range.setStart(caret.startContainer,word.index);range.setEnd(caret.startContainer,word.index+word.segment.length);
      const root=caret.startContainer.parentElement?.closest('[data-annotation-root],.textLayer,.prose')||(cfiFor?scope:null);if(!root)return;
      const anchor=selectionStart(root,range),contextRoot=caret.startContainer.parentElement?.closest('p,li')||root,contextAnchor=selectionStart(contextRoot,range);
      const context=sentenceFor(contextAnchor.text,word.segment,contextAnchor.start);
      const cfi=cfiFor?.(range),location=cfi||(book.format==='pdf'?Number(caret.startContainer.parentElement?.closest<HTMLElement>('[data-pdf-page]')?.dataset.pdfPage)||1:container.current?.scrollTop||0),key=[location,anchor.start,word.segment,context].join('|');
      if(lastHover.current===key)return;lastHover.current=key;
      current.current.onSelection({text:word.segment,context,start:anchor.start,location,cfi,kind:'word'});
    },700);
  }
  function onMouseMove(e:React.MouseEvent){if(book.format!=='epub'&&container.current)hoverWord(document,e.clientX,e.clientY,container.current);}
  function onScroll(){if(book.format==='epub'||book.format==='pdf')return;const el=container.current;if(el)onProgress(el.scrollTop,el.scrollTop/Math.max(1,el.scrollHeight-el.clientHeight));}
  return <div className={'reader-surface '+(book.format==='epub'?'epub-surface':'')} ref={container} onScroll={onScroll} onMouseUp={onMouseUp} onMouseMove={onMouseMove}>
    {busy&&<div className="reader-loading"><span className="spinner"/>正在打开文档…</div>}
    {book.format==='pdf'?pdfDoc&&<PdfDocument doc={pdfDoc} book={book} settings={settings} zoom={props.zoom} notes={props.notes} speechText={props.speechText} surface={container} control={control} onMeta={onMeta} onProgress={onProgress} onSelection={onSelection} onAnnotation={props.onAnnotation} onNavigate={props.onNavigate} onError={onError}/>:<div ref={mount} className={book.format==='epub'?'epub-document':'prose'} style={book.format==='epub'||book.format==='pdf'&&!settings.pdfTextMode?undefined:{fontSize:settings.fontSize,lineHeight:settings.lineHeight,maxWidth:settings.contentWidth,fontFamily:fontStack(settings.readingFont,settings.fontFamily==='serif')}} dangerouslySetInnerHTML={html?{__html:html}:undefined}/>}
  </div>;
}
