# The Fershman Journal — website

A complete site for The Fershman Journal: a broadsheet-style public journal, an admin
panel for writing and publishing, and a private members portal for internal slides,
models and recordings. Plain HTML, CSS and JavaScript — no build step. Drop the folder on
Netlify and it runs.

```
/            the journal (front page, sections, articles, authors, Learn Economics, search)
/admin/      admin panel — write, edit, schedule, publish; manage authors, members, inbox
/portal/     the portal — applications, and the members library of decks, models and recordings
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
   **Create an account**, and sign up. Confirm the email Supabase sends you, then sign in.
   **The first account ever created becomes the admin** — do this right after step 2.
8. Open `/admin/`. You're in.
9. **Let members sign up.** Supabase's built-in email only reaches people on your Supabase
   project team (that's why step 7 worked for you), and only 2 emails an hour. Anyone else who
   requests access while **Confirm email** is on gets an error. Pick one:
   - **Quick:** in Supabase open **Authentication → Sign In / Providers**, turn off
     **Confirm email** and save. People can request access without an email, and an admin still
     approves every new member, so only approve people you recognize.
   - **Proper:** connect your own email sender ([Emails from the site](#emails-from-the-site)).
     You need this anyway for **Forgot your password** to reach members.

   Accounts from the old fershman.com didn't carry over. Everyone requests access once.

## 3. Bring your articles over from Framer

1. In Framer, open your project, go to **Plugins**, search for **CMS Export** (made by
   Framer), choose your **articles** collection and export it as a CSV file. Do the same
   for your **authors** collection if you want their photos and bios.
2. In the new site, open **Admin → Import**, drop the CSV, check that each field is matched
   to the right column (the importer guesses), match your categories and authors, preview,
   and press **Import**.

**Learn Economics lessons** have their own importer on the same page (*Learn Economics lessons
from Framer*). Export the Learn Economics pages collection as CSV and drop it there: lessons land
in the Learn Economics hub under Microeconomics or Macroeconomics (from their category), keep their
dates, cover images, tables and headings, and old `/learn-economics/…` links redirect to them.

What the importer does for you:

- Keeps every article's slug, so old links like `/articles/margin-of-error` keep working.
  Old `/categories/…`, `/authors/…`, `/learn-economics/…` and `/learn-economics-categories/…` links also work
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
| Pending approval | An account with no access yet: applicants, and members waiting for an admin |
| Member | Open the members portal |
| Writer | + write drafts and submit them for review |
| Editor | + edit, schedule and publish; manage authors, portal files and the inbox |
| Admin | + approve members, see subscribers, change site settings |

### Teams and the Marketing team

Teams are the groups on the public Team page (`/team`; `/authors` still works): Leadership,
Editors, Marketing, Analysts, Staff Writers. One person can hold several positions: in
**Admin → Authors**, tick every team they're on, for example *Editors* and *Marketing*. Each
person appears once, under the first of their teams, with the others shown as tags. Add a
**class year**, **major** and bio in **Admin → Authors** (or **My byline**) and they show on the
card and in the profile that opens when a reader selects it, with the person's latest stories.
Photos print in black and white, in the spirit of the Journal's hedcut portraits; people without a
photo get their initials. A byline whose title starts with "House", like *Fershman Editors*,
signs stories but stays off the Team page.

Anyone whose byline is on **Marketing** (and whose account is linked to that byline in
Members) can run recruiting even as a writer: schedule info sessions, set active recruiting
periods and review applications. Everyone on Marketing is listed on the Apply page for coffee
chats automatically. Each person adds their own booking link under **Admin → My byline**.

New people sign up at `/portal/` and appear in **Admin → Members** as *Pending approval*.
Applicants get access automatically when their application is accepted; for current members
who create an account, choose a role to let them in. Link a writer's account to their author byline in the same
table so new articles are attributed to them automatically.

### Writing and publishing

**Admin → Articles → New article.** The editor shows a live preview in the site's real
typography.

- **Headline** and **standfirst** (the italic one-line summary) go at the top.
- Format with the toolbar or Markdown: `## Heading`, `**bold**`, `> pull quote`,
  `![alt text](image-url "Caption. Source: X")`, tables, and footnotes (`claim[^1]` then
  `[^1]: Source`). Paste or drop an image straight into the text to upload it.
