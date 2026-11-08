// The applicant's side of the portal: write, save and submit an application, then follow it to
// a decision. The database enforces the same rules (guard_application() in supabase/schema.sql).
import { db, LIVE, config } from "../data/db.js";
import { html, raw, mount, icon, fmtDate, fmtDateTime, safeUrl, $, $$ } from "../lib/util.js";
import { toast } from "../lib/ui.js";
import {
  friendlyError, mergeRecruiting, applicationStatus, roleAtLeast, dayLong,
  APP_QUESTIONS, APP_STEPS, appStep, YEARS, HEARD, MET, APP_FILE_MB, wordsIn,
} from "../data/shared.js";

const FILE_TYPES = ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const timeOf = (iso) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const decided = (s) => s === "accepted" || s === "declined";

export async function applicationView(main, { session, application = null, onChange = () => {} }) {
  mount(main, html`<div class="app-head"><div class="skeleton" style="height:52px;max-width:520px"></div></div>`);
  const [settings, periods] = await Promise.all([
    db.getSettings().catch(() => ({})),
    db.listRecruitingPeriods().catch(() => []),
  ]);
  const rc = mergeRecruiting(settings.recruiting);
  const st = applicationStatus(rc, new Date(), periods);
  const member = roleAtLeast(session.profile.role, "member");
  let app = application;

  const draw = () => {
    const status = app ? app.status : "new";
    const editing = !app || status === "draft";
    const returned = Boolean(app && status === "draft" && app.submitted_at);
    const locked = editing && !st.open && !returned ? "Applications are closed right now. Your draft is saved, and you can submit it once they reopen." : "";
    mount(main, html`
      <header class="app-head">
        <h1>${app ? "Your application" : "Apply to The Fershman Journal"}</h1>
        <p>${statusText(app, st, periods)}</p>
      </header>
      ${tracker(status)}
      <div class="app-notes">${notes(app, st, editing, returned)}</div>
      ${editing ? form(app, rc, session, locked) : summary(app, st)}
      ${!member && editing ? html`<aside class="app-aside">
        <h2>Already on the team?</h2>
        <p>Current members don't need to apply. An admin approves existing members' accounts from the members list${config.site.contactEmail ? html`. If you're waiting, email <a href="mailto:${config.site.contactEmail}">${config.site.contactEmail}</a>` : ""}.</p>
      </aside>` : ""}`);
    if (editing) wireForm(locked);
    const restart = $("[data-restart]", main);
    if (restart) restart.addEventListener("click", () => { app = null; draw(); scrollTo({ top: 0 }); });
  };

  function wireForm(locked) {
    const f = $("#appform", main);
    const actions = $("#ap-actions", f);
    const say = (text, bad = false) => {
      const m = $(".app-save", f);
      if (!m) return;
      m.textContent = text;
      m.classList.toggle("is-bad", bad);
    };
    const counts = () => $$("[data-limit]", f).forEach((ta) => {
      const n = wordsIn(ta.value);
      const limit = Number(ta.dataset.limit);
      const c = $(`[data-count="${ta.name}"]`, f);
      c.textContent = `${n} of ${limit} words`;
      c.classList.toggle("over", n > limit);
    });
    counts();

    // Saves run one after another, so the first one creates the draft and the rest update it.
    let timer = 0;
    let queue = Promise.resolve(true);
    const save = (extra = null) => (queue = queue.then(async () => {
      try {
        app = await db.saveApplication({ ...collect(f), ...(extra || {}) }, app && app.id);
        onChange(app);
        say(`Draft saved ${timeOf(app.updated_at)}`);
        return true;
      } catch (err) {
        say(friendlyError(err), true);
        return false;
      }
    }));
    f.addEventListener("input", (e) => {
      if (e.target.type === "file") return;
      if (e.target.dataset.limit) counts();
      clearTimeout(timer);
      say("Saving…");
      timer = setTimeout(save, 1200);
    });
    f.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-save]");
      if (b) { clearTimeout(timer); b.disabled = true; await save(); b.disabled = false; }
      if (e.target.closest("[data-file-remove]")) removeFile();
    });

    // One optional file: a writing sample or résumé.
    const fileBox = $("#ap-file", f);
    const drawFile = () => mount(fileBox, html`
      ${app && app.file_path
        ? html`<span class="app-file-name">${icon("file")}<span>${app.file_name || "Your file"}</span></span><button class="btn btn-sm" type="button" data-file-remove>Remove</button>`
        : html`<span class="app-file-hint">Or upload a writing sample or résumé: a PDF or Word document, up to ${APP_FILE_MB} MB.</span>`}
      <label class="btn btn-sm app-upload">${icon("upload")}<span>${app && app.file_path ? "Replace file" : "Upload a file"}</span><input type="file" accept="${FILE_TYPES}" data-file></label>`);
    drawFile();
    fileBox.addEventListener("change", async (e) => {
      if (!e.target.matches("[data-file]")) return;
      const file = e.target.files[0];
      if (!file) return;
      if (!/\.(pdf|docx?)$/i.test(file.name)) { say("Upload a PDF or Word document.", true); return; }
      if (file.size > APP_FILE_MB * 1048576) { say(`That file is larger than ${APP_FILE_MB} MB. Try a PDF, or add a link instead.`, true); return; }
      clearTimeout(timer);
      say("Uploading your file…");
      const old = app && app.file_path;
      try {
        const up = await db.uploadApplicationFile(file);
        if (await save(up)) {
          if (old && old !== up.file_path) db.removeApplicationFile(old).catch(() => {});
          drawFile();
          say(`File uploaded. Draft saved ${timeOf(app.updated_at)}`);
        }
      } catch (err) { say(friendlyError(err), true); }
    });
    async function removeFile() {
      const old = app && app.file_path;
      if (await save({ file_path: null, file_name: null })) {
        if (old) db.removeApplicationFile(old).catch(() => {});
        drawFile();
      }
    }

    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearTimeout(timer);
      if (!(await save())) return;
      if (locked) { say(locked, true); return; }
      $$("[aria-invalid]", f).forEach((el) => el.removeAttribute("aria-invalid"));
      $("#ap-roles", f).classList.remove("is-invalid");
      const issues = problems(collect(f));
      if (issues.length) {
        issues.forEach(([name]) => {
          if (name === "roles") $("#ap-roles", f).classList.add("is-invalid");
          else { const el = f.elements.namedItem(name); if (el) el.setAttribute("aria-invalid", "true"); }
        });
        say(issues.length === 1 ? issues[0][1] : `${issues[0][1]} ${issues.length - 1} more ${issues.length === 2 ? "item needs" : "items need"} attention.`, true);
        const first = issues[0][0] === "roles" ? $("#ap-roles input", f) : f.elements.namedItem(issues[0][0]);
        if (first) first.focus();
        return;
      }
      const before = actions.innerHTML;
      actions.innerHTML = html`<div class="app-confirm" role="group" aria-labelledby="ap-confirm-q">
        <p id="ap-confirm-q">Submit your application? You won't be able to change it afterwards.</p>
        <button class="btn btn-accent" type="button" data-yes>Submit application</button>
        <button class="btn" type="button" data-no>Keep editing</button>
        <p class="form-error" role="alert"></p>
      </div>`.value;
      const yes = $("[data-yes]", actions);
      yes.focus();
      $("[data-no]", actions).addEventListener("click", () => { actions.innerHTML = before; });
      yes.addEventListener("click", async () => {
        yes.disabled = true;
        yes.textContent = "Submitting…";
        try {
          app = await db.submitApplication(app.id);
          onChange(app);
          toast("Application submitted");
          draw();
          scrollTo({ top: 0 });
        } catch (err) {
          $(".form-error", actions).textContent = friendlyError(err);
          yes.disabled = false;
          yes.textContent = "Submit application";
        }
      });
    });
  }

  draw();
}

