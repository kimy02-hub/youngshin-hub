/* DMS Dashboard app.js v8 - clean rewrite */
'use strict';

const TASKS_KEY  = 'dms_tasks_v3';
const TASKS_URL  = 'tasks.json';
const EMAILS_URL = 'emails.json';
const GITHUB_REPO = 'kimy02-hub/youngshin-hub';

let allEmails = [], tasks = [], currentTab = 'all', completedOpen = false;

// -- BOOT ------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  loadTasksFromStorage();
  await loadEmails();
  await syncTasksFromGitHub();
  startAutoRefresh();
});

// -- GITHUB PUSH -----------------------------------------------
async function pushTasksToGitHub() {
  const token = localStorage.getItem('gh_token');
  if (!token) return;
  try {
    const api = 'https://api.github.com/repos/' + GITHUB_REPO + '/contents/' + TASKS_URL;
    const hdrs = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
    const gr = await fetch(api, { headers: hdrs });
    if (!gr.ok) return;
    const fi = await gr.json();
    const body = { tasks: tasks, saved_at: new Date().toISOString() };
    const enc = btoa(unescape(encodeURIComponent(JSON.stringify(body, null, 2))));
    await fetch(api, {
      method: 'PUT', headers: hdrs,
      body: JSON.stringify({ message: 'tasks update', content: enc, sha: fi.sha })
    });
  } catch (_) {}
}

// -- EMAIL LOADING ---------------------------------------------
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
      `<div class="loading-state"><p style="color:var(--text-ghost)">Could not load emails.<br><small>${e.message}</small></p></div>`;
  }
}

function updateLastUpdated(isoStr) {
  if (!isoStr) return;
  try {
    const d = new Date(isoStr), diff = Math.round((Date.now() - d) / 60000);
    const lbl = diff < 2 ? 'just now' : diff < 60 ? diff + 'm ago' :
                diff < 1440 ? Math.round(diff/60) + 'h ago' :
                d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    document.getElementById('lastUpdated').textContent = 'Updated ' + lbl;
  } catch (_) {}
}

async function refreshData() {
  const btn = document.querySelector('.refresh-btn');
  if (btn) { btn.classList.add('spinning'); btn.disabled = true; }
  try {
    await loadEmails();
    await syncTasksFromGitHub();
    showToast('Refreshed!');
  } finally {
    setTimeout(() => { if (btn) { btn.classList.remove('spinning'); btn.disabled = false; } }, 700);
  }
}

// -- TABS ------------------------------------------------------
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  renderEmails();
}

function getFilteredEmails() {
  if (currentTab === 'unread')  return allEmails.filter(e => !e.read);
  if (currentTab === 'flagged') return allEmails.filter(e => e.flagged);
  return allEmails;
}

// -- EMAIL RENDERING -------------------------------------------
function renderEmails() {
  const list = getFilteredEmails();
  const el   = document.getElementById('emailList');
  document.getElementById('emailCount').textContent = list.length;
  if (!list.length) {
    el.innerHTML = `<div class="loading-state"><p style="font-style:italic;color:var(--text-ghost)">No emails here</p></div>`;
    return;
  }
  el.innerHTML = '';
  list.forEach((email, idx) => el.appendChild(buildEmailCard(email, idx)));
}

function buildEmailCard(email, idx) {
  const card = document.createElement('div');
  card.className = 'email-card' + (!email.read ? ' unread' : '') + (email.flagged ? ' flagged-card' : '');
  card.style.animationDelay = (idx * 0.028) + 's';
  card.innerHTML = `
    <div class="email-top">
      <div class="email-sender-row">
        ${!email.read ? '<div class="unread-dot"></div>' : ''}
        ${email.flagged ? '<span class="flagged-star">&#9873;</span>' : ''}
        <span class="email-sender">${esc(parseName(email.sender))}</span>
      </div>
      <span class="email-time">${esc(formatTime(email.date))}</span>
    </div>
    <div class="email-subject">${esc(email.subject)}</div>
    ${email.cc ? `<div class="email-cc">cc: ${esc(formatCC(email.cc))}</div>` : ''}
    <div class="email-actions">
      <button class="to-task-btn" onclick="emailToTask('${escId(email.id)}')">+ Task</button>
      <a class="open-mail-btn" href="${buildMailUrl(email.id)}" target="_blank">&#9993; Open</a>
    </div>`;
  return card;
}

