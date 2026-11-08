// Apply page: where recruiting stands, how it works, the recruiting calendar, info sessions,
// coffee chats, roles and questions. Applications themselves are written in the portal
// (/portal/#apply), where drafts save as people write and applicants follow theirs to a decision.
import { db, config } from "../data/db.js";
import { html, raw, mount, icon, isEmail, safeUrl, $, $$ } from "../lib/util.js";
import { openPanel, toast, downloadFile } from "../lib/ui.js";
import {
  mergeRecruiting, applicationStatus, friendlyError, isMarketing, countdown, zonedTime,
  dayShort, weekdayOf, YEARS,
} from "../data/shared.js";
import { initChrome, setMeta, chromeData } from "./chrome.js";
import { track } from "./analytics.js";
import { avatar, errorState } from "./cards.js";

initChrome({ active: "apply" });
const main = $("#main");
const S = config.site;
const DAY = 864e5;
const START = "/portal/#apply";
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const honeypot = raw(`<div class="hp" aria-hidden="true"><label>Leave this empty <input name="company_website" tabindex="-1" autocomplete="off"></label></div>`);

// ---------- time & calendar helpers ----------
const tidy = (s) => s.replace(":00", "").replace(/\s?AM$/, " am").replace(/\s?PM$/, " pm").replace(/\u202f/g, " ");
const clock = (ms, tz) => tidy(new Date(ms).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }));
const cityOf = (tz) => String(tz).split("/").pop().replace(/_/g, " ");

function fmtSession(s, tz) {
  const start = new Date(s.starts_at);
  const end = new Date(start.getTime() + (s.duration_min || 60) * 60000);
  const opt = (o) => ({ timeZone: tz, ...o });
  return {
    day: start.toLocaleDateString("en-US", opt({ day: "numeric" })),
    month: start.toLocaleDateString("en-US", opt({ month: "short" })),
    wd: start.toLocaleDateString("en-US", opt({ weekday: "short" })),
    weekday: start.toLocaleDateString("en-US", opt({ weekday: "long", month: "long", day: "numeric" })),
    time: `${start.toLocaleTimeString("en-US", opt({ hour: "numeric", minute: "2-digit" }))} to ${end.toLocaleTimeString("en-US", opt({ hour: "numeric", minute: "2-digit", timeZoneName: "short" }))}`,
    start, end,
  };
}
const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
function calendarLinks(s) {
  const start = new Date(s.starts_at);
  const end = new Date(start.getTime() + (s.duration_min || 60) * 60000);
  const details = [s.description, s.join_url ? `Join: ${s.join_url}` : "", `${S.name}: ${location.origin}/apply`].filter(Boolean).join("\n\n");
  const where = s.join_url || s.location || "";
  const google = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(s.title)}&dates=${stamp(start)}/${stamp(end)}&details=${encodeURIComponent(details)}&location=${encodeURIComponent(where)}`;
  const esc = (v) => String(v || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//The Fershman Journal//Info sessions//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT", `UID:${s.id}@fershman.com`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(s.title)}`, `DESCRIPTION:${esc(details)}`, `LOCATION:${esc(where)}`, s.join_url ? `URL:${s.join_url}` : "",
    "END:VEVENT", "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");
  return { google, ics };
}

// Booking pages that work inside the site; anything else opens in a new tab.
function embedBooking(url) {
  try {
    const u = new URL(url);
    if (u.hostname === "calendly.com" || u.hostname.endsWith(".calendly.com")) {
      u.searchParams.set("embed_type", "Inline");
      u.searchParams.set("embed_domain", location.hostname);
      u.searchParams.set("hide_gdpr_banner", "1");
      return u.toString();
    }
    if (u.hostname === "calendar.google.com" && u.pathname.includes("/appointments/")) {
      u.searchParams.set("gv", "true");
      return u.toString();
    }
  } catch (_) { /* not a URL */ }
  return "";
}

// ---------- data ----------
async function load() {
  const shared = chromeData() || {};
  const [settings, authors, sessions, periods] = await Promise.all([
    shared.settings || db.getSettings(),
    db.listAuthors().catch(() => []),
    db.listInfoSessions().catch((e) => { console.warn("Info sessions unavailable", e); return []; }),
    shared.periods || db.listRecruitingPeriods().catch(() => []),
  ]);
  return { rc: mergeRecruiting(settings.recruiting), authors, sessions, periods: periods || [] };
}

