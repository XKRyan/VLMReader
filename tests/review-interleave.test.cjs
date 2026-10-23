const test = require('node:test'), assert = require('node:assert/strict');
const { makeEntry, withReviewSkills, reviewEntry, studyEntry } = require('../electron/core.cjs');
const { DEFAULTS } = require('../electron/store.cjs');
const { buildReviewQueue, reconcileReviewQueue, nextReview } = require('../shared/review-policy.mjs');

const settings = { ...DEFAULTS, reviewMethods: ['meaning'], apiKeySet: true, newPerDay: 20 };
const now = Date.parse('2026-10-18T10:00:00Z');
const word = index => 'word' + String.fromCharCode(97 + (index % 26));
const stateFor = entries => ({ entries, settings: { ...settings }, stats: { reviews: [] }, notebooks: [] });
function dueEntry(index) {
  let entry = withReviewSkills(makeEntry({ text: word(index), translation: '词' + index }, new Date(now - 4 * 86400000)));
  entry = reviewEntry(entry, 4, new Date(now - 3 * 86400000), 'meaning');
  entry.reviewSkills.meaning.card.due = new Date(now - 3600000).toISOString();
  return entry;
}
const freshEntry = index => withReviewSkills(makeEntry({ text: word(index), translation: '词' + index }, new Date(now)));

test('new words are introduced between due reviews instead of piling up behind them', () => {
  const entries = [...Array.from({ length: 6 }, (_, i) => dueEntry(i)), ...Array.from({ length: 4 }, (_, i) => freshEntry(10 + i))];
  const queue = buildReviewQueue(stateFor(entries), 'all', '', now);
  const kinds = queue.map(task => task.isNew ? 'N' : 'D').join('');
  assert.equal(queue.length, 10, kinds);
  assert.ok(kinds.includes('N'), 'fresh words must not be dropped');
  const firstNew = kinds.indexOf('N');
  assert.ok(firstNew <= 3, `a new word must appear early, got ${kinds}`);
  assert.ok(kinds.slice(firstNew).includes('D'), `reviews must separate the new words, got ${kinds}`);
});

test('new material is capped and first sightings return only after their recall time', () => {
  const state = stateFor(Array.from({ length: 20 }, (_, i) => freshEntry(i)));
  let queue = buildReviewQueue(state, 'all', '', now), index = 0, clock = now;
  const seen = [];
  for (let round=0; round<12; round++) {
    if(index>=queue.length){clock+=60000;queue=reconcileReviewQueue(state,queue,index,'all','',clock);}
    if(index>=queue.length)continue;
    const task = queue[index];
    seen.push(task.entryId);
    const entry = state.entries.find(item => item.id === task.entryId);
    // A step may be pulled in slightly early when it matures inside the imminent
    // window, but nothing further ahead than that.
    assert.ok(task.due<=clock+2*60000,'Do not practice a future step early');
    const answered = task.stage==='study'?studyEntry(entry,new Date(clock)):reviewEntry(entry, 3, new Date(clock), task.mode);
    state.entries = state.entries.map(item => item.id === entry.id ? answered : item);
    if(task.stage!=='study')state.stats.reviews.push({ entryId: entry.id, time: new Date(clock).toISOString(), isNew: task.isNew, rating: 3 });
    clock += 10000;
    index += 1;
    queue = reconcileReviewQueue(state, queue, index, 'all', '', clock,false,false);
  }
  const repeat = seen.findIndex((id, position) => seen.indexOf(id) !== position);
  assert.ok(repeat > 0 && repeat <= 5, `the first word must come back before adding a sixth new word, got ${repeat}`);
  assert.equal(new Set(seen.slice(0, repeat)).size, repeat, 'no word repeats before that recall');
});

test('a word that graduated past its learning steps does not return in the same sitting', () => {
  const state = stateFor([freshEntry(0), ...Array.from({ length: 8 }, (_, i) => freshEntry(i + 1))]);
  let queue = buildReviewQueue(state, 'all', '', now), index = 0, clock = now;
  const first = queue[0];
  // Good, then Good again when the ten-minute step matures: the card graduates.
  for (let round = 0; round < 2; round++) {
    const at = queue.findIndex((task, position) => position >= index && task.entryId === first.entryId);
    assert.ok(at >= 0, `the learning card must be queued again in round ${round}`);
    index = at;
    const entry = state.entries.find(item => item.id === first.entryId);
    const answered = reviewEntry(entry, 3, new Date(clock), 'meaning');
    state.entries = state.entries.map(item => item.id === entry.id ? answered : item);
    state.stats.reviews.push({ entryId: entry.id, time: new Date(clock).toISOString(), isNew: round === 0, rating: 3 });
    clock += 11 * 60000;
    index += 1;
    queue = reconcileReviewQueue(state, queue, index, 'all', '', clock);
  }
  assert.equal(nextReview(state.entries[0], settings, clock).learning, false);
  assert.ok(!queue.slice(index).some(task => task.entryId === first.entryId), 'a graduated card must leave the sitting');
});
