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
  return totalReviews(entry) === 0 && !(entry.clozePractice?.attempts > 0) && !entry.initialLearning;
}
const timestamp = value => Number.isFinite(new Date(value).getTime()) ? new Date(value).getTime() : 0;
function lastPractice(entry) {
  return Math.max(...REVIEW_METHODS.map(mode => timestamp(entry.reviewSkills?.[mode]?.card?.last_review)),
    timestamp(entry.card?.last_review), timestamp(entry.clozePractice?.lastResult?.record?.time), timestamp(entry.initialLearning?.introducedAt));
}
function lastMethod(entry) {
  const practices = REVIEW_METHODS.map(mode=>({mode,time:timestamp(entry.reviewSkills?.[mode]?.card?.last_review)}));
  const result=entry.clozePractice?.lastResult?.record;
  if(result)practices.push({mode:'cloze',time:timestamp(result.time)});
  const last=entry.history?.at(-1);
  if(last?.mode)practices.push({mode:last.mode,time:timestamp(last.log?.review)});
  return practices.reduce((latest,item)=>item.time>=latest.time?item:latest,{time:-1})?.mode;
}
// First writing is an application checkpoint, not a reward for merely seeing
// the definition. Respect the enabled foundations; writing-only remains usable.
export function firstProductionReady(entry, settings = {}) {
  const modes = enabledMethods(settings), skills = entry.reviewSkills || {};
  const passed = mode => skills[mode]?.card.reps > 0 && skills[mode]?.lastRating >= 3
    && !(mode === 'cloze' && entry.clozePractice?.lastResult?.record?.hints > 0);
  const applications = modes.filter(mode => mode === 'cloze' || mode === 'spelling');
  if (modes.includes('meaning') && !passed('meaning')) return false;
  // Disabling a foundational mode does not erase an already demonstrated skill.
  if (['cloze','spelling'].some(passed)) return true;
  if (applications.length) return false;
  return !modes.includes('meaning') || passed('meaning') && skills.meaning.card.reps >= 2;
}
function firstProductionPending(entry, settings = {}) {
  return entry.kind === 'word' && enabledMethods(settings).includes('production')
    && settings.apiKeySet && (!entry.reviewSkills?.production?.card.reps
      || [1,3].includes(entry.reviewSkills.production.card.state) || !!entry.productionPractice?.retryAfter)
    && (!!entry.initialLearning || totalReviews(entry) > 0);
}
// One task per word. Trained skills keep independent FSRS cards; untouched
// skills are introduced with a gap instead of revealing every answer together.
export function nextReview(entry, settings = {}, now = Date.now()) {
  if (entry.kind !== 'word' || !entry.reviewSkills) {
    const modes=enabledMethods(settings);
    return {entryId: entry.id, mode: entry.kind === 'sentence' ? settings.sentenceReviewMode || 'meaning' : modes.includes('meaning')?'meaning':modes[0],
      due: timestamp(entry.card?.due), isNew: isUnreviewed(entry), learning: [1, 3].includes(entry.card?.state),
      ...(entry.kind === 'word' && isUnreviewed(entry) && modes.includes('meaning') ? {stage:'study'} : {})};
  }
  const modes = enabledMethods(settings).filter(mode=>mode!=='production'||settings.apiKeySet), last = lastPractice(entry), fresh = isUnreviewed(entry);
  if(!modes.length)return {entryId:entry.id,mode:'production',due:Infinity,isNew:fresh,learning:false,blocked:true};
  const first = modes.includes('meaning') ? 'meaning' : modes[0];
  const lastMode = lastMethod(entry);
  const candidates = modes.filter(mode => mode !== 'production' || entry.reviewSkills.production?.card.reps
    || firstProductionReady(entry, settings)).map(mode => {
    const skill = entry.reviewSkills[mode], card = skill?.card;
    const trained = !!card?.reps;
    let due = trained ? timestamp(card.due) : last ? last + METHOD_GAP : timestamp(entry.createdAt);
    const initial = entry.initialLearning && totalReviews(entry) === 0 && mode === first;
    if (initial) due = Math.max(timestamp(entry.initialLearning.due), entry.clozePractice?.attempts > 0 && mode !== lastMode ? last + METHOD_GAP : 0);
    // Seeing another answer is a cue. Space sibling abilities without changing
    // their FSRS memory states; same-ability relearning keeps its own short step.
    if(trained&&last&&mode!==lastMode)due=Math.max(due,last+METHOD_GAP);
    if (mode === 'cloze' && entry.clozePractice?.retryAfter) due = Math.max(due, timestamp(entry.clozePractice.retryAfter));
    if (mode === 'production') {
      if (entry.productionPractice?.retryAfter) due = Math.max(timestamp(entry.productionPractice.retryAfter), mode === lastMode ? 0 : last + METHOD_GAP);
      due = Math.max(due, timestamp(entry.productionPractice?.deferredUntil));
    }
    const learning = !!initial || trained && [1, 3].includes(card.state) || mode === 'production' && !!entry.productionPractice?.retryAfter;
    const interval = Math.max(60_000, (card?.scheduled_days || 0) * 86400_000);
    const urgency = (now - due) / interval + (mode !== lastMode ? 0.25 : 0) + (skill?.lastRating === 1 ? 0.5 : 0);
    return {entryId: entry.id, mode, due, isNew: fresh, learning, urgency,
      ...(mode === 'production' && !trained ? {firstProduction:true} : {})};
  });
  if (fresh) return {...candidates.find(task => task.mode === first), ...(first === 'meaning' ? {stage:'study'} : {})};
  // A neutral answer leaves mastery unchanged but asks for another target-word
  // check after ten minutes, even if the skill has never received an FSRS grade.
  const neutral = entry.clozePractice?.retryAfter;
  if (neutral && modes.includes('cloze')) {
    const task = candidates.find(task => task.mode === 'cloze');
    task.due = Math.max(timestamp(neutral), lastMode === 'cloze' ? 0 : last + METHOD_GAP); task.learning = true;
  }
  const ready = candidates.filter(task => task.due <= now);
  // Once the foundations are passed and the cue gap elapsed, guarantee the
  // first writing turn instead of letting another due ability hide it forever.
  const firstWriting = ready.find(task => task.firstProduction);
  if (firstWriting) return firstWriting;
  return ready.length ? ready.sort((a, b) => Number(b.learning) - Number(a.learning) || b.urgency - a.urgency || a.due - b.due)[0]
    : candidates.sort((a, b) => a.due - b.due)[0];
}
// Notebooks are either the learner's own (words added one by one) or word lists
// (imported or preset). A word belongs to the word lists only when every notebook
// holding it is a word list; unfiled words are the learner's own.
export function wordlistIds(notebooks = []) {
  return new Set(notebooks.filter(notebook => notebook.kind === 'wordlist').map(notebook => notebook.id));
}
export function isListOnly(entry, lists) {
  const ids = entry.notebookIds || [];
  return ids.length > 0 && ids.every(id => lists.has(id));
}
// Notebooks created before kinds existed: a bulk import (most words added within minutes) is a word list.
export function inferNotebookKind(notebook, entries) {
  if (notebook.system) return 'personal';
  const times = entries.filter(entry => entry.notebookIds?.includes(notebook.id)).map(entry => Date.parse(entry.createdAt)).filter(Number.isFinite).sort((a, b) => a - b);
  let burst = 0;
  for (let end = 0, start = 0; end < times.length; end++) { while (times[end] - times[start] > 600000) start++; burst = Math.max(burst, end - start + 1); }
  return times.length >= 30 && burst >= times.length * 0.8 ? 'wordlist' : 'personal';
}
export function inNotebook(entry, scope = '', lists = new Set()) {
  if (!scope || scope === 'all') return true;
  if (scope === 'unfiled') return !entry.notebookIds?.length;
  if (scope === 'unreviewed') return entry.kind === 'word' && isUnreviewed(entry) && !isListOnly(entry, lists);
  if (scope === 'unreviewed-lists') return entry.kind === 'word' && isUnreviewed(entry) && isListOnly(entry, lists);
  return entry.notebookIds?.includes(scope) || false;
}
function mixDueMethods(tasks) {
  // A large backlog of one ability must not hide the other enabled abilities.
  // Keep the urgency order inside each ability; all of these cards are due.
  const lanes = new Map();
  for (const task of tasks) {
    if (!lanes.has(task.mode)) lanes.set(task.mode, {tasks: [], index: 0});
    lanes.get(task.mode).tasks.push(task);
  }
  const mixed = [];
  while (mixed.length < tasks.length) {
    for (const lane of lanes.values()) if (lane.index < lane.tasks.length) mixed.push(lane.tasks[lane.index++]);
  }
  return mixed;
}

