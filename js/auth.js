// ============================================================
// auth.js — Authentication and write-protection
// ============================================================

var AUTH_USERNAME  = 'Rrezza';
var AUTH_EMAIL     = 'rezarrezza@gmail.com';
var authSession    = null;
var authInitDone   = false;

// ============================================================
// INIT — call once on page load
// ============================================================
async function authInit() {
  await authCheckSession();
  authRenderButton();
  authApplyWriteProtection();
  authInitDone = true;
}

// ============================================================
// SESSION CHECK
// ============================================================
async function authCheckSession() {
  try {
    var stored = localStorage.getItem('sb_session');
    if (!stored) return;
    var session = JSON.parse(stored);
    // Check expiry
    if (!session.expires_at || Date.now() / 1000 > session.expires_at) {
      localStorage.removeItem('sb_session');
      authSession = null;
      return;
    }
    // Verify with Supabase
    var res = await fetch(SB_URL + '/auth/v1/user', {
      headers: {
        'apikey':        SB_KEY,
        'Authorization': 'Bearer ' + session.access_token
      }
    });
    if (res.ok) {
      authSession = session;
    } else {
      localStorage.removeItem('sb_session');
      authSession = null;
    }
  } catch(e) {
    authSession = null;
  }
}

function authIsLoggedIn() {
  return authSession !== null;
}

function authAccessToken() {
  return authSession ? authSession.access_token : null;
}

// ============================================================
// LOGIN
// ============================================================
async function authLogin(password) {
  var res = await fetch(SB_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: {
      'apikey':       SB_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email: AUTH_EMAIL, password: password })
  });
  var data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || 'Login failed');
  authSession = {
    access_token: data.access_token,
    expires_at:   Math.floor(Date.now() / 1000) + data.expires_in
  };
  localStorage.setItem('sb_session', JSON.stringify(authSession));
  return authSession;
}

// ============================================================
// LOGOUT
// ============================================================
async function authLogout() {
  try {
    if (authSession) {
      await fetch(SB_URL + '/auth/v1/logout', {
        method: 'POST',
        headers: {
          'apikey':        SB_KEY,
          'Authorization': 'Bearer ' + authSession.access_token
        }
      });
    }
  } catch(e) {}
  authSession = null;
  localStorage.removeItem('sb_session');
  authRenderButton();
  authApplyWriteProtection();
}

// ============================================================
// SUPABASE HEADER OVERRIDE
// When logged in, inject Bearer token so writes are authenticated
// ============================================================
function authHeaders(json) {
  var token = authAccessToken() || SB_KEY;
  if (json) return {
    'apikey':        SB_KEY,
    'Authorization': 'Bearer ' + token,
    'Content-Type':  'application/json'
  };
  return {
    'apikey':        SB_KEY,
    'Authorization': 'Bearer ' + token
  };
}

// Patch shared.js fetch headers at runtime
function authPatchGlobals() {
  window.H  = authHeaders(false);
  window.JH = authHeaders(true);
}

// ============================================================
// WRITE PROTECTION
// Disable all write buttons/inputs when logged out
// ============================================================
function authApplyWriteProtection() {
  authPatchGlobals();
  var loggedIn = authIsLoggedIn();

  // Elements that should only be active when logged in
  var writeSelectors = [
    '.btn-primary',
    'input[type="number"]',
    'input[type="text"]',
    'input[type="date"]',
    'input[type="datetime-local"]',
    'input[type="checkbox"]',
    'select',
    '.del-btn'
  ];

  // We use a CSS class approach — cleaner than iterating every element
  var style = document.getElementById('auth-write-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'auth-write-style';
    document.head.appendChild(style);
  }

  if (loggedIn) {
    style.textContent = '';
  } else {
    style.textContent =
      '.btn-primary:not(.auth-submit-btn) { opacity: 0.35; pointer-events: none; cursor: not-allowed; }\n' +
      '.del-btn { opacity: 0.35; pointer-events: none; cursor: not-allowed; }\n' +
      '.main input:not(.auth-input), .main select, .main textarea { pointer-events: none; background: var(--bg) !important; }';
  }

  // Show/hide the read-only banner
  var banner = document.getElementById('auth-readonly-banner');
  if (banner) banner.style.display = loggedIn ? 'none' : 'flex';
}

