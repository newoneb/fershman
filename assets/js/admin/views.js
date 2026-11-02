// Admin list views: dashboard, articles, authors, portal, inbox, members, subscribers, settings.
import { db, LIVE, config } from "../data/db.js";
import { html, raw, mount, icon, fmtDate, fmtDateTime, timeAgo, initials, safeUrl, slugify, fmtBytes, debounce, $, $$ } from "../lib/util.js";
import { toast, confirmDialog, openPanel, copyText, downloadFile } from "../lib/ui.js";
import { renderMarkdown } from "../lib/md.js";
import { articleState, roleAtLeast, ROLES, ROLE_LABELS, friendlyError, itemKind, SETTINGS_DEFAULTS } from "../data/shared.js";
import { kindIcon, kindLabel, openUploadPanel, openViewer } from "../shared/portal-ui.js";

const STATE_LABEL = { published: "Published", scheduled: "Scheduled", review: "In review", draft: "Draft" };
const pill = (state) => html`<span class="pill pill-${state}">${STATE_LABEL[state] || state}</span>`;
const sectionName = (slug) => (config.sections.find((s) => s.slug === slug) || (slug === "learn" ? { name: config.learn.name } : { name: slug || "—" })).name;
const head = (title, sub, actions = "") => html`<div class="view-head"><div><h1>${title}</h1>${sub ? html`<p>${sub}</p>` : ""}</div><div class="view-actions">${actions}</div></div>`;
const articleLink = (a) => `/articles/${encodeURIComponent(a.slug)}${articleState(a) === "published" ? "" : `?preview=${a.id}`}`;

// ---------------------------------------------------------------- Dashboard
export async function dashboard(ctx) {
  const [c, arts] = await Promise.all([ctx.refreshCounts(), db.adminListArticles()]);
  const isEditor = roleAtLeast(ctx.role, "editor");
  const isAdmin = roleAtLeast(ctx.role, "admin");
  const first = (ctx.session.profile.full_name || "").split(" ")[0];
  const stat = (value, label, href) => html`<a class="card stat" href="${href}"><div class="stat-value">${value ?? 0}</div><div class="stat-label">${label}</div></a>`;
  const showSetup = isAdmin && (!LIVE || (c.published || 0) === 0);
  mount(ctx.el, html`<div class="view">
    ${head(first ? `Welcome back, ${first}` : "Dashboard", isEditor ? "Here's where the journal stands today." : "Your drafts and submissions.",
      html`<a class="btn btn-accent" href="#/articles/new">${icon("plus")} New article</a>${isEditor ? html`<button class="btn" type="button" data-upload>${icon("upload")} Add to portal</button>` : ""}`)}
    <div class="stats">
      ${stat(c.published, "Published", "#/articles?status=published")}
      ${stat(c.scheduled, "Scheduled", "#/articles?status=scheduled")}
      ${stat(c.review, "In review", "#/articles?status=review")}
      ${stat(c.drafts, "Drafts", "#/articles?status=draft")}
      ${isEditor ? stat(c.newMessages, "New messages", "#/inbox") : ""}
      ${isAdmin ? stat(c.pending, "Waiting for approval", "#/members") : ""}
      ${isAdmin ? stat(c.subscribers, "Subscribers", "#/subscribers") : ""}
    </div>
    <div class="grid-2">
      <section class="card table-card" aria-labelledby="recent-h">
        <div class="card-pad" style="padding-bottom:6px"><h2 id="recent-h">Recently edited</h2></div>
        ${arts.length ? html`<table class="table table-responsive"><tbody>
          ${arts.slice(0, 7).map((a) => html`<tr class="clickable" data-href="#/articles/${a.id}">
            <td data-cell="main"><div class="t-title">${a.title || "Untitled"}</div><div class="t-sub">${sectionName(a.section)}${a.author ? html` — ${a.author.name}` : ""}</div></td>
            <td>${pill(articleState(a))}</td><td class="small muted">${timeAgo(a.updated_at)}</td></tr>`)}
        </tbody></table>` : html`<div class="table-empty"><strong>No articles yet</strong>Write the first one, or import your archive.</div>`}
      </section>
      ${showSetup ? html`
      <section class="card card-pad" aria-labelledby="setup-h">
        <h2 id="setup-h">${LIVE ? "Finish setting up" : "Go live in four steps"}</h2>
        <p>${LIVE ? "Your database is connected. Bring over your archive next." : "You're previewing the site with sample content. Connect a free Supabase project to publish for real."}</p>
        <ol class="checklist">
          <li class="${LIVE ? "done" : ""}"><div><strong>Create the database</strong>Make a free Supabase project and run <code>supabase/schema.sql</code> in its SQL editor.</div></li>
          <li class="${LIVE ? "done" : ""}"><div><strong>Connect the site</strong>Paste the project URL and publishable key in <a href="#/settings">Settings</a>, download <code>config.js</code> and redeploy.</div></li>
          <li class="${LIVE ? "done" : ""}"><div><strong>Create your admin account</strong>Sign up at <code>/portal/</code> on the live site. The first account becomes the admin.</div></li>
          <li class="${(c.published || 0) > 0 && LIVE ? "done" : ""}"><div><strong>Import your archive</strong>Export your Framer CMS to CSV and load it in <a href="#/import">Import</a>.</div></li>
        </ol>
      </section>` : html`
      <section class="card card-pad">
        <h2>Shortcuts</h2>
        <ul class="panel-links">
          <li><a href="#/articles?status=review">Articles waiting for review</a></li>
          ${isEditor ? html`<li><a href="#/inbox">Read new submissions</a></li><li><a href="#/portal">Manage portal files</a></li>` : ""}
          <li><a href="/" target="_blank" rel="noopener">Open the public site</a></li>
        </ul>
      </section>`}
    </div>
  </div>`);
  ctx.el.addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-href]");
    if (tr) location.hash = tr.dataset.href;
    if (e.target.closest("[data-upload]")) openUploadPanel({ onDone: () => ctx.refreshCounts() });
  });
}

