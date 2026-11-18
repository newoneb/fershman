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
export const searchTitle = (a) => String(a.seo_title || a.title || "").trim();
export const searchDescription = (a) => String(a.seo_description || a.dek || "").trim() || excerpt(a.body, 160);
export const homeTitle = (site) => site.seoTitle || `${site.name} — M&A, Markets and Financial Policy Analysis`;

export const absolute = (site, path = "/") => (/^https?:/i.test(path) ? path : `${String(site.url || "").replace(/\/$/, "")}${path}`);
export const defaultImage = (site) => absolute(site, "/assets/img/og-default.png");
export const xHandle = (site) => {
  const m = String((site.social || {}).x || "").match(/(?:x|twitter)\.com\/([A-Za-z0-9_]+)/);
  return m ? `@${m[1]}` : "";
};
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
    sameAs: Object.values(site.social || {}).filter(Boolean),
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
      sameAs: [p.linkedin_url, p.x_url].filter(Boolean),
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