let HOSTS = [];
/** Extra hosts from Recruiting settings first, then everyone on the Marketing team. */
function allHosts(rc, authors) {
  const listed = rc.hosts.filter((h) => h && (h.name || h.author_slug)).map((h) => {
    const a = authors.find((x) => x.slug === h.author_slug);
    return { ...h, booking_url: h.booking_url || (a && a.booking_url) || "", email: h.email || (a && a.contact_email) || "" };
  });
  const seen = new Set(listed.map((h) => h.author_slug).filter(Boolean));
  const team = authors.filter((a) => isMarketing(a) && !seen.has(a.slug)).map((a) => ({
    author_slug: a.slug, name: a.name, role: a.role_title || "Marketing", topics: "", booking_url: a.booking_url || "", email: a.contact_email || "",
  }));
  return [...listed, ...team];
}
function hostCards(hosts, authors) {
  return hosts.map((h, i) => {
    const a = authors.find((x) => x.slug === h.author_slug);
    const person = { name: h.name || (a && a.name) || "Fershman member", avatar_url: (a && a.avatar_url) || "", slug: a && a.slug };
    const role = h.role || (a && a.role_title) || "";
    const booking = safeUrl(h.booking_url);
    const action = booking
      ? html`<button class="btn btn-accent btn-sm" type="button" data-book="${i}">Book a time</button>`
      : h.email ? html`<a class="btn btn-sm" href="mailto:${h.email}?subject=${encodeURIComponent("Coffee chat about joining Fershman")}" data-track="coffee_chat_click" data-track-host-name="${person.name}" data-track-method="email">Email to schedule</a>` : "";
    return html`<article class="host">
      ${avatar(person, "avatar-md")}
      <div>
        <h3>${person.name}</h3>
        ${role ? html`<p class="host-role">${role}</p>` : ""}
        ${h.topics ? html`<p class="host-topics">Ask me about ${h.topics}</p>` : ""}
        ${action ? html`<div class="host-actions">${action}</div>` : ""}
      </div>
    </article>`;
  });
}

function sessionRow(s, rc) {
  const f = fmtSession(s, rc.timezone);
  const left = s.capacity ? Math.max(0, s.capacity - (s.registered || 0)) : null;
  let mine = null;
  try { mine = JSON.parse(localStorage.getItem(`fj-session-${s.id}`) || "null"); } catch (_) { /* ignore */ }
  return html`<li class="session" data-session="${s.id}">
    <div class="session-date" aria-hidden="true"><span class="m">${f.month}</span><span class="d">${f.day}</span><span class="w">${f.wd}</span></div>
    <div class="session-info">
      <h3>${s.title}</h3>
      <p class="session-when">${f.weekday}, ${f.time}</p>
      <p class="session-where">${s.is_online ? "Online. The link appears when you register." : s.location || "Location shared on registration"}</p>
      ${s.description ? html`<p class="session-desc">${s.description}</p>` : ""}
      <div class="session-slot"></div>
    </div>
    <div class="session-cta">
      ${mine ? html`<span class="pill-ok">${icon("check")} Registered</span><button class="btn btn-sm" type="button" data-show-reg="${s.id}">Calendar and details</button>`
        : left === 0 ? html`<span class="seats seats-full">Full</span>`
        : html`<button class="btn btn-accent btn-sm" type="button" data-register="${s.id}">Register</button>${left !== null ? html`<span class="seats">${left} seat${left === 1 ? "" : "s"} left</span>` : ""}`}
    </div>
  </li>`;
}

function confirmationBox(s, rc, already) {
  const f = fmtSession(s, rc.timezone);
  const { google } = calendarLinks(s);
  const join = safeUrl(s.join_url);
  return html`<div class="session-confirm" role="status">
    <strong>${already ? "You're already registered" : "You're registered"}</strong>
    <p>${f.weekday}, ${f.time}. ${join ? "" : s.location || ""}</p>
    ${join ? html`<p>Join link: <a href="${join}" target="_blank" rel="noopener">${join}</a></p>` : ""}
    <div class="row-actions">
      <a class="btn btn-sm" href="${google}" target="_blank" rel="noopener">${icon("calendar")} Add to Google Calendar</a>
      <button class="btn btn-sm" type="button" data-ics="${s.id}">${icon("download")} Apple / Outlook (.ics)</button>
    </div>
  </div>`;
}

