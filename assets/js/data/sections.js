// Sections and topic lines.
// Sections are the built-in list in config.js, plus Private Equity, plus whatever editors change in
// Admin → Sections (saved as the "sections" setting): renamed sections, sections hidden from the
// menu, and new ones. The list is cached in this browser so menus render without waiting, and it's
// refreshed every time settings load (see db.js).
const CACHE = "fj-sections-v1";

/** Sections added since the first release. Rename or hide them in Admin → Sections. */
const EXTRA_SECTIONS = [
  { slug: "private-equity", name: "Private Equity", description: "Buyouts, fund-raising, exits and the firms that own a growing share of the economy." },
];
/** More suggestions for the topic line in the editor. Writers can still type anything. */
const EXTRA_TOPICS = ["Private Equity", "Venture Capital", "Banking", "Real Estate", "Geopolitics", "Trade", "Labor Markets"];
const ACRONYMS = new Set(["pe", "vc", "ipo", "ipos", "esg", "ai", "tmt", "us", "uk", "eu", "fed", "ecb", "gdp", "lbo", "spac", "etf", "etfs", "fx", "ceo", "cfo", "m&a"]);
const SMALL = new Set(["and", "of", "the", "in", "on", "for", "to", "a"]);

let base = null;
let known = [];

/** Rebuilds config.sections in place from the built-in list and the saved overrides. */
export function applySections(config, saved) {
  if (!base) {
    base = config.sections.map((s) => ({ ...s, core: true }));
    for (const x of EXTRA_SECTIONS) if (!base.some((s) => s.slug === x.slug)) base.push({ ...x, core: true });
    for (const t of EXTRA_TOPICS) if (!config.topics.includes(t)) config.topics.push(t);
  }
  const out = base.map((s) => ({ ...s, nav: s.nav !== false }));
  for (const e of Array.isArray(saved) ? saved : []) {
    if (!e || !e.slug || ["learn", "latest"].includes(e.slug)) continue;
    const name = String(e.name || "").trim();
    const hit = out.find((s) => s.slug === e.slug);
    if (hit) {
      if (name) hit.name = name;
      if (typeof e.description === "string") hit.description = e.description;
      hit.nav = e.nav !== false;
    } else if (name) {
      out.push({ slug: e.slug, name, description: e.description || "", nav: e.nav !== false, core: false });
    }
  }
  config.sections.splice(0, config.sections.length, ...out);
  known = [...new Set([...config.topics, ...((config.learn && config.learn.topics) || []), ...out.map((s) => s.name)])];
}
export const builtInSlugs = () => new Set((base || []).map((s) => s.slug));
export function readSectionCache() {
  try { return JSON.parse(localStorage.getItem(CACHE) || "null"); } catch (_) { return null; }
}
export function writeSectionCache(value) {
  try { localStorage.setItem(CACHE, JSON.stringify(Array.isArray(value) ? value : [])); } catch (_) { /* private mode */ }
}

/** "private-equity" → "Private Equity", "m-a-restructuring" → "M&A Restructuring". */
export function prettify(slug) {
  const s = String(slug || "").trim().toLowerCase().replace(/^m-a(?=-|$)/, "m&a");
  return s.split(/[-_\s]+/).filter(Boolean)
    .map((w, i) => (ACRONYMS.has(w) ? w.toUpperCase() : i && SMALL.has(w) ? w : w[0].toUpperCase() + w.slice(1))).join(" ");
}
const key = (s) => String(s || "").toLowerCase().replace(/&/g, " ").replace(/\band\b/g, " ").replace(/[^a-z0-9]+/g, "");

/**
 * The topic line as readers should see it. Topics imported from Framer are sometimes web
 * addresses (m-a-restructuring); those become the matching known topic (M&A and Restructuring),
 * or a tidied version of the words. Anything already written as a label is left alone.
 */
export function topicLabel(t) {
  const v = String(t || "").trim();
  if (!v) return "";
  if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(v)) return v;
  const k = key(v);
  return known.find((x) => key(x) === k) || prettify(v);
}
