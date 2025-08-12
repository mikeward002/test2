/* QuietPath Finder – app.js (patched to match current HTML IDs)
   - Works with controls: #location-input, #distance, #rating, #reviews, #open-now, #apply-filters
   - Map-only view (no list/map tabs required)
   - Nearby Search: type=funeral_home
*/

// ---- Global state ----
const state = {
  center: { lat: 39.8283, lng: -98.5795 }, // US center fallback
  radiusMiles: 10,
  minRating: 0,
  minReviews: 0,
  openNow: false,
  map: null,
  markers: [],
  placesService: null,
  autocomplete: null,
  lastResults: [],
};

// Persist/restore simple state from localStorage
function loadState(){
  try {
    const saved = JSON.parse(localStorage.getItem('qp_finder_state') || '{}');
    Object.assign(state, saved);
  } catch(e){}
}
function saveState(){
  const toSave = {
    radiusMiles: state.radiusMiles,
    minRating: state.minRating,
    minReviews: state.minReviews,
    openNow: state.openNow,
    center: state.center,
  };
  localStorage.setItem('qp_finder_state', JSON.stringify(toSave));
}

// ---- Init app: callback from Google Maps script ----
window.initApp = function initApp(){
  loadState();
  bindControls();
  initMapAndAutocomplete().then(runInitialSearch);
};

// ---- Controls binding ----
function $(id){ return document.getElementById(id); }

function bindControls(){
  // Inputs (match current HTML IDs)
  const distanceSelect = $('distance');
  const minRatingSelect = $('rating');
  const minReviewsSelect = $('reviews');
  const openNowCheckbox = $('open-now');
  const applyBtn = $('apply-filters');

  // Guard if any are missing
  if(!distanceSelect || !minRatingSelect || !minReviewsSelect || !openNowCheckbox || !applyBtn){
    console.warn('Some UI controls are missing; the finder will still initialize.');
  }

  // Restore UI from state
  if(distanceSelect) distanceSelect.value = String(state.radiusMiles);
  if(minRatingSelect) minRatingSelect.value = String(state.minRating);
  if(minReviewsSelect) minReviewsSelect.value = String(state.minReviews);
  if(openNowCheckbox) openNowCheckbox.checked = !!state.openNow;

  // Apply filters
  if(applyBtn){
    applyBtn.addEventListener('click', () => {
      if(distanceSelect) state.radiusMiles = Number(distanceSelect.value);
      if(minRatingSelect) state.minRating = Number(minRatingSelect.value);
      if(minReviewsSelect) state.minReviews = Number(minReviewsSelect.value);
      if(openNowCheckbox) state.openNow = !!openNowCheckbox.checked;
      saveState();
      searchAndRender();
    });
  }
}

// ---- Init map and autocomplete ----
async function initMapAndAutocomplete(){
  // Try geolocation first
  await new Promise(resolve => {
    if(navigator.geolocation){
      navigator.geolocation.getCurrentPosition((pos)=>{
        state.center = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        resolve();
      }, ()=> resolve(), { enableHighAccuracy:true, timeout:6000 });
    } else { resolve(); }
  });

  // Map
  state.map = new google.maps.Map(document.getElementById('map'), {
    center: state.center,
    zoom: 12,
    mapId: 'QUIETPATH_FINDER_V1',
    clickableIcons: false,
    gestureHandling: 'greedy',
  });

  // Places service
  state.placesService = new google.maps.places.PlacesService(state.map);

  // Autocomplete on the location input
  const input = document.getElementById('location-input');
  if(input){
    const ac = new google.maps.places.Autocomplete(input, {
      fields: ['geometry','name'],
      types: ['geocode'],
    });
    ac.addListener('place_changed', () => {
      const place = ac.getPlace();
      if(place && place.geometry && place.geometry.location){
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

// ---- Search and render ----
async function runInitialSearch(){
  await searchAndRender();
}

async function searchAndRender(){
  clearMarkers();

  const radiusMeters = milesToMeters(state.radiusMiles);
  const request = {
    location: state.center,
    radius: radiusMeters,
    type: 'funeral_home',
    openNow: state.openNow || undefined, // only include if true
  };

  // Nearby Search
  const results = await placesNearby(request);
  const normalized = results.map(r => normalizePlace(r, state.center));

  // Client-side filters for rating and reviews
  let filtered = normalized.filter(p => {
    const passesRating = (p.rating ?? 0) >= state.minRating;
    const passesReviews = (p.user_ratings_total ?? 0) >= state.minReviews;
    return passesRating && passesReviews;
  });

  // Weighted sort
  filtered.forEach(p => p.score = computeScore(p));
  filtered.sort((a,b)=> (b.score - a.score) || (a.distance_miles - b.distance_miles));

  state.lastResults = filtered;

  // Render
  addMarkers(filtered);
}

// ---- Google Places helpers ----
function placesNearby(request){
  return new Promise((resolve, reject) => {
    state.placesService.nearbySearch(request, (results, status) => {
      if(status === google.maps.places.PlacesServiceStatus.OK){
        resolve(results || []);
      } else if(status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS){
        resolve([]);
      } else {
        console.error('Places nearby error:', status);
        resolve([]); // Fail soft
      }
    });
  });
}

// Normalize minimal fields
function normalizePlace(r, center){
  const loc = r.geometry?.location;
  const lat = loc?.lat?.() ?? 0;
  const lng = loc?.lng?.() ?? 0;
  return {
    place_id: r.place_id,
    name: r.name || 'Unknown',
    lat, lng,
    address: r.vicinity || r.formatted_address || '',
    rating: r.rating ?? 0,
    user_ratings_total: r.user_ratings_total ?? 0,
    open_now: r.opening_hours?.isOpen?.() ?? r.opening_hours?.open_now ?? null,
    distance_miles: haversineMiles(center.lat, center.lng, lat, lng),
  };
}

// ---- Rendering (Map markers) ----
function clearMarkers(){
  state.markers.forEach(m => m.setMap(null));
  state.markers = [];
}
function addMarkers(items){
  for(const p of items){
    const m = new google.maps.Marker({
      position: { lat: p.lat, lng: p.lng },
      map: state.map,
      title: p.name,
    });
    const iw = new google.maps.InfoWindow({
      content: `<div style="font-weight:600">${escapeHtml(p.name)}</div><div class="muted">${(p.rating||'–')} ⭐ (${p.user_ratings_total||0})</div>`
    });
    m.addListener('click', () => iw.open({ anchor: m, map: state.map }));
    state.markers.push(m);
  }
}

// ---- Utilities ----
function milesToMeters(mi){ return mi * 1609.34; }

function haversineMiles(lat1, lon1, lat2, lon2){
  const R = 3958.8; // Earth radius in miles
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lat2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function computeScore(p){
  const distanceFactor = 1 / (1 + p.distance_miles); // closer is better
  const ratingFactor = (p.rating || 0) / 5;
  const reviewsFactor = Math.min((p.user_ratings_total || 0) / 100, 1);
  return 0.6 * distanceFactor + 0.3 * ratingFactor + 0.1 * reviewsFactor;
}

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}
