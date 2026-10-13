const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {spawn, execFileSync} = require('node:child_process');
const {_electron: electron} = require('@playwright/test');
const {Store} = require('../electron/store.cjs');

const root = path.resolve(__dirname, '..');
const payload = path.resolve(process.env.VLMREADER_PACKAGE_DIR || path.join(root, 'release', 'win-unpacked'));
const version = require('../package.json').version;
let installer = path.join(root, 'publication', `VLMReader-Setup-${version}-x64.msi`);
const target = path.join(root, 'publication', 'installer-test-' + Date.now(), 'VLMReader');
assert.ok(target.startsWith(path.join(root, 'publication') + path.sep));
const data = path.join(target, 'data');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const personalFile = path.join(root, 'data', 'library.json');
const beforePersonal = fs.existsSync(personalFile) ? digest(personalFile) : null;
function run(exe, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {windowsHide: true});
    child.on('error', reject); child.on('exit', code => resolve(code));
  });
}
function walk(dir) {
  return fs.readdirSync(dir, {withFileTypes:true}).flatMap(item => item.isDirectory() ? walk(path.join(dir,item.name)) : [path.join(dir,item.name)]);
}
let productCode;
{
  const clone=path.join(root,'publication','installer-test-'+Date.now()+'.msi');
  const prepared=JSON.parse(execFileSync(process.env.VLMREADER_PYTHON||'python',['scripts/prepare_installer_test_msi.py',installer,clone],{cwd:root,encoding:'utf8'}));
  installer=clone; productCode=prepared.productCode;
}
const installerLog=path.join(root,'publication','installer-test.log');
function installedVersion(){
  const script='$ErrorActionPreference="Stop"; $installer = New-Object -ComObject WindowsInstaller.Installer; $installer.ProductInfo("'+productCode+'", "VersionString")';
  return execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8'}).trim();
}
const install = upgrade => run('msiexec.exe',['/i',installer,'/qn','/norestart','/L*v',installerLog,'INSTALLDIR='+target,...(upgrade?['REINSTALL=ALL','REINSTALLMODE=vomus']:[])]);
const desktop = path.join(process.env.USERPROFILE, 'Desktop', 'VLMReader Installer Test.lnk');
const menu = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'VLMReader Installer Test', 'VLMReader Installer Test.lnk');
const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE; delete env.MEMREADER_TEST; delete env.MEMREADER_TEST_DATA;
async function launch() {
  const app = await electron.launch({executablePath:path.join(target,'release','win-unpacked','VLMReader.exe'),args:['--disable-gpu'],env,timeout:30000});
  const page = await app.firstWindow(); await page.waitForFunction(() => !!window.mem);
  return {app,page};
}
(async () => {
  const store = new Store(data); store.state.settings.preloadSpeech = false; store.save();
  fs.writeFileSync(path.join(data,'keep-document.txt'), 'Do not remove my reading data.');
  fs.writeFileSync(path.join(target,'unrelated-project-file.txt'), 'Do not remove unrelated files.');
  const beforeInstall = digest(path.join(data,'library.json'));
  assert.equal(await install(false), 0);
  assert.equal(digest(path.join(data,'library.json')), beforeInstall);
  assert.ok(fs.existsSync(desktop)); assert.ok(fs.existsSync(menu));
  assert.match(installedVersion(), new RegExp(version.replaceAll('.', '\\.')));
  for (const file of walk(payload)) {
    assert.equal(digest(path.join(target,'release','win-unpacked',path.relative(payload,file))),digest(file));
  }
  console.log('Silent install, all payload hashes, user data, shortcuts and uninstall registration passed.');
  let {app,page} = await launch();
  let state;
  try {
    state = await page.evaluate(() => window.mem.boot()); assert.equal(state.dataDir, data); assert.equal(state.ttsReady, true);
    const definition = await page.evaluate(() => window.mem.lookup('resilient')); assert.ok(JSON.stringify(definition).includes('弹'));
    const audio = await page.evaluate(() => window.mem.speak('Read and remember.',0));
    assert.equal(Buffer.from(audio.data,'base64').toString('ascii',0,4),'RIFF');
    await page.evaluate(() => window.mem.saveSettings({uiFontSize:18}));
    await page.evaluate(filename => window.mem.importBooks([filename]),path.join(root,'tests','fixtures','Learning.docx'));
  } finally { await app.close(); }
  const beforeUpgrade = digest(path.join(data,'library.json'));
  assert.equal(await install(true), 0);
  assert.equal(digest(path.join(data,'library.json')),beforeUpgrade);
  ({app,page}=await launch());
  try { state=await page.evaluate(() => window.mem.boot()); assert.equal(state.settings.uiFontSize,18); assert.ok(state.books.some(book=>book.format==='docx')); }
  finally { await app.close(); }
  console.log('Actual installed application, offline dictionary/models, upgrade and relaunch persistence passed.');
  const beforeUninstall = digest(path.join(data,'library.json'));
  assert.equal(await run('msiexec.exe',['/x',productCode,'/qn','/norestart','/L*v',path.join(root,'publication','installer-uninstall-test.log')]),0);
  assert.equal(digest(path.join(data,'library.json')),beforeUninstall);
  assert.equal(fs.readFileSync(path.join(data,'keep-document.txt'),'utf8'),'Do not remove my reading data.');
  assert.equal(fs.readFileSync(path.join(target,'unrelated-project-file.txt'),'utf8'),'Do not remove unrelated files.');
  assert.ok(!fs.existsSync(path.join(target,'release','win-unpacked','VLMReader.exe')));
  assert.ok(!fs.existsSync(desktop)); assert.ok(!fs.existsSync(menu));
  let registryMissing=false; try {installedVersion();} catch {registryMissing=true;} assert.ok(registryMissing);
  if(beforePersonal) assert.equal(digest(personalFile),beforePersonal);
  console.log('Uninstall removes the program and registrations, preserves data/unrelated files, and never changes the personal library.');
  fs.writeFileSync(path.join(root,'publication','installer-validation.json'),JSON.stringify({version,target,install:true,upgrade:true,relaunch:true,offlineResources:true,uninstall:true,dataPreserved:true,personalLibraryUnchanged:true},null,2));
})().catch(async error=>{console.error(error);await run('msiexec.exe',['/x',productCode,'/qn','/norestart']);process.exitCode=1;});
