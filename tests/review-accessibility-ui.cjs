process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY='1';
const {_electron:electron,expect}=require('@playwright/test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {Store}=require('../electron/store.cjs');
const {makeEntry,withReviewSkills,reviewEntry}=require('../electron/core.cjs');
const {Dictionary}=require('../electron/dictionary.cjs');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version;
const profile=path.join(__dirname,'review-accessibility-data-'+Date.now());
const shots=path.join(root,'publication','screenshots-'+version);fs.mkdirSync(shots,{recursive:true});
const yesterday=new Date(Date.now()-86400000),checks={},requests=[],errors=[];
const nav=(page,name)=>page.locator('.app-sidebar').getByRole('button',{name:new RegExp('^'+name)});
function word(text,translation,definition,context,notebook){
  const entry=withReviewSkills(makeEntry({text,translation,definition,context},yesterday));entry.notebookIds=[notebook];return entry;
}
const server=http.createServer((request,response)=>{
  let body='';request.on('data',chunk=>body+=chunk);request.on('end',()=>{
    const payload=JSON.parse(body),input=JSON.parse(payload.messages[1].content);requests.push(input);
    const result={grade:'good',feedback:'目标词使用自然，句子完整。',corrected:input.sentence};
    setTimeout(()=>{response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]}));},120);
  });
});
(async()=>{
  const dictionary=new Dictionary(path.join(root,'assets')),raw=await dictionary.rawLookup('scrambled'),reeled=await dictionary.rawLookup('reeled');
  const seed=new Store(profile);
  const legacy=reviewEntry(word('scrambled',raw.translation,raw.definition,'The musicians scrambled back into their chairs.','spelling'),3,yesterday,'meaning');
  legacy.source='ECDICT';legacy.note='Keep my note';
  const second=reviewEntry(word('candid','坦率的','Honest and direct.','','spelling'),3,yesterday,'meaning');
  const cloze=word('reeled',reeled.translation,reeled.definition,'The exhausted sailor reeled along the narrow deck.','cloze');cloze.source='ECDICT';
  seed.state.entries=[legacy,second,cloze,word('resilient','有韧性的','Capable of recovering after difficulties.','A resilient learner keeps trying.','cloze'),word('adaptive','适应性的','Able to adjust to changes.','','meaning'),word('cautious','谨慎的','Careful to avoid risks.','','meaning'),word('glimpse','一瞥','A brief view of something.','','production'),word('compose','创作','To write music or a piece of text.','','production')];
  seed.state.notebooks=['spelling','cloze','meaning','production'].map(id=>({id,name:id,bookIds:[],createdAt:yesterday.toISOString()}));
  seed.state.settings.reviewMethods=['spelling'];seed.state.settings.preloadSpeech=false;seed.save();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const env={...process.env,MEMREADER_TEST:'1',MEMREADER_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({executablePath:process.env.MEMREADER_EXE||require('electron'),args:process.env.MEMREADER_EXE?['--disable-gpu']:['--disable-gpu',root],env,timeout:30000});
  const page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
  const boot=()=>page.evaluate(()=>window.mem.boot());
  const focused=locator=>expect.poll(()=>locator.evaluate(element=>element===document.activeElement)).toBe(true);
  async function mode(method,book){
    await page.evaluate(method=>window.mem.saveSettings({reviewMethods:[method]}),method);await page.reload();
    await nav(page,'生词本').click();await page.getByRole('combobox',{name:'选择词本',exact:true}).selectOption(book);await page.getByRole('button',{name:'去复习',exact:true}).click();
  }
  try{
    await nav(page,'偏好设置').waitFor();await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.setSize(1450,960);win.showInactive();});
    await page.evaluate(port=>window.mem.saveSettings({apiKey:'test-key-not-real',apiBase:'http://127.0.0.1:'+port,apiModel:'test',preloadSpeech:false}),server.address().port);
    let state=await boot(),migrated=state.entries.find(entry=>entry.id===legacy.id);
    assert.match(migrated.translation,/匆忙/);assert.doesNotMatch(migrated.translation,/密码形式|扰频/);assert.equal(migrated.note,'Keep my note');assert.equal(migrated.reviewSkills.meaning.card.reps,legacy.reviewSkills.meaning.card.reps);
    checks.legacyInflections={meaningRepaired:true,noteAndProgressPreserved:true};
    await mode('spelling','spelling');
    const spelling=page.getByRole('textbox',{name:'拼写答案',exact:true});await focused(spelling);
    assert.match(await page.locator('.spell-definition').innerText(),/匆忙/);
    await page.keyboard.type('scrambled');await expect(spelling).toHaveValue('scrambled');await page.keyboard.press('Enter');await focused(page.locator('.ratings .good'));
    const before=(await boot()).stats.reviews.length;
    for(const [key,cls] of [['ArrowLeft','hard'],['ArrowRight','good'],['ArrowDown','easy'],['Home','again'],['End','easy'],['ArrowUp','good']]){await page.keyboard.press(key);await focused(page.locator('.ratings .'+cls));}
    assert.equal((await boot()).stats.reviews.length,before,'Selecting a rating must not grade');
    await page.keyboard.press('Enter');await focused(spelling);await expect(spelling).toHaveValue('');await page.keyboard.type('wrong');await page.keyboard.press('Enter');await focused(page.locator('.ratings .again'));
    for(const cls of ['hard','good','easy'])assert.equal(await page.locator('.ratings .'+cls).isDisabled(),true);
    await page.keyboard.press('ArrowRight');await focused(page.locator('.ratings .again'));await page.keyboard.press('ArrowDown');await focused(page.locator('.ratings .again'));await page.keyboard.press('Enter');
    await expect.poll(async()=>(await boot()).stats.reviews.length).toBe(before+2);
    assert.equal((await boot()).stats.reviews.at(-1).rating,1);checks.spellingKeyboard={automaticFirstAndNextFocus:true,arrowSelection:true,enterConfirmation:true,wrongCannotPass:true};
    await mode('cloze','cloze');const input=page.getByRole('textbox',{name:'填空答案',exact:true});await focused(input);
    const exerciseBefore=(await boot()).entries.find(entry=>entry.id===cloze.id).clozePractice.active;
    const deck=page.getByRole('button',{name:'查词 deck',exact:true});await deck.focus();await page.keyboard.press('Enter');const dialog=page.getByRole('dialog',{name:'填空查词',exact:true});await dialog.waitFor();await focused(page.getByRole('button',{name:'关闭查词',exact:true}));
    await page.keyboard.press('Shift+Tab');assert.ok(await dialog.evaluate(element=>element.contains(document.activeElement)));
    await page.keyboard.press('F1');assert.equal((await boot()).entries.find(entry=>entry.id===cloze.id).clozePractice.active.hints,exerciseBefore.hints);
    await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await focused(input);
    await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'F1',isComposing:true,bubbles:true,cancelable:true})));assert.equal((await boot()).entries.find(entry=>entry.id===cloze.id).clozePractice.active.hints,0);
    await page.keyboard.press('F1');await expect.poll(async()=>(await boot()).entries.find(entry=>entry.id===cloze.id).clozePractice.active.hints).toBe(1);await focused(input);
    const hint=await page.locator('.cloze-hint').innerText();assert.match(hint,/walk|revolve|wind/);assert.doesNotMatch(hint,/\breel(?:s|ed|ing)?\b|past tense|p\. p\./i);
    await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'F1',repeat:true,bubbles:true,cancelable:true})));assert.equal((await boot()).entries.find(entry=>entry.id===cloze.id).clozePractice.active.hints,1);
    await page.keyboard.press('Alt+h');await expect(page.locator('.cloze-hint')).toHaveCount(2);await expect(input).toBeEnabled();await focused(input);await page.keyboard.press('F1');await expect(input).toHaveValue('r');await focused(input);await page.keyboard.press('F1');await page.locator('.cloze-due').waitFor();
    state=await boot();assert.equal(state.stats.reviews.at(-1).rating,1);assert.equal(state.stats.reviews.at(-1).hints,4);await focused(page.getByRole('button',{name:'继续',exact:true}));
    await page.screenshot({path:path.join(shots,'04-safe-english-hint-keyboard.png'),timeout:10000});
    await page.keyboard.press('Enter');await focused(input);await page.keyboard.type('resilient');await page.keyboard.press('Enter');await page.locator('.cloze-due').waitFor();await page.keyboard.press('Enter');assert.equal(requests.length,0);
    checks.clozeKeyboard={safeSemanticEnglishHint:true,F1AndAltH:true,imeAndRepeatGuards:true,dialogFocusTrap:true,escapeRestoresInput:true,nextFocus:true,noAIRequests:true};
    await mode('meaning','meaning');await focused(page.getByRole('button',{name:'显示答案',exact:true}));await page.keyboard.press('F1');await focused(page.locator('.ratings .good'));await page.keyboard.press('ArrowLeft');await page.keyboard.press('Enter');await page.locator('.flashcard-front h2').filter({hasText:'cautious'}).waitFor();await focused(page.getByRole('button',{name:'显示答案',exact:true}));await page.keyboard.press('Alt+h');await focused(page.locator('.ratings .good'));await page.keyboard.press('4');
    await expect.poll(async()=>(await boot()).entries.find(entry=>entry.text==='cautious').reviewSkills.meaning.card.reps).toBe(1);checks.meaningKeyboard={hintShortcutReveals:true,directNumberRating:true};
    await mode('production','production');const writing=page.getByRole('textbox',{name:'造句答案',exact:true});await expect(writing).toBeEnabled();await focused(writing);await page.keyboard.type('I caught a glimpse of the bird.');await page.keyboard.press('Control+Enter');await page.getByText('造句正确',{exact:true}).waitFor();await focused(page.getByRole('button',{name:'继续',exact:true}));await page.keyboard.press('Enter');await expect(writing).toBeEnabled();await focused(writing);await expect(writing).toHaveValue('');assert.equal(requests.length,1);checks.productionFocus={afterAsyncPrepare:true,afterNextQuestion:true,ctrlEnter:true};
    await page.evaluate(()=>window.mem.saveSettings({reviewMethods:['meaning']}));await page.reload();await nav(page,'偏好设置').click();await page.getByRole('combobox',{name:'界面语言',exact:true}).selectOption('en');await nav(page,'Review').click();await page.getByText('Enter to reveal/continue · Arrow keys to choose · 1–4 to rate',{exact:true}).waitFor();checks.englishShortcutLabels=true;
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(root,'publication','review-accessibility-validation.json'),JSON.stringify({version,executable:process.env.MEMREADER_EXE||'source',checks,aiRequests:requests.length,errors},null,2));console.log('ACCESSIBILITY UI PASSED '+JSON.stringify(checks));
  }finally{server.close();await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
