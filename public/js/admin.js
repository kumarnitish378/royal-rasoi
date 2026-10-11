import {
  db, auth, onAuthStateChanged, signOut, $, $$, esc, rupee, km, toast, patch, STATUS, ACTIVE,
  fmtTime, ago, tsMs, watchSettings, phoneLogin, makeMap, emo, getRole, normPhone, prettyPhone, mapsLink, DEFAULT_SETTINGS,
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, serverTimestamp, arrayUnion, writeBatch, Timestamp,
} from "./common.js";
import { DEFAULT_MENU, slug } from "./menu-data.js";

let me = null, settings = { ...DEFAULT_SETTINGS }, orders = [], menu = [], staff = [], riderLocs = {};
let filter = "active", started = false, firstOrders = true, seen = new Set(), soundOn = false, audioCtx = null;
const unsubs = [];

// ---------------- auth gate ----------------
onAuthStateChanged(auth, async (u) => {
  const gate = $("#gate");
  $("#logout").hidden = !u;
  if (!u) {
    $("#dash").hidden = true; gate.hidden = false;
    gate.innerHTML = `<h2>Restaurant login</h2><p class="muted sm">Only registered owner/manager numbers can open the dashboard.</p><div id="lg"></div>`;
    phoneLogin($("#lg"), () => {}); return;
  }
  gate.innerHTML = `<p class="muted">Checking access…</p>`;
  const role = await getRole(u.phoneNumber);
  if (role?.role !== "admin") {
    gate.innerHTML = `<h2>No access</h2><p>${esc(prettyPhone(u.phoneNumber))} is not registered as a restaurant manager.</p>
      <p class="sm muted">First-time setup: add this number in Firestore → <code>roles</code> (see README).</p>`;
    return;
  }
  me = { phone: u.phoneNumber, name: role.name || "Manager" };
  gate.hidden = true; $("#dash").hidden = false; $("#sound-btn").hidden = false;
  if (!started) start();
});
$("#logout").onclick = async () => { unsubs.splice(0).forEach((f) => f()); started = false; await signOut(auth); location.reload(); };

// ---------------- sound alert ----------------
$("#sound-btn").onclick = () => {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  audioCtx.resume(); soundOn = true; beep();
  $("#sound-btn").textContent = "🔔 Alert on"; $("#sound-btn").classList.add("green");
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
};
function beep() {
  if (!soundOn || !audioCtx) return;
  [0, 0.35, 0.7].forEach((t) => {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = "square"; o.frequency.value = 880; g.gain.value = 0.15;
    o.connect(g).connect(audioCtx.destination);
    o.start(audioCtx.currentTime + t); o.stop(audioCtx.currentTime + t + 0.2);
  });
}
function alertNew(o) {
  beep(); toast(`🔔 New order #${o.id} · ${rupee(o.total)}`);
  try { if (Notification.permission === "granted") new Notification("New order – Royal Rasoi", { body: `${o.customerName} · ${rupee(o.total)}` }); } catch {}
}

// ---------------- tabs ----------------
$("#tabs").onclick = (e) => {
  const b = e.target.closest("button"); if (!b) return;
  $$("#tabs button").forEach((x) => x.classList.toggle("on", x === b));
  ["orders", "riders", "menu", "settings"].forEach((t) => ($("#t-" + t).hidden = t !== b.dataset.t));
  if (b.dataset.t === "riders") renderRiderMap();
  if (b.dataset.t === "settings") renderSettings();
};
$("#ord-filter").onclick = (e) => {
  const b = e.target.closest("button"); if (!b) return;
  filter = b.dataset.f; $$("#ord-filter button").forEach((x) => x.classList.toggle("on", x === b)); renderOrders(true);
};

// ---------------- live data ----------------
function start() {
  started = true;
  $("#rider-url").textContent = location.origin + "/rider.html";
  unsubs.push(watchSettings((s) => {
    settings = s; $("#shop-open").checked = !!s.open;
    $("#shop-open-txt").textContent = s.open ? "Shop open" : "Shop closed";
  }));
  const since = Timestamp.fromMillis(Date.now() - 7 * 86400000);
  unsubs.push(onSnapshot(query(collection(db, "orders"), where("createdAt", ">=", since)), (snap) => {
    orders = snap.docs.map((d) => d.data()).sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
    for (const o of orders) {
      if (!seen.has(o.id)) { seen.add(o.id); if (!firstOrders && o.status === "placed") alertNew(o); }
    }
    firstOrders = false; renderOrders();
  }, (e) => toast("Orders: " + e.code, "err")));
  unsubs.push(onSnapshot(collection(db, "menu"), (snap) => {
    menu = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    renderMenu(); renderOrders(true);
  }));
  unsubs.push(onSnapshot(collection(db, "roles"), (snap) => {
    staff = snap.docs.map((d) => ({ phone: d.id, ...d.data() })); renderStaff(); renderOrders(true);
  }));
  unsubs.push(onSnapshot(collection(db, "riderLocations"), (snap) => {
    riderLocs = {}; snap.docs.forEach((d) => (riderLocs[d.id] = d.data())); renderStaff(); renderRiderMap();
  }));
  setInterval(() => renderOrders(true), 30000); // refresh "x min ago"
}

