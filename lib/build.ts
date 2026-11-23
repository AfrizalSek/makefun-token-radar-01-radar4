// radar-4 — board builder.
//
// Turns the snapshot into the ranked board and the dashboard payload:
// which protocols are rankable, the full ridge fit, its leave-one-out
// and walk-forward validation, the same validation for the kernel-median
// baseline, calibrated ranges, token-odds and verdicts per row.

import {
  ageDays,
  features,
  fitRidge,
  kernelMedianLogMult,
  leaveOneOut,
  median,
  normalCdf,
  parseSnap,
  quantile,
  walkForward,
} from './radar4.ts';
import type { BoardRow, Proto, RadarPayload, Snap } from './radar4.ts';
import { buildPlan } from './plan.ts';

const EXCLUDED_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

const EXCHANGE_PREFIXES = ['binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini'];

function firstWord(name: string): string {
  const words = name.toLowerCase().replace(/-/g, ' ').split(/\s+/).filter(Boolean);
  return words[0] ?? '';
}

function isVersioned(name: string): boolean {
  return /\s(v|V)?\d+(\.\d+)?$/.test(name);
}

function isRankable(p: Proto, liveFirstWords: Set<string>): boolean {
  if (p.mcap_usd !== null) return false;
  if (p.tvl_usd <= 0) return false;
  if (EXCLUDED_CATEGORIES.has(p.category ?? '')) return false;
  const words = (p.name ?? '').toLowerCase().split(/\s+/);
  if (words.includes('wrapped') || words.includes('staked') || words.includes('staking')) return false;
  if (isVersioned(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((x) => p.name.toLowerCase().startsWith(x))) return false;
  const fw = firstWord(p.name);
  if (fw !== '' && fw !== 'the' && fw !== 'a' && liveFirstWords.has(fw)) return false;
  return true;
}

export function buildRadar(snap: Snap): { board: BoardRow[]; payload: RadarPayload } {
  const watch = new Set(snap.watchlist);
  const liveFirstWords = new Set(
    snap.protocols.filter((p) => p.mcap_usd !== null).map((p) => firstWord(p.name)),
  );
  const comps = snap.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX',
  );
  const rankable = snap.protocols.filter((p) => isRankable(p, liveFirstWords));

  const fitted = fitRidge(comps, snap.as_of);
  const ridgePredict = (train: Proto[], p: Proto): number => fitRidge(train, snap.as_of).predictLogMult(p);
  const kernelPredict = (train: Proto[], p: Proto): number => kernelMedianLogMult(train, p, snap.as_of);

  const loo = leaveOneOut(comps, snap.as_of, ridgePredict);
  const looBase = leaveOneOut(comps, snap.as_of, kernelPredict);
  const wf = walkForward(comps, snap.as_of, ridgePredict, loo.q10, loo.q90);
  const wfBase = walkForward(comps, snap.as_of, kernelPredict, looBase.q10, looBase.q90);

  const residuals = loo.errors;
  const sigma = Math.sqrt(residuals.reduce((s, e) => s + e * e, 0) / Math.max(1, residuals.length));
  const medianLiveMultiple = median(comps.map((p) => p.mcap_usd! / p.tvl_usd));

  // Token-odds reference: the board's own median implied value, computed
  // after the fit. Odds = P(true implied value beats that median) under
  // the leave-one-out residual spread. A first version used the median
  // live *multiple* as the reference, but that made the biggest
  // protocols — top of the board on sheer size — read as "Weak", which
  // contradicts the ranking the odds are meant to summarise. The board
  // ranks by implied value, so the odds are about implied value too.
  const impliedAll = rankable.map((p) => p.tvl_usd * Math.max(0.01, Math.min(10, Math.exp(fitted.predictLogMult(p)))));
  const medianImplied = median(impliedAll);

  const categoryEffect: Record<string, number> = {};
  fitted.categories.forEach((c, i) => {
    categoryEffect[c] = fitted.beta[4 + i]!;
  });

  const sorted = [...rankable].sort((a, b) => b.tvl_usd - a.tvl_usd);
  const rows: BoardRow[] = sorted
    .map((p) => {
      const logMult = fitted.predictLogMult(p);
      const mult = Math.exp(logMult);
      const clamped = Math.max(0.01, Math.min(10, mult));
      const implied = Math.max(1, Math.round(p.tvl_usd * clamped));
      const low = Math.max(1, Math.round(p.tvl_usd * Math.max(0.01, Math.min(10, Math.exp(logMult + loo.q10)))));
      const high = Math.max(1, Math.round(p.tvl_usd * Math.max(0.01, Math.min(10, Math.exp(logMult + loo.q90)))));
      const odds = normalCdf((Math.log(implied) - Math.log(medianImplied)) / sigma);
      const verdict = odds >= 0.65 ? 'Strong' : odds >= 0.35 ? 'Watch' : 'Weak';
      const age = ageDays(p.listed_at, snap.as_of);
      const nearest = [...comps]
        .map((q) => ({ q, d: Math.abs(features(q, snap.as_of).lt - features(p, snap.as_of).lt) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 3)
        .map(({ q }) => ({ slug: q.slug, name: q.name, multiple: Math.round((q.mcap_usd! / q.tvl_usd) * 10000) / 10000 }));
      return {
        rank: 0,
        slug: p.slug,
        name: p.name,
        category: p.category ?? 'Unknown',
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        listed_at: p.listed_at,
        age_days: age,
        token_status: 'pre-token',
        implied_value_usd: implied,
        implied_low_usd: Math.min(low, implied),
        implied_high_usd: Math.max(high, implied),
        multiple: Math.round(clamped * 10000) / 10000,
        multiple_low: Math.round(Math.max(0.01, Math.min(10, Math.exp(logMult + loo.q10))) * 10000) / 10000,
        multiple_high: Math.round(Math.max(0.01, Math.min(10, Math.exp(logMult + loo.q90))) * 10000) / 10000,
        token_odds: Math.round(odds * 1000) / 1000,
        verdict,
        watchlist: watch.has(p.slug),
        nearest_comps: nearest,
        farm_steps: buildPlan(p, age, watch.has(p.slug)),
      };
    })
    .sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });

  const live = comps
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'Unknown',
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      multiple: Math.round((p.mcap_usd! / p.tvl_usd) * 10000) / 10000,
    }))
    .sort((a, b) => b.multiple - a.multiple);

  const payload: RadarPayload = {
    as_of: snap.as_of,
    floor_usd: snap.floor_usd,
    rows,
    watchlist_size: snap.watchlist.length,
    early_size: rows.filter((r) => !r.watchlist).length,
    live_shown: live.length,
    live_total: snap.protocols.filter((p) => p.mcap_usd !== null).length,
    live,
    model: {
      intercept: fitted.beta[0]!,
      slope: fitted.beta[1]!,
      lt_mean: fitted.ltMean,
      change_coef: fitted.beta[2]!,
      age_coef: fitted.beta[3]!,
      log_age_ref: Math.log(365),
      categories: fitted.categories,
      category_effect: categoryEffect,
      sigma_loo: sigma,
      q10: loo.q10,
      q90: loo.q90,
      median_live_multiple: medianLiveMultiple,
      median_implied_usd: Math.round(medianImplied),
      comps_n: comps.length,
    },
    validation: { loo: loo.validation, walk_forward: wf },
    baseline: { loo: looBase.validation, walk_forward: wfBase },
  };
  return { board: rows, payload };
}

export function boardProblem(board: BoardRow[], snap: Snap): string | null {
  if (board.length < 100) return `board holds ${board.length} rows, need at least 100`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `ranks are not exactly 1..${board.length}`;
  const sorted = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.implied_value_usd > sorted[i - 1]!.implied_value_usd) return 'implied value rises with rank';
  }
  const slugs = new Set(snap.protocols.map((p) => p.slug));
  for (const r of board) {
    if (!slugs.has(r.slug)) return `unknown slug ${r.slug}`;
    if (!r.name || r.implied_value_usd <= 0) return `row ${r.slug} is not well-formed`;
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `row ${r.slug} has ${r.farm_steps.length} farm steps`;
    }
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `row ${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  for (const slug of snap.watchlist) {
    if (!board.some((r) => r.slug === slug)) return `watchlist slug ${slug} is missing`;
  }
  return null;
}

export function dataScript(payload: RadarPayload): string {
  return `window.RADAR4_DATA = ${JSON.stringify(payload)};\n`;
}

export { parseSnap };
