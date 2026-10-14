"""Build the supplemental, attributed Open English WordNet 2025 lexicon."""
import gzip,hashlib,json,sqlite3,sys,urllib.request,xml.etree.ElementTree as ET
from pathlib import Path
root=Path(__file__).resolve().parents[1]
asset=root/'assets/wordnet'
if all((asset/name).exists() for name in ['wordnet.sqlite','LICENSE.md','ATTRIBUTION.txt','info.json']) and json.loads((asset/'info.json').read_text()).get('examples'):
    print('Open English WordNet already prepared.');sys.exit(0)
folder=root/'downloads';folder.mkdir(exist_ok=True)
source=folder/'english-wordnet-2025.xml.gz'
url='https://en-word.net/static/english-wordnet-2025.xml.gz'
if not source.exists():
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'VLMReader'}),timeout=60) as response,source.with_suffix('.part').open('wb') as out:
        while block:=response.read(1024*1024):out.write(block)
    source.with_suffix('.part').replace(source)
asset=root/'assets/wordnet';asset.mkdir(exist_ok=True)
building=asset/'wordnet.building';db=sqlite3.connect(building)
db.executescript('DROP TABLE IF EXISTS meanings;DROP TABLE IF EXISTS senses;DROP TABLE IF EXISTS lexemes;CREATE TABLE lexemes (word TEXT,lexicalId TEXT,pos TEXT);CREATE TABLE senses (lexicalId TEXT,synset TEXT);CREATE TABLE meanings (synset TEXT PRIMARY KEY,pos TEXT,definition TEXT,examples TEXT);')
with gzip.open(source,'rb') as stream:
    for _,node in ET.iterparse(stream,events=('end',)):
        if node.tag=='LexicalEntry':
            lemma=node.find('Lemma');word=lemma.attrib.get('writtenForm','') if lemma is not None else ''
            if word:
                db.execute('INSERT INTO lexemes VALUES (?,?,?)',(word.lower(),node.attrib['id'],lemma.attrib.get('partOfSpeech','')))
                db.executemany('INSERT INTO senses VALUES (?,?)',[(node.attrib['id'],sense.attrib['synset']) for sense in node.findall('Sense')])
            node.clear()
        elif node.tag=='Synset':
            definition=node.findtext('Definition') or ''
            db.execute('INSERT INTO meanings VALUES (?,?,?,?)',(node.attrib['id'],node.attrib.get('partOfSpeech',''),definition,json.dumps([n.text for n in node.findall('Example') if n.text],ensure_ascii=False)));node.clear()
db.executescript('CREATE INDEX word_lookup ON lexemes(word);CREATE INDEX sense_lookup ON senses(lexicalId);CREATE INDEX synset_lookup ON senses(synset);')
db.commit();counts={'headwords':db.execute('SELECT COUNT(DISTINCT word) FROM lexemes').fetchone()[0],'senses':db.execute('SELECT COUNT(*) FROM meanings').fetchone()[0]};db.close();building.replace(asset/'wordnet.sqlite')
license_url='https://raw.githubusercontent.com/globalwordnet/english-wordnet/main/LICENSE.md'
with urllib.request.urlopen(license_url,timeout=30) as response:(asset/'LICENSE.md').write_bytes(response.read())
attribution='Open English WordNet 2025\nSource: '+url+'\nProject: https://github.com/globalwordnet/english-wordnet\nCreators: Princeton WordNet and the Open English WordNet community.\nLicense: Creative Commons Attribution 4.0, https://creativecommons.org/licenses/by/4.0/\nVLMReader converts the source into SQLite and groups definitions by part of speech; lexical definitions remain unchanged.\n'
(asset/'ATTRIBUTION.txt').write_text(attribution,encoding='utf-8')
with source.open('rb') as file: digest=hashlib.file_digest(file,'sha256').hexdigest()
counts.update(source=url,version='2025',sha256=digest,examples=True)
(asset/'info.json').write_text(json.dumps(counts,indent=2),encoding='utf-8');print(json.dumps(counts))
