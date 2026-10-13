"""Build a native, per-user Windows Installer package without executable custom actions.

Requires Windows Python 3.12 (msilib) and the finalized portable application.
The MSI owns only its listed program files. No data files are packaged or removed.
"""
import hashlib
import json
import uuid
import gc
import ctypes
import os
from pathlib import Path
import msilib
from msilib import schema, sequence, text

root = Path(__file__).resolve().parents[1]
payload = Path(os.environ.get('VLMREADER_PACKAGE_DIR', root / 'release/win-unpacked')).resolve()
version = json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
output = root / f'publication/VLMReader-Setup-{version}-x64.msi'
output.parent.mkdir(exist_ok=True)
code = lambda name: '{' + str(uuid.uuid5(uuid.NAMESPACE_URL, 'https://github.com/XKRyan/VLMReader/' + name)).upper() + '}'
product_code = code('product/' + version)
upgrade_code = code('upgrade')
db = msilib.init_database(str(output), schema, 'VLMReader', product_code, version, 'VLMReader')
# Set the database code page before any Chinese filenames or UI text are inserted.
db.Commit()
del db
gc.collect()
generated=root/'publication/installer-build'
generated.mkdir(exist_ok=True)
(generated/'codepage.idt').write_bytes(b'\r\n\r\n936\t_ForceCodepage\r\n')
msi=ctypes.WinDLL('msi')
handle=ctypes.c_uint()
assert msi.MsiOpenDatabaseW(str(output),ctypes.c_void_p(1),ctypes.byref(handle)) == 0
try:
    assert msi.MsiDatabaseImportW(handle,str(generated),'codepage.idt') == 0
    assert msi.MsiDatabaseCommit(handle) == 0
finally:
    msi.MsiCloseHandle(handle)
db=msilib.OpenDatabase(str(output),msilib.MSIDBOPEN_TRANSACT)
summary = db.GetSummaryInformation(20)
summary.SetProperty(msilib.PID_CODEPAGE,936)
summary.SetProperty(msilib.PID_WORDCOUNT, 10)  # compressed + no elevated privileges required
summary.SetProperty(msilib.PID_TEMPLATE, 'x64;2052')
summary.SetProperty(msilib.PID_APPNAME, 'VLMReader Windows Installer Builder')
summary.Persist()
msilib.add_tables(db, sequence)
add = lambda table, records: msilib.add_data(db, table, records)
add('Property', [
    ('UpgradeCode',upgrade_code), ('INSTALLLEVEL','1'),
    ('ARPPRODUCTICON','AppIcon'), ('ARPURLINFOABOUT','https://github.com/XKRyan/VLMReader'),
    ('ARPNOMODIFY','1'), ('ARPNOREPAIR','1'), ('MSIFASTINSTALL','7'),
    ('SecureCustomProperties','INSTALLDIR;OLDPRODUCTS'), ('DefaultUIFont','Normal'),
])
db.OpenView("UPDATE `Property` SET `Value` = '2052' WHERE `Property` = 'ProductLanguage'").Execute(None)
add('Icon', [('AppIcon', msilib.Binary(str(root/'assets/icon.ico')))])
add('TextStyle', [('Normal','Segoe UI',9,0x363026,0), ('Title','Segoe UI',18,0xD1637C,1)])
add('ActionText',text.ActionText)
add('UIText',text.UIText)
add('Upgrade',[(upgrade_code,None,version,None,257,None,'OLDPRODUCTS')])
add('AppSearch',[('EXISTINGDIR','ExistingInstall'),('DRIVE_D','DriveD')])
add('RegLocator',[
    ('ExistingInstall',1,'Software\\VLMReader\\MSI','InstallLocation',18),
    ('DriveD',2,'SYSTEM\\MountedDevices','\\DosDevices\\D:',18),
])
add('CustomAction',[
    ('DefaultLocalFolder',51,'INSTALLDIR','[LocalAppDataFolder]Programs\\VLMReader'),
    ('DefaultDFolder',51,'INSTALLDIR','D:\\VLMReader'),
    ('PreviousFolder',51,'INSTALLDIR','[EXISTINGDIR]'),
])
for table in ('InstallUISequence','InstallExecuteSequence'):
    # Set defaults before costing. Explicit command-line INSTALLDIR always wins.
    add(table,[('DefaultLocalFolder','NOT INSTALLDIR AND NOT DRIVE_D AND NOT EXISTINGDIR',701),('DefaultDFolder','NOT INSTALLDIR AND DRIVE_D AND NOT EXISTINGDIR',702),('PreviousFolder','EXISTINGDIR AND NOT INSTALLDIR',703)])

