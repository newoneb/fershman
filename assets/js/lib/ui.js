// Toasts, confirm dialogs and theme switching.
import { esc } from "./util.js";

export function toast(message, { error = false, duration = 3400 } = {}) {
  let zone = document.querySelector(".toast-zone");
  if (!zone) {
    zone = document.createElement("div");
    zone.className = "toast-zone";
    zone.setAttribute("role", "status");
    zone.setAttribute("aria-live", "polite");
    document.body.append(zone);
  }
  const t = document.createElement("div");
  t.className = "toast" + (error ? " is-error" : "");
  t.textContent = message;
  zone.append(t);
  setTimeout(() => t.remove(), duration);
}

/** Promise<boolean>. Uses a native <dialog>. */
export function confirmDialog(message, { title = "Are you sure?", confirm = "Confirm", cancel = "Cancel", danger = false } = {}) {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "dialog";
    dlg.innerHTML = `
      <form method="dialog">
        <h2>${esc(title)}</h2>
        <p>${esc(message)}</p>
        <div class="dialog-actions">
          <button value="cancel" class="btn">${esc(cancel)}</button>
          <button value="ok" class="btn ${danger ? "btn-danger" : "btn-accent"}">${esc(confirm)}</button>
        </div>
      </form>`;
    document.body.append(dlg);
    dlg.addEventListener("close", () => { resolve(dlg.returnValue === "ok"); dlg.remove(); });
    dlg.showModal();
    dlg.querySelector('button[value="ok"]').focus();
  });
}

/** Promise<string|null> */
export function promptDialog(message, { title = "", value = "", confirm = "Save", placeholder = "" } = {}) {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "dialog";
    dlg.innerHTML = `
      <form method="dialog">
        ${title ? `<h2>${esc(title)}</h2>` : ""}
        <label class="field"><span class="label">${esc(message)}</span>
          <input class="input" name="v" value="${esc(value)}" placeholder="${esc(placeholder)}"></label>
        <div class="dialog-actions">
          <button value="cancel" class="btn" formnovalidate>Cancel</button>
          <button value="ok" class="btn btn-accent">${esc(confirm)}</button>
        </div>
      </form>`;
    document.body.append(dlg);
    const input = dlg.querySelector("input");
    dlg.addEventListener("close", () => { resolve(dlg.returnValue === "ok" ? input.value.trim() : null); dlg.remove(); });
    dlg.showModal();
    input.focus();
    input.select();
  });
}

const THEME_KEY = "fj-theme";
export function getTheme() {
  try { return localStorage.getItem(THEME_KEY) || "auto"; } catch (_) { return "auto"; }
}
export function setTheme(mode) {
  try { mode === "auto" ? localStorage.removeItem(THEME_KEY) : localStorage.setItem(THEME_KEY, mode); } catch (_) { /* private mode */ }
  if (mode === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", mode);
}

export function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.append(ta);
  ta.select();
  try { document.execCommand("copy"); } finally { ta.remove(); }
  return Promise.resolve();
}

/** Replace broken images with a fallback (cover art or initials). */
export function installImageFallbacks(makeFallback) {
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || img.dataset.failed) return;
    img.dataset.failed = "1";
    const replacement = makeFallback(img);
    if (replacement) img.replaceWith(replacement);
  }, true);
}

export function downloadFile(filename, content, type = "text/plain") {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Side panel built on <dialog>. Returns { el, body, foot, close }.
 * `body`/`foot` are HTML strings (already escaped) or nodes.
 */
export function openPanel({ title = "", body = "", foot = "", wide = false, onClose } = {}) {
  const dlg = document.createElement("dialog");
  dlg.className = "panel-dialog" + (wide ? " wide" : "");
  dlg.innerHTML = `
    <div class="panel-head"><h2></h2><button type="button" class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    <div class="panel-body"></div>
    <div class="panel-foot"></div>`;
  dlg.querySelector(".panel-head h2").textContent = title;
  const bodyEl = dlg.querySelector(".panel-body");
  const footEl = dlg.querySelector(".panel-foot");
  if (typeof body === "string") bodyEl.innerHTML = body; else if (body) bodyEl.append(body);
  if (typeof foot === "string") footEl.innerHTML = foot; else if (foot) footEl.append(foot);
  if (!foot) footEl.remove();
  document.body.append(dlg);
  const close = () => { if (dlg.open) dlg.close(); };
  dlg.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) close();
    if (e.target === dlg) close(); // backdrop click
  });
  dlg.addEventListener("close", () => { dlg.remove(); if (onClose) onClose(); });
  dlg.showModal();
  return { el: dlg, body: bodyEl, foot: footEl, close, setTitle: (t) => { dlg.querySelector(".panel-head h2").textContent = t; } };
}
