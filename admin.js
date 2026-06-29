/* ===========================================================
   Admin Dashboard Logic
   -----------------------------------------------------------
   Reads/writes the top-level `businesses` collection directly.
   Security rules (see firestore.rules) restrict these writes to
   accounts present in the `admins` collection — this file's
   onAdminAuthReady check controls the UI, the rules control
   actual data access.
   =========================================================== */

import { db } from "../public/firebase-config.js";
import { onAdminAuthReady, adminLogout } from "./admin-auth.js";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  onSnapshot,
  getCountFromServer,
  Timestamp,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const $ = (sel) => document.querySelector(sel);

// ----------------------------------------------------------
// AUTH GATE
// ----------------------------------------------------------
onAdminAuthReady({
  onSignedOut: () => { window.location.href = "admin-login.html"; },
  onAdmin: (user) => {
    $("#appLoadingScreen").classList.add("hidden");
    $("#adminShell").classList.remove("hidden");
    $("#adminEmailBadge").textContent = user.email;
    startBusinessSync();
  },
  onNotAdmin: () => { window.location.href = "admin-login.html"; },
  onError: (err) => {
    console.error("Admin auth error:", err);
    showToast("Something went wrong loading the admin console.", "error");
  },
});

$("#adminSignOutBtn").addEventListener("click", async () => {
  await adminLogout();
  window.location.href = "admin-login.html";
});

// ----------------------------------------------------------
// TOASTS (lightweight copy of the staff app's toast system)
// ----------------------------------------------------------
function showToast(message, type = "success") {
  const root = $("#toastRoot");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity 0.25s";
    setTimeout(() => el.remove(), 250);
  }, 2800);
}

