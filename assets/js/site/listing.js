// Category, all-categories, authors, author, Learn and search pages.
import { db, config } from "../data/db.js";
import { html, raw, mount, routeParam, params, debounce, esc, icon, initials, safeUrl, fmtDate, $ } from "../lib/util.js";
import { initChrome, setMeta, chromeData } from "./chrome.js";
import { track } from "./analytics.js";
import { story, articleUrl, sectionUrl, avatar, authorUrl, skeletonCards, emptyState, errorState } from "./cards.js";
import { teamList, authorTeams, isMarketing, isHouseByline, mergeRecruiting } from "../data/shared.js";

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

// ---------- Team ----------
const teamId = (t) => `team-${String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
/** "Class of 2027, Economics" */
function personMeta(p) {
  const year = String(p.class_year || "").trim();
  return [year ? (/^\d{4}$/.test(year) ? `Class of ${year}` : year) : "", String(p.major || "").trim()].filter(Boolean).join(", ");
}
function portrait(p, cls = "portrait") {
  const url = safeUrl(p.avatar_url);
  const ini = initials(p.name);
  return html`<span class="${cls}">${url ? html`<img src="${url}" alt="" loading="lazy" decoding="async" data-fallback="portrait" data-initials="${ini}">` : html`<span class="portrait-initials" aria-hidden="true">${ini}</span>`}</span>`;
}
/** The Marketing team hosts coffee chats; Recruiting settings can add anyone else. */
function chatFor(p, rc) {
  const h = (rc.hosts || []).find((x) => x && x.author_slug === p.slug);
  if (!h && !isMarketing(p)) return null;
  const url = safeUrl((h && h.booking_url) || p.booking_url);
  return { url: /^https:/i.test(url) ? url : "", email: (h && h.email) || p.contact_email || "" };
}

async function authorsPage() {
  initChrome({ active: "team" });
  setMeta({ title: "Team", description: "The students who write, edit and run The Fershman Journal." });
  const shared = chromeData() || {};
  const [authors, settings] = await Promise.all([db.listAuthors(), Promise.resolve(shared.settings || db.getSettings()).catch(() => ({}))]);
  const rc = mergeRecruiting(settings && settings.recruiting);
  const people = authors.filter((a) => !isHouseByline(a));
  const order = teamList(config.authorTeams, people);
  // Each person appears once, under the first of their teams in display order. Other teams show as tags.
  const home = (p) => order.find((t) => authorTeams(p).includes(t));
  const groups = order.map((team) => ({ team, people: people.filter((p) => home(p) === team) })).filter((g) => g.people.length);
  if (!groups.length) {
    return mount(main, html`<div class="container page"><header class="page-head"><h1>Team</h1></header>${emptyState("No one here yet", "Add bylines in the admin panel and they'll appear on this page.")}</div>`);
  }
  const card = (p, team) => {
    const others = authorTeams(p).filter((t) => t !== team);
    const chat = chatFor(p, rc);
    const meta = personMeta(p);
    return html`<li><button class="person-card" type="button" data-person="${p.slug}" aria-haspopup="dialog">
      ${portrait(p)}
      <span class="pc-name">${p.name}</span>
      ${p.role_title ? html`<span class="pc-role">${p.role_title}</span>` : ""}
      ${meta ? html`<span class="pc-meta">${meta}</span>` : ""}
      ${others.length || chat ? html`<span class="pc-tags">${others.map((t) => html`<span class="tag">${t}</span>`)}${chat ? html`<span class="tag tag-chat">Coffee chats</span>` : ""}</span>` : ""}
    </button></li>`;
  };
  mount(main, html`<div class="container page team-page">
    <header class="team-hero">
      <div>
        <h1>Team</h1>
        <p class="lede">Fershman is written, edited and run by students. Leadership sets the direction, section editors shape the coverage, and analysts and staff writers do the reporting.</p>
      </div>
      <nav class="team-index" aria-label="Teams"><ul>${groups.map((g) => html`<li><a href="#${teamId(g.team)}"><span>${g.team}</span><span class="n">${g.people.length}<span class="sr-only"> ${g.people.length === 1 ? "person" : "people"}</span></span></a></li>`)}</ul></nav>
    </header>
    ${groups.map((g) => html`<section class="team-group" id="${teamId(g.team)}" aria-labelledby="${teamId(g.team)}-h">
      <header class="team-group-head"><h2 id="${teamId(g.team)}-h">${g.team}</h2><span class="n" aria-hidden="true">${g.people.length}</span></header>
      <ul class="roster">${g.people.map((p) => card(p, g.team))}</ul>
    </section>`)}
    <aside class="team-join">
      <div><h2>Join the team</h2><p>We recruit writers, analysts and editors in the fall, winter and spring. No finance background needed.</p></div>
      <a class="btn btn-accent" href="/apply">See how to apply</a>
    </aside>
  </div>`);
  main.addEventListener("click", (e) => {
    const b = e.target.closest("[data-person]");
    const p = b && people.find((x) => x.slug === b.dataset.person);
    if (p) openPerson(p, rc, b);
  });
}

/** A profile sheet from the right: the full bio, links, and the person's latest stories. */
function openPerson(p, rc, opener) {
  const chat = chatFor(p, rc);
  const meta = personMeta(p);
  const li = safeUrl(p.linkedin_url);
  const x = safeUrl(p.x_url);
  const dlg = document.createElement("dialog");
  dlg.className = "person-sheet";
  dlg.setAttribute("aria-labelledby", "ps-name");
  dlg.innerHTML = html`<div class="sheet-inner">
    <button class="icon-btn sheet-close" type="button" data-close aria-label="Close">${icon("close")}</button>
    ${portrait(p, "portrait portrait-lg")}
    <p class="sheet-teams">${authorTeams(p).join(", ")}</p>
    <h2 id="ps-name">${p.name}</h2>
    ${p.role_title ? html`<p class="sheet-role">${p.role_title}</p>` : ""}
    ${meta ? html`<p class="sheet-meta">${meta}</p>` : ""}
    ${p.bio ? html`<p class="sheet-bio">${p.bio}</p>` : ""}
    ${(chat && (chat.url || chat.email)) || li || x ? html`<div class="sheet-links">
      ${chat && chat.url ? html`<a class="btn btn-accent btn-sm" href="${chat.url}" target="_blank" rel="noopener" data-track="coffee_chat_click" data-track-host-name="${p.name}" data-track-method="booking">Book a coffee chat</a>`
        : chat && chat.email ? html`<a class="btn btn-accent btn-sm" href="mailto:${chat.email}?subject=${encodeURIComponent("Coffee chat about joining Fershman")}" data-track="coffee_chat_click" data-track-host-name="${p.name}" data-track-method="email">Email for a coffee chat</a>` : ""}
      ${li ? html`<a class="btn btn-sm" href="${li}" target="_blank" rel="noopener">${icon("linkedin")} LinkedIn</a>` : ""}
      ${x ? html`<a class="btn btn-sm" href="${x}" target="_blank" rel="noopener">${icon("x")} X</a>` : ""}
    </div>` : ""}
    <section class="sheet-stories" aria-labelledby="ps-stories"><h3 id="ps-stories">Latest stories</h3><div data-stories><p class="sheet-quiet">Loading stories…</p></div></section>
  </div>`.value;
  document.body.append(dlg);
  const close = () => {
    if (!dlg.open || dlg.classList.contains("is-closing")) return;
    dlg.classList.add("is-closing");
    setTimeout(() => dlg.close(), reduceMotion ? 0 : 180);
  };
  dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest("[data-close]")) close(); });
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  dlg.addEventListener("close", () => { dlg.remove(); if (opener && opener.isConnected) opener.focus(); });
  dlg.showModal();
  db.listArticles({ authorId: p.id, limit: 3 }).then((rows) => {
    mount($("[data-stories]", dlg), rows.length
      ? html`<ul class="sheet-list">${rows.map((a) => html`<li><a href="${articleUrl(a)}">${a.title}</a><span>${fmtDate(a.published_at)}</span></li>`)}</ul><a class="sheet-more" href="${authorUrl(p)}">All stories by ${p.name}</a>`
      : html`<p class="sheet-quiet">No published stories yet.</p>`);
  }).catch(() => mount($("[data-stories]", dlg), html`<p class="sheet-quiet"><a href="${authorUrl(p)}">Open ${p.name}'s page</a></p>`));
}

async function authorPage() {
  initChrome({ active: "team" });
  const slug = routeParam("/authors");
  const author = slug ? await db.getAuthor(slug) : null;
  if (!author) return notFound("Author not found", "We couldn't find that writer. See everyone on the team page.");
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
          ${personMeta(author) ? html`<p class="person-meta-line">${personMeta(author)}</p>` : ""}
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
