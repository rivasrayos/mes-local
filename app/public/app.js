/* global Chart */

const state = {
  offset: 0,
  limit: 50,
  eolOffset: 0,
  charts: {},
  lines: [],
};

const $ = (id) => document.getElementById(id);

/**
 * Routes:
 *  #/                      product home
 *  #/imla                  IMLA lines
 *  #/imla/line/L12         IMLA line
 *  #/eol                   EOL lines
 *  #/eol/line/L12          EOL line
 *  #/settings              admin settings
 */
function getRoute() {
  let raw = (location.hash || '#/').replace(/^#/, '') || '/';
  if (!raw.startsWith('/')) raw = `/${raw}`;

  let m = raw.match(/^\/imla\/line\/([^/]+)\/?$/i);
  if (m) return { product: 'imla', page: 'line', line: decodeURIComponent(m[1]) };
  if (/^\/imla\/?$/i.test(raw)) return { product: 'imla', page: 'home', line: '' };

  m = raw.match(/^\/eol\/line\/([^/]+)\/?$/i);
  if (m) return { product: 'eol', page: 'line', line: decodeURIComponent(m[1]) };
  if (/^\/eol\/?$/i.test(raw)) return { product: 'eol', page: 'home', line: '' };

  if (/^\/settings\/?$/i.test(raw)) return { product: 'settings', page: 'home', line: '' };

  m = raw.match(/^\/line\/([^/]+)\/?$/i);
  if (m) return { product: 'imla', page: 'line', line: decodeURIComponent(m[1]), legacy: true };

  return { product: 'home', page: 'home', line: '' };
}

function goProductHome() { location.hash = '#/'; }
function goImlaHome() { location.hash = '#/imla'; }
function goEolHome() { location.hash = '#/eol'; }
function goSettings() { location.hash = '#/settings'; }
function goImlaLine(line) { location.hash = `#/imla/line/${encodeURIComponent(line)}`; }
function goEolLine(line) { location.hash = `#/eol/line/${encodeURIComponent(line)}`; }

const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin';
const ADMIN_SESSION_KEY = 'mes_admin_session';

function isAdminLoggedIn() {
  try {
    return sessionStorage.getItem(ADMIN_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

function setAdminLoggedIn(on) {
  try {
    if (on) sessionStorage.setItem(ADMIN_SESSION_KEY, '1');
    else sessionStorage.removeItem(ADMIN_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

function renderSettingsView() {
  const loggedIn = isAdminLoggedIn();
  $('settingsLoginPanel').classList.toggle('hidden', loggedIn);
  $('settingsAppPanel').classList.toggle('hidden', !loggedIn);
  $('settingsLogoutBtn').classList.toggle('hidden', !loggedIn);
  if (!loggedIn) {
    $('settingsLoginError').classList.add('hidden');
    $('settingsLoginError').textContent = '';
    return;
  }
  loadCameraRegistry().catch(console.error);
}

function syncCamRoleOptions() {
  const product = $('camProductSelect').value;
  const sel = $('camRoleSelect');
  const roles = product === 'imla'
    ? ['TOP', 'BOT']
    : ['EOL1', 'EOL2', 'EOL3', 'EOL4', 'EOL5'];
  sel.innerHTML = roles.map((r) => `<option value="${r}">${r}</option>`).join('');
}

function setCamMsg(el, text, kind) {
  if (!text) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.textContent = text;
  el.classList.remove('hidden', 'ok', 'err');
  if (kind) el.classList.add(kind);
}

async function discoverCameraUi() {
  const ip = ($('camIpInput').value || '').trim();
  const msg = $('camDiscoverMsg');
  setCamMsg(msg, 'Buscando…', '');
  $('camAssignBlock').classList.add('hidden');
  try {
    const res = await fetch('/api/settings/cameras/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se encontró la cámara');
    $('camFoundIp').textContent = data.ip || ip;
    $('camFoundSerial').textContent = data.serialNumber || '—';
    $('camFoundId').textContent = data.cameraId || '—';
    $('camAssignBlock').classList.remove('hidden');
    setCamMsg(msg, `Encontrada: ${data.serialNumber}`, 'ok');
  } catch (err) {
    setCamMsg(msg, err.message || String(err), 'err');
  }
}

async function saveCameraUi() {
  const msg = $('camSaveMsg');
  setCamMsg(msg, 'Guardando…', '');
  try {
    const body = {
      ip: $('camFoundIp').textContent,
      serialNumber: $('camFoundSerial').textContent,
      cameraId: $('camFoundId').textContent,
      lineNumber: ($('camLineInput').value || '').trim(),
      product: $('camProductSelect').value,
      role: $('camRoleSelect').value,
    };
    const res = await fetch('/api/settings/cameras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudo guardar');
    setCamMsg(msg, `Guardada: ${body.lineNumber} · ${body.product.toUpperCase()} ${body.role}`, 'ok');
    await loadCameraRegistry();
  } catch (err) {
    setCamMsg(msg, err.message || String(err), 'err');
  }
}

async function loadCameraRegistry() {
  const tbody = $('camRegistryBody');
  if (!tbody) return;
  try {
    const data = await api('/api/settings/cameras');
    const items = data.items || [];
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="7">Sin cámaras aún</td></tr>';
      return;
    }
    tbody.innerHTML = items.map((c) => `
      <tr>
        <td>${c.lineNumber || '—'}</td>
        <td>${(c.product || '').toUpperCase()}</td>
        <td>${c.role || '—'}</td>
        <td>${c.ip || '—'}</td>
        <td>${c.serialNumber || '—'}</td>
        <td>${c.cameraId || '—'}</td>
        <td><button type="button" class="btn" data-cam-del="${c.id}">Borrar</button></td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7">${err.message || err}</td></tr>`;
  }
}

async function deleteCameraUi(id) {
  if (!id || !confirm('¿Borrar esta cámara del registro?')) return;
  const res = await fetch(`/api/settings/cameras/${encodeURIComponent(id)}`, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert(data.error || 'No se pudo borrar');
    return;
  }
  await loadCameraRegistry();
}

function ensureRoute() {
  const r = getRoute();
  if (r.legacy && r.line) {
    location.replace(`#/imla/line/${encodeURIComponent(r.line)}`);
    return false;
  }
  return true;
}

function showView(viewId) {
  ['view-home', 'view-imla', 'view-eol', 'view-settings'].forEach((id) => {
    $(id).classList.toggle('hidden', id !== viewId);
  });
}

function buildQs(rangeSelectId, fromId, toId, line, extra = {}) {
  const params = new URLSearchParams();
  const range = $(rangeSelectId).value;
  if (line) params.set('lineNumber', line);

  if (range === 'custom') {
    const from = $(fromId).value;
    const to = $(toId).value;
    if (from) params.set('from', `${from.replace('T', ' ')}:00`);
    if (to) params.set('to', `${to.replace('T', ' ')}:00`);
  } else {
    params.set('range', range);
  }

  Object.entries(extra).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') params.set(k, v);
  });
  return params;
}

function imlaQs(extra = {}) {
  const route = getRoute();
  return buildQs('rangeSelect', 'fromInput', 'toInput', route.product === 'imla' ? route.line : '', extra);
}

function eolQs(extra = {}) {
  const route = getRoute();
  return buildQs('eolRangeSelect', 'eolFromInput', 'eolToInput', route.product === 'eol' ? route.line : '', extra);
}

async function api(path) {
  const res = await fetch(path);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

function fmtPct(n) {
  return `${(n || 0).toFixed(1)}%`;
}

/** Split timestamps into { date: YYYY-MM-DD, time: HH:mm:ss } for tables */
function splitDateTime(raw) {
  if (raw == null || raw === '') return { date: '—', time: '—' };
  const asString = String(raw).trim();

  // Already local wall clock: 2026-08-14 15:30:02 (optional fractional)
  let m = asString.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (m) return { date: m[1], time: m[2] };

  // Only parse real ISO / numeric dates — not broken "Fri Aug 14 2026 17" truncations
  if (!/^\d{4}-\d{2}-\d{2}/.test(asString) && !/^\d{10,13}$/.test(asString)) {
    return { date: '—', time: '—' };
  }

  const d = new Date(asString);
  if (!Number.isNaN(d.getTime())) {
    const pad = (n) => String(n).padStart(2, '0');
    return {
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    };
  }
  return { date: asString.slice(0, 10) || '—', time: '—' };
}

function makeChart(id, config) {
  const ctx = $(id);
  if (!ctx) return;
  if (state.charts[id]) state.charts[id].destroy();
  state.charts[id] = new Chart(ctx, config);
}

function kpiItems(summary, { includeCarriers = true } = {}) {
  const totalLabel = summary.unit === 'cable'
    ? 'Cables'
    : summary.unit === 'camera'
      ? 'Capturas'
      : 'Total';
  const items = [
    { label: totalLabel, value: summary.total },
    { label: 'Pass', value: summary.passCount, cls: 'pass' },
    { label: 'Fail', value: summary.failCount, cls: 'fail' },
    { label: 'Pass rate', value: fmtPct(summary.passRate), cls: 'pass' },
    { label: 'Fail rate', value: fmtPct(summary.failRate), cls: 'fail' },
  ];
  if (summary.unit !== 'camera') {
    items.push({ label: 'SN únicos', value: summary.uniqueSns });
  } else if (summary.uniqueSns != null) {
    items.push({ label: 'SN únicos', value: summary.uniqueSns });
  }
  if (includeCarriers && summary.unit !== 'camera') {
    items.push({
      label: summary.unit === 'cable' ? 'Pases ciclos' : 'Pases carriers',
      value: summary.carrierPasses ?? summary.uniqueCarriers,
    });
  }
  return items;
}

function renderKpiCards(summary, opts) {
  return kpiItems(summary, opts).map((i) => `
    <div class="kpi ${i.cls || ''}">
      <div class="label">${i.label}</div>
      <div class="value">${i.value}</div>
    </div>
  `).join('');
}

function isEmbedUrl(u) {
  return /\/embed\/capture\//i.test(u) || (!/\.(jpe?g|png|gif|webp|bmp)(\?|$)/i.test(u) && /capture_id=/i.test(u));
}

function renderImages(urls = []) {
  return (urls || []).map((u) => {
    if (isEmbedUrl(u)) {
      // Embed pages need a large viewport; small iframes crop the capture to a corner.
      return `
        <figure class="img-card img-card-embed">
          <button type="button" class="embed-preview" data-embed-url="${u}">
            <span class="embed-preview-title">Vista con boundings</span>
            <span class="embed-preview-sub">Clic para ver completa (embed)</span>
          </button>
          <figcaption>
            <button type="button" class="linkish" data-embed-url="${u}">Ver captura</button>
            · <a href="${u}" target="_blank" rel="noopener">Abrir en pestaña</a>
          </figcaption>
        </figure>
      `;
    }
    return `
      <figure class="img-card">
        <a href="${u}" target="_blank" rel="noopener">
          <img src="${u}" alt="inspection image" loading="lazy" referrerpolicy="no-referrer" />
        </a>
        <figcaption><a href="${u}" target="_blank" rel="noopener">Abrir</a></figcaption>
      </figure>
    `;
  }).join('') || '<span>—</span>';
}

const mediaZoom = { value: 1, min: 0.5, max: 4, step: 0.15 };
const mediaPan = { x: 0, y: 0, dragging: false, startX: 0, startY: 0, originX: 0, originY: 0 };
const mediaEmbed = { reloadTimer: null, pendingReload: false, openUrl: '', mode: 'embed' };
const capChoice = { el: null, payload: null };

function clampMediaPan() {
  const stage = $('mediaEmbedStage');
  if (!stage) return;
  const sw = stage.clientWidth || 1;
  const sh = stage.clientHeight || 1;
  const s = mediaZoom.value || 1;

  let cw = sw;
  let ch = sh;
  if (mediaEmbed.mode === 'image') {
    const image = $('mediaLightboxImage');
    if (image?.naturalWidth && image?.naturalHeight) {
      cw = image.naturalWidth;
      ch = image.naturalHeight;
    }
  }

  const scaledW = cw * s;
  const scaledH = ch * s;
  // Keep content inside the stage: when smaller, no pan; when larger, only within overflow.
  const maxX = Math.max(0, (scaledW - sw) / 2);
  const maxY = Math.max(0, (scaledH - sh) / 2);
  mediaPan.x = Math.min(maxX, Math.max(-maxX, mediaPan.x));
  mediaPan.y = Math.min(maxY, Math.max(-maxY, mediaPan.y));
}

function applyMediaTransform() {
  clampMediaPan();
  const frame = $('mediaLightboxFrame');
  const image = $('mediaLightboxImage');
  const btn = $('mediaZoomReset');
  const transform = `translate(calc(-50% + ${mediaPan.x}px), calc(-50% + ${mediaPan.y}px)) scale(${mediaZoom.value})`;
  if (frame) frame.style.transform = transform;
  if (image) image.style.transform = transform;
  if (btn) btn.textContent = `${Math.round(mediaZoom.value * 100)}%`;
}

function resetMediaView(zoom = 1) {
  mediaZoom.value = zoom;
  mediaPan.x = 0;
  mediaPan.y = 0;
  applyMediaTransform();
}

function bustEmbedUrl(url) {
  const clean = String(url || '').replace(/([?&])_mes_reload=\d+/g, '$1').replace(/[?&]$/, '');
  const sep = clean.includes('?') ? '&' : '?';
  return `${clean}${sep}_mes_reload=${Date.now()}`;
}

function stripEmbedOverlays(url) {
  try {
    const u = new URL(url);
    ['labels', 'heatmap', 'boundings'].forEach((k) => u.searchParams.delete(k));
    return u.toString();
  } catch {
    return String(url || '')
      .replace(/([?&])labels=[^&]*/gi, '$1')
      .replace(/([?&])heatmap=[^&]*/gi, '$1')
      .replace(/([?&])boundings=[^&]*/gi, '$1')
      .replace(/[?&]$/, '');
  }
}

function setMediaMode(mode) {
  mediaEmbed.mode = mode;
  const frame = $('mediaLightboxFrame');
  const image = $('mediaLightboxImage');
  if (!frame || !image) return;
  if (mode === 'image') {
    frame.classList.add('hidden');
    frame.src = 'about:blank';
    image.classList.remove('hidden');
  } else {
    image.classList.add('hidden');
    image.removeAttribute('src');
    frame.classList.remove('hidden');
  }
}

function openMediaLightbox(url, { mode = 'embed', title = 'Captura' } = {}) {
  mediaEmbed.openUrl = url;
  $('mediaLightboxTitle').textContent = title;
  $('mediaLightboxOpen').href = url;

  const frame = $('mediaLightboxFrame');
  const image = $('mediaLightboxImage');
  if (mediaEmbed.reloadTimer) {
    clearTimeout(mediaEmbed.reloadTimer);
    mediaEmbed.reloadTimer = null;
  }
  mediaEmbed.pendingReload = mode === 'embed';
  resetMediaView(1);
  setMediaMode(mode === 'image' ? 'image' : 'embed');

  if (mode === 'image') {
    image.onload = () => applyMediaTransform();
    image.src = url;
    applyMediaTransform();
  } else {
    const onLoad = () => {
      if (!mediaEmbed.pendingReload) return;
      mediaEmbed.pendingReload = false;
      mediaEmbed.reloadTimer = setTimeout(() => {
        mediaEmbed.reloadTimer = null;
        if ($('mediaLightbox').classList.contains('hidden')) return;
        if (frame.src === 'about:blank') return;
        frame.src = bustEmbedUrl(url);
        applyMediaTransform();
      }, 350);
    };
    frame.removeEventListener('load', frame._eolEmbedOnLoad);
    frame._eolEmbedOnLoad = onLoad;
    frame.addEventListener('load', onLoad);
    frame.src = bustEmbedUrl(url);
    applyMediaTransform();
  }

  document.body.style.overflow = 'hidden';
  $('mediaLightbox').classList.remove('hidden');
  $('mediaLightbox').setAttribute('aria-hidden', 'false');
}

function closeMediaLightbox() {
  if (mediaEmbed.reloadTimer) {
    clearTimeout(mediaEmbed.reloadTimer);
    mediaEmbed.reloadTimer = null;
  }
  mediaEmbed.pendingReload = false;
  mediaEmbed.openUrl = '';
  mediaPan.dragging = false;
  document.body.style.overflow = '';
  $('mediaEmbedStage')?.classList.remove('is-dragging');
  $('mediaLightbox').classList.add('hidden');
  $('mediaLightbox').setAttribute('aria-hidden', 'true');
  const frame = $('mediaLightboxFrame');
  const image = $('mediaLightboxImage');
  if (frame?._eolEmbedOnLoad) {
    frame.removeEventListener('load', frame._eolEmbedOnLoad);
    frame._eolEmbedOnLoad = null;
  }
  if (frame) {
    frame.src = 'about:blank';
    frame.style.transform = '';
    frame.classList.remove('hidden');
  }
  if (image) {
    image.removeAttribute('src');
    image.style.transform = '';
    image.classList.add('hidden');
  }
}

function reloadMediaEmbed() {
  const url = mediaEmbed.openUrl;
  if (!url) return;
  if (mediaEmbed.mode === 'image') {
    const image = $('mediaLightboxImage');
    if (!image) return;
    image.src = `${url}${url.includes('?') ? '&' : '?'}_mes_reload=${Date.now()}`;
    applyMediaTransform();
    return;
  }
  const frame = $('mediaLightboxFrame');
  if (!frame) return;
  if (mediaEmbed.reloadTimer) {
    clearTimeout(mediaEmbed.reloadTimer);
    mediaEmbed.reloadTimer = null;
  }
  mediaEmbed.pendingReload = false;
  resetMediaView(mediaZoom.value);
  frame.src = bustEmbedUrl(url);
  applyMediaTransform();
}

function hideCapChoiceMenu() {
  const menu = $('capChoiceMenu');
  if (!menu) return;
  menu.classList.add('hidden');
  menu.setAttribute('aria-hidden', 'true');
  capChoice.payload = null;
}

function showCapChoiceMenu(anchorEl, payload) {
  const menu = $('capChoiceMenu');
  if (!menu) return;
  capChoice.payload = payload;
  const rect = anchorEl.getBoundingClientRect();
  menu.classList.remove('hidden');
  menu.setAttribute('aria-hidden', 'false');
  const menuRect = menu.getBoundingClientRect();
  let left = rect.left;
  let top = rect.bottom + 6;
  if (left + menuRect.width > window.innerWidth - 8) left = window.innerWidth - menuRect.width - 8;
  if (top + menuRect.height > window.innerHeight - 8) top = rect.top - menuRect.height - 6;
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
}

function openCaptureFromChoice(mode) {
  const payload = capChoice.payload;
  hideCapChoiceMenu();
  if (!payload) return;
  if (mode === 'image') {
    const url = payload.imageUrl
      || (payload.markedImageUrl ? stripEmbedOverlays(payload.markedImageUrl) : '');
    if (!url) return;
    openMediaLightbox(url, { mode: 'image', title: `Imagen · ${payload.captureId || ''}` });
    return;
  }
  const url = payload.markedImageUrl || payload.imageUrl;
  if (!url) return;
  openMediaLightbox(url, {
    mode: isEmbedUrl(url) ? 'embed' : 'image',
    title: `Boundings · ${payload.captureId || ''}`,
  });
}

function wireMediaStageInteractions() {
  const stage = $('mediaEmbedStage');
  if (!stage || stage.dataset.wired === '1') return;
  stage.dataset.wired = '1';

  stage.addEventListener('wheel', (e) => {
    if ($('mediaLightbox').classList.contains('hidden')) return;
    e.preventDefault();
    const dir = e.deltaY > 0 ? -1 : 1;
    mediaZoom.value = Math.min(
      mediaZoom.max,
      Math.max(mediaZoom.min, mediaZoom.value + dir * mediaZoom.step)
    );
    applyMediaTransform();
  }, { passive: false });

  stage.addEventListener('pointerdown', (e) => {
    if ($('mediaLightbox').classList.contains('hidden')) return;
    if (e.button !== 0) return;
    mediaPan.dragging = true;
    mediaPan.startX = e.clientX;
    mediaPan.startY = e.clientY;
    mediaPan.originX = mediaPan.x;
    mediaPan.originY = mediaPan.y;
    stage.classList.add('is-dragging');
    stage.setPointerCapture(e.pointerId);
  });

  stage.addEventListener('pointermove', (e) => {
    if (!mediaPan.dragging) return;
    mediaPan.x = mediaPan.originX + (e.clientX - mediaPan.startX);
    mediaPan.y = mediaPan.originY + (e.clientY - mediaPan.startY);
    applyMediaTransform();
  });

  const endDrag = (e) => {
    if (!mediaPan.dragging) return;
    mediaPan.dragging = false;
    stage.classList.remove('is-dragging');
    try { stage.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
}

function wireImageActions(root) {
  root.querySelectorAll('[data-embed-url]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      openMediaLightbox(el.dataset.embedUrl);
    });
  });
}

function toLocalInputValue(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// -------------------- IMLA --------------------

function updateImlaChrome(route) {
  showView('view-imla');
  const isLine = route.page === 'line';
  $('homeCharts').classList.toggle('hidden', isLine);
  $('lineCharts').classList.toggle('hidden', !isLine);
  const backBtn = $('backBtn');
  if (isLine) {
    backBtn.textContent = '← Todas las líneas';
    $('pageEyebrow').textContent = 'IMLA · Página de línea';
    $('pageTitle').textContent = `Línea ${route.line}`;
    document.title = `MES IMLA — ${route.line}`;
  } else {
    backBtn.textContent = '← MES Local';
    $('pageEyebrow').textContent = 'IMLA';
    $('pageTitle').textContent = 'Todas las líneas';
    document.title = 'MES IMLA';
  }
}

function renderImlaHomeLines(byLine = []) {
  if (!byLine.length) {
    $('kpiRow').innerHTML = '<div class="kpi"><div class="label">Sin datos</div><div class="value">0</div></div>';
    return;
  }
  const sorted = [...byLine].sort((a, b) =>
    String(a.lineNumber).localeCompare(String(b.lineNumber), undefined, { numeric: true })
  );
  $('kpiRow').innerHTML = sorted.map((line) => `
    <section class="line-kpi-block clickable" data-line="${line.lineNumber}">
      <header class="line-kpi-header">
        <h3>${line.lineNumber}</h3>
        <button type="button" class="btn btn-line" data-line="${line.lineNumber}">Abrir línea</button>
      </header>
      <div class="kpi-row nested">${renderKpiCards(line)}</div>
    </section>
  `).join('');
  $('kpiRow').querySelectorAll('[data-line]').forEach((el) => {
    el.addEventListener('click', () => goImlaLine(el.dataset.line));
  });
}

async function loadImlaDashboard() {
  const route = getRoute();
  updateImlaChrome(route);
  const data = await api(`/api/dashboard?${imlaQs()}`);

  if (route.page === 'line') {
    $('kpiRow').innerHTML = `
      <section class="line-kpi-block current">
        <header class="line-kpi-header"><h3>General</h3></header>
        <div class="kpi-row nested">${renderKpiCards(data.summary)}</div>
      </section>
      <section class="line-kpi-block current kpi-view-top">
        <header class="line-kpi-header"><h3>TOP</h3></header>
        <div class="kpi-row nested">${renderKpiCards(data.summaryTop || data.summary)}</div>
      </section>
      <section class="line-kpi-block current kpi-view-bot">
        <header class="line-kpi-header"><h3>BOT</h3></header>
        <div class="kpi-row nested">${renderKpiCards(data.summaryBot || data.summary)}</div>
      </section>
    `;
    const passFailLine = (rows) => ({
      labels: rows.map((t) => String(t.bucket).slice(5, 16).replace('T', ' ')),
      datasets: [
        { label: 'Pass', data: rows.map((t) => t.passCount), borderColor: '#0f7a45', tension: 0.25 },
        { label: 'Fail', data: rows.map((t) => t.failCount), borderColor: '#b42318', tension: 0.25 },
      ],
    });
    const defectBar = (rows, color) => ({
      labels: rows.map((d) => d.defect),
      datasets: [{ label: 'Count', data: rows.map((d) => d.count), backgroundColor: color }],
    });
    const weldDonut = (rows) => ({
      labels: rows.map((w) => w.welding_position),
      datasets: [{
        data: rows.map((w) => w.count),
        backgroundColor: ['#0f6e7c', '#c45c26', '#b42318', '#5a6b78'],
      }],
    });
    const lineOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } };
    const barOpts = { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } };
    const donutOpts = { responsive: true, maintainAspectRatio: false };

    makeChart('trendChart', { type: 'line', data: passFailLine(data.trend || []), options: lineOpts });
    makeChart('trendChartTop', { type: 'line', data: passFailLine(data.trendTop || []), options: lineOpts });
    makeChart('trendChartBot', { type: 'line', data: passFailLine(data.trendBot || []), options: lineOpts });

    makeChart('defectChart', { type: 'bar', data: defectBar(data.defects || [], '#5a6b78'), options: barOpts });
    makeChart('defectChartTop', { type: 'bar', data: defectBar(data.defectsTop || [], '#0f6e7c'), options: barOpts });
    makeChart('defectChartBot', { type: 'bar', data: defectBar(data.defectsBot || [], '#c45c26'), options: barOpts });

    makeChart('weldChart', { type: 'doughnut', data: weldDonut(data.weldingOnFail || []), options: donutOpts });
    makeChart('weldChartTop', { type: 'doughnut', data: weldDonut(data.weldingOnFailTop || []), options: donutOpts });
    makeChart('weldChartBot', { type: 'doughnut', data: weldDonut(data.weldingOnFailBot || []), options: donutOpts });

    const paramNames = Object.keys(data.parameters || {});
    const first = paramNames[0] ? data.parameters[paramNames[0]] : [];
    makeChart('paramChart', {
      type: 'line',
      data: {
        labels: first.map((p) => String(p.bucket).slice(5, 16).replace('T', ' ')),
        datasets: paramNames.map((name, idx) => ({
          label: name,
          data: (data.parameters[name] || []).map((p) => p.avg),
          borderColor: ['#0f6e7c', '#c45c26', '#3d5a80', '#8a4fff'][idx % 4],
          tension: 0.25,
          spanGaps: true,
        })),
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
    });
    $('windowMeta').textContent = `Línea ${route.line} · ${data.window.from} → ${data.window.to}`;
  } else {
    renderImlaHomeLines(data.byLine);
    makeChart('lineChart', {
      type: 'bar',
      data: {
        labels: data.byLine.map((l) => l.lineNumber),
        datasets: [
          { label: 'Pass', data: data.byLine.map((l) => l.passCount || 0), backgroundColor: '#0f6e7c', stack: 'line' },
          { label: 'Fail', data: data.byLine.map((l) => l.failCount || 0), backgroundColor: '#b42318', stack: 'line' },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onClick: (_e, els) => {
          if (!els.length) return;
          const line = data.byLine[els[0].index]?.lineNumber;
          if (line && line !== '(blank)') goImlaLine(line);
        },
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
        plugins: { legend: { position: 'bottom' } },
      },
    });
    $('windowMeta').textContent = `IMLA · ${data.window.from} → ${data.window.to}`;
  }

  document.querySelectorAll('#view-imla .charts-grid:not(.hidden) .chart-block canvas').forEach((c) => {
    c.parentElement.style.height = '300px';
  });
}

async function loadImlaInspections() {
  updateImlaChrome(getRoute());
  const extra = {
    sn: $('fSn').value.trim(),
    carrierSn: $('fCarrier').value.trim(),
    slot: $('fSlot').value.trim(),
    passFail: $('fPassFail').value,
    defectType: $('fDefect').value.trim(),
    stationName: $('fStation').value.trim(),
    weldingPosition: $('fWeld').value,
    limit: state.limit,
    offset: state.offset,
  };
  const data = await api(`/api/inspections?${imlaQs(extra)}`);
  const tbody = document.querySelector('#inspTable tbody');
  tbody.innerHTML = data.items.map((item) => {
    const { date, time } = splitDateTime(item.inspectionTime);
    return `
    <tr>
      <td>${date}</td>
      <td>${time}</td>
      <td>${item.lineNumber || ''}</td>
      <td>${item.SN || ''}</td>
      <td>${item.carrierSn || ''}</td>
      <td>${item.slot || ''}</td>
      <td><span class="badge ${(item.passFail || '').toLowerCase()}">${item.passFail || ''}</span></td>
      <td title="${item.defectType || ''}">${(item.defectType || '').slice(0, 40)}</td>
      <td>${item.WeldingPosition || ''}</td>
      <td><button class="btn" data-id="${item.id}">Ver</button></td>
    </tr>`;
  }).join('');
  tbody.querySelectorAll('button[data-id]').forEach((btn) => {
    btn.addEventListener('click', () => openImlaDetail(btn.dataset.id));
  });
  $('pageInfo').textContent = `${data.offset + 1}–${Math.min(data.offset + data.limit, data.total)} de ${data.total}`;
  $('prevPage').disabled = data.offset <= 0;
  $('nextPage').disabled = data.offset + data.limit >= data.total;
}

async function openImlaDetail(id) {
  const item = await api(`/api/inspections/${id}`);
  const params = (item.parameters || []).map((p) => `<dt>${p.parameterName}</dt><dd>${p.parameterValue ?? ''}</dd>`).join('');
  $('drawerBody').innerHTML = `
    <dl class="kv">
      <dt>id</dt><dd>${item.id}</dd>
      <dt>batchId</dt><dd>${item.batchId}</dd>
      <dt>carrierSn</dt><dd>${item.carrierSn || ''}</dd>
      <dt>slot</dt><dd>${item.slot || ''}</dd>
      <dt>softwareVersion</dt><dd>${item.softwareVersion || ''}</dd>
      <dt>recipeVersion</dt><dd>${item.recipeVersion || ''}</dd>
      <dt>legMapping</dt><dd>${item.legMapping || ''}</dd>
      <dt>lineNumber</dt><dd>${item.lineNumber || ''}</dd>
      <dt>stationName</dt><dd>${item.stationName || ''}</dd>
      <dt>stageName</dt><dd>${item.stageName || ''}</dd>
      <dt>workStationCode</dt><dd>${item.workStationCode || ''}</dd>
      <dt>SN</dt><dd>${item.SN || ''}</dd>
      <dt>inspectionTime</dt><dd>${item.inspectionTime || ''}</dd>
      <dt>passFail</dt><dd>${item.passFail || ''}</dd>
      <dt>defectType</dt><dd>${item.defectType || ''}</dd>
      <dt>WeldingPosition</dt><dd>${item.WeldingPosition || ''}</dd>
      <dt>createdAt</dt><dd>${item.createdAt || ''}</dd>
      ${params}
    </dl>
    <h3>Imágenes</h3>
    <div class="img-grid">${renderImages(item.imageUrls)}</div>
  `;
  wireImageActions($('drawerBody'));
  $('drawer').classList.remove('hidden');
  $('drawer').setAttribute('aria-hidden', 'false');
}

// -------------------- EOL --------------------

function updateEolChrome(route) {
  showView('view-eol');
  const isLine = route.page === 'line';
  $('eolHomeCharts').classList.toggle('hidden', isLine);
  $('eolLineCharts').classList.toggle('hidden', !isLine);
  const backBtn = $('eolBackBtn');
  if (isLine) {
    backBtn.textContent = '← Todas las líneas';
    $('eolPageEyebrow').textContent = 'EOL · Página de línea';
    $('eolPageTitle').textContent = `Línea ${route.line}`;
    document.title = `MES EOL — ${route.line}`;
  } else {
    backBtn.textContent = '← MES Local';
    $('eolPageEyebrow').textContent = 'EOL';
    $('eolPageTitle').textContent = 'Todas las líneas';
    document.title = 'MES EOL';
  }
}

function renderEolHomeLines(byLine = []) {
  if (!byLine.length) {
    $('eolKpiRow').innerHTML = '<div class="kpi"><div class="label">Sin datos</div><div class="value">0</div></div>';
    return;
  }
  const sorted = [...byLine].sort((a, b) =>
    String(a.lineNumber).localeCompare(String(b.lineNumber), undefined, { numeric: true })
  );
  $('eolKpiRow').innerHTML = sorted.map((line) => `
    <section class="line-kpi-block clickable" data-eol-line="${line.lineNumber}">
      <header class="line-kpi-header">
        <h3>${line.lineNumber}</h3>
        <button type="button" class="btn btn-line" data-eol-line="${line.lineNumber}">Abrir línea</button>
      </header>
      <div class="kpi-row nested">${renderKpiCards(line)}</div>
    </section>
  `).join('');
  $('eolKpiRow').querySelectorAll('[data-eol-line]').forEach((el) => {
    el.addEventListener('click', () => goEolLine(el.dataset.eolLine));
  });
}

async function loadEolDashboard() {
  const route = getRoute();
  updateEolChrome(route);
  const data = await api(`/api/eol/dashboard?${eolQs()}`);

  if (route.page === 'line') {
    const cams = data.byCamera || [];
    const camBlocks = cams.map((cam) => `
      <section class="line-kpi-block current kpi-view-cam" data-cam="${cam.view}">
        <header class="line-kpi-header"><h3>${cam.view}</h3></header>
        <div class="kpi-row nested">${renderKpiCards(cam, { includeCarriers: false })}</div>
      </section>
    `).join('');
    $('eolKpiRow').innerHTML = `
      <section class="line-kpi-block current">
        <header class="line-kpi-header"><h3>General (cables)</h3></header>
        <div class="kpi-row nested">${renderKpiCards(data.summary)}</div>
      </section>
      ${camBlocks}
    `;

    const lineOpts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } };
    const barOpts = { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } };
    const passFailLine = (rows) => ({
      labels: (rows || []).map((t) => String(t.bucket).slice(5, 16).replace('T', ' ')),
      datasets: [
        { label: 'Pass', data: (rows || []).map((t) => t.passCount), borderColor: '#0f7a45', tension: 0.25 },
        { label: 'Fail', data: (rows || []).map((t) => t.failCount), borderColor: '#b42318', tension: 0.25 },
      ],
    });

    makeChart('eolCamYieldChart', {
      type: 'bar',
      data: {
        labels: cams.map((c) => c.view),
        datasets: [
          { label: 'Pass', data: cams.map((c) => c.passCount || 0), backgroundColor: '#0f6e7c', stack: 'cam' },
          { label: 'Fail', data: cams.map((c) => c.failCount || 0), backgroundColor: '#b42318', stack: 'cam' },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
        plugins: { legend: { position: 'bottom' } },
      },
    });

    makeChart('eolTrendChart', {
      type: 'line',
      data: passFailLine(data.trend || []),
      options: lineOpts,
    });
    makeChart('eolDefectChart', {
      type: 'bar',
      data: {
        labels: (data.defects || []).map((d) => d.defect),
        datasets: [{ label: 'Count', data: (data.defects || []).map((d) => d.count), backgroundColor: '#5a6b78' }],
      },
      options: barOpts,
    });

    const camCharts = $('eolCamCharts');
    camCharts.className = 'charts-grid wide-span';
    camCharts.innerHTML = cams.map((cam) => {
      const safe = String(cam.view).replace(/[^a-zA-Z0-9_-]/g, '_');
      return `
      <article class="chart-block">
        <h2>Tendencia · ${cam.view}</h2>
        <canvas id="eolTrend_${safe}"></canvas>
      </article>
      <article class="chart-block">
        <h2>Defectos · ${cam.view}</h2>
        <canvas id="eolDefect_${safe}"></canvas>
      </article>
    `;
    }).join('');

    cams.forEach((cam) => {
      const safe = String(cam.view).replace(/[^a-zA-Z0-9_-]/g, '_');
      const trend = (data.trendByCamera && data.trendByCamera[cam.view]) || [];
      const defects = (data.defectsByCamera && data.defectsByCamera[cam.view]) || [];
      makeChart(`eolTrend_${safe}`, { type: 'line', data: passFailLine(trend), options: lineOpts });
      makeChart(`eolDefect_${safe}`, {
        type: 'bar',
        data: {
          labels: defects.map((d) => d.defect),
          datasets: [{ label: 'Count', data: defects.map((d) => d.count), backgroundColor: '#0f6e7c' }],
        },
        options: barOpts,
      });
    });

    $('eolWindowMeta').textContent = `Línea ${route.line} · ${data.window.from} → ${data.window.to}`;
  } else {
    const camCharts = $('eolCamCharts');
    if (camCharts) {
      camCharts.className = 'charts-grid wide-span';
      camCharts.innerHTML = '';
    }
    renderEolHomeLines(data.byLine);
    makeChart('eolLineChart', {
      type: 'bar',
      data: {
        labels: data.byLine.map((l) => l.lineNumber),
        datasets: [
          { label: 'Pass', data: data.byLine.map((l) => l.passCount || 0), backgroundColor: '#0f6e7c', stack: 'line' },
          { label: 'Fail', data: data.byLine.map((l) => l.failCount || 0), backgroundColor: '#b42318', stack: 'line' },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onClick: (_e, els) => {
          if (!els.length) return;
          const line = data.byLine[els[0].index]?.lineNumber;
          if (line && line !== '(blank)') goEolLine(line);
        },
        scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
        plugins: { legend: { position: 'bottom' } },
      },
    });
    $('eolWindowMeta').textContent = `EOL · ${data.window.from} → ${data.window.to}`;
  }

  document.querySelectorAll('#view-eol .charts-grid:not(.hidden) .chart-block canvas').forEach((c) => {
    c.parentElement.style.height = '300px';
  });
}

async function loadEolInspections() {
  updateEolChrome(getRoute());
  hideCapChoiceMenu();
  const extra = {
    sn: $('eolFSn').value.trim(),
    captureId: $('eolFCaptureId').value.trim(),
    passFail: $('eolFPassFail').value,
    defectType: $('eolFDefect').value.trim(),
    limit: state.limit,
    offset: state.eolOffset,
  };
  const data = await api(`/api/eol/inspections?${eolQs(extra)}`);
  const camCols = (data.cameraViews && data.cameraViews.length)
    ? data.cameraViews
    : ['EOL1', 'EOL2', 'EOL3', 'EOL4', 'EOL5'];

  const thead = document.querySelector('#eolInspTable thead tr');
  if (thead) {
    thead.innerHTML = `
      <th>Fecha</th>
      <th>Hora</th>
      <th>Line</th>
      <th>SN</th>
      <th>Pos</th>
      ${camCols.map((c) => `<th>${c}</th>`).join('')}
      <th>Result</th>
      <th>Defects</th>
    `;
  }

  const renderCamCell = (caps = []) => {
    if (!caps.length) return '—';
    return caps.map((cap) => {
      const id = cap.captureId || '—';
      const fail = String(cap.passFail || '').toLowerCase() === 'fail';
      const title = `pos ${cap.position ?? '—'} · ${cap.passFail || ''} · clic para abrir`;
      const payload = encodeURIComponent(JSON.stringify({
        captureId: cap.captureId || '',
        imageUrl: cap.imageUrl || '',
        markedImageUrl: cap.markedImageUrl || '',
      }));
      return `<button type="button" class="cap-link ${fail ? 'cap-fail' : 'cap-ok'}" title="${title}" data-cap-payload="${payload}">${id}</button>`;
    }).join('<br>');
  };

  const tbody = document.querySelector('#eolInspTable tbody');
  tbody.innerHTML = data.items.map((item) => {
    const sn = item.sn || item.SN || '';
    const positions = Array.isArray(item.positions) ? item.positions.join(', ') : '';
    const byCam = item.capturesByCamera || {};
    const camCells = camCols.map((cam) => `<td class="cap-cell">${renderCamCell(byCam[cam] || [])}</td>`).join('');
    const { date, time } = splitDateTime(item.inspectionTime);
    return `
    <tr>
      <td>${date}</td>
      <td>${time}</td>
      <td>${item.lineNumber || ''}</td>
      <td>${sn}</td>
      <td>${positions || '—'}</td>
      ${camCells}
      <td><span class="badge ${(item.passFail || '').toLowerCase()}">${item.passFail || ''}</span></td>
      <td title="${item.defectType || ''}">${(item.defectType || '').slice(0, 40)}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('button[data-cap-payload]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const payload = JSON.parse(decodeURIComponent(btn.dataset.capPayload));
        showCapChoiceMenu(btn, payload);
      } catch (_) { /* ignore bad payload */ }
    });
  });

  $('eolPageInfo').textContent = `${data.offset + 1}–${Math.min(data.offset + data.limit, data.total)} de ${data.total}`;
  $('eolPrevPage').disabled = data.offset <= 0;
  $('eolNextPage').disabled = data.offset + data.limit >= data.total;
}

async function openEolDetail(id) {
  const item = await api(`/api/eol/inspections/${id}`);
  const sn = item.sn || item.SN || '';
  const positions = Array.isArray(item.positions) ? item.positions.join(', ') : '';
  const records = item.records || [];
  const recordsHtml = records.length
    ? `
      <div class="table-wrap">
        <table class="eol-cam-table">
          <thead>
            <tr>
              <th>Pos</th>
              <th>Cámara</th>
              <th>Capture ID</th>
              <th>Result</th>
              <th>Defects</th>
              <th>Images</th>
            </tr>
          </thead>
          <tbody>
            ${records.map((r) => `
              <tr>
                <td>${r.position ?? '—'}</td>
                <td title="${r.cameraId || ''}">${r.view || r.cameraId || '—'}</td>
                <td>${r.captureId || '—'}</td>
                <td><span class="badge ${(r.passFail || '').toLowerCase()}">${r.passFail || ''}</span></td>
                <td>${(r.defects || []).join(', ') || '—'}</td>
                <td><div class="img-grid compact">${renderImages(r.imageUrls || [])}</div></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`
    : '<p>—</p>';

  $('drawerBody').innerHTML = `
    <dl class="kv">
      <dt>lineNumber</dt><dd>${item.lineNumber || ''}</dd>
      <dt>stationName</dt><dd>${item.stationName || ''}</dd>
      <dt>SN (cable)</dt><dd>${sn}</dd>
      <dt>positions</dt><dd>${positions}</dd>
      <dt>cam fails</dt><dd>${item.failCameraCount || 0}</dd>
      <dt>inspectionTime</dt><dd>${item.inspectionTime || ''}</dd>
      <dt>passFail</dt><dd>${item.passFail || ''}</dd>
      <dt>defectType</dt><dd>${item.defectType || ''}</dd>
    </dl>
    <h3>Cámaras / posiciones</h3>
    ${recordsHtml}
  `;
  wireImageActions($('drawerBody'));
  $('drawer').classList.remove('hidden');
  $('drawer').setAttribute('aria-hidden', 'false');
}

async function deleteEolHistory(payload) {
  if (!confirm('¿Seguro que quieres borrar este histórico EOL?')) return;
  const res = await fetch('/api/eol/history', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Delete failed');
  $('eolDeleteResult').textContent = JSON.stringify(data, null, 2);
  await refreshAll();
}

async function deleteImlaHistory(payload) {
  if (!confirm('¿Seguro que quieres borrar este histórico IMLA?')) return;
  const res = await fetch('/api/history', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Delete failed');
  $('deleteResult').textContent = JSON.stringify(data, null, 2);
  await refreshAll();
}

// -------------------- Shell --------------------

function updatePageChrome() {
  const route = getRoute();
  if (route.product === 'home') {
    showView('view-home');
    document.title = 'MES Local — Inspection';
    return;
  }
  if (route.product === 'settings') {
    showView('view-settings');
    document.title = 'MES Local — Settings';
    renderSettingsView();
    return;
  }
  if (route.product === 'eol') {
    updateEolChrome(route);
    return;
  }
  updateImlaChrome(route);
}

async function refreshAll() {
  if (!ensureRoute()) return;
  const route = getRoute();
  updatePageChrome();

  if (route.product === 'home' || route.product === 'settings') return;

  if (route.product === 'eol') {
    const active = document.querySelector('#view-eol .tab.active')?.dataset.eolTab;
    if (active === 'inspections') await loadEolInspections();
    else if (active === 'admin') updateEolChrome(route);
    else await loadEolDashboard();
    return;
  }

  const active = document.querySelector('#view-imla .tab.active')?.dataset.tab;
  if (active === 'inspections') await loadImlaInspections();
  else if (active === 'admin') updateImlaChrome(route);
  else await loadImlaDashboard();
}

function wireUi() {
  if (!location.hash || location.hash === '#') location.hash = '#/';

  window.addEventListener('hashchange', () => {
    state.offset = 0;
    state.eolOffset = 0;
    refreshAll().catch(console.error);
  });

  document.querySelectorAll('.product-card[data-go]').forEach((card) => {
    card.addEventListener('click', () => { location.hash = card.dataset.go; });
  });

  $('settingsBackBtn').addEventListener('click', () => goProductHome());
  $('settingsLogoutBtn').addEventListener('click', () => {
    setAdminLoggedIn(false);
    renderSettingsView();
  });
  $('settingsLoginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const user = ($('settingsUser').value || '').trim();
    const pass = $('settingsPass').value || '';
    const err = $('settingsLoginError');
    if (user === ADMIN_USER && pass === ADMIN_PASS) {
      setAdminLoggedIn(true);
      $('settingsPass').value = '';
      err.classList.add('hidden');
      renderSettingsView();
      return;
    }
    err.textContent = 'Usuario o contraseña incorrectos.';
    err.classList.remove('hidden');
  });

  syncCamRoleOptions();
  $('camProductSelect').addEventListener('change', syncCamRoleOptions);
  $('camDiscoverBtn').addEventListener('click', () => discoverCameraUi().catch(console.error));
  $('camSaveBtn').addEventListener('click', () => saveCameraUi().catch(console.error));
  $('camIpInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      discoverCameraUi().catch(console.error);
    }
  });
  $('camRegistryBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cam-del]');
    if (!btn) return;
    deleteCameraUi(btn.getAttribute('data-cam-del')).catch(console.error);
  });

  $('backBtn').addEventListener('click', () => {
    const route = getRoute();
    if (route.page === 'line') goImlaHome();
    else goProductHome();
  });

  $('eolBackBtn').addEventListener('click', () => {
    const route = getRoute();
    if (route.page === 'line') goEolHome();
    else goProductHome();
  });

  document.querySelectorAll('#view-imla .tab').forEach((tab) => {
    tab.addEventListener('click', async () => {
      document.querySelectorAll('#view-imla .tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('#view-imla .panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      $(`tab-${tab.dataset.tab}`).classList.add('active');
      if (tab.dataset.tab === 'dashboard') await loadImlaDashboard();
      if (tab.dataset.tab === 'inspections') await loadImlaInspections();
    });
  });

  document.querySelectorAll('#view-eol .tab').forEach((tab) => {
    tab.addEventListener('click', async () => {
      document.querySelectorAll('#view-eol .tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('#view-eol .panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      $(`eol-tab-${tab.dataset.eolTab}`).classList.add('active');
      if (tab.dataset.eolTab === 'dashboard') await loadEolDashboard();
      if (tab.dataset.eolTab === 'inspections') await loadEolInspections();
    });
  });

  $('rangeSelect').addEventListener('change', () => {
    $('customRange').classList.toggle('hidden', $('rangeSelect').value !== 'custom');
  });
  $('eolRangeSelect').addEventListener('change', () => {
    $('eolCustomRange').classList.toggle('hidden', $('eolRangeSelect').value !== 'custom');
  });

  $('refreshBtn').addEventListener('click', refreshAll);
  $('eolRefreshBtn').addEventListener('click', refreshAll);

  $('exportBtn').addEventListener('click', () => {
    window.location.href = `/api/inspections/export.csv?${imlaQs({
      sn: $('fSn').value.trim(),
      carrierSn: $('fCarrier').value.trim(),
      slot: $('fSlot').value.trim(),
      passFail: $('fPassFail').value,
      defectType: $('fDefect').value.trim(),
      stationName: $('fStation').value.trim(),
      weldingPosition: $('fWeld').value,
    })}`;
  });
  $('eolExportBtn').addEventListener('click', () => {
    window.location.href = `/api/eol/inspections/export.csv?${eolQs({
      sn: $('eolFSn').value.trim(),
      captureId: $('eolFCaptureId').value.trim(),
      passFail: $('eolFPassFail').value,
      defectType: $('eolFDefect').value.trim(),
    })}`;
  });

  $('applyFilters').addEventListener('click', () => { state.offset = 0; loadImlaInspections(); });
  $('eolApplyFilters').addEventListener('click', () => { state.eolOffset = 0; loadEolInspections(); });
  $('prevPage').addEventListener('click', () => { state.offset = Math.max(0, state.offset - state.limit); loadImlaInspections(); });
  $('nextPage').addEventListener('click', () => { state.offset += state.limit; loadImlaInspections(); });
  $('eolPrevPage').addEventListener('click', () => { state.eolOffset = Math.max(0, state.eolOffset - state.limit); loadEolInspections(); });
  $('eolNextPage').addEventListener('click', () => { state.eolOffset += state.limit; loadEolInspections(); });

  $('closeDrawer').addEventListener('click', () => $('drawer').classList.add('hidden'));
  $('drawer').addEventListener('click', (e) => {
    if (e.target.id === 'drawer') $('drawer').classList.add('hidden');
  });
  $('closeMediaLightbox').addEventListener('click', closeMediaLightbox);
  $('mediaReloadEmbed').addEventListener('click', reloadMediaEmbed);
  $('mediaLightbox').addEventListener('click', (e) => {
    if (e.target.id === 'mediaLightbox') closeMediaLightbox();
  });
  $('capChoiceMenu')?.querySelectorAll('[data-cap-mode]').forEach((btn) => {
    btn.addEventListener('click', () => openCaptureFromChoice(btn.dataset.capMode));
  });
  document.addEventListener('click', (e) => {
    const menu = $('capChoiceMenu');
    if (!menu || menu.classList.contains('hidden')) return;
    if (menu.contains(e.target) || e.target.closest?.('[data-cap-payload]')) return;
    hideCapChoiceMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideCapChoiceMenu();
  });
  $('mediaZoomIn').addEventListener('click', () => {
    mediaZoom.value = Math.min(mediaZoom.max, mediaZoom.value + mediaZoom.step);
    applyMediaTransform();
  });
  $('mediaZoomOut').addEventListener('click', () => {
    mediaZoom.value = Math.max(mediaZoom.min, mediaZoom.value - mediaZoom.step);
    applyMediaTransform();
  });
  $('mediaZoomReset').addEventListener('click', () => {
    resetMediaView(1);
  });
  document.querySelector('.media-lightbox-panel')?.addEventListener('click', (e) => {
    e.stopPropagation();
  });
  wireMediaStageInteractions();

  $('deleteBeforeBtn').addEventListener('click', async () => {
    const v = $('deleteBefore').value;
    if (!v) return alert('Elige una fecha');
    try { await deleteImlaHistory({ before: new Date(v).toISOString() }); } catch (err) { alert(err.message); }
  });
  $('deleteRangeBtn').addEventListener('click', async () => {
    const from = $('deleteFrom').value;
    const to = $('deleteTo').value;
    if (!from || !to) return alert('Elige desde y hasta');
    try {
      await deleteImlaHistory({ from: `${from.replace('T', ' ')}:00`, to: `${to.replace('T', ' ')}:00` });
    } catch (err) { alert(err.message); }
  });

  $('eolDeleteBeforeBtn').addEventListener('click', async () => {
    const v = $('eolDeleteBefore').value;
    if (!v) return alert('Elige una fecha');
    try { await deleteEolHistory({ before: new Date(v).toISOString() }); } catch (err) { alert(err.message); }
  });
  $('eolDeleteRangeBtn').addEventListener('click', async () => {
    const from = $('eolDeleteFrom').value;
    const to = $('eolDeleteTo').value;
    if (!from || !to) return alert('Elige desde y hasta');
    try {
      await deleteEolHistory({ from: `${from.replace('T', ' ')}:00`, to: `${to.replace('T', ' ')}:00` });
    } catch (err) { alert(err.message); }
  });

  const now = new Date();
  const from = new Date(now.getTime() - 24 * 3600 * 1000);
  $('fromInput').value = toLocalInputValue(from);
  $('toInput').value = toLocalInputValue(now);
  $('eolFromInput').value = toLocalInputValue(from);
  $('eolToInput').value = toLocalInputValue(now);
}

wireUi();
refreshAll().catch((err) => {
  console.error(err);
});

setInterval(() => {
  const route = getRoute();
  if (route.product === 'imla') {
    const active = document.querySelector('#view-imla .tab.active')?.dataset.tab;
    if (active === 'dashboard') loadImlaDashboard().catch(console.error);
  }
  if (route.product === 'eol') {
    const active = document.querySelector('#view-eol .tab.active')?.dataset.eolTab;
    if (active === 'dashboard') loadEolDashboard().catch(console.error);
  }
}, 30000);
