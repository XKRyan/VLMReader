import type {SelectionInfo} from './types';
import {selectionStart} from './annotations';
import {sentenceFor} from './selection';
// The word under a point as a word selection; null over whitespace, punctuation, controls or outside text.
export function wordAt(doc:Document,x:number,y:number,scope:Element,location:(range:Range)=>string|number,cfiFor?:(range:Range)=>string):{info:SelectionInfo;range:Range}|null{
  const caret=(doc as any).caretRangeFromPoint?.(x,y) as Range|null;
  if(!caret||caret.startContainer.nodeType!==3||!scope.contains(caret.startContainer))return null;
  const node=caret.startContainer,text=node.textContent||'',offset=caret.startOffset;
  const word=[...new Intl.Segmenter(/[\u3400-\u9fff]/.test(text)?'zh':'en',{granularity:'word'}).segment(text)].find(part=>part.isWordLike&&offset>=part.index&&offset<=part.index+part.segment.length);
  if(!word)return null;
  const range=doc.createRange();range.setStart(node,word.index);range.setEnd(node,word.index+word.segment.length);
  // caretRangeFromPoint snaps to the nearest character, so require the point to be on the word itself.
  if(![...range.getClientRects()].some(rect=>x>=rect.left-1&&x<=rect.right+1&&y>=rect.top-1&&y<=rect.bottom+1))return null;
  const root=node.parentElement?.closest('[data-annotation-root],.textLayer,.prose')||(cfiFor?scope:null);if(!root)return null;
  const anchor=selectionStart(root,range),contextRoot=node.parentElement?.closest('p,li')||root,contextAnchor=selectionStart(contextRoot,range);
  const cfi=cfiFor?.(range);
  return {range,info:{text:word.segment,context:sentenceFor(contextAnchor.text,word.segment,contextAnchor.start),start:anchor.start,location:cfi||location(range),cfi,kind:'word'}};
}
// Clicks on links, buttons, form controls and annotation markers keep their own behaviour.
export function interactiveTarget(target:EventTarget|null){
  return !!(target as Element|null)?.closest?.('a,button,input,textarea,select,label,[role=button],[data-reader-annotations]');
}
