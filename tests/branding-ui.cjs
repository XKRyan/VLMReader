const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {_electron:electron} = require('@playwright/test');
const {verifyBranding} = require('../scripts/windows-branding.cjs');
const root = path.resolve(__dirname, '..');
const executable = process.env.MEMREADER_EXE || path.join(root, 'release-next', 'win-unpacked', 'VLMReader.exe');
const profile = path.join(root, 'publication', 'branding-test-' + Date.now());
const env = {...process.env, MEMREADER_TEST:'1', MEMREADER_TEST_DATA:profile};
delete env.ELECTRON_RUN_AS_NODE;
async function launch() {
  const app = await electron.launch({executablePath:executable, args:['--disable-gpu'], env, timeout:30000});
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.mem);
  return {app, page};
}
(async () => {
  const report = verifyBranding(executable);
  assert.deepEqual(report.sizes, [16,24,32,48,64,128,256]);
  let instance = await launch();
  try {
    assert.equal(await instance.app.evaluate(({app}) => app.getVersion()), require('../package.json').version);
    assert.equal(await instance.app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].getTitle()), 'VLMReader');
    const shellIcon = await instance.app.evaluate(async ({app}) => {
      const icon = await app.getFileIcon(process.execPath, {size:'large'});
      return {png:icon.toPNG().toString('base64'), bitmap:icon.toBitmap().toString('base64')};
    });
    const bitmap = Buffer.from(shellIcon.bitmap, 'base64');
    let purple=0, white=0;
    for(let i=0;i<bitmap.length;i+=4){
      const [b,g,r,a]=bitmap.subarray(i,i+4);
      if(a>200&&b>r+20&&r>g+5)purple++;
      if(a>200&&r>240&&g>240&&b>240)white++;
    }
    assert.ok(purple>=8 && white>=100, 'Windows must read the purple/white book, not its generic program icon');
    fs.mkdirSync(profile, {recursive:true});
    fs.writeFileSync(path.join(root, 'publication', 'exe-icon-proof.png'), Buffer.from(shellIcon.png, 'base64'));
    const result = await instance.page.evaluate(() => window.mem.lookup('resilient'));
    assert.ok(result.translation || result.definition);
    await instance.page.evaluate(() => window.mem.saveSettings({uiFontSize:18}));
  } finally { await instance.app.close(); }
  instance = await launch();
  try {
    assert.equal((await instance.page.evaluate(() => window.mem.boot())).settings.uiFontSize, 18);
    assert.equal(await instance.app.evaluate(({app}) => app.getVersion()), require('../package.json').version);
  } finally { await instance.app.close(); }
  fs.writeFileSync(path.join(root,'publication','branding-validation.json'), JSON.stringify({...report, version:require('../package.json').version, executable, launch:true, relaunch:true, offlineDictionary:true, persistentSettings:true}, null, 2) + '\n');
  console.log('Actual branded EXE startup, Windows file icon, offline dictionary and relaunch persistence passed.');
})().catch(error => {console.error(error); process.exitCode=1;});
