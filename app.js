// ══════════════════════════════════════════
//  AnonChat — app.js
// ══════════════════════════════════════════

let currentUser = null;        // Firebase user
let myAlias = '';              // e.g. Anon#4827
let myUID = '';
let currentChannel = 'general'; // room id or dm id
let currentChannelType = 'room'; // 'room' | 'dm'
let unsubscribeMessages = null;
let unsubscribeDMs = null;
let mediaRecorder = null;
let audioChunks = [];
let confirmationResult = null;
let appSettings = { groupChat: true, dmChat: true };

// ─── Aliases ─────────────────────────────
function generateAlias(uid) {
  const num = parseInt(uid.slice(-4), 16) % 9000 + 1000;
  return `Anon#${num}`;
}

// ─── OTP Flow ────────────────────────────
function sendOTP() {
  const cc = document.getElementById('country-code').value.trim();
  const ph = document.getElementById('phone-input').value.trim();
  if (!ph || ph.length < 8) return showToast('Enter a valid phone number');

  const fullPhone = cc + ph;
  showStep('loading');

  if (!window.recaptchaVerifier) {
    window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
      size: 'invisible',
      callback: () => {}
    });
  }

  auth.signInWithPhoneNumber(fullPhone, window.recaptchaVerifier)
    .then(result => {
      confirmationResult = result;
      showStep('otp');
      setupOTPInputs();
    })
    .catch(err => {
      showStep('phone');
      showToast('Failed to send OTP: ' + err.message);
    });
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
  if (code.length !== 6) return showToast('Enter the 6-digit OTP');
  showStep('loading');
  confirmationResult.confirm(code)
    .then(result => onSignedIn(result.user))
    .catch(() => { showStep('otp'); showToast('Invalid OTP. Try again.'); });
}

function backToPhone() { showStep('phone'); }

function showStep(name) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  document.getElementById('step-' + name).classList.add('active');
}

// ─── Auth State ──────────────────────────
auth.onAuthStateChanged(user => {
  if (user) { onSignedIn(user); }
  else { showScreen('verify'); }
});

