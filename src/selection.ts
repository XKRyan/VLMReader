import type {SelectionInfo} from './types';
import {selectionStart,normalizedText} from './annotations';
export function sentenceFor(text:string,selected:string,offset?:number){
  text=normalizedText(text);const at=offset??text.indexOf(normalizedText(selected));if(at<0)return text.slice(0,12000);
  const segments=[...new Intl.Segmenter(/[\u3400-\u9fff]/.test(text)?'zh':'en',{granularity:'sentence'}).segment(text)];
  const first=segments.findIndex(s=>at>=s.index&&at<s.index+s.segment.length),end=at+selected.length;let result='';
  for(let i=Math.max(0,first);i<segments.length;i++){result+=segments[i].segment;if(segments[i].index+segments[i].segment.length>=end)break;}return result.trim()||text.slice(0,12000);
}
export function selectionFromDoc(doc:Document,fallback:string,location:string|number,cfi?:string):SelectionInfo|null{
  const selection=doc.getSelection();if(!selection?.rangeCount)return null;const text=normalizedText(selection.toString());if(!text||text.length>5000)return null;
  const range=selection.getRangeAt(0),node=range.startContainer,el=node.nodeType===1?node as Element:node.parentElement;
  const root=el?.closest('[data-annotation-root],.textLayer,.prose')||doc.body;if(!root)return null;
  const anchor=selectionStart(root,range),block=el?.closest('p,li,h1,h2,h3,h4,blockquote,td');
  const contextAnchor=block&&block.contains(range.endContainer)?selectionStart(block,range):anchor;
  return {text,context:sentenceFor(contextAnchor.text||fallback||text,text,contextAnchor.start),start:anchor.start,location,cfi};
}
