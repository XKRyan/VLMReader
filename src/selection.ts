import type {SelectionInfo} from './types';
import {selectionStart,normalizedText} from './annotations';
// Sentence segments, keeping titles such as "Mrs." with the sentence that follows them.
const ABBREVIATION=/\b(?:Mrs?|Ms|Dr|St|Sr|Jr|Prof|Mt|vs|e\.g|i\.e)\.\s*$/i;
export function sentences(text:string){
  const result:{index:number;segment:string}[]=[];
  for(const {index,segment} of new Intl.Segmenter(/[\u3400-\u9fff]/.test(text)?'zh':'en',{granularity:'sentence'}).segment(text)){const last=result.at(-1);if(last&&ABBREVIATION.test(last.segment))last.segment+=segment;else result.push({index,segment});}
  return result;
}
export function sentenceFor(text:string,selected:string,offset?:number){
  text=normalizedText(text);const at=offset??text.indexOf(normalizedText(selected));if(at<0)return text.slice(0,12000);
  const segments=sentences(text);
  const first=segments.findIndex(s=>at>=s.index&&at<s.index+s.segment.length),end=at+selected.length;let result='';
  for(let i=Math.max(0,first);i<segments.length;i++){result+=segments[i].segment;if(segments[i].index+segments[i].segment.length>=end)break;}return result.trim()||text.slice(0,12000);
}
export function selectionFromDoc(doc:Document,fallback:string,location:string|number,cfi?:string):SelectionInfo|null{
  const selection=doc.getSelection();if(!selection?.rangeCount)return null;let text=normalizedText(selection.toString());if(!text||text.length>5000)return null;
  const range=selection.getRangeAt(0),node=range.startContainer,el=node.nodeType===1?node as Element:node.parentElement;
  const root=el?.closest('[data-annotation-root],.textLayer,.prose')||doc.body;if(!root)return null;
  const hasMath=[...root.querySelectorAll('.katex')].some(math=>range.intersectsNode(math));
  const anchor=selectionStart(root,range,hasMath),block=el?.closest('p,li,h1,h2,h3,h4,blockquote,td');
  if(hasMath&&anchor.selectedText)text=normalizedText(anchor.selectedText);
  const contextAnchor=block&&block.contains(range.endContainer)?selectionStart(block,range):anchor;
  return {text,context:sentenceFor(contextAnchor.text||fallback||text,text,contextAnchor.start),start:anchor.start,location,cfi};
}
const BLOCKS='p,li,h1,h2,h3,h4,h5,h6,blockquote,td,pre,dd,dt';
// Text to read aloud from the sentence containing the selection to the end of root.
// Returns null when the selection is not inside a paragraph-like block.
export function textFromSelection(doc:Document,root:Element|null):string|null{
  const selection=doc.getSelection();if(!root||!selection?.rangeCount)return null;
  const range=selection.getRangeAt(0),node=range.startContainer;if(!root.contains(node))return null;
  const block=(node.nodeType===1?node as Element:node.parentElement)?.closest(BLOCKS);if(!block||!root.contains(block))return null;
  const head=doc.createRange(),tail=doc.createRange();head.selectNodeContents(block);head.setEnd(node,range.startOffset);tail.selectNodeContents(block);tail.setStart(node,range.startOffset);
  const before=head.toString(),last=sentences(before).at(-1)?.segment||'';
  const opening=/[.!?。！？]["'”’)）]?\s*$/.test(last)&&!ABBREVIATION.test(last)?'':last.trimStart();
  const later=[...root.querySelectorAll(BLOCKS)].filter(item=>!item.parentElement?.closest(BLOCKS)&&!item.contains(block)&&!!(block.compareDocumentPosition(item)&Node.DOCUMENT_POSITION_FOLLOWING));
  const text=[opening+tail.toString(),...later.map(item=>(item as HTMLElement).innerText||item.textContent||'')].join('\n');
  return normalizedText(text)?text:null;
}