$("#shop-open").onchange = async (e) => {
  try { await setDoc(doc(db, "settings", "main"), { open: e.target.checked }, { merge: true }); toast(e.target.checked ? "Shop is OPEN for orders" : "Shop is CLOSED"); }
  catch (err) { toast(err.code, "err"); e.target.checked = !e.target.checked; }
};

// ---------------- orders ----------------
function priceIssues(o) {
  if (!menu.length) return [];
  const issues = [];
  let sum = 0;
  for (const i of o.items) {
    sum += i.price * i.qty;
    const m = menu.find((x) => x.id === i.itemId);
    const v = m?.variants.find((x) => (x.label || "") === (i.variant || ""));
    if (!v) issues.push(`${i.name}: not on current menu`);
    else if (Number(v.price) !== Number(i.price)) issues.push(`${i.name}: ordered at ${rupee(i.price)}, menu price ${rupee(v.price)}`);
  }
  if (Math.round(sum + (o.deliveryFee || 0)) !== Math.round(o.total)) issues.push(`Total doesn't add up (items ${rupee(sum)} + delivery ${rupee(o.deliveryFee || 0)})`);
  return issues;
}

function renderOrders(force) {
  const box = $("#orders");
  if (force) box._h = null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todays = orders.filter((o) => tsMs(o.createdAt) >= today.getTime());
  const delivered = todays.filter((o) => o.status === "delivered");
  const active = orders.filter((o) => ACTIVE.includes(o.status));
  const newCount = orders.filter((o) => o.status === "placed").length;
  $("#new-count").hidden = !newCount; $("#new-count").textContent = newCount;
  document.title = (newCount ? `(${newCount}) ` : "") + "Royal Rasoi – Dashboard";
  patch($("#stats"), `
    <div class="stat"><b>${newCount}</b><span>New (waiting)</span></div>
    <div class="stat"><b>${active.length}</b><span>Active orders</span></div>
    <div class="stat"><b>${delivered.length}</b><span>Delivered today</span></div>
    <div class="stat"><b>${rupee(delivered.reduce((a, o) => a + o.total, 0))}</b><span>Sales today</span></div>
    <div class="stat"><b>${rupee(delivered.filter((o) => o.payment.method === "cod").reduce((a, o) => a + o.total, 0))}</b><span>Cash today</span></div>`);

  const list = filter === "active" ? active.slice().sort((a, b) => tsMs(a.createdAt) - tsMs(b.createdAt))
    : orders.filter((o) => o.status === filter);
  const riders = staff.filter((s) => s.role === "rider");
  patch(box, list.length ? list.map((o) => orderCard(o, riders)).join("")
    : `<p class="muted center" style="margin:30px 0">${filter === "active" ? "No active orders right now." : "Nothing here in the last 7 days."}</p>`);
}

