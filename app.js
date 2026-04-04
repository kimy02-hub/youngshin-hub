/* ═══════════════════════════════════════════════════════════
   DMS Mailbox Dashboard · app.js
   ═══════════════════════════════════════════════════════════ */

// ─── State ───────────────────────────────────────────────────
let allEmails   = [];
let tasks       = [];
let currentTab  = 'all';
let completedOpen = false;

const TASKS_KEY  = 'dms_tasks_v2';
const EMAILS_URL = 'emails.json';

// ─── INIT ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadTasks();
  loadEmails();
  setTodayDefault();
});

function setTodayDefault() {
  const today = new Date().toISOString().split('T')[0];
  const el = document.getElementById('newTaskDue');
  if (el) el.setAttribute('min', today);
}

// ─── EMAIL LOADING ───────────────────────────────────────────
async function loadEmails() {
  try {
    const res = await fetch(EMAILS_URL + '?_=' + Date.now());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    allEmails = data.emails || [];
    updateLastUpdated(data.fetched_at);
    renderEmails();
  } catch (e) {
    document.getElementById('emailList').innerHTML =
      `<div class="loading-state"><p style="color:var(--grey-300)">Could not load emails.<br><small>${e.message}</small></p></div>`;
  }
}

function updateLastUpdated(isoStr) {
  if (!isoStr) return;
  try {
    const d = new Date(isoStr);
    const now = new Date();
    const diffMin = Math.round((now - d) / 60000);
    let label;
    if (diffMin < 2)        label = 'just now';
    else if (diffMin < 60)  label = `${diffMin}m ago`;
    else if (diffMin < 1440) label = `${Math.round(diffMin/60)}h ago`;
    else                     label = d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
    document.getElementById('lastUpdated').textContent = 'Updated ' + label;
  } catch(_) {}
}

async function refreshData() {
  const btn = document.querySelector('.refresh-btn');
  btn.classList.add('spinning');
  btn.disabled = true;
  try {
    await loadEmails();
    showToast('✦ Inbox refreshed!');
  } finally {
    setTimeout(() => { btn.classList.remove('spinning'); btn.disabled = false; }, 600);
  }
}

// ─── TAB SWITCHING ───────────────────────────────────────────
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  renderEmails();
}

function getFilteredEmails() {
  let list = allEmails;
  if (currentTab === 'unread')  list = list.filter(e => !e.read);
  if (currentTab === 'flagged') list = list.filter(e => e.flagged);
  return list;
}

// ─── EMAIL RENDERING ─────────────────────────────────────────
function renderEmails() {
  const list = getFilteredEmails();
  const container = document.getElementById('emailList');
  document.getElementById('emailCount').textContent = list.length;

  if (!list.length) {
    container.innerHTML = `<div class="loading-state"><p style="color:var(--grey-300);font-style:italic;">No emails here 🌸</p></div>`;
    return;
  }

  container.innerHTML = '';
  list.forEach((email, idx) => {
    container.appendChild(buildEmailCard(email, idx));
  });
}

function buildEmailCard(email, idx) {
  const card = document.createElement('div');
  card.className = 'email-card' + (!email.read ? ' unread' : '') + (email.flagged ? ' flagged-card' : '');
  card.style.animationDelay = (idx * 0.03) + 's';

  const senderName = parseName(email.sender);
  const timeStr    = formatTime(email.date);
  const mailUrl    = buildMailUrl(email);

  card.innerHTML = `
    <div class="email-top">
      <div class="email-sender-row">
        ${!email.read ? '<div class="unread-dot"></div>' : ''}
        ${email.flagged ? '<span class="flagged-star">⚑</span>' : ''}
        <span class="email-sender">${esc(senderName)}</span>
      </div>
      <span class="email-time">${esc(timeStr)}</span>
    </div>
    <div class="email-subject">${esc(email.subject)}</div>
    ${email.cc ? `<div class="email-cc">cc: ${esc(formatCC(email.cc))}</div>` : ''}
    <div class="email-actions">
      <button class="to-task-btn" onclick="emailToTask('${escId(email.id)}')">＋ Task</button>
      <a class="open-mail-btn" href="${mailUrl}" target="_blank">✉ Open</a>
    </div>
  `;
  return card;
}

// ─── TASK PERSISTENCE ────────────────────────────────────────
function loadTasks() {
  try {
    const raw = localStorage.getItem(TASKS_KEY);
    tasks = raw ? JSON.parse(raw) : [];
  } catch(_) { tasks = []; }
  renderTasks();
}

