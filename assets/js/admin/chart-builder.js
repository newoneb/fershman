// Chart builder for the article editor: pick a type, paste data from Google Sheets, Excel or a CSV,
// watch the interactive chart update, then insert (or update) a ```chart block in the article.
import { html, raw, debounce, $, $$ } from "../lib/util.js";
import { openPanel, toast } from "../lib/ui.js";
import { parseChart, renderChart, stringifyChart, readTable, TYPES, TYPE_LABELS } from "../lib/charts.js";

const EXAMPLES = {
  line: "Quarter,Revenue,Operating income\nQ1 2024,412,58\nQ2 2024,436,61\nQ3 2024,455,66\nQ4 2024,489,74\nQ1 2025,497,71\nQ2 2025,521,79",
  area: "Month,Assets under management\n2025-01,1.21\n2025-02,1.24\n2025-03,1.19\n2025-04,1.27\n2025-05,1.33\n2025-06,1.38",
  bar: "Year,Deals,Value\n2021,58,41\n2022,44,29\n2023,39,24\n2024,47,33\n2025,52,38",
  stacked: "Year,Debt,Equity\n2021,62,38\n2022,55,45\n2023,49,51\n2024,57,43",
  hbar: "Company,EV/EBITDA\nAlpha Corp,14.2\nBeta Holdings,11.8\nGamma Group,9.6\nDelta Inc.,7.3",
  scatter: "Company,Revenue growth,EV/EBITDA,Sector\nAlpha,12,14.2,Software\nBeta,4,9.1,Industrials\nGamma,18,21.5,Software\nDelta,2,7.4,Industrials\nEpsilon,9,12.3,Healthcare\nZeta,15,16.8,Healthcare",
};
const DATA_HINT = {
  line: "First column: dates (2024-01-31, 2024-01, Jan 2024, 2024 or Q1 2024) or labels. Then one column per series.",
  area: "First column: dates or labels. Then one column per series.",
  bar: "First column: categories or dates. Then one column per series.",
  stacked: "First column: categories or dates. Then one column per part of the stack.",
  hbar: "First column: the bars' names, in the order you want them. Then one or more value columns.",
  scatter: "Columns: a label for each dot, the x value, the y value, and optionally a group (up to 3).",
};
const BLOCK_RE = /```chart[^\n]*\n([\s\S]*?)\n?```/g;

/** The ```chart block under the cursor, if any. */
export function findChartBlock(text, pos) {
  BLOCK_RE.lastIndex = 0;
  let m;
  while ((m = BLOCK_RE.exec(text))) {
    if (pos >= m.index && pos <= m.index + m[0].length) return { start: m.index, end: m.index + m[0].length, source: m[1] };
  }
  return null;
}
/** The n-th ```chart block in the text. */
export function nthChartBlock(text, n) {
  BLOCK_RE.lastIndex = 0;
  let m, i = 0;
  while ((m = BLOCK_RE.exec(text))) {
    if (i === n) return { start: m.index, end: m.index + m[0].length, source: m[1] };
    i++;
  }
  return null;
}

