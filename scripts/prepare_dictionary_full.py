"""Upgrade the bundled ECDICT from the publisher's full CSV; keep CC-CEDICT."""
import csv, hashlib, json, sqlite3, time
from pathlib import Path
root=Path(__file__).resolve().parents[1]
source=root/'downloads/full-ecdict/stardict.csv'
if not source.exists():
    import urllib.request,py7zr
    archive=root/'downloads/stardict.7z'
    archive.parent.mkdir(exist_ok=True)
    if not archive.exists():
        with urllib.request.urlopen('https://raw.githubusercontent.com/skywind3000/ECDICT/master/stardict.7z',timeout=90) as response,archive.with_suffix('.part').open('wb') as output:
            while block:=response.read(1048576): output.write(block)
        archive.with_suffix('.part').replace(archive)
    with py7zr.SevenZipFile(archive) as packed:
        if 'stardict.csv' not in packed.getnames(): raise ValueError('Full dictionary CSV is missing')
        packed.extract(path=source.parent,targets=['stardict.csv'])
target=root/'assets/dictionary.sqlite'
building=target.with_suffix('.building')
if building.exists(): building.unlink()
db=sqlite3.connect(building)
db.executescript('PRAGMA journal_mode=OFF;PRAGMA synchronous=OFF;CREATE TABLE entries(word TEXT PRIMARY KEY COLLATE NOCASE,phonetic TEXT,definition TEXT,translation TEXT,tags TEXT,exchange TEXT,source TEXT);CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE phrases(headword TEXT,phrase TEXT,translation TEXT);')
count=0
with source.open(encoding='utf-8-sig',newline='') as stream:
    for row in csv.DictReader(stream):
        word=row.get('word','').strip()
        if not word: continue
        db.execute('INSERT OR REPLACE INTO entries VALUES (?,?,?,?,?,?,?)',(word,row.get('phonetic',''),row.get('definition','').replace('\\n','\n'),row.get('translation','').replace('\\n','\n'),row.get('tag',''),row.get('exchange',''),'ECDICT'))
        count+=1
        if count%500000==0: print('Indexed',count,flush=True)
# Prefer the existing, curated basic entries for shared headwords. The full
# data extends coverage, rather than replacing a corrected basic definition.
db.execute('ATTACH DATABASE ? AS previous',(str(target),))
db.execute('INSERT OR REPLACE INTO entries SELECT * FROM previous.entries')
db.commit()
db.execute('DETACH DATABASE previous')
en=db.execute("SELECT COUNT(*) FROM entries WHERE source='ECDICT'").fetchone()[0]
zh=db.execute("SELECT COUNT(*) FROM entries WHERE source='CC-CEDICT'").fetchone()[0]
# Common short phrases: both core competence and competence in are indexed.
# Require each headword to be a basic English headword; skip stop words.
stop=set('a an the of to in on at for and or with by from be is are as it'.split())
heads={row[0].lower() for row in db.execute("SELECT word FROM entries WHERE source='ECDICT' AND word NOT LIKE '% %' AND (tags<>'' OR exchange<>'')")}
import re
batch=[]
for phrase,translation in db.execute("SELECT word,translation FROM entries WHERE source='ECDICT' AND word LIKE '% %' AND translation<>''"):
    words=phrase.lower().split()
    if not 2<=len(words)<=5 or not all(re.fullmatch(r"[a-z'-]+",word) for word in words): continue
    for word in set(words)-stop:
        if word in heads: batch.append((word,phrase,translation))
    if len(batch)>10000: db.executemany('INSERT INTO phrases VALUES (?,?,?)',batch);batch=[]
db.executemany('INSERT INTO phrases VALUES (?,?,?)',batch)
db.execute('CREATE INDEX phrase_lookup ON phrases(headword)')
phrases=db.execute('SELECT COUNT(DISTINCT phrase) FROM phrases').fetchone()[0]
info={'enCount':en,'zhCount':zh,'builtAt':time.strftime('%Y-%m-%d'),'sources':['ECDICT full + curated basic (MIT)','CC-CEDICT (CC BY-SA 4.0)'],'phrases':phrases,'source':'https://github.com/skywind3000/ECDICT','edition':'full'}
with (root/'downloads/stardict.7z').open('rb') as stream: info['sourceSHA256']=hashlib.file_digest(stream,'sha256').hexdigest()
db.execute('INSERT INTO metadata VALUES (?,?)',('info',json.dumps(info)))
db.commit();db.execute('VACUUM');db.close();building.replace(target)
(root/'assets/dictionary-info.json').write_text(json.dumps(info,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(info),flush=True)
