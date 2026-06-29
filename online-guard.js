/* ===========================================================
   Online-only connectivity guard
   -----------------------------------------------------------
   Per requirement #1, this app does not function offline at all.
   This module shows a full-screen blocking overlay whenever the
   browser reports it has no network connection, and removes it
   the moment connectivity returns. It does NOT try to queue
   actions for later — by design, nothing should be writable
   while offline, since subscription status and booking conflict
   checks must always reflect the live server state.
   =========================================================== */

function buildOverlay() {
  const overlay = document.createElement("div");
  overlay.id = "offlineOverlay";
  overlay.className = "blocking-overlay hidden";
  overlay.innerHTML = `
    <div class="blocking-card">
      <div class="blocking-icon">⌁</div>
      <h2>No internet connection</h2>
      <p>Cadence needs an active internet connection to run. Please reconnect to continue — none of your saved data has been affected.</p>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

export function initOnlineGuard() {
  const overlay = buildOverlay();

  function update() {
    overlay.classList.toggle("hidden", navigator.onLine);
  }

  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  update();
}
