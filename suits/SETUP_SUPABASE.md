# Supabase Setup — Manual Steps

This guide picks up where the code leaves off. Everything in the repo is ready;
you just need to create the Supabase project, paste the schema, and drop four
values into `.env` files. The whole thing takes ~15 minutes.

---

## 1. Create the project

1. Go to <https://supabase.com> → **New Project**.
2. Region: **Mumbai** (lowest latency from India).
3. Save the database password in a password manager — you'll rarely need it,
   but if you lose it, rotating is annoying.

---

## 2. Apply the schema

1. In the Supabase dashboard → **SQL Editor** → **New query**.
2. Open `suits/backend/supabase_schema.sql` in this repo.
3. Copy the **entire file** into the SQL editor and click **Run**.
4. You should see `Success. No rows returned.` Re-running is safe — every
   statement is idempotent.

**Verify RLS is on** — in the SQL editor, run:

```sql
select tablename, rowsecurity
from pg_tables where schemaname = 'public';
```

Every row should show `rowsecurity = true`.

---

## 3. Create the Storage bucket

1. Sidebar → **Storage** → **New bucket**.
2. Name: **`documents`** (must match exactly — the SQL policies reference this name).
3. **Public bucket: OFF** (files are only accessible to their owner via signed URLs).
4. Click **Create**.

The storage policies in the schema already target this bucket by name, so you
don't need to create any policies manually.

---

## 4. Configure auth providers

### Email/password

1. Sidebar → **Authentication** → **Providers** → **Email**.
2. For local dev, **toggle "Confirm email" OFF** — otherwise signups hang
   waiting for a confirmation click. Turn it back on before production.
3. Save.

### Google OAuth (optional but recommended)

1. Sidebar → **Authentication** → **Providers** → **Google** → **Enabled**.
2. Follow Supabase's inline instructions to create an OAuth client in Google
   Cloud Console. The redirect URL Supabase gives you goes into the Google
   Cloud client settings.
3. Paste the Client ID + Client Secret back into Supabase and save.

### Site URL & redirect URLs

Sidebar → **Authentication** → **URL Configuration**:
- **Site URL**: `http://localhost:5173` for dev (add your production domain later).
- **Redirect URLs**: add `http://localhost:5173/**` (with wildcard) and your
  production origin. This is what OAuth and email-confirm links will redirect to.

---

## 5. Grab the keys

Sidebar → **Settings** → **API**. You need four values:

| Key in Supabase UI | Env var | Goes in |
|---|---|---|
| Project URL | `SUPABASE_URL` | project root `.env` |
| `service_role` (secret) | `SUPABASE_SERVICE_ROLE_KEY` | project root `.env` (backend only — NEVER frontend) |
| JWT Secret (under "JWT Settings") | `SUPABASE_JWT_SECRET` | project root `.env` |
| Project URL | `VITE_SUPABASE_URL` | `suits/frontend/.env` |
| `anon` `public` | `VITE_SUPABASE_ANON_KEY` | `suits/frontend/.env` |

> ⚠️ The `service_role` key bypasses RLS. Treat it like a root password.
> If you ever ship it to the browser by accident, **rotate it immediately**
> in Settings → API.

---

## 6. Fill in `.env` files

### Project root `/Users/rishiselarka/Documents/suits/.env`

Open your existing `.env` (where `OPENROUTER_API_KEY` already lives) and add:

```
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJI...
SUPABASE_JWT_SECRET=your-jwt-secret-here
SUPABASE_STORAGE_BUCKET=documents
```

### Frontend `suits/frontend/.env` (create this file)

```
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJI...
```

A template already exists at `suits/frontend/.env.example`.

---

## 7. Install new dependencies

```bash
# Backend
cd suits/backend
../venv/bin/pip install -r requirements.txt

# Frontend
cd ../frontend
npm install
```

New packages: `supabase`, `PyJWT[crypto]` (backend); `@supabase/supabase-js` (frontend).

---

## 8. Test end-to-end

```bash
# From suits/frontend/
npm run dev:all
```

1. Open <http://localhost:5173>. You should see the **Login** screen
   (not the splash).
2. Click **Create an account** → enter name/email/password → **Create account**.
3. If "Confirm email" is off, you can immediately sign in. Otherwise check
   your inbox.
4. After login, you should be dropped into the existing splash/onboarding flow.
5. Verify the JWT is flowing: open DevTools → Network → trigger any API call
   → the request should have an `Authorization: Bearer eyJ...` header.
6. In Supabase dashboard → **Authentication** → **Users**: you should see
   your new user. **Table Editor** → **profiles**: a matching profile row
   should exist (created by the signup trigger).

---

## 9. Turn off dev-mode fallback (optional, for production)

The backend auth dependency returns a placeholder `DEV_USER_ID` when
`SUPABASE_JWT_SECRET` is empty. Once your `.env` is populated, this fallback
stops firing automatically — every protected endpoint enforces a real JWT.

There's nothing to toggle. Just don't ship with an empty `SUPABASE_JWT_SECRET`.

---

## What's next (deferred — not in this PR)

These were consciously left out of the auth PR to keep the diff reviewable:

- **Migrate `backend/storage.py`** from local files to Supabase Storage
  (`{user_id}/{document_id}_{filename}` path convention — storage policies
  are already in place).
- **Migrate `backend/database.py`** from SQLite to Postgres (tables are
  already created and RLS-protected).
- **Add `user_id`** to every row your endpoints currently write (upload,
  analyze, results, usage, payments).
- **One-time migration script** to move existing `data/*.json` into Postgres.

After auth is proven working end-to-end, tackle those one table at a time —
each is a small, testable change instead of a big rewrite.

---

## Troubleshooting

- **"Invalid authentication token"** on every request → the `SUPABASE_JWT_SECRET`
  in the backend `.env` doesn't match the one in Supabase. Copy it again
  from Settings → API → JWT Settings.
- **Signup works but no row in `profiles`** → the trigger failed. Check
  Supabase logs (Dashboard → Logs → Postgres Logs) for the `handle_new_user`
  function error. The schema file includes `on conflict (id) do nothing`,
  so re-signing up is safe.
- **OAuth redirects to `localhost:3000` instead of `5173`** → set the Site URL
  correctly in Authentication → URL Configuration.
- **CORS errors after deploying** → add your production origin to both
  Supabase's redirect URLs and the backend's `CORS_ORIGINS` env var.
