# Test Portal — Setup & Deployment Guide

A complete self-hosted online test / mini-LMS: student signup with a passcode,
admin panel to create tests (with self-hosted images), live exam UI with timer,
solutions hidden until submission, results saved permanently in a database.

## What's inside

```
login.html              - student/admin login + signup (passcode-gated)
config.js                - PASTE YOUR SUPABASE URL + KEY HERE (do this first)
css/style.css             - shared design system
lib/supabaseClient.js     - shared Supabase connection helper

student/dashboard.html    - list of available tests + past results
student/test.html         - the actual exam screen (timer, palette, submit)
student/test-app.js       - exam logic

admin/dashboard.html      - admin panel (Manage Tests / Create Test / Passcode / Results)
admin/admin-app.js        - admin logic

schema.sql                 - run this once in Supabase to create the database
```

## Step 1 — Create your free Supabase project

1. Go to https://supabase.com → "Start your project" → sign up (free, no card).
2. "New Project" → give it a name, set a DB password, choose a region close to
   your users (e.g. Mumbai/South Asia) → Create. Takes ~2 minutes.
3. Once it's ready, go to **Settings → API** and copy:
   - **Project URL**
   - **anon public** key
4. Open `config.js` in this project and paste them in:
   ```js
   const SUPABASE_URL = "https://xxxxxxxx.supabase.co";
   const SUPABASE_ANON_KEY = "eyJhbGciOi...";
   ```

## Step 2 — Create the database

1. In Supabase, open **SQL Editor** (left sidebar).
2. Open `schema.sql` from this project, copy the whole file, paste it into the
   SQL editor, and click **Run**.
3. This creates every table, security rule, the secure grading function, and
   the `test-images` storage bucket — all in one go. Safe to re-run if needed.

## Step 3 — Turn on email login

1. In Supabase: **Authentication → Providers** → make sure **Email** is enabled.
2. **Authentication → Settings** → for easiest testing, turn **OFF** "Confirm
   email" (students can log in immediately after signup). You can turn it back
   on later for production if you want email verification.

## Step 4 — Create your admin account

1. Deploy the site (Step 6) or just open `login.html` locally.
2. Sign up like a normal student — use your own email + a passcode. The
   default passcode set by `schema.sql` is: **CHANGE_ME_123**
   (change this immediately once you're in the admin panel — see Step 5).
3. Go back to Supabase **SQL Editor** and run (with your real email):
   ```sql
   update profiles set role = 'admin' where email = 'youradmin@email.com';
   ```
4. Log out and log back in — you'll now land on the **Admin Panel** instead of
   the student dashboard.

## Step 5 — Using the Admin Panel

- **Manage Tests** — activate/deactivate or delete any test.
- **Create Test** — set a name & duration, add sections, add questions.
  For each question: upload the question image, set +/- marks, optionally
  upload a solution image, add options (A/B/C/D), mark the correct one, and
  optionally upload an image per option. All images are uploaded straight
  into *your own* Supabase storage bucket, so they'll never break even if an
  external source goes down.
- **Passcode** — change the signup passcode anytime; only people with the
  current code can create new student accounts.
- **Results** — pick a test to see every student's score, correct/incorrect/
  unattempted count, time taken, and submission time. Export to CSV anytime.

## Step 6 — Put it online (free static hosting)

Since this is a plain static site, drag-and-drop hosting works great:

**Netlify Drop (fastest)**
1. Go to https://app.netlify.com/drop
2. Drag this whole folder into the browser window
3. You get a live `https://...netlify.app` link instantly

**Or GitHub Pages / Vercel / Cloudflare Pages** — push this folder to a GitHub
repo and connect it; all three have a free static-site tier.

> Important: upload the **entire folder** (all files & subfolders), not just
> index files — the site needs `config.js`, `css/`, `lib/`, `student/`, and
> `admin/` all present with the same folder structure.

## How the security works (so solutions can't leak)

- Students never read the `questions`/`options` tables directly — they read
  safe views (`questions_for_student`, `options_for_student`) that simply
  don't contain the correct-answer flag or the solution image.
- When a student submits, the browser sends only their chosen option IDs to a
  database function (`submit_attempt`), which grades everything **on the
  server** and only then returns which answers were correct, together with
  solution images — this is what "unlocks" solutions strictly after submit.
- Row Level Security means a student can only ever see their own results;
  only accounts with `role = 'admin'` can see everyone's results or edit tests.

## Notes & limits (free Supabase tier)

- 500MB database storage, 1GB file storage, 50,000 monthly active users —
  plenty for a small-to-mid sized coaching/institute use case.
- If a project sits fully idle for 7 days, Supabase pauses it (just click
  "Resume" in the dashboard — no data is lost).
- Want to migrate an existing test (like the IAT Part Test 1 built earlier)
  into this system with self-hosted images? Just recreate it once through the
  **Create Test** admin form — every image gets uploaded to your own storage
  as you go, so it becomes fully self-hosted at the same time.
