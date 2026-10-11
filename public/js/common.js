import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, RecaptchaVerifier, signInWithPhoneNumber, onAuthStateChanged, signOut,
  setPersistence, browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

export * from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
export { onAuthStateChanged, signOut };

export const configured = !String(firebaseConfig.apiKey).startsWith("PASTE");
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
auth.languageCode = "en";
setPersistence(auth, browserLocalPersistence).catch(() => {});
export const db = getFirestore(app);

if (!configured) {
  addEventListener("DOMContentLoaded", () => {
    document.body.insertAdjacentHTML("afterbegin",
      `<div class="setup-warn">Setup needed: paste your Firebase config into <code>js/firebase-config.js</code> (see README).</div>`);
  });
}

// ---------- tiny DOM helpers ----------
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const rupee = (n) => "₹" + Math.round(Number(n) || 0).toLocaleString("en-IN");

/** Set innerHTML only when it changed (keeps maps/QR codes/inputs alive between snapshots). */
export function patch(el, html, after) {
  if (!el || el._h === html) return false;
  el._h = html; el.innerHTML = html; after && after(el); return true;
}

let toastTimer;
export function toast(msg, type = "") {
  let t = $("#toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.append(t); }
  t.textContent = msg; t.className = "show " + type;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = ""), 3200);
}