function orderCard(o, riders) {
  const issues = priceIssues(o);
  const wa = "https://wa.me/" + o.phone.replace("+", "") + "?text=" + encodeURIComponent(`Royal Rasoi: about your order #${o.id}`);
  const p = o.payment;
  const payTxt = p.method === "cod" ? `💵 Cash on delivery` : `📱 UPI${p.utr ? ` · UTR <b>${esc(p.utr)}</b>` : " · not paid yet"}`;
  const actions = {
    placed: `<button class="btn green" data-act="accepted" data-id="${o.id}">✓ Accept</button><button class="btn danger" data-act="cancelled" data-id="${o.id}">Reject</button>`,
    accepted: `<button class="btn primary" data-act="preparing" data-id="${o.id}">Start preparing</button>`,
    preparing: `<button class="btn primary" data-act="out_for_delivery" data-id="${o.id}">🛵 Send out for delivery</button>`,
    out_for_delivery: `<button class="btn green" data-act="delivered" data-id="${o.id}">✓ Mark delivered</button>`,
  }[o.status] || "";
  const riderSel = ACTIVE.includes(o.status) ? `<label>Rider
      <select data-rider="${o.id}"><option value="">— Assign rider —</option>
      ${riders.map((r) => `<option value="${esc(r.phone)}" ${o.riderPhone === r.phone ? "selected" : ""}>${esc(r.name)} ${riderLocs[r.phone]?.onDuty ? "🟢" : "⚪"}</option>`).join("")}
      </select></label>` : (o.riderName ? `<p class="sm">Rider: ${esc(o.riderName)}</p>` : "");
  return `<div class="card ocard ${o.status}">
    <div class="row" style="justify-content:space-between"><b>#${esc(o.id)}</b><span><span class="pill ${o.status}">${STATUS[o.status]}</span> <span class="sm muted">${ago(o.createdAt)}</span></span></div>
    <div class="row" style="justify-content:space-between;margin-top:6px">
      <span><b>${esc(o.customerName)}</b> · ${esc(prettyPhone(o.phone))}</span>
      <span class="row"><a class="btn sm" href="tel:${esc(o.phone)}">📞</a><a class="btn sm" href="${wa}" target="_blank" rel="noopener">WhatsApp</a></span>
    </div>
    <p class="sm" style="margin:6px 0">${esc(o.address)}${o.landmark ? ", near " + esc(o.landmark) : ""} · <a href="${mapsLink(o.location)}" target="_blank" rel="noopener">📍 Map (${o.distanceKm} km)</a></p>
    <div class="items">${o.items.map((i) => `<div class="kv"><span>${i.qty} × ${esc(i.name)}${i.variant ? ` <b>(${esc(i.variant)})</b>` : ""}${Object.keys(i.options || {}).length ? `<br><small class="muted">${esc(Object.entries(i.options).map(([k, v]) => k + ": " + v).join(", "))}</small>` : ""}</span><span>${rupee(i.price * i.qty)}</span></div>`).join("")}
      <div class="kv" style="border-top:1px solid var(--line);margin-top:4px;padding-top:4px"><b>Total</b><b>${rupee(o.total)}</b></div></div>
    ${o.note ? `<p class="warn">📝 ${esc(o.note)}</p>` : ""}
    ${issues.length ? `<p class="warn">⚠ Price check: ${issues.map(esc).join("; ")}</p>` : ""}
    <div class="row" style="justify-content:space-between"><span class="sm">${payTxt} · ${p.status === "paid" ? '<span class="ok">PAID</span>' : '<span class="bad">UNPAID</span>'}</span>
      ${p.status !== "paid" && o.status !== "cancelled" ? `<button class="btn sm" data-paid="${o.id}">Mark paid</button>` : ""}</div>
    ${riderSel}
    <div class="row" style="margin-top:10px">${actions}
      ${["accepted", "preparing", "out_for_delivery"].includes(o.status) ? `<button class="btn ghost sm" data-act="cancelled" data-id="${o.id}">Cancel</button>` : ""}</div>
  </div>`;
}

$("#orders").addEventListener("click", async (e) => {
  const a = e.target.closest("[data-act]"), pd = e.target.closest("[data-paid]");
  if (a) {
    const o = orders.find((x) => x.id === a.dataset.id), next = a.dataset.act;
    if (next === "out_for_delivery" && !o.riderPhone) return toast("Assign a rider first", "err");
    if (next === "cancelled" && !confirm(`Cancel order #${o.id}? Call the customer to inform them.`)) return;
    if (next === "delivered" && o.payment.status !== "paid" && !confirm("Payment not marked as received. Mark delivered anyway?")) return;
    a.disabled = true;
    try {
      await updateDoc(doc(db, "orders", o.id), {
        status: next, statusHistory: arrayUnion({ status: next, at: Date.now(), by: "restaurant" }), updatedAt: serverTimestamp(),
        ...(next === "delivered" ? { deliveredAt: serverTimestamp() } : {}),
        ...(next === "cancelled" ? { cancelledBy: "restaurant" } : {}),
      });
    } catch (err) { toast(err.code, "err"); a.disabled = false; }
  }
  if (pd) {
    const o = orders.find((x) => x.id === pd.dataset.paid);
    if (!confirm(`Confirm ${rupee(o.total)} received for #${o.id}?`)) return;
    try { await updateDoc(doc(db, "orders", o.id), { payment: { ...o.payment, status: "paid", confirmedBy: me.phone }, updatedAt: serverTimestamp() }); toast("Marked paid"); }
    catch (err) { toast(err.code, "err"); }
  }
});
$("#orders").addEventListener("change", async (e) => {
  const s = e.target.closest("[data-rider]"); if (!s) return;
  const r = staff.find((x) => x.phone === s.value);
  try {
    await updateDoc(doc(db, "orders", s.dataset.rider), { riderPhone: r ? r.phone : null, riderName: r ? r.name : null, updatedAt: serverTimestamp() });
    toast(r ? `Assigned to ${r.name}` : "Rider removed");
  } catch (err) { toast(err.code, "err"); }
});

