/**
 * JATL mock data service - same API as data-service.js, data in memory.
 *
 * Responsibilities:
 *   - Let the front-end run without Supabase (served by tests/mock/serve.js in place of data-service.js)
 *   - Seed believable data with edge cases: names with < & " ', a long name, 1200+ entries
 *   - Simulate failures: in the console, set MOCK.failAfter = n to make the n-th next write throw
 *
 * Never talks to a database. Reload the page to start from the seed again.
 */

const JATL_SCHEMA_VERSION = 0;

const MOCK = (() => {
  const me = '11111111-1111-1111-1111-111111111111';
  const vin = '22222222-2222-2222-2222-222222222222';
  const db = {
    members: [
      { id: me, name: 'An', email: 'an@example.com', created_at: '2026-01-05T09:00:00Z' },
      { id: vin, name: 'Vincent', email: 'vincent@example.com', created_at: '2026-01-05T09:00:00Z' }
    ],
    customers: [
      { id: 'c1', name: 'Bakkerij <b>Vet</b> & Zonen', created_at: '2026-01-06T09:00:00Z' },
      { id: 'c2', name: "Brouwerij 't Fluitje", created_at: '2026-01-06T09:00:00Z' },
      { id: 'c3', name: 'Stad "Gent" — dienst Stedenbouw en Ruimtelijke Planning, afdeling Publieke Ruimte', created_at: '2026-01-06T09:00:00Z' }
    ],
    projects: [
      { id: 'p1', customer_id: 'c1', name: 'Website <img src=x onerror=alert(1)>', created_at: '2026-01-07T09:00:00Z' },
      { id: 'p2', customer_id: 'c2', name: 'Etiket, nieuwe reeks', created_at: '2026-01-07T09:00:00Z' },
      { id: 'p3', customer_id: 'c3', name: 'Participatietraject', created_at: '2026-01-07T09:00:00Z' }
    ],
    phases: [{ name: 'Ontwerp' }, { name: 'R&D "fase 1"' }],
    entries: []
  };
  // ~1300 entries over the past year for both members, so paging/limits and totals get exercised.
  let n = 0;
  const today = new Date();
  for (let d = 0; d < 330; d++) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - d);
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    for (const [m, k] of [[me, 0], [vin, 1], [me, 2], [vin, 3], [me, 4], [vin, 5]]) {
      const p = db.projects[(d + k) % 3];
      db.entries.push({
        id: `e${++n}`, member_id: m, customer_id: p.customer_id, project_id: p.id,
        phase: k % 2 ? 'Ontwerp' : '', date, minutes: 30 + ((d * 7 + k * 13) % 8) * 15,
        note: k === 2 ? '=SOM(A1) <script>alert("x")</script>' : (k === 4 ? 'Overleg, "dringend"' : ''),
        created_at: `${date}T1${k}:00:00Z`
      });
    }
  }
  return { me, db, failAfter: null, writes: 0 };
})();

