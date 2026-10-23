const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const { Dictionary } = require('../electron/dictionary.cjs');

const dictionary = new Dictionary(path.resolve(__dirname, '..', 'assets'));

test('a misspelling that only has a "[网络]" entry is corrected to the real word', async () => {
  // ECDICT keeps scraped rows for common typos, e.g. "recieve" -> "[网络] 收…".
  for (const [typo, expected] of [['resiliant', 'resilient'], ['recieve', 'receive'], ['accomodate', 'accommodate']]) {
    const hint = await dictionary.suggest(typo);
    assert.ok(hint, `no suggestion for ${typo}`);
    assert.equal(hint.word.toLowerCase(), expected, `${typo} -> ${hint.word}`);
    assert.ok(!/^\s*\[网络\]/.test(hint.translation), 'the hint must not point at another scraped row');
  }
});

test('a misspelling missing from the dictionary is still corrected', async () => {
  const hint = await dictionary.suggest('govrenment');
  assert.ok(hint && hint.word.toLowerCase() === 'government', `got ${hint && hint.word}`);
});

test('solid headwords and non-Latin input are left alone', async () => {
  assert.equal(await dictionary.suggest('resilient'), null, 'a correct word needs no correction');
  assert.equal(await dictionary.suggest('receive'), null);
  assert.equal(await dictionary.suggest('a'), null);
  assert.equal(await dictionary.suggest('能力'), null);
  assert.equal(await dictionary.suggest('1234'), null);
});

test('spelling hints do not depend on which display sources are enabled', async () => {
  dictionary.setSources([]);
  const hint = await dictionary.suggest('resiliant');
  assert.ok(hint && hint.word.toLowerCase() === 'resilient', 'spelling aid still works with sources off');
  dictionary.setSources(Dictionary.SOURCES);
  dictionary.close();
});
