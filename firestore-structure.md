# Firestore Data Structure

This document describes every collection used by Cadence, what each field means, and who is allowed to read/write it (enforced by `firestore.rules`).

```
businesses/{businessId}
  name                      string            e.g. "Spa de Iloko"
  ownerEmail                string | null     for the admin's own reference
  subscriptionStatus        string            "active" | "expired" | "suspended"
  subscriptionExpiryDate    Timestamp | null  when access should cut off
  branding                  map               see below
  createdAt                 Timestamp         set once, on creation

  branding (map, nested inside the business document):
    logoUrl                 string | null     link to the tenant's own logo image
    primaryColor            string            hex, e.g. "#2F6740"
    secondaryColor          string            hex, e.g. "#684F39"
    address                 string | null
    contactPhone            string | null
    contactEmail            string | null

  businesses/{businessId}/bookings/{bookingId}
    customerName            string
    contactNumber           string
    serviceType             string
    date                    string            "YYYY-MM-DD"
    startTime               string            "HH:MM" (24h)
    duration                number            minutes (60 | 90 | 120)
    therapistIds             array<string>     refs to therapists/{id}
    notes                   string
    status                  string            "upcoming" | "completed" | "cancelled"
    createdAt               Timestamp

  businesses/{businessId}/therapists/{therapistId}
    name                    string
    status                  string            "available" | "off-duty" | "on-leave"

users/{uid}
  businessId                string            which businesses/{id} this login belongs to
  role                      string            "owner" | "staff"
  email                     string            for reference / admin lookups

admins/{uid}
  email                     string            for reference only
  (presence of this document is what grants admin access — no
   special fields are required beyond the document existing)
```

## Why this shape

**Everything booking-related lives under `businesses/{businessId}/...`.** This is what makes the app multi-tenant: every query the staff app makes is automatically scoped to one business by construction (`collection(db, "businesses", businessId, "bookings")`), and the security rules independently enforce the same scoping server-side — so even a modified client can't read another spa's data.

**`subscriptionStatus` is a separate field from the computed "is access currently allowed" check.** The actual access check (in both the app's `auth.js` and in `firestore.rules`) is:

```
subscriptionStatus == "active"  AND  subscriptionExpiryDate > now
```

This means letting a date pass automatically locks the account out — you don't have to manually flip every expiring business to `"expired"` yourself. The `"expired"` value is provided as a status you *can* set explicitly if you want a business to show as expired regardless of its date (e.g. you've decided to cut someone off early but want to keep their original expiry date visible for your own records), but it isn't required for the lock to work.

**`suspended` always wins.** A suspended business is locked out even if its expiry date is far in the future — used for "I need to cut this customer off right now" (e.g. non-payment dispute) without losing or editing their expiry date.

**Bookings are never hard-deleted by the app's own UI.** "Cancel" sets `status: "cancelled"` rather than removing the document. Combined with the security rules (which block reads/writes once a subscription lapses, but never trigger any deletion), this is what guarantees historical data survives an expired→reactivated cycle intact.

## Platform branding vs. tenant branding

Cadence (the app shell) and each tenant's booking app inside it use two **completely separate** color/identity systems:

- **Platform branding** — the Cadence name, mark, and indigo color scheme. Fixed in code (`--platform-*` CSS variables in `styles.css`), never read from Firestore. Used by: the login page, the favicon/PWA install icon, the loading screen, the locked/expired overlay, and the entire admin console. No business's data can ever change these — there's no field in Firestore for it.
- **Tenant branding** — each business's own name, logo, and two colors, stored in `businesses/{id}.branding`. Loaded once after a successful login + subscription check (see `applyBusinessBranding()` in `app.js`), which then:
  1. Sets `--tenant-primary` / `--tenant-primary-deep` / `--tenant-primary-light` / `--tenant-secondary` as runtime CSS variable overrides (the `-deep` and `-light` shades are derived automatically from the one primary color you set, via HSL math — you only ever need to pick two colors per business, not four).
  2. Swaps the logo `<img>` shown in the side rail, mobile top bar, and printed schedule header.
  3. Fills in the business name + address/contact line on printed schedules.

This split is why a new business with no branding set yet still looks reasonable (neutral gray placeholder theme) rather than broken, and why Spa de Iloko's specific green/brown look is just *that one tenant's* data — not baked into the app shell anyone else would see.

## Indexes

The staff app queries bookings with `where("date", "==", ...)` (conflict re-check) and ordered listening by `(date, startTime)`. Firestore will prompt you to create the composite index the first time you run the app — click the link it gives you in the browser console, or create it manually:

- Collection: `bookings` (collection, not collection group)
- Fields indexed: `date` Ascending, `startTime` Ascending

No other custom indexes are required.
