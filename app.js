/* DMS Mailbox Dashboard Ã¡ app.js  v4 */
let allEmails = [], tasks = [], currentTab = 'all', completedOpen = false;
const TASKS_KEY = 'dms_tasks_v3', EMAILS_URL = 'emails.json';

document.addEventListener('DOMContentLoaded', () => { loadTasks(); loadEmails(); });

// ?? EMAIL LOADING ??????????????????????????????????????????????
async function loadEmails() {
  try {
    const res  = await fetch(EMAILS_URL + '?_=' + Date.now());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    allEmails  = data.emails || [];
    updateLastUpdated(data.fetched_at);
    renderEmails();
  } catch(e) {
    document.getElementById('emailList').innerHTML =
      `<div class="loading-state"><p style="color:var(--text-ghost)">Could not load emails.<br><small>${e.message}</small></p></div>`;
  }
}

function updateLastUpdated(isoStr) {
  if (!isoStr) return;
  try {
    const d = new Date(isoStr), diffMin = Math.round((Date.now()-d)/60000);
    const label = diffMin<2?'just now':diffMin<60?`${diffMin}m ago`:diffMin<1440?`${Math.round(diffMin/60)}h ago`:d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
    document.getElementById('lastUpdated').textContent = 'Updated ' + label;
  } catch(_) {}
}

async function refreshData() {
  const btn = document.querySelector('.refresh-btn');
  btn.classList.add('spinning'); btn.disabled = true;
  try { await loadEmails(); showToast('? Inbox refreshed!'); }
  finally { setTimeout(() => { btn.classList.remove('spinning'); btn.disabled=false; }, 700); }
}

// ?? TAB ????????????????????????????????????????????????????????
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab===tab));
  renderEmails();
}
function getFilteredEmails() {
  if (currentTab==='unread')  return allEmails.filter(e=>!e.read);
  if (currentTab==='flagged') return allEmails.filter(e=>e.flagged);
  return allEmails;
}

// ?? EMAIL RENDERING ????????????????????????????????????????????
function renderEmails() {
  const list = getFilteredEmails();
  const container = document.getElementById('emailList');
  document.getElementById('emailCount').textContent = list.length;
  if (!list.length) { container.innerHTML=`<div class="loading-state"><p style="font-style:italic;color:var(--text-ghost)">No emails here ?</p></div>`; return; }
  container.innerHTML = '';
  list.forEach((email,idx) => container.appendChild(buildEmailCard(email,idx)));
}

function buildEmailCard(email, idx) {
  const card = document.createElement('div');
  card.className = 'email-card' + (!email.read?' unread':'') + (email.flagged?' flagged-card':'');
  card.style.animationDelay = (idx*0.028)+'s';
  card.innerHTML = `
    <div class="email-top">
      <div class="email-sender-row">
        ${!email.read?'<div class="unread-dot"></div>':''}
        ${email.flagged?'<span class="flagged-star">?</span>':''}
        <span class="email-sender">${esc(parseName(email.sender))}</span>
      </div>
      <span class="email-time">${esc(formatTime(email.date))}</span>
    </div>
    <div class="email-subject">${esc(email.subject)}</div>
    ${email.cc?`<div class="email-cc">cc: ${esc(formatCC(email.cc))}</div>`:''}
    <div class="email-actions">
      <button class="to-task-btn" onclick="emailToTask('${escId(email.id)}')">? Task</button>
      <a class="open-mail-btn" href="${buildMailUrl(email.id)}" target="_blank">? Open</a>
    </div>`;
  return card;
}

// ?? TASK PERSISTENCE ???????????????????????????????????????????
function loadTasks() {
  try { tasks = JSON.parse(localStorage.getItem(TASKS_KEY)||'[]'); } catch(_) { tasks=[]; }
  renderTasks();
}
function saveTasks() { localStorage.setItem(TASKS_KEY, JSON.stringify(tasks)); }

// ?? EMAIL ? TASK ????????????????????????????????????????????????
function emailToTask(emailId) {
  const email = allEmails.find(e=>e.id===emailId);
  if (!email) return;
  if (tasks.some(t=>t.emailId===emailId)) { showToast('Already added as a task!'); return; }
  tasks.unshift({ id:'task_'+Date.now(), title:email.subject, done:false, flagged:email.flagged||false,
    emailId, emailSender:email.sender, emailDate:email.date, cc:email.cc||'',
    due:null, note:'', subtasks:[], createdAt:new Date().toISOString(), type:'email' });
  saveTasks(); renderTasks(); showToast('? Task added!');
}

