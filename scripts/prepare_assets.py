"""Download published dictionaries/model; build a fast offline SQLite dictionary."""
import csv, gzip, io, json, re, sqlite3, sys, tarfile, urllib.request, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import dictionary_build
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
    building = target.with_suffix('.building')
    for stale in (building, Path(str(building) + '-journal')):
        stale.unlink(missing_ok=True)
    database = dictionary_build.open_database(building)
    dictionary_build.insert_ecdict(database, ec, 'ECDICT')
    dictionary_build.insert_cedict(database, cc)
    meta = {**dictionary_build.summarise(database), 'builtAt': time.strftime('%Y-%m-%d'), 'edition': 'basic', 'sources': ['ECDICT (MIT)', 'CC-CEDICT (CC BY-SA 4.0)']}
    dictionary_build.finish(database, target, building, meta)
    (ASSETS / 'dictionary-info.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding='utf-8')
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
