const fs = require('node:fs');
const path = require('node:path');
let loading;
class Dictionary {
  constructor(assets) { this.assets=assets; }
  async init() {
    if(this.db) return;
    if(this.promise) return this.promise;
    this.promise = (async()=>{
      const init = require('sql.js');
      const SQL = await init({ locateFile: file => path.join(path.dirname(require.resolve('sql.js/dist/sql-wasm.js')),file) });
      this.db = new SQL.Database(fs.readFileSync(path.join(this.assets,'dictionary.sqlite')));
      this.statement = this.db.prepare('SELECT * FROM entries WHERE word = ? COLLATE NOCASE');
    })();
    try { await this.promise; } catch(err) { this.promise=null; throw err; }
  }
  query(word) {
    this.statement.bind([word]);
    const entry = this.statement.step() ? this.statement.getAsObject() : null;
    this.statement.reset(); return entry;
  }
  async lookup(text) {
    const cleaned=String(text).normalize('NFKC').trim().replace(/^[“”"'‘’.,!?;:()[\]{}]+|[“”"'‘’.,!?;:()[\]{}]+$/g,'');
    if(!cleaned || cleaned.length>150) return null;
    await this.init();
    let found=this.query(cleaned); if(found) return found;
    if(/^[a-z'-]+$/i.test(cleaned)) {
      const w=cleaned.toLowerCase();
      const candidates = new Set([w.replace(/’/g,"'")]);
      if(w.endsWith('ies')) candidates.add(w.slice(0,-3)+'y');
      if(w.endsWith('ves')) {candidates.add(w.slice(0,-3)+'f'); candidates.add(w.slice(0,-3)+'fe');}
      if(w.endsWith('s')) {candidates.add(w.slice(0,-1));candidates.add(w.slice(0,-2));}
      for(const suffix of ['ing','ed','er','est']) if(w.endsWith(suffix)) {
        const base=w.slice(0,-suffix.length); candidates.add(base); candidates.add(base+'e');
        if(/(.)\1$/.test(base)) candidates.add(base.slice(0,-1));
      }
      for(const item of candidates) {found=this.query(item);if(found)return {...found,original:cleaned};}
    }
    return null;
  }
}
module.exports={ Dictionary };
