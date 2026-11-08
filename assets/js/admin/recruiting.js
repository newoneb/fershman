// Admin → Recruiting: applications pipeline, info sessions, coffee chats, Apply page settings.
import { db, config } from "../data/db.js";
import { html, raw, mount, icon, fmtDate, fmtDateTime, timeAgo, safeUrl, toLocalInput, fromLocalInput, debounce, $, $$ } from "../lib/util.js";
import { toast, confirmDialog, openPanel, copyText, downloadFile } from "../lib/ui.js";
import {
  roleAtLeast, friendlyError, mergeRecruiting, applicationStatus, isMarketing, wordsIn,
  APP_STAFF_LABELS, APP_TONES, APP_QUESTIONS, RECOMMENDATIONS, RECOMMENDATION_TONES, GRANT_ROLES,
} from "../data/shared.js";

const TABS = [
  { key: "applications", label: "Applications" },
  { key: "sessions", label: "Info sessions" },
  { key: "periods", label: "Recruiting periods" },
  { key: "chats", label: "Coffee chats", editor: true },
  { key: "page", label: "Apply page", editor: true },
];
const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export async function recruiting(ctx) {
  const isAdmin = roleAtLeast(ctx.role, "admin");
  const tabs = TABS.filter((t) => !t.editor || roleAtLeast(ctx.role, "editor"));
  let tab = tabs.some((t) => t.key === ctx.query.tab) ? ctx.query.tab : "applications";
  mount(ctx.el, html`<div class="view">
    <div class="view-head"><div><h1>Recruiting</h1><p>Applications, info sessions and coffee chats for the <a href="/apply" target="_blank" rel="noopener">Apply page</a>.</p></div>
      <div class="view-actions"><a class="btn" href="/apply" target="_blank" rel="noopener">${icon("external")} View Apply page</a></div></div>
    <div class="toolbar"><div class="seg" role="tablist" aria-label="Recruiting">${tabs.map((t) => html`<button type="button" role="tab" data-tab="${t.key}" aria-pressed="${t.key === tab ? "true" : "false"}">${t.label}</button>`)}</div></div>
    <div id="rc-body"></div>
  </div>`);
  let body = $("#rc-body", ctx.el);
  const show = async () => {
    $$("[data-tab]", ctx.el).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === tab)));
    const fresh = body.cloneNode(false); // drop the previous tab's listeners
    body.replaceWith(fresh);
    body = fresh;
    history.replaceState(null, "", `#/recruiting?tab=${tab}`);
    mount(body, html`<div class="skeleton" style="height:260px"></div>`);
    try {
      if (tab === "applications") await applications(body, ctx);
      if (tab === "sessions") await sessions(body, ctx);
      if (tab === "periods") await periods(body, ctx);
      if (tab === "chats") await chats(body, ctx, isAdmin);
      if (tab === "page") await pageSettings(body, ctx, isAdmin);
    } catch (err) {
      mount(body, html`<div class="card card-pad"><h2>This tab couldn't load</h2><p>${friendlyError(err)}</p>
        ${/info_sessions|register_for_session|stage|schema cache|does not exist/i.test(err.message || "") ? html`<p style="margin-top:8px">Re-run <code class="code">supabase/schema.sql</code> in the Supabase SQL editor to add the recruiting tables.</p>` : ""}</div>`);
    }
  };
  ctx.el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (b && b.dataset.tab !== tab) { tab = b.dataset.tab; show(); }
  });
  show();
}

// ---------------------------------------------------------------- Applications
// Written by applicants in the portal. Recruiters review; editors and admins accept or decline.
const FILTERS = [["submitted", "New"], ["reviewing", "Reviewing"], ["interview", "Interview"], ["accepted", "Accepted"], ["declined", "Declined"], ["draft", "Drafts"], ["all", "All"]];
const statusPill = (s) => html`<span class="pill" data-tone="${APP_TONES[s] || "muted"}">${APP_STAFF_LABELS[s] || s}</span>`;
const average = (list) => {
  const scores = list.map((r) => Number(r.score)).filter(Boolean);
  return scores.length ? Math.round((scores.reduce((x, y) => x + y, 0) / scores.length) * 10) / 10 : null;
};