// ---------- status, index and calendar ----------
function statusBlock(st) {
  return html`<div class="rs" data-tone="${st.tone}">
    <p class="rs-label"><span class="rs-dot" aria-hidden="true"></span>${st.label}</p>
    ${st.sub ? html`<p class="rs-detail">${st.sub}.</p>` : ""}
    ${st.until ? html`<p class="rs-clock" data-until="${st.until}"></p>` : ""}
  </div>`;
}

function indexBox(items) {
  return html`<nav class="apply-index" aria-labelledby="apply-index-h">
    <h2 class="sr-only" id="apply-index-h">On this page</h2>
    <ul>${items.map((i) => html`<li><a href="#${i.id}"><span class="ai-name">${i.label}</span>${i.note ? html`<span class="ai-note">${i.note}</span>` : ""}</a></li>`)}</ul>
  </nav>`;
}

/** The recruiting calendar: the period's dates and the info sessions in it, with today placed between them. */
function calendar(st, rc, sessions) {
  const tz = rc.timezone || "America/Chicago";
  const now = Date.now();
  const soon = st.upcoming && zonedTime(st.upcoming.starts_on, "00:00:00", tz) - now < 45 * DAY ? st.upcoming : null;
  const p = st.period || soon;
  const marks = [];
  let from, to;
  if (p) {
    from = zonedTime(p.starts_on, "00:00:00", tz);
    to = zonedTime(p.ends_on, "23:59:00", tz);
    marks.push({ at: from, day: p.starts_on, title: `${p.title} begins` });
    marks.push({ at: to, day: p.ends_on, title: "Apply by", note: "11:59 pm" });
    if (p.decisions_on) marks.push({ at: zonedTime(p.decisions_on, "12:00:00", tz), day: p.decisions_on, title: "Decisions by" });
  } else if (rc.status === "deadline" && rc.deadline && st.open) {
    from = now - 7 * DAY;
    to = zonedTime(rc.deadline, "23:59:00", tz);
    marks.push({ at: to, day: rc.deadline, title: "Applications close", note: "11:59 pm" });
  } else return null;
  sessions.filter((s) => { const t = new Date(s.starts_at).getTime(); return t >= from - 21 * DAY && t <= to; }).slice(0, 4)
    .forEach((s) => marks.push({ at: new Date(s.starts_at).getTime(), title: s.title, href: "#info-sessions" }));
  if (marks.length < 2) return null;
  marks.sort((a, b) => a.at - b.at);
  let progress = 0;
  if (now >= marks[marks.length - 1].at) progress = 1;
  else if (now > marks[0].at) {
    const i = marks.findIndex((m) => m.at > now) - 1;
    progress = (i + (now - marks[i].at) / (marks[i + 1].at - marks[i].at || 1)) / (marks.length - 1);
  }
  const next = marks.findIndex((m) => m.at > now);
  const items = marks.map((m, i) => {
    const state = m.at <= now ? "past" : i === next ? "next" : "ahead";
    const date = m.day ? dayShort(m.day) : new Date(m.at).toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric" });
    const note = m.day ? [weekdayOf(m.day), m.note].filter(Boolean).join(", ")
      : `${new Date(m.at).toLocaleDateString("en-US", { timeZone: tz, weekday: "long" })}, ${clock(m.at, tz)}`;
    const inner = html`<span class="cal-node" aria-hidden="true"></span><span class="cal-date">${date}</span><span class="cal-title">${m.title}</span><span class="cal-note">${note}</span>`;
    return html`<li class="cal-mark is-${state}">${m.href ? html`<a href="${m.href}">${inner}</a>` : inner}${state === "past" ? html`<span class="sr-only">, passed</span>` : ""}</li>`;
  });
  return {
    range: p ? `${dayShort(p.starts_on)} to ${dayShort(p.ends_on)}` : `Until ${dayShort(rc.deadline)}`,
    lede: `${p ? `${p.title}. ` : ""}Dates are in ${cityOf(tz)} time.`,
    markup: html`<div class="cal-wrap" style="--n:${marks.length};--p:${progress.toFixed(4)}">
      <ol class="cal">${items}</ol>
      ${progress > 0 && progress < 1 ? raw('<span class="cal-today" aria-hidden="true">Today</span>') : ""}
    </div>`,
  };
}