// ?? MANUAL TASK ????????????????????????????????????????????????
function addManualTask() {
  const title = document.getElementById('newTaskTitle').value.trim();
  if (!title) { document.getElementById('newTaskTitle').focus(); return; }
  const due = document.getElementById('newTaskDue').value||null;
  const cc  = document.getElementById('newTaskCC').value.trim();
  const isToday = due && due===new Date().toISOString().split('T')[0];
  tasks.unshift({ id:'task_'+Date.now(), title, done:false, flagged:isToday,
    emailId:null, emailSender:null, emailDate:null, cc, due,
    note:'', subtasks:[], createdAt:new Date().toISOString(), type:'manual' });
  saveTasks(); renderTasks(); closeAddTask();
  showToast(isToday?'? Auto-flagged Ã due today!':'? Task added!');
}

// ?? TASK ACTIONS ???????????????????????????????????????????????
function toggleTaskDone(taskId) {
  const t = tasks.find(t=>t.id===taskId); if (!t) return;
  t.done=!t.done; t.doneAt=t.done?new Date().toISOString():null;
  saveTasks(); renderTasks();
}
function toggleTaskFlag(taskId) {
  const t = tasks.find(t=>t.id===taskId); if (!t) return;
  t.flagged=!t.flagged; saveTasks(); renderTasks();
  showToast(t.flagged?'? Flagged!':'Flag removed');
}
function saveTaskCC(taskId) {
  const input=document.getElementById('cc-input-'+taskId); if (!input) return;
  const t=tasks.find(t=>t.id===taskId); if (!t) return;
  t.cc=input.value.trim(); saveTasks(); renderTasks(); showToast('CC saved');
}
function editTaskCC(taskId) {
  const wrap=document.getElementById('cc-wrap-'+taskId); if (!wrap) return;
  const t=tasks.find(t=>t.id===taskId); if (!t) return;
  wrap.innerHTML=`<div class="cc-edit-wrap"><span style="font-size:.69rem;color:var(--text-tertiary)">?</span>
    <input class="task-cc-input" id="cc-input-${taskId}" value="${esc(t.cc||'')}" placeholder="add ccÃ"
      onkeydown="if(event.key==='Enter')saveTaskCC('${taskId}');if(event.key==='Escape')renderTasks();"></input>
    <button class="cc-save-btn" onclick="saveTaskCC('${taskId}')">?</button></div>`;
  setTimeout(()=>{ const el=document.getElementById('cc-input-'+taskId); if(el)el.focus(); },30);
}

// ?? EDIT MODAL ????????????????????????????????????????????????
let editingTaskId = null;

function openEditTask(taskId) {
  const t = tasks.find(t=>t.id===taskId); if (!t) return;
  editingTaskId = taskId;
  document.getElementById('editTaskTitle').value = t.title||'';
  document.getElementById('editTaskDue').value   = t.due||'';
  document.getElementById('editTaskNote').value  = t.note||'';
  renderSubtaskEditor(t);
  document.getElementById('editTaskModal').classList.add('open');
  setTimeout(()=>document.getElementById('editTaskTitle').focus(), 80);
}

function closeEditTask(e) {
  if (e && e.target!==document.getElementById('editTaskModal')) return;
  document.getElementById('editTaskModal').classList.remove('open');
  editingTaskId = null;
}

function saveEditTask() {
  const t = tasks.find(t=>t.id===editingTaskId); if (!t) return;
  const title = document.getElementById('editTaskTitle').value.trim();
  if (!title) { document.getElementById('editTaskTitle').focus(); return; }
  t.title = title;
  t.due   = document.getElementById('editTaskDue').value || null;
  t.note  = document.getElementById('editTaskNote').value.trim();
  // Auto-flag if due today
  if (t.due && t.due===new Date().toISOString().split('T')[0]) t.flagged=true;
  saveTasks(); renderTasks();
  document.getElementById('editTaskModal').classList.remove('open');
  editingTaskId = null;
  showToast('? Task saved!');
}

// ?? SUBTASK EDITOR ????????????????????????????????????????????
function renderSubtaskEditor(t) {
  const list = document.getElementById('subtaskList');
  list.innerHTML = '';
  const subs = t.subtasks || [];
  subs.forEach((s,i) => {
    const row = document.createElement('div');
    row.className = 'subtask-row' + (s.done?' subtask-done':'');
    row.innerHTML = `
      <div class="subtask-check" onclick="toggleSubtask(${i})">${s.done?'?':''}</div>
      <input class="subtask-input" value="${esc(s.text)}" placeholder="Sub-taskÃ"
        onchange="updateSubtask(${i},this.value)"
        onkeydown="if(event.key==='Enter'){event.preventDefault();addSubtask();}">
      <button class="subtask-del" onclick="deleteSubtask(${i})" title="Remove">*</button>`;
    list.appendChild(row);
  });
}

