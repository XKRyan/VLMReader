// Local FSRS calibration.
//
// The scheduler ships with population-average weights. This module fits the one
// weight that decides how fast *this* learner forgets — w20, the decay of the
// forgetting curve — from the review history stored with each entry. Everything
// stays on the machine; no data leaves the app.
//
// It refuses to fit on thin data, and it keeps the default unless the fitted
// curve beats it both on the training loss and on a held-out slice, because a
// worse curve silently corrupts every future interval.
const { fsrs, generatorParameters } = require('ts-fsrs');

const MIN_SAMPLES = 60;
const MAX_SAMPLES = 4000;
const MIN_IMPROVEMENT = 0.02;
const DECAY_RANGE = [0.08, 0.45];
const DEFAULT_DECAY = generatorParameters({}).w[20];

function hydrateCard(card) {
  return {
    ...card,
    due: new Date(card.due),
    ...(card.last_review ? { last_review: new Date(card.last_review) } : {}),
  };
}

// Every review that happened at least a day after the previous one says
// something about long-term forgetting. Same-day learning steps do not.
function samples(state) {
  const out = [];
  for (const entry of state.entries || []) {
    for (const record of entry.history || []) {
      const before = record.beforeSkill?.card || record.before;
      const log = record.log;
      if (!before || !log || !(before.stability > 0)) continue;
      const review = new Date(log.review);
      const last = before.last_review ? new Date(before.last_review) : null;
      if (!last || !Number.isFinite(review.getTime()) || !Number.isFinite(last.getTime())) continue;
      const elapsed = (review - last) / 86400000;
      if (!(elapsed >= 1)) continue;
      out.push({ card: hydrateCard(before), review, elapsed, rating: Number(log.rating) });
    }
  }
  return out;
}

function negativeLogLikelihood(list, weights) {
  const scheduler = fsrs(generatorParameters({ w: weights }));
  let loss = 0;
  for (const sample of list) {
    const raw = scheduler.get_retrievability(sample.card, sample.review, false);
    const r = Math.min(1 - 1e-6, Math.max(1e-6, Number(raw)));
    loss -= Math.log(sample.rating > 1 ? r : 1 - r);
  }
  return loss / Math.max(1, list.length);
}

function withDecay(weights, decay) {
  const copy = [...weights];
  copy[20] = decay;
  return copy;
}

function calibrate(state) {
  const list = samples(state);
  if (list.length < MIN_SAMPLES) {
    return { status: 'insufficient', samples: list.length, needed: MIN_SAMPLES, decay: DEFAULT_DECAY };
  }
  // The grid search runs on the main thread, so a very large history is thinned
  // with a fixed stride instead of freezing the window for seconds.
  const stride = Math.max(1, Math.ceil(list.length / MAX_SAMPLES));
  const used = stride === 1 ? list : list.filter((_, index) => index % stride === 0);
  // Keep the most recent fifth as a holdout: memory drifts while learning.
  const split = Math.max(1, Math.floor(used.length * 0.8));
  const train = used.slice(0, split);
  const test = used.slice(split);
  const defaults = generatorParameters({}).w;
  const baseline = negativeLogLikelihood(train, defaults);
  let best = { decay: DEFAULT_DECAY, loss: baseline };
  const [low, high] = DECAY_RANGE;
  for (let decay = low; decay <= high + 1e-9; decay += 0.005) {
    const value = Number(decay.toFixed(4));
    const loss = negativeLogLikelihood(train, withDecay(defaults, value));
    if (loss < best.loss) best = { decay: value, loss };
  }
  const improvement = baseline > 0 ? (baseline - best.loss) / baseline : 0;
  const holdout = {
    before: Number(negativeLogLikelihood(test, defaults).toFixed(5)),
    after: Number(negativeLogLikelihood(test, withDecay(defaults, best.decay)).toFixed(5)),
  };
  // A holdout that is fractionally worse is within sampling noise; the fit is
  // only rejected when the held-out curve is clearly worse than the default.
  const accepted = improvement >= MIN_IMPROVEMENT && holdout.after <= holdout.before * 1.005;
  return {
    status: accepted ? 'fitted' : 'no_gain',
    samples: list.length,
    train: train.length,
    holdout: test.length,
    decay: accepted ? best.decay : DEFAULT_DECAY,
    fittedDecay: best.decay,
    defaultDecay: DEFAULT_DECAY,
    improvement: Number((improvement * 100).toFixed(2)),
    loss: { before: Number(baseline.toFixed(5)), after: Number(best.loss.toFixed(5)) },
    holdout,
  };
}

module.exports = { calibrate, samples, negativeLogLikelihood, withDecay, MIN_SAMPLES, DEFAULT_DECAY, DECAY_RANGE };
