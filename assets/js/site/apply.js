// Apply page: rolling status, process, roles, coffee chats, info sessions, application form, FAQ.
import { db, config } from "../data/db.js";
import { html, raw, mount, icon, isEmail, safeUrl, $, $$ } from "../lib/util.js";
import { openPanel, toast, downloadFile } from "../lib/ui.js";
import { mergeRecruiting, applicationStatus, friendlyError } from "../data/shared.js";
import { initChrome, setMeta } from "./chrome.js";
import { avatar, errorState } from "./cards.js";

initChrome({ active: null });
const main = $("#main");
const S = config.site;
const DRAFT_KEY = "fj-apply-draft";
const YEARS = ["First year", "Second year", "Third year", "Fourth year", "Graduate student", "Other"];
const HEARD = ["A friend or member", "Info session", "Activities fair", "Instagram", "LinkedIn", "Reading the journal", "Other"];

const honeypot = raw(`<div class="hp" aria-hidden="true"><label>Leave this empty <input name="company_website" tabindex="-1" autocomplete="off"></label></div>`);

// ---------- time & calendar helpers ----------
function fmtSession(s, tz) {
  const start = new Date(s.starts_at);
  const end = new Date(start.getTime() + (s.duration_min || 60) * 60000);
  const opt = (o) => ({ timeZone: tz, ...o });
  return {
    day: start.toLocaleDateString("en-US", opt({ day: "numeric" })),
    month: start.toLocaleDateString("en-US", opt({ month: "short" })),
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

// ---------- page ----------
async function load() {
  const [settings, authors, sessions] = await Promise.all([
    db.getSettings(),
    db.listAuthors().catch(() => []),
    db.listInfoSessions().catch((e) => { console.warn("Info sessions unavailable", e); return []; }),
  ]);
  return { rc: mergeRecruiting(settings.recruiting), authors, sessions };
}

function hostCards(rc, authors) {
  return rc.hosts.filter((h) => h && (h.name || h.author_slug)).map((h, i) => {
    const a = authors.find((x) => x.slug === h.author_slug);
    const person = { name: h.name || (a && a.name) || "Fershman member", avatar_url: (a && a.avatar_url) || "", slug: a && a.slug };
    const role = h.role || (a && a.role_title) || "";
    const booking = safeUrl(h.booking_url);
    const action = booking
      ? html`<button class="btn btn-accent btn-sm" type="button" data-book="${i}">Book a time</button>`
      : h.email ? html`<a class="btn btn-sm" href="mailto:${h.email}?subject=${encodeURIComponent("Coffee chat about joining Fershman")}">Email to schedule</a>` : "";
    return html`<article class="host">
      ${avatar(person, "avatar-md")}
      <div>
        <h3>${person.name}</h3>
        ${role ? html`<p class="host-role">${role}</p>` : ""}
        ${h.topics ? html`<p class="host-topics">Ask me about ${h.topics}</p>` : ""}
        <div class="host-actions">${action}</div>
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
    <div class="session-date" aria-hidden="true"><span class="d">${f.day}</span><span class="m">${f.month}</span></div>
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

function render({ rc, authors, sessions }) {
  const st = applicationStatus(rc);
  const hosts = hostCards(rc, authors);
  setMeta({ title: "Apply", description: rc.lede });
  mount(main, html`<div class="container page apply">
    <section class="apply-hero">
      <div>
        <p class="status-pill status-${st.tone}"><span class="dot" aria-hidden="true"></span>${st.label}${st.sub ? html`<span class="status-sub">${st.sub}</span>` : ""}</p>
        <h1>${rc.headline}</h1>
        <p class="lede">${rc.lede}</p>
        <div class="apply-ctas">
          ${st.open ? html`<a class="btn btn-accent" href="#apply-form">Start your application</a>` : html`<a class="btn btn-accent" href="#apply-form">Get notified when we reopen</a>`}
          ${hosts.length ? html`<a class="btn" href="#coffee-chats">Book a coffee chat</a>` : ""}
          ${sessions.length ? html`<a class="btn btn-ghost-link" href="#info-sessions">See info sessions</a>` : ""}
        </div>
      </div>
      ${rc.highlights.length ? html`<dl class="apply-facts">${rc.highlights.map((h) => html`<div><dt>${h.title}</dt><dd>${h.text}</dd></div>`)}</dl>` : ""}
    </section>

    <nav class="tabs apply-jump" aria-label="On this page">
      <a class="tab" href="#how">How it works</a>
      ${rc.roles.length ? html`<a class="tab" href="#roles">Roles</a>` : ""}
      ${hosts.length ? html`<a class="tab" href="#coffee-chats">Coffee chats</a>` : ""}
      <a class="tab" href="#info-sessions">Info sessions</a>
      <a class="tab" href="#apply-form">Application</a>
      ${rc.faq.length ? html`<a class="tab" href="#faq">FAQ</a>` : ""}
    </nav>

    <section class="apply-section" id="how" aria-labelledby="how-h">
      <header><h2 id="how-h">How it works</h2></header>
      <ol class="steps">${rc.steps.map((s, i) => html`<li><span class="step-n" aria-hidden="true">${i + 1}</span><h3>${s.title}</h3><p>${s.text}</p></li>`)}</ol>
    </section>

    ${rc.roles.length ? html`
    <section class="apply-section" id="roles" aria-labelledby="roles-h">
      <header><h2 id="roles-h">Roles</h2><p>Pick one or several on the application. Most people start as writers and analysts.</p></header>
      <div class="roles">${rc.roles.map((r) => html`<div class="role"><h3>${r.title}</h3><p>${r.text}</p></div>`)}</div>
    </section>` : ""}

    ${hosts.length ? html`
    <section class="apply-section" id="coffee-chats" aria-labelledby="cc-h">
      <header><h2 id="cc-h">Coffee chats</h2><p>${rc.chatsIntro}</p></header>
      <div class="hosts">${hosts}</div>
    </section>` : ""}

    <section class="apply-section" id="info-sessions" aria-labelledby="is-h">
      <header><h2 id="is-h">Info sessions</h2><p>${rc.sessionsIntro}</p></header>
      ${sessions.length ? html`<ul class="sessions">${sessions.map((s) => sessionRow(s, rc))}</ul>` : html`
        <div class="panel apply-empty">
          <h3>No sessions on the calendar right now</h3>
          <p>Leave your email and we'll tell you when the next one is announced.</p>
          <form class="inline-subscribe" data-notify="info-sessions" novalidate><label class="sr-only" for="n-sess">Email</label><input class="input" id="n-sess" name="email" type="email" placeholder="you@uchicago.edu" autocomplete="email"><button class="btn btn-accent" type="submit">Notify me</button></form>
          <p class="form-error" role="alert"></p>
        </div>`}
    </section>

    <section class="apply-section" id="apply-form" aria-labelledby="af-h">
      <div class="apply-form-wrap">
        <div>
          <header><h2 id="af-h">${st.open ? "Apply" : "Applications are closed"}</h2>
            <p>${st.open ? "It takes about ten minutes. Your answers save in this browser as you type, so you can finish later." : "We aren't taking applications right now. Leave your email and we'll tell you the day they reopen."}</p></header>
          ${rc.lookFor.length ? html`<h3 class="mini-h">What we look for</h3><ul class="checks">${rc.lookFor.map((t) => html`<li>${icon("check")}<span>${t}</span></li>`)}</ul>` : ""}
        </div>
        ${st.open ? applicationForm(rc) : html`
          <div class="form-card">
            <h2>Get notified</h2>
            <form class="form" data-notify="apply-waitlist" novalidate>
              <div class="field"><label for="n-app">Email</label><input class="input" id="n-app" name="email" type="email" autocomplete="email"></div>
              <p class="form-error" role="alert"></p>
              <div><button class="btn btn-accent" type="submit">Notify me</button></div>
            </form>
          </div>`}
      </div>
    </section>

    ${rc.faq.length ? html`
    <section class="apply-section" id="faq" aria-labelledby="faq-h">
      <header><h2 id="faq-h">Questions</h2></header>
      <div class="faq">${rc.faq.map((f) => html`<details><summary>${f.q}</summary><p>${f.a}</p></details>`)}</div>
      ${S.applyContacts && S.applyContacts.length ? html`<p class="apply-contact">Still have a question? Email ${S.applyContacts.map((e, i) => html`${i ? " or " : ""}<a href="mailto:${e}">${e}</a>`)}.</p>` : ""}
    </section>` : ""}
  </div>`);
  wire(rc, sessions);
}

function applicationForm(rc) {
  return html`<div class="form-card">
    <form class="form" id="application" novalidate>
      <div class="field-row">
        <div class="field"><label for="a-name">Full name</label><input class="input" id="a-name" name="name" required data-label="Full name" autocomplete="name"></div>
        <div class="field"><label for="a-email">Email</label><input class="input" id="a-email" name="email" type="email" required data-label="Email" autocomplete="email" placeholder="you@uchicago.edu"></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="a-year">Year</label><select class="select" id="a-year" name="year" required data-label="Year"><option value="">Choose…</option>${YEARS.map((y) => html`<option>${y}</option>`)}</select></div>
        <div class="field"><label for="a-major">Major(s)</label><input class="input" id="a-major" name="major" placeholder="Economics, Statistics"></div>
      </div>
      <fieldset class="field">
        <legend class="label">Roles you're interested in</legend>
        <div class="chips">${rc.roles.map((r) => html`<label class="chip"><input type="checkbox" name="roles" value="${r.title}"><span>${r.title}</span></label>`)}</div>
      </fieldset>
      <div class="field">
        <label for="a-why">Why Fershman?</label>
        <span class="hint">What draws you to markets, deals or policy, and what would you bring? Around 100 to 250 words.</span>
        <textarea class="textarea" id="a-why" name="why" rows="7" required data-label="Why Fershman?"></textarea>
        <span class="wordcount" data-wc="a-why">0 words</span>
      </div>
      <div class="field">
        <label for="a-pitch">Pitch the first story you'd write</label>
        <span class="hint">Two or three sentences: the argument, and why it matters now.</span>
        <textarea class="textarea" id="a-pitch" name="pitch" rows="4" required data-label="Pitch" style="min-height:110px"></textarea>
      </div>
      <div class="field-row">
        <div class="field"><label for="a-sample">Writing sample <span class="hint">(optional link)</span></label><input class="input" id="a-sample" name="sample" type="url" placeholder="https://"></div>
        <div class="field"><label for="a-resume">Résumé or LinkedIn <span class="hint">(optional link)</span></label><input class="input" id="a-resume" name="resume" type="url" placeholder="https://"></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="a-heard">How did you hear about us?</label><select class="select" id="a-heard" name="heard"><option value="">Choose…</option>${HEARD.map((h) => html`<option>${h}</option>`)}</select></div>
        <div class="field"><label for="a-met">Have you met us yet?</label><select class="select" id="a-met" name="met"><option value="">Choose…</option><option>Coffee chat</option><option>Info session</option><option>Both</option><option>Not yet</option></select></div>
      </div>
      ${honeypot}
      <p class="form-error" role="alert"></p>
      <div class="form-foot"><button class="btn btn-accent" type="submit">Submit application</button><span class="draft-state" aria-live="polite"></span></div>
    </form>
  </div>`;
}

function wire(rc, sessions) {
  const words = (t) => (String(t).trim().match(/\S+/g) || []).length;

  // Coffee-chat booking
  main.addEventListener("click", (e) => {
    const b = e.target.closest("[data-book]");
    if (!b) return;
    const h = rc.hosts[Number(b.dataset.book)];
    const url = safeUrl(h.booking_url);
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
      const draft = readDraft();
      if (draft.name) $("#r-name", row).value = draft.name;
      if (draft.email) $("#r-email", row).value = draft.email;
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
    const err = form.querySelector(".form-error") || form.parentElement.querySelector(".form-error");
    if (!isEmail(email)) { if (err) err.textContent = "Enter a valid email address."; return; }
    try {
      await db.subscribe({ email, source: form.dataset.notify });
      form.outerHTML = html`<div class="form-success" role="status"><strong>You're on the list</strong>We'll email you.</div>`.value;
    } catch (ex) { if (err) err.textContent = friendlyError(ex); }
  });

  // Application form: draft autosave, word count, submit
  const form = $("#application");
  if (!form) return;
  const state = $(".draft-state", form);
  const draft = readDraft();
  for (const [k, val] of Object.entries(draft)) {
    if (k === "roles") $$('input[name="roles"]', form).forEach((c) => (c.checked = val.includes(c.value)));
    else if (form.elements[k] && form.elements[k].type !== "checkbox") form.elements[k].value = val;
  }
  const wc = () => { const n = words(form.why.value); $('[data-wc="a-why"]', form).textContent = `${n} word${n === 1 ? "" : "s"}`; };
  wc();
  if (Object.keys(draft).length) state.textContent = "Draft restored from this browser";
  let t;
  form.addEventListener("input", () => {
    wc();
    clearTimeout(t);
    t = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(collect(form))); state.textContent = "Draft saved"; } catch (_) { /* ignore */ }
    }, 600);
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $(".form-error", form);
    err.textContent = "";
    const v = collect(form);
    if (new FormData(form).get("company_website")) return;
    for (const el of form.querySelectorAll("[required]")) {
      if (!String(el.value).trim()) { err.textContent = `Fill in “${el.dataset.label}” to continue.`; el.focus(); return; }
    }
    if (!isEmail(v.email)) { err.textContent = "Enter a valid email address."; form.email.focus(); return; }
    if (!v.roles.length) { err.textContent = "Choose at least one role."; return; }
    const btn = $('button[type="submit"]', form);
    btn.disabled = true;
    btn.textContent = "Submitting…";
    try {
      await db.sendMessage({
        kind: "application", name: v.name, email: v.email,
        subject: `${v.roles.join(", ")} (${v.year})`,
        body: v.why,
        data: { year: v.year, major: v.major, roles: v.roles.join(", "), pitch: v.pitch, sample: v.sample, resume: v.resume, heard: v.heard, met: v.met },
      });
      localStorage.removeItem(DRAFT_KEY);
      form.closest(".form-card").outerHTML = html`<div class="form-success apply-done" role="status">
        <strong>Application received</strong>
        <p>Thanks, ${v.name.split(" ")[0]}. ${rc.confirmation}</p>
        <div class="row-actions">${sessions.length ? html`<a class="btn btn-sm" href="#info-sessions">Register for an info session</a>` : ""}<a class="btn btn-sm" href="/">Read the latest</a></div>
      </div>`.value;
      $("#apply-form").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (ex) {
      err.textContent = friendlyError(ex);
      btn.disabled = false;
      btn.textContent = "Submit application";
    }
  });
}

function collect(form) {
  const fd = new FormData(form);
  const o = {};
  for (const k of ["name", "email", "year", "major", "why", "pitch", "sample", "resume", "heard", "met"]) o[k] = String(fd.get(k) || "").trim();
  o.roles = fd.getAll("roles");
  return o;
}
function readDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}") || {}; } catch (_) { return {}; }
}

try {
  render(await load());
  if (location.hash) setTimeout(() => { const el = document.querySelector(location.hash); if (el) el.scrollIntoView(); }, 50);
} catch (err) {
  console.error(err);
  mount(main, html`<div class="container">${errorState(err)}</div>`);
}
