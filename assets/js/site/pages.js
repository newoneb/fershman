// About, Submit, Apply, Subscribe, Contact, Privacy and 404 pages.
import { db, config } from "../data/db.js";
import { html, raw, mount, icon, isEmail, $ } from "../lib/util.js";
import { renderMarkdown } from "../lib/md.js";
import { initChrome, setMeta } from "./chrome.js";
import { track } from "./analytics.js";
import { avatar, authorUrl, sectionName, errorState } from "./cards.js";

const page = document.body.dataset.page;
const main = $("#main");
const S = config.site;
initChrome({ active: { about: "about", submit: "submit", contact: "contact" }[page] || null });

const honeypot = raw(`<div class="hp" aria-hidden="true"><label>Leave this empty <input name="company_website" tabindex="-1" autocomplete="off"></label></div>`);

/** Wire a form: validate, send, swap in a success message. */
function wireForm(form, { send, success, event }) {
  const err = form.querySelector(".form-error");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.textContent = "";
    const fd = new FormData(form);
    if (fd.get("company_website")) { form.replaceWith(successBox(success)); return; } // bot
    for (const el of form.querySelectorAll("[required]")) {
      if (el.type === "checkbox" ? !el.checked : !String(el.value).trim()) {
        err.textContent = `Fill in “${el.dataset.label || el.name}” to continue.`;
        el.focus();
        return;
      }
    }
    const email = fd.get("email");
    if (email !== null && !isEmail(email)) { err.textContent = "Enter a valid email address."; form.email.focus(); return; }
    const btn = form.querySelector('button[type="submit"]');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Sending…";
    try {
      const values = Object.fromEntries(fd.entries());
      const result = await send(values);
      if (event) track(event.name, typeof event.params === "function" ? event.params(values, result) : event.params || {});
      form.replaceWith(successBox(typeof success === "function" ? success(result) : success));
    } catch (ex) {
      err.textContent = ex.message || "That didn't go through. Try again in a moment.";
      btn.disabled = false;
      btn.textContent = label;
    }
  });
}
function successBox({ title, text }) {
  const div = document.createElement("div");
  div.className = "form-success";
  div.setAttribute("role", "status");
  div.innerHTML = html`<strong>${title}</strong>${text}`.value;
  return div;
}
const sectionOptions = () => config.sections.map((s) => html`<option value="${s.slug}">${s.name}</option>`);

async function about() {
  setMeta({ title: "About us", description: S.description });
  const [settings, authors] = await Promise.all([db.getSettings(), db.listAuthors()]);
  const leaders = authors.filter((a) => a.team === "Leadership");
  mount(main, html`<div class="container page">
    <header class="page-head"><h1>About the Journal</h1><p>${S.tagline}. ${S.description}</p></header>
    <div class="page-grid">
      <div class="prose">${raw(renderMarkdown(settings.about_md))}</div>
      <aside class="aside-stack">
        <section class="panel">
          <h2>Get involved</h2>
          <p>Write for us, join the team, or just read along.</p>
          <ul class="panel-links">
            <li><a href="/submit">Submit an article</a></li>
            <li><a href="/apply">Apply to join</a></li>
            <li><a href="/register">Subscribe to the briefing</a></li>
            <li><a href="/learn">Start learning</a></li>
          </ul>
        </section>
      </aside>
    </div>
    <section aria-labelledby="pillars-h">
      <h2 class="sr-only" id="pillars-h">What we do</h2>
      <div class="pillars">
        <div class="pillar"><h3>Financial journalism</h3><p>Independent analysis of M&A, markets and policy, with no house position to protect.</p></div>
        <div class="pillar"><h3>Free financial education</h3><p>Lessons and workshops that make economics and finance accessible to communities that are rarely offered them.</p></div>
        <div class="pillar"><h3>Risk diagnosis</h3><p>Quarterly reports on the U.S. economy, nationally and state by state: what drives growth and what could break.</p></div>
      </div>
    </section>
    ${leaders.length ? html`
    <section class="team" aria-labelledby="masthead-h">
      <h2 id="masthead-h">Masthead</h2>
      <ul class="people">${leaders.map((p) => html`<li><a class="person" href="${authorUrl(p)}">${avatar(p, "avatar-md")}<div><div class="person-name">${p.name}</div><div class="person-role">${p.role_title || ""}</div></div></a></li>`)}</ul>
      <p style="margin-top:16px"><a class="btn" href="/team">Meet the whole team</a></p>
    </section>` : ""}
  </div>`);
}

