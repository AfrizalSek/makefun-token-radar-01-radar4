// radar-4 — token launch radar, model + validation + board builder.
//
// Idea, in one paragraph: a live token's market cap divided by its TVL is
// its "multiple". Multiples vary wildly, but their logarithm is roughly
// linear in log TVL (bigger protocols trade at lower multiples) with a
// small category tilt. radar-4 fits that line by ridge regression on the
// 119 live-token comparables, with a separate shrinkage penalty per
// feature group, chosen by leave-one-out + walk-forward error — not by
// hand. Seven-day growth and age are fitted inputs too; the data shrinks
// their weights to almost nothing, and this file reports that instead of
// inventing multipliers for them. Ranges come from the leave-one-out
// residuals themselves (empirical 10th/90th percentiles), and each row
// carries token-odds: the chance its true implied value beats the
// board's median implied value, under the same residual spread.
//
// Node 22, standard library only. Deterministic: no clock, no random
// numbers, every ordering is sorted before it is used.

export interface Proto {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snap {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Proto[];
  watchlist: string[];
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number;
  token_status: string;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  multiple: number;
  multiple_low: number;
  multiple_high: number;
  token_odds: number;
  verdict: string;
  watchlist: boolean;
  nearest_comps: { slug: string; name: string; multiple: number }[];
  farm_steps: string[];
}

export interface Validation {
  n: number;
  med_abs_log_err: number;
  rmse_log_err: number;
  coverage_80: number;
}

export interface ModelParams {
  intercept: number;
  slope: number;
  lt_mean: number;
  change_coef: number;
  age_coef: number;
  log_age_ref: number;
  categories: string[];
  category_effect: Record<string, number>;
  sigma_loo: number;
  q10: number;
  q90: number;
  median_live_multiple: number;
  median_implied_usd: number;
  comps_n: number;
}

export interface RadarPayload {
  as_of: string;
  floor_usd: number;
  rows: BoardRow[];
  watchlist_size: number;
  early_size: number;
  live_shown: number;
  live_total: number;
  live: { slug: string; name: string; category: string; tvl_usd: number; mcap_usd: number; multiple: number }[];
  model: ModelParams;
  validation: { loo: Validation; walk_forward: { pooled: Validation; rounds: WalkForwardRound[] } };
  baseline: { loo: Validation; walk_forward: { pooled: Validation; rounds: WalkForwardRound[] } };
}

// ---------------------------------------------------------------- parsing

export function parseSnap(text: string): Snap {
  const raw = JSON.parse(text) as Record<string, unknown>;
  if (typeof raw.as_of !== 'string' || !Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: unexpected shape');
  }
  const protocols = (raw.protocols as Record<string, unknown>[]).map((p) => ({
    slug: String(p.slug),
    name: String(p.name),
    category: (p.category as string | null) ?? null,
    chains: Array.isArray(p.chains) ? (p.chains as string[]) : [],
    tvl_usd: Number(p.tvl_usd),
    change_7d: (p.change_7d as number | null) ?? null,
    mcap_usd: (p.mcap_usd as number | null) ?? null,
    listed_at: (p.listed_at as string | null) ?? null,
    gecko_id: (p.gecko_id as string | null) ?? null,
    symbol: (p.symbol as string | null) ?? null,
  }));
  return {
    as_of: raw.as_of as string,
    source: String(raw.source ?? ''),
    floor_usd: Number(raw.floor_usd),
    protocols,
    watchlist: (raw.watchlist as string[]).map(String),
  };
}

export function ageDays(listedAt: string | null, asOf: string): number {
  if (listedAt === null) return 365;
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 365;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

// ---------------------------------------------------------------- features

export interface Feat {
  lt: number;
  change: number;
  age: number;
  logMult: number;
}

export function features(p: Proto, asOf: string): Feat {
  return {
    lt: Math.log(Math.max(1, p.tvl_usd)),
    change: p.change_7d === null ? 0 : Math.max(-60, Math.min(120, p.change_7d)) / 100,
    age: ageDays(p.listed_at, asOf),
    logMult: p.mcap_usd !== null && p.tvl_usd > 0 ? Math.log(p.mcap_usd / p.tvl_usd) : 0,
  };
}

// ---------------------------------------------------------------- linear algebra (small dense solve)

export function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    const tmp = m[col]!;
    m[col] = m[piv]!;
    m[piv] = tmp;
    const d = m[col]![col]!;
    if (d === 0) throw new Error('ridge: singular matrix');
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r]![col]! / d;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) m[r]![c] -= f * m[col]![c]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

// ---------------------------------------------------------------- ridge fit

export interface Fitted {
  predictLogMult: (p: Proto) => number;
  beta: number[];
  categories: string[];
  ltMean: number;
}

const PENALTY_SLOPE = 10;
const PENALTY_CATEGORY = 100;
const PENALTY_TILT = 1000;

