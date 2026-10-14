process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY='1';
const {_electron:electron,expect}=require('@playwright/test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Store}=require('../electron/store.cjs');
const root=path.resolve(__dirname,'..'),profile=path.join(root,'publication','dictionary-scroll-data-'+Date.now()),blocked=process.argv.includes('--expect-blocked');
const seed=new Store(profile);seed.state.settings={...seed.state.settings,language:'en',preloadSpeech:false};seed.save();
const executable=process.env.MEMREADER_EXE||require('electron'),errors=[];let app;
async function loadWord(page,word){
 await page.getByRole('textbox',{name:'Word to look up',exact:true}).fill(word);await page.getByRole('button',{name:'Look up',exact:true}).click();
 await page.locator('.dictionary-title h2').filter({hasText:word}).waitFor();await page.locator('.dictionary-collocations').waitFor();
 await page.locator('.word-details summary').filter({hasText:'Word forms'}).waitFor();
}
async function waitForScrollToSettle(region){
 let previous=-1,stable=0;
 await expect.poll(async()=>{const position=await region.evaluate(el=>el.scrollTop);stable=Math.abs(position-previous)<.5?stable+1:0;previous=position;return stable;}).toBeGreaterThanOrEqual(2);
}
(async()=>{
 const env={...process.env,MEMREADER_TEST:'1',MEMREADER_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
 app=await electron.launch({executablePath:executable,args:process.env.MEMREADER_EXE?['--disable-gpu']:['--disable-gpu',root],env,timeout:30000});
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.getByRole('button',{name:'Dictionary',exact:true}).waitFor();
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setSize(1400,900);w.showInactive();});
 await page.getByRole('button',{name:'Dictionary',exact:true}).click();await loadWord(page,'clinic');
 const region=page.locator('.dictionary-page'),topbar=page.locator('.topbar'),sidebar=page.locator('.app-sidebar');
 const originalBar=await topbar.boundingBox(),originalSide=await sidebar.boundingBox();
 const bounds=await region.boundingBox();await page.mouse.move(bounds.x+bounds.width*.45,Math.min(bounds.y+150,850));await page.mouse.wheel(0,650);
 if(blocked){
  await page.waitForTimeout(250);assert.equal(await region.evaluate(el=>el.scrollTop),0);
  const save=await page.locator('.dictionary-save').boundingBox();assert.ok(save.y>await page.evaluate(()=>innerHeight));
  console.log('REPRODUCED: clinic results are clipped and cannot scroll in the previous EXE.');return;
 }
 await expect.poll(()=>region.evaluate(el=>el.scrollTop)).toBeGreaterThan(200);
 assert.equal((await topbar.boundingBox()).y,originalBar.y);assert.equal((await sidebar.boundingBox()).y,originalSide.y);
 const cases=[];
 for(const size of [{width:1400,height:900,font:16},{width:1000,height:720,font:16},{width:1000,height:720,font:22}]){
  await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setSize(size.width,size.height),size);
  await page.evaluate(font=>window.mem.saveSettings({uiFontSize:font}),size.font);await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Dictionary',exact:true}).click();await loadWord(page,'clinic');
  console.log('Checking layout '+JSON.stringify(size));
  await region.focus();await page.keyboard.press('PageDown');await expect.poll(()=>region.evaluate(el=>el.scrollTop)).toBeGreaterThan(150);await waitForScrollToSettle(region);
  const currentBounds=await region.boundingBox();await page.mouse.move(currentBounds.x+currentBounds.width*.45,currentBounds.y+currentBounds.height*.5);await page.mouse.wheel(0,10000);
  await expect.poll(()=>region.evaluate(el=>Math.abs(el.scrollHeight-el.clientHeight-el.scrollTop))).toBeLessThan(3);
  await expect(page.getByRole('button',{name:'Add to notebook',exact:true})).toBeVisible();
  const layout=await page.evaluate(()=>{const el=document.querySelector('.dictionary-page'),save=document.querySelector('.dictionary-save').getBoundingClientRect();return {outerHeight:document.scrollingElement.scrollHeight,viewport:innerHeight,saveBottom:save.bottom,scrollTop:el.scrollTop,scrollHeight:el.scrollHeight,height:el.clientHeight};});
  assert.ok(layout.outerHeight<=layout.viewport+1);assert.ok(layout.saveBottom<=layout.viewport+1);assert.ok(layout.scrollTop>0);
  cases.push({...size,...layout});
  if(size.width===1400)await page.screenshot({path:path.join(root,'publication','dictionary-scroll-bottom.png'),timeout:10000});
 }
 await page.getByRole('button',{name:'Add to notebook',exact:true}).click();await expect(page.getByRole('button',{name:'Saved',exact:true})).toBeVisible();
 let state=await page.evaluate(()=>window.mem.boot());assert.ok(state.entries.some(e=>e.text==='clinic'));
 await page.getByRole('button',{name:'Vocabulary',exact:false}).click();assert.equal(await page.evaluate(()=>document.scrollingElement.scrollTop),0);
 assert.deepEqual(errors,[]);
 const report={version:await app.evaluate(({app})=>app.getVersion()),executable,mouseWheel:true,keyboardPageDown:true,bottomSaveReachable:true,saveWorks:true,fixedNavigation:true,rootDoesNotScroll:true,cases,errors};
 fs.writeFileSync(path.join(root,'publication','dictionary-scroll-validation.json'),JSON.stringify(report,null,2));console.log('DICTIONARY SCROLL UI PASSED '+JSON.stringify(report));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(app)await app.close().catch(()=>{});});
