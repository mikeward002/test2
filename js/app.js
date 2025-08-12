
// QuietPath Funeral Home Finder - Map/List Version
let map, service, infowindow;
let markers = [];
let currentLocation = null;
let currentPlaces = [];

function initApp() {
    const locationInput = document.getElementById('locationInput');
    const distanceSelect = document.getElementById('distanceSelect');
    const minRatingSelect = document.getElementById('minRatingSelect');
    const minReviewsSelect = document.getElementById('minReviewsSelect');
    const openNowCheckbox = document.getElementById('openNowCheckbox');
    const applyBtn = document.getElementById('applyBtn');
    const mapTab = document.getElementById('mapTab');
    const listTab = document.getElementById('listTab');
    const searchAreaBtn = document.getElementById('searchAreaBtn');
    const listContainer = document.getElementById('list');

    map = new google.maps.Map(document.getElementById('map'), {
        zoom: 12,
        center: { lat: 39.5, lng: -98.35 }, // USA center
    });

    infowindow = new google.maps.InfoWindow();
    service = new google.maps.places.PlacesService(map);

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                currentLocation = new google.maps.LatLng(pos.coords.latitude, pos.coords.longitude);
                map.setCenter(currentLocation);
            },
            () => console.warn("Geolocation not available")
        );
    }

    applyBtn.addEventListener('click', () => searchPlaces());
    searchAreaBtn.addEventListener('click', () => searchPlaces(map.getCenter()));

    mapTab.addEventListener('click', () => {
        document.getElementById('map').style.display = 'block';
        listContainer.style.display = 'none';
    });

    listTab.addEventListener('click', () => {
        document.getElementById('map').style.display = 'none';
        listContainer.style.display = 'block';
    });

    searchPlaces();
}

function searchPlaces(center = currentLocation) {
    if (!center) return;

    const request = {
        location: center,
        radius: document.getElementById('distanceSelect').value * 1609, // miles to meters
        type: ['funeral_home'],
        openNow: document.getElementById('openNowCheckbox').checked || undefined,
    };

    service.nearbySearch(request, (results, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK) {
            clearMarkers();
            currentPlaces = results
                .filter(place => {
                    const minRating = parseFloat(document.getElementById('minRatingSelect').value);
                    const minReviews = parseInt(document.getElementById('minReviewsSelect').value);
                    return (!minRating || (place.rating && place.rating >= minRating)) &&
                           (!minReviews || (place.user_ratings_total && place.user_ratings_total >= minReviews));
                })
                .sort((a, b) => (b.rating || 0) - (a.rating || 0));

            currentPlaces.forEach(place => {
                addMarker(place);
                addListResult(place);
            });
        }
    });
}

function addMarker(place) {
    const marker = new google.maps.Marker({
        map,
        position: place.geometry.location,
        title: place.name,
    });

    marker.addListener('click', () => {
        infowindow.setContent(`
            <div><strong>${place.name}</strong><br>
            ${place.vicinity || ''}<br>
            Rating: ${place.rating || 'N/A'} (${place.user_ratings_total || 0} reviews)</div>
        `);
        infowindow.open(map, marker);
    });

    markers.push(marker);
}

function addListResult(place) {
    const listContainer = document.getElementById('list');
    const div = document.createElement('div');
    div.className = 'list-item';
    div.innerHTML = `
        <strong>${place.name}</strong><br>
        ${place.vicinity || ''}<br>
        Rating: ${place.rating || 'N/A'} (${place.user_ratings_total || 0} reviews)
    `;
    listContainer.appendChild(div);
}

function clearMarkers() {
    markers.forEach(marker => marker.setMap(null));
    markers = [];
    document.getElementById('list').innerHTML = '';
}

window.initApp = initApp;