async function submit() {
  setMeta({ title: "Write for Fershman", description: "Pitch or submit an article to The Fershman Journal." });
  const settings = await db.getSettings();
  mount(main, html`<div class="container page">
    <header class="page-head"><h1>Write for Fershman</h1><p>Shape the narrative. We publish analysts, students, investors and operators with original ideas, especially ones that spot a pattern early or challenge the consensus.</p></header>
    <div class="page-grid">
      <div class="prose">${raw(renderMarkdown(settings.submit_md))}</div>
      <section class="form-card" aria-labelledby="sub-form-h">
        <h2 id="sub-form-h">Send your pitch or draft</h2>
        <p>An editor reads every submission and replies within two weeks.</p>
        <form class="form" novalidate>
          <div class="field-row">
            <div class="field"><label for="f-name">Name</label><input class="input" id="f-name" name="name" required data-label="Name" autocomplete="name"></div>
            <div class="field"><label for="f-email">Email</label><input class="input" id="f-email" name="email" type="email" required data-label="Email" autocomplete="email"></div>
          </div>
          <div class="field-row">
            <div class="field"><label for="f-type">This is a</label><select class="select" id="f-type" name="type"><option value="pitch">Pitch</option><option value="draft">Finished draft</option></select></div>
            <div class="field"><label for="f-section">Section</label><select class="select" id="f-section" name="section">${sectionOptions()}</select></div>
          </div>
          <div class="field"><label for="f-title">Working headline</label><input class="input" id="f-title" name="subject" required data-label="Working headline"></div>
          <div class="field"><label for="f-link">Link to your draft <span class="hint">(optional, e.g. a Google Doc)</span></label><input class="input" id="f-link" name="link" type="url" placeholder="https://"></div>
          <div class="field"><label for="f-text">Your pitch or article</label><textarea class="textarea" id="f-text" name="body" required data-label="Your pitch or article" rows="10" placeholder="What's the argument, why now, and what evidence backs it?"></textarea></div>
          ${honeypot}
          <p class="form-error" role="alert"></p>
          <div><button class="btn btn-accent" type="submit">Send submission</button></div>
        </form>
      </section>
    </div>
  </div>`);
  wireForm($("form"), {
    send: (v) => db.sendMessage({ kind: "submission", name: v.name, email: v.email, subject: v.subject, body: v.body, data: { type: v.type, section: v.section, section_name: sectionName(v.section), link: v.link } }),
    success: { title: "Submission received", text: "Thanks for writing to us. An editor will reply by email." },
    event: { name: "story_pitch", params: (v) => ({ pitch_type: v.type, article_section: sectionName(v.section) }) },
  });
}

async function subscribe() {
  setMeta({ title: "Subscribe", description: "Get The Fershman Journal's analysis in your inbox." });
  const benefit = (t) => html`<li>${icon("check")}<span>${t}</span></li>`;
  mount(main, html`<div class="container page">
    <div class="subscribe-hero">
      <div>
        <h1>The Fershman briefing</h1>
        <p class="lede">New analysis on deals, markets and policy from our writers, delivered when it's published. Free, always.</p>
        <ul class="benefits">
          ${benefit("Every new story, the day it goes live")}
          ${benefit("Our quarterly U.S. risk reports")}
          ${benefit("Invitations to talks, info sessions and pitch nights")}
        </ul>
      </div>
      <section class="form-card" aria-labelledby="subf-h">
        <h2 id="subf-h">Join the list</h2>
        <p>One email when there's something worth reading. Unsubscribe anytime.</p>
        <form class="form" novalidate>
          <div class="field"><label for="s-name">Name <span class="hint">(optional)</span></label><input class="input" id="s-name" name="name" autocomplete="name"></div>
          <div class="field"><label for="s-email">Email</label><input class="input" id="s-email" name="email" type="email" required data-label="Email" autocomplete="email"></div>
          <label class="check"><input type="checkbox" name="consent" required data-label="the privacy policy box"><span>I agree to receive emails from The Fershman Journal and accept the <a href="/privacy">privacy policy</a>.</span></label>
          ${honeypot}
          <p class="form-error" role="alert"></p>
          <div><button class="btn btn-accent" type="submit">Subscribe</button></div>
        </form>
        <p class="form-note" style="margin-top:18px">Club member? <a href="/portal/">Sign in to the members portal</a>.</p>
      </section>
    </div>
  </div>`);
  wireForm($("form"), {
    send: (v) => db.subscribe({ email: v.email, name: v.name, source: "subscribe-page" }),
    success: (r) => (r && r.already
      ? { title: "You're already subscribed", text: "That address is already on the list. Nothing else to do." }
      : { title: "You're subscribed", text: "Welcome aboard. The next story will land in your inbox." }),
    event: { name: "newsletter_signup", params: (v, r) => ({ source: "subscribe_page", already: r && r.already ? "yes" : "no" }) },
  });
}