// ---------------------------------------------------------------- Articles
export async function articles(ctx) {
  const all = await db.adminListArticles();
  let status = ctx.query.status || "all";
  let q = "";
  let section = "";
  const count = (s) => (s === "all" ? all.length : all.filter((a) => articleState(a) === s).length);
  const tabs = ["all", "published", "scheduled", "review", "draft"];
  mount(ctx.el, html`<div class="view">
    ${head("Articles", roleAtLeast(ctx.role, "editor") ? "Everything in the journal, newest edits first." : "Your drafts and submissions.", html`<a class="btn btn-accent" href="#/articles/new">${icon("plus")} New article</a>`)}
    <div class="toolbar">
      <div class="seg" role="group" aria-label="Filter by status">
        ${tabs.map((t) => html`<button type="button" data-status="${t}" aria-pressed="${t === status}">${t === "all" ? "All" : STATE_LABEL[t]} <span class="n">${count(t)}</span></button>`)}
      </div>
      <input class="input search" type="search" placeholder="Search titles" aria-label="Search titles" data-q>
      <select class="select" data-section aria-label="Filter by section"><option value="">All sections</option>${config.sections.map((s) => html`<option value="${s.slug}">${s.name}</option>`)}<option value="learn">${config.learn.name}</option></select>
    </div>
    <div class="card table-card" id="list"></div>
  </div>`);
  const draw = () => {
    const rows = all.filter((a) => (status === "all" || articleState(a) === status)
      && (!section || a.section === section)
      && (!q || `${a.title} ${a.dek || ""} ${a.topic || ""}`.toLowerCase().includes(q)));
    mount("#list", rows.length ? html`
      <table class="table table-responsive">
        <thead><tr><th>Title</th><th>Author</th><th>Status</th><th>Date</th><th class="t-actions"><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${rows.map((a) => {
          const st = articleState(a);
          return html`<tr class="clickable" data-href="#/articles/${a.id}">
            <td data-cell="main"><div class="t-title">${a.featured ? html`<span title="Featured on the front page" style="color:var(--accent)">★ </span>` : ""}${a.title || "Untitled"}</div><div class="t-sub">${sectionName(a.section)}${a.topic ? html` — ${a.topic}` : ""}</div></td>
            <td data-cell="hide">${a.author ? a.author.name : html`<span class="muted">—</span>`}</td>
            <td>${pill(st)}</td>
            <td class="small muted">${st === "published" || st === "scheduled" ? fmtDateTime(a.published_at) : `Edited ${timeAgo(a.updated_at)}`}</td>
            <td class="t-actions"><a class="icon-btn" href="${articleLink(a)}" target="_blank" rel="noopener" title="${st === "published" ? "View on site" : "Preview"}" aria-label="Open ${a.title}" data-stop>${icon("external")}</a></td>
          </tr>`;
        })}</tbody>
      </table>` : html`<div class="table-empty"><strong>No matching articles</strong>${all.length ? "Try another filter." : "Start writing, or bring your archive over in Import."}</div>`);
  };
  ctx.el.addEventListener("click", (e) => {
    if (e.target.closest("[data-stop]")) return;
    const b = e.target.closest("[data-status]");
    if (b) {
      status = b.dataset.status;
      $$("[data-status]", ctx.el).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      history.replaceState(null, "", status === "all" ? "#/articles" : `#/articles?status=${status}`);
      draw();
    }
    const tr = e.target.closest("tr[data-href]");
    if (tr) location.hash = tr.dataset.href;
  });
  $("[data-q]", ctx.el).addEventListener("input", debounce((e) => { q = e.target.value.trim().toLowerCase(); draw(); }, 150));
  $("[data-section]", ctx.el).addEventListener("change", (e) => { section = e.target.value; draw(); });
  draw();
}

