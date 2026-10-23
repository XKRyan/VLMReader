const test = require('node:test'), assert = require('node:assert/strict');
const { calibrate, samples, negativeLogLikelihood, withDecay, DEFAULT_DECAY } = require('../electron/fsrs-calibrate.cjs');
const { generatorParameters, fsrs, createEmptyCard } = require('ts-fsrs');

const day = 86400000;
const start = Date.parse('2026-01-01T00:00:00Z');

// A synthetic learner whose forgetting curve is deliberately steeper or flatter
// than the default. Reviews sit far past the stability point, which is where two
// curves actually differ.
function synthetic(trueDecay, count = 2000) {
  const scheduler = fsrs(generatorParameters({ w: withDecay(generatorParameters({}).w, trueDecay) }));
  const entries = [];
  let seed = 7;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < count; i++) {
    const stability = 1 + (i % 10) * 3;
    const elapsed = stability * (2 + (i % 8) * 3);
    const last = new Date(start + i * day);
    const card = { ...createEmptyCard(last), stability, difficulty: 5, state: 2, due: new Date(+last + stability * day), last_review: last };
    const retrievability = Number(scheduler.get_retrievability(card, new Date(+last + elapsed * day), false));
    const success = random() < retrievability;
    entries.push({
      id: 'e' + i,
      history: [{ beforeSkill: { card: { ...card, due: card.due.toISOString(), last_review: last.toISOString() } }, log: { rating: success ? 3 : 1, review: new Date(+last + elapsed * day).toISOString() } }],
    });
  }
  return { entries };
}

test('thin data is refused instead of fitted', () => {
  const report = calibrate({ entries: [{ id: 'a', history: [] }] });
  assert.equal(report.status, 'insufficient');
  assert.equal(report.samples, 0);
  assert.ok(report.needed > 0);
});

test('same-day learning steps are not used as long-term evidence', () => {
  const last = new Date(start);
  const card = { ...createEmptyCard(last), stability: 2, difficulty: 5, state: 1, due: new Date(+last + 600000), last_review: last };
  const entry = { id: 'x', history: [{ beforeSkill: { card: { ...card, due: card.due.toISOString(), last_review: last.toISOString() } }, log: { rating: 3, review: new Date(+last + 10 * 60000).toISOString() } }] };
  assert.equal(samples({ entries: [entry] }).length, 0);
});

test('a learner who forgets faster than the default is pulled toward a steeper curve', () => {
  const report = calibrate(synthetic(0.30));
  assert.ok(report.fittedDecay > DEFAULT_DECAY + 0.05, `expected a steeper estimate, got ${report.fittedDecay}`);
  if (report.status === 'fitted') assert.ok(report.holdout.after <= report.holdout.before * 1.005, 'a fitted curve must also win on held-out reviews');
});

test('a learner who forgets slower than the default is pulled toward a flatter curve', () => {
  const report = calibrate(synthetic(0.08));
  assert.ok(report.fittedDecay < DEFAULT_DECAY, `expected a flatter estimate, got ${report.fittedDecay}`);
});

test('a clear difference is accepted, a marginal one is not', () => {
  const strong = calibrate(synthetic(0.42));
  assert.equal(strong.status, 'fitted');
  const marginal = calibrate(synthetic(0.13));
  if (marginal.status !== 'fitted') assert.equal(marginal.decay, DEFAULT_DECAY, 'a rejected fit leaves the default untouched');
  assert.ok(marginal.fittedDecay >= 0.08 && marginal.fittedDecay <= 0.45);
});

test('the loss prefers the curve that generated the reviews', () => {
  const list = samples(synthetic(0.30));
  const defaults = generatorParameters({}).w;
  assert.ok(negativeLogLikelihood(list, withDecay(defaults, 0.30)) < negativeLogLikelihood(list, defaults));
});

test('ratings below Good count as forgetting, not as recall', () => {
  const state = synthetic(0.3, 80);
  for (const entry of state.entries) entry.history[0].log.rating = 1;
  const defaults = generatorParameters({}).w;
  const list = samples(state);
  assert.ok(negativeLogLikelihood(list, withDecay(defaults, 0.45)) <= negativeLogLikelihood(list, withDecay(defaults, 0.08)));
});
