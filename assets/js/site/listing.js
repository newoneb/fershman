// Category, all-categories, authors, author, Learn and search pages.
import { db, config } from "../data/db.js";
import { html, raw, mount, routeParam, params, debounce, esc, $ } from "../lib/util.js";
import { initChrome, setMeta } from "./chrome.js";
import { track } from "./analytics.js";
import { story, articleUrl, sectionUrl, avatar, authorUrl, skeletonCards, emptyState, errorState } from "./cards.js";
import { teamList, authorTeams } from "../data/shared.js";

const page = document.body.dataset.page;
const main = $("#main");
const PAGE = 12;

const loading = html`<div class="container"><div class="page-head"><div class="skeleton sk-title" style="width:40%;height:48px"></div></div><div class="grid-cards">${skeletonCards(6)}</div></div>`;
mount(main, loading);

function notFound(title, text) {
  setMeta({ title });
  mount(main, html`<div class="container notfound"><h1>${title}</h1><p>${text}</p><div class="actions"><a class="btn btn-accent" href="/">Go to the front page</a><a class="btn" href="/categories">All categories</a></div></div>`);
}

function pager(fetchMore, renderItem, containerSel, startOffset, hasMore) {
  const wrap = $("#more-wrap");
  if (!wrap) return;
  wrap.hidden = !hasMore;
  let offset = startOffset;
  $("#more").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const next = await fetchMore(offset);
      offset += next.length;
      $(containerSel).insertAdjacentHTML("beforeend", next.map((a) => renderItem(a).value).join(""));
      if (next.length < PAGE) wrap.hidden = true;
    } finally { btn.disabled = false; }
  });
}
const moreButton = raw(`<div class="load-more" id="more-wrap" hidden><button class="btn" type="button" id="more">Load more</button></div>`);

async function categoryPage() {
  const slug = routeParam("/categories") || "latest";
  const isLatest = slug === "latest";
  const section = config.sections.find((s) => s.slug === slug);
  initChrome({ active: isLatest ? "latest" : slug });
  if (!isLatest && !section) return notFound("Section not found", "That section doesn't exist. Browse all categories instead.");
  const name = isLatest ? "Latest" : section.name;
  const desc = isLatest ? "Every story from The Fershman Journal, newest first." : section.description;
  setMeta({ title: name, description: desc });
  const query = (offset, limit) => db.listArticles(isLatest ? { excludeSections: ["learn"], offset, limit } : { section: slug, offset, limit });
  const rows = await query(0, PAGE + 5);
  const head = html`<header class="page-head"><h1>${name}</h1>${desc ? html`<p>${desc}</p>` : ""}
    ${isLatest ? html`<nav class="tabs" aria-label="Sections">${config.sections.map((s) => html`<a class="tab" href="/categories/${s.slug}">${s.name}</a>`)}</nav>` : ""}</header>`;
  if (!rows.length) {
    return mount(main, html`<div class="container">${head}${emptyState("No stories here yet", `Nothing has been published in ${name} so far. Check back soon, or browse the latest stories.`, { href: "/categories/latest", label: "See the latest" })}</div>`);
  }
  const [lead, ...rest] = rows;
  const side = rest.slice(0, 4);
  const grid = rest.slice(4);
  mount(main, html`<div class="container page">
    ${head}
    <div class="category-lead">
      ${story(lead, "lead", { headingLevel: 2, eager: true })}
      <div class="side-list">${side.map((a) => story(a, "compact", { dek: true }))}</div>
    </div>
    <div class="grid-cards" id="grid">${grid.map((a) => story(a, "secondary"))}</div>
    ${moreButton}
  </div>`);
  pager((offset) => query(offset, PAGE), (a) => story(a, "secondary"), "#grid", rows.length, rows.length === PAGE + 5);
}

