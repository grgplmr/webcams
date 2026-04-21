/* app.js — AéroCams France
   Clé Windy limitée au domaine aerocams.aeroclubmarcillacestuaire.fr
   Aucun serveur requis : tout se passe dans le navigateur. */

const WINDY_KEY = 'uXolg9Meh5c0DmoYPqkYqGoUslyieqWc';
const WINDY_API = 'https://api.windy.com/webcams/api/v3/webcams';
const WINDY_EMBED = id => `https://webcams.windy.com/webcams/public/embed/player/${id}/day`;
const WINDY_PAGE  = id => `https://www.windy.com/webcams/${id}`;

(async () => {
  // ── 1. Chargement des données ──────────────────────────────────────────────

  let cameras = [];
  try {
    const resp = await fetch('data/cameras.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    cameras = json.cameras || [];
  } catch (err) {
    console.error('Impossible de charger cameras.json :', err);
    document.getElementById('terrain-list').innerHTML =
      '<p class="load-error">Erreur de chargement des données terrains.</p>';
    return;
  }

  // ── 2. Carte Leaflet ───────────────────────────────────────────────────────

  const map = L.map('map', {
    center: [46.5, 2.5],
    zoom: 6,
    zoomControl: true,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map);

  // ── 3. Marqueurs Leaflet ───────────────────────────────────────────────────

  function makeIcon(hasWebcam) {
    const color = hasWebcam ? '#10b981' : '#3b82f6';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
      <path d="M14 0C6.268 0 0 6.268 0 14c0 9.333 14 22 14 22S28 23.333 28 14C28 6.268 21.732 0 14 0z" fill="${color}" stroke="white" stroke-width="1.5"/>
      <text x="14" y="19" font-size="12" font-family="sans-serif" text-anchor="middle" fill="white">✈</text>
    </svg>`;
    return L.divIcon({
      className: '',
      html: svg,
      iconSize: [28, 36],
      iconAnchor: [14, 36],
      popupAnchor: [0, -38],
    });
  }

  const markersByCam = {};

  cameras.forEach(cam => {
    const marker = L.marker([cam.lat, cam.lng], { icon: makeIcon(cam.actif) });
    marker.bindTooltip(
      `<strong>${cam.oaci}</strong><br>${cam.nom}`,
      { direction: 'top', offset: [0, -34], className: 'leaflet-tooltip-cam' }
    );
    marker.on('click', () => openSidebar(cam));
    marker.addTo(map);
    markersByCam[cam.id] = marker;
  });

  // ── 4. API Windy dynamique ─────────────────────────────────────────────────

  // Cache : évite d'interroger Windy plusieurs fois pour le même terrain
  const windyCache = {};

  async function fetchWindyNearby(lat, lng, radiusKm = 30) {
    const key = `${lat},${lng}`;
    if (windyCache[key]) return windyCache[key];

    try {
      const url = `${WINDY_API}?nearby=${lat},${lng},${radiusKm}&limit=5&fields=webcamId,title,status,location,player&key=${WINDY_KEY}`;
      const resp = await fetch(url, {
        headers: { 'x-windy-api-key': WINDY_KEY }
      });
      if (!resp.ok) throw new Error(`Windy API ${resp.status}`);
      const data = await resp.json();
      // Garder uniquement les webcams actives
      const actives = (data.webcams || []).filter(w => w.status === 'active');
      windyCache[key] = actives;
      return actives;
    } catch (err) {
      console.warn('Windy API indisponible :', err.message);
      windyCache[key] = [];
      return [];
    }
  }

  // ── 5. Sidebar ─────────────────────────────────────────────────────────────

  const sidebar        = document.getElementById('sidebar');
  const sidebarContent = document.getElementById('sidebar-content');
  const sidebarClose   = document.getElementById('sidebar-close');

  sidebarClose.addEventListener('click', closeSidebar);

  // Fermer la sidebar avec Echap
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeSidebar();
  });

  function closeSidebar() {
    sidebar.classList.add('sidebar-hidden');
    sidebar.classList.remove('sidebar-visible');
  }

  async function openSidebar(cam) {
    sidebar.classList.remove('sidebar-hidden');
    sidebar.classList.add('sidebar-visible');

    // Afficher le skeleton pendant le chargement
    sidebarContent.innerHTML = renderSkeletonHeader(cam);
    sidebar.scrollTop = 0;

    // Lancer METAR et recherche webcam en parallèle
    const [metar, windyCams] = await Promise.all([
      MetarService.fetch(cam.oaci),
      cam.actif ? Promise.resolve(null) : fetchWindyNearby(cam.lat, cam.lng),
    ]);

    // Construire le contenu complet
    sidebarContent.innerHTML = renderSidebarFull(cam, metar, windyCams);
  }

  function renderSkeletonHeader(cam) {
    return `
      <div class="sidebar-terrain-header">
        <div class="sidebar-oaci">${cam.oaci}</div>
        <div class="sidebar-nom">${cam.nom}</div>
        <div class="sidebar-meta">
          <span class="badge ${cam.type === 'aéroport' ? 'badge-airport' : 'badge-aerodrome'}">${cam.type}</span>
          <span class="sidebar-region">${cam.region}</span>
        </div>
      </div>
      <div class="sidebar-loading">
        <div class="skeleton skeleton-block"></div>
        <div class="skeleton skeleton-line" style="margin-top:.75rem"></div>
        <div class="skeleton skeleton-line short"></div>
        <div class="skeleton skeleton-line"></div>
      </div>`;
  }

  function renderSidebarFull(cam, metar, windyCams) {
    const typeBadge = cam.type === 'aéroport' ? 'badge-airport' : 'badge-aerodrome';
    const webcamHtml = renderWebcamSection(cam, windyCams);
    const metatHtml  = MetarService.renderHtml(metar);

    return `
      <div class="sidebar-terrain-header">
        <div class="sidebar-oaci">${cam.oaci}</div>
        <div class="sidebar-nom">${cam.nom}</div>
        <div class="sidebar-meta">
          <span class="badge ${typeBadge}">${cam.type}</span>
          <span class="sidebar-region">${cam.region}</span>
        </div>
      </div>

      <div class="sidebar-section">
        <h3 class="section-title">Webcam</h3>
        ${webcamHtml}
      </div>

      <div class="sidebar-section">
        <h3 class="section-title">METAR / Météo</h3>
        ${metatHtml}
      </div>`;
  }

  function renderWebcamSection(cam, windyCams) {
    // Cas 1 : URL codée en dur dans cameras.json
    if (cam.actif && cam.url_webcam) {
      return buildIframeBlock(cam.url_webcam, cam.url_direct, cam.nom, cam.windy_webcam_id);
    }

    // Cas 2 : résultat dynamique Windy API
    if (windyCams && windyCams.length > 0) {
      const best = windyCams[0];
      const embedUrl = best.player?.day?.embed || WINDY_EMBED(best.webcamId);
      const directUrl = WINDY_PAGE(best.webcamId);
      const distLabel = best.location?.city ? ` — ${best.location.city}` : '';
      return `
        <div class="webcam-dynamic-badge">📡 Webcam trouvée automatiquement${distLabel}</div>
        ${buildIframeBlock(embedUrl, directUrl, best.title || cam.nom, best.webcamId)}`;
    }

    // Cas 3 : aucune webcam disponible
    const directLink = cam.url_direct
      ? `<a href="${cam.url_direct}" target="_blank" rel="noopener" class="btn btn-secondary">
           Chercher sur Windy ↗
         </a>`
      : '';
    const apiNote = !cam.actif
      ? '<p class="webcam-hint">L\'API Windy n\'a pas trouvé de webcam active dans un rayon de 30 km.</p>'
      : '<p class="webcam-hint">Ajoutez l\'ID Windy dans <code>data/cameras.json</code> pour activer l\'aperçu.</p>';

    return `
      <div class="webcam-unavailable">
        <div class="webcam-icon">📷</div>
        <p>Aucune webcam disponible pour ce terrain.</p>
        ${apiNote}
        ${directLink}
      </div>`;
  }

  function buildIframeBlock(embedUrl, directUrl, nomTerrain, webcamId) {
    const safeId = (webcamId || '').toString().replace(/\W/g, '');
    return `
      <div class="webcam-wrapper">
        <iframe
          src="${embedUrl}"
          allowfullscreen
          loading="lazy"
          title="Webcam ${nomTerrain}"
          class="webcam-iframe"
          sandbox="allow-scripts allow-same-origin allow-popups">
        </iframe>
      </div>
      ${directUrl ? `<div class="webcam-footer"><a href="${directUrl}" target="_blank" rel="noopener" class="webcam-external-link">Ouvrir dans un nouvel onglet ↗</a></div>` : ''}`;
  }

  // ── 6. Liste des terrains ──────────────────────────────────────────────────

  const terrainList  = document.getElementById('terrain-list');
  const filterRegion = document.getElementById('filter-region');
  const filterType   = document.getElementById('filter-type');
  const filterWebcam = document.getElementById('filter-webcam');

  // Peupler le filtre régions
  const regions = [...new Set(cameras.map(c => c.region))].sort();
  regions.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r;
    opt.textContent = r;
    filterRegion.appendChild(opt);
  });

  function getFiltered() {
    const selRegion  = filterRegion.value;
    const selType    = filterType.value;
    const onlyWebcam = filterWebcam.checked;
    return cameras.filter(cam => {
      if (selRegion  && cam.region !== selRegion) return false;
      if (selType    && cam.type   !== selType)   return false;
      if (onlyWebcam && !cam.actif)               return false;
      return true;
    });
  }

  function renderList() {
    const filtered = getFiltered();

    // Synchroniser visibilité des marqueurs
    cameras.forEach(cam => {
      const marker  = markersByCam[cam.id];
      if (!marker) return;
      filtered.some(f => f.id === cam.id) ? marker.addTo(map) : marker.remove();
    });

    if (filtered.length === 0) {
      terrainList.innerHTML = '<p class="no-results">Aucun terrain ne correspond aux filtres sélectionnés.</p>';
      return;
    }

    terrainList.innerHTML = filtered.map(renderCard).join('');

    terrainList.querySelectorAll('.terrain-card').forEach(card => {
      const handler = () => {
        const cam = cameras.find(c => c.id === card.dataset.id);
        if (!cam) return;
        map.setView([cam.lat, cam.lng], 10, { animate: true });
        openSidebar(cam);
      };
      card.addEventListener('click', handler);
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
      });
    });

    // Charger METAR pour chaque carte
    filtered.forEach(loadMetarCard);
  }

  function renderCard(cam) {
    const webcamBadge = cam.actif
      ? '<span class="badge badge-webcam-on">Webcam ✓</span>'
      : '<span class="badge badge-webcam-off">METAR</span>';

    return `
      <div class="terrain-card" data-id="${cam.id}" role="button" tabindex="0" aria-label="Voir ${cam.nom}">
        <div class="terrain-card-header">
          <span class="oaci-badge">${cam.oaci}</span>
          ${webcamBadge}
        </div>
        <h3 class="terrain-card-nom">${cam.nom}</h3>
        <div class="terrain-card-meta">
          <span>${cam.region}</span>
          <span>${cam.type}</span>
        </div>
        <div class="terrain-card-metar" id="card-metar-${cam.id}">
          <span class="metar-dot metar-dot--loading"></span> Chargement METAR…
        </div>
      </div>`;
  }

  async function loadMetarCard(cam) {
    const el = document.getElementById(`card-metar-${cam.id}`);
    if (!el) return;
    const metar = await MetarService.fetch(cam.oaci);
    if (!metar?.rawOb) {
      el.innerHTML = '<span class="metar-dot metar-dot--unkn"></span> METAR indisponible';
      return;
    }
    const cat = MetarService.parseFlightCategory(metar.rawOb);
    // Extrait la partie utile du METAR (après heure Zulu)
    const shortIdx = metar.rawOb.indexOf('Z');
    const short = shortIdx !== -1
      ? metar.rawOb.substring(shortIdx + 1).trim().substring(0, 30)
      : metar.rawOb.substring(0, 30);
    el.innerHTML = `
      <span class="metar-dot metar-dot--${cat.toLowerCase()}"></span>
      <span class="flight-cat flight-cat--${cat.toLowerCase()}">${cat}</span>
      <span class="metar-short">${short}</span>`;
  }

  filterRegion.addEventListener('change', renderList);
  filterType.addEventListener('change', renderList);
  filterWebcam.addEventListener('change', renderList);

  renderList();

})();
