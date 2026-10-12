const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const output=path.resolve(process.argv[2]||path.join(root,'release','win-unpacked'));
const upstream=require('electron');
const executable=path.join(output,require('../package.json').build.productName+'.exe');
// Preserve the official runtime byte for byte. Modified executable resources can
// fail Windows application-control reputation checks; app branding stays in the
// window and shortcut. No security policy or runtime fuse is changed.
if(!fs.existsSync(path.join(output,'resources','app.asar')))throw Error('Build the application package first.');
fs.copyFileSync(upstream,executable);
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if(digest(upstream)!==digest(executable))throw Error('Runtime verification failed.');
fs.copyFileSync(path.join(root,'README.md'),path.join(output,'使用说明.md'));
console.log('VLMReader packaged with the verified, unmodified official Electron runtime.');