// ---------------------------------------------------------------- Authors
export async function authors(ctx) {
  let list = await db.listAuthors();
  const isAdmin = roleAtLeast(ctx.role, "admin");
  const reload = async () => { list = await db.listAuthors(); draw(); };
  mount(ctx.el, html`<div class="view">
    ${head("Authors", "Public bylines and author pages. These are separate from login accounts.", html`<button class="btn btn-accent" type="button" data-new>${icon("plus")} New author</button>`)}
    <div class="card table-card" id="list"></div>
  </div>`);
  const draw = () => mount("#list", list.length ? html`
    <table class="table table-responsive">
      <thead><tr><th>Name</th><th>Team</th><th>Page</th><th class="t-actions"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${list.map((a) => html`<tr class="clickable" data-id="${a.id}">
        <td data-cell="main"><div class="row" style="flex-wrap:nowrap">
          <span class="avatar">${safeUrl(a.avatar_url) ? html`<img src="${safeUrl(a.avatar_url)}" alt="" data-initials="${initials(a.name)}">` : initials(a.name)}</span>
          <div><div class="t-title">${a.name}</div><div class="t-sub">${a.role_title || ""}</div></div></div></td>
        <td>${a.team || "Contributors"}</td>
        <td data-cell="hide" class="small muted">/authors/${a.slug}</td>
        <td class="t-actions"><a class="icon-btn" href="/authors/${encodeURIComponent(a.slug)}" target="_blank" rel="noopener" aria-label="View ${a.name}'s page" data-stop>${icon("external")}</a></td>
      </tr>`)}</tbody>
    </table>` : html`<div class="table-empty"><strong>No authors yet</strong>Add your writers so their names appear on stories.</div>`);
  const edit = (author) => {
    const a = author || { name: "", slug: "", role_title: "", team: "Analysts", bio: "", avatar_url: "", linkedin_url: "", x_url: "", sort_order: 100 };
    let slugTouched = Boolean(author);
    const p = openPanel({
      title: author ? `Edit ${author.name}` : "New author",
      body: html`
        <div class="field"><label for="au-n">Name</label><input class="input" id="au-n" value="${a.name}" required></div>
        <div class="field"><label for="au-s">Page address</label><input class="input" id="au-s" value="${a.slug}"><span class="hint slug-preview">/authors/<span data-slug>${a.slug}</span></span></div>
        <div class="field"><label for="au-r">Role or title</label><input class="input" id="au-r" value="${a.role_title || ""}" placeholder="Analyst, The Fershman Journal"></div>
        <div class="field-row">
          <div class="field"><label for="au-t">Team</label><input class="input" id="au-t" list="au-teams" value="${a.team || ""}"><datalist id="au-teams">${config.authorTeams.map((t) => html`<option value="${t}">`)}</datalist></div>
          <div class="field"><label for="au-o">Order</label><input class="input" id="au-o" type="number" value="${a.sort_order ?? 100}"><span class="hint">Lower numbers appear first.</span></div>
        </div>
        <div class="field"><label for="au-b">Short bio</label><textarea class="textarea" id="au-b" rows="4">${a.bio || ""}</textarea></div>
        <div class="field"><span class="label">Photo</span>
          <div class="row"><span class="avatar avatar-md" data-av>${safeUrl(a.avatar_url) ? html`<img src="${safeUrl(a.avatar_url)}" alt="">` : initials(a.name)}</span>
            <label class="btn btn-sm">${icon("upload")} Upload<input type="file" accept="image/*" hidden data-file></label></div>
          <input class="input" id="au-a" value="${a.avatar_url || ""}" placeholder="…or paste an image URL"></div>
        <div class="field-row">
          <div class="field"><label for="au-li">LinkedIn URL</label><input class="input" id="au-li" value="${a.linkedin_url || ""}"></div>
          <div class="field"><label for="au-x">X URL</label><input class="input" id="au-x" value="${a.x_url || ""}"></div>
        </div>
        <p class="form-error" role="alert"></p>`.value,
      foot: html`${author && isAdmin ? html`<button class="btn btn-danger" type="button" data-del>Delete</button><span class="spacer"></span>` : ""}<button class="btn" type="button" data-close>Cancel</button><button class="btn btn-accent" type="button" data-save>${author ? "Save changes" : "Add author"}</button>`.value,
    });
    const r = p.el;
    const nameI = $("#au-n", r), slugI = $("#au-s", r);
    nameI.addEventListener("input", () => { if (!slugTouched) { slugI.value = slugify(nameI.value); $("[data-slug]", r).textContent = slugI.value; } });
    slugI.addEventListener("input", () => { slugTouched = true; $("[data-slug]", r).textContent = slugI.value; });
    $("[data-file]", r).addEventListener("change", async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try { const url = await db.uploadMedia(f); $("#au-a", r).value = url; $("[data-av]", r).innerHTML = html`<img src="${url}" alt="">`.value; }
      catch (ex) { $(".form-error", r).textContent = friendlyError(ex); }
    });
    r.addEventListener("click", async (e) => {
      if (e.target.closest("[data-save]")) {
        const data = {
          id: author && author.id, name: nameI.value.trim(), slug: slugify(slugI.value) || slugify(nameI.value),
          role_title: $("#au-r", r).value.trim() || null, team: $("#au-t", r).value.trim() || "Contributors",
          sort_order: Number($("#au-o", r).value) || 100, bio: $("#au-b", r).value.trim() || null,
          avatar_url: $("#au-a", r).value.trim() || null, linkedin_url: $("#au-li", r).value.trim() || null, x_url: $("#au-x", r).value.trim() || null,
        };
        if (!data.name) { $(".form-error", r).textContent = "Enter the author's name."; return; }
        try { await db.saveAuthor(data); toast(author ? "Author saved" : "Author added"); p.close(); reload(); }
        catch (ex) { $(".form-error", r).textContent = friendlyError(ex); }
      }
      if (e.target.closest("[data-del]")) {
        if (!(await confirmDialog(`Delete ${author.name}? Their stories stay published but lose the byline.`, { title: "Delete author", confirm: "Delete", danger: true }))) return;
        try { await db.deleteAuthor(author.id); toast("Author deleted"); p.close(); reload(); }
        catch (ex) { $(".form-error", r).textContent = friendlyError(ex); }
      }
    });
  };
  ctx.el.addEventListener("click", (e) => {
    if (e.target.closest("[data-stop]")) return;
    if (e.target.closest("[data-new]")) edit(null);
    const tr = e.target.closest("tr[data-id]");
    if (tr) edit(list.find((a) => a.id === tr.dataset.id));
  });
  draw();
}

