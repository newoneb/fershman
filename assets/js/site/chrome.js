// Header, navigation, ticker, drawer, announcement bar and footer for public pages.
import { db, config, LIVE } from "../data/db.js";
import { html, raw, mount, icon, fmtLongDate, hash, coverArt, safeUrl, $, $$ } from "../lib/util.js";
import { setTheme, getTheme, installImageFallbacks, copyText, toast } from "../lib/ui.js";
import { mergeRecruiting, applicationStatus } from "../data/shared.js";
import { pageView } from "./analytics.js";
import { recruitingPopup } from "./recruit-popup.js";

const S = config.site;

// The journal's own pages. On wide screens they sit beside the date at the top of every page,
// on phones they get the top row to themselves, and the menu and the footer list them too.
const JOURNAL = [
  { href: "/about-us", label: "About", key: "about" },
  { href: "/team", label: "Team", key: "team" },
  { href: "/submit", label: "Write for us", key: "submit" },
  { href: "/apply", label: "Apply", key: "apply" },
];

const here = (key, active) => (key && key === active ? raw('aria-current="page"') : "");
const applyMark = (key) => (key === "apply" ? raw("data-apply-link") : "");

function sectionItems() {
  return [{ href: "/categories/latest", label: "Latest", key: "latest" }]
    .concat(config.sections.map((s) => ({ href: `/categories/${s.slug}`, label: s.name, key: s.slug })))
    .concat([{ href: "/learn", label: config.learn.name, key: "learn" }]);
}
const journalLinks = (active, items = JOURNAL) => items.map((j) => html`<a href="${j.href}" ${applyMark(j.key)} ${here(j.key, active)}>${j.label}</a>`);

/** Whether this browser holds a portal sign-in. Read from local storage, so it costs no request. */
function signedIn() {
  try {
    if (!LIVE) return Boolean(localStorage.getItem("fershman-demo-session-v1"));
    const ref = new URL(config.supabase.url).hostname.split(".")[0];
    return Boolean(localStorage.getItem(`sb-${ref}-auth-token`));
  } catch (_) { return false; }
}

function header(active) {
  const portal = signedIn();
  return html`
  <a class="skip-link" href="#main">Skip to content</a>
  <div id="announce-slot"></div>
  <header class="site-header">
    <div class="topbar"><div class="container">
      <span class="topbar-date">${fmtLongDate()}</span>
      <nav class="topnav" aria-label="The journal">${journalLinks(active)}</nav>
      <div class="topbar-actions">
        ${LIVE ? "" : html`<a class="demo-pill" href="/admin/#/settings" title="Running on sample content. Connect Supabase to go live.">Demo mode</a>`}
        <a class="icon-btn" href="/search" aria-label="Search">${icon("search")}</a>
        <a class="signin-link" href="/portal/">${portal ? "Portal" : "Sign in"}</a>
        <a class="btn btn-accent btn-sm" href="/register">Subscribe</a>
      </div>
    </div></div>
    <div class="masthead container">
      <div class="masthead-mobile-row">
        <button class="icon-btn" type="button" data-drawer-open aria-label="Open menu" aria-controls="site-drawer" aria-expanded="false">${icon("menu")}</button>
        <a class="nameplate" href="/">${S.name}</a>
        <a class="icon-btn" href="/search" aria-label="Search">${icon("search")}</a>
      </div>
      <div class="masthead-desktop"><a class="nameplate" href="/">${S.name}</a></div>
      <p class="tagline">${S.tagline}</p>
      <div class="masthead-rule"></div>
      <nav class="mainnav" aria-label="Sections"><ul>${sectionItems().map((i) => html`<li><a href="${i.href}" ${here(i.key, active)}>${i.label}</a></li>`)}</ul></nav>
    </div>
    ${config.ticker && config.ticker.enabled ? html`<div class="ticker" id="ticker" aria-label="Market data"><div class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div></div></div>` : ""}
  </header>
  <div class="compact-bar" id="compact-bar" inert>
    <div class="container">
      <button class="icon-btn" type="button" data-drawer-open aria-label="Open menu" aria-controls="site-drawer">${icon("menu")}</button>
      <a class="compact-mark" href="/">${S.shortName}</a>
      <nav class="compact-nav" aria-label="Sections (compact)">${config.sections.map((s) => html`<a href="/categories/${s.slug}" ${here(s.slug, active)}>${s.name}</a>`)}</nav>
      <div class="compact-actions">
        <nav class="compact-journal" aria-label="The journal (compact)">${journalLinks(active, JOURNAL.filter((j) => j.key !== "submit"))}</nav>
        <a class="icon-btn" href="/search" aria-label="Search">${icon("search")}</a>
        <a class="btn btn-accent btn-sm" href="/register">Subscribe</a>
      </div>
    </div>
  </div>
  <div class="drawer-backdrop" data-drawer-close></div>
  <aside class="drawer" id="site-drawer" aria-label="Menu" inert>
    <div class="drawer-head">
      <a class="compact-mark" href="/">${S.shortName}</a>
      <button class="icon-btn" type="button" data-drawer-close aria-label="Close menu">${icon("close")}</button>
    </div>
    <div id="drawer-apply"></div>
    <nav>
      <h2>Sections</h2>
      <ul>${sectionItems().map((i) => html`<li><a href="${i.href}" ${here(i.key, active)}>${i.label}</a></li>`)}</ul>
      <h2>The journal</h2>
      <ul>${JOURNAL.concat([{ href: "/contact", label: "Contact", key: "contact" }]).map((j) => html`<li><a href="${j.href}" ${applyMark(j.key)} ${here(j.key, active)}>${j.label}</a></li>`)}</ul>
    </nav>
    <div class="drawer-cta">
      <a class="btn btn-accent" href="/register">Subscribe</a>
      <a class="btn" href="/portal/">${portal ? "Open the portal" : "Sign in to the portal"}</a>
    </div>
  </aside>`;
}

