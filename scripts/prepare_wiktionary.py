"""Build the supplemental English-English lexicon from the English Wiktionary.

The shard is the ClueSurf parse of the Wikimedia enterprise HTML dump, licensed
CC BY-SA 4.0. It is converted to SQLite so lookups stay offline and indexed;
only definitions, transcriptions and short examples are kept.
"""
import json
import re
import sqlite3
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets" / "wiktionary"
DOWNLOADS = ROOT / "downloads"
SOURCE = "https://huggingface.co/datasets/cluesurf/wiktionary-english"
FILE = DOWNLOADS / "wiktionary-english.jsonl"

# "simple past of reel" style glosses restate the lemma instead of defining it.
POINTERS = re.compile(
    r"\b(?:form of|alternative (?:form|spelling)|misspelling of|plural of|past tense|past participle"
    r"|present participle|third-person singular|comparative of|superlative of|synonym of"
    r"|initialism of|abbreviation of|obsolete form|archaic form|eye dialect of)\b",
    re.IGNORECASE,
)
PREFERRED = {"GA", "US", "RP", "UK", "General American", "Received Pronunciation"}
LETTER = re.compile(r"[^\W\d_]", re.UNICODE)


def ipa(record):
    editions = record.get("pronunciations") or []
    for entry in editions:
        if entry.get("system") == "ipa" and entry.get("accent") in PREFERRED and entry.get("text"):
            return entry["text"].strip().strip("/")
    for entry in editions:
        if entry.get("system") == "ipa" and entry.get("text") and entry.get("accent") != "Indic":
            return entry["text"].strip().strip("/")
    return ""


def walk(senses, depth=0):
    for sense in senses or []:
        if not isinstance(sense, dict):
            continue
        text = (sense.get("text") or "").strip()
        if text:
            yield depth, sense, text
        if depth < 1:
            yield from walk(sense.get("senses"), depth + 1)


def collect(word, record, item):
    role = (record.get("role") or "").strip()
    if role and role not in item["roles"]:
        item["roles"].append(role)
    if not item["phonetic"]:
        item["phonetic"] = ipa(record)
    for depth, sense, text in walk(record.get("senses")):
        if POINTERS.search(text):
            continue
        if depth == 0:
            line = f"{role}. {text}" if role else text
            if line not in item["definitions"]:
                item["definitions"].append(line)
        for example in sense.get("examples") or []:
            value = (example.get("text") or "").strip()
            if 12 < len(value) < 220 and value not in item["examples"] and len(item["examples"]) < 4:
                item["examples"].append(value)


def download():
    FILE.parent.mkdir(parents=True, exist_ok=True)
    url = SOURCE + "/resolve/main/base/string/english.jsonl"
    part = FILE.with_suffix(".jsonl.part")
    done = part.stat().st_size if part.exists() else 0
    request = urllib.request.Request(url, headers={"User-Agent": "VLMReader", "Range": f"bytes={done}-"})
    with urllib.request.urlopen(request, timeout=600) as response, part.open("ab") as out:
        while block := response.read(1048576):
            out.write(block)
    part.replace(FILE)


def main():
    if not FILE.exists():
        download()
    ASSETS.mkdir(parents=True, exist_ok=True)
    building = ASSETS / "wiktionary.building"
    building.unlink(missing_ok=True)
    database = sqlite3.connect(building)
    database.executescript(
        "PRAGMA journal_mode=OFF;PRAGMA synchronous=OFF;"
        "CREATE TABLE entries(word TEXT PRIMARY KEY COLLATE NOCASE,phonetic TEXT,definition TEXT,examples TEXT,roles TEXT);"
        "CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);"
    )

    merged = {}
    lines = 0
    started = time.time()
    with FILE.open(encoding="utf-8") as stream:
        for line in stream:
            lines += 1
            if lines % 200000 == 0:
                print(f"  read {lines:,} records, {len(merged):,} headwords", flush=True)
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if record.get("language") != "english":
                continue
            word = ((record.get("headword") or {}).get("text") or "").strip()
            if not word or len(word) > 60 or not LETTER.search(word) or re.search(r"[\r\n\t]", word):
                continue
            collect(word, record, merged.setdefault(word.lower(), {"word": word, "phonetic": "", "definitions": [], "examples": [], "roles": []}))

    rows = 0
    for key, item in merged.items():
        if not item["definitions"]:
            continue
        database.execute(
            "INSERT OR REPLACE INTO entries VALUES (?,?,?,?,?)",
            (
                key,
                item["phonetic"],
                "\n".join(item["definitions"][:24]),
                json.dumps(item["examples"], ensure_ascii=False),
                ",".join(item["roles"]),
            ),
        )
        rows += 1
    database.commit()
    database.execute("VACUUM")
    database.close()
    building.replace(ASSETS / "wiktionary.sqlite")

    info = {
        "headwords": rows,
        "records": lines,
        "builtAt": time.strftime("%Y-%m-%d"),
        "source": SOURCE,
        "license": "CC BY-SA 4.0",
        "seconds": round(time.time() - started),
    }
    (ASSETS / "info.json").write_text(json.dumps(info, indent=2), encoding="utf-8")
    (ASSETS / "ATTRIBUTION.txt").write_text(
        "English Wiktionary\n"
        f"Source: {SOURCE} (parse of the Wikimedia enterprise HTML dump)\n"
        "Project: https://en.wiktionary.org\n"
        "Creators: Wiktionary contributors.\n"
        "License: Creative Commons Attribution-ShareAlike 4.0, https://creativecommons.org/licenses/by-sa/4.0/\n"
        "VLMReader keeps definitions, IPA transcriptions and short examples, drops inflection pointers, and stores the result in SQLite.\n",
        encoding="utf-8",
    )
    print(json.dumps(info), flush=True)


if __name__ == "__main__":
    main()
