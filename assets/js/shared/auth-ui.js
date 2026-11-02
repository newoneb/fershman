// Sign in / request access / reset password screens for the admin panel and member portal.
import { db, LIVE, config } from "../data/db.js";
import { html, mount, coverArt, isEmail, $ } from "../lib/util.js";
import { friendlyError, isEmailDeliveryError } from "../data/shared.js";

const COPY = {
  admin: { kicker: "Admin", quote: "The newsroom: write, edit and publish the journal.", sub: "For writers and editors of The Fershman Journal." },
  portal: { kicker: "Members", quote: "Decks, models and recordings from inside the journal.", sub: "For members of The Fershman Journal." },
};

/**
 * Render the auth screen into `root`.
 * options: { context: "admin"|"portal", mode: "signin"|"signup"|"forgot"|"reset", onDone(session) }
 */
export function renderAuth(root, { context = "portal", mode = "signin", onDone } = {}) {
  const c = COPY[context];
  const allowSignup = context === "portal";
  let state = mode;
  let flash = "";

  const demoNote = LIVE ? "" : html`<div class="notice notice-warn" style="margin-top:18px">Demo mode: any email and password signs you in as an admin. Use <strong>member@example.com</strong> to see the member view.</div>`;

  function view() {
    const tabs = allowSignup && (state === "signin" || state === "signup") ? html`
      <div class="seg" role="tablist" aria-label="Account">
        <button type="button" data-mode="signin" aria-pressed="${state === "signin" ? "true" : "false"}">Sign in</button>
        <button type="button" data-mode="signup" aria-pressed="${state === "signup" ? "true" : "false"}">Request access</button>
      </div>` : "";
    let box;
    if (state === "signin") {
      box = html`
        <h1>${context === "admin" ? "Sign in to the admin" : "Members portal"}</h1>
        <p>${c.sub}</p>${tabs}${demoNote}
        ${flash ? html`<div class="notice" style="margin-top:18px">${flash}</div>` : ""}
        <form class="form" novalidate data-form="signin">
          <div class="field"><label for="au-email">Email</label><input class="input" id="au-email" name="email" type="email" autocomplete="email" required></div>
          <div class="field"><label for="au-pass">Password</label><input class="input" id="au-pass" name="password" type="password" autocomplete="current-password" required></div>
          <p class="form-error" role="alert"></p>
          <button class="btn btn-accent" type="submit">Sign in</button>
        </form>
        <div class="auth-links"><button type="button" data-mode="forgot">Forgot your password?</button>
          ${context === "admin" ? html`<a href="/portal/">Members portal</a>` : html`<a href="/">Back to the journal</a>`}</div>
        ${allowSignup ? html`<p class="form-note" style="margin-top:22px">Had an account on the old fershman.com? Old accounts didn't move to the new site. Choose <button type="button" class="link-inline" data-mode="signup">Request access</button> to create one with the same email.</p>` : ""}`;
    } else if (state === "signup") {
      box = html`
        <h1>Request access</h1>
        <p>Create an account. An admin approves new members before they can see the library.</p>${tabs}${demoNote}
        <form class="form" novalidate data-form="signup">
          <div class="field"><label for="au-name">Full name</label><input class="input" id="au-name" name="name" autocomplete="name" required></div>
          <div class="field"><label for="au-email">Email</label><input class="input" id="au-email" name="email" type="email" autocomplete="email" required></div>
          <div class="field"><label for="au-pass">Password</label><input class="input" id="au-pass" name="password" type="password" autocomplete="new-password" minlength="8" required><span class="hint">At least 8 characters.</span></div>
          <p class="form-error" role="alert"></p>
          <button class="btn btn-accent" type="submit">Request access</button>
        </form>
        <div class="auth-links"><a href="/">Back to the journal</a></div>`;
    } else if (state === "forgot") {
      box = html`
        <h1>Reset your password</h1>
        <p>Enter your account email and we'll send you a link to choose a new password.</p>
        <form class="form" novalidate data-form="forgot">
          <div class="field"><label for="au-email">Email</label><input class="input" id="au-email" name="email" type="email" autocomplete="email" required></div>
          <p class="form-error" role="alert"></p>
          <button class="btn btn-accent" type="submit">Send reset link</button>
        </form>
        <div class="auth-links"><button type="button" data-mode="signin">Back to sign in</button></div>`;
    } else if (state === "reset") {
      box = html`
        <h1>Choose a new password</h1>
        <p>You're signed in through your reset link. Set a new password to finish.</p>
        <form class="form" novalidate data-form="reset">
          <div class="field"><label for="au-pass">New password</label><input class="input" id="au-pass" name="password" type="password" autocomplete="new-password" minlength="8" required></div>
          <div class="field"><label for="au-pass2">Repeat new password</label><input class="input" id="au-pass2" name="password2" type="password" autocomplete="new-password" required></div>
          <p class="form-error" role="alert"></p>
          <button class="btn btn-accent" type="submit">Save new password</button>
        </form>`;
    } else if (state === "check-email") {
      box = html`
        <h1>Check your email</h1>
        <p>${flash}</p>
        <div class="auth-links"><button type="button" data-mode="signin">Back to sign in</button></div>`;
    }
    return html`
      <div class="auth-wrap">
        <div class="auth-art">
          ${coverArt("fershman-" + context, "markets")}
          <a href="/">${config.site.name}</a>
          <div><blockquote>${c.quote}</blockquote></div>
        </div>
        <main class="auth-panel" id="main"><div class="auth-box">${box}</div></main>
      </div>`;
  }

  function draw() {
    mount(root, view());
    const first = root.querySelector("input");
    if (first) first.focus();
  }

  root.onclick = (e) => {
    const b = e.target.closest("[data-mode]");
    if (b) { state = b.dataset.mode; flash = ""; draw(); }
  };
  root.onsubmit = async (e) => {
    const form = e.target.closest("form[data-form]");
    if (!form) return;
    e.preventDefault();
    const err = form.querySelector(".form-error");
    const btn = form.querySelector('button[type="submit"]');
    const v = Object.fromEntries(new FormData(form).entries());
    err.textContent = "";
    const kind = form.dataset.form;
    if (v.email !== undefined && !isEmail(v.email)) { err.textContent = "Enter a valid email address."; return; }
    if ((kind === "signin" || kind === "signup") && !v.password) { err.textContent = "Enter your password."; return; }
    if ((kind === "signup" || kind === "reset") && String(v.password).length < 8) { err.textContent = "Use at least 8 characters for your password."; return; }
    if (kind === "reset" && v.password !== v.password2) { err.textContent = "The two passwords don't match."; return; }
    if (kind === "signup" && !String(v.name || "").trim()) { err.textContent = "Enter your name."; return; }
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Please wait…";
    try {
      if (kind === "signin") {
        const session = await db.signIn(v.email, v.password);
        onDone && onDone(session);
        return;
      }
      if (kind === "signup") {
        const r = await db.signUp(v.email, v.password, v.name.trim());
        if (r.needsConfirmation) {
          state = "check-email";
          flash = `We sent a confirmation link to ${v.email}. Open it, then come back and sign in. An admin will approve your access. If nothing arrives in a few minutes, check your spam folder or email ${config.site.contactEmail || "the journal"}.`;
          draw();
        } else {
          onDone && onDone(await db.getSession());
        }
        return;
      }
      if (kind === "forgot") {
        await db.sendPasswordReset(v.email);
        state = "check-email";
        flash = LIVE ? `If an account exists for ${v.email}, a reset link is on its way.` : "Demo mode doesn't send email. In live mode, a reset link would be on its way.";
        draw();
        return;
      }
      if (kind === "reset") {
        await db.updatePassword(v.password);
        const url = new URL(location.href);
        url.searchParams.delete("reset");
        history.replaceState(null, "", url);
        onDone && onDone(await db.getSession());
      }
    } catch (ex) {
      const message = friendlyError(ex);
      if (kind === "signup" && /already exists/.test(message)) {
        state = "signin";
        flash = "You already have an account with this email. Sign in below, or use Forgot your password.";
        draw();
        const email = root.querySelector("#au-email");
        if (email) email.value = v.email;
        const pass = root.querySelector("#au-pass");
        if (pass) pass.focus();
        return;
      }
      err.textContent = message;
      const contact = config.site.contactEmail;
      const ask = message.match(/^([\s\S]*?\bemail )the journal([\s\S]*)$/i);
      if (contact && ask) {
        // "…email the journal and we'll sort it out" -> "…email <contact> and we'll sort it out"
        const a = document.createElement("a");
        a.href = `mailto:${contact}?subject=${encodeURIComponent("Fershman portal access")}`;
        a.textContent = contact;
        err.textContent = "";
        err.append(ask[1], a, ask[2]);
      } else if (contact && isEmailDeliveryError(ex)) {
        const a = document.createElement("a");
        a.href = `mailto:${contact}`;
        a.textContent = contact;
        err.append(" Contact ", a, ".");
      } else if (kind === "signin" && !allowSignup && /incorrect/.test(message)) {
        // The portal already says this under its form; the admin sign-in has no Request access tab.
        err.append(" Accounts from the old fershman.com didn't carry over. Request access in the members portal first.");
      }
      btn.disabled = false;
      btn.textContent = label;
    }
  };
  draw();
}

/** Screen for signed-in accounts that lack the needed role. */
export function renderNoAccess(root, { session, context, message, actions = "" }) {
  mount(root, html`
    <div class="auth-wrap">
      <div class="auth-art">${coverArt("fershman-wait-" + context, "policy")}<a href="/">${config.site.name}</a><div><blockquote>${COPY[context].quote}</blockquote></div></div>
      <main class="auth-panel" id="main"><div class="auth-box">
        <h1>${message.title}</h1>
        <p>${message.text}</p>
        <p class="small muted" style="margin-top:14px">Signed in as ${session.user.email}.</p>
        <div class="row" style="margin-top:22px">${actions}<button class="btn" type="button" data-signout>Sign out</button></div>
      </div></main>
    </div>`);
  $("[data-signout]", root).addEventListener("click", async () => { await db.signOut(); location.reload(); });
}
