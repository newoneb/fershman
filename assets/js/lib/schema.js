// Search snippets and structured data (schema.org JSON-LD), shared by the browser and by the
// Netlify edge function that prepares pages for search engines and link previews
// (netlify/edge-functions/seo.js). Keep this file free of browser APIs.

const strip = (md) => String(md || "")
  .replace(/```[\s\S]*?```/g, " ")
  .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/\[\^[^\]]+\]/g, "")
  .replace(/<[^>]+>/g, " ")
  .replace(/^#{1,6}\s+/gm, "")
  .replace(/[*_`>#|~]/g, "")
  .replace(/\s+/g, " ")
  .trim();

/** Plain-text summary of Markdown, cut at a word boundary. */
export function excerpt(md, max = 160) {
  const t = strip(md);
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${cut.slice(0, at > 60 ? at : cut.length).replace(/[,;:.\s]+$/, "")}…`;
}

/** What search engines show: the SEO fields from the editor, or the headline and standfirst. */
/**
 * Adds https:// to web addresses typed without it, like "www.linkedin.com/in/name" or "x.com/name".
 * Without it, browsers treat them as pages on this site. Paths, anchors and other schemes are left alone.
 */
export function withScheme(url) {
  const u = String(url ?? "").trim();
  if (!u) return "";
  if (u.startsWith("//")) return `https:${u}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) || /^[/#?.]/.test(u)) return u;
  const host = u.split(/[/?#]/)[0];
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}(:\d+)?$/i.test(host) && !/\.(png|jpe?g|gif|webp|avif|svg|pdf|html?|js|css|md|txt)$/i.test(host)) return `https://${u}`;
  return u;
}

export const searchTitle = (a) => String(a.seo_title || a.title || "").trim();
export const searchDescription = (a) => String(a.seo_description || a.dek || "").trim() || excerpt(a.body, 160);
export const homeTitle = (site) => site.seoTitle || `${site.name} — M&A, Markets and Financial Policy Analysis`;

export const absolute = (site, path = "/") => (/^https?:/i.test(path) ? path : `${String(site.url || "").replace(/\/$/, "")}${path}`);
export const defaultImage = (site) => absolute(site, "/assets/img/og-default.png");
export const xHandle = (site) => {
  const m = String((site.social || {}).x || "").match(/(?:x|twitter)\.com\/([A-Za-z0-9_]+)/);
  return m ? `@${m[1]}` : "";
};
/**
 * The byline a writer-page address most likely means, when it doesn't match exactly: the same name
 * written as an address, or an address one or two letters off (an old typo that's since been fixed).
 */
export function closestAuthor(list, slug) {
  const want = String(slug || "").toLowerCase();
  if (!want) return null;
  const asSlug = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const dist = (a, b) => {
    if (Math.abs(a.length - b.length) > 2) return 3;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  };
  return list.find((a) => String(a.slug).toLowerCase() === want)
    || list.find((a) => asSlug(a.name) === want)
    || list.map((a) => [a, dist(String(a.slug).toLowerCase(), want)]).filter(([, d]) => d <= 2).sort((x, y) => x[1] - y[1]).map(([a]) => a)[0]
    || null;
}

export const isHouseByline = (a) => Boolean(a) && (a.slug === "editors" || /^house\b/i.test(a.role_title || ""));

export function organizationLd(site) {
  return {
    "@type": "NewsMediaOrganization",
    "@id": absolute(site, "/#organization"),
    name: site.name,
    alternateName: site.shortName,
    url: absolute(site, "/"),
    logo: { "@type": "ImageObject", url: absolute(site, "/assets/img/apple-touch-icon.png"), width: 180, height: 180 },
    description: site.description,
    sameAs: Object.values(site.social || {}).map(withScheme).filter(Boolean),
    email: site.contactEmail || undefined,
  };
}
export function websiteLd(site) {
  return {
    "@type": "WebSite",
    "@id": absolute(site, "/#website"),
    name: site.name,
    alternateName: site.shortName,
    url: absolute(site, "/"),
    inLanguage: "en",
    publisher: { "@id": absolute(site, "/#organization") },
  };
}
const crumbs = (site, list) => ({
  "@type": "BreadcrumbList",
  itemListElement: list.filter(Boolean).map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: absolute(site, c.path) })),
});

/** An article or lesson, with its breadcrumb trail. */
export function articleLd(a, { site, url, image, section }) {
  const author = a.author && !isHouseByline(a.author)
    ? { "@type": "Person", name: a.author.name, url: absolute(site, `/authors/${encodeURIComponent(a.author.slug)}`), jobTitle: a.author.role_title || undefined }
    : { "@type": "Organization", name: site.name, url: absolute(site, "/") };
  const lesson = a.section === "learn";
  return [
    {
      "@type": lesson ? "Article" : "NewsArticle",
      "@id": `${url}#article`,
      mainEntityOfPage: { "@type": "WebPage", "@id": url },
      url,
      headline: String(a.title || "").slice(0, 110),
      description: searchDescription(a),
      image: image ? [image] : undefined,
      datePublished: a.published_at || undefined,
      dateModified: a.updated_at || a.published_at || undefined,
      author: [author],
      publisher: { "@id": absolute(site, "/#organization") },
      articleSection: section ? section.name : undefined,
      keywords: [a.topic, ...(a.tags || [])].filter(Boolean).join(", ") || undefined,
      inLanguage: "en",
      isAccessibleForFree: true,
      learningResourceType: lesson ? "Lesson" : undefined,
    },
    crumbs(site, [{ name: "Home", path: "/" }, section && { name: section.name, path: section.path }, { name: String(a.title || ""), path: url }]),
  ];
}

/** An author's page. */
export function personLd(p, { site, url }) {
  return {
    "@type": "ProfilePage",
    url,
    mainEntity: {
      "@type": "Person",
      name: p.name,
      url,
      jobTitle: p.role_title || undefined,
      description: p.bio || undefined,
      image: p.avatar_url || undefined,
      sameAs: [p.linkedin_url, p.x_url].map(withScheme).filter(Boolean),
      worksFor: { "@id": absolute(site, "/#organization") },
    },
  };
}

/** A section, the team, the lesson hub: a page that lists other pages. */
export function collectionLd({ site, url, name, description, items = [] }) {
  return {
    "@type": "CollectionPage",
    url,
    name,
    description: description || undefined,
    isPartOf: { "@id": absolute(site, "/#website") },
    mainEntity: {
      "@type": "ItemList",
      itemListElement: items.slice(0, 30).map((it, i) => ({ "@type": "ListItem", position: i + 1, url: absolute(site, it.path), name: it.name })),
    },
  };
}

export const graph = (...nodes) => ({ "@context": "https://schema.org", "@graph": nodes.flat().filter(Boolean) });
/** JSON safe to place inside a <script> tag. */
export const ldJson = (data) => JSON.stringify(data).replace(/</g, "\\u003c");