function saveTasks() {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
}

// ─── EMAIL → TASK ────────────────────────────────────────────
function emailToTask(emailId) {
  const email = allEmails.find(e => e.id === emailId);
  if (!email) return;

  // Check duplicate
  if (tasks.some(t => t.emailId === emailId)) {
    showToast('Already added as a task!');
    return;
  }

  const task = {
    id:         'task_' + Date.now(),
    title:      email.subject,
    done:       false,
    flagged:    email.flagged || false,
    emailId:    emailId,
    emailSender: email.sender,
    cc:         email.cc || '',
    due:        null,
    createdAt:  new Date().toISOString(),
    type:       'email'
  };

  // Auto-flag if email was flagged
  tasks.unshift(task);
  saveTasks();
  renderTasks();
  showToast('✦ Task added!');
}

// ─── MANUAL TASK ─────────────────────────────────────────────
function addManualTask() {
  const title = document.getElementById('newTaskTitle').value.trim();
  if (!title) { document.getElementById('newTaskTitle').focus(); return; }

  const due = document.getElementById('newTaskDue').value || null;
  const cc  = document.getElementById('newTaskCC').value.trim();

  const isToday = due && due === new Date().toISOString().split('T')[0];

  const task = {
    id:        'task_' + Date.now(),
    title,
    done:      false,
    flagged:   isToday, // auto-flag if due today
    emailId:   null,
    cc,
    due,
    createdAt: new Date().toISOString(),
    type:      'manual'
  };

  tasks.unshift(task);
  saveTasks();
  renderTasks();
  closeAddTask();
  showToast(isToday ? '⚑ Auto-flagged — due today!' : '✦ Task added!');
}

// ─── TASK ACTIONS ────────────────────────────────────────────
function toggleTaskDone(taskId) {
  const t = tasks.find(t => t.id === taskId);
  if (!t) return;
  t.done = !t.done;
  t.doneAt = t.done ? new Date().toISOString() : null;
  saveTasks();
  renderTasks();
}

function toggleTaskFlag(taskId) {
  const t = tasks.find(t => t.id === taskId);
  if (!t) return;
  t.flagged = !t.flagged;
  saveTasks();
  renderTasks();
  showToast(t.flagged ? '⚑ Flagged!' : 'Flag removed');
}

// ─── TASK RENDERING ──────────────────────────────────────────
function renderTasks() {
  const active    = tasks.filter(t => !t.done && !t.flagged);
  const flaggedT  = tasks.filter(t => !t.done && t.flagged);
  const completed = tasks.filter(t => t.done).sort((a,b) => new Date(b.doneAt||0) - new Date(a.doneAt||0));

  // Flagged section
  const flaggedSection = document.getElementById('flaggedSection');
  const flaggedList    = document.getElementById('flaggedTasksList');
  if (flaggedT.length) {
    flaggedSection.style.display = '';
    flaggedList.innerHTML = '';
    flaggedT.forEach((t,i) => flaggedList.appendChild(buildTaskCard(t, i)));
  } else {
    flaggedSection.style.display = 'none';
    flaggedList.innerHTML = '';
  }

  // Active tasks
  const activeList = document.getElementById('activeTasksList');
  activeList.innerHTML = '';
  if (active.length) {
    active.forEach((t,i) => activeList.appendChild(buildTaskCard(t, i)));
  }

  // Completed
  const completedSection = document.getElementById('completedSection');
  const completedList    = document.getElementById('completedTasksList');
  const completedCountEl = document.getElementById('completedCount');
  if (completed.length) {
    completedSection.style.display = '';
    completedCountEl.textContent = completed.length;
    completedList.innerHTML = '';
    completed.forEach((t,i) => completedList.appendChild(buildTaskCard(t, i)));
    completedList.className = 'completed-list' + (completedOpen ? ' open' : '');
  } else {
    completedSection.style.display = 'none';
  }

  // Empty state
  const isEmpty = !tasks.length;
  document.getElementById('tasksEmpty').style.display = isEmpty ? '' : 'none';
}