async function onSignedIn(user) {
  currentUser = user;
  myUID = user.uid;
  myAlias = generateAlias(myUID);

  // Check if blocked
  const blockedDoc = await db.collection('blocked').doc(myUID).get();
  if (blockedDoc.exists) {
    showScreen('chat');
    document.getElementById('blocked-notice').classList.remove('hidden');
    document.getElementById('input-area').classList.add('hidden');
    document.getElementById('my-alias').textContent = myAlias;
    loadMessages();
    return;
  }

  // Store user presence
  await db.collection('users').doc(myUID).set({
    alias: myAlias,
    uid: myUID,
    phone: user.phoneNumber,
    lastSeen: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  // Load app settings
  const settingsDoc = await db.collection('settings').doc('app').get();
  if (settingsDoc.exists) appSettings = { ...appSettings, ...settingsDoc.data() };

  document.getElementById('my-alias').textContent = myAlias;
  showScreen('chat');
  applySettings();
  openRoom('general');
  loadDMList();
  watchSettings();
}

function applySettings() {
  document.getElementById('new-dm-btn').style.display = appSettings.dmChat ? '' : 'none';
  document.getElementById('dm-section').style.display = appSettings.dmChat ? '' : 'none';
}

function watchSettings() {
  db.collection('settings').doc('app').onSnapshot(snap => {
    if (snap.exists) {
      appSettings = { ...appSettings, ...snap.data() };
      applySettings();
    }
  });
}

function signOutUser() {
  auth.signOut().then(() => { location.reload(); });
}

// ─── Rooms ───────────────────────────────
function openRoom(roomId) {
  if (!appSettings.groupChat && roomId !== 'general') {
    showToast('Group chat is currently disabled by admin.');
    return;
  }
  currentChannel = roomId;
  currentChannelType = 'room';

  document.querySelectorAll('.room-item').forEach(r => r.classList.remove('active'));
  const el = document.querySelector(`[data-room="${roomId}"]`);
  if (el) el.classList.add('active');

  document.getElementById('chat-channel-name').textContent = '# ' + roomId;
  document.getElementById('chat-channel-desc').textContent = 'Public group chat';
  loadMessages();
  closeSidebarMobile();
}

// ─── DMs ─────────────────────────────────
function loadDMList() {
  if (unsubscribeDMs) unsubscribeDMs();
  const dmList = document.getElementById('dm-list');
  unsubscribeDMs = db.collection('dms')
    .where('members', 'array-contains', myUID)
    .orderBy('lastAt', 'desc')
    .onSnapshot(snap => {
      dmList.innerHTML = '';
      snap.forEach(doc => {
        const data = doc.data();
        const otherId = data.members.find(m => m !== myUID);
        const otherAlias = generateAlias(otherId);
        const div = document.createElement('div');
        div.className = 'room-item';
        div.dataset.dm = doc.id;
        div.innerHTML = `<span class="room-icon">@</span><span>${otherAlias}</span>`;
        div.onclick = () => openDM(doc.id, otherAlias);
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
    div.className = 'user-list-item';
    div.textContent = alias;
    div.onclick = () => startDM(doc.id, alias);
    content.appendChild(div);
  });
  if (!content.children.length) content.innerHTML = '<p style="opacity:.5;padding:1rem">No other users yet.</p>';
}

async function startDM(otherUID, otherAlias) {
  closeModal('user-list-modal');
  const dmId = [myUID, otherUID].sort().join('_');
  await db.collection('dms').doc(dmId).set({
    members: [myUID, otherUID],
    lastAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  openDM(dmId, otherAlias);
}

function openDM(dmId, otherAlias) {
  currentChannel = dmId;
  currentChannelType = 'dm';
  document.querySelectorAll('.room-item').forEach(r => r.classList.remove('active'));
  const el = document.querySelector(`[data-dm="${dmId}"]`);
  if (el) el.classList.add('active');
  document.getElementById('chat-channel-name').textContent = '@ ' + otherAlias;
  document.getElementById('chat-channel-desc').textContent = 'Direct message';
  loadMessages();
  closeSidebarMobile();
}

// ─── Messages ────────────────────────────
function loadMessages() {
  if (unsubscribeMessages) unsubscribeMessages();
  const list = document.getElementById('messages-list');
  list.innerHTML = '';

  const col = currentChannelType === 'room'
    ? db.collection('rooms').doc(currentChannel).collection('messages')
    : db.collection('dms').doc(currentChannel).collection('messages');

  unsubscribeMessages = col.orderBy('createdAt').limitToLast(100).onSnapshot(snap => {
    snap.docChanges().forEach(change => {
      if (change.type === 'added') {
        renderMessage(change.doc.id, change.doc.data());
        scrollToBottom();
      }
      if (change.type === 'removed') {
        const el = document.getElementById('msg-' + change.doc.id);
        if (el) el.remove();
      }
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
  if (data.type === 'text') {
    content = `<p class="msg-text">${escapeHTML(data.text)}</p>`;
  } else if (data.type === 'image') {
    content = `<img class="msg-image" src="${data.url}" onclick="previewImage('${data.url}')" loading="lazy"/>`;
  } else if (data.type === 'voice') {
    content = `<audio controls src="${data.url}" class="msg-audio"></audio>`;
  }

  div.innerHTML = `
    <div class="msg-bubble">
      ${!isMine ? `<span class="msg-alias">${alias}</span>` : ''}
      ${content}
      <span class="msg-time">${time}</span>
    </div>`;

  list.appendChild(div);
}

async function sendMessage() {
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  autoResize(input);
  await postMessage({ type: 'text', text });
}

function handleEnter(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

async function postMessage(data) {
  const col = currentChannelType === 'room'
    ? db.collection('rooms').doc(currentChannel).collection('messages')
    : db.collection('dms').doc(currentChannel).collection('messages');

  const msg = {
    ...data,
    uid: myUID,
    alias: myAlias,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    channel: currentChannel
  };
  await col.add(msg);

  if (currentChannelType === 'dm') {
    await db.collection('dms').doc(currentChannel).update({
      lastAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }
}

// ─── Image Upload ────────────────────────
function triggerImageUpload() {
  document.getElementById('image-file-input').click();
}

async function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
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

// ─── Voice Recording ─────────────────────
async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.start();
    document.getElementById('recording-indicator').classList.remove('hidden');
  } catch (e) {
    showToast('Microphone access denied');
  }
}

async function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
  document.getElementById('recording-indicator').classList.add('hidden');

  mediaRecorder.stop();
  mediaRecorder.onstop = async () => {
    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    if (blob.size < 1000) return; // too short
    showToast('Sending voice message...');
    const ref = storage.ref(`voice/${myUID}_${Date.now()}.webm`);
    await ref.put(blob);
    const url = await ref.getDownloadURL();
    await postMessage({ type: 'voice', url });
    mediaRecorder.stream.getTracks().forEach(t => t.stop());
  };
}

// ─── Search ──────────────────────────────
function toggleSearch() {
  const bar = document.getElementById('search-bar');
  bar.classList.toggle('hidden');
  if (!bar.classList.contains('hidden')) document.getElementById('search-input').focus();
}

function searchMessages() {
  const q = document.getElementById('search-input').value.toLowerCase();
  document.querySelectorAll('.msg').forEach(m => {
    const text = m.querySelector('.msg-text');
    if (!text) { m.style.display = ''; return; }
    m.style.display = text.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

// ─── UI Helpers ──────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
}

function scrollToBottom() {
  const area = document.getElementById('messages-area');
  area.scrollTop = area.scrollHeight;
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function showToast(msg, duration = 3000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), duration);
}

function escapeHTML(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

function closeSidebarMobile() {
  if (window.innerWidth < 700) document.getElementById('sidebar').classList.remove('open');
}
