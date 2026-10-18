process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY='1';
const {_electron:electron,expect}=require('@playwright/test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),profile=path.join(__dirname,'regression-data-'+Date.now());
async function pdfWord(filename,word){
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc=await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(filename)),standardFontDataUrl:path.join(root,'node_modules/pdfjs-dist/standard_fonts').replace(/\\/g,'/')+'/'}).promise;
  try{const page=await doc.getPage(1),content=await page.getTextContent(),item=content.items.find(item=>item.str?.includes(word));assert.ok(item,'PDF word missing');const at=item.str.indexOf(word);return {x:item.transform[4]+(at+word.length/2)*item.width/item.str.length,y:item.transform[5]+item.height*0.35,width:page.view[2]-page.view[0],height:page.view[3]-page.view[1],font:item.height};}finally{await doc.destroy();}
}
(async()=>{
  const env={...process.env,MEMREADER_TEST:'1',MEMREADER_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({executablePath:process.env.MEMREADER_EXE||require('electron'),args:process.env.MEMREADER_EXE?['--disable-gpu']:['--disable-gpu',root],env});
  try{
    const page=await app.firstWindow();await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.setSize(1600,1000);win.showInactive();});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.getByRole('button',{name:'导入文档',exact:true}).waitFor();
    const pdfFile=process.env.MEMREADER_REGRESSION_PDF||path.join(__dirname,'fixtures/Courier.pdf');
    const files=[pdfFile,path.join(__dirname,'fixtures/Learning.docx'),path.join(__dirname,'fixtures/Learning.epub')];
    const books=await page.evaluate(files=>window.mem.importBooks(files),files);await page.reload();
    await page.locator('.book-card').getByRole('button',{name:books[0].title,exact:true}).click();await page.locator('.textLayer span').first().waitFor();
    const word=await pdfWord(pdfFile,'perfectly');
    async function selectVisibleWord(){
      let box=await page.locator('[data-pdf-page="1"] canvas').boundingBox();let x=box.x+word.x*box.width/word.width,y=box.y+(word.height-word.y)*box.height/word.height;
      const surface=await page.locator('.reader-surface').boundingBox();
      await page.locator('.reader-surface').evaluate((el,offset)=>{el.scrollTop+=offset.y;el.scrollLeft+=offset.x;},{x:Math.max(0,x-(surface.x+surface.width-60)),y:Math.max(0,y-(surface.y+surface.height-50))});
      box=await page.locator('[data-pdf-page="1"] canvas').boundingBox();x=box.x+word.x*box.width/word.width;y=box.y+(word.height-word.y)*box.height/word.height;
      await page.locator('[data-pdf-page="1"] .textLayer span').first().waitFor();
      await page.evaluate(()=>getSelection()?.removeAllRanges());await page.mouse.dblclick(x,y);
      if(!(await page.evaluate(()=>getSelection()?.toString())).trim()){
        await page.screenshot({path:path.join(__dirname,'screenshots/pdf-selection-failure.png'),timeout:10000});
        console.log('PDF selection diagnostic',await page.evaluate(({x,y})=>{const caret=document.caretRangeFromPoint(x,y),layer=document.querySelector('[data-pdf-page="1"] .textLayer');return {x,y,caretText:caret?.startContainer?.textContent?.slice(0,180),offset:caret?.startOffset,layerText:layer?.textContent?.slice(0,180),target:document.elementFromPoint(x,y)?.outerHTML?.slice(0,300)};},{x,y}));
      }
      assert.equal((await page.evaluate(()=>getSelection()?.toString())).trim(),'perfectly','Visible PDF glyphs and selection must agree');
      await page.locator('.translation-panel .entry-head h2').filter({hasText:/^perfectly$/}).waitFor();const add=page.locator('.translation-actions').getByRole('button',{name:'加入词本',exact:true});if(await add.isVisible()){await add.click();await page.locator('.translation-actions').getByRole('button',{name:'已添加',exact:true}).waitFor();}
    }
    for(const zoom of ['1','0.7','1.2']){
      await page.locator('.pdf-zoom input').evaluate((input,value)=>{const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));},zoom);
      await expect.poll(()=>page.evaluate(async zoom=>{const canvas=document.querySelector('.pdf-page canvas'),surface=document.querySelector('.reader-surface');if(!canvas||!surface||document.querySelector('.reader-loading')||!document.querySelector('.textLayer span'))return false;const settings=(await window.mem.boot()).settings;return Math.abs(canvas.getBoundingClientRect().width-Math.min(surface.clientWidth-64,settings.contentWidth+180)*Number(zoom))<1;},zoom)).toBe(true);await selectVisibleWord();
    }
    await page.screenshot({path:path.join(__dirname,'screenshots/08-selection-alignment.png')});
    console.log('Real mouse selection matches visible Courier PDF text at three zoom levels; DPR',await page.evaluate(()=>devicePixelRatio));
    const boundary=await page.locator('.reader-surface').evaluate(el=>{const next=el.querySelector('[data-pdf-page="2"]');const top=el.scrollTop+next.getBoundingClientRect().top-el.getBoundingClientRect().top;el.scrollTop=top-210;return top;});
    const scrollBox=await page.locator('.reader-surface').boundingBox();await page.mouse.move(scrollBox.x+scrollBox.width/2,scrollBox.y+scrollBox.height/2);
    const before=await page.locator('.reader-surface').evaluate(el=>el.scrollTop);await page.mouse.wheel(0,160);await page.waitForTimeout(350);const after=await page.locator('.reader-surface').evaluate(el=>el.scrollTop);
    assert.ok(after-before>=150&&after-before<=170,'The wheel must scroll by its delta across a PDF page boundary');assert.ok(after<boundary,'Crossing a boundary must not jump to the page top');assert.equal(await page.getByRole('spinbutton',{name:'跳转页码',exact:true}).inputValue(),'2');
    await page.mouse.wheel(0,120);await page.waitForTimeout(250);assert.equal(await page.getByRole('spinbutton',{name:'跳转页码',exact:true}).inputValue(),'2');
    await page.locator('.reader-surface').evaluate(el=>{el.scrollTop=0;});await page.waitForFunction(()=>document.querySelector('.reader-footer input')?.value==='1');
    console.log('Continuous PDF scrolling preserves wheel distance and page boundaries');
    await page.getByRole('button',{name:'切换 PDF 阅读模式',exact:true}).click();await page.locator('.pdf-text-document p').first().waitFor();
    assert.ok((await page.locator('.pdf-text-document').innerText()).includes('perfectly'));
    await page.getByRole('button',{name:'阅读样式',exact:true}).click();await page.getByRole('combobox',{name:'正文字体',exact:true}).selectOption('Arial');
    assert.ok((await page.locator('.pdf-text-document').evaluate(el=>getComputedStyle(el).fontFamily)).startsWith('Arial'));
    await page.locator('.style-popover input[type=range]').first().press('End');await page.waitForFunction(()=>getComputedStyle(document.querySelector('.pdf-text-document')).fontSize==='32px');
    await page.getByRole('button',{name:'关闭样式',exact:true}).click();await page.getByRole('button',{name:'切换 PDF 阅读模式',exact:true}).click();await page.locator('.textLayer span').first().waitFor();await selectVisibleWord();
    console.log('PDF text mode changes font and size while original PDF selection remains correct');
    await page.getByRole('button',{name:'返回书架',exact:true}).click();await page.getByRole('button',{name:'偏好设置',exact:true}).click();
    await page.getByRole('combobox',{name:'界面字体',exact:true}).selectOption('Segoe UI');await page.waitForFunction(()=>getComputedStyle(document.querySelector('.page-heading h1')).fontFamily.startsWith('"Segoe UI"'));
    await page.getByRole('button',{name:/^书架/}).first().click();await page.locator('.book-card').filter({hasText:'DOCX'}).getByRole('button',{name:'Learning',exact:true}).click();await page.locator('.prose table').waitFor();
    assert.ok((await page.locator('.prose').evaluate(el=>getComputedStyle(el).fontFamily)).startsWith('Arial'));
    await page.getByRole('button',{name:'返回书架',exact:true}).click();await page.locator('.book-card').filter({hasText:'EPUB'}).getByRole('button',{name:'Learning',exact:true}).click();
    const frame=page.frameLocator('.epub-document iframe');await frame.getByText('Chapter 1',{exact:true}).waitFor();assert.ok((await frame.locator('body').evaluate(el=>getComputedStyle(el).fontFamily)).startsWith('Arial'));
    const frameBox=await page.locator('.epub-document iframe').boundingBox();await page.mouse.move(frameBox.x+frameBox.width/2,frameBox.y+100);await page.mouse.wheel(0,180);await page.frameLocator('.epub-document iframe').getByText('Chapter 2',{exact:true}).waitFor();
    console.log('Interface, DOCX and EPUB fonts plus EPUB wheel page turns passed');
    await page.getByRole('button',{name:'返回书架',exact:true}).click();
    const sentence=await page.evaluate(()=>window.mem.collect({text:'A resilient learner keeps trying.',context:'A resilient learner keeps trying.',kind:'sentence',location:1,bookId:'',bookTitle:'Regression',translation:'有韧性的学习者会不断尝试。'}));
    await page.reload();await page.getByRole('button',{name:/^生词本/}).first().click();await page.locator('.vocab-row').filter({hasText:'A resilient learner keeps trying.'}).first().click();
    await page.getByRole('combobox',{name:'句子填空目标',exact:true}).fill('keeps trying');await page.locator('.vocab-detail .panel-heading').click();await expect.poll(()=>page.evaluate(async id=>(await window.mem.boot()).entries.find(e=>e.id===id)?.reviewTarget,sentence.id)).toBe('keeps trying');
    await assert.rejects(()=>page.evaluate(id=>window.mem.updateEntry(id,{reviewTarget:'not part of this sentence'}),sentence.id),/原句/);
    await page.getByRole('button',{name:'去复习',exact:true}).click();await page.getByRole('combobox',{name:'复习内容',exact:true}).selectOption('sentence');await page.getByRole('button',{name:'关键词填空',exact:true}).click();
    assert.equal(await page.locator('.cloze-text').innerText(),'A resilient learner ______ .');await page.getByRole('textbox',{name:'填空答案',exact:true}).fill('keeps trying');await page.getByRole('textbox',{name:'填空答案',exact:true}).press('Enter');await page.getByText('答案正确',{exact:false}).waitFor();await page.locator('.ratings .good').click();await page.locator('.review-complete').waitFor();
    assert.equal((await page.evaluate(()=>window.mem.boot())).entries.find(e=>e.id===sentence.id).card.reps,1);
    await page.locator('.app-sidebar nav').getByRole('button',{name:/^生词本/}).click();await page.getByRole('button',{name:'管理',exact:true}).click();const row=page.locator('.vocab-row').filter({hasText:'A resilient learner keeps trying.'}).first();await row.getByRole('button',{name:'删除条目',exact:true}).click();await page.getByRole('button',{name:'取消',exact:true}).click();assert.ok((await page.evaluate(()=>window.mem.boot())).entries.some(e=>e.id===sentence.id));
    await row.click();assert.ok(await page.locator('.sticky-detail-heading').getByRole('button',{name:'删除条目',exact:true}).isVisible());await page.locator('.sticky-detail-heading').getByRole('button',{name:'删除条目',exact:true}).click();await page.getByRole('button',{name:'确认删除',exact:true}).click();await expect.poll(()=>page.evaluate(async id=>(await window.mem.boot()).entries.some(e=>e.id===id),sentence.id)).toBe(false);
    const remaining=await page.evaluate(()=>window.mem.boot());assert.ok(remaining.entries.some(e=>e.text==='perfectly'));assert.ok(!remaining.stats.reviews.some(r=>r.entryId===sentence.id));
    console.log('Sentence keyword recall, FSRS scoring, deletion cancellation and complete record deletion passed');
    await page.getByRole('button',{name:'偏好设置',exact:true}).click();await page.getByRole('combobox',{name:'界面语言',exact:true}).selectOption('en');assert.ok(await page.getByRole('combobox',{name:'Default sentence exercise',exact:true}).isVisible());
    await page.reload();const saved=await page.evaluate(()=>window.mem.boot());assert.equal(saved.settings.uiFont,'Segoe UI');assert.equal(saved.settings.readingFont,'Arial');assert.equal(saved.settings.sentenceReviewMode,'cloze');assert.equal(saved.settings.language,'en');
    assert.equal(errors.length,0,errors.join('\n'));console.log('READER REGRESSION PASSED',profile);
  }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