async function applications(el, ctx) {
  const canDecide = roleAtLeast(ctx.role, "editor");
  const [apps, periodList, legacy] = await Promise.all([
    db.listApplications(),
    db.adminListRecruitingPeriods().catch(() => []),
    db.listMessages().then((m) => m.filter((x) => x.kind === "application").length).catch(() => 0),
  ]);
  let filter = apps.some((a) => a.status === "submitted") ? "submitted" : "all";
  let period = "all";
  let q = "";
  const periodName = (id) => (periodList.find((p) => p.id === id) || {}).title || "";
  const inPeriod = (a) => period === "all" || (period === "none" ? !a.period_id : a.period_id === period);
  const count = (f) => apps.filter(inPeriod).filter((a) => f === "all" || a.status === f).length;
  const visible = () => apps.filter(inPeriod).filter((a) => filter === "all" || a.status === filter)
    .filter((a) => !q || `${a.full_name} ${a.email} ${((a.answers || {}).roles || []).join(" ")}`.toLowerCase().includes(q));
  mount(el, html`
    <div class="toolbar">
      <div class="seg" role="group" aria-label="Filter by status">${FILTERS.map(([k, l]) => html`<button type="button" data-filter="${k}" aria-pressed="${k === filter ? "true" : "false"}">${l} <span class="n">${count(k)}</span></button>`)}</div>
      ${periodList.length ? html`<select class="select" data-period aria-label="Recruiting period" style="width:auto"><option value="all">All periods</option>${periodList.map((p) => html`<option value="${p.id}">${p.title}</option>`)}<option value="none">Outside a period</option></select>` : ""}
      <input class="input search" type="search" placeholder="Search applicants" aria-label="Search applicants" data-q>
      <span class="spacer"></span>
      <button class="btn" type="button" data-export>${icon("download")} Export CSV</button>
    </div>
    ${legacy ? html`<p class="small muted" style="margin:0 0 14px">${legacy} application${legacy === 1 ? "" : "s"} sent with the old Apply form ${legacy === 1 ? "is" : "are"} in the <a href="#/inbox">Inbox</a>.</p>` : ""}
    <div class="card table-card" id="apps"></div>`);
  const draw = () => {
    $$("[data-filter]", el).forEach((b) => { b.querySelector(".n").textContent = count(b.dataset.filter); b.setAttribute("aria-pressed", String(b.dataset.filter === filter)); });
    const rows = visible();
    mount($("#apps", el), rows.length ? html`<table class="table table-responsive">
      <thead><tr><th>Applicant</th><th>Roles</th><th>Year</th><th>Submitted</th><th>Reviews</th><th>Status</th></tr></thead>
      <tbody>${rows.map((a) => { const ans = a.answers || {}; return html`<tr class="clickable" data-id="${a.id}" tabindex="0">
        <td data-cell="main"><div class="t-title" style="font-family:var(--sans)">${a.full_name || "Unnamed applicant"}</div><div class="t-sub">${a.email}</div></td>
        <td data-cell="hide" class="small">${(ans.roles || []).join(", ")}</td>
        <td data-cell="hide" class="small muted">${ans.year || ""}</td>
        <td class="small muted">${a.submitted_at ? fmtDate(a.submitted_at) : "Not yet"}</td>
        <td class="small">${a.review_count ? `${a.review_count} (avg ${a.review_avg ?? "–"})` : "None"}</td>
        <td>${statusPill(a.status)}</td>
      </tr>`; })}</tbody></table>`
      : html`<div class="table-empty"><strong>${apps.length ? "Nothing here" : "No applications yet"}</strong>${apps.length ? "Try another status or period." : "Applications written in the portal appear here as soon as people start them."}</div>`);
  };

  const exportCsv = () => {
    const rows = visible();
    if (!rows.length) { toast("There are no applications in this view.", { error: true }); return; }
    const head = ["Name", "Email", "Status", "Period", "Year", "Major", "Graduation", "Roles", "Heard about us", "Met us", "Writing sample", "LinkedIn or résumé", "File", "Started", "Submitted", "Reviews", "Average score", "Why Fershman?", "Pitch"];
    const lines = rows.map((a) => {
      const x = a.answers || {};
      return [a.full_name, a.email, APP_STAFF_LABELS[a.status], periodName(a.period_id), x.year, x.major, x.graduation, (x.roles || []).join(", "), x.heard, x.met,
        x.sample, x.linkedin, a.file_name, a.created_at, a.submitted_at, a.review_count, a.review_avg, x.why, x.pitch].map(csvCell).join(",");
    });
    downloadFile(`fershman-applications-${new Date().toISOString().slice(0, 10)}.csv`, [head.map(csvCell).join(","), ...lines].join("\n"), "text/csv");
  };

  const detail = async (a) => {
    let reviews = await db.listReviews(a.id).catch(() => []);
    const ans = a.answers || {};
    const link = (v) => (v && /^https?:\/\//i.test(v) ? html`<a href="${safeUrl(v)}" target="_blank" rel="noopener">${v}</a>` : v || "—");
    const p = openPanel({
      title: a.full_name || a.email,
      wide: true,
      body: html`<div class="review-cols">
        <div class="review-main">
          <div class="row">${statusPill(a.status)}<span class="small muted">${[ans.year, ans.major, ans.graduation ? `graduating ${ans.graduation}` : ""].filter(Boolean).join(", ")}</span></div>
          ${APP_QUESTIONS.map((x) => html`<section class="review-qa"><h3>${x.label}</h3><p>${ans[x.name] || "No answer."}</p><span class="small muted">${wordsIn(ans[x.name])} words</span></section>`)}
          <dl class="kv">
            <dt>Email</dt><dd><a href="mailto:${a.email}">${a.email}</a></dd>
            <dt>Roles</dt><dd>${(ans.roles || []).join(", ") || "—"}</dd>
            <dt>Writing sample</dt><dd>${link(ans.sample)}</dd>
            <dt>LinkedIn or résumé</dt><dd>${link(ans.linkedin)}</dd>
            <dt>File</dt><dd>${a.file_path ? html`<button type="button" class="link-inline" data-open-file>${a.file_name || "Open the file"}</button>` : "—"}</dd>
            <dt>Heard via</dt><dd>${ans.heard || "—"}</dd>
            <dt>Met us</dt><dd>${ans.met || "—"}</dd>
            <dt>Period</dt><dd>${periodName(a.period_id) || "—"}</dd>
            <dt>Started</dt><dd>${fmtDateTime(a.created_at)}</dd>
            <dt>Submitted</dt><dd>${a.submitted_at ? fmtDateTime(a.submitted_at) : "Not yet"}</dd>
          </dl>
        </div>
        <aside class="review-side">
          <div data-decision-slot>${decisionCard(a, canDecide)}</div>
          <div data-reviews-slot>${reviewsCard(reviews)}</div>
        </aside>
      </div>`.value,
    });
    const r = p.el;
    const refreshReviews = () => {
      mount($("[data-reviews-slot]", r), reviewsCard(reviews));
      a.review_count = reviews.length;
      a.review_avg = average(reviews);
      draw();
    };
    r.addEventListener("change", (e) => {
      if (e.target.id !== "d-status") return;
      const g = $("[data-grant]", r);
      if (g) g.hidden = e.target.value !== "accepted";
    });
    r.addEventListener("click", async (e) => {
      if (e.target.closest("[data-open-file]")) {
        const w = window.open("", "_blank");
        try {
          const url = await db.applicationFileUrl(a.file_path);
          if (w) { w.opener = null; w.location = url; } else location.href = url;
        } catch (ex) { if (w) w.close(); toast(friendlyError(ex), { error: true }); }
      }
      const del = e.target.closest("[data-del-review]");
      if (del) {
        try {
          await db.deleteReview(del.dataset.delReview);
          reviews = reviews.filter((x) => x.id !== del.dataset.delReview);
          refreshReviews();
        } catch (ex) { toast(friendlyError(ex), { error: true }); }
      }
    });
    r.addEventListener("submit", async (e) => {
      const form = e.target;
      e.preventDefault();
      const err = $(".form-error", form);
      const btn = $('button[type="submit"]', form);
      err.textContent = "";
      const d = Object.fromEntries(new FormData(form).entries());
      btn.disabled = true;
      try {
        if (form.matches("[data-decision]")) {
          const patch = { message: String(d.message || "").trim() };
          if (d.status) patch.status = d.status;
          if (d.grant_role) patch.grant_role = d.grant_role;
          const was = a.status;
          Object.assign(a, await db.updateApplication(a.id, patch));
          toast(a.status === "accepted" && was !== "accepted" ? `Accepted. ${a.full_name || "The applicant"} now has ${GRANT_ROLES[a.grant_role]} access.` : "Saved");
          mount($("[data-decision-slot]", r), decisionCard(a, canDecide));
          const pill = $(".review-main .pill", r);
          if (pill) pill.outerHTML = statusPill(a.status).value;
          ctx.refreshCounts();
          draw();
        }
        if (form.matches("[data-review]")) {
          if (!d.score || !d.recommendation) { err.textContent = "Choose a score and a recommendation."; return; }
          reviews = [...reviews, await db.addReview(a.id, { score: Number(d.score), recommendation: d.recommendation, note: String(d.note || "").trim() })];
          refreshReviews();
          toast("Review added");
        }
      } catch (ex) { err.textContent = friendlyError(ex); }
      finally { if (btn.isConnected) btn.disabled = false; }
    });
  };

  el.addEventListener("click", (e) => {
    const f = e.target.closest("[data-filter]");
    if (f) { filter = f.dataset.filter; draw(); return; }
    if (e.target.closest("[data-export]")) { exportCsv(); return; }
    const tr = e.target.closest("tr[data-id]");
    const a = tr && apps.find((x) => x.id === tr.dataset.id);
    if (a) detail(a).catch((ex) => toast(friendlyError(ex), { error: true }));
  });
  el.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("tr[data-id]")) e.target.click(); });
  el.addEventListener("change", (e) => { if (e.target.matches("[data-period]")) { period = e.target.value; draw(); } });
  $("[data-q]", el).addEventListener("input", debounce((e) => { q = e.target.value.trim().toLowerCase(); draw(); }, 150));
  draw();
}

