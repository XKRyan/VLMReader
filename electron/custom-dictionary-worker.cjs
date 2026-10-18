const {parentPort,workerData}=require('node:worker_threads'),fs=require('node:fs'),path=require('node:path');
const {readDictionary,key}=require('./dictionary-files.cjs');
const SCHEMA='CREATE TABLE entries (word TEXT PRIMARY KEY COLLATE NOCASE, phonetic TEXT, translation TEXT, definition TEXT, exchange TEXT, tags TEXT, examples TEXT, collocations TEXT, html TEXT)';
const MERGE='INSERT INTO entries VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(word) DO UPDATE SET'
  +' translation=trim(entries.translation||char(10)||excluded.translation),'
  +' definition=trim(entries.definition||char(10)||excluded.definition),'
  +' html=entries.html||excluded.html';
// A large MDX cannot be held as one result set, so it is streamed block by block
// straight into SQLite. Everything else keeps the portable sql.js path.
async function streamed(){
  const {DatabaseSync}=require('node:sqlite');
  const {streamMdx,textOf,extractArticle}=require('./mdx-dictionary.cjs');
  const database=new DatabaseSync(workerData.dest);
  try{
    database.exec('PRAGMA journal_mode=OFF;PRAGMA synchronous=OFF;'+SCHEMA);
    const insert=database.prepare(MERGE);
    // MDict aliases ("@@@LINK=目标词") are resolved after the scan so a variant
    // headword returns the same article as its canonical entry.
    const resolve=database.prepare('INSERT OR IGNORE INTO entries SELECT ?,phonetic,translation,definition,exchange,tags,examples,collocations,html FROM entries WHERE word=?');
    const links=new Map();
    const seen=new Set();
    let count=0,duplicates=0;
    const sample=[];
    database.exec('BEGIN');
    const info=streamMdx(workerData.file,{onRow({word,article}){
      if(article.startsWith('@@@LINK=')){
        const target=article.slice(8).split(/\r?\n/)[0].trim();
        if(target&&!links.has(word))links.set(word,target);
        return;
      }
      if(/^freemdict$/i.test(word)||article.includes('Spidered by FreeMdict'))return;
      const parsed=extractArticle(article);
      const text=parsed.gloss||textOf(article).slice(0,4000);
      if(!text)return;
      const folded=key(word);
      if(!folded)return;
      if(seen.has(folded))duplicates++;
      else{seen.add(folded);count++;if(sample.length<3)sample.push({word,translation:text.slice(0,200)});}
      insert.run(word,parsed.phonetic,text,text,'','',JSON.stringify(parsed.examples),JSON.stringify(parsed.collocations),article);
    }});
    for(const [word,target] of links){
      const folded=key(word);
      if(!folded||seen.has(folded))continue;
      seen.add(folded);
      if(resolve.run(word,target).changes)count++;
    }
    database.exec('COMMIT');
    try{database.exec('VACUUM');}catch{}
    return {name:info.name,count,duplicates,sample};
  }finally{database.close();}
}
async function portable(){
  const plan=readDictionary(workerData.file),init=require('sql.js'),SQL=await init({locateFile:file=>path.join(path.dirname(require.resolve('sql.js/dist/sql-wasm.js')),file)}),db=new SQL.Database();
  db.run(SCHEMA);
  const insert=db.prepare('INSERT OR REPLACE INTO entries VALUES (?,?,?,?,?,?,?,?,?)'),seen=new Set();let duplicates=0;
  db.run('BEGIN');for(const row of plan.words){if(seen.has(key(row.word))){duplicates++;continue;}seen.add(key(row.word));insert.run([row.word,row.phonetic,row.translation,row.definition,row.exchange,row.tags,JSON.stringify(row.examples),JSON.stringify(row.collocations),row.html||'']);}insert.free();db.run('COMMIT');
  fs.writeFileSync(workerData.dest,Buffer.from(db.export()));db.close();
  return {name:plan.name,count:seen.size,duplicates,sample:plan.words.slice(0,3).map(row=>({word:row.word,translation:row.translation||row.definition}))};
}
(async()=>{
  const ext=path.extname(workerData.file).toLowerCase();
  let native=false;
  try{native=!!require('node:sqlite').DatabaseSync;}catch{}
  try{
    const result=ext==='.mdx'&&native?await streamed():await portable();
    parentPort.postMessage(result);
  }catch(error){
    try{fs.unlinkSync(workerData.dest);}catch{}
    parentPort.postMessage({error:error.message});
  }
})();
