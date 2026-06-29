/* ===========================================================
   Authentication + Subscription Gate
   -----------------------------------------------------------
   Responsibilities:
   1. Wrap Firebase Auth sign-in / sign-out.
   2. On every login AND every app startup (page load / refresh),
      look up the signed-in user's business record in Firestore
      and check subscriptionStatus + subscriptionExpiryDate.
   3. If the subscription is not active, lock the UI behind a
      full-screen message. Crucially, this NEVER deletes or
      touches bookings/therapists/customers/reports — it only
      hides the UI. The moment an admin reactivates the account,
      the same data is immediately visible again on next load.
   =========================================================== */

import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ----------------------------------------------------------
// Session state, populated once auth + business lookup resolve
// ----------------------------------------------------------
export const session = {
  user: null,        // Firebase Auth user object
  businessId: null,  // resolved from users/{uid}.businessId
  role: null,         // "owner" | "staff"
  business: null,     // the full business document (name, subscriptionStatus, ...)
};

/**
 * Computes whether a business's subscription currently grants access.
 * Treats a missing/invalid expiry date defensively as expired, since
 * "fail closed" is the safer default for a paid-access gate.
 */
export function isSubscriptionActive(business) {
  if (!business) return false;
  if (business.subscriptionStatus !== "active") return false;
  if (!business.subscriptionExpiryDate) return false;

  const expiry = business.subscriptionExpiryDate.toDate
    ? business.subscriptionExpiryDate.toDate()
    : new Date(business.subscriptionExpiryDate);

  return expiry.getTime() > Date.now();
}

/**
 * Looks up the signed-in user's link record (users/{uid}) and then
 * their business document. Throws a descriptive error if either is
 * missing, since both are required for the app to know what data
 * to show.
 */
async function loadUserAndBusiness(firebaseUser) {
  const userSnap = await getDoc(doc(db, "users", firebaseUser.uid));
  if (!userSnap.exists()) {
    throw new Error("NO_BUSINESS_LINK");
  }
  const userData = userSnap.data();

  const businessSnap = await getDoc(doc(db, "businesses", userData.businessId));
  if (!businessSnap.exists()) {
    throw new Error("BUSINESS_NOT_FOUND");
  }

  session.user = firebaseUser;
  session.businessId = userData.businessId;
  session.role = userData.role || "staff";
  session.business = businessSnap.data();

  return session;
}

export async function login(email, password) {
  if (!navigator.onLine) {
    throw new Error("OFFLINE");
  }
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  return loadUserAndBusiness(cred.user);
}

export async function logout() {
  await signOut(auth);
  session.user = null;
  session.businessId = null;
  session.role = null;
  session.business = null;
}

/**
 * Re-fetches the business doc fresh from the server (not cache) to
 * re-check subscription status. Call this on every app startup, and
 * optionally on an interval, so a subscription that expires (or gets
 * reactivated) while a tab is sitting open is caught without forcing
 * staff to manually refresh.
 */
export async function refreshSubscriptionStatus() {
  if (!session.businessId) return null;
  const businessSnap = await getDoc(doc(db, "businesses", session.businessId));
  if (!businessSnap.exists()) {
    throw new Error("BUSINESS_NOT_FOUND");
  }
  session.business = businessSnap.data();
  return session.business;
}

/**
 * Sets up the full startup flow: waits for Firebase Auth to resolve
 * the current user (handles page refresh), loads their business,
 * and invokes the appropriate callback. This is the single entry
 * point each protected page should call.
 */
export function onAuthReady({ onSignedOut, onActive, onExpired, onError }) {
  onAuthStateChanged(auth, async (firebaseUser) => {
    if (!firebaseUser) {
      onSignedOut();
      return;
    }
    try {
      await loadUserAndBusiness(firebaseUser);
      if (isSubscriptionActive(session.business)) {
        onActive(session);
      } else {
        onExpired(session);
      }
    } catch (err) {
      onError(err);
    }
  });
}