// ---------- page ----------
function render({ rc, authors, sessions, periods }) {
  const st = applicationStatus(rc, new Date(), periods);
  HOSTS = allHosts(rc, authors);
  const hosts = hostCards(HOSTS, authors);
  const cal = calendar(st, rc, sessions);
  const nextSession = sessions[0] ? fmtSession(sessions[0], rc.timezone) : null;
  setMeta({ title: "Apply", description: rc.lede });
  const index = [
    { id: "how", label: "How it works", note: `${rc.steps.length} steps` },
    cal ? { id: "calendar", label: "Recruiting calendar", note: cal.range } : null,
    { id: "info-sessions", label: "Info sessions", note: nextSession ? `Next on ${nextSession.month} ${nextSession.day}` : "None scheduled yet" },
    hosts.length ? { id: "coffee-chats", label: "Coffee chats", note: `${hosts.length} member${hosts.length === 1 ? "" : "s"} to talk to` } : null,
    rc.roles.length ? { id: "roles", label: "Roles", note: `${rc.roles.length} to choose from` } : null,
    { id: "apply-form", label: st.open ? "Apply" : "Get notified", note: st.open ? "Saves as you write" : "" },
    rc.faq.length ? { id: "faq", label: "Questions" } : null,
  ].filter(Boolean);
  const lookFor = rc.lookFor.length ? html`<div class="lookfor"><h3>What we look for</h3><ul class="checks">${rc.lookFor.map((t) => html`<li>${icon("check")}<span>${t}</span></li>`)}</ul></div>` : "";

  mount(main, html`<div class="container page apply">
    <section class="apply-hero">
      <div>
        ${statusBlock(st)}
        <h1>${rc.headline}</h1>
        <p class="lede">${rc.lede}</p>
        <div class="apply-ctas">
          ${st.open ? html`<a class="btn btn-accent" href="${START}" data-start data-track="application_start" data-track-from="hero">Start your application</a>`
            : html`<a class="btn btn-accent" href="#apply-form">Get notified when we reopen</a>`}
          ${sessions.length ? html`<a class="btn" href="#info-sessions">See info sessions</a>` : hosts.length ? html`<a class="btn" href="#coffee-chats">Book a coffee chat</a>` : ""}
        </div>
        <p class="apply-signin" data-signin>Started already? <a href="/portal/#application">Sign in to continue</a>.</p>
      </div>
      ${indexBox(index)}
    </section>

    ${rc.highlights.length ? html`<dl class="apply-facts" style="--facts:${Math.min(rc.highlights.length, 4)}">${rc.highlights.map((h) => html`<div><dt>${h.title}</dt><dd>${h.text}</dd></div>`)}</dl>` : ""}

    <section class="apply-section" id="how" aria-labelledby="how-h">
      <div class="apply-split">
        <header><h2 id="how-h">How it works</h2></header>
        <ol class="steps">${rc.steps.map((s, i) => html`<li><span class="step-n" aria-hidden="true">${i + 1}</span><div><h3>${s.title}</h3><p>${s.text}</p></div></li>`)}</ol>
      </div>
    </section>

    ${cal ? html`<section class="apply-section" id="calendar" aria-labelledby="cal-h">
      <header class="apply-wide-head"><h2 id="cal-h">Recruiting calendar</h2><p>${cal.lede}</p></header>
      ${cal.markup}
    </section>` : ""}

    <section class="apply-section" id="info-sessions" aria-labelledby="is-h">
      <div class="apply-split">
        <header><h2 id="is-h">Info sessions</h2><p>${rc.sessionsIntro}</p></header>
        <div>${sessions.length ? html`<ul class="sessions">${sessions.map((s) => sessionRow(s, rc))}</ul>` : html`
          <div class="apply-card apply-empty">
            <h3>No sessions on the calendar right now</h3>
            <p>Leave your email and we'll tell you when the next one is announced.</p>
            <form class="inline-subscribe" data-notify="info-sessions" novalidate><label class="sr-only" for="n-sess">Email</label><input class="input" id="n-sess" name="email" type="email" placeholder="you@uchicago.edu" autocomplete="email"><button class="btn btn-accent" type="submit">Notify me</button></form>
            <p class="form-error" role="alert"></p>
          </div>`}</div>
      </div>
    </section>

    ${hosts.length ? html`<section class="apply-section" id="coffee-chats" aria-labelledby="cc-h">
      <div class="apply-split">
        <header><h2 id="cc-h">Coffee chats</h2><p>${rc.chatsIntro}</p></header>
        <div class="hosts">${hosts}</div>
      </div>
    </section>` : ""}

    ${rc.roles.length ? html`<section class="apply-section" id="roles" aria-labelledby="roles-h">
      <div class="apply-split">
        <header><h2 id="roles-h">Roles</h2><p>Pick one or several on the application. Most people start as writers and analysts.</p></header>
        <div class="roles">${rc.roles.map((r) => html`<div class="role"><h3>${r.title}</h3><p>${r.text}</p></div>`)}</div>
      </div>
    </section>` : ""}

    <section class="apply-section" id="apply-form" aria-labelledby="af-h">
      <div class="apply-split">
        <header><h2 id="af-h">${st.open ? "Apply" : "Applications are closed"}</h2>
          <p>${st.open ? "Applications are written in the Fershman portal, so nothing you write is lost." : "We aren't taking applications right now."}</p></header>
        <div class="apply-start">
          ${st.open ? html`<div class="apply-card">
            <h3>Start your application</h3>
            <p>Create an account, then answer two short questions: why Fershman, and a story you'd pitch. Add a writing sample if you have one. Your draft saves as you write, and the portal shows where your application stands until you hear back.</p>
            <div class="apply-ctas">
              <a class="btn btn-accent" href="${START}" data-start data-track="application_start" data-track-from="apply_section">Start your application</a>
              <a class="btn btn-ghost-link" href="/portal/#application" data-signin>Sign in to continue</a>
            </div>
          </div>` : html`<div class="apply-card">
            <h3>Get notified</h3>
            <p>Leave your email and we'll tell you the day applications reopen. You can also <a href="${START}">start a draft in the portal</a> and submit it then.</p>
            <form class="inline-subscribe" data-notify="apply-waitlist" novalidate><label class="sr-only" for="n-app">Email</label><input class="input" id="n-app" name="email" type="email" autocomplete="email" placeholder="you@uchicago.edu"><button class="btn btn-accent" type="submit">Notify me</button></form>
            <p class="form-error" role="alert"></p>
          </div>`}
          ${lookFor}
        </div>
      </div>
    </section>

    ${rc.faq.length ? html`<section class="apply-section" id="faq" aria-labelledby="faq-h">
      <div class="apply-split">
        <header><h2 id="faq-h">Questions</h2></header>
        <div>
          <div class="faq">${rc.faq.map((f) => html`<details><summary>${f.q}</summary><p>${f.a}</p></details>`)}</div>
          ${S.applyContacts && S.applyContacts.length ? html`<p class="apply-contact">Still have a question? Email ${S.applyContacts.map((e, i) => html`${i ? " or " : ""}<a href="mailto:${e}">${e}</a>`)}.</p>` : ""}
        </div>
      </div>
    </section>` : ""}
  </div>`);
  wire(rc);
  personalize();
}

