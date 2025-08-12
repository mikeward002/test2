/* QuietPath – Funeral Home Finder (matches your current HTML IDs)
   Requires: Google Maps JS API with Places & callback=initApp
   HTML controls:
     #locationInput #distanceSelect #minRatingSelect #minReviewsSelect
     #openNowCheckbox #applyBtn #mapTab #listTab #searchAreaBtn
     #map #list
*/

// ---------- Global state ----------
const state = {
  center: { lat: 39.8283, lng: -98.5795 }, // US fallback
  radiusMiles: 10,
  minRating: 0,
  minReviews: 0,
  openNow: false,
  map: null,
  markers: [],
  placesService: null,
  autocomplete: null,
  lastResults: [],
  listMode: "map", // "map" or "list"
};

// ---------- Persist simple preferences ----------
function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem("qp_finder_state") || "{}");
    Object.assign(state, saved);
  } catch {}
}
function saveState() {
  const toSave = {
    radiusMiles: state.radiusMiles,
    minRating: state.minRating,
    minReviews: state.minReviews,
    openNow: state.openNow,
    center: state.center,
    listMode: state.listMode,
  };
  localStorage.setItem("qp_finder_state", JSON.stringify(toSave));
}

// ---------- App entry (called by Maps via callback=initApp) ----------
window.initApp = function initApp() {
  loadState();
  bindControls();
  initMapAndAutocomplete().then(runInitialSearch);
};

// ---------- DOM helpers ----------
const $ = (id) => document.getElementById(id);

// ---------- UI wiring ----------
function bindControls() {
  const distanceSelect = $("distanceSelect");
  const minRatingSelect = $("minRatingSelect");
  const minReviewsSelect = $("minReviewsSelect");
  const openNowCheckbox = $("openNowCheckbox");
  const applyBtn = $("applyBtn");
  const mapTab = $("mapTab");
  const listTab = $("listTab");
  const searchAreaBtn = $("searchAreaBtn");

  // Restore control values
  if (distanceSelect) distanceSelect.value = String(state.radiusMiles);
  if (minRatingSelect) minRatingSelect.value = String(state.minRating);
  if (minReviewsSelect) minReviewsSelect.value = String(state.minReviews);
  if (openNowCheckbox) openNowCheckbox.checked = !!state.openNow;

  // Apply button
  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      if (distanceSelect) state.radiusMiles = Number(distanceSelect.value);
      if (minRatingSelect) state.minRating = Number(minRatingSelect.value);
      if (minReviewsSelect) state.minReviews = Number(minReviewsSelect.value);
      if (openNowCheckbox) state.openNow = !!openNowCheckbox.checked;
      saveState();
      searchAndRender();
    });
  }

  // Tabs
  function setTab(mode) {
    state.listMode = mode;
    const listEl = $("list");
    const mapEl = $("map");
    if (mode === "map") {
      mapTab?.classList.add("active");
      listTab?.classList.remove("active");
      listEl.hidden = true;
      mapEl.hidden = false;
      // Resize reflow if switching back to map
      google.maps.event.trigger(state.map, "resize");
      state.map.setCenter(state.center);
    } else {
      listTab?.classList.add("active");
      mapTab?.classList.remove("active");
      listEl.hidden = false;
      mapEl.hidden = false; // keep map visible below list if you want; set true to hide
      renderList(state.lastResults);
    }
    saveState();
  }
  mapTab?.addEventListener("click", () => setTab("map"));
  listTab?.addEventListener("click", () => setTab("list"));
  if (state.listMode === "list") setTab("list");

  // Search this area
  searchAreaBtn?.addEventListener("click", () => {
    state.center = toLatLngLiteral(state.map.getCenter());
    saveState();
    searchAndRender();
    searchAreaBtn.hidden = true;
  });
}

// ---------- Map + Autocomplete ----------
async function initMapAndAutocomplete() {
  // Try geolocation
  await new Promise((resolve) => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          state.center = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          };
          resolve();
        },
        () => resolve(),
        { enableHighAccuracy: true, timeout: 6000 }
      );
    } else resolve();
  });

  // Map
  state.map = new google.maps.Map($("map"), {
    center: state.center,
    zoom: 12,
    clickableIcons: false,
    gestureHandling: "greedy",
    mapId: "QUIETPATH_FINDER_V1",
  });

  // Show "Search this area" when user pans/zooms away
  const searchAreaBtn = $("searchAreaBtn");
  if (searchAreaBtn) {
    state.map.addListener("idle", () => {
      const center = toLatLngLiteral(state.map.getCenter());
      const moved = haversineMiles(
        center.lat,
        center.lng,
        state.center.lat,
        state.center.lng
      );
      searchAreaBtn.hidden = moved < 0.5 ? true : false;
    });
  }

  // Places service
  state.placesService = new google.maps.places.PlacesService(state.map);

  // Autocomplete
  const input = $("locationInput");
  if (input) {
    const ac = new google.maps.places.Autocomplete(input, {
      fields: ["geometry", "name"],
      types: ["geocode"],
    });
    ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      if (place?.geometry?.location) {
        const loc = place.geometry.location;
        state.center = { lat: loc.lat(), lng: loc.lng() };
        state.map.setCenter(loc);
        state.map.setZoom(12);
        saveState();
        searchAndRender();
      }
    });
    state.autocomplete = ac;
  }
}

