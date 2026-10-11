const crypto = require('node:crypto');
const { createEmptyCard, fsrs, generatorParameters, Rating } = require('ts-fsrs');
const scheduler = fsrs(generatorParameters({ request_retention: 0.9, enable_fuzz: false }));
const normalize = s => String(s || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
function hydrate(card) {
  return { ...card, due: new Date(card.due), ...(card.last_review ? { last_review: new Date(card.last_review) } : {}) };
}
function reviewEntry(entry, rating, now = new Date()) {
  if (![Rating.Again, Rating.Hard, Rating.Good, Rating.Easy].includes(rating)) throw Error('无效的复习评分');
  const result = scheduler.next(hydrate(entry.card), now, rating);
  return { ...entry, card: result.card, updatedAt: now.toISOString(), history: [...(entry.history || []), { before: entry.card, log: result.log }].slice(-100) };
}
function reviewIntervals(entry, now = new Date()) {
  const results = scheduler.repeat(hydrate(entry.card), now);
  return [1,2,3,4].map(rating => ({ rating, due: results[rating].card.due.toISOString() }));
}
function makeEntry(input, now = new Date()) {
  const text = normalize(input.text);
  if (!text || text.length > 5000) throw Error('请选择 1–5000 个字符');
  const isChinese = /[\u3400-\u9fff]/.test(text);
  return { id: crypto.randomUUID(), text, language: isChinese ? 'zh' : 'en',
    kind: input.kind || (isChinese ? (text.length <= 6 && !/[。！？]/.test(text) ? 'word' : 'sentence') : (/^[\p{L}\p{M}'’-]+$/u.test(text) ? 'word' : 'sentence')),
    context: normalize(input.context).slice(0,12000), bookId: input.bookId || '', bookTitle: input.bookTitle || '', location: input.location || '',
    translation: input.translation || '', definition: input.definition || '', phonetic: input.phonetic || '', dictionaryWord: input.dictionaryWord || '',
    source: input.source || '', explanation:input.explanation||'',contextTranslation:input.contextTranslation||'',status: input.translation ? 'ready' : 'pending',
    createdAt: now.toISOString(), updatedAt: now.toISOString(), encounters: 1, contexts: [], note: '', suspended: false,
    card: createEmptyCard(now), history: [] };
}
function csvEscape(s) { return '"' + String(s || '').replace(/"/g, '""') + '"'; }
function vocabularyCsv(entries) {
  const header = ['内容','类型','译文','完整英文释义','音标','原句','来源文档','位置','备注','下次复习'];
  const rows = entries.map(e => [e.text, e.kind, e.translation, e.definition, e.phonetic, e.context, e.bookTitle, e.location, e.note, e.card.due].map(csvEscape).join(','));
  return '\ufeff' + header.map(csvEscape).join(',') + '\r\n' + rows.join('\r\n');
}
module.exports = { normalize, hydrate, makeEntry, reviewEntry, reviewIntervals, vocabularyCsv };
