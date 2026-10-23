const crypto = require('node:crypto');
const { createEmptyCard, fsrs, generatorParameters, Rating } = require('ts-fsrs');
// FSRS-6 defaults with a one-year ceiling: a vocabulary card should not vanish
// for decades. Spacing itself is left to the model.
const defaultWeights = generatorParameters({}).w;
let schedulerParams = { request_retention: 0.9, enable_fuzz: false, maximum_interval: 365, learning_steps:['1m','10m'], relearning_steps:['1m','10m'] };
let scheduler = fsrs(generatorParameters(schedulerParams));
// The forgetting curve can be calibrated to this learner (see fsrs-calibrate).
// Only w20 changes; every other weight keeps the population defaults.
function setDecay(decay) {
  const value = Number(decay);
  if (!Number.isFinite(value) || value < 0.08 || value > 0.45) return false;
  const weights = [...defaultWeights]; weights[20] = value;
  scheduler = fsrs(generatorParameters({ ...schedulerParams, w: weights }));
  return true;
}
// Deterministic spread instead of random fuzz: words learned on the same day
// would otherwise all come back on exactly the same day. The jitter is seeded by
// the word and its review count, so a card always lands on the same date.
function spread(card, seed) {
  const days = card.scheduled_days;
  if (!(days >= 3)) return card;
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) { hash ^= seed.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  const offset = ((hash >>> 0) % 2001) / 20000 - 0.05;
  return { ...card, due: new Date(new Date(card.due).getTime() + offset * days * 86400000) };
}
const normalize = s => String(s || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
function hydrate(card) {
  return { ...card, due: new Date(card.due), ...(card.last_review ? { last_review: new Date(card.last_review) } : {}) };
}
const {REVIEW_METHODS,totalReviews,nextReview,isUnreviewed}=require('../shared/review-policy.mjs');
function studyEntry(entry, now = new Date()) {
  if (entry.kind !== 'word' || !entry.translation) throw Error('请先补全单词释义');
  if (!isUnreviewed(entry)) return entry;
  // Exposure is neither a successful retrieval nor a failed test. Keep every
  // FSRS card and the review log untouched until an actual recall attempt.
  return {...withReviewSkills(entry),initialLearning:{introducedAt:now.toISOString(),due:new Date(+now+60_000).toISOString()},updatedAt:now.toISOString()};
}
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
  if (rating === 4 && entry.initialLearning && mode === 'meaning' && [0,1].includes(before.state)) throw Error('新词先完成短期回忆，再使用轻松评分');
  const result = scheduler.next(hydrate(before), now, rating);
  const card = spread(result.card, entry.id + ':' + mode + ':' + result.card.reps);
  const reviewSkills=entry.reviewSkills?{...entry.reviewSkills,[mode]:{card,lastRating:rating}}:undefined;
  const updated={...entry,...(reviewSkills?{reviewSkills}:{}),card,updatedAt:now.toISOString(),history:[...(entry.history||[]),{before:entry.card,beforeSkill:entry.reviewSkills?.[mode],mode,log:result.log}].slice(-100)};
  if(reviewSkills)updated.card={...card,reps:totalReviews(updated),lapses:REVIEW_METHODS.reduce((sum,key)=>sum+reviewSkills[key].card.lapses,0)};
  return updated;
}
function reviewIntervals(entry, now = new Date(), mode='meaning') {
  if(!REVIEW_METHODS.includes(mode))throw Error('复习方式无效');
  entry=withReviewSkills(entry);
  const results = scheduler.repeat(hydrate(entry.reviewSkills?.[mode]?.card||entry.card), now);
  // The preview must show the same day the card will actually land on, spread included.
  return [1,2,3,4].map(rating => ({ rating, due: spread(results[rating].card, entry.id + ':' + mode + ':' + results[rating].card.reps).due.toISOString() }));
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
module.exports = { normalize, hydrate, makeEntry, studyEntry, reviewEntry, reviewIntervals, undoReviewEntry, withReviewSkills, vocabularyCsv, setDecay, defaultWeights };
