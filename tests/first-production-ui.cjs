process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY='1';
const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {Store}=require('../electron/store.cjs'),{makeEntry,withReviewSkills,reviewEntry}=require('../electron/core.cjs');
const root=path.resolve(__dirname,'..'),profile=path.join(__dirname,'first-production-data-'+Date.now());
const start=Date.now(),yesterday=new Date(start-86400000),checks={},errors=[],requests=[];
let entry=reviewEntry(withReviewSkills(makeEntry({text:'write',translation:'书写',definition:'To form letters and words.',context:'I write notes.'},yesterday)),4,yesterday,'meaning');
entry.reviewSkills.meaning.card.due=new Date(start+86400000).toISOString();
const store=new Store(profile);store.state.entries=[entry];store.state.settings={...store.state.settings,reviewMethods:['meaning','spelling','production'],newPerDay:0,preloadSpeech:false};store.save();
const server=http.createServer((req,res)=>{let body='';req.on('data',part=>body+=part);req.on('end',()=>{const prompt=JSON.parse(JSON.parse(body).messages[1].content);requests.push(prompt);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({grade:'good',feedback:'句子完整，用词正确。',corrected:prompt.sentence})}}]}));});});
let app,page,time=start;
const boot=()=>page.evaluate(()=>window.mem.boot());
async function tick(ms){time+=ms;await app.evaluate((_,time)=>{global.__writingTime=time;},time);await page.clock.fastForward(ms);}
async function launch(){
  const env={...process.env,MEMREADER_TEST:'1',MEMREADER_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({executablePath:process.env.MEMREADER_EXE||require('electron'),args:process.env.MEMREADER_EXE?['--disable-gpu']:['--disable-gpu',root],env,timeout:30000});
  page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
  await page.clock.install({time:new Date(time)});time+=1000;await page.clock.pauseAt(new Date(time));
  await app.evaluate(({BrowserWindow},time)=>{global.__writingTime=time;const RealDate=Date;global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[global.__writingTime]));}static now(){return global.__writingTime;}};const win=BrowserWindow.getAllWindows()[0];win.setSize(1280,900);win.showInactive();},time);
  await page.evaluate(port=>window.mem.saveSettings({apiKey:'isolated-ui-test-key',apiBase:'http://127.0.0.1:'+port,apiModel:'test'}),server.address().port);
  await page.reload();await page.locator('.app-sidebar').getByRole('button',{name:/^复习/}).click();await tick(300);
  await page.getByRole('combobox',{name:'选择复习词本',exact:true}).selectOption('unreviewed');
}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    await launch();const input=()=>page.getByRole('textbox',{name:'造句答案',exact:true});
    await expect(page.locator('.word-production')).toHaveCount(0);
    await page.getByRole('textbox',{name:'拼写答案',exact:true}).fill('write');await page.keyboard.press('Enter');await page.locator('.ratings .good').click();
    await expect(page.locator('.word-production')).toHaveCount(0);assert.equal(requests.length,0);
    await tick(20*60000+1);await expect(input()).toBeEnabled();await expect(page.getByText('首次造句 · AI 批改',{exact:true})).toBeVisible();
    checks.foundationThenFirstWriting=true;
    await input().fill('I write a note after class.');await page.keyboard.press('F1');await expect(page.locator('.production-hint')).toContainText('To form letters');
    await page.getByRole('button',{name:'稍后造句',exact:true}).click();await expect(page.locator('.word-production')).toHaveCount(0);
    let data=await boot();assert.equal(data.entries[0].productionPractice.active.draft,'I write a note after class.');assert.equal(data.stats.reviews.length,1);assert.equal(requests.length,0);
    await app.close();app=null;time+=40*60000;await launch();await expect(input()).toHaveValue('I write a note after class.');await expect(page.locator('.production-hint')).toContainText('To form letters');
    checks.deferAndRestartKeepDraftAndHint=true;
    await tick(500);await page.screenshot({path:path.join(root,'publication','first-production.png'),timeout:10000});
    await input().focus();await page.keyboard.press('Control+Enter');await expect(page.getByText('提示后作答 · 将独立补练',{exact:true})).toBeVisible();
    data=await boot();assert.equal(data.entries[0].reviewSkills.production.lastRating,1);assert.equal(data.stats.reviews.length,2);assert.equal(requests.length,1);
    await page.getByRole('button',{name:'继续',exact:true}).click();await tick(10*60000+1);await expect(input()).toHaveValue('');await expect(page.locator('.production-hint')).toHaveCount(0);
    await input().fill('I write letters to my friends.');await page.keyboard.press('Control+Enter');await expect(page.getByText('造句正确',{exact:true})).toBeVisible();
    data=await boot();assert.equal(data.entries[0].reviewSkills.production.lastRating,3);assert.equal(data.stats.reviews.length,3);assert.equal(requests.length,2);
    checks.assistedThenIndependentPractice=true;
    await page.getByRole('button',{name:'继续',exact:true}).click();await expect(page.locator('.word-production')).toHaveCount(0);
    await page.getByRole('button',{name:'立即继续复习',exact:true}).click();await expect(page.locator('.word-production')).toHaveCount(0);
    assert.equal((await boot()).stats.reviews.length,3);checks.noImmediateWritingRepeat=true;assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(root,'publication','first-production-ui-validation.json'),JSON.stringify({checks,errors,version:require('../package.json').version},null,2));
    console.log('FIRST PRODUCTION UI PASSED '+JSON.stringify(checks));
  }finally{if(app)await app.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
