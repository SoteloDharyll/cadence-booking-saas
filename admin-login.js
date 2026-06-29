/* ===========================================================
   Admin Login Page Logic
   =========================================================== */

import { adminLogin, adminLogout, onAdminAuthReady } from "./admin-auth.js";

const $ = (sel) => document.querySelector(sel);

function showMessage(text) {
  const el = $("#authMessage");
  el.textContent = text;
  el.className = "auth-message error";
}

function setLoading(isLoading) {
  const btn = $("#adminLoginBtn");
  btn.disabled = isLoading;
  btn.textContent = isLoading ? "Signing in…" : "Sign In";
}

$("#adminLoginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!navigator.onLine) {
    showMessage("You're offline. Please reconnect to the internet to sign in.");
    return;
  }
  setLoading(true);
  try {
    await adminLogin($("#adminEmail").value, $("#adminPassword").value);
    // onAdminAuthReady below handles the redirect.
  } catch (err) {
    setLoading(false);
    if (err.message === "NOT_AN_ADMIN") {
      showMessage("This account doesn't have admin access.");
    } else if (err.message === "OFFLINE") {
      showMessage("You're offline. Please reconnect to the internet to sign in.");
    } else if (err.code === "auth/invalid-credential" || err.code === "auth/wrong-password" || err.code === "auth/user-not-found") {
      showMessage("Incorrect email or password.");
    } else {
      showMessage("Something went wrong signing in. Please try again.");
    }
  }
});

onAdminAuthReady({
  onSignedOut: () => setLoading(false),
  onAdmin: () => { window.location.href = "admin.html"; },
  onNotAdmin: async () => {
    await adminLogout();
    setLoading(false);
    showMessage("This account doesn't have admin access.");
  },
  onError: () => {
    setLoading(false);
    showMessage("Something went wrong. Please try again.");
  },
});
