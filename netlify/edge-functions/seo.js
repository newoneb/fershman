// Gives every public page its real title, description, canonical address, social card and
// structured data before it leaves the server, plus a readable copy of the content for crawlers
// that don't run JavaScript (Bing, LinkedIn, X, Slack, iMessage, AI search). Unknown articles,
// writers and sections get a real 404. If anything goes wrong, the page is sent unchanged.
import { describePage, applyHead } from "../lib/pages.js";

export default async (request, context) => {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.searchParams.has("preview")) return;
  const res = await context.next();
  if (!(res.headers.get("content-type") || "").includes("text/html")) return res;
  let page;
  try { page = await describePage(url); } catch (err) { console.error("[seo]", err.message); return res; }
  if (!page) return res;
  let html = await res.text();
  html = applyHead(html, page.head);
  if (page.body) html = html.replace(/<main id="main"([^>]*)><\/main>/, `<main id="main"$1>${page.body}</main>`);
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("Netlify-CDN-Cache-Control", "public, durable, s-maxage=120, stale-while-revalidate=86400");
  headers.set("Netlify-Vary", "query=topic");
  return new Response(html, { status: page.status || res.status, headers });
};

export const config = {
  path: "/*",
  excludedPath: ["/assets/*", "/admin/*", "/portal/*", "/content/*", "/supabase/*", "/tools/*", "/config.js", "/robots.txt", "/sitemap.xml", "/news-sitemap.xml", "/feed.xml", "/rss.xml", "/*.ico", "/*.png", "/*.svg", "/*.jpg", "/*.webp", "/*.css", "/*.js", "/*.json", "/*.txt", "/*.xml"],
  cache: "manual",
};
