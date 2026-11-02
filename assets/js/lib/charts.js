// Interactive charts for articles.
//
// Writers add a fenced ```chart block to an article (the editor's Chart button builds one):
//
//   ```chart
//   type: line                      line | area | bar | stacked | hbar | scatter
//   title: Margin debt hit a record
//   subtitle: Trillions of dollars
//   source: FINRA
//   prefix: $                       number format (also: suffix, decimals)
//   ranges: 1Y, 5Y, All             range buttons for time series
//   mark: 2020-03 | Pandemic        vertical marker (repeatable)
//   ref: 2 | Fed target             horizontal reference line (repeatable)
//   highlight: Margin debt          emphasize series, gray the rest
//   ---
//   Date,Margin debt
//   2020-01,0.56
//   ```
//
// md.js turns each block into <figure class="fj-chart"> holding the source; hydrateCharts() renders
// it as SVG with a crosshair or per-bar tooltip, keyboard navigation, legend toggles, a data table
// and a CSV download. Colors come from CSS variables (--viz-1 … --viz-6) validated for color-vision
// deficiency in light and dark mode.

const SVGNS = "http://www.w3.org/2000/svg";
export const TYPES = ["line", "area", "bar", "stacked", "hbar", "scatter"];
export const TYPE_LABELS = { line: "Line", area: "Area", bar: "Columns", stacked: "Stacked columns", hbar: "Bars", scatter: "Scatter" };
const TYPE_ALIASES = {
  line: "line", lines: "line", area: "area", bar: "bar", bars: "bar", column: "bar", columns: "bar",
  stacked: "stacked", "stacked bar": "stacked", "stacked bars": "stacked", "stacked columns": "stacked", "stacked-bar": "stacked",
  hbar: "hbar", "horizontal bar": "hbar", "horizontal bars": "hbar", ranking: "hbar", scatter: "scatter", dots: "scatter",
};
export const MAX_SERIES = 6;
const MAX_MUTED_SERIES = 12;
const MAX_GROUPS = 3;
const KEYS = new Set(["type", "title", "subtitle", "source", "note", "prefix", "suffix", "decimals", "ymin", "ymax", "min", "max", "ranges", "range", "mark", "marker", "ref", "reference", "highlight", "labels", "label"]);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS = {};
MONTH_FULL.forEach((m, i) => { MONTHS[m.toLowerCase()] = i; MONTHS[m.slice(0, 3).toLowerCase()] = i; });
MONTHS.sept = 8;

// ---------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------

/** Parse one CSV/TSV line, honoring "quoted, cells" and "" escapes. */
function splitLine(line, delim) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"' && !cur.trim()) { q = true; cur = ""; }
    else if (c === delim) { out.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}
function detectDelimiter(line) {
  if (line.includes("\t")) return "\t";
  if (line.includes(";") && !line.includes(",")) return ";";
  return ",";
}

/** Parse a data cell. Returns a number, null for an empty/missing cell, or NaN when unreadable. */
export function parseNumber(raw) {
  let s = String(raw ?? "").trim();
  if (!s || /^(?:-|–|—|n\/?a|na|nan|null|\.\.)$/i.test(s)) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/ /g, " ").replace(/[−–]/g, "-").replace(/[\s,$€£¥]/g, "").replace(/(%|x|bps?)$/i, "");
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(s)) return NaN;
  const v = parseFloat(s);
  return neg ? -v : v;
}
function decimalsOf(raw) {
  const m = String(raw).replace(/[^\d.]/g, "").match(/\.(\d+)/);
  return m ? m[1].length : 0;
}

