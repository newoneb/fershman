// Story card markup shared by every public page.
import { config } from "../data/db.js";
import { html, raw, esc, safeUrl, coverArt, initials, fmtDate, icon } from "../lib/util.js";

export const sectionBySlug = (slug) => config.sections.find((s) => s.slug === slug) || (slug === "learn" ? { slug: "learn", name: config.learn.name } : null);
export const sectionName = (slug) => (sectionBySlug(slug) || {}).name || "";
export const sectionUrl = (slug) => (slug === "learn" ? "/learn" : `/categories/${slug}`);
export const articleUrl = (a) => `/articles/${encodeURIComponent(a.slug)}`;
export const authorUrl = (au) => `/authors/${encodeURIComponent(au.slug)}`;

export function kicker(a, { showSection = false } = {}) {
  const sec = sectionBySlug(a.section);
  if (!sec && !a.topic) return "";
  if (showSection && sec && a.topic) {
    return html`<p class="kicker"><a href="${sectionUrl(sec.slug)}">${sec.name}</a><span class="kicker-sep">/</span><span>${a.topic}</span></p>`;
  }
  const label = a.section === "opinion" ? "Opinion" : a.topic || (sec && sec.name);
  return html`<p class="kicker${a.section === "opinion" ? " label-opinion" : ""}"><a href="${sec ? sectionUrl(sec.slug) : "#"}">${label}</a></p>`;
}

export function media(a, { cls = "", eager = false } = {}) {
  const url = safeUrl(a.cover_url);
  const inner = url
    ? html`<img src="${url}" alt="${a.cover_alt || ""}" ${raw(eager ? 'fetchpriority="high"' : 'loading="lazy"')} decoding="async" data-seed="${a.slug}" data-section="${a.section}">`
    : coverArt(a.slug, a.section);
  return html`<a class="media ${cls}" href="${articleUrl(a)}" tabindex="-1" aria-hidden="true">${inner}</a>`;
}

export function meta(a, { byline = true, date = true, minutes = false } = {}) {
  const parts = [];
  if (byline && a.author) parts.push(html`<a class="byline" href="${authorUrl(a.author)}">${a.author.name}</a>`);
  if (date && a.published_at) parts.push(html`<time datetime="${a.published_at}">${fmtDate(a.published_at)}</time>`);
  if (minutes) parts.push(html`<span>${minutes} min read</span>`);
  return parts.length ? html`<p class="story-meta">${parts}</p>` : "";
}

/** variant: lead | secondary | compact | river */
export function story(a, variant = "secondary", opts = {}) {
  const { image = variant !== "compact", dek = variant !== "compact" || opts.dek, headingLevel = 3, eager = false } = opts;
  const h = raw(`h${headingLevel}`);
  const showImage = image && (variant !== "river" || opts.riverImage !== false);
  const body = html`
    <div class="story-body">
      ${kicker(a)}
      <${h} class="story-title"><a href="${articleUrl(a)}">${a.title}</a></${h}>
      ${dek && a.dek ? html`<p class="story-dek">${a.dek}</p>` : ""}
      ${meta(a)}
    </div>`;
  if (variant === "river") {
    return html`<article class="story story--river">${body}${showImage ? media(a) : html`<span></span>`}</article>`;
  }
  return html`<article class="story story--${variant}">${showImage ? media(a, { eager }) : ""}${body}</article>`;
}

export function avatar(author, cls = "") {
  if (!author) return html`<span class="avatar ${cls}" aria-hidden="true">F</span>`;
  const url = safeUrl(author.avatar_url);
  return url
    ? html`<span class="avatar ${cls}"><img src="${url}" alt="" loading="lazy" data-fallback="avatar" data-initials="${initials(author.name)}"></span>`
    : html`<span class="avatar ${cls}" aria-hidden="true">${initials(author.name)}</span>`;
}

export function skeletonCards(n = 3) {
  return raw(Array.from({ length: n }, () => `<div><div class="skeleton sk-media"></div><div class="skeleton sk-title"></div><div class="skeleton sk-line"></div><div class="skeleton sk-line" style="width:60%"></div></div>`).join(""));
}

export function emptyState(title, text, action) {
  return html`<div class="empty"><h2>${title}</h2><p>${text}</p>${action ? html`<a class="btn" href="${action.href}">${action.label}</a>` : ""}</div>`;
}

export function errorState(err) {
  return html`<div class="empty"><h2>This page couldn't load</h2><p>${(err && err.message) || "Something went wrong."}</p><a class="btn" href="${location.pathname + location.search}">Try again</a></div>`;
}

export function shareButtons(a) {
  const url = location.origin + articleUrl(a);
  const t = encodeURIComponent(a.title);
  const u = encodeURIComponent(url);
  return html`
    <div class="share" aria-label="Share">
      <button class="icon-btn" type="button" data-share-copy="${url}" title="Copy link" aria-label="Copy link">${icon("link")}</button>
      <a class="icon-btn" href="https://x.com/intent/post?text=${raw(t)}&url=${raw(u)}" target="_blank" rel="noopener" title="Share on X" aria-label="Share on X">${icon("x")}</a>
      <a class="icon-btn" href="https://www.linkedin.com/sharing/share-offsite/?url=${raw(u)}" target="_blank" rel="noopener" title="Share on LinkedIn" aria-label="Share on LinkedIn">${icon("linkedin")}</a>
      <a class="icon-btn" href="mailto:?subject=${raw(t)}&body=${raw(u)}" title="Email" aria-label="Share by email">${icon("mail")}</a>
      <button class="icon-btn" type="button" data-print title="Print" aria-label="Print">${icon("printer")}</button>
    </div>`;
}

export { esc };
