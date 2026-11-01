import { db, config } from "../data/db.js";
import { html, raw, mount, fmtDate, fmtDateTime, readMinutes, routeParam, params, safeUrl, coverArt, truncate, $ } from "../lib/util.js";
import { renderMarkdown } from "../lib/md.js";
import { isPublic, articleState, parseFigures } from "../data/shared.js";
import { initChrome, setMeta } from "./chrome.js";
import { story, kicker, avatar, authorUrl, articleUrl, sectionUrl, sectionName, shareButtons, emptyState, errorState } from "./cards.js";

const slug = routeParam("/articles");
const previewKey = params().get("preview");
const main = $("#main");

mount(main, html`<div class="article-shell"><div class="article-head"><div class="skeleton sk-line" style="width:120px"></div><div class="skeleton sk-title" style="height:52px"></div><div class="skeleton sk-title" style="height:52px;width:60%"></div><div class="skeleton sk-line"></div></div></div>`);

let article = null;
let loadError = null;
try {
  article = previewKey ? await db.getArticleForPreview(previewKey) : slug ? await db.getArticle(slug) : null;
} catch (err) {
  loadError = err;
}

initChrome({ active: article ? article.section : null });

if (loadError) {
  mount(main, html`<div class="container">${errorState(loadError)}</div>`);
} else if (!article) {
  setMeta({ title: "Article not found" });
  mount(main, html`<div class="container notfound">
    <h1>We couldn't find that story</h1>
    <p>It may have moved, or the link may be mistyped. Try searching the archive instead.</p>
    <div class="actions"><a class="btn btn-accent" href="/search${slug ? `?q=${encodeURIComponent(slug.replace(/-/g, " "))}` : ""}">Search the archive</a><a class="btn" href="/">Go to the front page</a></div>
  </div>`);
} else {
  renderArticle(article);
}

