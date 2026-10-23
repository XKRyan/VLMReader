process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY='1';
const {_electron:electron,expect}=require('@playwright/test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {Store}=require('../electron/store.cjs'),{makeEntry,withReviewSkills,reviewEntry}=require('../electron/core.cjs');
const root=path.resolve(__dirname,'..'),profile=path.join(__dirname,'production-state-data-'+Date.now()),yesterday=new Date(Date.now()-86400000);
const requests=[],errors=[],checks={};let entry=withReviewSkills(makeEntry({text:'write',translation:'书写',context:'I write a short note every morning.'},yesterday));
for(const mode of ['meaning','cloze','spelling']){entry=reviewEntry(entry,4,yesterday,mode);entry.reviewSkills[mode].card.due=new Date(Date.now()+86400000).toISOString();}
const seed=new Store(profile);seed.state.entries=[entry];seed.state.settings={...seed.state.settings,reviewMethods:['meaning','production'],preloadSpeech:false};seed.save();
const server=http.createServer((request,response)=>{let body='';request.on('data',chunk=>body+=chunk);request.on('end',()=>{const input=JSON.parse(JSON.parse(body).messages[1].content);requests.push(input);response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({choices:[{message:{content:JSON.stringify({grade:'good',feedback:'目标词使用自然。',corrected:input.sentence})}}]}));});});
const nav=(page,name)=>page.locator('.app-sidebar').getByRole('button',{name:new RegExp('^'+name)});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const env={...process.env,MEMREADER_TEST:'1',MEMREADER_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({executablePath:process.env.MEMREADER_EXE||require('electron'),args:process.env.MEMREADER_EXE?['--disable-gpu']:['--disable-gpu',root],env,timeout:30000});
  const page=await app.firstWindow(),boot=()=>page.evaluate(()=>window.mem.boot());page.on('pageerror',error=>errors.push(error.message));
  try{
    await nav(page,'偏好设置').waitFor();await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.setSize(1450,960);win.showInactive();});
    await page.evaluate(port=>window.mem.saveSettings({apiKey:'local-regression-key',apiBase:'http://127.0.0.1:'+port,apiModel:'test'}),server.address().port);await page.reload();await nav(page,'复习').click();
    const input=page.getByRole('textbox',{name:'造句答案',exact:true});await expect(input).toBeEnabled();
    // Hold the normal typing debounce indefinitely: these assertions must rely
    // on leaving/unmounting the editor, not waiting long enough to hide a loss.
    await page.evaluate(()=>{const native=window.setTimeout.bind(window);window.setTimeout=(handler,timeout,...args)=>native(handler,timeout===400?60000:timeout,...args);});
    const first='I write a complete draft before changing methods.';await input.fill(first);
    await nav(page,'偏好设置').click();await page.getByRole('switch',{name:'启用造句练习',exact:true}).click();
    await expect(page.locator('.word-production')).toHaveCount(0);
    await expect.poll(async()=>(await boot()).entries[0].productionPractice.active.draft).toBe(first);
    await page.getByRole('switch',{name:'启用造句练习',exact:true}).click();await nav(page,'复习').click();await expect(input).toHaveValue(first);
    checks.latestDraftOnMethodDisable=true;
    const remounted='I write the final characters before starting another session.';await input.fill(remounted);
    await nav(page,'生词本').click();await page.getByRole('button',{name:'去复习',exact:true}).click();await expect(input).toHaveValue(remounted);checks.immediateRemountWaitsForPendingDraft=true;
    const second='I write the latest characters before removing the key.';await input.fill(second);
    await nav(page,'偏好设置').click();await page.getByRole('button',{name:'删除密钥',exact:true}).click();await nav(page,'复习').click();
    await expect(page.locator('.word-production')).toHaveCount(0);await expect(page.locator('.review-method-notice')).toBeVisible();
    await expect.poll(async()=>(await boot()).entries[0].productionPractice.active.draft).toBe(second);checks.latestDraftOnKeyRemoval=true;
    await nav(page,'偏好设置').click();await page.evaluate(port=>window.mem.saveSettings({apiKey:'local-regression-key',apiBase:'http://127.0.0.1:'+port}),server.address().port);
    await page.getByRole('switch',{name:'启用回忆词义',exact:true}).click();await nav(page,'复习').click();await expect(input).toHaveValue(second);
    assert.equal(requests.length,0);await input.focus();await page.keyboard.press('Control+Enter');await page.getByText('造句正确',{exact:true}).waitFor();
    const reviewed=(await boot()).stats.reviews.length;assert.equal(requests.length,1);
    await nav(page,'偏好设置').click();await page.getByRole('button',{name:'删除密钥',exact:true}).click();await nav(page,'复习').click();
    await page.getByText('造句正确',{exact:true}).waitFor();await expect(page.locator('.word-production')).toContainText(second);
    assert.equal((await boot()).stats.reviews.length,reviewed);await page.getByRole('button',{name:'继续',exact:true}).click();await expect(page.locator('.word-production')).toHaveCount(0);
    assert.equal((await boot()).stats.reviews.length,reviewed);assert.equal((await boot()).entries[0].productionPractice.active,null);checks.feedbackSurvivesKeyRemovalUntilContinue=true;checks.noDraftResurrectionOrExtraGrade=true;
    // Undo a manual grade after its exercise has been disabled. A retained
    // session prefix must not bypass the learner's latest method settings.
    await nav(page,'偏好设置').click();await page.getByRole('switch',{name:'启用回忆词义',exact:true}).click();await page.getByRole('switch',{name:'启用造句练习',exact:true}).click();
    const added=await page.evaluate(()=>window.mem.collect({text:'candid',kind:'word',context:'A candid teacher answers the question honestly.',bookId:'',bookTitle:'',location:'',notebookIds:[]}));
    // This case tests undo on an encountered recall card. Advance the isolated
    // test clocks past its first step; fresh-word study has its own UI suite.
    await page.evaluate(id=>window.mem.review(id,1,'meaning'),added.id);
    const reviewTime=Date.now()+120000;
    await app.evaluate((_,time)=>{const NativeDate=Date;global.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[time]));}static now(){return time;}};},reviewTime);
    await page.clock.install({time:new Date(reviewTime)});
    // The direct seed API does not emit a renderer mutation; refresh its state.
    await page.reload();await nav(page,'生词本').waitFor();await nav(page,'生词本').click();await page.getByRole('button',{name:'去复习',exact:true}).click();await expect(page.locator('.flashcard-front h2')).toHaveText('candid');
    await page.getByRole('button',{name:'显示答案',exact:true}).click();await page.locator('.ratings .easy').click();await expect(page.getByRole('button',{name:'撤销上一次评分',exact:true})).toBeEnabled();
    await nav(page,'偏好设置').click();await page.getByRole('switch',{name:'启用造句练习',exact:true}).click();await page.getByRole('switch',{name:'启用回忆词义',exact:true}).click();await nav(page,'复习').click();
    await page.getByRole('button',{name:'撤销上一次评分',exact:true}).click();
    await expect.poll(async()=>(await boot()).entries.find(item=>item.id===added.id).reviewSkills.meaning.card.reps).toBe(1);
    await expect(page.locator('.flashcard-front')).toHaveCount(0);await expect(page.locator('.review-method-notice')).toBeVisible();checks.undoCannotReenableDisabledMethod=true;
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(root,'publication','review-production-state-validation.json'),JSON.stringify({version:require('../package.json').version,checks,aiRequests:requests.length,errors},null,2));console.log('PRODUCTION STATE UI PASSED '+JSON.stringify(checks));
  }finally{server.close();await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
