// Demo adapter: the whole site runs from /content/seed.json, and anything you
// change in the admin panel or member portal is saved in this browser only.
import { uid, slugify } from "../lib/util.js";
import {
  normalizeAuthor, authorTeams, BYLINE_FIELDS, MARKETING,
  isPublic, byDateDesc, sortAuthors, SETTINGS_DEFAULTS, cleanArticle, roleAtLeast,
  articleState, pick, AUTHOR_FIELDS, guessMime,
} from "./shared.js";

const DB_KEY = "fershman-demo-db-v1";
const SESSION_KEY = "fershman-demo-session-v1";
const FILES_DB = "fershman-demo-files";

const clone = (o) => JSON.parse(JSON.stringify(o));
const nowISO = () => new Date().toISOString();

function readLS(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (_) { return null; } }
function writeLS(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; } }

function denied() { return Object.assign(new Error("Your account doesn't have permission to do that."), { code: "42501" }); }

// ---- IndexedDB for demo portal uploads ----
function openFiles() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FILES_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("files");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function fileTx(mode, fn) {
  const dbh = await openFiles();
  return new Promise((resolve, reject) => {
    const tx = dbh.transaction("files", mode);
    const store = tx.objectStore("files");
    const req = fn(store);
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  });
}
const filePut = (key, blob) => fileTx("readwrite", (s) => s.put(blob, key));
const fileGet = (key) => fileTx("readonly", (s) => s.get(key));
const fileDel = (key) => fileTx("readwrite", (s) => s.delete(key));