- **Interactive charts:** press the chart button in the toolbar (see
  [Interactive charts](#interactive-charts)).
- Maps and video: paste an embed code from Datawrapper, Flourish, YouTube, Vimeo, Google
  Slides, FRED or Our World in Data on its own line.
- **Key figures** (sidebar): one per line, `$1.5T | Record margin debt`. They appear beside
  the article.
- **Feature on the front page** makes it the lead story (newest featured story wins).
  **Show as the Big Read** puts it in the dark full-width band.
- **Publish**, or set a future date and press **Schedule**. **Unpublish** takes a story
  down without deleting it.
- Writers press **Submit for review**; editors see the count on the Articles menu.
- Unsaved changes are backed up in your browser, and `Ctrl/⌘ + S` saves.

### Interactive charts

Charts are drawn by the site itself, in the journal's style, so they load fast, work in dark
mode and on phones, and readers can explore them:

- hover, tap or use the arrow keys to read exact values (a crosshair on line charts)
- click a legend entry to hide or show a series
- switch time spans with range buttons such as 1Y, 5Y, All
- **View data** shows the numbers as a table; **Download data** saves a CSV

To add one, press the chart button in the editor toolbar, pick a type (line, area, columns,
stacked columns, bars or scatter), and paste your data from Google Sheets or Excel (or upload
a CSV). The first row holds column names. For line and area charts the first column holds
dates: `2024-03-31`, `2024-03`, `Mar 2024`, `2024` and `Q1 2024` all work. Then add a title,
a subtitle with the unit, the source, and optionally:

- **Before/After:** `$`, `%`, `x`, `bn` around every number. Keep the data itself plain
  (`1.5`, not `$1.5T`).
- **Emphasize:** name one or two series and the rest turn gray, so the story stands out.
- **Event markers:** `2020-03 | Pandemic cuts` draws a labeled vertical line.
- **Reference lines:** `2 | Fed target` draws a dashed line at that value.

The preview updates as you type, and errors say which row to fix. To change a chart later,
press **Edit chart** above it in the preview, or put the cursor inside it and press the chart
button. Up to six series per chart (twelve when you emphasize some), three groups in a scatter.
The colors are tested for color-blind readers in both light and dark mode.

Charts live in the article text as a block like this, which you can also type by hand:

````
```chart
type: line
title: The Fed's policy rate since 2015
subtitle: Upper bound of the target range, percent
source: Federal Reserve
suffix: %
ranges: 1Y, 5Y, All
mark: 2020-03 | Pandemic cuts
---
Month,Upper bound
2015-01,0.25
2015-02,0.25
```
````

The Learn Economics lesson "What a bond yield is really telling you" in the demo shows three
examples. For maps or anything more unusual, Datawrapper and Flourish embeds still work.

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
- **Settings:** the green announcement bar, and the text of the About, Submit and
  Privacy pages.

### Recruiting and applications

**Admin → Recruiting** runs everything on `/apply`. Editors, admins and the Marketing team can
use it.

**How someone applies.** The Apply page shows where recruiting stands (with a countdown while
there's a closing date), how it works, a recruiting calendar, info sessions, coffee chats, roles
and questions. **Start your application** opens the portal: the applicant creates an account and
writes the application there.

- The draft saves to the database as they type, so they can finish it later or on another device.
- They answer two questions (*Why Fershman?*, up to 250 words, and a story pitch, up to 120),
  pick roles, give their year and major, and can add a writing-sample link, a LinkedIn or résumé
  link and one PDF or Word file of up to 10 MB, stored privately. The questions are
  `APP_QUESTIONS` in `assets/js/data/shared.js`.
- After they submit, the portal shows a four-step tracker (Application, Review, Interview,
  Decision) and any note you leave them. Someone who was declined can start a new application.
- Current members who create an account see a note that they don't need to apply. Give them
  their role in **Admin → Members** as before.

**Reviewing.** **Applications** lists every application, filtered by status and recruiting
period, with search and **Export CSV**. Open one to read it and open the uploaded file, then:

- **Add a review:** a score from 1 to 5, a recommendation (advance, hold or decline) and notes.
  Only recruiters see reviews, never the applicant.
- **Move it** to *Reviewing* or *Interview*, and write a **note to the applicant**, for example an
  interview time and place. It appears on their application page.
- **Return it to the applicant for edits:** it becomes a draft they can change and send again,
  even after a deadline.
- **Accept** or **Decline.** Editors and admins make the final decision; the Marketing team can
  review but not decide. Accepting asks which access to give, **Writer** or **Member**, and grants
  it straight away, with no separate step in Members.

The database enforces all of this, not just the pages: applicants can change only their own
draft and submit only while applications are open, only recruiters can read applications and
reviews, and only editors and admins can accept or decline. Applications sent with the old
single-page form stay in the **Inbox**.

- **Info sessions:** add a date, place, optional capacity and an optional meeting link. People
  register on the Apply page, get Google Calendar and .ics buttons, and see the meeting link
  only after registering. Open a session to see who's coming, copy their emails or export them.
- **Recruiting periods:** mark the weeks you're actively recruiting (posters up, sessions
  running). During a period the Apply page leads with it ("Fall recruitment is on. Apply by
  October 16") and a countdown, the Apply link in the header gets a small green dot, and
  applications submitted then are filed under the period. Add a **Decisions by** date and it
  appears on the recruiting calendar and in applicants' status. Outside periods, applications
  stay open on a rolling basis. The period's note stays internal.
- **Coffee chats:** the Marketing team is listed automatically. You can also add extra hosts
  and paste each one's booking page (Calendly, Cal.com or a Google Calendar appointment
  schedule — all have free plans). Hosts without a link get an "Email to schedule" button.
  Hosts are also marked on the Team page.
- **Apply page:** open with rolling review, open until a deadline, or closed (visitors can ask
  to be notified, and applicants can still write a draft to submit when you reopen). Edit the
  headline, highlights, steps, roles, what you look for and the FAQ.
- **Recruiting pop-up:** while a recruiting period is on, a small card slides in at the bottom
  corner of every page (a few seconds after it loads, or once the reader scrolls), with buttons to
  the Apply page. It shows once per visit, stays away for the rest of the period once someone
  closes it, and doesn't appear on the Apply page itself. Change the message or turn it off under
  **Apply page → Application status**.

**Updating from an earlier version:** upload the new files (keep your `config.js`), then run the
whole of `supabase/schema.sql` once in the Supabase SQL editor. It adds the application tables,
the private `applications` storage bucket and any recruiting tables your project is missing, and
keeps all existing data. Running it again later is always safe.

### Emails from the site

Supabase sends two kinds of email for the site: the confirmation link when someone requests
access (only while **Confirm email** is on) and **Forgot your password** links.

Its built-in sender is meant for testing. It only delivers to people on your Supabase project
team, at most 2 emails an hour. Everyone else sees "The site can't send email to this address
yet" or "…reached its hourly email limit", with your contact email to write to instead.

To email everyone, connect your own sender. Resend's free plan (3,000 emails a month, 100 a day)
is plenty for a club:

1. Sign up at <https://resend.com>, open **Domains → Add domain** and enter `fershman.com`.
2. Resend lists a few DNS records. Add each one in GoDaddy (**My Products → fershman.com → DNS →
   Add new record**) exactly as shown, then press **Verify** in Resend. They live on their own
   subdomains, so your website and any email you already receive aren't affected.
3. In Resend open **API Keys → Create API key** (sending access) and copy the key.
4. In Supabase open **Authentication → Email** (under Notifications) **→ SMTP Settings**, turn on
   **Enable custom SMTP** and fill in:
   - Sender email: `no-reply@fershman.com`, sender name: `The Fershman Journal`
   - Host `smtp.resend.com`, port `465`, username `resend`, password: the API key
5. Save. Custom senders start at 30 emails an hour; change that under
   **Authentication → Rate Limits**.
6. If you turned off **Confirm email**, you can turn it back on now.

Sign-ups and sign-ins are also limited to 30 every 5 minutes per network. If a room full of
people requests access at once on campus Wi-Fi (at an info session, say), raise
**Sign-ups and sign-ins** under **Authentication → Rate Limits** beforehand.

### Helping someone who can't get in

- **"Email or password is incorrect"** and they had an account on the old site: old accounts
  didn't carry over. They choose **Create an account** and sign up again with the same email.
- **An email error while requesting access:** see above. Meanwhile, check
  **Authentication → Users** in Supabase. If they're listed as waiting for verification,
  delete them there and ask them to request access again once **Confirm email** is off or your
  own sender is connected.
- **They signed up but only see the application page:** current members don't need to apply. Choose
  their role in **Admin → Members** (and link their byline if they write).

### Google Analytics

The public pages report to Google Analytics 4 (`G-WQ8MGKY96G`, set as `analytics.ga4` in
`config.js`; an empty value turns it off). Because pages are built in the browser, the site
sends each page view itself once the real headline is in place, grouped by section
("Content group" in GA). On top of that it records:

| Event | When | Details |
|---|---|---|
| `article_progress` | a reader gets 25%, 50%, 75% and 100% of the way through a story | `percent_read`, `engaged_seconds`, `article_section`, `article_author` |
| `article_complete` | they reach the end | `engaged_seconds`, `read_minutes` (estimated length) |
| `article_read` | they leave a story | deepest `percent_read`, total `engaged_seconds` |
| `share` | copy link, LinkedIn, X, email or print | `method` |
| `newsletter_signup` | someone subscribes | |
| `application_start` | someone presses Start your application on the Apply page | `from` (`hero` or `apply_section`) |
| `info_session_register` | someone registers for an info session | `session_title` |
| `coffee_chat_click` | someone opens a host's booking page or email | `host_name`, `method` |
| `recruiting_notify`, `story_pitch`, `contact_message` | the other forms | |
| `search` | a search returns results | `search_term`, `results` |
| `chart_interact`, `chart_data` | a reader explores a chart, or views or downloads its data | `chart_title`, `method` |
| `recruiting_popup` | the pop-up is shown, clicked or closed | `popup_action`, `period_title` |

"Engaged" time only counts while the tab is visible and the reader has scrolled, moved or
typed in the last 30 seconds.

Set up GA once (Admin, the gear icon, in analytics.google.com):

1. **Data display → Events:** once the events have come in (give it a day), click the star
   next to `newsletter_signup`, `application_start` and `info_session_register` to make them
   key events.
2. **Data display → Custom definitions → Create custom dimension** (scope: Event) for
   `article_section`, `article_author`, `percent_read`, `chart_title`, `popup_action` and
   `host_name`, and a **custom metric** for `engaged_seconds` (unit: seconds). Without this
   step the details are collected but don't show in reports.
3. Check it works under **Reports → Realtime** while you browse the site.

Then **Explore → Free form** with *Page title* and `percent_read` as dimensions and *Event
count* as the value shows how far people read each story.

Not tracked: the admin panel and the portal (so applications themselves aren't), draft previews, browsers that send a
Global Privacy Control signal, and any browser where someone has signed in to the admin (so
the team's own visits don't count). Open `fershman.com/?analytics=off` or `?analytics=on` to
switch a browser out or back in.

The default Privacy page explains this. If you edited the Privacy page under **Settings**,
add a paragraph about Google Analytics there too.

## Customizing

Everything most people want to change is in `config.js`: the journal's name and tagline,
the sections (order, names, descriptions), contact emails, social links, Learn Economics
topics, author teams, and the market strip (symbols, or `enabled: false` to hide it).

Colors and fonts are tokens at the top of `assets/css/tokens.css`. The nameplate and drop
caps use Cinzel, the open-source cousin of Trajan Pro; headlines use Hedvig Letters Serif,
article text Newsreader and the interface Schibsted Grotesk. All four are open source and
bundled, so nothing loads from Google. Trajan Pro itself is licensed through Adobe: to use it,
add your Adobe Fonts web project to the page shells and put `"trajan-pro-3"` first in
`--display`.

## Good to know

- **Free plan limits** (Supabase): 500 MB database, 1 GB file storage, 50 MB per file,
  5 GB of downloads a month, 50,000 monthly active users. Free projects are paused after a
  week of inactivity; if the site ever says it can't reach the database, open the project in
  Supabase and restore it. Automatic backups need a paid plan.
- **Login emails:** Supabase's built-in sender only emails your Supabase team, 2 an hour.
  Connect your own sender before members sign up; see
  [Emails from the site](#emails-from-the-site).
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
assets/js/site/           public pages, analytics.js (Google Analytics), recruit-popup.js
assets/js/lib/charts.js   interactive charts (```chart blocks)
assets/js/admin/          admin views, editor, chart builder, importer
assets/js/portal/         the portal: app.js (sign-in, library), application.js (applications)
assets/vendor/            bundled libraries (Supabase client, marked, DOMPurify, Turndown, Papa Parse)
content/seed.json         demo content: your authors and recent headlines, sample portal items
supabase/schema.sql       database tables, permissions and storage — run in Supabase (safe to re-run)
_redirects, _headers      Netlify rewrites (old Framer URLs) and security headers
tools/serve.py            local preview server
```

Third-party licenses are in `assets/vendor/` and `assets/fonts/`.