export function openChartBuilder({ source = "", onSave }) {
  const P = source ? parseChart(source) : null;
  const sp = P ? P.spec : { type: "line", title: "", subtitle: "", source: "", note: "", prefix: "", suffix: "", decimals: null, ymin: null, ymax: null, ranges: [], marks: [], refs: [], highlight: [], labels: [] };
  const toCsv = (cols, rows) => [cols, ...rows].map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(",")).join("\n");
  const dataText = P && P.columns.length ? toCsv(P.columns, P.rows) : "";
  const editing = Boolean(source);
  let type = sp.type;
  const val = (v) => (v === null || v === undefined ? "" : String(v));

  const body = document.createElement("div");
  body.className = "cb";
  body.innerHTML = html`
    <div class="cb-grid">
      <div class="cb-form">
        <div class="field">
          <span class="label">Chart type</span>
          <div class="seg cb-types" role="group" aria-label="Chart type">
            ${TYPES.map((t) => html`<button type="button" data-type="${t}" aria-pressed="${t === type ? "true" : "false"}">${TYPE_LABELS[t]}</button>`)}
          </div>
        </div>
        <div class="field"><label for="cb-title">Title</label><input class="input" id="cb-title" value="${sp.title}" placeholder="The finding, in a few words"></div>
        <div class="field"><label for="cb-sub">Subtitle</label><input class="input" id="cb-sub" value="${sp.subtitle}" placeholder="What's measured and the unit, e.g. Billions of dollars"></div>
        <div class="field">
          <label for="cb-data">Data</label>
          <textarea class="textarea cb-data" id="cb-data" rows="9" spellcheck="false" placeholder="Paste from Google Sheets or Excel, or type CSV.&#10;First row: column names.">${dataText}</textarea>
          <span class="hint" id="cb-data-hint">${DATA_HINT[type]}</span>
          <div class="row">
            <label class="btn btn-sm">Upload CSV<input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden id="cb-file"></label>
            <button class="btn btn-ghost btn-sm" type="button" id="cb-example">Use example data</button>
          </div>
        </div>
        <div class="field-row">
          <div class="field"><label for="cb-source">Source</label><input class="input" id="cb-source" value="${sp.source}" placeholder="e.g. FINRA"></div>
          <div class="field"><label for="cb-note">Note</label><input class="input" id="cb-note" value="${sp.note}" placeholder="Optional"></div>
        </div>
        <fieldset class="cb-set">
          <legend>Numbers</legend>
          <div class="field-row cb-3">
            <div class="field"><label for="cb-prefix">Before</label><input class="input" id="cb-prefix" value="${sp.prefix}" placeholder="$"></div>
            <div class="field"><label for="cb-suffix">After</label><input class="input" id="cb-suffix" value="${sp.suffix}" placeholder="%, x, bn"></div>
            <div class="field"><label for="cb-dec">Decimals</label><select class="select" id="cb-dec">
              ${["", "0", "1", "2", "3"].map((d) => html`<option value="${d}" ${val(sp.decimals) === d ? raw("selected") : ""}>${d === "" ? "Auto" : d}</option>`)}
            </select></div>
          </div>
          <div class="field-row">
            <div class="field"><label for="cb-ymin">Axis starts at</label><input class="input" id="cb-ymin" inputmode="decimal" value="${val(sp.ymin)}" placeholder="Auto"></div>
            <div class="field"><label for="cb-ymax">Axis ends at</label><input class="input" id="cb-ymax" inputmode="decimal" value="${val(sp.ymax)}" placeholder="Auto"></div>
          </div>
        </fieldset>
        <fieldset class="cb-set">
          <legend>Story</legend>
          <div class="field cb-only" data-for="line area"><label for="cb-ranges">Range buttons</label><input class="input" id="cb-ranges" value="${(sp.ranges || []).join(", ")}" placeholder="1Y, 5Y, All"><span class="hint">For dates only. Readers switch between time spans; the last one is selected first.</span></div>
          <div class="field cb-only" data-for="line area bar stacked hbar"><label for="cb-hl">Emphasize</label><input class="input" id="cb-hl" list="cb-series" value="${(sp.highlight || []).join(", ")}" placeholder="Series names, separated by commas"><datalist id="cb-series"></datalist><span class="hint">The rest turn gray, so the story stands out.</span></div>
          <div class="field cb-only" data-for="scatter"><label for="cb-labels">Label these dots</label><input class="input" id="cb-labels" value="${(sp.labels || []).join(", ")}" placeholder="Names from the first column"></div>
          <div class="field cb-only" data-for="line area bar stacked"><label for="cb-marks">Event markers</label><textarea class="textarea cb-small" id="cb-marks" rows="2" placeholder="2020-03 | Pandemic cuts">${(sp.marks || []).map((m) => (m.label ? `${m.x} | ${m.label}` : m.x)).join("\n")}</textarea><span class="hint">One per line: a date or category, then a short label.</span></div>
          <div class="field cb-only" data-for="line area bar stacked hbar scatter"><label for="cb-refs">Reference lines</label><textarea class="textarea cb-small" id="cb-refs" rows="2" placeholder="2 | Fed target">${(sp.refs || []).map((r) => (r.label ? `${r.y} | ${r.label}` : r.y)).join("\n")}</textarea><span class="hint">One per line: a value, then a short label.</span></div>
        </fieldset>
      </div>
      <div class="cb-side">
        <p class="cb-side-head">Preview</p>
        <div class="cb-preview prose"><figure class="fj-chart" id="cb-fig"></figure></div>
        <ul class="cb-warn" id="cb-warn"></ul>
      </div>
    </div>`.value;

  const foot = document.createElement("div");
  foot.className = "row";
  foot.style.cssText = "justify-content:flex-end;width:100%";
  foot.innerHTML = html`<button class="btn" type="button" data-close>Cancel</button><button class="btn btn-accent" type="button" id="cb-save">${editing ? "Update chart" : "Insert chart"}</button>`.value;

  const saveBtn = $("#cb-save", foot);
  const panel = openPanel({ title: editing ? "Edit chart" : "Add a chart", body, foot, wide: true });
  const $b = (sel) => $(sel, body);
  let hinted = "";

  function collect() {
    const lines = (id) => $b(id).value.split("\n").map((l) => l.trim()).filter(Boolean);
    const list = (id) => $b(id).value.split(",").map((x) => x.trim()).filter(Boolean);
    const num = (id) => { const v = $b(id).value.trim(); return v === "" ? null : v; };
    const isOn = (key) => { const f = $b(`.cb-only[data-for~="${type}"] ${key}`); return Boolean(f); };
    return {
      type,
      title: $b("#cb-title").value.trim(), subtitle: $b("#cb-sub").value.trim(),
      source: $b("#cb-source").value.trim(), note: $b("#cb-note").value.trim(),
      prefix: $b("#cb-prefix").value, suffix: $b("#cb-suffix").value,
      decimals: $b("#cb-dec").value === "" ? null : $b("#cb-dec").value,
      ymin: num("#cb-ymin"), ymax: num("#cb-ymax"),
      ranges: isOn("#cb-ranges") ? list("#cb-ranges") : [],
      highlight: isOn("#cb-hl") ? list("#cb-hl") : [],
      labels: isOn("#cb-labels") ? list("#cb-labels") : [],
      marks: isOn("#cb-marks") ? lines("#cb-marks").map((l) => { const [x, ...r] = l.split("|"); return { x: x.trim(), label: r.join("|").trim() }; }) : [],
      refs: isOn("#cb-refs") ? lines("#cb-refs").map((l) => { const [y, ...r] = l.split("|"); return { y: y.trim(), label: r.join("|").trim() }; }) : [],
    };
  }
  function sourceText() {
    const t = readTable($b("#cb-data").value);
    return stringifyChart(collect(), t.columns, t.rows);
  }

  function refresh() {
    $$(".cb-only", body).forEach((f) => { f.hidden = !f.dataset.for.split(" ").includes(type); });
    $b("#cb-data-hint").textContent = DATA_HINT[type];
    const text = sourceText();
    const fig = $b("#cb-fig");
    const parsed = parseChart(text);
    // Suggest $ / % from pasted data once, if the writer hasn't set a format
    const sig = $b("#cb-data").value.slice(0, 400);
    if (sig && sig !== hinted && !$b("#cb-prefix").value && !$b("#cb-suffix").value && (parsed.hints.prefix || parsed.hints.suffix)) {
      hinted = sig;
      $b("#cb-prefix").value = parsed.hints.prefix;
      $b("#cb-suffix").value = parsed.hints.suffix;
      return refresh();
    }
    const dl = $b("#cb-series");
    dl.innerHTML = parsed.series.map((s) => html`<option value="${s.name}">`.value).join("");
    fig.className = "fj-chart";
    if (fig._fjChart) { fig._fjChart.destroy(); fig._fjChart = null; }
    if (!$b("#cb-data").value.trim()) {
      fig.innerHTML = html`<div class="cb-empty">Paste data on the left, or press <strong>Use example data</strong>.</div>`.value;
    } else {
      renderChart(fig, parsed);
    }
    const warn = $b("#cb-warn");
    warn.innerHTML = parsed.warnings.map((w) => html`<li>${w}</li>`.value).join("");
    saveBtn.disabled = !$b("#cb-data").value.trim() || parsed.errors.length > 0;
    return parsed;
  }
  const refreshSoon = debounce(refresh, 160);

  body.addEventListener("input", refreshSoon);
  body.addEventListener("change", refreshSoon);
  body.addEventListener("click", (e) => {
    const t = e.target.closest("[data-type]");
    if (t) {
      type = t.dataset.type;
      $$("[data-type]", body).forEach((b) => b.setAttribute("aria-pressed", b === t ? "true" : "false"));
      refresh();
    }
  });
  $b("#cb-example").addEventListener("click", () => {
    const area = $b("#cb-data");
    if (area.value.trim() && !window.confirm("Replace the data with an example?")) return;
    area.value = EXAMPLES[type];
    if (!$b("#cb-title").value) $b("#cb-title").value = "Example chart";
    refresh();
  });
  $b("#cb-file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { toast("That file is over 2 MB. Paste a smaller table.", { error: true }); return; }
    $b("#cb-data").value = (await f.text()).trim();
    refresh();
  });
  // Pasting a whole spreadsheet: keep tabs (TSV) as they are, they're read correctly
  $b("#cb-data").addEventListener("keydown", (e) => {
    if (e.key === "Tab" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      e.target.setRangeText("\t", e.target.selectionStart, e.target.selectionEnd, "end");
      refreshSoon();
    }
  });
  saveBtn.addEventListener("click", () => {
    const parsed = refresh();
    if (parsed.errors.length) { toast(parsed.errors[0], { error: true }); return; }
    onSave("```chart\n" + sourceText() + "\n```");
    panel.close();
  });
  refresh();
  setTimeout(() => (editing ? $b("#cb-title") : $b("#cb-data")).focus(), 30);
  return panel;
}