// -- TASK PERSISTENCE ------------------------------------------
function loadTasksFromStorage() {
  try { tasks = JSON.parse(localStorage.getItem(TASKS_KEY) || '[]'); } catch (_) { tasks = []; }
  tasks = tasks.filter(t => !t.deleted);
  tasks.forEach(t => { if (!t.note) t.note = ''; if (!t.subtasks) t.subtasks = []; });
  renderTasks();
  updateMobileBadge();
}

async function syncTasksFromGitHub() {
  try {
    const res = await fetch(TASKS_URL + '?_=' + Date.now());
    if (!res.ok) return;
    const data = await res.json();
    if (!data.tasks || !data.tasks.length) return;
    // IDs deleted locally
    const localDeleted = new Set(
      JSON.parse(localStorage.getItem(TASKS_KEY) || '[]')
        .filter(t => t.deleted).map(t => t.id)
    );
    // Keep local tasks not yet pushed
    const githubIds = new Set(data.tasks.map(t => t.id));
    // IDs deleted on GitHub (by any device)
    const githubDeleted = new Set(data.tasks.filter(t => t.deleted).map(t => t.id));
    // Keep local tasks not in GitHub AND not deleted on GitHub
    const localOnly = tasks.filter(t => !githubIds.has(t.id) && !githubDeleted.has(t.id));
    // Merge: github tasks minus any deleted, plus local-only
    tasks = [
      ...data.tasks.filter(t => !localDeleted.has(t.id) && !t.deleted),
      ...localOnly
    ];
    tasks.forEach(t => { if (!t.note) t.note = ''; if (!t.subtasks) t.subtasks = []; });
    localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
    renderTasks();
    updateMobileBadge();
  } catch (_) {}
}

function saveTasks() {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
  updateMobileBadge();
  pushTasksToGitHub();
}

// -- EMAIL TO TASK ---------------------------------------------
function emailToTask(emailId) {
  const email = allEmails.find(e => e.id === emailId);
  if (!email) return;
  if (tasks.some(t => t.emailId === emailId)) { showToast('Already a task!'); return; }
  tasks.unshift({
    id: 'task_' + Date.now(), title: email.subject, done: false,
    flagged: email.flagged || false, emailId, emailSender: email.sender,
    emailDate: email.date, cc: email.cc || '', due: null,
    note: '', subtasks: [], createdAt: new Date().toISOString(), type: 'email'
  });
  saveTasks(); renderTasks(); showToast('Task added!');
}

// -- MANUAL TASK -----------------------------------------------
function addManualTask() {
  const title = document.getElementById('newTaskTitle').value.trim();
  if (!title) { document.getElementById('newTaskTitle').focus(); return; }
  const due   = document.getElementById('newTaskDue').value || null;
  const cc    = document.getElementById('newTaskCC').value.trim();
  const today = new Date().toISOString().split('T')[0];
  tasks.unshift({
    id: 'task_' + Date.now(), title, done: false,
    flagged: due === today, emailId: null, emailSender: null,
    emailDate: null, cc, due, note: '', subtasks: [],
    createdAt: new Date().toISOString(), type: 'manual'
  });
  saveTasks(); renderTasks(); closeAddTask();
  showToast(due === today ? 'Auto-flagged: due today!' : 'Task added!');
}

// -- TASK ACTIONS ----------------------------------------------
function deleteTask(taskId) {
  if (!confirm('Delete this task?')) return;
  // Mark deleted and push FIRST - before removing from local array
  const t = tasks.find(t => t.id === taskId);
  if (t) {
    t.deleted = true;
    t.deletedAt = new Date().toISOString();
  }
  // Push with deleted flag before removing locally
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
  pushTasksToGitHub();
  // Now remove from local view
  tasks = tasks.filter(t => !t.deleted);
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
  renderTasks();
  updateMobileBadge();
  showToast('Task deleted');
}

function toggleTaskDone(taskId) {
  const t = tasks.find(t => t.id === taskId); if (!t) return;
  t.done   = !t.done;
  t.doneAt = t.done ? new Date().toISOString() : null;
  t.updatedAt = new Date().toISOString();
  saveTasks(); renderTasks();
}

function toggleTaskFlag(taskId) {
  const t = tasks.find(t => t.id === taskId); if (!t) return;
  t.flagged   = !t.flagged;
  t.updatedAt = new Date().toISOString();
  saveTasks(); renderTasks();
  showToast(t.flagged ? 'Flagged!' : 'Flag removed');
}

function saveTaskCC(taskId) {
  const input = document.getElementById('cc-input-' + taskId); if (!input) return;
  const t = tasks.find(t => t.id === taskId); if (!t) return;
  t.cc = input.value.trim(); t.updatedAt = new Date().toISOString();
  saveTasks(); renderTasks(); showToast('CC saved');
}