// ---------------- staff & rider map ----------------
function renderStaff() {
  $("#staff").innerHTML = staff.length ? `<div class="card">${staff.map((s) => {
    const loc = riderLocs[s.phone];
    const live = s.role === "rider" ? (loc?.onDuty ? `<span class="ok">● On duty · ${ago(loc.at)}</span>` : `<span class="muted">● Off duty</span>`) : "";
    return `<div class="mrow"><div class="nm"><b>${esc(s.name || "")}</b> <span class="pill">${s.role === "admin" ? "Manager" : "Rider"}</span><br>
      <small>${esc(prettyPhone(s.phone))}</small> ${live}</div>
      <a class="btn sm" href="tel:${esc(s.phone)}">📞</a>
      ${s.phone !== me?.phone ? `<button class="btn danger sm" data-del-staff="${esc(s.phone)}">Remove</button>` : ""}</div>`;
  }).join("")}</div>` : "";
}
$("#staff").onclick = async (e) => {
  const b = e.target.closest("[data-del-staff]"); if (!b) return;
  if (!confirm("Remove " + prettyPhone(b.dataset.delStaff) + "?")) return;
  try { await deleteDoc(doc(db, "roles", b.dataset.delStaff)); toast("Removed"); } catch (err) { toast(err.code, "err"); }
};
$("#st-add").onclick = async () => {
  const name = $("#st-name").value.trim(), phone = normPhone($("#st-phone").value), role = $("#st-role").value;
  if (!name) return toast("Enter a name", "err");
  if (!phone) return toast("Enter a valid 10-digit mobile", "err");
  try { await setDoc(doc(db, "roles", phone), { name, role, addedAt: serverTimestamp() }); $("#st-name").value = $("#st-phone").value = ""; toast(`${name} added as ${role}`); }
  catch (err) { toast(err.code, "err"); }
};

let rMap = null, rMarkers = {};
function renderRiderMap() {
  if ($("#t-riders").hidden) return;
  if (!rMap) {
    rMap = makeMap($("#riders-map"), settings, 14);
    L.marker([settings.lat, settings.lng], { icon: emo("🍽️") }).addTo(rMap).bindTooltip("Royal Rasoi");
  } else setTimeout(() => rMap.invalidateSize(), 100);
  for (const [phone, l] of Object.entries(riderLocs)) {
    const show = l.onDuty && Date.now() - l.at < 30 * 60000;
    if (!show) { rMarkers[phone]?.remove(); delete rMarkers[phone]; continue; }
    const tip = `${l.name || phone} · ${ago(l.at)}`;
    if (rMarkers[phone]) rMarkers[phone].setLatLng([l.lat, l.lng]).setTooltipContent(tip);
    else rMarkers[phone] = L.marker([l.lat, l.lng], { icon: emo("🛵", "rider") }).addTo(rMap).bindTooltip(tip, { permanent: true, direction: "top", offset: [0, -16] });
  }
}

