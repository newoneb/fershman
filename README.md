# The Fershman Journal — website

A complete site for The Fershman Journal: a broadsheet-style public journal, an admin
panel for writing and publishing, and a private members portal for internal slides,
models and recordings. Plain HTML, CSS and JavaScript — no build step. Drop the folder on
Netlify and it runs.

```
/            the journal (front page, sections, articles, authors, Learn Economics, search)
/admin/      admin panel — write, edit, schedule, publish; manage authors, members, inbox
/portal/     members portal — the library of decks, models and recordings
```

## How it works

The site runs in one of two modes, decided by `config.js`:

| | Demo mode (default) | Live mode |
|---|---|---|
| Setup | None | A free Supabase project (about 10 minutes) |
| Content | Sample stories, your real authors and headlines | Your database |
| Admin & portal | Work, but save only in your own browser | Shared by everyone, with real logins |

A website on its own can't store articles or accounts for other people, so live mode uses
[Supabase](https://supabase.com) (free) for the database, logins and file storage. Every
permission is enforced inside the database, not in the browser.

---

## 1. Put it online (5 minutes)

1. Unzip the download. You'll get a folder called `fershman-journal`.
2. Open <https://app.netlify.com/drop> and drag the **folder** (not the zip) onto the page.
3. Netlify gives you an address like `https://something.netlify.app`. The site is live in
   demo mode. Click around, open `/admin/` (any email and password works in demo mode) and
   `/portal/`.

Netlify can rename the address under **Site configuration → Change site name**.

## 2. Go live with a database (10 minutes)

1. **Create a project.** Sign up at <https://supabase.com/dashboard> and create a project.
   Pick the region closest to your readers (for Chicago, an East US region) and save the
   database password somewhere safe.
2. **Install the tables.** In the project, open **SQL Editor → New query**, paste the whole
   of `supabase/schema.sql`, and press **Run**. You should see
   *"The Fershman Journal schema is installed."*
3. **Copy your keys.** Press **Connect** at the top of the project dashboard (or open
   **Project Settings → Data API** and **API Keys**) and copy:
   - the **Project URL** (`https://abcdefghijkl.supabase.co`)
   - the **publishable key** (`sb_publishable_…`; older projects call it the `anon` key)

   Never use the *secret* key on the website.
4. **Connect the site.** Paste both into `config.js`:
   ```js
   supabase: {
     url: "https://abcdefghijkl.supabase.co",
     key: "sb_publishable_xxxxxxxx",
   },
   ```
   Or let the site write the file for you: in demo mode open **Admin → Settings → Go live**,
   paste the keys, press **Test connection**, then **Download config.js** and replace the file.
5. **Allow your web address to receive login emails.** In Supabase open
   **Authentication → URL Configuration**:
   - **Site URL:** your site's address, e.g. `https://something.netlify.app`
     (change it to `https://www.fershman.com` after step 4 below)
   - **Redirect URLs:** add `https://something.netlify.app/**` and `https://www.fershman.com/**`
6. **Redeploy.** In Netlify open your site → **Deploys**, and drag the folder onto the
   drop area again.
7. **Create your admin account.** Open `/portal/` on the live site, choose
   **Request access**, and sign up. Confirm the email Supabase sends you, then sign in.
   **The first account ever created becomes the admin** — do this right after step 2.
8. Open `/admin/`. You're in.

## 3. Bring your articles over from Framer

1. In Framer, open your project, go to **Plugins**, search for **CMS Export** (made by
   Framer), choose your **articles** collection and export it as a CSV file. Do the same
   for your **authors** collection if you want their photos and bios.
2. In the new site, open **Admin → Import**, drop the CSV, check that each field is matched
   to the right column (the importer guesses), match your categories and authors, preview,
   and press **Import**.

What the importer does for you:

- Keeps every article's slug, so old links like `/articles/margin-of-error` keep working.
  Old `/categories/…`, `/authors/…` and `/learn-economics-categories/…` links also work
  (see `_redirects`).
- Converts Framer's formatted text into the editor's format, keeping headings, links,
  lists, images and captions.
- Creates authors that don't exist yet.
- **Copy images into your own storage** moves images off Framer's servers where the browser
  allows it. Any that stay behind are listed; re-upload those in the editor before you
  cancel Framer.
- Running it again updates articles with the same slug instead of duplicating them.

Optional: **Admin → Import → Starter content** adds the 22 authors from fershman.com plus a
launch note and two Learn Economics lessons as drafts.

## 4. Move fershman.com to the new site

1. In Netlify open **Domain management → Add a domain**, add `www.fershman.com`, and let it
   add `fershman.com` too.
2. Disconnect the domain from Framer, then update the DNS records where your domain is
   registered, exactly as Netlify shows (usually a `CNAME` for `www` and an `A`/`ALIAS`
   record for the bare domain). HTTPS is issued automatically.
3. In Supabase, change **Site URL** to `https://www.fershman.com`.
4. Cancel Framer only after the archive and its images are imported.

---

## Running the journal

### Roles

| Role | Can |
|---|---|
| Pending approval | Nothing private yet — waiting for an admin |
| Member | Open the members portal |
| Writer | + write drafts and submit them for review |
| Editor | + edit, schedule and publish; manage authors, portal files and the inbox |
| Admin | + approve members, see subscribers, change site settings |

New people sign up at `/portal/` and appear in **Admin → Members** as *Pending approval*.
Choose a role to let them in. Link a writer's account to their author byline in the same
table so new articles are attributed to them automatically.

### Writing and publishing

**Admin → Articles → New article.** The editor shows a live preview in the site's real
typography.

- **Headline** and **standfirst** (the italic one-line summary) go at the top.
- Format with the toolbar or Markdown: `## Heading`, `**bold**`, `> pull quote`,
  `![alt text](image-url "Caption. Source: X")`, tables, and footnotes (`claim[^1]` then
  `[^1]: Source`). Paste or drop an image straight into the text to upload it.
- Charts and video: paste an embed code from Datawrapper, Flourish, YouTube, Vimeo, Google
  Slides, FRED or Our World in Data on its own line.
- **Key figures** (sidebar): one per line, `$1.5T | Record margin debt`. They appear beside
  the article.
- **Feature on the front page** makes it the lead story (newest featured story wins).
  **Show as the Big Read** puts it in the dark full-width band.
- **Publish**, or set a future date and press **Schedule**. **Unpublish** takes a story
  down without deleting it.
- Writers press **Submit for review**; editors see the count on the Articles menu.
- Unsaved changes are backed up in your browser, and `Ctrl/⌘ + S` saves.

### Members portal

Editors add files from **Admin → Member portal** or **Add files** inside `/portal/`.
Group them into collections such as *Fall 2026 pitch night*. PDFs, images, video and
Google Slides links preview inside the portal; PowerPoint, Keynote, Word and Excel files
download (PowerPoint and Word can also preview through Microsoft's free viewer). Files are
private: members get short-lived links, and nobody outside the club can open them.

The free Supabase plan allows **50 MB per file**. For bigger decks, export a PDF or add a
Google Slides or Drive link instead.

### Inbox, subscribers and settings

- **Inbox:** article submissions, applications and contact messages from the public forms.
- **Subscribers:** sign-ups from `/register`. **Export CSV** and import the list into
  Mailchimp, Beehiiv, Buttondown or Substack to send the newsletter.
- **Settings:** the green announcement bar, and the text of the About, Submit, Apply and
  Privacy pages.

## Customizing

Everything most people want to change is in `config.js`: the journal's name and tagline,
the sections (order, names, descriptions), contact emails, social links, Learn Economics
topics, author teams, and the market strip (symbols, or `enabled: false` to hide it).

Colors and fonts are tokens at the top of `assets/css/tokens.css`. The fonts (Newsreader
and Schibsted Grotesk, both open source) are bundled, so nothing loads from Google.

## Good to know

- **Free plan limits** (Supabase): 500 MB database, 1 GB file storage, 50 MB per file,
  5 GB of downloads a month, 50,000 monthly active users. Free projects are paused after a
  week of inactivity; if the site ever says it can't reach the database, open the project in
  Supabase and restore it. Automatic backups need a paid plan.
- **Login emails:** Supabase's built-in email sender is rate-limited to a few messages an
  hour, which is fine for a club. To send more, add your own SMTP server under
  **Authentication → Emails**. If you'd rather skip email confirmation entirely, turn off
  **Confirm email** under **Authentication → Sign In / Providers** — admins still approve
  every new member.
- **Security:** the publishable key in `config.js` is designed to be public. What protects
  your data is the row-level security in `supabase/schema.sql`. Never paste the secret key
  into any file in this folder.
- **Link previews:** stories are rendered in the reader's browser. Google indexes them
  normally, but LinkedIn and X show the journal's default title and image for article links.
- **Other hosts:** Cloudflare Pages reads the same `_redirects` file. Vercel uses
  `vercel.json`, included.
- **Preview on your computer:** `python3 tools/serve.py`, then open
  <http://localhost:8080>.

## What's where

```
config.js                 site settings and Supabase keys (the only file you must edit)
index.html, *.html        page shells; content is rendered by assets/js/site/*
admin/, portal/           the admin panel and members portal
assets/css/               tokens.css (colors, fonts), site.css, app.css
assets/js/data/           live.js (Supabase), demo.js (browser-only), shared.js
assets/js/site/           public pages
assets/js/admin/          admin views, editor, importer
assets/js/portal/         members portal
assets/vendor/            bundled libraries (Supabase client, marked, DOMPurify, Turndown, Papa Parse)
content/seed.json         demo content: your authors and recent headlines, sample portal items
supabase/schema.sql       database tables, permissions and storage — run once in Supabase
_redirects, _headers      Netlify rewrites (old Framer URLs) and security headers
tools/serve.py            local preview server
```

Third-party licenses are in `assets/vendor/` and `assets/fonts/`.
