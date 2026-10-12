"""Download published dictionaries/model; build a fast offline SQLite dictionary."""
import csv, gzip, io, json, re, sqlite3, tarfile, urllib.request, time
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets'; DOWNLOADS = ROOT / 'downloads'
ASSETS.mkdir(exist_ok=True); DOWNLOADS.mkdir(exist_ok=True)
def download(url, name):
    p = DOWNLOADS / name
    if p.exists() and p.stat().st_size > 100: return p
    tmp = p.with_suffix(p.suffix + '.part')
    print('Downloading', name, flush=True)
    req = urllib.request.Request(url, headers={'User-Agent': 'VLMReader/0.5.1'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=90) as resp, tmp.open('wb') as out:
                while block := resp.read(1024 * 1024): out.write(block)
            tmp.replace(p); print('Downloaded', name, p.stat().st_size, flush=True); return p
        except Exception:
            if attempt == 2: raise
            time.sleep(2)

def dictionaries():
    target = ASSETS / 'dictionary.sqlite'
    if target.exists(): return
    ec = download('https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv', 'ecdict.csv')
    cc = download('https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz', 'cedict.txt.gz')
    db = sqlite3.connect(str(target.with_suffix('.building')))
    db.executescript('PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; CREATE TABLE entries (word TEXT PRIMARY KEY COLLATE NOCASE, phonetic TEXT, definition TEXT, translation TEXT, tags TEXT, exchange TEXT, source TEXT); CREATE TABLE metadata (key TEXT PRIMARY KEY,value TEXT);')
    en = 0
    with ec.open(encoding='utf-8-sig', newline='') as f:
        for row in csv.DictReader(f):
            if not row.get('word'): continue
            db.execute('INSERT OR REPLACE INTO entries VALUES (?,?,?,?,?,?,?)', (row['word'], row.get('phonetic',''), row.get('definition','').replace('\\n','\n'), row.get('translation','').replace('\\n','\n'), row.get('tag',''), row.get('exchange',''), 'ECDICT'))
            en += 1
    zh = {}; pattern = re.compile(r'^(\S+) (\S+) \[(.*?)\] /(.*)/$')
    with gzip.open(cc, 'rt', encoding='utf-8') as f:
        for line in f:
            match = pattern.match(line.rstrip())
            if not match: continue
            trad, simp, py, meanings = match.groups()
            definition = meanings.replace('/', '\n')
            for word in dict.fromkeys([simp, trad]):
                record = zh.setdefault(word, {'py': [], 'defs': []})
                if py not in record['py']: record['py'].append(py)
                if definition not in record['defs']: record['defs'].append(definition)
    for word,r in zh.items():
        meaning = '\n\n'.join(r['defs'])
        db.execute('INSERT OR REPLACE INTO entries VALUES (?,?,?,?,?,?,?)', (word, ' / '.join(r['py']), meaning, meaning, '', '', 'CC-CEDICT'))
    meta = {'enCount': en, 'zhCount': len(zh), 'builtAt': time.strftime('%Y-%m-%d'), 'sources': ['ECDICT (MIT)', 'CC-CEDICT (CC BY-SA 4.0)']}
    db.execute('INSERT INTO metadata VALUES (?,?)', ('info', json.dumps(meta)))
    db.commit(); db.execute('VACUUM'); db.close()
    target.with_suffix('.building').replace(target)
    (ASSETS / 'dictionary-info.json').write_text(json.dumps(meta,ensure_ascii=False),encoding='utf-8')
    print('Dictionary ready', meta, flush=True)
    licensefile = download('https://raw.githubusercontent.com/skywind3000/ECDICT/master/LICENSE', 'ECDICT-LICENSE.txt')
    (ASSETS / 'ECDICT-LICENSE.txt').write_bytes(licensefile.read_bytes())

def model():
    dest = ASSETS / 'kokoro-multi-lang-v1_1'
    if (dest / 'model.onnx').exists(): return
    p = download('https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_1.tar.bz2', 'kokoro-multi-lang-v1_1.tar.bz2')
    print('Extracting bilingual speech model', flush=True)
    with tarfile.open(p, 'r:bz2') as t:
        t.extractall(ASSETS, filter='data')
    print('Speech model ready', flush=True)

if __name__ == '__main__':
    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        jobs = [pool.submit(dictionaries), pool.submit(model)]
        for j in jobs: j.result()