function renderArticle(a) {
  const minutes = readMinutes(a.body);
  const figures = parseFigures(a.figures);
  const cover = safeUrl(a.cover_url);
  const state = articleState(a);
  setMeta({ title: a.title, description: a.dek || truncate(a.body, 180), image: cover || undefined, url: location.origin + articleUrl(a) });

  mount(main, html`
    ${!isPublic(a) ? html`<div class="preview-banner"><div class="container">
      <span>Preview — ${state === "scheduled" ? `scheduled for ${fmtDateTime(a.published_at)}` : state === "review" ? "waiting for editor review" : "draft, not visible to readers"}.</span>
      <a href="/admin/#/articles/${a.id}">Edit in admin</a></div></div>` : ""}
    <div class="progress" aria-hidden="true"><span id="progress"></span></div>
    <article class="article" itemscope itemtype="https://schema.org/NewsArticle">
      <div class="article-shell">
        <header class="article-head">
          ${kicker(a, { showSection: true })}
          <h1 class="article-title" itemprop="headline">${a.title}</h1>
          ${a.dek ? html`<p class="article-dek" itemprop="description">${a.dek}</p>` : ""}
          <div class="article-byline">
            ${a.author ? html`
              <div class="byline-who">
                <a href="${authorUrl(a.author)}" tabindex="-1" aria-hidden="true">${avatar(a.author)}</a>
                <div>
                  <a class="byline-name" href="${authorUrl(a.author)}" itemprop="author">By ${a.author.name}</a>
                  ${a.author.role_title ? html`<span class="byline-role">${a.author.role_title}</span>` : ""}
                </div>
              </div>` : ""}
            <p class="story-meta">
              ${a.published_at ? html`<time datetime="${a.published_at}" itemprop="datePublished">${fmtDate(a.published_at, { month: "long", day: "numeric", year: "numeric" })}</time>` : html`<span>Not yet published</span>`}
              <span>${minutes} min read</span>
            </p>
            ${shareButtons(a)}
          </div>
        </header>
        ${cover || a.cover_caption ? html`
          <figure class="article-cover">
            <div class="media">${cover ? html`<img src="${cover}" alt="${a.cover_alt || ""}" fetchpriority="high" data-seed="${a.slug}" data-section="${a.section}" itemprop="image">` : coverArt(a.slug, a.section)}</div>
            ${a.cover_caption ? html`<figcaption>${a.cover_caption}</figcaption>` : ""}
          </figure>` : ""}
        <div class="article-layout">
          <div class="prose article-body" itemprop="articleBody">${raw(renderMarkdown(a.body))}</div>
          <aside class="article-rail" aria-label="Article details">
            <div class="rail-sticky">
              ${figures.length ? html`
                <section class="figures" aria-labelledby="fig-h">
                  <h2 id="fig-h">Key figures</h2>
                  <dl>${figures.map((f) => html`<div><dt>${f.value}</dt><dd>${f.label}</dd></div>`)}</dl>
                </section>` : ""}
              <section class="rail-mostread" id="rail-mostread" aria-label="Most read"></section>
            </div>
          </aside>
        </div>
        <footer class="article-end">
          ${(a.tags || []).length ? html`<div class="tags">${a.tags.map((t) => html`<a href="/search?q=${encodeURIComponent(t)}">${t}</a>`)}</div>` : ""}
          ${a.author ? html`
            <section class="author-box" aria-label="About the author">
              <a href="${authorUrl(a.author)}" tabindex="-1" aria-hidden="true">${avatar(a.author)}</a>
              <div>
                <h2><a href="${authorUrl(a.author)}">${a.author.name}</a></h2>
                ${a.author.role_title ? html`<p class="role">${a.author.role_title}</p>` : ""}
                ${a.author.bio ? html`<p class="bio">${a.author.bio}</p>` : html`<p class="bio"><a href="${authorUrl(a.author)}">More from ${a.author.name}</a></p>`}
              </div>
            </section>` : ""}
          <section class="end-cta" aria-label="Subscribe">
            <div><h2>Read the next one first</h2><p>Get new Fershman analysis in your inbox. Free, and you can unsubscribe anytime.</p></div>
            <a class="btn btn-accent" href="/register">Subscribe</a>
          </section>
        </footer>
      </div>
    </article>
    <section class="related container" id="related" aria-label="More stories"></section>`);

  // Reading progress
  const bar = $("#progress");
  const body = $(".article-body");
  const onScroll = () => {
    const r = body.getBoundingClientRect();
    const total = r.height - innerHeight * 0.6;
    const p = Math.min(1, Math.max(0, -r.top / (total > 0 ? total : 1)));
    bar.style.transform = `scaleX(${p})`;
  };
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  if (isPublic(a)) {
    const key = "fj-viewed-" + a.slug;
    try { if (!sessionStorage.getItem(key)) { sessionStorage.setItem(key, "1"); db.recordView(a.slug); } } catch (_) { db.recordView(a.slug); }
  }

  loadExtras(a);
}

async function loadExtras(a) {
  try {
    const [sameSection, popular] = await Promise.all([
      db.listArticles({ section: a.section, limit: 5 }),
      db.mostRead(5),
    ]);
    let related = sameSection.filter((x) => x.id !== a.id).slice(0, 4);
    if (related.length < 4) {
      const latest = await db.listArticles({ excludeSections: ["learn"], limit: 8 });
      related = related.concat(latest.filter((x) => x.id !== a.id && !related.some((r) => r.id === x.id))).slice(0, 4);
    }
    if (related.length) {
      mount("#related", html`
        ${related.every((r) => r.section === a.section)
          ? html`<div class="rail-head"><h2>More in ${sectionName(a.section)}</h2><a href="${sectionUrl(a.section)}">See all</a></div>`
          : html`<div class="rail-head"><h2>More from Fershman</h2><a href="/categories/latest">Latest stories</a></div>`}
        <div class="grid-cards">${related.map((r) => story(r, "secondary", { dek: false }))}</div>`);
    }
    const mr = popular.filter((x) => x.id !== a.id).slice(0, 5);
    if (mr.length) {
      mount("#rail-mostread", html`<div class="rail-head"><h2>Most read</h2></div>
        <ol class="mostread">${mr.map((x) => html`<li><a href="${articleUrl(x)}">${x.title}</a></li>`)}</ol>`);
    }
  } catch (err) {
    console.warn("Related stories unavailable", err);
  }
}
