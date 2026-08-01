/* Hoofdlogica Janka's Appie */

const Settings = (() => {
  const KEY = "jankasAppie.settings";
  const defaults = {
    radiusKm: 10, daysAhead: 7, uitdatabankKey: "",
    nlFeestenProxyUrl: "https://janka-appie-nl-feesten.mailvanakkie.workers.dev",
    manualLocation: null,
    categoryFilters: { markt: true, evenement: true, braderie: true, kermis: true }
  };

  function load() {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; }
    catch { return { ...defaults }; }
  }

  function save(settings) {
    localStorage.setItem(KEY, JSON.stringify(settings));
  }

  return { load, save };
})();

let currentSettings = Settings.load();
let currentPosition = null;

const statusBar = document.getElementById("statusBar");
const resultList = document.getElementById("resultList");

function setStatus(text) {
  statusBar.textContent = text;
}

function categoryLabel(cat) {
  return { markt: "Markt", evenement: "Evenement", braderie: "Braderie", kermis: "Kermis" }[cat] || "Onbekend";
}

function renderList(items) {
  resultList.innerHTML = "";
  if (items.length === 0) {
    resultList.innerHTML = `<li class="empty-state">Niets gevonden binnen ${currentSettings.radiusKm} km. Vergroot de zoekstraal in instellingen.</li>`;
    return;
  }
  items.forEach(it => {
    const li = document.createElement("li");
    li.className = "result-item";
    li.innerHTML = `
      <div class="title">${escapeHtml(it.title)}</div>
      <div class="meta">
        <span class="badge">${escapeHtml(categoryLabel(it.category))}</span>
        ${it.distanceKm.toFixed(1)} km · ${escapeHtml(it.dateLabel || "")} · ${escapeHtml(it.source)}
      </div>`;
    resultList.appendChild(li);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

async function loadAndRender() {
  if (!currentPosition) return;
  setStatus("Bezig met zoeken...");

  const { items, errors } = await DataSources.fetchAll({
    lat: currentPosition.lat,
    lon: currentPosition.lon,
    radiusKm: currentSettings.radiusKm,
    daysAhead: currentSettings.daysAhead,
    uitdatabankKey: currentSettings.uitdatabankKey,
    nlFeestenProxyUrl: currentSettings.nlFeestenProxyUrl
  });

  const filters = currentSettings.categoryFilters;
  const filtered = items.filter(it => filters[it.category] !== false);

  renderList(filtered);
  AppMap.setItems(filtered);
  AppNotifications.notifyNewItems(filtered);

  const hiddenCount = items.length - filtered.length;
  const hiddenNote = hiddenCount ? ` (${hiddenCount} verborgen door filter)` : "";
  const errorNote = errors.length ? ` (${errors.length} bron(nen) tijdelijk niet bereikbaar)` : "";
  setStatus(`${filtered.length} resultaten binnen ${currentSettings.radiusKm} km${hiddenNote}${errorNote}`);
}

function usePosition(lat, lon) {
  currentPosition = { lat, lon };
  AppMap.setUserLocation(lat, lon);
  loadAndRender();
}

function handlePosition(pos) {
  usePosition(pos.coords.latitude, pos.coords.longitude);
}

function handlePositionError(err) {
  setStatus("Locatie niet beschikbaar: " + err.message + ". Geef locatietoegang om resultaten te zien, of stel een locatie handmatig in via Instellingen.");
}

function requestLocation() {
  if (currentSettings.manualLocation) {
    usePosition(currentSettings.manualLocation.lat, currentSettings.manualLocation.lon);
    return;
  }
  if (!("geolocation" in navigator)) {
    setStatus("Geolocation wordt niet ondersteund door deze browser.");
    return;
  }
  setStatus("Locatie bepalen...");
  navigator.geolocation.getCurrentPosition(handlePosition, handlePositionError, {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 5 * 60 * 1000
  });
}

// --- Tab-navigatie ---
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    btn.classList.add("active");
    const view = document.getElementById(btn.dataset.tab + "View");
    view.classList.add("active");
    if (btn.dataset.tab === "map") AppMap.invalidateSize();
  });
});