function decisionCard(a, canDecide) {
  if (a.status === "draft") {
    return html`<section class="review-card"><h3>Decision</h3><p class="small muted">${a.submitted_at ? "Returned to the applicant for edits. You can review it again once they resubmit." : "This application is still a draft. You can review it once the applicant submits it."}</p></section>`;
  }
  const settled = a.status === "accepted" || a.status === "declined";
  const first = (a.full_name || "the applicant").split(" ")[0];
  const opts = [["submitted", "New"], ["reviewing", "Reviewing"], ["interview", "Interview"], ["accepted", "Accepted"], ["declined", "Declined"], ["draft", "Return to the applicant for edits"]];
  return html`<section class="review-card"><h3>Decision</h3>
    <form class="stack" data-decision style="gap:14px">
      <div class="field"><label for="d-status">Status</label>
        <select class="select" id="d-status" name="status" ${!canDecide && settled ? raw("disabled") : ""}>${opts.map(([v, l]) => html`<option value="${v}" ${v === a.status ? raw("selected") : ""} ${!canDecide && (v === "accepted" || v === "declined") && v !== a.status ? raw("disabled") : ""}>${l}</option>`)}</select>
        ${canDecide ? "" : html`<span class="hint">Editors and admins accept or decline.</span>`}</div>
      <div class="field" data-grant ${a.status === "accepted" ? "" : raw("hidden")}><label for="d-grant">Access when accepted</label>
        <select class="select" id="d-grant" name="grant_role">${Object.entries(GRANT_ROLES).map(([v, l]) => html`<option value="${v}" ${v === a.grant_role ? raw("selected") : ""}>${l}</option>`)}</select>
        <span class="hint">Writers can write and submit drafts. Members open the members library.</span></div>
      <div class="field"><label for="d-msg">Note to ${first}</label><textarea class="textarea" id="d-msg" name="message" rows="4" style="min-height:96px">${a.message || ""}</textarea><span class="hint">Shown on their application page, for example an interview time and place.</span></div>
      <p class="form-error" role="alert"></p>
      <div class="row"><button class="btn btn-accent" type="submit">Save</button><a class="btn" href="mailto:${a.email}?subject=${encodeURIComponent("Your application to The Fershman Journal")}">${icon("mail")} Email ${first}</a></div>
      ${a.decided_at ? html`<p class="small muted">Decided ${fmtDateTime(a.decided_at)}.</p>` : ""}
    </form>
  </section>`;
}

