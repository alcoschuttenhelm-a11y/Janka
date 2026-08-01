/* Hoofdlogica Janka's Appie */

const Settings = (() => {
  const KEY = "jankasAppie.settings";
  const defaults = { radiusKm: 10, daysAhead: 7, uitdatabankKey: "", nlFeestenProxyUrl: "" };

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

  renderList(items);
  AppMap.setItems(items);
  AppNotifications.notifyNewItems(items);

  const errorNote = errors.length ? ` (${errors.length} bron(nen) tijdelijk niet bereikbaar)` : "";
  setStatus(`${items.length} resultaten binnen ${currentSettings.radiusKm} km${errorNote}`);
}

function handlePosition(pos) {
  currentPosition = { lat: pos.coords.latitude, lon: pos.coords.longitude };
  AppMap.setUserLocation(currentPosition.lat, currentPosition.lon);
  loadAndRender();
}

function handlePositionError(err) {
  setStatus("Locatie niet beschikbaar: " + err.message + ". Geef locatietoegang om resultaten te zien.");
}

function requestLocation() {
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

function openSettings() {
  radiusInput.value = currentSettings.radiusKm;
  radiusValue.textContent = currentSettings.radiusKm + " km";
  daysInput.value = currentSettings.daysAhead;
  daysValue.textContent = currentSettings.daysAhead + " dagen";
  uitdatabankKeyInput.value = currentSettings.uitdatabankKey;
  nlFeestenProxyInput.value = currentSettings.nlFeestenProxyUrl;
  settingsModal.classList.remove("hidden");
}

function closeSettings() {
  currentSettings = {
    radiusKm: parseInt(radiusInput.value, 10),
    daysAhead: parseInt(daysInput.value, 10),
    uitdatabankKey: uitdatabankKeyInput.value.trim(),
    nlFeestenProxyUrl: nlFeestenProxyInput.value.trim()
  };
  Settings.save(currentSettings);
  settingsModal.classList.add("hidden");
  loadAndRender();
}

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
