/* ═══════════════════════════════════════════════════════════════════════════════
   Senior Labelers Tracker — script.js
   Frontend Logic: Auth, Data Fetch, Rendering, Filtering, Sorting
   Version: 1.0.0
   ═══════════════════════════════════════════════════════════════════════════════ */

'use strict';

// ── CONFIGURATION ─────────────────────────────────────────────────────────────
const CONFIG = {
  SCRIPT_URL:    'https://script.google.com/macros/s/AKfycbwsrhMUOM3gV5QxuEtjWvDPV-EsAOXazI0DxTTBwYY3Q-Q44_bdLtPAxixGQq35rVo2qg/exec',
  APP_NAME:      'Senior Labelers Tracker',
  VERSION:       '1.0.0',
  CACHE_TTL:     60 * 1000,          // 1 minute client-side cache
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_SECONDS:    30,
  TABLE_VIRTUAL_THRESHOLD: 200,      // Virtualize if rows > this
  DEBOUNCE_MS:   300,
};


// ═══════════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════════

const state = {
  fullName:         null,   // stored full name: "Mostafa Fayez (M)"
  displayName:      null,   // stripped: "Mostafa Fayez"
  currentDate:      null,
  allTasks:         [],     // combined support + own tasks (flat)
  filteredTasks:    [],
  sortColumn:       'timestamp',
  sortAsc:          false,
  filterModality:   '',
  filterPass:       '',
  filterMode:       '',
  loginAttempts:    0,
  lockoutUntil:     null,
  fetchCache:       {},     // key: "name|date" → {data, ts}
};


// ═══════════════════════════════════════════════════════════════════════════════
// DOM REFS
// ═══════════════════════════════════════════════════════════════════════════════

const DOM = {
  loginScreen:      () => document.getElementById('login-screen'),
  dashboardScreen:  () => document.getElementById('dashboard-screen'),
  loadingOverlay:   () => document.getElementById('loading-overlay'),
  loadingMessage:   () => document.getElementById('loading-message'),
  toastContainer:   () => document.getElementById('toast-container'),

  // Login
  inputName:        () => document.getElementById('input-name'),
  inputPass:        () => document.getElementById('input-pass'),
  btnLogin:         () => document.getElementById('btn-login'),
  loginError:       () => document.getElementById('login-error'),
  loginLockout:     () => document.getElementById('login-lockout'),

  // Dashboard
  btnLogout:        () => document.getElementById('btn-logout'),
  userAvatar:       () => document.getElementById('user-avatar'),
  userNameNav:      () => document.getElementById('user-name-nav'),
  dashboardGreeting:() => document.getElementById('dashboard-greeting'),
  dashboardSubtitle:() => document.getElementById('dashboard-subtitle'),
  dateSelect:       () => document.getElementById('date-select'),
  syncBadge:        () => document.getElementById('sync-badge'),
  lastSyncText:     () => document.getElementById('last-sync-text'),

  // Summary cards
  cardTotal:        () => document.getElementById('card-total'),
  cardSupport:      () => document.getElementById('card-support'),
  cardOwn:          () => document.getElementById('card-own'),
  cardObjects:      () => document.getElementById('card-objects'),

  // Panels
  supportPanelBody: () => document.getElementById('support-panel-body'),
  ownPanelBody:     () => document.getElementById('own-panel-body'),
  supportCountBadge:() => document.getElementById('support-count-badge'),
  ownCountBadge:    () => document.getElementById('own-count-badge'),

  // Table
  taskTableBody:    () => document.getElementById('task-table-body'),
  filterModality:   () => document.getElementById('filter-modality'),
  filterPass:       () => document.getElementById('filter-pass'),
  filterMode:       () => document.getElementById('filter-mode'),
  rowCountInfo:     () => document.getElementById('row-count-info'),
};


// ═══════════════════════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Strip suffix like "(M)" from a name.
 */
