const fs = require('node:fs');
const path = require('node:path');
let loading;
const {lemmaCandidates,forms,normalizeRow}=require('./dictionary-policy.cjs');
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
      const supplemental=path.join(this.assets,'wordnet','wordnet.sqlite');
      if(fs.existsSync(supplemental)){this.wordnet=new SQL.Database(fs.readFileSync(supplemental));this.senses=this.wordnet.prepare('SELECT meanings.pos,meanings.definition FROM lexemes JOIN senses USING(lexicalId) JOIN meanings USING(synset) WHERE lexemes.word = ? ORDER BY senses.rowid LIMIT 128');}
    })();
    try { await this.promise; } catch(err) { this.promise=null; throw err; }
  }
  query(word) {
    this.statement.bind([word]);
    const entry = this.statement.step() ? this.statement.getAsObject() : null;
    this.statement.reset(); return entry;
  }
  clean(text){return String(text).normalize('NFKC').trim().replace(/^[“”"'‘’.,!?;:()[\]{}]+|[“”"'‘’.,!?;:()[\]{}]+$/g,'');}
  enrich(row){
    if(!row||!this.senses)return row;
    this.senses.bind([row.word.toLowerCase()]);const lines=[];
    while(this.senses.step()){const sense=this.senses.getAsObject();if(sense.definition)lines.push(sense.pos+'. '+sense.definition);}
    this.senses.reset();return {...row,definition:[...new Set([...lines,...String(row.definition||'').split(/\r?\n/)])].filter(Boolean).join('\n')};
  }
  async rawLookup(text){
    const cleaned=this.clean(text);if(!cleaned||cleaned.length>150)return null;
    await this.init();return this.query(cleaned);
  }
  async lookup(text) {
    const cleaned=this.clean(text);
    if(!cleaned || cleaned.length>150) return null;
    await this.init();
    const found=this.query(cleaned);let parent;
    for(const candidate of lemmaCandidates(cleaned,found)){
      const row=this.query(candidate);if(!row)continue;
      const explicit=String(found?.exchange||'').split('/').some(part=>part.toLowerCase()==='0:'+candidate);
      if(explicit||forms(row).includes(cleaned.toLowerCase())){parent=row;break;}
    }
    if(found)return normalizeRow(this.enrich(found),this.enrich(parent),cleaned);
    return parent?{...normalizeRow(this.enrich(parent),null,cleaned),original:cleaned}:null;
  }
}
module.exports={ Dictionary };
