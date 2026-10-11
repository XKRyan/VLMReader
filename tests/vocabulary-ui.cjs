process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY='1';
const {_electron:electron}=require('@playwright/test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Store}=require('../electron/store.cjs'),{makeEntry,reviewEntry}=require('../electron/core.cjs');
const root=path.resolve(__dirname,'..'),profile=path.join(__dirname,'vocabulary-data-'+Date.now()),shots=path.join(__dirname,'screenshots');
fs.mkdirSync(shots,{recursive:true});
const seed=new Store(profile),items=[
  {text:'resilient',translation:'有韧性的',context:'A resilient learner keeps trying.'},
  {text:'learning',translation:'学习',context:'Learning builds lasting understanding.'},
  {text:'focus',translation:'专注',context:'Focus on one useful idea at a time.'},
  {text:'Learning builds lasting understanding.',translation:'学习构建持久的理解。',context:'Learning builds lasting understanding.'},
  {text:'A resilient learner keeps trying.',translation:'有韧性的学习者会不断尝试。',context:'A resilient learner keeps trying.'}
].map(input=>reviewEntry(makeEntry({...input,bookTitle:'Study notes'}),3));
seed.state.entries=items;seed.state.stats.reviews=items.map(e=>({entryId:e.id,rating:3,time:new Date().toISOString(),isNew:true}));seed.state.stats.minutes=37;seed.save();
async function launch(){const env={...process.env,MEMREADER_TEST:'1',MEMREADER_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;return electron.launch({executablePath:process.env.MEMREADER_EXE||require('electron'),args:process.env.MEMREADER_EXE?['--disable-gpu']:['--disable-gpu',root],env});}
function near(value,expected){assert.ok(Math.abs(parseFloat(value)-expected)<0.02,`${value} != ${expected}`);}
(async()=>{
  let app=await launch();const errors=[];
  try{
    let page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
    await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.setSize(1600,1000);win.showInactive();});
    await page.getByRole('button',{name:'偏好设置',exact:true}).click();
    const size=page.getByRole('combobox',{name:'界面字号',exact:true});assert.equal(await size.inputValue(),'16');
    near(await page.locator('.nav-item').first().evaluate(el=>getComputedStyle(el).fontSize),16);
    await page.screenshot({path:path.join(shots,'09-default-interface-size.png')});
    await size.selectOption('22');await page.waitForFunction(()=>getComputedStyle(document.querySelector('.nav-item')).fontSize==='22px');
    await assert.rejects(()=>page.evaluate(()=>window.mem.saveSettings({uiFontSize:100})),/13–22/);
    assert.equal((await page.evaluate(()=>window.mem.boot())).settings.fontSize,19);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1100,850));
    const layout=await page.evaluate(()=>({width:innerWidth,pageWidth:document.documentElement.scrollWidth,columns:getComputedStyle(document.querySelector('.settings-grid')).gridTemplateColumns.split(' ').length}));
    assert.equal(layout.columns,1);assert.ok(layout.pageWidth<=layout.width+1);
    await page.screenshot({path:path.join(shots,'10-large-interface-settings.png')});
    await size.selectOption('20');await page.waitForFunction(()=>getComputedStyle(document.querySelector('.nav-item')).fontSize==='20px');
    await page.getByRole('button',{name:/^生词本/}).first().click();
    assert.equal(await page.getByRole('checkbox',{name:'全选当前列表',exact:true}).count(),0);await page.getByRole('button',{name:'管理',exact:true}).click();
    const all=page.getByRole('checkbox',{name:'全选当前列表',exact:true}),bulk=page.getByRole('button',{name:'删除所选',exact:true});
    assert.ok(await bulk.isDisabled());await page.getByRole('checkbox',{name:'选择 resilient',exact:true}).check();
    assert.equal(await page.locator('.vocab-detail').count(),0,'Checkbox must not open entry details');
    assert.equal(await all.evaluate(el=>el.indeterminate),true);await all.check();assert.equal(await page.locator('.vocab-row:not(.table-heading) input:checked').count(),5);
    await all.uncheck();assert.ok(await bulk.isDisabled());
    await page.getByRole('checkbox',{name:'选择 resilient',exact:true}).focus();await page.keyboard.press('Space');
    await page.getByRole('checkbox',{name:'选择 learning',exact:true}).check();await bulk.click();
    assert.ok(await page.getByRole('dialog',{name:'删除所选 2 个条目？',exact:true}).isVisible());
    await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal((await page.evaluate(()=>window.mem.boot())).entries.length,5);
    await page.getByRole('button',{name:'取消选择',exact:true}).click();assert.ok(await bulk.isDisabled());
    const search=page.getByRole('textbox',{name:'搜索生词',exact:true});await search.fill('lasting');
    assert.equal(await page.locator('.vocab-row:not(.table-heading)').count(),2);await all.check();
    await page.screenshot({path:path.join(shots,'11-batch-delete-filtered.png')});
    await bulk.click();await page.getByRole('button',{name:'确认删除',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
    const after=await page.evaluate(()=>window.mem.boot()),deleted=new Set([items[1].id,items[3].id]);
    assert.deepEqual(after.entries.map(e=>e.id),items.filter(e=>!deleted.has(e.id)).map(e=>e.id));
    assert.equal(after.stats.reviews.length,3);assert.ok(after.stats.reviews.every(r=>!deleted.has(r.entryId)));assert.equal(after.stats.minutes,37);
    assert.ok(after.books.length>0);await search.fill('');await all.check();await page.getByRole('button',{name:'单词',exact:true}).click();
    assert.ok(await bulk.isDisabled(),'Switching filters clears the previous selection');assert.equal(await page.locator('.vocab-row:not(.table-heading)').count(),2);
    await all.check();await search.fill('resilient');assert.ok(await bulk.isDisabled(),'Changing search clears selected IDs');
    await all.check();await bulk.click();await page.getByRole('button',{name:'确认删除',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
    const kept=await page.evaluate(()=>window.mem.boot());assert.equal(kept.entries.length,2);assert.ok(kept.entries.some(e=>e.id===items[4].id),'Word-filter deletion must preserve the sentence');
    await search.fill('');await page.getByRole('button',{name:/^全部 /}).click();
    await page.locator('.vocab-row:not(.table-heading)').filter({hasText:'A resilient learner keeps trying.'}).click();
    await page.locator('.sticky-detail-heading').getByRole('button',{name:'删除条目',exact:true}).click();await page.getByRole('button',{name:'确认删除',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
    assert.equal(await page.locator('.vocab-detail').count(),0);assert.equal((await page.evaluate(()=>window.mem.boot())).entries[0].id,items[2].id);
    await page.getByRole('button',{name:'偏好设置',exact:true}).click();await page.getByRole('combobox',{name:'界面语言',exact:true}).selectOption('en');
    assert.ok(await page.getByRole('combobox',{name:'Interface text size',exact:true}).isVisible());await page.getByRole('button',{name:/^Vocabulary/}).first().click();await page.getByRole('button',{name:'Manage',exact:true}).click();
    await page.getByRole('checkbox',{name:'Select all in this list',exact:true}).check();await page.getByRole('button',{name:'Delete selected',exact:true}).click();
    assert.ok(await page.getByRole('dialog',{name:'Delete this entry?',exact:true}).isVisible());await page.getByRole('button',{name:'Cancel',exact:true}).click();
    await app.close();app=await launch();page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
    await page.getByRole('button',{name:'Settings',exact:true}).waitFor();await page.getByRole('button',{name:'Settings',exact:true}).click();
    assert.equal(await page.getByRole('combobox',{name:'Interface text size',exact:true}).inputValue(),'20');near(await page.locator('.nav-item').first().evaluate(el=>getComputedStyle(el).fontSize),20);
    const persisted=JSON.parse(fs.readFileSync(path.join(profile,'library.json'),'utf8'));assert.equal(persisted.entries.length,1);assert.equal(persisted.stats.reviews.length,1);assert.equal(persisted.settings.uiFontSize,20);
    assert.equal(errors.length,0,errors.join('\n'));console.log('VOCABULARY UI PASSED: filtered batch deletion, cancel, keyboard selection, records, larger adjustable text, small window, English and restart persistence.');
    console.log(profile);
  }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
