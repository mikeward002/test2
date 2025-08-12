/* QuietPath Finder – app.js
   Beginner-friendly v1 implementing Steps 3–7.
   - Map/List toggle
   - Geolocation + Autocomplete
   - Nearby Search for type=funeral_home
   - Filters with Apply button
   - "Search this area" after map pan/zoom
   - Client-side rating/reviews filter and weighted sort
*/

// ---- Global state ----
const state = {
  center: { lat: 39.8283, lng: -98.5795 }, // US center fallback
  radiusMiles: 10,
  minRating: 4.0,
  minReviews: 0,
  openNow: false,
  view: 'map', // 'map' | 'list'
  map: null,
  markers: [],
  placesService: null,
  autocomplete: null,
  dirtyBounds: false,
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
    view: state.view,
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
function bindControls(){
  // Inputs
  const distanceSelect = document.getElementById('distanceSelect');
  const minRatingSelect = document.getElementById('minRatingSelect');
  const minReviewsSelect = document.getElementById('minReviewsSelect');
  const openNowCheckbox = document.getElementById('openNowCheckbox');
  const applyBtn = document.getElementById('applyBtn');

  // Restore UI from state
  distanceSelect.value = String(state.radiusMiles);
  minRatingSelect.value = String(state.minRating);
  minReviewsSelect.value = String(state.minReviews);
  openNowCheckbox.checked = !!state.openNow;

  // Apply filters
  applyBtn.addEventListener('click', () => {
    state.radiusMiles = Number(distanceSelect.value);
    state.minRating = Number(minRatingSelect.value);
    state.minReviews = Number(minReviewsSelect.value);
    state.openNow = !!openNowCheckbox.checked;
    saveState();
    searchAndRender();
  });

  // Map/List toggle
  const mapTab = document.getElementById('mapTab');
  const listTab = document.getElementById('listTab');
  mapTab.addEventListener('click', () => setView('map'));
  listTab.addEventListener('click', () => setView('list'));
  setView(state.view); // restore

  // Search this area
  document.getElementById('searchAreaBtn').addEventListener('click', () => {
    state.dirtyBounds = false;
    document.getElementById('searchAreaBtn').hidden = true;
    state.center = { lat: state.map.getCenter().lat(), lng: state.map.getCenter().lng() };
    saveState();
    searchAndRender();
  });
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

  // Reveal "Search this area" after user pans/zooms
  state.map.addListener('idle', () => {
    if(!state.dirtyBounds){ return; }
    document.getElementById('searchAreaBtn').hidden = false;
  });
  state.map.addListener('dragstart', () => state.dirtyBounds = true);
  state.map.addListener('zoom_changed', () => state.dirtyBounds = true);

  // Places service
  state.placesService = new google.maps.places.PlacesService(state.map);

  // Autocomplete on the location input
  const input = document.getElementById('locationInput');
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
      state.dirtyBounds = false;
      document.getElementById('searchAreaBtn').hidden = true;
      saveState();
      searchAndRender();
    }
  });
  state.autocomplete = ac;
}

// ---- Search and render ----
async function runInitialSearch(){
  await searchAndRender();
}

async function searchAndRender(){
  clearMarkers();
  renderListLoading();

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
  renderList(filtered);

  // Empty state
  if(filtered.length === 0){
    renderEmpty();
  }
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
    phone: null, // requires Place Details
    website: null, // requires Place Details
    rating: r.rating ?? 0,
    user_ratings_total: r.user_ratings_total ?? 0,
    open_now: r.opening_hours?.isOpen?.() ?? r.opening_hours?.open_now ?? null,
    distance_miles: haversineMiles(center.lat, center.lng, lat, lng),
  };
}

// Optionally fetch details for phone/website on demand (throttled)
const detailsQueue = [];
let detailsTimer = null;
function queueDetails(place_id, cb){
  detailsQueue.push({ place_id, cb });
  if(!detailsTimer){
    detailsTimer = setInterval(processDetailsQueue, 350); // ~3/sec gentle
  }
}
function processDetailsQueue(){
  if(detailsQueue.length === 0){
    clearInterval(detailsTimer); detailsTimer = null; return;
  }
  const { place_id, cb } = detailsQueue.shift();
  state.placesService.getDetails(
    { placeId: place_id, fields: ['formatted_phone_number','international_phone_number','website','url','opening_hours']},
    (res, status) => {
      if(status === google.maps.places.PlacesServiceStatus.OK){
        cb(res);
      } else {
        cb(null);
      }
    }
  );
}