function editTaskCC(taskId) {
  const wrap = document.getElementById('cc-wrap-' + taskId); if (!wrap) return;
  const t = tasks.find(t => t.id === taskId); if (!t) return;
  wrap.innerHTML = `<div class="cc-edit-wrap">
    <input class="task-cc-input" id="cc-input-${taskId}" value="${esc(t.cc||'')}" placeholder="add cc..."
      onkeydown="if(event.key==='Enter')saveTaskCC('${taskId}');if(event.key==='Escape')renderTasks();">
    <button class="cc-save-btn" onclick="saveTaskCC('${taskId}')">&#10003;</button>
  </div>`;
  setTimeout(() => { const el = document.getElementById('cc-input-' + taskId); if (el) el.focus(); }, 30);
}

// -- EDIT TASK MODAL -------------------------------------------
let editingTaskId = null;

function openEditTask(taskId) {
  const t = tasks.find(t => t.id === taskId); if (!t) return;
  editingTaskId = taskId;
  document.getElementById('editTaskTitle').value = t.title || '';
  document.getElementById('editTaskDue').value   = t.due   || '';
  document.getElementById('editTaskNote').value  = t.note  || '';
  renderSubtaskEditor(t);
  document.getElementById('editTaskModal').classList.add('open');
  setTimeout(() => document.getElementById('editTaskTitle').focus(), 80);
}

function closeEditTask(e) {
  if (e && e.target !== document.getElementById('editTaskModal')) return;
  document.getElementById('editTaskModal').classList.remove('open');
  editingTaskId = null;
}

function saveEditTask() {
  const t = tasks.find(t => t.id === editingTaskId); if (!t) return;
  const title = document.getElementById('editTaskTitle').value.trim();
  if (!title) { document.getElementById('editTaskTitle').focus(); return; }
  t.title     = title;
  t.due       = document.getElementById('editTaskDue').value  || null;
  t.note      = document.getElementById('editTaskNote').value.trim();
  t.updatedAt = new Date().toISOString();
  if (t.due && t.due === new Date().toISOString().split('T')[0]) t.flagged = true;
  saveTasks(); renderTasks();
  document.getElementById('editTaskModal').classList.remove('open');
  editingTaskId = null;
  showToast('Task saved!');
}

// -- SUBTASK EDITOR --------------------------------------------
function renderSubtaskEditor(t) {
  const list = document.getElementById('subtaskList');
  list.innerHTML = '';
  (t.subtasks || []).forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'subtask-row' + (s.done ? ' subtask-done' : '');
    row.innerHTML = `
      <div class="subtask-check" onclick="toggleSubtask(${i})">${s.done ? '&#10003;' : ''}</div>
      <input class="subtask-input" value="${esc(s.text)}" placeholder="Sub-task..."
        onchange="updateSubtask(${i}, this.value)"
        onkeydown="if(event.key==='Enter'){event.preventDefault();addSubtask();}">
      <button class="subtask-del" onclick="deleteSubtask(${i})">&times;</button>`;
    list.appendChild(row);
  });
}

