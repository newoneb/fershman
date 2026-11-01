import { db, config } from "../data/db.js";
import { html, mount, fmtDate, $ } from "../lib/util.js";
import { initChrome, setMeta } from "./chrome.js";
import { story, articleUrl, sectionUrl, sectionName, avatar, authorUrl, media, kicker, meta, skeletonCards, emptyState, errorState } from "./cards.js";

initChrome({ active: "home" });
setMeta({ title: config.site.name, description: config.site.description });
const main = $("#main");

mount(main, html`
  <div class="container">
    <div class="front">
      <section class="front-lead">${skeletonCards(1)}</section>
      <aside class="front-brief"><div class="skeleton sk-title"></div><div class="skeleton sk-line"></div><div class="skeleton sk-line"></div><div class="skeleton sk-line"></div></aside>
      <aside class="front-side">${skeletonCards(1)}</aside>
    </div>
  </div>`);

const BLOCK_SECTIONS = ["markets", "business-deals", "policy"].filter((s) => config.sections.some((x) => x.slug === s));
const PAGE = 10;

try {
  const [latest, featured, bigReads, popular, opinion, ...blocks] = await Promise.all([
    db.listArticles({ excludeSections: ["learn"], limit: 30 }),
    db.listArticles({ featured: true, excludeSections: ["learn"], limit: 6 }),
    db.listArticles({ bigRead: true, limit: 1 }),
    db.mostRead(5),
    db.listArticles({ section: "opinion", limit: 4 }),
    ...BLOCK_SECTIONS.map((s) => db.listArticles({ section: s, limit: 4 })),
  ]);

  if (!latest.length) {
    mount(main, html`<div class="container">${emptyState(
      "Nothing published yet",
      "Stories appear here as soon as an editor publishes them. Sign in to the admin panel to write the first one, or import your archive.",
      { href: "/admin/", label: "Open the admin panel" }
    )}</div>`);
  } else {
    const used = new Set();
    const take = (a) => { if (a) used.add(a.id); return a; };
    const lead = take(featured[0] || latest[0]);
    const bigRead = bigReads[0] && bigReads[0].id !== lead.id ? take(bigReads[0]) : null;
    const pool = [...featured.slice(1), ...latest].filter((a, i, arr) => arr.findIndex((b) => b.id === a.id) === i);
    const side = pool.filter((a) => !used.has(a.id)).slice(0, 3).map(take);
    const brief = latest.filter((a) => !used.has(a.id)).slice(0, 6).map(take);
    const today = fmtDate(new Date(), { month: "long", day: "numeric" });
    const filled = BLOCK_SECTIONS.map((slug, i) => ({ slug, rows: blocks[i] })).filter((b) => b.rows.length);

    mount(main, html`
      <h1 class="sr-only">${config.site.name}</h1>
      <div class="container">
        <div class="front">
          <section class="front-lead" aria-label="Top story">${story(lead, "lead", { headingLevel: 2, eager: true })}</section>
          <aside class="front-brief" aria-labelledby="brief-h">
            <div class="rail-head"><h2 id="brief-h">The Brief</h2><span>${today}</span></div>
            ${brief.length ? html`<ul class="brief-list">${brief.map((a) => html`
              <li><a href="${articleUrl(a)}"><h3>${a.title}</h3>${a.dek ? html`<p>${a.dek}</p>` : ""}</a></li>`)}</ul>`
              : html`<p class="story-dek">More stories appear here as they're published.</p>`}
          </aside>
          <aside class="front-side" aria-label="More top stories">
            ${side.map((a, i) => story(a, i === 0 ? "secondary" : "compact", { dek: true }))}
          </aside>
        </div>
      </div>

      ${bigRead ? html`
      <section class="bigread" aria-labelledby="bigread-h">
        <div class="container">
          ${media(bigRead)}
          <div>
            <p class="bigread-label" id="bigread-h">The Big Read</p>
            ${kicker(bigRead)}
            <h2 class="story-title"><a href="${articleUrl(bigRead)}">${bigRead.title}</a></h2>
            ${bigRead.dek ? html`<p class="story-dek">${bigRead.dek}</p>` : ""}
            ${meta(bigRead)}
            <a class="btn" href="${articleUrl(bigRead)}">Read the story</a>
          </div>
        </div>
      </section>` : ""}

      ${filled.length ? html`
      <div class="container">
        <div class="section-blocks" style="--blocks:${filled.length}">
          ${filled.map(({ slug, rows }) => html`
            <section class="section-block" aria-labelledby="sb-${slug}">
              <div class="rail-head"><h2 id="sb-${slug}">${sectionName(slug)}</h2><a href="${sectionUrl(slug)}">All ${sectionName(slug)}</a></div>
              ${story(rows[0], "secondary", { dek: false })}
              ${rows.slice(1).map((a) => story(a, "compact"))}
            </section>`)}
        </div>
      </div>` : ""}

      ${opinion.length ? html`
      <div class="container">
        <section class="opinion-band" aria-labelledby="op-h">
          <div class="rail-head"><h2 id="op-h">Opinion</h2><a href="/categories/opinion">All opinion</a></div>
          <div class="opinion-grid">
            ${opinion.map((a) => html`
              <article class="opinion-card">
                ${a.author ? html`<a href="${authorUrl(a.author)}" tabindex="-1" aria-hidden="true">${avatar(a.author, "avatar-md")}</a>` : avatar(null, "avatar-md")}
                <div>
                  ${a.author ? html`<a class="op-author" href="${authorUrl(a.author)}">${a.author.name}</a>` : ""}
                  <h3 class="story-title"><a href="${articleUrl(a)}">${a.title}</a></h3>
                </div>
              </article>`)}
          </div>
        </section>
      </div>` : ""}

      <div class="container">
        <div class="river-wrap">
          <section aria-labelledby="latest-h">
            <div class="rail-head"><h2 id="latest-h">Latest</h2><a href="/categories/latest">All stories</a></div>
            <div id="river">${latest.filter((a) => a.id !== lead.id).slice(0, PAGE).map((a) => story(a, "river"))}</div>
            <div class="load-more" id="more-wrap" ${latest.length > PAGE ? "" : "hidden"}><button class="btn" type="button" id="more">Load more stories</button></div>
          </section>
          <aside class="aside-stack">
            ${popular.length ? html`
            <section aria-labelledby="mr-h">
              <div class="rail-head"><h2 id="mr-h">Most read</h2></div>
              <ol class="mostread">${popular.map((a) => html`<li><a href="${articleUrl(a)}">${a.title}</a></li>`)}</ol>
            </section>` : ""}
            <section class="panel" aria-labelledby="learn-h">
              <h2 id="learn-h">${config.learn.name}</h2>
              <p>${config.learn.description}</p>
              <ul class="panel-links">${config.learn.topics.map((t) => html`<li><a href="/learn?topic=${encodeURIComponent(t)}">${t}</a></li>`)}</ul>
            </section>
            <section class="panel" aria-labelledby="sub-h">
              <h2 id="sub-h">Get the briefing</h2>
              <p>New analysis from Fershman, straight to your inbox. No spam, unsubscribe anytime.</p>
              <a class="btn btn-accent" href="/register">Subscribe</a>
            </section>
          </aside>
        </div>
      </div>`);

    let offset = PAGE + 1;
    $("#more")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "Loading…";
      try {
        const next = await db.listArticles({ excludeSections: ["learn"], limit: PAGE, offset });
        offset += next.length;
        $("#river").insertAdjacentHTML("beforeend", next.filter((a) => a.id !== lead.id).map((a) => story(a, "river").value).join(""));
        if (next.length < PAGE) $("#more-wrap").hidden = true;
      } finally {
        btn.disabled = false;
        btn.textContent = "Load more stories";
      }
    });
  }
} catch (err) {
  console.error(err);
  mount(main, html`<div class="container">${errorState(err)}</div>`);
}