// ---------- geo ----------
export function km(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371, r = (d) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export const mapsLink = (p) => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
export const navLink = (p) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=two-wheeler`;

export function makeMap(el, center, zoom = 15) {
  const m = L.map(el, { zoomControl: true, attributionControl: true }).setView([center.lat, center.lng], zoom);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(m);
  setTimeout(() => m.invalidateSize(), 150);
  return m;
}
export const emo = (e, cls = "") =>
  L.divIcon({ className: "emo " + cls, html: `<span>${e}</span>`, iconSize: [36, 36], iconAnchor: [18, 18] });

// ---------- time ----------
export const tsMs = (t) => (t?.toMillis ? t.toMillis() : typeof t === "number" ? t : Date.now());
export const fmtTime = (t) => new Date(tsMs(t)).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
export function ago(t) {
  const s = Math.max(0, Math.round((Date.now() - tsMs(t)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return fmtTime(t);
}

// ---------- orders ----------
export const STEPS = ["placed", "accepted", "preparing", "out_for_delivery", "delivered"];
export const STATUS = {
  placed: "Order placed", accepted: "Accepted", preparing: "Being prepared",
  out_for_delivery: "Out for delivery", delivered: "Delivered", cancelled: "Cancelled",
};
export const ACTIVE = ["placed", "accepted", "preparing", "out_for_delivery"];

export function makeOrderId() {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const rnd = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
  return `RR${ymd}-${rnd}`;
}

export function normPhone(v) {
  const d = String(v || "").replace(/\D/g, "");
  const ten = d.length === 12 && d.startsWith("91") ? d.slice(2) : d.length === 11 && d.startsWith("0") ? d.slice(1) : d;
  return /^[6-9]\d{9}$/.test(ten) ? "+91" + ten : null;
}
export const prettyPhone = (p) => (p || "").replace(/^\+91(\d{5})(\d{5})$/, "+91 $1 $2");

export function upiLink(s, amount, note) {
  const q = new URLSearchParams({ pa: s.upiId, pn: s.upiName || s.name, am: Number(amount).toFixed(2), cu: "INR", tn: note });
  return "upi://pay?" + q.toString();
}

// ---------- settings ----------
export const DEFAULT_SETTINGS = {
  name: "Royal Rasoi",
  address: "Ravindra Thakur Rd, Patkhauliya, Koyla Belwa, Chakia, Bihar 845412",
  phones: ["+917779869252", "+918082199170", "+916206910981"],
  email: "ritik20004@gmail.com",
  lat: 26.4155, lng: 85.0465, locationSet: false,
  radiusKm: 3, deliveryFee: 0, freeAbove: 0, minOrder: 0,
  upiId: "", upiName: "Royal Rasoi",
  open: true, hours: "11:00 AM – 10:00 PM",
};
export function watchSettings(cb) {
  return onSnapshot(doc(db, "settings", "main"),
    (s) => cb({ ...DEFAULT_SETTINGS, ...(s.data() || {}) }),
    () => cb({ ...DEFAULT_SETTINGS }));
}
export function feeFor(s, subtotal) {
  if (!s.deliveryFee) return 0;
  if (s.freeAbove && subtotal >= s.freeAbove) return 0;
  return Number(s.deliveryFee);
}

export async function getRole(phone) {
  if (!phone) return null;
  try { const s = await getDoc(doc(db, "roles", phone)); return s.exists() ? s.data() : null; }
  catch { return null; }
}

// ---------- phone OTP login widget ----------
const AUTH_ERR = {
  "auth/invalid-phone-number": "That mobile number doesn't look right.",
  "auth/too-many-requests": "Too many attempts. Please wait a while and try again.",
  "auth/invalid-verification-code": "Wrong OTP. Please check and try again.",
  "auth/code-expired": "OTP expired. Please request a new one.",
  "auth/quota-exceeded": "SMS limit reached for today. Please call us to order.",
  "auth/captcha-check-failed": "Verification failed. Please reload and try again.",
  "auth/billing-not-enabled": "OTP SMS not enabled yet (restaurant setup pending).",
  "auth/operation-not-allowed": "Phone login is not enabled yet (restaurant setup pending).",
};
export const authMsg = (e) => AUTH_ERR[e?.code] || e?.message || "Something went wrong";

export function phoneLogin(container, onDone) {
  container.innerHTML = `
    <div class="login">
      <label>Mobile number
        <div class="phone-in"><span>+91</span><input id="pl-phone" inputmode="numeric" maxlength="10" autocomplete="tel-national" placeholder="10-digit mobile"></div>
      </label>
      <button class="btn primary block" id="pl-send">Send OTP</button>
      <div id="pl-otp-wrap" hidden>
        <label>Enter the 6-digit OTP sent by SMS
          <input id="pl-otp" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="••••••"></label>
        <button class="btn primary block" id="pl-verify">Verify & continue</button>
        <button class="btn link" id="pl-change">Change number</button>
      </div>
      <div id="pl-cap"></div>
    </div>`;
  const phoneEl = $("#pl-phone", container), send = $("#pl-send", container), wrap = $("#pl-otp-wrap", container);
  const otpEl = $("#pl-otp", container), verify = $("#pl-verify", container), cap = $("#pl-cap", container);
  let verifier = null, confirmation = null;

  send.onclick = async () => {
    const phone = normPhone(phoneEl.value);
    if (!phone) return toast("Enter a valid 10-digit mobile number", "err");
    send.disabled = true; send.textContent = "Sending…";
    try {
      if (!verifier) {
        cap.innerHTML = ""; const box = document.createElement("div"); cap.append(box);
        verifier = new RecaptchaVerifier(auth, box, { size: "invisible" });
      }
      confirmation = await signInWithPhoneNumber(auth, phone, verifier);
      wrap.hidden = false; send.hidden = true; phoneEl.disabled = true; otpEl.focus();
      toast("OTP sent to " + prettyPhone(phone));
    } catch (e) {
      toast(authMsg(e), "err");
      try { verifier?.clear(); } catch {}
      verifier = null;
    } finally { send.disabled = false; send.textContent = "Send OTP"; }
  };
  phoneEl.addEventListener("keydown", (e) => e.key === "Enter" && send.click());
  verify.onclick = async () => {
    const code = otpEl.value.replace(/\D/g, "");
    if (code.length !== 6) return toast("Enter the 6-digit OTP", "err");
    verify.disabled = true; verify.textContent = "Verifying…";
    try { await confirmation.confirm(code); onDone && onDone(); }
    catch (e) { toast(authMsg(e), "err"); }
    finally { verify.disabled = false; verify.textContent = "Verify & continue"; }
  };
  otpEl.addEventListener("keydown", (e) => e.key === "Enter" && verify.click());
  $("#pl-change", container).onclick = () => { wrap.hidden = true; send.hidden = false; phoneEl.disabled = false; otpEl.value = ""; };
}
