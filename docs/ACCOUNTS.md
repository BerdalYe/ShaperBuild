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

**Site URL:** under **Authentication → URL Configuration**, set the *Site
URL* to a page people can land on after clicking the link in the
confirmation email (for example the project's GitHub page). Otherwise the
link ends on `localhost:3000`, which looks broken even though the email was
confirmed.

**Email sending:** Supabase's built-in email sender only sends a few emails
an hour and is meant for testing. Before real people sign up, connect your
own sender under **Authentication → Emails → SMTP Settings** (for example
Resend, Brevo or your email provider), and change the email templates to say
ShaperBuild.

**Google (optional):**

1. In Google Cloud Console make an OAuth client (type *Web application*)
   with the redirect URL Supabase shows under **Authentication → Providers →
   Google**.
2. Paste the client id and secret into Supabase and turn Google on.
3. Under **Authentication → URL Configuration → Redirect URLs** add
   `http://127.0.0.1:45840/auth/callback` (the app listens there for a
   moment while you sign in in your browser).

## 3. Connect the app

The app's builds get the project from two **repository variables** (not
secrets: these values are meant to be public), so no key is kept in the code.

1. In Supabase open **Project Settings → API Keys** and copy the **Project
   URL** and the **publishable** key (`sb_publishable_…`) or the legacy
   **anon public** key. Never use the **secret** / **service_role** key.
2. On GitHub open the repository's **Settings → Secrets and variables →
   Actions → Variables** and add:
   - `SUPABASE_URL`: the Project URL, e.g. `https://YOUR-PROJECT.supabase.co`
   - `SUPABASE_ANON_KEY`: the publishable (or anon) key
   - `SUPABASE_GOOGLE`: `true` if you turned on Google (optional)
3. Build or release as usual: the build writes them into
   `electron/cloud-config.json` before packaging, and every copy then has
   accounts. Without the variables the app is built without accounts.

The anon and publishable keys are meant to be public: the database rules
from step 1 are what protect the data. Supabase is retiring the old *anon*
key in 2027; ShaperBuild works with either, so switch `SUPABASE_ANON_KEY` to
the publishable key whenever you like.

**Running from the source code:** set `SHAPER_SUPABASE_URL` and
`SHAPER_SUPABASE_KEY` (and `SHAPER_SUPABASE_GOOGLE=1`) in the environment
before `npm start`, or fill in `electron/cloud-config.json` locally (don't
commit it).

## Good to know

- **Costs:** the free plan holds 1 GB of files (a design is usually
  100 KB–2 MB) and 50,000 monthly users, and pauses after a week without
  use. The Pro plan removes the pause.
- **Your duties:** you are the controller of your users' data (GDPR). The
  app's [PRIVACY.md](../PRIVACY.md) describes what is stored; adjust it with
  your name and contact details, and Supabase's data processing agreement
  (in the dashboard under *Legal*) covers Supabase's side.
- **Testing without Supabase:** `tests/e2e/cloud.mjs` runs everything
  against a stand-in server, using the environment variables above.
