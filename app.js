/* app.js — Logique principale : carte Leaflet, chargement JSON, filtres, sidebar */

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
      <path d="M14 0C6.268 0 0 6.268 0 14c0 9.333 14 22 14 22S28 23.333 28 14C28 6.268 21.732 0 14 0z" fill="${color}"/>
      <circle cx="14" cy="14" r="6" fill="white"/>
      <text x="14" y="18" font-size="9" font-family="sans-serif" text-anchor="middle" fill="${color}">✈</text>
    </svg>`;
    return L.divIcon({
      className: '',
      html: svg,
      iconSize: [28, 36],
      iconAnchor: [14, 36],
      popupAnchor: [0, -36],
    });
  }

  const markersByCam = {};

  cameras.forEach(cam => {
    const marker = L.marker([cam.lat, cam.lng], { icon: makeIcon(cam.actif) });
    marker.bindTooltip(`<strong>${cam.oaci}</strong><br>${cam.nom}`, { direction: 'top', offset: [0, -32] });
    marker.on('click', () => openSidebar(cam));
    marker.addTo(map);
    markersByCam[cam.id] = marker;
  });

  // ── 4. Sidebar ─────────────────────────────────────────────────────────────

  const sidebar = document.getElementById('sidebar');
  const sidebarContent = document.getElementById('sidebar-content');
  const sidebarClose = document.getElementById('sidebar-close');

  sidebarClose.addEventListener('click', closeSidebar);

  function closeSidebar() {
    sidebar.classList.add('sidebar-hidden');
    sidebar.classList.remove('sidebar-visible');
  }

  async function openSidebar(cam) {
    sidebar.classList.remove('sidebar-hidden');
    sidebar.classList.add('sidebar-visible');

    sidebarContent.innerHTML = renderSidebarSkeleton(cam);

    // Charger le METAR en parallèle
    const metar = await MetarService.fetch(cam.oaci);
    const metatHtml = MetarService.renderHtml(metar);

    const metatContainer = document.getElementById('sidebar-metar');
    if (metatContainer) metatContainer.innerHTML = metatHtml;

    // Scroll to top sur mobile
    sidebar.scrollTop = 0;
  }

  function renderSidebarSkeleton(cam) {
    const typeBadge = cam.type === 'aéroport' ? 'badge-airport' : 'badge-aerodrome';
    const webcamSection = renderWebcamSection(cam);

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
        ${webcamSection}
      </div>

      <div class="sidebar-section">
        <h3 class="section-title">METAR / Météo</h3>
        <div id="sidebar-metar" class="metar-loading">
          <div class="skeleton skeleton-line"></div>
          <div class="skeleton skeleton-line short"></div>
          <div class="skeleton skeleton-line"></div>
        </div>
      </div>`;
  }

  function renderWebcamSection(cam) {
    if (!cam.actif || !cam.url_webcam) {
      const directLink = cam.url_direct
        ? `<a href="${cam.url_direct}" target="_blank" rel="noopener" class="btn btn-secondary">
             Chercher une webcam sur Windy ↗
           </a>`
        : '';
      return `
        <div class="webcam-unavailable">
          <div class="webcam-icon">📷</div>
          <p>Webcam non configurée pour ce terrain.</p>
          <p class="webcam-hint">Ajoutez l'ID Windy dans <code>data/cameras.json</code> pour activer l'aperçu.</p>
          ${directLink}
        </div>`;
    }

    if (cam.embed_type === 'iframe') {
      return `
        <div class="webcam-wrapper">
          <iframe
            src="${cam.url_webcam}"
            allowfullscreen
            loading="lazy"
            title="Webcam ${cam.nom}"
            class="webcam-iframe"
            sandbox="allow-scripts allow-same-origin allow-popups">
          </iframe>
          <div class="webcam-fallback" id="webcam-fallback-${cam.id}">
            <p>La webcam ne s'affiche pas ?</p>
            <a href="${cam.url_direct || cam.url_webcam}" target="_blank" rel="noopener" class="btn btn-secondary">
              Ouvrir dans un nouvel onglet ↗
            </a>
          </div>
        </div>`;
    }

    if (cam.embed_type === 'img') {
      return `
        <div class="webcam-wrapper">
          <img
            src="${cam.url_webcam}"
            alt="Webcam ${cam.nom}"
            class="webcam-img"
            onerror="this.style.display='none'; document.getElementById('img-fallback-${cam.id}').style.display='block';"
          />
          <div id="img-fallback-${cam.id}" class="webcam-unavailable" style="display:none">
            <p>Image indisponible temporairement.</p>
          </div>
        </div>`;
    }

    return `<div class="webcam-unavailable"><p>Type d'embed non reconnu.</p></div>`;
  }

  // ── 5. Liste des terrains ──────────────────────────────────────────────────

  const terrainList = document.getElementById('terrain-list');
  const filterRegion = document.getElementById('filter-region');
  const filterType = document.getElementById('filter-type');
  const filterWebcam = document.getElementById('filter-webcam');

  // Peupler le filtre régions
  const regions = [...new Set(cameras.map(c => c.region))].sort();
  regions.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r;
    opt.textContent = r;
    filterRegion.appendChild(opt);
  });

  function renderList() {
    const selRegion = filterRegion.value;
    const selType = filterType.value;
    const onlyWebcam = filterWebcam.checked;

    const filtered = cameras.filter(cam => {
      if (selRegion && cam.region !== selRegion) return false;
      if (selType && cam.type !== selType) return false;
      if (onlyWebcam && !cam.actif) return false;
      return true;
    });

    // Mettre à jour les marqueurs (afficher/masquer)
    cameras.forEach(cam => {
      const marker = markersByCam[cam.id];
      if (!marker) return;
      const visible = filtered.some(f => f.id === cam.id);
      if (visible) {
        marker.addTo(map);
      } else {
        marker.remove();
      }
    });

    if (filtered.length === 0) {
      terrainList.innerHTML = '<p class="no-results">Aucun terrain ne correspond aux filtres sélectionnés.</p>';
      return;
    }

    terrainList.innerHTML = filtered.map(cam => renderCard(cam)).join('');

    // Attacher les écouteurs sur les cartes
    terrainList.querySelectorAll('.terrain-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        const cam = cameras.find(c => c.id === id);
        if (!cam) return;
        map.setView([cam.lat, cam.lng], 10, { animate: true });
        openSidebar(cam);
      });
    });

    // Charger METAR pour chaque carte visible
    filtered.forEach(cam => loadMetarCard(cam));
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
    if (!metar || !metar.rawOb) {
      el.innerHTML = '<span class="metar-dot metar-dot--unkn"></span> METAR indisponible';
      return;
    }
    const cat = MetarService.parseFlightCategory(metar.rawOb);
    const dotClass = `metar-dot--${cat.toLowerCase()}`;
    el.innerHTML = `<span class="metar-dot ${dotClass}"></span> <span class="flight-cat flight-cat--${cat.toLowerCase()}">${cat}</span> &nbsp; <span class="metar-short">${metar.rawOb.substring(metar.rawOb.indexOf('Z') + 1, metar.rawOb.indexOf('Z') + 25).trim()}</span>`;
  }

  // Écouteurs filtres
  filterRegion.addEventListener('change', renderList);
  filterType.addEventListener('change', renderList);
  filterWebcam.addEventListener('change', renderList);

  // Keyboard navigation sur les cartes
  terrainList.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      const card = e.target.closest('.terrain-card');
      if (card) card.click();
    }
  });

  // Rendu initial
  renderList();

})();