export const NEW_BATCH = 5;
export function initialLearningPending(entry) {
  if (entry.kind !== 'word') return false;
  const cards = Object.values(entry.reviewSkills || {}).map(skill => skill.card);
  return !cards.some(card => [2, 3].includes(card.state))
    && (!!entry.initialLearning || cards.some(card => card.reps > 0));
}
// A new-word session keeps its unfinished words after the initial presentation.
// The vocabulary's strict "unreviewed" filter remains unchanged.
export function inReviewScope(entry, scope = '', lists = new Set(), settings = {}) {
  if (['unreviewed', 'unreviewed-lists'].includes(scope) && (initialLearningPending(entry) || firstProductionPending(entry, settings))) {
    return scope === 'unreviewed-lists' ? isListOnly(entry, lists) : !isListOnly(entry, lists);
  }
  return inNotebook(entry, scope, lists);
}
export function interleaveNew(due, fresh) {
  const mixed = [], spacing = Math.max(2, Math.ceil(due.length / Math.max(1, fresh.length)));
  let cursor = 0;
  for (let index = 0; index < due.length; index++) {
    mixed.push(due[index]);
    if ((index + 1) % spacing === 0 && cursor < fresh.length) mixed.push(fresh[cursor++]);
  }
  return [...mixed, ...fresh.slice(cursor)];
}
export function buildReviewQueue(state, kind = 'all', scope = '', now = Date.now(), early = false) {
  const day = new Date(now).toLocaleDateString('en-CA');
  const used = new Set(state.stats.reviews.filter(record => record.isNew && new Date(record.time).toLocaleDateString('en-CA') === day).map(record => record.entryId));
  for (const entry of state.entries) if (entry.initialLearning && new Date(entry.initialLearning.introducedAt).toLocaleDateString('en-CA') === day) used.add(entry.id);
  const lists = wordlistIds(state.notebooks);
  const entries = state.entries.filter(entry => !entry.suspended && entry.translation && inReviewScope(entry, scope, lists, state.settings) && (kind === 'all' || kind === entry.kind));
  const tasks = entries.map(entry => nextReview(entry, state.settings, now));
  const live = tasks.filter(task => !task.blocked);
  const due = live.filter(task => !task.isNew && task.due <= now).sort((a, b) => Number(b.learning) - Number(a.learning) || a.due - b.due);
  // A step that matures in the next couple of minutes is part of this sitting.
  // Showing it seconds early costs almost nothing and removes the dead minute
  // where the session would otherwise look finished.
  const imminent = live.filter(task => !task.isNew && task.mode !== 'production' && task.due > now && task.due <= now + WAIT_WINDOW).sort((a, b) => a.due - b.due);
  // Count learning words, not four sibling abilities. A backlog of weak words
  // reduces new material while every due review remains available.
  const methods = enabledMethods(state.settings).filter(mode => mode !== 'production' || state.settings.apiKeySet);
  const learning = entries.filter(entry => initialLearningPending(entry) || methods.some(mode => [1, 3].includes(entry.reviewSkills?.[mode]?.card.state))).length;
  const limit = Number.isInteger(state.settings.newPerDay) ? state.settings.newPerDay : 20;
  // How many first sightings one batch may hold. A small batch keeps the sitting
  // varied; the next batch starts as soon as this one is done.
  const batch = Number.isInteger(state.settings.newBatch) ? Math.max(1, Math.min(20, state.settings.newBatch)) : NEW_BATCH;
  const dailyLeft = Math.max(0, limit - used.size);
  const introductions = live.filter(task => task.isNew && !task.learning && task.due <= now).sort((a, b) => a.due - b.due);
  // The pipeline, in priority order: recall steps that are due or imminent, then
  // due reviews, then at most one batch of first sightings while other work
  // exists. The batch is a rhythm, not a wall: when nothing else is left the
  // next batch starts, so the learner is never parked on a waiting screen.
  let fresh = introductions.slice(0, Math.min(dailyLeft, Math.max(0, batch - learning)));
  let queue = interleaveNew(mixDueMethods([...due, ...imminent]), fresh);
  if (!queue.length && dailyLeft > 0 && introductions.length) {
    fresh = introductions.slice(0, Math.min(dailyLeft, batch));
    queue = interleaveNew([], fresh);
  }
  if (!queue.length && !early) {
    // Nothing at all: no early practice of future steps just to look busy,
    // unless the learner explicitly asks to continue.
    return [];
  }
  // The learner may still choose to continue past a learning gap: the
  // completion screen offers that explicitly instead of blocking the page.
  // Once chosen, the sitting keeps pulling the nearest upcoming cards, but only
  // within a day: practising something due next month would distort the schedule
  // far more than crossing a ten-minute step slightly early.
  if (!early) return queue;
  const extraNew = introductions.slice(fresh.length, dailyLeft);
  const soon = live.filter(task => !task.isNew && task.mode !== 'production' && task.due > now && task.due <= now + EARLY_HORIZON)
    .sort((a, b) => Number(b.learning) - Number(a.learning) || a.due - b.due)
    .slice(0, EARLY_BATCH);
  return [...queue, ...extraNew, ...soon];
}
export const EARLY_HORIZON = 24 * 60 * 60 * 1000;
export const EARLY_BATCH = 20;
// A learning step maturing inside this window is worth a short wait; outside it
// the session moves on to the next batch instead of parking the learner.
export const WAIT_WINDOW = 2 * 60 * 1000;
export function reconcileReviewQueue(state, queue, index, kind = 'all', scope = '', now = Date.now(), keepCurrentResult = false, preserveCurrent = true, early = false) {
  const current = queue[index], entry = current && state.entries.find(entry => entry.id === current.entryId);
  const allowed = enabledMethods(state.settings).filter(mode => mode !== 'production' || state.settings.apiKeySet);
  const keep = preserveCurrent && entry && !entry.suspended && entry.translation && inReviewScope(entry, scope, wordlistIds(state.notebooks), state.settings)
    && (kind === 'all' || entry.kind === kind)
    && (keepCurrentResult || (entry.kind === 'sentence' ? ['meaning', 'cloze'].includes(current.mode) : allowed.includes(current.mode)));
  const prefix = queue.slice(0, index);
  const answered = new Set(prefix.map(task => task.entryId));
  const ready = buildReviewQueue(state, kind, scope, now, early).filter(task => {
    if (keep && task.entryId === current.entryId) return false;
    // A word practised in this sitting may come back within the imminent window
    // (its own one-minute step) but not just because early mode reaches a day
    // ahead; otherwise it would repeat immediately.
    return !(answered.has(task.entryId) && task.due > now + WAIT_WINDOW);
  });
  // Retain pending round-robin order: rebuilding from the first mode after
  // every answer otherwise starves spelling/production behind a recall backlog.
  const key = task => task.entryId + ':' + task.mode;
  const positions = new Map(queue.slice(index).map((task, at) => [key(task), at]));
  const introduced = new Map(ready.map((task, at) => [key(task), at - 0.5]));
  ready.sort((a, b) => Number(b.learning && !positions.has(key(b))) - Number(a.learning && !positions.has(key(a)))
    || (positions.get(key(a)) ?? introduced.get(key(a))) - (positions.get(key(b)) ?? introduced.get(key(b))));
  // Short writing relearning must not repeatedly jump ahead of other due words.
  // Keep the due times intact; only rotate recent writing behind alternatives.
  const recentWriting = new Set(prefix.slice(-2).filter(task => task.mode === 'production').map(task => task.entryId));
  if (recentWriting.size) ready.sort((a,b) => Number(a.mode === 'production' && recentWriting.has(a.entryId))
    - Number(b.mode === 'production' && recentWriting.has(b.entryId)));
  return [...prefix, ...(keep ? [current] : []), ...ready];
}
