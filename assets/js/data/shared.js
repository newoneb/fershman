// Logic shared by the live (Supabase) and demo (browser) data adapters.

export const ARTICLE_FIELDS = [
  "slug", "title", "dek", "body", "section", "topic", "tags", "author_id",
  "cover_url", "cover_alt", "cover_caption", "figures", "status", "published_at",
  "featured", "big_read",
];
export const CARD_COLUMNS =
  "id,slug,title,dek,section,topic,tags,cover_url,cover_alt,cover_caption,status,published_at,featured,big_read,author_id,view_count,created_by,created_at,updated_at";
export const AUTHOR_FIELDS = ["slug", "name", "role_title", "team", "teams", "bio", "avatar_url", "x_url", "linkedin_url", "booking_url", "contact_email", "sort_order"];
/** Fields people may edit on their own byline (teams and address stay with editors). */
export const BYLINE_FIELDS = ["name", "role_title", "bio", "avatar_url", "x_url", "linkedin_url", "booking_url", "contact_email"];
export const MARKETING = "Marketing";
export const authorTeams = (a) => (a && Array.isArray(a.teams) && a.teams.length ? a.teams : [(a && a.team) || "Contributors"]);
export const isMarketing = (a) => authorTeams(a).includes(MARKETING);
/** Team order for display: config order, Marketing after Editors, then anything else in use. */
export function teamList(configTeams = [], authors = []) {
  const t = [...configTeams];
  if (!t.includes(MARKETING)) { const i = t.indexOf("Editors"); t.splice(i >= 0 ? i + 1 : t.length, 0, MARKETING); }
  authors.forEach((a) => authorTeams(a).forEach((x) => { if (!t.includes(x)) t.push(x); }));
  return t;
}
/** Fill teams/team consistently; people with a marketing title join Marketing. */
export function normalizeAuthor(a) {
  const out = { ...a };
  let teams = Array.isArray(out.teams) && out.teams.length ? [...out.teams] : out.team ? [out.team] : [];
  if (!(Array.isArray(a.teams) && a.teams.length) && /marketing/i.test(out.role_title || "") && !teams.includes(MARKETING)) teams.push(MARKETING);
  if (!teams.length) teams = ["Contributors"];
  out.teams = [...new Set(teams)];
  out.team = out.teams[0];
  return out;
}
export const ROLES = ["pending", "member", "writer", "editor", "admin"];
export const ROLE_LABELS = { pending: "Pending approval", member: "Member", writer: "Writer", editor: "Editor", admin: "Admin" };

export function roleAtLeast(role, min) {
  return ROLES.indexOf(role || "pending") >= ROLES.indexOf(min);
}

export function isPublic(a, now = Date.now()) {
  return a && a.status === "published" && a.published_at && new Date(a.published_at).getTime() <= now;
}

/** draft | review | scheduled | published */
export function articleState(a) {
  if (!a) return "draft";
  if (a.status === "published") return a.published_at && new Date(a.published_at).getTime() > Date.now() ? "scheduled" : "published";
  return a.status || "draft";
}

export function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

export function cleanArticle(a) {
  const row = pick(a, ARTICLE_FIELDS);
  if (row.tags && !Array.isArray(row.tags)) row.tags = String(row.tags).split(",").map((t) => t.trim()).filter(Boolean);
  for (const k of ["dek", "topic", "cover_url", "cover_alt", "cover_caption", "figures"]) if (row[k] === "") row[k] = null;
  if (row.author_id === "") row.author_id = null;
  return row;
}

export function sortAuthors(list, teams = []) {
  const order = (t) => { const i = teams.indexOf(t); return i === -1 ? teams.length : i; };
  return [...list].sort((a, b) => order(a.team) - order(b.team) || (a.sort_order ?? 100) - (b.sort_order ?? 100) || a.name.localeCompare(b.name));
}

export function byDateDesc(a, b) {
  return new Date(b.published_at || b.updated_at || 0) - new Date(a.published_at || a.updated_at || 0);
}