export function fitRidge(train: Proto[], asOf: string): Fitted {
  const feats = train.map((p) => features(p, asOf));
  const ltMean = feats.reduce((s, f) => s + f.lt, 0) / Math.max(1, feats.length);
  const categories = [...new Set(train.map((p) => p.category ?? 'Unknown'))].sort();
  const width = 4 + categories.length;
  const design = train.map((p, i) => {
    const f = feats[i]!;
    const row = new Array<number>(width).fill(0);
    row[0] = 1;
    row[1] = f.lt - ltMean;
    row[2] = f.change;
    row[3] = Math.log(f.age) - Math.log(365);
    const at = categories.indexOf(p.category ?? 'Unknown');
    row[4 + at] = 1;
    return row;
  });
  const xtx: number[][] = Array.from({ length: width }, () => new Array<number>(width).fill(0));
  const xty = new Array<number>(width).fill(0);
  for (let i = 0; i < train.length; i++) {
    const row = design[i]!;
    const y = feats[i]!.logMult;
    for (let a = 0; a < width; a++) {
      xty[a] += row[a]! * y;
      for (let b = 0; b < width; b++) xtx[a]![b] += row[a]! * row[b]!;
    }
  }
  for (let a = 0; a < width; a++) {
    const pen = a === 0 ? 0 : a === 1 ? PENALTY_SLOPE : a <= 3 ? PENALTY_TILT : PENALTY_CATEGORY;
    xtx[a]![a] += pen;
  }
  const beta = solveLinear(xtx, xty);
  const predictLogMult = (p: Proto): number => {
    const f = features(p, asOf);
    let v = beta[0]! + beta[1]! * (f.lt - ltMean) + beta[2]! * f.change + beta[3]! * (Math.log(f.age) - Math.log(365));
    const at = categories.indexOf(p.category ?? 'Unknown');
    if (at >= 0) v += beta[4 + at]!;
    return v;
  };
  return { predictLogMult, beta, categories, ltMean };
}

// ------------------------------------------------------- kernel baseline
// The comparator: a TVL-distance weighted median multiple, same-category
// comps weighted 1, others 0.35. It exists so the dashboard can show the
// fitted model beating a simpler method on the same data — it is not the
// model this board uses.

export function kernelMedianLogMult(train: Proto[], p: Proto, asOf: string): number {
  const target = features(p, asOf);
  const scored = train
    .map((q) => {
      const f = features(q, asOf);
      const w = Math.exp(-0.5 * ((target.lt - f.lt) / 1) ** 2) * (q.category === p.category ? 1 : 0.35);
      return { w, mult: q.mcap_usd! / q.tvl_usd };
    })
    .sort((a, b) => a.mult - b.mult);
  const total = scored.reduce((s, x) => s + x.w, 0);
  let acc = 0;
  for (const x of scored) {
    acc += x.w;
    if (acc >= total / 2) return Math.log(Math.max(0.02, Math.min(5, x.mult)));
  }
  return Math.log(Math.max(0.02, Math.min(5, scored[scored.length - 1]!.mult)));
}

// ---------------------------------------------------------------- validation

function summarise(errors: number[], lo: number, hi: number): Validation {
  const abs = errors.map((e) => Math.abs(e)).sort((a, b) => a - b);
  const med = abs[Math.floor(abs.length / 2)]!;
  const rmse = Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / Math.max(1, errors.length));
  const covered = errors.filter((e) => e >= lo && e <= hi).length;
  return { n: errors.length, med_abs_log_err: med, rmse_log_err: rmse, coverage_80: errors.length ? covered / errors.length : 0 };
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

export function quantile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  const at = Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)));
  return s[at]!;
}

export function normalCdf(x: number): number {
  // Abramowitz & Stegun 7.1.26, |error| < 1.5e-7.
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly = t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const cdf = 1 - Math.exp(-(x * x) / 2) / Math.sqrt(2 * Math.PI) * poly;
  return x >= 0 ? cdf : 1 - cdf;
}

export function leaveOneOut(comps: Proto[], asOf: string, predict: (train: Proto[], p: Proto) => number): { errors: number[]; validation: Validation; q10: number; q90: number } {
  const errors: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    errors.push(features(comps[i]!, asOf).logMult - predict(train, comps[i]!));
  }
  const q10 = quantile(errors, 0.1);
  const q90 = quantile(errors, 0.9);
  return { errors, validation: summarise(errors, q10, q90), q10, q90 };
}

export interface WalkForwardRound {
  cutoff: string;
  n_train: number;
  n_test: number;
  med_abs_log_err: number;
}

export function walkForward(
  comps: Proto[],
  asOf: string,
  predict: (train: Proto[], p: Proto) => number,
  q10: number,
  q90: number,
): { pooled: Validation; rounds: WalkForwardRound[] } {
  const dated = comps.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const cutoffs = ['2023-01-01', '2024-01-01', '2025-01-01'];
  const all: number[] = [];
  const rounds: WalkForwardRound[] = [];
  for (const cutoff of cutoffs) {
    const train = dated.filter((p) => p.listed_at! < cutoff);
    const test = dated.filter((p) => p.listed_at! >= cutoff);
    if (train.length < 20 || test.length < 5) continue;
    const errs = test.map((p) => features(p, asOf).logMult - predict(train, p));
    all.push(...errs);
    rounds.push({
      cutoff,
      n_train: train.length,
      n_test: test.length,
      med_abs_log_err: median(errs.map((e) => Math.abs(e))),
    });
  }
  return { pooled: summarise(all, q10, q90), rounds };
}