function stripSuffix(name) {
  if (!name) return '';
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

/**
 * Format timestamp to "HH:MM AM/PM" for display.
 */
function formatTime(ts) {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  } catch {
    return String(ts);
  }
}

/**
 * Format a number with count-up animation.
 */
function animateCountUp(el, targetVal, duration = 800) {
  if (!el) return;
  const start = 0;
  const startTime = performance.now();
  const endVal = Number(targetVal) || 0;

  function update(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const current = Math.round(start + (endVal - start) * eased);
    el.textContent = current.toLocaleString();
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

/**
 * Today's date as YYYY-MM-DD.
 */
function todayKey() {
  const d = new Date();
  const year  = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day   = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Greet based on time of day.
 */
function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * Debounce a function.
 */
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Escape HTML entities.
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Show or hide loading overlay.
 */
function setLoading(show, message = 'Loading data…') {
  const overlay = DOM.loadingOverlay();
  const msg     = DOM.loadingMessage();
  if (show) {
    overlay.classList.add('active');
    if (msg) msg.textContent = message;
  } else {
    overlay.classList.remove('active');
  }
}

/**
 * Show toast notification.
 */
function showToast(message, type = 'success', duration = 3000) {
  const container = DOM.toastContainer();
  if (!container) return;

  const icons = { success: '✅', error: '❌', warning: '⚠️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || ''}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideOutRight 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}


// ═══════════════════════════════════════════════════════════════════════════════
// API LAYER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build query string URL for Apps Script.
 */
function buildUrl(params) {
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${CONFIG.SCRIPT_URL}?${qs}`;
}

/**
 * Generic API call with error handling.
 */
async function apiCall(params) {
  const url = buildUrl(params);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error);
  return data;
}

/**
 * Authenticate user.
 */
async function apiAuth(name, pass) {
  return apiCall({ action: 'auth', name, pass });
}

/**
 * Fetch user's tasks for a date.
 */
async function apiUserData(name, date) {
  // Check cache
  const cacheKey = `${name}|${date}`;
  const cached   = state.fetchCache[cacheKey];
  if (cached && (Date.now() - cached.ts) < CONFIG.CACHE_TTL) {
    return cached.data;
  }

  const data = await apiCall({ action: 'userData', name, date });

  // Store in cache
  state.fetchCache[cacheKey] = { data, ts: Date.now() };
  return data;
}

/**
 * Fetch available dates for a user.
 */
async function apiAvailableDates(name) {
  return apiCall({ action: 'availableDates', name });
}


// ═══════════════════════════════════════════════════════════════════════════════
// AUTH MODULE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Show login error message.
 */
function showLoginError(msg) {
  const el = DOM.loginError();
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
}

function hideLoginError() {
  const el = DOM.loginError();
  if (el) el.classList.remove('show');
}

/**
 * Handle login submit.
 */
async function handleLogin() {
  // Check lockout
  if (state.lockoutUntil && Date.now() < state.lockoutUntil) {
    const remaining = Math.ceil((state.lockoutUntil - Date.now()) / 1000);
    showLockout(remaining);
    return;
  }
  state.lockoutUntil = null;
  DOM.loginLockout().classList.remove('show');

  const name = DOM.inputName().value.trim();
  const pass = DOM.inputPass().value.trim();

  hideLoginError();

  if (!name || !pass) {
    showLoginError('Please enter your name and password.');
    return;
  }

  // Set loading state on button
  const btn = DOM.btnLogin();
  btn.disabled = true;
  btn.classList.add('loading');

  try {
    const result = await apiAuth(name, pass);

    if (result.success) {
      state.loginAttempts = 0;
      state.fullName    = result.fullName;
      state.displayName = stripSuffix(result.fullName);

      // Store in session
      sessionStorage.setItem('slt_fullName',    state.fullName);
      sessionStorage.setItem('slt_displayName', state.displayName);

      showDashboard();
    } else {
      state.loginAttempts++;

      if (state.loginAttempts >= CONFIG.MAX_LOGIN_ATTEMPTS) {
        state.lockoutUntil = Date.now() + (CONFIG.LOCKOUT_SECONDS * 1000);
        showLockout(CONFIG.LOCKOUT_SECONDS);
        startLockoutCountdown();
      } else {
        const remaining = CONFIG.MAX_LOGIN_ATTEMPTS - state.loginAttempts;
        showLoginError(`Invalid name or password. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`);
      }
    }
  } catch (err) {
    showLoginError('Connection error. Please try again. ' + (err.message || ''));
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

function showLockout(seconds) {
  const el = DOM.loginLockout();
  el.textContent = `Too many attempts. Please wait ${seconds} second${seconds !== 1 ? 's' : ''}.`;
  el.classList.add('show');

  const btn = DOM.btnLogin();
  btn.disabled = true;
}

function startLockoutCountdown() {
  const interval = setInterval(() => {
    const remaining = Math.ceil((state.lockoutUntil - Date.now()) / 1000);
    if (remaining <= 0) {
      clearInterval(interval);
      state.lockoutUntil  = null;
      state.loginAttempts = 0;
      DOM.loginLockout().classList.remove('show');
      DOM.btnLogin().disabled = false;
    } else {
      showLockout(remaining);
    }
  }, 1000);
}


// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD INIT
// ═══════════════════════════════════════════════════════════════════════════════

async function showDashboard() {
  // Switch screens
  DOM.loginScreen().style.display = 'none';
  const dash = DOM.dashboardScreen();
  dash.classList.add('active');

  // Set user info in nav
  const initials = state.displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  DOM.userAvatar().textContent   = initials;
  DOM.userNameNav().textContent  = state.displayName;
  DOM.dashboardGreeting().textContent = `${getGreeting()}, ${state.displayName}!`;

  // Load available dates
  setLoading(true, 'Loading your dates…');
  try {
    const result = await apiAvailableDates(state.displayName);
    const dates  = result.dates || [];
    populateDateSelect(dates);

    // Default to today or first available
    const today = todayKey();
    const selectedDate = dates.includes(today) ? today : (dates[0] || today);
    state.currentDate = selectedDate;
    DOM.dateSelect().value = selectedDate;

    await loadDashboardData(selectedDate);
  } catch (err) {
    showToast('Failed to load dates: ' + err.message, 'error');
    // Fallback: load today anyway
    state.currentDate = todayKey();
    await loadDashboardData(state.currentDate);
  } finally {
    setLoading(false);
  }
}

/**
 * Populate date select dropdown.
 */
function populateDateSelect(dates) {
  const sel = DOM.dateSelect();
  sel.innerHTML = '';

  if (dates.length === 0) {
    const opt = document.createElement('option');
    opt.value = todayKey();
    opt.textContent = todayKey() + ' (today)';
    sel.appendChild(opt);
    return;
  }

  dates.forEach((date, i) => {
    const opt = document.createElement('option');
    opt.value = date;
    opt.textContent = date + (i === 0 ? ' (latest)' : '');
    sel.appendChild(opt);
  });
}

/**
 * Load and render dashboard data for a given date.
 */
async function loadDashboardData(date) {
  setLoading(true, 'Fetching tasks…');
  DOM.dashboardSubtitle().textContent = `Loading tasks for ${date}…`;

  try {
    const result = await apiUserData(state.displayName, date);

    const supportTasks = result.supportTasks || [];
    const ownTasks     = result.ownTasks     || [];

    // Tag each task with mode
    supportTasks.forEach(t => { t._mode = 'SUPPORT'; });
    ownTasks.forEach(t => { t._mode = 'OWN'; });

    state.allTasks = [...supportTasks, ...ownTasks];

    // Update last sync
    if (result.lastSync) {
      const syncTime = new Date(result.lastSync);
      DOM.lastSyncText().textContent = 'Synced ' + syncTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }

    // Render everything
    renderSummaryCards(supportTasks, ownTasks);
    renderSupportPanel(supportTasks);
    renderOwnPanel(ownTasks);

    applyFiltersAndRender();

    DOM.dashboardSubtitle().textContent =
      `${state.allTasks.length} task${state.allTasks.length !== 1 ? 's' : ''} on ${date}`;

  } catch (err) {
    showToast('Failed to load data: ' + err.message, 'error');
    DOM.dashboardSubtitle().textContent = 'Failed to load tasks.';
    renderEmptyState();
  } finally {
    setLoading(false);
  }
}

function renderEmptyState() {
  animateCountUp(DOM.cardTotal(),   0, 400);
  animateCountUp(DOM.cardSupport(), 0, 400);
  animateCountUp(DOM.cardOwn(),     0, 400);
  animateCountUp(DOM.cardObjects(), 0, 400);

  DOM.supportPanelBody().innerHTML = '<div class="empty-state"><div class="empty-icon">🤝</div><p>No support tasks for this date</p></div>';
  DOM.ownPanelBody().innerHTML     = '<div class="empty-state"><div class="empty-icon">📋</div><p>No tasks submitted today</p></div>';
  DOM.taskTableBody().innerHTML    = '<tr><td colspan="8" class="table-empty">No tasks to display</td></tr>';
  DOM.rowCountInfo().textContent   = 'Showing 0 tasks';
  DOM.supportCountBadge().textContent = '0 teams';
  DOM.ownCountBadge().textContent     = '0 tasks';
}


// ═══════════════════════════════════════════════════════════════════════════════
// RENDER: SUMMARY CARDS
// ═══════════════════════════════════════════════════════════════════════════════

function renderSummaryCards(supportTasks, ownTasks) {
  const totalTasks   = supportTasks.length + ownTasks.length;
  const totalObjects = [...supportTasks, ...ownTasks].reduce((sum, t) => sum + (Number(t.objectCount) || 0), 0);

  animateCountUp(DOM.cardTotal(),   totalTasks,   800);
  animateCountUp(DOM.cardSupport(), supportTasks.length, 800);
  animateCountUp(DOM.cardOwn(),     ownTasks.length,     800);
  animateCountUp(DOM.cardObjects(), totalObjects, 900);
}


// ═══════════════════════════════════════════════════════════════════════════════
// RENDER: SUPPORT PANEL
// ═══════════════════════════════════════════════════════════════════════════════

function renderSupportPanel(supportTasks) {
  const container = DOM.supportPanelBody();

  if (!supportTasks || supportTasks.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🤝</div><p>No support tasks for this date</p></div>';
    DOM.supportCountBadge().textContent = '0 teams';
    return;
  }

  // Group by team (by teamInfo.teamCode or by teamInfo.teamLead)
  const teamGroups = {};
  supportTasks.forEach(task => {
    const info = task.teamInfo;
    const key  = info ? (info.teamCode || info.teamLead || task.yubikeyEmail) : (task.yubikeyEmail || 'Unknown');

    if (!teamGroups[key]) {
      teamGroups[key] = {
        info: info,
        email: task.yubikeyEmail,
        tasks: []
      };
    }
    teamGroups[key].tasks.push(task);
  });

  const teamCount = Object.keys(teamGroups).length;
  DOM.supportCountBadge().textContent = `${teamCount} team${teamCount !== 1 ? 's' : ''}`;

  const html = Object.entries(teamGroups).map(([key, group], idx) => {
    return buildTeamBlock(group, idx);
  }).join('');

  container.innerHTML = html;

  // Attach queue toggles
  container.querySelectorAll('.queues-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const list = btn.nextElementSibling;
      if (!list) return;
      const isExpanded = list.classList.toggle('expanded');
      btn.textContent  = isExpanded ? '▲ Hide Queues' : '▼ Show Queues';
    });
  });
}

function buildTeamBlock(group, idx) {
  const info  = group.info;
  const tasks = group.tasks;

  // Breakdown
  const breakdown = { 'Lane Line': { FP: 0, QA: 0 }, 'LIDAR': { FP: 0, QA: 0 } };
  tasks.forEach(t => {
    const mod  = t.modality  || 'Lane Line';
    const pass = t.pass      || 'FP';
    if (!breakdown[mod]) breakdown[mod] = { FP: 0, QA: 0 };
    if (pass === 'QA') breakdown[mod].QA++;
    else                breakdown[mod].FP++;
  });

  const maxCount = Math.max(
    breakdown['Lane Line'].FP, breakdown['Lane Line'].QA,
    breakdown['LIDAR'].FP,     breakdown['LIDAR'].QA, 1
  );

  const teamLeadName = info ? (info.teamLead || 'Unknown Team') : (group.email || 'Unknown Team');
  const teamCode     = info ? (info.teamCode || '—') : '—';
  const unit         = info ? (info.unit     || '—') : '—';
  const shiftType    = info ? (info.shift    || '—') : '—';

  // Unique queues
  const queues = [...new Set(tasks.map(t => t.queueName).filter(Boolean))];

  const queueItems = queues.map(q =>
    `<div class="queue-item" title="${escapeHtml(q)}">• ${escapeHtml(q)}</div>`
  ).join('');

  const showQueuesToggle = queues.length > 0 ?
    `<div class="queues-section">
      <button class="queues-toggle" type="button">▼ Show Queues (${queues.length})</button>
      <div class="queues-list">${queueItems}</div>
    </div>` : '';

  const barRow = (label, fpVal, qaVal) => {
    const fpPct = Math.round((fpVal / maxCount) * 100);
    const qaPct = Math.round((qaVal / maxCount) * 100);
    return `<div class="breakdown-row">
      <div class="breakdown-label">${escapeHtml(label)}</div>
      <div class="breakdown-cell">
        <div class="breakdown-bar"><div class="breakdown-bar-fill bar-fp" style="width:${fpPct}%"></div></div>
        <span class="breakdown-num" style="color:var(--color-fp)">${fpVal}</span>
      </div>
      <div class="breakdown-cell">
        <div class="breakdown-bar"><div class="breakdown-bar-fill bar-qa" style="width:${qaPct}%"></div></div>
        <span class="breakdown-num" style="color:var(--color-qa)">${qaVal}</span>
      </div>
    </div>`;
  };

  return `
    <div class="team-block" style="animation-delay:${idx * 60}ms">
      <div class="team-block-header">
        <div>
          <div class="team-lead-name">🤝 ${escapeHtml(teamLeadName)}</div>
          <div class="team-meta">
            <span class="meta-chip">${escapeHtml(unit)}</span>
            <span class="meta-chip">Code: ${escapeHtml(teamCode)}</span>
            <span class="meta-chip">Shift: ${escapeHtml(shiftType)}</span>
          </div>
        </div>
        <div class="team-total-badge">${tasks.length} tasks</div>
      </div>

      <div class="mini-breakdown">
        <div class="breakdown-row" style="font-size:10px;color:var(--md-sys-color-on-surface-dim);margin-bottom:4px">
          <div></div>
          <div style="text-align:center;letter-spacing:0.5px">FP</div>
          <div style="text-align:center;letter-spacing:0.5px">QA</div>
        </div>
        ${barRow('Lane Line', breakdown['Lane Line'].FP, breakdown['Lane Line'].QA)}
        ${barRow('LIDAR',     breakdown['LIDAR'].FP,     breakdown['LIDAR'].QA)}
      </div>

      ${showQueuesToggle}
    </div>
  `;
}


// ═══════════════════════════════════════════════════════════════════════════════
// RENDER: OWN TASKS PANEL
// ═══════════════════════════════════════════════════════════════════════════════

function renderOwnPanel(ownTasks) {
  const container = DOM.ownPanelBody();
  DOM.ownCountBadge().textContent = `${ownTasks.length} task${ownTasks.length !== 1 ? 's' : ''}`;

  if (!ownTasks || ownTasks.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>No tasks submitted today</p></div>';
    return;
  }

  // Breakdown by modality + pass
  const breakdown = { 'Lane Line': { FP: 0, QA: 0 }, 'LIDAR': { FP: 0, QA: 0 } };
  let totalObjects = 0;

  ownTasks.forEach(t => {
    const mod  = t.modality || 'Lane Line';
    const pass = t.pass     || 'FP';
    if (!breakdown[mod]) breakdown[mod] = { FP: 0, QA: 0 };
    if (pass === 'QA') breakdown[mod].QA++;
    else                breakdown[mod].FP++;
    totalObjects += Number(t.objectCount) || 0;
  });

  const maxCount = Math.max(
    breakdown['Lane Line'].FP, breakdown['Lane Line'].QA,
    breakdown['LIDAR'].FP,     breakdown['LIDAR'].QA, 1
  );

  // Top queues
  const queueCounts = {};
  ownTasks.forEach(t => {
    const q = t.queueName;
    if (q) queueCounts[q] = (queueCounts[q] || 0) + 1;
  });
  const topQueues = Object.entries(queueCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const maxQueueCount = topQueues.length > 0 ? topQueues[0][1] : 1;

  const barRow = (label, fpVal, qaVal) => {
    const fpPct = Math.round((fpVal / maxCount) * 100);
    const qaPct = Math.round((qaVal / maxCount) * 100);
    return `<div class="breakdown-row">
      <div class="breakdown-label">${escapeHtml(label)}</div>
      <div class="breakdown-cell">
        <div class="breakdown-bar"><div class="breakdown-bar-fill bar-fp" style="width:${fpPct}%"></div></div>
        <span class="breakdown-num" style="color:var(--color-fp)">${fpVal}</span>
      </div>
      <div class="breakdown-cell">
        <div class="breakdown-bar"><div class="breakdown-bar-fill bar-qa" style="width:${qaPct}%"></div></div>
        <span class="breakdown-num" style="color:var(--color-qa)">${qaVal}</span>
      </div>
    </div>`;
  };

  const queueBars = topQueues.map(([name, count]) => {
    const pct = Math.round((count / maxQueueCount) * 100);
    return `<div class="queue-bar-row">
      <div class="queue-bar-label">
        <span class="queue-name-text" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
        <span class="queue-count">${count}</span>
      </div>
      <div class="queue-bar-track">
        <div class="queue-bar-fill" style="width:${pct}%"></div>
      </div>
    </div>`;
  }).join('');

  container.innerHTML = `
    <div class="own-stat-totals">
      <div class="own-stat">
        <div class="stat-val">${ownTasks.length}</div>
        <div class="stat-lbl">Total Tasks</div>
      </div>
      <div class="own-stat">
        <div class="stat-val">${totalObjects.toLocaleString()}</div>
        <div class="stat-lbl">Objects</div>
      </div>
      <div class="own-stat">
        <div class="stat-val">${(breakdown['Lane Line'].FP + breakdown['Lane Line'].QA + breakdown['LIDAR'].FP + breakdown['LIDAR'].QA > 0 ? Math.round((breakdown['Lane Line'].FP + breakdown['LIDAR'].FP) / ownTasks.length * 100) : 0)}%</div>
        <div class="stat-lbl">FP Rate</div>
      </div>
    </div>

    <div class="own-tasks-breakdown">
      <div class="breakdown-row" style="font-size:10px;color:var(--md-sys-color-on-surface-dim);margin-bottom:4px">
        <div></div>
        <div style="text-align:center;letter-spacing:0.5px">FP</div>
        <div style="text-align:center;letter-spacing:0.5px">QA</div>
      </div>
      ${barRow('Lane Line', breakdown['Lane Line'].FP, breakdown['Lane Line'].QA)}
      ${barRow('LIDAR',     breakdown['LIDAR'].FP,     breakdown['LIDAR'].QA)}
    </div>

    ${topQueues.length > 0 ? `
    <div class="top-queues-section">
      <h4>Top Queues</h4>
      ${queueBars}
    </div>` : ''}
  `;
}


// ═══════════════════════════════════════════════════════════════════════════════
// RENDER: TASK TABLE
// ═══════════════════════════════════════════════════════════════════════════════

function applyFiltersAndRender() {
  let tasks = [...state.allTasks];

  // Apply filters
  if (state.filterModality) tasks = tasks.filter(t => t.modality === state.filterModality);
  if (state.filterPass)     tasks = tasks.filter(t => t.pass     === state.filterPass);
  if (state.filterMode)     tasks = tasks.filter(t => t._mode    === state.filterMode);

  // Sort
  tasks.sort((a, b) => {
    let valA = a[state.sortColumn];
    let valB = b[state.sortColumn];

    if (state.sortColumn === 'timestamp') {
      valA = new Date(valA).getTime() || 0;
      valB = new Date(valB).getTime() || 0;
    } else if (state.sortColumn === 'objectCount') {
      valA = Number(valA) || 0;
      valB = Number(valB) || 0;
    } else if (state.sortColumn === 'idx') {
      // Keep original order
      valA = state.allTasks.indexOf(a);
      valB = state.allTasks.indexOf(b);
    } else {
      valA = String(valA || '').toLowerCase();
      valB = String(valB || '').toLowerCase();
    }

    if (valA < valB) return state.sortAsc ? -1 : 1;
    if (valA > valB) return state.sortAsc ?  1 : -1;
    return 0;
  });

  state.filteredTasks = tasks;
  renderTable(tasks);
}

function renderTable(tasks) {
  const tbody = DOM.taskTableBody();

  if (!tasks || tasks.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="table-empty">No tasks match the selected filters</td></tr>';
    DOM.rowCountInfo().textContent = 'Showing 0 tasks';
    return;
  }

  // Use requestAnimationFrame for smooth rendering
  requestAnimationFrame(() => {
    // For large datasets, chunk rendering
    const html = tasks.map((task, i) => buildTableRow(task, i)).join('');
    tbody.innerHTML = html;
    DOM.rowCountInfo().textContent = `Showing ${tasks.length.toLocaleString()} task${tasks.length !== 1 ? 's' : ''}`;

    // Update sort icons
    document.querySelectorAll('thead th[data-sort]').forEach(th => {
      th.classList.remove('sorted');
      const icon = th.querySelector('.sort-icon');
      if (icon) icon.textContent = '↕';
    });
    const activeTh = document.querySelector(`thead th[data-sort="${state.sortColumn}"]`);
    if (activeTh) {
      activeTh.classList.add('sorted');
      const icon = activeTh.querySelector('.sort-icon');
      if (icon) icon.textContent = state.sortAsc ? '↑' : '↓';
    }
  });
}

function buildTableRow(task, idx) {
  const time       = formatTime(task.timestamp);
  const modality   = task.modality  || '—';
  const pass       = task.pass      || '—';
  const queueName  = task.queueName || '—';
  const objects    = Number(task.objectCount) || 0;
  const taskLink   = task.taskLink  || '';
  const mode       = task._mode     || 'OWN';

  const modeChip = mode === 'SUPPORT'
    ? `<span class="chip chip-qa">Support</span>`
    : `<span class="chip chip-fp">Own</span>`;

  const modalityChip = modality === 'LIDAR'
    ? `<span class="chip chip-lidar">LIDAR</span>`
    : `<span class="chip chip-lane">Lane Line</span>`;

  const passChip = pass === 'QA'
    ? `<span class="chip chip-qa">QA</span>`
    : `<span class="chip chip-fp">FP</span>`;

  const linkCell = taskLink
    ? `<a class="task-link-btn" href="${escapeHtml(taskLink)}" target="_blank" rel="noopener noreferrer">🔗 Open</a>`
    : '—';

  const shortQueue = queueName.length > 35 ? queueName.slice(0, 32) + '…' : queueName;

  return `<tr>
    <td class="mono">${idx + 1}</td>
    <td class="mono">${escapeHtml(time)}</td>
    <td>${modeChip}</td>
    <td>${modalityChip}</td>
    <td>${passChip}</td>
    <td title="${escapeHtml(queueName)}" class="mono">${escapeHtml(shortQueue)}</td>
    <td class="mono">${objects.toLocaleString()}</td>
    <td>${linkCell}</td>
  </tr>`;
}


// ═══════════════════════════════════════════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════════════════════════════════════════

function initEventListeners() {
  // Login
  DOM.btnLogin().addEventListener('click', handleLogin);

  DOM.inputName().addEventListener('keydown', e => {
    if (e.key === 'Enter') DOM.inputPass().focus();
  });

  DOM.inputPass().addEventListener('keydown', e => {
    if (e.key === 'Enter') handleLogin();
  });

  // Clear error on input
  [DOM.inputName(), DOM.inputPass()].forEach(el => {
    el.addEventListener('input', hideLoginError);
  });

  // Logout
  DOM.btnLogout().addEventListener('click', handleLogout);

  // Date select
  DOM.dateSelect().addEventListener('change', e => {
    const newDate = e.target.value;
    if (newDate && newDate !== state.currentDate) {
      state.currentDate = newDate;
      loadDashboardData(newDate);
    }
  });

  // Filters
  DOM.filterModality().addEventListener('change', e => {
    state.filterModality = e.target.value;
    applyFiltersAndRender();
  });

  DOM.filterPass().addEventListener('change', e => {
    state.filterPass = e.target.value;
    applyFiltersAndRender();
  });

  DOM.filterMode().addEventListener('change', e => {
    state.filterMode = e.target.value;
    applyFiltersAndRender();
  });

  // Table sort (header clicks)
  document.querySelectorAll('thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (state.sortColumn === col) {
        state.sortAsc = !state.sortAsc;
      } else {
        state.sortColumn = col;
        state.sortAsc    = col === 'timestamp' ? false : true;
      }
      applyFiltersAndRender();
    });
  });
}

function handleLogout() {
  // Clear session
  sessionStorage.removeItem('slt_fullName');
  sessionStorage.removeItem('slt_displayName');

  // Reset state
  state.fullName      = null;
  state.displayName   = null;
  state.currentDate   = null;
  state.allTasks      = [];
  state.filteredTasks = [];
  state.fetchCache    = {};

  // Clear inputs
  DOM.inputName().value = '';
  DOM.inputPass().value = '';
  hideLoginError();

  // Switch screens
  DOM.dashboardScreen().classList.remove('active');
  DOM.loginScreen().style.display = '';

  showToast('Logged out successfully', 'success', 2000);
}


// ═══════════════════════════════════════════════════════════════════════════════
// SESSION RESTORE
// ═══════════════════════════════════════════════════════════════════════════════

function restoreSession() {
  const storedFull    = sessionStorage.getItem('slt_fullName');
  const storedDisplay = sessionStorage.getItem('slt_displayName');

  if (storedFull && storedDisplay) {
    state.fullName    = storedFull;
    state.displayName = storedDisplay;
    showDashboard();
    return true;
  }
  return false;
}


// ═══════════════════════════════════════════════════════════════════════════════
// APP INIT
// ═══════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();

  // Try to restore session; otherwise show login
  if (!restoreSession()) {
    DOM.loginScreen().style.display = '';
    DOM.dashboardScreen().classList.remove('active');
    // Focus first input
    setTimeout(() => DOM.inputName().focus(), 100);
  }
});
