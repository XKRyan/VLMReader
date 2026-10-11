const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {getPalette,sanitizeColorThemes,contrast}=require('../electron/palette.cjs'),{Store}=require('../electron/store.cjs');
test('custom colors validate, persist independently and keep controls readable',()=>{
  const colors=sanitizeColorThemes({paper:{accent:'#FF0',bg:'#112233',paper:'#fcf1de',readingText:'#202020'}},true);
  assert.equal(colors.paper.accent,'#ffff00');assert.throws(()=>sanitizeColorThemes({paper:{bg:'url(secret)'}},true));
  const p=getPalette({theme:'paper',colorThemes:colors});assert.equal(p.bg,'#112233');assert.equal(p.paper,'#fcf1de');assert.equal(p.accent,'#ffff00');
  assert.ok(contrast(p.onAccent,p.accent)>=4.5);assert.ok(contrast(p.accentText,p.surface)>=4.5);assert.ok(contrast(p.text,p.surface)>=4.5);
  assert.equal(getPalette({theme:'night',colorThemes:colors}).bg,'#171c26');
  const s=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'memreader-colors-')));s.state.settings.colorThemes=colors;s.save();assert.deepEqual(new Store(s.dir).state.settings.colorThemes,colors);
});
test('old or malformed palettes migrate without injecting CSS or changing reading data',()=>{
  const s=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'memreader-old-colors-')));s.state.settings.colorThemes={paper:{paper:'#badbad',accent:'bad-css'},unknown:{bg:'#ffffff'}};s.save();
  const next=new Store(s.dir);assert.deepEqual(next.state.settings.colorThemes,{paper:{paper:'#badbad'}});assert.equal(next.state.settings.fontSize,19);
});
