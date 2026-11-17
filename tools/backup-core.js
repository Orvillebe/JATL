/**
 * JATL backup core - pure functions shared by restore.html and compare.html
 *
 * Responsibilities:
 *   - Check that a file is a JATL backup this code understands (validateBackup)
 *   - Compare two backups table by table (compareBackups)
 *   - Build the restore SQL to paste into the Supabase SQL Editor (buildRestoreSql)
 *
 * No DOM, no network: runs in the browser (window.JatlBackup) and in node (tests).
 * The backup itself is made by DataService.exportBackup() in data-service.js.
 */

(function (root) {
  // Primary key per table. Rows are matched on this when comparing.
  const KEYS = { members: 'id', customers: 'id', projects: 'id', phases: 'name', entries: 'id' };
  const TABLES = Object.keys(KEYS);

  // Schema versions this restore can write to. 0 = schema.sql before migrations/.
  const SUPPORTED_VERSIONS = [0];

  function validateBackup(b) {
    const errors = [];
    if (!b || typeof b !== 'object') return { ok: false, errors: ['Geen JSON-object.'] };
    if (b.app !== 'JATL' || b.kind !== 'backup') errors.push('Dit is geen JATL-backup.');
    if (!SUPPORTED_VERSIONS.includes(b.schemaVersion)) {
      errors.push(`Schemaversie ${b.schemaVersion} wordt door deze tool niet ondersteund.`);
    }
    if (!b.tables || typeof b.tables !== 'object') {
      errors.push('De tabellen ontbreken.');
    } else {
      for (const t of TABLES) {
        const rows = b.tables[t];
        if (!Array.isArray(rows)) { errors.push(`Tabel ${t} ontbreekt.`); continue; }
        const key = KEYS[t];
        const seen = new Set();
        rows.forEach((r, i) => {
          if (!r || r[key] === undefined || r[key] === null) errors.push(`${t}, rij ${i + 1}: geen ${key}.`);
          else if (seen.has(r[key])) errors.push(`${t}: ${key} ${r[key]} staat er dubbel in.`);
          else seen.add(r[key]);
        });
        if (b.counts && b.counts[t] !== rows.length) {
          errors.push(`${t}: het bestand meldt ${b.counts[t]} rijen maar bevat er ${rows.length}. Het bestand is mogelijk onvolledig.`);
        }
      }
    }
    // Postgres jsonb cannot store the NUL character; refuse instead of failing halfway.
    if (JSON.stringify(b).includes('\\u0000')) errors.push('Het bestand bevat een NUL-teken, dat de database niet aanvaardt.');
    return { ok: errors.length === 0, errors: errors.slice(0, 20) };
  }

  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  // Compare two backups. Only the columns of the "before" row count, so new columns added
  // by a migration do not show up as differences.
  function compareBackups(before, after) {
    const result = {};
    for (const t of TABLES) {
      const key = KEYS[t];
      const a = new Map((before.tables[t] || []).map(r => [r[key], r]));
      const b = new Map((after.tables[t] || []).map(r => [r[key], r]));
      const changed = [], missing = [], added = [];
      let equal = 0;
      for (const [k, ra] of a) {
        const rb = b.get(k);
        if (!rb) { missing.push(ra); continue; }
        const cols = Object.keys(ra).filter(c => !same(ra[c], rb[c]));
        if (cols.length) changed.push({ key: k, cols, before: ra, after: rb });
        else equal++;
      }
      for (const [k, rb] of b) if (!a.has(k)) added.push(rb);
      result[t] = {
        before: a.size, after: b.size, equal, changed, missing, added,
        identical: changed.length === 0 && missing.length === 0 && added.length === 0
      };
    }
    return result;
  }

  // SQL string literal: single quotes doubled. standard_conforming_strings is on in Postgres,
  // so backslashes need no escaping.
  const sqlLiteral = s => `'${String(s).replace(/'/g, "''")}'`;

  // Build the restore script. One transaction: if any step fails, nothing changes.
  // schema is 'public' for now; release 2 adds 'test' with its own guard.
  function buildRestoreSql(backup, { schema = 'public', now = new Date().toISOString() } = {}) {
    const v = validateBackup(backup);
    if (!v.ok) throw new Error(v.errors.join(' '));
    if (!/^[a-z_]+$/.test(schema)) throw new Error('Ongeldige schemanaam.');

    const payload = sqlLiteral(JSON.stringify({ schemaVersion: backup.schemaVersion, tables: backup.tables }));
    const S = schema;
    const c = backup.tables;

    return `-- =====================================================================
-- JATL restore
-- Gemaakt:     ${now} met tools/restore.html
-- Backup van:  ${backup.createdAt || '?'} door ${backup.createdBy || '?'}
-- Bron:        ${backup.source || '?'}
-- Doel:        schema ${S}
--
-- Wat dit doet:
--   - Vervangt ALLE klanten, projecten, fases en registraties door die uit de backup.
--     Registraties die na de backup gemaakt zijn, verdwijnen.
--   - Leden worden bijgewerkt (naam, e-mail), nooit verwijderd. Een lid wordt gekoppeld aan
--     een login via id, of anders via e-mailadres. Een lid zonder login wordt overgeslagen,
--     samen met zijn registraties, en onderaan gemeld.
--   - Na het terugzetten telt het script alles na. Klopt een aantal niet, dan wordt
--     alles teruggedraaid en verandert er niets.
--
-- In de backup: ${c.customers.length} klanten, ${c.projects.length} projecten, ${c.phases.length} fases,
--               ${c.members.length} leden, ${c.entries.length} registraties.
-- =====================================================================

begin;

-- 1. Controle: deze restore is voor schemaversie ${backup.schemaVersion}.
do $guard$
begin
  if to_regclass('${S}.schema_migrations') is not null then
    raise exception 'Deze database heeft al migraties. Deze restore is gemaakt voor schemaversie ${backup.schemaVersion}. Er is niets veranderd.';
  end if;
end
$guard$;

-- 2. De backup als tijdelijke tabel (verdwijnt als de sessie sluit).
drop table if exists pg_temp.jatl_restore;
create temp table jatl_restore (j jsonb);
insert into jatl_restore values (${payload}::jsonb);

-- 3. Leden koppelen aan logins: eerst op id, anders op e-mailadres.
drop table if exists pg_temp.jatl_restore_members;
create temp table jatl_restore_members as
select b.id as old_id, coalesce(u1.id, u2.id) as new_id, b.name, b.email, b.created_at
from jatl_restore r
cross join lateral jsonb_to_recordset(r.j->'tables'->'members')
  as b(id uuid, name text, email text, created_at timestamptz)
left join auth.users u1 on u1.id = b.id
left join auth.users u2 on u1.id is null and lower(u2.email) = lower(b.email);

-- 4. Huidige data weg (registraties eerst, dan wat ze nodig hebben).
delete from ${S}.entries where true;
delete from ${S}.projects where true;
delete from ${S}.customers where true;
delete from ${S}.phases where true;

-- 5. Terugzetten.
insert into ${S}.members (id, name, email, created_at)
select new_id, name, email, created_at from jatl_restore_members where new_id is not null
on conflict (id) do update set name = excluded.name, email = excluded.email;

insert into ${S}.customers (id, name, created_at)
select x.id, x.name, x.created_at
from jatl_restore r
cross join lateral jsonb_to_recordset(r.j->'tables'->'customers')
  as x(id text, name text, created_at timestamptz);

insert into ${S}.projects (id, customer_id, name, created_at)
select x.id, x.customer_id, x.name, x.created_at
from jatl_restore r
cross join lateral jsonb_to_recordset(r.j->'tables'->'projects')
  as x(id text, customer_id text, name text, created_at timestamptz);

insert into ${S}.phases (name)
select x.name
from jatl_restore r
cross join lateral jsonb_to_recordset(r.j->'tables'->'phases') as x(name text);

insert into ${S}.entries (id, member_id, customer_id, project_id, phase, date, minutes, note, created_at)
select x.id, m.new_id, x.customer_id, x.project_id, coalesce(x.phase, ''), x.date, x.minutes, coalesce(x.note, ''), x.created_at
from jatl_restore r
cross join lateral jsonb_to_recordset(r.j->'tables'->'entries')
  as x(id text, member_id uuid, customer_id text, project_id text, phase text, date date, minutes integer, note text, created_at timestamptz)
join jatl_restore_members m on m.old_id = x.member_id and m.new_id is not null;

-- 6. Natellen. Klopt iets niet, dan wordt alles teruggedraaid.
do $check$
declare
  r jsonb := (select j from jatl_restore);
  expected_entries bigint;
begin
  if (select count(*) from ${S}.customers) <> jsonb_array_length(r->'tables'->'customers') then
    raise exception 'Klanten: aantal klopt niet. Er is niets veranderd.';
  end if;
  if (select count(*) from ${S}.projects) <> jsonb_array_length(r->'tables'->'projects') then
    raise exception 'Projecten: aantal klopt niet. Er is niets veranderd.';
  end if;
  if (select count(*) from ${S}.phases) <> jsonb_array_length(r->'tables'->'phases') then
    raise exception 'Fases: aantal klopt niet. Er is niets veranderd.';
  end if;
  select count(*) into expected_entries
  from jsonb_to_recordset(r->'tables'->'entries') as x(member_id uuid)
  join jatl_restore_members m on m.old_id = x.member_id and m.new_id is not null;
  if (select count(*) from ${S}.entries) <> expected_entries then
    raise exception 'Registraties: aantal klopt niet. Er is niets veranderd.';
  end if;
end
$check$;

commit;

-- 7. Verslag.
select 'klanten' as wat, count(*) as aantal from ${S}.customers
union all select 'projecten', count(*) from ${S}.projects
union all select 'fases', count(*) from ${S}.phases
union all select 'registraties', count(*) from ${S}.entries
union all select 'leden overgeslagen (geen login gevonden)', count(*) from jatl_restore_members where new_id is null
union all select 'registraties overgeslagen (lid zonder login)', count(*)
  from jatl_restore r
  cross join lateral jsonb_to_recordset(r.j->'tables'->'entries') as x(member_id uuid)
  join jatl_restore_members m on m.old_id = x.member_id and m.new_id is null;
`;
  }

  const api = { KEYS, TABLES, SUPPORTED_VERSIONS, validateBackup, compareBackups, sqlLiteral, buildRestoreSql };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JatlBackup = api;
})(typeof window !== 'undefined' ? window : globalThis);
