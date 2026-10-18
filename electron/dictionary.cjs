const fs = require('node:fs');
const path = require('node:path');
const {lemmaCandidates,forms,normalizeRow}=require('./dictionary-policy.cjs');
const {CustomDictionaries}=require('./custom-dictionaries.cjs');
const {openReadOnlyDatabase}=require('./read-only-sqlite.cjs');
class Dictionary {
  static SOURCES=['ecdict','cedict','wiktionary','wordnet'];
  constructor(assets,dataDir) { this.assets=assets;this.sources=new Set(Dictionary.SOURCES);if(dataDir)this.custom=new CustomDictionaries(dataDir); }
  setSources(list){this.sources=new Set(Array.isArray(list)?list.filter(id=>Dictionary.SOURCES.includes(id)):Dictionary.SOURCES);}
  enabled(id){return this.sources.has(id);}
  async init() {
    if(this.promise) return this.promise;
    if(this.db) return;
    this.promise = (async()=>{
      this.db = await openReadOnlyDatabase(path.join(this.assets,'dictionary.sqlite'));
      this.statement = this.db.prepare('SELECT * FROM entries WHERE word = ? COLLATE NOCASE');
      const supplemental=path.join(this.assets,'wordnet','wordnet.sqlite');
      if(fs.existsSync(supplemental)){this.wordnet=await openReadOnlyDatabase(supplemental);this.senses=this.wordnet.prepare('SELECT meanings.* FROM lexemes JOIN senses USING(lexicalId) JOIN meanings USING(synset) WHERE lexemes.word = ? ORDER BY senses.rowid LIMIT 128');}
      const wiktionary=path.join(this.assets,'wiktionary','wiktionary.sqlite');
      if(fs.existsSync(wiktionary)){this.reference=await openReadOnlyDatabase(wiktionary);this.glosses=this.reference.prepare('SELECT phonetic,definition,examples,roles FROM entries WHERE word = ?');}
      if(this.db.exec("SELECT name FROM sqlite_master WHERE name='phrases'").length)this.phrases=this.db.prepare('SELECT DISTINCT phrase,translation FROM phrases WHERE headword=? ORDER BY length(phrase),phrase LIMIT 16');
    })();
    try { await this.promise; } catch(err) { this.close(); throw err; }
  }
  query(word) {
    this.statement.bind([word]);
    const entry = this.statement.step() ? this.statement.getAsObject() : null;
    this.statement.reset();
    if(!entry)return null;
    const source=String(entry.source||'');
    return this.enabled(source==='CC-CEDICT'?'cedict':'ecdict')?entry:null;
  }
  clean(text){return String(text).normalize('NFKC').trim().replace(/^[“”"'‘’.,!?;:()[\]{}]+|[“”"'‘’.,!?;:()[\]{}]+$/g,'');}
  glossesFor(word){
    if(!this.glosses)return null;
    this.glosses.bind([String(word||'').toLowerCase()]);
    const row=this.glosses.step()?this.glosses.getAsObject():null;
    this.glosses.reset();
    if(!row)return null;
    let examples=[];try{examples=JSON.parse(row.examples||'[]');}catch{}
    return {phonetic:row.phonetic||'',definition:row.definition||'',roles:row.roles||'',examples:examples.filter(text=>typeof text==='string').map(text=>({text,translation:'',source:'Wiktionary'}))};
  }
  sensesFor(word){
    if(!this.senses)return {lines:[],examples:[]};
    this.senses.bind([String(word||'').toLowerCase()]);const lines=[],examples=[];
    while(this.senses.step()){const sense=this.senses.getAsObject();if(sense.definition)lines.push(sense.pos+'. '+sense.definition);for(const sentence of JSON.parse(sense.examples||'[]'))if(!examples.some(item=>item.text===sentence))examples.push({text:sentence,translation:'',source:'Open English WordNet'});}
    this.senses.reset();return {lines,examples};
  }
  enrich(row){
    if(!row)return row;
    const reference=this.enabled('wiktionary')?this.glossesFor(row.word):null,supplement=this.enabled('wordnet')?this.sensesFor(row.word):{lines:[],examples:[]};
    if(!reference&&!supplement.lines.length&&!supplement.examples.length)return row;
    const definition=[...(reference?.definition||'').split(/\r?\n/),...supplement.lines,...String(row.definition||'').split(/\r?\n/)].map(value=>value.trim()).filter(Boolean);
    const examples=[...(reference?.examples||[]),...supplement.examples,...(row.examples||[])],seen=new Set();
    return {...row,phonetic:row.phonetic||reference?.phonetic||'',definition:[...new Set(definition)].join('\n'),examples:examples.filter(item=>{if(!item.text||seen.has(item.text))return false;seen.add(item.text);return true;}).slice(0,16)};
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
    if(!result){const fallback=this.enrich({word:cleaned.toLowerCase(),translation:'',definition:'',phonetic:'',tags:'',exchange:'',source:this.glosses&&this.enabled('wiktionary')?'Wiktionary':'Open English WordNet'});if(fallback.definition)result={...fallback,cueWords:[cleaned]};}
    if(result){if(parent)result.examples=this.enrich(parent).examples||result.examples;result.collocations=[];if(this.phrases&&this.enabled('ecdict')){this.phrases.bind([(result.lemma||result.word).toLowerCase()]);while(this.phrases.step()){const row=this.phrases.getAsObject(),translation=String(row.translation||'').replace(/^\[(?:网络|地名|人名|英格兰人姓氏)\]\s*/,'').trim();if(!translation)continue;result.collocations.push({text:row.phrase,translation,source:'ECDICT'});}this.phrases.reset();}}
    return result;
  }
  async lookup(text){
    const cleaned=this.clean(text);if(!cleaned||cleaned.length>150)return null;
    const built=await this.builtInLookup(cleaned);let custom=this.custom?await this.custom.lookup(cleaned):[];
    // English reference dictionaries often index the lemma rather than every form.
    const lemma=built?.lemma||built?.word;if(this.custom&&lemma&&lemma.toLowerCase()!==cleaned.toLowerCase()){
      const inherited=await this.custom.lookup(lemma);for(const row of inherited)if(!custom.some(item=>item.source===row.source))custom.push(row);
    }
    if(!custom.length&&!built){
      // Words no dictionary covers can be filled from earlier AI translations.
      const ai=this.custom?.aiLookup(cleaned);if(ai)return {...ai,source:'AI 补充',cueWords:[...new Set([cleaned,ai.lemma].filter(Boolean))]};
    }
    if(!custom.length)return built;
    // The catalog order is the display priority: the first enabled dictionary
    // with gloss text becomes the primary source, so reordering in 管理词典
    // directly changes which dictionary is shown on top.
    const main=custom.find(row=>String(row.translation||'').trim())||custom.find(row=>String(row.definition||'').trim())||custom[0],sections=[...custom,...(built?[built]:[])],unique=values=>[...new Set(values.filter(Boolean))];
    // A bilingual edition often carries no IPA of its own; borrow the reading
    // from any other enabled dictionary, preferring one with stress marks.
    const readings=[main,...custom,...(built?[built]:[])].map(row=>String(row&&row.phonetic||'').trim()).filter(Boolean);
    const reading=readings.find(value=>/[\u02c8\u02cc]/.test(value))||readings.find(value=>value.includes('\u02d0'))||readings[0]||'';
    const reference=!!main.html&&!main.translation;
    return {...built,...main,word:built?.word||main.word,cueWords:unique([cleaned,...(built?.cueWords||[])]),source:reference&&built?built.source:main.source,definition:reference?built?.definition||main.definition:unique(sections.filter(row=>!row.html).map(row=>row.definition)).join('\n'),translation:main.translation||built?.translation||'',phonetic:reading,exchange:main.exchange||built?.exchange||'',examples:sections.flatMap(row=>(row.examples||[]).map(item=>({...item,source:item.source||row.source}))).sort((a,b)=>(b.translation?1:0)-(a.translation?1:0)).slice(0,20),collocations:sections.flatMap(row=>(row.collocations||[]).map(item=>({...item,source:item.source||row.source}))).slice(0,20),sections};
  }
  // Gloss from the user's own dictionaries only, in their 管理词典 order.
  async customGloss(text){
    const cleaned=this.clean(text);if(!this.custom||!cleaned||cleaned.length>150)return null;
    const usable=row=>String(row.translation||row.definition||'').trim();
    let rows=await this.custom.lookup(cleaned);
    if(!rows.some(usable)){const built=await this.builtInLookup(cleaned),lemma=built?.lemma||built?.word;if(lemma&&lemma.toLowerCase()!==cleaned.toLowerCase())rows=await this.custom.lookup(lemma);}
    const main=rows.find(row=>String(row.translation||'').trim())||rows.find(usable);
    return main?{translation:String(main.translation||main.definition).trim(),source:main.source}:null;
  }
  async synonyms(word){
    await this.init();if(!this.wordnet||!this.enabled('wordnet'))return [];
    const found=await this.builtInLookup(word),target=(found?.lemma||word).toLowerCase();
    const query=this.wordnet.prepare('SELECT DISTINCT related.word,meanings.pos,meanings.definition FROM lexemes own JOIN senses a ON own.lexicalId=a.lexicalId JOIN meanings ON meanings.synset=a.synset JOIN senses b ON b.synset=a.synset JOIN lexemes related ON related.lexicalId=b.lexicalId WHERE own.word=? AND related.word<>? LIMIT 12');
    const result=[];try{query.bind([target,target]);while(query.step()){const row=query.getAsObject(),translation=this.query(row.word)?.translation||'';result.push({word:row.word,pos:row.pos,meaning:translation.split('\n')[0],note:row.definition,source:'Open English WordNet'});}}finally{query.free();}return result;
  }
  close(){this.statement?.free();this.senses?.free();this.glosses?.free();this.phrases?.free();this.statement=this.senses=this.glosses=this.phrases=null;this.db?.close();this.wordnet?.close();this.reference?.close();this.db=this.wordnet=this.reference=null;this.promise=null;this.custom?.close();}
}
module.exports={ Dictionary };