// ============================================================
// LOGIN MODAL
// ============================================================
function authShowLoginModal() {
  var existing = document.getElementById('auth-modal');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = 'auth-modal';
  modal.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:1000;' +
    'display:flex;align-items:center;justify-content:center';
  modal.innerHTML =
    '<div class="auth-modal-box" style="background:var(--bg);border:1px solid var(--border);border-radius:12px;' +
    'padding:32px;width:320px;box-shadow:0 8px 32px rgba(0,0,0,0.2)">' +
      '<div style="font-size:16px;font-weight:600;margin-bottom:6px">ShadeSide Farms</div>' +
      '<div style="font-size:13px;color:var(--muted);margin-bottom:24px">Sign in to edit</div>' +
      '<div style="margin-bottom:14px">' +
        '<label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">Username</label>' +
        '<div style="font-size:14px;font-weight:500;padding:6px 0">Rrezza</div>' +
      '</div>' +
      '<div style="margin-bottom:20px">' +
        '<label style="font-size:12px;color:var(--muted);display:block;margin-bottom:4px">Password</label>' +
        '<input id="auth-pw-input" type="password" placeholder="Password" ' +
        'class="auth-input" ' +
        'style="width:100%;box-sizing:border-box;font-size:14px" ' +
        'onkeydown="if(event.key===\'Enter\')authSubmitLogin()">' +
      '</div>' +
      '<div style="display:flex;gap:10px;align-items:center">' +
        '<button class="auth-submit-btn" onclick="authSubmitLogin()" ' +
        'style="padding:7px 18px;background:var(--green);color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer">Sign in</button>' +
        '<button class="auth-cancel-btn" onclick="authCloseModal()" ' +
        'style="padding:7px 14px;background:none;border:1px solid var(--border);border-radius:6px;font-size:13px;cursor:pointer">Cancel</button>' +
        '<span id="auth-login-status" style="font-size:12px;color:var(--red)"></span>' +
      '</div>' +
    '</div>';

  document.body.appendChild(modal);
  setTimeout(function() {
    var pw = document.getElementById('auth-pw-input');
    if (pw) pw.focus();
  }, 50);
}

function authCloseModal() {
  var modal = document.getElementById('auth-modal');
  if (modal) modal.remove();
}

async function authSubmitLogin() {
  var pw = document.getElementById('auth-pw-input');
  var st = document.getElementById('auth-login-status');
  if (!pw || !pw.value.trim()) { if (st) st.textContent = 'Password required.'; return; }
  if (st) st.textContent = 'Signing in…';
  try {
    await authLogin(pw.value.trim());
    authCloseModal();
    authRenderButton();
    authApplyWriteProtection();
  } catch(err) {
    if (st) st.textContent = err.message;
    if (pw) pw.value = '';
    if (pw) pw.focus();
  }
}

// ============================================================
// SIDEBAR BUTTON
// ============================================================
function authRenderButton() {
  var container = document.getElementById('auth-btn-container');
  if (!container) return;
  if (authIsLoggedIn()) {
    container.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">' +
        '<span style="font-size:12px;color:rgba(255,255,255,0.7)">&#10003; ' + AUTH_USERNAME + '</span>' +
        '<button onclick="authLogout()" ' +
        'style="font-size:11px;color:rgba(255,255,255,0.45);background:none;border:none;cursor:pointer;padding:0;text-decoration:underline">Sign out</button>' +
      '</div>';
  } else {
    container.innerHTML =
      '<button onclick="authShowLoginModal()" ' +
      'style="font-size:12px;color:rgba(255,255,255,0.55);background:none;border:1px solid rgba(255,255,255,0.2);' +
      'border-radius:6px;padding:5px 12px;cursor:pointer;width:100%;text-align:center">Sign in</button>';
  }
}
