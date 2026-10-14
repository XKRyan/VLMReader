import type {Mark,HighlightColor} from './types';
export const highlightColors=[
  {id:'yellow',label:'黄色',ink:'#d6aa22',fill:'#f5ce4f'},
  {id:'green',label:'绿色',ink:'#52946a',fill:'#77bb8a'},
  {id:'blue',label:'蓝色',ink:'#4c8dce',fill:'#78afec'},
  {id:'pink',label:'粉色',ink:'#cc6e94',fill:'#ed97b9'},
  {id:'purple',label:'紫色',ink:'#9574d0',fill:'#b399ec'},
  {id:'theme',label:'主题色',ink:'var(--accent)',fill:'var(--accent)'}
] as const;
export function highlightInk(color?:HighlightColor){return highlightColors.find(item=>item.id===color)?.ink||'var(--accent)';}
export function highlightFill(color?:HighlightColor){return highlightColors.find(item=>item.id===color&&item.id!=='theme')?.fill;}
const groupName=(color:string)=>'vlmreader-note-'+color;
export function paintHighlights(ranges:Map<string,Range>,notes:Mark[]){
  CSS.highlights.set('memreader-notes',new Highlight(...ranges.values()));
  for(const color of highlightColors.filter(item=>item.id!=='theme')){
    const matching=notes.filter(note=>note.color===color.id).map(note=>ranges.get(note.id)).filter((range):range is Range=>!!range);
    if(matching.length){const highlight=new Highlight(...matching);highlight.priority=1;CSS.highlights.set(groupName(color.id),highlight);}
    else CSS.highlights.delete(groupName(color.id));
  }
}
export function clearHighlights(){CSS.highlights.delete('memreader-notes');for(const color of highlightColors)CSS.highlights.delete(groupName(color.id));}
