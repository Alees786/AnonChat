// ══════════════════════════════════════════
//  AnonChat — admin.js
// ══════════════════════════════════════════

let confirmationResult = null;
let allMessages = [];

// ─── Auth ────────────────────────────────
function sendOTP() {
  const cc = document.getElementById('country-code').value.trim();
  const ph = document.getElementById('phone-input').value.trim();
  if (!ph) return showToast('Enter phone number');
  showStep('loading');

  if (!window.recaptchaVerifier) {
    window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
      size: 'invisible', callback: () => {}
    });
  }

  auth.signInWithPhoneNumber(cc + ph, window.recaptchaVerifier)
    .then(r => { confirmationResult = r; showStep('otp'); setupOTPInputs(); })
    .catch(e => { showStep('phone'); showToast(e.message); });
}

function setupOTPInputs() {
  const digits = document.querySelectorAll('.otp-digit');
  digits.forEach((inp, i) => {
    inp.value = '';
    inp.addEventListener('input', () => {
      if (inp.value.length > 1) inp.value = inp.value.slice(-1);
      if (inp.value && i < digits.length - 1) digits[i + 1].focus();
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !inp.value && i > 0) digits[i - 1].focus();
    });
  });
  digits[0].focus();
}

function verifyOTP() {
  const digits = document.querySelectorAll('.otp-digit');
  const code = Array.from(digits).map(d => d.value).join('');
  if (code.length !== 6) return showToast('Enter 6-digit OTP');
  showStep('loading');
  confirmationResult.confirm(code)
    .then(r => {
      const phone = r.user.phoneNumber;
      if (!ADMIN_PHONES.includes(phone)) {
        auth.signOut();
        showStep('denied');
      } else {
        showScreen('admin-panel');
        loadAdminMessages();
        loadUsers();
        loadSettings();
      }
    })
    .catch(() => { showStep('otp'); showToast('Invalid OTP'); });
}

auth.onAuthStateChanged(user => {
  if (user && ADMIN_PHONES.includes(user.phoneNumber)) {
    showScreen('admin-panel');
    loadAdminMessages();
    loadUsers();
    loadSettings();
  }
});

function backToPhone() { showStep('phone'); }
function showStep(n) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  document.getElementById('step-' + n).classList.add('active');
}
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ─── Tabs ────────────────────────────────
function showTab(name) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  event.target.classList.add('active');
}

// ─── Messages ────────────────────────────
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
      <button class="btn-danger-sm" onclick="deleteMessage('${id}', '${room}', '${data.uid}')">🗑 Delete</button>
    </div>`;
  container.appendChild(div);
}

async function deleteMessage(msgId, room, uid) {
  if (!confirm('Delete this message?')) return;
  await db.collection('rooms').doc(room).collection('messages').doc(msgId).delete();
  showToast('Message deleted');
}

function filterMessages() {
  const q = document.getElementById('msg-search').value.toLowerCase();
  document.querySelectorAll('.admin-msg-row').forEach(row => {
    row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

// ─── Users ───────────────────────────────
function loadUsers() {
  const list = document.getElementById('admin-users');
  list.innerHTML = '';

  db.collection('users').onSnapshot(snap => {
    list.innerHTML = '';
    snap.forEach(doc => {
      const data = doc.data();
      renderUser(doc.id, data, list);
    });
  });
}

function renderUser(uid, data, container) {
  const div = document.createElement('div');
  div.className = 'user-row';
  div.id = 'user-' + uid;

  div.innerHTML = `
    <div class="user-info">
      <span class="user-alias">${escHTML(data.alias || '?')}</span>
      <span class="user-uid">${uid.slice(0,8)}…</span>
    </div>
    <div class="user-actions">
      <button class="btn-warn-sm" onclick="blockUser('${uid}', '${escHTML(data.alias || '')}')">🚫 Block</button>
      <button class="btn-danger-sm" onclick="unblockUser('${uid}')">✓ Unblock</button>
    </div>`;
  container.appendChild(div);
}

async function blockUser(uid, alias) {
  if (!confirm(`Block ${alias}? They can read but not send messages.`)) return;
  await db.collection('blocked').doc(uid).set({ blockedAt: firebase.firestore.FieldValue.serverTimestamp(), alias });
  showToast(`${alias} blocked`);
}

async function unblockUser(uid) {
  await db.collection('blocked').doc(uid).delete();
  showToast('User unblocked');
}

// ─── Settings ────────────────────────────
function loadSettings() {
  db.collection('settings').doc('app').onSnapshot(snap => {
    if (!snap.exists) return;
    const d = snap.data();
    document.getElementById('toggle-group').checked = d.groupChat !== false;
    document.getElementById('toggle-dm').checked = d.dmChat !== false;
    document.getElementById('toggle-images').checked = d.imageSharing !== false;
    document.getElementById('toggle-voice').checked = d.voiceMessages !== false;
  });
}

async function updateSetting(key, value) {
  await db.collection('settings').doc('app').set({ [key]: value }, { merge: true });
  showToast(`${key} set to ${value}`);
}

// ─── Helpers ─────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.add('hidden'), 3000);
}

function escHTML(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
