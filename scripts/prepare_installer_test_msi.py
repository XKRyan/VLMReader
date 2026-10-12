"""Clone only MSI metadata for an isolated installation test; never touch the normal registration."""
import json
import shutil
import sys
import uuid
from pathlib import Path
import msilib

source, target = map(Path, sys.argv[1:3])
root=Path(__file__).resolve().parents[1]
assert target.resolve().is_relative_to((root/'publication').resolve())
shutil.copyfile(source,target)
db=msilib.OpenDatabase(str(target),msilib.MSIDBOPEN_TRANSACT)
product='{'+str(uuid.uuid4()).upper()+'}'
def update(sql): db.OpenView(sql).Execute(None)
update(f"UPDATE `Property` SET `Value` = '{product}' WHERE `Property` = 'ProductCode'")
update("UPDATE `Property` SET `Value` = 'VLMReader Installer Test' WHERE `Property` = 'ProductName'")
update("UPDATE `Property` SET `Value` = '{703FC0E1-4A89-5D27-B908-184801AD4B8B}' WHERE `Property` = 'UpgradeCode'")
update("DELETE FROM `Upgrade`")
msilib.add_data(db,'Upgrade',[('{703FC0E1-4A89-5D27-B908-184801AD4B8B}',None,json.loads((root/'package.json').read_text(encoding='utf-8'))['version'],None,257,None,'OLDPRODUCTS')])
update("UPDATE `Registry` SET `Key` = 'Software\\VLMReader\\MSI.Test' WHERE `Registry` = 'InstallLocation'")
update("UPDATE `RegLocator` SET `Key` = 'Software\\VLMReader\\MSI.Test' WHERE `Signature_` = 'ExistingInstall'")
update("UPDATE `Directory` SET `DefaultDir` = 'VLMTEST|VLMReader Installer Test' WHERE `Directory` = 'ReaderMenu'")
update("UPDATE `Shortcut` SET `Name` = 'VLMTEST|VLMReader Installer Test'")
view=db.OpenView("SELECT `Component`, `ComponentId` FROM `Component`")
view.Execute(None)
while row:=view.Fetch():
    name,guid=row.GetString(1),row.GetString(2)
    changed='{'+str(uuid.uuid5(uuid.NAMESPACE_URL,'VLMReader/installer-test/'+guid)).upper()+'}'
    update(f"UPDATE `Component` SET `ComponentId` = '{changed}' WHERE `Component` = '{name}'")
summary=db.GetSummaryInformation(20)
summary.SetProperty(msilib.PID_REVNUMBER,msilib.gen_uuid())
summary.Persist()
db.Commit()
print(json.dumps({'productCode':product,'file':str(target)}))