// ---------------------------------------------------------------- Portal
export async function portal(ctx) {
  let items = await db.listPortalItems();
  let q = "";
  const collections = () => [...new Set(items.map((i) => i.collection || "General"))].sort();
  const reload = async () => { items = await db.listPortalItems(); draw(); };
  mount(ctx.el, html`<div class="view">
    ${head("Member portal", "Files and links that signed-in members can see.", html`<a class="btn" href="/portal/">${icon("external")} Open portal</a><button class="btn btn-accent" type="button" data-add>${icon("upload")} Add files</button>`)}
    <div class="toolbar"><input class="input search" type="search" placeholder="Search files" aria-label="Search files" data-q></div>
    <div id="list" class="stack"></div>
  </div>`);
  const draw = () => {
    const rows = items.filter((i) => !q || `${i.title} ${i.description || ""} ${i.collection || ""} ${i.file_name || ""}`.toLowerCase().includes(q));
    const groups = [...new Set(rows.map((i) => i.collection || "General"))];
    mount("#list", rows.length ? groups.map((g) => html`
      <section class="card table-card" aria-label="${g}">
        <div class="card-pad" style="padding-bottom:4px"><h2>${g} <span class="muted small">${rows.filter((i) => (i.collection || "General") === g).length}</span></h2></div>
        <table class="table table-responsive"><tbody>${rows.filter((i) => (i.collection || "General") === g).map((i) => {
          const k = itemKind(i);
          return html`<tr class="clickable" data-id="${i.id}">
            <td data-cell="main"><div class="row" style="flex-wrap:nowrap">${kindIcon(k)}<div style="min-width:0"><div class="t-title">${i.title}</div><div class="t-sub">${i.description || kindLabel(k)}</div></div></div></td>
            <td class="small muted">${i.event_date ? fmtDate(i.event_date + "T12:00:00") : ""}</td>
            <td class="small muted" data-cell="hide">${i.file_size ? fmtBytes(i.file_size) : kindLabel(k)}</td>
          </tr>`;
        })}</tbody></table>
      </section>`) : html`<div class="card"><div class="table-empty"><strong>${items.length ? "No matching files" : "The library is empty"}</strong>${items.length ? "Try another search." : "Add decks, models and recordings for members."}</div></div>`);
  };
  ctx.el.addEventListener("click", (e) => {
    if (e.target.closest("[data-add]")) openUploadPanel({ collections: collections(), onDone: reload });
    const tr = e.target.closest("tr[data-id]");
    if (tr) openViewer(items.find((i) => i.id === tr.dataset.id), { canEdit: true, collections: collections(), onChanged: reload });
  });
  $("[data-q]", ctx.el).addEventListener("input", debounce((e) => { q = e.target.value.trim().toLowerCase(); draw(); }, 150));
  draw();
}

