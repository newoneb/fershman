// Portal: sign in, applications, and the members library.
import { db, LIVE, config, dbError } from "../data/db.js";
import { html, raw, mount, icon, fmtDate, fmtBytes, debounce, params, $, $$ } from "../lib/util.js";
import { toast, installImageFallbacks } from "../lib/ui.js";
import { roleAtLeast, itemKind, friendlyError } from "../data/shared.js";
import { renderAuth } from "../shared/auth-ui.js";
import { kindIcon, kindLabel, openUploadPanel, openViewer } from "../shared/portal-ui.js";
import { applicationView } from "./application.js";

const root = document.getElementById("app");
const TYPE_GROUPS = {
  all: { label: "All", kinds: null },
  decks: { label: "Slides & PDFs", kinds: ["pdf", "slides", "gslides"] },
  docs: { label: "Documents & models", kinds: ["doc", "sheet", "file", "image"] },
  video: { label: "Video", kinds: ["video", "audio"] },
  links: { label: "Links", kinds: ["link"] },
};
const DEMO_ROLES = [["admin", "Admin"], ["editor", "Editor"], ["writer", "Writer"], ["member", "Member"], ["pending", "Applicant"]];

let session = null;
let myApp = null;

function shell(view) {
  const role = session.profile.role;
  const member = roleAtLeast(role, "member");
  const tab = (href, label, key) => html`<a href="${href}" ${view === key ? raw('aria-current="page"') : ""}>${label}</a>`;
  return html`
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="portal-top"><div class="container">
      <a class="portal-brand" href="/portal/"><strong>${config.site.shortName}</strong><span>Portal</span></a>
      <nav class="portal-nav" aria-label="Portal">
        ${member ? tab("/portal/#library", "Library", "library") : ""}
        ${!member || myApp ? tab("/portal/#application", "Your application", "application") : ""}
        ${roleAtLeast(role, "writer") ? html`<a href="/admin/">Admin</a>` : ""}
      </nav>
      <span class="spacer"></span>
      <a class="btn btn-ghost btn-sm" href="/">The journal</a>
      <button class="btn btn-ghost btn-sm" type="button" data-signout>Sign out</button>
    </div></header>
    ${LIVE ? "" : html`<div class="app-banner row" role="note"><span>Demo mode: the portal uses sample files and keeps everything in this browser only.</span><span class="spacer"></span><label class="row" style="gap:8px;flex-wrap:nowrap">View as <select class="select" data-demo-role style="min-height:32px;padding:4px 8px;width:auto">${DEMO_ROLES.map(([r, l]) => html`<option value="${r}" ${r === role ? raw("selected") : ""}>${l}</option>`)}</select></label></div>`}
    <main id="main" class="container portal-main" tabindex="-1"></main>`;
}