async function categoriesPage() {
  initChrome({ active: null });
  setMeta({ title: "All categories", description: "Browse every section of The Fershman Journal." });
  const lists = await Promise.all(config.sections.map((s) => db.listArticles({ section: s.slug, limit: 3 })));
  mount(main, html`<div class="container">
    <header class="page-head"><h1>All categories</h1><p>Every section of the journal, with its latest stories.</p></header>
    <div class="all-categories">
      ${config.sections.map((s, i) => html`
        <section class="cat-card">
          <h2><a href="/categories/${s.slug}">${s.name}</a></h2>
          <p>${s.description}</p>
          ${lists[i].length ? html`<ul>${lists[i].map((a) => html`<li><a href="${articleUrl(a)}">${a.title}</a></li>`)}</ul>` : html`<p>No stories yet.</p>`}
        </section>`)}
      <section class="cat-card">
        <h2><a href="/learn">${config.learn.name}</a></h2>
        <p>${config.learn.description}</p>
        <ul>${config.learn.topics.map((t) => html`<li><a href="/learn?topic=${encodeURIComponent(t)}">${t}</a></li>`)}</ul>
      </section>
    </div>
  </div>`);
}

async function authorsPage() {
  initChrome({ active: null });
  setMeta({ title: "Authors", description: "The analysts, editors and writers behind The Fershman Journal." });
  const authors = await db.listAuthors();
  const teams = teamList(config.authorTeams, authors);
  const grouped = teams.map((t) => ({ team: t, people: authors.filter((a) => authorTeams(a).includes(t)) })).filter((g) => g.people.length);
  mount(main, html`<div class="container page">
    <header class="page-head"><h1>Authors</h1><p>The analysts, editors and writers behind the journal.</p></header>
    ${grouped.length ? grouped.map((g) => html`
      <section class="team" aria-label="${g.team}">
        <h2>${g.team}</h2>
        <ul class="people">${g.people.map((p) => html`
          <li><a class="person" href="${authorUrl(p)}">${avatar(p, "avatar-md")}<div><div class="person-name">${p.name}</div>${p.role_title ? html`<div class="person-role">${p.role_title}</div>` : ""}</div></a></li>`)}
        </ul>
      </section>`) : emptyState("No authors yet", "Add authors in the admin panel and they'll be listed here.")}
  </div>`);
}

async function authorPage() {
  initChrome({ active: null });
  const slug = routeParam("/authors");
  const author = slug ? await db.getAuthor(slug) : null;
  if (!author) return notFound("Author not found", "We couldn't find that writer. See everyone on the authors page.");
  setMeta({ title: author.name, description: author.bio || `${author.name}${author.role_title ? `, ${author.role_title}` : ""} at The Fershman Journal.` });
  const query = (offset, limit) => db.listArticles({ authorId: author.id, offset, limit });
  const rows = await query(0, PAGE);
  mount(main, html`<div class="container page">
    <header class="page-head">
      <div class="author-head">
        ${avatar(author, "avatar-lg")}
        <div>
          <h1>${author.name}</h1>
          ${author.role_title ? html`<p class="role" style="font-style:normal">${author.role_title}</p>` : ""}
          ${author.bio ? html`<p class="bio" style="font-style:normal">${author.bio}</p>` : ""}
          ${author.x_url || author.linkedin_url ? html`<div class="author-links">
            ${author.linkedin_url ? html`<a href="${author.linkedin_url}" target="_blank" rel="noopener">LinkedIn</a>` : ""}
            ${author.x_url ? html`<a href="${author.x_url}" target="_blank" rel="noopener">X</a>` : ""}</div>` : ""}
        </div>
      </div>
    </header>
    <div class="river-wrap" style="border-top:0;padding-top:0">
      <section aria-label="Stories by ${author.name}">
        ${rows.length ? html`<div id="river">${rows.map((a) => story(a, "river"))}</div>${moreButton}` : emptyState("No published stories yet", `${author.name}'s stories will appear here once they're published.`)}
      </section>
      <aside class="aside-stack">
        <section class="panel"><h2>Write for Fershman</h2><p>Have an argument the market is missing? Pitch us.</p><a class="btn" href="/submit">Submit an article</a></section>
      </aside>
    </div>
  </div>`);
  pager((offset) => query(offset, PAGE), (a) => story(a, "river"), "#river", rows.length, rows.length === PAGE);
}