let confirmCallback = null;
function showConfirm(title, message, onConfirm) {
  $("#confirmTitle").textContent = title;
  $("#confirmMessage").textContent = message;
  confirmCallback = onConfirm;
  $("#confirmModal").classList.remove("hidden");
}
$("#confirmCancelBtn").addEventListener("click", () => { $("#confirmModal").classList.add("hidden"); confirmCallback = null; });
$("#confirmOkBtn").addEventListener("click", () => {
  if (confirmCallback) confirmCallback();
  $("#confirmModal").classList.add("hidden");
  confirmCallback = null;
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

// ----------------------------------------------------------
// LIVE BUSINESS LIST
// ----------------------------------------------------------
let businesses = [];

function startBusinessSync() {
  onSnapshot(
    collection(db, "businesses"),
    (snap) => {
      businesses = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderAll();
    },
    (err) => {
      console.error("Business sync error:", err);
      showToast("Couldn't load businesses. Check your connection.", "error");
    }
  );
}

function expiryDate(business) {
  if (!business.subscriptionExpiryDate) return null;
  return business.subscriptionExpiryDate.toDate
    ? business.subscriptionExpiryDate.toDate()
    : new Date(business.subscriptionExpiryDate);
}

function effectiveStatus(business) {
  // Shows "expired" in the table the moment the date has passed,
  // even if subscriptionStatus in Firestore still literally says
  // "active" — this matches what the staff app itself will enforce
  // (see auth.js isSubscriptionActive), so the admin view never
  // looks more optimistic than what staff actually experience.
  if (business.subscriptionStatus === "suspended") return "suspended";
  const expiry = expiryDate(business);
  if (!expiry || expiry.getTime() <= Date.now()) return "expired";
  return "active";
}

function formatDate(d) {
  if (!d) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function renderAll() {
  renderStats();
  renderTable();
}

function renderStats() {
  const total = businesses.length;
  let active = 0, expired = 0, suspended = 0;
  businesses.forEach((b) => {
    const s = effectiveStatus(b);
    if (s === "active") active++;
    else if (s === "expired") expired++;
    else if (s === "suspended") suspended++;
  });
  $("#adminStatTotal").textContent = total;
  $("#adminStatActive").textContent = active;
  $("#adminStatExpired").textContent = expired;
  $("#adminStatSuspended").textContent = suspended;
  $("#bizCount").textContent = `${total} business${total !== 1 ? "es" : ""}`;
}

async function fetchSubcollectionCounts(businessId) {
  try {
    const [therapistsCount, bookingsCount] = await Promise.all([
      getCountFromServer(collection(db, "businesses", businessId, "therapists")),
      getCountFromServer(collection(db, "businesses", businessId, "bookings")),
    ]);
    return { therapists: therapistsCount.data().count, bookings: bookingsCount.data().count };
  } catch (err) {
    console.error("Count fetch failed for", businessId, err);
    return { therapists: "—", bookings: "—" };
  }
}

async function renderTable() {
  const tbody = $("#businessTableBody");
  if (!businesses.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--slate-gray); padding:32px;">No businesses yet — add one above.</td></tr>`;
    return;
  }

  tbody.innerHTML = businesses.map((b) => buildRowHtml(b)).join("");

  // Wire up row actions
  businesses.forEach((b) => wireRowActions(b));

  // Fill in subcollection counts asynchronously (don't block the
  // initial table paint on these extra reads).
  businesses.forEach(async (b) => {
    const counts = await fetchSubcollectionCounts(b.id);
    const row = document.querySelector(`tr[data-biz-id="${b.id}"]`);
    if (!row) return;
    row.querySelector(".cell-therapists").textContent = counts.therapists;
    row.querySelector(".cell-bookings").textContent = counts.bookings;
  });
}

function buildRowHtml(b) {
  const status = effectiveStatus(b);
  const expiry = expiryDate(b);
  const expiryInputValue = expiry ? toDateInputValue(expiry) : "";
  const branding = b.branding || {};
  const primary = branding.primaryColor || "#4B5563";
  const secondary = branding.secondaryColor || "#9CA3AF";

  return `
    <tr data-biz-id="${b.id}">
      <td>
        <div class="biz-name">${escapeHtml(b.name || "(unnamed business)")}</div>
        ${b.ownerEmail ? `<div class="biz-email">${escapeHtml(b.ownerEmail)}</div>` : ""}
      </td>
      <td><span class="sub-status-pill ${status}">${status}</span></td>
      <td>
        <input type="date" class="admin-date-input" data-action="expiry" value="${expiryInputValue}">
      </td>
      <td class="cell-therapists">…</td>
      <td class="cell-bookings">…</td>
      <td>
        <div class="brand-swatch-row" title="Primary / secondary color">
          <span class="brand-swatch" style="background:${escapeHtml(primary)}"></span>
          <span class="brand-swatch" style="background:${escapeHtml(secondary)}"></span>
          <button class="btn btn-ghost btn-sm" data-action="edit-branding">Edit</button>
        </div>
      </td>
      <td>
        <div class="admin-row-actions">
          ${status !== "active" ? `<button class="btn btn-secondary btn-sm" data-action="activate">Activate</button>` : ""}
          ${status !== "suspended" ? `<button class="btn btn-ghost btn-sm" data-action="suspend">Suspend</button>` : ""}
        </div>
      </td>
    </tr>
  `;
}

function toDateInputValue(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function wireRowActions(business) {
  const row = document.querySelector(`tr[data-biz-id="${business.id}"]`);
  if (!row) return;

  const dateInput = row.querySelector('[data-action="expiry"]');
  dateInput.addEventListener("change", async () => {
    const newDate = dateInput.value ? new Date(dateInput.value + "T23:59:59") : null;
    try {
      await updateDoc(doc(db, "businesses", business.id), {
        subscriptionExpiryDate: newDate ? Timestamp.fromDate(newDate) : null,
      });
      showToast(`Expiry date updated for ${business.name}.`, "success");
    } catch (err) {
      console.error("Failed to update expiry date:", err);
      showToast("Couldn't update the expiry date. Check your connection.", "error");
    }
  });

  const activateBtn = row.querySelector('[data-action="activate"]');
  if (activateBtn) {
    activateBtn.addEventListener("click", () => {
      showConfirm(
        "Activate this business?",
        `${business.name} will immediately regain full access to their booking data.`,
        async () => {
          try {
            await updateDoc(doc(db, "businesses", business.id), { subscriptionStatus: "active" });
            showToast(`${business.name} activated.`, "success");
          } catch (err) {
            console.error("Failed to activate:", err);
            showToast("Couldn't activate this business. Check your connection.", "error");
          }
        }
      );
    });
  }

  const suspendBtn = row.querySelector('[data-action="suspend"]');
  if (suspendBtn) {
    suspendBtn.addEventListener("click", () => {
      showConfirm(
        "Suspend this business?",
        `${business.name} will be immediately locked out of the app. Their bookings, therapists, and customer data will NOT be deleted, and will be accessible again the moment you reactivate them.`,
        async () => {
          try {
            await updateDoc(doc(db, "businesses", business.id), { subscriptionStatus: "suspended" });
            showToast(`${business.name} suspended.`, "success");
          } catch (err) {
            console.error("Failed to suspend:", err);
            showToast("Couldn't suspend this business. Check your connection.", "error");
          }
        }
      );
    });
  }

  const editBrandingBtn = row.querySelector('[data-action="edit-branding"]');
  if (editBrandingBtn) {
    editBrandingBtn.addEventListener("click", () => openBrandingModal(business));
  }
}

// ----------------------------------------------------------
// EDIT BRANDING MODAL
// ----------------------------------------------------------
function openBrandingModal(business) {
  const branding = business.branding || {};
  $("#brandingModalTitle").textContent = `Edit branding — ${business.name}`;
  $("#brandingBizId").value = business.id;
  $("#brandLogoUrl").value = branding.logoUrl || "";
  $("#brandPrimaryColor").value = branding.primaryColor || "#4B5563";
  $("#brandSecondaryColor").value = branding.secondaryColor || "#9CA3AF";
  $("#brandAddress").value = branding.address || "";
  $("#brandPhone").value = branding.contactPhone || "";
  $("#brandContactEmail").value = branding.contactEmail || "";
  $("#brandingModal").classList.remove("hidden");
}
$("#closeBrandingModal").addEventListener("click", () => $("#brandingModal").classList.add("hidden"));
$("#cancelBrandingFormBtn").addEventListener("click", () => $("#brandingModal").classList.add("hidden"));

$("#brandingForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const bizId = $("#brandingBizId").value;
  const branding = {
    logoUrl: $("#brandLogoUrl").value.trim() || null,
    primaryColor: $("#brandPrimaryColor").value,
    secondaryColor: $("#brandSecondaryColor").value,
    address: $("#brandAddress").value.trim() || null,
    contactPhone: $("#brandPhone").value.trim() || null,
    contactEmail: $("#brandContactEmail").value.trim() || null,
  };

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    await updateDoc(doc(db, "businesses", bizId), { branding });
    $("#brandingModal").classList.add("hidden");
    showToast("Branding updated.", "success");
  } catch (err) {
    console.error("Failed to update branding:", err);
    showToast("Couldn't update branding. Check your connection and try again.", "error");
  } finally {
    submitBtn.disabled = false;
  }
});

// ----------------------------------------------------------
// ADD BUSINESS FORM
// ----------------------------------------------------------
$("#addBusinessForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#newBizName").value.trim();
  const ownerEmail = $("#newBizEmail").value.trim();
  const status = $("#newBizStatus").value;
  const expiryStr = $("#newBizExpiry").value;

  if (!name || !expiryStr) {
    showToast("Please fill in the business name and expiry date.", "error");
    return;
  }

  const branding = {
    logoUrl: $("#newBizLogoUrl").value.trim() || null,
    primaryColor: $("#newBizPrimaryColor").value,
    secondaryColor: $("#newBizSecondaryColor").value,
    address: $("#newBizAddress").value.trim() || null,
    contactPhone: $("#newBizPhone").value.trim() || null,
    contactEmail: $("#newBizContactEmail").value.trim() || null,
  };

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  try {
    await addDoc(collection(db, "businesses"), {
      name,
      ownerEmail: ownerEmail || null,
      subscriptionStatus: status,
      subscriptionExpiryDate: Timestamp.fromDate(new Date(expiryStr + "T23:59:59")),
      branding,
      createdAt: serverTimestamp(),
    });
    showToast(`${name} added. Don't forget to create their staff login — see SETUP.md.`, "success");
    e.target.reset();
  } catch (err) {
    console.error("Failed to add business:", err);
    showToast("Couldn't add the business. Check your connection and try again.", "error");
  } finally {
    submitBtn.disabled = false;
  }
});
