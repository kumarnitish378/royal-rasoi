import {
  db, auth, onAuthStateChanged, signOut, $, esc, rupee, km, toast, patch, STATUS, fmtTime, ago, tsMs,
  phoneLogin, getRole, prettyPhone, navLink, mapsLink,
  collection, doc, setDoc, updateDoc, onSnapshot, query, where, serverTimestamp, arrayUnion,
} from "./common.js";

let me = null, jobs = [], watchId = null, wakeLock = null, last = null, lastWrite = 0, unsubJobs = null;

onAuthStateChanged(auth, async (u) => {
  const gate = $("#gate");
  $("#logout").hidden = !u;
  if (!u) {
    $("#app").hidden = true; gate.hidden = false;
    gate.innerHTML = `<h2>Rider login</h2><p class="muted sm">Log in with the mobile number the restaurant registered for you.</p><div id="lg"></div>`;
    phoneLogin($("#lg"), () => {}); return;
  }
  gate.innerHTML = `<p class="muted">Checking…</p>`;
  const role = await getRole(u.phoneNumber);
  if (role?.role !== "rider" && role?.role !== "admin") {
    gate.innerHTML = `<h2>Not registered</h2><p>${esc(prettyPhone(u.phoneNumber))} is not registered as a rider. Ask the restaurant to add you.</p>`; return;
  }
  me = { phone: u.phoneNumber, name: role.name || "Rider", role: role.role };
  gate.hidden = true; $("#app").hidden = false;
  startJobs();
  try { if (localStorage.getItem("rr_duty") === "1") startDuty(); } catch {}
});
$("#logout").onclick = async () => { await stopDuty(); unsubJobs?.(); await signOut(auth); location.reload(); };

// ---------------- jobs ----------------
function startJobs() {
  unsubJobs = onSnapshot(query(collection(db, "orders"), where("riderPhone", "==", me.phone)), (snap) => {
    const all = snap.docs.map((d) => d.data());
    const today = new Date(); today.setHours(0, 0, 0, 0);
    jobs = all.filter((o) => ["accepted", "preparing", "out_for_delivery"].includes(o.status)).sort((a, b) => tsMs(a.createdAt) - tsMs(b.createdAt));
    const done = all.filter((o) => o.status === "delivered" && tsMs(o.deliveredAt || o.updatedAt) >= today.getTime());
    const cash = done.filter((o) => o.payment.method === "cod").reduce((a, o) => a + o.total, 0);
    $("#done-today").textContent = done.length ? `Today: ${done.length} delivered · cash collected ${rupee(cash)}` : "";
    renderJobs();
  }, (e) => toast("Orders: " + e.code, "err"));
}

function renderJobs() {
  patch($("#jobs"), jobs.length ? jobs.map((o) => {
    const p = o.payment;
    const collect = p.status === "paid" ? `<span class="ok">✓ Already paid</span>`
      : p.method === "cod" ? `<span class="collect">Collect ${rupee(o.total)} cash</span>`
      : `<span class="collect">UPI not confirmed — collect ${rupee(o.total)}</span>`;
    const dist = last ? km(last, o.location) : null;
    return `<div class="card ocard ${o.status}">
      <div class="row" style="justify-content:space-between"><b>#${esc(o.id)}</b><span class="pill ${o.status}">${STATUS[o.status]}</span></div>
      <p style="margin:6px 0"><b>${esc(o.customerName)}</b> · <a href="tel:${esc(o.phone)}">${esc(prettyPhone(o.phone))}</a></p>
      <p class="sm" style="margin:4px 0">${esc(o.address)}${o.landmark ? ", near " + esc(o.landmark) : ""}${dist != null ? ` · <b>${dist.toFixed(1)} km</b> from you` : ""}</p>
      ${o.note ? `<p class="warn">📝 ${esc(o.note)}</p>` : ""}
      <p class="sm muted">${o.items.map((i) => `${i.qty}× ${esc(i.name)}${i.variant ? " (" + esc(i.variant) + ")" : ""}`).join(", ")}</p>
      <p>${collect}</p>
      <div class="row">
        <a class="btn" href="${navLink(o.location)}" target="_blank" rel="noopener">🧭 Navigate</a>
        <a class="btn" href="tel:${esc(o.phone)}">📞 Call</a>
        ${o.status === "out_for_delivery"
          ? `<button class="btn green" data-deliver="${o.id}">✓ Delivered</button>`
          : `<button class="btn primary" data-pickup="${o.id}">Picked up — start delivery</button>`}
      </div></div>`;
  }).join("") : `<div class="card center"><p class="muted">No orders assigned right now.</p></div>`);
}

