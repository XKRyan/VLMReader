const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
// A small, separate file keeps lookup history out of library.json, which is
// several megabytes and rewritten on every study change.
const LIMIT=60;
class DictionaryHistory{
  constructor(dir){
    this.file=path.join(dir,'dictionary-history.json');
    this.items=this.read();
  }
  read(){
    try{
      if(!fs.existsSync(this.file))return [];
      const parsed=JSON.parse(fs.readFileSync(this.file,'utf8'));
      if(!Array.isArray(parsed))return [];
      return parsed.filter(item=>item&&typeof item.word==='string'&&item.word.trim()&&typeof item.at==='string').slice(0,LIMIT);
    }catch{return [];}
  }
  write(){
    const temporary=this.file+'.'+crypto.randomUUID()+'.tmp';
    try{fs.writeFileSync(temporary,JSON.stringify(this.items));fs.renameSync(temporary,this.file);}
    catch{/* history must never break a lookup */}
    finally{try{fs.unlinkSync(temporary);}catch{}}
  }
  list(){return this.items;}
  add(input){
    const word=String(input&&input.word||'').trim().replace(/\s+/g,' ').slice(0,120);
    if(!word)return this.items;
    const folded=word.toLowerCase();
    const entry={
      word,
      source:String(input.source||'').slice(0,80),
      meaning:String(input.meaning||'').replace(/\s+/g,' ').trim().slice(0,200),
      at:new Date().toISOString(),
    };
    this.items=[entry,...this.items.filter(item=>item.word.toLowerCase()!==folded)].slice(0,LIMIT);
    this.write();
    return this.items;
  }
  clear(){this.items=[];this.write();return this.items;}
}
module.exports={DictionaryHistory,LIMIT};