function addSubtask() {
  const t = tasks.find(t => t.id === editingTaskId); if (!t) return;
  if (!t.subtasks) t.subtasks = [];
  t.subtasks.push({ text: '', done: false });
  renderSubtaskEditor(t);
  const inputs = document.querySelectorAll('.subtask-input');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

function updateSubtask(idx, val) {
  const t = tasks.find(t => t.id === editingTaskId); if (!t || !t.subtasks) return;
  t.subtasks[idx].text = val;
}

function toggleSubtask(idx) {
  const t = tasks.find(t => t.id === editingTaskId); if (!t || !t.subtasks) return;
  t.subtasks[idx].done = !t.subtasks[idx].done;
  renderSubtaskEditor(t);
}

function deleteSubtask(idx) {
  const t = tasks.find(t => t.id === editingTaskId); if (!t || !t.subtasks) return;
  t.subtasks.splice(idx, 1);
  renderSubtaskEditor(t);
}

// -- TASK RENDERING --------------------------------------------
function renderTasks() {
  const active    = tasks.filter(t => !t.done && !t.flagged);
  const flaggedT  = tasks.filter(t => !t.done &&  t.flagged);
  const completed = tasks.filter(t =>  t.done).sort((a, b) => new Date(b.doneAt||0) - new Date(a.doneAt||0));

  const fSec  = document.getElementById('flaggedSection');
  const fList = document.getElementById('flaggedTasksList');
  if (flaggedT.length) {
    fSec.style.display = '';
    fList.innerHTML = '';
    flaggedT.forEach((t, i) => fList.appendChild(buildTaskCard(t, i)));
  } else {
    fSec.style.display = 'none';
  }

  const aList = document.getElementById('activeTasksList');
  aList.innerHTML = '';
  active.forEach((t, i) => aList.appendChild(buildTaskCard(t, i)));

  const cSec  = document.getElementById('completedSection');
  const cList = document.getElementById('completedTasksList');
  document.getElementById('completedCount').textContent = completed.length;
  if (completed.length) {
    cSec.style.display = '';
    cList.innerHTML = '';
    completed.forEach((t, i) => cList.appendChild(buildTaskCard(t, i)));
    cList.className = 'completed-list' + (completedOpen ? ' open' : '');
  } else {
    cSec.style.display = 'none';
  }

  document.getElementById('taskCount').textContent = tasks.filter(t => !t.done).length;
  document.getElementById('tasksEmpty').style.display = tasks.length ? 'none' : '';
  updateMobileBadge();
}

function buildTaskCard(task, idx) {
  const card = document.createElement('div');
  card.className = ['task-card', task.flagged && !task.done ? 'task-flagged' : '', task.done ? 'task-done' : ''].filter(Boolean).join(' ');
  card.style.animationDelay = (idx * 0.025) + 's';

  const tsLabel = task.type === 'email' && task.emailDate
    ? 'Received ' + formatTime(task.emailDate)
    : task.createdAt ? 'Created ' + formatDateShort(task.createdAt) : '';

  const fromHtml = task.type === 'email' && task.emailSender
    ? `<span class="task-from">From: <strong>${esc(parseName(task.emailSender))}</strong></span>`
    : '';

  const ccDisplay = task.cc ? formatCC(task.cc) : '';
  const ccHtml = `<span class="task-cc" id="cc-wrap-${task.id}">
    ${ccDisplay
      ? `<span>&#128100; ${esc(ccDisplay)}</span><button class="cc-edit-btn" onclick="editTaskCC('${task.id}')">&#9998;</button>`
      : `<button class="cc-edit-btn" onclick="editTaskCC('${task.id}')" style="opacity:.5">+ cc</button>`
    }</span>`;

  const note = task.note || '';
  const noteHtml = note.trim()
    ? `<div class="task-note-preview">${linkify(note.trim().substring(0, 200))}${note.length > 200 ? '...' : ''}</div>`
    : '';

  const subs = task.subtasks || [];
  const subHtml = subs.length
    ? `<div class="task-sub-preview">&#9745; ${subs.filter(s=>s.done).length}/${subs.length} sub-task${subs.length > 1 ? 's' : ''}</div>`
    : '';

  const dueHtml  = task.due ? buildDueLabel(task.due) : '';
  const mailLink = task.emailId
    ? `<a class="open-task-mail-btn" href="${buildMailUrl(task.emailId)}" target="_blank">&#9993; Mail</a>`
    : '';

  card.innerHTML = `
    <div class="task-checkbox" onclick="toggleTaskDone('${task.id}')"></div>
    <div class="task-body">
      <div class="task-title-row">
        <span class="task-title">${esc(task.title)}</span>
        <span class="task-timestamp">${esc(tsLabel)}</span>
      </div>
      ${noteHtml}${subHtml}
      <div class="task-meta">${dueHtml}${fromHtml}${ccHtml}</div>
    </div>
    <div class="task-actions">
      <button class="edit-task-btn"   onclick="openEditTask('${task.id}')"  title="Edit">&#9998;</button>
      ${!task.done
        ? `<button class="flag-task-btn ${task.flagged ? 'is-flagged' : ''}" onclick="toggleTaskFlag('${task.id}')" title="${task.flagged ? 'Unflag' : 'Flag'}">&#9873;</button>`
        : ''}
      <button class="delete-task-btn" onclick="deleteTask('${task.id}')"   title="Delete">&#10005;</button>
      ${mailLink}
    </div>`;
  return card;
}

function buildDueLabel(due) {
  const today = new Date().toISOString().split('T')[0];
  const cls   = due < today ? 'overdue' : due === today ? 'today' : '';
  const lbl   = due === today ? 'Today' : due < today ? 'Overdue' : formatDateShort(due + 'T00:00:00');
  return `<span class="task-due ${cls}">&#128197; ${lbl}</span>`;
}

