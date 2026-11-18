// Story tracker: who's writing what, where each story stands, and which stories need a meeting.
// Everyone who writes sees the whole budget. Writers pitch, take approved stories and move their
// own between Drafting and In edit; editors approve, assign, schedule and drop stories.
// The database enforces the same rules (guard_tracker() in supabase/schema.sql), and moves a story
// to In edit or Published when its linked article is sent for review or published.
import { db, config } from "../data/db.js";
import { html, raw, mount, icon, fmtDate, fmtDateTime, toLocalInput, fromLocalInput, debounce, initials, $, $$ } from "../lib/util.js";
import { toast, openPanel, confirmDialog } from "../lib/ui.js";
import { roleAtLeast, friendlyError, TRACKER_STAGES, TRACKER_ACTIVE, TRACKER_WRITER_STAGES, TRACKER_PRIORITY } from "../data/shared.js";

const VIEW_KEY = "fj-tracker-view";
const FILTERS = [["active", "In progress"], ["mine", "Mine"], ["meeting", "Needs a meeting"], ["unassigned", "Unassigned"], ["done", "Done"]];
const stageOf = (k) => TRACKER_STAGES.find((s) => s.key === k) || TRACKER_STAGES[0];
const day = (d) => (d ? fmtDate(`${d}T12:00:00`) : "");
const localToday = () => { const t = new Date(); return new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const ARTICLE_STATUS = { draft: "Draft", review: "In review", published: "Published" };

export async function tracker(ctx) {
  const editor = roleAtLeast(ctx.role, "editor");
  const me = ctx.session.profile;
  const myAuthor = me.author_id || null;
  let items = [];
  let authors = [];
  let articles = [];
  [items, authors, articles] = await Promise.all([db.listTracker(), db.listAuthors().catch(() => []), db.adminListArticles().catch(() => [])]);
  authors = authors.slice().sort((a, b) => a.name.localeCompare(b.name));

  let view = localStorage.getItem(VIEW_KEY) === "list" ? "list" : "board";
  let filter = "active";
  let section = "";
  let q = "";

  const nameOf = (id) => (authors.find((a) => a.id === id) || {}).name || "";
  const sectionName = (s) => (s === "learn" ? config.learn.name : (config.sections.find((x) => x.slug === s) || {}).name || "");
  const isMine = (it) => it.created_by === me.id || Boolean(myAuthor && (it.writer_id === myAuthor || it.editor_id === myAuthor));
  const canEdit = (it) => editor || it.created_by === me.id || Boolean(myAuthor && it.writer_id === myAuthor);
  const canMove = (it, stage) => editor || (canEdit(it) && it.stage !== "pitch" && TRACKER_WRITER_STAGES.includes(stage));
  const canClaim = (it) => !editor && myAuthor && !it.writer_id && !["pitch", "published", "killed"].includes(it.stage);
  const done = (it) => it.stage === "published" || it.stage === "killed";
  const overdue = (it) => it.due_on && !done(it) && ["approved", "drafting"].includes(it.stage) && it.due_on < localToday();

  const visible = () => items.filter((it) => {
    if (filter === "done" ? !done(it) : done(it)) return false;
    if (filter === "mine" && !isMine(it)) return false;
    if (filter === "meeting" && !it.meeting_needed) return false;
    if (filter === "unassigned" && it.writer_id) return false;
    if (section && it.section !== section) return false;
    return !q || `${it.title} ${it.angle || ""} ${nameOf(it.writer_id)} ${nameOf(it.editor_id)}`.toLowerCase().includes(q);
  }).sort((a, b) => (a.priority === "high" ? 0 : 1) - (b.priority === "high" ? 0 : 1)
    || String(a.due_on || a.publish_on || "9999").localeCompare(String(b.due_on || b.publish_on || "9999"))
    || String(b.created_at).localeCompare(String(a.created_at)));

  const person = (id, empty = "Unassigned") => (id
    ? html`<span class="tk-person"><span class="tk-avatar" aria-hidden="true">${initials(nameOf(id))}</span>${nameOf(id)}</span>`
    : html`<span class="tk-person is-empty">${empty}</span>`);
  const meetingTag = (it) => (it.meeting_needed
    ? html`<span class="tk-tag tk-tag-meet">${icon("calendar")}${it.meeting_at ? fmtDateTime(it.meeting_at) : "Meeting needed"}</span>` : "");

  const card = (it) => html`<article class="tk-card" draggable="${canEdit(it) || editor ? "true" : "false"}" data-id="${it.id}" tabindex="0" aria-label="${it.title}, ${stageOf(it.stage).label}">
    <div class="tk-card-top"><span class="tk-sec">${sectionName(it.section) || "No section"}</span>${it.priority === "high" ? html`<span class="tk-pri">High priority</span>` : ""}</div>
    <h3>${it.title}</h3>
    <div class="tk-card-people">${person(it.writer_id)}</div>
    <div class="tk-card-foot">
      ${it.due_on ? html`<span class="tk-tag ${overdue(it) ? "is-late" : ""}">${overdue(it) ? "Overdue: " : "Due "}${day(it.due_on)}</span>` : it.publish_on ? html`<span class="tk-tag">Runs ${day(it.publish_on)}</span>` : ""}
      ${meetingTag(it)}
      ${it.comment_count ? html`<span class="tk-tag">${it.comment_count} note${it.comment_count === 1 ? "" : "s"}</span>` : ""}
      ${it.article_id ? html`<span class="tk-tag">${icon("doc")}Draft linked</span>` : ""}
    </div>
  </article>`;

  const drawBody = () => {
    const rows = visible();
    const body = $("#tk-body", ctx.el);
    $$("[data-filter]", ctx.el).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === filter)));
    $$("[data-view]", ctx.el).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === view)));
    const meets = items.filter((it) => it.meeting_needed && !done(it)).sort((a, b) => String(a.meeting_at || "9999").localeCompare(String(b.meeting_at || "9999")));
    mount($("#tk-meetings", ctx.el), meets.length && filter !== "done" ? html`<section class="card card-pad tk-meetings" aria-labelledby="tk-meet-h">
      <h2 id="tk-meet-h">Meetings to hold <span class="n">${meets.length}</span></h2>
      <ul>${meets.map((it) => html`<li><button class="link-inline" type="button" data-open="${it.id}">${it.title}</button>
        <span class="tk-when">${it.meeting_at ? fmtDateTime(it.meeting_at) : "Not scheduled yet"}</span>
        ${it.meeting_note ? html`<span class="tk-why">${it.meeting_note}</span>` : ""}</li>`)}</ul>
    </section>` : "");
    if (view === "list") {
      mount(body, rows.length ? html`<div class="card table-card"><table class="table table-responsive">
        <thead><tr><th>Story</th><th>Stage</th><th>Writer</th><th>Editor</th><th>Due</th><th>Runs</th><th>Meeting</th></tr></thead>
        <tbody>${rows.map((it) => html`<tr class="clickable" data-id="${it.id}" tabindex="0">
          <td data-cell="main"><div class="t-title" style="font-family:var(--sans)">${it.title}</div><div class="t-sub">${sectionName(it.section)}${it.priority === "high" ? " (high priority)" : ""}</div></td>
          <td><span class="pill" data-tone="${it.stage === "killed" ? "muted" : it.stage === "published" ? "ok" : it.stage === "pitch" ? "new" : "active"}">${stageOf(it.stage).label}</span></td>
          <td class="small">${nameOf(it.writer_id) || html`<span class="muted">Unassigned</span>`}</td>
          <td class="small">${nameOf(it.editor_id) || html`<span class="muted">None</span>`}</td>
          <td class="small ${overdue(it) ? "tk-late-text" : "muted"}">${day(it.due_on)}</td>
          <td class="small muted">${day(it.publish_on)}</td>
          <td class="small">${it.meeting_needed ? (it.meeting_at ? fmtDateTime(it.meeting_at) : "Needed") : ""}</td>
        </tr>`)}</tbody></table></div>`
        : html`<div class="card table-empty"><strong>Nothing here</strong>${filter === "active" ? "Pitch the first story to start the budget." : "Try another filter."}</div>`);
      return;
    }
    const cols = filter === "done" ? ["published", "killed"] : TRACKER_ACTIVE;
    mount(body, html`<div class="tk-board" style="--cols:${cols.length}">${cols.map((k) => {
      const list = rows.filter((it) => it.stage === k);
      return html`<section class="tk-col" data-stage="${k}" aria-labelledby="tk-col-${k}">
        <header class="tk-col-head"><h2 id="tk-col-${k}">${stageOf(k).label}</h2><span class="n">${list.length}</span></header>
        <p class="tk-col-hint">${stageOf(k).hint}</p>
        <div class="tk-drop">${list.length ? list.map(card) : html`<p class="tk-empty">${k === "pitch" && filter === "active" ? "No pitches yet." : "Nothing here."}</p>`}</div>
      </section>`;
    })}</div>`);
  };

  mount(ctx.el, html`<div class="view tracker">
    <div class="view-head tk-head">
      <div><h1>Story tracker</h1><p>Who's writing what, where every story stands, and which ones need a meeting.</p></div>
      <button class="btn btn-accent" type="button" data-new>${icon("plus")} ${editor ? "New story" : "Pitch a story"}</button>
    </div>
    <div id="tk-meetings"></div>
    <div class="toolbar">
      <div class="seg" role="group" aria-label="Show">${FILTERS.map(([k, l]) => html`<button type="button" data-filter="${k}" aria-pressed="${k === filter ? "true" : "false"}">${l}</button>`)}</div>
      <select class="select" data-sec aria-label="Section" style="width:auto"><option value="">All sections</option>${config.sections.map((s) => html`<option value="${s.slug}">${s.name}</option>`)}<option value="learn">${config.learn.name}</option></select>
      <input class="input search" type="search" placeholder="Search stories or people" aria-label="Search stories" data-q>
      <span class="spacer"></span>
      <div class="seg" role="group" aria-label="Layout"><button type="button" data-view="board" aria-pressed="${view === "board" ? "true" : "false"}">Board</button><button type="button" data-view="list" aria-pressed="${view === "list" ? "true" : "false"}">List</button></div>
    </div>
    ${myAuthor ? "" : html`<p class="small muted tk-nobyline">Your account isn't linked to a byline yet, so Mine shows only the stories you pitched. An admin can link it in Members.</p>`}
    <div id="tk-body"></div>
  </div>`);
  drawBody();

  // ---- moving stories between stages
  async function move(id, stage) {
    const it = items.find((x) => x.id === id);
    if (!it || it.stage === stage) return;
    if (!canMove(it, stage)) {
      toast(it.stage === "pitch" && !editor ? "An editor approves pitches first." : canEdit(it) ? "Editors move stories to Approved, Ready, Published or Dropped." : "Only the writer, the person who pitched it, or an editor can move this story.", { error: true });
      return;
    }
    const prev = it.stage;
    it.stage = stage;
    drawBody();
    try { Object.assign(it, await db.saveTrackerItem({ stage }, id)); toast(`Moved to ${stageOf(stage).label}`); }
    catch (ex) { it.stage = prev; drawBody(); toast(friendlyError(ex), { error: true }); }
  }
  ctx.el.addEventListener("dragstart", (e) => {
    const c = e.target.closest(".tk-card");
    if (!c) return;
    e.dataTransfer.setData("text/plain", c.dataset.id);
    e.dataTransfer.effectAllowed = "move";
    c.classList.add("is-dragging");
  });
  ctx.el.addEventListener("dragend", () => $$(".is-dragging, .is-over", ctx.el).forEach((x) => x.classList.remove("is-dragging", "is-over")));
  ctx.el.addEventListener("dragover", (e) => {
    const col = e.target.closest(".tk-col");
    if (!col) return;
    e.preventDefault();
    $$(".tk-col.is-over", ctx.el).forEach((x) => { if (x !== col) x.classList.remove("is-over"); });
    col.classList.add("is-over");
  });
  ctx.el.addEventListener("drop", (e) => {
    const col = e.target.closest(".tk-col");
    if (!col) return;
    e.preventDefault();
    col.classList.remove("is-over");
    move(e.dataTransfer.getData("text/plain"), col.dataset.stage);
  });

  // ---- toolbar and opening stories
  ctx.el.addEventListener("click", (e) => {
    const f = e.target.closest("[data-filter]");
    if (f) { filter = f.dataset.filter; drawBody(); return; }
    const v = e.target.closest("[data-view]");
    if (v) { view = v.dataset.view; localStorage.setItem(VIEW_KEY, view); drawBody(); return; }
    if (e.target.closest("[data-new]")) { openStory(null); return; }
    const o = e.target.closest("[data-open], .tk-card, tr[data-id]");
    if (o) openStory(items.find((x) => x.id === (o.dataset.open || o.dataset.id)));
  });
  ctx.el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches(".tk-card, tr[data-id]")) openStory(items.find((x) => x.id === e.target.dataset.id));
  });
  ctx.el.addEventListener("change", (e) => { if (e.target.matches("[data-sec]")) { section = e.target.value; drawBody(); } });
  $("[data-q]", ctx.el).addEventListener("input", debounce((e) => { q = e.target.value.trim().toLowerCase(); drawBody(); }, 150));

  // ---- the story panel: details on the left, notes on the right
  async function openStory(it) {
    const fresh = !it;
    const s = it || { title: "", angle: "", section: config.sections[0].slug, priority: "normal", stage: "pitch", writer_id: editor ? null : myAuthor, editor_id: null, due_on: null, publish_on: null, meeting_needed: false, meeting_at: null, meeting_note: "", article_id: null };
    const editable = fresh || canEdit(s);
    const ro = editable ? "" : raw("disabled");
    const stageOpts = TRACKER_STAGES.map((x) => {
      const ok = editor || x.key === s.stage || (!fresh && canMove(s, x.key));
      return html`<option value="${x.key}" ${x.key === s.stage ? raw("selected") : ""} ${ok ? "" : raw("disabled")}>${x.label}</option>`;
    });
    const peopleOpts = (cur, none) => html`<option value="">${none}</option>${authors.map((a) => html`<option value="${a.id}" ${a.id === cur ? raw("selected") : ""}>${a.name}</option>`)}`;
    const art = s.article_id ? articles.find((a) => a.id === s.article_id) : null;
    const drafts = articles.filter((a) => a.status !== "published" && !items.some((x) => x.article_id === a.id)).slice(0, 60);
    const p = openPanel({
      title: fresh ? (editor ? "New story" : "Pitch a story") : s.title,
      wide: true,
      body: html`<div class="tk-panel">
        <form class="stack tk-form" data-story novalidate>
          ${editable ? "" : html`<p class="notice">You can read this story and leave notes. Its writer, the person who pitched it, or an editor can change it.</p>`}
          <div class="field"><label for="tk-title">Working headline</label><input class="input" id="tk-title" name="title" value="${s.title}" ${ro} required></div>
          <div class="field"><label for="tk-angle">Angle</label><textarea class="textarea" id="tk-angle" name="angle" rows="4" ${ro} placeholder="The argument, why it matters now, and who you'll talk to.">${s.angle || ""}</textarea></div>
          <div class="field-row">
            <div class="field"><label for="tk-section">Section</label><select class="select" id="tk-section" name="section" ${ro}>${config.sections.map((x) => html`<option value="${x.slug}" ${x.slug === s.section ? raw("selected") : ""}>${x.name}</option>`)}<option value="learn" ${s.section === "learn" ? raw("selected") : ""}>${config.learn.name}</option></select></div>
            <div class="field"><label for="tk-priority">Priority</label><select class="select" id="tk-priority" name="priority" ${ro}>${Object.entries(TRACKER_PRIORITY).map(([k, l]) => html`<option value="${k}" ${k === s.priority ? raw("selected") : ""}>${l}</option>`)}</select></div>
          </div>
          <div class="field-row">
            <div class="field"><label for="tk-stage">Stage</label><select class="select" id="tk-stage" name="stage" ${fresh && !editor ? raw("disabled") : ro}>${stageOpts}</select>
              ${editor ? "" : html`<span class="hint">${fresh ? "New stories start as pitches. An editor approves them." : "You can move your stories between Drafting and In edit."}</span>`}</div>
            <div class="field"><label for="tk-writer">Writer</label>${editor
              ? html`<select class="select" id="tk-writer" name="writer_id">${peopleOpts(s.writer_id, "Unassigned")}</select>`
              : fresh ? html`<select class="select" id="tk-writer" name="writer_id"><option value="">Anyone</option>${myAuthor ? html`<option value="${myAuthor}" selected>Me (${nameOf(myAuthor)})</option>` : ""}</select>`
              : html`<p class="tk-static">${nameOf(s.writer_id) || "Unassigned"}</p>${canClaim(s) ? html`<button class="btn btn-sm" type="button" data-claim>Take this story</button>` : ""}`}</div>
          </div>
          <div class="field-row">
            <div class="field"><label for="tk-editor">Editor</label>${editor ? html`<select class="select" id="tk-editor" name="editor_id">${peopleOpts(s.editor_id, "None yet")}</select>` : html`<p class="tk-static">${nameOf(s.editor_id) || "None yet"}</p>`}</div>
            <div class="field"><label for="tk-due">Draft due</label><input class="input" id="tk-due" name="due_on" type="date" value="${s.due_on || ""}" ${ro}></div>
          </div>
          <div class="field-row">
            <div class="field"><label for="tk-pub">Planned to run</label><input class="input" id="tk-pub" name="publish_on" type="date" value="${s.publish_on || ""}" ${ro}></div>
            <span></span>
          </div>
          <fieldset class="tk-meet">
            <legend class="sr-only">Meeting</legend>
            <label class="toggle"><input type="checkbox" name="meeting_needed" ${s.meeting_needed ? raw("checked") : ""} ${ro}><span class="track"></span><span>Needs a meeting</span></label>
            <div class="stack" data-meet ${s.meeting_needed ? "" : raw("hidden")} style="gap:12px;margin-top:12px">
              <div class="field"><label for="tk-meet-at">When <span class="hint">(optional)</span></label><input class="input" id="tk-meet-at" name="meeting_at" type="datetime-local" value="${s.meeting_at ? toLocalInput(s.meeting_at) : ""}" ${ro}></div>
              <div class="field"><label for="tk-meet-note">What to discuss</label><textarea class="textarea" id="tk-meet-note" name="meeting_note" rows="2" ${ro} placeholder="The structure, a source, the numbers in the second chart">${s.meeting_note || ""}</textarea></div>
            </div>
          </fieldset>
          ${fresh ? "" : html`<div class="tk-article">
            <h3>Draft</h3>
            ${s.article_id
              ? art ? html`<p><a href="#/articles/${art.id}">${art.title}</a> <span class="pill" data-tone="${art.status === "published" ? "ok" : art.status === "review" ? "active" : "muted"}">${ARTICLE_STATUS[art.status] || art.status}</span></p>` : html`<p class="small muted">Linked to a draft you can't open.</p>`
              : (editor || (myAuthor && s.writer_id === myAuthor)) && s.stage !== "pitch"
                ? html`<div class="row"><button class="btn btn-sm" type="button" data-start-draft>${icon("edit")} Start the draft</button>${drafts.length ? html`<select class="select" data-link-draft aria-label="Link an existing draft" style="width:auto"><option value="">Or link an existing draft…</option>${drafts.map((a) => html`<option value="${a.id}">${a.title}</option>`)}</select>` : ""}</div>
                  <p class="small muted">Starting the draft opens it in the editor with this headline and section. The story moves to In edit when the draft is sent for review, and to Published when it goes out.</p>`
                : html`<p class="small muted">${s.stage === "pitch" ? "The draft can start once an editor approves the pitch." : "The writer starts the draft from here."}</p>`}
          </div>`}
          <p class="form-error" role="alert"></p>
          ${editable ? html`<div class="row"><button class="btn btn-accent" type="submit">${fresh ? (editor ? "Add story" : "Send pitch") : "Save"}</button>${!fresh && (editor || (s.created_by === me.id && s.stage === "pitch")) ? html`<span class="spacer"></span><button class="btn btn-ghost" type="button" data-delete>${icon("trash")} Delete</button>` : ""}</div>` : ""}
        </form>
        <aside class="tk-notes" aria-labelledby="tk-notes-h">
          <h3 id="tk-notes-h">Notes</h3>
          ${fresh ? html`<p class="small muted">Notes open once the story is on the tracker.</p>` : html`<ul class="tk-thread" data-thread><li class="small muted">Loading notes…</li></ul>
            <form class="stack" data-note style="gap:8px"><label class="sr-only" for="tk-note">Add a note</label><textarea class="textarea" id="tk-note" name="body" rows="3" placeholder="A question for the writer, sourcing, the edit…"></textarea><div><button class="btn btn-sm" type="submit">Add note</button></div></form>`}
        </aside>
      </div>`.value,
    });
    const r = p.el;
    let notes = [];
    const drawNotes = () => mount($("[data-thread]", r), notes.length
      ? notes.map((n) => html`<li><div class="tk-note-head"><strong>${n.author_name || "Someone"}</strong><span>${fmtDateTime(n.created_at)}</span>${n.user_id === me.id || editor ? html`<button class="link-inline small" type="button" data-del-note="${n.id}">Remove</button>` : ""}</div><p>${n.body}</p></li>`)
      : html`<li class="small muted">No notes yet. Use them for questions, sourcing and the edit.</li>`);
    if (!fresh) db.listTrackerComments(s.id).then((list) => { notes = list; drawNotes(); }).catch(() => mount($("[data-thread]", r), html`<li class="small muted">Notes couldn't load.</li>`));

    const collect = (form) => {
      const fd = new FormData(form);
      const g = (k) => (fd.has(k) ? String(fd.get(k) || "").trim() : undefined);
      const out = { title: g("title"), angle: g("angle"), section: g("section"), priority: g("priority"), stage: g("stage"),
        writer_id: fd.has("writer_id") ? g("writer_id") || null : undefined, editor_id: fd.has("editor_id") ? g("editor_id") || null : undefined,
        due_on: fd.has("due_on") ? g("due_on") || null : undefined, publish_on: fd.has("publish_on") ? g("publish_on") || null : undefined,
        meeting_needed: fd.has("meeting_needed"), meeting_at: g("meeting_at") ? fromLocalInput(g("meeting_at")) : null, meeting_note: g("meeting_note") || "" };
      Object.keys(out).forEach((k) => out[k] === undefined && delete out[k]);
      return out;
    };
    const save = async (patch, msg) => {
      const saved = await db.saveTrackerItem(patch, fresh ? undefined : s.id);
      const existing = items.find((x) => x.id === saved.id);
      if (existing) Object.assign(existing, saved); else items.unshift({ ...saved, comment_count: 0 });
      drawBody();
      ctx.refreshCounts();
      if (msg) toast(msg);
      return saved;
    };

    r.addEventListener("change", (e) => { if (e.target.name === "meeting_needed") $("[data-meet]", r).hidden = !e.target.checked; });
    r.addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target;
      const btn = $('button[type="submit"]', form);
      btn.disabled = true;
      try {
        if (form.matches("[data-story]")) {
          const data = collect(form);
          if (!data.title) { $(".form-error", form).textContent = "Give the story a working headline."; return; }
          await save(data, fresh ? (editor ? "Story added" : "Pitch sent. An editor will take a look.") : "Saved");
          p.close();
        }
        if (form.matches("[data-note]")) {
          const body = String(new FormData(form).get("body") || "").trim();
          if (!body) return;
          notes.push(await db.addTrackerComment(s.id, body));
          const it2 = items.find((x) => x.id === s.id);
          if (it2) it2.comment_count = (it2.comment_count || 0) + 1;
          form.reset();
          drawNotes();
          drawBody();
        }
      } catch (ex) {
        const err = $(".form-error", r);
        if (err && form.matches("[data-story]")) err.textContent = friendlyError(ex); else toast(friendlyError(ex), { error: true });
      } finally { btn.disabled = false; }
    });
    r.addEventListener("click", async (e) => {
      try {
        if (e.target.closest("[data-claim]")) { await save({ writer_id: myAuthor }, "It's yours. Start the draft when you're ready."); p.close(); }
        if (e.target.closest("[data-delete]")) {
          if (!(await confirmDialog(`Delete “${s.title}” from the tracker? Its notes go too. A linked draft stays in Articles.`, { title: "Delete this story?", confirm: "Delete", danger: true }))) return;
          await db.deleteTrackerItem(s.id);
          items = items.filter((x) => x.id !== s.id);
          drawBody();
          ctx.refreshCounts();
          p.close();
          toast("Deleted");
        }
        if (e.target.closest("[data-start-draft]")) {
          const a = await db.saveArticle({ title: s.title, section: s.section || config.sections[0].slug, author_id: s.writer_id || myAuthor || null, status: "draft", body: s.angle ? `<!-- Angle: ${s.angle.replace(/-->/g, "")} -->\n\n` : "" });
          await save({ article_id: a.id, ...(s.stage === "approved" ? { stage: "drafting" } : {}) }, "Draft started");
          p.close();
          ctx.navigate(`#/articles/${a.id}`);
        }
        const del = e.target.closest("[data-del-note]");
        if (del) {
          await db.deleteTrackerComment(del.dataset.delNote);
          notes = notes.filter((n) => n.id !== del.dataset.delNote);
          const it2 = items.find((x) => x.id === s.id);
          if (it2) it2.comment_count = Math.max(0, (it2.comment_count || 1) - 1);
          drawNotes();
          drawBody();
        }
      } catch (ex) { toast(friendlyError(ex), { error: true }); }
    });
    r.addEventListener("change", async (e) => {
      if (!e.target.matches("[data-link-draft]") || !e.target.value) return;
      try {
        await save({ article_id: e.target.value, ...(s.stage === "approved" ? { stage: "drafting" } : {}) }, "Draft linked");
        p.close();
      } catch (ex) { toast(friendlyError(ex), { error: true }); }
    });
  }
}
