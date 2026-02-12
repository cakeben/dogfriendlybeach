import { beaches } from './data.js';

const form = document.getElementById('search-form');
const addressInput = document.getElementById('address');
const resetBtn = document.getElementById('reset-btn');
const statusEl = document.getElementById('status');
const rowsEl = document.getElementById('rows');
const radiusEl = document.getElementById('radius');
const radiusVal = document.getElementById('radius-val');
const sortEl = document.getElementById('sort');

const defaultCenter = [54.4, -3.5];
const defaultZoom = 5.5;

const map = L.map('map', { zoomControl: true }).setView(defaultCenter, defaultZoom);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

let userMarker;
let beachMarkers = [];
let userLoc = null;

const distanceMiles = (a, b) => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return (2 * R * Math.asin(Math.sqrt(h))) * 0.621371;
};

function beachScore(item) {
  const ratingWeight = item.rating * 18;
  const reviewWeight = Math.log10(item.reviews + 1) * 13;
  const distPenalty = item.distanceMiles != null ? Math.min(item.distanceMiles, 120) * 0.45 : 0;
  return Number((ratingWeight + reviewWeight - distPenalty).toFixed(2));
}

function directionsLink(item) {
  if (userLoc) {
    return `https://www.google.com/maps/dir/?api=1&origin=${userLoc.lat},${userLoc.lon}&destination=${item.lat},${item.lon}&travelmode=driving`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${item.lat},${item.lon}`;
}

function mapLink(item) {
  return `https://www.google.com/maps/search/?api=1&query=${item.lat},${item.lon}`;
}

function render(list) {
  rowsEl.innerHTML = '';
  beachMarkers.forEach((m) => m.remove());
  beachMarkers = [];

  list.forEach((b, idx) => {
    const websiteHtml = b.website ? `<a href="${b.website}" target="_blank" rel="noopener noreferrer">Website</a>` : '';
    const mapHtml = `<a href="${mapLink(b)}" target="_blank" rel="noopener noreferrer">Map</a>`;
    const directionsHtml = `<a href="${directionsLink(b)}" target="_blank" rel="noopener noreferrer">Directions</a>`;
    const linksHtml = [websiteHtml, mapHtml, directionsHtml].filter(Boolean).join(' · ');

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${b.name}</td>
      <td>${b.area}</td>
      <td>${b.dogAccess}</td>
      <td>${b.rating.toFixed(1)}</td>
      <td>${b.reviews.toLocaleString()}</td>
      <td>${b.distanceMiles == null ? '-' : `${b.distanceMiles.toFixed(1)} mi`}</td>
      <td><span class="badge">${b.score.toFixed(2)}</span></td>
      <td>${linksHtml}</td>
    `;
    rowsEl.appendChild(tr);

    const marker = L.marker([b.lat, b.lon])
      .addTo(map)
      .bindPopup(`<strong>${b.name}</strong><br/>${b.area}<br/>🐾 ${b.dogAccess}<br/>⭐ ${b.rating} (${b.reviews.toLocaleString()} reviews)<br/>${linksHtml}`);
    beachMarkers.push(marker);
  });
}

async function geocodeAddress(query) {
  const trimmed = query.trim();
  const postcodeLike = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i.test(trimmed);

  if (postcodeLike) {
    const pcRes = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(trimmed)}`);
    if (pcRes.ok) {
      const pcPayload = await pcRes.json();
      if (pcPayload?.result) {
        return { lat: pcPayload.result.latitude, lon: pcPayload.result.longitude, label: pcPayload.result.postcode };
      }
    }
  }

  const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=gb&q=${encodeURIComponent(trimmed)}`);
  if (!geoRes.ok) throw new Error('Address not found');
  const geoPayload = await geoRes.json();
  if (!Array.isArray(geoPayload) || geoPayload.length === 0) throw new Error('Address not found');

  return {
    lat: Number(geoPayload[0].lat),
    lon: Number(geoPayload[0].lon),
    label: geoPayload[0].display_name
  };
}

function computeView() {
  const radius = Number(radiusEl.value);
  radiusVal.textContent = String(radius);

  const allWithDistance = beaches.map((b) => {
    const dist = userLoc ? distanceMiles(userLoc, b) : null;
    return { ...b, distanceMiles: dist, score: 0 };
  });

  let ranked = allWithDistance;
  if (userLoc) ranked = ranked.filter((b) => b.distanceMiles <= radius);

  if (userLoc && ranked.length === 0) {
    ranked = [...allWithDistance].sort((a, b) => (a.distanceMiles ?? 999) - (b.distanceMiles ?? 999)).slice(0, 25);
    statusEl.textContent = `No beaches within ${radius} miles. Showing nearest dog friendly beaches.`;
  }

  ranked = ranked.map((b) => ({ ...b, score: beachScore(b) }));

  switch (sortEl.value) {
    case 'distance':
      ranked.sort((a, b) => (a.distanceMiles ?? 999) - (b.distanceMiles ?? 999));
      break;
    case 'rating':
      ranked.sort((a, b) => b.rating - a.rating || b.reviews - a.reviews);
      break;
    case 'reviews':
      ranked.sort((a, b) => b.reviews - a.reviews);
      break;
    default:
      ranked.sort((a, b) => b.score - a.score);
  }

  ranked = ranked.slice(0, 25);
  render(ranked);

  if (ranked.length > 0) {
    const group = L.featureGroup(beachMarkers.concat(userMarker ? [userMarker] : []));
    map.fitBounds(group.getBounds().pad(0.2));
  } else if (!userLoc) {
    map.setView(defaultCenter, defaultZoom);
  }
}



function resetView() {
  userLoc = null;
  addressInput.value = '';
  if (userMarker) {
    userMarker.remove();
    userMarker = undefined;
  }
  statusEl.textContent = 'Showing UK dog-allowed beaches from The Beach Guide.';
  computeView();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = addressInput.value.trim();
  if (!query) return;

  statusEl.textContent = 'Resolving address...';
  try {
    userLoc = await geocodeAddress(query);
    if (userMarker) userMarker.remove();
    userMarker = L.marker([userLoc.lat, userLoc.lon]).addTo(map).bindPopup('Your location').openPopup();
    statusEl.textContent = `Showing dog friendly beaches near ${userLoc.label || query}.`;
    computeView();
  } catch {
    statusEl.textContent = `Could not find location: ${query}`;
  }
});

resetBtn.addEventListener('click', resetView);
radiusEl.addEventListener('input', computeView);
sortEl.addEventListener('change', computeView);

resetView();
