/* Leaflet-kaartweergave voor Janka's Appie */

const AppMap = (() => {
  let map = null;
  let markersLayer = null;
  let userMarker = null;

  function init(lat, lon) {
    if (map) return;
    map = L.map("map").setView([lat, lon], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-bijdragers',
      maxZoom: 19
    }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);
  }

  function setUserLocation(lat, lon) {
    if (!map) init(lat, lon);
    if (userMarker) userMarker.remove();
    userMarker = L.circleMarker([lat, lon], {
      radius: 8,
      color: "#e67e22",
      fillColor: "#e67e22",
      fillOpacity: 0.9
    }).addTo(map).bindPopup("Jouw locatie");
  }

  function invalidateSize() {
    if (map) setTimeout(() => map.invalidateSize(), 100);
  }

  function setItems(items) {
    if (!markersLayer) return;
    markersLayer.clearLayers();
    items.forEach(it => {
      const marker = L.marker([it.lat, it.lon]);
      const link = it.url ? `<br><a href="${it.url}" target="_blank" rel="noopener">Meer info</a>` : "";
      marker.bindPopup(`<b>${escapeHtml(it.title)}</b><br>${escapeHtml(it.dateLabel || "")}<br>${it.distanceKm.toFixed(1)} km — ${escapeHtml(it.source)}${link}`);
      marker.addTo(markersLayer);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  return { init, setUserLocation, setItems, invalidateSize };
})();
