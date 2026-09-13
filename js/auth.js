// ============================================================
// auth.js v19 — Supabase email/password authentication
// v19: added forgot-password flow (request reset email, recovery-redirect
//      handling, set-new-password screen in the login modal).
// ============================================================
//
// How it works:
//   1. On load, checks localStorage for a saved session.
//   2. If a valid session exists, restores the user JWT as the
//      Bearer token — this satisfies RLS policies that require
//      auth.uid() to be set.
//   3. If no session (or expired), app runs in read-only mode.
//      The yellow banner prompts sign-in.
//   4. On sign-in, POSTs to Supabase auth endpoint, gets a
//      user JWT, swaps it into the shared H/JH headers, hides
//      the banner, updates the sidebar button.
//   5. On sign-out, clears the session, restores the anon key,
//      shows the banner again.
//
// Depends on: shared.js (SB_URL, SB_KEY, H, JH)
// ============================================================

var AUTH_SESSION_KEY = 'sf_auth_session';

// ============================================================
// INIT — called on DOMContentLoaded
// ============================================================
async function authInit() {
  // A recovery-email link lands back here with the session in the URL hash
  // (Supabase's implicit flow) — handle that before falling back to any
  // saved session, since the recovery token takes priority.
  if (_authHandleRecoveryRedirect()) return;

  var saved = _authLoadSession();
  if (saved) {
    // Check expiry (Supabase expires_at is Unix timestamp in seconds)
    if (saved.expires_at && Date.now() / 1000 < saved.expires_at - 60) {
      _authApplySession(saved);
      return;
    }
    // Expired — try to refresh
    var refreshed = await _authRefresh(saved.refresh_token);
    if (refreshed) {
      _authApplySession(refreshed);
      return;
    }
    // Refresh failed — clear and fall through to read-only
    _authClearSession();
  }
  _authSetReadOnly();
}

// ============================================================
// MODAL
// ============================================================
function authShowLoginModal() {
  document.getElementById('auth-email').value    = '';
  document.getElementById('auth-password').value = '';
  document.getElementById('auth-login-status').textContent = '';
  authShowSigninView();
  document.getElementById('auth-login-modal').style.display = 'flex';
  setTimeout(function() { document.getElementById('auth-email').focus(); }, 50);

  // Allow Enter key to submit
  document.getElementById('auth-password').onkeydown = function(e) {
    if (e.key === 'Enter') authSubmitLogin();
  };
}

function authCloseLoginModal() {
  document.getElementById('auth-login-modal').style.display = 'none';
}

// ============================================================
// MODAL — view switching (sign in / forgot password / set new password)
// ============================================================
function _authShowView(viewId) {
  ['auth-signin-view', 'auth-forgot-view', 'auth-newpw-view'].forEach(function(id) {
    document.getElementById(id).style.display = (id === viewId) ? 'block' : 'none';
  });
}

function authShowSigninView() {
  _authShowView('auth-signin-view');
}

function authShowForgotView() {
  document.getElementById('auth-forgot-email').value = document.getElementById('auth-email').value;
  document.getElementById('auth-forgot-status').textContent = '';
  _authShowView('auth-forgot-view');
}

// ============================================================
// FORGOT PASSWORD — request a reset email
// ============================================================
async function authRequestPasswordReset() {
  var statusEl = document.getElementById('auth-forgot-status');
  var btn      = document.getElementById('auth-forgot-btn');
  var email    = document.getElementById('auth-forgot-email').value.trim();

  if (!email) {
    statusEl.textContent = 'Enter your email.';
    statusEl.style.color = 'var(--red)';
    return;
  }

  btn.disabled = true;
  statusEl.textContent = 'Sending…';
  statusEl.style.color = 'var(--muted)';

  try {
    var res = await fetch(SB_URL + '/auth/v1/recover', {
      method: 'POST',
      headers: { 'apikey': SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, options: { redirect_to: window.location.origin + window.location.pathname } })
    });
    if (!res.ok) {
      var data = await res.json().catch(function() { return {}; });
      throw new Error(data.error_description || data.msg || 'Could not send reset email.');
    }
    statusEl.textContent = 'Check your email for a reset link.';
    statusEl.style.color = 'var(--green)';
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.style.color = 'var(--red)';
  } finally {
    btn.disabled = false;
  }
}

// ============================================================
// RECOVERY REDIRECT — land here from the emailed reset link
// ============================================================
var _authRecoverySession = null; // holds the one-time recovery tokens until the new password is set

function _authHandleRecoveryRedirect() {
  var hash = window.location.hash;
  if (!hash || hash.indexOf('type=recovery') === -1) return false;

  var params = new URLSearchParams(hash.substring(1));
  var accessToken  = params.get('access_token');
  var refreshToken = params.get('refresh_token');
  var expiresIn    = parseInt(params.get('expires_in'), 10) || 3600;
  if (!accessToken) return false;

  _authRecoverySession = {
    access_token:  accessToken,
    refresh_token: refreshToken,
    expires_at:    Math.floor(Date.now() / 1000) + expiresIn
  };

  // Strip the token out of the URL bar so it's not left sitting in history.
  history.replaceState(null, '', window.location.pathname + window.location.search);

  _authSetReadOnly(); // headers stay on the anon key until the new password is actually saved
  document.getElementById('auth-newpw-1').value = '';
  document.getElementById('auth-newpw-2').value = '';
  document.getElementById('auth-newpw-status').textContent = '';
  _authShowView('auth-newpw-view');
  document.getElementById('auth-login-modal').style.display = 'flex';
  return true;
}

