const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const { Dictionary } = require('../electron/dictionary.cjs');
const { ContextMeanings } = require('../electron/context-meanings.cjs');
const fs = require('node:fs'), os = require('node:os');

const dictionary = new Dictionary(path.resolve(__dirname, '..', 'assets'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vlm-context-dict-'));
const meanings = new ContextMeanings(dir);
dictionary.contextMeanings = meanings;

test('a word no dictionary covers can be answered from a remembered AI meaning', async () => {
  meanings.save('zorbnic', { translation: 'adj. 虚构的示例词', explanation: '来自语境', context: 'a zorbnic example' });
  const found = await dictionary.lookup('zorbnic');
  assert.ok(found, 'the remembered meaning must be usable');
  assert.equal(found.source, 'AI 语境');
  assert.match(found.translation, /虚构的示例词/);
});

test('a real dictionary entry always wins over the remembered meaning', async () => {
  meanings.save('resilient', { translation: '被 AI 覆盖的释义' });
  const found = await dictionary.lookup('resilient');
  assert.notEqual(found.source, 'AI 语境');
  assert.doesNotMatch(String(found.translation), /被 AI 覆盖/);
});

test.after(() => { dictionary.close(); fs.rmSync(dir, { recursive: true, force: true }); });
