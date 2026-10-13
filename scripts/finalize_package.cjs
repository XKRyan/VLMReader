const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const output=path.resolve(process.argv[2]||path.join(root,'release','win-unpacked'));
const upstream=require('electron');
const executable=path.join(output,require('../package.json').build.productName+'.exe');
if(!fs.existsSync(path.join(output,'resources','app.asar')))throw Error('Build the application package first.');
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const signed=process.env.VLMREADER_SIGNED_EXECUTABLE;
const compatibility=process.env.VLMREADER_COMPATIBILITY_EDITION==='1';
const branded=process.env.VLMREADER_BRANDED_EXECUTABLE||(!signed&&!compatibility?require('./windows-branding.cjs').prepare().file:null);
if(signed||branded){
  const {verifyBranding,verifySignature}=require('./windows-branding.cjs');
  const candidate=path.resolve(signed||branded);
  // Validate before replacing anything; never silently restore the old icon.
  verifyBranding(candidate);
  if(signed||process.env.VLMREADER_REQUIRE_SIGNATURE==='1')verifySignature(candidate);
  if(candidate!==executable)fs.copyFileSync(candidate,executable);
  if(digest(candidate)!==digest(executable))throw Error('Signed runtime copy verification failed.');
  console.log(signed?'VLMReader packaged with its embedded book icon and verified publishing signature.':'VLMReader packaged with its embedded book icon; this unsigned build requires actual Windows launch validation before release.');
}else{
  // Existing compatibility edition retains the accepted official binary until
  // a branded runtime has a trusted signature. No Windows security settings change.
  fs.copyFileSync(upstream,executable);
  if(digest(upstream)!==digest(executable))throw Error('Runtime verification failed.');
  console.log('Compatibility edition: executable retains the Electron icon; window and shortcuts use the book icon.');
}
fs.copyFileSync(path.join(root,'README.md'),path.join(output,'使用说明.md'));
