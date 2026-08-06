/* global Chart */

const state = {
  offset: 0,
  limit: 50,
  charts: {},
  lines: [],
};

const $ = (id) => document.getElementById(id);

/**
 * Routes:
 *  #/                product home
 *  #/imla            IMLA lines home
 *  #/imla/line/L12   IMLA line page
 *  #/eol             EOL home
 *  legacy #/line/X   → #/imla/line/X
 */
function getRoute() {
  let raw = (location.hash || '#/').replace(/^#/, '') || '/';
  if (!raw.startsWith('/')) raw = `/${raw}`;

  // legacy redirect handled in ensureRoute
  let m = raw.match(/^\/imla\/line\/([^/]+)\/?$/i);
  if (m) return { product: 'imla', page: 'line', line: decodeURIComponent(m[1]) };

  if (/^\/imla\/?$/i.test(raw)) return { product: 'imla', page: 'home', line: '' };
  if (/^\/eol\/?$/i.test(raw)) return { product: 'eol', page: 'home', line: '' };

  m = raw.match(/^\/line\/([^/]+)\/?$/i);
  if (m) return { product: 'imla', page: 'line', line: decodeURIComponent(m[1]), legacy: true };

  return { product: 'home', page: 'home', line: '' };
}

function currentLine() {
  const r = getRoute();
  return r.product === 'imla' ? (r.line || '') : '';
}

function goProductHome() {
  location.hash = '#/';
}

function goImlaHome() {
  location.hash = '#/imla';
}

function goLine(line) {
  location.hash = `#/imla/line/${encodeURIComponent(line)}`;
}

function goEol() {
  location.hash = '#/eol';
}

function ensureRoute() {
  const r = getRoute();
  if (r.legacy && r.line) {
    location.replace(`#/imla/line/${encodeURIComponent(r.line)}`);
    return false;
  }
  if (!location.hash || location.hash === '#' || location.hash === '#/') {
    // keep #/
  }
  return true;
}

function showView(viewId) {
  ['view-home', 'view-imla', 'view-eol'].forEach((id) => {
    $(id).classList.toggle('hidden', id !== viewId);
  });
}

function qs(extra = {}) {
  const params = new URLSearchParams();
  const line = currentLine();
  const range = $('rangeSelect').value;

  if (line) params.set('lineNumber', line);

  if (range === 'custom') {
    const from = $('fromInput').value;
    const to = $('toInput').value;
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

function makeChart(id, config) {
  const ctx = $(id);
  if (!ctx) return;
  if (state.charts[id]) state.charts[id].destroy();
  state.charts[id] = new Chart(ctx, config);
}

function updatePageChrome() {
  const route = getRoute();

  if (route.product === 'home') {
    showView('view-home');
    document.title = 'MES Local — Inspection';
    return;
  }

  if (route.product === 'eol') {
    showView('view-eol');
    document.title = 'MES EOL';
    return;
  }

  showView('view-imla');
  const isLine = route.page === 'line';
  document.body.classList.toggle('page-line', isLine);
  document.body.classList.toggle('page-home', !isLine);

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

async function loadLines() {
  const data = await api('/api/lines');
  state.lines = data.lines || [];
}

function kpiItems(summary) {
  return [
    { label: 'Total', value: summary.total },
    { label: 'Pass', value: summary.passCount, cls: 'pass' },
    { label: 'Fail', value: summary.failCount, cls: 'fail' },
    { label: 'Pass rate', value: fmtPct(summary.passRate), cls: 'pass' },
    { label: 'Fail rate', value: fmtPct(summary.failRate), cls: 'fail' },
    { label: 'SN únicos', value: summary.uniqueSns },
    { label: 'Carriers', value: summary.uniqueCarriers },
  ];
}

function renderKpiCards(summary) {
  return kpiItems(summary).map((i) => `
    <div class="kpi ${i.cls || ''}">
      <div class="label">${i.label}</div>
      <div class="value">${i.value}</div>
    </div>
  `).join('');
}

function renderHomeLines(byLine = []) {
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
      <div class="kpi-row nested">
        ${renderKpiCards(line)}
      </div>
    </section>
  `).join('');

  $('kpiRow').querySelectorAll('[data-line]').forEach((el) => {
    el.addEventListener('click', () => {
      const line = el.dataset.line;
      if (line) goLine(line);
    });
  });
}

function renderLineKpis(summary) {
  $('kpiRow').innerHTML = `
    <section class="line-kpi-block current">
      <div class="kpi-row nested">
        ${renderKpiCards(summary)}
      </div>
    </section>
  `;
}

function renderHomeLineChart(byLine = []) {
  makeChart('lineChart', {
    type: 'bar',
    data: {
      labels: byLine.map((l) => l.lineNumber),
      datasets: [
        {
          label: 'Pass',
          data: byLine.map((l) => l.passCount ?? Math.max(0, (l.total || 0) - (l.failCount || 0))),
          backgroundColor: '#0f6e7c',
          stack: 'line',
        },
        {
          label: 'Fail',
          data: byLine.map((l) => l.failCount || 0),
          backgroundColor: '#b42318',
          stack: 'line',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_evt, elements) => {
        if (!elements.length) return;
        const idx = elements[0].index;
        const line = byLine[idx]?.lineNumber;
        if (line && line !== '(blank)') goLine(line);
      },
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true },
      },
      plugins: { legend: { position: 'bottom' } },
    },
  });
}

function renderLineCharts(data) {
  const labels = data.trend.map((t) => String(t.bucket).slice(5, 16).replace('T', ' '));
  makeChart('trendChart', {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Pass', data: data.trend.map((t) => t.passCount), borderColor: '#0f7a45', tension: 0.25 },
        { label: 'Fail', data: data.trend.map((t) => t.failCount), borderColor: '#b42318', tension: 0.25 },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
  });

  makeChart('defectChart', {
    type: 'bar',
    data: {
      labels: data.defects.map((d) => d.defect),
      datasets: [{ label: 'Count', data: data.defects.map((d) => d.count), backgroundColor: '#0f6e7c' }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
    },
  });

  makeChart('weldChart', {
    type: 'doughnut',
    data: {
      labels: data.weldingOnFail.map((w) => w.welding_position),
      datasets: [{
        data: data.weldingOnFail.map((w) => w.count),
        backgroundColor: ['#0f6e7c', '#c45c26', '#b42318', '#5a6b78'],
      }],
    },
    options: { responsive: true, maintainAspectRatio: false },
  });

  const paramNames = Object.keys(data.parameters || {});
  const first = paramNames[0] ? data.parameters[paramNames[0]] : [];
  makeChart('paramChart', {
    type: 'line',
    data: {
      labels: first.map((p) => String(p.bucket).slice(5, 16).replace('T', ' ')),
      datasets: paramNames.map((name, idx) => {
        const colors = ['#0f6e7c', '#c45c26', '#3d5a80', '#8a4fff'];
        return {
          label: name,
          data: (data.parameters[name] || []).map((p) => p.avg),
          borderColor: colors[idx % colors.length],
          tension: 0.25,
          spanGaps: true,
        };
      }),
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
  });
}

async function loadDashboard() {
  updatePageChrome();
  const route = getRoute();
  if (route.product !== 'imla') return;

  const data = await api(`/api/dashboard?${qs()}`);

  if (route.page === 'line') {
    renderLineKpis(data.summary);
    renderLineCharts(data);
    $('windowMeta').textContent = `Línea ${route.line} · Ventana: ${data.window.range}${data.window.shift ? ` (${data.window.shift})` : ''} · ${data.window.from} → ${data.window.to}`;
  } else {
    renderHomeLines(data.byLine);
    renderHomeLineChart(data.byLine);
    $('windowMeta').textContent = `IMLA · Ventana: ${data.window.range}${data.window.shift ? ` (${data.window.shift})` : ''} · ${data.window.from} → ${data.window.to}`;
  }

  document.querySelectorAll('#view-imla .charts-grid:not(.hidden) .chart-block canvas').forEach((c) => {
    c.parentElement.style.height = '300px';
  });
}

function filterExtras() {
  return {
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
}

async function loadInspections() {
  updatePageChrome();
  if (getRoute().product !== 'imla') return;

  const data = await api(`/api/inspections?${qs(filterExtras())}`);
  const tbody = document.querySelector('#inspTable tbody');
  tbody.innerHTML = data.items.map((item) => `
    <tr>
      <td>${item.inspectionTime || ''}</td>
      <td>${item.lineNumber || ''}</td>
      <td>${item.SN || ''}</td>
      <td>${item.carrierSn || ''}</td>
      <td>${item.slot || ''}</td>
      <td><span class="badge ${(item.passFail || '').toLowerCase()}">${item.passFail || ''}</span></td>
      <td title="${item.defectType || ''}">${(item.defectType || '').slice(0, 40)}</td>
      <td>${item.WeldingPosition || ''}</td>
      <td><button class="btn" data-id="${item.id}">Ver</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('button[data-id]').forEach((btn) => {
    btn.addEventListener('click', () => openDetail(btn.dataset.id));
  });

  $('pageInfo').textContent = `${data.offset + 1}–${Math.min(data.offset + data.limit, data.total)} de ${data.total}`;
  $('prevPage').disabled = data.offset <= 0;
  $('nextPage').disabled = data.offset + data.limit >= data.total;
}

async function openDetail(id) {
  const item = await api(`/api/inspections/${id}`);
  const params = (item.parameters || []).map((p) => `
    <dt>${p.parameterName}</dt><dd>${p.parameterValue ?? ''}</dd>
  `).join('');
  const images = (item.imageUrls || []).map((u) => {
    const isEmbed = /\/embed\/capture\//i.test(u) || (!/\.(jpe?g|png|gif|webp|bmp)(\?|$)/i.test(u) && /capture_id=/i.test(u));
    const media = isEmbed
      ? `<iframe src="${u}" title="capture" loading="lazy" referrerpolicy="no-referrer"></iframe>`
      : `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="inspection image" loading="lazy" referrerpolicy="no-referrer" /></a>`;
    return `
      <figure class="img-card">
        ${media}
        <figcaption><a href="${u}" target="_blank" rel="noopener">Abrir</a></figcaption>
      </figure>
    `;
  }).join('') || '<span>—</span>';

  $('drawerBody').innerHTML = `
    <dl class="kv">
      <dt>id</dt><dd>${item.id}</dd>
      <dt>batchId</dt><dd>${item.batchId}</dd>
      <dt>carrierSn</dt><dd>${item.carrierSn || ''}</dd>
      <dt>slot</dt><dd>${item.slot || ''}</dd>
      <dt>softwareVersion</dt><dd>${item.softwareVersion || ''}</dd>
      <dt>recipeVersion</dt><dd>${item.recipeVersion || ''}</dd>
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
    <div class="img-grid">${images}</div>
  `;
  $('drawer').classList.remove('hidden');
  $('drawer').setAttribute('aria-hidden', 'false');
}

function closeDrawer() {
  $('drawer').classList.add('hidden');
  $('drawer').setAttribute('aria-hidden', 'true');
}

function toLocalInputValue(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function deleteHistory(payload) {
  if (!confirm('¿Seguro que quieres borrar este histórico?')) return;
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

async function refreshAll() {
  if (!ensureRoute()) return;
  const route = getRoute();
  updatePageChrome();

  if (route.product === 'home' || route.product === 'eol') return;

  await loadLines();
  const active = document.querySelector('#view-imla .tab.active')?.dataset.tab;
  if (active === 'inspections') await loadInspections();
  else if (active === 'admin') updatePageChrome();
  else await loadDashboard();
}

function wireUi() {
  if (!location.hash || location.hash === '#') {
    location.hash = '#/';
  }

  window.addEventListener('hashchange', () => {
    state.offset = 0;
    refreshAll().catch(console.error);
  });

  document.querySelectorAll('.product-card[data-go]').forEach((card) => {
    card.addEventListener('click', () => {
      location.hash = card.dataset.go;
    });
  });

  $('backBtn').addEventListener('click', () => {
    const route = getRoute();
    if (route.page === 'line') goImlaHome();
    else goProductHome();
  });

  $('eolBackBtn').addEventListener('click', goProductHome);

  document.querySelectorAll('#view-imla .tab').forEach((tab) => {
    tab.addEventListener('click', async () => {
      document.querySelectorAll('#view-imla .tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('#view-imla .panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      $(`tab-${tab.dataset.tab}`).classList.add('active');
      if (tab.dataset.tab === 'dashboard') await loadDashboard();
      if (tab.dataset.tab === 'inspections') await loadInspections();
      if (tab.dataset.tab === 'admin') updatePageChrome();
    });
  });

  $('rangeSelect').addEventListener('change', () => {
    $('customRange').classList.toggle('hidden', $('rangeSelect').value !== 'custom');
  });

  $('refreshBtn').addEventListener('click', refreshAll);
  $('exportBtn').addEventListener('click', () => {
    window.location.href = `/api/inspections/export.csv?${qs(filterExtras())}`;
  });
  $('applyFilters').addEventListener('click', () => {
    state.offset = 0;
    loadInspections();
  });
  $('prevPage').addEventListener('click', () => {
    state.offset = Math.max(0, state.offset - state.limit);
    loadInspections();
  });
  $('nextPage').addEventListener('click', () => {
    state.offset += state.limit;
    loadInspections();
  });
  $('closeDrawer').addEventListener('click', closeDrawer);
  $('drawer').addEventListener('click', (e) => {
    if (e.target.id === 'drawer') closeDrawer();
  });

  $('deleteBeforeBtn').addEventListener('click', async () => {
    const v = $('deleteBefore').value;
    if (!v) return alert('Elige una fecha');
    try {
      await deleteHistory({ before: new Date(v).toISOString() });
    } catch (err) {
      alert(err.message);
    }
  });

  $('deleteRangeBtn').addEventListener('click', async () => {
    const from = $('deleteFrom').value;
    const to = $('deleteTo').value;
    if (!from || !to) return alert('Elige desde y hasta');
    try {
      await deleteHistory({
        from: `${from.replace('T', ' ')}:00`,
        to: `${to.replace('T', ' ')}:00`,
      });
    } catch (err) {
      alert(err.message);
    }
  });

  const now = new Date();
  const from = new Date(now.getTime() - 24 * 3600 * 1000);
  $('fromInput').value = toLocalInputValue(from);
  $('toInput').value = toLocalInputValue(now);
}

wireUi();
refreshAll().catch((err) => {
  console.error(err);
  if ($('kpiRow')) {
    $('kpiRow').innerHTML = `<div class="kpi fail"><div class="label">Error</div><div class="value" style="font-size:1rem">${err.message}</div></div>`;
  }
});

setInterval(() => {
  const route = getRoute();
  if (route.product !== 'imla') return;
  const active = document.querySelector('#view-imla .tab.active')?.dataset.tab;
  if (active === 'dashboard') loadDashboard().catch(console.error);
}, 30000);