async function authSubmitNewPassword() {
  var statusEl = document.getElementById('auth-newpw-status');
  var btn      = document.getElementById('auth-newpw-btn');
  var pw1      = document.getElementById('auth-newpw-1').value;
  var pw2      = document.getElementById('auth-newpw-2').value;

  if (!pw1 || pw1.length < 6) {
    statusEl.textContent = 'Password must be at least 6 characters.';
    statusEl.style.color = 'var(--red)';
    return;
  }
  if (pw1 !== pw2) {
    statusEl.textContent = 'Passwords do not match.';
    statusEl.style.color = 'var(--red)';
    return;
  }
  if (!_authRecoverySession) {
    statusEl.textContent = 'Reset link expired. Request a new one.';
    statusEl.style.color = 'var(--red)';
    return;
  }

  btn.disabled = true;
  statusEl.textContent = 'Saving…';
  statusEl.style.color = 'var(--muted)';

  try {
    var res = await fetch(SB_URL + '/auth/v1/user', {
      method: 'PUT',
      headers: {
        'apikey':        SB_KEY,
        'Authorization': 'Bearer ' + _authRecoverySession.access_token,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({ password: pw1 })
    });
    var data = await res.json();
    if (!res.ok) {
      throw new Error(data.error_description || data.msg || 'Could not set password.');
    }

    var session = {
      access_token:  _authRecoverySession.access_token,
      refresh_token: _authRecoverySession.refresh_token,
      expires_at:    _authRecoverySession.expires_at,
      user_email:    data.email || ''
    };
    _authRecoverySession = null;
    _authSaveSession(session);
    _authApplySession(session);
    authCloseLoginModal();
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.style.color = 'var(--red)';
  } finally {
    btn.disabled = false;
  }
}

// ============================================================
// SIGN IN
// ============================================================
async function authSubmitLogin() {
  var statusEl = document.getElementById('auth-login-status');
  var btn      = document.getElementById('auth-submit-btn');
  var email    = document.getElementById('auth-email').value.trim();
  var password = document.getElementById('auth-password').value;

  if (!email || !password) {
    statusEl.textContent = 'Email and password required.';
    statusEl.style.color = 'var(--red)';
    return;
  }

  btn.disabled = true;
  statusEl.textContent = 'Signing in…';
  statusEl.style.color = 'var(--muted)';

  try {
    var res = await fetch(SB_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: {
        'apikey':       SB_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email: email, password: password })
    });

    var data = await res.json();

    if (!res.ok) {
      throw new Error(data.error_description || data.msg || 'Sign-in failed.');
    }

    // Build session object
    var session = {
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expires_at:    Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
      user_email:    data.user ? data.user.email : email
    };

    _authSaveSession(session);
    _authApplySession(session);
    authCloseLoginModal();

  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.style.color = 'var(--red)';
  } finally {
    btn.disabled = false;
  }
}

// ============================================================
// SIGN OUT
// ============================================================
async function authSignOut() {
  // Attempt server-side sign-out (best-effort)
  try {
    var token = (_authLoadSession() || {}).access_token;
    if (token) {
      await fetch(SB_URL + '/auth/v1/logout', {
        method: 'POST',
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + token }
      });
    }
  } catch (_) { /* ignore */ }

  _authClearSession();
  _authSetReadOnly();
}

// ============================================================
// INTERNAL HELPERS
// ============================================================
function _authApplySession(session) {
  // Swap Bearer token in shared.js headers to user JWT
  // H and JH are declared as var in shared.js — reassign values
  H['Authorization']  = 'Bearer ' + session.access_token;
  JH['Authorization'] = 'Bearer ' + session.access_token;

  // Hide read-only banner
  var banner = document.getElementById('auth-readonly-banner');
  if (banner) banner.style.display = 'none';

  // Render signed-in button in sidebar
  var container = document.getElementById('auth-btn-container');
  if (container) {
    var label = session.user_email || 'Signed in';
    container.innerHTML =
      '<div style="font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + label + '">' + label + '</div>' +
      '<button onclick="authSignOut()" style="width:100%;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.7);border-radius:7px;padding:6px 10px;font-size:12px;cursor:pointer;font-family:inherit">Sign out</button>';
  }
}

function _authSetReadOnly() {
  // Restore anon key as Bearer
  H['Authorization']  = 'Bearer ' + SB_KEY;
  JH['Authorization'] = 'Bearer ' + SB_KEY;

  // Show read-only banner
  var banner = document.getElementById('auth-readonly-banner');
  if (banner) banner.style.display = 'flex';

  // Render sign-in button in sidebar
  var container = document.getElementById('auth-btn-container');
  if (container) {
    container.innerHTML =
      '<button onclick="authShowLoginModal()" style="width:100%;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.7);border-radius:7px;padding:6px 10px;font-size:12px;cursor:pointer;font-family:inherit">&#128274; Sign in</button>';
  }
}

async function _authRefresh(refreshToken) {
  try {
    var res = await fetch(SB_URL + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { 'apikey': SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    if (!res.ok) return null;
    var data = await res.json();
    return {
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expires_at:    Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
      user_email:    data.user ? data.user.email : ''
    };
  } catch (_) { return null; }
}

function _authSaveSession(session) {
  try { localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session)); } catch (_) {}
}

function _authLoadSession() {
  try {
    var s = localStorage.getItem(AUTH_SESSION_KEY);
    return s ? JSON.parse(s) : null;
  } catch (_) { return null; }
}

function _authClearSession() {
  try { localStorage.removeItem(AUTH_SESSION_KEY); } catch (_) {}
}
