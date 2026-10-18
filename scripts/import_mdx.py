"""Import an MDict (.mdx) dictionary into VLMReader's own dictionary folder.

The application's GUI import reads a whole dictionary into memory and builds an
in-memory sql.js database, which is fine for small files but cannot hold a
150 MB learner's dictionary. This script streams the blocks instead and writes
straight to SQLite, producing exactly the artifact the app expects:
`data/dictionaries/<uuid>.sqlite` plus its `catalog.json` entry.
"""
import argparse
import json
import re
import sqlite3
import struct
import time
import uuid
import zlib
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BLOCK = re.compile(r"<(script|style)[\s\S]*?</\1>", re.I)
TAG = re.compile(r"<[^>]+>")
ENTITIES = {"&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'"}


def plain(html_text):
    text = BLOCK.sub(" ", html_text)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"</(?:p|div|li|tr|h[1-6]|blockquote|td)>", "\n", text, flags=re.I)
    text = TAG.sub("", text)
    for source, target in ENTITIES.items():
        text = text.replace(source, target)
    text = re.sub(r"&#(\d+);", lambda match: chr(int(match.group(1))), text)
    text = re.sub(r"&#x([\da-f]+);", lambda match: chr(int(match.group(1), 16)), text, flags=re.I)
    text = text.replace("\r", "")
    text = re.sub(r"[ \t\u00a0]{2,}", " ", text)
    text = re.sub(r"\n[ \t]+", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


# LDOCE-family articles put real senses in span.sense > span.def, usage
# sentences in span.example, and phrases in span.collocate. Thesaurus and
# word-family panels (span.exponent) describe *other* headwords, so they must be
# skipped or, for example, "bank" would lead with "the part of a river where it
# joins the sea" — the definition of "mouth".
IGNORED_CLASSES = {"exponent", "collgloss", "thes"}
MAX_DEFINITIONS, MAX_EXAMPLES, MAX_COLLOCATIONS = 12, 12, 10


class Extractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.out = {"definitions": [], "examples": [], "collocations": [], "phonetic": []}

    def _blocked(self):
        return any(entry[4] for entry in self.stack)

    def _inside(self, name):
        return any(name in entry[1] for entry in self.stack)

    def _kind(self, tag, classes):
        if "def" in classes and self._inside("sense"):
            return "definitions"
        if "example" in classes and self._inside("sense"):
            return "examples"
        if tag == "li" and self._inside("exas"):
            return "examples"
        # Only standalone collocation labels: the same classes also highlight
        # phrases inside example sentences, which are not useful as headwords.
        if ("collocate" in classes or "collo" in classes) and not self._inside("example") and not self._inside("def"):
            return "collocations"
        if "pron" in classes:
            return "phonetic"
        return None

    def handle_starttag(self, tag, attributes):
        classes = set()
        for name, value in attributes:
            if name == "class" and value:
                classes.update(value.split())
        blocked = self._blocked() or bool(classes & IGNORED_CLASSES)
        kind = None if blocked else self._kind(tag, classes)
        self.stack.append([tag, classes, kind, [], blocked])

    def handle_endtag(self, tag):
        while self.stack:
            entry = self.stack.pop()
            if entry[2] and not entry[4]:
                text = re.sub(r"\s+", " ", "".join(entry[3])).strip(" :;,")
                if text:
                    self.out[entry[2]].append(text)
            if entry[0] == tag:
                break

    def handle_data(self, data):
        for entry in reversed(self.stack):
            if entry[2] and not entry[4]:
                entry[3].append(data)
                return


def extract(html_text):
    parser = Extractor()
    try:
        parser.feed(html_text)
        parser.close()
    except Exception:
        pass
    seen, definitions = set(), []
    for value in parser.out["definitions"]:
        folded = value.lower()
        if 3 < len(value) <= 600 and folded not in seen and len(definitions) < MAX_DEFINITIONS:
            seen.add(folded)
            definitions.append(value)
    seen, examples = set(), []
    for value in parser.out["examples"]:
        folded = value.lower()
        if 12 < len(value) <= 400 and folded not in seen and len(examples) < MAX_EXAMPLES:
            seen.add(folded)
            examples.append({"text": value, "translation": ""})
    seen, collocations = set(), []
    for value in parser.out["collocations"]:
        term = re.split(r"[►·]|\(=", value)[0].strip(" :;,.")
        folded = term.lower()
        if 3 < len(term) <= 60 and folded not in seen and len(collocations) < MAX_COLLOCATIONS:
            seen.add(folded)
            collocations.append({"text": term, "translation": ""})
    phonetic = parser.out["phonetic"][0] if parser.out["phonetic"] else ""
    return definitions, examples, collocations, phonetic.strip("/ ")


def u64(buffer, offset):
    return struct.unpack_from(">Q", buffer, offset)[0]


def header(buffer):
    size = struct.unpack_from(">L", buffer, 0)[0]
    text = buffer[4:4 + size].decode("utf-16-le").lstrip("\ufeff")
    attributes = dict(re.findall(r'(\w+)="([^"]*)"', text))
    if not text.startswith(("<Dictionary", "<Library_Data")):
        raise SystemExit("not an MDX file")
    return attributes, 4 + size + 4


def scan_keys(buffer, start, blocks_total):
    """Walk the key blocks; each is a self-describing zlib stream."""
    words, offset, stop = [], start, start + blocks_total
    while offset < stop:
        engine = zlib.decompressobj()
        fed = buffer[offset + 8:stop]
        data = engine.decompress(fed)
        if not engine.eof:
            raise SystemExit("compressed key block does not end inside the key section")
        consumed = len(fed) - len(engine.unused_data)
        position = 0
        while position + 8 <= len(data):
            record_offset = struct.unpack_from(">Q", data, position)[0]
            position += 8
            end = data.find(b"\0", position)
            if end < 0:
                break
            words.append((data[position:end].decode("utf-8"), record_offset))
            position = end + 1
        offset += 8 + consumed
    return words, offset


def import_mdx(path, name):
    started = time.time()
    buffer = Path(path).read_bytes()
    attributes, at = header(buffer)
    version = attributes.get("GeneratedByEngineVersion", "2.0")
    if attributes.get("Encrypted", "0") not in ("0", "2"):
        raise SystemExit("加密的 MDX 暂不支持")
    if version != "2.0":
        raise SystemExit(f"only MDX 2.0 is streamed here (got {version})")
    encoding = attributes.get("Encoding", "UTF-8").upper()

    key_blocks = u64(buffer, at)
    entries = u64(buffer, at + 8)
    index_compressed = u64(buffer, at + 24)
    blocks_total = u64(buffer, at + 32)
    key_start = at + 44 + index_compressed  # 5 x uint64 preamble, Adler-32, index
    words, after_keys = scan_keys(buffer, key_start, blocks_total)
    print(f"  key blocks {key_blocks}: {len(words):,} headwords (declared {entries:,})", flush=True)

    record_blocks = u64(buffer, after_keys)
    record_index_size = u64(buffer, after_keys + 16)
    index_at = after_keys + 32
    plan, cursor, total = [], index_at + record_index_size, 0
    for i in range(record_blocks):
        compressed = u64(buffer, index_at + i * 16)
        decompressed = u64(buffer, index_at + i * 16 + 8)
        plan.append((cursor, compressed, decompressed, total))
        cursor += compressed
        total += decompressed
    print(f"  record blocks {record_blocks}: {total:,} bytes of articles", flush=True)

    target_dir = ROOT / "data" / "dictionaries"
    target_dir.mkdir(parents=True, exist_ok=True)
    identifier = str(uuid.uuid4())
    target = target_dir / f"{identifier}.sqlite"
    if target.exists():
        raise SystemExit("target already exists")

    database = sqlite3.connect(target)
    database.executescript(
        "PRAGMA journal_mode=OFF;PRAGMA synchronous=OFF;"
        "CREATE TABLE entries (word TEXT PRIMARY KEY COLLATE NOCASE, phonetic TEXT, translation TEXT,"
        " definition TEXT, exchange TEXT, tags TEXT, examples TEXT, collocations TEXT, html TEXT);"
    )
    decode = (lambda chunk: chunk.decode("utf-16-le")) if encoding == "UTF-16" else (lambda chunk: chunk.decode("utf-8"))
    ends = [words[i + 1][1] if i + 1 < len(words) else total for i in range(len(words))]

    carry, carry_start, index, written, duplicates = b"", 0, 0, 0, 0
    seen = set()
    database.execute("BEGIN")
    for position, compressed, decompressed, base in plan:
        engine = zlib.decompressobj()
        data = engine.decompress(buffer[position + 8:position + compressed])
        if len(data) != decompressed:
            raise SystemExit("record block size mismatch")
        window = (carry + data) if carry else data
        window_start = carry_start if carry else base
        while index < len(words) and ends[index] <= window_start + len(window):
            word, start = words[index]
            article = decode(window[start - window_start:ends[index] - window_start]).rstrip("\0")
            index += 1
            folded = word.strip().lower()
            if not folded:
                continue
            if not article:
                continue
            definitions, examples, collocations, phonetic = extract(article)
            if definitions:
                gloss = "\n".join(f"{index}. {value}" for index, value in enumerate(definitions[:12], 1))
            else:
                gloss = plain(article)[:4000]
            if not gloss:
                continue
            fresh = folded not in seen
            seen.add(folded)
            database.execute(
                "INSERT INTO entries VALUES (?,?,?,?,?,?,?,?,?)"
                " ON CONFLICT(word) DO UPDATE SET"
                " translation=trim(entries.translation||char(10)||excluded.translation),"
                " definition=trim(entries.definition||char(10)||excluded.definition),"
                " html=entries.html||excluded.html",
                (word, phonetic, gloss, gloss, "", "", json.dumps(examples, ensure_ascii=False), json.dumps(collocations, ensure_ascii=False), article),
            )
            if fresh:
                written += 1
            else:
                duplicates += 1
            if written % 10000 == 0 and fresh:
                print(f"    {written:,} entries", flush=True)
        if index < len(words):
            keep = words[index][1] - window_start
            if keep > 0:
                window = window[keep:]
                window_start += keep
            carry, carry_start = window, window_start
        else:
            carry, carry_start = b"", 0
    database.execute("COMMIT")
    database.commit()
    database.execute("VACUUM")
    database.close()
    print(f"  wrote {written:,} entries ({duplicates:,} duplicates skipped) in {time.time() - started:.0f}s", flush=True)

    catalog_file = target_dir / "catalog.json"
    backup = target_dir / "catalog.json.before-mdx-import"
    catalog = json.loads(catalog_file.read_text("utf-8")) if catalog_file.exists() else []
    if catalog_file.exists() and not backup.exists():
        backup.write_bytes(catalog_file.read_bytes())
    catalog.append({
        "id": identifier,
        "name": name,
        "count": written,
        "enabled": True,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })
    temporary = catalog_file.with_suffix(".json.new")
    temporary.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), "utf-8")
    temporary.replace(catalog_file)
    print(f"  registered as {name!r} -> {target.name}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("file")
    parser.add_argument("--name", default="Longman Dictionary of Contemporary English 6th")
    arguments = parser.parse_args()
    import_mdx(arguments.file, arguments.name)