// ---------- Search + Render ----------
async function runInitialSearch() {
  await searchAndRender();
  if (state.listMode === "list") renderList(state.lastResults);
}

async function searchAndRender() {
  clearMarkers();

  const request = {
    location: state.center,
    radius: milesToMeters(state.radiusMiles),
    type: "funeral_home",
    openNow: state.openNow || undefined, // only include if true
  };

  const results = await placesNearby(request);
  const normalized = results.map((r) => normalizePlace(r, state.center));

  // Filters
  const filtered = normalized
    .filter((p) => (p.rating ?? 0) >= state.minRating)
    .filter((p) => (p.user_ratings_total ?? 0) >= state.minReviews)
    .map((p) => ({ ...p, score: computeScore(p) }))
    .sort(
      (a, b) => b.score - a.score || a.distance_miles - b.distance_miles
    );

  state.lastResults = filtered;
  addMarkers(filtered);
  if (state.listMode === "list") renderList(filtered);
}

// Google Places wrapper
function placesNearby(request) {
  return new Promise((resolve) => {
    state.placesService.nearbySearch(request, (results, status) => {
      if (status === google.maps.places.PlacesServiceStatus.OK) {
        resolve(results || []);
      } else if (
        status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS
      ) {
        resolve([]);
      } else {
        console.error("Places nearby error:", status);
        resolve([]);
      }
    });
  });
}

// Normalize minimal fields we use
function normalizePlace(r, center) {
  const loc = r.geometry?.location;
  const lat = loc?.lat?.() ?? 0;
  const lng = loc?.lng?.() ?? 0;
  return {
    place_id: r.place_id,
    name: r.name || "Unknown",
    lat,
    lng,
    address: r.vicinity || r.formatted_address || "",
    rating: r.rating ?? 0,
    user_ratings_total: r.user_ratings_total ?? 0,
    open_now:
      r.opening_hours?.isOpen?.() ?? r.opening_hours?.open_now ?? null,
    distance_miles: haversineMiles(center.lat, center.lng, lat, lng),
  };
}

// ---------- Map markers ----------
function clearMarkers() {
  state.markers.forEach((m) => m.setMap(null));
  state.markers = [];
}
function addMarkers(items) {
  for (const p of items) {
    const m = new google.maps.Marker({
      position: { lat: p.lat, lng: p.lng },
      map: state.map,
      title: p.name,
    });
    const iw = new google.maps.InfoWindow({
      content: `
        <div style="font-weight:600">${escapeHtml(p.name)}</div>
        <div class="muted">${p.rating ?? "–"} ⭐ (${p.user_ratings_total ?? 0})</div>
        <div class="muted">${escapeHtml(p.address || "")}</div>
      `,
    });
    m.addListener("click", () => iw.open({ anchor: m, map: state.map }));
    state.markers.push(m);
  }
}

// ---------- List rendering ----------
function renderList(items) {
  const list = $("list");
  if (!list) return;
  if (!items.length) {
    list.innerHTML = `<div class="empty">No results. Try expanding the distance or changing filters.</div>`;
    return;
  }
  list.innerHTML = items
    .map(
      (p) => `
    <div class="card">
      <div class="result-header">
        <div>
          <div style="font-weight:600">${escapeHtml(p.name)}</div>
          <div class="muted">${escapeHtml(p.address || "")}</div>
        </div>
        <div class="rating">${p.rating ?? "–"} ⭐</div>
      </div>
      <div class="chips">
        <span class="chip">${p.user_ratings_total ?? 0} reviews</span>
        <span class="chip">${p.distance_miles.toFixed(1)} mi</span>
      </div>
    </div>`
    )
    .join("");
}

// ---------- Utilities ----------
function milesToMeters(mi) {
  return mi * 1609.34;
}
function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
function computeScore(p) {
  const distanceFactor = 1 / (1 + p.distance_miles); // closer is better
  const ratingFactor = (p.rating || 0) / 5;
  const reviewsFactor = Math.min((p.user_ratings_total || 0) / 100, 1);
  return 0.6 * distanceFactor + 0.3 * ratingFactor + 0.1 * reviewsFactor;
}
function toLatLngLiteral(latLng) {
  return { lat: latLng.lat(), lng: latLng.lng() };
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[m]);
}
