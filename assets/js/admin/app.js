// Admin panel: auth gate, layout and hash router.
import { db, LIVE, config, dbError } from "../data/db.js";
import { html, mount, icon, initials, $, $$ } from "../lib/util.js";
import { toast, installImageFallbacks } from "../lib/ui.js";
import { roleAtLeast, ROLE_LABELS, friendlyError } from "../data/shared.js";
import { renderAuth, renderNoAccess } from "../shared/auth-ui.js";

const root = document.getElementById("app");
const NAV = [
  { key: "dashboard", label: "Dashboard", icon: "home", min: "writer" },
  { key: "articles", label: "Articles", icon: "doc", min: "writer", badge: (c) => c.review },
  { key: "authors", label: "Authors", icon: "users", min: "editor" },
  { key: "sections", label: "Sections", icon: "folder", min: "editor" },
  { key: "portal", label: "Member portal", icon: "folder", min: "editor" },
  { key: "inbox", label: "Inbox", icon: "inbox", min: "editor", badge: (c) => c.newMessages },
  { key: "recruiting", label: "Recruiting", icon: "calendar", min: "writer", allow: (s) => roleAtLeast(s.profile.role, "editor") || s.recruiter, badge: (c) => c.newApplications },
  { key: "members", label: "Members", icon: "user", min: "admin", badge: (c) => c.pending },
  { key: "subscribers", label: "Subscribers", icon: "mail", min: "admin" },
  { key: "import", label: "Import", icon: "upload", min: "editor" },
  { key: "settings", label: "Settings", icon: "settings", min: "admin" },
  { key: "byline", label: "My byline", icon: "edit", min: "writer" },
];

let session = null;
let counts = {};
let leaveGuard = null;
let lastHash = location.hash;

export function setLeaveGuard(fn) { leaveGuard = fn; }
const canSee = (n) => roleAtLeast(session.profile.role, n.min) && (!n.allow || n.allow(session));
export function navigate(hash, { replace = false } = {}) {
  if (replace) { history.replaceState(null, "", hash); lastHash = hash; route(); }
  else location.hash = hash;
}

function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  const [path, qs] = h.split("?");
  const parts = path.split("/").filter(Boolean);
  return { parts, query: Object.fromEntries(new URLSearchParams(qs || "")) };
}

async function refreshCounts() {
  try { counts = await db.counts(); } catch (_) { counts = {}; }
  $$(".app-nav [data-badge]").forEach((el) => {
    const item = NAV.find((n) => n.key === el.dataset.badge);
    const n = item && item.badge ? item.badge(counts) : 0;
    el.textContent = n || "";
    el.hidden = !n;
  });
  return counts;
}

function demoRoleSelect(role) {
  return html`<label class="row" style="gap:8px;flex-wrap:nowrap">View as <select class="select" data-demo-role style="min-height:32px;padding:4px 8px;width:auto">${["admin", "editor", "writer", "member", "pending"].map((r) => html`<option value="${r}" ${r === role ? html`selected` : ""}>${ROLE_LABELS[r]}</option>`)}</select></label>`;
}
document.addEventListener("change", async (e) => {
  if (!e.target.matches("[data-demo-role]")) return;
  await db.setDemoRole(e.target.value);
  location.reload();
});

