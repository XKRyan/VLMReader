const crypto = require('node:crypto');
const { createEmptyCard, fsrs, generatorParameters, Rating } = require('ts-fsrs');
const scheduler = fsrs(generatorParameters({ request_retention: 0.9, enable_fuzz: false }));
const normalize = s => String(s || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
function hydrate(card) {
  return { ...card, due: new Date(card.due), ...(card.last_review ? { last_review: new Date(card.last_review) } : {}) };
}
const {REVIEW_METHODS,totalReviews,nextReview}=require('../shared/review-policy.mjs');
function withReviewSkills(entry, legacyMode='meaning') {
  if(entry.kind!=='word')return entry;
  const existing=entry.reviewSkills||{}, skills={};
  const valid=card=>card&&[0,1,2,3].includes(card.state)&&Number.isFinite(new Date(card.due).getTime())&&['reps','lapses','stability','difficulty','elapsed_days','scheduled_days'].every(key=>Number.isFinite(card[key])&&card[key]>=0)&&(!card.last_review||Number.isFinite(new Date(card.last_review).getTime()));
  const created=Number.isFinite(new Date(entry.createdAt).getTime())?new Date(entry.createdAt):new Date();
  for(const mode of REVIEW_METHODS)skills[mode]=valid(existing[mode]?.card)?{...existing[mode],lastRating:[0,1,2,3,4].includes(existing[mode].lastRating)?existing[mode].lastRating:0}:{card:!entry.reviewSkills&&mode===legacyMode&&valid(entry.card)?entry.card:createEmptyCard(created),lastRating:0};
  return {...entry,reviewSkills:skills};
}
function reviewEntry(entry, rating, now = new Date(), mode='meaning') {
  if (![Rating.Again, Rating.Hard, Rating.Good, Rating.Easy].includes(rating)) throw Error('无效的复习评分');
  if(!REVIEW_METHODS.includes(mode)||entry.kind==='sentence'&&!['meaning','cloze'].includes(mode))throw Error('复习方式无效');
  entry=withReviewSkills(entry);
  const before=entry.kind==='word'?entry.reviewSkills[mode].card:entry.card;
  const result = scheduler.next(hydrate(before), now, rating);
  const reviewSkills=entry.reviewSkills?{...entry.reviewSkills,[mode]:{card:result.card,lastRating:rating}}:undefined;
  const updated={...entry,...(reviewSkills?{reviewSkills}:{}),card:result.card,updatedAt:now.toISOString(),history:[...(entry.history||[]),{before:entry.card,beforeSkill:entry.reviewSkills?.[mode],mode,log:result.log}].slice(-100)};
  if(reviewSkills)updated.card={...result.card,reps:totalReviews(updated),lapses:REVIEW_METHODS.reduce((sum,key)=>sum+reviewSkills[key].card.lapses,0)};
  return updated;
}
function reviewIntervals(entry, now = new Date(), mode='meaning') {
  if(!REVIEW_METHODS.includes(mode))throw Error('复习方式无效');
  entry=withReviewSkills(entry);
  const results = scheduler.repeat(hydrate(entry.reviewSkills?.[mode]?.card||entry.card), now);
  return [1,2,3,4].map(rating => ({ rating, due: results[rating].card.due.toISOString() }));
}
function undoReviewEntry(entry){
  const history=[...(entry.history||[])],last=history.pop();if(!last)return entry;
  const reviewSkills=entry.reviewSkills&&last.beforeSkill?{...entry.reviewSkills,[last.mode]:last.beforeSkill}:entry.reviewSkills;
  return {...entry,card:last.before,history,...(reviewSkills?{reviewSkills}:{})};
}
function makeEntry(input, now = new Date()) {
  const text = normalize(input.text);
  if (!text || text.length > 5000) throw Error('请选择 1–5000 个字符');
  const isChinese = /[\u3400-\u9fff]/.test(text);
  return { id: crypto.randomUUID(), text, language: isChinese ? 'zh' : 'en',
    kind: input.kind || (isChinese ? (text.length <= 6 && !/[。！？]/.test(text) ? 'word' : 'sentence') : (/^[\p{L}\p{M}'’-]+$/u.test(text) ? 'word' : 'sentence')),
    context: normalize(input.context).slice(0,12000), bookId: input.bookId || '', bookTitle: input.bookTitle || '', location: input.location || '',
    translation: input.translation || '', definition: input.definition || '', phonetic: input.phonetic || '', dictionaryWord: input.dictionaryWord || '',
    ...(Array.isArray(input.cueWords)?{cueWords:input.cueWords.filter(word=>typeof word==='string'&&word.length<=100).slice(0,32)}:{}),
    source: input.source || '', explanation:input.explanation||'',contextTranslation:input.contextTranslation||'',status: input.translation ? 'ready' : 'pending',
    createdAt: now.toISOString(), updatedAt: now.toISOString(), encounters: 1, contexts: [], note: '', suspended: false,
    card: createEmptyCard(now), history: [], notebookIds:[] };
}
function csvEscape(s) { return '"' + String(s || '').replace(/"/g, '""') + '"'; }
function vocabularyCsv(entries,settings={}) {
  const header = ['内容','类型','译文','完整英文释义','音标','原句','来源文档','位置','备注','下次复习'];
  const rows = entries.map(e => {const due=nextReview(e,settings).due;return [e.text, e.kind, e.translation, e.definition, e.phonetic, e.context, e.bookTitle, e.location, e.note, Number.isFinite(due)?new Date(due).toISOString():''].map(csvEscape).join(',');});
  return '\ufeff' + header.map(csvEscape).join(',') + '\r\n' + rows.join('\r\n');
}
module.exports = { normalize, hydrate, makeEntry, reviewEntry, reviewIntervals, undoReviewEntry, withReviewSkills, vocabularyCsv };
