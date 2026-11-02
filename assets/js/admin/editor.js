// Article editor: Markdown with live preview, publishing workflow, cover image, key figures.
import { db, LIVE, config } from "../data/db.js";
import { html, raw, mount, icon, slugify, safeUrl, coverArt, wordCount, readMinutes, toLocalInput, fromLocalInput, fmtDateTime, timeAgo, debounce, $, $$ } from "../lib/util.js";
import { toast, confirmDialog, openPanel, promptDialog } from "../lib/ui.js";
import { renderMarkdown, enhance, EMBED_HOSTS } from "../lib/md.js";
import { articleState, roleAtLeast, friendlyError } from "../data/shared.js";

const STATE_LABEL = { published: "Published", scheduled: "Scheduled", review: "In review", draft: "Draft" };

export async function editor(ctx, id) {
  const isNew = id === "new";
  const canPublish = roleAtLeast(ctx.role, "editor");
  const [loaded, authors] = await Promise.all([isNew ? null : db.adminGetArticle(id), db.listAuthors()]);
  if (!isNew && !loaded) {
    mount(ctx.el, html`<div class="view"><div class="card card-pad"><h2>Article not found</h2><p>It may have been deleted, or your role can't open it.</p><p style="margin-top:12px"><a class="btn" href="#/articles">Back to articles</a></p></div></div>`);
    return;
  }
  let a = loaded || {
    id: null, title: "", dek: "", body: "", section: config.sections[0].slug, topic: "", tags: [],
    author_id: ctx.session.profile.author_id || null, cover_url: "", cover_alt: "", cover_caption: "", figures: "",
    status: "draft", published_at: null, featured: false, big_read: false, slug: "", updated_at: null,
  };
  let dirty = false;
  let slugTouched = !isNew && Boolean(a.slug);
  const backupKey = `fj-backup-${a.id || "new"}`;
  const wide = matchMedia("(min-width: 1300px)").matches;
  let mode = wide ? "split" : "write";

  const authorOptions = html`<option value="">No byline</option>${authors.map((au) => html`<option value="${au.id}" ${au.id === a.author_id ? raw("selected") : ""}>${au.name}</option>`)}`;
  const sectionOptions = html`${config.sections.map((s) => html`<option value="${s.slug}" ${s.slug === a.section ? raw("selected") : ""}>${s.name}</option>`)}<option value="learn" ${a.section === "learn" ? raw("selected") : ""}>${config.learn.name} (lesson)</option>`;
  const topicList = [...new Set([...config.topics, ...config.learn.topics])];
  const tb = (name, label, act) => html`<button class="icon-btn" type="button" data-md="${act}" title="${label}" aria-label="${label}">${icon(name)}</button>`;

  mount(ctx.el, html`
    <div class="editor-top">
      <a class="back" href="#/articles">${icon("chevronLeft")} Articles</a>
      <span id="ed-pill"></span>
      <span class="save-state" id="ed-saved" aria-live="polite"></span>
      <span class="spacer"></span>
      <a class="btn btn-ghost" id="ed-view" target="_blank" rel="noopener">${icon("eye")} Preview</a>
      <span class="row" id="ed-actions"></span>
    </div>
    <div class="editor">
      <div class="editor-main">
        <div id="ed-restore"></div>
        <label class="sr-only" for="ed-title">Headline</label>
        <textarea class="ed-title" id="ed-title" rows="1" placeholder="Headline">${a.title}</textarea>
        <label class="sr-only" for="ed-dek">Standfirst</label>
        <textarea class="ed-dek" id="ed-dek" rows="1" placeholder="Standfirst: one sentence on why this matters">${a.dek || ""}</textarea>
        <div class="card ed-body-card">
          <div class="md-toolbar" role="toolbar" aria-label="Formatting">
            ${tb("heading", "Section heading", "h2")}${tb("bold", "Bold (Ctrl+B)", "bold")}${tb("italic", "Italic (Ctrl+I)", "italic")}${tb("link", "Link (Ctrl+K)", "link")}
            <span class="sep"></span>
            ${tb("quote", "Pull quote", "quote")}${tb("listUl", "Bulleted list", "ul")}${tb("listOl", "Numbered list", "ol")}${tb("table", "Table", "table")}${tb("chart", "Interactive chart", "chart")}
            <span class="sep"></span>
            ${tb("image", "Insert image", "image")}${tb("footnote", "Footnote", "footnote")}${tb("hr", "Divider", "hr")}
            <div class="seg" role="group" aria-label="Editor view">
              <button type="button" data-mode="write" aria-pressed="${mode === "write" ? "true" : "false"}">Write</button>
              <button type="button" data-mode="split" aria-pressed="${mode === "split" ? "true" : "false"}">Split</button>
              <button type="button" data-mode="preview" aria-pressed="${mode === "preview" ? "true" : "false"}">Preview</button>
            </div>
          </div>
          <div class="md-panes" id="ed-panes">
            <label class="sr-only" for="ed-body">Article body (Markdown)</label>
            <textarea class="md-input" id="ed-body" spellcheck="true" placeholder="Start writing. Use the toolbar for headings, quotes, tables and images, or paste an image straight in.">${a.body || ""}</textarea>
            <div class="md-preview" id="ed-preview"><div class="prose"></div></div>
          </div>
          <div class="md-foot"><span id="ed-wc"></span><button class="btn btn-ghost btn-sm" type="button" data-help>Formatting help</button></div>
        </div>
      </div>
      <aside class="editor-side" aria-label="Article settings">
        <section class="card side-card">
          <h2>Publishing</h2>
          <p class="small muted" id="ed-status-text"></p>
          ${canPublish ? html`
            <div class="field"><label for="ed-date">Publish date and time</label><input class="input" id="ed-date" type="datetime-local" value="${a.published_at ? toLocalInput(a.published_at) : ""}"><span class="hint">Leave empty to publish now. A future time schedules the story.</span></div>
            <label class="toggle"><input type="checkbox" id="ed-featured" ${a.featured ? raw("checked") : ""}><span class="track"></span>Feature on the front page</label>
            <label class="toggle"><input type="checkbox" id="ed-bigread" ${a.big_read ? raw("checked") : ""}><span class="track"></span>Show as the Big Read</label>` : html`<p class="small muted">When it's ready, press <strong>Submit for review</strong>. An editor will edit and publish it.</p>`}
        </section>
        <section class="card side-card">
          <h2>Placement</h2>
          <div class="field"><label for="ed-section">Section</label><select class="select" id="ed-section">${sectionOptions}</select></div>
          <div class="field"><label for="ed-topic">Topic line</label><input class="input" id="ed-topic" list="ed-topics" value="${a.topic || ""}" placeholder="e.g. M&A and Restructuring"><datalist id="ed-topics">${topicList.map((t) => html`<option value="${t}">`)}</datalist><span class="hint">Small green label above the headline.</span></div>
          <div class="field"><label for="ed-author">Byline</label><select class="select" id="ed-author">${authorOptions}</select></div>
          <div class="field"><label for="ed-tags">Tags</label><input class="input" id="ed-tags" value="${(a.tags || []).join(", ")}" placeholder="Private Equity, Rates"><span class="hint">Separate with commas.</span></div>
        </section>
        <section class="card side-card">
          <h2>Cover image</h2>
          <div class="cover-preview" id="ed-cover-prev"></div>
          <div class="row"><label class="btn btn-sm">${icon("upload")} Upload image<input type="file" accept="image/*" hidden id="ed-cover-file"></label><span class="small muted" id="ed-cover-status"></span></div>
          <div class="field"><label for="ed-cover">Image URL</label><input class="input" id="ed-cover" value="${a.cover_url || ""}" placeholder="https://…"></div>
          <div class="field"><label for="ed-alt">Alt text</label><input class="input" id="ed-alt" value="${a.cover_alt || ""}" placeholder="Describe the image for screen readers"></div>
          <div class="field"><label for="ed-caption">Caption and credit</label><input class="input" id="ed-caption" value="${a.cover_caption || ""}" placeholder="Photo: Name/Agency"></div>
        </section>
        <section class="card side-card">
          <h2>Key figures</h2>
          <div class="field"><label for="ed-figures">One per line: <code class="code">value | label</code></label><textarea class="textarea" id="ed-figures" rows="4" placeholder="$1.5T | Record margin debt&#10;19% | Annual growth in borrowing">${a.figures || ""}</textarea><span class="hint">Shown beside the article. Up to six.</span></div>
        </section>
        <section class="card side-card">
          <h2>Web address</h2>
          <div class="field"><label for="ed-slug">Slug</label><input class="input" id="ed-slug" value="${a.slug || ""}"><span class="slug-preview">/articles/<span id="ed-slug-prev">${a.slug || ""}</span></span></div>
          ${a.id && (canPublish || (a.status === "draft")) ? html`<button class="btn btn-danger btn-sm" type="button" data-delete>${icon("trash")} Delete article</button>` : ""}
        </section>
      </aside>
    </div>`);

  const $id = (x) => $("#" + x, ctx.el);
  const body = $id("ed-body");
  const title = $id("ed-title");
  const dek = $id("ed-dek");
  const preview = $("#ed-preview .prose", ctx.el);

  const autosize = (t) => { t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; };
  [title, dek].forEach((t) => { autosize(t); t.addEventListener("input", () => autosize(t)); });

  function collect() {
    const v = (x) => { const el = $id(x); return el ? el.value.trim() : undefined; };
    const data = {
      title: title.value.trim(), dek: dek.value.trim() || null, body: body.value,
      section: v("ed-section"), topic: v("ed-topic") || null, author_id: v("ed-author") || null,
      tags: v("ed-tags").split(",").map((t) => t.trim()).filter(Boolean),
      cover_url: v("ed-cover") || null, cover_alt: v("ed-alt") || null, cover_caption: v("ed-caption") || null,
      figures: v("ed-figures") || null, slug: slugify(v("ed-slug")) || slugify(title.value) || "",
    };
    if (canPublish) {
      data.featured = $id("ed-featured").checked;
      data.big_read = $id("ed-bigread").checked;
      data.published_at = fromLocalInput($id("ed-date").value) || a.published_at || null;
    }
    return data;
  }

  function drawCover() {
    const url = safeUrl($id("ed-cover").value.trim());
    mount($id("ed-cover-prev"), url
      ? html`<img src="${url}" alt="">`
      : html`<div style="width:100%;height:100%;position:relative">${coverArt(slugify(title.value) || "new", $id("ed-section").value)}<span style="position:absolute;inset:auto 8px 8px auto;background:var(--paper);padding:3px 8px;border-radius:6px;font-size:11px">Generated cover</span></div>`);
  }
  function drawPreview() {
    if (mode === "write") return;
    preview.innerHTML = renderMarkdown(body.value || "*Nothing written yet.*");
    enhance(preview).then(() => {
      $$("figure.fj-chart", preview).forEach((f, i) => {
        const row = document.createElement("div");
        row.className = "cb-edit-row";
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn btn-sm";
        b.dataset.chartEdit = String(i);
        b.textContent = "Edit chart";
        row.append(b);
        f.before(row);
      });
    });
  }
  async function editChart(block) {
    const { openChartBuilder } = await import("./chart-builder.js");
    openChartBuilder({
      source: block ? block.source : "",
      onSave: (text) => {
        if (block) {
          body.setRangeText(text, block.start, block.end, "end");
          body.focus();
          body.dispatchEvent(new Event("input"));
        } else insertBlock(text);
        toast(block ? "Chart updated" : "Chart added");
      },
    });
  }
  function drawCounts() {
    const n = wordCount(body.value);
    $id("ed-wc").textContent = `${n.toLocaleString()} word${n === 1 ? "" : "s"}, ${readMinutes(body.value)} min read`;
  }
  function drawMode() {
    const panes = $id("ed-panes");
    panes.classList.toggle("split", mode === "split");
    body.hidden = mode === "preview";
    $id("ed-preview").hidden = mode === "write";
    $$("[data-mode]", ctx.el).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
    drawPreview();
  }
  function drawState() {
    const st = articleState(a);
    mount($id("ed-pill"), a.id ? html`<span class="pill pill-${st}">${STATE_LABEL[st]}</span>` : html`<span class="pill">New</span>`);
    const statusText = !a.id ? "Not saved yet."
      : st === "published" ? `Live since ${fmtDateTime(a.published_at)}.`
      : st === "scheduled" ? `Goes live ${fmtDateTime(a.published_at)}.`
      : st === "review" ? "Waiting for an editor."
      : `Draft, last saved ${timeAgo(a.updated_at)}.`;
    $id("ed-status-text").textContent = statusText;
    const view = $id("ed-view");
    if (a.id) { view.hidden = false; view.href = `/articles/${encodeURIComponent(a.slug)}${st === "published" ? "" : `?preview=${a.id}`}`; }
    else view.hidden = true;
    const btn = (act, label, accent) => html`<button class="btn ${accent ? "btn-accent" : ""}" type="button" data-act="${act}">${label}</button>`;
    let actions;
    if (!canPublish) {
      actions = st === "review" ? html`${btn("draft", "Move back to draft")}${btn("review", "Save changes", true)}` : html`${btn("draft", "Save draft")}${btn("review", "Submit for review", true)}`;
    } else if (st === "published" || st === "scheduled") {
      actions = html`${btn("unpublish", "Unpublish")}${btn("update", st === "scheduled" ? "Save schedule" : "Update", true)}`;
    } else {
      actions = html`${btn("draft", "Save draft")}${btn("schedule", "Schedule")}${btn("publish", "Publish", true)}`;
    }
    mount($id("ed-actions"), actions);
  }
  function markDirty() {
    dirty = true;
    $id("ed-saved").textContent = "Unsaved changes";
    backup();
  }
  const backup = debounce(() => {
    try { localStorage.setItem(backupKey, JSON.stringify({ at: Date.now(), data: collect() })); } catch (_) { /* full */ }
  }, 700);
  const clearBackup = () => { try { localStorage.removeItem(backupKey); localStorage.removeItem("fj-backup-new"); } catch (_) { /* ignore */ } };

  // Offer to restore an unsaved local copy
  try {
    const saved = JSON.parse(localStorage.getItem(backupKey) || "null");
    const serverTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
    if (saved && saved.at > serverTime && (saved.data.body !== a.body || saved.data.title !== a.title)) {
      mount($id("ed-restore"), html`<div class="restore-bar"><span>You have unsaved changes from ${timeAgo(saved.at)} in this browser.</span><span class="spacer"></span><button class="btn btn-sm" type="button" data-restore>Restore them</button><button class="btn btn-ghost btn-sm" type="button" data-discard>Discard</button></div>`);
      $id("ed-restore").addEventListener("click", (e) => {
        if (e.target.closest("[data-restore]")) {
          const d = saved.data;
          title.value = d.title || ""; dek.value = d.dek || ""; body.value = d.body || "";
          const set = (x, val) => { const el = $id(x); if (el && val !== undefined && val !== null) el.value = Array.isArray(val) ? val.join(", ") : val; };
          set("ed-section", d.section); set("ed-topic", d.topic); set("ed-author", d.author_id); set("ed-tags", d.tags);
          set("ed-cover", d.cover_url); set("ed-alt", d.cover_alt); set("ed-caption", d.cover_caption); set("ed-figures", d.figures); set("ed-slug", d.slug);
          [title, dek].forEach(autosize); drawCover(); drawPreview(); drawCounts(); markDirty();
          mount($id("ed-restore"), "");
        }
        if (e.target.closest("[data-discard]")) { clearBackup(); mount($id("ed-restore"), ""); }
      });
    }
  } catch (_) { /* ignore */ }

  // ---- Markdown helpers
  function surround(before, after = before, placeholder = "text") {
    const { selectionStart: s, selectionEnd: e, value } = body;
    const sel = value.slice(s, e) || placeholder;
    body.setRangeText(before + sel + after, s, e, "end");
    body.selectionStart = s + before.length;
    body.selectionEnd = s + before.length + sel.length;
    body.focus();
    body.dispatchEvent(new Event("input"));
  }
  function prefixLines(prefix) {
    const { selectionStart: s, selectionEnd: e, value } = body;
    const start = value.lastIndexOf("\n", s - 1) + 1;
    const end = value.indexOf("\n", e) === -1 ? value.length : value.indexOf("\n", e);
    const lines = value.slice(start, end).split("\n").map((l, i) => (typeof prefix === "function" ? prefix(i) : prefix) + l.replace(/^(#{1,6} |> |- |\d+\. )/, ""));
    body.setRangeText(lines.join("\n"), start, end, "end");
    body.focus();
    body.dispatchEvent(new Event("input"));
  }
  function insertBlock(text) {
    const { selectionStart: s, value } = body;
    const pre = s > 0 && value[s - 1] !== "\n" ? "\n\n" : s > 1 && value[s - 2] !== "\n" ? "\n" : "";
    body.setRangeText(pre + text + "\n\n", s, body.selectionEnd, "end");
    body.focus();
    body.dispatchEvent(new Event("input"));
  }
  async function insertImageFile(file) {
    if (!file || !file.type.startsWith("image/")) return;
    toast("Uploading image…");
    try {
      const url = await db.uploadMedia(file);
      insertBlock(`![${file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ")}](${url} "Caption. Source: …")`);
      toast("Image inserted. Edit the caption in quotes.");
    } catch (ex) { toast(friendlyError(ex), { error: true }); }
  }
  async function mdAction(act) {
    switch (act) {
      case "h2": return prefixLines("## ");
      case "bold": return surround("**");
      case "italic": return surround("*");
      case "link": {
        const url = await promptDialog("Link address", { title: "Add a link", placeholder: "https://", confirm: "Add link" });
        if (url) surround("[", `](${url})`, "link text");
        return;
      }
      case "quote": return prefixLines("> ");
      case "ul": return prefixLines("- ");
      case "ol": return prefixLines((i) => `${i + 1}. `);
      case "table": return insertBlock("| Company | Deal value | Multiple |\n|---|---|---|\n| Example Co. | $2.0bn | 12.5x |\n| Sample Corp. | $850m | 9.8x |");
      case "hr": return insertBlock("---");
      case "chart": {
        const { findChartBlock } = await import("./chart-builder.js");
        return editChart(findChartBlock(body.value, body.selectionStart));
      }
      case "footnote": {
        const n = (body.value.match(/\[\^(\d+)\]:/g) || []).length + 1;
        const { selectionEnd: e } = body;
        body.setRangeText(`[^${n}]`, e, e, "end");
        body.value = body.value.replace(/\s*$/, "") + `\n\n[^${n}]: Source or note.`;
        body.focus();
        body.dispatchEvent(new Event("input"));
        return;
      }
      case "image": {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.onchange = () => insertImageFile(input.files[0]);
        input.click();
      }
    }
  }

  // ---- Save
  async function save(action) {
    const data = collect();
    if (!data.title) { toast("Add a headline first.", { error: true }); title.focus(); return; }
    if (["publish", "schedule", "review", "update"].includes(action) && !data.body.trim()) { toast("The article body is empty.", { error: true }); body.focus(); return; }
    const now = Date.now();
    if (action === "draft") data.status = "draft";
    if (action === "review") data.status = "review";
    if (action === "unpublish") data.status = "draft";
    if (action === "update") data.status = a.status;
    if (action === "publish") {
      data.status = "published";
      if (!data.published_at || new Date(data.published_at).getTime() > now) data.published_at = new Date().toISOString();
    }
    if (action === "schedule") {
      const when = fromLocalInput($id("ed-date").value);
      if (!when || new Date(when).getTime() <= now) { toast("Pick a future date and time under Publishing first.", { error: true }); $id("ed-date").focus(); return; }
      data.status = "published";
      data.published_at = when;
    }
    if (action === "update" && a.status === "published" && slugTouched && loaded && loaded.slug && data.slug !== loaded.slug) {
      if (!(await confirmDialog("Changing the address of a published story breaks links people have shared. Change it anyway?", { title: "Change the web address?", confirm: "Change it" }))) return;
    }
    $$("#ed-actions button", ctx.el).forEach((b) => (b.disabled = true));
    try {
      const saved = await db.saveArticle({ id: a.id, ...data });
      const wasNew = !a.id;
      a = saved;
      dirty = false;
      clearBackup();
      $id("ed-slug").value = a.slug;
      $id("ed-slug-prev").textContent = a.slug;
      $id("ed-saved").textContent = "All changes saved";
      if ($id("ed-date")) $id("ed-date").value = a.published_at ? toLocalInput(a.published_at) : "";
      const msg = { draft: "Draft saved", review: "Submitted for review", publish: "Published", schedule: `Scheduled for ${fmtDateTime(a.published_at)}`, unpublish: "Unpublished", update: "Updated" }[action];
      toast(msg);
      drawState();
      ctx.refreshCounts();
      if (wasNew) ctx.navigate(`#/articles/${a.id}`, { replace: true });
    } catch (ex) {
      toast(friendlyError(ex), { error: true });
    } finally {
      $$("#ed-actions button", ctx.el).forEach((b) => (b.disabled = false));
    }
  }

  // ---- Events
  const onInput = debounce(() => { drawPreview(); drawCounts(); }, 180);
  ctx.el.addEventListener("input", (e) => {
    if (e.target === body) onInput();
    if (e.target === title && !slugTouched) { $id("ed-slug").value = slugify(title.value); $id("ed-slug-prev").textContent = $id("ed-slug").value; }
    if (e.target.id === "ed-slug") { slugTouched = true; $id("ed-slug-prev").textContent = slugify(e.target.value); }
    if (e.target.id === "ed-cover") drawCover();
    if (e.target.closest(".editor")) markDirty();
  });
  ctx.el.addEventListener("change", (e) => {
    if (e.target.id === "ed-section") drawCover();
    if (e.target.closest(".editor-side")) markDirty();
  });
  ctx.el.addEventListener("click", async (e) => {
    const m = e.target.closest("[data-md]");
    if (m) mdAction(m.dataset.md);
    const ce = e.target.closest("[data-chart-edit]");
    if (ce) {
      const { nthChartBlock } = await import("./chart-builder.js");
      editChart(nthChartBlock(body.value, Number(ce.dataset.chartEdit)));
      return;
    }
    const md = e.target.closest("[data-mode]");
    if (md) { mode = md.dataset.mode; drawMode(); }
    const act = e.target.closest("[data-act]");
    if (act) save(act.dataset.act);
    if (e.target.closest("[data-help]")) showHelp();
    if (e.target.closest("[data-delete]")) {
      if (!(await confirmDialog(`Delete “${a.title || "Untitled"}”? This can't be undone.`, { title: "Delete article", confirm: "Delete", danger: true }))) return;
      try { await db.deleteArticle(a.id); dirty = false; clearBackup(); toast("Article deleted"); ctx.refreshCounts(); location.hash = "#/articles"; }
      catch (ex) { toast(friendlyError(ex), { error: true }); }
    }
  });
  $id("ed-cover-file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    $id("ed-cover-status").textContent = "Uploading…";
    try { const url = await db.uploadMedia(f); $id("ed-cover").value = url; drawCover(); markDirty(); $id("ed-cover-status").textContent = "Uploaded"; }
    catch (ex) { $id("ed-cover-status").textContent = ""; toast(friendlyError(ex), { error: true }); }
  });
  body.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "b") { e.preventDefault(); surround("**"); }
    if (mod && e.key.toLowerCase() === "i") { e.preventDefault(); surround("*"); }
    if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); mdAction("link"); }
  });
  body.addEventListener("paste", (e) => {
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
    if (file) { e.preventDefault(); insertImageFile(file); }
  });
  body.addEventListener("dragover", (e) => { if ([...e.dataTransfer.items].some((i) => i.kind === "file")) { e.preventDefault(); body.classList.add("drop-hint"); } });
  body.addEventListener("dragleave", () => body.classList.remove("drop-hint"));
  body.addEventListener("drop", (e) => {
    body.classList.remove("drop-hint");
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
    if (file) { e.preventDefault(); insertImageFile(file); }
  });
  const onKey = (e) => {
    if (!document.body.contains(body)) { document.removeEventListener("keydown", onKey); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(a.status === "published" ? "update" : canPublish ? "draft" : a.status === "review" ? "review" : "draft"); }
  };
  document.addEventListener("keydown", onKey);
  ctx.setLeaveGuard((fromUnload) => {
    if (!dirty) return true;
    if (fromUnload) return false;
    return window.confirm("Leave without saving? A copy of your changes stays in this browser.");
  });

  function showHelp() {
    openPanel({
      title: "Formatting help",
      body: html`<div class="prose no-dropcap" style="font-size:1rem">
        <p>Articles are written in Markdown. The preview shows exactly what readers will see.</p>
        <table><thead><tr><th>To get</th><th>Type</th></tr></thead><tbody>
          <tr><td>Section heading</td><td><code>## Heading</code></td></tr>
          <tr><td>Smaller heading</td><td><code>### Heading</code></td></tr>
          <tr><td>Bold, italic</td><td><code>**bold**</code>, <code>*italic*</code></td></tr>
          <tr><td>Link</td><td><code>[text](https://…)</code></td></tr>
          <tr><td>Pull quote</td><td><code>&gt; The quote</code></td></tr>
          <tr><td>Image with caption</td><td><code>![alt text](url "Caption. Source: X")</code></td></tr>
          <tr><td>Footnote</td><td><code>claim[^1]</code> then <code>[^1]: Source</code></td></tr>
          <tr><td>Divider</td><td><code>---</code></td></tr>
        </tbody></table>
        <h3>Tables</h3>
        <p>Use the table button. Numbers in tables are right-aligned automatically.</p>
        <h3>Interactive charts</h3>
        <p>Press the chart button in the toolbar, pick a type, and paste your data from Google Sheets, Excel or a CSV. Readers can hover for values, switch series on and off, view the data as a table and download it. To change a chart later, put the cursor inside it and press the chart button again, or press <strong>Edit chart</strong> in the preview.</p>
        <p>Charts are stored in the article as a <code>&#96;&#96;&#96;chart</code> block: settings such as <code>type: line</code>, <code>title:</code>, <code>source:</code>, then <code>---</code> and the data as CSV.</p>
        <h3>Embeds and video</h3>
        <p>Paste an embed code (an <code>&lt;iframe&gt;</code>) on its own line, for maps and other visuals. Allowed sources: ${EMBED_HOSTS.join(", ")}.</p>
        <h3>Key figures</h3>
        <p>In the sidebar, one per line: <code>$1.5T | Record margin debt</code>.</p>
        <h3>Shortcuts</h3>
        <p><code>Ctrl/⌘ + S</code> save, <code>Ctrl/⌘ + B</code> bold, <code>Ctrl/⌘ + I</code> italic, <code>Ctrl/⌘ + K</code> link. Paste or drop an image into the text to upload it.</p>
      </div>`.value,
    });
  }

  drawCover(); drawCounts(); drawMode(); drawState();
  $id("ed-saved").textContent = a.id ? "All changes saved" : "";
  if (isNew) title.focus();
}