/** "value | label" per line → [{value, label}] */
export function parseFigures(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.split("|"))
    .filter((p) => p[0] && p[0].trim())
    .map(([value, ...rest]) => ({ value: value.trim(), label: rest.join("|").trim() }))
    .slice(0, 6);
}

const MIME = {
  pdf: "application/pdf", ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  key: "application/x-iwork-keynote-sffkey", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv", txt: "text/plain", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  mp3: "audio/mpeg", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", zip: "application/zip",
};
export function guessMime(name) {
  const ext = String(name || "").split(".").pop().toLowerCase();
  return MIME[ext] || "application/octet-stream";
}

/** pdf | slides | doc | sheet | video | audio | image | gslides | link | file */
export function itemKind(item) {
  if (item.kind === "link") {
    const u = String(item.url || "");
    if (/docs\.google\.com\/presentation/.test(u)) return "gslides";
    if (/youtube\.com|youtu\.be|vimeo\.com/.test(u)) return "video";
    return "link";
  }
  const name = String(item.file_name || "").toLowerCase();
  const m = String(item.mime_type || guessMime(name));
  if (m === "application/pdf") return "pdf";
  if (/presentation|powerpoint|keynote/.test(m) || /\.(pptx?|key)$/.test(name)) return "slides";
  if (/wordprocessing|msword/.test(m)) return "doc";
  if (/spreadsheet|ms-excel|text\/csv/.test(m)) return "sheet";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("image/")) return "image";
  return "file";
}

export function safeFileName(name) {
  const base = String(name || "file").normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const dot = base.lastIndexOf(".");
  const stem = (dot > 0 ? base.slice(0, dot) : base).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "file";
  const ext = dot > 0 ? base.slice(dot + 1).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toLowerCase() : "";
  return ext ? `${stem}.${ext}` : stem;
}

export function friendlyError(err) {
  if (!err) return "Something went wrong.";
  const code = err.code || "";
  const msg = err.message || err.error_description || String(err);
  if (code === "23505" || /duplicate key/i.test(msg)) {
    if (/slug/i.test(msg)) return "That URL slug is already used. Change the slug and try again.";
    if (/email/i.test(msg)) return "That email is already on the list.";
    return "This already exists.";
  }
  if (code === "42501" || /row-level security|permission denied/i.test(msg)) return "Your account doesn't have permission to do that.";
  if (code === "42P01" || /does not exist|Could not find the table|schema cache/i.test(msg)) return "The database isn't set up yet. Run supabase/schema.sql in the Supabase SQL editor.";
  if (/Invalid login credentials/i.test(msg)) return "Email or password is incorrect.";
  if (/Email not confirmed/i.test(msg)) return "Confirm your email first — check your inbox for the link.";
  if (/rate limit/i.test(msg)) return "Too many attempts. Wait a minute and try again.";
  if (/Password should be/i.test(msg)) return msg;
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return "Can't reach the server. Check your connection and try again.";
  if (/exceeded the maximum allowed size|Payload too large|413/i.test(msg)) return "That file is too large for your storage plan.";
  return msg;
}

