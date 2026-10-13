const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const icon = path.join(root, 'assets', 'icon.ico');
const digest = data => crypto.createHash('sha256').update(data).digest('hex');

// Inspect PE resources as bytes; never load or execute the candidate program.
function inspect(file) {
  const data = fs.readFileSync(file);
  const pe = data.readUInt32LE(0x3c);
  if (data.toString('ascii', pe, pe + 4) !== 'PE\0\0') throw Error('Invalid Windows executable');
  const optional = pe + 24;
  const directory = optional + (data.readUInt16LE(optional) === 0x20b ? 112 : 96);
  const table = optional + data.readUInt16LE(pe + 20);
  const sections = [];
  for (let i = 0; i < data.readUInt16LE(pe + 6); i++) {
    const at = table + 40 * i;
    sections.push({name:data.toString('ascii', at, at + 8).replace(/\0.*$/, ''), size:data.readUInt32LE(at + 16), address:data.readUInt32LE(at + 12), offset:data.readUInt32LE(at + 20), executable:!!(data.readUInt32LE(at + 36) & 0x20000000)});
  }
  const offset = address => {
    const section = sections.find(s => address >= s.address && address < s.address + s.size);
    if (!section) throw Error('Invalid resource address');
    return section.offset + address - section.address;
  };
  const base = offset(data.readUInt32LE(directory + 16));
  const resources = [];
  function walk(relative, ids) {
    const at = base + relative;
    const count = data.readUInt16LE(at + 12) + data.readUInt16LE(at + 14);
    for (let i = 0; i < count; i++) {
      const entry = at + 16 + i * 8;
      const id = data.readUInt32LE(entry);
      const child = data.readUInt32LE(entry + 4);
      if (child & 0x80000000) walk(child & 0x7fffffff, [...ids, id]);
      else {
        const value = base + child;
        const start = offset(data.readUInt32LE(value));
        resources.push({ids:[...ids, id], bytes:data.subarray(start, start + data.readUInt32LE(value + 4))});
      }
    }
  }
  walk(0, []);
  return {data, sections, resources};
}

function verifyBranding(file) {
  const candidate = inspect(file);
  const official = inspect(require('electron'));
  const originalCode = official.sections.filter(s => s.executable);
  const newCode = candidate.sections.filter(s => s.executable);
  if (originalCode.length !== newCode.length || originalCode.some((s, i) => s.name !== newCode[i].name || !official.data.subarray(s.offset, s.offset + s.size).equals(candidate.data.subarray(newCode[i].offset, newCode[i].offset + newCode[i].size)))) throw Error('Executable code differs from the official Electron runtime');
  const ico = fs.readFileSync(icon);
  const expected = [];
  for (let i = 0; i < ico.readUInt16LE(4); i++) {
    const at = 6 + i * 16;
    expected.push({width:ico[at] || 256, height:ico[at + 1] || 256, bytes:ico.subarray(ico.readUInt32LE(at + 12), ico.readUInt32LE(at + 12) + ico.readUInt32LE(at + 8))});
  }
  const groups = candidate.resources.filter(r => r.ids[0] === 14);
  if (!groups.length || groups.some(group => {
    if (group.bytes.readUInt16LE(4) !== expected.length) return true;
    return expected.some((item, i) => {
      const at = 6 + i * 14;
      const id = group.bytes.readUInt16LE(at + 12);
      const resource = candidate.resources.find(r => r.ids[0] === 3 && r.ids[1] === id && r.ids[2] === group.ids[2]);
      return (group.bytes[at] || 256) !== item.width || (group.bytes[at + 1] || 256) !== item.height || !resource?.bytes.equals(item.bytes);
    });
  })) throw Error('The executable does not contain the current VLMReader book icon at every size');
  return {sha256:digest(candidate.data), iconSha256:digest(ico), sizes:expected.map(item => item.width), executableCodeUnchanged:true};
}

function verifySignature(file) {
  const env = {...process.env, VLMREADER_SIGNATURE_CHECK:path.resolve(file)};
  // PowerShell 7 module paths cannot be inherited by Windows PowerShell 5.1.
  delete env.PSModulePath;
  const result = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; $signature=Get-AuthenticodeSignature -LiteralPath $env:VLMREADER_SIGNATURE_CHECK; [pscustomobject]@{status=$signature.Status.ToString();subject=$signature.SignerCertificate.Subject} | ConvertTo-Json -Compress"], {encoding:'utf8', windowsHide:true, env}));
  if (result.status !== 'Valid') throw Error('A trusted publishing signature is required; candidate signature status: ' + result.status);
  return result;
}

function prepare() {
  const output = path.join(root, 'publication', 'signing', 'VLMReader.exe');
  fs.mkdirSync(path.dirname(output), {recursive:true});
  fs.copyFileSync(require('electron'), output);
  const builder = require.resolve('app-builder-lib/package.json', {paths:[path.dirname(require.resolve('electron-builder/package.json'))]});
  const editor = require.resolve('electron-winstaller/vendor/rcedit.exe', {paths:[path.dirname(builder)]});
  const version = require('../package.json').version;
  execFileSync(editor, [output, '--set-icon', icon, '--set-version-string', 'ProductName', 'VLMReader', '--set-version-string', 'FileDescription', 'VLMReader', '--set-version-string', 'CompanyName', 'VLMReader', '--set-version-string', 'OriginalFilename', 'VLMReader.exe', '--set-file-version', version, '--set-product-version', version], {windowsHide:true});
  const report = {file:output, version, ...verifyBranding(output), status:'PREPARED_NOT_LAUNCH_VALIDATED', installedApplicationUnchanged:true};
  fs.writeFileSync(path.join(path.dirname(output), 'verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  return report;
}

module.exports = {verifyBranding, verifySignature, prepare};
if (require.main === module) prepare();
