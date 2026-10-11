# Royal Rasoi – Online Ordering

Three pages, one Firebase backend:

| Page | Who | What it does |
|---|---|---|
| `/` (index.html) | Customers | Menu (Indo-Chinese + Indo-Italian), veg filter, cart, combos with choices, phone-OTP login, map pin + 3 km check, Cash/UPI, live order tracking with rider on the map, cancel before acceptance |
| `/admin.html` | Owner / manager | Live orders with sound alert, accept → preparing → out for delivery → delivered, assign rider, mark paid, price-tamper check, open/close shop, menu editor (prices, sold-out toggle, add/delete dishes), staff & riders, live rider map, settings (location, radius, fee, UPI ID) |
| `/rider.html` | Riders | Duty on/off with GPS sharing, assigned orders, navigate in Google Maps, call customer, picked up / delivered, cash collection |

Stack: plain HTML + JS (no build step), Firebase Auth (phone OTP) + Firestore (realtime), Leaflet + OpenStreetMap, hosted on Netlify.

---

## Setup (about 30 minutes, one time)

### 1. Firebase project
1. Go to https://console.firebase.google.com → **Add project** → name it `royal-rasoi` (Analytics optional).
2. **Project settings → General → Your apps → Web (`</>`)** → register app → copy the `firebaseConfig` values into `public/js/firebase-config.js`.

### 2. Turn on phone OTP
1. **Upgrade to the Blaze plan** (Spark/free plan can't send OTP SMS). Then in Google Cloud Billing set a **budget alert** (e.g. ₹500/month).
   - OTP SMS to India are billed per message (a few rupees each). Customers stay logged in on their phone, so most people verify only once.
2. **Authentication → Sign-in method → Phone → Enable.**
3. **Authentication → Settings → SMS region policy → Allow → India.**
4. For testing without SMS cost: **Phone → Phone numbers for testing** (e.g. `+91 99999 00001` / `123456`).

### 3. Firestore
1. **Firestore Database → Create database** → location **asia-south1 (Mumbai)** → production mode.
2. **Rules** tab → paste everything from `firestore.rules` → **Publish**.
3. Create the first manager: **Start collection** `roles` → Document ID `+917779869252` → fields `role` (string) = `admin`, `name` (string) = `Owner`.
   (Doc ID must be exactly `+91` followed by 10 digits, no spaces.)

### 4. Deploy on Netlify
- Easiest: https://app.netlify.com/drop → drag the whole `royal-rasoi` folder (Netlify reads `netlify.toml` and serves `public/`). Or push to GitHub and connect the repo.
- Copy the site address (e.g. `royal-rasoi.netlify.app`, or your own domain) into **Firebase → Authentication → Settings → Authorized domains → Add domain**. OTP will not work until this is done.

### 5. First run
1. Open `https://YOUR-SITE/admin.html` on the restaurant phone → log in with the owner number.
2. **Menu → Load default Royal Rasoi menu** (all 36 dishes from the printed menus).
3. **Settings** → stand inside the restaurant → **Use current location** → add your **UPI ID** → **Save**.
4. Tap **🔔 Turn on order alert** (browsers need one tap before they can play sound). Keep this tab open on the counter phone/tablet.
5. **Riders & staff → Add** your delivery boy's name + mobile (role Rider).
6. The rider opens `https://YOUR-SITE/rider.html`, logs in with his number, taps **Start duty**.

## Daily flow
1. Customer orders → dashboard beeps, card glows.
2. **Accept** → **Start preparing** → pick rider in the dropdown → **Send out for delivery** (or rider taps **Picked up**).
3. Customer sees the rider moving on the map with distance + ETA.
4. Rider taps **Delivered** (marks cash collected). UPI orders: check the UTR in your bank app and tap **Mark paid**.

## Good to know
- **Rider tracking runs in the browser**, so the rider page must stay open with the screen on (it requests a screen wake-lock). If the phone locks, updates pause until he opens it again. For true background tracking, the next step is a small Android app for riders writing to the same `riderLocations` / `orders.riderLocation` fields.
- **Prices**: the order stores the prices the customer saw. The dashboard shows a ⚠ price-check warning if anything doesn't match the current menu or total, so a tampered order can't slip through unnoticed.
- **Shop closed**: toggle on the Orders tab; customers can still browse but can't order.
- **Maps** use free OpenStreetMap tiles — fine for one restaurant's traffic.
- **Costs** at small scale: Firestore and Netlify stay within free limits; you pay only for OTP SMS.

## Data model (Firestore)
- `settings/main` – name, address, phones, lat/lng, radiusKm, deliveryFee, freeAbove, minOrder, upiId, upiName, open, hours
- `menu/{id}` – name, desc, category, cuisine (`chinese`/`italian`/`beverage`), veg, variants `[{label, price}]`, optionGroups `[{name, options[]}]`, available, image, sort
- `orders/{RRyymmdd-XXX}` – customer, address, location, items, totals, payment `{method, status, utr}`, status, statusHistory, riderPhone/riderName, riderLocation
- `roles/{+91…}` – `{role: admin|rider, name}`
- `riderLocations/{+91…}` – last GPS fix + onDuty
