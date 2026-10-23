import type {Mark} from './types';
type Point={node:Text;start:number;end:number};
export const normalizedText=(text:string)=>text.replace(/\s+/g,' ').trim();
export function textIndex(root:Element){
  const points:Point[]=[],characters:string[]=[],walker=root.ownerDocument.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  let node:Node|null,lastBlock:Element|null=null,lastPoint:Point|null=null;
  function append(char:string,point:Point){if(/\s/.test(char)){char=' ';if(!characters.length||characters.at(-1)===' ')return;}characters.push(char);points.push(point);lastPoint=point;}
  while((node=walker.nextNode())){
    const text=node as Text,el=text.parentElement;if(!el||el.closest('script,style,[data-ui]'))continue;
    const block=el.closest('.textLayer span,p,li,h1,h2,h3,h4,blockquote,td,pre');
    if(lastBlock&&block!==lastBlock&&lastPoint)append(' ',lastPoint);lastBlock=block;
    for(let i=0;i<text.data.length;i++)append(text.data[i],{node:text,start:i,end:i+1});
  }
  if(characters.at(-1)===' '){characters.pop();points.pop();}
  return {text:characters.join(''),points};
}
export function selectionStart(root:Element,range:Range,includeSelection=false){const index=textIndex(root);const start=index.points.findIndex(point=>range.comparePoint(point.node,point.start)===0),end=includeSelection?index.points.findLastIndex(point=>range.comparePoint(point.node,point.end)===0):-1;return {text:index.text,start:Math.max(0,start),selectedText:includeSelection?index.text.slice(Math.max(0,start),end+1):undefined};}
export function annotationRange(root:Element,mark:Pick<Mark,'text'|'start'|'context'>):Range|null{
  const index=textIndex(root),needle=normalizedText(mark.text);if(!needle)return null;
  let at=typeof mark.start==='number'&&index.text.slice(mark.start,mark.start+needle.length)===needle?mark.start:-1;
  if(at<0&&mark.context){const contextAt=index.text.indexOf(normalizedText(mark.context));if(contextAt>=0)at=index.text.indexOf(needle,contextAt);}
  if(at<0)at=index.text.indexOf(needle);if(at<0||!index.points[at+needle.length-1])return null;
  const first=index.points[at],last=index.points[at+needle.length-1],range=root.ownerDocument.createRange();range.setStart(first.node,first.start);range.setEnd(last.node,last.end);return range;
}
export function rangeAtPoint(ranges:Map<string,Range>,x:number,y:number){let found:string|null=null,length=Infinity;for(const [id,range] of ranges){const size=range.toString().length;if(size>=length)continue;for(const rect of range.getClientRects())if(x>=rect.left&&x<=rect.right&&y>=rect.top&&y<=rect.bottom){found=id;length=size;break;}}return found;}
