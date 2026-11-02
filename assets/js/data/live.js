// Live adapter: Supabase (Postgres + Auth + Storage). Every permission is
// enforced by Row Level Security in supabase/schema.sql — this file only asks.
import { uid, slugify } from "../lib/util.js";
import {
  normalizeAuthor, BYLINE_FIELDS,
  CARD_COLUMNS, SETTINGS_DEFAULTS, cleanArticle, sortAuthors, pick, AUTHOR_FIELDS,
  safeFileName, guessMime, roleAtLeast,
} from "./shared.js";

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.supabase && window.supabase.createClient) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Couldn't load ${src}`));
    document.head.append(s);
  });
}

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

export async function createSupabaseClient(url, key) {
  await loadScript("/assets/vendor/supabase.js");
  return window.supabase.createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}

export async function createLiveAdapter(config) {
  const sb = await createSupabaseClient(config.supabase.url, config.supabase.key);
  const nowISO = () => new Date().toISOString();
  const publicArticles = (cols) => sb.from("articles").select(cols).eq("status", "published").lte("published_at", nowISO());

  // Authors are few; cache them and join in JS (works the same for every query type).
  let authorsPromise = null;
  const loadAuthors = () => {
    if (!authorsPromise) {
      authorsPromise = sb.from("authors").select("*").then(unwrap).catch((e) => { authorsPromise = null; throw e; });
    }
    return authorsPromise;
  };
  const attach = async (rows) => {
    const list = rows || [];
    if (!list.length) return list;
    let map = new Map();
    try { map = new Map((await loadAuthors()).map((a) => [a.id, a])); } catch (_) { /* show without bylines */ }
    return list.map((r) => ({ ...r, author: map.get(r.author_id) || null }));
  };

  let profileCache = null; // { id, profile }
  async function profileFor(user) {
    if (profileCache && profileCache.id === user.id) return profileCache.profile;
    const { data } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
    const profile = data || { id: user.id, email: user.email, role: "pending", full_name: "" };
    profileCache = { id: user.id, profile };
    return profile;
  }

  const api = {
    mode: "live",
    client: sb,

    // ---------- Public reads ----------
    async listArticles({ section, excludeSections, topic, authorId, tag, featured, bigRead, limit = 20, offset = 0 } = {}) {
      let q = publicArticles(CARD_COLUMNS);
      if (section) q = q.eq("section", section);
      if (excludeSections && excludeSections.length) q = q.not("section", "in", `(${excludeSections.map((s) => `"${s}"`).join(",")})`);
      if (topic) q = q.ilike("topic", topic);
      if (authorId) q = q.eq("author_id", authorId);
      if (tag) q = q.contains("tags", [tag]);
      if (featured) q = q.eq("featured", true);
      if (bigRead) q = q.eq("big_read", true);
      const rows = unwrap(await q.order("published_at", { ascending: false }).range(offset, offset + limit - 1));
      return attach(rows);
    },
    async getArticle(slug) {
      const row = unwrap(await publicArticles("*").eq("slug", slug).maybeSingle());
      return row ? (await attach([row]))[0] : null;
    },
    async getArticleForPreview(key) {
      const isId = /^[0-9a-f-]{36}$/i.test(key);
      const row = unwrap(await sb.from("articles").select("*").eq(isId ? "id" : "slug", key).maybeSingle());
      return row ? (await attach([row]))[0] : null;
    },
    async searchArticles(q, limit = 30) {
      const term = String(q || "").trim();
      if (term.length < 2) return [];
      const rows = unwrap(await sb.rpc("search_articles", { q: term, max_results: limit }));
      return attach(rows || []);
    },
    async mostRead(limit = 5) {
      const rows = unwrap(await publicArticles(CARD_COLUMNS).neq("section", "learn")
        .order("view_count", { ascending: false }).order("published_at", { ascending: false }).limit(limit));
      return attach(rows);
    },
    async recordView(slug) {
      try { await sb.rpc("record_view", { p_slug: slug }); } catch (_) { /* best effort */ }
    },
    async listAuthors() {
      return sortAuthors(await loadAuthors(), config.authorTeams);
    },
    async getAuthor(slug) {
      return unwrap(await sb.from("authors").select("*").eq("slug", slug).maybeSingle());
    },
    async getSettings() {
      const rows = unwrap(await sb.from("settings").select("key,value"));
      const out = { ...SETTINGS_DEFAULTS };
      for (const r of rows || []) out[r.key] = r.value;
      return out;
    },

    // ---------- Public writes ----------
    async sendMessage({ kind, name, email, subject, body, data }) {
      unwrap(await sb.from("messages").insert({ kind, name, email, subject: subject || null, body: body || "", data: data || {} }));
    },
    async subscribe({ email, name, source }) {
      const { error } = await sb.from("subscribers").insert({ email: String(email).trim().toLowerCase(), name: name || null, source: source || "site" });
      if (error && error.code === "23505") return { already: true };
      if (error) throw error;
      return { already: false };
    },

    // ---------- Auth ----------
    async getSession() {
      const { data } = await sb.auth.getSession();
      const s = data && data.session;
      if (!s) return null;
      const profile = await profileFor(s.user);
      if (profileCache && profileCache.recruiter === undefined) {
        try { profileCache.recruiter = Boolean((await sb.rpc("is_recruiter")).data); } catch (_) { profileCache.recruiter = false; }
      }
      return { user: { id: s.user.id, email: s.user.email }, profile, recruiter: Boolean(profileCache && profileCache.recruiter) };
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT" || event === "USER_UPDATED" || event === "SIGNED_IN") profileCache = null;
        // Never call Supabase inside this callback directly (it can deadlock); defer.
        setTimeout(() => cb(event), 0);
      });
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, password) {
      profileCache = null;
      unwrap(await sb.auth.signInWithPassword({ email: String(email).trim(), password }));
      return api.getSession();
    },
    async signUp(email, password, fullName) {
      const data = unwrap(await sb.auth.signUp({
        email: String(email).trim(), password,
        options: { data: { full_name: fullName || "" }, emailRedirectTo: `${location.origin}/portal/` },
      }));
      return { needsConfirmation: !data.session };
    },
    async signOut() { profileCache = null; await sb.auth.signOut(); },
    async sendPasswordReset(email) {
      unwrap(await sb.auth.resetPasswordForEmail(String(email).trim(), { redirectTo: `${location.origin}/portal/?reset=1` }));
      return true;
    },
    async updatePassword(password) {
      unwrap(await sb.auth.updateUser({ password }));
      return true;
    },

    // ---------- Staff: articles ----------
    async adminListArticles() {
      const rows = unwrap(await sb.from("articles").select(CARD_COLUMNS).order("updated_at", { ascending: false }).limit(1000));
      return attach(rows);
    },
    async adminGetArticle(id) {
      const row = unwrap(await sb.from("articles").select("*").eq("id", id).maybeSingle());
      return row ? (await attach([row]))[0] : null;
    },
    async saveArticle(input) {
      const row = cleanArticle(input);
      if (!row.slug) row.slug = slugify(row.title) || uid().slice(0, 8);
      const q = input.id ? sb.from("articles").update(row).eq("id", input.id) : sb.from("articles").insert(row);
      const saved = unwrap(await q.select().single());
      return (await attach([saved]))[0];
    },
    async deleteArticle(id) {
      unwrap(await sb.from("articles").delete().eq("id", id));
    },
    async importArticles(rows, { onProgress } = {}) {
      let done = 0, inserted = 0, updated = 0;
      const failed = [];
      const existing = new Set((unwrap(await sb.from("articles").select("slug").limit(5000)) || []).map((r) => r.slug));
      for (let i = 0; i < rows.length; i += 20) {
        const chunk = rows.slice(i, i + 20).map(cleanArticle);
        const { error } = await sb.from("articles").upsert(chunk, { onConflict: "slug" });
        if (error) {
          // Retry one by one so a single bad row doesn't sink the batch.
          for (const r of chunk) {
            const res = await sb.from("articles").upsert(r, { onConflict: "slug" });
            if (res.error) failed.push({ slug: r.slug, error: res.error.message });
            else existing.has(r.slug) ? updated++ : inserted++;
          }
        } else {
          chunk.forEach((r) => (existing.has(r.slug) ? updated++ : inserted++));
        }
        done += chunk.length;
        if (onProgress) onProgress(done, rows.length);
      }
      return { inserted, updated, failed };
    },

    // ---------- Staff: authors ----------
    async saveAuthor(input) {
      const row = normalizeAuthor(pick(input, AUTHOR_FIELDS));
      row.slug = row.slug || slugify(row.name);
      const q = input.id ? sb.from("authors").update(row).eq("id", input.id) : sb.from("authors").insert(row);
      const saved = unwrap(await q.select().single());
      authorsPromise = null;
      return saved;
    },
    async deleteAuthor(id) {
      unwrap(await sb.from("authors").delete().eq("id", id));
      authorsPromise = null;
    },
    async importAuthors(list) {
      const rows = list.map((a) => normalizeAuthor(pick(a, AUTHOR_FIELDS)));
      unwrap(await sb.from("authors").upsert(rows, { onConflict: "slug" }));
      authorsPromise = null;
      return api.listAuthors();
    },

    // ---------- Admin ----------
    async listProfiles() {
      return unwrap(await sb.from("profiles").select("*").order("created_at", { ascending: false }));
    },
    async updateProfile(id, patch) {
      const saved = unwrap(await sb.from("profiles").update(pick(patch, ["role", "author_id", "full_name"])).eq("id", id).select().single());
      if (profileCache && profileCache.id === id) profileCache = null;
      return saved;
    },
    async listMessages() {
      return unwrap(await sb.from("messages").select("*").order("created_at", { ascending: false }).limit(1000));
    },
    async updateMessage(id, patch) {
      unwrap(await sb.from("messages").update(pick(patch, ["status", "stage"])).eq("id", id));
    },
    async deleteMessage(id) {
      unwrap(await sb.from("messages").delete().eq("id", id));
    },
    async listSubscribers() {
      const all = [];
      for (let from = 0; ; from += 1000) {
        const page = unwrap(await sb.from("subscribers").select("*").order("created_at", { ascending: false }).range(from, from + 999));
        all.push(...page);
        if (page.length < 1000) break;
      }
      return all;
    },
    async deleteSubscriber(id) {
      unwrap(await sb.from("subscribers").delete().eq("id", id));
    },
    async saveSetting(key, value) {
      unwrap(await sb.from("settings").upsert({ key, value }, { onConflict: "key" }));
    },
    async counts() {
      const now = nowISO();
      const head = (q) => q.then(({ count, error }) => (error ? 0 : count || 0));
      const a = () => sb.from("articles").select("id", { count: "exact", head: true });
      const s = await api.getSession();
      const r = s ? s.profile.role : "pending";
      const [published, scheduled, review, drafts, subscribers, newMessages, pending] = await Promise.all([
        head(a().eq("status", "published").lte("published_at", now)),
        head(a().eq("status", "published").gt("published_at", now)),
        head(a().eq("status", "review")),
        head(a().eq("status", "draft")),
        roleAtLeast(r, "admin") ? head(sb.from("subscribers").select("id", { count: "exact", head: true })) : 0,
        roleAtLeast(r, "editor") ? head(sb.from("messages").select("id", { count: "exact", head: true }).eq("status", "new")) : 0,
        roleAtLeast(r, "admin") ? head(sb.from("profiles").select("id", { count: "exact", head: true }).eq("role", "pending")) : 0,
      ]);
      const newApplications = s ? await head(sb.from("messages").select("id", { count: "exact", head: true }).eq("kind", "application").eq("stage", "new")) : 0;
      return { published, scheduled, review, drafts, subscribers, newMessages, pending, newApplications };
    },

    // ---------- Media (public bucket) ----------
    async uploadMedia(file) {
      if (!file.type.startsWith("image/")) throw new Error("Only images can be uploaded here.");
      const d = new Date();
      const path = `articles/${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${uid().slice(0, 8)}-${safeFileName(file.name)}`;
      unwrap(await sb.storage.from("media").upload(path, file, { cacheControl: "31536000", upsert: false, contentType: file.type }));
      return sb.storage.from("media").getPublicUrl(path).data.publicUrl;
    },

    // ---------- Member portal (private bucket) ----------
    async listPortalItems() {
      return unwrap(await sb.from("portal_items").select("*").order("event_date", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }));
    },
    async createPortalItem(meta, file) {
      const row = {
        title: meta.title, description: meta.description || null, collection: meta.collection || "General",
        event_date: meta.event_date || null, kind: file ? "file" : "link", url: file ? null : meta.url,
      };
      let path = null;
      if (file) {
        path = `${slugify(row.collection) || "general"}/${uid().slice(0, 8)}-${safeFileName(file.name)}`;
        unwrap(await sb.storage.from("portal").upload(path, file, { upsert: false, contentType: file.type || guessMime(file.name) }));
        Object.assign(row, { file_path: path, file_name: file.name, file_size: file.size, mime_type: file.type || guessMime(file.name) });
      }
      const { data, error } = await sb.from("portal_items").insert(row).select().single();
      if (error) {
        if (path) await sb.storage.from("portal").remove([path]);
        throw error;
      }
      return data;
    },
    async updatePortalItem(id, patch) {
      return unwrap(await sb.from("portal_items").update(pick(patch, ["title", "description", "collection", "event_date", "url"])).eq("id", id).select().single());
    },
    async deletePortalItem(item) {
      unwrap(await sb.from("portal_items").delete().eq("id", item.id));
      if (item.file_path) await sb.storage.from("portal").remove([item.file_path]);
    },
    async portalFileUrl(item, { download = false } = {}) {
      if (item.kind === "link") return item.url;
      const opts = download ? { download: item.file_name || true } : undefined;
      const data = unwrap(await sb.storage.from("portal").createSignedUrl(item.file_path, 60 * 60, opts));
      return data.signedUrl;
    },

    // ---------- Recruiting ----------
    async listInfoSessions() {
      return unwrap(await sb.rpc("info_sessions_public")) || [];
    },
    async registerForSession(sessionId, { name, email, year, note }) {
      return unwrap(await sb.rpc("register_for_session", { p_session: sessionId, p_name: name, p_email: email, p_year: year || null, p_note: note || null }));
    },
    async adminListInfoSessions() {
      const rows = unwrap(await sb.from("info_sessions").select("*, session_registrations(count)").order("starts_at", { ascending: false }));
      return (rows || []).map(({ session_registrations: c, ...rest }) => ({ ...rest, registered: (c && c[0] && c[0].count) || 0 }));
    },
    async saveInfoSession(input) {
      const row = pick(input, ["title", "description", "starts_at", "duration_min", "location", "join_url", "capacity", "is_published"]);
      const q = input.id ? sb.from("info_sessions").update(row).eq("id", input.id) : sb.from("info_sessions").insert(row);
      return unwrap(await q.select().single());
    },
    async deleteInfoSession(id) {
      unwrap(await sb.from("info_sessions").delete().eq("id", id));
    },
    async listRegistrations(sessionId) {
      return unwrap(await sb.from("session_registrations").select("*").eq("session_id", sessionId).order("created_at"));
    },
    async deleteRegistration(id) {
      unwrap(await sb.from("session_registrations").delete().eq("id", id));
    },
    async listRecruitingPeriods() {
      return unwrap(await sb.from("recruiting_periods").select("*").order("starts_on", { ascending: false })) || [];
    },
    async saveRecruitingPeriod(input) {
      const row = pick(input, ["title", "starts_on", "ends_on", "note"]);
      const q = input.id ? sb.from("recruiting_periods").update(row).eq("id", input.id) : sb.from("recruiting_periods").insert(row);
      return unwrap(await q.select().single());
    },
    async deleteRecruitingPeriod(id) {
      unwrap(await sb.from("recruiting_periods").delete().eq("id", id));
    },
    async updateMyByline(patch) {
      const s = await api.getSession();
      const id = s && s.profile.author_id;
      if (!id) throw new Error("Your account isn't linked to a byline yet. Ask an admin to link it in Members.");
      const saved = unwrap(await sb.from("authors").update(pick(patch, BYLINE_FIELDS)).eq("id", id).select().single());
      authorsPromise = null;
      return saved;
    },
  };
  return api;
}