// ---------------------------------------------------------------- Inbox
export async function inbox(ctx) {
  let msgs = await db.listMessages();
  let kind = "all";
  let showArchived = false;
  let selected = null;
  const KIND_LABEL = { submission: "Submission", application: "Application", contact: "Contact" };
  mount(ctx.el, html`<div class="view">
    ${head("Inbox", "Submissions, applications and messages from the public site.")}
    <div class="toolbar">
      <div class="seg" role="group" aria-label="Filter messages">
        ${["all", "submission", "application", "contact"].map((k) => html`<button type="button" data-kind="${k}" aria-pressed="${k === kind}">${k === "all" ? "All" : KIND_LABEL[k] + "s"}</button>`)}
      </div>
      <label class="toggle"><input type="checkbox" data-archived><span class="track"></span>Show archived</label>
    </div>
    <div class="inbox"><ul class="card msg-list" id="list" role="listbox" aria-label="Messages"></ul><section class="card msg-detail" id="detail" aria-live="polite"></section></div>
  </div>`);
  const visible = () => msgs.filter((m) => (kind === "all" || m.kind === kind) && (showArchived ? m.status === "archived" : m.status !== "archived"));
  const drawList = () => {
    const rows = visible();
    mount("#list", rows.length ? rows.map((m) => html`
      <li class="msg-item ${m.status === "new" ? "unread" : ""}" role="option" tabindex="0" data-id="${m.id}" aria-selected="${selected && selected.id === m.id}">
        <div class="who">${m.name || m.email}<time>${timeAgo(m.created_at)}</time></div>
        <div class="subj">${KIND_LABEL[m.kind] || m.kind}: ${m.subject || "(no subject)"}</div>
        <div class="snip">${(m.body || "").slice(0, 120)}</div>
      </li>`) : html`<li class="table-empty"><strong>Nothing here</strong>${showArchived ? "No archived messages." : "New submissions and messages will appear here."}</li>`);
  };
  const drawDetail = () => {
    const m = selected;
    if (!m) { mount("#detail", html`<p class="muted">Select a message to read it.</p>`); return; }
    const d = m.data || {};
    const fields = Object.entries(d).filter(([k, v]) => v && k !== "section");
    mount("#detail", html`
      <div class="row"><span class="pill ${m.status === "new" ? "pill-new" : ""}">${KIND_LABEL[m.kind] || m.kind}</span><span class="small muted">${fmtDateTime(m.created_at)}</span></div>
      <h2 style="margin-top:12px">${m.subject || "(no subject)"}</h2>
      <dl class="kv"><dt>From</dt><dd>${m.name || "—"}</dd><dt>Email</dt><dd><a href="mailto:${m.email}">${m.email}</a></dd>
        ${fields.map(([k, v]) => html`<dt>${k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}</dt><dd>${/^https?:\/\//.test(v) ? html`<a href="${safeUrl(v)}" target="_blank" rel="noopener">${v}</a>` : v}</dd>`)}</dl>
      <div class="msg-body">${m.body}</div>
      <div class="row" style="margin-top:20px">
        <a class="btn btn-accent" href="mailto:${m.email}?subject=${encodeURIComponent("Re: " + (m.subject || "Your message to Fershman"))}">${icon("mail")} Reply by email</a>
        <button class="btn" type="button" data-act="${m.status === "archived" ? "unarchive" : "archive"}">${m.status === "archived" ? "Move to inbox" : "Archive"}</button>
        <button class="btn btn-ghost" type="button" data-act="unread">Mark unread</button>
        <span class="spacer"></span>
        <button class="btn btn-danger" type="button" data-act="delete">${icon("trash")} Delete</button>
      </div>`);
  };
  const select = async (id) => {
    selected = msgs.find((m) => m.id === id);
    if (selected && selected.status === "new") {
      selected.status = "read";
      try { await db.updateMessage(id, { status: "read" }); ctx.refreshCounts(); } catch (_) { /* ignore */ }
    }
    drawList(); drawDetail();
    if (matchMedia("(max-width: 1080px)").matches) $("#detail").scrollIntoView({ behavior: "smooth" });
  };
  ctx.el.addEventListener("click", async (e) => {
    const k = e.target.closest("[data-kind]");
    if (k) { kind = k.dataset.kind; $$("[data-kind]", ctx.el).forEach((x) => x.setAttribute("aria-pressed", String(x === k))); drawList(); }
    const li = e.target.closest(".msg-item[data-id]");
    if (li) select(li.dataset.id);
    const act = e.target.closest("[data-act]");
    if (act && selected) {
      const a = act.dataset.act;
      try {
        if (a === "delete") {
          if (!(await confirmDialog("Delete this message permanently?", { title: "Delete message", confirm: "Delete", danger: true }))) return;
          await db.deleteMessage(selected.id);
          msgs = msgs.filter((m) => m.id !== selected.id);
          selected = null;
          toast("Message deleted");
        } else {
          const status = a === "archive" ? "archived" : a === "unread" ? "new" : "read";
          await db.updateMessage(selected.id, { status });
          selected.status = status;
          toast(a === "archive" ? "Archived" : a === "unread" ? "Marked unread" : "Moved to inbox");
          if (a !== "unread") selected = null;
        }
        ctx.refreshCounts(); drawList(); drawDetail();
      } catch (ex) { toast(friendlyError(ex), { error: true }); }
    }
  });
  ctx.el.addEventListener("keydown", (e) => { const li = e.target.closest(".msg-item[data-id]"); if (li && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); select(li.dataset.id); } });
  $("[data-archived]", ctx.el).addEventListener("change", (e) => { showArchived = e.target.checked; selected = null; drawList(); drawDetail(); });
  drawList(); drawDetail();
}

// ---------------------------------------------------------------- Members
export async function members(ctx) {
  let [profiles, authorList] = await Promise.all([db.listProfiles(), db.listAuthors()]);
  const portalUrl = `${location.origin}/portal/`;
  mount(ctx.el, html`<div class="view">
    ${head("Members", "Everyone with an account. Roles decide what they can see and do.", html`<button class="btn" type="button" data-copy>${icon("link")} Copy invite link</button>`)}
    <div class="card card-pad" style="margin-bottom:16px">
      <h2>How access works</h2>
      <p>New people sign up at <a href="/portal/">${portalUrl}</a> and appear here as <strong>Pending approval</strong>. Choose a role to let them in.</p>
      <dl class="kv" style="grid-template-columns:110px minmax(0,1fr)">
        <dt>Member</dt><dd>Sees the members portal: decks, models, recordings.</dd>
        <dt>Writer</dt><dd>Also writes drafts and submits them for review.</dd>
        <dt>Editor</dt><dd>Also edits, schedules and publishes, manages authors, portal files and the inbox.</dd>
        <dt>Admin</dt><dd>Everything, including members, subscribers and site settings.</dd>
      </dl>
    </div>
    <div class="card table-card" id="list"></div>
  </div>`);
  const draw = () => {
    const sorted = [...profiles].sort((a, b) => (a.role === "pending" ? -1 : 0) - (b.role === "pending" ? -1 : 0) || new Date(b.created_at) - new Date(a.created_at));
    mount("#list", sorted.length ? html`
      <table class="table table-responsive">
        <thead><tr><th>Person</th><th>Role</th><th>Byline</th><th>Joined</th></tr></thead>
        <tbody>${sorted.map((p) => html`<tr data-id="${p.id}">
          <td data-cell="main"><div class="t-title" style="font-family:var(--sans)">${p.full_name || "—"}${p.id === ctx.session.user.id ? html` <span class="small muted">(you)</span>` : ""}</div><div class="t-sub">${p.email}</div></td>
          <td><div class="row" style="flex-wrap:nowrap">
            <select class="select" data-role aria-label="Role for ${p.email}">${ROLES.map((r) => html`<option value="${r}" ${r === p.role ? raw("selected") : ""}>${ROLE_LABELS[r]}</option>`)}</select>
            ${p.role === "pending" ? html`<button class="btn btn-accent btn-sm" type="button" data-approve>Approve</button>` : ""}</div></td>
          <td data-cell="hide"><select class="select" data-author aria-label="Byline for ${p.email}"><option value="">None</option>${authorList.map((a) => html`<option value="${a.id}" ${a.id === p.author_id ? raw("selected") : ""}>${a.name}</option>`)}</select></td>
          <td class="small muted">${fmtDate(p.created_at)}</td>
        </tr>`)}</tbody>
      </table>` : html`<div class="table-empty"><strong>No accounts yet</strong>Share the invite link with your club.</div>`);
  };
  const update = async (id, patch, label) => {
    try {
      const saved = await db.updateProfile(id, patch);
      profiles = profiles.map((p) => (p.id === id ? { ...p, ...saved } : p));
      toast(label);
      ctx.refreshCounts();
    } catch (ex) { toast(friendlyError(ex), { error: true }); }
    draw();
  };
  ctx.el.addEventListener("change", (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    if (e.target.matches("[data-role]")) update(tr.dataset.id, { role: e.target.value }, `Role changed to ${ROLE_LABELS[e.target.value]}`);
    if (e.target.matches("[data-author]")) update(tr.dataset.id, { author_id: e.target.value || null }, "Byline linked");
  });
  ctx.el.addEventListener("click", async (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (e.target.closest("[data-approve]") && tr) update(tr.dataset.id, { role: "member" }, "Approved as member");
    if (e.target.closest("[data-copy]")) { await copyText(portalUrl); toast("Invite link copied"); }
  });
  draw();
}

// ---------------------------------------------------------------- Subscribers
export async function subscribers(ctx) {
  let subs = await db.listSubscribers();
  let q = "";
  mount(ctx.el, html`<div class="view">
    ${head("Subscribers", "People who signed up for the briefing on the Subscribe page.", html`<button class="btn btn-accent" type="button" data-export>${icon("download")} Export CSV</button>`)}
    <div class="card card-pad" style="margin-bottom:16px"><p style="margin:0">To send a newsletter, export the list and import it into an email tool such as Mailchimp, Beehiiv, Buttondown or Substack.</p></div>
    <div class="toolbar"><input class="input search" type="search" placeholder="Search emails" aria-label="Search emails" data-q><span class="small muted" id="total"></span></div>
    <div class="card table-card" id="list"></div>
  </div>`);
  const draw = () => {
    const rows = subs.filter((s) => !q || `${s.email} ${s.name || ""}`.toLowerCase().includes(q));
    mount("#total", `${subs.length} total`);
    mount("#list", rows.length ? html`
      <table class="table table-responsive">
        <thead><tr><th>Email</th><th>Name</th><th>Signed up</th><th class="t-actions"><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${rows.map((s) => html`<tr data-id="${s.id}">
          <td data-cell="main"><div class="t-title" style="font-family:var(--sans);font-weight:500">${s.email}</div></td>
          <td>${s.name || html`<span class="muted">—</span>`}</td>
          <td class="small muted">${fmtDate(s.created_at)}</td>
          <td class="t-actions"><button class="icon-btn" type="button" data-del aria-label="Remove ${s.email}">${icon("trash")}</button></td>
        </tr>`)}</tbody>
      </table>` : html`<div class="table-empty"><strong>${subs.length ? "No matches" : "No subscribers yet"}</strong>${subs.length ? "" : "Sign-ups from the Subscribe page will appear here."}</div>`);
  };
  ctx.el.addEventListener("click", async (e) => {
    if (e.target.closest("[data-export]")) {
      const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const csv = ["email,name,source,subscribed_at", ...subs.map((s) => [s.email, s.name, s.source, s.created_at].map(esc).join(","))].join("\n");
      downloadFile(`fershman-subscribers-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv");
    }
    const tr = e.target.closest("tr[data-id]");
    if (e.target.closest("[data-del]") && tr) {
      const s = subs.find((x) => x.id === tr.dataset.id);
      if (!(await confirmDialog(`Remove ${s.email} from the list?`, { title: "Remove subscriber", confirm: "Remove", danger: true }))) return;
      try { await db.deleteSubscriber(s.id); subs = subs.filter((x) => x.id !== s.id); toast("Removed"); draw(); }
      catch (ex) { toast(friendlyError(ex), { error: true }); }
    }
  });
  $("[data-q]", ctx.el).addEventListener("input", debounce((e) => { q = e.target.value.trim().toLowerCase(); draw(); }, 150));
  draw();
}

