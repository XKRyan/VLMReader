const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const http=require('node:http');
const https=require('node:https');
const dns=require('node:dns').promises;
const net=require('node:net');
const {readText,references}=require('./document-files.cjs');
const MAX_IMAGE=15*1024*1024;
const MIME={'image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp','image/avif':'avif','image/bmp':'bmp','image/svg+xml':'svg'};
function privateAddress(address){return /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(?:1[6-9]|2\d|3[01])\.|22[4-9]\.|23\d\.|24\d\.|25[0-5]\.)/.test(address)||address==='::'||address==='::1'||/^(?:fc|fd|fe[89ab]|ff)/i.test(address)||/^::ffff:/i.test(address);}
async function download(url,allowLocal=false,redirects=0,data=false){
  if(url.startsWith('//'))url='https:'+url;
  const target=new URL(url);if(!['http:','https:'].includes(target.protocol)||target.username||target.password)throw Error('Unsupported image URL');
  const hostname=target.hostname.replace(/^\[|\]$/g,'');
  const addresses=net.isIP(hostname)?[{address:hostname,family:net.isIP(hostname)}]:await dns.lookup(hostname,{all:true});
  if(!addresses.length||!allowLocal&&addresses.some(item=>privateAddress(item.address)))throw Error('Private network image URLs are not supported');
  const address=addresses[0];
  return new Promise((resolve,reject)=>{
    const request=(target.protocol==='https:'?https:http).get(target,{headers:{'User-Agent':'VLMReader Markdown','Accept':'image/*'},lookup:(_hostname,options,callback)=>options?.all?callback(null,[address]):callback(null,address.address,address.family)},response=>{
      if([301,302,303,307,308].includes(response.statusCode)){response.resume();if(redirects>=4)return reject(Error('Too many redirects'));let next;try{next=new URL(response.headers.location,target).href;}catch{return reject(Error('Invalid resource redirect'));}return download(next,allowLocal,redirects+1,data).then(resolve,reject);}
      const mime=String(response.headers['content-type']||'').split(';')[0].toLowerCase();
      if(response.statusCode!==200||!(data?/^(?:application\/(?:json|octet-stream)|text\/(?:plain|csv|tab-separated-values))$/.test(mime):MIME[mime])){response.resume();return reject(Error('Resource unavailable or unsupported format'));}
      if(Number(response.headers['content-length'])>MAX_IMAGE){response.destroy();return reject(Error('Image exceeds 15 MB'));}
      let size=0;const chunks=[];response.on('data',chunk=>{size+=chunk.length;if(size>MAX_IMAGE){response.destroy(Error('Image exceeds 15 MB'));return;}chunks.push(chunk);});response.on('error',reject);response.on('end',()=>resolve({bytes:Buffer.concat(chunks),mime}));
    });
    request.on('error',reject);const timer=setTimeout(()=>request.destroy(Error('Image request timed out')),15000);request.on('close',()=>clearTimeout(timer));
  });
}
const inFlight=new Map();
function diagramInBook(dataDir,book,source){
  if(book.format!=='md'||typeof source!=='string'||source.length>100000)throw Error('Invalid diagram');
  return require('markdown-it')().parse(readText(path.join(dataDir,'books',book.id+'.md')),{}).find(token=>token.type==='fence'&&token.content===source&&['vega','vega-lite','plantuml'].includes(token.info.trim().toLowerCase()));
}
async function diagramData(dataDir,book,source,url,allowLocal=false){
  const token=diagramInBook(dataDir,book,source);if(!token||!['vega','vega-lite'].includes(token.info.trim()))throw Error('Diagram not found');
  const spec=JSON.parse(source);let allowed=false;function walk(value){if(!value||typeof value!=='object')return;if(value.url===url)allowed=true;for(const child of Object.values(value))walk(child);}walk(spec);if(!allowed)throw Error('Data is not referenced by the diagram');
  if(/^https?:\/\/|^\/\//i.test(url))return (await download(url,allowLocal,0,true)).bytes.toString('utf8');
  const linked=localLink(book,url);if(!/\.(json|csv|tsv)$/i.test(linked.path)||fs.statSync(linked.path).size>5*1024*1024)throw Error('Unsupported chart data file');return readText(linked.path);
}
function saveDiagram(dataDir,book,source,svg){
  if(!diagramInBook(dataDir,book,source)||typeof svg!=='string'||svg.length>5*1024*1024||!svg.startsWith('data:image/svg+xml;charset=utf-8,'))throw Error('Invalid diagram image');
  const bytes=Buffer.from(decodeURIComponent(svg.slice('data:image/svg+xml;charset=utf-8,'.length)),'utf8'),directory=path.join(dataDir,'books',book.id+'-assets'),file=path.join(directory,'manifest.json'),name=crypto.createHash('sha256').update(source).digest('hex').slice(0,24)+'.svg';
  fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,name),bytes);const manifest=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};manifest[source]=name;fs.writeFileSync(file,JSON.stringify(manifest));return true;
}
async function cacheImage(dataDir,book,reference,{allowLocal=false,plantuml=false}={}){
  if(typeof reference!=='string'||reference.length>200000)throw Error('Invalid image reference');
  const source=path.join(dataDir,'books',book.id+'.'+book.format),directory=path.join(dataDir,'books',book.id+'-assets'),manifestFile=path.join(directory,'manifest.json');
  const readManifest=()=>fs.existsSync(manifestFile)?JSON.parse(fs.readFileSync(manifestFile,'utf8')):{};
  const old=readManifest()[reference];
  if(typeof old==='string'&&/^[a-f0-9]{24}\.(?:png|jpg|gif|webp|avif|bmp|svg)$/.test(old)&&fs.existsSync(path.join(directory,old))){const mime=Object.keys(MIME).find(key=>MIME[key]===path.extname(old).slice(1));return 'data:'+mime+';base64,'+fs.readFileSync(path.join(directory,old)).toString('base64');}
  let url=reference;
  if(plantuml){
    if(book.format!=='md')throw Error('Not a Markdown document');
    const MarkdownIt=require('markdown-it'),tokens=new MarkdownIt().parse(readText(source),{});
    if(!tokens.some(token=>token.type==='fence'&&token.info.trim().toLowerCase()==='plantuml'&&token.content===reference))throw Error('Diagram not found');
    url='https://www.plantuml.com/plantuml/svg/'+require('plantuml-encoder').encode(reference);
  }else if(!['md','html','htm'].includes(book.format)||!references(readText(source)).has(reference))throw Error('Image is not referenced by this document');
  const key=directory+'|'+reference;if(inFlight.has(key))return inFlight.get(key);
  const work=(async()=>{const {bytes,mime}=await download(url,allowLocal),filename=crypto.createHash('sha256').update(reference).digest('hex').slice(0,24)+'.'+MIME[mime];fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,filename),bytes);const manifest=readManifest();manifest[reference]=filename;const temp=manifestFile+'.tmp';fs.writeFileSync(temp,JSON.stringify(manifest));fs.renameSync(temp,manifestFile);return 'data:'+mime+';base64,'+bytes.toString('base64');})();
  inFlight.set(key,work);try{return await work;}finally{inFlight.delete(key);}
}
function localLink(book,href){
  if(typeof href!=='string'||href.length>8192||/^[a-z][a-z\d+.-]*:|^\/\//i.test(href))throw Error('Unsupported document link');
  if(!book.sourcePath)throw Error('Original folder unavailable. Reimport the Markdown file to restore relative document links.');
  const [filename,anchor='']=href.split('#');let decoded;try{decoded=decodeURIComponent(filename.split('?')[0]);}catch{throw Error('Invalid document link');}
  const target=path.resolve(path.dirname(book.sourcePath),decoded);if(!fs.statSync(target,{throwIfNoEntry:false})?.isFile())throw Error('Linked document not found: '+path.basename(target));
  return {path:target,anchor:decodeURIComponent(anchor)};
}
module.exports={cacheImage,download,privateAddress,localLink,diagramData,saveDiagram};