cab = msilib.CAB('payload.cab')
feature = msilib.Feature(db,'Reader','VLMReader','Reader, dictionary and offline speech',1,1)
feature.set_current()
target = msilib.Directory(db,cab,None,str(root),'TARGETDIR','SourceDir',componentflags=256)
appdir = msilib.Directory(db,cab,target,'.','INSTALLDIR','VLMReader',componentflags=256)
release_dir = msilib.Directory(db,cab,appdir,'release','ReleaseDir','release',componentflags=256)
runtime_dir = msilib.Directory(db,cab,release_dir,'win-unpacked','RuntimeDir','WINUNP~1|win-unpacked',componentflags=256)
directory_map = {Path('.'):runtime_dir}
files = sorted(p for p in payload.rglob('*') if p.is_file())
for index,file in enumerate(files):
    relative=file.relative_to(payload)
    assert not any(part.lower() in ('data','library.json','api-key.bin','local state','cookies') for part in relative.parts)
    parent=relative.parent
    if parent not in directory_map:
        for ancestor in reversed([parent,*parent.parents]):
            if ancestor == Path('.') or ancestor in directory_map: continue
            owner=directory_map[ancestor.parent]
            directory_map[ancestor]=msilib.Directory(db,cab,owner,ancestor.name,'Dir'+str(len(directory_map)),owner.make_short(ancestor.name)+'|'+ancestor.name,componentflags=256)
    directory=directory_map[parent]
    component='FileComponent'+str(index)
    directory.start_component(component,feature,256,relative.name,code('component/'+relative.as_posix()))
    directory.add_file(relative.name,src=str(file))
appdir.start_component('AppIconComponent',feature,256,'VLMReader-App.ico',code('icon'))
appdir.add_file('VLMReader-App.ico',src=str(root/'assets/icon.ico'))
# Per-user non-advertised shortcuts use an HKCU registry key as their key path.
add('Directory',[('DesktopFolder','TARGETDIR','.'),('ProgramMenuFolder','TARGETDIR','.'),('ReaderMenu','ProgramMenuFolder','VLMReader')])
add('Component',[('ShortcutComponent',code('shortcuts'),'INSTALLDIR',260,None,'InstallLocation')])
add('FeatureComponents',[('Reader','ShortcutComponent')])
add('Registry',[('InstallLocation',1,'Software\\VLMReader\\MSI','InstallLocation','[INSTALLDIR]','ShortcutComponent')])
shortcut_fields=lambda key,directory: (key,directory,'VLMREA~1|VLMReader','ShortcutComponent','[RuntimeDir]VLMReader.exe',None,'VLMReader',None,'AppIcon',0,1,'INSTALLDIR')
add('Shortcut',[shortcut_fields('DesktopShortcut','DesktopFolder'),shortcut_fields('MenuShortcut','ReaderMenu')])
add('RemoveFile',[('RemoveMenuFolder','ShortcutComponent',None,'ReaderMenu',2)])

def dialog(name, title, first, default, cancel):
    return msilib.Dialog(db,name,50,50,390,245,3,title,first,default,cancel)
