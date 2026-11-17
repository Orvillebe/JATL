# JATL - Just A Time Logger

Minimal time logging for small teams. Static site, no build step required.

## Features

- Log hours per client / project / phase
- Weekly overview per person
- Reports with filters (period, client, project, person, phase)
- CSV export
- Authentication (only invited users can access)

## Setup

### 1. Database

The app expects a backend matching the schema in `schema.sql`. The default is Supabase (free tier is sufficient), but you can use any PostgreSQL-compatible backend by replacing `data-service.js`.

**Supabase setup:**

- Create a free project on [supabase.com](https://supabase.com)
- Enable **Data API** and **Automatic RLS** during creation
- Go to SQL Editor, paste the contents of `schema.sql`, click Run
- Go to Settings > API and copy your **Project URL** and **anon public key**

### 2. Users

Supabase Auth manages user accounts. Self-registration is disabled by design.

- Go to Authentication > Sign In / Providers > disable **Allow new users to sign up**
- Go to Authentication > Users > **Create a new user** (email + temporary password)
- Share the credentials with your team member 
- A profile is automatically created on first login

### 3. App

- Fork or clone this repo
- Replace the placeholder URL and anon key in `data-service.js`
- Host the files wherever you like (e.g. GitHub Pages, Netlify, Cloudflare Pages, or just open locally in a browser)

### 4. Usage

- Open the URL in your browser and log in
- Add clients, projects and optionally phases via Manage
- Log hours via Register

## Backup and restore

The Supabase free plan makes **no backups you can restore yourself**. The backup file is the only safety net, so keep it outside Supabase.

- **Backup:** Manage > *Backup downloaden*. One JSON file with every table (members, customers, projects, phases, entries) and the schema version. Every signed-in user can read every table, so any user's backup is complete. Take one before every release.
- **Restore:** open `tools/restore.html` in a browser (works offline, sends nothing). Give it the backup to restore **and** a fresh backup of now. It shows per table what comes back and what gets lost, then makes SQL to paste in the Supabase SQL Editor. The SQL is one transaction, counts everything afterwards and rolls back if a count is off. Members are updated, never deleted; in a new Supabase project they are matched to logins by e-mail, and a member without a login is skipped and reported.
- **Check:** open `tools/compare.html` and drop two backups (before and after). Per table you see the counts and whether every old row is unchanged in every old column. New columns do not count.

The restore only accepts schema version 0 (the current `schema.sql`). Release 2 adds migrations and extends it.

## Testing

- `node --test tests/*.test.js` - backup, compare, restore SQL and CSV quoting.
- `node tests/mock/serve.js`, then open http://localhost:5174 - the full app with an in-memory mock (`tests/mock/mock-data-service.js`) instead of Supabase. 1400+ entries and names with `< & " '`. In the browser console, `MOCK.failAfter = 1` makes the second next write fail, to see how the app handles a dropped connection. The real database is never contacted.

## Releasing

- Work on `dev`; `main` is what GitHub Pages serves, so merging to `main` is going live.
- Bump `?v=` in `index.html` (on `style.css`, `data-service.js` and `app.js`) so phones load the new files.
- Download a backup before merging.

## Files

- `index.html` - page structure
- `style.css` - styling
- `app.js` - UI logic (Helpers, Register, Report, Manage, App)
- `data-service.js` - data layer (replaceable), backup and CSV export
- `schema.sql` - database schema
- `tools/` - restore and compare pages, `backup-core.js` with their logic
- `tests/` - node tests and the mock server

## Security

- Only invited users can log in (self-registration disabled)
- Row Level Security on all tables
- Everyone can read all entries (for reports), but can only create/edit/delete their own
- Clients, projects and phases are shared and editable by all authenticated users
- The anon key in the code is safe to publish (RLS enforces all access rules)
- The Supabase client is loaded at a fixed version with an integrity hash; the browser refuses any other file
- Every name, note and phase is escaped before it is shown

### Known limits (fixed in release 2)

- Deleting a customer or project also deletes every entry on it, for everyone (`on delete cascade`). The confirm dialog shows how many.
- Editing hours is "add new, then remove old" in separate requests, not one transaction. On failure the app takes back what it added, so nothing is lost, but if even that fails you may see an hour twice.
- Any login in the Supabase project can read and write everything.

## Roadmap

- [ ] Password change for users
- [ ] PWA (installable on phone)