// ---------------- menu admin ----------------
function renderMenu() {
  const cats = [...new Set(menu.map((m) => m.category))];
  $("#menu-admin").innerHTML = menu.length ? cats.map((c) => `<div class="card"><h3>${esc(c)}</h3>
    ${menu.filter((m) => m.category === c).map((m) => `<div class="mrow">
      <span class="dot ${m.veg ? "veg" : "nv"}"></span>
      <div class="nm" data-edit="${m.id}" style="cursor:pointer"><b>${esc(m.name)}</b><br><small>${m.variants.map((v) => `${v.label ? esc(v.label) + " " : ""}${rupee(v.price)}`).join(" · ")}</small></div>
      <label class="tgl" title="Available"><input type="checkbox" data-avail="${m.id}" ${m.available !== false ? "checked" : ""}><span></span></label>
    </div>`).join("")}</div>`).join("")
    : `<div class="card"><p>No dishes yet. Tap <b>Load default Royal Rasoi menu</b> to add all dishes from your printed menus.</p></div>`;
}
$("#menu-admin").addEventListener("change", async (e) => {
  const t = e.target.closest("[data-avail]"); if (!t) return;
  try { await updateDoc(doc(db, "menu", t.dataset.avail), { available: t.checked }); toast(t.checked ? "Available" : "Marked sold out"); }
  catch (err) { toast(err.code, "err"); t.checked = !t.checked; }
});
$("#menu-admin").addEventListener("click", (e) => {
  const n = e.target.closest("[data-edit]"); if (n) editDish(menu.find((m) => m.id === n.dataset.edit));
});
$("#m-add").onclick = () => editDish(null);
$("#m-seed").onclick = async () => {
  if (menu.length && !confirm(`This will reset ${DEFAULT_MENU.length} dishes to the printed-menu prices (your extra dishes stay). Continue?`)) return;
  const b = writeBatch(db);
  DEFAULT_MENU.forEach(({ id, ...d }) => b.set(doc(db, "menu", id), d));
  try { await b.commit(); toast(`Loaded ${DEFAULT_MENU.length} dishes`); } catch (err) { toast(err.code, "err"); }
};

function openSheet(html, mount) {
  $("#sheet-body").innerHTML = html; $("#sheet").hidden = false; mount && mount($("#sheet-body"));
}
function closeSheet() { $("#sheet").hidden = true; $("#sheet-body").innerHTML = ""; }
$("#sheet").addEventListener("click", (e) => { if (e.target.hasAttribute("data-close")) closeSheet(); });

const parseVariants = (t) => t.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
  const i = l.lastIndexOf(":"); const label = i >= 0 ? l.slice(0, i).trim() : ""; const price = Number((i >= 0 ? l.slice(i + 1) : l).replace(/[^\d.]/g, ""));
  return { label, price };
});
const parseOptions = (t) => t.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
  const i = l.indexOf(":"); return { name: l.slice(0, i).trim(), options: l.slice(i + 1).split("|").map((x) => x.trim()).filter(Boolean) };
}).filter((g) => g.name && g.options.length);

function editDish(m) {
  const cats = [...new Set(menu.map((x) => x.category))];
  const d = m || { name: "", desc: "", category: cats[0] || "", cuisine: "chinese", veg: true, variants: [{ label: "", price: 0 }], optionGroups: [], image: "", available: true, sort: (menu.at(-1)?.sort || 0) + 10 };
  openSheet(`<h2>${m ? "Edit dish" : "Add dish"}</h2>
    <label>Name<input id="d-name" value="${esc(d.name)}"></label>
    <label>Description (optional)<input id="d-desc" value="${esc(d.desc)}"></label>
    <div class="grid2">
      <label>Category<input id="d-cat" list="cat-list" value="${esc(d.category)}"><datalist id="cat-list">${cats.map((c) => `<option value="${esc(c)}">`).join("")}</datalist></label>
      <label>Cuisine<select id="d-cui">${["chinese", "italian", "beverage"].map((c) => `<option value="${c}" ${d.cuisine === c ? "selected" : ""}>${{ chinese: "Indo-Chinese", italian: "Indo-Italian", beverage: "Beverage" }[c]}</option>`).join("")}</select></label>
      <label>Type<select id="d-veg"><option value="1" ${d.veg ? "selected" : ""}>🟢 Veg</option><option value="0" ${!d.veg ? "selected" : ""}>🔴 Non-veg</option></select></label>
      <label>Display order<input id="d-sort" type="number" value="${d.sort ?? 0}"></label>
    </div>
    <label>Sizes &amp; prices — one per line as <code>Label: price</code> (e.g. <code>Half: 50</code>). For a single price just write <code>45</code>.
      <textarea id="d-var" rows="3">${esc(d.variants.map((v) => (v.label ? v.label + ": " : "") + v.price).join("\n"))}</textarea></label>
    <label>Choices for combos (optional) — one per line as <code>Group: A | B | C</code>
      <textarea id="d-opt" rows="2">${esc((d.optionGroups || []).map((g) => g.name + ": " + g.options.join(" | ")).join("\n"))}</textarea></label>
    <label>Photo URL (optional)<input id="d-img" value="${esc(d.image || "")}" placeholder="https://…"></label>
    <div class="row" style="margin-top:14px">
      <button class="btn primary" id="d-save">Save</button>
      ${m ? `<button class="btn danger" id="d-del">Delete dish</button>` : ""}
    </div>`, (b) => {
    $("#d-save", b).onclick = async () => {
      const name = $("#d-name", b).value.trim();
      const variants = parseVariants($("#d-var", b).value);
      if (!name) return toast("Enter a name", "err");
      if (!variants.length || variants.some((v) => !(v.price > 0))) return toast("Check prices — each line needs a price", "err");
      const data = {
        name, desc: $("#d-desc", b).value.trim(), category: $("#d-cat", b).value.trim() || "Other",
        cuisine: $("#d-cui", b).value, veg: $("#d-veg", b).value === "1", sort: Number($("#d-sort", b).value) || 0,
        variants, optionGroups: parseOptions($("#d-opt", b).value), image: $("#d-img", b).value.trim(),
        available: d.available !== false,
      };
      const id = m ? m.id : `${data.cuisine}-${slug(name)}-${Math.random().toString(36).slice(2, 6)}`;
      try { await setDoc(doc(db, "menu", id), data); toast("Saved"); closeSheet(); } catch (err) { toast(err.code, "err"); }
    };
    const del = $("#d-del", b);
    if (del) del.onclick = async () => {
      if (!confirm(`Delete ${m.name}? (Tip: switch it off instead if it's only sold out today.)`)) return;
      try { await deleteDoc(doc(db, "menu", m.id)); toast("Deleted"); closeSheet(); } catch (err) { toast(err.code, "err"); }
    };
  });
}

