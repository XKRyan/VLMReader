import DOMPurify from 'dompurify';

const formatting=['color','background-color','font-weight','font-style','text-decoration-line','text-decoration-color'] as const;
function safeValue(property:string,value:string){
  if(!value||/url\s*\(|var\s*\(|expression\s*\(|[{}<>]/i.test(value))return '';
  if(property==='font-weight')return /^(normal|bold|[1-9]00)$/.test(value)?value:'';
  if(property==='font-style')return /^(normal|italic|oblique)$/.test(value)?value:'';
  if(property==='text-decoration-line')return /^(none|(?:underline|overline|line-through)(?: (?:underline|overline|line-through))*)$/.test(value)?value:'';
  if(/^(inherit|initial|unset|revert|currentcolor)$/i.test(value))return '';
  return CSS.supports('color',value)?value:'';
}
function specificity(selector:string){
  // Common document selectors (Word exports and Markdown HTML); ties use order.
  return (selector.match(/#[\w-]+/g)?.length||0)*10000+(selector.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g)?.length||0)*100+(selector.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|:[\w-]+(?:\([^)]*\))?/g,'').match(/[a-z][\w-]*/gi)?.length||0);
}
export function documentHtml(input:string,resources:Record<string,string>={}){
  const doc=DOMPurify.sanitize(input,{WHOLE_DOCUMENT:true,RETURN_DOM:true,FORBID_TAGS:['iframe','form','input','button','script','link','meta','object','embed'],FORBID_ATTR:['srcset'],ALLOW_DATA_ATTR:false}) as HTMLElement;
  const body=doc.querySelector('body')||doc;
  const styles=new Map<Element,Map<string,{value:string;priority:number}>>();
  function apply(element:Element,style:CSSStyleDeclaration,weight:number){
    let values=styles.get(element);if(!values){values=new Map();styles.set(element,values);}
    for(const property of formatting){const value=safeValue(property,style.getPropertyValue(property).trim()),priority=weight+(style.getPropertyPriority(property)==='important'?1e9:0);if(value&&priority>=(values.get(property)?.priority??-1))values.set(property,{value,priority});}
  }
  for(const block of doc.querySelectorAll('style')){
    try{
      const sheet=new CSSStyleSheet();sheet.replaceSync(block.textContent||'');
      function rules(list:CSSRuleList){for(const rule of list){if(rule instanceof CSSStyleRule){for(const selector of rule.selectorText.split(',')){try{for(const element of doc.querySelectorAll(selector))apply(element,rule.style,specificity(selector));}catch{/* Ignore unsupported selectors. */}}}else if(rule instanceof CSSMediaRule&&matchMedia(rule.conditionText).matches)rules(rule.cssRules);}}
      rules(sheet.cssRules);
    }catch{/* A broken stylesheet must not hide the document. */}
    block.remove();
  }
  for(const element of [doc,...doc.querySelectorAll('*')]){
    const legacy=document.createElement('span');
    if(element.getAttribute('color'))legacy.style.color=element.getAttribute('color')!;
    if(element.getAttribute('bgcolor'))legacy.style.backgroundColor=element.getAttribute('bgcolor')!;
    apply(element,legacy.style,0);
    if(element instanceof HTMLElement||element instanceof SVGElement)apply(element,element.style,1e6);
    // Reading fonts/sizes and layout remain controlled by the reader.
    element.removeAttribute('style');element.removeAttribute('class');
    element.removeAttribute('color');element.removeAttribute('bgcolor');element.removeAttribute('face');
  }
  for(const [element,values] of styles){
    const style=[...values].map(([property,{value}])=>property+':'+value).join(';');
    if(style)element.setAttribute('style',style);
  }
  for(const image of body.querySelectorAll('img')){
    const original=image.getAttribute('src')||'';if(Object.hasOwn(resources,original))image.setAttribute('src',resources[original]);
    image.setAttribute('loading','lazy');image.setAttribute('decoding','async');
  }
  // Retain body-level ink without applying a source document's styles to the app.
  const wrapper=document.createElement('div');wrapper.className='document-body';
  for(const ancestor of [doc,body])if(ancestor.getAttribute('style'))wrapper.style.cssText+=';'+ancestor.getAttribute('style');
  while(body.firstChild)wrapper.append(body.firstChild);
  return wrapper.outerHTML;
}
