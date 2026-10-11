const {_electron:electron,expect}=require('@playwright/test'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),profile=path.join(__dirname,'progress-data-'+Date.now());fs.mkdirSync(profile,{recursive:true});const source=path.join(profile,'Progress.txt');fs.writeFileSync(source,'A learner keeps reading.\n\n'.repeat(200));
(async()=>{
 const env={...process.env,MEMREADER_TEST:'1',MEMREADER_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;const app=await electron.launch({executablePath:process.env.MEMREADER_EXE||require('electron'),args:process.env.MEMREADER_EXE?['--disable-gpu']:['--disable-gpu',root],env});
 try{const page=await app.firstWindow();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());await page.getByRole('button',{name:'偏好设置',exact:true}).waitFor();await page.evaluate(()=>window.mem.saveSettings({preloadSpeech:false}));const [book]=await page.evaluate(source=>window.mem.importBooks([source]),source);await page.reload();await page.locator('.book-card').getByRole('button',{name:'Progress',exact:true}).click();await page.locator('.prose p').first().waitFor();
 await page.locator('.reader-loading').waitFor({state:'hidden'});await page.locator('.reader-surface').evaluate(el=>el.scrollTop=900);await expect.poll(()=>page.evaluate(async id=>(await window.mem.boot()).books.find(b=>b.id===id).location,book.id)).toBe(900);
 await page.locator('.reader-surface').evaluate(el=>el.scrollTop=1234);await expect.poll(()=>page.evaluate(async id=>(await window.mem.boot()).books.find(b=>b.id===id).location,book.id)).toBe(1234);
 await app.close();const saved=JSON.parse(fs.readFileSync(path.join(profile,'library.json'),'utf8'));assert.equal(saved.books.find(b=>b.id===book.id).location,1234);console.log('PROGRESS EXIT PASSED',profile);
 }finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