async function learnPage() {
  initChrome({ active: "learn" });
  const L = config.learn;
  const topicParam = routeParam("/learn", "topic");
  const topic = L.topics.find((t) => t.toLowerCase() === String(topicParam).toLowerCase()) || "";
  setMeta({ title: topic ? `${topic} — ${L.name}` : L.name, description: L.description });
  const rows = await db.listArticles({ section: "learn", topic: topic || undefined, limit: 60 });
  mount(main, html`<div class="container">
    <header class="learn-hero">
      <h1>${L.name}</h1>
      <p>${L.description} Each lesson starts with the question, then builds the idea step by step.</p>
    </header>
    <nav class="tabs" aria-label="Topics" style="margin-bottom:28px">
      <a class="tab" href="/learn" ${!topic ? raw('aria-current="page"') : ""}>All lessons</a>
      ${L.topics.map((t) => html`<a class="tab" href="/learn?topic=${encodeURIComponent(t)}" ${t === topic ? raw('aria-current="page"') : ""}>${t}</a>`)}
    </nav>
    ${rows.length ? html`<div class="lessons">${rows.map((a) => story(a, "secondary"))}</div>`
      : emptyState("Lessons are on the way", topic ? `No ${topic} lessons yet.` : "No lessons have been published yet.", { href: "/submit", label: "Suggest a lesson" })}
  </div>`);
}

let searchTimer = 0;
let lastSearch = "";
/** Count a search once the reader stops typing. */
function trackSearch(term, results) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    if (term.toLowerCase() === lastSearch) return;
    lastSearch = term.toLowerCase();
    track("search", { search_term: term, results });
  }, 1500);
}

async function searchPage() {
  initChrome({ active: null });
  setMeta({ title: "Search" });
  const initial = params().get("q") || "";
  mount(main, html`<div class="container-narrow page" style="padding-top:clamp(28px,5vw,56px)">
    <form class="search-box" role="search" id="search-form">
      ${raw('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>')}
      <label class="sr-only" for="q">Search the journal</label>
      <input id="q" name="q" type="search" placeholder="Search the journal" autocomplete="off" value="${initial}">
    </form>
    <p class="search-status" id="status" aria-live="polite"></p>
    <div class="search-results" id="results"></div>
  </div>`);
  const input = $("#q");
  const highlight = (text, terms) => {
    let out = esc(text || "");
    for (const t of terms) {
      if (t.length < 2) continue;
      out = out.replace(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"), "<mark>$1</mark>");
    }
    return raw(out);
  };
  let seq = 0;
  const run = async (q) => {
    const id = ++seq;
    const url = new URL(location.href);
    q ? url.searchParams.set("q", q) : url.searchParams.delete("q");
    history.replaceState(null, "", url);
    if (q.trim().length < 2) { mount("#status", "Type at least two characters."); mount("#results", ""); return; }
    mount("#status", "Searching…");
    try {
      const rows = await db.searchArticles(q, 30);
      if (id !== seq) return;
      trackSearch(q.trim(), rows.length);
      const terms = q.trim().split(/\s+/);
      mount("#status", rows.length ? `${rows.length} result${rows.length === 1 ? "" : "s"} for “${q.trim()}”` : `No results for “${q.trim()}”. Try a company, a person or a broader term.`);
      mount("#results", rows.map((a) => {
        const card = story(a, "river");
        // highlight title & dek
        return raw(card.value
          .replace(`>${esc(a.title)}</a>`, `>${highlight(a.title, terms).value}</a>`)
          .replace(a.dek ? `>${esc(a.dek)}</p>` : "\u0000", a.dek ? `>${highlight(a.dek, terms).value}</p>` : ""));
      }));
    } catch (err) {
      mount("#status", err.message || "Search failed.");
    }
  };
  input.addEventListener("input", debounce(() => run(input.value), 260));
  $("#search-form").addEventListener("submit", (e) => { e.preventDefault(); run(input.value); });
  input.focus();
  if (initial) run(initial);
  else mount("#status", "Search every story, lesson and author note.");
}

const routes = { category: categoryPage, categories: categoriesPage, authors: authorsPage, author: authorPage, learn: learnPage, search: searchPage };
try {
  await (routes[page] || categoryPage)();
} catch (err) {
  console.error(err);
  if (!document.querySelector(".site-header")) initChrome({});
  mount(main, html`<div class="container">${errorState(err)}</div>`);
}
