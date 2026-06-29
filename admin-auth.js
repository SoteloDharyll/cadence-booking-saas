/* ===========================================================
   Super-Admin Authentication
   -----------------------------------------------------------
   Deliberately separate from auth.js (business staff auth).
   A signed-in Firebase user is only treated as a super-admin if
   their UID has a corresponding document in the top-level
   `admins` collection — see firestore.rules, which is the real
   enforcement point. This client-side check only controls what
   the admin UI *shows*; Firestore security rules are what
   actually prevent a non-admin from writing to other businesses'
   subscription data even if they bypass this page entirely.
   =========================================================== */

import { auth, db } from "../public/firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

export async function adminLogin(email, password) {
  if (!navigator.onLine) throw new Error("OFFLINE");
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  const adminSnap = await getDoc(doc(db, "admins", cred.user.uid));
  if (!adminSnap.exists()) {
    await signOut(auth);
    throw new Error("NOT_AN_ADMIN");
  }
  return cred.user;
}

export async function adminLogout() {
  await signOut(auth);
}

export function onAdminAuthReady({ onSignedOut, onAdmin, onNotAdmin, onError }) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      onSignedOut();
      return;
    }
    try {
      const adminSnap = await getDoc(doc(db, "admins", user.uid));
      if (adminSnap.exists()) {
        onAdmin(user, adminSnap.data());
      } else {
        onNotAdmin();
      }
    } catch (err) {
      onError(err);
    }
  });
}
