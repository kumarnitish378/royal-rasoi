import {
  db, auth, onAuthStateChanged, signOut, $, $$, esc, rupee, km, toast, patch, STATUS, STEPS, ACTIVE,
  fmtTime, ago, tsMs, watchSettings, phoneLogin, makeMap, emo, makeOrderId, feeFor, upiLink, prettyPhone, mapsLink,
  collection, doc, setDoc, updateDoc, onSnapshot, query, where, serverTimestamp, arrayUnion,
} from "./common.js";

// ---------------- state ----------------
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

let settings = null, menu = [], user = null;
let cart = load("rr_cart", []);
let profile = load("rr_profile", {});
let cuisine = "all", vegOnly = false, search = "";
let unsubTrack = null, unsubOrders = null, trackMap = null, trackMarkers = {}, trackFit = false;

// ---------------- data ----------------
watchSettings((s) => { settings = s; renderShop(); renderMenu(); renderCartBar(); });
onSnapshot(collection(db, "menu"), (snap) => {
  menu = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  syncCart(); renderMenu(); renderCartBar();
}, () => { $("#menu").innerHTML = `<p class="muted center">Couldn't load the menu. Please call us to order.</p>`; });
onAuthStateChanged(auth, (u) => { user = u; route(); });

// ---------------- shop header ----------------
function renderShop() {
  const s = settings;
  $("#shop-addr").textContent = "📍 " + s.address;
  const b = $("#open-badge");
  b.textContent = s.open ? `● Open now${s.hours ? " · " + s.hours : ""}` : "● Closed now";
  b.className = "badge " + (s.open ? "open" : "closed");
  const p = s.phones?.[0];
  if (p) $("#call-btn").href = "tel:" + p;
  const fee = s.deliveryFee ? `Delivery ${rupee(s.deliveryFee)}${s.freeAbove ? `, free above ${rupee(s.freeAbove)}` : ""}` : "Free delivery";
  $("#delivery-txt").textContent = `${fee} within ${s.radiusKm} km · Cash on delivery or UPI${s.minOrder ? ` · Min order ${rupee(s.minOrder)}` : ""}`;
  $("#foot-contact").innerHTML = (s.phones || []).map((x) => `<a href="tel:${x}">${prettyPhone(x)}</a>`).join(" | ") +
    (s.email ? ` | <a href="mailto:${esc(s.email)}">${esc(s.email)}</a>` : "");
}

// ---------------- menu ----------------
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-");
function renderMenu() {
  if (!settings) return;
  const box = $("#menu");
  if (!menu.length) { box.innerHTML = `<p class="muted center">Menu is being updated. Please call us to order.</p>`; $("#cat-chips").innerHTML = ""; return; }
  const q = search.trim().toLowerCase();
  const list = menu.filter((i) =>
    (cuisine === "all" || i.cuisine === cuisine || i.cuisine === "beverage") &&
    (!vegOnly || i.veg) &&
    (!q || `${i.name} ${i.desc || ""} ${i.category}`.toLowerCase().includes(q)));
  const cats = [], groups = {};
  for (const i of list) { if (!groups[i.category]) { groups[i.category] = []; cats.push(i.category); } groups[i.category].push(i); }
  $("#cat-chips").innerHTML = cats.map((c) => `<button class="chip" data-cat="${slug(c)}">${esc(c)}</button>`).join("");
  box.innerHTML = cats.length
    ? cats.map((c) => `<h3 class="cat" id="cat-${slug(c)}">${esc(c)}</h3><div class="grid">${groups[c].map(itemCard).join("")}</div>`).join("")
    : `<p class="muted center">No dishes match your search.</p>`;
}
function itemCard(i) {
  const inCart = cart.filter((l) => l.itemId === i.id).reduce((a, l) => a + l.qty, 0);
  let actions;
  if (i.available === false) actions = `<span class="soldout">Sold out today</span>`;
  else if (i.optionGroups?.length) actions = `<button class="btn add" data-combo="${i.id}">${rupee(i.variants[0].price)} · Choose <b>+</b></button>`;
  else actions = i.variants.map((v, vi) =>
    `<button class="btn add" data-add="${i.id}" data-v="${vi}">${v.label ? esc(v.label) + " · " : ""}${rupee(v.price)} <b>+</b></button>`).join("");
  return `<article class="item${i.available === false ? " off" : ""}">
    ${i.image ? `<img src="${esc(i.image)}" alt="${esc(i.name)}" loading="lazy">` : ""}
    <div class="item-main">
      <div class="item-head"><span class="dot ${i.veg ? "veg" : "nv"}" title="${i.veg ? "Veg" : "Non-veg"}"></span><h4>${esc(i.name)}</h4>${inCart ? `<span class="incart">${inCart} in cart</span>` : ""}</div>
      ${i.desc ? `<p class="desc">${esc(i.desc)}</p>` : ""}
      <div class="actions">${actions}</div>
    </div></article>`;
}

