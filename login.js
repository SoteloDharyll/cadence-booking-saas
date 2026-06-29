/* ===========================================================
   Login Page Logic
   =========================================================== */

import { login, logout, onAuthReady } from "./auth.js";
import { initOnlineGuard } from "./online-guard.js";

initOnlineGuard();

const $ = (sel) => document.querySelector(sel);

function showMessage(text, type = "error") {
  const el = $("#authMessage");
  el.textContent = text;
  el.className = `auth-message ${type}`;
}
function hideMessage() {
  $("#authMessage").classList.add("hidden");
}

function setLoading(isLoading) {
  const btn = $("#loginBtn");
  btn.disabled = isLoading;
  btn.textContent = isLoading ? "Signing in…" : "Sign In";
}

function showLockedOverlay(message) {
  $("#lockedMessage").textContent = message;
  $("#lockedOverlay").classList.remove("hidden");
}
function hideLockedOverlay() {
  $("#lockedOverlay").classList.add("hidden");
}

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  hideMessage();

  if (!navigator.onLine) {
    showMessage("You're offline. Please reconnect to the internet to sign in.");
    return;
  }

  const email = $("#loginEmail").value;
  const password = $("#loginPassword").value;
  setLoading(true);

  try {
    await login(email, password);
    // onAuthReady (registered below) will fire immediately after this
    // resolves and handle the active/expired routing — nothing else
    // to do here.
  } catch (err) {
    setLoading(false);
    showMessage(friendlyAuthError(err));
  }
});

$("#lockedLogoutBtn").addEventListener("click", async () => {
  await logout();
  hideLockedOverlay();
  setLoading(false);
});

function friendlyAuthError(err) {
  const code = err && err.code ? err.code : "";
  if (err.message === "OFFLINE") return "You're offline. Please reconnect to the internet to sign in.";
  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
    return "Incorrect email or password. Please try again.";
  }
  if (code === "auth/too-many-requests") {
    return "Too many attempts. Please wait a moment and try again.";
  }
  if (code === "auth/invalid-email") {
    return "Please enter a valid email address.";
  }
  if (err.message === "NO_BUSINESS_LINK" || err.message === "BUSINESS_NOT_FOUND") {
    return "This account isn't linked to a business yet. Please contact the administrator.";
  }
  return "Something went wrong signing in. Please try again.";
}

// ----------------------------------------------------------
// Auth state routing — runs on page load too, so a staff member
// who already has a session (browserLocalPersistence) gets routed
// straight to the app or the locked screen without re-entering
// credentials, while the subscription check still happens fresh
// against the server every time.
// ----------------------------------------------------------
onAuthReady({
  onSignedOut: () => {
    setLoading(false);
    // Already on the login page — nothing further to do.
  },
  onActive: () => {
    window.location.href = "index.html";
  },
  onExpired: (session) => {
    setLoading(false);
    const status = session.business.subscriptionStatus;
    if (status === "suspended") {
      showLockedOverlay("Your account has been suspended. Please contact the administrator for assistance.");
    } else {
      showLockedOverlay("Your subscription has expired. Please contact the administrator to renew.");
    }
  },
  onError: (err) => {
    setLoading(false);
    showMessage(friendlyAuthError(err));
  },
});
