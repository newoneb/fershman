// Member-portal pieces shared by the portal and the admin panel:
// file-type icons, the upload panel and the item viewer.
import { db, LIVE, config } from "../data/db.js";
import { html, raw, icon, fmtDate, fmtBytes, esc, safeUrl, $, $$ } from "../lib/util.js";
import { openPanel, toast, confirmDialog } from "../lib/ui.js";
import { itemKind, friendlyError } from "../data/shared.js";

const KIND = {
  pdf: { label: "PDF", icon: "file" }, slides: { label: "Slides", icon: "slides" }, doc: { label: "Document", icon: "doc" },
  sheet: { label: "Spreadsheet", icon: "table" }, video: { label: "Video", icon: "video" }, audio: { label: "Audio", icon: "video" },
  image: { label: "Image", icon: "image" }, gslides: { label: "Google Slides", icon: "slides" }, link: { label: "Link", icon: "link" },
  file: { label: "File", icon: "file" },
};
export const kindLabel = (k) => (KIND[k] || KIND.file).label;
export const kindIcon = (k) => html`<span class="kind-icon kind-${k}" aria-hidden="true">${icon((KIND[k] || KIND.file).icon)}</span>`;

export function embedUrl(url) {
  const u = String(url || "");
  let m = u.match(/docs\.google\.com\/presentation\/d\/([^/]+)/);
  if (m) return `https://docs.google.com/presentation/d/${m[1]}/embed?start=false&loop=false`;
  m = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/);
  if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  m = u.match(/vimeo\.com\/(\d+)/);
  if (m) return `https://player.vimeo.com/video/${m[1]}`;
  return "";
}

const titleFromFile = (name) => String(name).replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

/** Upload files or add a link. Resolves when the panel closes. */
export function openUploadPanel({ collections = [], defaultCollection = "", onDone } = {}) {
  const maxMB = (config.portal && config.portal.maxUploadMB) || 50;
  let mode = "files";
  let files = [];
  const today = new Date().toISOString().slice(0, 10);
  const panel = openPanel({
    title: "Add to the members portal",
    body: html`
      <div class="seg" role="tablist" aria-label="What to add">
        <button type="button" data-mode="files" aria-pressed="true">Upload files</button>
        <button type="button" data-mode="link" aria-pressed="false">Add a link</button>
      </div>
      <div data-pane="files" class="stack">
        <label class="dropzone" tabindex="0">
          ${icon("upload")}
          <span><strong>Drop files here</strong> or click to choose</span>
          <span class="small">PDF, PowerPoint, Keynote, Excel, Word, video or images, up to ${maxMB} MB each</span>
          <input type="file" multiple hidden>
        </label>
        <ul class="file-list"></ul>
      </div>
      <div data-pane="link" class="stack" hidden>
        <div class="field"><label for="pl-url">Link</label><input class="input" id="pl-url" type="url" placeholder="https://docs.google.com/presentation/…"><span class="hint">Google Slides and YouTube links preview inside the portal.</span></div>
        <div class="field"><label for="pl-title">Title</label><input class="input" id="pl-title"></div>
      </div>
      <div class="field"><label for="pu-col">Collection</label><input class="input" id="pu-col" list="pu-cols" value="${defaultCollection}" placeholder="e.g. Fall 2026 pitch night"><datalist id="pu-cols">${collections.map((c) => html`<option value="${c}">`)}</datalist><span class="hint">Items are grouped by collection in the library.</span></div>
      <div class="field-row">
        <div class="field"><label for="pu-date">Meeting or event date</label><input class="input" id="pu-date" type="date" value="${today}"></div>
        <div class="field"></div>
      </div>
      <div class="field"><label for="pu-desc">Description <span class="hint">(optional)</span></label><textarea class="textarea" id="pu-desc" rows="3" style="min-height:80px"></textarea></div>
      <p class="form-error" role="alert"></p>`.value,
    foot: html`<button class="btn" type="button" data-close>Cancel</button><button class="btn btn-accent" type="button" data-submit>Upload</button>`.value,
    onClose: () => onDone && onDone(),
  });
  const root = panel.el;
  const err = $(".form-error", root);
  const input = $('input[type="file"]', root);
  const list = $(".file-list", root);
  const submit = $("[data-submit]", root);
  const dz = $(".dropzone", root);

  const drawFiles = () => {
    list.innerHTML = files.map((f, i) => html`
      <li data-i="${i}">
        ${kindIcon(itemKind({ kind: "file", file_name: f.file.name, mime_type: f.file.type }))}
        <div style="min-width:0">
          <input class="input" data-title="${i}" value="${f.title}" aria-label="Title for ${f.file.name}" style="min-height:34px;padding:6px 8px;font-weight:600">
          <div class="fmeta">${f.file.name} — ${fmtBytes(f.file.size)}</div>
        </div>
        <span data-status="${i}">${f.status === "done" ? html`<span class="status-ok">Uploaded</span>` : f.status === "error" ? html`<span class="status-err">${f.error}</span>` : f.status === "uploading" ? html`<span class="small muted">Uploading…</span>` : html`<button class="icon-btn" type="button" data-remove="${i}" aria-label="Remove ${f.file.name}">${icon("close")}</button>`}</span>
      </li>`.value).join("");
    submit.textContent = mode === "files" ? (files.length > 1 ? `Upload ${files.length} files` : "Upload") : "Add link";
  };
  const addFiles = (fileList) => {
    err.textContent = "";
    for (const file of fileList) {
      if (file.size > maxMB * 1024 * 1024) { err.textContent = `${file.name} is over ${maxMB} MB. Export a smaller PDF, or add it as a link instead.`; continue; }
      files.push({ file, title: titleFromFile(file.name), status: "ready" });
    }
    drawFiles();
  };
  input.addEventListener("change", () => { addFiles(input.files); input.value = ""; });
  dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  ["dragenter", "dragover"].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add("is-over"); }));
  ["dragleave", "drop"].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.remove("is-over"); }));
  dz.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));
  list.addEventListener("input", (e) => { const i = e.target.dataset.title; if (i !== undefined) files[i].title = e.target.value; });
  list.addEventListener("click", (e) => { const b = e.target.closest("[data-remove]"); if (b) { files.splice(Number(b.dataset.remove), 1); drawFiles(); } });
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-mode]");
    if (!b) return;
    mode = b.dataset.mode;
    $$("[data-mode]", root).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    $('[data-pane="files"]', root).hidden = mode !== "files";
    $('[data-pane="link"]', root).hidden = mode !== "link";
    drawFiles();
  });

  submit.addEventListener("click", async () => {
    err.textContent = "";
    const meta = {
      collection: $("#pu-col", root).value.trim() || "General",
      event_date: $("#pu-date", root).value || null,
      description: $("#pu-desc", root).value.trim() || null,
    };
    if (mode === "link") {
      const url = $("#pl-url", root).value.trim();
      const title = $("#pl-title", root).value.trim();
      if (!safeUrl(url) || !/^https?:/i.test(url)) { err.textContent = "Enter a full link starting with https://"; return; }
      if (!title) { err.textContent = "Give the link a title."; return; }
      submit.disabled = true;
      try {
        await db.createPortalItem({ ...meta, title, url });
        toast("Link added");
        panel.close();
      } catch (ex) { err.textContent = friendlyError(ex); submit.disabled = false; }
      return;
    }
    const pending = files.filter((f) => f.status !== "done");
    if (!pending.length) { err.textContent = "Choose at least one file."; return; }
    submit.disabled = true;
    let ok = 0;
    for (const f of pending) {
      f.status = "uploading"; drawFiles();
      try {
        await db.createPortalItem({ ...meta, title: f.title.trim() || titleFromFile(f.file.name) }, f.file);
        f.status = "done"; ok++;
      } catch (ex) {
        f.status = "error"; f.error = friendlyError(ex);
      }
      drawFiles();
    }
    submit.disabled = false;
    if (files.every((f) => f.status === "done")) { toast(ok === 1 ? "File uploaded" : `${ok} files uploaded`); panel.close(); }
    else err.textContent = "Some files didn't upload. Fix the issue and press Upload again to retry them.";
  });
  drawFiles();
  return panel;
}