async function shrinkImage(file, maxW = 1400, quality = 0.82) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("That image couldn't be read.")); i.src = url; });
    const scale = Math.min(1, maxW / img.naturalWidth);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function createDemoAdapter(config) {
  let state = readLS(DB_KEY);
  if (!state || state.version !== 1) {
    const res = await fetch("/content/seed.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("Seed content is missing (/content/seed.json).");
    const seed = await res.json();
    state = {
      version: 1,
      authors: seed.authors || [],
      articles: seed.articles || [],
      portal: seed.portal || [],
      profiles: seed.profiles || [],
      messages: seed.messages || [],
      subscribers: seed.subscribers || [],
      settings: seed.settings || {},
    };
    writeLS(DB_KEY, state);
  }
  if (!state.sessions) {
    // Sample info sessions, dated relative to today so they're always upcoming.
    const at = (days, hour) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
    state.sessions = [
      { id: uid(), title: "Info session: how Fershman works (sample)", description: "Sections, editing, publishing and what new members do in their first quarter.", starts_at: at(5, 18), duration_min: 60, location: "On campus (room sent on registration)", join_url: "", capacity: 40, is_published: true, created_at: new Date().toISOString() },
      { id: uid(), title: "Virtual info session (sample)", description: "The same session online, for anyone who can't make it in person.", starts_at: at(12, 19), duration_min: 45, location: "Online", join_url: "https://example.com/meeting", capacity: null, is_published: true, created_at: new Date().toISOString() },
    ];
    state.registrations = [];
    writeLS(DB_KEY, state);
  }
  if (!state.periods) {
    state.periods = [];
    state.authors = state.authors.map(normalizeAuthor);
    writeLS(DB_KEY, state);
  }
  const save = () => {
    if (!writeLS(DB_KEY, state)) throw new Error("Demo storage in this browser is full. Connect Supabase, or reset the demo in Admin → Settings.");
  };

  let session = readLS(SESSION_KEY);
  const listeners = new Set();
  const emit = (event) => listeners.forEach((cb) => setTimeout(() => cb(event), 0));
  const me = () => session && session.profile;
  const role = () => (me() ? me().role : "anon");
  const need = (min) => { if (!session || !roleAtLeast(role(), min)) throw denied(); };
  const isRecruiter = () => {
    if (!session) return false;
    if (roleAtLeast(role(), "editor")) return true;
    if (!roleAtLeast(role(), "member")) return false;
    const a = state.authors.find((x) => x.id === me().author_id);
    return Boolean(a) && authorTeams(a).includes(MARKETING);
  };
  const needRecruiter = () => { if (!isRecruiter()) throw denied(); };
  const setSession = (profile) => {
    session = profile ? { user: { id: profile.id, email: profile.email }, profile: clone(profile) } : null;
    if (session) writeLS(SESSION_KEY, session); else localStorage.removeItem(SESSION_KEY);
  };

  const authorMap = () => new Map(state.authors.map((a) => [a.id, a]));
  const withAuthor = (a, map = authorMap()) => ({ ...a, author: map.get(a.author_id) || null });
  const card = (a, map) => { const { body, ...rest } = a; return withAuthor(rest, map); };
  const visibleToMe = (a) => isPublic(a) || roleAtLeast(role(), "editor") || (roleAtLeast(role(), "writer") && a.created_by === (me() && me().id));

  const api = {
    mode: "demo",

    // ---------- Public reads ----------
    async listArticles({ section, excludeSections, topic, authorId, tag, featured, bigRead, limit = 20, offset = 0 } = {}) {
      let rows = state.articles.filter((a) => isPublic(a));
      if (section) rows = rows.filter((a) => a.section === section);
      if (excludeSections && excludeSections.length) rows = rows.filter((a) => !excludeSections.includes(a.section));
      if (topic) rows = rows.filter((a) => (a.topic || "").toLowerCase() === topic.toLowerCase());
      if (authorId) rows = rows.filter((a) => a.author_id === authorId);
      if (tag) rows = rows.filter((a) => (a.tags || []).some((t) => t.toLowerCase() === tag.toLowerCase()));
      if (featured) rows = rows.filter((a) => a.featured);
      if (bigRead) rows = rows.filter((a) => a.big_read);
      const map = authorMap();
      return rows.sort(byDateDesc).slice(offset, offset + limit).map((a) => card(clone(a), map));
    },
    async getArticle(slug) {
      const a = state.articles.find((x) => x.slug === slug && isPublic(x));
      return a ? withAuthor(clone(a)) : null;
    },
    async getArticleForPreview(key) {
      const a = state.articles.find((x) => x.id === key || x.slug === key);
      return a && visibleToMe(a) ? withAuthor(clone(a)) : null;
    },
    async searchArticles(q, limit = 30) {
      const terms = String(q || "").toLowerCase().split(/\s+/).filter((t) => t.length > 1);
      if (!terms.length) return [];
      const map = authorMap();
      return state.articles
        .filter((a) => isPublic(a))
        .map((a) => {
          const hay = { t: (a.title || "").toLowerCase(), d: (a.dek || "").toLowerCase(), b: (a.body || "").toLowerCase(), k: `${a.topic || ""} ${(a.tags || []).join(" ")}`.toLowerCase() };
          let score = 0;
          for (const t of terms) {
            if (hay.t.includes(t)) score += 5;
            if (hay.d.includes(t)) score += 3;
            if (hay.k.includes(t)) score += 2;
            if (hay.b.includes(t)) score += 1;
          }
          return { a, score };
        })
        .filter((r) => r.score > 0)
        .sort((x, y) => y.score - x.score || byDateDesc(x.a, y.a))
        .slice(0, limit)
        .map((r) => card(clone(r.a), map));
    },
    async mostRead(limit = 5) {
      const map = authorMap();
      return state.articles.filter((a) => isPublic(a) && a.section !== "learn")
        .sort((x, y) => (y.view_count || 0) - (x.view_count || 0) || byDateDesc(x, y))
        .slice(0, limit).map((a) => card(clone(a), map));
    },
    async recordView(slug) {
      const a = state.articles.find((x) => x.slug === slug);
      if (a) { a.view_count = (a.view_count || 0) + 1; try { save(); } catch (_) { /* ignore */ } }
    },
    async listAuthors() {
      return sortAuthors(clone(state.authors), config.authorTeams);
    },
    async getAuthor(slug) {
      const a = state.authors.find((x) => x.slug === slug);
      return a ? clone(a) : null;
    },
    async getSettings() {
      return { ...clone(SETTINGS_DEFAULTS), ...clone(state.settings) };
    },

    // ---------- Public writes ----------
    async sendMessage({ kind, name, email, subject, body, data }) {
      state.messages.unshift({ id: uid(), kind, name, email, subject: subject || null, body: body || "", data: data || {}, status: "new", stage: "new", created_at: nowISO() });
      save();
    },
    async subscribe({ email, name, source }) {
      const e = String(email).trim().toLowerCase();
      if (state.subscribers.some((s) => s.email === e)) return { already: true };
      state.subscribers.unshift({ id: uid(), email: e, name: name || null, source: source || "site", created_at: nowISO() });
      save();
      return { already: false };
    },

    // ---------- Auth ----------
    async getSession() {
      if (!session) return null;
      const fresh = state.profiles.find((p) => p.id === session.user.id);
      if (fresh) setSession(fresh);
      return { ...clone(session), recruiter: isRecruiter() };
    },
    onAuthChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    async signIn(email, password) {
      if (!email || !password) throw new Error("Enter your email and password.");
      let p = state.profiles.find((x) => x.email.toLowerCase() === String(email).trim().toLowerCase());
      if (!p) {
        p = { id: uid(), email: String(email).trim(), full_name: String(email).split("@")[0], role: "admin", author_id: null, created_at: nowISO() };
        state.profiles.unshift(p);
        save();
      }
      setSession(p);
      emit("SIGNED_IN");
      return clone(session);
    },
    async signUp(email, password, fullName) {
      if (!email || !password) throw new Error("Enter your email and a password.");
      if (password.length < 8) throw new Error("Password should be at least 8 characters.");
      const exists = state.profiles.find((x) => x.email.toLowerCase() === String(email).trim().toLowerCase());
      if (exists) throw new Error("An account with this email already exists. Sign in instead.");
      const p = { id: uid(), email: String(email).trim(), full_name: fullName || "", role: "pending", author_id: null, created_at: nowISO() };
      state.profiles.unshift(p);
      save();
      setSession(p);
      emit("SIGNED_IN");
      return { needsConfirmation: false };
    },
    async signOut() { setSession(null); emit("SIGNED_OUT"); },
    async sendPasswordReset() { return true; },
    async updatePassword() { return true; },

    // ---------- Staff: articles ----------
    async adminListArticles() {
      need("writer");
      const map = authorMap();
      return state.articles.filter(visibleToMe).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).map((a) => card(clone(a), map));
    },
    async adminGetArticle(id) {
      need("writer");
      const a = state.articles.find((x) => x.id === id);
      if (!a || !visibleToMe(a)) return null;
      return withAuthor(clone(a));
    },
    async saveArticle(input) {
      need("writer");
      const isEditor = roleAtLeast(role(), "editor");
      const row = cleanArticle(input);
      if (!row.slug) row.slug = slugify(row.title) || uid().slice(0, 8);
      if (state.articles.some((x) => x.slug === row.slug && x.id !== input.id)) {
        throw Object.assign(new Error('duplicate key value violates unique constraint "articles_slug_key"'), { code: "23505" });
      }
      const ts = nowISO();
      if (input.id) {
        const cur = state.articles.find((x) => x.id === input.id);
        if (!cur) throw new Error("This article no longer exists.");
        if (!isEditor) {
          const next = row.status || cur.status;
          if (cur.created_by !== me().id || !["draft", "review"].includes(cur.status) || !["draft", "review"].includes(next)) throw denied();
        }
        Object.assign(cur, row, { updated_at: ts });
        if (cur.status === "published" && !cur.published_at) cur.published_at = ts;
        save();
        return withAuthor(clone(cur));
      }
      if (!isEditor && !["draft", "review"].includes(row.status || "draft")) throw denied();
      const rec = {
        id: uid(), title: "", dek: null, body: "", section: (config.sections[0] || {}).slug || "markets", topic: null, tags: [],
        author_id: null, cover_url: null, cover_alt: null, cover_caption: null, figures: null, status: "draft",
        published_at: null, featured: false, big_read: false, view_count: 0,
        ...row, created_by: me().id, created_at: ts, updated_at: ts,
      };
      if (rec.status === "published" && !rec.published_at) rec.published_at = ts;
      state.articles.push(rec);
      save();
      return withAuthor(clone(rec));
    },
    async deleteArticle(id) {
      need("writer");
      const a = state.articles.find((x) => x.id === id);
      if (!a) return;
      const ok = roleAtLeast(role(), "editor") || (a.created_by === me().id && a.status === "draft");
      if (!ok) throw denied();
      state.articles = state.articles.filter((x) => x.id !== id);
      save();
    },
    async importArticles(rows, { onProgress } = {}) {
      need("editor");
      let inserted = 0, updated = 0;
      const ts = nowISO();
      rows.forEach((r, i) => {
        const row = cleanArticle(r);
        const cur = state.articles.find((x) => x.slug === row.slug);
        if (cur) { Object.assign(cur, row, { updated_at: ts }); updated++; }
        else {
          state.articles.push({ id: uid(), dek: null, topic: null, tags: [], author_id: null, cover_url: null, cover_alt: null, cover_caption: null, figures: null, featured: false, big_read: false, view_count: 0, ...row, created_by: me().id, created_at: ts, updated_at: ts });
          inserted++;
        }
        if (onProgress) onProgress(i + 1, rows.length);
      });
      save();
      return { inserted, updated, failed: [] };
    },

    // ---------- Staff: authors ----------
    async saveAuthor(input) {
      need("editor");
      const row = normalizeAuthor(pick(input, AUTHOR_FIELDS));
      row.slug = row.slug || slugify(row.name);
      if (state.authors.some((x) => x.slug === row.slug && x.id !== input.id)) {
        throw Object.assign(new Error('duplicate key value violates unique constraint "authors_slug_key"'), { code: "23505" });
      }
      if (input.id) {
        const cur = state.authors.find((x) => x.id === input.id);
        Object.assign(cur, row, { updated_at: nowISO() });
        save();
        return clone(cur);
      }
      const rec = { id: uid(), role_title: null, team: "Contributors", bio: null, avatar_url: null, x_url: null, linkedin_url: null, sort_order: 100, ...row, created_at: nowISO() };
      state.authors.push(rec);
      save();
      return clone(rec);
    },
    async deleteAuthor(id) {
      need("admin");
      state.authors = state.authors.filter((a) => a.id !== id);
      state.articles.forEach((a) => { if (a.author_id === id) a.author_id = null; });
      save();
    },
    async importAuthors(list) {
      need("editor");
      for (const raw of list) {
        const a = normalizeAuthor(raw);
        const cur = state.authors.find((x) => x.slug === a.slug);
        if (cur) Object.assign(cur, pick(a, AUTHOR_FIELDS));
        else state.authors.push({ id: uid(), team: "Contributors", sort_order: 100, ...pick(a, AUTHOR_FIELDS), created_at: nowISO() });
      }
      save();
      return api.listAuthors();
    },

    // ---------- Admin: people, inbox, subscribers, settings ----------
    async listProfiles() { need("admin"); return clone(state.profiles); },
    async updateProfile(id, patch) {
      const p = state.profiles.find((x) => x.id === id);
      if (!p) throw new Error("Account not found.");
      if (!(roleAtLeast(role(), "admin") || (me() && me().id === id && !("role" in patch) && !("author_id" in patch)))) throw denied();
      if (patch.role && p.role === "admin" && patch.role !== "admin" && state.profiles.filter((x) => x.role === "admin").length <= 1) {
        throw new Error("You are the only admin. Make someone else an admin first.");
      }
      Object.assign(p, pick(patch, ["role", "author_id", "full_name"]));
      save();
      if (me() && me().id === id) { setSession(p); emit("USER_UPDATED"); }
      return clone(p);
    },
    async listMessages() {
      if (roleAtLeast(role(), "editor")) return clone(state.messages);
      needRecruiter();
      return clone(state.messages.filter((m) => m.kind === "application"));
    },
    async updateMessage(id, patch) {
      const m = state.messages.find((x) => x.id === id);
      if (!(roleAtLeast(role(), "editor") || (isRecruiter() && m && m.kind === "application"))) throw denied();
      if (m) Object.assign(m, pick(patch, ["status", "stage"]));
      save();
    },
    async deleteMessage(id) { need("editor"); state.messages = state.messages.filter((m) => m.id !== id); save(); },
    async listSubscribers() { need("admin"); return clone(state.subscribers); },
    async deleteSubscriber(id) { need("admin"); state.subscribers = state.subscribers.filter((s) => s.id !== id); save(); },
    async saveSetting(key, value) { need("admin"); state.settings[key] = clone(value); save(); },
    async counts() {
      need("writer");
      const arts = state.articles.filter(visibleToMe);
      const by = (s) => arts.filter((a) => articleState(a) === s).length;
      return {
        published: by("published"), scheduled: by("scheduled"), review: by("review"), drafts: by("draft"),
        subscribers: roleAtLeast(role(), "admin") ? state.subscribers.length : 0,
        newMessages: roleAtLeast(role(), "editor") ? state.messages.filter((m) => m.status === "new").length : 0,
        pending: roleAtLeast(role(), "admin") ? state.profiles.filter((p) => p.role === "pending").length : 0,
        newApplications: isRecruiter() ? state.messages.filter((m) => m.kind === "application" && (m.stage || "new") === "new").length : 0,
      };
    },

    // ---------- Media ----------
    async uploadMedia(file) {
      need("writer");
      if (!file.type.startsWith("image/")) throw new Error("Only images can be uploaded here.");
      return shrinkImage(file);
    },

    // ---------- Member portal ----------
    async listPortalItems() {
      need("member");
      return clone(state.portal).sort((a, b) => String(b.event_date || b.created_at).localeCompare(String(a.event_date || a.created_at)));
    },
    async createPortalItem(meta, file) {
      need("editor");
      const ts = nowISO();
      const item = {
        id: uid(), title: meta.title, description: meta.description || null, collection: meta.collection || "General",
        kind: file ? "file" : "link", url: file ? null : meta.url, file_path: null, file_name: null, file_size: null, mime_type: null,
        event_date: meta.event_date || null, created_by: me().id, created_at: ts, updated_at: ts,
      };
      if (file) {
        const key = `portal/${item.id}/${file.name}`;
        await filePut(key, file);
        Object.assign(item, { file_path: key, file_name: file.name, file_size: file.size, mime_type: file.type || guessMime(file.name) });
      }
      state.portal.push(item);
      save();
      return clone(item);
    },
    async updatePortalItem(id, patch) {
      need("editor");
      const it = state.portal.find((x) => x.id === id);
      if (!it) throw new Error("Item not found.");
      Object.assign(it, pick(patch, ["title", "description", "collection", "event_date", "url"]), { updated_at: nowISO() });
      save();
      return clone(it);
    },
    async deletePortalItem(item) {
      need("editor");
      state.portal = state.portal.filter((x) => x.id !== item.id);
      save();
      if (item.file_path && !item.file_path.startsWith("/")) { try { await fileDel(item.file_path); } catch (_) { /* ignore */ } }
    },
    async portalFileUrl(item) {
      need("member");
      if (item.kind === "link") return item.url;
      if (item.file_path && item.file_path.startsWith("/")) return item.file_path;
      const blob = await fileGet(item.file_path);
      if (!blob) throw new Error("This demo file is no longer stored in this browser.");
      return URL.createObjectURL(blob);
    },

    // ---------- Recruiting ----------
    async listInfoSessions() {
      const now = Date.now();
      return state.sessions
        .filter((x) => x.is_published && new Date(x.starts_at).getTime() + x.duration_min * 60000 > now)
        .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
        .map(({ join_url, ...rest }) => ({ ...rest, is_online: Boolean(join_url), registered: state.registrations.filter((r) => r.session_id === rest.id).length }));
    },
    async registerForSession(sessionId, { name, email, year, note }) {
      const e = String(email || "").trim().toLowerCase();
      if (!String(name || "").trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { status: "invalid" };
      const x = state.sessions.find((y) => y.id === sessionId);
      if (!x || !x.is_published || new Date(x.starts_at).getTime() + x.duration_min * 60000 <= Date.now()) return { status: "closed" };
      const details = { id: x.id, title: x.title, description: x.description, starts_at: x.starts_at, duration_min: x.duration_min, location: x.location, join_url: x.join_url };
      const regs = state.registrations.filter((r) => r.session_id === x.id);
      if (regs.some((r) => r.email === e)) return { ...details, status: "already" };
      if (x.capacity && regs.length >= x.capacity) return { status: "full" };
      state.registrations.push({ id: uid(), session_id: x.id, name: String(name).trim(), email: e, year: year || null, note: note || null, created_at: nowISO() });
      save();
      return { ...details, status: "registered" };
    },
    async adminListInfoSessions() {
      needRecruiter();
      return clone(state.sessions).sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at))
        .map((x) => ({ ...x, registered: state.registrations.filter((r) => r.session_id === x.id).length }));
    },
    async saveInfoSession(input) {
      needRecruiter();
      const row = pick(input, ["title", "description", "starts_at", "duration_min", "location", "join_url", "capacity", "is_published"]);
      if (input.id) {
        const cur = state.sessions.find((x) => x.id === input.id);
        Object.assign(cur, row);
        save();
        return clone(cur);
      }
      const rec = { id: uid(), description: null, duration_min: 60, location: null, join_url: null, capacity: null, is_published: true, ...row, created_at: nowISO() };
      state.sessions.push(rec);
      save();
      return clone(rec);
    },
    async deleteInfoSession(id) {
      needRecruiter();
      state.sessions = state.sessions.filter((x) => x.id !== id);
      state.registrations = state.registrations.filter((r) => r.session_id !== id);
      save();
    },
    async listRegistrations(sessionId) {
      needRecruiter();
      return clone(state.registrations.filter((r) => r.session_id === sessionId));
    },
    async deleteRegistration(id) {
      needRecruiter();
      state.registrations = state.registrations.filter((r) => r.id !== id);
      save();
    },
    async listRecruitingPeriods() {
      return clone(state.periods).sort((a, b) => b.starts_on.localeCompare(a.starts_on));
    },
    async saveRecruitingPeriod(input) {
      needRecruiter();
      const row = pick(input, ["title", "starts_on", "ends_on", "note"]);
      if (input.id) { const cur = state.periods.find((x) => x.id === input.id); Object.assign(cur, row); save(); return clone(cur); }
      const rec = { id: uid(), note: null, ...row, created_at: nowISO() };
      state.periods.push(rec);
      save();
      return clone(rec);
    },
    async deleteRecruitingPeriod(id) {
      needRecruiter();
      state.periods = state.periods.filter((x) => x.id !== id);
      save();
    },
    async updateMyByline(patch) {
      need("writer");
      const a = state.authors.find((x) => x.id === me().author_id);
      if (!a) throw new Error("Your account isn't linked to a byline yet. Ask an admin to link it in Members.");
      Object.assign(a, pick(patch, BYLINE_FIELDS));
      save();
      return clone(a);
    },

    // ---------- Demo-only helpers ----------
    async setDemoRole(newRole) {
      if (!session) return;
      const p = state.profiles.find((x) => x.id === session.user.id);
      if (p) { p.role = newRole; save(); setSession(p); emit("USER_UPDATED"); }
    },
    async resetDemo() {
      localStorage.removeItem(DB_KEY);
      localStorage.removeItem(SESSION_KEY);
      try { indexedDB.deleteDatabase(FILES_DB); } catch (_) { /* ignore */ }
    },
  };
  return api;
}
