/* metar.js — Fetch et parsing METAR depuis aviationweather.gov (NOAA/FAA, sans clé, CORS ouvert) */

const MetarService = (() => {
  const API_BASE = 'https://aviationweather.gov/api/data/metar';
  const cache = {};
  const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

  async function fetch(icaoId) {
    const now = Date.now();
    if (cache[icaoId] && (now - cache[icaoId].ts) < CACHE_TTL_MS) {
      return cache[icaoId].data;
    }

    const url = `${API_BASE}?ids=${icaoId}&format=json&hours=2`;
    try {
      const resp = await window.fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      const data = Array.isArray(json) && json.length > 0 ? json[0] : null;
      cache[icaoId] = { ts: now, data };
      return data;
    } catch (err) {
      console.warn(`METAR fetch échoué pour ${icaoId}:`, err.message);
      return null;
    }
  }

  function parseFlightCategory(raw) {
    if (!raw) return 'UNKN';

    // Visibilité en mètres (format européen 4 chiffres) ou en SM
    let visMiles = null;
    const visMetersMatch = raw.match(/\s(\d{4})\s/);
    const visSmMatch = raw.match(/\s(\d+(?:\/\d+)?)SM\s/);
    if (visSmMatch) {
      const parts = visSmMatch[1].split('/');
      visMiles = parts.length === 2 ? parseInt(parts[0]) / parseInt(parts[1]) : parseFloat(parts[0]);
    } else if (visMetersMatch) {
      const meters = parseInt(visMetersMatch[1]);
      visMiles = meters === 9999 ? 10 : meters / 1852;
    }

    // Plafond : couche BKN ou OVC la plus basse
    let ceilingFt = null;
    const cloudRegex = /(BKN|OVC)(\d{3})/g;
    let match;
    while ((match = cloudRegex.exec(raw)) !== null) {
      const alt = parseInt(match[2]) * 100;
      if (ceilingFt === null || alt < ceilingFt) ceilingFt = alt;
    }

    if (visMiles === null && ceilingFt === null) return 'UNKN';

    const vis = visMiles ?? 10;
    const ceil = ceilingFt ?? 99999;

    if (ceil < 500 || vis < 1) return 'LIFR';
    if (ceil < 1000 || vis < 3) return 'IFR';
    if (ceil < 3000 || vis < 5) return 'MVFR';
    return 'VFR';
  }

  function formatWind(raw) {
    const m = raw.match(/(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT/);
    if (!m) return null;
    const dir = m[1] === 'VRB' ? 'variable' : `${m[1]}°`;
    const spd = parseInt(m[2]);
    const gust = m[3] ? ` rafales ${m[3]} kt` : '';
    return `${dir} ${spd} kt${gust}`;
  }

  function formatVisibility(raw) {
    const visSmMatch = raw.match(/\s(\d+(?:\/\d+)?)SM\s/);
    if (visSmMatch) return `${visSmMatch[1]} SM`;
    const visMetersMatch = raw.match(/\s(\d{4})\s/);
    if (visMetersMatch) {
      const m = parseInt(visMetersMatch[1]);
      return m === 9999 ? '≥ 10 km' : `${m} m`;
    }
    return null;
  }

  function formatClouds(raw) {
    const cloudRegex = /(FEW|SCT|BKN|OVC)(\d{3})/g;
    const labels = { FEW: 'Peu nuageux', SCT: 'Fragmenté', BKN: 'Nuageux', OVC: 'Couvert' };
    const layers = [];
    let match;
    while ((match = cloudRegex.exec(raw)) !== null) {
      layers.push(`${labels[match[1]] || match[1]} ${parseInt(match[2]) * 100} ft`);
    }
    if (layers.length === 0 && /SKC|CLR|CAVOK/.test(raw)) return 'Ciel dégagé';
    return layers.length > 0 ? layers.join(' / ') : null;
  }

  function formatTemp(raw) {
    const m = raw.match(/(M?\d{2})\/(M?\d{2})/);
    if (!m) return null;
    const parse = s => (s.startsWith('M') ? -1 : 1) * parseInt(s.replace('M', ''));
    return `${parse(m[1])}°C / rosée ${parse(m[2])}°C`;
  }

  function formatQnh(raw) {
    const qMatch = raw.match(/Q(\d{4})/);
    if (qMatch) return `${qMatch[1]} hPa`;
    const aMatch = raw.match(/A(\d{4})/);
    if (aMatch) return `${(parseInt(aMatch[1]) / 100).toFixed(2)} inHg`;
    return null;
  }

  function formatTime(obsTime) {
    if (!obsTime) return null;
    const d = new Date(obsTime * 1000);
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
  }

  function renderHtml(metar) {
    if (!metar || !metar.rawOb) {
      return `<div class="metar-error">METAR indisponible pour ce terrain.</div>`;
    }

    const raw = metar.rawOb;
    const cat = parseFlightCategory(raw);
    const wind = formatWind(raw);
    const vis = formatVisibility(raw);
    const clouds = formatClouds(raw);
    const temp = formatTemp(raw);
    const qnh = formatQnh(raw);
    const time = formatTime(metar.obsTime);

    const catLabels = { VFR: 'VFR', MVFR: 'MVFR', IFR: 'IFR', LIFR: 'LIFR', UNKN: '?' };

    const rows = [
      wind   && ['Vent', wind],
      vis    && ['Visibilité', vis],
      clouds && ['Nébulosité', clouds],
      temp   && ['Temp / Rosée', temp],
      qnh    && ['QNH', qnh],
      time   && ['Observation', time],
    ].filter(Boolean);

    return `
      <div class="metar-block">
        <div class="metar-header">
          <span class="metar-label">METAR</span>
          <span class="flight-cat flight-cat--${cat.toLowerCase()}">${catLabels[cat]}</span>
        </div>
        <pre class="metar-raw">${raw}</pre>
        <table class="metar-table">
          <tbody>
            ${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  return { fetch, parseFlightCategory, renderHtml };
})();
