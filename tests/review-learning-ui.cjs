process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY='1';
const {_electron:electron,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Store}=require('../electron/store.cjs'),{makeEntry,withReviewSkills}=require('../electron/core.cjs');
const root=path.resolve(__dirname,'..'),profile=path.join(__dirname,'review-learning-data-'+Date.now()),now=Date.now();
const seed=new Store(profile),words=['candid','resilient','swift','glimpse','compose','adapt','retrieve'];
seed.state.entries=words.map(text=>withReviewSkills(makeEntry({text,translation:'用于学习的中文释义',definition:'A short English meaning.',context:'We use '+text+' in this example.'},new Date(now-1000))));
seed.state.settings={...seed.state.settings,reviewMethods:['meaning'],preloadSpeech:false,newPerDay:20};seed.save();
const errors=[],checks={};let app,page,time=now;
const nav=name=>page.locator('.app-sidebar').getByRole('button',{name:new RegExp('^'+name)});
async function launch(){
  const env={...process.env,MEMREADER_TEST:'1',MEMREADER_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({executablePath:process.env.MEMREADER_EXE||require('electron'),args:process.env.MEMREADER_EXE?['--disable-gpu']:['--disable-gpu',root],env,timeout:30000});
  page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
  await page.clock.install({time:new Date(time)});time+=1000;await page.clock.pauseAt(new Date(time));
  await app.evaluate(({BrowserWindow},time)=>{global.__reviewTestTime=time;const NativeDate=Date;global.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[global.__reviewTestTime]));}static now(){return global.__reviewTestTime;}};const win=BrowserWindow.getAllWindows()[0];win.setSize(1280,900);win.showInactive();},time);
  await nav('复习').click();await tick(300);
}
const boot=()=>page.evaluate(()=>window.mem.boot());
async function tick(ms){time+=ms;await app.evaluate((_,time)=>{global.__reviewTestTime=time;},time);await page.clock.fastForward(ms);}
async function grade(name){await page.getByRole('button',{name:'显示答案',exact:true}).click();await page.locator('.ratings .'+name).click();}
(async()=>{try{
  await launch();await page.locator('.new-word-study h2').waitFor();
  await page.screenshot({path:path.join(root,'publication','new-word-study.png'),timeout:10000});
  await page.getByRole('button',{name:'学好了，稍后回忆',exact:true}).focus();await page.keyboard.press('Enter');
  for(let i=1;i<5;i++)await page.getByRole('button',{name:'学好了，稍后回忆',exact:true}).click();
  await expect(page.locator('.review-complete')).toContainText('稍后继续巩固');
  let data=await boot();assert.equal(data.entries.filter(entry=>entry.initialLearning).length,5);assert.equal(data.stats.reviews.length,0);assert.ok(data.entries.every(entry=>entry.card.reps===0));checks.studyDoesNotGrade=true;checks.fiveWordBatch=true;
  await tick(59999);await expect(page.locator('.review-complete')).toBeVisible();
  await tick(2);await expect(page.locator('.flashcard-front h2')).toHaveText('candid');await expect(page.locator('.new-word-study')).toHaveCount(0);checks.dueTimeRespected=true;
  await grade('again');
  for(let i=1;i<5;i++)await grade('good');
  await expect(page.locator('.review-complete')).toBeVisible();data=await boot();assert.equal(data.stats.reviews.length,5);assert.equal(data.entries[0].reviewSkills.meaning.lastRating,1);
  await tick(60001);await expect(page.locator('.flashcard-front h2')).toHaveText('candid');
  await page.getByRole('button',{name:'显示答案',exact:true}).click();await expect(page.locator('.ratings .easy')).toBeDisabled();
  await page.locator('.ratings .good').focus();await page.keyboard.press('ArrowLeft');await expect(page.locator('.ratings .hard')).toBeFocused();await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
  await expect(page.locator('.review-complete')).toBeVisible();checks.sameSessionRelearning=true;checks.keyboardRatings=true;
  await page.getByRole('button',{name:'撤销上一次评分',exact:true}).click();await expect(page.locator('.flashcard-front h2')).toHaveText('candid');assert.equal((await boot()).stats.reviews.length,5);await grade('good');checks.undo=true;
  await expect(page.locator('.review-complete')).toBeVisible();await page.screenshot({path:path.join(root,'publication','new-word-wait.png'),timeout:10000});
  await app.close();app=null;await launch();await expect(page.locator('.review-complete')).toBeVisible();assert.equal((await boot()).stats.reviews.length,6);checks.restartKeepsLearning=true;
  await tick(10*60000+1);await expect(page.locator('.flashcard-front h2')).toBeVisible();assert.notEqual(await page.locator('.flashcard-front h2').innerText(),'adapt');checks.tenMinuteRecall=true;
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(root,'publication','review-learning-ui-validation.json'),JSON.stringify({checks,errors},null,2));console.log('LEARNING UI PASSED '+JSON.stringify(checks));
}finally{if(app)await app.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
