/**
 * Blackshaw Head Community Map — approval backend (Google Apps Script)
 *
 * What it does
 *  - Receives "Add your house" submissions from the map and adds them to the
 *    "Submissions" sheet as Pending, then emails the administrator.
 *  - When an administrator changes Status to Approved, it emails the person who
 *    submitted it with a link to their house on the map, and (by default)
 *    deletes their email address from the sheet.
 *  - Serves the list of Approved houses to the map (names and positions only,
 *    never email addresses).
 *
 * Setup: see README.md, step 2. In short: paste this file into
 * Extensions > Apps Script on a new Google Sheet, fill in SETTINGS, run setup()
 * once, then Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
 */

const SETTINGS = {
  ADMIN_EMAIL: "bernsteen@gmail.com",               // who gets "new house to approve" emails
  MAP_URL: "https://johnjkearney82-cell.github.io/blackshaw-community-map/", // your live map
  MAP_NAME: "Blackshaw Head Community Map",
  DELETE_EMAIL_AFTER_NOTIFY: true,   // remove the owner's email once they've been told
  SEND_ACKNOWLEDGEMENT: true,        // "thanks, we've received it" email to the submitter
  SEND_REJECTION_EMAIL: false,       // email the submitter if an entry is rejected
  MAX_SUBMISSIONS_PER_HOUR: 30,      // simple flood protection
  // Rough box around Blackshaw parish. Submissions outside it are refused.
  BOUNDS: { south: 53.728, north: 53.767, west: -2.137, east: -2.024 }
};

const SHEET_NAME = "Submissions";
const COLS = ["ID", "Submitted", "Status", "House name", "Lane", "How to spot it",
  "Latitude", "Longitude", "Check location", "Owner email", "Consent", "Reviewed", "Owner notified", "Admin notes"];
const C = Object.fromEntries(COLS.map((n, i) => [n, i + 1]));   // column numbers, 1-based
const STATUSES = ["Pending", "Approved", "Rejected"];

