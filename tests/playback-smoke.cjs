const {_electron:electron}=require('@playwright/test');
const assert=require('node:assert/strict');const path=require('node:path');
const root=path.resolve(__dirname,'..');
(async()=>{
 const env={...process.env,MEMREADER_TEST:'1',MEMREADER_TEST_DATA:path.join(__dirname,'playback-data-'+Date.now())};delete env.ELECTRON_RUN_AS_NODE;
 const exe=process.env.MEMREADER_EXE||require('electron');
 const app=await electron.launch({executablePath:exe,args:process.env.MEMREADER_EXE?['--disable-gpu']:['--disable-gpu',root],env,timeout:30000});
 try{
  const page=await app.firstWindow();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());
  await page.getByRole('button',{name:'导入文档',exact:true}).waitFor();
  await page.evaluate(async filename=>{await window.mem.importBooks([filename]);await window.mem.saveSettings({rate:1,continuousRead:true});},path.join(__dirname,'fixtures','Speech.pdf'));
  await page.reload();await page.locator('.book-card').getByRole('button',{name:'Speech',exact:true}).click();await page.locator('.textLayer span').first().waitFor();
  await page.getByRole('button',{name:'开始朗读',exact:true}).click();await page.locator('.audio-info strong').filter({hasText:'正在朗读'}).waitFor({timeout:30000});
  await page.getByRole('button',{name:'暂停朗读',exact:true}).click();await page.locator('.audio-info strong').filter({hasText:'朗读已暂停'}).waitFor();
  assert.equal(await page.locator('.reader-footer>span').first().innerText(),'第 1 / 2 页');
  await page.getByRole('slider',{name:'朗读速度',exact:true}).press('End');assert.equal((await page.evaluate(()=>window.mem.boot())).settings.rate,3);
  await page.getByRole('button',{name:'开始朗读',exact:true}).click();await page.getByText('第 2 / 2 页',{exact:true}).waitFor({timeout:30000});
  await page.locator('.audio-info strong').filter({hasText:'听一听，让文字有声音'}).waitFor({timeout:30000});
  assert.ok((await page.locator('.textLayer').innerText()).includes('Second page'));
  console.log('Real audio playback, pause/resume, continuous speed adjustment and automatic next-page reading passed');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
