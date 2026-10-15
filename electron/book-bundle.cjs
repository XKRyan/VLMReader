const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),JSZip=require('jszip');
const FORMATS=new Set(['pdf','epub','docx','txt','md','html','htm']),COLORS=new Set(['yellow','green','blue','pink','purple','theme']);
const LIMIT=350*1024*1024,IMAGE=/^[a-f0-9]{24}\.(?:png|jpe?g|gif|webp|avif|bmp|svg)$/i;
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const invalid=()=>Error('带批注文档无效或已损坏');
function string(value,max,required=false){if(typeof value!=='string'||value.length>max||required&&!value.length)throw invalid();return value;}
function mark(row){
 if(!row||typeof row!=='object')throw invalid();
 const location=typeof row.location==='number'&&Number.isFinite(row.location)?row.location:string(row.location,12000);
 const result={text:string(row.text,100000),location,note:string(row.note||'',12000),color:row.color||'theme',createdAt:string(row.createdAt,64,true),shareId:string(row.shareId||row.id,100,true)};
 if(!COLORS.has(result.color)||!Number.isFinite(Date.parse(result.createdAt)))throw invalid();
 for(const [field,max]of [['cfi',12000],['context',100000],['updatedAt',64]])if(row[field]!==undefined)result[field]=string(row[field],max);
 if(row.start!==undefined){if(!Number.isSafeInteger(row.start)||row.start<0)throw invalid();result.start=row.start;}
 return result;
}
function localFiles(store,book){
 const folder=path.join(store.dir,'books'),source=path.join(folder,book.id+'.'+book.format);if(!FORMATS.has(book.format)||!fs.statSync(source).isFile())throw Error('原文文件不存在');
 const result=[{name:'document.'+book.format,data:fs.readFileSync(source)}],assets=path.join(folder,book.id+'-assets'),manifest=path.join(assets,'manifest.json');
 if(['md','html','htm'].includes(book.format)&&fs.existsSync(manifest)){
  const mappings=JSON.parse(fs.readFileSync(manifest,'utf8')),safe={};
  for(const [reference,name]of Object.entries(mappings)){
   if(!IMAGE.test(name)||typeof reference!=='string')throw invalid();const file=path.join(assets,name);if(!fs.existsSync(file))throw Error('文档图片缺失，请重新导入原文后导出');safe[reference]=name;
  }
  result.push({name:'assets/manifest.json',data:Buffer.from(JSON.stringify(safe))});
  for(const name of [...new Set(Object.values(safe))].sort())result.push({name:'assets/'+name,data:fs.readFileSync(path.join(assets,name))});
 }
 if(result.reduce((sum,file)=>sum+file.data.length,0)>LIMIT)throw Error('带批注文档过大（上限 350 MB）');return result;
}
const identity=files=>digest(files.map(file=>[file.name,digest(file.data)]).sort((a,b)=>a[0].localeCompare(b[0])).map(row=>row.join(':')).join('\n'));
async function exportBundle(store,id,destination){
 const book=store.state.books.find(book=>book.id===id);if(!book)throw Error('文档不存在');const files=localFiles(store,book),manifest={type:'VLMReader annotated document',version:1,title:book.title,format:book.format,files:files.map(file=>({name:file.name,sha256:digest(file.data)})),notes:store.state.notes.filter(row=>row.bookId===id).map(mark),bookmarks:store.state.bookmarks.filter(row=>row.bookId===id).map(mark)};
 const metadata=JSON.stringify(manifest);if(Buffer.byteLength(metadata)>8*1024*1024)throw Error('批注内容过多，请拆分后导出');const zip=new JSZip();zip.file('manifest.json',metadata);for(const file of files)zip.file(file.name,file.data);
 const bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6}});if(bytes.length>LIMIT)throw Error('带批注文档过大（上限 350 MB）');
 const temporary=destination+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(temporary,bytes);fs.renameSync(temporary,destination);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}return {path:destination,notes:manifest.notes.length,bookmarks:manifest.bookmarks.length};
}
async function readBundle(filename){
 const stat=fs.statSync(filename);if(!stat.isFile()||stat.size>LIMIT)throw Error('带批注文档过大（上限 350 MB）');
 let zip;try{zip=await JSZip.loadAsync(fs.readFileSync(filename));}catch{throw invalid();}
 const entries=Object.values(zip.files);if(entries.length>5000)throw invalid();let expanded=0;
 for(const file of entries){const size=file._data?.uncompressedSize||0;if(!Number.isSafeInteger(size)||size<0||size>LIMIT)throw invalid();expanded+=size;if(expanded>LIMIT)throw invalid();if(file.unsafeOriginalName&&file.unsafeOriginalName!==file.name||file.name.includes('\\')||file.name.startsWith('/')||file.name.split('/').includes('..'))throw invalid();}
 const meta=zip.file('manifest.json');if(!meta||meta._data.uncompressedSize>8*1024*1024)throw invalid();let manifest;try{manifest=JSON.parse(await meta.async('string'));}catch{throw invalid();}
 if(manifest.type!=='VLMReader annotated document'||manifest.version!==1||!FORMATS.has(manifest.format)||!Array.isArray(manifest.files)||manifest.files.length>4000||!manifest.files.length)throw invalid();string(manifest.title,500,true);
 for(const field of ['notes','bookmarks'])if(!Array.isArray(manifest[field])||manifest[field].length>10000)throw invalid();
 const seen=new Set(['manifest.json']),files=[];
 for(const row of manifest.files){if(!row||typeof row.name!=='string'||!(/^[a-f0-9]{64}$/.test(row.sha256))||seen.has(row.name)||!(row.name==='document.'+manifest.format||row.name==='assets/manifest.json'||row.name.startsWith('assets/')&&IMAGE.test(row.name.slice(7))))throw invalid();seen.add(row.name);const file=zip.file(row.name);if(!file)throw invalid();const data=await file.async('nodebuffer');if(digest(data)!==row.sha256)throw invalid();files.push({name:row.name,data});}
 if(!seen.has('document.'+manifest.format)||entries.some(file=>!file.dir&&!seen.has(file.name)))throw invalid();
 const assets=files.find(file=>file.name==='assets/manifest.json');if(assets){let mapping;try{mapping=JSON.parse(assets.data.toString());}catch{throw invalid();}if(!mapping||Array.isArray(mapping)||typeof mapping!=='object'||Object.entries(mapping).some(([ref,name])=>ref.length>12000||typeof name!=='string'||!IMAGE.test(name)||!seen.has('assets/'+name)))throw invalid();}
 if(files.some(file=>file.name.startsWith('assets/')&&file.name!=='assets/manifest.json')&&!assets)throw invalid();
 return {manifest,files,notes:manifest.notes.map(mark),bookmarks:manifest.bookmarks.map(mark)};
}
async function importBundle(store,filename){
 const plan=await readBundle(filename),fingerprint=identity(plan.files),source=plan.files.find(file=>file.name==='document.'+plan.manifest.format),hash=digest(source.data);
 // Existing content is reused only when the document and every saved image match.
 let book=store.state.books.find(item=>item.hash===hash&&(()=>{try{return identity(localFiles(store,item))===fingerprint;}catch{return false;}})());const created=[];
 if(!book){book={id:crypto.randomUUID(),hash,format:plan.manifest.format,title:plan.manifest.title,size:source.data.length,createdAt:new Date().toISOString(),lastRead:null,progress:0,location:null,favorite:false};}
 const merge=(existing,incoming)=>{const result=[...existing];for(const row of incoming){const same=item=>item.bookId===book.id&&item.text===row.text&&(item.note||'')===row.note&&(item.color||'theme')===row.color&&String(item.location)===String(row.location)&&item.cfi===row.cfi&&item.start===row.start;if(!result.some(same))result.push({...row,id:crypto.randomUUID(),bookId:book.id});}return result;};
 const next={...store.state,books:store.state.books.some(item=>item.id===book.id)?store.state.books:[book,...store.state.books],notes:merge(store.state.notes,plan.notes),bookmarks:merge(store.state.bookmarks,plan.bookmarks)};
 try{
  if(!store.state.books.some(item=>item.id===book.id))for(const file of plan.files){const destination=path.join(store.dir,'books',file.name.startsWith('assets/')?book.id+'-assets/'+file.name.slice(7):book.id+'.'+book.format);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,file.data,{flag:'wx'});created.push(destination);}
  store.replaceState(next);return book;
 }catch(error){for(const file of created)try{fs.unlinkSync(file);}catch{}throw error;}
}
module.exports={exportBundle,readBundle,importBundle};