$("#menu").addEventListener("click", (e) => {
  const a = e.target.closest("[data-add]"), c = e.target.closest("[data-combo]");
  if (a) { const it = menu.find((m) => m.id === a.dataset.add); if (it) addLine(it, +a.dataset.v); }
  if (c) { const it = menu.find((m) => m.id === c.dataset.combo); if (it) openCombo(it); }
});
$("#cat-chips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cat]"); if (b) $("#cat-" + b.dataset.cat)?.scrollIntoView({ behavior: "smooth" });
});
$("#cuisine-seg").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  cuisine = b.dataset.c; $$("#cuisine-seg button").forEach((x) => x.classList.toggle("on", x === b)); renderMenu();
});
$("#veg-only").addEventListener("change", (e) => { vegOnly = e.target.checked; renderMenu(); });
$("#search").addEventListener("input", (e) => { search = e.target.value; renderMenu(); });

// ---------------- cart ----------------
function saveCart() { save("rr_cart", cart); renderCartBar(); renderMenu(); }
function addLine(item, vi, options = {}) {
  if (!settings?.open) return toast("Sorry, we're closed right now.", "err");
  const v = item.variants[vi];
  const key = `${item.id}|${vi}|${JSON.stringify(options)}`;
  const l = cart.find((x) => x.key === key);
  if (l) l.qty++;
  else cart.push({ key, itemId: item.id, name: item.name, variant: v.label || "", price: Number(v.price), qty: 1, options, veg: !!item.veg });
  saveCart(); toast(`Added ${item.name}${v.label ? " (" + v.label + ")" : ""}`);
}
/** Refresh prices from the live menu; drop items that no longer exist or are sold out. */
function syncCart() {
  if (!menu.length) return;
  const before = cart.length;
  cart = cart.filter((l) => {
    const it = menu.find((m) => m.id === l.itemId);
    if (!it || it.available === false) return false;
    const v = it.variants.find((x) => (x.label || "") === l.variant);
    if (!v) return false;
    l.price = Number(v.price); l.name = it.name; return true;
  });
  save("rr_cart", cart);
  if (cart.length < before) toast("Some items in your cart are no longer available and were removed.", "err");
}
const subtotal = () => cart.reduce((a, l) => a + l.price * l.qty, 0);
const count = () => cart.reduce((a, l) => a + l.qty, 0);

function renderCartBar() {
  const bar = $("#cart-bar");
  const onMenu = !location.hash || location.hash === "#/" || location.hash === "#";
  if (!cart.length || !onMenu) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.innerHTML = `<span>${count()} item${count() > 1 ? "s" : ""} · ${rupee(subtotal())}</span><span>View cart →</span>`;
}
$("#cart-bar").onclick = () => openCart();

// ---------------- sheet ----------------
function openSheet(html, mount) {
  $("#sheet-body").onclick = null;
  $("#sheet-body").innerHTML = html; $("#sheet").hidden = false; document.body.style.overflow = "hidden";
  mount && mount($("#sheet-body"));
}
function closeSheet() { $("#sheet").hidden = true; document.body.style.overflow = ""; $("#sheet-body").innerHTML = ""; }
$("#sheet").addEventListener("click", (e) => { if (e.target.hasAttribute("data-close")) closeSheet(); });