function statusText(a, st, periods) {
  if (!a) {
    return st.open
      ? "Answer in your own words. Your draft saves as you write, so you can come back and finish it later."
      : "Applications are closed right now. You can still write a draft and submit it once they reopen.";
  }
  const p = periods.find((x) => x.id === a.period_id);
  const by = p && p.decisions_on ? dayLong(p.decisions_on) : "";
  switch (a.status) {
    case "draft": return a.submitted_at
      ? "The editors sent your application back so you can make changes. Submit it again when it's ready."
      : "Your draft is saved. Finish it and submit it when you're ready.";
    case "submitted": return `Submitted ${fmtDate(a.submitted_at)}. The editors read every application${by ? ` and share decisions by ${by}` : ""}. We'll email you about next steps.`;
    case "reviewing": return `The editors are reading your application${by ? ` and will share a decision by ${by}` : ""}. We'll email you about next steps.`;
    case "interview": return "You're invited to an interview. The editors will email you to find a time.";
    case "accepted": return "Welcome to The Fershman Journal. Your access is active.";
    case "declined": return "Thank you for applying. We can't offer you a place this time, and you're welcome to apply again in a future quarter.";
    default: return "";
  }
}

// Application, Review, Interview, Decision: a real sequence, so the steps are numbered.
function tracker(status) {
  const step = appStep(status);
  const finished = decided(status);
  const note = { new: "Not started", draft: "In progress", submitted: "Received", reviewing: "In review", interview: "Invited", accepted: "Accepted", declined: "Decision shared" }[status];
  return html`<ol class="track" aria-label="Application progress">${APP_STEPS.map((label, i) => {
    const state = i < step || (finished && i === step) ? "done" : i === step ? "current" : "";
    return html`<li class="${state}" ${i === step ? raw('aria-current="step"') : ""}>
      <span class="track-n">${i + 1}</span><span class="track-label">${label}</span>${i === step ? html`<span class="track-note">${note}</span>` : ""}
    </li>`;
  })}</ol>`;
}

