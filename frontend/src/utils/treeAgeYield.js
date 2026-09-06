/**
 * Tree-age yield reference — the browser-side mirror of
 * `backend/utils/constants.js`. Both copies must carry the same numbers.
 *
 * The backend remains authoritative: every figure stored on a survey is
 * computed server-side. This copy exists only so forms and review screens can
 * show the expected figure live, without a round trip per keystroke.
 */

export const TREE_AGE_BRACKETS = [
  { key: '1-3',   label: '1–3 years',   kgPerTree: 0,   minKg: 0,   maxKg: 0,   note: 'Not yet bearing' },
  { key: '4-5',   label: '4–5 years',   kgPerTree: 10,  minKg: 0,   maxKg: 20,  note: 'First fruiting' },
  { key: '6-10',  label: '6–10 years',  kgPerTree: 65,  minKg: 20,  maxKg: 115, note: 'Building yield' },
  { key: '11-15', label: '11–15 years', kgPerTree: 125, minKg: 110, maxKg: 140, note: 'Peak yield' },
  { key: '16-25', label: '16–25 years', kgPerTree: 100, minKg: 85,  maxKg: 115, note: 'Steady' },
  { key: '26-40', label: '26–40 years', kgPerTree: 150, minKg: 100, maxKg: 200, note: 'Large mature trees' },
  { key: '40+',   label: '40+ years',   kgPerTree: 125, minKg: 100, maxKg: 150, note: 'Declining / variable' },
];

export const TREE_AGE_KEYS = TREE_AGE_BRACKETS.map((b) => b.key);

const BRACKET_BY_KEY = TREE_AGE_BRACKETS.reduce((acc, b) => ({ ...acc, [b.key]: b }), {});

export const getBracket = (key) => BRACKET_BY_KEY[key] || null;

/**
 * Surveys store the distribution as [{ ageRange, numberOfTrees }], farms store
 * it as { '1-3': n, ... }, and the survey form holds it as strings. All three
 * collapse to { key: number } here.
 */
export const normalizeTreeAgeDistribution = (input) => {
  const out = TREE_AGE_KEYS.reduce((acc, key) => ({ ...acc, [key]: 0 }), {});
  if (!input) return out;

  if (Array.isArray(input)) {
    input.forEach((entry) => {
      const key = entry?.ageRange;
      if (key in out) out[key] += Number(entry.numberOfTrees) || 0;
    });
    return out;
  }

  TREE_AGE_KEYS.forEach((key) => {
    out[key] = Number(input[key]) || 0;
  });
  return out;
};

export const countTrees = (distribution) =>
  Object.values(normalizeTreeAgeDistribution(distribution)).reduce((sum, n) => sum + n, 0);

export const countBearingTrees = (distribution) => {
  const dist = normalizeTreeAgeDistribution(distribution);
  return TREE_AGE_BRACKETS.reduce((sum, b) => (b.kgPerTree > 0 ? sum + dist[b.key] : sum), 0);
};

export const calculateExpectedProduction = (distribution) => {
  const dist = normalizeTreeAgeDistribution(distribution);

  let expectedKg = 0;
  let minKg = 0;
  let maxKg = 0;

  TREE_AGE_BRACKETS.forEach((b) => {
    expectedKg += dist[b.key] * b.kgPerTree;
    minKg += dist[b.key] * b.minKg;
    maxKg += dist[b.key] * b.maxKg;
  });

  return {
    expectedKg: Math.round(expectedKg),
    minKg: Math.round(minKg),
    maxKg: Math.round(maxKg),
    totalTrees: countTrees(dist),
    bearingTrees: countBearingTrees(dist),
    perBracket: TREE_AGE_BRACKETS.map((b) => ({
      ...b,
      trees: dist[b.key],
      expectedKg: Math.round(dist[b.key] * b.kgPerTree),
    })),
  };
};

// ---------------------------------------------------------------------------
// Yield-gap review
// ---------------------------------------------------------------------------

export const YIELD_REVIEW_THRESHOLDS = { ok: 25, review: 50 };

export const YIELD_FLAGS = {
  NO_DATA: 'no-data',
  NO_BEARING: 'no-bearing',
  OK: 'ok',
  REVIEW: 'review',
  OUTLIER: 'outlier',
};

export const YIELD_FLAG_LABELS = {
  [YIELD_FLAGS.NO_DATA]: 'No tree ages recorded',
  [YIELD_FLAGS.NO_BEARING]: 'No bearing trees yet',
  [YIELD_FLAGS.OK]: 'Consistent with tree ages',
  [YIELD_FLAGS.REVIEW]: 'Worth checking',
  [YIELD_FLAGS.OUTLIER]: 'Large discrepancy',
};

/**
 * `treesRecorded` separates a survey with no tree ages filled in (nothing to
 * check against) from a genuinely young orchard where nothing bears yet.
 */
export const calculateYieldGap = (expectedKg, reportedKg, treesRecorded = null) => {
  const expected = Number(expectedKg) || 0;
  const reported = Number(reportedKg) || 0;

  if (expected <= 0) {
    const noAgesRecorded = treesRecorded !== null ? Number(treesRecorded) <= 0 : reported <= 0;
    return {
      expectedKg: expected,
      reportedKg: reported,
      gapKg: 0,
      gapPercent: null,
      flag: noAgesRecorded ? YIELD_FLAGS.NO_DATA : YIELD_FLAGS.NO_BEARING,
    };
  }

  const gapKg = Math.round(reported - expected);
  const gapPercent = parseFloat((((reported - expected) / expected) * 100).toFixed(2));
  const drift = Math.abs(gapPercent);

  let flag = YIELD_FLAGS.OUTLIER;
  if (drift <= YIELD_REVIEW_THRESHOLDS.ok) flag = YIELD_FLAGS.OK;
  else if (drift <= YIELD_REVIEW_THRESHOLDS.review) flag = YIELD_FLAGS.REVIEW;

  return { expectedKg: expected, reportedKg: reported, gapKg, gapPercent, flag };
};

// ---------------------------------------------------------------------------
// Bikram Sambat census year (mirrors the backend cut-over on 14 April)
// ---------------------------------------------------------------------------

export const getCurrentBsYear = (date = new Date()) => {
  const ad = date.getFullYear();
  const afterNewYear =
    date.getMonth() > 3 || (date.getMonth() === 3 && date.getDate() >= 14);
  return afterNewYear ? ad + 57 : ad + 56;
};

export const censusYearOptions = (count = 6) => {
  const current = getCurrentBsYear();
  return Array.from({ length: count }, (_, i) => current - i);
};

/** Format a kg figure with a thousands separator, or a dash when unset. */
export const formatKg = (kg) =>
  kg === null || kg === undefined ? '—' : `${Math.round(kg).toLocaleString('en-IN')} kg`;

/** Metric tonnes, for district-level totals where kg gets unreadable. */
export const formatMT = (kg) =>
  kg === null || kg === undefined ? '—' : `${(kg / 1000).toFixed(2)} MT`;

/** Metric tonnes at national/province scale — thousands-separated, and no
 *  decimals once the figure passes ~1,000 MT, where two decimal places would
 *  be false precision on a six-figure tonnage. */
export const formatLargeMT = (kg) => {
  if (kg === null || kg === undefined) return '—';
  const mt = kg / 1000;
  const decimals = Math.abs(mt) >= 1000 ? 0 : 2;
  return `${mt.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} MT`;
};