export const SETTINGS_DEFAULTS = {
  announcement: { enabled: false, text: "", link: "" },

  about_md: `The Fershman Journal is an independent, student-run publication and educational charity. We write about the deals, markets and policies that shape the economy — and we teach the ideas behind them, for free.

## Why we exist

Economics and finance should be easy to understand. Most people are never taught how markets, credit or policy actually work, even though those forces decide what they earn, borrow and own. We want to change that, and to train a new generation of analysts, leaders and entrepreneurs along the way.

## How we work

Every piece is written by a member and edited by a section head before it is published. We have no advertisers and no house position to protect, so our writers are free to criticize banks, regulators and technology companies alike.`,

  apply_md: `Fershman is a selective, research-driven student publication. Contributors produce in-depth analysis on markets, M&A, corporate strategy and macroeconomic trends, with support from our section editors.

We recruit every Fall, Winter and Spring quarter. Prior writing or finance experience isn't required — genuine curiosity and the discipline to back an argument with evidence are.

## How it works

1. **Coffee chat.** Meet a current member and ask anything.
2. **Information session.** Learn how sections, editing and publishing work.
3. **Written application.** Submit the form on this page with a short writing sample.

## Current cycle

Fall 2026 applications are closed. The next cycle opens in Winter 2027 — leave your details and we'll tell you when it does.`,

  submit_md: `## What we publish

- **Markets & macro.** Rates, credit, equities, commodities and the forces behind them.
- **Geopolitics & policy.** How governments, central banks and regulators move markets.
- **Capitalism, technology & power.** The companies and industries reshaping the economy.
- **Deep dives.** Long-form analysis of a single deal, company or idea.
- **Fershman Views.** Opinionated essays with an economic lens.

## Guidelines

- Pitches and finished drafts are both welcome.
- Aim for 600 to 2,000 words.
- Be factual and source your claims. Link to the data wherever you can.
- An original argument beats a summary. Challenge the consensus when the evidence supports it.
- Write with a clear voice, but clarity comes first.
- Charts, tables and footnotes are encouraged, especially in data-heavy pieces.`,

  privacy_md: `*Last updated: November 1, 2026*

This policy explains what The Fershman Journal collects when you use fershman.com and what we do with it.

## What we collect

- **Newsletter sign-ups:** your email address and, if you give it, your name.
- **Forms:** the details you enter when you submit an article, apply or contact us.
- **Member accounts:** your name, email address and role, so we can give club members access to internal materials.
- **Reading statistics:** an anonymous count of how many times each article is opened. We don't track individual readers.

## How we use it

We use this information only to run the journal: to send the newsletter, reply to you, review applications and submissions, and manage member access. We never sell or rent your information.

## Who processes it

Our site is hosted on Netlify. Accounts, forms and files are stored with Supabase. The market data strip is provided by TradingView, which may set its own cookies.

## Your choices

You can unsubscribe from the newsletter at any time, and you can ask us to delete any information we hold about you by emailing us.

## Contact

Questions about this policy? Email the address on our [contact page](/contact).`,
};

// ---------------------------------------------------------------- Recruiting
export const STAGES = ["new", "reviewing", "interview", "accepted", "declined"];
export const STAGE_LABELS = { new: "New", reviewing: "Reviewing", interview: "Interview", accepted: "Accepted", declined: "Declined" };

