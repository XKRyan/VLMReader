const fs=require('node:fs');
const path=require('node:path');
const JSZip=require('jszip');
const {DOMParser,XMLSerializer}=require('@xmldom/xmldom');
const mammoth=require('mammoth');
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const A='http://schemas.openxmlformats.org/drawingml/2006/main';
const REL='http://schemas.openxmlformats.org/package/2006/relationships';
const HIGHLIGHTS={black:'#000000',blue:'#0000ff',cyan:'#00ffff',green:'#00ff00',magenta:'#ff00ff',red:'#ff0000',yellow:'#ffff00',white:'#ffffff',darkBlue:'#000080',darkCyan:'#008080',darkGreen:'#008000',darkMagenta:'#800080',darkRed:'#800000',darkYellow:'#808000',darkGray:'#808080',lightGray:'#c0c0c0'};
const child=(node,name)=>Array.from(node?.childNodes||[]).find(n=>n.nodeType===1&&n.namespaceURI===W&&n.localName===name);
const attr=(node,name)=>node?.getAttributeNS(W,name)||'';
const hex=value=>/^[a-f\d]{6}$/i.test(value||'')?'#'+value.toLowerCase():null;
function parseXml(text){
  if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('DOCX XML 包含不支持的实体声明');
  return new DOMParser({errorHandler:{warning(){},error(message){throw Error(message);},fatalError(message){throw Error(message);}}}).parseFromString(text,'application/xml');
}
function themeColor(base,tint,shade){
  if(!base)return null;
  const rgb=[1,3,5].map(at=>parseInt(base.slice(at,at+2),16)/255),max=Math.max(...rgb),min=Math.min(...rgb),d=max-min;
  let light=(max+min)/2,hue=0,saturation=0;
  if(d){saturation=d/(1-Math.abs(2*light-1));hue=(max===rgb[0]?(rgb[1]-rgb[2])/d+(rgb[1]<rgb[2]?6:0):max===rgb[1]?(rgb[2]-rgb[0])/d+2:(rgb[0]-rgb[1])/d+4)/6;}
  // Word applies tint/shade to HSL luminance; tint takes precedence (MS-OI29500 2.1.72).
  if(/^[a-f\d]{2}$/i.test(tint))light=light*parseInt(tint,16)/255+1-parseInt(tint,16)/255;
  else if(/^[a-f\d]{2}$/i.test(shade))light*=parseInt(shade,16)/255;
  const c=(1-Math.abs(2*light-1))*saturation,x=c*(1-Math.abs(hue*6%2-1)),m=light-c/2;
  const values=hue<1/6?[c,x,0]:hue<2/6?[x,c,0]:hue<3/6?[0,c,x]:hue<4/6?[0,x,c]:hue<5/6?[x,0,c]:[c,0,x];
  return '#'+values.map(v=>Math.round((v+m)*255).toString(16).padStart(2,'0')).join('');
}
function readColor(node,theme,fill=false){
  const themed=theme[attr(node,fill?'themeFill':'themeColor')];
  const cached=hex(attr(node,fill?'fill':'val'));if(!themed)return cached;
  const tint=attr(node,fill?'themeFillTint':'themeTint'),shade=attr(node,fill?'themeFillShade':'themeShade'),resolved=themeColor(themed,tint,shade);
  // Keep Word's cached rounding if it agrees with the current theme; a stale
  // cached RGB value must not override a changed theme color.
  if((tint||shade)&&cached&&[1,3,5].every(at=>Math.abs(parseInt(cached.slice(at,at+2),16)-parseInt(resolved.slice(at,at+2),16))<=2))return cached;
  return resolved;
}
function properties(node,theme){
  const result={},color=child(node,'color'),highlight=child(node,'highlight'),shading=child(node,'shd');
  if(color)result.color=readColor(color,theme);
  if(highlight)result.highlight=HIGHLIGHTS[attr(highlight,'val')]||null;
  if(shading)result.shading=attr(shading,'val')==='nil'?null:readColor(shading,theme,true);
  for(const name of ['b','i','u','strike']){const value=child(node,name);if(value)result[name]=value.cloneNode(true);}
  return result;
}
function foreground(background){const rgb=[1,3,5].map(at=>parseInt(background.slice(at,at+2),16)/255),luminance=rgb.map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);return luminance>.179?'#000000':'#ffffff';}
async function readXml(zip,filename){const file=zip.file(filename);return file?parseXml(await file.async('string')):null;}
function related(document,base,type,fallback){
  const rel=Array.from(document?.getElementsByTagNameNS(REL,'Relationship')||[]).find(el=>el.getAttribute('Type')?.endsWith('/'+type)&&el.getAttribute('TargetMode')!=='External');
  const target=rel?.getAttribute('Target');return target?path.posix.normalize(target.startsWith('/')?target.slice(1):path.posix.join(base,target)):fallback;
}
async function convertDocx(filename){
  const input=Buffer.isBuffer(filename)?filename:fs.readFileSync(filename),zip=await JSZip.loadAsync(input);
  const mainPath=related(await readXml(zip,'_rels/.rels'),'','officeDocument','word/document.xml'),base=path.posix.dirname(mainPath);
  const relations=await readXml(zip,path.posix.join(base,'_rels',path.posix.basename(mainPath)+'.rels'));
  const stylePath=related(relations,base,'styles','word/styles.xml');
  const stylesDoc=await readXml(zip,stylePath)||parseXml('<w:styles xmlns:w="'+W+'"/>');
  const themeDoc=await readXml(zip,related(relations,base,'theme','word/theme/theme1.xml')),theme={};
  const scheme=themeDoc?.getElementsByTagNameNS(A,'clrScheme')[0];
  for(const item of Array.from(scheme?.childNodes||[])){if(item.nodeType!==1)continue;const value=Array.from(item.childNodes).find(n=>n.nodeType===1);theme[item.localName]=hex(value?.getAttribute('val'))||hex(value?.getAttribute('lastClr'));}
  for(const [name,target] of Object.entries({dark1:'dk1',light1:'lt1',dark2:'dk2',light2:'lt2',text1:'dk1',background1:'lt1',text2:'dk2',background2:'lt2'}))theme[name]=theme[target];
  const styles=new Map(),cache=new Map();let defaultParagraph='';
  for(const style of Array.from(stylesDoc.getElementsByTagNameNS(W,'style'))){const id=attr(style,'styleId');if(!styles.has(id))styles.set(id,style);if(attr(style,'type')==='paragraph'&&attr(style,'default')==='1')defaultParagraph=id;}
  function resolve(id,seen=new Set()){
    if(cache.has(id))return cache.get(id);if(!id||seen.has(id))return {};
    seen.add(id);const style=styles.get(id),result={...resolve(attr(child(style,'basedOn'),'val'),seen),...properties(child(style,'rPr'),theme)};cache.set(id,result);return result;
  }
  const defaults=properties(child(child(child(stylesDoc.documentElement,'docDefaults'),'rPrDefault'),'rPr'),theme),maps=['u => u'],formats=new Map();
  const parts=[mainPath,...['footnotes','endnotes','comments'].map(name=>related(relations,base,name,'word/'+name+'.xml'))];
  const serializer=new XMLSerializer();
  for(const part of new Set(parts)){
    const doc=await readXml(zip,part);if(!doc)continue;
    for(const run of Array.from(doc.getElementsByTagNameNS(W,'r'))){
      let paragraph=run.parentNode;while(paragraph&&!(paragraph.namespaceURI===W&&paragraph.localName==='p'))paragraph=paragraph.parentNode;
      const pPr=child(paragraph,'pPr');let rPr=child(run,'rPr');
      const original=attr(child(rPr,'rStyle'),'val'),effective={...defaults,...resolve(attr(child(pPr,'pStyle'),'val')||defaultParagraph),...resolve(original),...properties(rPr,theme)};
      const background=effective.highlight||effective.shading||readColor(child(pPr,'shd'),theme,true);
      const color=effective.color&&effective.color!=='#000000'?effective.color:background?(effective.color||foreground(background)):null;
      if(!color&&!background)continue;
      const css=(color?'color:'+color+';':'')+(background?'background-color:'+background+';':'');
      const key=original+'|'+css;let id=formats.get(key);
      if(!id){id='VLMFormat'+formats.size;while(styles.has(id))id+='x';formats.set(key,id);const style=stylesDoc.createElementNS(W,'w:style');style.setAttributeNS(W,'w:type','character');style.setAttributeNS(W,'w:styleId',id);const name=stylesDoc.createElementNS(W,'w:name');name.setAttributeNS(W,'w:val',id);style.appendChild(name);stylesDoc.documentElement.appendChild(style);maps.push("r."+id+" => span[style='"+css+"']");}
      if(!rPr){rPr=doc.createElementNS(W,'w:rPr');run.insertBefore(rPr,run.firstChild);}
      let rStyle=child(rPr,'rStyle');if(!rStyle){rStyle=doc.createElementNS(W,'w:rStyle');rPr.insertBefore(rStyle,rPr.firstChild);}rStyle.setAttributeNS(W,'w:val',id);
      // Retain inherited emphasis when a colored run receives its display style.
      for(const name of ['b','i','u','strike'])if(effective[name]&&!child(rPr,name))rPr.appendChild(doc.importNode(effective[name],true));
    }
    zip.file(part,serializer.serializeToString(doc));
  }
  zip.file(stylePath,serializer.serializeToString(stylesDoc));
  // Only the in-memory copy changes; embedded drawings/images stay in the ZIP.
  const result=await mammoth.convertToHtml({buffer:await zip.generateAsync({type:'nodebuffer'})},{styleMap:maps,externalFileAccess:false});
  return {html:result.value,warnings:result.messages.map(m=>m.message)};
}
module.exports={convertDocx};
