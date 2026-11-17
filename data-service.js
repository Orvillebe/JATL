/**
 * JATL Data Service - Supabase implementation with Auth
 *
 * Responsibilities:
 *   - All reads and writes to the database (app.js never talks to Supabase directly)
 *   - Paging past the 1000-row limit of the Supabase API (fetchAll)
 *   - Backup export (all tables as JSON) and CSV export
 *
 * Replace the two values below with your Supabase project details.
 * Find them at: Supabase Dashboard > Settings > API
 */

// Schema version this code expects. 0 = schema.sql as it was before migrations/.
// A backup carries this number; tools/restore.html refuses a mismatch.
const JATL_SCHEMA_VERSION = 0;

const SUPABASE_URL = 'https://pqbxqsunkbuvxlvvjbnp.supabase.co';       // e.g. https://xxxxx.supabase.co
const SUPABASE_ANON_KEY = 'sb_publishable_P_C445o2GHbvR1rYnJFPBQ_6DRvQBF8';       // e.g. eyJhbGciOi...

const DataService = (() => {
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // The Supabase API returns at most 1000 rows per request (project setting "Max rows").
  // fetchAll keeps asking for the next page until a page comes back short.
  // makeQuery must build a fresh, fully ordered query each time (end the order on a unique column).
  const PAGE = 1000;
  async function fetchAll(makeQuery) {
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await makeQuery().range(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...data);
      if (data.length < PAGE) return rows;
    }
  }

  // =====================
  // AUTH
  // =====================

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  async function getSession() {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
  }

  function onAuthStateChange(callback) {
    supabase.auth.onAuthStateChange((_event, session) => {
      callback(session);
    });
  }

  // =====================
  // MEMBERS
  // =====================

  async function getMembers() {
    const { data, error } = await supabase.from('members').select('*').order('name');
    if (error) throw error;
    return data.map(r => ({ id: r.id, name: r.name, email: r.email }));
  }

  async function updateMemberName(name) {
    const session = await getSession();
    if (!session) throw new Error('Not authenticated');
    const { error } = await supabase.from('members')
      .update({ name })
      .eq('id', session.user.id);
    if (error) throw error;
  }

  // =====================
  // CUSTOMERS
  // =====================

  async function getCustomers() {
    const { data, error } = await supabase.from('customers').select('*').order('name');
    if (error) throw error;
    return data.map(r => ({ id: r.id, name: r.name }));
  }

  async function addCustomer(name) {
    const { data, error } = await supabase.from('customers').insert({ name }).select();
    if (error) throw error;
    return { id: data[0].id, name: data[0].name };
  }

  async function removeCustomer(id) {
    const { error } = await supabase.from('customers').delete().eq('id', id);
    if (error) throw error;
  }

  // =====================
  // PROJECTS
  // =====================

  async function getProjects() {
    const { data, error } = await supabase.from('projects').select('*').order('name');
    if (error) throw error;
    return data.map(r => ({ id: r.id, customerId: r.customer_id, name: r.name }));
  }

  async function getProjectsByCustomer(customerId) {
    const { data, error } = await supabase.from('projects')
      .select('*').eq('customer_id', customerId).order('name');
    if (error) throw error;
    return data.map(r => ({ id: r.id, customerId: r.customer_id, name: r.name }));
  }

  async function addProject(customerId, name) {
    const { data, error } = await supabase.from('projects')
      .insert({ customer_id: customerId, name }).select();
    if (error) throw error;
    return { id: data[0].id, customerId: data[0].customer_id, name: data[0].name };
  }

  async function removeProject(id) {
    const { error } = await supabase.from('projects').delete().eq('id', id);
    if (error) throw error;
  }

  // =====================
  // PHASES
  // =====================

  async function getPhases() {
    const { data, error } = await supabase.from('phases').select('name').order('name');
    if (error) throw error;
    return data.map(r => r.name);
  }

  async function addPhase(name) {
    const { error } = await supabase.from('phases').insert({ name });
    if (error) throw error;
  }

  async function removePhase(name) {
    const { error } = await supabase.from('phases').delete().eq('name', name);
    if (error) throw error;
  }

  // =====================
  // ENTRIES
  // =====================

  async function getEntries(filters = {}) {
    const data = await fetchAll(() => {
      let q = supabase.from('entries').select('*');

      if (filters.memberId) q = q.eq('member_id', filters.memberId);
      if (filters.customerId) q = q.eq('customer_id', filters.customerId);
      if (filters.projectId) q = q.eq('project_id', filters.projectId);
      if (filters.phase) q = q.eq('phase', filters.phase);
      if (filters.dateFrom) q = q.gte('date', filters.dateFrom);
      if (filters.dateTo) q = q.lte('date', filters.dateTo);

      // id last, so paging is stable when date and created_at are equal
      return q.order('date', { ascending: false }).order('created_at', { ascending: false }).order('id');
    });

    return data.map(r => ({
      id: r.id,
      memberId: r.member_id,
      customerId: r.customer_id,
      projectId: r.project_id,
      phase: r.phase,
      date: r.date,
      minutes: r.minutes,
      note: r.note || '',
      createdAt: r.created_at
    }));
  }

  async function addEntry({ memberId, customerId, projectId, phase, date, minutes, note }) {
    const { data, error } = await supabase.from('entries').insert({
      member_id: memberId,
      customer_id: customerId,
      project_id: projectId,
      phase: phase || '',
      date, minutes,
      note: note || ''
    }).select();
    if (error) throw error;
    const r = data[0];
    return {
      id: r.id, memberId: r.member_id, customerId: r.customer_id,
      projectId: r.project_id, phase: r.phase, date: r.date,
      minutes: r.minutes, note: r.note, createdAt: r.created_at
    };
  }

  async function updateEntry(id, updates) {
    const dbUpdates = {};
    if (updates.minutes !== undefined) dbUpdates.minutes = updates.minutes;
    if (updates.note !== undefined) dbUpdates.note = updates.note;
    if (updates.phase !== undefined) dbUpdates.phase = updates.phase;

    const { data, error } = await supabase.from('entries')
      .update(dbUpdates).eq('id', id).select();
    if (error) throw error;
    const r = data[0];
    return {
      id: r.id, memberId: r.member_id, customerId: r.customer_id,
      projectId: r.project_id, phase: r.phase, date: r.date,
      minutes: r.minutes, note: r.note, createdAt: r.created_at
    };
  }

  async function removeEntry(id) {
    const { error } = await supabase.from('entries').delete().eq('id', id);
    if (error) throw error;
  }

  // =====================
  // REPORTING
  // =====================

  async function getReport(filters = {}) {
    const entries = await getEntries(filters);
    const members = await getMembers();
    const customers = await getCustomers();
    const projects = await getProjects();

    const totalMinutes = entries.reduce((sum, e) => sum + e.minutes, 0);

    const byMember = {};
    const byProject = {};
    const byPhase = {};
    const byCustomer = {};

    for (const e of entries) {
      byMember[e.memberId] = (byMember[e.memberId] || 0) + e.minutes;
      byProject[e.projectId] = (byProject[e.projectId] || 0) + e.minutes;
      byPhase[e.phase] = (byPhase[e.phase] || 0) + e.minutes;
      byCustomer[e.customerId] = (byCustomer[e.customerId] || 0) + e.minutes;
    }

    const resolve = (map, list) =>
      Object.entries(map).map(([id, minutes]) => ({
        id,
        name: (list.find(x => x.id === id) || {}).name || 'Onbekend',
        minutes
      })).sort((a, b) => b.minutes - a.minutes);

    return {
      totalMinutes,
      entries: entries.length,
      byMember: resolve(byMember, members),
      byProject: resolve(byProject, projects),
      byPhase: Object.entries(byPhase).map(([phase, minutes]) => ({ phase, minutes })),
      byCustomer: resolve(byCustomer, customers)
    };
  }

  // =====================
  // LOCAL PREFERENCES (always localStorage)
  // =====================

  function getRecentProject() {
    try {
      return JSON.parse(localStorage.getItem('jatl_recent_project')) || null;
    } catch { return null; }
  }

  function setRecentProject({ customerId, projectId, phase }) {
    localStorage.setItem('jatl_recent_project', JSON.stringify({ customerId, projectId, phase }));
  }

  // =====================
  // EXPORT
  // =====================

  // Backup: every table, raw database rows (snake_case), so restore.html can put them back as they were.
  // Every signed-in user can read every table (see schema.sql), so any user's backup is complete.
  async function exportBackup() {
    const tables = {
      members:   await fetchAll(() => supabase.from('members').select('*').order('id')),
      customers: await fetchAll(() => supabase.from('customers').select('*').order('id')),
      projects:  await fetchAll(() => supabase.from('projects').select('*').order('id')),
      phases:    await fetchAll(() => supabase.from('phases').select('*').order('name')),
      entries:   await fetchAll(() => supabase.from('entries').select('*').order('id'))
    };
    const session = await getSession();
    const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
    return {
      app: 'JATL',
      kind: 'backup',
      schemaVersion: JATL_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      createdBy: session?.user?.email || '',
      source: SUPABASE_URL,
      counts,
      tables
    };
  }

  // One CSV field: always quoted, quotes doubled, and a leading ' before = + - @
  // so Excel does not read the field as a formula.
  function csvField(v) {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  }

  async function exportCSV(filters = {}) {
    const entries = await getEntries(filters);
    const members = await getMembers();
    const customers = await getCustomers();
    const projects = await getProjects();

    const header = 'Datum,Persoon,Klant,Project,Fase,Uren,Minuten,Notitie';
    const rows = entries.map(e => {
      const member = members.find(m => m.id === e.memberId)?.name || '';
      const customer = customers.find(c => c.id === e.customerId)?.name || '';
      const project = projects.find(p => p.id === e.projectId)?.name || '';
      const h = Math.floor(e.minutes / 60);
      const m = e.minutes % 60;
      return [e.date, member, customer, project, e.phase, `${h}:${String(m).padStart(2,'0')}`, e.minutes, e.note]
        .map(csvField).join(',');
    });

    return [header, ...rows].join('\n');
  }

  // =====================
  // PUBLIC API
  // =====================

  return {
    signIn, signOut, getSession, onAuthStateChange,
    getMembers, updateMemberName,
    getCustomers, addCustomer, removeCustomer,
    getProjects, getProjectsByCustomer, addProject, removeProject,
    getPhases, addPhase, removePhase,
    getEntries, addEntry, updateEntry, removeEntry,
    getReport,
    getRecentProject, setRecentProject,
    exportCSV, exportBackup, csvField
  };
})();
