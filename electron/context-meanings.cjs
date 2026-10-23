// AI meanings in context, remembered per word.
//
// A dictionary explains the word; this store keeps what the AI said it means in
// the sentence the learner was reading, so the same word shows instantly next
// time without another API call and can be used when the dictionaries lack it.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LIMIT = 4000;
const MAX_TEXT = 400;

function atomic(file, value) {
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  try { fs.writeFileSync(temporary, JSON.stringify(value)); fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
const clean = (value, limit = MAX_TEXT) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
const key = word => String(word || '').trim().toLowerCase();

class ContextMeanings {
  constructor(dir) {
    this.file = path.join(dir, 'context-meanings.json');
    this.items = this.read();
  }
  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!parsed || typeof parsed !== 'object') return {};
      const items = {};
      for (const [word, item] of Object.entries(parsed)) {
        if (!key(word) || !item || typeof item.translation !== 'string' || !item.translation.trim()) continue;
        items[key(word)] = {
          word: clean(item.word || word, 120),
          translation: clean(item.translation, 300),
          english: clean(item.english),
          explanation: clean(item.explanation),
          context: clean(item.context),
          at: clean(item.at, 40),
        };
      }
      return items;
    } catch { return {}; }
  }
  get(word) {
    const id = key(word);
    return id ? this.items[id] || null : null;
  }
  save(word, input) {
    const id = key(word);
    const translation = clean(input && input.translation, 300);
    if (!id || !translation) return null;
    const row = {
      word: clean(word, 120),
      translation,
      english: clean(input.english),
      explanation: clean(input.explanation),
      context: clean(input.context),
      at: new Date().toISOString(),
    };
    const items = { ...this.items, [id]: row };
    const keys = Object.keys(items);
    if (keys.length > LIMIT) {
      keys.sort((a, b) => String(items[a].at).localeCompare(String(items[b].at)));
      for (const stale of keys.slice(0, keys.length - LIMIT)) delete items[stale];
    }
    atomic(this.file, items);
    this.items = items;
    return row;
  }
  clear() { atomic(this.file, {}); this.items = {}; return {}; }
  list() { return Object.values(this.items).sort((a, b) => String(b.at).localeCompare(String(a.at))); }
}

module.exports = { ContextMeanings, LIMIT };
