process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY='1';
const {_electron:electron,expect}=require('@playwright/test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),profile=path.join(__dirname,'formatting-data-'+Date.now()),shots=path.join(__dirname,'screenshots');
fs.mkdirSync(shots,{recursive:true});
async function launch(){const env={...process.env,MEMREADER_TEST:'1',MEMREADER_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;const app=await electron.launch({executablePath:process.env.MEMREADER_EXE||require('electron'),args:process.env.MEMREADER_EXE?['--disable-gpu']:['--disable-gpu',root],env,timeout:30000});await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.setSize(1600,1000);win.showInactive();});return app;}
async function color(locator,background,ink){await expect.poll(()=>locator.evaluate(el=>({background:getComputedStyle(el).backgroundColor,ink:getComputedStyle(el).color}))).toEqual({background,ink});}
(async()=>{let app=await launch();const errors=[];
try{
  let page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));await page.getByRole('button',{name:'导入文档',exact:true}).waitFor();
  const files=['Formatting.docx','Formatting.html','Formatting.md','Formatting.epub','Formatting.pdf'].map(file=>path.join(__dirname,'fixtures',file));
  const books=await page.evaluate(async files=>{await window.mem.saveSettings({preloadSpeech:false,readingFont:'Arial',fontSize:23});return window.mem.importBooks(files);},files);await page.reload();
  async function open(book){await page.locator('.book-card').filter({hasText:book.format.toUpperCase()}).getByRole('button',{name:book.title,exact:true}).click();await page.locator('.reader-loading').waitFor({state:'hidden'});}
  const docx=books.find(b=>b.format==='docx');await open(docx);
  await color(page.locator('.prose span').filter({hasText:/^yellow highlight$/}),'rgb(255, 255, 0)','rgb(0, 0, 0)');
  await color(page.locator('.prose span').filter({hasText:/^red text$/}),'rgba(0, 0, 0, 0)','rgb(192, 0, 0)');
  await color(page.locator('.prose span').filter({hasText:/^retrieval$/}),'rgb(0, 255, 255)','rgb(128, 0, 0)');
  await expect.poll(()=>page.locator('.prose img').evaluate(img=>img.complete&&img.naturalWidth===480)).toBe(true);
  await expect(page.locator('.prose table')).toBeVisible();
  assert.equal(await page.locator('.prose span').first().evaluate(el=>getComputedStyle(el).fontSize),'23px');assert.match(await page.locator('.prose span').first().evaluate(el=>getComputedStyle(el).fontFamily),/Arial/);
  await page.locator('.prose').evaluate(el=>{const node=[...el.querySelectorAll('span')].find(span=>span.textContent==='yellow highlight').firstChild,range=document.createRange();range.setStart(node,0);range.setEnd(node,6);getSelection().removeAllRanges();getSelection().addRange(range);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
  await expect(page.locator('.entry-head h2')).toHaveText('yellow');await expect.poll(()=>page.evaluate(async()=>(await window.mem.boot()).entries.some(e=>e.text==='yellow'&&e.context.includes('original yellow highlight')))).toBe(true);
  await page.locator('.translation-content').getByRole('button',{name:'添加批注',exact:true}).click();await page.getByRole('textbox',{name:'批注内容'}).fill('Highlight and annotation coexist.');await page.getByRole('button',{name:'保存批注',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>CSS.highlights.get('memreader-notes')?.size||0)).toBe(1);
  await page.screenshot({path:path.join(shots,'25-docx-formatting.png'),timeout:10000});
  await page.evaluate(()=>window.mem.saveSettings({theme:'night'}));await page.reload();await open(docx);await color(page.locator('.prose span').filter({hasText:/^yellow highlight$/}),'rgb(255, 255, 0)','rgb(0, 0, 0)');
  await color(page.locator('.prose span').filter({hasText:/^Dark blue highlight$/}),'rgb(0, 0, 128)','rgb(255, 255, 255)');await expect.poll(()=>page.evaluate(()=>CSS.highlights.get('memreader-notes')?.size||0)).toBe(1);
  await page.getByRole('button',{name:'返回书架',exact:true}).click();await page.evaluate(()=>window.mem.saveSettings({theme:'paper'}));await page.reload();
  for(const format of ['html','md']){
    await open(books.find(b=>b.format===format));
    const image=page.locator('.prose img');await expect.poll(()=>image.evaluate(img=>img.complete&&img.naturalWidth===480)).toBe(true);assert.ok((await image.getAttribute('src')).startsWith('data:image/png;base64,'));
    assert.equal(await page.evaluate(()=>window.documentExecuted),undefined);assert.equal(await page.locator('.prose script,.prose style,.prose [data-ui]').count(),0);
    assert.equal(await page.locator('.prose img').getAttribute('onerror'),null);
    if(format==='html'){
      await color(page.locator('.prose span').filter({hasText:/^yellow highlighting and blue words$/}),'rgb(255, 255, 0)','rgb(128, 0, 0)');
      assert.equal(await page.locator('.prose em').evaluate(el=>getComputedStyle(el).color),'rgb(0, 102, 204)');
      assert.equal(await page.locator('.prose font').evaluate(el=>getComputedStyle(el).color),'rgb(0, 128, 0)');
      assert.equal(await page.locator('.prose span').first().evaluate(el=>getComputedStyle(el).position),'static');assert.equal(await page.locator('.prose span').first().evaluate(el=>getComputedStyle(el).fontSize),'23px');
    }else await color(page.locator('.prose span').filter({hasText:'Highlighted Markdown'}),'rgb(255, 255, 0)','rgb(128, 0, 0)');
    await page.getByRole('button',{name:'返回书架',exact:true}).click();
  }
  await open(books.find(b=>b.format==='epub'));const frame=page.frameLocator('.epub-container iframe');await color(frame.locator('.source-highlight'),'rgb(255, 255, 0)','rgb(128, 0, 0)');await expect.poll(()=>frame.locator('img').evaluate(img=>img.complete&&img.naturalWidth===480)).toBe(true);await page.getByRole('button',{name:'返回书架',exact:true}).click();
  await open(books.find(b=>b.format==='pdf'));await page.locator('.textLayer span').first().waitFor();
  const pixels=await page.locator('.pdf-page canvas').evaluate(canvas=>{const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let yellow=0,purple=0;for(let at=0;at<data.length;at+=4){if(data[at]>240&&data[at+1]>240&&data[at+2]<30)yellow++;if(data[at]>70&&data[at]<170&&data[at+1]>50&&data[at+1]<150&&data[at+2]>180)purple++;}return {yellow,purple};});assert.ok(pixels.yellow>100&&pixels.purple>100,'Original PDF colors and embedded illustration must render');
  await app.close();app=await launch();page=await app.firstWindow();await page.getByRole('button',{name:'导入文档',exact:true}).waitFor();await open(docx);await expect.poll(()=>page.locator('.prose img').evaluate(img=>img.complete&&img.naturalWidth===480)).toBe(true);await color(page.locator('.prose span').filter({hasText:/^yellow highlight$/}),'rgb(255, 255, 0)','rgb(0, 0, 0)');
  assert.deepEqual(errors,[]);console.log('PASS: DOCX source highlights/colors/styles/images/table; fonts, selection, annotations, theme and restart; HTML/Markdown local images and safe styles; EPUB/PDF source colors and images.');
}finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