function footer() {
  const soc = S.social || {};
  return html`
  <footer class="site-footer"><div class="container">
    <div class="footer-top">
      <div class="footer-brand">
        <a class="footer-mark" href="/">${S.name}</a>
        <p class="footer-about">${S.description}</p>
        <div class="socials">
          ${soc.x ? html`<a href="${soc.x}" target="_blank" rel="noopener" aria-label="Fershman on X">${icon("x")}</a>` : ""}
          ${soc.instagram ? html`<a href="${soc.instagram}" target="_blank" rel="noopener" aria-label="Fershman on Instagram">${icon("instagram")}</a>` : ""}
          ${soc.linkedin ? html`<a href="${soc.linkedin}" target="_blank" rel="noopener" aria-label="Fershman on LinkedIn">${icon("linkedin")}</a>` : ""}
        </div>
      </div>
      <div><h2>Sections</h2><ul>
        <li><a href="/categories/latest">Latest</a></li>
        ${config.sections.map((s) => html`<li><a href="/categories/${s.slug}">${s.name}</a></li>`)}
      </ul></div>
      <div><h2>The Journal</h2><ul>
        <li><a href="/about-us">About us</a></li>
        <li><a href="/team">Team</a></li>
        <li><a href="/learn">${config.learn.name}</a></li>
        <li><a href="/submit">Write for us</a></li>
        <li><a href="/apply" data-apply-link>Apply to join</a></li>
      </ul></div>
      <div><h2>Readers</h2><ul>
        <li><a href="/register">Subscribe</a></li>
        <li><a href="/search">Search</a></li>
        <li><a href="/contact">Contact</a></li>
        <li><a href="/privacy">Privacy policy</a></li>
        <li><a href="/portal/">Portal sign-in</a></li>
      </ul></div>
    </div>
    <div class="footer-bottom">
      <span>© ${new Date().getFullYear()} ${S.name}${config.ticker && config.ticker.enabled ? html`. Market data by <a href="https://www.tradingview.com/" target="_blank" rel="noopener nofollow" style="color:inherit">TradingView</a>.` : ""}</span>
      <div class="theme-switch" role="group" aria-label="Color theme">
        <button type="button" data-theme-set="auto">Auto</button>
        <button type="button" data-theme-set="light">Light</button>
        <button type="button" data-theme-set="dark">Dark</button>
      </div>
    </div>
  </div></footer>`;
}

function setupDrawer() {
  const drawer = $("#site-drawer");
  const open = () => {
    document.body.classList.add("drawer-open");
    drawer.inert = false;
    $$("[data-drawer-open]").forEach((b) => b.setAttribute("aria-expanded", "true"));
    setTimeout(() => drawer.querySelector("a, button").focus(), 50);
  };
  const close = () => {
    document.body.classList.remove("drawer-open");
    drawer.inert = true;
    $$("[data-drawer-open]").forEach((b) => b.setAttribute("aria-expanded", "false"));
  };
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-drawer-open]")) open();
    else if (e.target.closest("[data-drawer-close]")) close();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.body.classList.contains("drawer-open")) close(); });
}

function setupCompactBar() {
  const bar = $("#compact-bar");
  const target = $(".masthead-rule");
  if (!bar || !target || !("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver(([entry]) => {
    const show = !entry.isIntersecting && entry.boundingClientRect.top < 0;
    bar.classList.toggle("is-visible", show);
    bar.inert = !show;
  });
  io.observe(target);
}

function setupTheme() {
  const sync = () => {
    const mode = getTheme();
    $$("[data-theme-set]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeSet === mode)));
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-theme-set]");
    if (b) { setTheme(b.dataset.themeSet); sync(); }
  });
  sync();
}

