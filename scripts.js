const map = L.map('map').setView([51.163, 10.447], 6);
L.tileLayer('https://{s}.tile.openstreetmap.de/{z}/{x}/{y}.png', {
  maxZoom: 18,
  attribution: '&copy; OpenStreetMap-Mitwirkende'
}).addTo(map);
let plzLayer = null;
let featureIndex = []; // { plz, feature, layer }
let plzPropKey = null;

const selectedPlz = new Set();
const regions = new Map();       // name → Set(plz)
const regionColors = new Map();  // name → farbe

const palette = ['#ef4444', '#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#14b8a6', '#6366f1'];

const defaultStyle = { color: '#3b82f6', weight: 1, fillOpacity: 0.1 };
const selectedStyle = { color: '#1d4ed8', weight: 2, fillOpacity: 0.25 };

function guessPlzKey(props) {
  const keys = Object.keys(props);
  const candidates = ['plz', 'PLZ', 'postcode', 'postalcode'];
  for (let c of candidates) {
    if (keys.includes(c)) return c;
  }
  for (let k of keys) {
    if (typeof props[k] === 'string' && /^\d{5}$/.test(props[k])) return k;
  }
  return null;
}

function updateSelCount() {
  document.getElementById('selCount').textContent = `${selectedPlz.size} ausgewählt`;
}

function styleFor(plz) {
  for (const [region, set] of regions.entries()) {
    if (set.has(plz)) {
      const color = getRegionColor(region);
      return { color: '#1f2937', weight: 1.5, fillColor: color, fillOpacity: 0.35 };
    }
  }
  return selectedPlz.has(plz) ? selectedStyle : defaultStyle;
}

function restyle(plz) {
  const rec = featureIndex.find(f => f.plz === plz);
  if (rec && rec.layer) rec.layer.setStyle(styleFor(plz));
}

function restyleAll() {
  featureIndex.forEach(f => restyle(f.plz));
}

function getRegionColor(name) {
  if (!regionColors.has(name)) {
    const used = new Set(regionColors.values());
    const next = palette.find(c => !used.has(c)) || '#111827';
    regionColors.set(name, next);
    refreshLegend();
  }
  return regionColors.get(name);
}

function refreshLegend() {
  const el = document.getElementById('legend');
  const container = document.getElementById('legendItems');
  container.innerHTML = '';
  if (regionColors.size === 0) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  for (const [name, color] of regionColors.entries()) {
    const div = document.createElement('div');
    div.innerHTML = `<span class="swatch" style="background:${color}"></span>${name}`;
    container.appendChild(div);
  }
}

function zoomToSelected() {
  if (selectedPlz.size === 0) return;
  let bounds = null;
  for (const plz of selectedPlz) {
    const rec = featureIndex.find(r => r.plz === plz);
    if (!rec) continue;
    const b = turf.bbox(rec.feature);
    const latlngBounds = L.latLngBounds(
      [b[1], b[0]],
      [b[3], b[2]]
    );
    bounds = bounds ? bounds.extend(latlngBounds) : latlngBounds;
  }
  if (bounds) map.fitBounds(bounds.pad(0.1));
}

document.getElementById('geojsonInput').addEventListener('change', async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  try {
    const gj = JSON.parse(text);
    loadGeojson(gj);
  } catch (e) {
    alert('Fehler beim Einlesen der Datei.');
  }
});

function loadGeojson(gj) {
  if (plzLayer) map.removeLayer(plzLayer);
  featureIndex = [];
  selectedPlz.clear();
  updateSelCount();

  const sample = gj.features?.[0];
  if (!sample) return alert('Keine Features im GeoJSON.');
  plzPropKey = guessPlzKey(sample.properties || {});
  if (!plzPropKey) return alert('PLZ-Feld konnte nicht erkannt werden.');

  plzLayer = L.geoJSON(gj, {
    style: f => styleFor(String(f.properties[plzPropKey])),
    onEachFeature: (feature, layer) => {
      const plz = String(feature.properties[plzPropKey]);
      featureIndex.push({ plz, feature, layer });
      layer.bindTooltip(`PLZ: ${plz}`, { sticky: true });
    }
  }).addTo(map);

  map.fitBounds(plzLayer.getBounds().pad(0.05));

  map.off('click');
  map.on('click', (e) => {
    const pt = turf.point([e.latlng.lng, e.latlng.lat]);
    for (const rec of featureIndex) {
      if (turf.booleanPointInPolygon(pt, rec.feature)) {
        if (selectedPlz.has(rec.plz)) selectedPlz.delete(rec.plz);
        else selectedPlz.add(rec.plz);
        restyle(rec.plz);
        updateSelCount();
        break;
      }
    }
  });
}

document.getElementById('btnClearSel').onclick = () => {
  selectedPlz.clear();
  updateSelCount();
  restyleAll();
};
document.getElementById('btnZoomSel').onclick = zoomToSelected;

// === Region erstellen ===
const regionSelect = document.getElementById('regionSelect');
const regionList = document.getElementById('regionList');

