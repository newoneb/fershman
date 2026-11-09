// Import: Framer CMS CSV (articles and authors) and starter content.
import { db, LIVE, config } from "../data/db.js";
import { html, raw, mount, icon, slugify, safeUrl, truncate, fmtDate, $, $$ } from "../lib/util.js";
import { toast } from "../lib/ui.js";
import { sanitizeHTML } from "../lib/md.js";
import { friendlyError } from "../data/shared.js";

// ---------- helpers ----------
function loadScript(src, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve(window[globalName]);
    s.onerror = () => reject(new Error(`Couldn't load ${src}`));
    document.head.append(s);
  });
}
let turndown = null;
async function htmlToMarkdown(input, { lesson = false } = {}) {
  if (!turndown) {
    const { default: TurndownService } = await import("/assets/vendor/turndown.es.js");
    turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced", emDelimiter: "*", strongDelimiter: "**", hr: "---" });
    turndown.keep(["iframe", "table"]); // tables stay as HTML, which the article page styles
    turndown.addRule("figure", {
      filter: "figure",
      replacement: (content, node) => {
        const img = node.querySelector("img");
        if (!img) return content;
        const cap = node.querySelector("figcaption");
        const alt = (img.getAttribute("alt") || "").replace(/[[\]]/g, "");
        const title = cap ? ` "${cap.textContent.trim().replace(/"/g, "'")}"` : "";
        return `\n\n![${alt}](${img.getAttribute("src")}${title})\n\n`;
      },
    });
  }
  // Framer lessons use h4 for sections and h5 for sub-sections; on Fershman those are h2 and h3.
  if (lesson) input = String(input).replace(/<(\/?)h[34](\s|>)/gi, "<$1h2$2").replace(/<(\/?)h5(\s|>)/gi, "<$1h3$2");
  return turndown.turndown(sanitizeHTML(input)).replace(/\n{3,}/g, "\n\n").trim();
}
const looksHTML = (s) => /<\/?(p|h[1-6]|ul|ol|li|strong|em|b|i|a|img|blockquote|figure|br|div|span)[\s>/]/i.test(s);
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const truthy = (v) => /^(true|yes|y|1|on|x)$/i.test(String(v || "").trim());
const splitList = (v) => String(v || "").split(/[,;|]/).map((t) => t.trim()).filter(Boolean);
function parseDate(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00Z` : s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function cleanSlug(v) {
  let s = String(v || "").trim();
  if (!s) return "";
  s = s.split("?")[0].replace(/\/+$/, "");
  if (s.includes("/")) s = s.slice(s.lastIndexOf("/") + 1);
  try { s = decodeURIComponent(s); } catch (_) { /* keep */ }
  return s.toLowerCase().replace(/\s+/g, "-");
}
const firstUrl = (v) => (String(v || "").match(/https?:\/\/[^\s,"')]+/) || [""])[0];
const plain = (v) => { const d = document.createElement("div"); d.innerHTML = sanitizeHTML(v); return d.textContent.replace(/\s+/g, " ").trim(); };

function guessMapping(headers, targets) {
  const map = {};
  const used = new Set();
  const nh = headers.map((h) => ({ h, n: norm(h) }));
  for (const t of targets) { // exact pass
    const hit = nh.find(({ h, n }) => !used.has(h) && t.guess.includes(n));
    if (hit) { map[t.key] = hit.h; used.add(hit.h); }
  }
  for (const t of targets) { // partial pass
    if (map[t.key]) continue;
    const hit = nh.find(({ h, n }) => !used.has(h) && t.guess.some((g) => n.includes(g)) && !(t.key === "cover_url" && /alt/.test(n)));
    if (hit) { map[t.key] = hit.h; used.add(hit.h); }
  }
  return map;
}
function matchSection(value) {
  const v = slugify(String(value || "").split(",")[0]);
  if (!v) return "";
  const all = [...config.sections, { slug: "learn", name: config.learn.name }];
  const hit = all.find((s) => s.slug === v || slugify(s.name) === v || slugify(s.name).replace(/-and-/g, "-") === v);
  if (hit) return hit.slug;
  if (config.learn.topics.some((t) => slugify(t) === v) || v.includes("economics")) return "learn";
  return "";
}

const ARTICLE_TARGETS = [
  { key: "title", label: "Headline", required: true, guess: ["title", "name", "headline"] },
  { key: "slug", label: "Slug (web address)", guess: ["slug", "url", "path", "handle"] },
  { key: "dek", label: "Standfirst or summary", guess: ["summary", "description", "excerpt", "exerpt", "subtitle", "dek", "standfirst", "lead", "intro", "subheading", "short description"] },
  { key: "body", label: "Article text", required: true, guess: ["content", "body", "text", "article", "post", "rich text", "html", "article body"] },
  { key: "published_at", label: "Publish date", guess: ["date", "published", "publish date", "published date", "published at", "publication date", "created"] },
  { key: "section", label: "Section or category", guess: ["category", "categories", "section"] },
  { key: "topic", label: "Topic line", guess: ["topic", "kicker", "label", "subcategory", "sub category", "eyebrow", "tag"] },
  { key: "tags", label: "Tags", guess: ["tags", "keywords", "topics", "related topics"] },
  { key: "author", label: "Author", guess: ["author", "authors", "writer", "byline", "written by"] },
  { key: "cover_url", label: "Cover image", guess: ["image", "cover", "thumbnail", "featured image", "hero", "cover image", "main image", "banner"] },
  { key: "cover_alt", label: "Cover alt text", guess: ["image alt", "alt", "alt text"] },
  { key: "featured", label: "Featured (yes/no)", guess: ["featured", "feature", "pinned"] },
  { key: "draft", label: "Draft flag (yes/no)", guess: ["draft", "is draft", "hidden", "archived"] },
];
// Learn Economics lessons: always in the Learn section, filed under a topic from their category.
const LEARN_TARGETS = ARTICLE_TARGETS.filter((t) => !["topic", "featured"].includes(t.key)).map((t) => (t.key === "section"
  ? { ...t, label: "Category (Microeconomics or Macroeconomics)", guess: ["learn economics category", "category", "categories", "topic"] } : t));
const AUTHOR_TARGETS = [
  { key: "name", label: "Name", required: true, guess: ["name", "full name", "title", "author"] },
  { key: "slug", label: "Slug", guess: ["slug", "url", "handle"] },
  { key: "role_title", label: "Role or title", guess: ["role", "position", "job title", "title role", "subtitle"] },
  { key: "bio", label: "Bio", guess: ["bio", "about", "description", "biography"] },
  { key: "avatar_url", label: "Photo", guess: ["image", "photo", "avatar", "picture", "headshot", "profile image"] },
  { key: "linkedin_url", label: "LinkedIn", guess: ["linkedin", "linked in"] },
  { key: "x_url", label: "X / Twitter", guess: ["twitter", "x", "x url"] },
];

// ---------- view ----------
export async function importView(ctx) {
  mount(ctx.el, html`<div class="view">
    <div class="view-head"><div><h1>Import</h1><p>Bring your archive over from Framer. Articles keep their web addresses, so old links keep working.</p></div></div>
    <div class="stack">
      <section class="card card-pad stack" id="imp-articles" aria-labelledby="ia-h">
        <div><h2 id="ia-h">Articles from Framer</h2>
          <ol class="checklist">
            <li><div><strong>Export from Framer</strong>Open your project, go to Plugins, search for <em>CMS Export</em> (made by Framer), choose your articles collection and export it as CSV.</div></li>
            <li><div><strong>Drop the file here</strong>You'll match the columns, check a preview, then import. Running it again updates articles with the same slug instead of duplicating them.</div></li>
          </ol>
        </div>
        <div data-importer="articles"></div>
      </section>
      <section class="card card-pad stack" id="imp-learn" aria-labelledby="il-h">
        <div><h2 id="il-h">Learn Economics lessons from Framer</h2><p>Export your Learn Economics pages collection the same way. Lessons go into the ${config.learn.name} hub, filed under ${config.learn.topics.join(" or ")} from their category, with their original dates and cover images. Running it again updates lessons with the same slug.</p></div>
        <div data-importer="learn"></div>
      </section>
      <section class="card card-pad stack" id="imp-authors" aria-labelledby="iau-h">
        <div><h2 id="iau-h">Authors from Framer</h2><p>Optional. Export your authors collection the same way to bring over photos and bios. Authors with the same slug are updated.</p></div>
        <div data-importer="authors"></div>
      </section>
      ${LIVE ? html`
      <section class="card card-pad stack" aria-labelledby="st-h">
        <div><h2 id="st-h">Starter content</h2><p>Adds the 22 authors listed on fershman.com, plus a launch note from the editors and two Learn Economics lessons as drafts you can review and publish.</p></div>
        <div class="row"><button class="btn" type="button" data-starter>${icon("plus")} Add starter content</button><span class="small muted" data-starter-status></span></div>
      </section>` : ""}
    </div>
  </div>`);

  setupImporter($('[data-importer="articles"]', ctx.el), "articles", ctx);
  setupImporter($('[data-importer="learn"]', ctx.el), "learn", ctx);
  setupImporter($('[data-importer="authors"]', ctx.el), "authors", ctx);

  const starter = $("[data-starter]", ctx.el);
  if (starter) starter.addEventListener("click", async () => {
    const status = $("[data-starter-status]", ctx.el);
    starter.disabled = true;
    status.textContent = "Adding…";
    try {
      const seed = await (await fetch("/content/seed.json")).json();
      const authors = await db.importAuthors(seed.authors.map(({ id, created_at, ...rest }) => rest));
      const bySlug = new Map(authors.map((a) => [a.slug, a.id]));
      const rows = seed.articles.filter((a) => a.starter).map((a) => ({
        slug: a.slug, title: a.title, dek: a.dek, body: a.body, section: a.section, topic: a.topic, tags: a.tags,
        figures: a.figures, author_id: bySlug.get(a.author_slug) || null, status: "draft", published_at: null,
      }));
      const r = await db.importArticles(rows);
      status.textContent = `Added ${authors.length} authors and ${r.inserted + r.updated} draft articles.`;
      toast("Starter content added");
      ctx.refreshCounts();
    } catch (ex) {
      status.textContent = friendlyError(ex);
      starter.disabled = false;
    }
  });
}

function setupImporter(host, kind, ctx) {
  const targets = kind === "authors" ? AUTHOR_TARGETS : kind === "learn" ? LEARN_TARGETS : ARTICLE_TARGETS;
  let rows = [];
  let headers = [];
  let map = {};
  let sectionMap = {};
  let authorMap = {};
  let authors = [];

  const dropzone = () => html`
    <label class="dropzone" tabindex="0">
      ${icon("upload")}<span><strong>Drop your CSV file here</strong> or click to choose</span>
      <input type="file" accept=".csv,text/csv" hidden>
    </label>`;
  mount(host, dropzone());

  async function parseFile(file) {
    if (!file) return;
    try {
      const Papa = await loadScript("/assets/vendor/papaparse.min.js", "Papa");
      const res = await new Promise((resolve, reject) => Papa.parse(file, { header: true, skipEmptyLines: "greedy", complete: resolve, error: reject }));
      rows = res.data.filter((r) => Object.values(r).some((v) => String(v || "").trim()));
      headers = res.meta.fields || [];
      if (!rows.length) throw new Error("That file has no rows.");
      map = guessMapping(headers, targets);
      if (kind !== "authors") authors = await db.listAuthors();
      drawMapping(file.name);
    } catch (ex) {
      toast(friendlyError(ex), { error: true });
    }
  }

  function sample(col) {
    const r = rows.find((x) => String(x[col] || "").trim());
    return r ? truncate(plain(r[col]), 70) : "";
  }

  function distinct(col) {
    return [...new Set(rows.map((r) => String(r[col] || "").split(",")[0].trim()).filter(Boolean))].slice(0, 60);
  }

  function resolveAuthorAuto(value) {
    const v = slugify(value);
    const hit = authors.find((a) => a.slug === v || slugify(a.name) === v || a.id === value);
    return hit ? hit.id : `new:${value}`;
  }

  function drawValueMaps() {
    if (kind === "authors") return "";
    const sCol = map.section, aCol = map.author;
    let out = "";
    if (sCol && kind === "learn") {
      const vals = distinct(sCol);
      const topics = config.learn.topics;
      vals.forEach((v) => { if (!(v in sectionMap)) sectionMap[v] = topics.find((t) => slugify(t) === slugify(v)) || topics[0]; });
      out += html`<div class="stack" style="gap:8px"><h3 class="small" style="font-weight:700">Match categories to topics</h3>
        <table class="table map-table"><tbody>${vals.map((v) => html`<tr><td>${truncate(v, 50)}</td><td>
          <select class="select" data-secmap="${v}">${topics.map((t) => html`<option value="${t}" ${sectionMap[v] === t ? raw("selected") : ""}>${t}</option>`)}</select></td></tr>`)}</tbody></table></div>`.value;
    } else if (sCol) {
      const vals = distinct(sCol);
      vals.forEach((v) => { if (!(v in sectionMap)) sectionMap[v] = matchSection(v) || config.sections[0].slug; });
      out += html`<div class="stack" style="gap:8px"><h3 class="small" style="font-weight:700">Match section values</h3>
        <table class="table map-table"><tbody>${vals.map((v) => html`<tr><td>${truncate(v, 50)}</td><td>
          <select class="select" data-secmap="${v}">${config.sections.map((s) => html`<option value="${s.slug}" ${sectionMap[v] === s.slug ? raw("selected") : ""}>${s.name}</option>`)}<option value="learn" ${sectionMap[v] === "learn" ? raw("selected") : ""}>${config.learn.name}</option></select></td></tr>`)}</tbody></table></div>`.value;
    }
    if (aCol) {
      const vals = distinct(aCol);
      vals.forEach((v) => { if (!(v in authorMap)) authorMap[v] = resolveAuthorAuto(v); });
      out += html`<div class="stack" style="gap:8px"><h3 class="small" style="font-weight:700">Match authors</h3>
        <table class="table map-table"><tbody>${vals.map((v) => html`<tr><td>${truncate(v, 50)}</td><td>
          <select class="select" data-authmap="${v}">
            <option value="new:${v}" ${authorMap[v] === `new:${v}` ? raw("selected") : ""}>Create new author “${truncate(v, 30)}”</option>
            <option value="" ${authorMap[v] === "" ? raw("selected") : ""}>No byline</option>
            ${authors.map((a) => html`<option value="${a.id}" ${authorMap[v] === a.id ? raw("selected") : ""}>${a.name}</option>`)}
          </select></td></tr>`)}</tbody></table></div>`.value;
    }
    return raw(out);
  }

  function drawMapping(fileName) {
    mount(host, html`
      <div class="row"><span class="pill pill-published">${rows.length} rows</span><span class="small muted">${fileName}</span><span class="spacer"></span><button class="btn btn-ghost btn-sm" type="button" data-reset>Choose another file</button></div>
      <div class="stack" style="gap:8px"><h3 class="small" style="font-weight:700">Match columns</h3>
        <div class="table-card card"><table class="table map-table">
          <thead><tr><th>Field</th><th>Column in your file</th><th>Example</th></tr></thead>
          <tbody>${targets.map((t) => html`<tr>
            <td>${t.label}${t.required ? html` <span class="muted">(required)</span>` : ""}</td>
            <td><select class="select" data-map="${t.key}"><option value="">Skip</option>${headers.map((h) => html`<option value="${h}" ${map[t.key] === h ? raw("selected") : ""}>${h}</option>`)}</select></td>
            <td class="small muted" data-sample="${t.key}">${map[t.key] ? sample(map[t.key]) : ""}</td>
          </tr>`)}</tbody>
        </table></div>
      </div>
      <div data-valuemaps class="stack">${drawValueMaps()}</div>
      ${kind !== "authors" ? html`
      <div class="stack" style="gap:10px"><h3 class="small" style="font-weight:700">Options</h3>
        <label class="toggle"><input type="checkbox" data-opt="published" checked><span class="track"></span>Publish imported articles with their original dates</label>
        ${LIVE ? html`<label class="toggle"><input type="checkbox" data-opt="rehost" checked><span class="track"></span>Copy images into your own storage (recommended before you cancel Framer)</label>` : ""}
      </div>` : ""}
      <div class="row"><button class="btn" type="button" data-preview>Preview import</button></div>
      <div data-out class="stack"></div>`);
  }

  async function buildArticles() {
    const get = (r, k) => (map[k] ? String(r[map[k]] ?? "").trim() : "");
    const publish = $('[data-opt="published"]', host)?.checked ?? true;
    const out = [];
    const skipped = [];
    for (const r of rows) {
      const title = get(r, "title");
      if (!title) { skipped.push("(row without a headline)"); continue; }
      let body = get(r, "body");
      if (looksHTML(body)) body = await htmlToMarkdown(body, { lesson: kind === "learn" });
      const sVal = String(get(r, "section")).split(",")[0].trim();
      const aVal = String(get(r, "author")).split(",")[0].trim();
      const learn = kind === "learn";
      const section = learn ? "learn" : sVal ? sectionMap[sVal] || matchSection(sVal) || config.sections[0].slug : config.sections[0].slug;
      let topic = learn ? (sVal && sectionMap[sVal]) || null : get(r, "topic") || null;
      if (section === "learn" && !topic) topic = config.learn.topics.find((t) => slugify(t) === slugify(sVal)) || null;
      out.push({
        slug: cleanSlug(get(r, "slug")) || slugify(title),
        title, dek: plain(get(r, "dek")) || null, body, section, topic,
        tags: splitList(plain(get(r, "tags"))),
        author_key: aVal ? (aVal in authorMap ? authorMap[aVal] : resolveAuthorAuto(aVal)) : "",
        cover_url: firstUrl(get(r, "cover_url")) || null, cover_alt: get(r, "cover_alt") || null,
        published_at: parseDate(get(r, "published_at")) || new Date().toISOString(),
        featured: truthy(get(r, "featured")),
        status: !publish || truthy(get(r, "draft")) ? "draft" : "published",
      });
    }
    return { items: out, skipped };
  }

  function buildAuthors() {
    const get = (r, k) => (map[k] ? String(r[map[k]] ?? "").trim() : "");
    return rows.map((r) => {
      const name = plain(get(r, "name"));
      if (!name) return null;
      return {
        name, slug: cleanSlug(get(r, "slug")) || slugify(name), role_title: plain(get(r, "role_title")) || null,
        bio: plain(get(r, "bio")) || null, avatar_url: firstUrl(get(r, "avatar_url")) || null,
        linkedin_url: firstUrl(get(r, "linkedin_url")) || null, x_url: firstUrl(get(r, "x_url")) || null,
      };
    }).filter(Boolean);
  }

  async function rehostImages(items, onStep) {
    const urls = new Set();
    for (const a of items) {
      if (a.cover_url && !a.cover_url.includes(".supabase.")) urls.add(a.cover_url);
      for (const m of a.body.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)"]+)/g)) if (!m[1].includes(".supabase.")) urls.add(m[1]);
    }
    const moved = new Map();
    let i = 0, failed = 0;
    for (const url of urls) {
      i++;
      onStep(i, urls.size);
      try {
        const res = await fetch(url, { mode: "cors" });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (!blob.type.startsWith("image/")) throw new Error("not an image");
        const name = (url.split("?")[0].split("/").pop() || "image").slice(0, 60);
        moved.set(url, await db.uploadMedia(new File([blob], name, { type: blob.type })));
      } catch (_) { failed++; }
    }
    for (const a of items) {
      if (a.cover_url && moved.has(a.cover_url)) a.cover_url = moved.get(a.cover_url);
      a.body = a.body.replace(/(!\[[^\]]*\]\()(https?:\/\/[^\s)"]+)/g, (m, pre, u) => (moved.has(u) ? pre + moved.get(u) : m));
    }
    return { moved: moved.size, failed, total: urls.size };
  }

  async function preview() {
    const out = $("[data-out]", host);
    const missing = targets.filter((t) => t.required && !map[t.key]);
    if (missing.length) { mount(out, html`<p class="form-error">Match a column for: ${missing.map((t) => t.label).join(", ")}.</p>`); return; }
    if (kind === "authors") {
      const list = buildAuthors();
      mount(out, html`
        <div class="import-preview"><table class="table"><thead><tr><th>Name</th><th>Role</th><th>Slug</th></tr></thead><tbody>
          ${list.slice(0, 8).map((a) => html`<tr><td>${a.name}</td><td>${a.role_title || ""}</td><td class="small muted">${a.slug}</td></tr>`)}</tbody></table></div>
        <div class="row"><button class="btn btn-accent" type="button" data-go>Import ${list.length} authors</button></div>`);
      $("[data-go]", out).addEventListener("click", async (e) => {
        e.currentTarget.disabled = true;
        try { await db.importAuthors(list); mount(out, html`<div class="notice">Imported ${list.length} authors.</div>`); toast("Authors imported"); }
        catch (ex) { mount(out, html`<p class="form-error">${friendlyError(ex)}</p>`); }
      });
      return;
    }
    mount(out, html`<p class="small muted">Converting articles…</p>`);
    const { items, skipped } = await buildArticles();
    const newAuthors = [...new Set(items.map((a) => a.author_key).filter((k) => k.startsWith("new:")))].map((k) => k.slice(4));
    mount(out, html`
      <div class="notice">${items.length} ${kind === "learn" ? "lessons" : "articles"} ready${skipped.length ? `, ${skipped.length} rows skipped (no headline)` : ""}.${newAuthors.length ? ` ${newAuthors.length} new author${newAuthors.length === 1 ? "" : "s"} will be created.` : ""}</div>
      <div class="import-preview"><table class="table"><thead><tr><th>Headline</th><th>Section</th><th>Date</th><th>Text</th></tr></thead><tbody>
        ${items.slice(0, 6).map((a) => html`<tr><td><strong>${a.title}</strong><div class="small muted">/articles/${a.slug}</div></td><td>${a.section === "learn" ? `${config.learn.name}${a.topic ? `: ${a.topic}` : ""}` : (config.sections.find((s) => s.slug === a.section) || { name: a.section }).name}</td><td class="small">${fmtDate(a.published_at)}</td><td class="small muted">${truncate(a.body.replace(/[#>*_[\]()!|-]/g, " "), 90)}</td></tr>`)}
      </tbody></table></div>
      <div class="row"><button class="btn btn-accent" type="button" data-go>Import ${items.length} ${kind === "learn" ? "lessons" : "articles"}</button></div>
      <div data-progress hidden class="stack" style="gap:6px"><div class="progress-bar"><span></span></div><span class="small muted" data-progress-text></span></div>`);
    $("[data-go]", out).addEventListener("click", async (e) => {
      e.currentTarget.disabled = true;
      const prog = $("[data-progress]", out);
      const bar = $(".progress-bar span", out);
      const ptext = $("[data-progress-text]", out);
      prog.hidden = false;
      try {
        // 1. Create missing authors
        let authorIds = new Map(authors.map((a) => [a.id, a.id]));
        if (newAuthors.length) {
          ptext.textContent = "Creating authors…";
          const list = await db.importAuthors(newAuthors.map((n) => ({ name: n, slug: slugify(n), team: "Contributors" })));
          for (const n of newAuthors) { const hit = list.find((a) => a.slug === slugify(n)); if (hit) authorIds.set(`new:${n}`, hit.id); }
        }
        items.forEach((a) => { a.author_id = a.author_key ? authorIds.get(a.author_key) || null : null; delete a.author_key; });
        // 2. Images
        let imgNote = "";
        if ($('[data-opt="rehost"]', host)?.checked) {
          const r = await rehostImages(items, (i, n) => { ptext.textContent = `Copying image ${i} of ${n}…`; bar.style.width = `${(i / Math.max(n, 1)) * 50}%`; });
          imgNote = r.total ? ` Copied ${r.moved} of ${r.total} images${r.failed ? ` (${r.failed} stayed on Framer's servers — you can re-upload those in the editor)` : ""}.` : "";
        }
        // 3. Articles
        const res = await db.importArticles(items, { onProgress: (d, n) => { ptext.textContent = `Saving article ${d} of ${n}…`; bar.style.width = `${50 + (d / n) * 50}%`; } });
        bar.style.width = "100%";
        mount(out, html`<div class="notice"><strong>Import finished.</strong> ${res.inserted} new, ${res.updated} updated${res.failed.length ? `, ${res.failed.length} failed` : ""}.${imgNote}</div>
          ${res.failed.length ? html`<ul class="small">${res.failed.map((f) => html`<li><strong>${f.slug}</strong>: ${f.error}</li>`)}</ul>` : ""}
          <div class="row">${kind === "learn" ? html`<a class="btn" href="/learn" target="_blank" rel="noopener">See the lessons</a>` : html`<a class="btn" href="#/articles">See articles</a>`}<a class="btn btn-ghost" href="/" target="_blank" rel="noopener">View the site</a></div>`);
        toast("Import finished");
        ctx.refreshCounts();
      } catch (ex) {
        mount(out, html`<p class="form-error">${friendlyError(ex)}</p>`);
      }
    });
  }

  host.addEventListener("change", (e) => {
    if (e.target.matches('input[type="file"]')) parseFile(e.target.files[0]);
    if (e.target.matches("[data-map]")) {
      map[e.target.dataset.map] = e.target.value;
      const s = $(`[data-sample="${e.target.dataset.map}"]`, host);
      if (s) s.textContent = e.target.value ? sample(e.target.value) : "";
      if (["section", "author"].includes(e.target.dataset.map)) mount($("[data-valuemaps]", host), drawValueMaps());
    }
    if (e.target.matches("[data-secmap]")) sectionMap[e.target.dataset.secmap] = e.target.value;
    if (e.target.matches("[data-authmap]")) authorMap[e.target.dataset.authmap] = e.target.value;
  });
  host.addEventListener("click", (e) => {
    if (e.target.closest("[data-reset]")) { rows = []; map = {}; sectionMap = {}; authorMap = {}; mount(host, dropzone()); }
    if (e.target.closest("[data-preview]")) preview();
  });
  host.addEventListener("keydown", (e) => { const dz = e.target.closest(".dropzone"); if (dz && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); $("input", dz).click(); } });
  host.addEventListener("dragover", (e) => { const dz = e.target.closest(".dropzone"); if (dz) { e.preventDefault(); dz.classList.add("is-over"); } });
  host.addEventListener("dragleave", (e) => { const dz = e.target.closest(".dropzone"); if (dz) dz.classList.remove("is-over"); });
  host.addEventListener("drop", (e) => { const dz = e.target.closest(".dropzone"); if (dz) { e.preventDefault(); dz.classList.remove("is-over"); parseFile(e.dataTransfer.files[0]); } });
}
