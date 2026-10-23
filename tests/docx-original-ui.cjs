const {_electron:electron,expect}=require('@playwright/test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),JSZip=require('jszip');
const {Store}=require('../electron/store.cjs');
const root=path.resolve(__dirname,'..'),profile=path.join(root,'publication','word-view-data-'+Date.now());
fs.mkdirSync(profile,{recursive:true});const store=new Store(profile);store.state.settings={...store.state.settings,language:'en',preloadSpeech:false};store.save();
const checks={},errors=[];let app;
async function fixture(){
 const zip=new JSZip();zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
 zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
 let paragraphs='';for(let i=1;i<=3;i++){if(i>1)paragraphs+='<w:p><w:r><w:br w:type="page"/></w:r></w:p>';for(let j=1;j<=8;j++)paragraphs+=`<w:p><w:pPr><w:spacing w:after="240"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="28"/><w:color w:val="155599"/></w:rPr><w:t>Page ${i} paragraph ${j}: A thoughtful reader keeps useful explanations beside the source.</w:t></w:r></w:p>`;}
 paragraphs+='<w:tbl><w:tblPr><w:tblW w:w="8000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>First column</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Second column</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
 zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+paragraphs+'<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000"/></w:sectPr></w:body></w:document>');
 const file=path.join(profile,'Word layout verification.docx');fs.writeFileSync(file,await zip.generateAsync({type:'nodebuffer'}));return file;
}
async function ready(page,original){await expect(page.locator(original?'.word-original section.vlm-word':'.prose p').first()).toBeVisible();await expect(page.locator('.reader-loading')).toHaveCount(0);}
(async()=>{
 const file=await fixture(),env={...process.env,MEMREADER_TEST:'1',MEMREADER_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
 app=await electron.launch({executablePath:process.env.MEMREADER_EXE||require('electron'),args:process.env.MEMREADER_EXE?['--disable-gpu']:['--disable-gpu',root],env});
 const page=await app.firstWindow();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.getByRole('button',{name:'Import documents',exact:true}).waitFor();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1450,980));
 const book=(await page.evaluate(file=>window.mem.importBooks([file]),file))[0];
 const text='Page 2 paragraph 3: A thoughtful reader keeps useful explanations beside the source.';
 await page.evaluate(({book,text})=>window.mem.note({bookId:book.id,location:0,text,note:'Keep this annotation in both views.',color:'blue',newAnnotation:true}),{book,text});
 await page.reload();await page.locator('.book-card').getByRole('button',{name:book.title,exact:true}).click();await ready(page,false);
 const mode=page.getByRole('button',{name:'Switch Word reading mode',exact:true});await expect(mode).toHaveText('Original layout');
 await page.locator('.prose p').filter({hasText:text}).evaluate(el=>el.scrollIntoView({block:'start'}));
 const before=await page.locator('.prose p').filter({hasText:text}).boundingBox();
 await mode.click();await ready(page,true);
 await expect(page.locator('.word-original section.vlm-word')).toHaveCount(3);
 const original=page.locator('.word-original p').filter({hasText:text});await expect(original).toBeInViewport();
 const after=await original.boundingBox();assert.ok(Math.abs(after.y-before.y)<80,'Switch preserves the current paragraph');
 const font=await original.locator('span').first().evaluate(el=>({font:getComputedStyle(el).fontFamily,color:getComputedStyle(el).color,size:getComputedStyle(el).fontSize}));assert.match(font.font,/Courier New/);assert.equal(font.color,'rgb(21, 85, 153)');assert.equal(font.size,'18.6667px');
 await expect(page.locator('.word-original table')).toHaveCount(1);checks.pagesFontsColorsTables=true;checks.positionPreserved=true;
 assert.equal(await page.evaluate(()=>CSS.highlights.get('memreader-notes').size),1);await expect(page.locator('.annotation-marker')).toHaveCount(1);checks.savedAnnotationLocated=true;
 // The whole document still participates in normal selection and draft previews.
 await original.evaluate(el=>{const walk=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);const node=walk.nextNode(),range=document.createRange();range.setStart(node,0);range.setEnd(node,18);getSelection().removeAllRanges();getSelection().addRange(range);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
 await page.getByRole('button',{name:'Annotate selected text',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Annotation text',exact:true})).toBeFocused();await expect(mode).toBeDisabled();
 assert.ok(await page.evaluate(()=>CSS.highlights.get('vlmreader-note-preview')?.size>0));await page.getByRole('button',{name:'Close annotation editor',exact:true}).click();await expect(mode).toBeEnabled();checks.selectionDraftAndUnsavedProtection=true;
 await original.evaluate(el=>{const node=el.querySelector('span').firstChild,range=document.createRange();range.setStart(node,0);range.setEnd(node,18);getSelection().removeAllRanges();getSelection().addRange(range);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
 await page.getByRole('button',{name:'Annotate selected text',exact:true}).click();await page.getByRole('textbox',{name:'Annotation text',exact:true}).fill('Created in original Word view.');await page.getByRole('button',{name:'Save annotation',exact:true}).click();await expect(mode).toBeEnabled();
 await expect.poll(()=>page.evaluate(()=>CSS.highlights.get('memreader-notes').size)).toBe(2);checks.saveFromOriginalView=true;
 await mode.click();await ready(page,false);assert.equal(await page.evaluate(()=>CSS.highlights.get('memreader-notes').size),2);await expect(page.locator('.prose p').filter({hasText:text})).toBeInViewport();checks.roundTrip=true;
 await mode.click();await ready(page,true);await page.reload();await page.locator('.book-card').getByRole('button',{name:book.title,exact:true}).click();await ready(page,true);await expect(mode).toHaveText('Reading view');checks.perBookPreferencePersists=true;
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,720));
 await expect.poll(()=>page.locator('.word-original section.vlm-word').first().evaluate(el=>el.getBoundingClientRect().width<=el.closest('.reader-surface').clientWidth)).toBe(true);checks.fitsNarrowReader=true;
 await page.getByRole('button',{name:'Contents & bookmarks',exact:true}).click();await expect.poll(()=>page.locator('.word-original section.vlm-word').first().evaluate(el=>el.getBoundingClientRect().right<=el.closest('.reader-surface').getBoundingClientRect().right)).toBe(true);checks.fitsWithSidebar=true;
 await page.evaluate(()=>window.mem.saveSettings({uiFontSize:22}));await page.reload();await page.locator('.book-card').getByRole('button',{name:book.title,exact:true}).click();await ready(page,true);
 const toolbar=await page.locator('.reader-toolbar').boundingBox();for(const action of await page.locator('.reader-tools button').all()){const box=await action.boundingBox();assert.ok(box&&box.x>=toolbar.x&&box.x+box.width<=toolbar.x+toolbar.width+1,'Word actions fit at the largest interface font');}checks.largeUiToolbar=true;
 await page.evaluate(()=>window.mem.saveSettings({uiFontSize:16}));
 await page.getByRole('slider',{name:'Document zoom'}).fill('1.5');await expect(page.getByRole('slider',{name:'Document zoom'})).toHaveValue('1.5');await page.getByRole('slider',{name:'Document zoom'}).fill('1');await expect(page.getByRole('slider',{name:'Document zoom'})).toHaveValue('1');checks.zoom=true;
 const formatted=(await page.evaluate(file=>window.mem.importBooks([file]),path.join(root,'tests/fixtures/Formatting.docx')))[0];await page.reload();await page.locator('.book-card').getByRole('button',{name:formatted.title,exact:true}).click();await ready(page,false);await mode.click();await ready(page,true);await expect.poll(()=>page.locator('.word-original img').first().evaluate(img=>img.complete&&img.naturalWidth)).toBe(480);checks.embeddedImage=true;
 if(process.env.MEMREADER_WORD_SAMPLE){const sample=(await page.evaluate(file=>window.mem.importBooks([file]),process.env.MEMREADER_WORD_SAMPLE))[0];await page.reload();await page.locator('.book-card').getByRole('button',{name:sample.title,exact:true}).click();await ready(page,false);const text=(await page.locator('.prose').innerText()).replace(/\s+/g,' ').trim().slice(0,70);await mode.click();await ready(page,true);assert.ok((await page.locator('.word-original').innerText()).replace(/\s+/g,' ').includes(text));checks.realWordDocument={pages:await page.locator('.word-original section.vlm-word').count()};}
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1450,980));
 await page.locator('.reader-surface').evaluate(el=>el.scrollTop=0);
 await page.waitForTimeout(300);
 fs.writeFileSync(path.join(root,'publication','word-original.png'),Buffer.from(await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')),'base64'));
 assert.deepEqual(errors,[]);await app.close();app=null;
 fs.writeFileSync(path.join(root,'publication','word-original-validation.json'),JSON.stringify({version:require('../package.json').version,executable:process.env.MEMREADER_EXE||'source',checks,errors},null,2));console.log(JSON.stringify(checks));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(app)await app.close();});
