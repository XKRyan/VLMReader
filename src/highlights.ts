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
const layers=new WeakMap<Document,Set<string>>();
function clearLayers(doc:Document){const registry=doc.defaultView?.CSS.highlights;for(const name of layers.get(doc)||[])registry?.delete(name);layers.delete(doc);doc.getElementById('vlmreader-highlight-layers')?.remove();}
type PreviewHighlight={range:Range;color?:HighlightColor;id?:string};
export function paintHighlights(ranges:Map<string,Range>,notes:Mark[],doc:Document=document,preview?:PreviewHighlight|null){
  const registry=doc.defaultView?.CSS.highlights;if(!registry)return;clearLayers(doc);const names=new Set<string>();layers.set(doc,names);
  // Editing replaces that note's painted layer; its saved data stays intact.
  const visibleNotes=notes.filter(note=>note.id!==preview?.id),visibleRanges=new Map([...ranges].filter(([id])=>id!==preview?.id));
  registry.set('memreader-notes',new Highlight(...visibleRanges.values()));
  for(const color of highlightColors.filter(item=>item.id!=='theme')){
    const matching=visibleNotes.filter(note=>note.color===color.id).map(note=>visibleRanges.get(note.id)).filter((range):range is Range=>!!range);
    if(matching.length){const highlight=new Highlight(...matching);highlight.priority=1;registry.set(groupName(color.id),highlight);}
    else registry.delete(groupName(color.id));
  }
  // An opaque base isolates source HTML/DOCX/EPUB backgrounds. Our own
  // translucent layers can still blend with one another above that base.
  // Raster PDF ink must remain visible through its transparent text layer.
  const mask=[...visibleRanges.values(),...(preview?[preview.range]:[])].filter(range=>!range.startContainer.parentElement?.closest('.textLayer'));
  const base=new Highlight(...mask);base.priority=2;registry.set('vlmreader-note-base',base);names.add('vlmreader-note-base');
  const rules:string[]=['::highlight(vlmreader-note-base){background:var(--paper,#fff);color:inherit}'];
  for(const note of [...visibleNotes].sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||''))||a.id.localeCompare(b.id))){
    const range=ranges.get(note.id);if(!range)continue;const name='vlmreader-layer-'+names.size,highlight=new Highlight(range);
    highlight.priority=3+Math.max(0,100000-range.toString().length);registry.set(name,highlight);names.add(name);
    const fill=highlightFill(note.color)||'var(--accent)';rules.push('::highlight('+name+'){background:color-mix(in srgb,'+fill+' 34%,transparent);color:inherit}');
  }
  if(preview){
    const name='vlmreader-note-preview',highlight=new Highlight(preview.range);highlight.priority=3+Math.max(0,100000-preview.range.toString().length);registry.set(name,highlight);names.add(name);
    const fill=highlightFill(preview.color)||'var(--accent)';rules.push('::highlight('+name+'){background:color-mix(in srgb,'+fill+' 34%,transparent);color:inherit}');
  }
  if(rules.length){const style=doc.createElement('style');style.id='vlmreader-highlight-layers';style.textContent=rules.join('\n');doc.head.append(style);}
}
export function clearHighlights(doc:Document=document){clearLayers(doc);const registry=doc.defaultView?.CSS.highlights;registry?.delete('memreader-notes');for(const color of highlightColors)registry?.delete(groupName(color.id));}
