import MarkdownIt from 'markdown-it';
import footnote from 'markdown-it-footnote';
import sub from 'markdown-it-sub';
import sup from 'markdown-it-sup';
import mark from 'markdown-it-mark';
import ins from 'markdown-it-ins';
import deflist from 'markdown-it-deflist';
import {full as emoji} from 'markdown-it-emoji';
import tasks from 'markdown-it-task-lists';
import katex from 'katex';
import 'katex/contrib/mhchem';
import hljs from 'highlight.js';
import 'katex/dist/katex.min.css';
import './markdown.css';
import {documentHtml} from './documentHtml';
import {t} from './i18n';

type Rich={id:string;kind:string;source:string;block:boolean};
const diagrams=new Set(['mermaid','flowchart','sequence','vega','vega-lite','plantuml']);
export async function markdownHtml(source:string,resources:Record<string,string>={}){
  const rich:Rich[]=[],prefix='md-'+crypto.randomUUID()+'-',escape=MarkdownIt().utils.escapeHtml;
  const macros:Record<string,string>={};
  // JSON front matter is metadata only when the leading object parses in full.
  let jsonMetadata='';if(source.trimStart().startsWith('{')){const lines=source.split('\n');for(let n=0;n<Math.min(lines.length,1000);n++)if(lines[n].trim().endsWith('}')){const candidate=lines.slice(0,n+1).join('\n');try{JSON.parse(candidate);jsonMetadata=candidate;source=lines.slice(n+1).join('\n');break;}catch{}}}
  const placeholder=(kind:string,source:string,block=true)=>{const id=prefix+rich.length;rich.push({id,kind,source,block});return `<${block?'div':'span'} id="${id}"></${block?'div':'span'}>`;};
  const md=new MarkdownIt({html:true,linkify:true,breaks:false}).use(footnote).use(sub).use(sup).use(mark).use(ins).use(deflist).use(emoji).use(tasks);
  md.inline.ruler.before('escape','math',(state:any,silent:boolean)=>{
    const pos=state.pos,tail=state.src.slice(pos),open=tail.startsWith('\\\\(')?'\\\\(':tail.startsWith('\\(')?'\\(':tail.startsWith('$`')?'$`':tail[0]==='$'?'$':'';
    if(!open||open==='$'&&(tail[1]==='$'||/\s/.test(tail[1]||'')))return false;
    const close=open==='$`'?'`$':open==='$'?'$':open.replace('(',')');let end=state.src.indexOf(close,pos+open.length);
    while(end>=0&&state.src[end-1]==='\\')end=state.src.indexOf(close,end+close.length);
    if(end<0||state.src.slice(pos,end).includes('\n')||open==='$'&&(/\s/.test(state.src[end-1])||/\d/.test(state.src[end+1]||'')))return false;
    if(!silent){const token=state.push('math_inline','',0);token.content=state.src.slice(pos+open.length,end);}state.pos=end+close.length;return true;
  });
  md.renderer.rules.math_inline=(tokens,idx)=>placeholder('math',tokens[idx].content,false);
  md.block.ruler.before('fence','extended_blocks',(state:any,start:number,end:number,silent:boolean)=>{
    const first=state.src.slice(state.bMarks[start]+state.tShift[start],state.eMarks[start]).trim();
    let close='',kind='';
    if(first.startsWith('$$')){close='$$';kind='math';}else if(first.startsWith('\\\\[')){close='\\\\]';kind='math';}else if(first.startsWith('\\[')){close='\\]';kind='math';}
    else if(first==='>>>'){close='>>>';kind='quote';}else if(start===0&&['---','+++',';;;'].includes(first)){close=first;kind='frontmatter';}
    if(!kind)return false;const open=kind==='math'?(close==='$$'?'$$':close.replace(']', '[')):first;
    let content=kind==='math'?first.slice(open.length):'',last=start;
    const inlineEnd=content.indexOf(close);if(inlineEnd>=0)content=content.slice(0,inlineEnd);
    else{for(last=start+1;last<end;last++){const line=state.src.slice(state.bMarks[last],state.eMarks[last]);const at=line.indexOf(close);if(at>=0&&(kind==='math'||line.trim()===close)){content+='\n'+line.slice(0,at);break;}content+='\n'+line;}if(last===end)return false;}
    if(silent)return true;const token=state.push('extended_block','',0);token.meta={kind};token.content=content.trim();token.map=[start,last+1];state.line=last+1;return true;
  },{alt:['paragraph','reference','blockquote','list']});
  md.renderer.rules.extended_block=(tokens,idx)=>{const token=tokens[idx];return token.meta?.kind==='quote'?'<blockquote>'+md.render(token.content)+'</blockquote>':placeholder(String(token.meta?.kind),token.content);};
  md.inline.ruler.before('emphasis','inline_diff',(state:any,silent:boolean)=>{const m=/^(?:\{([+-])([\s\S]*?)\1\}|\[([+-])([\s\S]*?)\3\])/.exec(state.src.slice(state.pos));if(!m||!(m[2]||m[4]).trim())return false;if(!silent){const token=state.push('html_inline','',0),tag=(m[1]||m[3])==='+'?'ins':'del';token.content=`<${tag}>${escape(m[2]||m[4])}</${tag}>`;}state.pos+=m[0].length;return true;});
  md.renderer.rules.fence=(tokens,idx)=>{const token=tokens[idx],language=token.info.trim().split(/\s+/)[0].toLowerCase();return placeholder(language==='math'||language==='latex'?'math':diagrams.has(language)?language:'code:'+language,token.content);};
  const html=((jsonMetadata?placeholder('frontmatter',jsonMetadata):'')+md.render(source)).replace(/<input\b[^>]*class="task-list-item-checkbox"[^>]*>/g,tag=>tag.includes('checked')?'☑ ':'☐ ').replace(/<input\b(?=[^>]*task-list-item-checkbox)[^>]*>/g,tag=>tag.includes('checked')?'☑ ':'☐ ');
  const root=document.createElement('div');root.innerHTML=documentHtml(html,resources);root.firstElementChild?.classList.add('markdown-body');
  // GitHub-style heading anchors, including Chinese and repeated headings.
  const ids=new Set([...root.querySelectorAll('[id]')].map(el=>el.id));
  for(const heading of root.querySelectorAll('h1,h2,h3,h4,h5,h6')){
    let label=heading.textContent||'',explicit=/\s*\{#([^\s}]+)\}\s*$/.exec(label);
    if(explicit){const walk=document.createTreeWalker(heading,NodeFilter.SHOW_TEXT);let node:Node|null;while((node=walk.nextNode()))if(node.textContent?.includes(explicit[0]))node.textContent=node.textContent.replace(explicit[0],'');label=label.replace(explicit[0],'');}
    const base=explicit?.[1]||label.toLowerCase().trim().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu,'').replace(/\s/g,'-')||'section';let id=base,n=0;while(ids.has(id))id=base+'-'+(++n);if(!heading.id){heading.id=id;ids.add(id);}
  }
  for(const anchor of root.querySelectorAll('a[name]'))if(!anchor.id)anchor.id=anchor.getAttribute('name')!;
  for(const p of root.querySelectorAll('p'))if(/^\[(?:toc)\]$/i.test(p.textContent?.trim()||'')){const nav=document.createElement('nav');nav.className='markdown-toc';for(const heading of root.querySelectorAll('h1,h2,h3,h4,h5,h6')){const a=document.createElement('a');a.href='#'+encodeURIComponent(heading.id);a.textContent=heading.textContent;a.style.paddingLeft=(Number(heading.tagName[1])-1)*14+'px';nav.append(a);}p.replaceWith(nav);}
  for(const quote of root.querySelectorAll('blockquote')){const first=quote.querySelector('p');if(!first)continue;const alert=/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/.exec(first.textContent||'');if(alert){quote.className='markdown-alert '+alert[1].toLowerCase();first.innerHTML=first.innerHTML.replace(/^\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/,`<strong>${alert[1]}</strong><br>`);}}
  for(const item of rich){const el=root.querySelector('#'+item.id);if(!el)continue;el.removeAttribute('id');
    if(item.kind==='math'){el.className=item.block?'markdown-math-block':'markdown-math';el.setAttribute('aria-label',item.source);el.setAttribute('role','math');try{el.innerHTML=katex.renderToString(item.source,{displayMode:item.block,throwOnError:true,trust:false,strict:'warn',output:'html',maxExpand:1000,maxSize:30,macros});}catch{el.classList.add('markdown-render-error');el.textContent=item.source;el.setAttribute('title',t('公式无法渲染，已保留源码'));}}
    else if(item.kind.startsWith('code:')){const language=item.kind.slice(5),pre=document.createElement('pre'),code=document.createElement('code');code.className='hljs';code.innerHTML=hljs.getLanguage(language)?hljs.highlight(item.source,{language,ignoreIllegals:true}).value:escape(item.source);pre.append(code);el.replaceWith(pre);}
    else if(item.kind==='frontmatter'){el.setAttribute('data-ui','true');el.innerHTML='<details class="markdown-frontmatter"><summary>'+t('文档信息')+'</summary><pre>'+escape(item.source)+'</pre></details>';}
    else{el.className='markdown-diagram';el.setAttribute('data-ui','true');el.setAttribute('data-diagram-kind',item.kind);el.innerHTML='<details><summary>'+escape(item.kind)+' · '+t('查看源码')+'</summary><pre>'+escape(item.source)+'</pre></details>';el.setAttribute('data-diagram-source',item.source);if(['plantuml','vega','vega-lite'].includes(item.kind)&&/^data:image\//.test(resources[item.source]||'')){const img=document.createElement('img');img.src=resources[item.source];img.alt=item.kind;el.prepend(img);el.setAttribute('data-rendered','true');}}
  }
  for(const image of root.querySelectorAll('img')){image.referrerPolicy='no-referrer';let src=image.getAttribute('src')||'';if(src.startsWith('//')){image.setAttribute('data-remote-image',src);image.removeAttribute('src');continue;}if(!/^(data:image\/|https?:\/\/)/i.test(src)){image.setAttribute('data-missing-image',src);image.removeAttribute('src');}else if(/^https?:/i.test(src)){image.setAttribute('data-remote-image',src);image.removeAttribute('src');}}
  return root.innerHTML;
}
