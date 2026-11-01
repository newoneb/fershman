// Markdown → sanitized HTML for article bodies and static pages.
import { Marked } from "/assets/vendor/marked.esm.js";
import markedFootnote from "/assets/vendor/marked-footnote.js";
import DOMPurify from "/assets/vendor/purify.es.js";

// Iframes are allowed only from these hosts (charts, video, slides).
export const EMBED_HOSTS = [
  "datawrapper.dwcdn.net", "public.flourish.studio", "flo.uri.sh",
  "www.youtube.com", "www.youtube-nocookie.com", "player.vimeo.com",
  "docs.google.com", "e.infogram.com", "fred.stlouisfed.org",
  "ourworldindata.org", "open.spotify.com", "embed.podcasts.apple.com",
];

const marked = new Marked({ gfm: true, breaks: false });
marked.use(markedFootnote({ description: "Notes", headingClass: "footnotes-title", backRefLabel: "Back to note {0}" }));

let hooked = false;
function setupPurify() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook("uponSanitizeElement", (node, data) => {
    if (data.tagName !== "iframe") return;
    let ok = false;
    try {
      const u = new URL(node.getAttribute("src") || "", location.href);
      ok = u.protocol === "https:" && EMBED_HOSTS.includes(u.hostname);
    } catch (_) { ok = false; }
    if (!ok && node.parentNode) node.parentNode.removeChild(node);
  });
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      const href = node.getAttribute("href") || "";
      if (/^https?:\/\//i.test(href) && !href.startsWith(location.origin)) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    }
    if (node.tagName === "IMG") node.setAttribute("loading", "lazy");
  });
}

const NUMERIC = /^[\s(+\-−–]*[$€£¥]?\s?[\d][\d,.]*\s?(%|x|bp|bps|bn|m|k|tn|[KMBT])?\)?\s*$/i;

export function renderMarkdown(md, { figures = true } = {}) {
  setupPurify();
  const dirty = marked.parse(String(md || ""));
  const clean = DOMPurify.sanitize(dirty, {
    ADD_TAGS: ["iframe"],
    ADD_ATTR: ["allow", "allowfullscreen", "frameborder", "scrolling", "loading", "target"],
    FORBID_ATTR: ["style"],
    FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select"],
  });
  const tpl = document.createElement("template");
  tpl.innerHTML = clean;
  const root = tpl.content;

  if (figures) {
    // A paragraph holding only an image becomes a captioned figure (caption = image title).
    root.querySelectorAll("p > img").forEach((img) => {
      const p = img.parentElement;
      if (p.textContent.trim() || p.children.length !== 1) return;
      const fig = document.createElement("figure");
      fig.append(img);
      const cap = img.getAttribute("title");
      if (cap) {
        img.removeAttribute("title");
        const fc = document.createElement("figcaption");
        fc.textContent = cap;
        fig.append(fc);
      }
      p.replaceWith(fig);
    });
  }
  root.querySelectorAll("table").forEach((t) => {
    if (!t.parentElement || !t.parentElement.classList.contains("table-wrap")) {
      const wrap = document.createElement("div");
      wrap.className = "table-wrap";
      t.replaceWith(wrap);
      wrap.append(t);
    }
    t.querySelectorAll("td").forEach((td) => { if (NUMERIC.test(td.textContent)) td.classList.add("num"); });
    // Right-align header cells above numeric columns
    const rows = t.querySelectorAll("tbody tr");
    if (rows.length) {
      t.querySelectorAll("thead th").forEach((th, i) => {
        const numeric = Array.from(rows).every((r) => !r.children[i] || r.children[i].classList.contains("num") || !r.children[i].textContent.trim());
        if (numeric) th.classList.add("num");
      });
    }
  });
  root.querySelectorAll("iframe").forEach((f) => {
    f.setAttribute("loading", "lazy");
    if (!f.getAttribute("title")) f.setAttribute("title", "Embedded content");
    if (!f.parentElement || !f.parentElement.classList.contains("embed")) {
      const wrap = document.createElement("div");
      wrap.className = "embed";
      f.replaceWith(wrap);
      wrap.append(f);
    }
  });
  return tpl.innerHTML;
}

/** Plain sanitize for HTML coming from imports. */
export function sanitizeHTML(dirty) {
  setupPurify();
  return DOMPurify.sanitize(String(dirty || ""), { FORBID_ATTR: ["style", "class"], ADD_TAGS: ["iframe"] });
}
