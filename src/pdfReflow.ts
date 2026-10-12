import type {PDFPageProxy} from 'pdfjs-dist';

type Content=Awaited<ReturnType<PDFPageProxy['getTextContent']>>;
type Operators=Awaited<ReturnType<PDFPageProxy['getOperatorList']>>;
type Rect=[number,number,number,number];
type Matrix=number[];
export interface PdfRun{text:string;color?:string;background?:string}
export interface PdfParagraph{kind:'text';runs:PdfRun[];top:number;bottom:number}
export interface PdfFigure{kind:'figure';rect:Rect;polygons?:number[][][];top:number;bottom:number;src?:string}
export interface PdfReflow{blocks:(PdfParagraph|PdfFigure)[];width:number;height:number}
interface Region{rect:Rect;color:string;opacity:number}
interface Glyph{char:string;color:string;width:number}
interface Graphic{rect:Rect;polygons?:number[][][]}
interface Line{runs:PdfRun[];top:number;bottom:number;x:number;height:number}
const identity=[1,0,0,1,0,0];
function multiply(a:Matrix,b:Matrix):Matrix{return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];}
function point(m:Matrix,x:number,y:number){return [m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];}
function bounds(points:number[][]):Rect{return [Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];}
function transformRect(r:Rect,m:Matrix){return bounds([point(m,r[0],r[1]),point(m,r[2],r[1]),point(m,r[0],r[3]),point(m,r[2],r[3])]);}
function inside(r:Rect,x:number,y:number,pad=0){return x>=r[0]-pad&&x<=r[2]+pad&&y>=r[1]-pad&&y<=r[3]+pad;}
function overlap(a:Rect,b:Rect,pad=0){return a[0]<=b[2]+pad&&a[2]+pad>=b[0]&&a[1]<=b[3]+pad&&a[3]+pad>=b[1];}
function inPolygon(points:number[][],x:number,y:number){let hit=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
function rgb(value:unknown):string|undefined{
  if(typeof value==='string'&&/^#[\da-f]{6}$/i.test(value))return value.toLowerCase();
  if(Array.isArray(value)||ArrayBuffer.isView(value)){const v=Array.from(value as ArrayLike<number>);if(v.length>=3)return '#'+v.slice(0,3).map(n=>Math.round(Math.max(0,Math.min(255,n))).toString(16).padStart(2,'0')).join('');}
}
function ink(color:string){return color==='#000000'?undefined:color;}
function background(color:string,opacity:number){return '#'+[1,3,5].map(at=>Math.round(parseInt(color.slice(at,at+2),16)*opacity+255*(1-opacity)).toString(16).padStart(2,'0')).join('');}
function highlightedInk(color:string){const c=[1,3,5].map(at=>parseInt(color.slice(at,at+2),16));return c[0]*.2126+c[1]*.7152+c[2]*.0722<125?'#ffffff':'#171923';}
function nonGray(color:string){const c=[1,3,5].map(at=>parseInt(color.slice(at,at+2),16));return Math.max(...c)-Math.min(...c)>25;}
function pushRun(runs:PdfRun[],run:PdfRun){if(!run.text)return;const last=runs.at(-1);if(last&&last.color===run.color&&last.background===run.background)last.text+=run.text;else runs.push({...run});}
function joiningSpace(before:string,after:string){return before&&!/\s$/.test(before)&&!/^\s/.test(after)&&!(/[\u3400-\u9fff]$/.test(before)&&/^[\u3400-\u9fff]/.test(after))?' ':'';}

/** All geometry uses the page viewport, so crop boxes and rotated pages share
 * the same coordinates. The PDF stays unchanged; only the reading view reflows. */
export function buildPdfReflow(content:Content,operators:Operators,annotations:Record<string,unknown>[],viewport:{width:number;height:number;transform:Matrix},ops:Record<string,number>):PdfReflow{
  const paints:Region[]=[],graphics:Graphic[]=[],glyphs:Glyph[]=[],spaceWidths=new Map<string,number>();
  let state={matrix:identity,fill:'#000000',opacity:1,lineWidth:1,font:''};const stack:typeof state[]=[];
  function save(){stack.push({...state,matrix:[...state.matrix]});}
  function restore(){state=stack.pop()||{matrix:identity,fill:'#000000',opacity:1,lineWidth:1,font:''};}
  function geometry(rect:Rect,matrix=state.matrix){return transformRect(rect,multiply(viewport.transform,matrix));}
  function image(matrix=state.matrix){const m=multiply(viewport.transform,matrix),polygon=[point(m,0,0),point(m,1,0),point(m,1,1),point(m,0,1)];graphics.push({rect:bounds(polygon),polygons:[polygon]});}
  for(let i=0;i<operators.fnArray.length;i++){
    const op=operators.fnArray[i],args=operators.argsArray[i]||[];
    if(op===ops.save)save();else if(op===ops.restore)restore();
    else if(op===ops.transform)state.matrix=multiply(state.matrix,args);
    else if(op===ops.paintFormXObjectBegin){save();if(args[0])state.matrix=multiply(state.matrix,args[0]);}
    else if(op===ops.paintFormXObjectEnd)restore();
    else if(op===ops.beginGroup){save();if(args[0]?.matrix)state.matrix=multiply(state.matrix,args[0].matrix);}
    else if(op===ops.endGroup)restore();
    else if(op===ops.setLineWidth)state.lineWidth=Number(args[0])||1;
    else if(op===ops.setFont)state.font=String(args[0]);
    else if(op===ops.setFillRGBColor)state.fill=rgb(args[0])||'#000000';
    else if(op===ops.setFillGray){const byte=Math.round(args[0]*255);state.fill=rgb([byte,byte,byte])!;}
    else if(op===ops.setGState){for(const [key,value] of args[0]||[])if(key==='ca')state.opacity=Math.max(0,Math.min(1,Number(value)));}
    else if(op===ops.showText||op===ops.showSpacedText){
      for(const glyph of args[0]||[]){if(!glyph||typeof glyph!=='object'||!glyph.unicode)continue;if(glyph.isSpace&&glyph.width>0)spaceWidths.set(state.font,glyph.width);const chars=(glyph.unicode as string).normalize('NFKC').split('');for(const char of chars)if(!/\s/.test(char))glyphs.push({char,color:state.fill,width:Math.abs(glyph.width||500)/chars.length});}
    }else if(op===ops.paintImageXObject||op===ops.paintInlineImageXObject||op===ops.paintImageMaskXObject||op===ops.paintSolidColorImageMask)image();
    else if(op===ops.paintImageXObjectRepeat||op===ops.paintImageMaskXObjectRepeat){const positions=args.at(-1),mask=op===ops.paintImageMaskXObjectRepeat;if(positions)for(let at=0;at<positions.length;at+=2)image(multiply(state.matrix,[args[1],mask?args[2]:0,mask?args[3]:0,mask?args[4]:args[2],positions[at],positions[at+1]]));}
    else if(op===ops.paintInlineImageXObjectGroup){for(const entry of args[1]||[])image(multiply(state.matrix,entry.transform));}
    else if(op===ops.paintImageMaskXObjectGroup){for(const entry of args[0]||[])image(multiply(state.matrix,entry.transform));}
    else if(op===ops.constructPath&&args[2]){
      const rect=geometry(Array.from(args[2]) as Rect),filled=[ops.fill,ops.eoFill,ops.fillStroke,ops.eoFillStroke,ops.closeFillStroke,ops.closeEOFillStroke].includes(args[0]);
      if(filled&&nonGray(state.fill)&&state.opacity>0)paints.push({rect,color:state.fill,opacity:state.opacity});
      // Keep vector illustrations too. Thin rules and page-size backgrounds are
      // decoration, rather than separate figures. Highlight shapes are removed below.
      if(!filled&&args[0]!==ops.endPath){const pad=state.lineWidth*Math.max(Math.hypot(state.matrix[0],state.matrix[1]),Math.hypot(state.matrix[2],state.matrix[3]))/2;rect[0]-=pad;rect[1]-=pad;rect[2]+=pad;rect[3]+=pad;}
      const w=rect[2]-rect[0],h=rect[3]-rect[1];if(args[0]!==ops.endPath&&w>0&&h>0&&w*h<viewport.width*viewport.height*.8)graphics.push({rect});
    }
  }
  const items=content.items.filter((item):item is Extract<Content['items'][number],{str:string}>=>'str' in item);
  if(!items.some(item=>item.str.trim()))return {blocks:[{kind:'figure',rect:[0,0,viewport.width,viewport.height],top:0,bottom:viewport.height}],width:viewport.width,height:viewport.height};
  const boxes=items.filter(item=>item.str.trim()).map(item=>{const m=multiply(viewport.transform,item.transform),h=Math.hypot(m[2],m[3])||item.height;return {left:m[4],right:m[4]+item.width,y:m[5]-h*.35,height:h};});
  const highlights=paints.filter(p=>boxes.some(box=>p.rect[3]-p.rect[1]<=box.height*3&&p.rect[0]<box.right&&p.rect[2]>box.left&&inside(p.rect,Math.max(p.rect[0],Math.min(p.rect[2],(box.left+box.right)/2)),box.y,1)));
  for(const annotation of annotations){
    if(annotation.subtype!=='Highlight'||annotation.hidden||annotation.invisible||(Number(annotation.annotationFlags)||0)&35)continue;
    const color=rgb(annotation.color)||'#ffff00',opacity=typeof annotation.opacity==='number'?Math.max(0,Math.min(1,annotation.opacity)):.4;
    if(!opacity)continue;
    const quads=annotation.quadPoints as ArrayLike<number>|undefined;
    if(quads?.length){for(let i=0;i+7<quads.length;i+=8){const points=[];for(let j=0;j<8;j+=2)points.push(point(viewport.transform,quads[i+j],quads[i+j+1]));highlights.push({rect:bounds(points),color,opacity});}}
    else if(Array.isArray(annotation.rect))highlights.push({rect:transformRect(annotation.rect as Rect,viewport.transform),color,opacity});
  }
  let figures=graphics.filter(({rect})=>!highlights.some(h=>h.rect.every((n,i)=>Math.abs(n-rect[i])<.1))&&rect.every(Number.isFinite));
  figures=figures.map(f=>({...f,rect:[Math.max(0,f.rect[0]),Math.max(0,f.rect[1]),Math.min(viewport.width,f.rect[2]),Math.min(viewport.height,f.rect[3])] as Rect})).filter(({rect:r})=>r[2]>r[0]&&r[3]>r[1]);
  // Join tiles and overlapping vector shapes into one illustration. Cap work
  // on path-heavy pages; the original view remains available for exact layout.
  if(figures.length>1000)figures=[{rect:bounds(figures.flatMap(({rect:r})=>[[r[0],r[1]],[r[2],r[3]]]))}];
  for(let i=0;i<figures.length;i++){for(let j=i+1;j<figures.length;j++){const a=figures[i],b=figures[j];if(overlap(a.rect,b.rect,2)){figures[i]={rect:bounds([[a.rect[0],a.rect[1]],[a.rect[2],a.rect[3]],[b.rect[0],b.rect[1]],[b.rect[2],b.rect[3]]]),polygons:a.polygons&&b.polygons?[...a.polygons,...b.polygons]:undefined};figures.splice(j,1);i=-1;break;}}}
  figures=figures.filter(({rect:r})=>(r[2]-r[0]>=12||r[3]-r[1]>=12)&&r[2]-r[0]>=3&&r[3]-r[1]>=3);
  const stream=glyphs.map(g=>g.char).join('');let cursor=0;const lines:Line[]=[];let line:Line|undefined,lastEnd=0;
  for(const item of items){
    const chars=Array.from(item.str),key=item.str.normalize('NFKC').replace(/\s/g,''),at=key?stream.indexOf(key,cursor):-1;
    const matching=at>=cursor&&at-cursor<80;let glyphAt=at;
    const weighted=chars.map(char=>{const norm=char.normalize('NFKC').replace(/\s/g,'');let width=/\s/.test(char)?spaceWidths.get(item.fontName)||250:500,color=matching?ink(glyphs[Math.max(at,glyphAt-1)]?.color||'#000000'):undefined;
      if(matching&&norm){width=0;color=ink(glyphs[glyphAt]?.color||'#000000');for(let i=0;i<norm.length;i++){width+=glyphs[glyphAt]?.width||500;glyphAt++;}}return {char,width,color};});if(matching)cursor=at+key.length;
    const m=multiply(viewport.transform,item.transform),height=Math.hypot(m[2],m[3])||item.height||12,base=Math.hypot(m[0],m[1])||1,ux=m[0]/base,uy=m[1]/base,vx=m[2]/height,vy=m[3]/height;
    const top=m[5]-height*.8,bottom=m[5]+height*.2;
    if(!line||Math.abs(line.bottom-bottom)>height*.4||m[4]-lastEnd>height*6){line={runs:[],top,bottom,x:m[4],height};lines.push(line);lastEnd=m[4];}
    if(item.str){const existing=line.runs.map(r=>r.text).join('');if(m[4]-lastEnd>height*.15)pushRun(line.runs,{text:joiningSpace(existing,item.str)});}
    const total=weighted.reduce((sum,c)=>sum+c.width,0)||1;let advance=0;
    for(const char of weighted){const w=item.width*char.width/total,x=m[4]+ux*(advance+w/2)+vx*height*.35,y=m[5]+uy*(advance+w/2)+vy*height*.35;advance+=w;
      // Text drawn inside a figure belongs to its bitmap, keeping diagram labels
      // in place without repeating them in the reflowed paragraphs.
      if(figures.some(({rect,polygons})=>inside(rect,x,y)&&(!polygons||polygons.some(p=>inPolygon(p,x,y)))))continue;
      const highlight=highlights.filter(h=>inside(h.rect,x,y,.6)).at(-1),fill=highlight?background(highlight.color,highlight.opacity):undefined;pushRun(line.runs,{text:char.char,color:char.color||(fill?highlightedInk(fill):undefined),background:fill});
    }
    line.top=Math.min(line.top,top);line.bottom=Math.max(line.bottom,bottom);lastEnd=m[4]+item.width;if(item.hasEOL)line=undefined;
  }
  const readingLines=lines.filter(l=>l.runs.some(r=>r.text.trim())).sort((a,b)=>a.top-b.top||a.x-b.x);
  const gaps=readingLines.slice(1).map((l,i)=>l.top-readingLines[i].top).filter(g=>g>2).sort((a,b)=>a-b),normal=gaps[Math.floor(gaps.length/2)]||18;
  const blocks:PdfReflow['blocks']=[];let paragraph:PdfParagraph|undefined,lastLine:Line|undefined;
  for(const l of readingLines){
    const previous=lastLine,figureBetween=previous&&figures.some(({rect:r})=>r[1]>=previous.bottom-2&&r[3]<=l.top+2);
    if(!paragraph||!lastLine||l.top-lastLine.top>normal*1.5||l.height/lastLine.height>1.3||lastLine.height/l.height>1.3||figureBetween){paragraph={kind:'text',runs:[],top:l.top,bottom:l.bottom};blocks.push(paragraph);}
    else pushRun(paragraph.runs,{text:joiningSpace(paragraph.runs.map(r=>r.text).join(''),l.runs[0].text)});
    for(const run of l.runs)pushRun(paragraph.runs,run);paragraph.bottom=l.bottom;lastLine=l;
  }
  blocks.push(...figures.map(f=>({kind:'figure' as const,...f,top:f.rect[1],bottom:f.rect[3]})));blocks.sort((a,b)=>a.top-b.top);
  return {blocks,width:viewport.width,height:viewport.height};
}

/** Crop the original renderer instead of decoding image objects: transparency,
 * masks, rotations and labels therefore survive exactly as painted in the PDF. */
export async function renderPdfFigures(page:PDFPageProxy,model:PdfReflow):Promise<string[]>{
  const figures=model.blocks.filter((b):b is PdfFigure=>b.kind==='figure');if(!figures.length)return [];
  const scale=Math.min(2.5,2000/model.width,2800/model.height),viewport=page.getViewport({scale,rotation:0}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  const urls:string[]=[];
  try{await page.render({canvas,canvasContext:canvas.getContext('2d')!,viewport}).promise;
    for(const figure of figures){const [x0,y0,x1,y1]=figure.rect,x=Math.max(0,Math.floor((x0-1)*scale)),y=Math.max(0,Math.floor((y0-1)*scale)),w=Math.min(canvas.width-x,Math.ceil((x1-x0+2)*scale)),h=Math.min(canvas.height-y,Math.ceil((y1-y0+2)*scale));
      const crop=document.createElement('canvas');crop.width=Math.max(1,w);crop.height=Math.max(1,h);const ctx=crop.getContext('2d')!;
      if(figure.polygons){ctx.beginPath();for(const polygon of figure.polygons){polygon.forEach((p,i)=>{const px=p[0]*scale-x,py=p[1]*scale-y;if(i)ctx.lineTo(px,py);else ctx.moveTo(px,py);});ctx.closePath();}ctx.clip();}
      ctx.drawImage(canvas,x,y,w,h,0,0,w,h);
      const blob=await new Promise<Blob>((resolve,reject)=>crop.toBlob(blob=>blob?resolve(blob):reject(Error('PDF image could not be rendered.')),'image/png'));
      figure.src=URL.createObjectURL(blob);urls.push(figure.src);crop.width=crop.height=0;
    }return urls;
  }catch(error){urls.forEach(url=>URL.revokeObjectURL(url));throw error;}finally{canvas.width=canvas.height=0;}
}