function reviewsCard(reviews) {
  const avg = average(reviews);
  return html`<section class="review-card"><h3>Reviews</h3>
    <p class="small muted">${reviews.length ? `Average ${avg ?? "–"} out of 5, from ${reviews.length} review${reviews.length === 1 ? "" : "s"}.` : "No reviews yet. Only recruiters see reviews."}</p>
    ${reviews.length ? html`<ul class="review-list">${reviews.map((r) => html`<li>
      <div class="row" style="gap:8px"><strong class="small">${r.reviewer_name || "Reviewer"}</strong><span class="pill" data-tone="${RECOMMENDATION_TONES[r.recommendation] || "muted"}">${RECOMMENDATIONS[r.recommendation] || r.recommendation}</span><span class="spacer"></span><span class="small">${r.score ? `${r.score} of 5` : ""}</span></div>
      ${r.note ? html`<p class="small">${r.note}</p>` : ""}
      <div class="row" style="gap:8px"><span class="small muted">${fmtDate(r.created_at)}</span><span class="spacer"></span><button class="link-inline small" type="button" data-del-review="${r.id}">Remove</button></div>
    </li>`)}</ul>` : ""}
    <details class="review-add" ${reviews.length ? "" : raw("open")}><summary>Add your review</summary>
      <form class="stack" data-review style="gap:12px;margin-top:12px">
        <fieldset class="field"><legend class="label">Score</legend><div class="chips">${[1, 2, 3, 4, 5].map((n) => html`<label class="chip"><input type="radio" name="score" value="${n}"><span>${n}</span></label>`)}</div></fieldset>
        <fieldset class="field"><legend class="label">Recommendation</legend><div class="chips">${Object.entries(RECOMMENDATIONS).map(([k, l]) => html`<label class="chip"><input type="radio" name="recommendation" value="${k}"><span>${l}</span></label>`)}</div></fieldset>
        <div class="field"><label for="rv-note">Notes</label><textarea class="textarea" id="rv-note" name="note" rows="3" style="min-height:80px"></textarea></div>
        <p class="form-error" role="alert"></p>
        <div><button class="btn btn-accent btn-sm" type="submit">Add review</button></div>
      </form>
    </details>
  </section>`;
}