function setupTicker() {
  const host = $("#ticker .tradingview-widget-container");
  if (!host) return;
  const dark = document.documentElement.dataset.theme === "dark" ||
    (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  const s = document.createElement("script");
  s.src = "https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js";
  s.async = true;
  s.textContent = JSON.stringify({
    symbols: config.ticker.symbols, showSymbolLogo: false, isTransparent: true,
    displayMode: "adaptive", colorTheme: dark ? "dark" : "light", locale: "en",
  });
  s.onerror = () => { const t = $("#ticker"); if (t) t.remove(); };
  host.append(s);
}

async function setupAnnouncement(settingsPromise) {
  try {
    const settings = await settingsPromise;
    const a = settings.announcement || {};
    if (!a.enabled || !a.text) return;
    const key = "fj-announce-" + hash(a.text + (a.link || ""));
    if (localStorage.getItem(key)) return;
    const link = safeUrl(a.link);
    mount("#announce-slot", html`
      <div class="announce" role="region" aria-label="Announcement"><div class="container">
        <span>${a.text} ${link ? html`<a href="${link}">Learn more</a>` : ""}</span>
        <button type="button" aria-label="Dismiss announcement">${icon("close")}</button>
      </div></div>`);
    $("#announce-slot button").addEventListener("click", () => { localStorage.setItem(key, "1"); mount("#announce-slot", ""); });
  } catch (_) { /* announcement is optional */ }
}

/** While recruiting has a closing date, every Apply link gets a small marker and the menu leads with it. */
async function setupApplyStatus(settingsPromise, periodsPromise) {
  try {
    const [settings, periods] = await Promise.all([settingsPromise, periodsPromise]);
    const st = applicationStatus(mergeRecruiting(settings.recruiting), new Date(), periods || []);
    if (!st.open || !st.until) return;
    const note = st.sub ? `${st.label}. ${st.sub}.` : `${st.label}.`;
    $$("[data-apply-link]").forEach((a) => {
      a.classList.add("is-live");
      a.title = note;
      a.insertAdjacentHTML("beforeend", html`<span class="sr-only"> (${st.label})</span>`.value);
    });
    mount("#drawer-apply", html`<a class="drawer-apply" href="/apply"><strong>${st.label}</strong>${st.sub ? html`<span>${st.sub}</span>` : ""}</a>`);
  } catch (_) { /* the marker is optional */ }
}

function fallbackFor(img) {
  if (img.dataset.fallback === "avatar" || img.dataset.fallback === "portrait") {
    const span = document.createElement("span");
    span.textContent = img.dataset.initials || "F";
    span.setAttribute("aria-hidden", "true");
    if (img.dataset.fallback === "portrait") span.className = "portrait-initials";
    return span;
  }
  if (img.closest(".media")) {
    const tpl = document.createElement("template");
    tpl.innerHTML = coverArt(img.dataset.seed || img.src, img.dataset.section).value;
    return tpl.content.firstElementChild;
  }
  if (img.closest(".prose")) {
    const fig = img.closest("figure");
    if (fig) fig.remove(); else img.remove();
    return null;
  }
  return null;
}

let shared = null;
/** Settings and recruiting periods, already requested by the chrome, for pages that need them too. */
export const chromeData = () => shared;

/** Call once per page. `active` = nav key to highlight. */
export function initChrome({ active } = {}) {
  document.body.classList.add("site");
  document.body.insertAdjacentHTML("afterbegin", header(active).value);
  document.body.insertAdjacentHTML("beforeend", footer().value);
  setupDrawer();
  setupCompactBar();
  setupTheme();
  setupTicker();
  const settings = db.getSettings();
  settings.catch(() => {});
  const periods = Promise.resolve().then(() => db.listRecruitingPeriods()).catch(() => []);
  shared = { settings, periods };
  setupAnnouncement(settings);
  setupApplyStatus(settings, periods);
  recruitingPopup(settings, periods);
  installImageFallbacks(fallbackFor);
  document.addEventListener("click", async (e) => {
    const copy = e.target.closest("[data-share-copy]");
    if (copy) {
      if (navigator.share && matchMedia("(pointer: coarse)").matches) {
        try { await navigator.share({ title: document.title, url: copy.dataset.shareCopy }); return; } catch (_) { /* fall back to copy */ }
      }
      await copyText(copy.dataset.shareCopy);
      toast("Link copied");
    }
    if (e.target.closest("[data-print]")) window.print();
  });
}

export function setMeta({ title, description, image, url, analytics } = {}) {
  if (title) document.title = title === S.name ? title : `${title} — ${S.name}`;
  pageView(analytics);
  const setTag = (selector, attr, value) => {
    if (!value) return;
    let el = document.head.querySelector(selector);
    if (!el) {
      el = document.createElement("meta");
      const [k, v] = selector.replace(/^meta\[|\]$/g, "").split("=");
      el.setAttribute(k, v.replace(/"/g, ""));
      document.head.append(el);
    }
    el.setAttribute(attr, value);
  };
  setTag('meta[name="description"]', "content", description);
  setTag('meta[property="og:title"]', "content", title);
  setTag('meta[property="og:description"]', "content", description);
  setTag('meta[property="og:image"]', "content", image);
  setTag('meta[property="og:url"]', "content", url || location.href);
  setTag('meta[name="twitter:title"]', "content", title);
  setTag('meta[name="twitter:description"]', "content", description);
}
