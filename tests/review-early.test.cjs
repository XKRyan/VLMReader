const test = require('node:test'), assert = require('node:assert/strict');
const { makeEntry, withReviewSkills, reviewEntry } = require('../electron/core.cjs');
const { DEFAULTS } = require('../electron/store.cjs');
const { buildReviewQueue, reconcileReviewQueue, EARLY_BATCH } = require('../shared/review-policy.mjs');

const now = Date.parse('2026-10-20T02:00:00Z');
const settings = { ...DEFAULTS, reviewMethods: ['meaning'], apiKeySet: true };
const stateFor = entries => ({ entries, settings: { ...settings }, stats: { reviews: [] }, notebooks: [] });
const MINUTE = 60000;

function scheduledIn(ms, index = 0) {
  let entry = withReviewSkills(makeEntry({ text: 'harbour' + String.fromCharCode(97 + Math.floor(index / 26)) + String.fromCharCode(97 + index % 26), translation: '港口' }, new Date(now - 6 * 86400000)));
  entry = reviewEntry(entry, 3, new Date(now - 5 * 86400000), 'meaning');
  entry.reviewSkills.meaning.card.due = new Date(now + ms).toISOString();
  entry.reviewSkills.meaning.card.scheduled_days = Math.max(1, Math.round(ms / 86400000));
  return entry;
}

test('nothing is practised ahead while the queue still has work', () => {
  const state = stateFor([scheduledIn(3 * 86400000)]);
  assert.equal(buildReviewQueue(state, 'all', '', now).length, 0, 'a future card is not due yet');
});

test('the learner can ask to keep going instead of waiting', () => {
  const state = stateFor([scheduledIn(10 * MINUTE, 0), scheduledIn(3 * 86400000, 1)]);
  const early = buildReviewQueue(state, 'all', '', now, true);
  assert.equal(early.length, 1, 'the ten-minute card is offered, the three-day one is not');
  assert.ok(early[0].due > now && early[0].due <= now + 10 * MINUTE + 1000);
});

test('kept going, the sitting keeps refilling from cards due within a day', () => {
  const state = stateFor([scheduledIn(5 * MINUTE, 0), scheduledIn(60 * MINUTE, 1), scheduledIn(20 * 3600000, 2), scheduledIn(30 * 3600000, 3)]);
  let queue = buildReviewQueue(state, 'all', '', now, true);
  assert.equal(queue.length, 3, 'the card due in 30 hours stays out');
  // Answer the first card and reconcile in the same early mode.
  const task = queue[0];
  const entry = state.entries.find(item => item.id === task.entryId);
  state.entries = state.entries.map(item => item.id === entry.id ? reviewEntry(entry, 3, new Date(now)) : item);
  queue = reconcileReviewQueue(state, queue, 1, 'all', '', now + 1000, false, false, true);
  assert.ok(queue.slice(1).length >= 2, 'the sitting keeps a queue instead of stopping after one card');
});

test('an explicit early batch is capped so one click cannot dump everything', () => {
  const state = stateFor(Array.from({ length: 40 }, (_, i) => scheduledIn(2 * 3600000, i)));
  assert.equal(buildReviewQueue(state, 'all', '', now, true).length, EARLY_BATCH);
});
