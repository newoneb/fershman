// Builds what search engines and link previews read for each public page: the title, description,
// canonical address, Open Graph and X cards, structured data, and a readable version of the content.
// Used by netlify/edge-functions/seo.js and feeds.js.
import config from "../../config.js";
import { Marked } from "../../assets/vendor/marked.esm.js";
import { applySections, topicLabel } from "../../assets/js/data/sections.js";
import * as S from "../../assets/js/lib/schema.js";

export const site = config.site;
export const abs = (path) => S.absolute(site, path);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const now = () => new Date().toISOString();
const httpUrl = (u) => (/^https?:\/\//i.test(String(u || "")) ? String(u) : "");
const fmtDay = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Reads public rows from Supabase with the publishable key (RLS shows only published content). */
export async function rest(path) {
  const { url, key } = config.supabase || {};
  if (!url || !key) return null;
  const r = await fetch(`${url}/rest/v1/${path}`, { headers: { apikey: key, Accept: "application/json" }, signal: AbortSignal.timeout(3500) });
  if (!r.ok) throw new Error(`Supabase answered ${r.status} for ${path.split("?")[0]}`);
  return r.json();
}
const PUBLISHED = () => `status=eq.published&published_at=lte.${encodeURIComponent(now())}`;
export const publishedArticles = (filter = "", select = "slug,title,dek,section,topic,published_at,updated_at,cover_url,cover_alt,author_id", limit = 30) =>
  rest(`articles?${PUBLISHED()}${filter ? `&${filter}` : ""}&select=${select}&order=published_at.desc&limit=${limit}`);

/** Sections, including ones added in Admin → Sections. */
export async function sections() {
  const rows = await rest("settings?key=eq.sections&select=value").catch(() => null);
  applySections(config, rows && rows[0] ? rows[0].value : null);
  return config.sections;
}
export async function sectionFor(slug) {
  if (slug === "learn") return { slug, name: config.learn.name, path: "/learn" };
  const s = (await sections()).find((x) => x.slug === slug);
  return s ? { ...s, path: `/categories/${s.slug}` } : null;
}

// Markdown → HTML for crawlers. Editors write the content; this still drops anything executable.
const md = new Marked({ gfm: true, breaks: false });
const clean = (h) => String(h)
  .replace(/<(script|style|iframe|object|embed|form)[\s\S]*?<\/\1>/gi, "")
  .replace(/<(script|style|iframe|object|embed|form|input|button)[^>]*\/?>/gi, "")
  .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
  .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
export const renderMarkdown = (src) => clean(md.parse(String(src || "")));

// ---------- head ----------
export function headTags({ title, description, url, image, imageAlt, type = "website", robots, extra = [], ld }) {
  const img = httpUrl(image) || S.defaultImage(site);
  const handle = S.xHandle(site);
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}">`,
    `<meta name="robots" content="${robots || "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"}">`,
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:site_name" content="${esc(site.name)}">`,
    `<meta property="og:locale" content="en_US">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:image" content="${esc(img)}">`,
    `<meta property="og:image:alt" content="${esc(imageAlt || title)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    handle ? `<meta name="twitter:site" content="${handle}">` : "",
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    `<meta name="twitter:image" content="${esc(img)}">`,
    ...extra,
    ld ? `<script type="application/ld+json" id="ld-page">${S.ldJson(ld)}</script>` : "",
  ].filter(Boolean).join("\n");
}
/** Swaps the shell's generic tags for the page's own. */
export function applyHead(html, tags) {
  const stripped = html
    .replace(/<title>[\s\S]*?<\/title>\s*/i, "")
    .replace(/<meta\s+(?:name="(?:description|robots|twitter:[^"]+)"|property="og:[^"]+")[^>]*>\s*/gi, "")
    .replace(/<link\s+rel="canonical"[^>]*>\s*/gi, "")
    .replace(/<script type="application\/ld\+json"[\s\S]*?<\/script>\s*/gi, "");
  return stripped.replace("</head>", `${tags}\n</head>`);
}

// ---------- readable content (hidden once the page's own JavaScript draws it) ----------
const list = (items) => `<ul class="ssr-list">${items.map((i) => `<li><h2><a href="${esc(i.path)}">${esc(i.name)}</a></h2>${i.dek ? `<p>${esc(i.dek)}</p>` : ""}${i.date ? `<time datetime="${esc(i.date)}">${fmtDay(i.date)}</time>` : ""}</li>`).join("")}</ul>`;
const listPage = (h1, intro, items) => `<div class="container page ssr"><header class="page-head"><h1>${esc(h1)}</h1>${intro ? `<p>${esc(intro)}</p>` : ""}</header>${items.length ? list(items) : ""}</div>`;
const articleItems = (rows) => (rows || []).map((a) => ({ name: a.title, path: `/articles/${encodeURIComponent(a.slug)}`, dek: a.dek, date: a.published_at }));
const notFound = (path, what) => ({
  status: 404,
  head: headTags({ title: `${what} not found — ${site.name}`, description: site.description, url: abs(path), robots: "noindex, follow" }),
});

// ---------- pages ----------
const STATIC = {
  "/about-us": ["About us", null],
  "/apply": ["Apply to join", "Join The Fershman Journal as a writer, analyst or editor. Info sessions, coffee chats, roles and how to apply."],
  "/submit": ["Write for Fershman", "Pitch or submit an article to The Fershman Journal."],
  "/contact": ["Contact", "Get in touch with The Fershman Journal."],
  "/register": ["Subscribe", "Get The Fershman Journal's analysis in your inbox."],
  "/privacy": ["Privacy policy", null],
};

/** Head tags, readable content and status for a path, or null to leave the page as it is. */
export async function describePage(url) {
  const path = decodeURI(url.pathname).replace(/\/+$/, "") || "/";
  const title = (t) => `${t} — ${site.name}`;

  if (path === "/" || path === "/index.html") {
    const rows = await publishedArticles("section=neq.learn");
    if (!rows) return null;
    const items = articleItems(rows);
    return {
      head: headTags({ title: S.homeTitle(site), description: site.description, url: abs("/"), ld: S.graph(S.organizationLd(site), S.websiteLd(site), S.collectionLd({ site, url: abs("/"), name: site.name, description: site.description, items })) }),
      body: listPage(site.name, site.description, items),
    };
  }

  let m = path.match(/^\/articles\/([^/]+)$/);
  if (m) {
    const rows = await rest(`articles?slug=eq.${encodeURIComponent(m[1])}&${PUBLISHED()}&select=*&limit=1`);
    if (!rows) return null;
    const a = rows[0];
    if (!a) return notFound(path, "Article");
    if (a.author_id) a.author = ((await rest(`authors?id=eq.${a.author_id}&select=slug,name,role_title,avatar_url&limit=1`)) || [])[0] || null;
    const section = (await sectionFor(a.section)) || null;
    a.topic = topicLabel(a.topic) || null;
    const url2 = abs(`/articles/${encodeURIComponent(a.slug)}`);
    const image = httpUrl(a.cover_url);
    const head = headTags({
      title: title(S.searchTitle(a)), description: S.searchDescription(a), url: url2, image, imageAlt: a.cover_alt, type: "article",
      extra: [
        a.published_at ? `<meta property="article:published_time" content="${esc(a.published_at)}">` : "",
        a.updated_at ? `<meta property="article:modified_time" content="${esc(a.updated_at)}">` : "",
        section ? `<meta property="article:section" content="${esc(section.name)}">` : "",
        a.author ? `<meta property="article:author" content="${esc(abs(`/authors/${encodeURIComponent(a.author.slug)}`))}">` : "",
        a.author ? `<meta name="author" content="${esc(a.author.name)}">` : "",
        ...[a.topic, ...(a.tags || [])].filter(Boolean).map((t) => `<meta property="article:tag" content="${esc(t)}">`),
        image ? `<link rel="preload" as="image" href="${esc(image)}" fetchpriority="high">` : "",
      ],
      ld: S.graph(S.articleLd(a, { site, url: url2, image, section }), S.organizationLd(site)),
    });
    const body = `<div class="container ssr"><article class="article"><header class="article-head">
      ${section ? `<p class="kicker"><a href="${esc(section.path)}">${esc(section.name)}</a>${a.topic ? ` / ${esc(a.topic)}` : ""}</p>` : ""}
      <h1 class="article-title">${esc(a.title)}</h1>
      ${a.dek ? `<p class="article-dek">${esc(a.dek)}</p>` : ""}
      <p class="story-meta">${a.author ? `By <a href="/authors/${esc(encodeURIComponent(a.author.slug))}">${esc(a.author.name)}</a>, ` : ""}<time datetime="${esc(a.published_at)}">${fmtDay(a.published_at)}</time></p>
    </header>
    ${image ? `<figure class="article-cover"><img src="${esc(image)}" alt="${esc(a.cover_alt || a.title)}">${a.cover_caption ? `<figcaption>${esc(a.cover_caption)}</figcaption>` : ""}</figure>` : ""}
    <div class="prose">${renderMarkdown(a.body)}</div></article></div>`;
    return { head, body };
  }

  m = path.match(/^\/authors\/([^/]+)$/);
  if (m) {
    const rows = await rest(`authors?slug=eq.${encodeURIComponent(m[1])}&select=*&limit=1`);
    if (!rows) return null;
    const p = rows[0] || S.closestAuthor((await rest("authors?select=*&limit=1000")) || [], m[1]);
    if (!p) return notFound(path, "Writer");
    const items = articleItems(await publishedArticles(`author_id=eq.${p.id}`));
    const url2 = abs(`/authors/${encodeURIComponent(p.slug)}`);
    const description = p.bio ? S.excerpt(p.bio, 160) : `${p.name}${p.role_title ? `, ${p.role_title}` : ""}. Stories by ${p.name} in ${site.name}.`;
    return {
      head: headTags({ title: title(p.name), description, url: url2, image: p.avatar_url, type: "profile", ld: S.graph(S.personLd(p, { site, url: url2 }), S.organizationLd(site)) }),
      body: listPage(p.name, [p.role_title, p.bio].filter(Boolean).join(". "), items),
    };
  }

  if (path === "/team" || path === "/authors") {
    const rows = await rest("authors?select=slug,name,role_title&order=sort_order.asc,name.asc&limit=300");
    if (!rows) return null;
    const items = rows.filter((p) => !S.isHouseByline(p)).map((p) => ({ name: p.name, path: `/authors/${encodeURIComponent(p.slug)}`, dek: p.role_title }));
    const description = `The students who write, edit and run ${site.name}.`;
    return {
      head: headTags({ title: title("Team"), description, url: abs("/team"), ld: S.graph(S.collectionLd({ site, url: abs("/team"), name: "Team", description, items })) }),
      body: listPage("Team", description, items),
    };
  }

  if (path === "/categories") {
    const all = await sections();
    const items = all.map((s) => ({ name: s.name, path: `/categories/${s.slug}`, dek: s.description })).concat([{ name: config.learn.name, path: "/learn", dek: config.learn.description }]);
    const description = `Every section of ${site.name}.`;
    return { head: headTags({ title: title("All sections"), description, url: abs("/categories"), ld: S.graph(S.collectionLd({ site, url: abs("/categories"), name: "All sections", description, items })) }), body: listPage("All sections", description, items) };
  }

  m = path.match(/^\/categories\/([^/]+)$/);
  if (m) {
    const slug = m[1];
    const latest = slug === "latest";
    const section = latest ? { name: "Latest", description: `Every story from ${site.name}, newest first.` } : await sectionFor(slug);
    const rows = await publishedArticles(latest ? "section=neq.learn" : `section=eq.${encodeURIComponent(slug)}`);
    if (!rows) return null;
    if (!section && !rows.length) return notFound(path, "Section");
    const name = section ? section.name : slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const items = articleItems(rows);
    const url2 = abs(`/categories/${slug}`);
    const description = (section && section.description) || `${name} coverage from ${site.name}.`;
    return { head: headTags({ title: title(name), description, url: url2, ld: S.graph(S.collectionLd({ site, url: url2, name, description, items })) }), body: listPage(name, description, items) };
  }

  if (path === "/learn") {
    const topic = config.learn.topics.find((t) => t.toLowerCase() === String(url.searchParams.get("topic") || "").toLowerCase()) || "";
    const rows = await publishedArticles(`section=eq.learn${topic ? `&topic=eq.${encodeURIComponent(topic)}` : ""}`, undefined, 100);
    if (!rows) return null;
    const name = topic ? `${topic} — ${config.learn.name}` : config.learn.name;
    const url2 = abs(topic ? `/learn?topic=${encodeURIComponent(topic)}` : "/learn");
    const items = articleItems(rows);
    return { head: headTags({ title: title(name), description: config.learn.description, url: url2, ld: S.graph(S.collectionLd({ site, url: url2, name, description: config.learn.description, items })) }), body: listPage(name, config.learn.description, items) };
  }

  if (path === "/search") return { head: headTags({ title: title("Search"), description: `Search ${site.name}.`, url: abs("/search"), robots: "noindex, follow" }) };

  if (STATIC[path]) {
    const [name, description] = STATIC[path];
    return { head: headTags({ title: title(name), description: description || site.description, url: abs(path) }) };
  }
  return null;
}
