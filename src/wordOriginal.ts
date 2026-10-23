import DOMPurify from 'dompurify';

// Render only when requested. Word styles stay inside this document, and external
// resources / alternate HTML chunks never become part of the reader UI.
export async function wordOriginal(bytes:Uint8Array):Promise<string>{
  const {renderAsync}=await import('docx-preview');
  const body=document.createElement('div'),styles=document.createElement('div');
  await renderAsync(bytes,body,styles,{className:'vlm-word',inWrapper:true,
    ignoreLastRenderedPageBreak:false,useBase64URL:true,renderAltChunks:false,
    renderComments:false,experimental:false});
  const safeStyle=(style:CSSStyleDeclaration)=>{
    const result=document.createElement('span').style;
    for(const name of Array.from(style)){
      const value=style.getPropertyValue(name);
      if(/url\(/i.test(value)&&!/^url\(["']?data:[\w/+.-]+;base64,[A-Za-z0-9+/=]+["']?\)$/i.test(value.trim()))continue;
      if(/expression\(|javascript:|@import/i.test(value))continue;
      result.setProperty(name,value,style.getPropertyPriority(name));
    }
    return result.cssText;
  };
  const css:string[]=[];
  for(const source of styles.querySelectorAll('style')){
    const sheet=new CSSStyleSheet();sheet.replaceSync(source.textContent||'');
    for(const rule of sheet.cssRules){
      if(rule instanceof CSSStyleRule){
        const selectors=rule.selectorText.split(',').map(selector=>'.word-original '+selector.trim()).join(',');
        css.push(selectors+'{'+safeStyle(rule.style)+'}');
      }else if(rule instanceof CSSFontFaceRule)css.push('@font-face{'+safeStyle(rule.style)+'}');
    }
  }
  const clean=DOMPurify.sanitize(body.innerHTML,{RETURN_DOM_FRAGMENT:true,
    FORBID_TAGS:['script','style','iframe','object','embed','form','input','button','link','meta','foreignObject'],
    FORBID_ATTR:['srcset'],ALLOW_DATA_ATTR:false});
  for(const el of clean.querySelectorAll('*')){
    for(const attr of ['src','href','xlink:href']){
      const value=el.getAttribute(attr);
      if(value&&!value.startsWith('#')&&!(attr==='src'&&el.tagName==='IMG'&&/^data:image\//i.test(value)))el.removeAttribute(attr);
    }
    if(el instanceof HTMLElement&&el.hasAttribute('style'))el.setAttribute('style',safeStyle(el.style));
  }
  const result=document.createElement('div');result.append(clean);
  return '<style>'+css.join('\n').replace(/</g,'\\3c ')+'</style>'+result.innerHTML;
}
