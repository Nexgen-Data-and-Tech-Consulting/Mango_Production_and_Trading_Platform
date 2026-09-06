/**
 * Scales the registered-farmer sample up against the NSCA 2021/22 population
 * benchmark (`backend/data/nscaMangoBenchmark.js`) to produce a national-level
 * production estimate, instead of quietly presenting "sum of our registered
 * farmers" as if it were "Nepal".
 *
 * This is a ratio estimator: production-per-bearing-tree, computed from the
 * sample, multiplied by the benchmark's bearing-tree count for the same
 * scope. Takes `totals` and `treeAgeProfile` as arguments — both are already
 * computed by `getCensusSummary` — so calling this adds zero extra DB queries.
 */
import { TREE_AGE_BRACKETS } from './constants.js';
import { NSCA_BENCHMARK } from '../data/nscaMangoBenchmark.js';

const BRACKET_BY_KEY = TREE_AGE_BRACKETS.reduce((acc, b) => ({ ...acc, [b.key]: b }), {});

const round = (value, decimals = 0) => {
  const factor = 10 ** decimals;
  return Math.round((Number(value) || 0) * factor) / factor;
};

/**
 * The benchmark row for a census scope: district if set and known, else
 * province, else national. Table 7.7 stops at district — a municipality-level
 * scope has no row of its own, so it naturally falls back to its parent
 * district, since `buildCensusScope` already carries the parent district in
 * `scope.district` once an admin has drilled past it.
 */
export const getBenchmark = ({ province, district } = {}) => {
  const { source, yearBS } = NSCA_BENCHMARK;

  if (district && NSCA_BENCHMARK.districts[district]) {
    const row = NSCA_BENCHMARK.districts[district];
    return {
      tier: 'district',
      name: district,
      holdings: row.holdings,
      totalTrees: row.totalTrees,
      bearingTrees: row.bearingTrees,
      source,
      yearBS,
    };
  }
  if (province && NSCA_BENCHMARK.provinces[province]) {
    const row = NSCA_BENCHMARK.provinces[province];
    return {
      tier: 'province',
      name: province,
      holdings: row.holdings,
      totalTrees: row.totalTrees,
      bearingTrees: row.bearingTrees,
      source,
      yearBS,
    };
  }
  const row = NSCA_BENCHMARK.national;
  return {
    tier: 'national',
    name: 'Nepal',
    holdings: row.holdings,
    totalTrees: row.totalTrees,
    bearingTrees: row.bearingTrees,
    source,
    yearBS,
  };
};

/**
 * `farmers`/`coveragePercent` thresholds below which the ratio estimate is
 * too thin a sample to trust. A sample can fail on either count: a handful
 * of huge orchards can hit the coverage bar with almost no farmers, and a lot
 * of tiny gardens can hit the farmer count while covering almost no trees.
 */
const RELIABILITY_THRESHOLDS = {
  indicative: { farmers: 30, coveragePercent: 0.5 },
  developing: { farmers: 200, coveragePercent: 5 },
};

export const estimateNationalProduction = ({ scope, totals, treeAgeProfile }) => {
  const benchmark = getBenchmark(scope || {});

  const coveragePercent =
    benchmark.totalTrees > 0 ? round((totals.totalTrees / benchmark.totalTrees) * 100, 4) : null;

  // Re-sum the sample's own tree-age mix against the low/planning/high
  // kg-per-tree figures, rather than a flat constant — a sample skewed
  // toward young or old orchards has to show up honestly in the band.
  let lowKg = 0;
  let planningKg = 0;
  let highKg = 0;
  (treeAgeProfile || []).forEach((row) => {
    const bracket = BRACKET_BY_KEY[row.key];
    if (!bracket) return;
    lowKg += row.trees * bracket.minKg;
    planningKg += row.trees * bracket.kgPerTree;
    highKg += row.trees * bracket.maxKg;
  });

  const bearingTrees = totals.bearingTrees || 0;
  const hasBearingSample = bearingTrees > 0;

  // No bearing trees in the sample means "cannot estimate a rate", not "the
  // rate is zero" — null propagates that distinction to the UI instead of
  // rendering a false "we estimate zero production".
  const perBearingTreeKg = hasBearingSample
    ? {
        reported: round(totals.reportedProductionKg / bearingTrees, 2),
        planningLow: round(lowKg / bearingTrees, 2),
        planning: round(planningKg / bearingTrees, 2),
        planningHigh: round(highKg / bearingTrees, 2),
      }
    : { reported: null, planningLow: null, planning: null, planningHigh: null };

  const estimatedProductionKg = hasBearingSample
    ? {
        reported: Math.round(perBearingTreeKg.reported * benchmark.bearingTrees),
        planningLow: Math.round(perBearingTreeKg.planningLow * benchmark.bearingTrees),
        planning: Math.round(perBearingTreeKg.planning * benchmark.bearingTrees),
        planningHigh: Math.round(perBearingTreeKg.planningHigh * benchmark.bearingTrees),
      }
    : { reported: null, planningLow: null, planning: null, planningHigh: null };

  let reliability = 'no-data';
  if (hasBearingSample && totals.farmers > 0 && benchmark.totalTrees > 0) {
    const pct = coveragePercent ?? 0;
    if (
      totals.farmers < RELIABILITY_THRESHOLDS.indicative.farmers ||
      pct < RELIABILITY_THRESHOLDS.indicative.coveragePercent
    ) {
      reliability = 'indicative';
    } else if (
      totals.farmers < RELIABILITY_THRESHOLDS.developing.farmers ||
      pct < RELIABILITY_THRESHOLDS.developing.coveragePercent
    ) {
      reliability = 'developing';
    } else {
      reliability = 'reliable';
    }
  }

  return {
    benchmark,
    coveragePercent,
    perBearingTreeKg,
    estimatedProductionKg,
    sampleFarmers: totals.farmers,
    reliability,
  };
};

export default { getBenchmark, estimateNationalProduction };
