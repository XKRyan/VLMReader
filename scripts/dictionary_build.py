"""Shared builders for the bundled offline dictionaries.

The published ECDICT tables mix several phonetic notations and inline every
specialist gloss into the general meaning, so this module normalises the IPA,
separates the domain-tagged senses and keeps the Collins / Oxford 3000 /
frequency columns that the dictionary files ship but the old build dropped.
"""
import csv
import gzip
import json
import re
import sqlite3
import time
from pathlib import Path

SCHEMA = """
PRAGMA journal_mode=OFF;
PRAGMA synchronous=OFF;
CREATE TABLE entries (
  word TEXT PRIMARY KEY COLLATE NOCASE,
  phonetic TEXT, definition TEXT, translation TEXT,
  tags TEXT, exchange TEXT, source TEXT,
  pos TEXT, collins INTEGER, oxford INTEGER, rank INTEGER, domains TEXT
);
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE phrases (headword TEXT, phrase TEXT, translation TEXT);
"""

# ECDICT borrows glyphs from Cyrillic and Greek and writes stress with ASCII
# punctuation, which renders as 'kɒmpitәns' instead of /ˈkɒmpɪtəns/.
PHONETIC_REPLACEMENTS = {
    "\u04d9": "\u0259",  # Cyrillic schwa -> IPA schwa
    "\u0454": "\u025b",  # Ukrainian ie -> open e
    "\u03b5": "\u025b",  # Greek epsilon -> open e
    "\u0435": "e",       # Cyrillic ie -> e
    "\u02b9": "\u02c8",  # modifier prime -> primary stress
    "\u02ba": "\u02c8",
    "\u00b4": "\u02c8",  # acute accent used for stress
    "\u02ca": "\u02c8",  # modifier letter acute accent
    "\u2018": "\u02c8",
    "\u2019": "\u02c8",
    ":": "\u02d0",
    "\uff08": "(",
    "\uff09": ")",
    "\uff0c": ",",
    "\uff1b": ";",
    "\u00a0": " ",
    "\u3000": " ",
}
# Characters that may survive into a displayed transcription.
ALLOWED_PHONETIC = set(
    "abcdefghijklmnopqrstuvwxyz"
    "\u00e6\u0251\u0252\u0254\u0259\u025c\u025b\u026a\u028a\u028c\u0283\u0292\u03b8\u00f0\u014b"
    "\u0279\u027e\u025a\u025d\u0294\u0261\u02c8\u02cc\u02d0.-() "
)
TAG = re.compile(r"\[([^\[\]]{1,8})\]")
TAG_START = re.compile(r"(?=\[[^\[\]]{1,8}\])")


def normalise_phonetic(raw):
    """Return display-ready IPA, or '' when the source string is unusable."""
    text = str(raw or "").strip()
    if not text:
        return ""
    if "IPA:" in text:
        text = text.split("IPA:", 1)[1]
        text = re.split(r"[,;\]]", text, 1)[0]
    else:
        text = text.split(";", 1)[0]
    text = text.strip().strip("/").strip()
    text = text.replace("/", " ")
    for source, target in PHONETIC_REPLACEMENTS.items():
        text = text.replace(source, target)
    # In this notation ' always marks the following syllable; a comma is a
    # secondary stress mark unless it separates alternative pronunciations.
    text = text.replace("'", "\u02c8")
    text = re.sub(r",(?=\s|$)", " ", text)
    text = text.replace(",", "\u02cc")
    text = re.sub(r"^\.", "\u02cc", text)
    text = re.sub(r"\s{2,}", " ", text).strip(" ,;")
    if not text or any(character not in ALLOWED_PHONETIC for character in text):
        return ""
    if not any(character.isalpha() for character in text):
        return ""
    return text


def split_translation(raw):
    """Split 'n. 能力 [医] 活性' into general glosses and domain-tagged notes."""
    value = str(raw or "").replace("\\n", "\n").strip()
    if not value:
        return "", ""
    general, domains = [], []
    for line in value.split("\n"):
        for segment in TAG_START.split(line):
            segment = segment.strip()
            if not segment:
                continue
            (domains if TAG.match(segment) else general).append(segment)
    if not general:
        return value, ""
    return "\n".join(general), "\n".join(domains)


def rank_of(bnc, frq):
    values = [value for value in (bnc, frq) if value and value > 0]
    return min(values) if values else 0


def number(value):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return 0


def open_database(path):
    database = sqlite3.connect(path)
    database.executescript(SCHEMA)
    return database


def insert_ecdict(database, source, label):
    """Insert one published ECDICT table; later inserts win for shared headwords."""
    rows = 0
    with source.open(encoding="utf-8-sig", newline="") as stream:
        for record in csv.DictReader(stream):
            word = (record.get("word") or "").strip()
            if not word:
                continue
            translation, domains = split_translation(record.get("translation"))
            bnc, frq = number(record.get("bnc")), number(record.get("frq"))
            database.execute(
                "INSERT OR REPLACE INTO entries VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    word,
                    normalise_phonetic(record.get("phonetic")),
                    str(record.get("definition") or "").replace("\\n", "\n"),
                    translation,
                    record.get("tag") or "",
                    record.get("exchange") or "",
                    label,
                    record.get("pos") or "",
                    number(record.get("collins")),
                    number(record.get("oxford")),
                    rank_of(bnc, frq),
                    domains,
                ),
            )
            rows += 1
            if rows % 500000 == 0:
                print(f"  {label}: {rows:,} rows", flush=True)
    return rows