document.getElementById('btnCreateRegion').onclick = () => {
  const name = document.getElementById('regionName').value.trim();
  if (!name) return alert('Bitte Regionsnamen eingeben');
  if (regions.has(name)) return alert('Region existiert bereits');
  regions.set(name, new Set());
  regionColors.set(name, getRegionColor(name));
  refreshRegionSelect();
  document.getElementById('regionName').value = '';
};

document.getElementById('btnAddSelectedToRegion').onclick = () => {
  const name = regionSelect.value;
  if (!name) return;
  const set = regions.get(name);
  selectedPlz.forEach(p => set.add(p));
  refreshRegionSelect();
  restyleAll();
};

document.getElementById('btnRemovePlzFromRegion').onclick = () => {
  const name = regionSelect.value;
  if (!name) return;
  const set = regions.get(name);
  selectedPlz.forEach(p => set.delete(p));
  refreshRegionSelect();
  restyleAll();
};

document.getElementById('btnDeleteRegion').onclick = () => {
  const name = regionSelect.value;
  if (!name) return;
  if (!confirm(`Region "${name}" wirklich löschen?`)) return;
  regions.delete(name);
  regionColors.delete(name);
  refreshRegionSelect();
  restyleAll();
};

function refreshRegionSelect() {
  regionSelect.innerHTML = '';
  for (const name of regions.keys()) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    regionSelect.appendChild(opt);
  }
  refreshRegionList();
  refreshLegend();
}

function refreshRegionList() {
  regionList.innerHTML = '';
  for (const [name, set] of regions) {
    const div = document.createElement('div');
    div.className = 'list-item';
    div.innerHTML = `<div><span class="swatch" style="background:${getRegionColor(name)}"></span><strong>${name}</strong> — ${set.size} PLZ</div>`;
    regionList.appendChild(div);
  }
}

// === Export ===
document.getElementById('btnExportJson').onclick = () => {
  const data = {};
  for (const [name, set] of regions) {
    data[name] = Array.from(set).sort();
  }
  const json = JSON.stringify({ regions: data, created: new Date().toISOString() }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'plz_regionen.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

document.getElementById('btnExportXlsx').onclick = () => {
  const rows = [];
  for (const [name, set] of regions) {
    for (const plz of set) {
      rows.push({ Region: name, PLZ: plz });
    }
  }
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Regionen');
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'plz_regionen.xlsx'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// === LocalStorage Speichern / Laden ===
document.getElementById('btnSaveLocal').onclick = () => {
  const state = {
    regions: Array.from(regions.entries()).map(([name, set]) => [name, Array.from(set)]),
    regionColors: Array.from(regionColors.entries())
  };
  localStorage.setItem('plz_region_state', JSON.stringify(state));
  alert('Gespeichert im Browser.');
};

document.getElementById('btnLoadLocal').onclick = () => {
  const raw = localStorage.getItem('plz_region_state');
  if (!raw) return alert('Keine gespeicherten Daten gefunden.');
  try {
    const obj = JSON.parse(raw);
    regions.clear();
    for (const [name, arr] of obj.regions) regions.set(name, new Set(arr));
    regionColors.clear();
    for (const [name, color] of obj.regionColors) regionColors.set(name, color);
    refreshRegionSelect();
    restyleAll();
  } catch (e) {
    alert('Fehler beim Laden.');
  }
};

// === Reset ===
document.getElementById('btnResetAll').onclick = () => {
  if (!confirm('Wirklich alles zurücksetzen?')) return;
  selectedPlz.clear();
  regions.clear();
  regionColors.clear();
  if (plzLayer) map.removeLayer(plzLayer);
  featureIndex = [];
  plzLayer = null;
  updateSelCount();
  refreshRegionSelect();
  refreshLegend();
};

let lasso = null;

function activateLasso() {
  if (lasso) {
    lasso.disable();
    map.off('lasso.finished');
    lasso = null;
  }

  lasso = L.lasso(map, {
    intersect: true,
    layers: plzLayer
  });

  lasso.enable();
  console.log("Lasso aktiviert");

  map.once('lasso.finished', (event) => {
    const selectedLayers = event.layers;
    let count = 0;

    for (const rec of featureIndex) {
      if (rec.layer && selectedLayers.includes(rec.layer)) {
        selectedPlz.add(rec.plz);
        count++;
      }
    }

    console.log(`✅ ${count} PLZ ausgewählt`);
    updateSelCount();
    restyleAll();

    // 🎯 снова активировать
    activateLasso(); // рекурсивно запускаем заново
  });
}

document.getElementById('btnLasso').onclick = () => {
  if (lasso) {
    lasso.disable();
    map.off('lasso.finished');
    lasso = null;
    document.getElementById('btnLasso').textContent = 'Lasso aktivieren';
    console.log("Lasso deaktiviert");
  } else {
    activateLasso();
    document.getElementById('btnLasso').textContent = 'Lasso deaktivieren';
  }
};
