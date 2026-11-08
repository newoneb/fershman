// Recruiting pop-up: while a recruiting period is on, a small card slides in on public pages and
// points visitors to /apply. It never blocks the page, shows at most once per visit, and stays away
// for the rest of the period once someone dismisses it or clicks through.
import { db } from "../data/db.js";
import { html, mount, icon, $ } from "../lib/util.js";
import { mergeRecruiting, activePeriod } from "../data/shared.js";
import { track } from "./analytics.js";

const SKIP = /^\/(apply|admin|portal)(\/|$)/;

function storage(kind) {
  try { return kind === "local" ? localStorage : sessionStorage; } catch (_) { return null; }
}
const dayLabel = (d) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric" });

export async function recruitingPopup(settingsPromise, periodsPromise) {
  if (SKIP.test(location.pathname) || new URLSearchParams(location.search).has("preview")) return;
  let settings, periods;
  try {
    [settings, periods] = await Promise.all([settingsPromise, periodsPromise || db.listRecruitingPeriods()]);
  } catch (_) { return; }
  const rc = mergeRecruiting(settings && settings.recruiting);
  if (rc.status === "closed" || rc.popup === false) return;
  const { active } = activePeriod(periods || [], new Date(), rc.timezone || "America/Chicago");
  if (!active) return;
  const key = `fj-recruit-${active.id}`;
  const local = storage("local"), session = storage("session");
  if (local && local.getItem(key)) return; // dismissed or clicked through this period
  if (session && session.getItem(key)) return; // already shown during this visit

  let next = null;
  try {
    const now = Date.now();
    next = (await db.listInfoSessions())
      .filter((s) => new Date(s.starts_at).getTime() > now && !(s.capacity && s.registered >= s.capacity))
      .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))[0] || null;
  } catch (_) { next = null; }

  const tz = rc.timezone || "America/Chicago";
  const when = next ? new Date(next.starts_at).toLocaleString("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).replace(":00", "") : "";
  // The period's own note is internal, so the card uses the pop-up message from the Apply page settings.
  const msg = String(rc.popupText || "").trim();
  const text = msg.length > 180 ? msg.slice(0, 177).replace(/\s+\S*$/, "") + "…" : msg;

  const show = () => {
    if (document.getElementById("recruit-pop") || document.body.classList.contains("drawer-open")) return;
    if (session) session.setItem(key, "shown");
    const wrap = document.createElement("div");
    wrap.id = "recruit-pop";
    mount(wrap, html`
      <aside class="recruit-pop" role="region" aria-labelledby="recruit-pop-h">
        <button class="recruit-pop-x" type="button" data-pop-close aria-label="Dismiss">${icon("close")}</button>
        <p class="recruit-pop-kicker"><span class="dot" aria-hidden="true"></span>Now recruiting</p>
        <h2 id="recruit-pop-h">${active.title} is on</h2>
        <p class="recruit-pop-text">${text ? `${text} ` : ""}Apply by ${dayLabel(active.ends_on)}.</p>
        ${next ? html`<p class="recruit-pop-session">${icon("calendar")}<span>Info session ${when}${next.location ? `, ${next.location}` : next.is_online ? ", online" : ""}</span></p>` : ""}
        <div class="recruit-pop-actions">
          <a class="btn btn-accent btn-sm" href="/apply" data-pop-go>How to apply</a>
          ${next ? html`<a class="btn btn-sm" href="/apply#info-sessions" data-pop-go="session">Info sessions</a>` : html`<button class="btn btn-sm btn-quiet" type="button" data-pop-close>Not now</button>`}
        </div>
      </aside>`);
    document.body.append(wrap);
    requestAnimationFrame(() => requestAnimationFrame(() => wrap.firstElementChild.classList.add("is-in")));
    track("recruiting_popup", { popup_action: "view", period_title: active.title });
    const close = (action) => {
      if (local) local.setItem(key, action);
      track("recruiting_popup", { popup_action: action, period_title: active.title });
      const card = wrap.firstElementChild;
      card.classList.remove("is-in");
      setTimeout(() => wrap.remove(), 260);
      document.removeEventListener("keydown", onKey);
    };
    const onKey = (e) => { if (e.key === "Escape" && document.getElementById("recruit-pop")) close("dismiss"); };
    document.addEventListener("keydown", onKey);
    wrap.addEventListener("click", (e) => {
      if (e.target.closest("[data-pop-close]")) close("dismiss");
      const go = e.target.closest("[data-pop-go]");
      if (go) { if (local) local.setItem(key, "click"); track("recruiting_popup", { popup_action: go.dataset.popGo || "apply", period_title: active.title }); }
    });
  };

  // Let the page settle first: after a few seconds, or once the reader starts scrolling.
  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    removeEventListener("scroll", onScroll);
    show();
  };
  const onScroll = () => { if (scrollY > 600) fire(); };
  addEventListener("scroll", onScroll, { passive: true });
  setTimeout(fire, 4000);
}