async function contact() {
  setMeta({ title: "Contact", description: "Get in touch with The Fershman Journal." });
  const soc = S.social || {};
  mount(main, html`<div class="container page">
    <header class="page-head"><h1>Contact</h1><p>Tips, corrections, partnerships or questions — we read everything.</p></header>
    <div class="page-grid">
      <section class="form-card" aria-labelledby="c-h">
        <h2 id="c-h">Send a message</h2>
        <p>We usually reply within a few days.</p>
        <form class="form" novalidate>
          <div class="field-row">
            <div class="field"><label for="c-name">Name</label><input class="input" id="c-name" name="name" required data-label="Name" autocomplete="name"></div>
            <div class="field"><label for="c-email">Email</label><input class="input" id="c-email" name="email" type="email" required data-label="Email" autocomplete="email"></div>
          </div>
          <div class="field"><label for="c-topic">Topic</label><select class="select" id="c-topic" name="subject"><option>General question</option><option>Correction</option><option>News tip</option><option>Partnership or sponsorship</option><option>Press</option></select></div>
          <div class="field"><label for="c-msg">Message</label><textarea class="textarea" id="c-msg" name="body" required data-label="Message" rows="8"></textarea></div>
          ${honeypot}
          <p class="form-error" role="alert"></p>
          <div><button class="btn btn-accent" type="submit">Send message</button></div>
        </form>
      </section>
      <aside class="aside-stack">
        <section class="panel"><h2>Email</h2><ul class="contact-list"><li><a href="mailto:${S.contactEmail}">${S.contactEmail}</a></li></ul></section>
        <section class="panel"><h2>Follow</h2><ul class="panel-links">
          ${soc.x ? html`<li><a href="${soc.x}" target="_blank" rel="noopener">X</a></li>` : ""}
          ${soc.instagram ? html`<li><a href="${soc.instagram}" target="_blank" rel="noopener">Instagram</a></li>` : ""}
          ${soc.linkedin ? html`<li><a href="${soc.linkedin}" target="_blank" rel="noopener">LinkedIn</a></li>` : ""}
        </ul></section>
      </aside>
    </div>
  </div>`);
  wireForm($("form"), {
    send: (v) => db.sendMessage({ kind: "contact", name: v.name, email: v.email, subject: v.subject, body: v.body }),
    success: { title: "Message sent", text: "Thanks for getting in touch. We'll reply by email." },
    event: { name: "contact_message", params: (v) => ({ topic: v.subject }) },
  });
}

async function privacy() {
  setMeta({ title: "Privacy policy" });
  const settings = await db.getSettings();
  mount(main, html`<div class="container-narrow page">
    <header class="page-head"><h1>Privacy policy</h1></header>
    <div class="prose">${raw(renderMarkdown(settings.privacy_md))}</div>
  </div>`);
}

function notFound() {
  setMeta({ title: "Page not found" });
  mount(main, html`<div class="container notfound">
    <h1>This page isn't here</h1>
    <p>The link may be old or mistyped. If you followed a link to a story, try searching for it.</p>
    <div class="actions"><a class="btn btn-accent" href="/">Front page</a><a class="btn" href="/search">Search</a><a class="btn" href="/categories">All categories</a></div>
  </div>`);
}

const routes = { about, submit, subscribe, contact, privacy, notfound: notFound };
try {
  await (routes[page] || notFound)();
} catch (err) {
  console.error(err);
  mount(main, html`<div class="container">${errorState(err)}</div>`);
}