function addSubtask() {
  const t = tasks.find(t=>t.id===editingTaskId); if (!t) return;
  if (!t.subtasks) t.subtasks=[];
  t.subtasks.push({text:'',done:false});
  renderSubtaskEditor(t);
  // Focus the new input
  const inputs = document.querySelectorAll('.subtask-input');
  if (inputs.length) inputs[inputs.length-1].focus();
}

function updateSubtask(idx, val) {
  const t = tasks.find(t=>t.id===editingTaskId); if (!t||!t.subtasks) return;
  t.subtasks[idx].text = val;
}

function toggleSubtask(idx) {
  const t = tasks.find(t=>t.id===editingTaskId); if (!t||!t.subtasks) return;
  t.subtasks[idx].done = !t.subtasks[idx].done;
  renderSubtaskEditor(t);
}

function deleteSubtask(idx) {
  const t = tasks.find(t=>t.id===editingTaskId); if (!t||!t.subtasks) return;
  t.subtasks.splice(idx,1);
  renderSubtaskEditor(t);
}

// ?? TASK RENDERING ?????????????????????????????????????????????
function renderTasks() {
  const active    = tasks.filter(t=>!t.done&&!t.flagged);
  const flaggedT  = tasks.filter(t=>!t.done&&t.flagged);
  const completed = tasks.filter(t=>t.done).sort((a,b)=>new Date(b.doneAt||0)-new Date(a.doneAt||0));
  const flaggedSection=document.getElementById('flaggedSection');
  const flaggedList=document.getElementById('flaggedTasksList');
  if (flaggedT.length) {
    flaggedSection.style.display='';
    flaggedList.innerHTML='';
    flaggedT.forEach((t,i)=>flaggedList.appendChild(buildTaskCard(t,i)));
  } else { flaggedSection.style.display='none'; flaggedList.innerHTML=''; }
  const activeList=document.getElementById('activeTasksList');
  activeList.innerHTML='';
  active.forEach((t,i)=>activeList.appendChild(buildTaskCard(t,i)));
  const completedSection=document.getElementById('completedSection');
  const completedList=document.getElementById('completedTasksList');
  document.getElementById('completedCount').textContent=completed.length;
  if (completed.length) {
    completedSection.style.display='';
    completedList.innerHTML='';
    completed.forEach((t,i)=>completedList.appendChild(buildTaskCard(t,i)));
    completedList.className='completed-list'+(completedOpen?' open':'');
  } else { completedSection.style.display='none'; }
  document.getElementById('taskCount').textContent=tasks.filter(t=>!t.done).length;
  document.getElementById('tasksEmpty').style.display=tasks.length?'none':'';
}

