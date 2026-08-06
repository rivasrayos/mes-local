/* global Chart */

const state = {
  offset: 0,
  limit: 50,
  charts: {},
};

const $ = (id) => document.getElementById(id);

function qs(extra = {}) {
  const params = new URLSearchParams();
  const line = $('lineSelect').value;
  const range = $('rangeSelect').value;

  if (line) params.set('lineNumber', line);

  if (range === 'custom') {
    const from = $('fromInput').value;
    const to = $('toInput').value;
    if (from) params.set('from', from.replace('T', ' ') + ':00');
    if (to) params.set('to', to.replace('T', ' ') + ':00');
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

function destroyCharts() {
  Object.values(state.charts).forEach((c) => c.destroy());
  state.charts = {};
}

function makeChart(id, config) {
  const ctx = $(id);
  if (!ctx) return;
  if (state.charts[id]) state.charts[id].destroy();
  state.charts[id] = new Chart(ctx, config);
}

async function loadLines() {
  const data = await api('/api/lines');
  const sel = $('lineSelect');
  const current = sel.value;
  sel.innerHTML = '<option value="">Todas (por línea)</option>';
  data.lines.forEach((line) => {
    const opt = document.createElement('option');
    opt.value = line;
    opt.textContent = line;
    sel.appendChild(opt);
  });
  sel.value = current;
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

function renderKpis(summary) {
  $('kpiRow').innerHTML = renderKpiCards(summary);
}

function renderKpisByLine(byLine = []) {
  if (!byLine.length) {
    $('kpiRow').innerHTML = '<div class="kpi"><div class="label">Sin datos</div><div class="value">0</div></div>';
    return;
  }

  const sorted = [...byLine].sort((a, b) =>
    String(a.lineNumber).localeCompare(String(b.lineNumber), undefined, { numeric: true })
  );

  $('kpiRow').innerHTML = sorted.map((line) => `
    <section class="line-kpi-block">
      <header class="line-kpi-header">
        <h3>${line.lineNumber}</h3>
        <button type="button" class="btn btn-line" data-line="${line.lineNumber}">Ver línea</button>
      </header>
      <div class="kpi-row nested">
        ${renderKpiCards(line)}
      </div>
    </section>
  `).join('');

  $('kpiRow').querySelectorAll('button[data-line]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('lineSelect').value = btn.dataset.line;
      refreshAll();
    });
  });
}

async function loadDashboard() {
  const selectedLine = $('lineSelect').value;
  const data = await api(`/api/dashboard?${qs()}`);

  if (selectedLine) {
    renderKpis(data.summary);
  } else {
    // No mezclar totales globales: una sección KPI por línea
    renderKpisByLine(data.byLine);
  }

  $('windowMeta').textContent = `Ventana: ${data.window.range}${data.window.shift ? ` (${data.window.shift})` : ''} · ${data.window.from} → ${data.window.to}${selectedLine ? ` · línea ${selectedLine}` : ' · KPIs por línea'}`;

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

  makeChart('lineChart', {
    type: 'bar',
    data: {
      labels: data.byLine.map((l) => l.lineNumber),
      datasets: [
        {
          label: 'Pass',
          data: data.byLine.map((l) => l.passCount != null
            ? l.passCount
            : Math.max(0, (l.total || 0) - (l.failCount || 0))),
          backgroundColor: '#0f6e7c',
          stack: 'line',
        },
        {
          label: 'Fail',
          data: data.byLine.map((l) => l.failCount || 0),
          backgroundColor: '#b42318',
          stack: 'line',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true },
      },
      plugins: { legend: { position: 'bottom' } },
    },
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

  document.querySelectorAll('.chart-block canvas').forEach((c) => {
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
  await loadLines();
  const active = document.querySelector('.tab.active')?.dataset.tab;
  if (active === 'inspections') await loadInspections();
  else await loadDashboard();
}

function wireUi() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', async () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      $(`tab-${tab.dataset.tab}`).classList.add('active');
      if (tab.dataset.tab === 'dashboard') await loadDashboard();
      if (tab.dataset.tab === 'inspections') await loadInspections();
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
        from: from.replace('T', ' ') + ':00',
        to: to.replace('T', ' ') + ':00',
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
  $('kpiRow').innerHTML = `<div class="kpi fail"><div class="label">Error</div><div class="value" style="font-size:1rem">${err.message}</div></div>`;
});

setInterval(() => {
  const active = document.querySelector('.tab.active')?.dataset.tab;
  if (active === 'dashboard') loadDashboard().catch(console.error);
}, 30000);