// ---- Rendering (Map) ----
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

// ---- Rendering (List) ----
function renderListLoading(){
  const list = document.getElementById('list');
  list.hidden = (state.view !== 'list');
  list.innerHTML = `<div class="card">Loading results…</div>`;
}
function renderEmpty(){
  const list = document.getElementById('list');
  list.innerHTML = `<div class="empty">No results. Try widening distance or lowering the rating filter.</div>`;
}

function renderList(items){
  const list = document.getElementById('list');
  list.hidden = (state.view !== 'list');
  list.innerHTML = ''; // clear

  if(items.length === 0){
    renderEmpty(); return;
  }

  for(const p of items){
    const card = document.createElement('article');
    card.className = 'card';

    const header = document.createElement('div');
    header.className = 'result-header';
    header.innerHTML = `
      <h3>${escapeHtml(p.name)}</h3>
      <div class="rating">${p.rating?.toFixed?.(1) ?? '–'} <span class="count">(${p.user_ratings_total || 0})</span></div>
    `;
    card.appendChild(header);

    const addr = document.createElement('p');
    addr.className = 'muted';
    addr.textContent = p.address || '';
    card.appendChild(addr);

    const chips = document.createElement('div');
    chips.className = 'chips';
    if(p.open_now === true) chips.innerHTML += `<span class="chip">Open now</span>`;
    chips.innerHTML += `<span class="chip">${p.distance_miles.toFixed(1)} mi</span>`;
    card.appendChild(chips);

    const actions = document.createElement('div');
    actions.className = 'actions';

    // Details on demand: fetch phone/website once when rendering
    queueDetails(p.place_id, (details) => {
      if(details){
        const phoneNum = details.formatted_phone_number || details.international_phone_number;
        const website = details.website;
        if(phoneNum){
          const a = document.createElement('a');
          a.className = 'btn btn-secondary';
          a.href = `tel:${phoneNum.replace(/\s+/g,'')}`;
          a.textContent = 'Call';
          actions.appendChild(a);
        }
        if(website){
          const w = document.createElement('a');
          w.className = 'btn btn-secondary';
          w.href = website; w.target = '_blank'; w.rel = 'noopener';
          w.textContent = 'Website';
          actions.appendChild(w);
        }
      }
    });

    const dir = document.createElement('a');
    dir.className = 'btn btn-primary';
    dir.href = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
    dir.target = '_blank'; dir.rel = 'noopener';
    dir.textContent = 'Directions';
    actions.appendChild(dir);

    card.appendChild(actions);
    list.appendChild(card);
  }
}

// ---- View toggle ----
function setView(next){
  const mapEl = document.getElementById('map');
  const listEl = document.getElementById('list');
  const mapTab = document.getElementById('mapTab');
  const listTab = document.getElementById('listTab');

  state.view = next;
  saveState();

  const isMap = next === 'map';
  mapEl.hidden = !isMap;
  listEl.hidden = isMap;

  mapTab.classList.toggle('active', isMap);
  mapTab.setAttribute('aria-selected', String(isMap));
  mapTab.setAttribute('aria-pressed', String(isMap));

  listTab.classList.toggle('active', !isMap);
  listTab.setAttribute('aria-selected', String(!isMap));
  listTab.setAttribute('aria-pressed', String(!isMap));

  if(isMap && state.map){
    google.maps.event.trigger(state.map, 'resize');
    state.map.setCenter(state.center);
  }

  // If switching to list and we already have results, render them
  if(!isMap && state.lastResults.length){
    renderList(state.lastResults);
  }
}

// ---- Utilities ----
function milesToMeters(mi){ return mi * 1609.34; }

function haversineMiles(lat1, lon1, lat2, lon2){
  const R = 3958.8; // Earth radius in miles
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
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
