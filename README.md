# Cadence — Multi-Tenant Booking SaaS

A white-label, multi-tenant booking management platform for service businesses (spas, salons, clinics — anywhere that schedules appointments against a limited pool of staff). You run one instance of this app and sell access to many separate businesses ("tenants"); each one gets fully isolated bookings, therapist/staff data, and customer records, plus their own logo, colors, name, and contact info — while the platform shell itself (login page, app icon, admin console) stays neutrally branded as **Cadence**, not any one tenant's identity.

This is the SaaS rebuild of an original single-spa, LocalStorage-based booking tool — now backed by Firebase Authentication and Firestore, online-only, with full subscription gating, a super-admin console, and per-tenant white-label theming.

## The two brand layers — read this first

This is the most important architectural idea in the project, so it's worth stating plainly:

1. **Platform branding ("Cadence")** — fixed in code, never stored in Firestore, never changes per tenant. This is what appears on: the login page, the browser favicon, the installed PWA icon/splash, the loading screen, the locked/expired overlay, and the entire super-admin console. No business's data can ever alter this layer.
2. **Tenant branding** — each business's own name, logo, primary/secondary color, address, and contact info, stored in `businesses/{id}.branding` in Firestore. This loads automatically the moment a business's staff member signs in, and re-skins the *booking app's interior* (buttons, the side rail, stat cards, the dashboard, printed schedules) — but never the platform chrome around it.

**Spa de Iloko is just the first example tenant**, seeded with its own name/logo/colors in its own Firestore document, exactly the way every future paying customer will be onboarded. None of its assets, colors, or branding are hardcoded into the app shell — delete that one Firestore document and the app shell looks identical, just with zero tenants.

## What's in this project

```
public/                  ← the staff-facing app (what spa owners/employees use)
  login.html / login.js  ← sign-in + subscription lock screen (Cadence-branded)
  index.html             ← the booking app itself (dashboard, bookings, schedule, therapists)
  app.js                 ← booking/conflict-prevention logic + auth/subscription gate +
                            the tenant branding loader (applyBusinessBranding)
  auth.js                ← Firebase Auth wrapper + subscription status checking
  data-service.js        ← all Firestore reads/writes, scoped per business
  online-guard.js         ← blocks the UI when the device has no internet connection
  firebase-config.js      ← 🔧 put your Firebase project's config here
  styles.css              ← shared visual design; --platform-* vars (fixed) vs
                             --tenant-* vars (overridden at runtime per business)
  manifest.json, assets/platform/  ← Cadence PWA icons, shared by every tenant

admin/                  ← the super-admin console (only you should have access) — always
                          Cadence-branded, regardless of which businesses it's managing
  admin-login.html / admin-login.js  ← admin-only sign-in
  admin.html / admin.js              ← view all businesses, edit branding + subscriptions, see stats
  assets/                            ← Cadence platform icons (self-contained copy)

firestore.rules          ← security rules — the actual enforcement layer
docs/
  SETUP.md               ← step-by-step: create your Firebase project, deploy rules,
                            add your first admin + onboard your first tenant
  firestore-structure.md ← what every collection/field means, incl. the branding object
```

## Start here

1. Read **`docs/SETUP.md`** top to bottom.
2. Read **`docs/firestore-structure.md`** — especially the "Platform branding vs. tenant branding" section.
3. Once set up: business owners/staff sign in at `public/login.html`; you sign in at `admin/admin-login.html`.

## How the subscription gate works, in one paragraph

Every time the staff app loads or a staff member logs in, it reads that business's `businesses/{id}` document fresh from Firestore and checks `subscriptionStatus === "active"` AND `subscriptionExpiryDate` is still in the future. If either check fails, the booking UI is replaced by a lock screen reading *"Your subscription has expired. Please contact the administrator to renew."* (or a suspension-specific message) — but nothing is deleted. The same check is also enforced independently by Firestore's security rules, so it can't be bypassed by tampering with the app's JavaScript. The moment you reactivate a business from the admin console, the exact same data — and the exact same branding — reappears, because none of it was ever touched.

## Onboarding a new tenant (no code changes required)

1. In the admin console, fill out "Add a new business": name, expiry date, and their branding (logo URL, two colors, address, contact info).
2. Create their staff login in Firebase Authentication + a `users/{uid}` link document pointing at the new business (see SETUP.md step 8).
3. Hand them their login. That's it — their booking app instantly shows their own name/logo/colors, with zero deploys or code edits.

## Honest limitations worth knowing about

- **Booking conflict prevention is "very strong" rather than "mathematically airtight."** The app checks for conflicts twice — instantly against locally-synced data for fast feedback, then again against the live server immediately before saving. Two staff at different terminals booking the exact same slot within milliseconds of each other could in rare cases both pass the check before either write lands. Closing that gap completely would require a Cloud Function with a transactional lock — a reasonable next step if you ever need it, but plain client-side Firestore can't do it perfectly.
- **This app is intentionally online-only** — there's no offline mode or service worker caching of booking data. If the device loses internet, the UI shows a blocking "no connection" message rather than letting anyone work from stale data.
- **Tenant logos are linked by URL, not uploaded through the app.** You (the admin) paste a link to an already-hosted image when onboarding a business. Adding direct logo upload would mean wiring up Firebase Storage — a natural future addition, documented as a next step rather than built in, to keep the current setup simple.
- **The admin console trusts the `admins` Firestore collection, not a special Firebase "claim" or role.** Adding/removing admins requires editing Firestore directly (see SETUP.md) rather than through a UI — a deliberate tradeoff to avoid giving any client-side code the ability to grant itself admin rights.

## Local development

There's no build step — it's plain HTML/CSS/JS loaded as ES modules. To run it locally, serve the `public/` (and separately, `admin/`) folders with any static file server (opening `index.html` directly via `file://` won't work correctly with ES module imports in most browsers):

```
cd public && python3 -m http.server 8080
# then visit http://localhost:8080/login.html
```

Remember to add `localhost` to Firebase Auth's authorized domains while testing locally (Authentication → Settings → Authorized domains).
Deployment test