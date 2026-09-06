import React from 'react';
import { FiUsers, FiTrendingUp, FiMapPin, FiLayers, FiCheckCircle, FiGlobe } from 'react-icons/fi';
import StatusBadge from './StatusBadge';
import {
  TREE_AGE_BRACKETS,
  calculateYieldGap,
  countTrees,
  YIELD_FLAG_LABELS,
  formatKg,
  formatMT,
  formatLargeMT,
} from '../utils/treeAgeYield';
import '../styles/census.css';

const TIER_LABELS = {
  province: 'Province',
  district: 'District',
  municipality: 'Municipality',
};

const RELIABILITY_PILL = { reliable: 'ok', developing: 'review', indicative: 'outlier', 'no-data': 'no-data' };
const RELIABILITY_LABELS = {
  reliable: 'Reliable sample',
  developing: 'Developing sample',
  indicative: 'Indicative only',
  'no-data': 'No data',
};

/** Below 0.1% a fixed one-decimal display reads as "0.0%" for almost every
 *  district, which looks like a bug rather than a true tiny sample. */
const formatCoveragePercent = (percent) => {
  if (percent === null || percent === undefined) return '—';
  return percent < 0.1 ? `${percent.toFixed(3)}%` : `${percent.toFixed(1)}%`;
};

/** Positive: actual production exceeds the tree-age table's midpoint.
 *  Negative (the common case): the trees on the ground could be carrying
 *  more than farmers are currently reporting. */
const gapClass = (ne) => {
  const { reported, planning } = ne.estimatedProductionKg;
  if (!planning) return '';
  return reported - planning < 0 ? 'is-negative' : 'is-positive';
};

const formatGapPercent = (ne) => {
  const { reported, planning } = ne.estimatedProductionKg;
  if (!planning) return '—';
  const pct = ((reported - planning) / planning) * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
};

/**
 * The body of a census report, shared by the officer and admin pages.
 *
 * Both roles read the same figures from the same endpoint; only the scope
 * differs — an officer is pinned to one district, an admin drills the whole
 * country. Keeping the presentation here means the two views can never drift
 * apart and quote different totals for the same year.
 *
 * `onDrill` is optional: pass it to make breakdown rows navigable (admin),
 * omit it for a fixed scope (officer).
 */
