const fs = require('node:fs');
const path = require('node:path');
const {lemmaCandidates,forms,normalizeRow}=require('./dictionary-policy.cjs');
const {CustomDictionaries}=require('./custom-dictionaries.cjs');
class Dictionary {
  constructor(assets,dataDir) { this.assets=assets;if(dataDir)this.custom=new CustomDictionaries(dataDir); }
  async init() {
    if(this.db) return;
    if(this.promise) return this.promise;
    this.promise = (async()=>{
      const init = require('sql.js');
      const SQL = await init({ locateFile: file => path.join(path.dirname(require.resolve('sql.js/dist/sql-wasm.js')),file) });
      this.db = new SQL.Database(fs.readFileSync(path.join(this.assets,'dictionary.sqlite')));
      this.statement = this.db.prepare('SELECT * FROM entries WHERE word = ? COLLATE NOCASE');
      const supplemental=path.join(this.assets,'wordnet','wordnet.sqlite');
      if(fs.existsSync(supplemental)){this.wordnet=new SQL.Database(fs.readFileSync(supplemental));this.senses=this.wordnet.prepare('SELECT meanings.* FROM lexemes JOIN senses USING(lexicalId) JOIN meanings USING(synset) WHERE lexemes.word = ? ORDER BY senses.rowid LIMIT 128');}
      if(this.db.exec("SELECT name FROM sqlite_master WHERE name='phrases'").length)this.phrases=this.db.prepare('SELECT DISTINCT phrase,translation FROM phrases WHERE headword=? ORDER BY length(phrase),phrase LIMIT 16');
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
    this.senses.bind([row.word.toLowerCase()]);const lines=[],examples=[];
    while(this.senses.step()){const sense=this.senses.getAsObject();if(sense.definition)lines.push(sense.pos+'. '+sense.definition);for(const sentence of JSON.parse(sense.examples||'[]'))if(!examples.some(item=>item.text===sentence))examples.push({text:sentence,translation:'',source:'Open English WordNet'});}
    this.senses.reset();return {...row,definition:[...new Set([...lines,...String(row.definition||'').split(/\r?\n/)])].filter(Boolean).join('\n'),examples:examples.slice(0,16)};
  }
  async rawLookup(text){
    const cleaned=this.clean(text);if(!cleaned||cleaned.length>150)return null;
    await this.init();return this.query(cleaned);
  }
  async builtInLookup(text) {
    const cleaned=this.clean(text);
    if(!cleaned || cleaned.length>150) return null;
    await this.init();
    const found=this.query(cleaned);let parent;
    for(const candidate of lemmaCandidates(cleaned,found)){
      const row=this.query(candidate);if(!row)continue;
      const explicit=String(found?.exchange||'').split('/').some(part=>part.toLowerCase()==='0:'+candidate);
      if(explicit||forms(row).includes(cleaned.toLowerCase())){parent=row;break;}
    }
    let result=found?normalizeRow(this.enrich(found),this.enrich(parent),cleaned):parent?{...normalizeRow(this.enrich(parent),null,cleaned),original:cleaned}:null;
    if(!result){const fallback=this.enrich({word:cleaned.toLowerCase(),translation:'',definition:'',phonetic:'',tags:'',exchange:'',source:'Open English WordNet'});if(fallback.definition)result={...fallback,cueWords:[cleaned]};}
    if(result){if(parent)result.examples=this.enrich(parent).examples||result.examples;result.collocations=[];if(this.phrases){this.phrases.bind([(result.lemma||result.word).toLowerCase()]);while(this.phrases.step()){const row=this.phrases.getAsObject();result.collocations.push({text:row.phrase,translation:row.translation,source:'ECDICT'});}this.phrases.reset();}}
    return result;
  }
  async lookup(text){
    const cleaned=this.clean(text);if(!cleaned||cleaned.length>150)return null;
    const built=await this.builtInLookup(cleaned),custom=this.custom?await this.custom.lookup(cleaned):[];
    if(!custom.length)return built;
    const main=custom[0],sections=[...custom,...(built?[built]:[])],unique=values=>[...new Set(values.filter(Boolean))];
    return {...built,...main,cueWords:unique([cleaned,...(built?.cueWords||[])]),definition:unique(sections.map(row=>row.definition)).join('\n'),translation:main.translation||built?.translation||'',phonetic:main.phonetic||built?.phonetic||'',exchange:main.exchange||built?.exchange||'',examples:sections.flatMap(row=>(row.examples||[]).map(item=>({...item,source:item.source||row.source}))).slice(0,20),collocations:sections.flatMap(row=>(row.collocations||[]).map(item=>({...item,source:item.source||row.source}))).slice(0,20),sections};
  }
  async synonyms(word){
    await this.init();if(!this.wordnet)return [];
    const found=await this.builtInLookup(word),target=(found?.lemma||word).toLowerCase();
    const query=this.wordnet.prepare('SELECT DISTINCT related.word,meanings.pos,meanings.definition FROM lexemes own JOIN senses a ON own.lexicalId=a.lexicalId JOIN meanings ON meanings.synset=a.synset JOIN senses b ON b.synset=a.synset JOIN lexemes related ON related.lexicalId=b.lexicalId WHERE own.word=? AND related.word<>? LIMIT 12');
    const result=[];try{query.bind([target,target]);while(query.step()){const row=query.getAsObject(),translation=this.query(row.word)?.translation||'';result.push({word:row.word,pos:row.pos,meaning:translation.split('\n')[0],note:row.definition,source:'Open English WordNet'});}}finally{query.free();}return result;
  }
}
module.exports={ Dictionary };