/* ---------------- web app ---------------- */

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || "houses";
  if (action === "status") {
    // quick health check: which sheet the web app can see (no personal data)
    try {
      const ss = book_();
      return json_({ ok: true, sheet: ss.getName(), tabs: ss.getSheets().map(t => t.getName()), houses: approvedHouses_().length });
    } catch (err) { return json_({ ok: false, error: String(err.message || err) }); }
  }
  if (action !== "houses") return json_({ ok: false, error: "Unknown request." });
  const cache = CacheService.getScriptCache();
  const hit = cache.get("houses");
  if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
  const body = JSON.stringify({ ok: true, houses: approvedHouses_(), updated: new Date().toISOString() });
  cache.put("houses", body, 300);
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: "That didn't go through. Please try again." }); }
  if (!d || d.action !== "submit") return json_({ ok: false, error: "Unknown request." });

  // Bots: a filled hidden field, or a form completed implausibly fast. Pretend it worked.
  if (d.website || (typeof d.elapsedMs === "number" && d.elapsedMs < 3000)) return json_({ ok: true });

  const name = clean_(d.name, 80);
  const lane = clean_(d.lane, 60);
  const note = clean_(d.note, 200);
  const email = String(d.email || "").trim().slice(0, 120);
  const lat = Number(d.lat), lng = Number(d.lng);
  const B = SETTINGS.BOUNDS;

  if (!name) return json_({ ok: false, error: "Enter the house name." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json_({ ok: false, error: "Enter a valid email address." });
  if (d.consent !== true) return json_({ ok: false, error: "Tick the box to confirm you live here or have the owner's permission." });
  if (!isFinite(lat) || !isFinite(lng) || lat < B.south || lat > B.north || lng < B.west || lng > B.east)
    return json_({ ok: false, error: "That spot is outside Blackshaw parish. Move the map so the cross is on the house." });

  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (err) { return json_({ ok: false, error: "The map is busy. Please try again in a moment." }); }
  try {
    // flood protection
    const cache = CacheService.getScriptCache();
    const hourKey = "n-" + Utilities.formatDate(new Date(), "Etc/UTC", "yyyyMMddHH");
    const n = Number(cache.get(hourKey) || 0);
    if (n >= SETTINGS.MAX_SUBMISSIONS_PER_HOUR) return json_({ ok: false, error: "Lots of houses are being added right now. Please try again later." });
    cache.put(hourKey, String(n + 1), 3700);

    const sh = sheet_();
    // same name already waiting? don't add it twice
    const last = sh.getLastRow();
    if (last > 1) {
      const rows = sh.getRange(2, 1, last - 1, COLS.length).getValues();
      const dup = rows.some(r => unsafeCell_(r[C["House name"] - 1]).toLowerCase() === name.toLowerCase() && r[C["Status"] - 1] !== "Rejected");
      if (dup) return json_({ ok: false, error: name + " is already on the map or waiting for approval. Email " + SETTINGS.ADMIN_EMAIL + " if it needs correcting." });
    }

    const id = Utilities.getUuid().replace(/-/g, "").slice(0, 10);
    const row = new Array(COLS.length).fill("");
    row[C["ID"] - 1] = id;
    row[C["Submitted"] - 1] = new Date();
    row[C["Status"] - 1] = "Pending";
    row[C["House name"] - 1] = safeCell_(name);
    row[C["Lane"] - 1] = safeCell_(lane);
    row[C["How to spot it"] - 1] = safeCell_(note);
    row[C["Latitude"] - 1] = lat;
    row[C["Longitude"] - 1] = lng;
    row[C["Check location"] - 1] = '=HYPERLINK("https://www.google.com/maps?q=' + lat + "," + lng + '&t=k","Open in Google Maps")';
    row[C["Owner email"] - 1] = safeCell_(email);
    row[C["Consent"] - 1] = "Yes";
    sh.appendRow(row);

    notifyAdmin_(id, name, lane, note, lat, lng);
    if (SETTINGS.SEND_ACKNOWLEDGEMENT) {
      send_(email, "We've received " + name,
        "Hello,\n\nThanks for adding " + name + " to the " + SETTINGS.MAP_NAME + ".\n\n" +
        "A local volunteer will check it, usually within a few days. We'll email you again when it's on the map.\n\n" +
        "If you didn't send this, you can ignore this email and nothing will be published.\n\n" + SETTINGS.MAP_NAME);
    }
    return json_({ ok: true, id: id });
  } finally {
    lock.releaseLock();
  }
}

/* ---------------- approvals ---------------- */

/** Installable trigger (created by setup): runs when anyone edits the sheet. */
function onSheetEdit(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  if (sh.getName() !== SHEET_NAME) return;
  const c0 = e.range.getColumn(), c1 = c0 + e.range.getNumColumns() - 1;
  if (C["Status"] < c0 || C["Status"] > c1) return;
  const r0 = Math.max(2, e.range.getRow()), r1 = e.range.getRow() + e.range.getNumRows() - 1;
  for (let r = r0; r <= r1; r++) processRow_(sh, r);
  CacheService.getScriptCache().remove("houses");
}

/** Menu item: sends any approval emails that were missed (e.g. rows approved before setup). */
function sendMissedEmails() {
  const sh = sheet_();
  for (let r = 2; r <= sh.getLastRow(); r++) processRow_(sh, r);
  CacheService.getScriptCache().remove("houses");
  book_().toast("Done. Any missed approval emails have been sent.");
}

function processRow_(sh, r) {
  const v = sh.getRange(r, 1, 1, COLS.length).getValues()[0];
  const status = v[C["Status"] - 1], notified = v[C["Owner notified"] - 1];
  const id = v[C["ID"] - 1], name = unsafeCell_(v[C["House name"] - 1]), email = unsafeCell_(v[C["Owner email"] - 1]).trim();
  if (!id || !STATUSES.includes(status) || status === "Pending") return;
  if (!v[C["Reviewed"] - 1]) sh.getRange(r, C["Reviewed"]).setValue(new Date());
  if (notified) return;

  if (status === "Approved") {
    if (email) {
      const link = SETTINGS.MAP_URL.replace(/#.*$/, "") + "#h/s-" + id;
      send_(email, name + " is now on the " + SETTINGS.MAP_NAME,
        "Hello,\n\nGood news: " + name + " is now on the " + SETTINGS.MAP_NAME + ".\n\n" +
        "Here's a link straight to it. You can send it to couriers or add it to your delivery instructions:\n" + link + "\n\n" +
        "If anything needs correcting, or you'd like it removed, just reply to this email.\n\n" + SETTINGS.MAP_NAME);
    }
    sh.getRange(r, C["Owner notified"]).setValue(email ? new Date() : "No email on file");
  } else if (status === "Rejected") {
    if (email && SETTINGS.SEND_REJECTION_EMAIL) {
      send_(email, "About " + name + " on the " + SETTINGS.MAP_NAME,
        "Hello,\n\nThanks for adding " + name + ". We weren't able to put it on the map this time, usually because we couldn't confirm the location.\n\n" +
        "Reply to this email if you'd like to sort it out.\n\n" + SETTINGS.MAP_NAME);
      sh.getRange(r, C["Owner notified"]).setValue(new Date());
    } else {
      sh.getRange(r, C["Owner notified"]).setValue("Not emailed");
    }
  }
  if (SETTINGS.DELETE_EMAIL_AFTER_NOTIFY && email) sh.getRange(r, C["Owner email"]).setValue("(deleted after notifying)");
}

function approvedHouses_() {
  const sh = sheet_(), last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, COLS.length).getValues()
    .filter(r => r[C["Status"] - 1] === "Approved" && r[C["ID"] - 1])
    .map(r => ({
      id: String(r[C["ID"] - 1]),
      name: unsafeCell_(r[C["House name"] - 1]),
      lane: unsafeCell_(r[C["Lane"] - 1]),
      note: unsafeCell_(r[C["How to spot it"] - 1]),
      lat: Number(r[C["Latitude"] - 1]),
      lng: Number(r[C["Longitude"] - 1])
    }))
    .filter(h => h.name && isFinite(h.lat) && isFinite(h.lng));
}

/* ---------------- setup ---------------- */

/** Run once from the Apps Script editor. Safe to run again. */
function setup() {
  const ss = SpreadsheetApp.getActive();
  PropertiesService.getScriptProperties().setProperty("SHEET_ID", ss.getId());
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME, 0);
  sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight("bold").setBackground("#e9ecdc");
  sh.setFrozenRows(1);
  const statusRange = sh.getRange(2, C["Status"], sh.getMaxRows() - 1, 1);
  statusRange.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(false).build());
  const rules = [
    ["Pending", "#fff4cc"], ["Approved", "#d9f0dc"], ["Rejected", "#f7d9d6"]
  ].map(([t, bg]) => SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(t).setBackground(bg).setRanges([statusRange]).build());
  sh.setConditionalFormatRules(rules);
  [90, 140, 100, 220, 140, 240, 90, 90, 150, 200, 70, 140, 140, 220].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.getRange(2, C["Submitted"], sh.getMaxRows() - 1, 1).setNumberFormat("d mmm yyyy h:mm");
  sh.getRange(2, C["Reviewed"], sh.getMaxRows() - 1, 2).setNumberFormat("d mmm yyyy h:mm");

  // one edit trigger, never duplicates
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "onSheetEdit").forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("onSheetEdit").forSpreadsheet(ss).onEdit().create();

  // carry over the house added during the prototype
  if (sh.getLastRow() < 2) {
    const lat = 53.744121, lng = -2.055781, row = new Array(COLS.length).fill("");
    row[C["ID"] - 1] = "cally2"; row[C["Submitted"] - 1] = new Date(); row[C["Status"] - 1] = "Approved";
    row[C["House name"] - 1] = "2 Cally Hall Farm Cottages"; row[C["Lane"] - 1] = "Badger Lane";
    row[C["Latitude"] - 1] = lat; row[C["Longitude"] - 1] = lng;
    row[C["Check location"] - 1] = '=HYPERLINK("https://www.google.com/maps?q=' + lat + "," + lng + '&t=k","Open in Google Maps")';
    row[C["Consent"] - 1] = "Yes"; row[C["Reviewed"] - 1] = new Date(); row[C["Owner notified"] - 1] = "Added by organiser";
    sh.appendRow(row);
  }
  CacheService.getScriptCache().remove("houses");
  ss.toast("Setup finished. Now deploy the script as a web app (see README).");
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu("Community Map")
    .addItem("Send any missed approval emails", "sendMissedEmails")
    .addItem("Run setup again", "setup")
    .addToUi();
}