welcome=dialog('WelcomeDlg','VLMReader 安装','Next','Next','Cancel')
welcome.text('Title',24,24,340,32,3,'{\\Title}VLMReader')
welcome.text('Body',24,75,340,85,3,'阅读、理解与记忆。\r\n\r\n安装完整阅读器、离线词典与双语语音模型。\r\n已有阅读资料会保留。')
welcome.line('Line',16,198,358,1)
welcome.pushbutton('Next',224,214,70,20,3,'下一步','Cancel').event('NewDialog','DirectoryDlg')
welcome.pushbutton('Cancel',304,214,70,20,3,'取消','Next').event('EndDialog','Exit')
choose=dialog('DirectoryDlg','VLMReader 安装','Folder','Install','Cancel')
choose.text('Title',24,20,340,30,3,'{\\Title}选择安装位置')
choose.text('Body',24,65,340,45,3,'可选择原便携版根目录，继续使用已有资料。\r\n资料保存在安装目录的 data 文件夹，卸载时保留。')
choose.control('Folder','Edit',24,126,340,22,3,'INSTALLDIR',None,'Install',None)
choose.line('Line',16,198,358,1)
install=choose.pushbutton('Install',224,214,70,20,3,'安装','Cancel')
install.event('SetTargetPath','INSTALLDIR',ordering=1)
install.event('EndDialog','Return',ordering=2)
choose.pushbutton('Cancel',304,214,70,20,3,'取消','Folder').event('EndDialog','Exit')
finish=dialog('ExitDialog','VLMReader 安装','Finish','Finish','Finish')
finish.text('Title',24,28,340,35,3,'{\\Title}操作完成')
finish.text('Body',24,88,340,55,3,'安装后可通过桌面或开始菜单打开 VLMReader。\r\n卸载后，阅读资料仍保留在 data 文件夹中。')
finish.pushbutton('Finish',304,214,70,20,3,'完成','Finish').event('EndDialog','Return')
progress=msilib.Dialog(db,'ProgressDlg',50,50,390,245,1,'VLMReader','Cancel','Cancel','Cancel')
progress.text('Title',24,28,340,35,3,'{\\Title}正在处理')
progress.text('Body',24,85,340,45,3,'正在安装或更新程序，请稍候。\r\n已有阅读资料会保留。')
bar=progress.control('Progress','ProgressBar',24,146,340,16,1,None,None,None,None)
bar.mapping('SetProgress','Progress')
progress.pushbutton('Cancel',304,214,70,20,3,'取消','Cancel').event('EndDialog','Exit')
for name,message in [('FatalError','安装未完成。请检查目录权限与剩余空间，然后重试。'),('UserExit','安装已取消。')]:
    fail=dialog(name,'VLMReader 安装','Finish','Finish','Finish')
    fail.text('Body',24,72,340,75,3,message)
    fail.pushbutton('Finish',304,214,70,20,3,'关闭','Finish').event('EndDialog','Return')
add('InstallUISequence',[('WelcomeDlg','NOT Installed',1100),('ProgressDlg',None,1201)])
db.Commit()
print('Packing licensed offline resources into the MSI...',flush=True)
cache=generated/'payload.cab'
cache_manifest=generated/'payload-sha256.txt'
payload_digest=hashlib.sha256()
for filename,key in cab.files:
    payload_digest.update(key.encode())
    with open(filename,'rb') as source:
        payload_digest.update(hashlib.file_digest(source,'sha256').digest())
cache_key=payload_digest.hexdigest()
if not cache.exists() or not cache_manifest.exists() or cache_manifest.read_text() != cache_key:
    msilib.FCICreate(str(cache),cab.files)
    cache_manifest.write_text(cache_key)
add('Media',[(1,cab.index,None,'#payload.cab',None,None)])
msilib.add_stream(db,'payload.cab',str(cache))
db.Commit()
# Windows Installer may compact the database when its last handle closes.
# Release every object that retains the database before computing the public hash.
msilib.current_feature=None
directory_map.clear()
for database_owner in ('db','summary','feature','target','appdir','release_dir','runtime_dir','directory','owner','welcome','choose','install','finish','progress','bar','fail'):
    globals()[database_owner]=None
gc.collect()
manifest={'file':output.name,'bytes':output.stat().st_size,'sha256':hashlib.file_digest(output.open('rb'),'sha256').hexdigest(),'productCode':product_code,'programFiles':len(files),'customExecutableActions':False}
(root/'publication/installer-msi-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print(json.dumps(manifest),flush=True)