async function route() {
  const hash = location.hash.replace(/^#/, "");
  const member = roleAtLeast(session.profile.role, "member");
  const view = !member || hash === "application" || hash === "apply" ? "application" : "library";
  mount(root, shell(view));
  const main = $("#main");
  try {
    if (view === "application") {
      document.title = `Your application — ${config.site.shortName} Portal`;
      await applicationView(main, { session, application: myApp, onChange: (a) => { myApp = a; } });
    } else {
      await library(main);
    }
  } catch (err) {
    console.error(err);
    mount(main, html`<div class="empty"><h2>This page couldn't load</h2><p>${friendlyError(err)}</p></div>`);
  }
}

async function library(main) {
  const role = session.profile.role;
  const canEdit = roleAtLeast(role, "editor");
  const name = session.profile.full_name || session.user.email;
  let items = [];
  let q = "";
  let col = "";
  let type = "all";

  mount(main, html`
    <div class="portal-hero">
      <h1>Library</h1>
      <p>Decks, models and recordings from Fershman meetings. Signed in as ${name}.</p>
    </div>
    <div class="portal-toolbar">
      <div class="toolbar" style="margin:0">
        <input class="input search" type="search" placeholder="Search the library" aria-label="Search the library" data-q>
        <select class="select" data-col aria-label="Collection"><option value="">All collections</option></select>
        <div class="seg" role="group" aria-label="File type">${Object.entries(TYPE_GROUPS).map(([k, g]) => html`<button type="button" data-type="${k}" aria-pressed="${k === type ? "true" : "false"}">${g.label}</button>`)}</div>
        ${canEdit ? html`<span class="spacer"></span><button class="btn btn-accent" type="button" data-add>${icon("upload")} Add files</button>` : ""}
      </div>
    </div>
    <div id="lib" aria-live="polite"><div class="items" style="margin-top:28px">${Array.from({ length: 6 }, () => html`<div class="skeleton" style="height:96px;border-radius:12px"></div>`)}</div></div>`);

  const collections = () => {
    const latest = new Map();
    for (const i of items) {
      const c = i.collection || "General";
      const d = i.event_date || i.created_at;
      if (!latest.has(c) || String(d) > String(latest.get(c))) latest.set(c, d);
    }
    return [...latest.entries()].sort((a, b) => String(b[1]).localeCompare(String(a[1]))).map(([c]) => c);
  };

  const draw = () => {
    const kinds = TYPE_GROUPS[type].kinds;
    const rows = items.filter((i) => (!col || (i.collection || "General") === col)
      && (!kinds || kinds.includes(itemKind(i)))
      && (!q || `${i.title} ${i.description || ""} ${i.collection || ""} ${i.file_name || ""}`.toLowerCase().includes(q)));
    if (!items.length) {
      mount("#lib", html`<div class="empty"><h2>The library is empty</h2><p>${canEdit ? "Add the decks, models and recordings you present at meetings. Members will see them here." : "Editors haven't added anything yet. Check back after the next meeting."}</p>${canEdit ? html`<button class="btn btn-accent" type="button" data-add>${icon("upload")} Add files</button>` : ""}</div>`);
      return;
    }
    if (!rows.length) { mount("#lib", html`<div class="empty"><h2>Nothing matches</h2><p>Try a different search, collection or file type.</p></div>`); return; }
    const groups = collections().filter((c) => rows.some((i) => (i.collection || "General") === c));
    mount("#lib", groups.map((g) => {
      const inGroup = rows.filter((i) => (i.collection || "General") === g);
      return html`<section class="collection" aria-label="${g}">
        <div class="collection-head"><h2>${g}</h2><span>${inGroup.length} item${inGroup.length === 1 ? "" : "s"}</span></div>
        <div class="items">${inGroup.map((i) => {
          const k = itemKind(i);
          return html`<button class="card item" type="button" data-id="${i.id}">
            ${kindIcon(k)}
            <div style="min-width:0">
              <h3>${i.title}</h3>
              ${i.description ? html`<p>${i.description}</p>` : ""}
              <div class="item-meta"><span>${kindLabel(k)}</span>${i.event_date ? html`<span>${fmtDate(i.event_date + "T12:00:00")}</span>` : ""}${i.file_size ? html`<span>${fmtBytes(i.file_size)}</span>` : ""}</div>
            </div>
          </button>`;
        })}</div>
      </section>`;
    }));
  };

  const load = async () => {
    try {
      items = await db.listPortalItems();
      const sel = $("[data-col]", main);
      const current = sel.value;
      sel.innerHTML = html`<option value="">All collections</option>${collections().map((c) => html`<option value="${c}">${c}</option>`)}`.value;
      sel.value = collections().includes(current) ? current : "";
      col = sel.value;
      draw();
    } catch (ex) {
      mount("#lib", html`<div class="empty"><h2>The library couldn't load</h2><p>${friendlyError(ex)}</p></div>`);
    }
  };

  main.addEventListener("click", (e) => {
    if (e.target.closest("[data-add]")) openUploadPanel({ collections: collections(), defaultCollection: col, onDone: load });
    const t = e.target.closest("[data-type]");
    if (t) { type = t.dataset.type; $$("[data-type]", main).forEach((b) => b.setAttribute("aria-pressed", String(b === t))); draw(); }
    const card = e.target.closest(".item[data-id]");
    if (card) openViewer(items.find((i) => i.id === card.dataset.id), { canEdit, collections: collections(), onChanged: load });
  });
  $("[data-q]", main).addEventListener("input", debounce((e) => { q = e.target.value.trim().toLowerCase(); draw(); }, 150));
  $("[data-col]", main).addEventListener("change", (e) => { col = e.target.value; draw(); });
  document.title = `Library — ${config.site.shortName} Portal`;
  await load();
}

async function boot() {
  installImageFallbacks(() => null);
  if (dbError) {
    mount(root, html`<div class="container" style="padding:60px 20px"><h1>Can't connect</h1><p>${friendlyError(dbError)}</p></div>`);
    return;
  }
  let recovering = params().get("reset") === "1";
  db.onAuthChange((event) => {
    if (event === "PASSWORD_RECOVERY") { recovering = true; renderAuth(root, { context: "portal", mode: "reset", onDone: () => location.replace("/portal/") }); }
    if (event === "SIGNED_OUT") location.replace("/portal/");
  });
  session = await db.getSession();
  if (recovering && session) {
    renderAuth(root, { context: "portal", mode: "reset", onDone: () => location.replace("/portal/") });
    return;
  }
  if (!session) {
    const intent = /^#(apply|application)$/.test(location.hash) ? "apply" : "";
    renderAuth(root, { context: "portal", intent, onDone: () => location.reload() });
    return;
  }
  myApp = await db.myApplication().catch(() => null);
  document.addEventListener("click", async (e) => {
    if (e.target.closest("[data-signout]")) { await db.signOut(); location.href = "/portal/"; }
  });
  document.addEventListener("change", async (e) => {
    if (e.target.matches("[data-demo-role]")) { await db.setDemoRole(e.target.value); location.reload(); }
  });
  addEventListener("hashchange", () => { route(); });
  await route();
}

boot().catch((err) => { console.error(err); toast(friendlyError(err), { error: true }); });
