import {t} from './i18n';
let serial:Promise<unknown>=Promise.resolve();
const svgURL=(svg:string)=>'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
function legacySequence(source:string){
  return 'sequenceDiagram\n'+source.split('\n').map(line=>{
    if(/^\s*Title:/i.test(line))return 'title '+line.replace(/^\s*Title:\s*/i,'');
    return line.replace(/^(\s*[^:>]+?)\s*(--?>|--?>>)([^:]+):/,(_all,a,arrow,b)=>a.trim()+(arrow.startsWith('--')?'-->>':'->>')+b.trim()+':');
  }).join('\n');
}
async function diagram(kind:string,source:string,bookId:string){
  if(source.length>100000)throw Error(t('图表过大，请查看源码'));
  if(kind==='mermaid'||kind==='sequence'){
    const {default:mermaid}=await import('mermaid');
    mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'default',suppressErrorRendering:true,maxTextSize:100000,maxEdges:1000,flowchart:{htmlLabels:false},fontFamily:'Arial, sans-serif'});
    const result=await mermaid.render('md-diagram-'+crypto.randomUUID(),kind==='sequence'?legacySequence(source):source);return svgURL(result.svg);
  }
  if(kind==='vega'||kind==='vega-lite'){
    const vega=await import('vega'),{expressionInterpreter}=await import('vega-interpreter'),{dsvFormat}=await import('d3-dsv');
    // d3's object-row parser generates functions, which the reader's CSP blocks.
    // Parse rows without evaluation, then map the header to plain data objects.
    for(const [name,delimiter] of [['csv',','],['tsv','\t'],['dsv','']]){
      const parse=(data:unknown,format:any={})=>{const rows=dsvFormat(delimiter||format.delimiter||',').parseRows(String(data)),header=format.header||rows.shift()||[];return Object.assign(rows.map((row:string[])=>Object.fromEntries(header.map((key:string,i:number)=>[key,row[i]??'']))),{columns:header});};
      parse.responseType='text';(vega as any).formats(name,parse);
    }
    let spec=JSON.parse(source);if(kind==='vega-lite')spec=(await import('vega-lite')).compile(spec).spec;
    const failures:Error[]=[];
    const loader={...vega.loader(),load:async(url:string)=>{try{return await window.mem.diagramData(bookId,source,url);}catch(error){failures.push(error as Error);throw error;}}};
    const view=new vega.View(vega.parse(spec,undefined,{ast:true}),{renderer:'none',loader,expr:expressionInterpreter} as any);
    try{await view.runAsync();if(failures.length)throw failures[0];const svg=svgURL(await view.toSVG());await window.mem.cacheDiagram(bookId,source,svg);return svg;}finally{view.finalize();}
  }
  if(kind==='flowchart'){
    const {default:flowchart}=await import('flowchart.js'),scratch=document.createElement('div');scratch.id='flow-'+crypto.randomUUID();scratch.dataset.ui='true';scratch.style.cssText='position:absolute;left:-100000px;top:0;pointer-events:none';document.body.append(scratch);
    try{const chart=flowchart.parse(source);chart.drawSVG(scratch.id,{'font-size':16,'line-width':2});const svg=scratch.querySelector('svg');if(!svg)throw Error('Invalid flowchart');return svgURL(new XMLSerializer().serializeToString(svg));}finally{scratch.remove();}
  }
  throw Error('Unsupported diagram');
}
/** Lazy resources never alter document text offsets, so saved annotations remain anchored. */
export function enhanceMarkdown(root:HTMLElement,bookId:string,onLayout:()=>void){
  let disposed=false;const cleanups:(()=>void)[]=[],pending=new Set<HTMLElement>();
  function status(parent:Element,text:string,action?:()=>void,label=t('重试')){
    const row=document.createElement('span');row.className='markdown-resource-status';row.dataset.ui='true';row.textContent=text;
    if(action){const button=document.createElement('button');button.textContent=label;button.onclick=action;row.append(button);}parent.append(row);return row;
  }
  function image(parent:Element,src:string,alt:string){const img=document.createElement('img');img.src=src;img.alt=alt;img.decoding='async';img.onload=onLayout;parent.prepend(img);}
  async function load(element:HTMLElement){
    if(disposed||pending.has(element))return;pending.add(element);
    let progress:HTMLElement|null=null;
    try{
      if(element instanceof HTMLImageElement){
        progress=status(element.parentElement!,t('正在加载图片…'));const src=await window.mem.remoteImage(bookId,element.dataset.remoteImage!);
        if(disposed)return;element.onload=onLayout;element.src=src;element.removeAttribute('data-remote-image');
      }else{
        const kind=element.dataset.diagramKind!,source=element.dataset.diagramSource!;
        progress=status(element,t('正在绘制图表…'));
        const src=kind==='plantuml'?await window.mem.remoteImage(bookId,source,true):await (serial=serial.catch(()=>{}).then(()=>disposed?'':diagram(kind,source,bookId))) as string;
        if(disposed)return;image(element,src,kind);element.dataset.rendered='true';
      }
    }catch(error){if(!disposed){status(element instanceof HTMLImageElement?element.parentElement!:element,t('无法加载：')+(error as Error).message,()=>{row.remove();void load(element);});const row=(element instanceof HTMLImageElement?element.parentElement!:element).lastElementChild!;}}
    finally{progress?.remove();pending.delete(element);if(!disposed)onLayout();}
  }
  const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);void load(entry.target as HTMLElement);}},{root:root.closest('.reader-surface'),rootMargin:'600px'});
  for(const element of root.querySelectorAll<HTMLElement>('img[data-remote-image],.markdown-diagram')){
    if(element.dataset.rendered==='true')continue;
    if(element.dataset.diagramKind==='plantuml'){
      if(element.querySelector('img'))continue;
      const row=status(element,t('PlantUML 在线渲染会将此图表源码发送至 plantuml.com。'),()=>{row.remove();void load(element);},t('加载图表'));
    }else observer.observe(element);
  }
  for(const img of root.querySelectorAll<HTMLImageElement>('img')){const resize=()=>onLayout();img.addEventListener('load',resize);cleanups.push(()=>img.removeEventListener('load',resize));if(img.dataset.missingImage)status(img.parentElement!,t('找不到图片：')+img.dataset.missingImage);}
  const resize=new ResizeObserver(onLayout);resize.observe(root);
  return()=>{disposed=true;observer.disconnect();resize.disconnect();cleanups.forEach(fn=>fn());};
}
