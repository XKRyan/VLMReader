import type {Entry} from './types';
const common=new Set('a an the and or but to of in on at for from by with as is am are was were be been being this that these those it its i you he she we they me him her us them my your his our their not no do does did have has had will would can could should may might than then when what who which where how all any some there here also just very so into through about only every'.split(' '));
function targetPattern(target:string,language:string){const escaped=target.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return new RegExp(language==='en'?'(?<![\\p{L}\\p{M}])'+escaped+'(?![\\p{L}\\p{M}])':escaped,'giu');}
export function sentenceTargets(entry:Pick<Entry,'text'|'language'>,words:Pick<Entry,'text'|'kind'>[]=[]){
  const text=entry.text;
  const known=words.filter(e=>e.kind==='word'&&targetPattern(e.text,entry.language).test(text)).map(e=>e.text);
  const segments=[...new Intl.Segmenter(entry.language,{granularity:'word'}).segment(text)].filter(s=>s.isWordLike&&s.segment.length>=2);
  const candidates=segments.filter(s=>!common.has(s.segment.toLowerCase())&&!/^\d+$/.test(s.segment));
  candidates.sort((a,b)=>Math.min(b.segment.length,9)-Math.min(a.segment.length,9));
  return [...new Set([...known,...candidates.map(s=>s.segment)])].slice(0,25);
}
export function clozeFor(entry:Entry,words:Entry[]=[]){
  const target=entry.kind==='word'?entry.text:(entry.reviewTarget||sentenceTargets(entry,words)[0]||'');
  const text=entry.kind==='word'?entry.context:entry.text;
  if(!target)return {text,target:'',available:false};
  const changed=text.replace(targetPattern(target,entry.language),' ______ ');
  return {text:changed,target,available:changed!==text&&/[\p{L}\p{M}\p{N}]/u.test(changed.replace(/______/g,''))};
}