/** Defaults for the Apply page. Everything here is editable in Admin → Recruiting. */
export const RECRUITING_DEFAULTS = {
  status: "rolling", // rolling | deadline | closed
  deadline: "",
  timezone: "America/Chicago",
  headline: "Join The Fershman Journal",
  lede: "Research, write and publish analysis on markets, deals and policy, with editors who make your work sharper. Applications are reviewed on a rolling basis, so apply whenever you're ready.",
  highlights: [
    { title: "Rolling review", text: "No deadline. We read every application as it arrives." },
    { title: "No experience required", text: "Curiosity and evidence-backed thinking matter more than a finance background." },
    { title: "Join any quarter", text: "New members start in Fall, Winter and Spring." },
  ],
  steps: [
    { title: "Have a coffee chat", text: "Optional. Talk with a current member about what writing for Fershman is actually like." },
    { title: "Come to an info session", text: "Recommended. Learn how sections, editing and publishing work, and meet the editors." },
    { title: "Apply", text: "Tell us why Fershman, pitch a story you'd write, and share a writing sample if you have one." },
    { title: "Hear back", text: "We review applications on a rolling basis and reply to everyone by email." },
  ],
  roles: [
    { title: "Writer & analyst", text: "Research and publish analysis on markets, M&A, corporate strategy and macro." },
    { title: "Section editor", text: "Shape a section's coverage and edit writers' drafts." },
    { title: "Research", text: "Build the data and models behind our quarterly U.S. risk reports." },
    { title: "Marketing & partnerships", text: "Grow the readership, run events and build relationships with partners." },
    { title: "Technology", text: "Build and maintain the site, data tools and members portal." },
    { title: "Teaching", text: "Write Learn Economics lessons and help run free workshops." },
  ],
  lookFor: [
    "Curiosity about why markets and companies behave the way they do",
    "Arguments backed by evidence, not adjectives",
    "Clear writing, or the drive to get there with editing",
    "Follow-through: you'll see a piece from pitch to publication",
  ],
  chatsIntro: "Informal conversations with current members. Ask anything about writing, editing or how the journal works.",
  hosts: [
    { author_slug: "eliazar", name: "Eliazar Marchenko", role: "Chief Executive Officer, Founder", topics: "", booking_url: "", email: "eliazar@uchicago.edu" },
    { author_slug: "samuel-regelman", name: "Samuel Regelman", role: "Analyst and Marketing Co-Director", topics: "", booking_url: "", email: "regelman@uchicago.edu" },
  ],
  sessionsIntro: "Hear how the journal works, meet the editors and get your questions answered.",
  faq: [
    { q: "Do I need finance or writing experience?", a: "No. We look for genuine interest in research-driven analysis. Editors work closely with every new writer." },
    { q: "What does \"rolling basis\" mean?", a: "There's no single deadline. We review applications as they come in throughout the year and reply by email." },
    { q: "Are coffee chats and info sessions required?", a: "No, but they're the best way to understand the role and meet the people you'd work with." },
    { q: "Can I apply for more than one role?", a: "Yes. Select every role you're interested in and we'll talk through the fit." },
    { q: "I applied before. Can I apply again?", a: "Yes. Tell us what's changed since your last application." },
  ],
  confirmation: "We'll read your application and reply by email. In the meantime, come to an info session or book a coffee chat.",
};

export function mergeRecruiting(saved) {
  const out = { ...RECRUITING_DEFAULTS };
  if (saved && typeof saved === "object") {
    for (const k of Object.keys(RECRUITING_DEFAULTS)) if (saved[k] !== undefined && saved[k] !== null) out[k] = saved[k];
  }
  return out;
}

/** open/closed state of applications from the recruiting settings. */
const dayLabel = (d) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric" });
export function activePeriod(periods = [], now = new Date()) {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const active = periods.find((p) => p.starts_on <= today && today <= p.ends_on) || null;
  const upcoming = periods.filter((p) => p.starts_on > today).sort((a, b) => a.starts_on.localeCompare(b.starts_on))[0] || null;
  return { active, upcoming };
}
export function applicationStatus(rc, now = new Date(), periods = []) {
  if (rc.status === "closed") return { open: false, tone: "closed", label: "Applications are closed right now" };
  const { active, upcoming } = activePeriod(periods, now);
  if (rc.status !== "deadline" && active) {
    return { open: true, tone: "open", period: active, label: `${active.title} is on`, sub: `Apply by ${dayLabel(active.ends_on)}` };
  }
  if (rc.status !== "deadline" && upcoming && (new Date(`${upcoming.starts_on}T12:00:00`) - now) < 45 * 86400000) {
    return { open: true, tone: "open", label: "Applications open, reviewed on a rolling basis", sub: `${upcoming.title} starts ${dayLabel(upcoming.starts_on)}` };
  }
  if (rc.status === "deadline" && rc.deadline) {
    const end = new Date(`${rc.deadline}T23:59:59`);
    const date = end.toLocaleDateString("en-US", { month: "long", day: "numeric" });
    if (end < now) return { open: false, tone: "closed", label: `Applications closed on ${date}` };
    const days = Math.ceil((end - now) / 86400000);
    return { open: true, tone: "open", label: `Applications open until ${date}`, sub: days <= 14 ? `${days} day${days === 1 ? "" : "s"} left` : "" };
  }
  return { open: true, tone: "open", label: "Applications open, reviewed on a rolling basis" };
}
