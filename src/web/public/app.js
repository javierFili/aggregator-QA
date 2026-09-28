/* iGaming QA Runner — UI (vanilla JS + jQuery for Select2). */
(() => {
  'use strict';

  const $id = (id) => document.getElementById(id);
  const COMMON_CURRENCIES = ['EUR', 'USD', 'GBP', 'RON', 'BRL', 'BOB', 'ARS', 'CLP', 'COP', 'MXN', 'PEN', 'CAD', 'TRY', 'PLN', 'INR'];
  const PREFS_KEY = 'qa-runner-prefs'; // non-secret preferences only (never the API key)
  const STATE_LABEL = { idle: 'Inactivo', loading: 'Cargando catálogo…', running: 'En ejecución', stopping: 'DETENCIÓN SOLICITADA', finished: 'Finalizado', stopped: 'Detenido', failed: 'Error' };
  const STATE_CLASS = { idle: 'secondary', loading: 'info', running: 'primary', stopping: 'warning', finished: 'success', stopped: 'warning', failed: 'danger' };
  const STEP_LABEL = { session: 'creando sesión (1050)', 'http-launch': 'cadena HTTP', browser: 'navegador', currency: 'divisa', limits: 'límites', evidence: 'evidencias', idle: 'libre' };

  const state = { results: [], filter: 'ALL', search: '', run: null, detailModal: null };

  // ---------------------------------------------------------------- helpers
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const badgeClass = (s) => ({ PASS: 'success', FAIL: 'danger', REVIEW: 'warning', NOT_DETECTED: 'warning', SKIPPED: 'secondary', NOT_DECLARED: 'light' }[s] || 'secondary');
  const badge = (s, title) => `<span class="badge text-bg-${badgeClass(s)} status-badge" ${title ? `title="${esc(title)}"` : ''}>${esc(s)}</span>`;
  const duration = (ms) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
  const clock = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; };

  function showAlert(message) {
    if (/partner|launcher|Jugadores existentes|Prefijo|workers|Idioma/i.test(message || '')) $id('advanced').open = true;
    const el = $id('formAlert');
    el.textContent = message;
    el.classList.toggle('d-none', !message);
  }

  async function api(method, url, body) {
    const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  // ---------------------------------------------------------------- form
  function credentials() {
    return {
      aggregatorUrl: $id('aggregatorUrl').value.trim(),
      launcherUrl: $id('launcherUrl').value.trim(),
      partnerCode: $id('partnerCode').value.trim(),
      apiKey: $id('apiKey').value,
    };
  }

  function runConfig() {
    return {
      ...credentials(),
      currencies: $('#currencies').val() || [],
      lang: $id('lang').value,
      workers: Number($id('workers').value),
      expectedLimits: { min: $id('limitMin').value.trim(), default: $id('limitDefault').value.trim(), max: $id('limitMax').value.trim() },
      options: {
        browserCheck: $id('optBrowser').checked,
        testCurrencies: $id('optCurrencies').checked,
        testLimits: $id('optLimits').checked,
        screenshotsOnFailure: $id('optScreens').checked,
        screenshotsAll: $id('optScreensAll').checked,
        testUndeclaredCurrencies: $id('optUndeclared').checked,
        readyTimeout: $id('readyTimeout').value,
      },
      players: { prefix: $id('playerPrefix').value.trim(), existing: $id('existingPlayers').value },
      accessHeader: { name: $id('accessHeaderName').value.trim(), value: $id('accessHeaderValue').value },
      filters: { providers: $('#providers').val() || [], gameIds: $id('gameIds').value, maxGames: Number($id('maxGames').value) || 0 },
    };
  }

  const PREF_FIELDS = ['readyTimeout', 'aggregatorUrl', 'launcherUrl', 'partnerCode', 'playerPrefix', 'accessHeaderName', 'lang', 'workers', 'limitMin', 'limitDefault', 'limitMax', 'gameIds', 'maxGames'];
  const PREF_CHECKS = ['optBrowser', 'optCurrencies', 'optLimits', 'optScreens', 'optScreensAll', 'optUndeclared'];

  function savePrefs() {
    try {
      const prefs = { currencies: $('#currencies').val() || [] };
      for (const f of PREF_FIELDS) prefs[f] = $id(f).value;
      for (const c of PREF_CHECKS) prefs[c] = $id(c).checked;
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch { /* storage unavailable */ }
  }

  function loadPrefs() {
    try {
      const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      for (const f of PREF_FIELDS) if (prefs[f] !== undefined) $id(f).value = prefs[f];
      for (const c of PREF_CHECKS) if (prefs[c] !== undefined) $id(c).checked = !!prefs[c];
      return prefs;
    } catch {
      return {};
    }
  }

  function setCurrencyOptions(codes, selected) {
    const $sel = $('#currencies');
    const current = new Set(selected ?? $sel.val() ?? []);
    const all = [...new Set([...codes, ...current])];
    $sel.empty();
    for (const code of all) $sel.append(new Option(code, code, false, current.has(code)));
    $sel.trigger('change');
  }

  function initSelects(prefs) {
    $('#currencies').select2({
      theme: 'bootstrap-5',
      tags: true,
      width: '100%',
      placeholder: 'GBP, EUR, USD…',
      tokenSeparators: [',', ' ', ';'],
      createTag: (params) => {
        const term = String(params.term || '').trim().toUpperCase();
        return /^[A-Z]{3}$/.test(term) ? { id: term, text: term, newTag: true } : null;
      },
    });
    // normalise manual entries to upper case and drop duplicates
    $('#currencies').on('select2:select', (e) => {
      const id = String(e.params.data.id).toUpperCase();
      if (id !== e.params.data.id) {
        const values = ($('#currencies').val() || []).map((v) => v.toUpperCase());
        setCurrencyOptions([], [...new Set(values)]);
      }
      savePrefs();
    });
    $('#currencies').on('select2:unselect', savePrefs);
    setCurrencyOptions(COMMON_CURRENCIES, prefs.currencies || ['GBP', 'EUR', 'USD']);
    $('#providers').select2({ theme: 'bootstrap-5', width: '100%', placeholder: 'Todos los proveedores', allowClear: true });
  }

  // ---------------------------------------------------------------- actions
  async function loadGames() {
    showAlert('');
    const btn = $id('btnLoad');
    btn.disabled = true;
    btn.textContent = 'Cargando…';
    try {
      const { catalog } = await api('POST', '/api/catalog', credentials());
      state.sampleGameId = catalog.games[0]?.id;
      $id('statProviders').textContent = catalog.providers.length;
      $id('statGames').textContent = catalog.gameCount;
      const topCurrencies = Object.entries(catalog.currencies).sort((a, b) => b[1] - a[1]);
      const noCurrencies = catalog.gamesWithoutCurrencies ? ` · ⚠️ ${catalog.gamesWithoutCurrencies} juegos sin divisas en 1071 (se probarán igualmente)` : '';
      $id('catalogInfo').textContent = `Divisas en el catálogo: ${topCurrencies.slice(0, 12).map(([c, n]) => `${c} (${n})`).join(', ') || '— ninguna —'}${noCurrencies}`;
      setCurrencyOptions(topCurrencies.map(([c]) => c).concat(COMMON_CURRENCIES));
      const $prov = $('#providers');
      const selected = new Set($prov.val() || []);
      $prov.empty();
      for (const p of catalog.providers.sort((a, b) => a.name.localeCompare(b.name))) {
        $prov.append(new Option(`${p.name} (${p.games})`, p.code, false, selected.has(p.code)));
      }
      $prov.prop('disabled', false).trigger('change');
    } catch (err) {
      showAlert(`No se pudo cargar el catálogo: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = '2 · Cargar juegos';
    }
  }

  async function probeSession() {
    const btn = $id('btnProbe');
    const box = $id('probeResult');
    btn.disabled = true;
    btn.textContent = 'Probando…';
    try {
      const ids = $id('gameIds').value.split(/[,;\s]+/).filter(Boolean);
      const { probe } = await api('POST', '/api/session-test', { ...runConfig(), sampleGameId: ids[0] ?? state.sampleGameId });
      const allOk = probe.results.every((p) => p.ok);
      box.className = `small alert ${allOk ? 'alert-success' : 'alert-danger'} mb-0`;
      const rows = probe.results.map((r) => `<div>${r.ok ? '✅' : '❌'} <b>${esc(r.currency)}</b> · jugador <code>${esc(r.username)}</code>${r.source === 'existing' ? ' (existente)' : ''} — ${esc(r.response)}${r.assignedCurrency && r.assignedCurrency !== r.currency ? ` <span class="text-danger">⚠️ el agregador le asignó ${esc(r.assignedCurrency)}</span>` : ''}</div>`).join('');
      const mode = probe.launchMode && !probe.wafBlocked ? `<div class="mt-1 text-secondary">Launcher: ${probe.launchMode === 'front' ? '/front/launcher (sesiones de sitio)' : '/{partner}/launch (documentado)'}</div>` : '';
      const waf = probe.wafBlocked ? `<div class="mt-2 text-danger fw-semibold">⚠️ Cloudflare bloquea la apertura de juegos con su verificación anti-bot. Los juegos saldrán «Bloqueado por Cloudflare». Pide al equipo que permita a la herramienta (IP de este ordenador o «Cabecera de acceso» en Opciones avanzadas).</div>` : '';
      if (probe.wafBlocked) box.className = 'small alert alert-warning mb-0';
      box.innerHTML = `<div class="fw-semibold mb-1">${allOk ? 'Sesiones correctas' + (probe.wafBlocked ? '' : ': ya puedes cargar juegos e iniciar QA') : 'Hay problemas con la conexión'}</div>${rows}${mode}${waf}`;
    } catch (err) {
      box.className = 'small mt-2 alert alert-danger mb-0';
      box.textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = '1 · Probar conexión';
    }
  }

  async function startQa() {
    showAlert('');
    savePrefs();
    try {
      state.results = [];
      renderTable();
      const { run } = await api('POST', '/api/runs', runConfig());
      applySummary(run);
    } catch (err) {
      showAlert(`No se pudo iniciar: ${err.message}`);
    }
  }

  async function stopQa() {
    try {
      const { run } = await api('POST', '/api/runs/stop');
      applySummary(run);
    } catch (err) {
      showAlert(err.message);
    }
  }

  // ---------------------------------------------------------------- rendering
  function applySummary(run) {
    state.run = run;
    const badgeEl = $id('runState');
    const s = run ? run.state : 'idle';
    badgeEl.textContent = STATE_LABEL[s] || s;
    badgeEl.className = `badge text-bg-${STATE_CLASS[s] || 'secondary'}`;
    const active = run && ['loading', 'running', 'stopping'].includes(s);
    $id('btnStart').disabled = !!active;
    $id('btnLoad').disabled = !!active;
    $id('btnStop').disabled = !active || run.stopRequested;
    $id('btnExport').disabled = !run || run.testsCompleted === 0;
    if (!run) return;

    if (run.gamesDiscovered) $id('statGames').textContent = run.gamesDiscovered;
    if (run.providers?.length) $id('statProviders').textContent = run.providers.length;
    const pct = run.gamesQueued ? Math.round((run.gamesCompleted / run.gamesQueued) * 100) : 0;
    $id('progressText').textContent = `${run.gamesCompleted} / ${run.gamesQueued} juegos`;
    $id('progressBar').style.width = `${pct}%`;
    $id('progressBar').classList.toggle('progress-bar-striped', !!active);
    $id('progressBar').classList.toggle('progress-bar-animated', !!active);
    for (const k of ['PASS', 'FAIL', 'REVIEW', 'SKIPPED']) $id(`c${k}`).textContent = run.counters[k];
    $id('cTests').textContent = run.testsCompleted;
    $id('elapsed').textContent = `Tiempo: ${clock(run.durationMs)}`;
    $id('runDir').textContent = run.runDir ? `Evidencias: ${run.runDir}` : '';
    if (run.error) showAlert(`La ejecución falló: ${run.error}`);

    const workers = (run.workers || []).filter((w) => w.step && w.step !== 'idle');
    $id('workers').innerHTML = workers.length
      ? workers.map((w) => `<li class="list-group-item d-flex gap-2"><span class="badge text-bg-dark">Worker ${String(w.workerId).padStart(2, '0')}</span><span class="fw-semibold">${esc(w.gameName)}</span><span class="text-secondary">#${esc(w.gameId)} · ${esc(w.provider)} · ${esc(w.currency)}</span><span class="ms-auto text-secondary">${esc(STEP_LABEL[w.step] || w.step)}</span></li>`).join('')
      : `<li class="list-group-item text-secondary">${active ? (s === 'loading' ? 'Cargando proveedores y juegos…' : 'Esperando…') : 'Sin actividad.'}</li>`;
  }

  function matches(r) {
    if (state.filter !== 'ALL' && r.overall !== state.filter) return false;
    if (!state.search) return true;
    const q = state.search.toLowerCase();
    return [r.gameName, r.gameId, r.provider, r.currency].some((v) => String(v).toLowerCase().includes(q));
  }

  function limitBadge(c) {
    if (!c || c.status === 'SKIPPED') return badge('SKIPPED', c?.detail);
    const extra = c.detected !== undefined ? `<div class="small text-secondary">${esc(c.detected)}</div>` : '';
    return badge(c.status, c.detail) + extra;
  }

  function rowHtml(r, index) {
    return `<tr data-index="${index}">
      <td class="fw-semibold">${esc(r.gameName)}</td><td>${esc(r.gameId)}</td><td>${esc(r.provider)}</td>
      <td>${esc(r.currency)}${r.declared ? '' : ' <span class="badge text-bg-light border" title="No declarada en 1071">ND</span>'}</td>
      <td>${badge(r.launch.status, r.launch.detail)}</td><td>${badge(r.currencyCheck.status, r.currencyCheck.detail)}</td>
      <td>${limitBadge(r.minLimit)}</td><td>${limitBadge(r.defaultLimit)}</td><td>${limitBadge(r.maxLimit)}</td>
      <td>${badge(r.overall)}</td><td class="text-nowrap">${duration(r.durationMs)}</td>
      <td><button class="btn btn-sm btn-link p-0 detail" type="button">Detalle</button></td>
    </tr>`;
  }

  function renderTable() {
    const rows = [];
    let shown = 0;
    state.results.forEach((r, i) => {
      if (matches(r)) {
        rows.push(rowHtml(r, i));
        shown++;
      }
    });
    $id('results').innerHTML = rows.join('');
    $id('tableFooter').textContent = `${shown} de ${state.results.length} filas`;
  }

  function appendResult(r) {
    state.results.push(r);
    const i = state.results.length - 1;
    if (matches(r)) $id('results').insertAdjacentHTML('beforeend', rowHtml(r, i));
    const shown = $id('results').children.length;
    $id('tableFooter').textContent = `${shown} de ${state.results.length} filas`;
    $id('btnExport').disabled = false;
  }

  function showDetail(r) {
    $id('detailTitle').textContent = `${r.gameName} (#${r.gameId}) · ${r.provider} · ${r.currency}`;
    const checks = [['Lanzamiento', r.launch], ['Divisa', r.currencyCheck], ['Apuesta mínima', r.minLimit], ['Apuesta por defecto', r.defaultLimit], ['Apuesta máxima', r.maxLimit]];
    const errors = r.errors.length
      ? `<table class="table table-sm small"><thead><tr><th>Paso</th><th>Tipo</th><th>HTTP</th><th>URL</th><th>Descripción</th></tr></thead><tbody>${r.errors.map((e) => `<tr class="${e.warning ? 'table-warning' : 'table-danger'}"><td>${esc(e.step)}</td><td>${esc(e.type)}</td><td>${esc(e.httpStatus ?? '')}</td><td class="text-break">${esc(e.url ?? '')}</td><td class="text-break">${esc(e.description)}</td></tr>`).join('')}</tbody></table>`
      : '<p class="text-secondary">Sin errores.</p>';
    $id('detailBody').innerHTML = `
      <table class="table table-sm"><tbody>${checks.map(([label, c]) => `<tr><th class="w-25">${label}</th><td>${badge(c.status)}</td><td class="small">${esc(c.detail ?? '')}${c.source ? ` <span class="text-secondary">[${esc(c.source)}]</span>` : ''}</td></tr>`).join('')}
      <tr><th>Resultado</th><td>${badge(r.overall)}</td><td class="small">${duration(r.durationMs)} · ${esc(new Date(r.startedAt).toLocaleString())}</td></tr></tbody></table>
      <h6>Errores y avisos</h6>${errors}
      <div class="d-flex gap-3">
        ${r.diagnostics ? `<a class="btn btn-sm btn-outline-secondary" target="_blank" href="/api/evidence/${r.diagnostics}">Diagnóstico JSON</a>` : ''}
        ${r.screenshot ? `<a class="btn btn-sm btn-outline-secondary" target="_blank" href="/api/evidence/${r.screenshot}">Abrir captura</a>` : ''}
      </div>
      ${r.screenshot ? `<img class="img-fluid border mt-3" alt="captura" src="/api/evidence/${r.screenshot}">` : ''}`;
    state.detailModal.show();
  }

  function appendLog(entry) {
    const el = $id('log');
    const line = `${entry.time.slice(11, 19)} [${entry.level.toUpperCase()}]${entry.scope ? ` [${entry.scope}]` : ''} ${entry.message}\n`;
    el.textContent += line;
    if (el.textContent.length > 60000) el.textContent = el.textContent.slice(-50000);
    el.scrollTop = el.scrollHeight;
  }

  // ---------------------------------------------------------------- fake wallet status
  async function refreshWallet() {
    try {
      const w = await api('GET', '/api/wallet');
      if (!w.enabled) return;
      $id('walletCard').classList.remove('d-none');
      const per = Object.entries(w.balances || {}).map(([c, v]) => `${c} ${v}`).join(' · ');
      $id('walletInfo').textContent = `Activo en ${location.origin}${w.path} · saldo ${per || w.defaultBalance}`;
      const calls = Object.entries(w.stats.calls || {});
      $id('walletCalls').innerHTML = calls.length
        ? `✅ El agregador lo está usando: ${calls.map(([k, n]) => `${esc(k)} ${n}`).join(' · ')} <span class="text-secondary">(última ${esc(new Date(w.stats.lastCallAt).toLocaleTimeString())})</span>`
        : '<span class="text-secondary">Aún no ha recibido llamadas del agregador</span>';
    } catch { /* ignore */ }
  }

  // ---------------------------------------------------------------- live updates (SSE)
  function connect() {
    const source = new EventSource('/api/events');
    source.addEventListener('snapshot', (e) => {
      const data = JSON.parse(e.data);
      state.results = data.results || [];
      renderTable();
      applySummary(data.run);
    });
    source.addEventListener('state', (e) => applySummary(JSON.parse(e.data)));
    source.addEventListener('progress', (e) => applySummary(JSON.parse(e.data)));
    source.addEventListener('result', (e) => appendResult(JSON.parse(e.data)));
    source.addEventListener('log', (e) => appendLog(JSON.parse(e.data)));
  }

  // ---------------------------------------------------------------- boot
  document.addEventListener('DOMContentLoaded', async () => {
    const prefs = loadPrefs();
    initSelects(prefs);
    state.detailModal = new bootstrap.Modal($id('detailModal'));
    try {
      const settings = await api('GET', '/api/settings');
      $id('workers').max = settings.maxWorkers;
      if (!prefs.readyTimeout && settings.readyTimeoutMs !== undefined) $id('readyTimeout').value = Math.round(settings.readyTimeoutMs / 1000);
      if (!prefs.workers) $id('workers').value = settings.defaultWorkers;
    } catch { /* ignore */ }

    const preview = () => {
      const prefix = $id('playerPrefix').value.trim() || 'qa-runner';
      const currencies = ($('#currencies').val() || ['EUR', 'USD']).slice(0, 3);
      $id('playerPreview').textContent = currencies.map((c) => `${prefix}-${c.toLowerCase()}-w01`).join(', ');
    };
    $('#currencies').on('change', preview);
    $id('playerPrefix').addEventListener('input', preview);
    preview();
    $id('btnLoad').addEventListener('click', loadGames);
    $id('btnProbe').addEventListener('click', probeSession);
    $id('btnStart').addEventListener('click', startQa);
    $id('btnStop').addEventListener('click', stopQa);
    $id('btnExport').addEventListener('click', () => { window.location.href = '/api/report'; });
    $id('configForm').addEventListener('change', savePrefs);
    $id('filters').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-filter]');
      if (!btn) return;
      state.filter = btn.dataset.filter;
      for (const b of $id('filters').querySelectorAll('button')) b.classList.toggle('active', b === btn);
      renderTable();
    });
    $id('search').addEventListener('input', (e) => { state.search = e.target.value.trim(); renderTable(); });
    $id('results').addEventListener('click', (e) => {
      const btn = e.target.closest('button.detail');
      if (!btn) return;
      const r = state.results[Number(btn.closest('tr').dataset.index)];
      if (r) showDetail(r);
    });
    connect();
    refreshWallet();
    setInterval(refreshWallet, 5000);
  });
})();
