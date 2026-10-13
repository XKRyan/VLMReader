export const REVIEW_METHODS = ['meaning', 'cloze', 'spelling'];
export const METHOD_GAP = 20 * 60 * 1000;
export function enabledMethods(settings = {}) {
  const chosen = settings.reviewMethods;
  const valid = Array.isArray(chosen) ? REVIEW_METHODS.filter(mode => chosen.includes(mode)) : REVIEW_METHODS;
  return valid.length ? valid : ['meaning'];
}
export function totalReviews(entry) {
  return entry.kind === 'word' && entry.reviewSkills
    ? REVIEW_METHODS.reduce((sum, mode) => sum + (entry.reviewSkills[mode]?.card?.reps || 0), 0)
    : entry.card?.reps || 0;
}
export function isUnreviewed(entry) {
  return totalReviews(entry) === 0 && !(entry.clozePractice?.attempts > 0);
}
const timestamp = value => Number.isFinite(new Date(value).getTime()) ? new Date(value).getTime() : 0;
function lastPractice(entry) {
  return Math.max(...REVIEW_METHODS.map(mode => timestamp(entry.reviewSkills?.[mode]?.card?.last_review)),
    timestamp(entry.card?.last_review), timestamp(entry.clozePractice?.lastResult?.record?.time));
}
// One task per word. Trained skills keep independent FSRS cards; untouched
// skills are introduced with a gap rather than drilling all three immediately.
export function nextReview(entry, settings = {}, now = Date.now()) {
  if (entry.kind !== 'word' || !entry.reviewSkills) {
    const modes=enabledMethods(settings);
    return {entryId: entry.id, mode: entry.kind === 'sentence' ? settings.sentenceReviewMode || 'meaning' : modes.includes('meaning')?'meaning':modes[0],
      due: timestamp(entry.card?.due), isNew: isUnreviewed(entry), learning: [1, 3].includes(entry.card?.state)};
  }
  const modes = enabledMethods(settings), last = lastPractice(entry), fresh = isUnreviewed(entry);
  const first = modes.includes('meaning') ? 'meaning' : modes[0];
  const lastMode = entry.history?.at(-1)?.mode || entry.clozePractice?.lastResult?.record?.mode;
  const candidates = modes.map(mode => {
    const skill = entry.reviewSkills[mode], card = skill?.card;
    const trained = !!card?.reps;
    let due = trained ? timestamp(card.due) : last ? last + METHOD_GAP : timestamp(entry.createdAt);
    if (mode === 'cloze' && entry.clozePractice?.retryAfter) due = Math.max(due, timestamp(entry.clozePractice.retryAfter));
    const learning = trained && [1, 3].includes(card.state);
    const interval = Math.max(60_000, (card?.scheduled_days || 0) * 86400_000);
    const urgency = (now - due) / interval + (mode !== lastMode ? 0.25 : 0) + (skill?.lastRating === 1 ? 0.5 : 0);
    return {entryId: entry.id, mode, due, isNew: fresh, learning, urgency};
  });
  if (fresh) return candidates.find(task => task.mode === first);
  // A neutral answer leaves mastery unchanged but asks for another target-word
  // check after ten minutes, even if the skill has never received an FSRS grade.
  const neutral = entry.clozePractice?.retryAfter;
  if (neutral && modes.includes('cloze') && !entry.reviewSkills.cloze.card.reps) {
    const task = candidates.find(task => task.mode === 'cloze');
    task.due = timestamp(neutral); task.learning = true;
  }
  const ready = candidates.filter(task => task.due <= now);
  return ready.length ? ready.sort((a, b) => Number(b.learning) - Number(a.learning) || b.urgency - a.urgency || a.due - b.due)[0]
    : candidates.sort((a, b) => a.due - b.due)[0];
}
export function inNotebook(entry, scope = '') {
  if (!scope || scope === 'all') return true;
  if (scope === 'unfiled') return !entry.notebookIds?.length;
  if (scope === 'unreviewed') return entry.kind === 'word' && isUnreviewed(entry);
  return entry.notebookIds?.includes(scope) || false;
}
export function buildReviewQueue(state, kind = 'all', scope = '', now = Date.now()) {
  const day = new Date(now).toLocaleDateString('en-CA');
  const used = new Set(state.stats.reviews.filter(record => record.isNew && new Date(record.time).toLocaleDateString('en-CA') === day).map(record => record.entryId)).size;
  const tasks = state.entries.filter(entry => !entry.suspended && entry.translation && inNotebook(entry, scope) && (kind === 'all' || kind === entry.kind))
    .map(entry => nextReview(entry, state.settings, now));
  const due = tasks.filter(task => !task.isNew && task.due <= now)
    .sort((a, b) => Number(b.learning) - Number(a.learning) || a.due - b.due);
  const fresh = tasks.filter(task => task.isNew).sort((a, b) => a.due - b.due).slice(0, Math.max(0, state.settings.newPerDay - used));
  return [...due, ...fresh];
}