function notes(a, st, editing, returned) {
  const out = [];
  if (editing && !returned) {
    out.push(st.open
      ? html`<aside class="app-note is-signal"><h2>${st.label}</h2>${st.sub ? html`<p>${st.sub}.</p>` : ""}</aside>`
      : html`<aside class="app-note"><h2>${st.label}</h2><p>Your draft is saved in the portal. You can submit it once applications reopen.</p></aside>`);
  }
  if (!LIVE) out.push(html`<aside class="app-note is-warn"><h2>Demo mode</h2><p>The portal isn't connected to a database, so this application stays in this browser and isn't sent to the journal.</p></aside>`);
  if (a && a.message) out.push(html`<aside class="app-note"><h2>A note from the editors</h2><p>${a.message}</p></aside>`);
  return out;
}

function form(a, rc, session, locked) {
  const ans = (a && a.answers) || {};
  const val = (k) => ans[k] || "";
  const opts = (list, cur) => list.map((x) => html`<option ${x === cur ? raw("selected") : ""}>${x}</option>`);
  const chosen = ans.roles || [];
  return html`<form class="appform" id="appform" novalidate>
    <fieldset class="app-fs">
      <legend>About you</legend>
      <div class="app-grid">
        <div class="field"><label for="ap-name">Full name</label><input class="input" id="ap-name" name="full_name" autocomplete="name" value="${(a && a.full_name) || session.profile.full_name || ""}"></div>
        <div class="field"><label for="ap-email">Email</label><input class="input" id="ap-email" value="${(a && a.email) || session.user.email}" readonly aria-describedby="ap-email-h"><span class="hint" id="ap-email-h">Your account email. We'll write to you here.</span></div>
        <div class="field"><label for="ap-year">Year</label><select class="select" id="ap-year" name="year"><option value="">Choose…</option>${opts(YEARS, val("year"))}</select></div>
        <div class="field"><label for="ap-major">Major or intended major</label><input class="input" id="ap-major" name="major" value="${val("major")}" placeholder="Economics, Statistics"></div>
        <div class="field"><label for="ap-grad">Expected graduation <span class="hint">(optional)</span></label><input class="input" id="ap-grad" name="graduation" value="${val("graduation")}" placeholder="June 2029"></div>
      </div>
    </fieldset>
    <fieldset class="app-fs">
      <legend>Roles you're interested in</legend>
      <p class="app-fs-note">Choose one or several. Most people start as writers and analysts.</p>
      <div class="chips" id="ap-roles">${rc.roles.map((r) => html`<label class="chip"><input type="checkbox" name="roles" value="${r.title}" ${chosen.includes(r.title) ? raw("checked") : ""}><span>${r.title}</span></label>`)}</div>
    </fieldset>
    <fieldset class="app-fs">
      <legend>Your writing</legend>
      ${APP_QUESTIONS.map((q) => html`<div class="field app-q">
        <label for="ap-${q.name}">${q.label}</label>
        <span class="hint" id="ap-${q.name}-h">${q.hint}</span>
        <textarea class="textarea" id="ap-${q.name}" name="${q.name}" rows="${q.rows}" data-limit="${q.limit}" aria-describedby="ap-${q.name}-h ap-${q.name}-c">${val(q.name)}</textarea>
        <span class="app-count" id="ap-${q.name}-c" data-count="${q.name}"></span>
      </div>`)}
    </fieldset>
    <fieldset class="app-fs">
      <legend>Something you've written</legend>
      <p class="app-fs-note">Optional, and it helps. A published piece, a class paper or a blog post all work.</p>
      <div class="app-grid">
        <div class="field"><label for="ap-sample">Writing sample link</label><input class="input" id="ap-sample" name="sample" type="url" value="${val("sample")}" placeholder="https://"></div>
        <div class="field"><label for="ap-linkedin">LinkedIn or résumé link</label><input class="input" id="ap-linkedin" name="linkedin" type="url" value="${val("linkedin")}" placeholder="https://"></div>
      </div>
      <div class="app-file" id="ap-file"></div>
    </fieldset>
    <fieldset class="app-fs">
      <legend>Finally</legend>
      <div class="app-grid">
        <div class="field"><label for="ap-heard">How did you hear about us?</label><select class="select" id="ap-heard" name="heard"><option value="">Choose…</option>${opts(HEARD, val("heard"))}</select></div>
        <div class="field"><label for="ap-met">Have you met us yet?</label><select class="select" id="ap-met" name="met"><option value="">Choose…</option>${opts(MET, val("met"))}</select></div>
      </div>
    </fieldset>
    <div class="app-actions" id="ap-actions">
      <button class="btn btn-accent" type="submit" ${locked ? raw("disabled") : ""}>Submit application</button>
      <button class="btn" type="button" data-save>Save draft</button>
      <p class="app-save" role="status" aria-live="polite">${a ? `Draft saved ${timeOf(a.updated_at)}` : "Your draft saves as you write."}</p>
      ${locked ? html`<p class="app-locked">${locked}</p>` : ""}
    </div>
  </form>`;
}

