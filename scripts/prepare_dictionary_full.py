"""Build the bundled English-Chinese dictionary from the published ECDICT tables.

Run after `scripts/prepare_assets.py`; this rebuilds `assets/dictionary.sqlite`
from the full ECDICT table (coverage), the curated basic table (curated glosses
win for shared headwords) and CC-CEDICT (Chinese lookups), storing clean IPA,
separated specialist senses and the Collins / Oxford 3000 / frequency ranks that
the published files carry.
"""
import hashlib
import json
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dictionary_build

ROOT = Path(__file__).resolve().parents[1]
DOWNLOADS = ROOT / "downloads"
ASSETS = ROOT / "assets"


def download(url, name):
    target = DOWNLOADS / name
    if target.exists() and target.stat().st_size > 100:
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    print("Downloading", name, flush=True)
    request = urllib.request.Request(url, headers={"User-Agent": "VLMReader"})
    with urllib.request.urlopen(request, timeout=300) as response, target.with_suffix(target.suffix + ".part").open("wb") as out:
        while block := response.read(1048576):
            out.write(block)
    target.with_suffix(target.suffix + ".part").replace(target)
    return target


def full_table():
    source = DOWNLOADS / "full-ecdict" / "stardict.csv"
    if source.exists():
        return source
    archive = download("https://raw.githubusercontent.com/skywind3000/ECDICT/master/stardict.7z", "stardict.7z")
    import py7zr

    with py7zr.SevenZipFile(archive) as packed:
        if "stardict.csv" not in packed.getnames():
            raise ValueError("Full dictionary CSV is missing")
        packed.extract(path=source.parent, targets=["stardict.csv"])
    return source


def main():
    basic = download("https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv", "ecdict.csv")
    cedict = download("https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz", "cedict.txt.gz")
    full = full_table()

    target = ASSETS / "dictionary.sqlite"
    building = target.with_suffix(".building")
    for stale in (building, target.with_suffix(".building-journal")):
        stale.unlink(missing_ok=True)

    database = dictionary_build.open_database(building)
    started = time.time()
    print("Indexing full ECDICT table", flush=True)
    dictionary_build.insert_ecdict(database, full, "ECDICT")
    print("Overlaying the curated basic table", flush=True)
    dictionary_build.insert_ecdict(database, basic, "ECDICT")
    print("Indexing CC-CEDICT", flush=True)
    dictionary_build.insert_cedict(database, cedict)
    print("Indexing phrases", flush=True)
    phrases = dictionary_build.build_phrases(database)
    counts = dictionary_build.summarise(database)
    info = {
        **counts,
        "phrases": phrases,
        "builtAt": time.strftime("%Y-%m-%d"),
        "edition": "full",
        "sources": [
            "ECDICT full + curated basic (MIT)",
            "CC-CEDICT (CC BY-SA 4.0)",
        ],
        "source": "https://github.com/skywind3000/ECDICT",
        "normalised": "IPA repaired (schwa/stress/length), specialist senses moved to domains, Collins/Oxford/frequency ranks kept",
    }
    archive = DOWNLOADS / "stardict.7z"
    if archive.exists():
        with archive.open("rb") as stream:
            info["sourceSHA256"] = hashlib.file_digest(stream, "sha256").hexdigest()
    dictionary_build.finish(database, target, building, info)
    (ASSETS / "dictionary-info.json").write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({**info, "seconds": round(time.time() - started)}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
