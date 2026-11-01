// Small helpers shared by every page. No dependencies.

const SAFE = Symbol("safe-html");

/** Mark a string as already-safe HTML. */
export function raw(value) {
  return { [SAFE]: true, value: String(value ?? "") };
}

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function render(v) {
  if (v === null || v === undefined || v === false || v === true) return "";
  if (Array.isArray(v)) return v.map(render).join("");
  if (typeof v === "object" && v[SAFE]) return v.value;
  return esc(v);
}

/** Tagged template that escapes every interpolated value unless it is raw()/html``. */
export function html(strings, ...values) {
  let out = "";
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += render(values[i]);
  });
  return raw(out);
}

export const toHTML = (v) => render(v);

export function mount(el, content) {
  if (typeof el === "string") el = document.querySelector(el);
  if (el) el.innerHTML = render(content);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Allow only http(s), mailto, tel, data:image and site-relative URLs. */
export function safeUrl(url) {
  const u = String(url ?? "").trim();
  if (!u) return "";
  if (u.startsWith("/") && !u.startsWith("//")) return u;
  if (/^data:image\/(png|jpe?g|gif|webp|avif);base64,/i.test(u)) return u;
  try {
    const parsed = new URL(u, location.origin);
    if (["http:", "https:", "mailto:", "tel:", "blob:"].includes(parsed.protocol)) return u;
  } catch (_) { /* fall through */ }
  return "";
}

// ---------- Dates ----------
export function fmtDate(value, opts) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", opts || { month: "short", day: "numeric", year: "numeric" });
}
export function fmtDateTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
export function fmtLongDate(d = new Date()) {
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
export function timeAgo(value) {
  const d = new Date(value);
  const s = (Date.now() - d.getTime()) / 1000;
  if (Number.isNaN(s)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(d);
}
/** Value for <input type="datetime-local"> in the reader's timezone. */
export function toLocalInput(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalInput(str) {
  if (!str) return null;
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ---------- Text ----------
export function slugify(s) {
  return String(s || "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'"`]/g, "")
    .replace(/&/g, " and ")
    .replace(/\$/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90)
    .replace(/-+$/g, "");
}
export function plainText(md) {
  return String(md || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\^[^\]]+\]:?/g, " ")
    .replace(/[#>*_~`|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function wordCount(md) {
  const t = plainText(md);
  return t ? t.split(" ").length : 0;
}
export function readMinutes(md) {
  return Math.max(1, Math.round(wordCount(md) / 230));
}
export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "F";
  const first = parts[0][0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}
export function truncate(s, n = 160) {
  const t = String(s || "");
  return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : t;
}
export function fmtBytes(n) {
  if (!n && n !== 0) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v < 10 && i ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}
export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
export function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || "").trim());
}
export function params() {
  return new URLSearchParams(location.search);
}
/** Last path segment after a prefix: /articles/<slug> → slug. Falls back to ?slug= */
export function routeParam(prefix, key = "slug") {
  const q = params().get(key);
  if (q) return q;
  const path = location.pathname.replace(/\/+$/, "");
  if (path.startsWith(prefix + "/")) {
    try { return decodeURIComponent(path.slice(prefix.length + 1)); } catch (_) { return path.slice(prefix.length + 1); }
  }
  return "";
}

// ---------- Deterministic randomness for cover art ----------
export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TONES = {
  night: { bg: "#0c1814", grid: "#1b2c25", fill: "rgba(98,201,161,0.13)", line: "#62c9a1" },
  ledger: { bg: "#0a5c44", grid: "#11694f", fill: "rgba(255,255,255,0.09)", line: "#ffffff" },
  paper: { bg: "#eef0ec", grid: "#dde1da", fill: "rgba(10,92,68,0.09)", line: "#0a5c44" },
  ink: { bg: "#141716", grid: "#252a28", fill: "rgba(255,255,255,0.07)", line: "#eef2ef" },
};
const SECTION_TONE = {
  markets: "night", "business-deals": "ledger", policy: "paper", opinion: "ink",
  "future-outlook": "night", "history-parallels": "paper", learn: "ledger",
};

/**
 * A unique, deterministic "price line" illustration for stories without a photo.
 * Same slug → same picture, everywhere.
 */
export function coverArt(seed, section) {
  const tone = TONES[SECTION_TONE[section] || ["night", "ledger", "paper", "ink"][hash(seed || "x") % 4]];
  const rnd = mulberry32(hash(seed || "fershman"));
  const W = 600, H = 400, n = 34;
  let y = H * (0.45 + rnd() * 0.2);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const shock = rnd() < 0.08 ? (rnd() - 0.5) * 120 : 0;
    y += (rnd() - 0.47) * 38 + shock;
    y = Math.max(70, Math.min(H - 50, y));
    pts.push([(i * W) / (n - 1), y]);
  }
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  let grid = "";
  for (let gy = 50; gy < H; gy += 50) grid += `<line x1="0" y1="${gy}" x2="${W}" y2="${gy}" stroke="${tone.grid}" stroke-width="1"/>`;
  for (let gx = 75; gx < W; gx += 75) grid += `<line x1="${gx}" y1="0" x2="${gx}" y2="${H}" stroke="${tone.grid}" stroke-width="1"/>`;
  const last = pts[pts.length - 1];
  return raw(`<svg class="cover-art" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><rect width="${W}" height="${H}" fill="${tone.bg}"/>${grid}<path d="${area}" fill="${tone.fill}"/><path d="${line}" fill="none" stroke="${tone.line}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${last[0] - 2}" cy="${last[1]}" r="5" fill="${tone.line}"/></svg>`);
}

// ---------- Icons (24×24, stroke = currentColor) ----------
const P = (d, extra = "") => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" ${extra}>${d}</svg>`;
const ICONS = {
  search: P('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
  menu: P('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  close: P('<path d="M6 6l12 12M18 6 6 18"/>'),
  x: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.3L5.3 21H2.2l7.2-8.3L1.8 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z"/></svg>',
  linkedin: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9.75h4V21H3V9.75Zm6.5 0h3.8v1.6h.05c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.78 2.65 4.78 6.1V21h-4v-4.95c0-1.18-.02-2.7-1.65-2.7-1.65 0-1.9 1.29-1.9 2.62V21h-4V9.75Z"/></svg>',
  instagram: P('<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="0.6" fill="currentColor"/>'),
  link: P('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  mail: P('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>'),
  check: P('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  download: P('<path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14"/>'),
  upload: P('<path d="M12 16V5m0 0L7.5 9.5M12 5l4.5 4.5M5 20h14"/>'),
  file: P('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/>'),
  slides: P('<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M12 16v4M8 20h8"/>'),
  video: P('<rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3"/>'),
  image: P('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="m21 16-5.5-5.5L5 20"/>'),
  external: P('<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  trash: P('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
  edit: P('<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>'),
  eye: P('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>'),
  star: P('<path d="m12 3.8 2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.7l-5.1 2.7 1-5.6-4.1-4 5.7-.8L12 3.8Z"/>'),
  logout: P('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 16l-4-4 4-4M6 12h10"/>'),
  folder: P('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>'),
  user: P('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
  users: P('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1.2-3.5 3.6-5.2 6.5-5.2s5.3 1.7 6.5 5.2"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.9c1.6.7 2.8 2.4 3.5 5.1"/>'),
  inbox: P('<path d="M3 13h5l1.5 3h5l1.5-3h5"/><path d="M5.5 5h13L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5l2.5-8Z"/>'),
  settings: P('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
  home: P('<path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1v-8Z"/>'),
  doc: P('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'),
  book: P('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z"/><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20"/>'),
  lock: P('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>'),
  sun: P('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>'),
  moon: P('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>'),
  bold: P('<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7V5ZM7 12h7a3.5 3.5 0 0 1 0 7H7v-7Z"/>'),
  italic: P('<path d="M14 5h-4M14 19h-4M14.5 5l-5 14"/>'),
  quote: P('<path d="M7 7h4v4c0 3-1.5 5-4 6M15 7h4v4c0 3-1.5 5-4 6"/>'),
  listUl: P('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".9" fill="currentColor"/><circle cx="4.5" cy="12" r=".9" fill="currentColor"/><circle cx="4.5" cy="18" r=".9" fill="currentColor"/>'),
  listOl: P('<path d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1v5M3.8 13.5c.4-.9 2.6-1 2.4.4-.1.8-2.4 1.8-2.4 3.1h2.6"/>'),
  table: P('<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>'),
  hr: P('<path d="M4 12h16"/>'),
  footnote: P('<path d="M5 18V8l-2 1.5M10 18l4-11 4 11M11.3 14.5h5.4"/>'),
  heading: P('<path d="M6 5v14M18 5v14M6 12h12"/>'),
  chart: P('<path d="M4 4v16h16"/><path d="m7 14 3.5-4 3 3L19 7"/>'),
  copy: P('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>'),
  calendar: P('<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  more: P('<circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/>'),
  chevronDown: P('<path d="m6 9 6 6 6-6"/>'),
  chevronLeft: P('<path d="m15 6-6 6 6 6"/>'),
  globe: P('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3Z"/>'),
  send: P('<path d="M21 3 10 14M21 3l-7 18-4-7-7-4 18-7Z"/>'),
  grid: P('<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>'),
  printer: P('<path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="7" rx="1"/>'),
  refresh: P('<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4"/>'),
  key: P('<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>'),
};
export function icon(name) {
  return raw(ICONS[name] || "");
}
