(() => {
  "use strict";

  const state = {
    all: [],
    filtered: [],
    search: "",
    filters: {},
    sort: "name",
    userLocation: null,
    distances: new Map(),
    view: "list",
    map: null,
    markers: null,
    hasCoordinateData: false,
  };

  const els = {
    search: document.getElementById("searchInput"),
    filters: document.getElementById("filters"),
    sort: document.getElementById("sortSelect"),
    distanceOption: document.getElementById("distanceSortOption"),
    nearby: document.getElementById("nearbyBtn"),
    reset: document.getElementById("resetBtn"),
    cards: document.getElementById("cardsGrid"),
    count: document.getElementById("resultCount"),
    label: document.getElementById("resultLabel"),
    empty: document.getElementById("emptyState"),
    listView: document.getElementById("listView"),
    mapView: document.getElementById("mapView"),
    mapEmpty: document.getElementById("mapEmptyState"),
    listBtn: document.getElementById("listViewBtn"),
    mapBtn: document.getElementById("mapViewBtn"),
    status: document.getElementById("statusMessage"),
    locationSummary: document.getElementById("locationSummary"),
  };

  const FIELD_LABELS = {
    marca: "Marca",
    departamento: "Departamento",
    municipio: "Municipio",
    grupo: "Grupo / categoría",
  };

  const ICON = {
    pin: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 10a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z"/></svg>`,
    waze: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v10a5 5 0 0 1-5 5h-1l-3 3v-3H9a5 5 0 0 1-5-5V5a1 1 0 0 1 1-1Zm3 7a1.2 1.2 0 1 0 0-2.4A1.2 1.2 0 0 0 8 11Zm8 0a1.2 1.2 0 1 0 0-2.4A1.2 1.2 0 0 0 16 11Zm-7.3 3.2a4.8 4.8 0 0 0 6.6 0l-1.1-1.1a3.2 3.2 0 0 1-4.4 0l-1.1 1.1Z"/></svg>`,
    map: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 4 6-2 6 2v16l-6 2-6-2-6 2V6l6-2Zm0 2.1L5 7.4v11.9l4-1.3V6.1Zm2 0v11.8l4 1.3V7.4l-4-1.3Zm6 1.3v11.8l2-.7V6.7l-2 .7Z"/></svg>`,
    distance: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 10a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z"/></svg>`,
  };

  function normalize(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[char]);
  }

  function hasCoords(item) {
    if ([item.latitud, item.longitud].some((value) =>
      value == null || (typeof value === "string" && value.trim() === "")
    )) return false;
    const lat = Number(item.latitud);
    const lon = Number(item.longitud);
    return Number.isFinite(lat) && Number.isFinite(lon) &&
      lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }

  function destinationText(item) {
    return [item.direccion, item.municipio, item.departamento, "Guatemala"]
      .filter(Boolean)
      .join(", ");
  }

  // IMPORTANT: Waze uses only a destination. It will use the user's current
  // location as origin inside Waze; this site never defines an origin.
  function buildWazeUrl(item) {
    if (hasCoords(item)) {
      return `https://waze.com/ul?ll=${item.latitud},${item.longitud}&navigate=yes`;
    }
    const address = destinationText(item);
    if (address) {
      return `https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`;
    }
    return null;
  }

  function buildLocationUrl(item) {
    if (hasCoords(item)) {
      const lat = Number(item.latitud);
      const lon = Number(item.longitud);
      return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lon)}#map=18/${encodeURIComponent(lat)}/${encodeURIComponent(lon)}`;
    }
    const address = destinationText(item);
    if (address) {
      return `https://www.openstreetmap.org/search?query=${encodeURIComponent(address)}`;
    }
    return null;
  }

  function searchableText(item) {
    const extras = item.extras ? Object.values(item.extras).join(" ") : "";
    return normalize([
      item.nombre, item.marca, item.direccion, item.municipio,
      item.departamento, item.grupo, item.codigo, item.observaciones, extras
    ].filter(Boolean).join(" "));
  }

  function collate(a, b) {
    return String(a ?? "").localeCompare(String(b ?? ""), "es", { sensitivity: "base" });
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = (v) => v * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function computeDistances() {
    state.distances.clear();
    if (!state.userLocation) return;
    for (const item of state.all) {
      if (!hasCoords(item)) continue;
      const km = haversineKm(
        state.userLocation.lat, state.userLocation.lon,
        Number(item.latitud), Number(item.longitud)
      );
      state.distances.set(item.id, km);
    }
  }

  function uniqueValues(field) {
    return [...new Set(state.all.map((x) => x[field]).filter(Boolean))]
      .sort((a, b) => collate(a, b));
  }

  function buildFilters() {
    const fields = ["marca", "departamento", "municipio", "grupo"];
    els.filters.innerHTML = "";

    for (const field of fields) {
      const values = uniqueValues(field);
      if (!values.length) continue;

      const label = document.createElement("label");
      label.className = "filter-field";
      const caption = document.createElement("span");
      caption.textContent = FIELD_LABELS[field];

      const select = document.createElement("select");
      select.dataset.field = field;
      select.setAttribute("aria-label", `Filtrar por ${FIELD_LABELS[field]}`);
      select.innerHTML = `<option value="">Todas</option>` +
        values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");

      select.addEventListener("change", () => {
        state.filters[field] = select.value;
        applyFilters();
      });

      label.append(caption, select);
      els.filters.appendChild(label);
    }
  }

  function applyFilters() {
    const q = normalize(state.search);
    const active = Object.entries(state.filters).filter(([, value]) => value);

    state.filtered = state.all.filter((item) => {
      if (q && !searchableText(item).includes(q)) return false;
      return active.every(([field, value]) => String(item[field] ?? "") === value);
    });

    sortCurrent();
    render();
  }

  function sortCurrent() {
    state.filtered.sort((a, b) => {
      switch (state.sort) {
        case "brand":
          return collate(a.marca, b.marca) || collate(a.nombre, b.nombre);
        case "municipality":
          return collate(a.municipio, b.municipio) || collate(a.nombre, b.nombre);
        case "department":
          return collate(a.departamento, b.departamento) || collate(a.municipio, b.municipio) || collate(a.nombre, b.nombre);
        case "distance": {
          const da = state.distances.get(a.id);
          const db = state.distances.get(b.id);
          if (da == null && db == null) return collate(a.nombre, b.nombre);
          if (da == null) return 1;
          if (db == null) return -1;
          return da - db;
        }
        case "name":
        default:
          return collate(a.nombre, b.nombre);
      }
    });
  }

  function metaChips(item) {
    const chips = [];
    if (item.codigo) chips.push(`<span class="meta-chip">Código ${escapeHtml(item.codigo)}</span>`);
    if (item.grupo) chips.push(`<span class="meta-chip">${escapeHtml(item.grupo)}</span>`);
    const distance = state.distances.get(item.id);
    if (Number.isFinite(distance)) {
      chips.push(`<span class="meta-chip distance-chip" title="Distancia aproximada en línea recta">${ICON.distance}${distance.toFixed(1)} km en línea recta</span>`);
    } else if (!hasCoords(item)) {
      chips.push(`<span class="meta-chip">Ubicación precisa pendiente</span>`);
    }
    return chips.join("");
  }

  function extrasHtml(item) {
    if (!item.extras || !Object.keys(item.extras).length) return "";
    const rows = Object.entries(item.extras)
      .filter(([, value]) => value !== null && value !== "")
      .map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`)
      .join("");
    if (!rows) return "";
    return `<details class="extra-details"><summary>Más información</summary><dl>${rows}</dl></details>`;
  }

  function cardHtml(item) {
    const waze = buildWazeUrl(item);
    const location = buildLocationUrl(item);
    const brandKey = normalize(item.marca).replace(/\s+/g, "-");
    const secondary = [item.municipio, item.departamento].filter(Boolean).join(", ");
    const title = item.nombre || item.marca || "Gasolinera";

    const info = item.direccion || secondary ? `
      <div class="info-row">
        <span class="icon">${ICON.pin}</span>
        <div>
          ${item.direccion ? `<div>${escapeHtml(item.direccion)}</div>` : ""}
          ${secondary ? `<div class="location-secondary">${escapeHtml(secondary)}</div>` : ""}
        </div>
      </div>` : "";

    const actions = (location || waze) ? `
      <div class="card-actions">
        ${location ? `<a class="action-btn action-btn--secondary" href="${location}" target="_blank" rel="noopener">${ICON.map}Ver ubicación</a>` : ""}
        ${waze ? `<a class="action-btn action-btn--waze" href="${waze}" target="_blank" rel="noopener">${ICON.waze}IR CON WAZE</a>` : ""}
      </div>` : `<div class="location-unavailable">Ubicación no disponible.</div>`;

    return `
      <article class="station-card" data-brand="${escapeHtml(brandKey)}">
        <div class="station-card__top">
          ${item.marca ? `<span class="brand-chip">${escapeHtml(item.marca)}</span>` : ""}
          <h2>${escapeHtml(title)}</h2>
        </div>
        <div class="station-card__body">
          ${info}
          ${metaChips(item) ? `<div class="meta-row">${metaChips(item)}</div>` : ""}
          ${item.observaciones ? `<p class="notes">${escapeHtml(item.observaciones)}</p>` : ""}
          ${extrasHtml(item)}
          ${actions}
        </div>
      </article>`;
  }

  function renderList() {
    els.cards.innerHTML = state.filtered.map(cardHtml).join("");
    els.empty.hidden = state.filtered.length !== 0;
  }

  function ensureMap() {
    if (state.map || typeof L === "undefined") return;
    state.map = L.map("map", { zoomControl: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(state.map);
    state.markers = L.layerGroup().addTo(state.map);
  }

  function popupHtml(item) {
    const waze = buildWazeUrl(item);
    const addr = destinationText(item);
    return `
      <div>
        <p class="popup-title">${escapeHtml(item.nombre || item.marca || "Gasolinera")}</p>
        ${addr ? `<p class="popup-address">${escapeHtml(addr)}</p>` : ""}
        ${waze ? `<a class="popup-waze" href="${waze}" target="_blank" rel="noopener">IR CON WAZE</a>` : ""}
      </div>`;
  }

  function renderMap() {
    if (state.view !== "map") return;
    const points = state.filtered.filter(hasCoords);

    if (!points.length) {
      els.mapEmpty.hidden = false;
      document.getElementById("map").style.display = "none";
      return;
    }

    els.mapEmpty.hidden = true;
    document.getElementById("map").style.display = "block";
    ensureMap();
    if (!state.map) return;

    state.markers.clearLayers();
    const bounds = [];

    for (const item of points) {
      const lat = Number(item.latitud);
      const lon = Number(item.longitud);
      const marker = L.marker([lat, lon]).bindPopup(popupHtml(item));
      marker.addTo(state.markers);
      bounds.push([lat, lon]);
    }

    if (bounds.length === 1) state.map.setView(bounds[0], 15);
    else state.map.fitBounds(bounds, { padding: [30, 30] });

    setTimeout(() => state.map.invalidateSize(), 0);
  }

  function render() {
    els.count.textContent = state.filtered.length.toLocaleString("es-GT");
    els.label.textContent = state.filtered.length === 1 ? "gasolinera" : "gasolineras";
    const located = state.filtered.filter(hasCoords).length;
    els.locationSummary.textContent = `${located} de ${state.filtered.length} estaciones de esta selección tienen coordenadas. ` +
      (state.userLocation
        ? "Las distancias son aproximadas, en línea recta. Las estaciones sin coordenadas aparecen al final al ordenar por cercanía."
        : "Pulsa Mostrar gasolineras cercanas y permite el acceso a tu ubicación para ordenarlas por distancia.");
    if (state.view === "list") renderList();
    else renderMap();
  }

  function showStatus(message, duration = 3200) {
    els.status.textContent = message;
    els.status.classList.add("is-visible");
    clearTimeout(showStatus._timer);
    showStatus._timer = setTimeout(() => els.status.classList.remove("is-visible"), duration);
  }

  function setView(view) {
    state.view = view;
    const isList = view === "list";
    els.listView.hidden = !isList;
    els.mapView.hidden = isList;
    els.listBtn.classList.toggle("is-active", isList);
    els.mapBtn.classList.toggle("is-active", !isList);
    els.listBtn.setAttribute("aria-pressed", String(isList));
    els.mapBtn.setAttribute("aria-pressed", String(!isList));
    render();
  }

  function requestNearby() {
    if (!state.hasCoordinateData) {
      showStatus("Todavía no hay estaciones con coordenadas para calcular distancias.", 6000);
      return;
    }
    if (!window.isSecureContext) {
      showStatus("Abre esta página con HTTPS para permitir el acceso a tu ubicación.", 6000);
      return;
    }
    if (!navigator.geolocation) {
      showStatus("Este navegador no permite obtener la ubicación.");
      return;
    }

    els.nearby.disabled = true;
    els.nearby.textContent = "Obteniendo ubicación…";

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (!Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) {
          showStatus("El dispositivo devolvió una ubicación inválida. Vuelve a intentarlo.", 6000);
          els.nearby.disabled = false;
          els.nearby.innerHTML = `${ICON.distance}Mostrar gasolineras cercanas`;
          return;
        }
        state.userLocation = { lat: coords.latitude, lon: coords.longitude };
        computeDistances();
        els.distanceOption.disabled = false;
        state.sort = "distance";
        els.sort.value = "distance";
        sortCurrent();
        render();
        const located = state.filtered.filter(hasCoords).length;
        showStatus(located
          ? "Estaciones ordenadas por distancia en línea recta. Waze calculará la ruta por calles."
          : "Esta selección no tiene coordenadas. Pulsa Limpiar filtros para ver las estaciones disponibles.", 6000);
        els.nearby.disabled = false;
        els.nearby.innerHTML = `${ICON.distance}Actualizar gasolineras cercanas`;
      },
      (error) => {
        const msg = error.code === 1
          ? "Ubicación bloqueada. Permítela en los permisos de este sitio y vuelve a pulsar el botón."
          : error.code === 3
            ? "Se agotó el tiempo para obtener tu ubicación. Vuelve a intentarlo."
            : "No fue posible obtener tu ubicación. Activa la ubicación de tu dispositivo y vuelve a intentarlo.";
        showStatus(msg, 8000);
        els.nearby.disabled = false;
        els.nearby.innerHTML = `${ICON.distance}Mostrar gasolineras cercanas`;
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }

  function resetFilters() {
    state.search = "";
    state.filters = {};
    state.sort = "name";
    els.search.value = "";
    els.sort.value = "name";
    els.filters.querySelectorAll("select").forEach((select) => { select.value = ""; });
    applyFilters();
  }

  function bindEvents() {
    els.search.addEventListener("input", () => {
      state.search = els.search.value;
      applyFilters();
    });
    els.sort.addEventListener("change", () => {
      state.sort = els.sort.value;
      sortCurrent();
      render();
    });
    els.reset.addEventListener("click", resetFilters);
    els.nearby.addEventListener("click", requestNearby);
    els.listBtn.addEventListener("click", () => setView("list"));
    els.mapBtn.addEventListener("click", () => setView("map"));
  }

  async function loadData() {
    try {
      const response = await fetch("gasolineras.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error("El JSON no contiene una lista.");

      state.all = data.filter((item) => item && typeof item === "object");
      state.filtered = [...state.all];
      state.hasCoordinateData = state.all.some(hasCoords);

      if (!state.hasCoordinateData) {
        els.nearby.title = "Todavía no hay estaciones con coordenadas.";
        els.distanceOption.disabled = true;
      }

      buildFilters();
      bindEvents();
      applyFilters();
    } catch (error) {
      console.error(error);
      els.cards.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <div class="empty-state__icon">⚠️</div>
          <h2>No se pudo cargar gasolineras.json</h2>
          <p>Si abriste index.html directamente desde una carpeta, inicia un servidor local como se explica en README.md.</p>
        </div>`;
      showStatus("No se pudo cargar la información de gasolineras.", 5000);
    }
  }

  loadData();
})();
