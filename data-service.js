/* ===========================================================
   Firestore Data Service
   -----------------------------------------------------------
   Every read/write here is scoped under businesses/{businessId}/...
   so one spa's bookings, therapists, and customers are never
   visible to another spa. This mirrors the original app's
   in-memory `bookings` / `therapists` arrays, but backed by
   live Firestore listeners instead of localStorage.

   IMPORTANT: this module assumes session.businessId is already
   set (i.e. auth.js's onAuthReady has resolved an active
   subscription) before any of these functions are called.
   =========================================================== */

import { db } from "./firebase-config.js";
import { session } from "./auth.js";
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  getDocs,
  runTransaction,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

function businessCollection(name) {
  if (!session.businessId) throw new Error("No active business session.");
  return collection(db, "businesses", session.businessId, name);
}

function businessDoc(name, id) {
  if (!session.businessId) throw new Error("No active business session.");
  return doc(db, "businesses", session.businessId, name, id);
}

// ----------------------------------------------------------
// LIVE LISTENERS
// ----------------------------------------------------------
// Each subscribe function returns an unsubscribe function. The app
// keeps a local in-memory array (bookings / therapists) updated by
// these callbacks, then re-renders — same pattern as the original
// app, just fed by Firestore instead of localStorage.

export function subscribeBookings(onChange, onError) {
  const q = query(businessCollection("bookings"), orderBy("date"), orderBy("startTime"));
  return onSnapshot(
    q,
    (snap) => {
      const bookings = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      onChange(bookings);
    },
    (err) => onError && onError(err)
  );
}

export function subscribeTherapists(onChange, onError) {
  const q = query(businessCollection("therapists"), orderBy("name"));
  return onSnapshot(
    q,
    (snap) => {
      const therapists = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      onChange(therapists);
    },
    (err) => onError && onError(err)
  );
}

// ----------------------------------------------------------
// BOOKINGS CRUD
// ----------------------------------------------------------

function timeToMinutesLocal(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function rangesOverlapLocal(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

/**
 * Re-fetches the latest non-cancelled bookings for the given date,
 * directly from the server (Firestore queries always hit the server
 * in this app since offline persistence is disabled — see
 * firebase-config.js), and re-runs the overlap check against
 * whatever is there *right now*, not the possibly-stale snapshot
 * the UI was holding when the form was submitted.
 *
 * Honest limitation: Firestore transactions can only read documents
 * by direct reference, not arbitrary range queries, so this can't be
 * wrapped in a single atomic transaction the way a relational
 * database UPDATE...WHERE could be. Two staff submitting the exact
 * same conflicting slot within milliseconds of each other could in
 * rare cases both pass this check before either write commits. This
 * re-check closes the vast majority of that race window (network
 * round-trips dominate the timing, so the realistic exposure is
 * small), but eliminating it completely would require a Cloud
 * Function with a transactional per-slot lock document — a natural
 * next step if this ever needs to be bulletproof at high concurrency.
 */
async function findServerSideConflict({ date, startTime, duration, therapistIds, excludeBookingId }) {
  const newStart = timeToMinutesLocal(startTime);
  const newEnd = newStart + Number(duration);

  const q = query(businessCollection("bookings"), where("date", "==", date));
  const snap = await getDocs(q);

  for (const docSnap of snap.docs) {
    if (docSnap.id === excludeBookingId) continue;
    const b = docSnap.data();
    if (b.status === "cancelled") continue;
    if (!b.therapistIds || !b.therapistIds.some((id) => therapistIds.includes(id))) continue;

    const bStart = timeToMinutesLocal(b.startTime);
    const bEnd = bStart + Number(b.duration);
    if (rangesOverlapLocal(newStart, newEnd, bStart, bEnd)) {
      return { conflict: true, with: b };
    }
  }
  return { conflict: false };
}

export async function createBooking(data) {
  const result = await findServerSideConflict(data);
  if (result.conflict) {
    const err = new Error("SERVER_CONFLICT");
    err.conflictWith = result.with;
    throw err;
  }
  return addDoc(businessCollection("bookings"), {
    ...data,
    status: "upcoming",
    createdAt: serverTimestamp(),
  });
}

export async function updateBooking(id, data) {
  if (data.date && data.startTime && data.duration && data.therapistIds) {
    const result = await findServerSideConflict({ ...data, excludeBookingId: id });
    if (result.conflict) {
      const err = new Error("SERVER_CONFLICT");
      err.conflictWith = result.with;
      throw err;
    }
  }
  return updateDoc(businessDoc("bookings", id), data);
}

export async function setBookingStatus(id, status) {
  return updateDoc(businessDoc("bookings", id), { status });
}

// Bookings are never hard-deleted from the UI — "Cancel" sets status
// to "cancelled" instead (see setBookingStatus), which is what keeps
// historical/reporting data intact. deleteBookingPermanently exists
// only for completeness (e.g. a future "purge test data" admin tool)
// and is intentionally not wired to any UI button.
export async function deleteBookingPermanently(id) {
  return deleteDoc(businessDoc("bookings", id));
}

// ----------------------------------------------------------
// THERAPISTS CRUD
// ----------------------------------------------------------

export async function createTherapist(data) {
  return addDoc(businessCollection("therapists"), data);
}

export async function updateTherapist(id, data) {
  return updateDoc(businessDoc("therapists", id), data);
}

export async function deleteTherapist(id) {
  return deleteDoc(businessDoc("therapists", id));
}

export { Timestamp };
