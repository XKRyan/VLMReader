const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { ContextMeanings, LIMIT } = require('../electron/context-meanings.cjs');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vlm-context-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('an AI meaning in context survives a restart and is found case-insensitively', async t => {
  const dir = fixture(t);
  const store = new ContextMeanings(dir);
  store.save('Grimly', { translation: 'adv. 严肃地；冷峻地', explanation: '此处修饰 surveying', context: 'the latter, grimly surveying the board' });
  const restored = new ContextMeanings(dir);
  const found = restored.get('grimly');
  assert.equal(found.translation, 'adv. 严肃地；冷峻地');
  assert.equal(found.explanation, '此处修饰 surveying');
  assert.match(found.context, /surveying/);
  assert.equal(restored.get('GRIMLY').word, 'Grimly');
  assert.equal(restored.get('unknown'), null);
});

test('a newer meaning replaces the older one for the same word', async t => {
  const store = new ContextMeanings(fixture(t));
  store.save('bank', { translation: 'n. 银行' });
  store.save('BANK', { translation: 'n. 河岸', context: 'the river bank' });
  assert.equal(store.get('bank').translation, 'n. 河岸');
});

test('empty or malformed input is ignored instead of stored', async t => {
  const store = new ContextMeanings(fixture(t));
  assert.equal(store.save('', { translation: 'x' }), null);
  assert.equal(store.save('word', { translation: '   ' }), null);
  assert.equal(store.save('word', null), null);
  assert.equal(store.list().length, 0);
});

test('the store is bounded and drops the oldest meanings first', async t => {
  const dir = fixture(t);
  const seed = {};
  for (let index = 0; index < LIMIT; index++) {
    seed['word' + index] = { word: 'word' + index, translation: 'meaning ' + index, at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString() };
  }
  fs.writeFileSync(path.join(dir, 'context-meanings.json'), JSON.stringify(seed));
  const store = new ContextMeanings(dir);
  seed['word0'].at = new Date(Date.UTC(2025, 0, 1)).toISOString();
  fs.writeFileSync(path.join(dir, 'context-meanings.json'), JSON.stringify(seed));
  const loaded = new ContextMeanings(dir);
  loaded.save('fresh', { translation: '最新的一条' });
  const onDisk = JSON.parse(fs.readFileSync(loaded.file, 'utf8'));
  assert.equal(Object.keys(onDisk).length, LIMIT);
  assert.equal(loaded.get('word0'), null, 'the oldest entry is dropped');
  assert.equal(loaded.get('fresh').translation, '最新的一条');
  assert.ok(store.get('word1'), 'other entries survive');
});

test('a damaged file never blocks translation', async t => {
  const dir = fixture(t);
  fs.writeFileSync(path.join(dir, 'context-meanings.json'), 'not json');
  const store = new ContextMeanings(dir);
  assert.equal(store.get('grimly'), null);
  store.save('grimly', { translation: 'adv. 严肃地' });
  assert.equal(new ContextMeanings(dir).get('grimly').translation, 'adv. 严肃地');
});
