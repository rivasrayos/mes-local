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

  m = raw.match(/^\/line\/([^/]+)\/?$/i);
  if (m) return { product: 'imla', page: 'line', line: decodeURIComponent(m[1]), legacy: true };

  return { product: 'home', page: 'home', line: '' };
}

function goProductHome() { location.hash = '#/'; }
function goImlaHome() { location.hash = '#/imla'; }
function goEolHome() { location.hash = '#/eol'; }
function goImlaLine(line) { location.hash = `#/imla/line/${encodeURIComponent(line)}`; }
function goEolLine(line) { location.hash = `#/eol/line/${encodeURIComponent(line)}`; }

function ensureRoute() {
  const r = getRoute();
  if (r.legacy && r.line) {
    location.replace(`#/imla/line/${encodeURIComponent(r.line)}`);
    return false;
  }
  return true;
}

function showView(viewId) {
  ['view-home', 'view-imla', 'view-eol'].forEach((id) => {
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

function makeChart(id, config) {
  const ctx = $(id);
  if (!ctx) return;
  if (state.charts[id]) state.charts[id].destroy();
  state.charts[id] = new Chart(ctx, config);
}

function kpiItems(summary, { includeCarriers = true } = {}) {
  const items = [
    { label: 'Total', value: summary.total },
    { label: 'Pass', value: summary.passCount, cls: 'pass' },
    { label: 'Fail', value: summary.failCount, cls: 'fail' },
    { label: 'Pass rate', value: fmtPct(summary.passRate), cls: 'pass' },
    { label: 'Fail rate', value: fmtPct(summary.failRate), cls: 'fail' },
    { label: 'SN únicos', value: summary.uniqueSns },
  ];
  if (includeCarriers) items.push({ label: 'Carriers', value: summary.uniqueCarriers });
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

function renderImages(urls = []) {
  return (urls || []).map((u) => {
    const isEmbed = /\/embed\/capture\//i.test(u) || (!/\.(jpe?g|png|gif|webp|bmp)(\?|$)/i.test(u) && /capture_id=/i.test(u));
    const media = isEmbed
      ? `<iframe src="${u}" title="capture" loading="lazy" referrerpolicy="no-referrer"></iframe>`
      : `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="inspection image" loading="lazy" referrerpolicy="no-referrer" /></a>`;
    return `<figure class="img-card">${media}<figcaption><a href="${u}" target="_blank" rel="noopener">Abrir</a></figcaption></figure>`;
  }).join('') || '<span>—</span>';
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
    $('kpiRow').innerHTML = `<section class="line-kpi-block current"><div class="kpi-row nested">${renderKpiCards(data.summary)}</div></section>`;
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
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
    });
    makeChart('weldChart', {
      type: 'doughnut',
      data: {
        labels: data.weldingOnFail.map((w) => w.welding_position),
        datasets: [{ data: data.weldingOnFail.map((w) => w.count), backgroundColor: ['#0f6e7c', '#c45c26', '#b42318', '#5a6b78'] }],
      },
      options: { responsive: true, maintainAspectRatio: false },
    });
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
  $('drawer').classList.remove('hidden');
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
      <div class="kpi-row nested">${renderKpiCards(line, { includeCarriers: false })}</div>
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
    $('eolKpiRow').innerHTML = `<section class="line-kpi-block current"><div class="kpi-row nested">${renderKpiCards(data.summary, { includeCarriers: false })}</div></section>`;
    const labels = data.trend.map((t) => String(t.bucket).slice(5, 16).replace('T', ' '));
    makeChart('eolTrendChart', {
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
    makeChart('eolDefectChart', {
      type: 'bar',
      data: {
        labels: data.defects.map((d) => d.defect),
        datasets: [{ label: 'Count', data: data.defects.map((d) => d.count), backgroundColor: '#c45c26' }],
      },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } },
    });
    $('eolWindowMeta').textContent = `Línea ${route.line} · ${data.window.from} → ${data.window.to}`;
  } else {
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
  const extra = {
    sn: $('eolFSn').value.trim(),
    passFail: $('eolFPassFail').value,
    defectType: $('eolFDefect').value.trim(),
    stationName: $('eolFStation').value.trim(),
    stageName: $('eolFStage').value.trim(),
    limit: state.limit,
    offset: state.eolOffset,
  };
  const data = await api(`/api/eol/inspections?${eolQs(extra)}`);
  const tbody = document.querySelector('#eolInspTable tbody');
  tbody.innerHTML = data.items.map((item) => `
    <tr>
      <td>${item.inspectionTime || ''}</td>
      <td>${item.lineNumber || ''}</td>
      <td>${item.SN || ''}</td>
      <td>${item.stationName || ''}</td>
      <td>${item.stageName || ''}</td>
      <td><span class="badge ${(item.passFail || '').toLowerCase()}">${item.passFail || ''}</span></td>
      <td title="${item.defectType || ''}">${(item.defectType || '').slice(0, 40)}</td>
      <td><button class="btn" data-eol-id="${item.id}">Ver</button></td>
    </tr>
  `).join('');
  tbody.querySelectorAll('button[data-eol-id]').forEach((btn) => {
    btn.addEventListener('click', () => openEolDetail(btn.dataset.eolId));
  });
  $('eolPageInfo').textContent = `${data.offset + 1}–${Math.min(data.offset + data.limit, data.total)} de ${data.total}`;
  $('eolPrevPage').disabled = data.offset <= 0;
  $('eolNextPage').disabled = data.offset + data.limit >= data.total;
}

async function openEolDetail(id) {
  const item = await api(`/api/eol/inspections/${id}`);
  $('drawerBody').innerHTML = `
    <dl class="kv">
      <dt>id</dt><dd>${item.id}</dd>
      <dt>lineNumber</dt><dd>${item.lineNumber || ''}</dd>
      <dt>stationName</dt><dd>${item.stationName || ''}</dd>
      <dt>stageName</dt><dd>${item.stageName || ''}</dd>
      <dt>workStationCode</dt><dd>${item.workStationCode || ''}</dd>
      <dt>SN</dt><dd>${item.SN || ''}</dd>
      <dt>inspectionTime</dt><dd>${item.inspectionTime || ''}</dd>
      <dt>passFail</dt><dd>${item.passFail || ''}</dd>
      <dt>defectType</dt><dd>${item.defectType || ''}</dd>
      <dt>createdAt</dt><dd>${item.createdAt || ''}</dd>
    </dl>
    <h3>Imágenes</h3>
    <div class="img-grid">${renderImages(item.imageUrls)}</div>
  `;
  $('drawer').classList.remove('hidden');
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

  if (route.product === 'home') return;

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
      passFail: $('eolFPassFail').value,
      defectType: $('eolFDefect').value.trim(),
      stationName: $('eolFStation').value.trim(),
      stageName: $('eolFStage').value.trim(),
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
