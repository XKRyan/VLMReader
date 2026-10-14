const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{Worker}=require('node:worker_threads');
const {validate,key}=require('./dictionary-files.cjs');
function atomic(file,value){const tmp=file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify(value));fs.renameSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}}
class CustomDictionaries{
  constructor(dataDir){
    this.dir=path.join(dataDir,'dictionaries');fs.mkdirSync(this.dir,{recursive:true});this.file=path.join(this.dir,'catalog.json');this.personalFile=path.join(this.dir,'personal.json');this.catalog=[];this.personal=[];this.cache=new Map();this.plans=new Map();this.revision=0;
    this.problem='';
    try{
      if(fs.existsSync(this.file))this.catalog=JSON.parse(fs.readFileSync(this.file,'utf8'));
      if(!Array.isArray(this.catalog)||this.catalog.some(item=>!item||!/^[\da-f-]{36}$/.test(item.id)||typeof item.name!=='string'||typeof item.enabled!=='boolean'))throw Error('invalid catalog');
      if(fs.existsSync(this.personalFile))this.personal=JSON.parse(fs.readFileSync(this.personalFile,'utf8')).map(validate);
      if(this.catalog.some(item=>!fs.existsSync(this.dbFile(item.id))))throw Error('missing file');
    }catch{this.problem='自定义词典文件损坏或缺失，请从备份恢复';this.catalog=[];this.personal=[];}

  }
  dbFile(id){if(!/^[\da-f-]{36}$/.test(id))throw Error('词典不存在');return path.join(this.dir,id+'.sqlite');}
  guard(){if(this.problem)throw Error(this.problem);}
  list(){this.guard();return [{id:'personal',name:'我的词典',count:this.personal.length,enabled:true,editable:true},...this.catalog.map(item=>({...item,editable:false}))];}
  async preview(file){
    this.guard();
    if(this.importing)throw Error('已有词典正在导入，请稍候');this.importing=true;
    try{
      const id=crypto.randomUUID(),dest=this.dbFile(id),workerFile=path.join(__dirname.replace('app.asar','app.asar.unpacked'),'custom-dictionary-worker.cjs');
      const result=await new Promise((resolve,reject)=>{const worker=new Worker(workerFile,{workerData:{file,dest}});let settled=false;worker.once('message',result=>{settled=true;result.error?reject(Error(result.error)):resolve(result);});worker.once('error',reject);worker.once('exit',code=>{if(!settled)reject(Error('词典处理未完成：'+code));});});
      for(const [token,plan]of this.plans){fs.unlinkSync(this.dbFile(token));this.plans.delete(token);}
      this.plans.set(id,{...result,created:Date.now()});return {token:id,...result};
    }finally{this.importing=false;}
  }
  commit(token,name){
    this.guard();
    const plan=this.plans.get(token);if(!plan)throw Error('词典预览已过期，请重新选择文件');
    const item={id:token,name:String(name||plan.name).trim().slice(0,80),count:plan.count,enabled:true,createdAt:new Date().toISOString()};if(!item.name)throw Error('请填写词典名称');
    const next=[...this.catalog,item];atomic(this.file,next);this.catalog=next;this.plans.delete(token);this.revision++;return item;
  }
  discard(token){if(this.plans.has(token)){fs.unlinkSync(this.dbFile(token));this.plans.delete(token);}return true;}
  update(id,enabled){
    this.guard();
    if(typeof enabled!=='boolean'||!this.catalog.some(item=>item.id===id))throw Error('词典不存在');const next=this.catalog.map(item=>item.id===id?{...item,enabled}:item);atomic(this.file,next);this.catalog=next;this.cache.get(id)?.close();this.cache.delete(id);this.revision++;return true;
  }
  remove(id){
    this.guard();
    if(!this.catalog.some(item=>item.id===id))throw Error('词典不存在');const next=this.catalog.filter(item=>item.id!==id);atomic(this.file,next);this.catalog=next;this.cache.get(id)?.close();this.cache.delete(id);try{fs.unlinkSync(this.dbFile(id));}catch{}this.revision++;return true;
  }
  personalEntries(){return this.personal;}
  savePersonal(input,oldWord){
    this.guard();
    const row=validate({...this.personal.find(item=>key(item.word)===key(oldWord)),...input});if(oldWord&&!this.personal.some(item=>key(item.word)===key(oldWord)))throw Error('自定义词条不存在');
    if(this.personal.some(item=>key(item.word)===key(row.word)&&key(item.word)!==key(oldWord)))throw Error('已有同名词条，请编辑原词条');
    const next=[...this.personal.filter(item=>key(item.word)!==key(oldWord)),row].sort((a,b)=>a.word.localeCompare(b.word));atomic(this.personalFile,next);this.personal=next;this.revision++;return row;
  }
  deletePersonal(word){this.guard();const next=this.personal.filter(item=>key(item.word)!==key(word));atomic(this.personalFile,next);this.personal=next;this.revision++;return true;}
  async lookup(word){
    if(this.problem)return [];
    const rows=[],mine=this.personal.find(item=>key(item.word)===key(word));if(mine)rows.push({...mine,source:'我的词典'});
    if(!this.SQL){const init=require('sql.js');this.SQL=await init({locateFile:file=>path.join(path.dirname(require.resolve('sql.js/dist/sql-wasm.js')),file)});}
    for(const item of this.catalog.filter(item=>item.enabled)){
      let db=this.cache.get(item.id);if(!db){while(this.cache.size>=2){const [id,old]=this.cache.entries().next().value;old.close();this.cache.delete(id);}db=new this.SQL.Database(fs.readFileSync(this.dbFile(item.id)));this.cache.set(item.id,db);}
      const query=db.prepare('SELECT * FROM entries WHERE word=? COLLATE NOCASE');try{query.bind([word]);if(query.step()){const row=query.getAsObject();rows.push({...row,examples:JSON.parse(row.examples),collocations:JSON.parse(row.collocations),source:item.name});}}finally{query.free();}
    }return rows;
  }
}
module.exports={CustomDictionaries};
