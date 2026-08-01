/*
 * Meldingen voor Janka's Appie.
 * Betrouwbaar zolang de app open staat (voorgrond-melding bij nieuwe items).
 * Achtergrond-meldingen via Periodic Background Sync zijn best-effort: alleen
 * ondersteund in Chromium-browsers op Android, en alleen als de PWA geïnstalleerd
 * is en de gebruiker de app regelmatig gebruikt (browser-heuristiek, geen garantie).
 */

const AppNotifications = (() => {
  const SEEN_KEY = "jankasAppie.seenIds";

  async function requestPermission() {
    if (!("Notification" in window)) return "unsupported";
    if (Notification.permission === "granted") return "granted";
    if (Notification.permission === "denied") return "denied";
    return await Notification.requestPermission();
  }

  function getSeenIds() {
    try {
      return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"));
    } catch {
      return new Set();
    }
  }

  function saveSeenIds(ids) {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...ids]));
  }

  // Vergelijkt nieuwe resultaten met wat eerder getoond is en meldt alleen het verschil.
  function notifyNewItems(items) {
    const seen = getSeenIds();
    const fresh = items.filter(it => !seen.has(it.id));

    items.forEach(it => seen.add(it.id));
    saveSeenIds(seen);

    if (fresh.length === 0) return;
    if (Notification.permission !== "granted") return;

    const title = fresh.length === 1
      ? `Nieuw bij jou in de buurt: ${fresh[0].title}`
      : `${fresh.length} nieuwe markten/evenementen bij jou in de buurt`;
    const body = fresh.slice(0, 3).map(it => `${it.title} (${it.distanceKm.toFixed(1)} km)`).join(", ");

    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.ready.then(reg => reg.showNotification(title, { body, icon: "icons/icon-192.png" }));
    } else {
      new Notification(title, { body, icon: "icons/icon-192.png" });
    }
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return null;
    try {
      const reg = await navigator.serviceWorker.register("service-worker.js");
      await tryEnablePeriodicSync(reg);
      return reg;
    } catch (e) {
      console.warn("Service worker registratie mislukt:", e);
      return null;
    }
  }

  // Best-effort: registreert periodieke achtergrondsynchronisatie indien de browser dit ondersteunt.
  async function tryEnablePeriodicSync(reg) {
    if (!("periodicSync" in reg)) return false;
    try {
      const status = await navigator.permissions.query({ name: "periodic-background-sync" });
      if (status.state !== "granted") return false;
      await reg.periodicSync.register("check-nearby-events", { minInterval: 6 * 60 * 60 * 1000 });
      return true;
    } catch (e) {
      console.warn("Periodic background sync niet beschikbaar:", e);
      return false;
    }
  }

  return { requestPermission, notifyNewItems, registerServiceWorker };
})();