function buildTaskCard(task, idx) {
  const card = document.createElement('div');
  const classes = ['task-card'];
  if (task.flagged && !task.done) classes.push('task-flagged');
  if (task.done) classes.push('task-done');
  card.className = classes.join(' ');
  card.style.animationDelay = (idx * 0.03) + 's';

  const dueLabel  = task.due ? buildDueLabel(task.due) : '';
  const ccLabel   = task.cc ? `<span class="task-cc" title="${esc(task.cc)}">👤 ${esc(formatCC(task.cc))}</span>` : '';
  const dateInfo  = task.type === 'email'
    ? `<span class="task-created">${formatTime(task.createdAt)}</span>`
    : task.createdAt
      ? `<span class="task-created">Created ${formatDateShort(task.createdAt)}</span>`
      : '';

  const mailLink = task.emailId
    ? `<a class="open-task-mail-btn" href="${buildMailUrlById(task.emailId)}" target="_blank">✉ Mail</a>`
    : '';

  card.innerHTML = `
    <div class="task-checkbox" onclick="toggleTaskDone('${task.id}')"></div>
    <div class="task-body">
      <div class="task-title">${esc(task.title)}</div>
      <div class="task-meta">
        ${dueLabel}
        ${ccLabel}
        ${dateInfo}
      </div>
    </div>
    <div class="task-actions">
      ${!task.done ? `<button class="flag-task-btn ${task.flagged ? 'is-flagged' : ''}" onclick="toggleTaskFlag('${task.id}')" title="${task.flagged ? 'Unflag' : 'Flag high priority'}">⚑</button>` : ''}
      ${mailLink}
    </div>
  `;
  return card;
}

function buildDueLabel(due) {
  const today = new Date().toISOString().split('T')[0];
  const cls   = due < today ? 'overdue' : due === today ? 'today' : '';
  const label = due === today ? 'Today' : due < today ? 'Overdue' : formatDateShort(due + 'T00:00:00');
  return `<span class="task-due ${cls}">📅 ${label}</span>`;
}

// ─── COMPLETED FOLD ──────────────────────────────────────────
function toggleCompleted() {
  completedOpen = !completedOpen;
  document.getElementById('completedTasksList').className = 'completed-list' + (completedOpen ? ' open' : '');
  const chevron = document.querySelector('.completed-toggle svg');
  if (chevron) chevron.style.transform = completedOpen ? 'rotate(180deg)' : '';
}

// ─── MODAL ───────────────────────────────────────────────────
function openAddTask() {
  document.getElementById('newTaskTitle').value = '';
  document.getElementById('newTaskDue').value   = '';
  document.getElementById('newTaskCC').value    = '';
  document.getElementById('addTaskModal').classList.add('open');
  setTimeout(() => document.getElementById('newTaskTitle').focus(), 80);
}

function closeAddTask(e) {
  if (e && e.target !== document.getElementById('addTaskModal')) return;
  document.getElementById('addTaskModal').classList.remove('open');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.getElementById('addTaskModal').classList.remove('open');
  if (e.key === 'Enter' && document.getElementById('addTaskModal').classList.contains('open')) addManualTask();
});

// ─── TOAST ───────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

// ─── HELPERS ─────────────────────────────────────────────────
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escId(id) {
  return String(id || '').replace(/'/g, "\\'");
}

function parseName(sender) {
  if (!sender) return 'Unknown';
  const m = sender.match(/^"?([^"<]+)"?\s*</);
  if (m) return m[1].trim().replace(/^"|"$/g, '');
  const em = sender.match(/([^@<\s]+)@/);
  return em ? em[1] : sender.split('@')[0] || sender;
}

function formatCC(cc) {
  if (!cc) return '';
  const names = cc.split(',').map(s => parseName(s.trim())).filter(Boolean);
  if (names.length === 0) return '';
  if (names.length <= 2) return names.join(', ');
  return names.slice(0,2).join(', ') + ` +${names.length-2}`;
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = diffMs / 60000;
    if (diffMin < 1)   return 'just now';
    if (diffMin < 60)  return `${Math.round(diffMin)}m ago`;
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay)       return d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
    const yesterday = new Date(now); yesterday.setDate(now.getDate()-1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  } catch(_) { return dateStr.substring(0,10); }
}

function formatDateShort(isoStr) {
  try {
    return new Date(isoStr).toLocaleDateString('en-US',{month:'short',day:'numeric'});
  } catch(_) { return isoStr; }
}

function buildMailUrl(email) {
  // Deep-link to Apple Mail via message-id
  if (email.id) return 'message://%3C' + encodeURIComponent(email.id) + '%3E';
  return '#';
}

function buildMailUrlById(emailId) {
  if (!emailId) return '#';
  return 'message://%3C' + encodeURIComponent(emailId) + '%3E';
}
