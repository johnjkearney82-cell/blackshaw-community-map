// Settings for the Blackshaw Head Community Map.
// After you deploy the Google Apps Script (see README step 2), paste its web app URL below.
// Leave it empty and the map still works: it shows listed buildings, and the
// "Add your house" form explains that submissions aren't switched on yet.
window.MAP_CONFIG = {
  // e.g. "https://script.google.com/macros/s/AKfycb.../exec"
  appsScriptUrl: "https://script.google.com/macros/s/AKfycbxINrSikPfAqQhUFvKfbvh7Fknd7l5606qcSePe9YkGZnoZ_FvzVhFf3kxk2iceTZLHag/exec",

  // Parish boundary. A copy saved in this repo is used first; if it's missing,
  // the map asks MapIt (mySociety) for Blackshaw civil parish (area 59191).
  boundaryFile: "data/parish-boundary.geojson",
  boundaryFallbackUrl: "https://mapit.mysociety.org/area/59191.geojson",

  // Where the map opens if the boundary can't be loaded.
  centre: [53.7465, -2.0650],
  zoom: 14,

  // Shown in the footer and the privacy notice.
  contactEmail: "johnjkearney82@gmail.com"
};