function toggleCompleted() {
  completedOpen = !completedOpen;
  document.getElementById('completedTasksList').className = 'completed-list' + (completedOpen ? ' open' : '');
  const svg = document.querySelector('.completed-toggle svg');
  if (svg) svg.style.transform = completedOpen ? 'rotate(180deg)' : '';
}

// -- MODALS ----------------------------------------------------
function openAddTask() {
  ['newTaskTitle', 'newTaskDue', 'newTaskCC'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('addTaskModal').classList.add('open');
  setTimeout(() => document.getElementById('newTaskTitle').focus(), 80);
}

function closeAddTask(e) {
  if (e && e.target !== document.getElementById('addTaskModal')) return;
  document.getElementById('addTaskModal').classList.remove('open');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.getElementById('addTaskModal').classList.remove('open');
    document.getElementById('editTaskModal').classList.remove('open');
    editingTaskId = null;
  }
  if (e.key === 'Enter' && document.getElementById('addTaskModal').classList.contains('open')) addManualTask();
});

// -- GITHUB TOKEN SETUP ----------------------------------------
function setupGitHubToken() {
  const existing = localStorage.getItem('gh_token');
  if (existing) {
    if (!confirm('GitHub token already stored. Replace it?')) return;
  }
  const token = prompt('Paste your GitHub token:');
  if (token && token.startsWith('ghp_')) {
    localStorage.setItem('gh_token', token.trim());
    alert('Token saved! This device can now sync tasks instantly.');
  } else if (token) {
    alert('Invalid token - must start with ghp_');
  }
}

// -- MOBILE ----------------------------------------------------
function mobileSwitchTab(panel) {
  const split    = document.querySelector('.split');
  const inboxBtn = document.getElementById('mobileInboxBtn');
  const tasksBtn = document.getElementById('mobileTasksBtn');
  if (!split) return;
  if (panel === 'tasks') {
    split.classList.add('show-tasks');
    if (tasksBtn) tasksBtn.classList.add('active');
    if (inboxBtn) inboxBtn.classList.remove('active');
  } else {
    split.classList.remove('show-tasks');
    if (inboxBtn) inboxBtn.classList.add('active');
    if (tasksBtn) tasksBtn.classList.remove('active');
  }
}

function updateMobileBadge() {
  const badge = document.getElementById('tasksBadge');
  if (!badge) return;
  const n = tasks.filter(t => !t.done).length;
  badge.textContent    = n > 0 ? n : '';
  badge.style.display  = n > 0 ? 'block' : 'none';
}

// -- AUTO REFRESH (emails only) --------------------------------
function startAutoRefresh() {
  const INTERVAL = 3 * 60 * 1000;
  let next = Date.now() + INTERVAL;

  setInterval(() => {
    const left = Math.max(0, Math.round((next - Date.now()) / 1000));
    const el   = document.getElementById('lastUpdated');
    if (el && left > 0) {
      const base = el.textContent.split(' | ')[0];
      el.textContent = base + ' | next in ' + Math.floor(left/60) + ':' + String(left % 60).padStart(2, '0');
    }
  }, 1000);

  setInterval(async () => {
    next = Date.now() + INTERVAL;
    await loadEmails();
    await syncTasksFromGitHub();
  }, INTERVAL);
}

// -- TOAST -----------------------------------------------------
let toastTimer;
function showToast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

// -- HELPERS ---------------------------------------------------
function linkify(text) {
  if (!text) return '';
  return esc(text).replace(/(https?:\/\/[^\s<>"]+)/g, url => {
    const clean = url.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"');
    const label = clean.length > 40 ? clean.substring(0, 40) + '...' : clean;
    return `<a href="${clean}" target="_blank" class="note-link" onclick="event.stopPropagation()">${label}</a>`;
  });
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escId(id) { return String(id || '').replace(/'/g, "\\'"); }

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
  if (!names.length) return '';
  return names.length <= 2 ? names.join(', ') : names.slice(0, 2).join(', ') + ` +${names.length - 2}`;
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr), now = new Date(), diff = (now - d) / 60000;
    if (diff < 1)   return 'just now';
    if (diff < 60)  return Math.round(diff) + 'm ago';
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const yd = new Date(now); yd.setDate(now.getDate() - 1);
    if (d.toDateString() === yd.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch (_) { return String(dateStr).substring(0, 10); }
}

function formatDateShort(isoStr) {
  try { return new Date(isoStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  catch (_) { return isoStr; }
}

function buildMailUrl(emailId) {
  if (!emailId) return '#';
  return 'message://%3C' + encodeURIComponent(emailId) + '%3E';
}