const DataService = (() => {
  const db = MOCK.db;
  const uid = () => 'm' + Math.random().toString(36).slice(2, 10);
  const wait = () => new Promise(r => setTimeout(r, 40));
  async function write() {
    await wait();
    if (MOCK.failAfter !== null) {
      if (MOCK.failAfter <= 0) { MOCK.failAfter = null; const e = new Error('MOCK: verbinding weg'); throw e; }
      MOCK.failAfter--;
    }
    MOCK.writes++;
  }
  const mapEntry = r => ({ id: r.id, memberId: r.member_id, customerId: r.customer_id, projectId: r.project_id,
    phase: r.phase, date: r.date, minutes: r.minutes, note: r.note || '', createdAt: r.created_at });
  const byName = (a, b) => a.name.localeCompare(b.name);

  let listener = null;
  const session = { user: { id: MOCK.me, email: 'an@example.com' } };

  return {
    async signIn() { listener && listener(session); return { session }; },
    async signOut() { listener && listener(null); },
    async getSession() { return session; },
    onAuthStateChange(cb) { listener = cb; },

    async getMembers() { return [...db.members].sort(byName).map(r => ({ id: r.id, name: r.name, email: r.email })); },
    async updateMemberName(name) { await write(); db.members.find(m => m.id === MOCK.me).name = name; },

    async getCustomers() { return [...db.customers].sort(byName).map(r => ({ id: r.id, name: r.name })); },
    async addCustomer(name) { await write(); const r = { id: uid(), name, created_at: new Date().toISOString() }; db.customers.push(r); return { id: r.id, name }; },
    async removeCustomer(id) {
      await write();
      db.entries = db.entries.filter(e => e.customer_id !== id);
      db.projects = db.projects.filter(p => p.customer_id !== id);
      db.customers = db.customers.filter(c => c.id !== id);
    },

    async getProjects() { return [...db.projects].sort(byName).map(r => ({ id: r.id, customerId: r.customer_id, name: r.name })); },
    async getProjectsByCustomer(cid) { return (await this.getProjects()).filter(p => p.customerId === cid); },
    async addProject(customerId, name) { await write(); const r = { id: uid(), customer_id: customerId, name, created_at: new Date().toISOString() }; db.projects.push(r); return { id: r.id, customerId, name }; },
    async removeProject(id) { await write(); db.entries = db.entries.filter(e => e.project_id !== id); db.projects = db.projects.filter(p => p.id !== id); },

    async getPhases() { return db.phases.map(p => p.name).sort(); },
    async addPhase(name) { await write(); db.phases.push({ name }); },
    async removePhase(name) { await write(); db.phases = db.phases.filter(p => p.name !== name); },

    async getEntries(f = {}) {
      await wait();
      return db.entries.filter(e =>
        (!f.memberId || e.member_id === f.memberId) && (!f.customerId || e.customer_id === f.customerId) &&
        (!f.projectId || e.project_id === f.projectId) && (!f.phase || e.phase === f.phase) &&
        (!f.dateFrom || e.date >= f.dateFrom) && (!f.dateTo || e.date <= f.dateTo)
      ).sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)).map(mapEntry);
    },
    async addEntry(x) {
      await write();
      const r = { id: uid(), member_id: x.memberId, customer_id: x.customerId, project_id: x.projectId, phase: x.phase || '',
        date: x.date, minutes: x.minutes, note: x.note || '', created_at: new Date().toISOString() };
      db.entries.push(r); return mapEntry(r);
    },
    async updateEntry() { throw new Error('not used'); },
    async removeEntry(id) { await write(); db.entries = db.entries.filter(e => e.id !== id); },

    getRecentProject() { try { return JSON.parse(localStorage.getItem('jatl_mock_recent')) || null; } catch { return null; } },
    setRecentProject(v) { try { localStorage.setItem('jatl_mock_recent', JSON.stringify(v)); } catch {} },

    csvField(v) { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; },
    async exportCSV(f = {}) {
      const es = await this.getEntries(f);
      return ['Datum,Persoon,Klant,Project,Fase,Uren,Minuten,Notitie', ...es.map(e => [e.date,
        db.members.find(m => m.id === e.memberId)?.name, db.customers.find(c => c.id === e.customerId)?.name,
        db.projects.find(p => p.id === e.projectId)?.name, e.phase, `${Math.floor(e.minutes / 60)}:${String(e.minutes % 60).padStart(2, '0')}`,
        e.minutes, e.note].map(this.csvField).join(','))].join('\n');
    },
    async exportBackup() {
      await wait();
      const tables = JSON.parse(JSON.stringify(db));
      return { app: 'JATL', kind: 'backup', schemaVersion: JATL_SCHEMA_VERSION, createdAt: new Date().toISOString(),
        createdBy: 'an@example.com', source: 'mock', counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])), tables };
    }
  };
})();