function openCombo(item) {
  openSheet(`<h2>${esc(item.name)}</h2><p class="muted">${esc(item.desc || "")}</p>
    ${item.optionGroups.map((g, gi) => `<fieldset><legend>${esc(g.name)}</legend>
      ${g.options.map((o, oi) => `<label class="radio"><input type="radio" name="g${gi}" value="${esc(o)}" ${oi === 0 ? "checked" : ""}> ${esc(o)}</label>`).join("")}
    </fieldset>`).join("")}
    <button class="btn primary block" id="combo-add">Add to cart · ${rupee(item.variants[0].price)}</button>`,
  (b) => {
    $("#combo-add", b).onclick = () => {
      const options = {};
      item.optionGroups.forEach((g, gi) => (options[g.name] = $(`input[name=g${gi}]:checked`, b)?.value || g.options[0]));
      addLine(item, 0, options); closeSheet();
    };
  });
}

const optText = (o) => Object.entries(o || {}).map(([k, v]) => `${k}: ${v}`).join(", ");
function openCart() {
  syncCart();
  if (!cart.length) { closeSheet(); renderCartBar(); return; }
  const sub = subtotal(), fee = feeFor(settings, sub);
  openSheet(`<h2>Your order</h2>
    <div class="lines">${cart.map((l, i) => `<div class="line">
      <span class="dot ${l.veg ? "veg" : "nv"}"></span>
      <div class="nm">${esc(l.name)}<small>${esc([l.variant, optText(l.options)].filter(Boolean).join(" · "))}</small></div>
      <div class="qty"><button data-dec="${i}" aria-label="Less">−</button><span>${l.qty}</span><button data-inc="${i}" aria-label="More">+</button></div>
      <b>${rupee(l.price * l.qty)}</b></div>`).join("")}</div>
    <div class="sum"><div><span>Subtotal</span><b>${rupee(sub)}</b></div>
      <div><span>Delivery</span><b>${fee ? rupee(fee) : "FREE"}</b></div>
      <div class="total"><span>Total</span><b>${rupee(sub + fee)}</b></div></div>
    ${settings.minOrder && sub < settings.minOrder ? `<p class="warn">Minimum order is ${rupee(settings.minOrder)}.</p>` : ""}
    <button class="btn primary block" id="go-checkout" ${settings.minOrder && sub < settings.minOrder ? "disabled" : ""}>Proceed to checkout</button>`,
  (b) => {
    b.onclick = (e) => {
      const inc = e.target.closest("[data-inc]"), dec = e.target.closest("[data-dec]");
      if (inc) { cart[+inc.dataset.inc].qty++; saveCart(); openCart(); }
      if (dec) { const l = cart[+dec.dataset.dec]; l.qty--; if (l.qty <= 0) cart.splice(+dec.dataset.dec, 1); saveCart(); openCart(); }
    };
    $("#go-checkout", b).onclick = openCheckout;
  });
}

