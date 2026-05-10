// ╔══════════════════════════════════════════════════╗
// ║  REPLACE these values with your Firebase config  ║
// ║  Firebase Console → Project Settings → Your App  ║
// ╚══════════════════════════════════════════════════╝

const firebaseConfig = {
    apiKey: "AIzaSyDct_cguxkTdyx15mqNrOmHDtw4Kn6sVwo",
    authDomain: "anonchat-5f42b.firebaseapp.com",
    projectId: "anonchat-5f42b",
    storageBucket: "anonchat-5f42b.firebasestorage.app",
    messagingSenderId: "371969381542",
    appId: "1:371969381542:web:3b84d085f184928d4a9067",
    measurementId: "G-RQ4HW91Z4W"
  };

// Admin phone numbers (with country code, no spaces)
// These users get access to /admin/index.html
const ADMIN_PHONES = [
  "+918893572233"  // ← replace with your number
];

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();
