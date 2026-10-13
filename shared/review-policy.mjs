export const REVIEW_METHODS = ['meaning', 'cloze', 'spelling', 'production'];
export const METHOD_GAP = 20 * 60 * 1000;
export function enabledMethods(settings = {}) {
  const chosen = settings.reviewMethods;
  const valid = Array.isArray(chosen) ? REVIEW_METHODS.filter(mode => chosen.includes(mode)) : REVIEW_METHODS.slice(0,3);
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
function lastMethod(entry) {
  const practices = REVIEW_METHODS.map(mode=>({mode,time:timestamp(entry.reviewSkills?.[mode]?.card?.last_review)}));
  const result=entry.clozePractice?.lastResult?.record;
  if(result)practices.push({mode:'cloze',time:timestamp(result.time)});
  const last=entry.history?.at(-1);
  if(last?.mode)practices.push({mode:last.mode,time:timestamp(last.log?.review)});
  return practices.reduce((latest,item)=>item.time>=latest.time?item:latest,{time:-1})?.mode;
}
// One task per word. Trained skills keep independent FSRS cards; untouched
// skills are introduced with a gap instead of revealing every answer together.
export function nextReview(entry, settings = {}, now = Date.now()) {
  if (entry.kind !== 'word' || !entry.reviewSkills) {
    const modes=enabledMethods(settings);
    return {entryId: entry.id, mode: entry.kind === 'sentence' ? settings.sentenceReviewMode || 'meaning' : modes.includes('meaning')?'meaning':modes[0],
      due: timestamp(entry.card?.due), isNew: isUnreviewed(entry), learning: [1, 3].includes(entry.card?.state)};
  }
  const modes = enabledMethods(settings).filter(mode=>mode!=='production'||settings.apiKeySet), last = lastPractice(entry), fresh = isUnreviewed(entry);
  if(!modes.length)return {entryId:entry.id,mode:'production',due:Infinity,isNew:fresh,learning:false,blocked:true};
  const first = modes.includes('meaning') ? 'meaning' : modes[0];
  const lastMode = lastMethod(entry);
  const candidates = modes.map(mode => {
    const skill = entry.reviewSkills[mode], card = skill?.card;
    const trained = !!card?.reps;
    let due = trained ? timestamp(card.due) : last ? last + METHOD_GAP : timestamp(entry.createdAt);
    // Seeing another answer is a cue. Space sibling abilities without changing
    // their FSRS memory states; same-ability relearning keeps its own short step.
    if(trained&&last&&mode!==lastMode)due=Math.max(due,last+METHOD_GAP);
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
  const due = tasks.filter(task => !task.blocked && !task.isNew && task.due <= now)
    .sort((a, b) => Number(b.learning) - Number(a.learning) || a.due - b.due);
  const limit=Number.isInteger(state.settings.newPerDay)?state.settings.newPerDay:20;
  const fresh = tasks.filter(task => !task.blocked && task.isNew&&task.due<=now).sort((a, b) => a.due - b.due).slice(0, Math.max(0,limit - used));
  return [...due, ...fresh];
}