/** Signed-in applicants see "Continue your application" instead of "Start". */
async function personalize() {
  try {
    const s = await db.getSession();
    if (!s) return;
    $$("[data-signin]", main).forEach((el) => el.remove());
    const a = await db.myApplication();
    if (!a) return;
    const label = a.status === "draft" ? "Continue your application" : "View your application";
    $$("[data-start]", main).forEach((el) => { el.textContent = label; el.href = "/portal/#application"; });
  } catch (_) { /* the page works the same for everyone */ }
}

function wire(rc) {
  // Countdown to the closing date
  const clockEl = $(".rs-clock", main);
  if (clockEl) {
    const until = Number(clockEl.dataset.until);
    const tick = () => {
      const left = until - Date.now();
      clockEl.textContent = left > 0 ? `${countdown(left)} left` : "";
      return left > 0;
    };
    if (tick()) { const t = setInterval(() => { if (!tick()) clearInterval(t); }, 30000); }
  }

  // The calendar's progress line draws in once, when it scrolls into view.
  const cal = $(".cal", main);
  if (cal && !reduceMotion && "IntersectionObserver" in window) {
    cal.classList.add("is-waiting");
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      requestAnimationFrame(() => cal.classList.remove("is-waiting"));
      io.disconnect();
    }, { threshold: 0.5 });
    io.observe(cal);
  }

  // Coffee-chat booking
  main.addEventListener("click", (e) => {
    const b = e.target.closest("[data-book]");
    if (!b) return;
    const h = HOSTS[Number(b.dataset.book)];
    const url = safeUrl(h.booking_url);
    track("coffee_chat_click", { host_name: h.name, method: "booking" });
    const embed = embedBooking(url);
    if (!embed || matchMedia("(max-width: 640px)").matches) { window.open(url, "_blank", "noopener"); return; }
    openPanel({
      title: `Book a coffee chat with ${h.name || "a member"}`,
      wide: true,
      body: html`<iframe class="booking-frame" src="${embed}" title="Booking calendar"></iframe>`.value,
      foot: html`<a class="btn" href="${url}" target="_blank" rel="noopener">${icon("external")} Open in a new tab</a>`.value,
    });
  });

  // Info sessions: open a registration form inside the row
  main.addEventListener("click", (e) => {
    const r = e.target.closest("[data-register]");
    if (r) {
      $$(".session-slot", main).forEach((x) => (x.innerHTML = ""));
      const row = r.closest(".session");
      mount($(".session-slot", row), html`<form class="session-form" novalidate>
        <div class="field-row">
          <div class="field"><label for="r-name">Name</label><input class="input" id="r-name" name="name" autocomplete="name" required></div>
          <div class="field"><label for="r-email">Email</label><input class="input" id="r-email" name="email" type="email" autocomplete="email" required></div>
        </div>
        <div class="field"><label for="r-year">Year</label><select class="select" id="r-year" name="year"><option value="">Choose…</option>${YEARS.map((y) => html`<option>${y}</option>`)}</select></div>
        ${honeypot}
        <p class="form-error" role="alert"></p>
        <div class="row-actions"><button class="btn btn-accent btn-sm" type="submit">Confirm registration</button><button class="btn btn-sm" type="button" data-cancel-reg>Cancel</button></div>
      </form>`);
      $("#r-name", row).focus();
    }
    if (e.target.closest("[data-cancel-reg]")) e.target.closest(".session-slot").innerHTML = "";
    const show = e.target.closest("[data-show-reg]");
    if (show) {
      const saved = JSON.parse(localStorage.getItem(`fj-session-${show.dataset.showReg}`) || "null");
      if (saved) mount($(".session-slot", show.closest(".session")), confirmationBox(saved, rc, true));
    }
    const ics = e.target.closest("[data-ics]");
    if (ics) {
      const saved = JSON.parse(localStorage.getItem(`fj-session-${ics.dataset.ics}`) || "null");
      if (saved) downloadFile("fershman-info-session.ics", calendarLinks(saved).ics, "text/calendar");
    }
  });
  main.addEventListener("submit", async (e) => {
    const form = e.target.closest(".session-form");
    if (!form) return;
    e.preventDefault();
    const err = $(".form-error", form);
    const v = Object.fromEntries(new FormData(form).entries());
    if (v.company_website) return;
    if (!v.name.trim()) { err.textContent = "Enter your name."; return; }
    if (!isEmail(v.email)) { err.textContent = "Enter a valid email address."; return; }
    const row = form.closest(".session");
    const btn = $('button[type="submit"]', form);
    btn.disabled = true;
    try {
      const res = await db.registerForSession(row.dataset.session, { name: v.name.trim(), email: v.email.trim(), year: v.year });
      if (res.status === "registered" || res.status === "already") {
        try { localStorage.setItem(`fj-session-${res.id}`, JSON.stringify(res)); } catch (_) { /* private mode */ }
        mount($(".session-slot", row), confirmationBox(res, rc, res.status === "already"));
        mount($(".session-cta", row), html`<span class="pill-ok">${icon("check")} Registered</span>`);
        if (res.status === "registered") track("info_session_register", { session_title: res.title });
        toast(res.status === "already" ? "You're already registered" : "You're registered");
      } else if (res.status === "full") {
        err.textContent = "This session just filled up. Try another one.";
      } else if (res.status === "invalid") {
        err.textContent = "Check your name and email and try again.";
      } else {
        err.textContent = "Registration for this session has closed.";
      }
    } catch (ex) {
      err.textContent = friendlyError(ex);
    } finally { btn.disabled = false; }
  });

  // "Notify me" forms
  main.addEventListener("submit", async (e) => {
    const form = e.target.closest("[data-notify]");
    if (!form) return;
    e.preventDefault();
    const email = form.email.value.trim();
    const err = form.parentElement.querySelector(".form-error");
    if (!isEmail(email)) { if (err) err.textContent = "Enter a valid email address."; return; }
    try {
      await db.subscribe({ email, source: form.dataset.notify });
      track("recruiting_notify", { source: form.dataset.notify });
      form.outerHTML = html`<div class="form-success" role="status"><strong>You're on the list</strong>We'll email you.</div>`.value;
    } catch (ex) { if (err) err.textContent = friendlyError(ex); }
  });
}

try {
  render(await load());
  if (location.hash) setTimeout(() => { const el = document.querySelector(location.hash); if (el) el.scrollIntoView(); }, 50);
} catch (err) {
  console.error(err);
  mount(main, html`<div class="container">${errorState(err)}</div>`);
}