function buildTaskCard(task, idx) {
  const cls=['task-card'];
  if (task.flagged&&!task.done) cls.push('task-flagged');
  if (task.done) cls.push('task-done');
  const card=document.createElement('div');
  card.className=cls.join(' ');
  card.style.animationDelay=(idx*0.025)+'s';
  let tsLabel='';
  if (task.type==='email'&&task.emailDate) tsLabel='Received '+formatTime(task.emailDate);
  else if (task.createdAt) tsLabel='Created '+formatDateShort(task.createdAt);
  let fromHtml='';
  if (task.type==='email'&&task.emailSender)
    fromHtml=`<span class="task-from">From: <strong>${esc(parseName(task.emailSender))}</strong></span>`;
  const ccDisplay=task.cc?formatCC(task.cc):'';
  const ccHtml=`<span class="task-cc" id="cc-wrap-${task.id}">
    ${ccDisplay
      ?`<span>? ${esc(ccDisplay)}</span><button class="cc-edit-btn" onclick="editTaskCC('${task.id}')" title="Edit CC">?</button>`
      :`<button class="cc-edit-btn" onclick="editTaskCC('${task.id}')" title="Add CC" style="opacity:.5">+ cc</button>`
    }</span>`;
  const dueHtml=task.due?buildDueLabel(task.due):'';
  const mailLink=task.emailId?`<a class="open-task-mail-btn" href="${buildMailUrl(task.emailId)}" target="_blank">? Mail</a>`:'';
  // Note & subtask preview
  const hasNote = task.note && task.note.trim();
  const subs    = task.subtasks||[];
  const doneSubs= subs.filter(s=>s.done).length;
  const notePreview = hasNote?`<div class="task-note-preview">${esc(task.note.trim().substring(0,80))}${task.note.length>80?'Ã':''}</div>`:'';
  const subPreview  = subs.length?`<div class="task-sub-preview">? ${doneSubs}/${subs.length} sub-tasks</div>`:'';
  card.innerHTML=`
    <div class="task-checkbox" onclick="toggleTaskDone('${task.id}')"></div>
    <div class="task-body">
      <div class="task-title-row">
        <span class="task-title">${esc(task.title)}</span>
        <span class="task-timestamp">${esc(tsLabel)}</span>
      </div>
      ${notePreview}${subPreview}
      <div class="task-meta">${dueHtml}${fromHtml}${ccHtml}</div>
    </div>
    <div class="task-actions">
      <button class="edit-task-btn" onclick="openEditTask('${task.id}')" title="Edit task">&#9998;</button>
      ${!task.done?`<button class="flag-task-btn ${task.flagged?'is-flagged':''}" onclick="toggleTaskFlag('${task.id}')" title="${task.flagged?'Unflag':'Flag'}">&#9873;</button>`:''}
      ${mailLink}
    </div>`;
  return card;
}

function buildDueLabel(due) {
  const today=new Date().toISOString().split('T')[0];
  const cls=due<today?'overdue':due===today?'today':'';
  const label=due===today?'? Today':due<today?'? Overdue':'? '+formatDateShort(due+'T00:00:00');
  return `<span class="task-due ${cls}">${label}</span>`;
}

function toggleCompleted() {
  completedOpen=!completedOpen;
  document.getElementById('completedTasksList').className='completed-list'+(completedOpen?' open':'');
  const svg=document.querySelector('.completed-toggle svg');
  if (svg) svg.style.transform=completedOpen?'rotate(180deg)':'';
}

// ?? ADD TASK MODAL ?????????????????????????????????????????????
function openAddTask() {
  ['newTaskTitle','newTaskDue','newTaskCC'].forEach(id=>{document.getElementById(id).value='';});
  document.getElementById('addTaskModal').classList.add('open');
  setTimeout(()=>document.getElementById('newTaskTitle').focus(),80);
}
function closeAddTask(e) {
  if (e&&e.target!==document.getElementById('addTaskModal')) return;
  document.getElementById('addTaskModal').classList.remove('open');
}
document.addEventListener('keydown',e=>{
  if (e.key==='Escape') {
    document.getElementById('addTaskModal').classList.remove('open');
    document.getElementById('editTaskModal').classList.remove('open');
    editingTaskId=null;
  }
  if (e.key==='Enter'&&document.getElementById('addTaskModal').classList.contains('open')) addManualTask();
});

// ?? TOAST ??????????????????????????????????????????????????????
let toastTimer;
function showToast(msg) {
  let el=document.querySelector('.toast');
  if (!el){el=document.createElement('div');el.className='toast';document.body.appendChild(el);}
  el.textContent=msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>el.classList.remove('show'),2400);
}

// ?? HELPERS ????????????????????????????????????????????????????
function esc(str){return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function escId(id){return String(id||'').replace(/'/g,"\\'");}
function parseName(sender){
  if(!sender)return 'Unknown';
  const m=sender.match(/^"?([^"<]+)"?\s*</);
  if(m)return m[1].trim().replace(/^"|"$/g,'');
  const em=sender.match(/([^@<\s]+)@/);
  return em?em[1]:sender.split('@')[0]||sender;
}
function formatCC(cc){
  if(!cc)return '';
  const names=cc.split(',').map(s=>parseName(s.trim())).filter(Boolean);
  if(!names.length)return '';
  if(names.length<=2)return names.join(', ');
  return names.slice(0,2).join(', ')+` +${names.length-2}`;
}
function formatTime(dateStr){
  if(!dateStr)return '';
  try{
    const d=new Date(dateStr),now=new Date(),diffMin=(now-d)/60000;
    if(diffMin<1)return 'just now';
    if(diffMin<60)return `${Math.round(diffMin)}m ago`;
    if(d.toDateString()===now.toDateString())return d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
    const yd=new Date(now);yd.setDate(now.getDate()-1);
    if(d.toDateString()===yd.toDateString())return 'Yesterday';
    return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  }catch(_){return String(dateStr).substring(0,10);}
}
function formatDateShort(isoStr){try{return new Date(isoStr).toLocaleDateString('en-US',{month:'short',day:'numeric'});}catch(_){return isoStr;}}
function buildMailUrl(emailId){if(!emailId)return '#';return 'message://%3C'+encodeURIComponent(emailId)+'%3E';}
