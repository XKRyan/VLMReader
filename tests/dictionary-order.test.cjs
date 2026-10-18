const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { CustomDictionaries } = require('../electron/custom-dictionaries.cjs');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vlm-order-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const custom = new CustomDictionaries(dir);
  const catalog = ['a', 'b', 'c'].map((name, index) => ({
    id: `${String(index + 1).repeat(8)}-1111-2222-3333-444455556666`,
    name, count: 1, enabled: true, createdAt: '2026-01-01T00:00:00.000Z',
  }));
  fs.writeFileSync(custom.file, JSON.stringify(catalog));
  fs.writeFileSync(custom.personalFile, '[]');
  for (const item of catalog) fs.writeFileSync(custom.dbFile(item.id), '');
  return { dir, catalog, custom: new CustomDictionaries(dir) };
}

test('dictionaries keep their stored order and can be moved before another entry', t => {
  const { dir, catalog, custom } = fixture(t);
  assert.deepEqual(custom.list().filter(item => !item.editable).map(item => item.name), ['a', 'b', 'c']);

  const moved = custom.move(catalog[2].id, catalog[0].id);
  assert.deepEqual(moved.filter(item => !item.editable).map(item => item.name), ['c', 'a', 'b']);
  assert.deepEqual(new CustomDictionaries(dir).list().filter(item => !item.editable).map(item => item.name), ['c', 'a', 'b']);

  custom.move(catalog[0].id, null);
  assert.deepEqual(custom.list().filter(item => !item.editable).map(item => item.name), ['c', 'b', 'a']);

  assert.throws(() => custom.move('00000000-0000-0000-0000-000000000000', null), /词典不存在/);
  custom.close();
});

test('an unknown drop target appends instead of losing the dictionary', t => {
  const { catalog, custom } = fixture(t);
  custom.move(catalog[1].id, 'not-a-real-id');
  assert.deepEqual(custom.list().filter(item => !item.editable).map(item => item.name), ['a', 'c', 'b']);
  assert.equal(custom.list().filter(item => !item.editable).length, 3);
  custom.close();
});