// ---------------- checkout ----------------
function openCheckout() {
  if (!settings.open) return toast("Sorry, we're closed right now.", "err");
  if (!user) {
    openSheet(`<h2>Login to order</h2><p class="muted">We'll send a one-time code to your mobile. You only need to do this once on this phone.</p><div id="login-box"></div>`,
      (b) => phoneLogin($("#login-box", b), () => setTimeout(openCheckout, 300)));
    return;
  }
  const sub = subtotal(), fee = feeFor(settings, sub), total = sub + fee;
  const shop = { lat: settings.lat, lng: settings.lng };
  let pin = profile.lat ? { lat: profile.lat, lng: profile.lng } : null;

  openSheet(`<h2>Delivery details</h2>
    <label>Your name<input id="co-name" value="${esc(profile.name || "")}" autocomplete="name" placeholder="Full name"></label>
    <label>Mobile<input value="${esc(prettyPhone(user.phoneNumber))}" disabled></label>
    <label>House no. / street / village / area<textarea id="co-addr" rows="2" placeholder="e.g. Near Shiv Mandir, Ward 5, Chakia">${esc(profile.address || "")}</textarea></label>
    <label>Landmark<input id="co-land" value="${esc(profile.landmark || "")}" placeholder="Nearby shop, school, temple…"></label>
    <div class="map-head"><b>Pin your exact location</b><button class="btn ghost sm" id="co-gps">📍 Use my location</button></div>
    <div id="co-map" class="map"></div>
    <p id="co-dist" class="sm muted">Tap “Use my location” or drag the pin to your door.</p>
    <label>Note for kitchen (optional)<textarea id="co-note" rows="2" placeholder="Less spicy, extra sauce, Kadhai request…"></textarea></label>
    <fieldset><legend>Payment</legend>
      <label class="radio"><input type="radio" name="pay" value="cod" checked> 💵 Cash on delivery</label>
      <label class="radio"><input type="radio" name="pay" value="upi" ${settings.upiId ? "" : "disabled"}> 📱 UPI (GPay / PhonePe / Paytm)${settings.upiId ? "" : " <small class='muted'>— not available yet</small>"}</label>
    </fieldset>
    <div class="sum"><div><span>Items (${count()})</span><b>${rupee(sub)}</b></div><div><span>Delivery</span><b>${fee ? rupee(fee) : "FREE"}</b></div>
      <div class="total"><span>To pay</span><b>${rupee(total)}</b></div></div>
    <button class="btn primary block" id="co-place">Place order · ${rupee(total)}</button>
    <p class="sm muted center">Not ${esc(prettyPhone(user.phoneNumber))}? <button class="btn link sm" id="co-logout">Log out</button></p>`,
  (b) => {
    const map = makeMap($("#co-map", b), pin || shop, pin ? 16 : 14);
    L.marker([shop.lat, shop.lng], { icon: emo("🍽️") }).addTo(map).bindTooltip("Royal Rasoi");
    L.circle([shop.lat, shop.lng], { radius: settings.radiusKm * 1000, color: "#f2bf4a", weight: 1, fillOpacity: 0.05 }).addTo(map);
    const marker = L.marker(pin ? [pin.lat, pin.lng] : [shop.lat + 0.004, shop.lng], { draggable: true, icon: emo("🏠") }).addTo(map);
    const setPin = (ll, move) => {
      pin = { lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6) };
      if (move) { marker.setLatLng(ll); map.setView(ll, 17); }
      const d = km(shop, pin), el = $("#co-dist", b);
      const ok = d <= settings.radiusKm;
      el.className = "sm " + (ok ? "ok" : "bad");
      el.textContent = ok ? `✓ ${d.toFixed(1)} km from restaurant — we deliver here.` : `✗ ${d.toFixed(1)} km away — we deliver only within ${settings.radiusKm} km. Call us to check.`;
    };
    if (pin) setPin(pin);
    marker.on("dragend", () => setPin(marker.getLatLng()));
    map.on("click", (e) => setPin(e.latlng, true));
    $("#co-gps", b).onclick = () => {
      if (!navigator.geolocation) return toast("Location not supported on this phone", "err");
      $("#co-gps", b).textContent = "Locating…";
      navigator.geolocation.getCurrentPosition(
        (p) => { setPin({ lat: p.coords.latitude, lng: p.coords.longitude }, true); $("#co-gps", b).textContent = "📍 Use my location"; },
        () => { toast("Couldn't get location. Turn on GPS or drag the pin.", "err"); $("#co-gps", b).textContent = "📍 Use my location"; },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    };
    $("#co-logout", b).onclick = async () => { await signOut(auth); closeSheet(); toast("Logged out"); };

    $("#co-place", b).onclick = async (ev) => {
      const name = $("#co-name", b).value.trim(), address = $("#co-addr", b).value.trim(), landmark = $("#co-land", b).value.trim();
      const note = $("#co-note", b).value.trim(), method = $("input[name=pay]:checked", b).value;
      if (name.length < 2) return toast("Please enter your name", "err");
      if (address.length < 5) return toast("Please enter your full address", "err");
      if (!pin) return toast("Please pin your location on the map", "err");
      const dist = km(shop, pin);
      if (dist > settings.radiusKm) return toast(`Sorry, we deliver only within ${settings.radiusKm} km`, "err");
      syncCart();
      if (!cart.length) { closeSheet(); return; }
      const sub2 = subtotal(), fee2 = feeFor(settings, sub2);
      const id = makeOrderId(), btn = ev.currentTarget;
      btn.disabled = true; btn.textContent = "Placing order…";
      try {
        await setDoc(doc(db, "orders", id), {
          id, userId: user.uid, phone: user.phoneNumber, customerName: name, address, landmark, note,
          location: pin, distanceKm: +dist.toFixed(2),
          items: cart.map((l) => ({ itemId: l.itemId, name: l.name, variant: l.variant, options: l.options || {}, price: l.price, qty: l.qty, veg: l.veg })),
          subtotal: sub2, deliveryFee: fee2, total: sub2 + fee2,
          payment: { method, status: "pending", utr: "" },
          status: "placed", statusHistory: [{ status: "placed", at: Date.now(), by: "customer" }],
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        profile = { name, address, landmark, lat: pin.lat, lng: pin.lng }; save("rr_profile", profile);
        cart = []; saveCart(); closeSheet();
        location.hash = "#/track/" + id;
        toast("Order placed! 🎉");
      } catch (e) {
        console.error(e); toast("Couldn't place order: " + (e.code || e.message), "err");
        btn.disabled = false; btn.textContent = `Place order · ${rupee(sub2 + fee2)}`;
      }
    };
  });
}

// ---------------- router ----------------
function route() {
  const h = location.hash || "#/";
  if (unsubTrack) { unsubTrack(); unsubTrack = null; }
  if (unsubOrders) { unsubOrders(); unsubOrders = null; }
  $("#view-menu").hidden = $("#view-orders").hidden = $("#view-track").hidden = true;
  if (h.startsWith("#/track/")) { $("#view-track").hidden = false; showTrack(decodeURIComponent(h.slice(8))); }
  else if (h.startsWith("#/orders")) { $("#view-orders").hidden = false; showOrders(); }
  else { $("#view-menu").hidden = false; }
  renderCartBar();
  scrollTo(0, 0);
}
addEventListener("hashchange", route);

// ---------------- my orders ----------------
function showOrders() {
  const body = $("#orders-body");
  if (!user) {
    body.innerHTML = `<div class="card"><p>Log in with your mobile number to see your orders.</p><div id="ol"></div></div>`;
    phoneLogin($("#ol"), () => {});
    return;
  }
  body.innerHTML = `<p class="muted">Loading…</p>`;
  unsubOrders = onSnapshot(query(collection(db, "orders"), where("userId", "==", user.uid)), (snap) => {
    const list = snap.docs.map((d) => d.data()).sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
    body.innerHTML = (list.length ? list.map((o) => `<a class="card order-row" href="#/track/${o.id}" style="text-decoration:none;color:inherit">
        <div><b>#${esc(o.id)}</b><div class="sm muted">${fmtTime(o.createdAt)} · ${o.items.reduce((a, i) => a + i.qty, 0)} items</div></div>
        <div style="text-align:right"><span class="pill ${o.status}">${STATUS[o.status]}</span><div><b>${rupee(o.total)}</b></div></div></a>`).join("")
      : `<p class="muted">No orders yet. <a href="#/">Order now →</a></p>`) +
      `<p class="sm muted center">Logged in as ${esc(prettyPhone(user.phoneNumber))} · <button class="btn link sm" id="lo">Log out</button></p>`;
    $("#lo").onclick = () => signOut(auth);
  }, (e) => { body.innerHTML = `<p class="bad">Couldn't load orders (${esc(e.code)}).</p>`; });
}

// ---------------- tracking ----------------
function showTrack(id) {
  const info = $("#tr-info"), det = $("#tr-details");
  info._h = det._h = null;
  if (!user) {
    info.innerHTML = `<div class="card"><p>Log in to track your order.</p><div id="tl"></div></div>`; det.innerHTML = "";
    $("#tr-map").hidden = true; phoneLogin($("#tl"), () => {}); return;
  }
  $("#tr-map").hidden = false;
  info.innerHTML = `<p class="muted">Loading order…</p>`; det.innerHTML = "";
  if (trackMap) { trackMap.remove(); trackMap = null; }
  trackMarkers = {}; trackFit = false;
  unsubTrack = onSnapshot(doc(db, "orders", id), (s) => {
    if (!s.exists()) { info.innerHTML = `<p class="bad">Order not found.</p>`; return; }
    renderTrack(s.data());
  }, (e) => { info.innerHTML = `<p class="bad">Couldn't open this order (${esc(e.code)}).</p>`; $("#tr-map").hidden = true; });
}

function renderTrack(o) {
  const step = STEPS.indexOf(o.status);
  const rider = o.riderLocation;
  const showRider = o.status === "out_for_delivery" && rider && Date.now() - rider.at < 15 * 60 * 1000;
  let eta = "";
  if (showRider) { const d = km(rider, o.location); eta = `${d.toFixed(1)} km away · about ${Math.max(2, Math.round((d / 18) * 60))} min`; }

  const headline = {
    placed: "Waiting for the restaurant to accept…", accepted: "Order accepted 👍", preparing: "Your food is being prepared 🍳",
    out_for_delivery: "Rider is on the way 🛵", delivered: "Delivered. Enjoy your meal! 😋", cancelled: "This order was cancelled",
  }[o.status];

  // payment block
  let pay = "";
  if (o.payment.method === "upi" && o.status !== "cancelled") {
    if (o.payment.status === "paid") pay = `<p class="ok">✓ UPI payment received</p>`;
    else if (o.payment.utr) pay = `<p class="muted">UPI payment submitted (UTR ${esc(o.payment.utr)}). Restaurant will confirm shortly.</p>`;
    else if (settings?.upiId) pay = `<div class="card"><h3>Pay ${rupee(o.total)} by UPI</h3>
        <p class="sm muted">Scan with any UPI app, or tap the button on this phone. Then enter the UTR / reference number below.</p>
        <div class="qr" id="upi-qr"></div>
        <a class="btn primary block" href="${esc(upiLink(settings, o.total, "Royal Rasoi " + o.id))}">Pay with UPI app</a>
        <label>UTR / reference no. (12 digits)<input id="utr" inputmode="numeric" maxlength="22" placeholder="After paying, paste it here"></label>
        <button class="btn block" id="utr-btn" style="margin-top:8px">I've paid</button>
        <p class="sm muted">Paying later? You can also pay cash to the rider.</p></div>`;
  } else if (o.payment.method === "cod" && o.status !== "cancelled") {
    pay = o.payment.status === "paid" ? `<p class="ok">✓ Paid ${rupee(o.total)} (cash)</p>` : `<p>💵 Keep <b>${rupee(o.total)}</b> ready — cash on delivery.</p>`;
  }

  patch($("#tr-info"), `<div class="card">
    <div class="row" style="justify-content:space-between"><b>#${esc(o.id)}</b><span class="pill ${o.status}">${STATUS[o.status]}</span></div>
    <div class="big-status">${headline}</div>
    ${o.status !== "cancelled" ? `<div class="steps">${STEPS.map((s, i) => `<div class="${i <= step ? "done" : ""}">${STATUS[s]}</div>`).join("")}</div>` : ""}
    ${o.riderName && ACTIVE.includes(o.status) ? `<div class="row" style="justify-content:space-between;margin-top:8px">
        <span>🛵 Rider: <b>${esc(o.riderName)}</b>${eta ? `<br><span class="sm muted">${eta}</span>` : ""}</span>
        <a class="btn sm" href="tel:${esc(o.riderPhone)}">📞 Call rider</a></div>` : ""}
    ${pay}
  </div>`, (el) => {
    const q = $("#upi-qr", el);
    if (q && window.QRCode) new QRCode(q, { text: upiLink(settings, o.total, "Royal Rasoi " + o.id), width: 180, height: 180 });
    const ub = $("#utr-btn", el);
    if (ub) ub.onclick = async () => {
      const utr = $("#utr", el).value.replace(/\s/g, "");
      if (!/^[A-Za-z0-9]{6,22}$/.test(utr)) return toast("Enter the UTR / reference number from your UPI app", "err");
      ub.disabled = true;
      try { await updateDoc(doc(db, "orders", o.id), { payment: { ...o.payment, utr }, updatedAt: serverTimestamp() }); toast("Thanks! Payment sent for confirmation."); }
      catch (e) { toast("Couldn't save: " + e.code, "err"); ub.disabled = false; }
    };
  });

  patch($("#tr-details"), `<div class="card">
    <h3>Order details</h3><p class="sm muted">${fmtTime(o.createdAt)}</p>
    ${o.items.map((i) => `<div class="kv"><span><span class="dot ${i.veg ? "veg" : "nv"}" style="display:inline-block;vertical-align:-2px"></span> ${i.qty} × ${esc(i.name)}${i.variant ? ` (${esc(i.variant)})` : ""}${Object.keys(i.options || {}).length ? `<br><small class="muted">${esc(optText(i.options))}</small>` : ""}</span><span>${rupee(i.price * i.qty)}</span></div>`).join("")}
    <div class="sum"><div><span>Delivery</span><b>${o.deliveryFee ? rupee(o.deliveryFee) : "FREE"}</b></div><div class="total"><span>Total (${o.payment.method === "upi" ? "UPI" : "Cash"})</span><b>${rupee(o.total)}</b></div></div>
    <p class="sm"><b>Deliver to:</b> ${esc(o.customerName)}, ${esc(o.address)}${o.landmark ? ", near " + esc(o.landmark) : ""}</p>
    ${o.note ? `<p class="sm"><b>Note:</b> ${esc(o.note)}</p>` : ""}
    <div class="row">
      <a class="btn sm" href="tel:${esc(settings?.phones?.[0] || "")}">📞 Call restaurant</a>
      ${o.status === "placed" ? `<button class="btn danger sm" id="cancel-btn">Cancel order</button>` : ""}
    </div></div>`, (el) => {
    const cb = $("#cancel-btn", el);
    if (cb) cb.onclick = async () => {
      if (!confirm("Cancel this order?")) return;
      try {
        await updateDoc(doc(db, "orders", o.id), {
          status: "cancelled", cancelledBy: "customer", statusHistory: arrayUnion({ status: "cancelled", at: Date.now(), by: "customer" }), updatedAt: serverTimestamp(),
        });
        toast("Order cancelled");
      } catch (e) { toast("Restaurant has already accepted — please call to cancel.", "err"); }
    };
  });

  // map
  const mapEl = $("#tr-map");
  const shop = settings ? { lat: settings.lat, lng: settings.lng } : null;
  if (o.status === "delivered" || o.status === "cancelled") { mapEl.hidden = true; return; }
  mapEl.hidden = false;
  if (!trackMap) trackMap = makeMap(mapEl, o.location, 15);
  const put = (key, p, icon, tip) => {
    if (!p) { if (trackMarkers[key]) { trackMarkers[key].remove(); delete trackMarkers[key]; } return; }
    if (trackMarkers[key]) trackMarkers[key].setLatLng([p.lat, p.lng]);
    else trackMarkers[key] = L.marker([p.lat, p.lng], { icon }).addTo(trackMap).bindTooltip(tip);
  };
  put("home", o.location, emo("🏠"), "You");
  put("shop", shop, emo("🍽️"), "Royal Rasoi");
  put("rider", showRider ? rider : null, emo("🛵", "rider"), "Rider");
  const pts = [o.location, shop, showRider ? rider : null].filter(Boolean).map((p) => [p.lat, p.lng]);
  // Fit once on open, and once more when the rider first appears; after that let the user pan/zoom freely.
  const want = showRider ? 2 : 1;
  if (trackFit < want) { trackMap.fitBounds(pts, { padding: [40, 40], maxZoom: 17 }); trackFit = want; }
}
