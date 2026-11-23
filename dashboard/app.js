// radar-4 dashboard: board, live comparables, method. No network.
(function () {
  const D = window.RADAR4_DATA;
  if (!D) return;
  const rows = D.rows;
  const model = D.model;

  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) { return (n * 100).toFixed(1) + '%'; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  // ---- KPIs
  document.getElementById('asof').textContent =
    'Snapshot ' + D.as_of + ' · floor ' + money(D.floor_usd) + ' · ' + model.comps_n + ' live comparables';
  const kpis = [
    [rows.length, 'protocols ranked'],
    [D.watchlist_size + ' / ' + D.watchlist_size, 'watchlist covered'],
    [D.validation.loo.med_abs_log_err.toFixed(2), 'LOO median |log error|'],
    [D.validation.walk_forward.pooled.med_abs_log_err.toFixed(2), 'walk-forward median |log error|'],
    [pct(D.validation.loo.coverage_80), 'LOO 80% range coverage'],
    [rows.filter((r) => r.verdict === 'Strong').length + ' Strong', 'verdicts: ' + rows.filter((r) => r.verdict === 'Watch').length + ' Watch, ' + rows.filter((r) => r.verdict === 'Weak').length + ' Weak'],
  ];
  document.getElementById('kpis').innerHTML = kpis
    .map(([b, s]) => '<div class="kpi"><b>' + b + '</b><span>' + s + '</span></div>')
    .join('');

  // ---- tabs
  document.querySelectorAll('.tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tabpage').forEach((p) => p.classList.add('hidden'));
      document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
    });
  });

  // ---- board: filter + sort
  const catSel = document.getElementById('category');
  [...new Set(rows.map((r) => r.category))].sort().forEach((c) => {
    const o = document.createElement('option');
    o.textContent = c;
    catSel.appendChild(o);
  });
  let sortKey = 'rank';
  let sortDir = 1;
  function filtered() {
    const q = document.getElementById('q').value.trim().toLowerCase();
    const v = document.getElementById('verdict').value;
    const c = catSel.value;
    const w = document.getElementById('watchonly').checked;
    return rows.filter((r) => {
      if (q && !(r.name.toLowerCase().includes(q) || r.slug.includes(q))) return false;
      if (v && r.verdict !== v) return false;
      if (c && r.category !== c) return false;
      if (w && !r.watchlist) return false;
      return true;
    });
  }
  function renderBoard() {
    const list = filtered().sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortDir;
      return String(av).localeCompare(String(bv)) * sortDir;
    });
    document.getElementById('count').textContent = list.length + ' rows shown';
    document.getElementById('rows').innerHTML = list
      .map((r) => {
        return (
          '<tr data-slug="' + r.slug + '">' +
          '<td>' + r.rank + '</td>' +
          '<td>' + esc(r.name) + (r.watchlist ? ' <span class="watch">●</span>' : '') + '<br><span style="color:#6a736c;font-size:11px">' + esc(r.slug) + '</span></td>' +
          '<td>' + esc(r.category) + '</td>' +
          '<td class="num">' + money(r.tvl_usd) + '</td>' +
          '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
          '<td class="num">' + money(r.implied_low_usd) + ' – ' + money(r.implied_high_usd) + '</td>' +
          '<td class="num">' + pct(r.token_odds) + '</td>' +
          '<td><span class="verdict ' + r.verdict + '">' + r.verdict + '</span></td>' +
          '</tr>'
        );
      })
      .join('');
  }
  document.querySelectorAll('#board th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const k = th.dataset.sort;
      if (sortKey === k) sortDir = -sortDir;
      else { sortKey = k; sortDir = 1; }
      renderBoard();
    });
  });
  ['q', 'verdict', 'category', 'watchonly'].forEach((id) => {
    document.getElementById(id).addEventListener('input', renderBoard);
  });
  renderBoard();

  // ---- detail drawer (event delegation: rows are repainted)
  function recompute(r) {
    const ch = r.change_7d === null ? 0 : Math.max(-60, Math.min(120, r.change_7d)) / 100;
    const logMult =
      model.intercept +
      model.slope * (Math.log(r.tvl_usd) - model.lt_mean) +
      model.change_coef * ch +
      model.age_coef * (Math.log(r.age_days) - model.log_age_ref) +
      (model.category_effect[r.category] || 0);
    const mult = Math.max(0.01, Math.min(10, Math.exp(logMult)));
    return { logMult, implied: Math.max(1, Math.round(r.tvl_usd * mult)) };
  }
  document.getElementById('rows').addEventListener('click', (ev) => {
    const tr = ev.target.closest('tr[data-slug]');
    if (!tr) return;
    const r = rows.find((x) => x.slug === tr.dataset.slug);
    if (!r) return;
    const rc = recompute(r);
    const same = Math.abs(rc.implied - r.implied_value_usd) <= Math.max(1, r.implied_value_usd * 0.001);
    const lo = Math.log(r.implied_low_usd);
    const hi = Math.log(r.implied_high_usd);
    const at = ((Math.log(r.implied_value_usd) - lo) / (hi - lo)) * 100;
    const chains = r.chains.length > 5 ? r.chains.slice(0, 5).join(', ') + ' + ' + (r.chains.length - 5) + ' more' : r.chains.join(', ');
    document.getElementById('detail').innerHTML =
      '<h2>' + esc(r.name) + '</h2>' +
      '<p>Rank ' + r.rank + ' · ' + esc(r.category) + ' · ' + esc(chains) + (r.watchlist ? ' · <span class="watch">on the watchlist</span>' : ' · early find') + '</p>' +
      '<div class="detail-kv">' +
      '<div><span>TVL</span><b>' + money(r.tvl_usd) + '</b></div>' +
      '<div><span>7-day TVL change</span><b>' + (r.change_7d === null ? 'not reported' : r.change_7d.toFixed(1) + '%') + '</b></div>' +
      '<div><span>Implied value</span><b>' + money(r.implied_value_usd) + '</b></div>' +
      '<div><span>Fitted multiple</span><b>' + r.multiple + '×</b></div>' +
      '<div><span>Token odds</span><b>' + pct(r.token_odds) + '</b></div>' +
      '<div><span>Verdict</span><b>' + r.verdict + '</b></div>' +
      '</div>' +
      '<p>80% range ' + money(r.implied_low_usd) + ' – ' + money(r.implied_high_usd) + '</p>' +
      '<div class="rangebar"><i style="left:' + at.toFixed(1) + '%"></i></div>' +
      '<p class="recompute ' + (same ? 'ok' : '') + '">Recomputed from the fitted model: ' + money(rc.implied) +
      (same ? ' — the same number the board carries.' : ' — differs from the board number; treat the board with caution.') + '</p>' +
      '<p>Token odds is the chance the true implied value beats the board’s median implied value (' + money(model.median_implied_usd) +
      '), under the leave-one-out residual spread. Verdict: Strong at 65% or more, Watch from 35%, Weak below.</p>' +
      '<h2>Nearest live comparables</h2>' +
      '<p>' + r.nearest_comps.map((c) => esc(c.name) + ' ' + c.multiple + '×').join(' · ') + '</p>' +
      '<h2>Farm plan</h2><ol class="steps">' +
      r.farm_steps.map((s) => '<li>' + esc(s) + '</li>').join('') +
      '</ol>';
    document.getElementById('drawer').classList.remove('hidden');
  });
  document.getElementById('close').addEventListener('click', () => {
    document.getElementById('drawer').classList.add('hidden');
  });

  // ---- live tab
  document.getElementById('liverows').innerHTML = D.live
    .map((p) => '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.category) + '</td><td class="num">' + money(p.tvl_usd) + '</td><td class="num">' + money(p.mcap_usd) + '</td><td class="num">' + p.multiple + '×</td></tr>')
    .join('');
  document.getElementById('livecount').textContent =
    D.live_shown + ' of ' + D.live_total + ' live protocols shown (exchanges excluded). Median live multiple ' + model.median_live_multiple.toFixed(3) + '×.';

  // ---- method tab
  const m = model;
  document.getElementById('formula').innerHTML =
    'log(multiple) = <code>' + m.intercept.toFixed(3) + '</code> + <code>' + m.slope.toFixed(3) + '</code> × (ln TVL − ' + m.lt_mean.toFixed(2) + ')' +
    ' + <code>' + m.change_coef.toFixed(4) + '</code> × clipped 7-day change' +
    ' + <code>' + m.age_coef.toFixed(4) + '</code> × (ln age − ln 365)' +
    ' + category effect (shrunk, largest ' + Math.max(...Object.values(m.category_effect)).toFixed(3) + ', smallest ' + Math.min(...Object.values(m.category_effect)).toFixed(3) + ').<br>' +
    'Implied value = TVL × exp(log multiple), clamped to 0.01×–10×. Range = prediction × exp(' + m.q10.toFixed(2) + ') to × exp(' + m.q90.toFixed(2) + '), the 10th and 90th percentiles of the leave-one-out residuals. ' +
    'Residual spread σ = ' + m.sigma_loo.toFixed(2) + ' in log points.';
  const v = D.validation;
  const b = D.baseline;
  const wfRows = v.walk_forward.rounds
    .map((r, i) => {
      const br = b.walk_forward.rounds[i];
      return '<tr><td>Walk-forward, listed after ' + r.cutoff + ' (train ' + r.n_train + ', test ' + r.n_test + ')</td><td>' + r.med_abs_log_err.toFixed(4) + '</td><td>' + (br ? br.med_abs_log_err.toFixed(4) : '—') + '</td></tr>';
    })
    .join('');
  document.getElementById('validrows').innerHTML =
    '<tr><td>Leave-one-out, median |log error| (n = ' + v.loo.n + ')</td><td>' + v.loo.med_abs_log_err.toFixed(4) + '</td><td>' + b.loo.med_abs_log_err.toFixed(4) + '</td></tr>' +
    '<tr><td>Leave-one-out, RMSE log error</td><td>' + v.loo.rmse_log_err.toFixed(4) + '</td><td>' + b.loo.rmse_log_err.toFixed(4) + '</td></tr>' +
    '<tr><td>Leave-one-out, 80% range coverage</td><td>' + pct(v.loo.coverage_80) + '</td><td>' + pct(b.loo.coverage_80) + '</td></tr>' +
    '<tr><td>Walk-forward pooled, median |log error|</td><td>' + v.walk_forward.pooled.med_abs_log_err.toFixed(4) + '</td><td>' + b.walk_forward.pooled.med_abs_log_err.toFixed(4) + '</td></tr>' +
    '<tr><td>Walk-forward pooled, 80% range coverage</td><td>' + pct(v.walk_forward.pooled.coverage_80) + '</td><td>' + pct(b.walk_forward.pooled.coverage_80) + '</td></tr>' +
    wfRows;

  // Deep links, so a state of the page can be opened directly:
  // #filter=watchlist filters to the watchlist, #row=<slug> opens a row.
  (function deepLink() {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (hash.get('filter') === 'watchlist') {
      document.getElementById('watchonly').checked = true;
      renderBoard();
    }
    const slug = hash.get('row');
    if (slug) {
      const tr = document.querySelector('#rows tr[data-slug="' + slug + '"]');
      if (tr) tr.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  })();
})();
