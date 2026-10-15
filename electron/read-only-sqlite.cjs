const fs=require('node:fs'),path=require('node:path');
let nativeDatabase;
try{nativeDatabase=require('node:sqlite').DatabaseSync;}catch{/* Older runtimes retain the portable reader. */}
let portableSQL;
async function portable(){
  if(!portableSQL){const init=require('sql.js');portableSQL=init({locateFile:file=>path.join(path.dirname(require.resolve('sql.js/dist/sql-wasm.js')),file)}).catch(error=>{portableSQL=null;throw error;});}
  return portableSQL;
}
class NativeStatement{
  constructor(owner,sql){this.owner=owner;this.statement=owner.db.prepare(sql);this.iterator=null;this.row=null;owner.statements.add(this);}
  bind(values=[]){this.reset();this.iterator=this.statement.iterate(...values);return true;}
  step(){if(!this.iterator)this.iterator=this.statement.iterate();const item=this.iterator.next();this.row=item.done?null:item.value;return !item.done;}
  getAsObject(){return this.row?{...this.row}:{};}
  reset(){this.iterator?.return();this.iterator=null;this.row=null;return true;}
  free(){this.reset();this.statement=null;this.owner.statements.delete(this);}
}
class NativeDatabase{
  constructor(file){
    this.engine='native';this.statements=new Set();this.db=new nativeDatabase(file,{readOnly:true});
    // Keep indexed dictionaries file-backed instead of copying their entire
    // contents into a WASM heap. Each connection has a bounded 4 MiB page cache.
    try{this.db.exec('PRAGMA query_only=ON; PRAGMA cache_size=-4096; PRAGMA mmap_size=0;');}catch(error){this.db.close();throw error;}
  }
  prepare(sql){return new NativeStatement(this,sql);}
  exec(sql){const rows=this.db.prepare(sql).all();if(!rows.length)return [];const columns=Object.keys(rows[0]);return [{columns,values:rows.map(row=>columns.map(name=>row[name]))}];}
  close(){if(!this.db)return;for(const statement of [...this.statements])statement.free();this.db.close();this.db=null;}
}
async function openReadOnlyDatabase(file,{native=true}={}){
  if(native&&nativeDatabase)return new NativeDatabase(file);
  const SQL=await portable(),db=new SQL.Database(fs.readFileSync(file));db.run('PRAGMA query_only=ON');db.engine='portable';return db;
}
module.exports={openReadOnlyDatabase};
