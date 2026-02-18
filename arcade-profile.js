// Arcade Profile - client-side auth, score submission, and HUD bar
// Loaded by all games and the landing page
// v3 - Shadow DOM HUD (immune to game CSS)

(function() {
  'use strict';

  const API_BASE = '/api';
  const TOKEN_KEY = 'arcadeToken';
  const USER_KEY = 'arcadeUser';
  const AVATAR_KEY = 'arcadeAvatar';

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function getUsername() {
    return localStorage.getItem(USER_KEY);
  }

  function getAvatar() {
    return parseInt(localStorage.getItem(AVATAR_KEY) || '0');
  }

  function isLoggedIn() {
    return !!getToken();
  }

  function setSession(token, username, avatar) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, username);
    localStorage.setItem(AVATAR_KEY, String(avatar));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(AVATAR_KEY);
  }

  async function register(username, password, avatar) {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, avatar }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    setSession(data.token, data.username, data.avatar);
    return data;
  }

  async function login(username, password) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    setSession(data.token, data.username, data.avatar);
    return data;
  }

  function logout() {
    clearSession();
  }

  async function updateAvatar(avatarId) {
    const token = getToken();
    if (!token) return null;
    const res = await fetch(`${API_BASE}/auth/avatar`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ avatar: avatarId }),
    });
    if (res.ok) {
      localStorage.setItem(AVATAR_KEY, String(avatarId));
      return await res.json();
    }
    if (res.status === 401) clearSession();
    return null;
  }

  async function submitScore(gameId, score) {
    const token = getToken();
    if (!token) return null;
    try {
      const res = await fetch(`${API_BASE}/scores`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ game: gameId, score }),
      });
      if (res.status === 401) { clearSession(); return null; }
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }

  async function getLeaderboard(gameId) {
    try {
      const url = gameId ? `${API_BASE}/leaderboard?game=${gameId}` : `${API_BASE}/leaderboard`;
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }

  async function getProfile() {
    const token = getToken();
    if (!token) return null;
    try {
      const res = await fetch(`${API_BASE}/profile`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.status === 401) { clearSession(); return null; }
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }

  async function getCumulative() {
    const token = getToken();
    if (!token) return null;
    try {
      const res = await fetch(`${API_BASE}/profile/cumulative`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.status === 401) { clearSession(); return null; }
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }

  // ========== IN-GAME HUD BAR (Shadow DOM) ==========

  const HUD_H = 40;

  function renderHUD(options) {
    const { accentColor = '#0ff', gameId = '' } = options || {};

    // Remove old home buttons
    const oldBtn = document.querySelector('.home-btn');
    if (oldBtn) oldBtn.remove();

    // Prevent wide canvases from inflating the viewport
    const style = document.createElement('style');
    style.textContent = 'html{max-width:100vw!important;overflow-x:hidden!important}';
    document.head.appendChild(style);

    // Use screen width for fixed sizing (immune to viewport inflation)
    const screenW = Math.min(screen.width, window.innerWidth) || screen.width;

    // Host element - fixed width based on screen, not inflated viewport
    const host = document.createElement('div');
    host.id = 'arcade-hud-host';
    host.setAttribute('style',
      'position:fixed!important;top:0!important;left:0!important;' +
      'width:100vw!important;max-width:100vw!important;' +
      'z-index:99999!important;height:' + HUD_H + 'px!important;' +
      'pointer-events:auto!important;display:block!important;overflow:hidden!important;'
    );

    // Shadow DOM isolates HUD from ALL game CSS
    const shadow = host.attachShadow({ mode: 'open' });

    // Build avatar HTML if logged in
    let leftHTML = '';
    let avatarCanvas = null;
    if (isLoggedIn()) {
      if (window.ArcadeAvatars) {
        avatarCanvas = window.ArcadeAvatars.drawToCanvas(getAvatar(), 28);
      }
      leftHTML = `
        <span id="avatar-slot"></span>
        <span class="username">${getUsername().toUpperCase()}</span>
      `;
    } else {
      leftHTML = `<a href="../" class="login-link">LOGIN</a>`;
    }

    shadow.innerHTML = `
      <style>
        :host { all: initial; display: block; width: 100%; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        .bar {
          display: flex; align-items: center; justify-content: space-between;
          width: 100%; height: ${HUD_H}px; padding: 0 8px; gap: 6px;
          background: #000;
          border-bottom: 2px solid ${accentColor};
          font-family: 'Press Start 2P', 'Courier New', monospace;
          font-size: 10px; color: #ccc;
          user-select: none; -webkit-user-select: none;
        }
        .left {
          display: flex; align-items: center; gap: 6px;
          min-width: 0; flex: 1; overflow: hidden;
        }
        .center {
          color: ${accentColor}; white-space: nowrap; font-size: 9px;
          flex-shrink: 0;
        }
        .right { flex-shrink: 0; }
        .back-btn {
          color: ${accentColor}; text-decoration: none;
          font-family: 'Press Start 2P', 'Courier New', monospace;
          font-size: 10px; padding: 5px 8px;
          border: 1px solid ${accentColor}; border-radius: 3px;
          background: transparent; transition: background 0.2s;
          display: inline-block; white-space: nowrap;
        }
        .back-btn:hover { background: ${accentColor}33; }
        .username {
          color: #fff; white-space: nowrap; overflow: hidden;
          text-overflow: ellipsis; font-size: 10px;
        }
        .login-link {
          color: ${accentColor}; text-decoration: none;
          font-family: 'Press Start 2P', 'Courier New', monospace;
          font-size: 10px;
        }
        #avatar-slot canvas {
          flex-shrink: 0; image-rendering: pixelated;
          vertical-align: middle;
        }
      </style>
      <div class="bar">
        <div class="left">${leftHTML}</div>
        <div class="center" id="hud-score"></div>
        <div class="right">
          <a href="../" class="back-btn">&lt; ARCADE</a>
        </div>
      </div>
    `;

    // Insert avatar canvas into shadow DOM if available
    if (avatarCanvas) {
      const slot = shadow.getElementById('avatar-slot');
      if (slot) slot.appendChild(avatarCanvas);
    }

    // Fetch cumulative score for logged-in users
    if (isLoggedIn()) {
      getCumulative().then(data => {
        if (data && data.cumulative != null) {
          const scoreEl = shadow.getElementById('hud-score');
          if (scoreEl) scoreEl.textContent = 'TOTAL: ' + data.cumulative.toLocaleString();
        }
      });
    }

    document.body.prepend(host);

    // Push down game's fixed-position buttons so they don't overlap
    setTimeout(() => {
      const pushDown = (el) => {
        if (el === host) return;
        const top = parseInt(getComputedStyle(el).top);
        if (!isNaN(top) && top < HUD_H + 4) {
          el.style.top = (top + HUD_H + 4) + 'px';
        }
      };
      document.querySelectorAll('[style*="position: fixed"], [style*="position:fixed"]').forEach(pushDown);
      document.querySelectorAll('#btn-mute, #btn-back, .touch-btn[style*="top"]').forEach(pushDown);

      // Push canvas down if it's behind the HUD bar (prevents game HUD overlap)
      const gameCanvas = document.querySelector('canvas');
      if (gameCanvas) {
        const rect = gameCanvas.getBoundingClientRect();
        if (rect.top < HUD_H) {
          gameCanvas.style.marginTop = (HUD_H - rect.top + 2) + 'px';
        }
      }
    }, 150);

    return host;
  }

  window.ArcadeProfile = {
    getToken, getUsername, getAvatar, isLoggedIn,
    setSession, clearSession,
    register, login, logout, updateAvatar,
    submitScore, getLeaderboard, getProfile, getCumulative,
    renderHUD,
  };
})();
