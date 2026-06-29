/* ===========================================================
   Cadence — Booking Management SaaS
   Vanilla JS, Firebase Auth + Firestore backed, online-only
   =========================================================== */

import { session, onAuthReady, refreshSubscriptionStatus, isSubscriptionActive, logout } from "./auth.js";
import { initOnlineGuard } from "./online-guard.js";
import {
  subscribeBookings,
  subscribeTherapists,
  createBooking,
  updateBooking,
  setBookingStatus,
  createTherapist,
  updateTherapist,
  deleteTherapist,
} from "./data-service.js";

(function () {
  "use strict";

  // ----------------------------------------------------------
  // DOM SHORTCUTS
  // ----------------------------------------------------------
  // Defined first since the auth/subscription gate below (which
  // runs before the rest of the app) uses these immediately inside
  // its callbacks.
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  initOnlineGuard();

  // ----------------------------------------------------------
  // LIVE STATE
  // ----------------------------------------------------------
  // These arrays mirror Firestore in real time via onSnapshot
  // listeners (see startLiveSync below). Every read in the
  // rendering code below works exactly like the original
  // localStorage version — only how these arrays get populated
  // has changed.
  let bookings = [];
  let therapists = [];
  let unsubscribeBookings = null;
  let unsubscribeTherapists = null;

  // ----------------------------------------------------------
  // AUTH + SUBSCRIPTION GATE
  // ----------------------------------------------------------
  // This is the central control point satisfying requirement #4:
  // every login AND every app startup re-checks the live
  // subscription status from Firestore before any booking data
  // is shown. If expired/suspended, the UI is fully replaced by
  // a lock screen — nothing is deleted, nothing is rendered.
  function showLoadingScreen(show) {
    $("#appLoadingScreen").classList.toggle("hidden", !show);
  }

  function showLockedOverlay(message) {
    stopLiveSync();
    $("#lockedMessage").textContent = message;
    $("#lockedOverlay").classList.remove("hidden");
    document.querySelector(".app-shell").classList.add("hidden");
  }
  function hideLockedOverlay() {
    $("#lockedOverlay").classList.add("hidden");
    document.querySelector(".app-shell").classList.remove("hidden");
  }

  function applyBusinessBranding() {

    console.log("SESSION BUSINESS:", session.business);
    const business = session.business || {};
    const branding = business.branding || {};
    const name = business.name || "Your Business";

    $("#businessNameLabel").textContent = name;
    $("#businessNameLabelMobile").textContent = name;
    $("#printBusinessName").textContent = name;

    // ---- Logo ----
    // Falls back to the platform mark if a tenant hasn't set a logo yet,
    // so a brand-new business never shows a broken image.
    const logoSrc = branding.logoUrl || "assets/platform/icon-512.png";
    $("#tenantLogoImg").src = logoSrc;
    $("#tenantLogoImgMobile").src = logoSrc;
    $("#printLogoImg").src = logoSrc;

    // ---- Colors ----
    // Tenants set ONE primary + ONE secondary color (the simplest thing
    // to ask a non-technical business owner for). We derive the deeper
    // and lighter shades the UI actually needs (button gradients, hover
    // states, soft badge backgrounds) from those two via HSL lightness
    // shifts, rather than asking for four separate color pickers.
    const primary = isValidHex(branding.primaryColor) ? branding.primaryColor : "#4B5563";
    const secondary = isValidHex(branding.secondaryColor) ? branding.secondaryColor : "#9CA3AF";

    const root = document.documentElement.style;
    root.setProperty("--tenant-primary", primary);
    root.setProperty("--tenant-primary-deep", shiftLightness(primary, -14));
    root.setProperty("--tenant-primary-light", tintTowardWhite(primary, 0.85));
    root.setProperty("--tenant-secondary", secondary);

    // ---- Address / contact (shown on printed schedules) ----
    const contactParts = [branding.address, branding.contactPhone, branding.contactEmail].filter(Boolean);
    $("#printBusinessContact").textContent = contactParts.join("  ·  ");
  }

  function isValidHex(value) {
    return typeof value === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
  }

  // Lightens (positive amount) or darkens (negative amount) a hex color
  // by shifting its HSL lightness, clamped to [0,100]. Kept dependency-free
  // since this is the only place color math is needed.
  function shiftLightness(hex, amount) {
    const { h, s, l } = hexToHsl(hex);
    const newL = Math.max(0, Math.min(100, l + amount));
    return hslToHex(h, s, newL);
  }

  // Produces a soft pastel tint for badge/card backgrounds by mixing the
  // color toward white in RGB space (not just raising HSL lightness),
  // since a pure lightness shift keeps the color too saturated/vivid to
  // use as a background — a real "light" UI tint also desaturates as it
  // brightens, the same way a designer would eyeball a tint swatch.
  // `ratio` of 0 = original color, 1 = pure white.
  function tintTowardWhite(hex, ratio) {
    let h = hex.replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const mix = (channel) => Math.round(channel + (255 - channel) * ratio);
    const toHex = (v) => v.toString(16).padStart(2, "0");
    return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
  }

  function hexToHsl(hex) {
    let h = hex.replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let hue = 0, sat = 0;
    const light = (max + min) / 2;
    const delta = max - min;
    if (delta !== 0) {
      sat = delta / (1 - Math.abs(2 * light - 1));
      switch (max) {
        case r: hue = ((g - b) / delta) % 6; break;
        case g: hue = (b - r) / delta + 2; break;
        case b: hue = (r - g) / delta + 4; break;
      }
      hue *= 60;
      if (hue < 0) hue += 360;
    }
    return { h: hue, s: sat * 100, l: light * 100 };
  }

  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }
    const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  function startLiveSync() {
    stopLiveSync(); // guard against double-subscribing
    unsubscribeBookings = subscribeBookings(
      (data) => { bookings = data; refreshCurrentView(); },
      (err) => handleSyncError("Bookings", err)
    );
    unsubscribeTherapists = subscribeTherapists(
      (data) => { therapists = data; refreshCurrentView(); },
      (err) => handleSyncError("Therapists", err)
    );
  }

  // A live listener can fail for two very different reasons, and the
  // person should see a different message for each:
  //   1. Security rules just revoked access (subscription expired or
  //      was suspended while this tab was open) — show the proper
  //      lock screen immediately, with the real reason, rather than
  //      a generic "check your connection" toast that would send
  //      someone on a pointless networking goose chase.
  //   2. An actual transient network/connection error — show the
  //      lightweight toast as before.
  async function handleSyncError(label, err) {
    console.error(`${label} sync error:`, err);
    if (err && err.code === "permission-denied") {
      try {
        const business = await refreshSubscriptionStatus();
        applyBusinessBranding();
        showLockedOverlay(lockMessageFor(business));
      } catch (innerErr) {
        // Even the re-check failed (e.g. business doc itself removed) —
        // fall back to a generic lock message rather than leaving the
        // person looking at a half-broken screen with no explanation.
        showLockedOverlay("We couldn't verify your subscription. Please contact the administrator.");
      }
      return;
    }
    showToast(`Couldn't sync ${label.toLowerCase()}. Check your connection.`, "error");
  }

  function stopLiveSync() {
    if (unsubscribeBookings) { unsubscribeBookings(); unsubscribeBookings = null; }
    if (unsubscribeTherapists) { unsubscribeTherapists(); unsubscribeTherapists = null; }
    bookings = [];
    therapists = [];
  }

  function lockMessageFor(business) {
    if (business.subscriptionStatus === "suspended") {
      return "Your account has been suspended. Please contact the administrator for assistance.";
    }
    return "Your subscription has expired. Please contact the administrator to renew.";
  }

  onAuthReady({
    onSignedOut: () => {
      window.location.href = "login.html";
    },
    onActive: () => {
      showLoadingScreen(false);
      hideLockedOverlay();
      applyBusinessBranding();
      startLiveSync();
      init();
    },
    onExpired: (s) => {
      showLoadingScreen(false);
      applyBusinessBranding();
      showLockedOverlay(lockMessageFor(s.business));
    },
    onError: (err) => {
      showLoadingScreen(false);
      console.error("Auth/business load error:", err);
      showLockedOverlay("We couldn't load your account. Please contact the administrator.");
    },
  });

  // Re-check subscription status periodically while the app is open,
  // so an expiry (or reactivation) that happens mid-session is caught
  // without forcing staff to manually reload the page. This re-reads
  // from the live server every time — never a cache.
  const SUBSCRIPTION_RECHECK_MS = 5 * 60 * 1000; // every 5 minutes
  setInterval(async () => {
    if (!session.businessId || !navigator.onLine) return;
    try {
      const business = await refreshSubscriptionStatus();
      applyBusinessBranding();
      if (!isSubscriptionActive(business)) {
        showLockedOverlay(lockMessageFor(business));
      }
    } catch (err) {
      console.error("Subscription re-check failed:", err);
    }
  }, SUBSCRIPTION_RECHECK_MS);

  // Also re-check immediately whenever the tab regains focus/visibility —
  // catches the common case of an admin reactivating/suspending an
  // account while the staff member's laptop was simply asleep or the
  // tab was backgrounded.
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible") return;
    if (!session.businessId || !navigator.onLine) return;
    try {
      const business = await refreshSubscriptionStatus();
      applyBusinessBranding();
      if (isSubscriptionActive(business)) {
        hideLockedOverlay();
        if (!unsubscribeBookings) startLiveSync();
      } else {
        showLockedOverlay(lockMessageFor(business));
      }
    } catch (err) {
      console.error("Subscription re-check failed:", err);
    }
  });

  function wireSignOutButtons() {
    const handler = async () => {
      stopLiveSync();
      await logout();
      window.location.href = "login.html";
    };
    $("#signOutBtn").addEventListener("click", handler);
    $("#signOutBtnMobile").addEventListener("click", handler);
    $("#lockedLogoutBtn").addEventListener("click", handler);
  }

  // ----------------------------------------------------------
  // DATE / TIME HELPERS
  // ----------------------------------------------------------
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function pad(n) { return n.toString().padStart(2, "0"); }

  function timeToMinutes(t) {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  }
  function minutesToLabel(mins) {
    let h = Math.floor(mins / 60);
    const m = mins % 60;
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12; if (h === 0) h = 12;
    return `${h}:${pad(m)} ${ampm}`;
  }
  function formatDateLabel(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }
  function bookingEndMinutes(b) { return timeToMinutes(b.startTime) + Number(b.duration); }

  function nowMinutes() {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  // ----------------------------------------------------------
  // CORE CONFLICT LOGIC
  // ----------------------------------------------------------

  // Returns active (non-cancelled) bookings for a given date that involve a given therapist id
  function bookingsForTherapistOnDate(therapistId, dateStr, excludeBookingId) {
    return bookings.filter(b =>
      b.date === dateStr &&
      b.status !== "cancelled" &&
      b.id !== excludeBookingId &&
      b.therapistIds.includes(therapistId)
    );
  }

  function rangesOverlap(startA, endA, startB, endB) {
    return startA < endB && startB < endA;
  }

  // Check whether a specific therapist is free for [startTime, startTime+duration) on dateStr
  function isTherapistFree(therapistId, dateStr, startTime, duration, excludeBookingId) {
    const newStart = timeToMinutes(startTime);
    const newEnd = newStart + Number(duration);
    const existing = bookingsForTherapistOnDate(therapistId, dateStr, excludeBookingId);
    for (const b of existing) {
      const bStart = timeToMinutes(b.startTime);
      const bEnd = bookingEndMinutes(b);
      if (rangesOverlap(newStart, newEnd, bStart, bEnd)) {
        return { free: false, conflictWith: b, bStart, bEnd };
      }
    }
    return { free: true };
  }

  // Validate a full booking attempt: returns { ok: true } or { ok: false, message }
  function validateBooking({ date, startTime, duration, therapistIds, excludeBookingId }) {
    if (!therapistIds.length) {
      return { ok: false, message: "Please select at least one therapist for this booking." };
    }

    // Check each selected therapist isn't off-duty/on-leave
    for (const tid of therapistIds) {
      const t = therapists.find(x => x.id === tid);
      if (!t) continue;
      if (t.status !== "available") {
        return { ok: false, message: `${t.name} is currently marked as ${t.status === "off-duty" ? "Off Duty" : "On Leave"} and cannot be assigned to bookings.` };
      }
    }

    // Check per-therapist double-booking / overlap
    for (const tid of therapistIds) {
      const t = therapists.find(x => x.id === tid);
      const result = isTherapistFree(tid, date, startTime, duration, excludeBookingId);
      if (!result.free) {
        const name = t ? t.name : "This therapist";
        const range = `${minutesToLabel(result.bStart)} to ${minutesToLabel(result.bEnd)}`;
        return {
          ok: false,
          message: `Booking conflict detected. Therapist ${name} is already assigned from ${range}.`
        };
      }
    }

    // Check total available therapist capacity isn't exceeded at any overlapping moment
    // (covers the case of requiring 2 therapists when only 1 is free overall)
    const availableTherapists = therapists.filter(t => t.status === "available");
    if (therapistIds.length > availableTherapists.length) {
      return { ok: false, message: "Not enough available therapists for this schedule." };
    }

    return { ok: true };
  }

  // ----------------------------------------------------------
  // TOASTS
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
    }, 2600);
  }

  // ----------------------------------------------------------
  // MODAL HELPERS
  // ----------------------------------------------------------
  function openModal(id) { $(id).classList.remove("hidden"); }
  function closeModal(id) { $(id).classList.add("hidden"); }

  function showConflictModal(message) {
    $("#conflictMessage").textContent = message;
    openModal("#conflictModal");
  }
  $("#conflictOkBtn").addEventListener("click", () => closeModal("#conflictModal"));

  let confirmCallback = null;
  function showConfirm(title, message, onConfirm) {
    $("#confirmTitle").textContent = title;
    $("#confirmMessage").textContent = message;
    confirmCallback = onConfirm;
    openModal("#confirmModal");
  }
  $("#confirmCancelBtn").addEventListener("click", () => { closeModal("#confirmModal"); confirmCallback = null; });
  $("#confirmOkBtn").addEventListener("click", () => {
    if (confirmCallback) confirmCallback();
    closeModal("#confirmModal");
    confirmCallback = null;
  });

  // ----------------------------------------------------------
  // NAVIGATION
  // ----------------------------------------------------------
  function switchView(viewName) {
    $$(".view").forEach(v => v.classList.remove("active"));
    $(`#view-${viewName}`).classList.add("active");
    $$(".rail-link").forEach(l => l.classList.toggle("active", l.dataset.view === viewName));
    $$(".bottom-link[data-view]").forEach(l => l.classList.toggle("active", l.dataset.view === viewName));
    if (viewName === "dashboard") renderDashboard();
    if (viewName === "bookings") renderBookingsList();
    if (viewName === "schedule") renderScheduleView();
    if (viewName === "therapists") renderTherapistsView();
  }

  $$(".rail-link, .bottom-link[data-view]").forEach(btn => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });

  // ----------------------------------------------------------
  // DASHBOARD RENDERING
  // ----------------------------------------------------------
  function renderDashboard() {
    const today = todayStr();
    $("#todayDateLabel").textContent = formatDateLabel(today);

    const todaysBookings = bookings.filter(b => b.date === today && b.status !== "cancelled");
    $("#statTotal").textContent = todaysBookings.length;

    const now = nowMinutes();
    const occupiedIds = new Set();
    todaysBookings.forEach(b => {
      const s = timeToMinutes(b.startTime), e = bookingEndMinutes(b);
      if (now >= s && now < e && b.status !== "completed") {
        b.therapistIds.forEach(id => occupiedIds.add(id));
      }
    });

    const availableCount = therapists.filter(t => t.status === "available" && !occupiedIds.has(t.id)).length;
    const offDutyCount = therapists.filter(t => t.status !== "available").length;

    $("#statAvailable").textContent = availableCount;
    $("#statOccupied").textContent = occupiedIds.size;
    $("#statOffDuty").textContent = offDutyCount;

    renderRhythmChart(today);

    $("#dashBookingCount").textContent = `${todaysBookings.length} booking${todaysBookings.length !== 1 ? "s" : ""}`;
    renderBookingList($("#dashBookingList"), sortByTime(todaysBookings.filter(b => b.status !== "cancelled")));
  }

  function sortByTime(list) {
    return [...list].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
  }

  // Signature element: hour-by-hour rhythm strip per therapist, 8AM-9PM
  function renderRhythmChart(dateStr) {
    const container = $("#rhythmChart");
    container.innerHTML = "";

    const DAY_START = 8 * 60;   // 8 AM
    const DAY_END = 21 * 60;    // 9 PM
    const totalSpan = DAY_END - DAY_START;

    if (!therapists.length) {
      container.innerHTML = `<p class="rhythm-empty">No therapists added yet. Add your team in the Therapists tab.</p>`;
      return;
    }

    const isToday = dateStr === todayStr();
    const now = nowMinutes();

    therapists.forEach(t => {
      const row = document.createElement("div");
      row.className = "rhythm-row" + (t.status !== "available" ? " offduty" : "");

      const name = document.createElement("div");
      name.className = "rhythm-name";
      name.textContent = t.name;
      row.appendChild(name);

      const track = document.createElement("div");
      track.className = "rhythm-track";

      if (t.status === "available") {
        const dayBookings = bookings.filter(b => b.date === dateStr && b.status !== "cancelled" && b.therapistIds.includes(t.id));
        dayBookings.forEach(b => {
          const s = Math.max(timeToMinutes(b.startTime), DAY_START);
          const e = Math.min(bookingEndMinutes(b), DAY_END);
          if (e <= s) return;
          const left = ((s - DAY_START) / totalSpan) * 100;
          const width = ((e - s) / totalSpan) * 100;
          const block = document.createElement("div");
          block.className = "rhythm-block" + (b.status === "completed" ? " completed" : "");
          block.style.left = left + "%";
          block.style.width = Math.max(width, 1.5) + "%";
          block.title = `${b.customerName} · ${minutesToLabel(timeToMinutes(b.startTime))}–${minutesToLabel(bookingEndMinutes(b))}`;
          track.appendChild(block);
        });

        if (isToday && now >= DAY_START && now <= DAY_END) {
          const nowLine = document.createElement("div");
          nowLine.className = "rhythm-now-line";
          nowLine.style.left = (((now - DAY_START) / totalSpan) * 100) + "%";
          track.appendChild(nowLine);
        }
      }

      row.appendChild(track);
      container.appendChild(row);
    });
  }

  // ----------------------------------------------------------
  // BOOKING LIST RENDERING (shared by dashboard / list / schedule)
  // ----------------------------------------------------------
  function renderBookingList(container, list) {
    container.innerHTML = "";
    if (!list.length) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">🪷</span>
          <p>No bookings here yet. Tap "New Booking" to encode an appointment.</p>
        </div>`;
      return;
    }
    list.forEach(b => container.appendChild(buildBookingCard(b)));
  }

  function buildBookingCard(b) {
    const card = document.createElement("div");
    card.className = `booking-card status-${b.status}`;
    card.dataset.id = b.id;

    const therapistNames = b.therapistIds
      .map(id => (therapists.find(t => t.id === id) || {}).name || "Unassigned")
      .join(" & ");

    card.innerHTML = `
      <div class="booking-time">
        <span>${minutesToLabel(timeToMinutes(b.startTime))}</span>
        <span class="dur">${b.duration} min</span>
      </div>
      <div class="booking-main">
        <div class="booking-customer">${escapeHtml(b.customerName)}</div>
        <div class="booking-meta">${escapeHtml(b.serviceType)} · ${escapeHtml(b.contactNumber)}</div>
        <div class="booking-therapists">${escapeHtml(therapistNames)}</div>
      </div>
      <span class="status-pill ${b.status}">${b.status}</span>
    `;
    card.addEventListener("click", () => openDetailModal(b.id));
    return card;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  // ----------------------------------------------------------
  // BOOKINGS VIEW (search / filter / export / print)
  // ----------------------------------------------------------
  function renderBookingsList() {
    populateTherapistFilterOptions();
    applyBookingsFilters();
  }

  function populateTherapistFilterOptions() {
    const sel = $("#filterTherapist");
    const current = sel.value;
    sel.innerHTML = `<option value="">All therapists</option>` +
      therapists.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");
    sel.value = current;
  }

  function applyBookingsFilters() {
    const q = $("#searchInput").value.trim().toLowerCase();
    const dateFilter = $("#filterDate").value;
    const therapistFilter = $("#filterTherapist").value;
    const statusFilter = $("#filterStatus").value;

    let list = bookings.filter(b => {
      if (q && !(b.customerName.toLowerCase().includes(q) || b.contactNumber.toLowerCase().includes(q))) return false;
      if (dateFilter && b.date !== dateFilter) return false;
      if (therapistFilter && !b.therapistIds.includes(therapistFilter)) return false;
      if (statusFilter && b.status !== statusFilter) return false;
      return true;
    });

    list = [...list].sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
    renderBookingList($("#allBookingList"), list);
  }

  ["input", "change"].forEach(evt => {
    $("#searchInput").addEventListener(evt, applyBookingsFilters);
    $("#filterDate").addEventListener(evt, applyBookingsFilters);
    $("#filterTherapist").addEventListener(evt, applyBookingsFilters);
    $("#filterStatus").addEventListener(evt, applyBookingsFilters);
  });

  $("#clearFiltersBtn").addEventListener("click", () => {
    $("#searchInput").value = "";
    $("#filterDate").value = "";
    $("#filterTherapist").value = "";
    $("#filterStatus").value = "";
    applyBookingsFilters();
  });

  $("#exportCsvBtn").addEventListener("click", exportBookingsCsv);
  $("#printScheduleBtn").addEventListener("click", () => {
    switchView("schedule");
    setTimeout(() => window.print(), 150);
  });

  function exportBookingsCsv() {
    const header = ["Date", "Start Time", "Duration (min)", "Customer Name", "Contact Number", "Service", "Therapists", "Status", "Notes"];
    const rows = bookings.map(b => {
      const tNames = b.therapistIds.map(id => (therapists.find(t => t.id === id) || {}).name || "").join(" & ");
      return [b.date, b.startTime, b.duration, b.customerName, b.contactNumber, b.serviceType, tNames, b.status, b.notes || ""]
        .map(csvEscape).join(",");
    });
    const csv = [header.map(csvEscape).join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugify((session.business && session.business.name) || "spa")}-bookings-${todayStr()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Bookings exported to CSV.", "success");
  }
  function csvEscape(val) {
    const s = String(val == null ? "" : val);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }
  function slugify(str) {
    return String(str).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "spa";
  }

  // ----------------------------------------------------------
  // SCHEDULE VIEW
  // ----------------------------------------------------------
  function renderScheduleView() {
    if (!$("#scheduleDate").value) $("#scheduleDate").value = todayStr();
    renderScheduleForDate($("#scheduleDate").value);
  }
  $("#scheduleDate").addEventListener("change", () => renderScheduleForDate($("#scheduleDate").value));

  function renderScheduleForDate(dateStr) {
    $("#printDateLabel").textContent = formatDateLabel(dateStr);

    // Therapist status chips (live status + whether occupied right now if date is today)
    const grid = $("#scheduleTherapistStatus");
    grid.innerHTML = "";
    const isToday = dateStr === todayStr();
    const now = nowMinutes();

    therapists.forEach(t => {
      let dotClass = "dot-gray";
      let label = t.status === "available" ? "Available" : (t.status === "off-duty" ? "Off Duty" : "On Leave");

      if (t.status === "available") {
        const occupiedNow = isToday && bookings.some(b => {
          if (b.date !== dateStr || b.status === "cancelled" || b.status === "completed" || !b.therapistIds.includes(t.id)) return false;
          const s = timeToMinutes(b.startTime), e = bookingEndMinutes(b);
          return now >= s && now < e;
        });
        dotClass = occupiedNow ? "dot-red" : "dot-green";
        label = occupiedNow ? "Occupied now" : "Available";
      }

      const chip = document.createElement("div");
      chip.className = "therapist-status-chip";
      chip.innerHTML = `<i class="dot ${dotClass}"></i> ${escapeHtml(t.name)} — ${label}`;
      grid.appendChild(chip);
    });

    const dayBookings = sortByTime(bookings.filter(b => b.date === dateStr && b.status !== "cancelled"));
    renderBookingList($("#scheduleBookingList"), dayBookings);
  }

  // ----------------------------------------------------------
  // THERAPISTS VIEW
  // ----------------------------------------------------------
  function renderTherapistsView() {
    const grid = $("#therapistGrid");
    grid.innerHTML = "";
    if (!therapists.length) {
      grid.innerHTML = `<div class="empty-state"><span class="empty-icon">🧑‍⚕️</span><p>No therapists yet. Add your first team member.</p></div>`;
      return;
    }
    therapists.forEach(t => grid.appendChild(buildTherapistCard(t)));
  }

  function buildTherapistCard(t) {
    const card = document.createElement("div");
    card.className = `therapist-card status-${t.status}`;
    const statusLabel = t.status === "available" ? "Available" : (t.status === "off-duty" ? "Off Duty" : "On Leave");
    const initials = t.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();

    card.innerHTML = `
      <div class="therapist-card-top">
        <div class="therapist-avatar">${escapeHtml(initials)}</div>
      </div>
      <div class="therapist-name">${escapeHtml(t.name)}</div>
      <span class="status-badge ${t.status}">${statusLabel}</span>
      <div class="therapist-actions">
        <button class="btn btn-secondary btn-sm" data-action="edit">Edit</button>
        <button class="btn btn-ghost btn-sm" data-action="delete">Remove</button>
      </div>
    `;
    card.querySelector('[data-action="edit"]').addEventListener("click", () => openTherapistModal(t.id));
    card.querySelector('[data-action="delete"]').addEventListener("click", () => {
      const hasFutureBookings = bookings.some(b => b.therapistIds.includes(t.id) && b.status === "upcoming");
      const msg = hasFutureBookings
        ? `${t.name} has upcoming bookings assigned. Removing them will not delete those bookings, but they'll show as unassigned. Continue?`
        : `Remove ${t.name} from your therapist list?`;
      showConfirm("Remove therapist?", msg, async () => {
        try {
          await deleteTherapist(t.id);
          showToast(`${t.name} removed.`, "success");
        } catch (err) {
          console.error("Failed to remove therapist:", err);
          showToast("Couldn't remove therapist. Check your connection and try again.", "error");
        }
      });
    });
    return card;
  }

  // Therapist add/edit modal
  $("#addTherapistBtn").addEventListener("click", () => openTherapistModal(null));
  $("#closeTherapistModal").addEventListener("click", () => closeModal("#therapistModal"));
  $("#cancelTherapistFormBtn").addEventListener("click", () => closeModal("#therapistModal"));

  function openTherapistModal(therapistId) {
    const form = $("#therapistForm");
    form.reset();
    if (therapistId) {
      const t = therapists.find(x => x.id === therapistId);
      $("#therapistModalTitle").textContent = "Edit Therapist";
      $("#therapistId").value = t.id;
      $("#therapistName").value = t.name;
      $("#therapistStatus").value = t.status;
    } else {
      $("#therapistModalTitle").textContent = "Add Therapist";
      $("#therapistId").value = "";
    }
    openModal("#therapistModal");
  }

  $("#therapistForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("#therapistId").value;
    const name = $("#therapistName").value.trim();
    const status = $("#therapistStatus").value;
    if (!name) return;

    const saveBtn = e.target.querySelector('button[type="submit"]');
    saveBtn.disabled = true;
    try {
      if (id) {
        await updateTherapist(id, { name, status });
      } else {
        await createTherapist({ name, status });
      }
      closeModal("#therapistModal");
      showToast("Therapist saved.", "success");
    } catch (err) {
      console.error("Failed to save therapist:", err);
      showToast("Couldn't save therapist. Check your connection and try again.", "error");
    } finally {
      saveBtn.disabled = false;
    }
  });

  // ----------------------------------------------------------
  // BOOKING FORM MODAL
  // ----------------------------------------------------------
  const newBookingTriggers = ["#newBookingBtnDash", "#newBookingBtnList", "#railNewBookingBtn", "#fabNewBooking"];
  newBookingTriggers.forEach(sel => $(sel).addEventListener("click", () => openBookingModal(null)));

  $("#closeBookingModal").addEventListener("click", () => closeModal("#bookingModal"));
  $("#cancelBookingFormBtn").addEventListener("click", () => closeModal("#bookingModal"));

  $("#serviceType").addEventListener("change", (e) => {
    $("#customServiceWrap").classList.toggle("hidden", e.target.value !== "__other");
  });

  // Re-render the eligible-therapist checkbox list whenever relevant fields change
  ["bookingDate", "startTime", "duration", "therapistCount"].forEach(id => {
    $("#" + id).addEventListener("change", refreshTherapistCheckboxes);
    $("#" + id).addEventListener("input", refreshTherapistCheckboxes);
  });

  function openBookingModal(bookingId) {
    const form = $("#bookingForm");
    form.reset();
    $("#customServiceWrap").classList.add("hidden");

    if (bookingId) {
      const b = bookings.find(x => x.id === bookingId);
      $("#bookingModalTitle").textContent = "Edit Booking";
      $("#bookingId").value = b.id;
      $("#customerName").value = b.customerName;
      $("#contactNumber").value = b.contactNumber;

      const knownServices = Array.from($("#serviceType").options).map(o => o.value);
      if (knownServices.includes(b.serviceType)) {
        $("#serviceType").value = b.serviceType;
      } else {
        $("#serviceType").value = "__other";
        $("#customServiceWrap").classList.remove("hidden");
        $("#customServiceName").value = b.serviceType;
      }

      $("#bookingDate").value = b.date;
      $("#startTime").value = b.startTime;
      $("#duration").value = b.duration;
      $("#therapistCount").value = String(b.therapistIds.length || 1);
      $("#bookingNotes").value = b.notes || "";
    } else {
      $("#bookingModalTitle").textContent = "New Booking";
      $("#bookingId").value = "";
      $("#bookingDate").value = todayStr();
    }

    refreshTherapistCheckboxes();
    openModal("#bookingModal");
  }

  // Builds the list of therapist checkboxes, marking ones that are busy for the
  // currently-entered date/time/duration as disabled with an inline conflict note.
  function refreshTherapistCheckboxes() {
    const date = $("#bookingDate").value;
    const startTime = $("#startTime").value;
    const duration = $("#duration").value;
    const requiredCount = Number($("#therapistCount").value);
    const excludeId = $("#bookingId").value || null;

    const wrap = $("#therapistCheckboxes");
    const previouslyChecked = $$('#therapistCheckboxes input[type="checkbox"]:checked').map(cb => cb.value);
    wrap.innerHTML = "";

    if (!therapists.length) {
      wrap.innerHTML = `<p class="field-hint">No therapists added yet — add your team in the Therapists tab first.</p>`;
      return;
    }

    therapists.forEach(t => {
      let disabled = false;
      let note = "";

      if (t.status !== "available") {
        disabled = true;
        note = t.status === "off-duty" ? "Off duty" : "On leave";
      } else if (date && startTime && duration) {
        const result = isTherapistFree(t.id, date, startTime, duration, excludeId);
        if (!result.free) {
          disabled = true;
          note = `Busy ${minutesToLabel(result.bStart)}–${minutesToLabel(result.bEnd)}`;
        }
      }

      const item = document.createElement("label");
      item.className = "therapist-check-item" + (disabled ? " disabled" : "");
      const wasChecked = previouslyChecked.includes(t.id) && !disabled;
      item.innerHTML = `
        <input type="checkbox" value="${t.id}" ${disabled ? "disabled" : ""} ${wasChecked ? "checked" : ""}>
        <span>${escapeHtml(t.name)}</span>
        ${note ? `<span class="tc-note">${escapeHtml(note)}</span>` : ""}
      `;
      const checkbox = item.querySelector("input");
      checkbox.addEventListener("change", () => {
        item.classList.toggle("checked", checkbox.checked);
        enforceTherapistSelectionLimit(requiredCount);
      });
      if (wasChecked) item.classList.add("checked");
      wrap.appendChild(item);
    });
  }

  // Prevents selecting more therapists than required; unchecks oldest extra selection
  function enforceTherapistSelectionLimit(maxCount) {
    const checked = $$('#therapistCheckboxes input[type="checkbox"]:checked');
    if (checked.length > maxCount) {
      const extra = checked[0];
      extra.checked = false;
      extra.closest(".therapist-check-item").classList.remove("checked");
      showToast(`This booking only requires ${maxCount} therapist${maxCount > 1 ? "s" : ""}.`, "error");
    }
  }

  $("#bookingForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const id = $("#bookingId").value;
    const customerName = $("#customerName").value.trim();
    const contactNumber = $("#contactNumber").value.trim();
    let serviceType = $("#serviceType").value;
    if (serviceType === "__other") {
      serviceType = $("#customServiceName").value.trim();
      if (!serviceType) { showToast("Please type the custom service name.", "error"); return; }
    } else if (!serviceType) {
      showToast("Please select a service type.", "error"); return;
    }

    const date = $("#bookingDate").value;
    const startTime = $("#startTime").value;
    const duration = Number($("#duration").value);
    const therapistCount = Number($("#therapistCount").value);
    const therapistIds = $$('#therapistCheckboxes input[type="checkbox"]:checked').map(cb => cb.value);
    const notes = $("#bookingNotes").value.trim();

    if (!customerName || !contactNumber || !date || !startTime) {
      showToast("Please fill in all required fields.", "error");
      return;
    }

    if (therapistIds.length !== therapistCount) {
      showConflictModal(`This booking requires ${therapistCount} therapist${therapistCount > 1 ? "s" : ""}, but ${therapistIds.length} ${therapistIds.length === 1 ? "is" : "are"} selected. Please select exactly ${therapistCount}.`);
      return;
    }

    // Fast client-side check first, using the live-synced local data —
    // catches almost everything instantly with no network round-trip.
    const validation = validateBooking({ date, startTime, duration, therapistIds, excludeBookingId: id || null });
    if (!validation.ok) {
      showConflictModal(validation.message);
      return;
    }

    const bookingData = { customerName, contactNumber, serviceType, date, startTime, duration, therapistIds, notes };
    const saveBtn = $("#saveBookingBtn");
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";

    try {
      // The Firestore service re-verifies against the live server as
      // the final authority (see data-service.js) before committing —
      // this is what actually prevents two staff members from both
      // booking the same therapist/slot at almost the same moment.
      if (id) {
        await updateBooking(id, bookingData);
        showToast("Booking updated.", "success");
      } else {
        await createBooking(bookingData);
        showToast("Booking saved.", "success");
      }
      closeModal("#bookingModal");
    } catch (err) {
      if (err.message === "SERVER_CONFLICT") {
        const conflictTherapist = therapists.find(t => err.conflictWith && err.conflictWith.therapistIds.includes(t.id));
        const name = conflictTherapist ? conflictTherapist.name : "This therapist";
        const bStart = minutesToLabel(timeToMinutes(err.conflictWith.startTime));
        const bEnd = minutesToLabel(timeToMinutes(err.conflictWith.startTime) + Number(err.conflictWith.duration));
        showConflictModal(`Booking conflict detected. Therapist ${name} is already assigned from ${bStart} to ${bEnd}. Someone else may have just booked this slot — please pick another time.`);
      } else {
        console.error("Failed to save booking:", err);
        showToast("Couldn't save the booking. Check your connection and try again.", "error");
      }
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Booking";
    }
  });

  function refreshCurrentView() {
    const activeView = $(".view.active").id.replace("view-", "");
    switchView(activeView);
  }

  // ----------------------------------------------------------
  // BOOKING DETAIL MODAL (view / edit / cancel / complete)
  // ----------------------------------------------------------
  let activeDetailId = null;

  function openDetailModal(bookingId) {
    const b = bookings.find(x => x.id === bookingId);
    if (!b) return;
    activeDetailId = bookingId;

    const therapistNames = b.therapistIds
      .map(id => (therapists.find(t => t.id === id) || {}).name || "Unassigned (removed)")
      .join(" & ") || "Unassigned";

    $("#detailContent").innerHTML = `
      <div class="detail-row"><span>Customer</span><span>${escapeHtml(b.customerName)}</span></div>
      <div class="detail-row"><span>Contact</span><span>${escapeHtml(b.contactNumber)}</span></div>
      <div class="detail-row"><span>Service</span><span>${escapeHtml(b.serviceType)}</span></div>
      <div class="detail-row"><span>Date</span><span>${escapeHtml(formatDateLabel(b.date))}</span></div>
      <div class="detail-row"><span>Time</span><span>${minutesToLabel(timeToMinutes(b.startTime))} – ${minutesToLabel(bookingEndMinutes(b))}</span></div>
      <div class="detail-row"><span>Duration</span><span>${b.duration} mins</span></div>
      <div class="detail-row"><span>Therapist(s)</span><span>${escapeHtml(therapistNames)}</span></div>
      <div class="detail-row"><span>Status</span><span><span class="status-pill ${b.status}">${b.status}</span></span></div>
      ${b.notes ? `<div class="detail-row"><span>Notes</span><span>${escapeHtml(b.notes)}</span></div>` : ""}
    `;

    const isFinal = b.status === "cancelled" || b.status === "completed";
    $("#detailCancelBtn").classList.toggle("hidden", isFinal);
    $("#detailEditBtn").classList.toggle("hidden", isFinal);
    $("#detailCompleteBtn").classList.toggle("hidden", b.status !== "upcoming");

    openModal("#detailModal");
  }

  $("#closeDetailModal").addEventListener("click", () => closeModal("#detailModal"));

  $("#detailEditBtn").addEventListener("click", () => {
    closeModal("#detailModal");
    openBookingModal(activeDetailId);
  });

  $("#detailCancelBtn").addEventListener("click", () => {
    const b = bookings.find(x => x.id === activeDetailId);
    showConfirm("Cancel this booking?", `This will cancel ${b.customerName}'s ${b.serviceType} appointment. This can't be undone.`, async () => {
      try {
        await setBookingStatus(activeDetailId, "cancelled");
        closeModal("#detailModal");
        showToast("Booking cancelled.", "success");
      } catch (err) {
        console.error("Failed to cancel booking:", err);
        showToast("Couldn't cancel the booking. Check your connection and try again.", "error");
      }
    });
  });

  $("#detailCompleteBtn").addEventListener("click", async () => {
    try {
      await setBookingStatus(activeDetailId, "completed");
      closeModal("#detailModal");
      showToast("Booking marked as completed.", "success");
    } catch (err) {
      console.error("Failed to mark booking completed:", err);
      showToast("Couldn't update the booking. Check your connection and try again.", "error");
    }
  });

  // ----------------------------------------------------------
  // INIT
  // ----------------------------------------------------------
  // Called from the onActive() callback in the auth gate above,
  // once a signed-in user's subscription has been confirmed active.
  // (Not called at module load time — the app must not render any
  // booking data until that check has passed.)
  function init() {
    $("#bookingDate").value = todayStr();
    renderDashboard();
  }

  // Wired once at startup — safe to call before auth resolves since
  // these buttons are only visible once their containing screens are
  // shown, and signing out is safe to invoke from any state.
  wireSignOutButtons();

  // NOTE: deliberately no service worker registration here. This
  // app is online-only by design (requirement #1) — caching the app
  // shell for offline use would let staff open a UI that can't load
  // live booking data or re-verify subscription status, which is
  // exactly the situation we want to avoid rather than paper over.
})();

