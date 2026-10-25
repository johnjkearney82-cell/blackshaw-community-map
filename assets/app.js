/* Blackshaw Head Community Map
   Plain JavaScript + Leaflet. No build step: edit and push.
   Data: listed buildings from data/listed-buildings.json, approved neighbour
   houses from the Google Apps Script feed (see apps-script/Code.gs). */
(function () {
  "use strict";

  const CFG = Object.assign({
    appsScriptUrl: "",
    boundaryFile: "data/parish-boundary.geojson",
    boundaryFallbackUrl: "https://mapit.mysociety.org/area/59191.geojson",
    centre: [53.7465, -2.065],
    zoom: 14,
    contactEmail: ""
  }, window.MAP_CONFIG || {});

  const LANE_NAMES = [
    "Badger Lane", "Davey Lane", "Davey Lane Top", "Dark Lane", "Greenland Road", "High Street, Colden",
    "Jack Bridge, Colden", "Jumble Hole Road", "Land Lane", "Long Causeway", "Lower Lane", "Marsh Lane",
    "Moor Lane", "Moorcock Road", "New Road", "New Shaw Lane", "Old Shaw Lane", "Underbank", "Underbank Avenue"
  ];
  const LABEL_ZOOM = 16;        // house names appear from this zoom level
  const CACHE_KEY = "bhcm-approved-v1";

  /* ---------- state ---------- */
  let listed = [], approved = [];
  let selId = null, query = "", mode = "browse";
  let addDraft = blankDraft(), addMsg = null, sending = false, addStartedAt = 0;
  const markers = new Map();   // id -> {marker, place}
  const all = () => listed.concat(approved);
  function blankDraft() { return { name: "", lane: "", note: "", email: "", consent: false, website: "" }; }

  /* ---------- map ---------- */
  const map = L.map("map", {
    zoomControl: false, zoomSnap: 0.5, zoomDelta: 1, wheelPxPerZoomLevel: 90,
    minZoom: 12, maxZoom: 19, tap: true, preferCanvas: false
  }).setView(CFG.centre, CFG.zoom);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, maxNativeZoom: 19, detectRetina: false,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors · Listed buildings &copy; <a href="https://historicengland.org.uk/listing/the-list/" target="_blank" rel="noopener">Historic England</a>'
  }).addTo(map);
  map.attributionControl.setPrefix(false);
  map.setMaxBounds(L.latLngBounds([53.715, -2.13], [53.78, -2.0]).pad(0.2));

  const mapEl = document.getElementById("map");
  function zoomClass() { mapEl.classList.toggle("map-far", map.getZoom() < LABEL_ZOOM); }
  map.on("zoomend", zoomClass); zoomClass();

  /* parish boundary: local copy first, then MapIt */
  (async function loadBoundary() {
    const sources = [CFG.boundaryFile, CFG.boundaryFallbackUrl].filter(Boolean);
    for (const url of sources) {
      try {
        const r = await fetch(url, { cache: "force-cache" });
        if (!r.ok) continue;
        const gj = await r.json();
        const layer = L.geoJSON(gj, { style: () => ({ className: "boundary", interactive: false }) }).addTo(map);
        layer.bringToBack();
        if (!location.hash.startsWith("#h/")) map.fitBounds(layer.getBounds(), { padding: [20, 20] });
        map.setMaxBounds(layer.getBounds().pad(0.6));
        return;
      } catch (_) { /* try next source */ }
    }
  })();

  /* ---------- markers ---------- */
  function cottageSvg(kind) {
    if (kind === "landmark") return '<svg viewBox="-12 -12 24 24"><path class="wall" d="M0 -9L9 0L0 9L-9 0Z"/></svg>';
    return '<svg viewBox="-12 -12 24 24"><path class="wall" d="M-8 7V-.8L0 -8.4L8 -.8V7Z"/>' +
      '<path class="roof" d="M-9.2 0L0 -9.2L9.2 0L7.6 1L0 -6.6L-7.6 1Z"/><rect class="roof" x="-1.6" y="2.4" width="3.2" height="4.6"/></svg>';
  }
  function iconFor(p, sel) {
    const kind = p.src === "added" ? "added" : p.kind === "landmark" ? "landmark" : "listed";
    const size = sel ? 34 : 24;
    return L.divIcon({
      className: "cot " + kind + (sel ? " sel" : ""), html: cottageSvg(p.src === "added" ? "house" : p.kind),
      iconSize: [size, size], iconAnchor: [size / 2, size / 2]
    });
  }
  function addMarker(p) {
    const m = L.marker([p.lat, p.lng], { icon: iconFor(p, false), title: p.name, alt: p.name, keyboard: true, riseOnHover: true })
      .bindTooltip(p.name, { permanent: true, direction: "right", offset: [10, 0], className: "lbl", interactive: false })
      .on("click", () => select(p.id, false))
      .addTo(map);
    markers.set(p.id, { marker: m, place: p });
  }
  function syncMarkers() {
    const want = new Map(all().map(p => [p.id, p]));
    for (const [id, o] of markers) if (!want.has(id)) { o.marker.remove(); markers.delete(id); }
    for (const p of want.values()) if (!markers.has(p.id)) addMarker(p);
    refreshSelection();
    scheduleDeclutter();
  }
  let lastSel = null;
  function refreshSelection() {
    for (const id of [lastSel, selId]) {
      const o = id && markers.get(id); if (!o) continue;
      const sel = id === selId;
      o.marker.setIcon(iconFor(o.place, sel));
      o.marker.setZIndexOffset(sel ? 1000 : 0);
      const t = o.marker.getTooltip(); const el = t && t.getElement();
      if (el) el.classList.toggle("sel", sel);
    }
    lastSel = selId;
  }

  /* hide labels that would overlap, keeping the selected one and the shortest names first */
  let declutterT = 0;
  function scheduleDeclutter() { clearTimeout(declutterT); declutterT = setTimeout(declutter, 60); }
  function declutter() {
    if (map.getZoom() < LABEL_ZOOM) return;
    const items = [];
    for (const [id, o] of markers) {
      const t = o.marker.getTooltip(); const el = t && t.getElement(); if (!el) continue;
      const pt = map.latLngToContainerPoint(o.marker.getLatLng());
      items.push({ id, el, pt, w: o.place.name.length * 6.8 + 6, p: o.place });
    }
    items.sort((a, b) => (b.id === selId) - (a.id === selId) || (b.p.src === "added") - (a.p.src === "added") || a.p.name.length - b.p.name.length);
    const boxes = items.map(i => ({ x: i.pt.x - 11, y: i.pt.y - 11, w: 22, h: 22 }));
    for (const i of items) {
      const b = { x: i.pt.x + 10, y: i.pt.y - 9, w: i.w, h: 18 };
      const hit = boxes.some(o => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
      const show = i.id === selId || !hit;
      i.el.style.visibility = show ? "" : "hidden";
      if (show) boxes.push(b);
    }
  }
  map.on("zoomend moveend", scheduleDeclutter);

  /* ---------- data ---------- */
  async function loadListed() {
    try {
      const r = await fetch("data/listed-buildings.json");
      const j = await r.json();
      listed = (j.places || []).map(p => Object.assign({}, p, { src: "listed" }));
    } catch (_) { listed = []; toast("Couldn't load the listed buildings. Try refreshing."); }
  }
  function cleanApproved(arr) {
    return (Array.isArray(arr) ? arr : []).map(h => {
      const lat = +h.lat, lng = +h.lng;
      if (!isFinite(lat) || !isFinite(lng) || typeof h.name !== "string" || !h.id) return null;
      return {
        id: "s-" + String(h.id).replace(/[^\w-]/g, ""), name: h.name.slice(0, 80), lat, lng,
        lane: typeof h.lane === "string" ? h.lane.slice(0, 60) : "", note: typeof h.note === "string" ? h.note.slice(0, 200) : "",
        kind: "house", src: "added"
      };
    }).filter(Boolean);
  }
  async function loadApproved() {
    try { const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); if (c) approved = cleanApproved(c); } catch (_) {}
    if (!CFG.appsScriptUrl) return;
    try {
      const r = await fetch(CFG.appsScriptUrl + "?action=houses&t=" + Math.floor(Date.now() / 60000));
      const j = await r.json();
      if (j && j.ok) {
        approved = cleanApproved(j.houses);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(j.houses)); } catch (_) {}
      }
    } catch (_) { /* keep cached copy */ }
  }

  /* ---------- panel ---------- */
  const sheet = document.getElementById("sheet");
  const appEl = document.getElementById("app");
  const h = (t, props, ...kids) => {
    const e = document.createElement(t);
    if (props) for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    }
    kids.flat().forEach(c => { if (c == null || c === false) return; e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  };
  function swatch(p) {
    const mark = p.kind === "landmark" && p.src !== "added";
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 14 14"); s.setAttribute("class", "lg"); s.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", mark ? "M7 1.5L12.5 7 7 12.5 1.5 7Z" : "M2 13V6.5L7 2l5 4.5V13Z");
    path.setAttribute("style", "fill:var(--" + (p.src === "added" ? "heather" : mark ? "paper" : "stone") + ")");
    s.appendChild(path); return s;
  }
  function matches() {
    const q = query.trim().toLowerCase(); if (!q) return [];
    const words = q.split(/\s+/);
    return all().filter(p => { const s = (p.name + " " + (p.lane || "")).toLowerCase(); return words.every(w => s.includes(w)); })
      .sort((a, b) => a.name.toLowerCase().indexOf(q) - b.name.toLowerCase().indexOf(q) || a.name.localeCompare(b.name)).slice(0, 40);
  }
  function list(items) {
    return h("ul", { class: "results" }, items.map(p => h("li", {},
      h("button", { type: "button", onclick: () => select(p.id, true) }, swatch(p), h("span", { class: "nm" }, p.name), h("span", { class: "ln" }, p.lane || "")))));
  }
  function about() {
    return h("div", { class: "about" },
      h("p", {}, "Stone cottages are Historic England listed buildings. Purple cottages are houses neighbours have added, checked by a volunteer before they appear."),
      h("p", {}, "House names only. We never show who lives anywhere. ", h("a", { href: "privacy.html" }, "Privacy notice"), "."),
      CFG.contactEmail ? h("p", {}, "To correct or remove a house, email " + CFG.contactEmail + ".") : null);
  }

  function renderSheet() {
    sheet.textContent = "";
    appEl.classList.toggle("has-sel", !!selId);
    appEl.classList.toggle("adding", mode === "add");
    document.getElementById("addBtn").textContent = mode === "add" ? "Cancel" : "Add your house";
    if (mode === "add") { sheet.appendChild(addForm()); return; }
    const sel = all().find(p => p.id === selId);
    if (sel) { sheet.appendChild(placeCard(sel)); return; }
    const res = matches();
    if (query.trim()) {
      sheet.appendChild(h("p", { class: "eyebrow" }, res.length ? res.length + (res.length === 1 ? " match" : " matches") : "No matches"));
      if (!res.length) {
        sheet.appendChild(h("p", { class: "empty" }, "“" + query.trim() + "” isn't on the map yet. If it's your house, add it so the next driver can find it."));
        sheet.appendChild(h("div", { class: "actions", style: "margin-top:10px" },
          h("button", { class: "btn primary", type: "button", onclick: () => startAdd(query.trim()) }, "Add “" + query.trim() + "”")));
      } else sheet.appendChild(list(res));
      return;
    }
    sheet.appendChild(h("p", { class: "eyebrow" }, "Houses on the map · " + all().length));
    sheet.appendChild(h("p", { class: "empty", style: "margin-bottom:10px" }, "Search for a house by name, or tap a cottage on the map. If your house isn't here yet, use Add your house."));
    sheet.appendChild(list(all().slice().sort((a, b) => a.name.localeCompare(b.name))));
    sheet.appendChild(about());
  }

  function placeLink(p) { return location.origin + location.pathname + "#h/" + p.id; }
  function placeCard(p) {
    const lat = p.lat.toFixed(5), lng = p.lng.toFixed(5);
    return h("div", { class: "place" },
      h("p", { class: "eyebrow" }, p.src === "added" ? "Added by a neighbour" : p.kind === "landmark" ? "Landmark · listed" : "Listed building"),
      h("h2", {}, p.name),
      p.lane ? h("p", { class: "meta" }, p.lane) : null,
      p.note ? h("p", { class: "note" }, p.note) : null,
      h("dl", { class: "facts" }, h("dt", {}, "Lat, long"), h("dd", {}, lat + ", " + lng)),
      h("div", { class: "actions" },
        h("a", { class: "btn primary", href: "https://www.google.com/maps/dir/?api=1&destination=" + lat + "," + lng, target: "_blank", rel: "noopener" }, "Directions"),
        h("button", { class: "btn ghost", type: "button", onclick: () => copy(placeLink(p), "Link copied. Send it to a courier or add it to delivery notes.") }, "Copy link to this house"),
        h("button", { class: "btn ghost", type: "button", onclick: () => select(null) }, "Back to list")));
  }

  function addForm() {
    const f = h("form", { novalidate: true });
    const field = (id, el) => { el.id = id; return el; };
    const nameIn = field("f-name", h("input", { maxlength: "80", placeholder: "e.g. Rose Cottage", autocomplete: "off" }));
    nameIn.value = addDraft.name; nameIn.oninput = () => addDraft.name = nameIn.value;
    const laneSel = field("f-lane", h("select", {}, h("option", { value: "" }, "Not sure"), h("option", { value: "Private track" }, "Private track"), LANE_NAMES.map(n => h("option", { value: n }, n))));
    laneSel.value = addDraft.lane; laneSel.onchange = () => addDraft.lane = laneSel.value;
    const noteIn = field("f-note", h("textarea", { maxlength: "200", placeholder: "e.g. Green gate, second house past the chapel" }));
    noteIn.value = addDraft.note; noteIn.oninput = () => addDraft.note = noteIn.value;
    const emailIn = field("f-email", h("input", { type: "email", maxlength: "120", autocomplete: "email", inputmode: "email", placeholder: "you@example.com" }));
    emailIn.value = addDraft.email; emailIn.oninput = () => addDraft.email = emailIn.value;
    const consentIn = field("f-consent", h("input", { type: "checkbox" }));
    consentIn.checked = addDraft.consent; consentIn.onchange = () => addDraft.consent = consentIn.checked;
    const hpIn = field("f-website", h("input", { tabindex: "-1", autocomplete: "off" }));
    hpIn.value = addDraft.website; hpIn.oninput = () => addDraft.website = hpIn.value;
    const off = !CFG.appsScriptUrl;

    f.append(
      h("p", { class: "eyebrow" }, "Add your house"),
      h("p", { class: "empty" }, "Drag the map until the red cross is on your house, then fill this in. A local volunteer checks each house before it appears, and we'll email you when it's on the map."),
      h("label", { for: "f-name" }, "House name", nameIn),
      h("label", { for: "f-lane" }, "Lane ", h("small", {}, "(optional)"), laneSel),
      h("label", { for: "f-note" }, "How to spot it ", h("small", {}, "(optional)"), noteIn),
      h("label", { for: "f-email" }, "Your email ", h("small", {}, "(only used to tell you it's approved, never shown)"), emailIn),
      h("label", { class: "check", for: "f-consent" }, consentIn, h("span", {}, "I live here or have the owner's permission, and I'm happy to be emailed about this entry. ", h("a", { href: "privacy.html", target: "_blank" }, "Privacy notice"))),
      h("label", { class: "hp", for: "f-website", "aria-hidden": "true" }, "Leave this empty", hpIn),
      addMsg ? h("p", { class: "msg " + addMsg.type, role: addMsg.type === "err" ? "alert" : "status" }, addMsg.text) : null,
      off ? h("p", { class: "msg" }, "Adding houses isn't switched on yet. The map's organiser needs to connect the approval sheet.") : null,
      h("div", { class: "actions" },
        h("button", { class: "btn primary", type: "submit", disabled: off || sending }, sending ? "Sending…" : "Send for approval"),
        h("button", { class: "btn ghost", type: "button", onclick: cancelAdd }, "Cancel")));
    f.addEventListener("submit", e => { e.preventDefault(); submitHouse(); });
    setTimeout(() => { try { (addDraft.name ? emailIn : nameIn).focus({ preventScroll: true }); } catch (_) {} }, 0);
    return f;
  }

  /* ---------- actions ---------- */
  function select(id, fly) {
    selId = id; mode = "browse";
    document.getElementById("cross").hidden = true; document.getElementById("addhint").hidden = true;
    const o = id && markers.get(id);
    if (o && fly) map.flyTo(o.marker.getLatLng(), Math.max(map.getZoom(), 17), { duration: .6 });
    try { history.replaceState(null, "", id ? "#h/" + id : location.pathname + location.search); } catch (_) {}
    refreshSelection(); scheduleDeclutter(); renderSheet();
  }
  function startAdd(prefill) {
    mode = "add"; selId = null; refreshSelection(); addMsg = null;
    addDraft = Object.assign(blankDraft(), { name: prefill || "" });
    addStartedAt = Date.now();
    document.getElementById("cross").hidden = false; document.getElementById("addhint").hidden = false;
    if (map.getZoom() < 16) map.flyTo(map.getCenter(), 16, { duration: .5 });
    renderSheet();
  }
  function cancelAdd() {
    mode = "browse"; addMsg = null;
    document.getElementById("cross").hidden = true; document.getElementById("addhint").hidden = true;
    renderSheet();
  }
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  async function submitHouse() {
    const name = addDraft.name.trim().replace(/\s+/g, " ");
    const email = addDraft.email.trim();
    if (!name) { addMsg = { type: "err", text: "Enter the house name." }; return renderSheet(); }
    if (!EMAIL_RE.test(email)) { addMsg = { type: "err", text: "Enter an email address so we can tell you when it's approved." }; return renderSheet(); }
    if (!addDraft.consent) { addMsg = { type: "err", text: "Tick the box to confirm you live here or have the owner's permission." }; return renderSheet(); }
    const c = map.getCenter();
    const body = {
      action: "submit", name: name.slice(0, 80), lane: addDraft.lane, note: addDraft.note.trim().slice(0, 200),
      lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6), email: email.slice(0, 120), consent: true,
      website: addDraft.website, elapsedMs: Date.now() - addStartedAt
    };
    sending = true; addMsg = null; renderSheet();
    try {
      // text/plain avoids a CORS preflight, which Apps Script can't answer
      const r = await fetch(CFG.appsScriptUrl, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "text/plain;charset=utf-8" } });
      const j = await r.json();
      sending = false;
      if (j && j.ok) {
        mode = "browse";
        document.getElementById("cross").hidden = true; document.getElementById("addhint").hidden = true;
        renderSheet();
        sheet.prepend(h("p", { class: "msg ok", role: "status", style: "margin-bottom:10px" },
          "Thanks. " + name + " has been sent for approval. We'll email you when it's on the map."));
        addDraft = blankDraft();
      } else {
        addMsg = { type: "err", text: (j && j.error) || "That didn't go through. Check the details and try again." };
        renderSheet();
      }
    } catch (_) {
      sending = false;
      addMsg = { type: "err", text: "Couldn't send just now. Check your connection and try again." };
      renderSheet();
    }
  }
  function copy(text, done) {
    const ok = () => toast(done || "Copied");
    const fallback = () => { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); ok(); } catch (_) { toast(text); } t.remove(); };
    try { navigator.clipboard.writeText(text).then(ok, fallback); } catch (_) { fallback(); }
  }
  let toastT = 0;
  function toast(m) { const t = document.getElementById("toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2800); }

  /* ---------- controls ---------- */
  document.getElementById("zin").onclick = () => map.zoomIn();
  document.getElementById("zout").onclick = () => map.zoomOut();
  const fsBtn = document.getElementById("fs");
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;
  function setFull(on) {
    appEl.classList.toggle("full", on);
    fsBtn.setAttribute("aria-pressed", String(on));
    fsBtn.setAttribute("aria-label", on ? "Exit full screen" : "Full screen map");
    fsBtn.title = on ? "Exit full screen" : "Full screen";
    setTimeout(() => map.invalidateSize(), 50);
  }
  fsBtn.onclick = () => {
    const on = !appEl.classList.contains("full");
    setFull(on);
    try {
      if (on) { const req = appEl.requestFullscreen || appEl.webkitRequestFullscreen; if (req) { const p = req.call(appEl); if (p && p.catch) p.catch(() => {}); } }
      else if (fsEl()) { const ex = document.exitFullscreen || document.webkitExitFullscreen; if (ex) { const p = ex.call(document); if (p && p.catch) p.catch(() => {}); } }
    } catch (_) {}
  };
  const onFsChange = () => { if (!fsEl() && appEl.classList.contains("full")) setFull(false); };
  document.addEventListener("fullscreenchange", onFsChange);
  document.addEventListener("webkitfullscreenchange", onFsChange);
  document.addEventListener("keydown", e => { if (e.key === "Escape" && appEl.classList.contains("full") && !fsEl()) setFull(false); });

  document.getElementById("addBtn").onclick = () => mode === "add" ? cancelAdd() : startAdd("");
  const qIn = document.getElementById("q");
  qIn.addEventListener("input", () => {
    query = qIn.value;
    if (mode === "add") cancelAdd();
    selId = null; refreshSelection(); renderSheet();
    const res = matches(); if (res.length === 1) select(res[0].id, true);
  });
  map.on("click", () => { if (mode === "browse" && selId) select(null); });
  if (window.ResizeObserver) new ResizeObserver(() => map.invalidateSize()).observe(mapEl);

  function openFromHash() {
    const m = location.hash.match(/^#h\/([\w-]+)$/);
    if (m && markers.has(m[1])) { select(m[1], false); map.setView(markers.get(m[1]).marker.getLatLng(), 17); }
  }
  window.addEventListener("hashchange", openFromHash);

  /* ---------- boot ---------- */
  (async function boot() {
    await loadListed();
    await loadApproved().catch(() => {});
    syncMarkers(); renderSheet(); openFromHash();
    // refresh the approved list when the tab comes back into view
    document.addEventListener("visibilitychange", async () => {
      if (document.visibilityState !== "visible") return;
      await loadApproved(); syncMarkers(); if (mode === "browse") renderSheet();
    });
  })();
})();
