// /sitemap.xml (every public page, with lastmod and cover images), /news-sitemap.xml (the last
// two days, for Google News) and /feed.xml (RSS 2.0, the latest 50 stories). Built live from Supabase.
import siteConfig from "../../config.js";
import { site, abs, esc, rest, publishedArticles, sections } from "../lib/pages.js";
import { topicLabel } from "../../assets/js/data/sections.js";
import { searchDescription, isHouseByline } from "../../assets/js/lib/schema.js";

const xml = (body, type) => new Response(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`, {
  headers: { "content-type": `${type}; charset=utf-8`, "Netlify-CDN-Cache-Control": "public, durable, s-maxage=600, stale-while-revalidate=86400" },
});
const loc = (path) => esc(abs(path));
const day = (iso) => (iso ? String(iso).slice(0, 10) : "");

async function sitemap() {
  const [articles, authors, secs] = await Promise.all([
    publishedArticles("", "slug,title,updated_at,published_at,cover_url,section", 5000),
    rest("authors?select=slug,name,role_title,updated_at&limit=1000"),
    sections(),
  ]);
  const newest = (articles && articles[0] && (articles[0].updated_at || articles[0].published_at)) || new Date().toISOString();
  const url = (path, lastmod, extra = "") => `<url><loc>${loc(path)}</loc>${lastmod ? `<lastmod>${day(lastmod)}</lastmod>` : ""}${extra}</url>`;
  const pages = [
    url("/", newest), url("/categories/latest", newest), url("/categories"), url("/learn", newest), url("/team"),
    url("/about-us"), url("/apply"), url("/submit"), url("/contact"), url("/register"),
    ...secs.map((s) => url(`/categories/${s.slug}`, newest)),
    ...siteConfig.learn.topics.map((t) => url(`/learn?topic=${encodeURIComponent(t)}`)),
    ...(authors || []).filter((p) => !isHouseByline(p)).map((p) => url(`/authors/${encodeURIComponent(p.slug)}`, p.updated_at)),
    ...(articles || []).map((a) => url(`/articles/${encodeURIComponent(a.slug)}`, a.updated_at || a.published_at,
      /^https?:\/\//.test(a.cover_url || "") ? `<image:image><image:loc>${esc(a.cover_url)}</image:loc></image:image>` : "")),
  ];
  return `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${pages.join("\n")}\n</urlset>`;
}

async function newsSitemap() {
  const since = new Date(Date.now() - 2 * 864e5).toISOString();
  const rows = (await publishedArticles(`section=neq.learn&published_at=gte.${encodeURIComponent(since)}`, "slug,title,published_at", 1000)) || [];
  const items = rows.map((a) => `<url><loc>${loc(`/articles/${encodeURIComponent(a.slug)}`)}</loc><news:news><news:publication><news:name>${esc(site.name)}</news:name><news:language>en</news:language></news:publication><news:publication_date>${esc(a.published_at)}</news:publication_date><news:title>${esc(a.title)}</news:title></news:news></url>`);
  return `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n${items.join("\n")}\n</urlset>`;
}

async function rss() {
  const [rows, authors, secs] = await Promise.all([
    publishedArticles("", "slug,title,dek,body,section,topic,published_at,cover_url,author_id", 50),
    rest("authors?select=id,name&limit=1000"),
    sections(),
  ]);
  const names = new Map((authors || []).map((p) => [p.id, p.name]));
  const secName = (s) => (s === "learn" ? siteConfig.learn.name : (secs.find((x) => x.slug === s) || {}).name || "");
  const items = (rows || []).map((a) => {
    const link = loc(`/articles/${encodeURIComponent(a.slug)}`);
    return `<item><title>${esc(a.title)}</title><link>${link}</link><guid isPermaLink="true">${link}</guid><pubDate>${new Date(a.published_at).toUTCString()}</pubDate>`
      + `<description>${esc(searchDescription(a))}</description>`
      + (names.get(a.author_id) ? `<dc:creator>${esc(names.get(a.author_id))}</dc:creator>` : "")
      + (secName(a.section) ? `<category>${esc(secName(a.section))}</category>` : "")
      + (a.topic ? `<category>${esc(topicLabel(a.topic))}</category>` : "")
      + (/^https?:\/\//.test(a.cover_url || "") ? `<media:content url="${esc(a.cover_url)}" medium="image"/>` : "")
      + `</item>`;
  });
  return `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">
<channel><title>${esc(site.name)}</title><link>${loc("/")}</link><description>${esc(site.description)}</description><language>en</language>
<atom:link href="${loc("/feed.xml")}" rel="self" type="application/rss+xml"/>
<image><url>${loc("/assets/img/apple-touch-icon.png")}</url><title>${esc(site.name)}</title><link>${loc("/")}</link></image>
${rows && rows[0] ? `<lastBuildDate>${new Date(rows[0].published_at).toUTCString()}</lastBuildDate>` : ""}
${items.join("\n")}
</channel></rss>`;
}

export default async (request) => {
  const path = new URL(request.url).pathname;
  try {
    if (path === "/sitemap.xml") return xml(await sitemap(), "application/xml");
    if (path === "/news-sitemap.xml") return xml(await newsSitemap(), "application/xml");
    return xml(await rss(), "application/rss+xml");
  } catch (err) {
    console.error("[feeds]", err.message);
    return new Response("This feed is briefly unavailable.", { status: 503, headers: { "retry-after": "300", "content-type": "text/plain" } });
  }
};

export const config = { path: ["/sitemap.xml", "/news-sitemap.xml", "/feed.xml", "/rss.xml"], cache: "manual" };
