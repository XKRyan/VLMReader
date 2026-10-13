const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {DOMParser}=require('@xmldom/xmldom'),JSZip=require('jszip');
const {targetPattern}=require('./review-examples.cjs');
const parser=new DOMParser({onError:()=>{}});
function plain(html){const doc=parser.parseFromString('<div>'+html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<\/(?:p|div|h[1-6]|li|tr)>|<br\s*\/?\s*>/gi,'\n')+'</div>','text/html');return doc.documentElement.textContent;}
function sentences(text,location){
  const clean=text.normalize('NFKC').replace(/\u00ad/g,'').replace(/([a-z])-\s*\n\s*([a-z])/gi,'$1$2').replace(/\s+/g,' ').trim();
  return [...new Intl.Segmenter(/[\u3400-\u9fff]/.test(clean)?'zh':'en',{granularity:'sentence'}).segment(clean)]
    .map(item=>({text:item.segment.trim(),location})).filter(item=>item.text.length>=15&&item.text.length<=500&&/[.!?。！？]["”’']?$/.test(item.text)&&!/https?:\/\//i.test(item.text));
}
async function extractBook(file,format,onPart){
  if(format==='pdf'){
    const fonts=path.join(path.dirname(require.resolve('pdfjs-dist/package.json')),'standard_fonts').replaceAll(path.sep,'/')+'/';
    const pdf=await import('pdfjs-dist/legacy/build/pdf.mjs'),doc=await pdf.getDocument({data:new Uint8Array(fs.readFileSync(file)),isEvalSupported:false,disableFontFace:true,useSystemFonts:false,useWorkerFetch:false,standardFontDataUrl:fonts}).promise;
    try{for(let number=1;number<=doc.numPages;number++){const page=await doc.getPage(number),content=await page.getTextContent();await onPart(sentences(content.items.map(item=>item.str+(item.hasEOL?'\n':' ')).join(''),number));page.cleanup();}}finally{await doc.destroy();}return;
  }
  if(format==='docx'){
    const zip=await JSZip.loadAsync(fs.readFileSync(file)),xml=await zip.file('word/document.xml')?.async('string');if(!xml)throw Error('文档没有正文');
    const doc=parser.parseFromString(xml,'text/xml');for(const paragraph of Array.from(doc.getElementsByTagName('w:p')))await onPart(sentences(Array.from(paragraph.getElementsByTagName('w:t')).map(node=>node.textContent).join(''),0));return;
  }
  if(format==='epub'){
    const zip=await JSZip.loadAsync(fs.readFileSync(file)),container=parser.parseFromString(await zip.file('META-INF/container.xml').async('string'),'text/xml'),opfPath=container.getElementsByTagName('rootfile')[0].getAttribute('full-path'),opf=parser.parseFromString(await zip.file(opfPath).async('string'),'text/xml');
    const items=new Map(Array.from(opf.getElementsByTagName('item')).map(item=>[item.getAttribute('id'),item.getAttribute('href')]));
    for(const ref of Array.from(opf.getElementsByTagName('itemref'))){const href=items.get(ref.getAttribute('idref'));if(!href)continue;const name=path.posix.normalize(path.posix.join(path.posix.dirname(opfPath),decodeURIComponent(href.split('#')[0]))),part=zip.file(name);if(part)await onPart(sentences(plain(await part.async('string')),href));}return;
  }
  const {readText}=require('./document-files.cjs');const text=readText(file);
  await onPart(sentences(['html','htm'].includes(format)?plain(text):format==='md'?text.replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*#`]/g,''):text,0));
}
class ContextIndex{
  constructor(dataDir){
    this.dataDir=dataDir;this.db=new DatabaseSync(path.join(dataDir,'context-index.sqlite'));
    this.db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS books(id TEXT PRIMARY KEY,stamp TEXT); CREATE VIRTUAL TABLE IF NOT EXISTS sentences USING fts5(bookId UNINDEXED,text,location UNINDEXED,tokenize='unicode61');");
  }
  async update(books){
    const alive=new Set(books.map(book=>book.id));for(const row of this.db.prepare('SELECT id FROM books').all())if(!alive.has(row.id)){this.db.prepare('DELETE FROM sentences WHERE bookId=?').run(row.id);this.db.prepare('DELETE FROM books WHERE id=?').run(row.id);}
    const failures=[];
    for(const book of books){
      const file=path.join(this.dataDir,'books',book.id+'.'+book.format);let info;try{info=fs.statSync(file);}catch{this.db.prepare('DELETE FROM sentences WHERE bookId=?').run(book.id);this.db.prepare('DELETE FROM books WHERE id=?').run(book.id);continue;}const stamp='2:'+info.size+':'+info.mtimeMs;
      if(this.db.prepare('SELECT stamp FROM books WHERE id=?').get(book.id)?.stamp===stamp)continue;
      this.db.exec('BEGIN');try{
        this.db.prepare('DELETE FROM sentences WHERE bookId=?').run(book.id);const insert=this.db.prepare('INSERT INTO sentences(bookId,text,location) VALUES(?,?,?)');
        await extractBook(file,book.format,async rows=>{for(const row of rows)insert.run(book.id,row.text,String(row.location));await new Promise(resolve=>setImmediate(resolve));});
        this.db.prepare('INSERT OR REPLACE INTO books VALUES(?,?)').run(book.id,stamp);this.db.exec('COMMIT');
      }catch(error){this.db.exec('ROLLBACK');failures.push({bookId:book.id,error:error.message.slice(0,120)});}
    }
    return failures;
  }
  search(word,books,limit=8){
    if(!word||word.length>100)return [];
    const query='"'+word.replace(/"/g,'""')+'"',rows=/[\u3400-\u9fff]/.test(word)?this.db.prepare('SELECT bookId,text,location FROM sentences WHERE instr(text,?)>0 LIMIT 200').all(word):this.db.prepare('SELECT bookId,text,location FROM sentences WHERE sentences MATCH ? LIMIT 200').all(query);
    const sources=new Map(books.map(book=>[book.id,book])),seen=new Set(),result=[];
    for(const row of rows){const book=sources.get(row.bookId);if(!book||seen.has(row.text.toLowerCase())||[...row.text.matchAll(targetPattern(word,/[\u3400-\u9fff]/.test(word)?'zh':'en'))].length!==1)continue;
      seen.add(row.text.toLowerCase());result.push({sentence:row.text,target:word,bookId:row.bookId,bookTitle:book.title,location:book.format==='pdf'?Number(row.location):row.location});if(result.length>=limit)break;}
    return result;
  }
  close(){this.db.close();}
}
module.exports={ContextIndex,extractBook,sentences};