def insert_cedict(database, source):
    """Insert CC-CEDICT so Chinese lookups keep working."""
    pattern = re.compile(r"^(\S+) (\S+) \[(.*?)\] /(.*)/$")
    collected = {}
    with gzip.open(source, "rt", encoding="utf-8") as stream:
        for line in stream:
            match = pattern.match(line.rstrip())
            if not match:
                continue
            traditional, simplified, pinyin, meanings = match.groups()
            definition = meanings.replace("/", "\n")
            for word in dict.fromkeys([simplified, traditional]):
                entry = collected.setdefault(word, {"pinyin": [], "definitions": []})
                if pinyin not in entry["pinyin"]:
                    entry["pinyin"].append(pinyin)
                if definition not in entry["definitions"]:
                    entry["definitions"].append(definition)
    for word, entry in collected.items():
        meaning = "\n\n".join(entry["definitions"])
        # Latin-script CC-CEDICT headwords such as "a" would otherwise replace
        # the English entry with a Chinese transliteration gloss.
        database.execute(
            "INSERT OR IGNORE INTO entries VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (word, " / ".join(toned(p) for p in entry["pinyin"]), meaning, meaning, "", "", "CC-CEDICT", "", 0, 0, 0, ""),
        )
    return len(collected)


TONE_MARKS = {"a": "āáǎà", "e": "ēéěè", "i": "īíǐì", "o": "ōóǒò", "u": "ūúǔù", "ü": "ǖǘǚǜ"}


def _mark(syllable, tone):
    low = syllable.lower()
    index = -1
    for letter in ("a", "o", "e"):
        if letter in low:
            index = low.index(letter)
            break
    if index < 0 and "iu" in low:
        index = low.index("iu") + 1
    if index < 0:
        vowels = [position for position, character in enumerate(low) if character in "aeiouvü"]
        index = vowels[-1] if vowels else -1
    if index < 0:
        return syllable
    base = "ü" if low[index] == "v" else low[index]
    marked = TONE_MARKS.get(base)
    if not marked:
        return syllable
    return syllable[:index] + marked[tone - 1] + syllable[index + 1:]


def toned(pinyin):
    """CC-CEDICT stores 'neng2 li4'; display reads better as 'néng lì'."""
    syllables = []
    for syllable in str(pinyin).split():
        tone = 5
        if syllable and syllable[-1].isdigit():
            tone = int(syllable[-1])
            syllable = syllable[:-1]
        syllable = syllable.replace("u:", "v")
        if tone in (1, 2, 3, 4) and syllable:
            syllable = _mark(syllable, tone)
        syllables.append(syllable.replace("v", "ü"))
    return " ".join(syllables)


def build_phrases(database):
    """Index short multi-word phrases under each of their content words."""
    stop = set("a an the of to in on at for and or with by from be is are as it".split())
    headwords = {
        row[0].lower()
        for row in database.execute(
            "SELECT word FROM entries WHERE source LIKE 'ECDICT%' AND word NOT LIKE '% %' AND (tags<>'' OR exchange<>'')"
        )
    }
    batch = []
    for phrase, translation in database.execute(
        "SELECT word,translation FROM entries WHERE source LIKE 'ECDICT%' AND word LIKE '% %' AND translation<>''"
    ):
        words = phrase.lower().split()
        if not 2 <= len(words) <= 5 or not all(re.fullmatch(r"[a-z'-]+", word) for word in words):
            continue
        for word in set(words) - stop:
            if word in headwords:
                batch.append((word, phrase, translation))
        if len(batch) > 10000:
            database.executemany("INSERT INTO phrases VALUES (?,?,?)", batch)
            batch = []
    database.executemany("INSERT INTO phrases VALUES (?,?,?)", batch)
    database.execute("CREATE INDEX phrase_lookup ON phrases(headword)")
    return database.execute("SELECT COUNT(DISTINCT phrase) FROM phrases").fetchone()[0]


def finish(database, target, building, info):
    database.execute("INSERT OR REPLACE INTO metadata VALUES (?,?)", ("info", json.dumps(info, ensure_ascii=False)))
    database.commit()
    database.execute("VACUUM")
    database.close()
    building.replace(target)
    return info


def summarise(database):
    count = lambda sql: database.execute(sql).fetchone()[0]
    return {
        "enCount": count("SELECT COUNT(*) FROM entries WHERE source LIKE 'ECDICT%'"),
        "zhCount": count("SELECT COUNT(*) FROM entries WHERE source='CC-CEDICT'"),
        "phonetic": count("SELECT COUNT(*) FROM entries WHERE phonetic<>''"),
        "domains": count("SELECT COUNT(*) FROM entries WHERE domains<>''"),
        "ranked": count("SELECT COUNT(*) FROM entries WHERE rank>0"),
    }