/* ---------------- helpers ---------------- */

/** The spreadsheet this script belongs to. setup() remembers its ID, so the web app
 *  always finds it, even where Google doesn't report an "active" spreadsheet. */
function book_() {
  let ss = null;
  try { ss = SpreadsheetApp.getActive(); } catch (err) {}
  if (ss) return ss;
  const id = PropertiesService.getScriptProperties().getProperty("SHEET_ID");
  if (id) return SpreadsheetApp.openById(id);
  throw new Error("Open the sheet, go to Extensions > Apps Script, and run setup() from there.");
}
/** The Submissions tab, created with its headings if it's missing. */
function sheet_() {
  const ss = book_();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME, 0);
    sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight("bold").setBackground("#e9ecdc");
    sh.setFrozenRows(1);
  }
  return sh;
}
function notifyAdmin_(id, name, lane, note, lat, lng) {
  const url = book_().getUrl();
  send_(SETTINGS.ADMIN_EMAIL, "New house to approve: " + name,
    "A neighbour has added a house to the " + SETTINGS.MAP_NAME + ".\n\n" +
    "House name: " + name + "\nLane: " + (lane || "Not given") + "\nHow to spot it: " + (note || "Not given") + "\n" +
    "Where they put it: https://www.google.com/maps?q=" + lat + "," + lng + "&t=k\n\n" +
    "To approve or reject, open the sheet and change Status for row " + id + ":\n" + url + "\n\n" +
    "Approving emails the owner automatically.");
}
function send_(to, subject, body) {
  try {
    MailApp.sendEmail({ to: to, subject: subject, body: body, name: SETTINGS.MAP_NAME, replyTo: SETTINGS.ADMIN_EMAIL });
  } catch (err) { console.error("Email failed: " + err); }
}
function clean_(s, max) { return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max); }
/** Stop text starting with = + - @ being treated as a spreadsheet formula. */
function safeCell_(s) { s = String(s || ""); return /^[=+\-@]/.test(s) ? "'" + s : s; }
function unsafeCell_(s) { s = String(s || ""); return s.charAt(0) === "'" ? s.slice(1) : s; }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/** Run from the editor to check email works. Unlike the map's emails, this shows any error. */
function testEmail() {
  MailApp.sendEmail({ to: SETTINGS.ADMIN_EMAIL, subject: "Test from the " + SETTINGS.MAP_NAME,
    body: "If you can read this, approval alerts can reach " + SETTINGS.ADMIN_EMAIL + ".\n\nEmails left today: " + MailApp.getRemainingDailyQuota() });
  console.log("Sent a test email to " + SETTINGS.ADMIN_EMAIL + ". Emails left today: " + MailApp.getRemainingDailyQuota());
}
