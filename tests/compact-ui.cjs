process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY='1';
const {_electron:electron,expect}=require('@playwright/test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Store}=require('../electron/store.cjs'),{makeEntry,withReviewSkills}=require('../electron/core.cjs');
const root=path.resolve(__dirname,'..'),profile=path.join(root,'publication','compact-ui-data-'+Date.now()),output=path.join(root,'publication','compact-ui');
fs.mkdirSync(output,{recursive:true});const seed=new Store(profile),yesterday=new Date(Date.now()-86400000);
seed.state.settings={...seed.state.settings,language:'en',preloadSpeech:false,reviewMethods:['meaning'],uiFontSize:16};
seed.state.entries=['resilient','candid','focus','momentum','adaptive','cautious','swift','glimpse','clinic','competence','observe','evidence'].map(word=>withReviewSkills(makeEntry({text:word,translation:'用于学习的词义',definition:'A useful academic word.',context:'A reader studies this word carefully.'},yesterday)));
seed.save();const fixture=path.join(profile,'A detailed study document with a long title for keyboard navigation and compact layout.txt');fs.writeFileSync(fixture,'A resilient reader studies evidence carefully.\n\nThis academic document is used to check keyboard navigation.');
const env={...process.env,MEMREADER_TEST:'1',MEMREADER_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
const executable=process.env.MEMREADER_EXE||require('electron'),errors=[],cases=[],checks={};let app;
const nav=(page,name)=>page.locator('.app-sidebar').getByRole('button',{name:new RegExp('^'+name)});
async function dimensions(page,name,selector,size){
 const pane=page.locator(selector);await expect(pane).toBeVisible();
 const layout=await pane.evaluate(el=>{const rect=el.getBoundingClientRect();return {viewport:innerWidth,rootWidth:document.documentElement.scrollWidth,rootHeight:document.scrollingElement.scrollHeight,viewportHeight:innerHeight,left:rect.left,right:rect.right,width:el.clientWidth,contentWidth:el.scrollWidth,height:el.clientHeight,contentHeight:el.scrollHeight};});
 assert.ok(layout.rootWidth<=layout.viewport+1,`${name} root horizontal overflow: ${JSON.stringify(layout)}`);
 assert.ok(layout.contentWidth<=layout.width+1,`${name} page horizontal overflow: ${JSON.stringify(layout)}`);
 assert.ok(layout.left>=-1&&layout.right<=layout.viewport+1,`${name} content outside window: ${JSON.stringify(layout)}`);
 assert.ok(layout.rootHeight<=layout.viewportHeight+1,`${name} must retain its own scroll region`);
 cases.push({name,...size,...layout});
}
(async()=>{
 app=await electron.launch({executablePath:executable,args:process.env.MEMREADER_EXE?['--disable-gpu']:['--disable-gpu',root],env,timeout:30000});const page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
 await nav(page,'Settings').waitFor();await page.evaluate(file=>window.mem.importBooks([file]),fixture);await page.reload();await nav(page,'Settings').waitFor();
 for(const size of [{width:1400,height:940,font:16},{width:1000,height:720,font:16},{width:1400,height:940,font:22},{width:1000,height:720,font:22}]){
  await app.evaluate(({BrowserWindow},size)=>{const w=BrowserWindow.getAllWindows()[0];w.setSize(size.width,size.height);w.showInactive();},size);
  await nav(page,'Settings').click();await page.getByRole('combobox',{name:'Interface text size',exact:true}).selectOption(String(size.font));
  await expect.poll(()=>page.locator('.nav-item').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBe(size.font);
  await dimensions(page,'settings','.settings-page',size);
  const settings=page.locator('.settings-page'),bounds=await settings.boundingBox();await page.mouse.move(bounds.x+bounds.width*.5,bounds.y+bounds.height*.6);await page.mouse.wheel(0,15000);
  await expect.poll(()=>settings.evaluate(el=>Math.abs(el.scrollHeight-el.clientHeight-el.scrollTop))).toBeLessThan(3);
  await expect(page.locator('.app-version')).toHaveText('VLMReader '+require('../package.json').version);
  const footer=await page.locator('.app-version').boundingBox();assert.ok(footer.y+footer.height<=await page.evaluate(()=>innerHeight)+1,'Settings footer must remain reachable');
  await nav(page,'Library').click();await dimensions(page,'library','.library-page',size);
  const continueLayout=await page.locator('.continue-card').evaluate(el=>{const card=el.getBoundingClientRect(),action=el.querySelector('.continue-info>.primary').getBoundingClientRect();return {cardTop:card.top,cardBottom:card.bottom,actionTop:action.top,actionBottom:action.bottom};});assert.ok(continueLayout.actionTop>=continueLayout.cardTop&&continueLayout.actionBottom<=continueLayout.cardBottom+1,'Continue reading must not be clipped by a fixed-height card: '+JSON.stringify(continueLayout));
  await nav(page,'Dictionary').click();await page.getByRole('textbox',{name:'Word to look up',exact:true}).fill('clinic');await page.getByRole('button',{name:'Look up',exact:true}).click();await page.locator('.dictionary-title h2').filter({hasText:'clinic'}).waitFor();await dimensions(page,'dictionary','.dictionary-page',size);
  await nav(page,'Vocabulary').click();await dimensions(page,'vocabulary','.vocabulary-page',size);
  await nav(page,'Review').click();await expect(page.locator('.flashcard-front h2')).toHaveText('resilient');await dimensions(page,'review','.review-page',size);
  await page.screenshot({path:path.join(output,`review-${size.width}-${size.font}.png`),timeout:10000});
 }
 checks.layouts={pages:5,combinations:4,preservesChosenFont:true,noHorizontalOverflow:true,settingsBottomReachable:true};
 await nav(page,'Settings').click();await page.getByRole('combobox',{name:'Interface text size',exact:true}).selectOption('16');await nav(page,'Library').click();
 const card=page.locator('.book-card').first(),cover=card.locator('.book-cover-button'),favorite=card.getByRole('button',{name:'Favorite document',exact:true}),remove=card.getByRole('button',{name:'Remove document',exact:true});
 await cover.focus();await page.keyboard.press('Tab');await expect(card.locator('.book-card-heading>button')).toBeFocused();await page.keyboard.press('Tab');await expect(favorite).toBeFocused();await page.keyboard.press('Space');await expect(card.getByRole('button',{name:'Remove favorite',exact:true})).toBeFocused();
 await page.keyboard.press('Tab');await expect(remove).toBeFocused();const before=await page.evaluate(()=>window.mem.boot());await page.keyboard.press('Enter');
 const confirmation=page.getByRole('dialog',{name:'Remove this document?',exact:true}),cancel=confirmation.getByRole('button',{name:'Cancel',exact:true}),deleteButton=confirmation.getByRole('button',{name:'Delete',exact:true});
 await expect(confirmation).toBeVisible();await expect(cancel).toBeFocused();await page.keyboard.press('Tab');await expect(deleteButton).toBeFocused();await page.keyboard.press('Tab');await expect(cancel).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(deleteButton).toBeFocused();
 assert.equal(await page.locator('.main').evaluate(el=>el.inert),true);assert.equal(await page.locator('.app-sidebar').evaluate(el=>el.inert),true);
 await page.keyboard.press('Escape');await expect(confirmation).toHaveCount(0);await expect(remove).toBeFocused();assert.equal((await page.evaluate(()=>window.mem.boot())).books.length,before.books.length);
 checks.libraryKeyboard={coverAndTitle:true,favoriteToggle:true,menuAccessible:true};checks.deleteModal={cancelInitialFocus:true,tabWrap:true,shiftTabWrap:true,backgroundInert:true,escapeCancels:true,focusRestored:true,dataUnchanged:true};
 await nav(page,'Vocabulary').click();const add=page.getByRole('button',{name:'Add word',exact:true});await add.focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog',{name:'Add word',exact:true}),input=dialog.getByRole('textbox',{name:'Word to add',exact:true}),close=dialog.getByRole('button',{name:'Close add word',exact:true}),last=dialog.getByRole('button',{name:'Cancel',exact:true});
 await expect(input).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(close).toBeFocused();await page.keyboard.press('Shift+Tab');await expect(last).toBeFocused();await page.keyboard.press('Tab');await expect(close).toBeFocused();await page.keyboard.press('Tab');await expect(input).toBeFocused();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(add).toBeFocused();
 checks.addWordModal={wordInitialFocus:true,tabWrap:true,shiftTabWrap:true,escapeCloses:true,focusRestored:true};
 assert.deepEqual(errors,[]);const report={version:await app.evaluate(({app})=>app.getVersion()),executable,profile,checks,cases,errors};fs.writeFileSync(path.join(root,'publication','compact-ui-validation.json'),JSON.stringify(report,null,2));console.log('COMPACT APP UI PASSED '+JSON.stringify(checks));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(app)await app.close().catch(()=>{});});
