// Google Analytics 4 for the public site.
//
// Sends one page_view per page once its real title is known (pages render in the browser), how far
// readers get through each story and for how long, and the actions that matter: newsletter sign-ups,
// applications, info-session registrations, coffee-chat clicks, shares, searches, chart use and the
// recruiting pop-up. Not loaded on /admin or /portal, on draft previews, for browsers that send a
// Global Privacy Control signal, or on browsers where someone signed in to the admin.
//
// The measurement ID comes from config.js (analytics.ga4); set it to "" to turn analytics off.
import config from "/config.js";

const DEFAULT_ID = "G-WQ8MGKY96G";
const cfg = (config && config.analytics) || {};
const ID = Object.prototype.hasOwnProperty.call(cfg, "ga4") ? String(cfg.ga4 || "").trim() : DEFAULT_ID;
const OPT_OUT_KEY = "fj-no-analytics";

function readOptOut() {
  try {
    const q = new URLSearchParams(location.search).get("analytics");
    if (q === "off") localStorage.setItem(OPT_OUT_KEY, "1");
    if (q === "on") localStorage.removeItem(OPT_OUT_KEY);
    return localStorage.getItem(OPT_OUT_KEY) === "1";
  } catch (_) { return false; }
}
const OFF = !/^G-[A-Z0-9]{4,}$/i.test(ID)
  || navigator.globalPrivacyControl === true
  || /^\/(admin|portal)(\/|$)/.test(location.pathname)
  || new URLSearchParams(location.search).has("preview")
  || readOptOut();

let started = false;
let pageSent = false;
let pageTimer = 0;
let pageExtra = {};

export const analyticsOn = !OFF;

function gtag() { window.dataLayer.push(arguments); } // eslint-disable-line prefer-rest-params

function clean(params) {
  const out = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === "") continue;
    out[k] = typeof v === "string" ? v.slice(0, 100) : v;
  }
  return out;
}

function start() {
  if (OFF || started) return;
  started = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || gtag;
  window.gtag("js", new Date());
  window.gtag("config", ID, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ID)}`;
  document.head.append(s);
  wireClicks();
  document.addEventListener("fj:chart", (e) => {
    const d = e.detail || {};
    if (d.action === "interact") track("chart_interact", { chart_title: d.title, chart_type: d.type });
    else track("chart_data", { chart_title: d.title, chart_type: d.type, method: d.action });
  });
}

/** Send a GA4 event. Safe to call anywhere; does nothing when analytics is off. */
export function track(name, params = {}) {
  if (OFF) return;
  start();
  window.gtag("event", name, clean(params));
}

function groupFor(path) {
  if (path === "/" || path === "/index.html") return "Home";
  if (/^\/learn/.test(path)) return "Learn Economics";
  if (/^\/authors?(\/|$)/.test(path)) return "Authors";
  if (/^\/search/.test(path)) return "Search";
  if (/^\/apply/.test(path)) return "Recruiting";
  if (/^\/(register|subscribe)/.test(path)) return "Subscribe";
  if (/^\/(categories|articles)/.test(path)) return "Stories";
  return "Pages";
}

/** One page_view per page load, sent shortly after the page sets its real title. */
export function pageView(extra = {}) {
  if (OFF || pageSent) return;
  start();
  Object.assign(pageExtra, extra || {});
  clearTimeout(pageTimer);
  pageTimer = setTimeout(() => {
    pageSent = true;
    const group = pageExtra.content_group || groupFor(location.pathname);
    window.gtag("set", { content_group: group });
    window.gtag("event", "page_view", clean({
      page_title: document.title,
      page_location: location.href,
      page_referrer: document.referrer || undefined,
      ...pageExtra,
      content_group: group,
    }));
  }, 300);
}

/** Reading depth for a story: 25/50/75/100% of the body seen, with engaged time. */
export function trackReading(bodyEl, info = {}) {
  if (OFF || !bodyEl) return;
  start();
  const marks = [25, 50, 75, 100];
  const sent = new Set();
  let engagedMs = 0;
  let last = performance.now();
  let lastActive = last;
  let summarySent = false;
  const IDLE_MS = 30000;
  const active = () => { lastActive = performance.now(); };
  for (const ev of ["scroll", "pointermove", "pointerdown", "keydown", "touchstart", "wheel"]) addEventListener(ev, active, { passive: true });
  const tick = () => {
    const now = performance.now();
    if (document.visibilityState === "visible" && now - lastActive < IDLE_MS) engagedMs += Math.min(now - last, 5000);
    last = now;
  };
  setInterval(tick, 1000);
  const seconds = () => Math.round(engagedMs / 1000);
  const deepest = () => Math.max(0, ...sent);
  const check = () => {
    tick();
    const r = bodyEl.getBoundingClientRect();
    if (r.height <= 0) return;
    const seen = Math.min(1, Math.max(0, (innerHeight - r.top) / r.height)) * 100;
    for (const m of marks) {
      if (seen >= m && !sent.has(m)) {
        sent.add(m);
        track("article_progress", { percent_read: m, engaged_seconds: seconds(), ...info });
        if (m === 100) track("article_complete", { engaged_seconds: seconds(), ...info });
      }
    }
  };
  let raf = 0;
  addEventListener("scroll", () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(check); }, { passive: true });
  setTimeout(check, 1200);
  const summary = () => {
    if (summarySent) return;
    tick();
    if (seconds() < 2) return;
    summarySent = true;
    track("article_read", { percent_read: deepest(), engaged_seconds: seconds(), ...info });
  };
  addEventListener("pagehide", summary);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") summary(); });
}

// Clicks worth knowing about: share buttons and anything marked data-track="event_name"
function wireClicks() {
  document.addEventListener("click", (e) => {
    const share = e.target.closest(".share a, .share button");
    if (share) {
      const label = (share.getAttribute("aria-label") || share.title || "").toLowerCase();
      const method = share.hasAttribute("data-share-copy") ? "copy_link" : share.hasAttribute("data-print") ? "print"
        : /linkedin/.test(label) ? "linkedin" : /\bx\b|twitter/.test(label) ? "x" : /email/.test(label) ? "email" : "other";
      track("share", { method, content_type: "article", item_id: location.pathname.split("/").pop() });
      return;
    }
    const t = e.target.closest("[data-track]");
    if (t) {
      const params = {};
      for (const [k, v] of Object.entries(t.dataset)) {
        if (k.startsWith("track") && k !== "track") params[k.slice(5).replace(/^[A-Z]/, (c) => c.toLowerCase()).replace(/[A-Z]/g, (c) => "_" + c.toLowerCase())] = v;
      }
      track(t.dataset.track, params);
    }
  }, { capture: true });
}