// ---------------- settings ----------------
let sMap = null, sMarker = null, sPin = null;
function renderSettings() {
  const f = $("#settings-form"), s = settings;
  for (const k of ["name", "hours", "address", "email", "radiusKm", "deliveryFee", "freeAbove", "minOrder", "upiId", "upiName"]) f.elements[k].value = s[k] ?? "";
  f.elements.phones.value = (s.phones || []).join(", ");
  sPin = { lat: s.lat, lng: s.lng };
  if (!sMap) {
    sMap = makeMap($("#set-map"), sPin, 16);
    sMarker = L.marker([sPin.lat, sPin.lng], { draggable: true, icon: emo("🍽️") }).addTo(sMap);
    sMarker.on("dragend", () => setLoc(sMarker.getLatLng()));
    sMap.on("click", (e) => setLoc(e.latlng));
  } else { sMarker.setLatLng([sPin.lat, sPin.lng]); sMap.setView([sPin.lat, sPin.lng]); setTimeout(() => sMap.invalidateSize(), 100); }
  $("#loc-txt").innerHTML = s.locationSet ? `<span class="ok">✓ Location saved</span>` : `<span class="bad">⚠ Location not set yet — the delivery area check is using an approximate Chakia point.</span>`;
}
function setLoc(ll) {
  sPin = { lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6) };
  sMarker.setLatLng([sPin.lat, sPin.lng]); sMap.setView([sPin.lat, sPin.lng], 17);
  $("#loc-txt").textContent = `New location: ${sPin.lat}, ${sPin.lng} — press Save settings.`;
}
$("#loc-gps").onclick = () => navigator.geolocation.getCurrentPosition(
  (p) => setLoc({ lat: p.coords.latitude, lng: p.coords.longitude }),
  () => toast("Couldn't get location. Turn on GPS.", "err"), { enableHighAccuracy: true, timeout: 15000 });
$("#settings-form").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target, n = (k) => Number(f.elements[k].value) || 0;
  const phones = f.elements.phones.value.split(",").map(normPhone).filter(Boolean);
  const upiId = f.elements.upiId.value.trim();
  if (upiId && !/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(upiId)) return toast("UPI ID looks wrong (e.g. name@okaxis)", "err");
  const moved = sPin.lat !== settings.lat || sPin.lng !== settings.lng;
  try {
    await setDoc(doc(db, "settings", "main"), {
      name: f.elements.name.value.trim(), hours: f.elements.hours.value.trim(), address: f.elements.address.value.trim(),
      email: f.elements.email.value.trim(), phones, radiusKm: n("radiusKm") || 3, deliveryFee: n("deliveryFee"), freeAbove: n("freeAbove"),
      minOrder: n("minOrder"), upiId, upiName: f.elements.upiName.value.trim(), lat: sPin.lat, lng: sPin.lng,
      locationSet: settings.locationSet || moved, open: settings.open,
    }, { merge: true });
    toast("Settings saved"); renderSettings();
  } catch (err) { toast(err.code, "err"); }
};
