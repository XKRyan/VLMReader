const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {mobiFixture}=require('./mobi-fixture.cjs'),{readDictionary}=require('../electron/dictionary-files.cjs'),{CustomDictionaries}=require('../electron/custom-dictionaries.cjs'),{Dictionary}=require('../electron/dictionary.cjs');
const {palmDoc,withoutTrailers}=require('../electron/mobi-dictionary.cjs');
const services=new Map();
function fixture(t,data){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vlm-mobi-')),file=path.join(dir,'sample.mobi');services.set(dir,[]);fs.writeFileSync(file,data);t.after(()=>{for(const service of services.get(dir))service.close();services.delete(dir);fs.rmSync(dir,{recursive:true,force:true});});return {dir,file};}
function dictionary(dir){const service=new Dictionary(path.resolve('assets'),dir);services.get(dir).push(service);return service;}
test('MOBI7 uncompressed and PalmDOC imports preserve Unicode articles and merge case aliases without losing senses',t=>{
 for(const compression of [1,2]){const {file}=fixture(t,mobiFixture([{word:'café',html:'<h2>café</h2><p>A place serving drinks. 咖啡馆</p>'},{word:'CAFÉ',html:'<p>A second sense.</p>'}],compression)),result=readDictionary(file);assert.equal(result.name,'Sample Dictionary');assert.equal(result.words.length,1);assert.match(result.words[0].definition,/咖啡馆/);assert.match(result.words[0].html,/<hr\/>[\s\S]*second sense/);assert.equal(result.words[0].translation,'');}
});
test('PalmDOC backreferences, ASCII shortcuts and record trailers decode with bounded output',()=>{
 assert.equal(palmDoc(Buffer.from([97,98,99,0x80,0x1b,0xc1]),20).toString(),'abcabcabc A');assert.throws(()=>palmDoc(Buffer.from([0x80,8]),20),/损坏/);assert.throws(()=>palmDoc(Buffer.from([4,1]),20),/损坏/);assert.throws(()=>palmDoc(Buffer.from([0xc1]),1),/损坏/);
 assert.equal(withoutTrailers(Buffer.from([97,0,0x81]),3).toString(),'a');assert.throws(()=>withoutTrailers(Buffer.from([1]),2),/损坏/);
});
test('encrypted, HUFF, KF8, non-dictionary and corrupt offsets are rejected explicitly',t=>{
 for(const [mutate,error]of [
  [(b,h)=>b.writeUInt16BE(1,h+12),/加密/],[(b,h)=>b.writeUInt16BE(17480,h),/PalmDOC/],[(b,h)=>b.writeUInt32BE(8,h+36),/MOBI7/],[(b,h)=>b.writeUInt32BE(0xffffffff,h+40),/词条索引/],[(b)=>b.writeUInt32BE(b.length+1,86),/损坏/],[(b,h)=>b.writeUInt32BE(0xffffffff,h+4),/损坏/]
 ]){const b=mobiFixture();mutate(b,b.readUInt32BE(78));const {file}=fixture(t,b);assert.throws(()=>readDictionary(file),error);}
 const {file}=fixture(t,Buffer.alloc(20));assert.throws(()=>readDictionary(file),/损坏/);
});
test('MOBI English reference survives restart and inflection lookup without overwriting Chinese or semantic review cues',async t=>{
 const {dir,file}=fixture(t,mobiFixture()),custom=new CustomDictionaries(dir),plan=await custom.preview(file);custom.commit(plan.token,'Reference');
 const d=dictionary(dir),baseDictionary=new Dictionary(path.resolve('assets'));let base;try{base=await baseDictionary.lookup('scrambled');}finally{baseDictionary.close();}const found=await d.lookup('scrambled');assert.equal(found.word,'scrambled');assert.equal(found.lemma,'scramble');assert.equal(found.translation,base.translation);assert.equal(found.definition,base.definition);assert.equal(found.source,base.source);assert.match(found.sections[0].html,/move hurriedly/);
 const restarted=await dictionary(dir).lookup('scrambled');assert.equal(restarted.sections[0].html,found.sections[0].html);
 custom.savePersonal({word:'scrambled',translation:'我自己的释义',definition:'My edited definition.'});const mine=await dictionary(dir).lookup('scrambled');assert.equal(mine.translation,'我自己的释义');assert.match(mine.definition,/My edited definition/);assert.doesNotMatch(mine.definition,/To move hurriedly/);assert.ok(mine.sections.some(row=>row.html));
});
