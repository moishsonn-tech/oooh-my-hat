// AI-Artist Intelligence — shared self-serve auth gate.
//
// Include after supabase-config.js and the Supabase JS CDN script on any page
// that should be artist-gated. No-ops entirely (page behaves exactly as
// today, no sign-in screen) until supabase-config.js has real project values —
// see the comment there. This is what lets every other page's <script> stay
// untouched right now and only start gating once Moshe drops in a real
// Supabase project.
//
// Auth model: self-serve signup, no allowlist/approval (anyone can request a
// magic link and gets an account) — matches the Chartmetric-style "artist
// sets it up themselves" flow, deliberately different from ENS Auto Group's
// allowed_emails gate. First login is always magic link (passkey enrollment
// needs an already-authenticated session, it can't create a new account by
// itself); "Register a passkey on this device" is offered once signed in, for
// fast sign-in next time.
(function (global) {
  'use strict';

  function isConfigured() {
    return !!(global.SUPABASE_URL && global.SUPABASE_ANON_KEY &&
      global.SUPABASE_URL.indexOf('YOUR-PROJECT') === -1);
  }

  var client = null;
  function getClient() {
    if (!isConfigured()) return null;
    if (!client) {
      if (!global.supabase || !global.supabase.createClient) {
        console.warn('[auth-gate] supabase-js not loaded — add the CDN <script> before auth-gate.js');
        return null;
      }
      client = global.supabase.createClient(global.SUPABASE_URL, global.SUPABASE_ANON_KEY);
    }
    return client;
  }

  async function getSession() {
    var c = getClient();
    if (!c) return null;
    var res = await c.auth.getSession();
    return (res && res.data && res.data.session) || null;
  }

  async function requestMagicLink(email) {
    var c = getClient();
    if (!c) throw new Error('Supabase not configured yet');
    var res = await c.auth.signInWithOtp({
      email: email,
      options: { emailRedirectTo: global.location.origin + global.location.pathname }
    });
    if (res.error) throw res.error;
    return true;
  }

  async function signOut() {
    var c = getClient();
    if (!c) return;
    await c.auth.signOut();
  }

  // Passkey/WebAuthn — Supabase Auth's native support is a beta feature
  // (Authentication → Passkeys in the dashboard). Verify these method names
  // against current Supabase docs when actually enabling this; beta APIs can
  // rename between when this was written and when it's switched on.
  async function enrollPasskey() {
    var c = getClient();
    if (!c) throw new Error('Supabase not configured yet');
    if (!c.auth.mfa || !c.auth.mfa.enroll) throw new Error('Passkey enrollment unavailable — check Supabase Auth → Passkeys is enabled and the SDK version supports it');
    var res = await c.auth.mfa.enroll({ factorType: 'webauthn' });
    if (res.error) throw res.error;
    return res.data;
  }

  async function signInWithPasskey() {
    var c = getClient();
    if (!c) throw new Error('Supabase not configured yet');
    if (!c.auth.signInWithWebAuthn) throw new Error('Passkey sign-in unavailable — check Supabase Auth → Passkeys is enabled and the SDK version supports it');
    var res = await c.auth.signInWithWebAuthn();
    if (res.error) throw res.error;
    return res.data;
  }

  var GATE_STYLE = '' +
    '.auth-gate-overlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;' +
    'justify-content:center;background:var(--bg,#0b0d12);padding:20px;}' +
    '.auth-gate-panel{width:100%;max-width:360px;background:var(--panel,#151821);' +
    'border:1px solid var(--border,#262b38);border-radius:14px;padding:28px;}' +
    '.auth-gate-panel h2{margin:0 0 6px;font-size:18px;}' +
    '.auth-gate-panel p{margin:0 0 18px;font-size:13px;opacity:.7;line-height:1.5;}' +
    '.auth-gate-panel input{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;' +
    'border:1px solid var(--border,#262b38);background:var(--bg,#0b0d12);color:inherit;font-size:14px;' +
    'margin-bottom:10px;}' +
    '.auth-gate-panel button{width:100%;padding:10px 12px;border-radius:8px;border:none;' +
    'background:var(--accent,#5b8cff);color:#fff;font-size:14px;cursor:pointer;}' +
    '.auth-gate-note{margin-top:12px;font-size:12px;min-height:16px;}';

  function renderOverlay() {
    if (document.getElementById('authGateOverlay')) return;
    var style = document.createElement('style');
    style.textContent = GATE_STYLE;
    document.head.appendChild(style);

    var overlay = document.createElement('div');
    overlay.className = 'auth-gate-overlay';
    overlay.id = 'authGateOverlay';
    overlay.innerHTML =
      '<div class="auth-gate-panel">' +
        '<h2>Sign in</h2>' +
        '<p>Enter your email and we’ll send you a sign-in link. No password needed.</p>' +
        '<form id="authGateForm">' +
          '<input type="email" id="authGateEmail" placeholder="you@example.com" autocomplete="email" autofocus required/>' +
          '<button type="submit">Send sign-in link</button>' +
        '</form>' +
        '<div class="auth-gate-note" id="authGateNote"></div>' +
      '</div>';
    document.body.appendChild(overlay);

    document.getElementById('authGateForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = document.getElementById('authGateEmail').value.trim();
      var note = document.getElementById('authGateNote');
      note.textContent = 'Sending…';
      requestMagicLink(email)
        .then(function () { note.textContent = 'Check your email for a sign-in link.'; })
        .catch(function (err) { note.textContent = 'Failed: ' + err.message; });
    });
  }

  function removeOverlay() {
    var el = document.getElementById('authGateOverlay');
    if (el) el.remove();
  }

  // init() resolves once we know whether to show the app or the gate.
  // Callback receives the session (or null if unconfigured/signed out).
  async function init(onReady) {
    if (!isConfigured()) { onReady(null); return; }
    var session = await getSession();
    if (session) { removeOverlay(); onReady(session); }
    else { renderOverlay(); onReady(null); }

    var c = getClient();
    if (c) {
      c.auth.onAuthStateChange(function (_event, newSession) {
        if (newSession) { removeOverlay(); onReady(newSession); }
        else { renderOverlay(); onReady(null); }
      });
    }
  }

  global.AuthGate = {
    isConfigured: isConfigured,
    getClient: getClient,
    getSession: getSession,
    requestMagicLink: requestMagicLink,
    signOut: signOut,
    enrollPasskey: enrollPasskey,
    signInWithPasskey: signInWithPasskey,
    init: init
  };
})(window);