function shell() {
  const role = session.profile.role;
  const name = session.profile.full_name || session.user.email;
  mount(root, html`
    <a class="skip-link" href="#view">Skip to content</a>
    <div class="app">
      <aside class="app-side" id="app-side" aria-label="Admin navigation">
        <a class="app-brand" href="#/dashboard"><strong>${config.site.shortName}</strong><span>Admin</span></a>
        <nav class="app-nav">
          ${NAV.filter((n) => canSee(n)).map((n) => html`
            <a href="#/${n.key}" data-nav="${n.key}">${icon(n.icon)}<span>${n.label}</span>${n.badge ? html`<span class="count" data-badge="${n.key}" hidden></span>` : ""}</a>`)}
        </nav>
        <div class="app-side-foot">
          <div class="app-user">
            <span class="avatar">${initials(name)}</span>
            <div style="min-width:0"><div class="app-user-name">${name}</div><div class="app-user-role">${ROLE_LABELS[role]}</div></div>
          </div>
          <nav class="app-nav">
            <a href="/" target="_blank" rel="noopener">${icon("external")}<span>View site</span></a>
            <a href="/portal/">${icon("folder")}<span>Members portal</span></a>
            <a href="#" data-signout>${icon("logout")}<span>Sign out</span></a>
          </nav>
        </div>
      </aside>
      <div class="app-scrim" data-nav-close></div>
      <div class="app-main">
        <header class="app-top">
          <button class="icon-btn" type="button" data-nav-open aria-label="Open navigation">${icon("menu")}</button>
          <strong>${config.site.shortName} Admin</strong>
          <span class="spacer"></span>
          <a class="btn btn-accent btn-sm" href="#/articles/new">${icon("plus")} New</a>
        </header>
        ${LIVE ? "" : html`<div class="app-banner row" role="note"><span>Demo mode: changes are saved in this browser only, and readers won't see them. ${roleAtLeast(role, "admin") ? html`To go live, open <a href="#/settings">Settings</a> and connect Supabase.` : ""}</span><span class="spacer"></span>${demoRoleSelect(role)}</div>`}
        <div id="view" tabindex="-1"></div>
      </div>
    </div>`);
  root.addEventListener("click", async (e) => {
    if (e.target.closest("[data-nav-open]")) document.body.classList.add("nav-open");
    if (e.target.closest("[data-nav-close]") || e.target.closest(".app-nav a")) document.body.classList.remove("nav-open");
    if (e.target.closest("[data-signout]")) {
      e.preventDefault();
      if (leaveGuard && !leaveGuard()) return;
      await db.signOut();
      location.hash = "";
      location.reload();
    }
  });
}

async function route() {
  const { parts, query } = parseHash();
  const key = parts[0] || "dashboard";
  const item = NAV.find((n) => n.key === key);
  const role = session.profile.role;
  $$(".app-nav [data-nav]").forEach((a) => { if (a.dataset.nav === key) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  // Fresh container per view so event listeners from the previous view can't fire here.
  const prev = $("#view");
  const el = prev.cloneNode(false);
  prev.replaceWith(el);
  leaveGuard = null;
  if (!item || !canSee(item)) {
    mount(el, html`<div class="view"><div class="card card-pad"><h2>That page isn't available</h2><p>Your role (${ROLE_LABELS[role]}) doesn't include it.</p><p style="margin-top:12px"><a class="btn" href="#/dashboard">Go to the dashboard</a></p></div></div>`);
    return;
  }
  const ctx = { session, role, el, parts, query, refreshCounts, navigate, setLeaveGuard };
  mount(el, html`<div class="view"><div class="skeleton" style="height:36px;width:220px;margin-bottom:22px"></div><div class="skeleton" style="height:300px"></div></div>`);
  try {
    if (key === "articles" && parts[1]) {
      const m = await import("./editor.js");
      await m.editor(ctx, parts[1]);
    } else if (key === "recruiting") {
      const m = await import("./recruiting.js");
      await m.recruiting(ctx);
    } else if (key === "import") {
      const m = await import("./import.js");
      await m.importView(ctx);
    } else {
      const m = await import("./views.js");
      await m[key](ctx);
    }
    document.title = `${item.label} — ${config.site.shortName} Admin`;
  } catch (err) {
    console.error(err);
    mount(el, html`<div class="view"><div class="card card-pad"><h2>This page couldn't load</h2><p>${friendlyError(err)}</p><p style="margin-top:12px"><button class="btn" type="button" onclick="location.reload()">Reload</button></p></div></div>`);
  }
}

window.addEventListener("hashchange", () => {
  if (leaveGuard && !leaveGuard()) {
    history.replaceState(null, "", lastHash || "#/dashboard"); // replaceState doesn't fire hashchange
    return;
  }
  lastHash = location.hash;
  route();
});

async function boot() {
  installImageFallbacks((img) => { const s = document.createElement("span"); s.textContent = img.dataset.initials || ""; return s; });
  if (dbError) {
    mount(root, html`<div class="view"><div class="card card-pad"><h2>Can't connect to the database</h2><p>${friendlyError(dbError)} Check the Supabase URL and key in config.js.</p></div></div>`);
    return;
  }
  session = await db.getSession();
  if (!session) {
    renderAuth(root, { context: "admin", onDone: () => location.reload() });
    return;
  }
  if (!roleAtLeast(session.profile.role, "writer")) {
    const pending = session.profile.role === "pending";
    renderNoAccess(root, {
      session, context: "admin",
      message: pending
        ? { title: "Waiting for approval", text: "An admin needs to approve your account before you can use the admin panel." }
        : { title: "No editor access", text: "Your account is a member account. Ask an admin to make you a writer or editor if you need to publish." },
      actions: html`${pending ? "" : html`<a class="btn btn-accent" href="/portal/">Go to the members portal</a>`}${LIVE ? "" : html`<button class="btn" type="button" data-demo-admin>Switch back to admin (demo)</button>`}`,
    });
    const back = $("[data-demo-admin]");
    if (back) back.addEventListener("click", async () => { await db.setDemoRole("admin"); location.reload(); });
    return;
  }
  // Staff browsers don't count in the site's Google Analytics (see assets/js/site/analytics.js)
  try { localStorage.setItem("fj-no-analytics", "1"); } catch (_) { /* private mode */ }
  shell();
  if (!location.hash) history.replaceState(null, "", "#/dashboard");
  lastHash = location.hash;
  await route();
  refreshCounts();
  db.onAuthChange((event) => { if (event === "SIGNED_OUT") location.reload(); });
  window.addEventListener("beforeunload", (e) => { if (leaveGuard && !leaveGuard(true)) { e.preventDefault(); e.returnValue = ""; } });
}

boot().catch((err) => {
  console.error(err);
  toast(friendlyError(err), { error: true });
});