export default function CensusReport({ census, onDrill }) {
  const totals = census?.totals;
  if (!totals) return null;
  const ne = census.nationalEstimate;

  const tier = TIER_LABELS[census.groupedBy] || 'Area';
  const canDrill = typeof onDrill === 'function' && census.groupedBy !== 'municipality';

  return (
    <>
      {/* ---------- Headline figures ---------- */}
      <div className="stats-grid">
        <div className="stat-card green">
          <div className="stat-card-icon"><FiUsers /></div>
          <p className="stat-label">Farmers Recorded</p>
          <p className="stat-value">{totals.farmers}</p>
        </div>
        <div className="stat-card gold">
          <div className="stat-card-icon"><FiLayers /></div>
          <p className="stat-label">Mango Trees</p>
          <p className="stat-value">{totals.totalTrees.toLocaleString('en-IN')}</p>
          <p className="stat-sub">{totals.bearingTrees.toLocaleString('en-IN')} bearing</p>
        </div>
        <div className="stat-card blue">
          <div className="stat-card-icon"><FiMapPin /></div>
          <p className="stat-label">Orchard Area</p>
          <p className="stat-value">{totals.orchardAreaHectare}</p>
          <p className="stat-sub">hectares</p>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon"><FiTrendingUp /></div>
          <p className="stat-label">Reported Production</p>
          <p className="stat-value">{totals.reportedProductionMT}</p>
          <p className="stat-sub">MT · expected {totals.expectedProductionMT} MT</p>
        </div>
      </div>

      {/* ---------- National estimate ---------- */}
      {ne && (
        <div className="census-panel">
          <h2><FiGlobe /> National Estimate</h2>
          <p className="census-panel__intro">
            Registered farmers are a sample, not the whole population. This scales the
            sample&apos;s production per bearing tree up against the government&apos;s
            2021/22 agriculture census bearing-tree count for {ne.benchmark.name}, and
            compares that against what the same tree-age mix could potentially carry.
          </p>

          {ne.reliability === 'no-data' ? (
            <p className="census-panel__intro">
              {ne.benchmark.totalTrees === 0
                ? `The 2021/22 census recorded no mango holdings in ${ne.benchmark.name}, so no estimate can be scaled here.`
                : `No bearing trees have been reported yet in ${ne.benchmark.name} — nothing to scale up yet.`}
            </p>
          ) : (
            <div className="census-compare">
              <div className="census-compare__item">
                <span className="detail-label">Coverage</span>
                <strong>{formatCoveragePercent(ne.coveragePercent)}</strong>
                <span className="census-compare__sub">
                  {totals.totalTrees.toLocaleString('en-IN')} registered of {ne.benchmark.totalTrees.toLocaleString('en-IN')} census trees
                </span>
              </div>
              <div className="census-compare__item">
                <span className="detail-label">Estimated Actual Production</span>
                <strong>{formatLargeMT(ne.estimatedProductionKg.reported)}</strong>
                <span className="census-compare__sub">from reported yields, scaled to {ne.benchmark.name}</span>
              </div>
              <div className="census-compare__item">
                <span className="detail-label">Production Potential</span>
                <strong>
                  {formatLargeMT(ne.estimatedProductionKg.planningLow)} – {formatLargeMT(ne.estimatedProductionKg.planningHigh)}
                </strong>
                <span className="census-compare__sub">tree-age reference table, not reported data</span>
              </div>
              <div className="census-compare__item">
                <span className="detail-label">National Yield Gap</span>
                <strong className={gapClass(ne)}>{formatGapPercent(ne)}</strong>
                <span className="census-compare__sub">actual vs. potential midpoint</span>
              </div>
              <div className="census-compare__item">
                <span className="detail-label">Sample Reliability</span>
                <strong>
                  <span className={`yield-pill yield-pill--${RELIABILITY_PILL[ne.reliability]}`}>
                    {RELIABILITY_LABELS[ne.reliability]}
                  </span>
                </strong>
                <span className="census-compare__sub">{ne.sampleFarmers} registered farms</span>
              </div>
            </div>
          )}

          <p className="census-panel__foot">
            Method: {ne.sampleFarmers} registered farms → kg per bearing tree (reported) → ×
            the government census&apos;s bearing-tree count for {ne.benchmark.name}. The
            potential range instead applies the tree-age reference table below.
            Source: {ne.benchmark.source}.
          </p>
        </div>
      )}

      {/* ---------- Expected vs reported ---------- */}
      <div className="census-panel">
        <h2>Expected vs Reported</h2>
        <p className="census-panel__intro">
          Expected production is each orchard&apos;s tree count multiplied by the standard
          yield for that tree age, summed across the whole area. It is a reference
          baseline for planning, not a target.
        </p>
        <div className="census-compare">
          <div className="census-compare__item">
            <span className="detail-label">Expected</span>
            <strong>{formatMT(totals.expectedProductionKg)}</strong>
            <span className="census-compare__sub">{formatKg(totals.expectedProductionKg)}</span>
          </div>
          <div className="census-compare__item">
            <span className="detail-label">Reported</span>
            <strong>{formatMT(totals.reportedProductionKg)}</strong>
            <span className="census-compare__sub">{formatKg(totals.reportedProductionKg)}</span>
          </div>
          <div className="census-compare__item">
            <span className="detail-label">Difference</span>
            <strong className={totals.gapKg < 0 ? 'is-negative' : 'is-positive'}>
              {totals.gapKg > 0 ? '+' : ''}{formatMT(totals.gapKg)}
            </strong>
            <span className="census-compare__sub">
              {totals.gapPercent === null
                ? 'no tree age data'
                : `${totals.gapPercent > 0 ? '+' : ''}${totals.gapPercent}% vs expected`}
            </span>
          </div>
          <div className="census-compare__item">
            <span className="detail-label">Avg Satisfaction</span>
            <strong>{totals.averageSatisfaction}</strong>
            <span className="census-compare__sub">out of 10</span>
          </div>
        </div>

        {Object.keys(totals.flagCounts || {}).length > 0 && (
          <div className="tree-age-tags" style={{ marginTop: 14 }}>
            {Object.entries(totals.flagCounts).map(([flag, count]) => (
              <span key={flag} className={`yield-pill yield-pill--${flag}`}>
                {YIELD_FLAG_LABELS[flag] || flag}: {count}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ---------- Tree age profile ---------- */}
      <div className="census-panel">
        <h2>Tree Age Profile</h2>
        <p className="census-panel__intro">
          The age structure of the orchard stock across this area. Young brackets
          indicate future production coming on stream; the 40+ bracket indicates
          replanting need.
        </p>
        <div className="admin-table-wrap">
          <table className="admin-table yield-table">
            <thead>
              <tr>
                <th>Age of mango tree</th>
                <th>Trees recorded</th>
                <th>Share</th>
                <th>Planning value</th>
                <th>Expected production</th>
              </tr>
            </thead>
            <tbody>
              {census.treeAgeProfile.map((row) => {
                const share = totals.totalTrees
                  ? ((row.trees / totals.totalTrees) * 100).toFixed(1)
                  : '0.0';
                return (
                  <tr key={row.key}>
                    <td>{row.label}</td>
                    <td>{row.trees.toLocaleString('en-IN')}</td>
                    <td>
                      <div className="share-bar">
                        <div className="share-bar__fill" style={{ width: `${share}%` }} />
                        <span>{share}%</span>
                      </div>
                    </td>
                    <td>{row.kgPerTree === 0 ? '—' : `${row.kgPerTree} kg/tree`}</td>
                    <td>{row.expectedKg === 0 ? '—' : formatKg(row.expectedKg)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------- Breakdown at the current tier ---------- */}
      <div className="census-panel">
        <h2>By {tier}</h2>
        {canDrill && (
          <p className="census-panel__intro">
            Select a {tier.toLowerCase()} to open its own census.
          </p>
        )}
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{tier}</th>
                <th>Farmers</th>
                <th>Trees</th>
                <th>Area (ha)</th>
                <th>Expected</th>
                <th>Reported</th>
                <th>Difference</th>
              </tr>
            </thead>
            <tbody>
              {census.breakdown.map((row) => (
                <tr
                  key={row.name}
                  className={canDrill ? 'row--drillable' : undefined}
                  onClick={canDrill ? () => onDrill(row.name) : undefined}
                  tabIndex={canDrill ? 0 : undefined}
                  role={canDrill ? 'button' : undefined}
                  onKeyDown={
                    canDrill
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onDrill(row.name);
                          }
                        }
                      : undefined
                  }
                >
                  <td>{row.name}</td>
                  <td>{row.farmers}</td>
                  <td>{row.totalTrees.toLocaleString('en-IN')}</td>
                  <td>{row.orchardAreaHectare}</td>
                  <td>{formatMT(row.expectedProductionKg)}</td>
                  <td>{formatMT(row.reportedProductionKg)}</td>
                  <td className={row.gapKg < 0 ? 'is-negative' : 'is-positive'}>
                    {row.gapPercent === null
                      ? '—'
                      : `${row.gapPercent > 0 ? '+' : ''}${row.gapPercent}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------- Full register ---------- */}
      <div className="census-panel">
        <h2>Census Register ({census.surveys.length})</h2>
        <p className="census-panel__intro">
          Every record filed for {census.year} BS in this area. Export the CSV for the
          district office file.
        </p>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Farmer</th>
                <th>District</th>
                <th>Municipality</th>
                <th>Area (ha)</th>
                <th>Trees</th>
                <th>Expected</th>
                <th>Reported</th>
                <th>Check</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {census.surveys.map((s) => {
                const gap = calculateYieldGap(
                  s.expectedProductionKg,
                  s.totalProductionKg,
                  countTrees(s.treeAgeDistribution)
                );
                return (
                  <tr key={s._id}>
                    <td>{s.farmerId?.name || 'Unknown'}</td>
                    <td>{s.district || '—'}</td>
                    <td>{s.municipality || '—'}</td>
                    <td>{s.orchardAreaHectare ?? '—'}</td>
                    <td>
                      {s.totalMangoTrees}
                      {s.bearingTreeCount > 0 && (
                        <span className="cell-sub"> ({s.bearingTreeCount} bearing)</span>
                      )}
                    </td>
                    <td>{formatKg(s.expectedProductionKg)}</td>
                    <td>{formatKg(s.totalProductionKg)}</td>
                    <td>
                      <span className={`yield-pill yield-pill--${gap.flag}`}>
                        {gap.gapPercent === null
                          ? YIELD_FLAG_LABELS[gap.flag]
                          : `${gap.gapPercent > 0 ? '+' : ''}${gap.gapPercent}%`}
                      </span>
                    </td>
                    <td><StatusBadge status={s.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------- Reference table ---------- */}
      <div className="census-panel census-panel--reference">
        <h2><FiCheckCircle /> Yield Reference Used</h2>
        <p className="census-panel__intro">
          Every expected-production figure on this page comes from this table. No
          estimation or prediction model is involved — the arithmetic is
          trees × kg-per-tree, and it can be reproduced by hand.
        </p>
        <div className="admin-table-wrap">
          <table className="admin-table yield-table">
            <thead>
              <tr>
                <th>Age of mango tree</th>
                <th>Indicative production/tree/year</th>
                <th>Suggested planning value</th>
              </tr>
            </thead>
            <tbody>
              {TREE_AGE_BRACKETS.map((b) => (
                <tr key={b.key}>
                  <td>{b.label}</td>
                  <td>
                    {b.minKg === b.maxKg ? `${b.minKg} kg` : `${b.minKg}–${b.maxKg} kg`}
                    <span className="cell-sub"> · {b.note}</span>
                  </td>
                  <td><strong>{b.kgPerTree} kg</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
