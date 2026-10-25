# Blackshaw Head Community Map

A map of house names in Blackshaw parish (Blackshaw Head, HX7), so delivery drivers, visitors and new neighbours can find a house by name.

- Search for a house, get directions, or copy a link to it for a courier.
- Listed buildings come pre-loaded from Historic England's records.
- Residents add their own house. A volunteer approves each one in a Google Sheet, and the resident is emailed automatically when it's on the map.
- House names only. The map never shows who lives anywhere.

It's a plain website with no build step. It runs on free GitHub Pages hosting, and a free Google Sheet with a small script handles approvals.

## What's in this folder

| File | What it's for |
| --- | --- |
| `index.html`, `assets/` | The map page, its styling and its code |
| `config.js` | The settings you change: the approval script's web address, contact email |
| `data/listed-buildings.json` | The listed buildings shown on the map. Edit to add or remove one |
| `data/parish-boundary.geojson` | The parish outline (you add this in step 4) |
| `apps-script/Code.gs` | The approval script that runs in Google Sheets |
| `privacy.html` | The privacy notice linked from the form |
| `vendor/leaflet/` | The map library (Leaflet 1.9.4), kept here so the site doesn't depend on another server |

---

## Setting it up

Allow about 30 minutes. You need a GitHub account and the Google account that will receive approval emails.

### 1. Put the site on GitHub

1. On GitHub, create a new **public** repository called `blackshaw-community-map`. Don't add a README, since this folder has one.
2. On the empty repository page, choose **uploading an existing file**. Drag in everything inside this folder (not the folder itself) and commit.
3. Go to **Settings → Pages**. Under "Build and deployment", set **Source** to *Deploy from a branch*, branch **main**, folder **/ (root)**, then **Save**.
4. After a minute or two the site is live at `https://johnjkearney82-cell.github.io/blackshaw-community-map/`.

At this point the map works, with listed buildings only. The "Add your house" form says submissions aren't switched on yet.

### 2. Create the approval sheet

1. Sign in to Google as **bernsteen@gmail.com** (the admin account, which owns the sheet and sends the emails) and create a new sheet at [sheets.new](https://sheets.new). Name it *Blackshaw Community Map – Submissions*.
2. Choose **Extensions → Apps Script**. Delete what's in the editor, paste in everything from `apps-script/Code.gs`, and click **Save**.
3. Near the top of the script, change `MAP_URL` to your live map address from step 1.4.
4. In the toolbar's function menu, choose **setup**, then click **Run**.
5. Google asks for permission. Choose your account, then **Advanced → Go to (project name) (unsafe)**, then **Allow**. "Unsafe" only means Google hasn't reviewed a script you wrote yourself. The permissions are to edit this one sheet, send email as you, and react when the sheet is edited.
6. Back in the sheet you'll see a **Submissions** tab with a Status column. *2 Cally Hall Farm Cottages* is already there as Approved.
7. In Apps Script, choose **Deploy → New deployment**. Click the cog, choose **Web app**, and set:
   - **Execute as:** Me
   - **Who has access:** Anyone
8. Click **Deploy** and copy the **Web app URL**. It ends in `/exec`.

### 3. Connect the map to the sheet

Open `config.js` on GitHub (click it, then the pencil icon). Paste the web app URL between the quotes on the `appsScriptUrl` line and commit. The live site updates within a minute or two.

### 4. Save the parish boundary (recommended)

The map draws the parish outline from mySociety's MapIt service. It's better to keep your own copy so the map doesn't rely on their server:

1. Open <https://mapit.mysociety.org/area/59191.geojson> in your browser and save the page as `parish-boundary.geojson`.
2. On GitHub, open the `data` folder, choose **Add file → Upload files**, upload it and commit.

### 5. Test it end to end

1. On the live map, use **Add your house** with a test name and your own email.
2. Check that you got the acknowledgement email and the "New house to approve" email.
3. In the sheet, change that row's **Status** to **Approved**.
4. Check that you got the "now on the map" email, and that its link opens the map at your test house.
5. Delete the test row from the sheet.

---

## Approving houses day to day

- Each new house arrives by email with a link to where it was placed on satellite view.
- In the sheet, set **Status** to **Approved** or **Rejected**. Approving emails the resident straight away. Their email address is then deleted from the sheet.
- The map picks up changes within about five minutes.
- To fix a name or position, edit the cell. To take a house off the map, set it to **Rejected** or delete the row.
- If emails were ever missed, use **Community Map → Send any missed approval emails** in the sheet's menu.
- To add more approvers, share the sheet with them as editors. Emails still come from, and go to, the admin account in `ADMIN_EMAIL`.

## Changing things later

- **The approval script.** After editing `Code.gs`, choose **Deploy → Manage deployments**, click the pencil, set **Version** to *New version* and **Deploy**. This keeps the same web address. A brand-new deployment would give a new address, and you'd have to update `config.js`.
- **Settings in the script.** You can switch off the acknowledgement email, turn on rejection emails, or keep email addresses after notifying.
- **Listed buildings.** Edit `data/listed-buildings.json`. Each entry needs a unique `id`, a `name`, `lat`/`lng`, an optional `lane`, and a `kind` of `house` or `landmark`.
- **Lanes in the drop-down.** Edit `LANE_NAMES` near the top of `assets/app.js`.
- **Your own web address.** GitHub Pages supports a custom domain such as `map.blackshawhead.org` under **Settings → Pages**.

## Limits and good manners

- **Email.** A free Google account can send about 100 emails a day. That's plenty for a parish, since each house uses two or three.
- **Map tiles.** The background map comes from OpenStreetMap's free tile servers. Their [usage policy](https://operations.osmfoundation.org/policies/tiles/) is fine for a community site this size. Keep the OpenStreetMap credit visible.
- **Spam.** The form has a hidden trap field, a minimum fill-in time, a limit on submissions per hour, and only accepts positions inside the parish. Human approval catches the rest. If spam ever becomes a nuisance, add [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/).

## Before launching to the whole village

- **Data controller.** Agree who is responsible for the data, ideally the parish council. Name them in `privacy.html` and set `contactEmail` in `config.js` to a council address.
- **Ownership.** Move the GitHub repository and the Google Sheet into council-owned accounts, so the map doesn't depend on one person.
- **Approvers.** Decide who approves houses and how quickly.
- **Let people know.** Put a QR code poster on the noticeboard and in the village newsletter, and tell residents they can put the map link in their delivery instructions.

## Credits

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
- Listed buildings from the National Heritage List for England, © Historic England.
- Parish boundary via [MapIt](https://mapit.mysociety.org/) by mySociety, from Ordnance Survey Boundary-Line. Contains OS data © Crown copyright and database right.
- Map library: [Leaflet](https://leafletjs.com/).
