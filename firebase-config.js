/* ===========================================================
   Cadence — Firebase initialization
   -----------------------------------------------------------
   Fill in the values below with your own Firebase project's
   config (Firebase Console → Project Settings → General →
   "Your apps" → SDK setup and configuration → Config).

   This file is loaded by every page (login, app, admin) via
   <script type="module">, so it only needs to be edited once.
   =========================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  initializeFirestore,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ----------------------------------------------------------
// 🔧 REPLACE THESE VALUES with your Firebase project config
// ----------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyBNkLE7ZAR_iDCffhxBz6AfwzwiuDHgPf8",
  authDomain: "cadence-booking-saas.firebaseapp.com",
  projectId: "cadence-booking-saas",
  storageBucket: "cadence-booking-saas.firebasestorage.app",
  messagingSenderId: "789982631867",
  appId: "1:789982631867:web:a99c31b1f8398e77b1969e"
};

export const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
// Keep the user signed in across browser restarts on this device.
// (Combined with the online-only requirement, this just means staff
// don't have to log in every single time they open the app — the
// subscription + connectivity checks below still run on every load.)
setPersistence(auth, browserLocalPersistence).catch(() => {
  /* Persistence can fail in some private-browsing contexts; the app
     still works, staff just need to log in each session. */
});

// IMPORTANT: This app is intentionally ONLINE-ONLY. We do NOT enable
// Firestore's offline persistence cache. This is a deliberate product
// decision (see requirement #1) so that:
//   - Subscription status is always checked against the live server,
//     never a stale local cache, which would defeat the purpose of
//     being able to lock out an expired account.
//   - Staff at different terminals always see the true current
//     booking state, with no risk of two offline devices both
//     thinking the same therapist/time slot is free and creating a
//     conflicting double-booking once they reconnect.
export const db = initializeFirestore(app, {
  // localCache deliberately omitted — defaults to memory-only cache,
  // which is cleared on reload and never used while offline.
});