// ---------------------------------------------------------------- Info sessions
async function sessions(el, ctx) {
  let list = await db.adminListInfoSessions();
  const reload = async () => { list = await db.adminListInfoSessions(); draw(); };
  mount(el, html`
    <div class="toolbar"><p class="small muted" style="margin:0">People register on the Apply page. Meeting links are shown only to people who register.</p><span class="spacer"></span><button class="btn btn-accent" type="button" data-new>${icon("plus")} New session</button></div>
    <div id="sess" class="stack"></div>`);
  const row = (s) => html`<tr class="clickable" data-id="${s.id}">
    <td data-cell="main"><div class="t-title">${s.title}</div><div class="t-sub">${fmtDateTime(s.starts_at)}${s.location ? html` — ${s.location}` : ""}</div></td>
    <td class="small">${s.registered}${s.capacity ? ` / ${s.capacity}` : ""} registered</td>
    <td>${s.is_published ? html`<span class="pill pill-published">Published</span>` : html`<span class="pill">Hidden</span>`}</td>
  </tr>`;
  const draw = () => {
    const now = Date.now();
    const upcoming = list.filter((s) => new Date(s.starts_at).getTime() + (s.duration_min || 60) * 60000 > now).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    const past = list.filter((s) => !upcoming.includes(s));
    mount($("#sess", el), html`
      <section class="card table-card"><div class="card-pad" style="padding-bottom:4px"><h2>Upcoming</h2></div>
        ${upcoming.length ? html`<table class="table table-responsive"><tbody>${upcoming.map(row)}</tbody></table>` : html`<div class="table-empty"><strong>No upcoming sessions</strong>Add one and it appears on the Apply page right away.</div>`}</section>
      ${past.length ? html`<section class="card table-card"><div class="card-pad" style="padding-bottom:4px"><h2>Past</h2></div><table class="table table-responsive"><tbody>${past.map(row)}</tbody></table></section>` : ""}`);
  };
  const edit = async (s) => {
    const isNew = !s;
    const x = s || { title: "Info session", description: "", starts_at: null, duration_min: 60, location: "", join_url: "", capacity: null, is_published: true };
    const p = openPanel({
      title: isNew ? "New info session" : x.title, wide: !isNew,
      body: html`
        <div class="field"><label for="s-title">Title</label><input class="input" id="s-title" value="${x.title}"></div>
        <div class="field-row">
          <div class="field"><label for="s-when">Date and time</label><input class="input" id="s-when" type="datetime-local" value="${x.starts_at ? toLocalInput(x.starts_at) : ""}"><span class="hint">In your time zone. The Apply page shows Chicago time.</span></div>
          <div class="field"><label for="s-dur">Length (minutes)</label><input class="input" id="s-dur" type="number" min="5" max="600" value="${x.duration_min || 60}"></div>
        </div>
        <div class="field"><label for="s-loc">Location</label><input class="input" id="s-loc" value="${x.location || ""}" placeholder="e.g. Harper 130, or Online"></div>
        <div class="field"><label for="s-link">Meeting link <span class="hint">(optional, for online sessions)</span></label><input class="input" id="s-link" type="url" value="${x.join_url || ""}" placeholder="https://zoom.us/j/…"><span class="hint">Shown only after someone registers.</span></div>
        <div class="field"><label for="s-desc">Description</label><textarea class="textarea" id="s-desc" rows="3" style="min-height:80px">${x.description || ""}</textarea></div>
        <div class="field-row">
          <div class="field"><label for="s-cap">Capacity <span class="hint">(optional)</span></label><input class="input" id="s-cap" type="number" min="1" value="${x.capacity || ""}" placeholder="No limit"></div>
          <div class="field" style="align-content:end"><label class="toggle"><input type="checkbox" id="s-pub" ${x.is_published ? raw("checked") : ""}><span class="track"></span>Show on the Apply page</label></div>
        </div>
        <p class="form-error" role="alert"></p>
        ${isNew ? "" : html`<div class="stack" style="gap:10px;margin-top:6px"><div class="row"><h3 style="font:650 1rem/1.2 var(--sans)">Registrations</h3><span class="spacer"></span>
          <button class="btn btn-sm" type="button" data-copy-emails>${icon("copy")} Copy emails</button><button class="btn btn-sm" type="button" data-export-regs>${icon("download")} CSV</button></div>
          <div id="regs" class="card table-card"><div class="table-empty">Loading…</div></div></div>`}`.value,
      foot: html`${isNew ? "" : html`<button class="btn btn-danger" type="button" data-del>Delete</button><span class="spacer"></span>`}<button class="btn" type="button" data-close>Cancel</button><button class="btn btn-accent" type="button" data-save>${isNew ? "Add session" : "Save changes"}</button>`.value,
    });
    const r = p.el;
    let regs = [];
    const drawRegs = () => mount($("#regs", r), regs.length ? html`<table class="table"><tbody>${regs.map((g) => html`<tr data-reg="${g.id}">
        <td><div style="font-weight:600">${g.name}</div><div class="t-sub">${g.email}${g.year ? ` — ${g.year}` : ""}</div></td>
        <td class="small muted">${timeAgo(g.created_at)}</td>
        <td class="t-actions"><button class="icon-btn" type="button" data-unreg aria-label="Remove ${g.name}">${icon("trash")}</button></td></tr>`)}</tbody></table>`
      : html`<div class="table-empty">No one has registered yet.</div>`);
    if (!isNew) { regs = await db.listRegistrations(x.id); drawRegs(); }
    r.addEventListener("click", async (e) => {
      const err = $(".form-error", r);
      try {
        if (e.target.closest("[data-save]")) {
          const data = {
            id: x.id, title: $("#s-title", r).value.trim(), starts_at: fromLocalInput($("#s-when", r).value),
            duration_min: Number($("#s-dur", r).value) || 60, location: $("#s-loc", r).value.trim() || null,
            join_url: $("#s-link", r).value.trim() || null, description: $("#s-desc", r).value.trim() || null,
            capacity: Number($("#s-cap", r).value) || null, is_published: $("#s-pub", r).checked,
          };
          if (!data.title) { err.textContent = "Give the session a title."; return; }
          if (!data.starts_at) { err.textContent = "Pick a date and time."; return; }
          if (data.join_url && !/^https:\/\//i.test(data.join_url)) { err.textContent = "The meeting link should start with https://"; return; }
          await db.saveInfoSession(data);
          toast(isNew ? "Session added" : "Session saved");
          p.close();
          reload();
        }
        if (e.target.closest("[data-del]")) {
          if (!(await confirmDialog(`Delete “${x.title}” and its ${regs.length} registration${regs.length === 1 ? "" : "s"}?`, { title: "Delete session", confirm: "Delete", danger: true }))) return;
          await db.deleteInfoSession(x.id);
          toast("Session deleted");
          p.close();
          reload();
        }
        const un = e.target.closest("[data-unreg]");
        if (un) {
          const id = un.closest("tr").dataset.reg;
          await db.deleteRegistration(id);
          regs = regs.filter((g) => g.id !== id);
          drawRegs();
          toast("Registration removed");
        }
        if (e.target.closest("[data-copy-emails]")) {
          if (!regs.length) { toast("No registrations yet."); return; }
          await copyText(regs.map((g) => g.email).join(", "));
          toast(`${regs.length} email${regs.length === 1 ? "" : "s"} copied`);
        }
        if (e.target.closest("[data-export-regs]")) {
          const lines = ["name,email,year,registered_at", ...regs.map((g) => [g.name, g.email, g.year, g.created_at].map(csvCell).join(","))];
          downloadFile(`registrations-${(x.title || "session").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`, lines.join("\n"), "text/csv");
        }
      } catch (ex) { err.textContent = friendlyError(ex); }
    });
  };
  el.addEventListener("click", (e) => {
    if (e.target.closest("[data-new]")) edit(null);
    const tr = e.target.closest("tr[data-id]");
    if (tr) edit(list.find((s) => s.id === tr.dataset.id));
  });
  draw();
}

// ---------------------------------------------------------------- Shared: repeatable lists
function repeater(key, items, fields, addLabel) {
  const rowHTML = (it = {}) => html`<div class="card card-pad rep-row" data-rep="${key}" style="display:grid;gap:10px;padding:14px">
    ${fields.map((f) => html`<label class="field"><span class="label">${f.label}</span>${f.type === "textarea"
      ? html`<textarea class="textarea" data-f="${f.name}" rows="2" style="min-height:64px">${it[f.name] || ""}</textarea>`
      : f.type === "select" ? html`<select class="select" data-f="${f.name}">${f.options.map((o) => html`<option value="${o.value}" ${o.value === (it[f.name] || "") ? raw("selected") : ""}>${o.label}</option>`)}</select>`
      : html`<input class="input" data-f="${f.name}" value="${it[f.name] || ""}" placeholder="${f.placeholder || ""}">`}</label>`)}
    <div><button class="btn btn-ghost btn-sm" type="button" data-rep-remove>${icon("trash")} Remove</button></div>
  </div>`;
  return {
    html: html`<div class="stack" style="gap:10px" data-rep-list="${key}">${items.map((it) => rowHTML(it))}</div>
      <div><button class="btn btn-sm" type="button" data-rep-add="${key}">${icon("plus")} ${addLabel}</button></div>`,
    template: rowHTML(),
  };
}
function readRepeater(root, key) {
  return $$(`[data-rep="${key}"]`, root).map((row) => {
    const o = {};
    $$("[data-f]", row).forEach((i) => { o[i.dataset.f] = i.value.trim(); });
    return o;
  }).filter((o) => Object.values(o).some(Boolean));
}
function wireRepeaters(root, templates) {
  root.addEventListener("click", (e) => {
    const add = e.target.closest("[data-rep-add]");
    if (add) $(`[data-rep-list="${add.dataset.repAdd}"]`, root).insertAdjacentHTML("beforeend", templates[add.dataset.repAdd].value);
    const rm = e.target.closest("[data-rep-remove]");
    if (rm) rm.closest(".rep-row").remove();
  });
}

// ---------------------------------------------------------------- Coffee chats
async function chats(el, ctx, isAdmin) {
  const [settings, authors] = await Promise.all([db.getSettings(), db.listAuthors()]);
  const rc = mergeRecruiting(settings.recruiting);
  const team = authors.filter(isMarketing);
  const authorOptions = [{ value: "", label: "Someone else (type a name below)" }, ...authors.map((a) => ({ value: a.slug, label: a.name }))];
  const hosts = repeater("hosts", rc.hosts, [
    { name: "author_slug", label: "Member", type: "select", options: authorOptions },
    { name: "name", label: "Name (if not listed above)" },
    { name: "role", label: "Role shown on the card", placeholder: "Leave empty to use their author title" },
    { name: "topics", label: "Ask me about", placeholder: "M&A writing, joining as a first-year" },
    { name: "booking_url", label: "Booking link", placeholder: "https://calendly.com/…" },
    { name: "email", label: "Email (used if there's no booking link)" },
  ], "Add a host");
  mount(el, html`<div class="stack">
    ${isAdmin ? "" : html`<div class="notice notice-warn">Only admins can change coffee chat hosts.</div>`}
    <section class="card card-pad stack">
      <div><h2>How booking works</h2>
        <p>Each host shares a free booking page — <a href="https://calendly.com" target="_blank" rel="noopener">Calendly</a>, <a href="https://cal.com" target="_blank" rel="noopener">Cal.com</a>, or a Google Calendar appointment schedule. Those tools check the host's calendar, send confirmations and reminders, and handle rescheduling. Calendly and Google booking pages open inside the site; others open in a new tab. Hosts without a link get an "Email to schedule" button.</p></div>
      <label class="field"><span class="label">Intro shown above the hosts</span><textarea class="textarea" id="cc-intro" rows="2" style="min-height:64px">${rc.chatsIntro}</textarea></label>
    </section>
    <section class="card table-card">
      <div class="card-pad" style="padding-bottom:4px"><h2>Marketing team (listed automatically)</h2><p>Everyone on the Marketing team appears on the Apply page. They add their own booking link under <strong>My byline</strong>; editors change teams in Authors.</p></div>
      ${team.length ? html`<table class="table table-responsive"><tbody>${team.map((a) => html`<tr>
        <td data-cell="main"><div class="t-title" style="font-family:var(--sans)">${a.name}</div><div class="t-sub">${a.role_title || ""}</div></td>
        <td class="small">${a.booking_url ? html`<span class="pill pill-published">Booking link set</span>` : a.contact_email ? html`<span class="pill">Email only</span>` : html`<span class="pill pill-review">No link or email yet</span>`}</td></tr>`)}</tbody></table>`
        : html`<div class="table-empty">No one is on the Marketing team yet. Add them in Authors.</div>`}
    </section>
    <h2 style="font:650 1.0625rem/1.25 var(--sans);margin-top:6px">Extra hosts <span class="small muted">(optional, shown before the Marketing team)</span></h2>
    ${hosts.html}
    <div><button class="btn btn-accent" type="button" data-save-chats ${isAdmin ? "" : raw("disabled")}>Save coffee chats</button></div>
  </div>`);
  wireRepeaters(el, { hosts: hosts.template });
  $("[data-save-chats]", el).addEventListener("click", async () => {
    const list = readRepeater(el, "hosts").map((h) => {
      const a = authors.find((x) => x.slug === h.author_slug);
      return { ...h, name: h.name || (a ? a.name : "") };
    });
    const bad = list.find((h) => h.booking_url && !/^https:\/\//i.test(h.booking_url));
    if (bad) { toast(`The booking link for ${bad.name || "a host"} should start with https://`, { error: true }); return; }
    try {
      const fresh = mergeRecruiting((await db.getSettings()).recruiting);
      await db.saveSetting("recruiting", { ...fresh, hosts: list, chatsIntro: $("#cc-intro", el).value.trim() });
      toast("Coffee chats saved");
    } catch (ex) { toast(friendlyError(ex), { error: true }); }
  });
}

// ---------------------------------------------------------------- Apply page settings
async function pageSettings(el, ctx, isAdmin) {
  const rc = mergeRecruiting((await db.getSettings()).recruiting);
  const st = applicationStatus(rc);
  const two = [{ name: "title", label: "Title" }, { name: "text", label: "Text", type: "textarea" }];
  const highlights = repeater("highlights", rc.highlights, two, "Add a highlight");
  const steps = repeater("steps", rc.steps, two, "Add a step");
  const roles = repeater("roles", rc.roles, two, "Add a role");
  const faq = repeater("faq", rc.faq, [{ name: "q", label: "Question" }, { name: "a", label: "Answer", type: "textarea" }], "Add a question");
  mount(el, html`<div class="stack">
    ${isAdmin ? "" : html`<div class="notice notice-warn">Only admins can change the Apply page.</div>`}
    <section class="card card-pad stack">
      <div><h2>Application status</h2><p>Right now the page says: <strong>${st.label}</strong>.</p></div>
      <div class="field-row">
        <label class="field"><span class="label">Applications are</span>
          <select class="select" id="p-status">
            <option value="rolling" ${rc.status === "rolling" ? raw("selected") : ""}>Open, rolling review (no deadline)</option>
            <option value="deadline" ${rc.status === "deadline" ? raw("selected") : ""}>Open until a deadline</option>
            <option value="closed" ${rc.status === "closed" ? raw("selected") : ""}>Closed (visitors can ask to be notified)</option>
          </select></label>
        <label class="field" id="p-deadline-wrap" ${rc.status === "deadline" ? "" : raw("hidden")}><span class="label">Deadline</span><input class="input" id="p-deadline" type="date" value="${rc.deadline || ""}"></label>
      </div>
      <label class="toggle"><input type="checkbox" id="p-popup" ${rc.popup !== false ? raw("checked") : ""}><span class="track"></span>During a recruiting period, show a pop-up on every page that links to Apply</label>
      <label class="field"><span class="label">Pop-up message</span><input class="input" id="p-popup-text" value="${rc.popupText || ""}" maxlength="180"><span class="hint">Shown with the period's name and end date, e.g. “Fall recruitment is on … Apply by October 16.” Visitors who close it don't see it again that period.</span></label>
    </section>
    <section class="card card-pad stack">
      <h2>Top of the page</h2>
      <label class="field"><span class="label">Headline</span><input class="input" id="p-headline" value="${rc.headline}"></label>
      <label class="field"><span class="label">Introduction</span><textarea class="textarea" id="p-lede" rows="3" style="min-height:80px">${rc.lede}</textarea></label>
      <h3 class="small" style="font-weight:700">Highlights (beside the headline)</h3>
      ${highlights.html}
    </section>
    <section class="card card-pad stack"><h2>How it works</h2>${steps.html}</section>
    <section class="card card-pad stack"><h2>Roles</h2><p>These also become the role choices on the application form.</p>${roles.html}</section>
    <section class="card card-pad stack">
      <h2>Application section</h2>
      <label class="field"><span class="label">What we look for (one per line)</span><textarea class="textarea" id="p-look" rows="4">${rc.lookFor.join("\n")}</textarea></label>
      <label class="field"><span class="label">Message after someone applies</span><textarea class="textarea" id="p-confirm" rows="2" style="min-height:64px">${rc.confirmation}</textarea></label>
      <label class="field"><span class="label">Info sessions intro</span><textarea class="textarea" id="p-sessions" rows="2" style="min-height:64px">${rc.sessionsIntro}</textarea></label>
    </section>
    <section class="card card-pad stack"><h2>Questions</h2>${faq.html}</section>
    <div class="row"><button class="btn btn-accent" type="button" data-save-page ${isAdmin ? "" : raw("disabled")}>Save Apply page</button><a class="btn btn-ghost" href="/apply" target="_blank" rel="noopener">Preview</a></div>
  </div>`);
  wireRepeaters(el, { highlights: highlights.template, steps: steps.template, roles: roles.template, faq: faq.template });
  $("#p-status", el).addEventListener("change", (e) => { $("#p-deadline-wrap", el).hidden = e.target.value !== "deadline"; });
  $("[data-save-page]", el).addEventListener("click", async () => {
    const status = $("#p-status", el).value;
    const deadline = $("#p-deadline", el).value;
    if (status === "deadline" && !deadline) { toast("Pick the deadline date.", { error: true }); return; }
    try {
      const fresh = mergeRecruiting((await db.getSettings()).recruiting);
      const next = {
        ...fresh, status, deadline: status === "deadline" ? deadline : "",
        popup: $("#p-popup", el).checked, popupText: $("#p-popup-text", el).value.trim(),
        headline: $("#p-headline", el).value.trim() || fresh.headline,
        lede: $("#p-lede", el).value.trim(),
        highlights: readRepeater(el, "highlights"), steps: readRepeater(el, "steps"),
        roles: readRepeater(el, "roles"), faq: readRepeater(el, "faq"),
        lookFor: $("#p-look", el).value.split("\n").map((t) => t.trim()).filter(Boolean),
        confirmation: $("#p-confirm", el).value.trim(), sessionsIntro: $("#p-sessions", el).value.trim(),
      };
      await db.saveSetting("recruiting", next);
      toast(`Apply page saved: ${applicationStatus(next).label}`);
    } catch (ex) { toast(friendlyError(ex), { error: true }); }
  });
}

// ---------------------------------------------------------------- Recruiting periods
async function periods(el, ctx) {
  let list = await db.adminListRecruitingPeriods();
  const today = new Date().toISOString().slice(0, 10);
  const draw = () => mount(el, html`
    <div class="card card-pad stack" style="margin-bottom:16px">
      <div><h2>Active recruiting periods</h2><p>Mark the weeks you're actively recruiting — posters up, info sessions running. During a period the Apply page leads with it (for example “Fall recruitment is on. Apply by October 16”), and every page of the site shows a small pop-up pointing to Apply. Applications stay open on a rolling basis outside these dates. Applications submitted during a period are filed under it, and an optional decisions date tells applicants when to expect an answer.</p></div>
      <div class="field-row">
        <label class="field"><span class="label">Name</span><input class="input" id="pr-title" placeholder="Fall recruitment"></label>
        <label class="field"><span class="label">Note <span class="hint">(optional, internal)</span></span><input class="input" id="pr-note" placeholder="Posters up week 2"></label>
      </div>
      <div class="field-row">
        <label class="field"><span class="label">Starts</span><input class="input" id="pr-start" type="date"></label>
        <label class="field"><span class="label">Ends</span><input class="input" id="pr-end" type="date"></label>
      </div>
      <div class="field-row">
        <label class="field"><span class="label">Decisions by <span class="hint">(optional, shown to applicants)</span></span><input class="input" id="pr-dec" type="date"></label>
        <span></span>
      </div>
      <div><button class="btn btn-accent" type="button" data-add-period>${icon("plus")} Add period</button></div>
    </div>
    <div class="card table-card">${list.length ? html`<table class="table table-responsive"><thead><tr><th>Period</th><th>Dates</th><th>Status</th><th class="t-actions"><span class="sr-only">Actions</span></th></tr></thead><tbody>
      ${list.map((p) => { const st = p.ends_on < today ? "Past" : p.starts_on > today ? "Upcoming" : "Active now";
        return html`<tr data-id="${p.id}"><td data-cell="main"><div class="t-title">${p.title}</div>${p.note ? html`<div class="t-sub">${p.note}</div>` : ""}</td>
          <td class="small">${fmtDate(p.starts_on + "T12:00:00")} to ${fmtDate(p.ends_on + "T12:00:00")}${p.decisions_on ? html`<div class="t-sub">Decisions by ${fmtDate(p.decisions_on + "T12:00:00")}</div>` : ""}</td>
          <td><span class="pill ${st === "Active now" ? "pill-published" : st === "Upcoming" ? "pill-scheduled" : ""}">${st}</span></td>
          <td class="t-actions"><button class="icon-btn" type="button" data-del-period aria-label="Delete ${p.title}">${icon("trash")}</button></td></tr>`; })}
    </tbody></table>` : html`<div class="table-empty"><strong>No recruiting periods yet</strong>Add the next one above.</div>`}</div>`);
  el.addEventListener("click", async (e) => {
    try {
      if (e.target.closest("[data-add-period]")) {
        const data = { title: $("#pr-title", el).value.trim(), note: $("#pr-note", el).value.trim() || null, starts_on: $("#pr-start", el).value, ends_on: $("#pr-end", el).value, decisions_on: $("#pr-dec", el).value || null };
        if (!data.title || !data.starts_on || !data.ends_on) { toast("Give the period a name, a start and an end date.", { error: true }); return; }
        if (data.ends_on < data.starts_on) { toast("The end date is before the start date.", { error: true }); return; }
        await db.saveRecruitingPeriod(data);
        toast("Recruiting period added");
        list = await db.adminListRecruitingPeriods();
        draw();
      }
      const del = e.target.closest("[data-del-period]");
      if (del) {
        const p = list.find((x) => x.id === del.closest("tr").dataset.id);
        if (!(await confirmDialog(`Delete “${p.title}”?`, { title: "Delete period", confirm: "Delete", danger: true }))) return;
        await db.deleteRecruitingPeriod(p.id);
        list = list.filter((x) => x.id !== p.id);
        draw();
      }
    } catch (ex) { toast(friendlyError(ex), { error: true }); }
  });
  draw();
}
