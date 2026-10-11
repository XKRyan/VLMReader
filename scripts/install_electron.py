import hashlib,json,urllib.request,zipfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]
pkg=root/'node_modules'/'electron'
version=json.loads((pkg/'package.json').read_text())['version']
name=f'electron-v{version}-win32-x64.zip'
target=root/'downloads'/name
if not target.exists():
    print('Downloading Windows runtime',flush=True)
    req=urllib.request.Request('https://github.com/electron/electron/releases/download/v'+version+'/'+name,headers={'User-Agent':'MemReader-build'})
    with urllib.request.urlopen(req,timeout=90) as res,target.with_suffix('.part').open('wb') as out:
        while b:=res.read(1024*1024):out.write(b)
    target.with_suffix('.part').replace(target)
digest=hashlib.sha256(target.read_bytes()).hexdigest()
expected=json.loads((pkg/'checksums.json').read_text())[name]
assert digest==expected,'Runtime checksum mismatch'
print('Checksum verified; extracting',flush=True)
with zipfile.ZipFile(target) as z:z.extractall(pkg/'dist')
(pkg/'path.txt').write_text('electron.exe')
print('Windows runtime ready',flush=True)
