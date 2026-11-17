// Tests for tools/backup-core.js and the CSV quoting in data-service.js.
// Run: node --test tests/*.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const B = require('../tools/backup-core.js');

function backup(over = {}) {
  const tables = {
    members: [{ id: 'u1', name: 'An', email: 'an@example.com', created_at: '2026-01-01T00:00:00Z' }],
    customers: [{ id: 'c1', name: "Bakkerij 't Hoekje", created_at: '2026-01-01T00:00:00Z' }],
    projects: [{ id: 'p1', customer_id: 'c1', name: 'Website', created_at: '2026-01-01T00:00:00Z' }],
    phases: [{ name: 'Ontwerp' }],
    entries: [
      { id: 'e1', member_id: 'u1', customer_id: 'c1', project_id: 'p1', phase: 'Ontwerp', date: '2026-11-02', minutes: 90, note: 'Schets <b>', created_at: '2026-11-02T10:00:00Z' },
      { id: 'e2', member_id: 'u1', customer_id: 'c1', project_id: 'p1', phase: '', date: '2026-11-03', minutes: 30, note: '', created_at: '2026-11-03T10:00:00Z' }
    ],
    ...over.tables
  };
  const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
  return { app: 'JATL', kind: 'backup', schemaVersion: 0, createdAt: '2026-11-17T12:00:00Z', createdBy: 'an@example.com', counts, tables, ...over.top };
}
const clone = o => JSON.parse(JSON.stringify(o));

test('a valid backup passes', () => {
  assert.deepEqual(B.validateBackup(backup()), { ok: true, errors: [] });
});

test('refuses other files, unknown versions, duplicates and truncated files', () => {
  assert.equal(B.validateBackup({ hello: 1 }).ok, false);
  assert.equal(B.validateBackup(backup({ top: { schemaVersion: 7 } })).ok, false);

  const dup = backup();
  dup.tables.entries.push(clone(dup.tables.entries[0]));
  dup.counts.entries = 3;
  assert.match(B.validateBackup(dup).errors.join(), /dubbel/);

  const cut = backup();
  cut.counts.entries = 5;
  assert.match(B.validateBackup(cut).errors.join(), /onvolledig/);
});

test('compare: identical backups are equal in every table', () => {
  const r = B.compareBackups(backup(), backup());
  for (const t of B.TABLES) assert.equal(r[t].identical, true, t);
});

test('compare: a new column in "after" does not count', () => {
  const after = backup();
  after.tables.customers[0].active = true;
  after.tables.customers[0].inactive_since = null;
  assert.equal(B.compareBackups(backup(), after).customers.identical, true);
});

test('compare: changed, missing and added rows are reported', () => {
  const after = backup();
  after.tables.entries[0].minutes = 60;          // changed
  after.tables.entries.splice(1, 1);             // e2 missing
  after.tables.entries.push({ ...clone(after.tables.entries[0]), id: 'e3' }); // added
  const r = B.compareBackups(backup(), after).entries;
  assert.deepEqual(r.changed.map(c => [c.key, c.cols]), [['e1', ['minutes']]]);
  assert.deepEqual(r.missing.map(x => x.id), ['e2']);
  assert.deepEqual(r.added.map(x => x.id), ['e3']);
  assert.equal(r.identical, false);
});

test('restore SQL: one transaction, guard, check, quotes doubled', () => {
  const sql = B.buildRestoreSql(backup(), { now: 'X' });
  assert.ok(sql.indexOf('begin;') < sql.indexOf('delete from public.entries'));
  assert.ok(sql.indexOf('delete from public.entries') < sql.indexOf('$check$'));
  assert.ok(sql.indexOf('$check$') < sql.indexOf('commit;'));
  assert.match(sql, /schema_migrations/);
  // The customer name with a quote ends up doubled inside the one JSON literal.
  assert.match(sql, /Bakkerij ''t Hoekje/);
  // Every single quote inside the payload literal is doubled: strip the doubled ones, none may remain.
  const payload = sql.split('insert into jatl_restore values (')[1].split('::jsonb);')[0];
  assert.equal(payload.slice(1, -1).replace(/''/g, '').includes("'"), false);
});

test('restore SQL: refuses an invalid backup or schema name', () => {
  assert.throws(() => B.buildRestoreSql({ app: 'nope' }));
  assert.throws(() => B.buildRestoreSql(backup(), { schema: 'public; drop table x' }));
});

test('sqlLiteral doubles quotes and leaves backslashes', () => {
  assert.equal(B.sqlLiteral("a'b\\c"), "'a''b\\c'");
});

test('CSV: every field quoted, quotes doubled, formulas neutralised', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'data-service.js'), 'utf8');
  const ctx = { window: { supabase: { createClient: () => ({}) } }, localStorage: {}, location: { hostname: 'x', host: 'x' } };
  vm.createContext(ctx);
  vm.runInContext(src + '\nthis.DataService = DataService;', ctx);
  const f = ctx.DataService.csvField;
  assert.equal(f('Jansen, Piet'), '"Jansen, Piet"');
  assert.equal(f('zei "ja"'), '"zei ""ja"""');
  assert.equal(f('=SUM(A1)'), `"'=SUM(A1)"`);
  assert.equal(f('-5'), `"'-5"`);
  assert.equal(f('@x'), `"'@x"`);
  assert.equal(f(null), '""');
  assert.equal(f(90), '"90"');
});

test('environment: no banner on the live address, red warning anywhere else', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'data-service.js'), 'utf8');
  const kindOn = (hostname, host = hostname, protocol = 'https:') => {
    const ctx = { window: { supabase: { createClient: () => ({}) } }, localStorage: {}, location: { hostname, host, protocol } };
    vm.createContext(ctx);
    vm.runInContext(src + '\nthis.DataService = DataService;', ctx);
    return ctx.DataService.environment.kind;
  };
  assert.equal(kindOn('orvillebe.github.io'), 'live');
  assert.equal(kindOn('localhost', 'localhost:8000'), 'elsewhere');
  assert.equal(kindOn('', '', 'file:'), 'elsewhere');
});