/** Parse a date-like cell. Returns { t (UTC ms), g: "year"|"quarter"|"month"|"day" } or null. */
export function parseDate(raw) {
  const s = String(raw ?? "").trim();
  let m;
  const ok = (y, mo, d) => y >= 1000 && y <= 2999 && mo >= 0 && mo <= 11 && d >= 1 && d <= 31;
  if ((m = s.match(/^(\d{4})$/))) { const y = +m[1]; return y >= 1000 && y <= 2999 ? { t: Date.UTC(y, 0, 1), g: "year" } : null; }
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})$/))) { const y = +m[1], mo = +m[2] - 1; return ok(y, mo, 1) ? { t: Date.UTC(y, mo, 1), g: "month" } : null; }
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/))) { const y = +m[1], mo = +m[2] - 1, d = +m[3]; return ok(y, mo, d) ? { t: Date.UTC(y, mo, d), g: "day" } : null; }
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/))) {
    let y = +m[3]; if (y < 100) y += y < 70 ? 2000 : 1900;
    const mo = +m[1] - 1, d = +m[2];
    return ok(y, mo, d) ? { t: Date.UTC(y, mo, d), g: "day" } : null;
  }
  if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{4})$/)) && m[1].toLowerCase() in MONTHS) return { t: Date.UTC(+m[2], MONTHS[m[1].toLowerCase()], 1), g: "month" };
  if ((m = s.match(/^([A-Za-z]{3})[-\s]['’]?(\d{2})$/)) && m[1].toLowerCase() in MONTHS) return { t: Date.UTC(2000 + +m[2], MONTHS[m[1].toLowerCase()], 1), g: "month" };
  if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/)) && m[1].toLowerCase() in MONTHS) {
    const y = +m[3], mo = MONTHS[m[1].toLowerCase()], d = +m[2];
    return ok(y, mo, d) ? { t: Date.UTC(y, mo, d), g: "day" } : null;
  }
  if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/)) && m[2].toLowerCase() in MONTHS) {
    const y = +m[3], mo = MONTHS[m[2].toLowerCase()], d = +m[1];
    return ok(y, mo, d) ? { t: Date.UTC(y, mo, d), g: "day" } : null;
  }
  if ((m = s.match(/^Q([1-4])\s*['’]?(\d{2}|\d{4})$/i)) || (m = s.match(/^(\d{4})\s*-?\s*Q([1-4])$/i))) {
    const q = /^Q/i.test(s) ? +m[1] : +m[2];
    let y = /^Q/i.test(s) ? +m[2] : +m[1];
    if (y < 100) y += 2000;
    return { t: Date.UTC(y, (q - 1) * 3, 1), g: "quarter" };
  }
  return null;
}

const G_ORDER = { year: 0, quarter: 1, month: 2, day: 3 };

export function fmtDate(t, g, style = "full") {
  const d = new Date(t);
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (g === "year") return String(y);
  if (g === "quarter") return `Q${Math.floor(m / 3) + 1} ${y}`;
  if (g === "month") return style === "full" ? `${MONTH_FULL[m]} ${y}` : `${MON[m]} ${y}`;
  return style === "full" ? `${MON[m]} ${d.getUTCDate()}, ${y}` : `${MON[m]} ${d.getUTCDate()}`;
}

/** Turn chart source text into { spec, columns, rows, x, series, points, errors, warnings }. */
export function parseChart(src) {
  const text = String(src || "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const spec = {
    type: "line", title: "", subtitle: "", source: "", note: "", prefix: "", suffix: "", decimals: null,
    ymin: null, ymax: null, ranges: [], marks: [], refs: [], highlight: [], labels: [], set: new Set(),
  };
  const errors = [], warnings = [];

  // Header: "key: value" lines, ended by a --- line (or by the first line that isn't a setting).
  let sep = lines.findIndex((l) => /^\s*-{3,}\s*$/.test(l));
  let i = 0;
  const headerLines = [];
  if (sep >= 0) { headerLines.push(...lines.slice(0, sep)); i = sep + 1; }
  else {
    while (i < lines.length) {
      const l = lines[i];
      const m = l.match(/^\s*([A-Za-z][A-Za-z ]{0,20}?)\s*:\s*(.*)$/);
      if (!l.trim()) { i++; continue; }
      if (m && KEYS.has(m[1].toLowerCase())) { headerLines.push(l); i++; continue; }
      break;
    }
  }
  for (const l of headerLines) {
    if (!l.trim() || /^\s*#/.test(l)) continue;
    const m = l.match(/^\s*([A-Za-z][A-Za-z ]{0,20}?)\s*:\s*(.*)$/);
    if (!m) { warnings.push(`Ignored a line in the settings: "${l.trim().slice(0, 40)}"`); continue; }
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (!KEYS.has(key)) { warnings.push(`Unknown setting "${m[1]}"`); continue; }
    spec.set.add(key);
    switch (key) {
      case "type": {
        const t = TYPE_ALIASES[val.toLowerCase()];
        if (t) spec.type = t; else errors.push(`Unknown chart type "${val}". Use one of: ${TYPES.join(", ")}.`);
        break;
      }
      case "title": case "subtitle": case "source": case "note": spec[key] = val; break;
      case "prefix": case "suffix": spec[key] = val.replace(/^["']|["']$/g, ""); break;
      case "decimals": { const d = parseInt(val, 10); if (val && !Number.isNaN(d)) spec.decimals = Math.max(0, Math.min(4, d)); break; }
      case "ymin": case "min": { const v = parseNumber(val); if (typeof v === "number" && !Number.isNaN(v)) spec.ymin = v; break; }
      case "ymax": case "max": { const v = parseNumber(val); if (typeof v === "number" && !Number.isNaN(v)) spec.ymax = v; break; }
      case "ranges": case "range": spec.ranges = val.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean); break;
      case "mark": case "marker": { const [x, ...rest] = val.split("|"); if (x.trim()) spec.marks.push({ x: x.trim(), label: rest.join("|").trim() }); break; }
      case "ref": case "reference": {
        const [y, ...rest] = val.split("|");
        const v = parseNumber(y);
        if (typeof v === "number" && !Number.isNaN(v)) spec.refs.push({ y: v, label: rest.join("|").trim() });
        else warnings.push(`Reference line "${val}" needs a number first, like "2 | Target".`);
        break;
      }
      case "highlight": spec.highlight = val.split(",").map((x) => x.trim()).filter(Boolean); break;
      case "labels": case "label": spec.labels = val.split(",").map((x) => x.trim()).filter(Boolean); break;
    }
  }

  // Data
  const dataLines = lines.slice(i).filter((l) => l.trim());
  const out = { spec, columns: [], rows: [], x: null, series: [], points: [], groups: [], errors, warnings, decimals: 0, hints: { prefix: "", suffix: "" } };
  if (!dataLines.length) { errors.push("Add the data: a header row, then one row per date or category."); return out; }
  const delim = detectDelimiter(dataLines[0]);
  const columns = splitLine(dataLines[0], delim).map((c, k) => c || (k ? `Series ${k}` : ""));
  const rows = dataLines.slice(1).map((l) => { const r = splitLine(l, delim); while (r.length < columns.length) r.push(""); return r.slice(0, columns.length); });
  out.columns = columns; out.rows = rows;
  if (columns.length < 2) { errors.push("The data needs at least two columns: dates or categories first, then values."); return out; }
  if (!rows.length) { errors.push("The data has a header row but no values yet."); return out; }

  // Formatting hints from the raw cells ($, %, x)
  const cells = rows.flatMap((r) => r.slice(1)).filter((c) => c && c.trim());
  const share = (re) => cells.length ? cells.filter((c) => re.test(c.trim())).length / cells.length : 0;
  if (share(/^\(?-?[$]/) > 0.5) out.hints.prefix = "$";
  if (share(/%\)?$/) > 0.5) out.hints.suffix = "%";
  else if (share(/x\)?$/i) > 0.5) out.hints.suffix = "x";
  else if (share(/bps?\)?$/i) > 0.5) out.hints.suffix = " bp";

  const numberCell = (raw, r, colName) => {
    const v = parseNumber(raw);
    if (Number.isNaN(v)) {
      if (errors.length < 5) {
        errors.push(/^[\s($€£¥-]*[\d.,]+\s*(k|m|mm|bn|b|t|tn|tr)\)?$/i.test(String(raw).trim())
          ? `Row ${r + 2}: "${raw}" in "${colName}". Use plain numbers (like 1.5) and put the unit in Suffix.`
          : `Row ${r + 2}: "${raw}" in "${colName}" isn't a number.`);
      }
      return null;
    }
    if (v !== null) out.decimals = Math.max(out.decimals, Math.min(3, decimalsOf(raw)));
    return v;
  };

  if (spec.type === "scatter") {
    if (columns.length < 3) { errors.push("A scatter chart needs three columns: a label, the x value, then the y value (a fourth column can name groups)."); return out; }
    const groups = [];
    rows.forEach((r, k) => {
      const x = numberCell(r[1], k, columns[1]);
      const y = numberCell(r[2], k, columns[2]);
      const group = columns.length > 3 ? (r[3] || "").trim() : "";
      if (group && !groups.includes(group)) groups.push(group);
      if (x !== null && y !== null) out.points.push({ label: r[0], x, y, group, i: k });
    });
    if (groups.length > MAX_GROUPS) errors.push(`Use up to ${MAX_GROUPS} groups in a scatter chart so every group stays tellable apart (this one has ${groups.length}). Fold the rest into "Other".`);
    out.groups = groups;
    out.xName = columns[1]; out.yName = columns[2];
    if (!out.points.length && !errors.length) errors.push("None of the rows has both an x and a y value.");
    return out;
  }

  // x column: dates (time axis for line and area) or categories
  const parsedX = rows.map((r) => parseDate(r[0]));
  const allDates = parsedX.every(Boolean);
  if (allDates) {
    const g = parsedX.reduce((acc, p) => (G_ORDER[p.g] > G_ORDER[acc] ? p.g : acc), "year");
    out.x = { kind: "time", t: parsedX.map((p) => p.t), g, raw: rows.map((r) => r[0]) };
    // keep rows in date order
    const order = out.x.t.map((t, k) => k).sort((a, b) => out.x.t[a] - out.x.t[b]);
    if (order.some((v, k) => v !== k)) {
      out.rows = order.map((k) => rows[k]);
      out.x.t = order.map((k) => parsedX[k].t);
      out.x.raw = order.map((k) => rows[k][0]);
    }
  } else {
    out.x = { kind: "cat", raw: rows.map((r) => r[0]) };
  }
  if (spec.type !== "line" && spec.type !== "area" && out.x.kind === "time") out.x.band = true;

  const hl = spec.highlight.map((h) => h.toLowerCase());
  const seriesCols = columns.slice(1);
  const limit = hl.length ? MAX_MUTED_SERIES : MAX_SERIES;
  if (seriesCols.length > limit) {
    errors.push(hl.length
      ? `Up to ${MAX_MUTED_SERIES} series per chart (this one has ${seriesCols.length}).`
      : `Up to ${MAX_SERIES} series per chart (this one has ${seriesCols.length}). Split it into two charts, or highlight the ones that matter and the rest turn gray.`);
  }
  let slot = 0;
  out.series = seriesCols.slice(0, limit).map((name, k) => {
    const muted = hl.length > 0 && !hl.includes(name.toLowerCase());
    const s = { name, values: out.rows.map((r, ri) => numberCell(r[k + 1], ri, name)), slot: muted ? 0 : Math.min(++slot, MAX_SERIES), key: k };
    return s;
  });
  if (hl.length && !out.series.some((s) => s.slot)) warnings.push(`Highlight "${spec.highlight.join(", ")}" doesn't match a column name.`);
  if (out.series.every((s) => s.values.every((v) => v === null)) && !errors.length) errors.push("There are no numbers in the data yet.");
  if ((spec.type === "hbar" || spec.type === "bar" || spec.type === "stacked") && out.rows.length > 60) warnings.push("That's a lot of bars. A line chart may read better.");
  return out;
}

/** Build chart source text from settings and a data table. */
export function stringifyChart(spec, columns, rows) {
  const lines = [];
  const add = (k, v) => { if (v !== undefined && v !== null && String(v).trim() !== "") lines.push(`${k}: ${v}`); };
  add("type", spec.type || "line");
  add("title", spec.title); add("subtitle", spec.subtitle); add("source", spec.source); add("note", spec.note);
  add("prefix", spec.prefix); add("suffix", spec.suffix);
  if (spec.decimals !== null && spec.decimals !== undefined && spec.decimals !== "") add("decimals", spec.decimals);
  if (spec.ymin !== null && spec.ymin !== undefined && spec.ymin !== "") add("ymin", spec.ymin);
  if (spec.ymax !== null && spec.ymax !== undefined && spec.ymax !== "") add("ymax", spec.ymax);
  if (spec.ranges && spec.ranges.length) add("ranges", spec.ranges.join(", "));
  if (spec.highlight && spec.highlight.length) add("highlight", spec.highlight.join(", "));
  if (spec.labels && spec.labels.length) add("labels", spec.labels.join(", "));
  for (const m of spec.marks || []) add("mark", m.label ? `${m.x} | ${m.label}` : m.x);
  for (const r of spec.refs || []) add("ref", r.label ? `${r.y} | ${r.label}` : r.y);
  const q = (c) => (/[",\n]/.test(c) ? `"${String(c).replace(/"/g, '""')}"` : String(c));
  lines.push("---");
  lines.push(columns.map(q).join(","));
  for (const r of rows) lines.push(r.map((c) => q(c ?? "")).join(","));
  return lines.join("\n");
}

/** Read pasted data (CSV, TSV from Sheets/Excel, semicolons) into columns and rows. */
export function readTable(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim());
  if (!lines.length) return { columns: [], rows: [] };
  const delim = detectDelimiter(lines[0]);
  const columns = splitLine(lines[0], delim);
  const rows = lines.slice(1).map((l) => splitLine(l, delim));
  return { columns, rows };
}

// ---------------------------------------------------------------------------------------------
// Formatting & scales
// ---------------------------------------------------------------------------------------------

function fmtNum(v, { decimals = null, prefix = "", suffix = "", compact = false } = {}) {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  const neg = v < 0;
  let a = Math.abs(v), unit = "";
  if (compact && a >= 1e4) {
    for (const [d, u] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]]) if (a >= d) { a /= d; unit = u; break; }
  }
  const dec = decimals === null ? (unit ? (a < 10 ? 1 : 0) : a !== 0 && a < 1 ? 2 : a < 10 && a % 1 ? 1 : 0) : decimals;
  const s = a.toLocaleString("en-US", { minimumFractionDigits: unit ? 0 : dec, maximumFractionDigits: dec });
  return (neg && +s.replace(/[^\d.]/g, "") !== 0 ? "−" : "") + prefix + s + unit + suffix;
}

function niceStep(range, count) {
  const raw = range / Math.max(1, count);
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 2.25 ? 2 : f < 3.5 ? 2.5 : f < 7.5 ? 5 : 10) * p;
}
function stepDecimals(step) {
  const e = Math.floor(Math.log10(step));
  const mant = Math.round((step / 10 ** e) * 100) / 100;
  return Math.max(0, -e + (mant === 2.5 ? 1 : 0));
}
function niceScale(lo, hi, count) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
  if (lo === hi) { if (lo === 0) hi = 1; else { const d = Math.abs(lo) * 0.1; lo -= d; hi += d; } }
  const step = niceStep(hi - lo, count);
  const nlo = Math.floor(lo / step + 1e-9) * step, nhi = Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  for (let v = nlo, k = 0; v <= nhi + step * 1e-6 && k < 40; v += step, k++) ticks.push(Math.round(v / step) * step);
  return { lo: nlo, hi: nhi, step, ticks, dec: stepDecimals(step) };
}

let measureCtx = null;
function textWidth(s, size = 12, weight = 500) {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  measureCtx.font = `${weight} ${size}px "Schibsted Grotesk", ui-sans-serif, system-ui, sans-serif`;
  return measureCtx.measureText(String(s)).width;
}

const TIME_STEPS = [
  { u: "d", n: 1 }, { u: "d", n: 2 }, { u: "d", n: 7 }, { u: "d", n: 14 },
  { u: "m", n: 1 }, { u: "m", n: 2 }, { u: "m", n: 3 }, { u: "m", n: 6 },
  { u: "y", n: 1 }, { u: "y", n: 2 }, { u: "y", n: 5 }, { u: "y", n: 10 }, { u: "y", n: 20 }, { u: "y", n: 25 }, { u: "y", n: 50 }, { u: "y", n: 100 },
];
function genTicks(t0, t1, st) {
  const out = [];
  const d0 = new Date(t0);
  if (st.u === "y") {
    let y = Math.ceil(d0.getUTCFullYear() / st.n) * st.n;
    if (Date.UTC(y, 0, 1) < t0) y += st.n;
    for (let t = Date.UTC(y, 0, 1); t <= t1 && out.length < 200; y += st.n, t = Date.UTC(y, 0, 1)) out.push(t);
  } else if (st.u === "m") {
    let mi = d0.getUTCFullYear() * 12 + d0.getUTCMonth();
    if (Date.UTC(Math.floor(mi / 12), mi % 12, 1) < t0) mi++;
    mi = Math.ceil(mi / st.n) * st.n;
    for (let t = Date.UTC(Math.floor(mi / 12), mi % 12, 1); t <= t1 && out.length < 400; mi += st.n, t = Date.UTC(Math.floor(mi / 12), mi % 12, 1)) out.push(t);
  } else {
    let t = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate());
    if (t < t0) t += 864e5;
    for (; t <= t1 && out.length < 400; t += st.n * 864e5) out.push(t);
  }
  return out;
}
function tickLabel(t, st, first, g) {
  const d = new Date(t);
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (st.u === "y") return String(y);
  if (st.u === "m" && g === "quarter") return m === 0 || first ? `Q${Math.floor(m / 3) + 1} ${y}` : `Q${Math.floor(m / 3) + 1}`;
  if (st.u === "m") return m === 0 || first ? `${MON[m]} ${y}` : MON[m];
  return `${MON[m]} ${d.getUTCDate()}`;
}
/** Pick calendar-aligned ticks whose labels don't collide. */
function timeTicks(t0, t1, x, g) {
  for (const st of TIME_STEPS) {
    if (g === "year" && st.u !== "y") continue;
    if ((g === "month" || g === "quarter") && st.u === "d") continue;
    if (g === "quarter" && st.u === "m" && st.n < 3) continue;
    const ts = genTicks(t0, t1, st);
    if (ts.length > 60) continue;
    const labels = ts.map((t, k) => tickLabel(t, st, k === 0, g));
    let fits = true;
    for (let k = 1; k < ts.length && fits; k++) {
      const gap = x(ts[k]) - x(ts[k - 1]);
      if (gap < (textWidth(labels[k]) + textWidth(labels[k - 1])) / 2 + 14) fits = false;
    }
    if (fits && ts.length >= 1) return ts.map((t, k) => ({ t, label: labels[k] }));
  }
  return [{ t: t0, label: tickLabel(t0, { u: "y" }, true) }];
}

function rangeStart(token, lastT, firstT) {
  const tok = String(token).toUpperCase();
  const d = new Date(lastT);
  if (tok === "ALL" || tok === "MAX") return firstT;
  if (tok === "YTD") return Date.UTC(d.getUTCFullYear(), 0, 1);
  const m = tok.match(/^(\d+)\s*([DWMY])$/);
  if (!m) return null;
  const n = +m[1];
  if (m[2] === "D") return lastT - n * 864e5;
  if (m[2] === "W") return lastT - n * 7 * 864e5;
  if (m[2] === "M") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, d.getUTCDate());
  return Date.UTC(d.getUTCFullYear() - n, d.getUTCMonth(), d.getUTCDate());
}

// ---------------------------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------------------------

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else n.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids) if (kid !== null && kid !== undefined && kid !== false) n.append(kid);
  return n;
}
function sv(tag, attrs = {}, text) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
}
const r1 = (v) => Math.round(v * 10) / 10;

/** Column/bar path with a 4px rounded data end and a square baseline. */
function barPath(x, y, w, h, dir) {
  // dir: "up" (rounded top), "down" (rounded bottom), "right" (rounded right), "left" (rounded left)
  if (w <= 0 || h <= 0) return "";
  const r = Math.min(4, w / 2, h / 2);
  if (dir === "up") return `M${r1(x)},${r1(y + h)}V${r1(y + r)}Q${r1(x)},${r1(y)} ${r1(x + r)},${r1(y)}H${r1(x + w - r)}Q${r1(x + w)},${r1(y)} ${r1(x + w)},${r1(y + r)}V${r1(y + h)}Z`;
  if (dir === "down") return `M${r1(x)},${r1(y)}V${r1(y + h - r)}Q${r1(x)},${r1(y + h)} ${r1(x + r)},${r1(y + h)}H${r1(x + w - r)}Q${r1(x + w)},${r1(y + h)} ${r1(x + w)},${r1(y + h - r)}V${r1(y)}Z`;
  if (dir === "right") return `M${r1(x)},${r1(y)}H${r1(x + w - r)}Q${r1(x + w)},${r1(y)} ${r1(x + w)},${r1(y + r)}V${r1(y + h - r)}Q${r1(x + w)},${r1(y + h)} ${r1(x + w - r)},${r1(y + h)}H${r1(x)}Z`;
  if (dir === "left") return `M${r1(x + w)},${r1(y)}H${r1(x + r)}Q${r1(x)},${r1(y)} ${r1(x)},${r1(y + r)}V${r1(y + h - r)}Q${r1(x)},${r1(y + h)} ${r1(x + r)},${r1(y + h)}H${r1(x + w)}Z`;
  return `M${r1(x)},${r1(y)}h${r1(w)}v${r1(h)}h${r1(-w)}Z`;
}
function shapePath(kind, cx, cy, r) {
  if (kind === 1) return `M${r1(cx - r * 0.9)},${r1(cy - r * 0.9)}h${r1(r * 1.8)}v${r1(r * 1.8)}h${r1(-r * 1.8)}Z`;
  if (kind === 2) return `M${r1(cx)},${r1(cy - r * 1.15)}L${r1(cx + r * 1.1)},${r1(cy + r * 0.85)}L${r1(cx - r * 1.1)},${r1(cy + r * 0.85)}Z`;
  return `M${r1(cx - r)},${r1(cy)}a${r},${r} 0 1,0 ${r * 2},0a${r},${r} 0 1,0 ${-r * 2},0`;
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------

/** Render charts inside `root` that haven't been rendered yet. */
export function hydrateCharts(root = document) {
  root.querySelectorAll("figure.fj-chart:not(.is-ready)").forEach((fig) => {
    const src = fig.querySelector(".fj-chart-src");
    const text = src ? src.textContent : fig.dataset.src || "";
    try { renderChart(fig, text); } catch (err) {
      console.error("[Fershman] chart failed", err);
      fig.classList.add("is-ready");
      fig.append(el("div", { class: "fj-chart-error", text: "This chart couldn't be displayed." }));
    }
  });
}

/** Render one chart into an (empty or placeholder) figure. Returns a small controller. */
export function renderChart(fig, source, { onEvent } = {}) {
  const P = typeof source === "string" ? parseChart(source) : source;
  const { spec } = P;
  if (fig._fjChart) { fig._fjChart.destroy(); fig._fjChart = null; }
  fig.textContent = "";
  fig.classList.add("fj-chart", "is-ready");
  fig.dataset.type = spec.type;
  const emit = (action) => {
    const detail = { action, title: spec.title || "", type: spec.type };
    fig.dispatchEvent(new CustomEvent("fj:chart", { bubbles: true, detail }));
    if (onEvent) onEvent(detail);
  };

  const head = (spec.title || spec.subtitle) ? el("figcaption", { class: "fj-chart-head" },
    spec.title ? el("p", { class: "fj-chart-title", text: spec.title }) : null,
    spec.subtitle ? el("p", { class: "fj-chart-sub", text: spec.subtitle }) : null) : null;
  if (head) fig.append(head);

  if (P.errors.length) {
    const box = el("div", { class: "fj-chart-error", role: "note" }, el("strong", { text: "This chart needs a fix" }));
    const ul = el("ul");
    P.errors.slice(0, 5).forEach((e) => ul.append(el("li", { text: e })));
    box.append(ul);
    fig.append(box);
    return { parsed: P, redraw() {}, destroy() {} };
  }

  const fmt = {
    prefix: spec.set.has("prefix") ? spec.prefix : P.hints.prefix,
    suffix: spec.set.has("suffix") ? spec.suffix : P.hints.suffix,
  };
  const valueDec = spec.decimals !== null ? spec.decimals : P.decimals;
  const fv = (v) => fmtNum(v, { decimals: valueDec, ...fmt });

  // ---- state
  const state = {
    hidden: new Set(),
    range: spec.ranges.length ? spec.ranges[spec.ranges.length - 1] : null,
    active: null, // hovered index (or point index)
    interacted: false,
  };
  const isTime = P.x && P.x.kind === "time" && (spec.type === "line" || spec.type === "area");
  if (!isTime) state.range = null;

  // ---- tools: legend + ranges
  const tools = el("div", { class: "fj-chart-tools" });
  const legendItems = spec.type === "scatter"
    ? P.groups.map((g, k) => ({ key: k, name: g, slot: k + 1, shape: k }))
    : P.series.map((s) => ({ key: s.key, name: s.name, slot: s.slot }));
  if (legendItems.length >= 2) {
    const lg = el("div", { class: "fj-legend", role: "group", "aria-label": "Series (select to show or hide)" });
    legendItems.forEach((it) => {
      const sw = spec.type === "scatter"
        ? (() => { const s = sv("svg", { viewBox: "0 0 12 12", width: 12, height: 12, class: `fj-sw-shape s${it.slot}`, "aria-hidden": "true" }); s.append(sv("path", { d: shapePath(it.shape, 6, 6, 4.2) })); return s; })()
        : el("span", { class: `fj-sw ${spec.type === "line" ? "fj-sw-line" : "fj-sw-box"} s${it.slot}`, "aria-hidden": "true" });
      const b = el("button", { type: "button", "aria-pressed": "true", "data-key": String(it.key) }, sw, el("span", { text: it.name }));
      lg.append(b);
    });
    lg.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-key]");
      if (!b) return;
      const key = +b.dataset.key;
      const visible = legendItems.filter((it) => !state.hidden.has(it.key));
      if (!state.hidden.has(key) && visible.length <= 1) return; // keep at least one
      if (state.hidden.has(key)) state.hidden.delete(key); else state.hidden.add(key);
      b.setAttribute("aria-pressed", state.hidden.has(key) ? "false" : "true");
      touch();
      draw();
    });
    tools.append(lg);
  }
  if (state.range) {
    const rg = el("div", { class: "fj-ranges", role: "group", "aria-label": "Time range" });
    spec.ranges.forEach((tok) => {
      if (rangeStart(tok, 0, 0) === null && !/^(all|max)$/i.test(tok)) return;
      rg.append(el("button", { type: "button", "aria-pressed": tok === state.range ? "true" : "false", "data-range": tok, text: /^(all|max)$/i.test(tok) ? "All" : tok.toUpperCase() }));
    });
    rg.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-range]");
      if (!b) return;
      state.range = b.dataset.range;
      rg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
      touch();
      draw();
    });
    tools.append(rg);
  }
  if (tools.childNodes.length) fig.append(tools);

  // ---- plot
  const plot = el("div", { class: "fj-plot", tabindex: "0", role: "group", "aria-roledescription": "chart" });
  const tip = el("div", { class: "fj-tip", hidden: true, "aria-hidden": "true" });
  const live = el("p", { class: "fj-sr", "aria-live": "polite" });
  plot.append(tip, live);
  fig.append(plot);

  // ---- data table + footer
  const tableWrap = el("div", { class: "fj-chart-table", hidden: true });
  fig.append(tableWrap);
  const meta = el("p", { class: "fj-chart-meta" });
  if (spec.note) meta.append(el("span", { text: `Note: ${spec.note}` }));
  if (spec.source) meta.append(el("span", { text: `Source: ${spec.source}` }));
  const viewBtn = el("button", { type: "button", class: "fj-linkbtn", "aria-expanded": "false", text: "View data" });
  const dlBtn = el("button", { type: "button", class: "fj-linkbtn", text: "Download data" });
  fig.append(el("div", { class: "fj-chart-foot" }, meta, el("p", { class: "fj-chart-actions" }, viewBtn, dlBtn)));
  viewBtn.addEventListener("click", () => {
    const open = tableWrap.hidden;
    if (open && !tableWrap.firstChild) tableWrap.append(buildTable());
    tableWrap.hidden = !open;
    viewBtn.setAttribute("aria-expanded", String(open));
    viewBtn.textContent = open ? "Hide data" : "View data";
    if (open) emit("table");
  });
  dlBtn.addEventListener("click", () => {
    const q = (c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c));
    const csv = [P.columns.map(q).join(","), ...P.rows.map((r) => r.map(q).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `${(spec.title || "fershman-chart").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "chart"}.csv`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    emit("download");
  });

  function buildTable() {
    const t = el("table");
    const thead = el("thead"), tr = el("tr");
    const cols = spec.type === "scatter" ? P.columns.slice(0, P.groups.length ? 4 : 3) : P.columns;
    cols.forEach((c, k) => tr.append(el("th", { scope: "col", class: k ? "num" : null, text: c })));
    if (spec.type === "scatter" && P.groups.length) tr.lastChild.className = "";
    thead.append(tr); t.append(thead);
    const tb = el("tbody");
    P.rows.forEach((r, ri) => {
      const row = el("tr");
      if (spec.type === "scatter") {
        row.append(el("th", { scope: "row", text: r[0] }));
        row.append(el("td", { class: "num", text: fmtNum(parseNumber(r[1]), { decimals: P.decimals }) }));
        row.append(el("td", { class: "num", text: fmtNum(parseNumber(r[2]), { decimals: P.decimals }) }));
        if (P.groups.length) row.append(el("td", { text: r[3] || "" }));
      } else {
        const xLabel = P.x.kind === "time" ? fmtDate(P.x.t[ri], P.x.g, "full") : r[0];
        row.append(el("th", { scope: "row", text: xLabel }));
        P.series.forEach((s) => row.append(el("td", { class: "num", text: fv(s.values[ri]) })));
      }
      tb.append(row);
    });
    t.append(tb);
    return t;
  }

  function touch() {
    if (!state.interacted) { state.interacted = true; emit("interact"); }
  }

  // ---- drawing
  let geom = null; // what the hover layer needs
  let lastW = 0;

  function draw() {
    const W = Math.max(260, Math.round(plot.clientWidth || fig.clientWidth || 600));
    lastW = W;
    const old = plot.querySelector("svg");
    if (old) old.remove();
    hideTip();
    let svg;
    if (spec.type === "hbar") svg = drawHbar(W);
    else if (spec.type === "scatter") svg = drawScatter(W);
    else svg = drawXY(W);
    plot.insertBefore(svg, tip);
    plot.setAttribute("aria-label", summary());
  }

  function visibleSeries() { return P.series.filter((s) => !state.hidden.has(s.key)); }
  function windowIdx() {
    const n = P.rows.length;
    if (!isTime || !state.range) return [0, n - 1];
    const t = P.x.t;
    const start = rangeStart(state.range, t[n - 1], t[0]);
    let a = 0;
    while (a < n - 2 && t[a] < start) a++;
    return [a, n - 1];
  }

  function yAxis(svg, sc, x0, x1, y, compact) {
    const g = sv("g", { class: "fj-grid" });
    sc.ticks.forEach((v) => {
      const yy = Math.round(y(v)) + 0.5;
      g.append(sv("line", { x1: x0, x2: x1, y1: yy, y2: yy, class: v === 0 && sc.lo < 0 ? "fj-zero" : null }));
    });
    svg.append(g);
    const lab = sv("g", { class: "fj-ylabels" });
    sc.ticks.forEach((v) => lab.append(sv("text", { x: x0 - 8, y: Math.round(y(v)) + 4, "text-anchor": "end" }, fmtNum(v, { decimals: compact ? null : sc.dec, compact, ...fmt }))));
    svg.append(lab);
  }
  function yLabelWidth(sc, compact) {
    return Math.max(...sc.ticks.map((v) => textWidth(fmtNum(v, { decimals: compact ? null : sc.dec, compact, ...fmt }))));
  }

  // ---------- line / area / bar / stacked ----------
  function drawXY(W) {
    const series = visibleSeries();
    const [a, b] = windowIdx();
    const idx = []; for (let k = a; k <= b; k++) idx.push(k);
    const stacked = spec.type === "stacked";
    const bars = spec.type === "bar" || stacked;
    const H = Math.round(Math.min(420, Math.max(250, W * 0.56)));
    const top = 12 + (spec.marks.length ? 18 : 0);
    const bottom = 30;

    // y domain
    let lo = Infinity, hi = -Infinity;
    for (const k of idx) {
      if (stacked) {
        let pos = 0, neg = 0;
        for (const s of series) { const v = s.values[k]; if (v === null) continue; if (v >= 0) pos += v; else neg += v; }
        lo = Math.min(lo, neg); hi = Math.max(hi, pos);
      } else {
        for (const s of series) { const v = s.values[k]; if (v === null) continue; lo = Math.min(lo, v); hi = Math.max(hi, v); }
      }
    }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    for (const r of spec.refs) { lo = Math.min(lo, r.y); hi = Math.max(hi, r.y); }
    const dataLo = lo, dataHi = hi;
    const zeroBased = bars || spec.type === "area";
    if (zeroBased) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    else if (lo > 0 && lo < hi * 0.3) lo = 0;
    // Axis start/end set by the writer; never cut off data
    if (spec.ymin !== null) lo = Math.min(spec.ymin, dataLo, zeroBased ? 0 : Infinity);
    if (spec.ymax !== null) hi = Math.max(spec.ymax, dataHi);
    const plotHGuess = H - top - bottom;
    const sc = niceScale(lo, hi, Math.max(3, Math.min(6, Math.round(plotHGuess / 56))));
    if (spec.ymin !== null && lo === spec.ymin) { sc.lo = spec.ymin; sc.ticks = sc.ticks.filter((v) => v >= spec.ymin - 1e-9); }
    if (spec.ymax !== null && hi === spec.ymax) { sc.hi = spec.ymax; sc.ticks = sc.ticks.filter((v) => v <= spec.ymax + 1e-9); }
    const compact = !fmt.suffix && Math.max(...sc.ticks.map(Math.abs)) >= 1e4;
    const left = Math.ceil(yLabelWidth(sc, compact)) + 10;

    // end labels for lines (<= 4 visible series, no collisions)
    const lastIdx = (s) => { for (let k = b; k >= a; k--) if (s.values[k] !== null) return k; return -1; };
    let endLabels = [];
    const labelled = spec.highlight.length ? series.filter((s) => s.slot) : series;
    if (!bars && labelled.length && labelled.length <= 4) {
      endLabels = labelled.map((s) => ({ s, k: lastIdx(s) })).filter((e) => e.k >= 0).map((e) => ({ ...e, text: fv(e.s.values[e.k]) }));
    }
    const right = endLabels.length ? Math.ceil(Math.max(...endLabels.map((e) => textWidth(e.text, 12, 600)))) + 14 : 10;
    const plotW = W - left - right, plotH = H - top - bottom;
    const y = (v) => top + (1 - (v - sc.lo) / (sc.hi - sc.lo || 1)) * plotH;

    // x positions
    let xPos, bandW = 0;
    if (bars) {
      bandW = plotW / idx.length;
      xPos = (k) => left + (k - a + 0.5) * bandW;
    } else if (isTime) {
      const t0 = P.x.t[a], t1 = P.x.t[b];
      xPos = (k) => left + (t1 === t0 ? plotW / 2 : ((P.x.t[k] - t0) / (t1 - t0)) * plotW);
    } else {
      xPos = (k) => left + (idx.length === 1 ? plotW / 2 : ((k - a) / (idx.length - 1)) * plotW);
    }

    const svg = sv("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true", focusable: "false" });
    yAxis(svg, sc, left, left + plotW, y, compact);

    // x axis labels
    const xl = sv("g", { class: "fj-xlabels" });
    const baseY = top + plotH;
    if (isTime) {
      const t0 = P.x.t[a], t1 = P.x.t[b];
      const xt = (t) => left + (t1 === t0 ? plotW / 2 : ((t - t0) / (t1 - t0)) * plotW);
      const ticks = timeTicks(t0, t1, xt, P.x.g);
      ticks.forEach((tk) => {
        const px = xt(tk.t);
        const w = textWidth(tk.label);
        const anchor = px - w / 2 < 2 ? "start" : px + w / 2 > W - 2 ? "end" : "middle";
        xl.append(sv("line", { x1: Math.round(px) + 0.5, x2: Math.round(px) + 0.5, y1: baseY, y2: baseY + 4, class: "fj-tick" }));
        xl.append(sv("text", { x: anchor === "start" ? Math.max(px, 0) : anchor === "end" ? Math.min(px, W) : px, y: baseY + 19, "text-anchor": anchor }, tk.label));
      });
    } else {
      const labels = idx.map((k) => (P.x.kind === "time" ? fmtDate(P.x.t[k], P.x.g, "short") : String(P.x.raw[k])));
      const step = bars ? bandW : idx.length > 1 ? plotW / (idx.length - 1) : plotW;
      const maxW = Math.max(...labels.map((l) => textWidth(l)));
      const every = Math.max(1, Math.ceil((maxW + 12) / Math.max(step, 1)));
      labels.forEach((lab, j) => {
        if (j % every !== 0) return;
        const px = xPos(idx[j]);
        let text = lab;
        const room = step * every - 6;
        if (textWidth(text) > room && room > 20) { while (text.length > 2 && textWidth(text + "…") > room) text = text.slice(0, -1); text += "…"; }
        const w = textWidth(text);
        const anchor = px - w / 2 < 2 ? "start" : px + w / 2 > W - 2 ? "end" : "middle";
        xl.append(sv("text", { x: anchor === "start" ? Math.max(px - Math.min(bandW / 2, 6), 0) : anchor === "end" ? Math.min(px + Math.min(bandW / 2, 6), W) : px, y: baseY + 19, "text-anchor": anchor }, text));
      });
    }
    // baseline
    const zeroY = sc.lo <= 0 && sc.hi >= 0 ? y(0) : y(sc.lo);
    svg.append(sv("line", { x1: left, x2: left + plotW, y1: Math.round(baseY) + 0.5, y2: Math.round(baseY) + 0.5, class: "fj-axis" }));
    svg.append(xl);

    // reference lines
    for (const rf of spec.refs) {
      const yy = Math.round(y(rf.y)) + 0.5;
      if (yy < top - 1 || yy > baseY + 1) continue;
      svg.append(sv("line", { x1: left, x2: left + plotW, y1: yy, y2: yy, class: "fj-ref" }));
      if (rf.label) svg.append(sv("text", { x: left + plotW, y: yy - 5, "text-anchor": "end", class: "fj-annot" }, rf.label));
    }
    // markers
    const markG = sv("g", { class: "fj-marks" });
    const markPx = [];
    for (const mk of spec.marks) {
      let px = null;
      if (P.x.kind === "time") {
        const d = parseDate(mk.x);
        if (!d) continue;
        if (bars) {
          let best = -1, bd = Infinity;
          idx.forEach((k) => { const dd = Math.abs(P.x.t[k] - d.t); if (dd < bd) { bd = dd; best = k; } });
          if (best >= 0 && d.t >= P.x.t[a] - 40 * 864e5 && d.t <= P.x.t[b] + 40 * 864e5) px = xPos(best);
        } else if (d.t >= P.x.t[a] && d.t <= P.x.t[b]) {
          const t0 = P.x.t[a], t1 = P.x.t[b];
          px = left + (t1 === t0 ? plotW / 2 : ((d.t - t0) / (t1 - t0)) * plotW);
        }
      } else {
        const k = P.x.raw.findIndex((r) => String(r).toLowerCase() === mk.x.toLowerCase());
        if (k >= a && k <= b) px = xPos(k);
      }
      if (px === null) continue;
      markPx.push({ px, label: mk.label });
    }
    // Marker labels sit above the plot, to the right of their line when there's room, else to the
    // left; a label that fits neither way is dropped (the line stays, and the table has the data).
    markPx.sort((p, q) => p.px - q.px);
    const taken = [];
    const free = (x0, x1) => x0 >= 0 && x1 <= W && taken.every(([a0, a1]) => x1 + 6 <= a0 || x0 >= a1 + 6);
    markPx.forEach((mk, j) => {
      const xx = Math.round(mk.px) + 0.5;
      markG.append(sv("line", { x1: xx, x2: xx, y1: top - 4, y2: baseY, class: "fj-mark" }));
      if (!mk.label) return;
      const w = textWidth(mk.label, 11);
      const nextLine = j + 1 < markPx.length ? markPx[j + 1].px : Infinity;
      if (xx + 4 + w < nextLine - 4 && free(xx + 4, xx + 4 + w)) {
        taken.push([xx + 4, xx + 4 + w]);
        markG.append(sv("text", { x: xx + 4, y: top - 8, "text-anchor": "start", class: "fj-annot" }, mk.label));
      } else if (free(xx - 4 - w, xx - 4)) {
        taken.push([xx - 4 - w, xx - 4]);
        markG.append(sv("text", { x: xx - 4, y: top - 8, "text-anchor": "end", class: "fj-annot" }, mk.label));
      }
    });

    // marks: series
    const marksG = sv("g", { class: "fj-series" });
    const order = [...series].sort((p, q) => (p.slot === 0 ? -1 : 0) - (q.slot === 0 ? -1 : 0));
    if (bars && !stacked) {
      const k = series.length;
      const barW = Math.max(2, Math.min(24, (bandW * 0.78 - (k - 1) * 2) / k));
      const groupW = k * barW + (k - 1) * 2;
      const single = k === 1;
      const showVals = single && idx.length <= 12 && idx.every((ki) => textWidth(fv(series[0].values[ki]), 11, 600) <= bandW - 2);
      idx.forEach((ki) => {
        const g = sv("g", { class: "fj-band", "data-i": ki });
        series.forEach((s, j) => {
          const v = s.values[ki];
          if (v === null) return;
          const x0 = xPos(ki) - groupW / 2 + j * (barW + 2);
          const yv = y(v), yb = zeroY;
          const h = Math.abs(yb - yv);
          g.append(sv("path", { d: barPath(x0, Math.min(yb, yv), barW, Math.max(h, v === 0 ? 0 : 1), v >= 0 ? "up" : "down"), class: `fj-bar s${s.slot}` }));
          if (showVals) g.append(sv("text", { x: x0 + barW / 2, y: v >= 0 ? yv - 6 : yv + 15, "text-anchor": "middle", class: "fj-val" }, fv(v)));
        });
        marksG.append(g);
      });
    } else if (stacked) {
      const barW = Math.max(3, Math.min(24, bandW * 0.62));
      idx.forEach((ki) => {
        const g = sv("g", { class: "fj-band", "data-i": ki });
        let pos = 0, neg = 0;
        const segs = [];
        series.forEach((s) => {
          const v = s.values[ki];
          if (v === null || v === 0) return;
          if (v > 0) { segs.push({ s, from: pos, to: pos + v, up: true }); pos += v; } else { segs.push({ s, from: neg, to: neg + v, up: false }); neg += v; }
        });
        const lastUp = [...segs].reverse().find((sg) => sg.up), lastDown = [...segs].reverse().find((sg) => !sg.up);
        segs.forEach((sg) => {
          let yA = y(sg.from), yB = y(sg.to);
          const first = sg.from === 0;
          if (sg.up) { if (!first) yA -= 2; } else if (!first) yA += 2;
          const top0 = Math.min(yA, yB), h = Math.abs(yA - yB);
          if (h < 0.5) return;
          const outer = sg === lastUp || sg === lastDown;
          g.append(sv("path", { d: barPath(xPos(ki) - barW / 2, top0, barW, h, outer ? (sg.up ? "up" : "down") : "flat"), class: `fj-bar s${sg.s.slot}` }));
        });
        marksG.append(g);
      });
    } else {
      const base = sc.lo <= 0 && sc.hi >= 0 ? y(0) : y(sc.lo);
      order.forEach((s) => {
        const segs = [];
        let cur = [];
        idx.forEach((k) => {
          const v = s.values[k];
          if (v === null) { if (cur.length) segs.push(cur); cur = []; return; }
          cur.push([xPos(k), y(v)]);
        });
        if (cur.length) segs.push(cur);
        if (spec.type === "area") {
          segs.forEach((sg) => {
            if (sg.length < 2) return;
            const d = `M${r1(sg[0][0])},${r1(base)}L` + sg.map((p) => `${r1(p[0])},${r1(p[1])}`).join("L") + `L${r1(sg[sg.length - 1][0])},${r1(base)}Z`;
            marksG.append(sv("path", { d, class: `fj-area s${s.slot}` }));
          });
        }
        segs.forEach((sg) => {
          if (sg.length === 1) { marksG.append(sv("circle", { cx: r1(sg[0][0]), cy: r1(sg[0][1]), r: 3, class: `fj-dot s${s.slot}` })); return; }
          marksG.append(sv("path", { d: "M" + sg.map((p) => `${r1(p[0])},${r1(p[1])}`).join("L"), class: `fj-line s${s.slot}` }));
        });
      });
      // end dots
      series.forEach((s) => {
        const k = lastIdx(s);
        if (k < 0) return;
        marksG.append(sv("circle", { cx: r1(xPos(k)), cy: r1(y(s.values[k])), r: 4, class: `fj-dot s${s.slot}` }));
      });
    }
    svg.append(marksG);
    svg.append(markG);

    // end labels (skip all if any two would collide)
    if (endLabels.length) {
      const placed = endLabels.map((e) => ({ ...e, py: y(e.s.values[e.k]), px: xPos(e.k) })).sort((p, q) => p.py - q.py);
      const collide = placed.some((p, j) => j > 0 && p.py - placed[j - 1].py < 14);
      if (!collide) {
        const g = sv("g", { class: "fj-endlabels" });
        placed.forEach((p) => g.append(sv("text", { x: r1(p.px + 8), y: r1(p.py + 4), class: "fj-endlabel" }, p.text)));
        svg.append(g);
      }
    }

    // hover layer
    const hover = sv("g", { class: "fj-hover" });
    svg.append(hover);
    geom = { kind: bars ? "band" : "x", idx, xPos, y, left, top, plotW, plotH, W, H, svg, hover, series, bandW };
    return svg;
  }

  // ---------- horizontal bars ----------
  function drawHbar(W) {
    const series = visibleSeries();
    const n = P.rows.length;
    const k = series.length;
    const single = k === 1;
    const barT = single ? 18 : Math.max(8, Math.min(16, 40 / k));
    const rowH = k * barT + (k - 1) * 2 + (single ? 12 : 14);
    const labels = P.rows.map((r, i) => (P.x.kind === "time" ? fmtDate(P.x.t[i], P.x.g, "short") : String(r[0])));
    const maxLabelW = Math.min(W * 0.42, Math.max(...labels.map((l) => textWidth(l, 13, 500))) + 4);
    let lo = 0, hi = 0;
    series.forEach((s) => s.values.forEach((v) => { if (v === null) return; lo = Math.min(lo, v); hi = Math.max(hi, v); }));
    for (const r of spec.refs) { lo = Math.min(lo, r.y); hi = Math.max(hi, r.y); }
    if (spec.ymax !== null) hi = Math.max(hi, spec.ymax);
    if (spec.ymin !== null) lo = Math.min(lo, spec.ymin);
    const valW = Math.max(...series.flatMap((s) => s.values.map((v) => (v === null ? 0 : textWidth(fv(v), 12, 600)))), 0);
    const showVals = single;
    const axis = !single;
    const left = Math.ceil(maxLabelW) + 12;
    const right = showVals ? Math.ceil(valW) + 10 : 14;
    const leftPad = lo < 0 && showVals ? Math.ceil(valW) + 8 : 0;
    const top = axis ? 22 : 4;
    const plotW = Math.max(60, W - left - right - leftPad);
    const H = top + n * rowH + 6;
    const sc = axis ? niceScale(lo, hi, Math.max(2, Math.min(5, Math.round(plotW / 90)))) : { lo, hi: hi || 1, ticks: [], dec: 0 };
    const x0 = left + leftPad;
    const x = (v) => x0 + ((v - sc.lo) / (sc.hi - sc.lo || 1)) * plotW;
    const svg = sv("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true", focusable: "false" });
    if (axis) {
      const g = sv("g", { class: "fj-grid" }), lab = sv("g", { class: "fj-ylabels" });
      sc.ticks.forEach((v) => {
        const xx = Math.round(x(v)) + 0.5;
        g.append(sv("line", { x1: xx, x2: xx, y1: top - 4, y2: H - 4 }));
        lab.append(sv("text", { x: xx, y: 12, "text-anchor": "middle" }, fmtNum(v, { decimals: sc.dec, ...fmt })));
      });
      svg.append(g, lab);
    }
    const zx = Math.round(x(0)) + 0.5;
    const marksG = sv("g", { class: "fj-series" });
    P.rows.forEach((r, i) => {
      const yRow = top + i * rowH;
      const g = sv("g", { class: "fj-band", "data-i": i });
      let text = labels[i];
      if (textWidth(text, 13, 500) > maxLabelW) { while (text.length > 2 && textWidth(text + "…", 13, 500) > maxLabelW) text = text.slice(0, -1); text += "…"; }
      g.append(sv("text", { x: left - 10, y: yRow + rowH / 2 + 4.5, "text-anchor": "end", class: "fj-cat" }, text));
      series.forEach((s, j) => {
        const v = s.values[i];
        if (v === null) return;
        const by = yRow + (rowH - (k * barT + (k - 1) * 2)) / 2 + j * (barT + 2);
        const xv = x(v), w = Math.abs(xv - x(0));
        g.append(sv("path", { d: barPath(Math.min(xv, x(0)), by, Math.max(w, v === 0 ? 0 : 1), barT, v >= 0 ? "right" : "left"), class: `fj-bar s${s.slot}` }));
        if (showVals) g.append(sv("text", { x: v >= 0 ? xv + 6 : xv - 6, y: by + barT / 2 + 4, "text-anchor": v >= 0 ? "start" : "end", class: "fj-val" }, fv(v)));
      });
      marksG.append(g);
    });
    svg.append(sv("line", { x1: zx, x2: zx, y1: top - 2, y2: H - 4, class: "fj-axis" }));
    svg.append(marksG);
    for (const rf of spec.refs) {
      const xx = Math.round(x(rf.y)) + 0.5;
      svg.append(sv("line", { x1: xx, x2: xx, y1: top - 4, y2: H - 4, class: "fj-ref" }));
      if (rf.label) svg.append(sv("text", { x: xx + 4, y: H - 8, class: "fj-annot" }, rf.label));
    }
    svg.append(sv("g", { class: "fj-hover" }));
    geom = { kind: "row", rowH, top, n, W, H, svg, series, left, labels, xv: x };
    return svg;
  }

  // ---------- scatter ----------
  function drawScatter(W) {
    const pts = P.points.filter((p) => !state.hidden.has(P.groups.indexOf(p.group)));
    const H = Math.round(Math.min(480, Math.max(280, W * 0.66)));
    const top = 30, bottom = 44;
    let xlo = Infinity, xhi = -Infinity, ylo = Infinity, yhi = -Infinity;
    P.points.forEach((p) => { xlo = Math.min(xlo, p.x); xhi = Math.max(xhi, p.x); ylo = Math.min(ylo, p.y); yhi = Math.max(yhi, p.y); });
    for (const r of spec.refs) { ylo = Math.min(ylo, r.y); yhi = Math.max(yhi, r.y); }
    if (spec.ymin !== null) ylo = spec.ymin;
    if (spec.ymax !== null) yhi = Math.max(yhi, spec.ymax);
    const pad = (lo, hi) => { const d = (hi - lo) * 0.04 || 1; return [lo - d, hi + d]; };
    [xlo, xhi] = pad(xlo, xhi);
    if (spec.ymin === null) [ylo, yhi] = pad(ylo, yhi);
    const ys = niceScale(ylo, yhi, Math.max(3, Math.min(6, Math.round((H - top - bottom) / 60))));
    const left = Math.ceil(yLabelWidth(ys, false)) + 10, right = 14;
    const plotW = W - left - right, plotH = H - top - bottom;
    const xs = niceScale(xlo, xhi, Math.max(3, Math.min(8, Math.round(plotW / 80))));
    const x = (v) => left + ((v - xs.lo) / (xs.hi - xs.lo || 1)) * plotW;
    const y = (v) => top + (1 - (v - ys.lo) / (ys.hi - ys.lo || 1)) * plotH;
    const svg = sv("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true", focusable: "false" });
    yAxis(svg, ys, left, left + plotW, y, false);
    const xl = sv("g", { class: "fj-xlabels" });
    xs.ticks.forEach((v) => {
      const xx = Math.round(x(v)) + 0.5;
      xl.append(sv("line", { x1: xx, x2: xx, y1: top + plotH, y2: top + plotH + 4, class: "fj-tick" }));
      xl.append(sv("text", { x: xx, y: top + plotH + 18, "text-anchor": "middle" }, fmtNum(v, { decimals: xs.dec })));
    });
    svg.append(sv("line", { x1: left, x2: left + plotW, y1: Math.round(top + plotH) + 0.5, y2: Math.round(top + plotH) + 0.5, class: "fj-axis" }));
    svg.append(xl);
    svg.append(sv("text", { x: left + plotW, y: H - 4, "text-anchor": "end", class: "fj-axis-title" }, P.xName));
    svg.append(sv("text", { x: 0, y: 14, "text-anchor": "start", class: "fj-axis-title" }, P.yName));
    for (const rf of spec.refs) {
      const yy = Math.round(y(rf.y)) + 0.5;
      svg.append(sv("line", { x1: left, x2: left + plotW, y1: yy, y2: yy, class: "fj-ref" }));
      if (rf.label) svg.append(sv("text", { x: left + plotW, y: yy - 5, "text-anchor": "end", class: "fj-annot" }, rf.label));
    }
    const g = sv("g", { class: "fj-series" });
    const placed = pts.map((p) => {
      const gi = P.groups.length ? P.groups.indexOf(p.group) : 0;
      const slot = P.groups.length ? gi + 1 : 1;
      const px = x(p.x), py = y(p.y);
      g.append(sv("path", { d: shapePath(Math.max(0, gi), px, py, 4.5), class: `fj-pt s${slot}` }));
      return { ...p, px, py, slot, shape: Math.max(0, gi) };
    });
    svg.append(g);
    const want = spec.labels.map((l) => l.toLowerCase());
    if (want.length) {
      const lg = sv("g", { class: "fj-ptlabels" });
      placed.filter((p) => want.includes(String(p.label).toLowerCase())).forEach((p) => {
        const w = textWidth(p.label, 12, 600);
        const anchor = p.px + w + 10 > W ? "end" : "start";
        lg.append(sv("text", { x: anchor === "start" ? p.px + 8 : p.px - 8, y: p.py - 6, "text-anchor": anchor, class: "fj-ptlabel" }, p.label));
      });
      svg.append(lg);
    }
    svg.append(sv("g", { class: "fj-hover" }));
    geom = { kind: "pt", points: placed.slice().sort((p, q) => p.px - q.px), W, H, svg, left, top, plotW, plotH };
    return svg;
  }

  // ---------- hover, touch and keyboard ----------
  function hideTip() {
    tip.hidden = true;
    state.active = null;
    if (geom && geom.hover) geom.hover.textContent = "";
    if (geom && geom.svg) geom.svg.querySelectorAll(".is-dim").forEach((n) => n.classList.remove("is-dim"));
  }
  function setTip(rows, header, px, py) {
    tip.textContent = "";
    if (header) tip.append(el("p", { class: "fj-tip-x", text: header }));
    rows.forEach((r) => {
      const row = el("p", { class: "fj-tip-row" });
      row.append(el("span", { class: `fj-tip-key ${r.shape !== undefined ? "fj-tip-shape" : ""} s${r.slot}`, "aria-hidden": "true" }));
      row.append(el("b", { text: r.value }));
      if (r.name) row.append(el("span", { text: r.name }));
      tip.append(row);
    });
    tip.hidden = false;
    const pw = plot.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
    let lx = px + 14;
    if (lx + tw > pw) lx = px - 14 - tw;
    if (lx < 0) lx = Math.max(0, Math.min(pw - tw, px - tw / 2));
    let ty = Math.max(0, Math.min((geom.H || 300) - th - 4, py - th / 2));
    tip.style.transform = `translate(${Math.round(lx)}px, ${Math.round(ty)}px)`;
  }
  function announce(text) { live.textContent = text; }

  function showIndex(k, opts = {}) {
    if (!geom) return;
    if (geom.kind === "x" || geom.kind === "band") {
      const { xPos, y, top, plotH, hover, series } = geom;
      const px = xPos(k);
      hover.textContent = "";
      if (geom.kind === "x") {
        hover.append(sv("line", { x1: Math.round(px) + 0.5, x2: Math.round(px) + 0.5, y1: top, y2: top + plotH, class: "fj-cross" }));
        series.forEach((s) => { const v = s.values[k]; if (v !== null) hover.append(sv("circle", { cx: r1(px), cy: r1(y(v)), r: 4.5, class: `fj-dot s${s.slot}` })); });
      } else {
        geom.svg.querySelectorAll(".fj-band").forEach((b) => b.classList.toggle("is-dim", +b.dataset.i !== k));
      }
      const header = P.x.kind === "time" ? fmtDate(P.x.t[k], P.x.g, "full") : String(P.x.raw[k]);
      const rows = series.map((s) => ({ slot: s.slot, value: fv(s.values[k]), name: series.length > 1 ? s.name : s.name }));
      if (spec.type === "stacked" && series.length > 1) {
        const tot = series.reduce((acc, s) => acc + (s.values[k] || 0), 0);
        rows.push({ slot: "t", value: fv(tot), name: "Total" });
      }
      const vals = series.map((s) => s.values[k]).filter((v) => v !== null);
      const py = opts.py !== undefined ? opts.py : vals.length ? y(Math.max(...vals)) : top;
      setTip(rows, header, px, py);
      state.active = k;
      if (opts.announce) announce(`${header}: ${rows.map((r) => `${r.name} ${r.value}`).join(", ")}`);
    } else if (geom.kind === "row") {
      geom.svg.querySelectorAll(".fj-band").forEach((b) => b.classList.toggle("is-dim", +b.dataset.i !== k));
      const rows = geom.series.map((s) => ({ slot: s.slot, value: fv(s.values[k]), name: geom.series.length > 1 ? s.name : s.name }));
      const header = geom.labels[k];
      const ends = geom.series.map((s) => s.values[k]).filter((v) => v !== null).map((v) => geom.xv(Math.max(v, 0)));
      setTip(rows, header, ends.length ? Math.max(...ends) : geom.left, geom.top + k * geom.rowH + geom.rowH / 2);
      state.active = k;
      if (opts.announce) announce(`${header}: ${rows.map((r) => `${r.name} ${r.value}`).join(", ")}`);
    } else if (geom.kind === "pt") {
      const p = geom.points[k];
      if (!p) return;
      geom.hover.textContent = "";
      geom.hover.append(sv("path", { d: shapePath(p.shape, p.px, p.py, 6.5), class: `fj-pt is-on s${p.slot}` }));
      const rows = [
        { slot: p.slot, shape: p.shape, value: fmtNum(p.x, { decimals: P.decimals }), name: P.xName },
        { slot: p.slot, shape: p.shape, value: fmtNum(p.y, { decimals: P.decimals }), name: P.yName },
      ];
      setTip(rows, p.group ? `${p.label} (${p.group})` : p.label, p.px, p.py);
      state.active = k;
      if (opts.announce) announce(`${p.label}: ${P.xName} ${rows[0].value}, ${P.yName} ${rows[1].value}`);
    }
  }

  function indexFromPointer(e) {
    if (!geom) return null;
    const rect = geom.svg.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    if (geom.kind === "x" || geom.kind === "band") {
      let best = null, bd = Infinity;
      for (const k of geom.idx) {
        const d = Math.abs(geom.xPos(k) - mx);
        if (d < bd && geom.series.some((s) => s.values[k] !== null)) { bd = d; best = k; }
      }
      if (geom.kind === "band" && bd > geom.bandW / 2 + 2) return null;
      return { k: best, py: my };
    }
    if (geom.kind === "row") {
      const k = Math.floor((my - geom.top) / geom.rowH);
      return k >= 0 && k < geom.n ? { k } : null;
    }
    let best = null, bd = 30 * 30;
    geom.points.forEach((p, k) => { const d = (p.px - mx) ** 2 + (p.py - my) ** 2; if (d < bd) { bd = d; best = k; } });
    return best === null ? null : { k: best };
  }

  plot.addEventListener("pointermove", (e) => {
    const hit = indexFromPointer(e);
    if (!hit || hit.k === null) { if (e.pointerType === "mouse") hideTip(); return; }
    touch();
    if (hit.k !== state.active || geom.kind === "x") showIndex(hit.k, { py: hit.py });
  });
  plot.addEventListener("pointerdown", (e) => {
    const hit = indexFromPointer(e);
    if (hit && hit.k !== null) { touch(); showIndex(hit.k, { py: hit.py }); }
  });
  plot.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hideTip(); });
  const outside = (e) => { if (!fig.contains(e.target)) hideTip(); };
  document.addEventListener("pointerdown", outside, { passive: true });

  function navList() {
    if (!geom) return [];
    if (geom.kind === "x" || geom.kind === "band") return geom.idx.filter((k) => geom.series.some((s) => s.values[k] !== null));
    if (geom.kind === "row") return [...Array(geom.n).keys()];
    return [...geom.points.keys()];
  }
  plot.addEventListener("keydown", (e) => {
    const list = navList();
    if (!list.length) return;
    const pos = list.indexOf(state.active);
    let next = null;
    const fwd = ["ArrowRight", "ArrowDown"], back = ["ArrowLeft", "ArrowUp"];
    if (fwd.includes(e.key)) next = list[pos < 0 ? 0 : Math.min(list.length - 1, pos + 1)];
    else if (back.includes(e.key)) next = list[pos < 0 ? list.length - 1 : Math.max(0, pos - 1)];
    else if (e.key === "Home") next = list[0];
    else if (e.key === "End") next = list[list.length - 1];
    else if (e.key === "Escape") { hideTip(); return; }
    if (next === null || next === undefined) return;
    e.preventDefault();
    touch();
    showIndex(next, { announce: true });
  });
  plot.addEventListener("blur", () => hideTip());

  function summary() {
    const name = TYPE_LABELS[spec.type].toLowerCase();
    const parts = [`${spec.title || "Chart"}.`, `${name.charAt(0).toUpperCase() + name.slice(1)} chart`];
    if (spec.type === "scatter") parts.push(`of ${P.points.length} points, ${P.xName} against ${P.yName}.`);
    else {
      const ser = visibleSeries();
      parts.push(ser.length > 1 ? `with ${ser.length} series: ${ser.map((s) => s.name).join(", ")}.` : `of ${ser[0] ? ser[0].name : "values"}.`);
      if (P.x.kind === "time") parts.push(`${fmtDate(P.x.t[0], P.x.g)} to ${fmtDate(P.x.t[P.x.t.length - 1], P.x.g)}.`);
    }
    parts.push("Use the arrow keys to read values, or View data for a table.");
    return parts.join(" ");
  }

  draw();
  if (document.fonts && document.fonts.status !== "loaded") document.fonts.ready.then(() => { if (fig.isConnected) draw(); });

  let raf = 0;
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => {
    if (!plot.isConnected) { controller.destroy(); return; }
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { const w = Math.round(plot.clientWidth); if (w && Math.abs(w - lastW) > 1) draw(); });
  }) : null;
  if (ro) ro.observe(plot);

  const controller = {
    parsed: P,
    redraw: draw,
    destroy() { if (ro) ro.disconnect(); cancelAnimationFrame(raf); document.removeEventListener("pointerdown", outside); },
  };
  fig._fjChart = controller;
  return controller;
}