function collect(f) {
  const fd = new FormData(f);
  const s = (k) => String(fd.get(k) || "").trim();
  return {
    full_name: s("full_name"),
    answers: {
      year: s("year"), major: s("major"), graduation: s("graduation"), roles: fd.getAll("roles").map(String),
      why: s("why"), pitch: s("pitch"), sample: s("sample"), linkedin: s("linkedin"), heard: s("heard"), met: s("met"),
    },
  };
}

function problems(d) {
  const list = [];
  if (!d.full_name) list.push(["full_name", "Add your full name."]);
  if (!d.answers.year) list.push(["year", "Choose your year."]);
  if (!d.answers.major) list.push(["major", "Add your major, or the one you expect to choose."]);
  if (!d.answers.roles.length) list.push(["roles", "Choose at least one role."]);
  for (const q of APP_QUESTIONS) {
    const n = wordsIn(d.answers[q.name]);
    if (!n) list.push([q.name, `Answer “${q.label}”${/[?.!]$/.test(q.label) ? "" : "."}`]);
    else if (n > q.limit) list.push([q.name, `Shorten “${q.label}” to ${q.limit} words or fewer.`]);
  }
  for (const k of ["sample", "linkedin"]) {
    if (d.answers[k] && !/^https?:\/\/\S+$/i.test(d.answers[k])) list.push([k, "Links should start with https://"]);
  }
  return list;
}

function summary(a, st) {
  const ans = a.answers || {};
  const link = (v) => (v && /^https?:\/\//i.test(v) ? html`<a href="${safeUrl(v)}" target="_blank" rel="noopener">${v}</a>` : v);
  const rows = [
    ["Name", a.full_name], ["Email", a.email], ["Year", ans.year], ["Major", ans.major], ["Graduation", ans.graduation],
    ["Roles", (ans.roles || []).join(", ")], ["Writing sample", link(ans.sample)], ["LinkedIn or résumé", link(ans.linkedin)],
    ["File", a.file_name], ["Submitted", a.submitted_at ? fmtDateTime(a.submitted_at) : ""],
  ].filter(([, v]) => v);
  let next = "";
  if (a.status === "accepted") {
    next = html`<div class="app-next"><a class="btn btn-accent" href="/portal/#library">Open the members library</a>${a.grant_role === "writer" ? html`<a class="btn" href="/admin/">Start writing in the admin</a>` : ""}</div>`;
  } else if (a.status === "declined" && st.open) {
    next = html`<div class="app-next"><button class="btn btn-accent" type="button" data-restart>Start a new application</button></div>`;
  }
  return html`${next}<div class="app-summary">
    <div>${APP_QUESTIONS.map((q) => html`<section class="app-qa"><h2>${q.label}</h2><p>${ans[q.name] || "No answer."}</p></section>`)}</div>
    <aside class="app-details"><h2>Details</h2><dl class="app-dl">${rows.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl></aside>
  </div>`;
}
