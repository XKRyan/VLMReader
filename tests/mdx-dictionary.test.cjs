const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {mdxFixture,writeFixture}=require('./mdx-fixture.cjs');
const {readDictionary}=require('../electron/dictionary-files.cjs');
const {streamMdx,textOf}=require('../electron/mdx-dictionary.cjs');
const ENTRIES={
  'dedicated':'<b>dedicated</b> <i>adj.</i> devoted to a task.<br/><b>dedicated to</b> set apart.',
  'water':'<b>water</b> <i>n.</i> the clear liquid that falls as rain.',
  'resilient':'<b>resilient</b> <i>adj.</i> able to recover quickly.',
};
test('an MDX dictionary exposes every headword with its full article kept for expansion',t=>{
  const file=writeFixture(t,{entries:ENTRIES});
  const {name,words}=readDictionary(file);
  assert.equal(name,'Fixture MDX');
  assert.deepEqual(words.map(word=>word.word),['dedicated','resilient','water']);
  assert.match(words[0].definition,/devoted to a task/);
  assert.match(words[0].html,/dedicated to/);
  assert.equal(words[0].source,undefined);
});
test('compressed, UTF-16 and legacy 1.2 files read back identically',t=>{
  const expected='<b>water</b> <i>n.</i> the clear liquid that falls as rain.';
  for(const options of [
    {entries:ENTRIES,compression:2},
    {entries:ENTRIES,encoding:'UTF-16',compression:2},
    {entries:ENTRIES,version:'1.2',compression:0},
    {entries:ENTRIES,compression:1},
  ]) {
    const {words}=readDictionary(writeFixture(t,options));
    assert.equal(words.length,3,JSON.stringify(options));
    assert.equal(words.find(word=>word.word==='water').html,expected,JSON.stringify(options));
  }
});
test('an index-encrypted dictionary is read by walking the key blocks',t=>{
  // Commercial learners' dictionaries ship Encrypted="2" with an unreadable
  // keyword index; the key blocks themselves stay plain zlib.
  const file=writeFixture(t,{entries:ENTRIES,compression:2,encrypted:2,corruptIndex:true});
  const {words}=readDictionary(file);
  assert.equal(words.length,3);
  assert.match(words.find(word=>word.word==='water').html,/clear liquid/);
  const streamed=streamMdx(file,{onRow(){}});
  assert.equal(streamed.scanned,true);
  assert.equal(streamed.encrypted,2);
});
test('a dictionary that needs a registration key is refused instead of being read as garbage',t=>{
  const file=writeFixture(t,{entries:ENTRIES,encrypted:1});
  assert.throws(()=>readDictionary(file),/密钥/);
  assert.throws(()=>writeGuard(file),/密钥/);
});
function writeGuard(file){return streamMdx(file,{onRow(){}});}
test('streaming yields every article once without materialising the record section',t=>{
  const file=writeFixture(t,{entries:ENTRIES,compression:2,encrypted:2,corruptIndex:true});
  const seen=[];
  const info=streamMdx(file,{onRow(row){seen.push(row);}});
  assert.equal(info.count,3);
  assert.deepEqual(seen.map(row=>row.word),['dedicated','resilient','water']);
  assert.ok(seen.every(row=>typeof row.article==='string'&&row.article.length>0));
});
test('imported article text loses markup but keeps words and entities',()=>{
  assert.equal(textOf('<b>dedicated</b> <i>adj.</i> devoted&nbsp;to a task.<br/>Second line.'),
    'dedicated adj. devoted to a task.\nSecond line.');
  assert.equal(textOf('<p>one</p><p>two</p>'),'one\ntwo');
  assert.equal(textOf('<script>bad()</script>safe'),'safe');
  assert.equal(textOf('&amp; &#65; &#x42;'),'& A B');
});
test('a truncated or foreign file is rejected without crashing',t=>{
  const buffer=mdxFixture({entries:ENTRIES,compression:2});
  for(const broken of [buffer.subarray(0,20),buffer.subarray(0,buffer.length-40),Buffer.from('not an mdx file at all')]){
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vlm-mdx-bad-'));
    const file=path.join(dir,'broken.mdx');
    fs.writeFileSync(file,broken);
    try{assert.throws(()=>readDictionary(file),/MDX|损坏|不支持|词典/);}finally{fs.rmSync(dir,{recursive:true,force:true});}
  }
});
