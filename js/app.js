// ══════════════════════════════════════════
//  AnonChat — app.js (no OTP version)
// ══════════════════════════════════════════

let myAlias = '';
let myUID = '';
let myPhone = '';
let currentChannel = 'general';
let currentChannelType = 'room';
let unsubscribeMessages = null;
let unsubscribeDMs = null;
let mediaRecorder = null;
let audioChunks = [];
let appSettings = { groupChat: true, dmChat: true };

// ── Generate a unique ID stored in localStorage ──
function getOrCreateUID() {
  let uid = localStorage.getItem('anonchat_uid');
  if (!uid) {
    uid = 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    localStorage.setItem('anonchat_uid', uid);
  }
  return uid;
}

// ── Generate alias from UID ──
function generateAlias(uid) {
  let hash = 0;
  for (let i = 0; i < uid.length; i++) hash = ((hash << 5) - hash) + uid.charCodeAt(i);
  const num = Math.abs(hash) % 9000 + 1000;
  return `Anon#${num}`;
}

// ── Enter Chat (no OTP) ──
async function enterChat() {
  const cc = document.getElementById('country-code').value.trim();
  const ph = document.getElementById('phone-input').value.trim();
  if (!ph || ph.length < 8) return showToast('Enter a valid phone number');

  myPhone = cc + ph;
  myUID = getOrCreateUID();
  myAlias = generateAlias(myUID);
  showStep('loading');

  try {
    // Check if blocked
    const blockedDoc = await db.collection('blocked').doc(myUID).get();
    if (blockedDoc.exists) {
      localStorage.removeItem('anonchat_uid');
      localStorage.removeItem('anonchat_phone');
      showToast('You have been blocked.');
      showStep('phone');
      return;
    }

    // Save user — phone only visible to admin
    await db.collection('users').doc(myUID).set({
      alias: myAlias,
      uid: myUID,
      phone: myPhone,
      lastSeen: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    localStorage.setItem('anonchat_phone', myPhone);

    const settingsDoc = await db.collection('settings').doc('app').get();
    if (settingsDoc.exists) appSettings = { ...appSettings, ...settingsDoc.data() };

    document.getElementById('my-alias').textContent = myAlias;
    showScreen('chat');
    applySettings();
    openRoom('general');
    loadDMList();
    watchSettings();

  } catch (err) {
    showStep('phone');
    showToast('Connection error. Check your internet.');
    console.error(err);
  }
}

// ── Auto-login returning user ──
window.addEventListener('load', async () => {
  const uid   = localStorage.getItem('anonchat_uid');
  const phone = localStorage.getItem('anonchat_phone');
  if (uid && phone) {
    myUID = uid; myPhone = phone; myAlias = generateAlias(myUID);
    showStep('loading');
    try {
      const blockedDoc = await db.collection('blocked').doc(myUID).get();
      if (blockedDoc.exists) {
        localStorage.removeItem('anonchat_uid');
        localStorage.removeItem('anonchat_phone');
        showStep('phone');
        showToast('You have been blocked.');
        return;
      }
      await db.collection('users').doc(myUID).set({
        alias: myAlias, uid: myUID, phone: myPhone,
        lastSeen: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      const settingsDoc = await db.collection('settings').doc('app').get();
      if (settingsDoc.exists) appSettings = { ...appSettings, ...settingsDoc.data() };

      document.getElementById('my-alias').textContent = myAlias;
      showScreen('chat');
      applySettings();
      openRoom('general');
      loadDMList();
      watchSettings();
    } catch(e) { showStep('phone'); }
  } else {
    showStep('phone');
  }
});

function showStep(n) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  document.getElementById('step-' + n).classList.add('active');
}

function signOutUser() {
  localStorage.removeItem('anonchat_uid');
  localStorage.removeItem('anonchat_phone');
  location.reload();
}

function applySettings() {
  document.getElementById('new-dm-btn').style.display = appSettings.dmChat ? '' : 'none';
  document.getElementById('dm-section').style.display  = appSettings.dmChat ? '' : 'none';
}

function watchSettings() {
  db.collection('settings').doc('app').onSnapshot(snap => {
    if (snap.exists) { appSettings = { ...appSettings, ...snap.data() }; applySettings(); }
  });
}

// ── Rooms ──
function openRoom(roomId) {
  currentChannel = roomId; currentChannelType = 'room';
  document.querySelectorAll('.room-item').forEach(r => r.classList.remove('active'));
  const el = document.querySelector(`[data-room="${roomId}"]`);
  if (el) el.classList.add('active');
  document.getElementById('chat-channel-name').textContent = '# ' + roomId;
  document.getElementById('chat-channel-desc').textContent = 'Public group chat';
  loadMessages(); closeSidebarMobile();
}

// ── DMs ──
function loadDMList() {
  if (unsubscribeDMs) unsubscribeDMs();
  const dmList = document.getElementById('dm-list');
  unsubscribeDMs = db.collection('dms')
    .where('members', 'array-contains', myUID)
    .orderBy('lastAt', 'desc')
    .onSnapshot(snap => {
      dmList.innerHTML = '';
      snap.forEach(doc => {
        const otherId = doc.data().members.find(m => m !== myUID);
        const alias = generateAlias(otherId);
        const div = document.createElement('div');
        div.className = 'room-item'; div.dataset.dm = doc.id;
        div.innerHTML = `<span class="room-icon">@</span><span>${alias}</span>`;
        div.onclick = () => openDM(doc.id, alias);
        dmList.appendChild(div);
      });
    });
}

async function showUserList() {
  if (!appSettings.dmChat) return showToast('DMs are disabled by admin.');
  const modal = document.getElementById('user-list-modal');
  const content = document.getElementById('user-list-content');
  content.innerHTML = '<div class="spinner"></div>';
  modal.classList.remove('hidden');
  const users = await db.collection('users').get();
  content.innerHTML = '';
  users.forEach(doc => {
    if (doc.id === myUID) return;
    const alias = doc.data().alias || generateAlias(doc.id);
    const div = document.createElement('div');
    div.className = 'user-list-item'; div.textContent = alias;
    div.onclick = () => startDM(doc.id, alias);
    content.appendChild(div);
  });
  if (!content.children.length) content.innerHTML = '<p style="opacity:.5;padding:1rem">No other users yet.</p>';
}

async function startDM(otherUID, alias) {
  closeModal('user-list-modal');
  const dmId = [myUID, otherUID].sort().join('_');
  await db.collection('dms').doc(dmId).set({
    members: [myUID, otherUID], lastAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  openDM(dmId, alias);
}

function openDM(dmId, alias) {
  currentChannel = dmId; currentChannelType = 'dm';
  document.querySelectorAll('.room-item').forEach(r => r.classList.remove('active'));
  const el = document.querySelector(`[data-dm="${dmId}"]`);
  if (el) el.classList.add('active');
  document.getElementById('chat-channel-name').textContent = '@ ' + alias;
  document.getElementById('chat-channel-desc').textContent = 'Direct message';
  loadMessages(); closeSidebarMobile();
}

// ── Messages ──
function loadMessages() {
  if (unsubscribeMessages) unsubscribeMessages();
  document.getElementById('messages-list').innerHTML = '';
  const col = currentChannelType === 'room'
    ? db.collection('rooms').doc(currentChannel).collection('messages')
    : db.collection('dms').doc(currentChannel).collection('messages');
  unsubscribeMessages = col.orderBy('createdAt').limitToLast(100).onSnapshot(snap => {
    snap.docChanges().forEach(change => {
      if (change.type === 'added') { renderMessage(change.doc.id, change.doc.data()); scrollToBottom(); }
      if (change.type === 'removed') { const el = document.getElementById('msg-' + change.doc.id); if (el) el.remove(); }
    });
  });
}

function renderMessage(id, data) {
  const list = document.getElementById('messages-list');
  const isMine = data.uid === myUID;
  const div = document.createElement('div');
  div.className = `msg ${isMine ? 'msg-mine' : 'msg-other'}`;
  div.id = 'msg-' + id;
  const alias = data.alias || generateAlias(data.uid);
  const time = data.createdAt ? new Date(data.createdAt.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  let content = '';
  if (data.type === 'text') content = `<p class="msg-text">${escapeHTML(data.text)}</p>`;
  else if (data.type === 'image') content = `<img class="msg-image" src="${data.url}" onclick="previewImage('${data.url}')" loading="lazy"/>`;
  else if (data.type === 'voice') content = `<audio controls src="${data.url}" class="msg-audio"></audio>`;
  div.innerHTML = `<div class="msg-bubble">${!isMine ? `<span class="msg-alias">${alias}</span>` : ''}${content}<span class="msg-time">${time}</span></div>`;
  list.appendChild(div);
}

async function sendMessage() {
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = ''; autoResize(input);
  await postMessage({ type: 'text', text });
}

function handleEnter(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

async function postMessage(data) {
  const col = currentChannelType === 'room'
    ? db.collection('rooms').doc(currentChannel).collection('messages')
    : db.collection('dms').doc(currentChannel).collection('messages');
  await col.add({ ...data, uid: myUID, alias: myAlias, createdAt: firebase.firestore.FieldValue.serverTimestamp(), channel: currentChannel });
  if (currentChannelType === 'dm') {
    await db.collection('dms').doc(currentChannel).update({ lastAt: firebase.firestore.FieldValue.serverTimestamp() });
  }
}

// ── Image ──
function triggerImageUpload() { document.getElementById('image-file-input').click(); }
async function handleImageUpload(e) {
  const file = e.target.files[0]; if (!file) return;
  showToast('Uploading image...');
  const ref = storage.ref(`images/${myUID}_${Date.now()}`);
  await ref.put(file);
  const url = await ref.getDownloadURL();
  await postMessage({ type: 'image', url });
  e.target.value = '';
}
function previewImage(url) {
  document.getElementById('preview-img').src = url;
  document.getElementById('img-preview-modal').classList.remove('hidden');
}

// ── Voice ──
async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.start();
    document.getElementById('recording-indicator').classList.remove('hidden');
  } catch(e) { showToast('Microphone access denied'); }
}
async function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
  document.getElementById('recording-indicator').classList.add('hidden');
  mediaRecorder.stop();
  mediaRecorder.onstop = async () => {
    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    if (blob.size < 1000) return;
    showToast('Sending voice message...');
    const ref = storage.ref(`voice/${myUID}_${Date.now()}.webm`);
    await ref.put(blob);
    const url = await ref.getDownloadURL();
    await postMessage({ type: 'voice', url });
    mediaRecorder.stream.getTracks().forEach(t => t.stop());
  };
}

// ── Search ──
function toggleSearch() {
  const bar = document.getElementById('search-bar');
  bar.classList.toggle('hidden');
  if (!bar.classList.contains('hidden')) document.getElementById('search-input').focus();
}
function searchMessages() {
  const q = document.getElementById('search-input').value.toLowerCase();
  document.querySelectorAll('.msg').forEach(m => {
    const t = m.querySelector('.msg-text');
    m.style.display = (!t || t.textContent.toLowerCase().includes(q)) ? '' : 'none';
  });
}

// ── Helpers ──
function showScreen(n) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + n).classList.add('active');
}
function scrollToBottom() { const a = document.getElementById('messages-area'); a.scrollTop = a.scrollHeight; }
function autoResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; }
function showToast(msg) {
  const t = document.getElementById('toast'); t.textContent = msg;
  t.classList.remove('hidden'); clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.add('hidden'), 3000);
}
function escapeHTML(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('open'); }
function closeSidebarMobile() { if (window.innerWidth < 700) document.getElementById('sidebar').classList.remove('open'); }
