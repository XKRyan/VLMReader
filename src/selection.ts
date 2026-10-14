import type {SelectionInfo} from './types';
import {selectionStart,normalizedText,textIndex,annotationRange} from './annotations';
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
export function selectWholeSentence(doc:Document):Range|null{
  const selection=doc.getSelection();if(!selection?.rangeCount||selection.isCollapsed)return null;
  const range=selection.getRangeAt(0),element=range.startContainer.parentElement;
  const root=element?.closest('[data-annotation-root],.textLayer,.prose')||doc.body;
  if(!root?.contains(range.endContainer))return null;
  const block=element?.closest('p,li,h1,h2,h3,h4,blockquote,td'),scope=block?.contains(range.endContainer)?block:root;
  const index=textIndex(scope),anchor=selectionStart(scope,range),length=normalizedText(selection.toString()).length;
  const sentences=[...new Intl.Segmenter(/[\u3400-\u9fff]/.test(index.text)?'zh':'en',{granularity:'sentence'}).segment(index.text)];
  const first=sentences.find(item=>anchor.start<item.index+item.segment.length),last=sentences.find(item=>anchor.start+length<=item.index+item.segment.length);
  if(!first||!last)return null;
  const text=index.text.slice(first.index,last.index+last.segment.length).trim(),start=first.index+first.segment.length-first.segment.trimStart().length;
  const next=annotationRange(scope,{text,start});if(!next)return null;
  selection.removeAllRanges();selection.addRange(next);return next;
}
