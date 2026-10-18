import type {Entry,Notebook} from './types';
import {inNotebook,wordlistIds} from '../shared/review-policy.mjs';
// The learner's own unreviewed words (not word-list words) are underlined in the theme accent with a CSS highlight, so the page DOM is never changed.
const NAME='vlmreader-vocab',STYLE='vlmreader-vocab-style',LIMIT=8000;
const fold=(word:string)=>word.toLocaleLowerCase().replace(/’/g,"'");
export function unreviewedWords(entries:Entry[],notebooks:Notebook[]){
  const words=new Set<string>(),lists=wordlistIds(notebooks);
  for(const entry of entries)if(inNotebook(entry,'unreviewed',lists))for(const form of [entry.text,...(entry.cueWords||[])])if(form&&form.length>1)words.add(fold(form.trim()));
  return words;
}
export function paintVocabulary(root:Element,words:Set<string>,color:string){
  const doc=root.ownerDocument,registry=doc.defaultView?.CSS?.highlights;if(!registry)return;
  if(!words.size){registry.delete(NAME);return;}
  let style=doc.getElementById(STYLE);if(!style){style=doc.createElement('style');style.id=STYLE;doc.head?.appendChild(style);}
  const rule=`::highlight(${NAME}){text-decoration:underline;text-decoration-color:${color};text-decoration-thickness:2px;text-underline-offset:3px}`;if(style.textContent!==rule)style.textContent=rule;
  const chinese=[...words].filter(word=>/[\u3400-\u9fff]/.test(word)),ranges:Range[]=[];
  const walker=doc.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:node=>node.parentElement?.closest('script,style,textarea,[data-reader-annotations]')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
  const add=(node:Node,at:number,length:number)=>{const range=doc.createRange();range.setStart(node,at);range.setEnd(node,at+length);ranges.push(range);};
  for(let node=walker.nextNode();node&&ranges.length<LIMIT;node=walker.nextNode()){
    const text=node.textContent||'';
    for(const match of text.matchAll(/[A-Za-zÀ-ɏ]+(?:['’-][A-Za-zÀ-ɏ]+)*/g))if(words.has(fold(match[0])))add(node,match.index!,match[0].length);
    if(chinese.length&&/[\u3400-\u9fff]/.test(text))for(const word of chinese)for(let at=text.indexOf(word);at>=0;at=text.indexOf(word,at+word.length))add(node,at,word.length);
  }
  const highlight=new Highlight(...ranges);highlight.priority=-1;registry.set(NAME,highlight);
}