$("#jobs").addEventListener("click", async (e) => {
  const pk = e.target.closest("[data-pickup]"), dv = e.target.closest("[data-deliver]");
  if (pk) {
    const o = jobs.find((x) => x.id === pk.dataset.pickup);
    if (!watchId) startDuty();
    pk.disabled = true;
    try {
      await updateDoc(doc(db, "orders", o.id), {
        status: "out_for_delivery", statusHistory: arrayUnion({ status: "out_for_delivery", at: Date.now(), by: "rider" }),
        ...(last ? { riderLocation: { lat: last.lat, lng: last.lng, at: Date.now() } } : {}), updatedAt: serverTimestamp(),
      });
      toast("Customer can now track you live 🛵");
    } catch (err) { toast(err.code, "err"); pk.disabled = false; }
  }
  if (dv) {
    const o = jobs.find((x) => x.id === dv.dataset.deliver);
    const needCash = o.payment.status !== "paid";
    if (!confirm(needCash ? `Delivered #${o.id} and collected ${rupee(o.total)}?` : `Mark #${o.id} as delivered?`)) return;
    dv.disabled = true;
    try {
      await updateDoc(doc(db, "orders", o.id), {
        status: "delivered", deliveredAt: serverTimestamp(), statusHistory: arrayUnion({ status: "delivered", at: Date.now(), by: "rider" }),
        ...(needCash ? { payment: { ...o.payment, status: "paid", collectedBy: me.phone, collectedAs: o.payment.method === "cod" ? "cash" : "rider-collected" } } : {}),
        updatedAt: serverTimestamp(),
      });
      toast("Delivered ✓");
    } catch (err) { toast(err.code, "err"); dv.disabled = false; }
  }
});

// ---------------- duty & GPS ----------------
$("#duty-btn").onclick = () => (watchId ? stopDuty() : startDuty());

async function keepAwake() {
  try { if ("wakeLock" in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => (wakeLock = null)); } } catch {}
}
document.addEventListener("visibilitychange", () => { if (watchId && document.visibilityState === "visible") keepAwake(); });

function startDuty() {
  if (!navigator.geolocation) return toast("GPS not available on this phone", "err");
  watchId = navigator.geolocation.watchPosition(onPos, (err) => {
    $("#gps-info").textContent = err.code === 1 ? "Location permission denied — allow it in browser settings" : "Waiting for GPS…";
    if (err.code === 1) { stopDuty(); toast("Please allow location access", "err"); }
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  keepAwake();
  try { localStorage.setItem("rr_duty", "1"); } catch {}
  $("#duty-state").textContent = "On duty"; $("#duty-btn").textContent = "End duty";
  $("#duty-btn").className = "btn danger"; $("#duty-card").classList.add("on");
  $("#gps-info").textContent = "Getting GPS…";
}

async function stopDuty() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  try { await wakeLock?.release(); } catch {}
  wakeLock = null;
  try { localStorage.setItem("rr_duty", "0"); } catch {}
  $("#duty-state").textContent = "Off duty"; $("#duty-btn").textContent = "Start duty";
  $("#duty-btn").className = "btn primary"; $("#duty-card").classList.remove("on");
  $("#gps-info").textContent = "Location is not being shared";
  if (me) { try { await setDoc(doc(db, "riderLocations", me.phone), { onDuty: false, at: Date.now(), name: me.name }, { merge: true }); } catch {} }
}

async function onPos(p) {
  const cur = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) };
  const now = Date.now();
  const moved = last ? km(last, cur) * 1000 : Infinity;
  last = cur;
  $("#gps-info").textContent = `GPS ±${Math.round(p.coords.accuracy)} m · updated ${new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
  // write at most every 8 s, or every 3 s if moved > 40 m
  if (now - lastWrite < 8000 && !(moved > 40 && now - lastWrite > 3000)) return;
  lastWrite = now;
  const loc = { lat: cur.lat, lng: cur.lng, at: now };
  try {
    await setDoc(doc(db, "riderLocations", me.phone), { ...loc, acc: Math.round(p.coords.accuracy), onDuty: true, name: me.name });
    await Promise.all(jobs.filter((o) => o.status === "out_for_delivery").map((o) =>
      updateDoc(doc(db, "orders", o.id), { riderLocation: loc, updatedAt: serverTimestamp() })));
  } catch (e) { console.warn(e); }
  renderJobs();
}