// ---------------------------------------------------------------- Settings
export async function settings(ctx) {
  const s = await db.getSettings();
  const ann = s.announcement || {};
  const pages = [
    { key: "about_md", label: "About page" }, { key: "submit_md", label: "Submit guidelines" },
    { key: "privacy_md", label: "Privacy policy" },
  ];
  let pageKey = pages[0].key;
  let previewOn = false;
  mount(ctx.el, html`<div class="view">
    ${head("Settings", "Site-wide announcement, page text and your database connection.")}
    <div class="stack">
      <section class="card card-pad stack" aria-labelledby="ann-h">
        <div><h2 id="ann-h">Announcement bar</h2><p>A thin green bar above the masthead on every page. Readers can dismiss it.</p></div>
        <label class="toggle"><input type="checkbox" id="ann-on" ${ann.enabled ? raw("checked") : ""}><span class="track"></span>Show the announcement</label>
        <div class="field"><label for="ann-text">Text</label><input class="input" id="ann-text" value="${ann.text || ""}" placeholder="Fall applications are open until October 16."></div>
        <div class="field"><label for="ann-link">Link <span class="hint">(optional)</span></label><input class="input" id="ann-link" value="${ann.link || ""}" placeholder="/apply"></div>
        <div><button class="btn btn-accent" type="button" data-save-ann>Save announcement</button></div>
      </section>

      <section class="card card-pad stack" aria-labelledby="pages-h">
        <div><h2 id="pages-h">Page text</h2><p>Written in Markdown, like articles. Changes go live as soon as you save.</p></div>
        <div class="row">
          <div class="seg" role="group" aria-label="Page">${pages.map((p) => html`<button type="button" data-page="${p.key}" aria-pressed="${p.key === pageKey}">${p.label}</button>`)}</div>
          <span class="spacer"></span>
          <label class="toggle"><input type="checkbox" data-preview><span class="track"></span>Preview</label>
        </div>
        <textarea class="textarea" id="page-md" rows="16" style="font-family:var(--mono);font-size:.875rem"></textarea>
        <div class="card card-pad" id="page-preview" hidden><div class="prose no-dropcap"></div></div>
        <div class="row"><button class="btn btn-accent" type="button" data-save-page>Save page text</button><button class="btn btn-ghost" type="button" data-reset-page>Restore default text</button></div>
      </section>

      ${LIVE ? html`
      <section class="card card-pad stack" aria-labelledby="conn-h">
        <div><h2 id="conn-h">Database</h2><p>Connected to <code class="code">${config.supabase.url}</code>.</p></div>
        <ul class="panel-links">
          <li><a href="https://supabase.com/dashboard/project/${(config.supabase.url.match(/https:\/\/([^.]+)\./) || [])[1] || ""}" target="_blank" rel="noopener">Open this project in Supabase</a></li>
          <li><a href="https://supabase.com/dashboard/project/${(config.supabase.url.match(/https:\/\/([^.]+)\./) || [])[1] || ""}/auth/url-configuration" target="_blank" rel="noopener">Auth URL settings (set your site URL here)</a></li>
        </ul>
      </section>` : html`
      <section class="card card-pad stack" aria-labelledby="live-h" id="go-live">
        <div><h2 id="live-h">Go live</h2><p>Right now everything runs on sample content in your browser. Connect a free Supabase project so articles, members and files are shared by everyone.</p></div>
        <ol class="checklist">
          <li><div><strong>Create a project</strong>Sign up at <a href="https://supabase.com/dashboard" target="_blank" rel="noopener">supabase.com</a> and create a new project (the free plan is enough).</div></li>
          <li><div><strong>Set up the tables</strong>In the project, open SQL Editor, paste the schema and press Run. <button class="btn btn-sm" type="button" data-copy-schema style="margin-top:8px">${icon("copy")} Copy schema</button></div></li>
          <li><div><strong>Paste your keys</strong>Press Connect at the top of your Supabase project (or open Project Settings → Data API and API Keys) and copy the Project URL and the publishable key.
            <div class="stack" style="margin-top:10px;gap:10px">
              <input class="input" id="sb-url" placeholder="https://abcdefghijkl.supabase.co" autocomplete="off">
              <input class="input" id="sb-key" placeholder="sb_publishable_…" autocomplete="off">
              <div class="row"><button class="btn" type="button" data-test>Test connection</button><span class="small" id="sb-result" role="status"></span></div>
            </div></div></li>
          <li><div><strong>Download config.js and redeploy</strong>Replace <code>config.js</code> in your site folder with this file, then drag the folder onto Netlify again. <button class="btn btn-accent btn-sm" type="button" data-download style="margin-top:8px">${icon("download")} Download config.js</button></div></li>
          <li><div><strong>Create your admin account</strong>Open <code>/portal/</code> on the live site and request access. The first account becomes the admin automatically.</div></li>
        </ol>
      </section>
      <section class="card card-pad stack" aria-labelledby="demo-h">
        <div><h2 id="demo-h">Demo tools</h2><p>Preview what each role sees, or start the demo over.</p></div>
        <div class="row">
          <label class="field" style="min-width:220px"><span class="label">View the admin as</span>
            <select class="select" data-demo-role>${["admin", "editor", "writer", "member", "pending"].map((r) => html`<option value="${r}" ${r === ctx.role ? raw("selected") : ""}>${ROLE_LABELS[r]}</option>`)}</select></label>
          <span class="spacer"></span>
          <button class="btn btn-danger" type="button" data-reset-demo>Reset demo data</button>
        </div>
      </section>`}
    </div>
  </div>`);

  const md = $("#page-md");
  const loadPage = () => { md.value = s[pageKey] ?? SETTINGS_DEFAULTS[pageKey] ?? ""; drawPreview(); };
  const drawPreview = () => {
    $("#page-preview").hidden = !previewOn;
    md.hidden = previewOn;
    if (previewOn) $("#page-preview .prose").innerHTML = renderMarkdown(md.value);
  };
  ctx.el.addEventListener("change", async (e) => {
    if (e.target.matches("[data-preview]")) { previewOn = e.target.checked; drawPreview(); }
    if (e.target.matches("[data-demo-role]")) {
      await db.setDemoRole(e.target.value);
      toast(`Now viewing as ${ROLE_LABELS[e.target.value]}`);
      setTimeout(() => location.reload(), 500);
    }
  });
  ctx.el.addEventListener("click", async (e) => {
    const pb = e.target.closest("[data-page]");
    if (pb) { pageKey = pb.dataset.page; $$("[data-page]", ctx.el).forEach((x) => x.setAttribute("aria-pressed", String(x === pb))); loadPage(); }
    try {
      if (e.target.closest("[data-save-ann]")) {
        const value = { enabled: $("#ann-on").checked, text: $("#ann-text").value.trim(), link: $("#ann-link").value.trim() };
        if (value.enabled && !value.text) { toast("Write the announcement text first.", { error: true }); return; }
        await db.saveSetting("announcement", value);
        toast(value.enabled ? "Announcement is live" : "Announcement saved (hidden)");
      }
      if (e.target.closest("[data-save-page]")) {
        await db.saveSetting(pageKey, md.value);
        s[pageKey] = md.value;
        toast("Page text saved");
      }
      if (e.target.closest("[data-reset-page]")) {
        if (!(await confirmDialog("Replace the text in the editor with the original default? Nothing is saved until you press Save.", { title: "Restore default text", confirm: "Restore" }))) return;
        md.value = SETTINGS_DEFAULTS[pageKey] || "";
        drawPreview();
      }
      if (e.target.closest("[data-copy-schema]")) {
        const res = await fetch("/supabase/schema.sql");
        if (!res.ok) throw new Error("supabase/schema.sql is missing from the site folder.");
        await copyText(await res.text());
        toast("Schema copied. Paste it into the Supabase SQL editor.");
      }
      if (e.target.closest("[data-test]")) {
        const url = $("#sb-url").value.trim().replace(/\/+$/, "");
        const key = $("#sb-key").value.trim();
        const out = $("#sb-result");
        if (!/^https:\/\/.+\.supabase\.(co|in)$/.test(url) && !/^https:\/\//.test(url)) { out.textContent = "Enter the full Project URL, starting with https://"; return; }
        if (!key) { out.textContent = "Paste the publishable key."; return; }
        if (/^sb_secret_|service_role/.test(key)) { out.textContent = "That's a secret key. Use the publishable key — the secret key must never go on a website."; return; }
        out.textContent = "Testing…";
        const { createSupabaseClient } = await import("../data/live.js");
        const client = await createSupabaseClient(url, key);
        const { error } = await client.from("articles").select("id", { count: "exact", head: true });
        out.textContent = error ? friendlyError(error) : "Connected, and the tables are set up. Download config.js next.";
        out.style.color = error ? "var(--danger)" : "var(--accent)";
      }
      if (e.target.closest("[data-download]")) {
        const url = $("#sb-url").value.trim().replace(/\/+$/, "");
        const key = $("#sb-key").value.trim();
        if (!url || !key) { toast("Paste the Project URL and publishable key first.", { error: true }); return; }
        if (/^sb_secret_|service_role/.test(key)) { toast("Use the publishable key, not a secret key.", { error: true }); return; }
        let text = await (await fetch("/config.js", { cache: "no-store" })).text();
        const replaced = text.replace(/url:\s*"[^"]*"/, `url: ${JSON.stringify(url)}`).replace(/key:\s*"[^"]*"/, `key: ${JSON.stringify(key)}`);
        if (replaced === text) {
          const cfg = { ...config, supabase: { url, key } };
          text = `// The Fershman Journal — site configuration (generated)\nexport default ${JSON.stringify(cfg, null, 2)};\n`;
        } else text = replaced;
        downloadFile("config.js", text, "text/javascript");
        toast("config.js downloaded. Replace the file in your site folder and redeploy.");
      }
      if (e.target.closest("[data-reset-demo]")) {
        if (!(await confirmDialog("Erase everything you changed in the demo and restore the sample content?", { title: "Reset demo", confirm: "Reset", danger: true }))) return;
        await db.resetDemo();
        location.href = "/admin/";
      }
    } catch (ex) {
      toast(friendlyError(ex), { error: true });
    }
  });
  loadPage();
}
