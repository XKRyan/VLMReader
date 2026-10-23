process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY='1';
const {_electron:electron,expect}=require('@playwright/test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {Store}=require('../electron/store.cjs');
const {makeEntry,withReviewSkills,reviewEntry}=require('../electron/core.cjs');
const root=path.resolve(__dirname,'..'),profile=path.join(__dirname,'review-mixed-production-data-'+Date.now());
const now=Date.now(),yesterday=new Date(now-86400000),errors=[],requests=[],checks={};
function word(text,translation,context,mode){
  let entry=withReviewSkills(makeEntry({text,translation,context},yesterday));
  for(const trained of ['meaning','cloze','spelling'].slice(0,['meaning','cloze','spelling','production'].indexOf(mode))){
    entry=reviewEntry(entry,4,yesterday,trained);
    entry.reviewSkills[trained].card.due=new Date(now+86400000).toISOString();
  }
  if(mode==='meaning')entry=reviewEntry(entry,3,yesterday,mode);
  if(mode==='spelling'){entry=reviewEntry(entry,4,yesterday,'production');entry.reviewSkills.production.card.due=new Date(now+86400000).toISOString();}
  return entry;
}
const production=word('write','书写','I write a short note every morning.','production');
const seed=new Store(profile);seed.state.entries=[...Array.from({length:24},()=>word('adaptive','适应性的','','meaning')),word('candid','坦率的','The candid teacher answers every question honestly.','cloze'),word('swift','迅速的','A swift runner passes the gate.','spelling'),production];
seed.state.settings={...seed.state.settings,preloadSpeech:false,reviewMethods:['meaning','cloze','spelling'],newPerDay:0};seed.save();
const server=http.createServer((request,response)=>{let body='';request.on('data',chunk=>body+=chunk);request.on('end',()=>{
  const input=JSON.parse(JSON.parse(body).messages[1].content);requests.push(input);
  response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({choices:[{message:{content:JSON.stringify({grade:'good',feedback:'目标词使用自然，句子完整。',corrected:input.sentence})}}]}));
});});
const nav=(page,name)=>page.locator('.app-sidebar').getByRole('button',{name:new RegExp('^'+name)});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const env={...process.env,MEMREADER_TEST:'1',MEMREADER_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({executablePath:process.env.MEMREADER_EXE||require('electron'),args:process.env.MEMREADER_EXE?['--disable-gpu']:['--disable-gpu',root],env,timeout:30000});
  const page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
  const boot=()=>page.evaluate(()=>window.mem.boot());
  try{
    await nav(page,'偏好设置').waitFor();await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.setSize(1450,960);win.showInactive();});
    await nav(page,'复习').click();await page.locator('.flashcard-front h2').filter({hasText:'adaptive'}).waitFor();
    await nav(page,'偏好设置').click();
    await page.getByRole('switch',{name:'启用造句练习',exact:true}).click();
    await nav(page,'复习').click();await expect(page.locator('.review-method-notice')).toContainText('配置 AI 密钥');
    checks.noKeyExplained=true;
    await nav(page,'偏好设置').click();
    await page.evaluate(port=>window.mem.saveSettings({apiKey:'local-regression-key',apiBase:'http://127.0.0.1:'+port,apiModel:'test'}),server.address().port);
    // Refresh the app state through the actual settings UI, without reloading or
    // remounting the retained Review page.
    await page.getByRole('switch',{name:'启用句子填空',exact:true}).click();
    await page.getByRole('switch',{name:'启用句子填空',exact:true}).click();
    await nav(page,'复习').click();await expect(page.locator('.review-method-notice')).toHaveCount(0);
    await expect(page.locator('.flashcard-front h2')).toHaveText('adaptive');
    assert.equal(requests.length,0,'Enabling, scheduling and preparing a writing exercise must not call AI');
    let completed=0;
    while(!await page.locator('.word-production').isVisible()){
      assert.ok(completed<4,'Sentence writing must appear within one mixed-method round despite the recall backlog');
      if(await page.locator('.word-cloze').isVisible()){
        await expect(page.getByRole('textbox',{name:'填空答案',exact:true})).toBeEnabled();
        const state=await boot(),entry=state.entries.find(entry=>entry.clozePractice?.active);
        await page.getByRole('textbox',{name:'填空答案',exact:true}).fill(entry.clozePractice.active.target);
        await page.keyboard.press('Enter');await page.locator('.cloze-due').waitFor();await page.keyboard.press('Enter');
      }else if(await page.getByRole('textbox',{name:'拼写答案',exact:true}).isVisible()){
        await page.getByRole('textbox',{name:'拼写答案',exact:true}).fill('swift');await page.keyboard.press('Enter');await page.locator('.ratings .good').waitFor();await page.locator('.ratings .good').click();
      }else{
        await page.getByRole('button',{name:'显示答案',exact:true}).click();await page.locator('.ratings .good').click();
      }
      completed++;
      await expect(page.locator('.session-counter strong')).toHaveText(new RegExp('^'+completed+' /'));
    }
    const input=page.getByRole('textbox',{name:'造句答案',exact:true});await expect(input).toBeEnabled();
    assert.equal(requests.length,0);await input.fill('I write a short note after class.');
    await nav(page,'偏好设置').click();await page.getByRole('switch',{name:'启用回忆词义',exact:true}).click();await nav(page,'复习').click();
    await expect(input).toHaveValue('I write a short note after class.');checks.retainedDraftSurvivesSettings=true;
    const before=(await boot()).entries.find(entry=>entry.id===production.id).reviewSkills;
    await input.focus();await page.keyboard.press('Control+Enter');await page.getByText('造句正确',{exact:true}).waitFor();
    const after=(await boot()).entries.find(entry=>entry.id===production.id).reviewSkills;
    assert.equal(after.production.card.reps,1);for(const mode of ['meaning','cloze','spelling'])assert.deepEqual(after[mode],before[mode]);
    assert.equal(requests.length,1);checks.mixedProduction={beforeQuestion:completed+1,recallBacklog:24,independentSkill:true,oneExplicitSubmissionRequest:true};
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(root,'publication','review-mixed-production-validation.json'),JSON.stringify({version:require('../package.json').version,checks,errors},null,2));
    console.log('MIXED PRODUCTION UI PASSED '+JSON.stringify(checks));
  }finally{server.close();await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
