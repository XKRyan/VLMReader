const {parentPort,workerData}=require('node:worker_threads'),fs=require('node:fs'),path=require('node:path');
const {readDictionary,key}=require('./dictionary-files.cjs');
(async()=>{
  const plan=readDictionary(workerData.file),init=require('sql.js'),SQL=await init({locateFile:file=>path.join(path.dirname(require.resolve('sql.js/dist/sql-wasm.js')),file)}),db=new SQL.Database();
  db.run('CREATE TABLE entries (word TEXT PRIMARY KEY COLLATE NOCASE, phonetic TEXT, translation TEXT, definition TEXT, exchange TEXT, tags TEXT, examples TEXT, collocations TEXT)');
  const insert=db.prepare('INSERT OR REPLACE INTO entries VALUES (?,?,?,?,?,?,?,?)'),seen=new Set();let duplicates=0;
  db.run('BEGIN');for(const row of plan.words){if(seen.has(key(row.word))){duplicates++;continue;}seen.add(key(row.word));insert.run([row.word,row.phonetic,row.translation,row.definition,row.exchange,row.tags,JSON.stringify(row.examples),JSON.stringify(row.collocations)]);}insert.free();db.run('COMMIT');
  fs.writeFileSync(workerData.dest,Buffer.from(db.export()));db.close();parentPort.postMessage({name:plan.name,count:seen.size,duplicates,sample:plan.words.slice(0,3).map(row=>({word:row.word,translation:row.translation||row.definition}))});
})().catch(error=>{try{fs.unlinkSync(workerData.dest);}catch{}parentPort.postMessage({error:error.message});});
