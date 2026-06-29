# Setup Guide — Cadence (Multi-Tenant Booking SaaS)

This guide takes you from zero to a working multi-tenant booking SaaS, end to end. Follow it in order — later steps depend on earlier ones.

---

## 1. Create your Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and click **Add project**.
2. Name it (e.g. "cadence-booking"), and you can disable Google Analytics unless you want it.
3. Once created, you land on the project's Overview page.

## 2. Register a Web App

1. On the Overview page, click the **`</>`** (Web) icon to add a web app.
2. Give it a nickname (e.g. "Cadence Web"). You don't need Firebase Hosting checked at this step (we'll cover hosting options separately, but you don't have to use Firebase's).
3. Firebase will show you a config object that looks like:
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "cadence-booking.firebaseapp.com",
     projectId: "cadence-booking",
     storageBucket: "cadence-booking.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abc123",
   };
   ```
4. Copy these values into **`public/firebase-config.js`**, replacing the placeholder strings at the top of the file.

## 3. Enable Authentication

1. In the Firebase Console sidebar, go to **Build → Authentication**.
2. Click **Get started**.
3. Under **Sign-in method**, enable **Email/Password** (the simple toggle, not the passwordless link option).

You do **not** need to enable any other sign-in providers for this app.

## 4. Enable Firestore

1. In the sidebar, go to **Build → Firestore Database**.
2. Click **Create database**.
3. Choose **Production mode** (not test mode — we're providing real security rules).
4. Pick a location close to your users. **This cannot be changed later**, so choose carefully.

## 5. Deploy the security rules

The simplest path (no command line needed):

1. In Firestore, click the **Rules** tab.
2. Open `firestore.rules` from this project, copy its entire contents.
3. Paste it into the Rules editor in the console, replacing what's there.
4. Click **Publish**.

(If you're comfortable with the Firebase CLI instead: `firebase deploy --only firestore:rules` after running `firebase init firestore` and pointing it at this `firestore.rules` file.)

## 6. Create your first super-admin account

This is **you** — the only person who can activate/suspend subscriptions.

1. In Firebase Console → **Authentication → Users → Add user**. Enter your own email and a strong password.
2. Copy the **User UID** shown after creation (looks like `a1B2c3D4e5...`).
3. Go to **Firestore Database → Data**, click **Start collection**, name it exactly `admins`.
4. For the **Document ID**, paste the UID you copied. Leave it with at least one field, e.g. add a field `email` (string) set to your email address, just for your own reference.
5. Click **Save**.

You can now sign in at `admin/admin-login.html` with that email/password.

## 7. Add your first tenant — Spa de Iloko (or any other business)

You can do this either through the Admin Console UI, or manually — the UI is easier:

1. Open `admin/admin-login.html` in a browser, sign in with your admin account.
2. You'll land on the Admin Console. Use the **"Add a new business"** form:
   - Business name (e.g. "Spa de Iloko"), optional owner email (for your reference), initial status, and expiry date.
   - Their branding: a link to their logo image, their primary and secondary brand colors, and their address/contact info. All of this is optional at creation time — you can leave colors at the defaults and add a logo later via the **Edit** button in the table once you have one.
3. Click **+ Add Business**. It now appears in the table below, with live swatches showing their current colors.

The moment a staff member from this business signs in (see step 8), the app automatically re-skins itself with this exact branding — no code changes, no redeploy.

> 💡 **Where do I host a tenant's logo image?** The Logo URL field expects a direct link to an image file (ending in `.png`, `.jpg`, etc.) that's already reachable on the web — the app doesn't have a file upload feature built in (see the README's "Honest limitations" section for why). If a business doesn't already have their logo hosted somewhere, quick options include: uploading it to a free image host and using the direct image link it gives you, putting it in a public Google Drive/Dropbox folder and using the direct-file-view link, or hosting it alongside your own site if you have one. Any URL that resolves to just the image (not a webpage containing the image) will work.

## 8. Create the business's staff login

The admin console creates the *business record*, but Firebase Authentication logins for actual staff/owners are created separately (this keeps you in full control of who gets access, rather than letting anyone self-register):

1. Firebase Console → **Authentication → Users → Add user**. Enter the business's owner/staff email and a password (have them change it after first login, or use Firebase's password reset email flow).
2. Copy the new user's **UID**.
3. Go to **Firestore Database → Data**, open (or create) the `users` collection.
4. **Document ID**: paste the UID.
5. Add fields:
   - `businessId` (string) — the **document ID** of the business you created in step 7 (find it by clicking that business's row in Firestore — the ID is shown at the top).
   - `role` (string) — `"owner"` or `"staff"`.
   - `email` (string) — their email, for your own reference.
6. Save.

They can now sign in at the regular staff login page (`public/login.html`) with that email/password.

> 💡 **Repeat steps 7–8 for every tenant** you onboard. Each one gets its own `businesses/{id}` document and at least one `users/{uid}` link record pointing to it.

## 9. Host the files

This app is plain static HTML/CSS/JS — no build step, no server required. You have several options:

- **Firebase Hosting** (free tier is generous, integrates well since you're already using Firebase):
  ```
  npm install -g firebase-tools
  firebase login
  firebase init hosting    # point the public directory to "public"
  firebase deploy --only hosting
  ```
  You'll want to host the `admin/` folder too — either as a second Hosting site, or simply alongside `public/` at a path like `/admin/`.
- **Any static host** (Netlify, Vercel, GitHub Pages, your own server): just upload the `public/` and `admin/` folders as-is. No environment variables needed — `firebase-config.js` already has your project's public config baked in (this is normal and safe; Firebase's web API keys are not secret, since security rules are the actual access control).

## 10. Authorize your hosting domain

1. Firebase Console → **Authentication → Settings → Authorized domains**.
2. Add the domain you deployed to (Firebase Hosting domains are added automatically; for a custom domain or another host, add it manually here), or sign-in will fail with an `auth/unauthorized-domain` error.

## 11. Test the full flow

1. Visit your staff login page, sign in as a business's staff/owner. Confirm you see their dashboard, can create a booking, see the conflict-prevention message if you double-book a therapist, and can print/export.
2. In the admin console, suspend that business. Refresh the staff app (or wait up to 5 minutes / switch tabs and back) — confirm it locks with the "contact the administrator" message, and that the booking you created is **still there** in Firestore (check the Firestore console directly) even though the UI is locked.
3. Reactivate the business in the admin console. Confirm the staff app unlocks and the same booking reappears.

---

## Ongoing operations

- **Changing a subscription's expiry date**: Admin Console → find the business's row → change the date in the date picker. Saves immediately.
- **Suspending/activating**: same row, click the Suspend/Activate button. Takes effect within seconds for an open tab (faster if they're actively using the app, since the security rules also stop their reads/writes immediately — the UI lock screen just catches up to that on the next check).
- **Updating a tenant's branding** (new logo, different colors, address/contact changes): same row, click **Edit** under the Branding column, update the fields, save. Takes effect the next time that business's staff load or refresh the app.
- **Adding more admins**: repeat step 6 for any additional trusted person — be selective, since anyone in the `admins` collection can suspend/activate any business.
- **A business needs a second staff login**: repeat step 8 (a `users/{uid}` doc) — you can link as many logins as you like to the same `businessId`.

## Costs to be aware of

This setup uses Firebase's standard pay-as-you-go pricing (Spark free tier covers a meaningful amount of usage for a small number of businesses; Blaze is the pay-as-you-go plan you'd move to as you grow). Firestore charges per document read/write/delete and the live `onSnapshot` listeners count toward reads — for a small number of tenants with realistic booking volumes this is typically a few dollars a month at most, but keep an eye on the **Usage** tab in the Firebase Console as you add customers.
