# Blackshaw Head Community Map

A map of house names in Blackshaw parish (Blackshaw Head, HX7) so delivery drivers and visitors can find houses by name. Residents add their own house; a volunteer approves it in a Google Sheet.

## Stack
- Static site, no build step: `index.html`, `assets/app.js`, `assets/style.css`, `config.js`.
- Map: Leaflet 1.9.4 vendored in `vendor/leaflet/`, OpenStreetMap tiles (warm CSS filter for the illustrated look).
- Data: `data/listed-buildings.json` (Historic England listed buildings), `data/parish-boundary.geojson` (optional local copy; falls back to MapIt area 59191).
- Approvals: Google Apps Script in `apps-script/Code.gs`, bound to a Google Sheet ("Submissions" tab). Its web app URL goes in `config.js` → `appsScriptUrl`.
- Hosting: GitHub Pages from `main`, root. Live at https://johnjkearney82-cell.github.io/blackshaw-community-map/

## Working on it
```bash
python3 -m http.server 8000   # then open http://localhost:8000
```
- Changing `apps-script/Code.gs` does nothing until it's pasted into the Sheet's Apps Script editor and redeployed (Manage deployments → edit → New version, so the URL stays the same).
- House deep links are `#h/<id>`; neighbour houses use `s-<sheet ID>`.

## Rules
- House names and positions only. Never publish or store who lives anywhere; owner emails stay in the sheet and are deleted after the approval email.
- Don't copy house names from Royal Mail, Google or other licensed sources.
- Keep the OpenStreetMap and Historic England credits visible.

## Status
- First version built 25 Oct 2026. See README.md for setup steps and what's outstanding (approval sheet, config URL, boundary file, end-to-end test, parish council review).