// --- Instellingen-modal ---
const settingsModal = document.getElementById("settingsModal");
const radiusInput = document.getElementById("radiusInput");
const radiusValue = document.getElementById("radiusValue");
const daysInput = document.getElementById("daysInput");
const daysValue = document.getElementById("daysValue");
const uitdatabankKeyInput = document.getElementById("uitdatabankKeyInput");
const nlFeestenProxyInput = document.getElementById("nlFeestenProxyInput");
const locationSearchInput = document.getElementById("locationSearchInput");
const locationStatus = document.getElementById("locationStatus");
const catInputs = {
  markt: document.getElementById("catMarkt"),
  evenement: document.getElementById("catEvenement"),
  braderie: document.getElementById("catBraderie"),
  kermis: document.getElementById("catKermis")
};

function renderLocationStatus() {
  locationStatus.textContent = currentSettings.manualLocation
    ? "Handmatig ingesteld: " + currentSettings.manualLocation.label
    : "GPS-locatie wordt gebruikt.";
}

function openSettings() {
  radiusInput.value = currentSettings.radiusKm;
  radiusValue.textContent = currentSettings.radiusKm + " km";
  daysInput.value = currentSettings.daysAhead;
  daysValue.textContent = currentSettings.daysAhead + " dagen";
  uitdatabankKeyInput.value = currentSettings.uitdatabankKey;
  nlFeestenProxyInput.value = currentSettings.nlFeestenProxyUrl;
  Object.keys(catInputs).forEach(cat => { catInputs[cat].checked = currentSettings.categoryFilters[cat] !== false; });
  renderLocationStatus();
  settingsModal.classList.remove("hidden");
}

function closeSettings() {
  const categoryFilters = {};
  Object.keys(catInputs).forEach(cat => { categoryFilters[cat] = catInputs[cat].checked; });

  currentSettings = {
    ...currentSettings,
    radiusKm: parseInt(radiusInput.value, 10),
    daysAhead: parseInt(daysInput.value, 10),
    uitdatabankKey: uitdatabankKeyInput.value.trim(),
    nlFeestenProxyUrl: nlFeestenProxyInput.value.trim(),
    categoryFilters
  };
  Settings.save(currentSettings);
  settingsModal.classList.add("hidden");
  loadAndRender();
}

// --- Handmatige locatie (Nominatim/OpenStreetMap plaatsnaam-zoek) ---
async function searchLocation() {
  const query = locationSearchInput.value.trim();
  if (!query) return;
  locationStatus.textContent = "Zoeken naar \"" + query + "\"...";
  try {
    const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=" + encodeURIComponent(query);
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const results = await res.json();
    if (!results.length) {
      locationStatus.textContent = "Niets gevonden voor \"" + query + "\".";
      return;
    }
    const r = results[0];
    currentSettings.manualLocation = { lat: parseFloat(r.lat), lon: parseFloat(r.lon), label: r.display_name };
    Settings.save(currentSettings);
    renderLocationStatus();
    usePosition(currentSettings.manualLocation.lat, currentSettings.manualLocation.lon);
  } catch (e) {
    locationStatus.textContent = "Zoeken mislukt: " + e.message;
  }
}

document.getElementById("locationSearchBtn").addEventListener("click", searchLocation);
locationSearchInput.addEventListener("keydown", e => { if (e.key === "Enter") searchLocation(); });
document.getElementById("useGpsBtn").addEventListener("click", () => {
  currentSettings.manualLocation = null;
  Settings.save(currentSettings);
  renderLocationStatus();
  requestLocation();
});

document.getElementById("settingsBtn").addEventListener("click", openSettings);
document.getElementById("closeSettingsBtn").addEventListener("click", closeSettings);
radiusInput.addEventListener("input", () => radiusValue.textContent = radiusInput.value + " km");
daysInput.addEventListener("input", () => daysValue.textContent = daysInput.value + " dagen");
document.getElementById("refreshBtn").addEventListener("click", () => { closeSettings(); });
document.getElementById("enableNotificationsBtn").addEventListener("click", async () => {
  const result = await AppNotifications.requestPermission();
  setStatus(result === "granted" ? "Meldingen ingeschakeld." : "Meldingen niet ingeschakeld (" + result + ").");
});

// --- Init ---
AppNotifications.registerServiceWorker();
requestLocation();
