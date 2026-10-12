const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const TYPES={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',avif:'image/avif',bmp:'image/bmp',svg:'image/svg+xml'};
function readText(filename){
  const bytes=fs.readFileSync(filename);
  if(bytes[0]===255&&bytes[1]===254)return bytes.subarray(2).toString('utf16le');
  if(bytes[0]===254&&bytes[1]===255)return Buffer.from(bytes.subarray(2)).swap16().toString('utf16le');
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return new TextDecoder('gb18030').decode(bytes);}
}
function references(text){
  const result=new Set();
  for(const match of text.matchAll(/<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi))result.add((match[1]||match[2]||match[3]).replace(/&amp;/g,'&'));
  for(const match of text.matchAll(/!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g))result.add(match[1]||match[2]);
  for(const match of text.matchAll(/^\s*\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gm))result.add(match[1]||match[2]);
  return result;
}
function copyImages(sourceFile,directory){
  const base=path.resolve(path.dirname(sourceFile)),manifest={};
  for(const reference of references(readText(sourceFile))){
    if(/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference))continue;
    let relative;try{relative=decodeURIComponent(reference.split(/[?#]/)[0]);}catch{continue;}
    const source=path.resolve(base,relative),extension=path.extname(source).slice(1).toLowerCase();
    if(!source.toLowerCase().startsWith((base+path.sep).toLowerCase())||!TYPES[extension])continue;
    const stat=fs.statSync(source,{throwIfNoEntry:false});if(!stat?.isFile())continue;
    const filename=crypto.createHash('sha256').update(reference).digest('hex').slice(0,24)+'.'+extension;
    fs.mkdirSync(directory,{recursive:true});fs.copyFileSync(source,path.join(directory,filename));manifest[reference]=filename;
  }
  if(Object.keys(manifest).length)fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(manifest),'utf8');
}
function imageResources(directory){
  const file=path.join(directory,'manifest.json');if(!fs.existsSync(file))return {};
  const result={};
  for(const [reference,filename] of Object.entries(JSON.parse(fs.readFileSync(file,'utf8')))){
    if(typeof filename!=='string'||path.basename(filename)!==filename)continue;
    const mime=TYPES[path.extname(filename).slice(1).toLowerCase()],image=path.join(directory,filename);
    if(mime&&fs.existsSync(image))result[reference]='data:'+mime+';base64,'+fs.readFileSync(image).toString('base64');
  }
  return result;
}
module.exports={readText,copyImages,imageResources};