/** Open an item: preview, download, and (for editors) edit or delete. */
export async function openViewer(item, { canEdit = false, collections = [], onChanged } = {}) {
  const kind = itemKind(item);
  const panel = openPanel({ title: item.title, wide: true, body: `<div class="viewer"><div class="skeleton viewer-frame"></div></div>` });
  const root = panel.el;
  let url = "";
  try { url = await db.portalFileUrl(item); } catch (ex) {
    panel.body.innerHTML = html`<div class="viewer-empty">${kindIcon(kind)}<p>${friendlyError(ex)}</p></div>`.value;
    return panel;
  }
  const safe = safeUrl(url);
  const officeUrl = LIVE && /^https:/.test(safe) ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(safe)}` : "";
  let preview;
  if (kind === "pdf") preview = html`<iframe class="viewer-frame" src="${safe}#view=FitH" title="${item.title}"></iframe>`;
  else if (kind === "image") preview = html`<img src="${safe}" alt="${item.title}">`;
  else if (kind === "video" && item.kind === "file") preview = html`<video src="${safe}" controls preload="metadata"></video>`;
  else if (kind === "audio") preview = html`<audio src="${safe}" controls style="width:100%"></audio>`;
  else if ((kind === "gslides" || kind === "video") && embedUrl(item.url)) preview = html`<iframe class="viewer-frame" src="${embedUrl(item.url)}" title="${item.title}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
  else if (["slides", "doc", "sheet"].includes(kind)) {
    preview = html`<div class="viewer-empty" data-office>${kindIcon(kind)}<p><strong>${kindLabel(kind)}</strong><br>Download to open it in PowerPoint, Keynote or Excel${officeUrl ? ", or preview it here with Microsoft's free viewer" : ""}.</p>
      ${officeUrl ? html`<button class="btn" type="button" data-office-load>Preview here</button><span class="small">The preview sends a temporary link to Microsoft's viewer.</span>` : ""}</div>`;
  } else if (item.kind === "link") preview = html`<div class="viewer-empty">${kindIcon(kind)}<p>${item.url}</p><a class="btn btn-accent" href="${safe}" target="_blank" rel="noopener">Open link</a></div>`;
  else preview = html`<div class="viewer-empty">${kindIcon(kind)}<p>No preview for this file type. Download it to open.</p></div>`;

  panel.body.innerHTML = html`
    <div class="viewer">${preview}</div>
    <dl class="kv">
      <dt>Collection</dt><dd>${item.collection || "General"}</dd>
      ${item.event_date ? html`<dt>Date</dt><dd>${fmtDate(item.event_date + "T12:00:00")}</dd>` : ""}
      <dt>Type</dt><dd>${kindLabel(kind)}${item.file_size ? html` — ${fmtBytes(item.file_size)}` : ""}</dd>
      ${item.file_name ? html`<dt>File</dt><dd>${item.file_name}</dd>` : ""}
      <dt>Added</dt><dd>${fmtDate(item.created_at)}</dd>
    </dl>
    ${item.description ? html`<p style="font-size:var(--fs-ui);line-height:1.6">${item.description}</p>` : ""}`.value;

  const foot = document.createElement("div");
  foot.className = "panel-foot";
  foot.innerHTML = html`
    ${canEdit ? html`<button class="btn btn-danger" type="button" data-del>${icon("trash")} Delete</button><button class="btn" type="button" data-edit>${icon("edit")} Edit</button><span class="spacer"></span>` : ""}
    ${item.kind === "file" ? html`<button class="btn" type="button" data-open>${icon("external")} Open in new tab</button><button class="btn btn-accent" type="button" data-dl>${icon("download")} Download</button>`
      : html`<a class="btn btn-accent" href="${safe}" target="_blank" rel="noopener">${icon("external")} Open link</a>`}`.value;
  root.append(foot);

  root.addEventListener("click", async (e) => {
    if (e.target.closest("[data-office-load]")) {
      $("[data-office]", root).outerHTML = html`<iframe class="viewer-frame" src="${officeUrl}" title="${item.title}"></iframe>`.value;
    }
    if (e.target.closest("[data-open]")) window.open(safe, "_blank", "noopener");
    if (e.target.closest("[data-dl]")) {
      try {
        const dl = LIVE ? await db.portalFileUrl(item, { download: true }) : safe;
        const a = document.createElement("a");
        a.href = dl;
        a.download = item.file_name || "download";
        document.body.append(a);
        a.click();
        a.remove();
      } catch (ex) { toast(friendlyError(ex), { error: true }); }
    }
    if (e.target.closest("[data-del]")) {
      if (!(await confirmDialog(`Delete “${item.title}” for everyone? This can't be undone.`, { title: "Delete item", confirm: "Delete", danger: true }))) return;
      try { await db.deletePortalItem(item); toast("Deleted"); panel.close(); onChanged && onChanged(); }
      catch (ex) { toast(friendlyError(ex), { error: true }); }
    }
    if (e.target.closest("[data-edit]")) {
      panel.body.innerHTML = html`
        <div class="field"><label for="pe-title">Title</label><input class="input" id="pe-title" value="${item.title}"></div>
        ${item.kind === "link" ? html`<div class="field"><label for="pe-url">Link</label><input class="input" id="pe-url" value="${item.url}"></div>` : ""}
        <div class="field"><label for="pe-col">Collection</label><input class="input" id="pe-col" list="pe-cols" value="${item.collection || ""}"><datalist id="pe-cols">${collections.map((c) => html`<option value="${c}">`)}</datalist></div>
        <div class="field"><label for="pe-date">Date</label><input class="input" id="pe-date" type="date" value="${item.event_date || ""}"></div>
        <div class="field"><label for="pe-desc">Description</label><textarea class="textarea" id="pe-desc" rows="4">${item.description || ""}</textarea></div>
        <p class="form-error" role="alert"></p>`.value;
      foot.innerHTML = html`<button class="btn" type="button" data-close>Cancel</button><button class="btn btn-accent" type="button" data-save>Save changes</button>`.value;
    }
    if (e.target.closest("[data-save]")) {
      const patch = {
        title: $("#pe-title", root).value.trim() || item.title,
        collection: $("#pe-col", root).value.trim() || "General",
        event_date: $("#pe-date", root).value || null,
        description: $("#pe-desc", root).value.trim() || null,
      };
      if (item.kind === "link") patch.url = $("#pe-url", root).value.trim();
      try { await db.updatePortalItem(item.id, patch); toast("Saved"); panel.close(); onChanged && onChanged(); }
      catch (ex) { $(".form-error", root).textContent = friendlyError(ex); }
    }
  });
  return panel;
}

export { esc, raw };
