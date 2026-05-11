// ══════════════════════════════════════════
//  AnonChat — admin.js (password login)
// ══════════════════════════════════════════

// ⚠️ CHANGE THIS PASSWORD — something only you know!
const ADMIN_PASSWORD = "alees2233";

let allMessages = [];

// ── Login ──
function checkPassword() {
  const entered = document.getElementById('admin-password').value;
  if (!entered) return showToast('Enter password');
  showStep('loading');
  setTimeout(() => {
    if (entered === ADMIN_PASSWORD) {
      sessionStorage.setItem('admin_auth', '1');
      showScreen('admin-panel');
      loadAdminMessages();
      loadUsers();
      loadSettings();
    } else {
      showStep('denied');
    }
  }, 600);
}

function adminLogout() {
  sessionStorage.removeItem('admin_auth');
  location.reload();
}

// Auto-login if session exists
window.addEventListener('load', () => {
  if (sessionStorage.getItem('admin_auth') === '1') {
    showScreen('admin-panel');
    loadAdminMessages();
    loadUsers();
    loadSettings();
  }
});

function showStep(n) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  document.getElementById('step-' + n).classList.add('active');
}
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Tabs ──
function showTab(name, btn) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  if (btn) btn.classList.add('active');
}

// ── Messages ──
function loadAdminMessages() {
  const room = document.getElementById('room-filter').value;
  const list = document.getElementById('admin-messages');
  list.innerHTML = '<div class="spinner"></div>';
  db.collection('rooms').doc(room).collection('messages')
    .orderBy('createdAt', 'desc').limit(200)
    .onSnapshot(snap => {
      allMessages = [];
      list.innerHTML = '';
      snap.forEach(doc => {
        allMessages.push({ id: doc.id, ...doc.data(), room });
        renderAdminMessage(doc.id, doc.data(), room, list);
      });
      if (!list.children.length) list.innerHTML = '<p style="opacity:.4;padding:1rem;text-align:center">No messages yet</p>';
    });
}

function renderAdminMessage(id, data, room, container) {
  const alias = data.alias || '?';
  const time = data.createdAt ? new Date(data.createdAt.toDate()).toLocaleString() : '';
  const div = document.createElement('div');
  div.className = 'admin-msg-row';
  div.id = 'amsg-' + id;

  let preview = '';
  if (data.type === 'text') preview = `<span class="msg-preview">${escHTML(data.text || '')}</span>`;
  else if (data.type === 'image') preview = `<img src="${data.url}" class="thumb" onclick="window.open('${data.url}')"/>`;
  else if (data.type === 'voice') preview = `<audio controls src="${data.url}" style="height:32px"></audio>`;

  div.innerHTML = `
    <div class="amsg-meta">
      <span class="amsg-alias">${escHTML(alias)}</span>
      <span class="amsg-time">${time}</span>
      <span class="amsg-type badge-${data.type}">${data.type}</span>
    </div>
    <div class="amsg-content">${preview}</div>
    <div class="amsg-actions">
      <button class="btn-danger-sm" onclick="deleteMessage('${id}','${room}')">🗑 Delete</button>
      <button class="btn-warn-sm" onclick="blockUserFromMsg('${data.uid}','${escHTML(alias)}')">🚫 Block</button>
    </div>`;
  container.appendChild(div);
}

async function deleteMessage(msgId, room) {
  if (!confirm('Delete this message?')) return;
  await db.collection('rooms').doc(room).collection('messages').doc(msgId).delete();
  showToast('Message deleted');
}

async function blockUserFromMsg(uid, alias) {
  if (!confirm(`Block ${alias}?`)) return;
  await db.collection('blocked').doc(uid).set({
    blockedAt: firebase.firestore.FieldValue.serverTimestamp(), alias
  });
  showToast(`${alias} blocked`);
}

function filterMessages() {
  const q = document.getElementById('msg-search').value.toLowerCase();
  document.querySelectorAll('.admin-msg-row').forEach(row => {
    row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

// ── Users ──
function loadUsers() {
  const list = document.getElementById('admin-users');
  db.collection('users').onSnapshot(snap => {
    list.innerHTML = '';
    snap.forEach(doc => renderUser(doc.id, doc.data(), list));
    if (!list.children.length) list.innerHTML = '<p style="opacity:.4;padding:1rem;text-align:center">No users yet</p>';
  });
}

function renderUser(uid, data, container) {
  const div = document.createElement('div');
  div.className = 'user-row';
  div.innerHTML = `
    <div class="user-info">
      <span class="user-alias">${escHTML(data.alias || '?')}</span>
      <span class="user-phone">📱 ${escHTML(data.phone || 'unknown')}</span>
      <span class="user-uid">ID: ${uid.slice(0,10)}…</span>
    </div>
    <div class="user-actions">
      <button class="btn-warn-sm" onclick="blockUser('${uid}','${escHTML(data.alias||'')}')">🚫 Block</button>
      <button class="btn-ghost-sm" onclick="unblockUser('${uid}')">✓ Unblock</button>
    </div>`;
  container.appendChild(div);
}

async function blockUser(uid, alias) {
  if (!confirm(`Block ${alias}?`)) return;
  await db.collection('blocked').doc(uid).set({
    blockedAt: firebase.firestore.FieldValue.serverTimestamp(), alias
  });
  showToast(`${alias} blocked`);
}

async function unblockUser(uid) {
  await db.collection('blocked').doc(uid).delete();
  showToast('User unblocked');
}

// ── Settings ──
function loadSettings() {
  db.collection('settings').doc('app').onSnapshot(snap => {
    if (!snap.exists) return;
    const d = snap.data();
    document.getElementById('toggle-group').checked  = d.groupChat !== false;
    document.getElementById('toggle-dm').checked     = d.dmChat !== false;
    document.getElementById('toggle-images').checked = d.imageSharing !== false;
    document.getElementById('toggle-voice').checked  = d.voiceMessages !== false;
  });
}

async function updateSetting(key, value) {
  await db.collection('settings').doc('app').set({ [key]: value }, { merge: true });
  showToast(`${key} → ${value ? 'ON' : 'OFF'}`);
}

// ── Helpers ──
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.add('hidden'), 3000);
}
function escHTML(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
