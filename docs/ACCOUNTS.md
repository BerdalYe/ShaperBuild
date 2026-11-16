# Setting up accounts (Supabase)

ShaperBuild's accounts and cloud designs run on a [Supabase](https://supabase.com)
project that you own. Until one is connected, the app works as before and
the account button explains that accounts are not set up.

## 1. Make the project

1. Sign up at supabase.com and click **New project**. Pick a name, a strong
   database password and a region close to your users (for Norway:
   *Stockholm* or *Frankfurt*).
2. When it is ready, open **SQL Editor → New query**, paste everything from
   [`supabase/schema.sql`](../supabase/schema.sql) and click **Run**. This
   makes the `projects` table, the private `projects` storage bucket, the
   rules that keep each user's designs to themselves, and `delete_account()`.

## 2. Sign-in settings

**Authentication → Sign In / Providers → Email**: leave *Enable Email
provider* on. *Confirm email* on means new users click a link in an email
before they can sign in (recommended); ShaperBuild tells them so.

**Google (optional):**

1. In Google Cloud Console make an OAuth client (type *Web application*)
   with the redirect URL Supabase shows under **Authentication → Providers →
   Google**.
2. Paste the client id and secret into Supabase and turn Google on.
3. Under **Authentication → URL Configuration → Redirect URLs** add
   `http://127.0.0.1:45840/auth/callback` (the app listens there for a
   moment while you sign in in your browser).

## 3. Connect the app

Open **Project Settings → API** and copy the **Project URL** and the
**anon public** key into [`electron/cloud-config.json`](../electron/cloud-config.json):

```json
{
  "url": "https://YOUR-PROJECT.supabase.co",
  "anonKey": "eyJ...",
  "google": true
}
```

Set `"google": false` if you skipped Google. The anon key is meant to be
public: the database rules from step 1 are what protect the data. Never put
the **service_role** key in the app.

Build or release the app as usual; every copy then has accounts.

## Good to know

- **Costs:** the free plan holds 1 GB of files (a design is usually
  100 KB–2 MB) and 50,000 monthly users, and pauses after a week without
  use. The Pro plan removes the pause.
- **Your duties:** you are the controller of your users' data (GDPR). The
  app's [PRIVACY.md](../PRIVACY.md) describes what is stored; adjust it with
  your name and contact details, and Supabase's data processing agreement
  (in the dashboard under *Legal*) covers Supabase's side.
- **Testing without Supabase:** `tests/e2e/cloud.mjs` runs everything
  against a stand-in server; the environment variables
  `SHAPER_SUPABASE_URL`, `SHAPER_SUPABASE_KEY` and `SHAPER_SUPABASE_GOOGLE`
  override the config file.
