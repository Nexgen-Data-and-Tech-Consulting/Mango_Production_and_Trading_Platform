import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '../../services/api';
import '../../styles/forms.css';
import '../../styles/census.css';
import { useDispatch, useSelector } from 'react-redux';
import { checkSurveyStatus } from '../../store/surveySlice';
import { getProvinces, getDistricts, getMunicipalities } from '../../utils/nepalLocations';
import {
  TREE_AGE_BRACKETS,
  calculateExpectedProduction,
  calculateYieldGap,
  getCurrentBsYear,
  YIELD_FLAGS,
  formatKg,
} from '../../utils/treeAgeYield';

const EDUCATION_LEVELS = ['None', 'Primary', 'Secondary', 'Higher Secondary', 'Bachelor', 'Master or above'];
const TREE_AGE_RANGES = TREE_AGE_BRACKETS.map((b) => b.key);

export default function SurveyForm() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  // With an :id in the path this form edits an existing record (PUT) instead of
  // filing a new one (POST). The backend allows one survey per farmer per census
  // year, so correcting a rejected record is the only way back in.
  const { id: editingId } = useParams();
  const isEditing = Boolean(editingId);
  const { currentYearBS, years } = useSelector((state) => state.survey);
  const [submitting, setSubmitting] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(Boolean(editingId));

  const censusYear = currentYearBS || getCurrentBsYear();
  const previousYear = censusYear - 1;

  const [formData, setFormData] = useState({
    // Personal
    age: '',
    educationLevel: EDUCATION_LEVELS[0],

    // Farm location
    province: '',
district: '',
municipality: '',

    // Household
    householdMembers: '',

    // Orchard
    orchardAreaKatha: '',
    totalMangoTrees: '',

    // Management
    selfManaged: true,
    managementType: '',
    productionCostNPR: '',

    // Production
    totalProductionKg: '',
    earningsCurrentYearNPR: '',
    earningsPreviousYearNPR: '',

    // Satisfaction
    satisfactionLevel: 5,

    // Assistance
    receivedGovernmentAssistance: false,
    governmentOfficeSource: '',
    receivedNonGovernmentAssistance: false,
    nonGovernmentSource: '',

    // Challenges
    productionChallenges: '',
    marketingChallenges: '',
    suggestions: '',
  });

  const [treeAges, setTreeAges] = useState(
    TREE_AGE_RANGES.reduce((acc, range) => ({ ...acc, [range]: '' }), {})
  );

  useEffect(() => {
    if (!editingId) return;
    let cancelled = false;

    api
      .get(`/surveys/${editingId}`)
      .then(({ data }) => {
        if (cancelled) return;
        const s = data.survey;
        setFormData((prev) => {
          const next = { ...prev };
          // Copy only the keys this form owns, so server-side fields
          // (status, expectedProductionKg, farmerId, ...) are never echoed back.
          Object.keys(prev).forEach((key) => {
            if (s[key] !== undefined && s[key] !== null) next[key] = s[key];
          });
          return next;
        });
        setTreeAges(
          TREE_AGE_RANGES.reduce((acc, range) => {
            const entry = (s.treeAgeDistribution || []).find((d) => d.ageRange === range);
            return { ...acc, [range]: entry ? String(entry.numberOfTrees) : '' };
          }, {})
        );
      })
      .catch((error) => {
        if (cancelled) return;
        toast.error(error.response?.data?.message || 'Failed to load your survey');
        navigate('/farmer/dashboard');
      })
      .finally(() => {
        if (!cancelled) setLoadingExisting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [editingId, navigate]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    const updated = { ...formData, [name]: type === 'checkbox' ? checked : value };

    // Cascading resets: changing province clears district+municipality,
    // changing district clears municipality
    if (name === 'district') {
      updated.municipality = '';
    }

    setFormData(updated);
  };

  const handleTreeAgeChange = (range, value) => {
    setTreeAges({ ...treeAges, [range]: value });
  };

  // Live expected production from the tree ages entered so far. Recomputed
  // locally so the farmer sees it update as they type; the authoritative
  // figure is recalculated server-side on save.
  const expected = useMemo(() => calculateExpectedProduction(treeAges), [treeAges]);

  const reportedKg = Number(formData.totalProductionKg) || 0;
  const gap = useMemo(
    () => calculateYieldGap(expected.expectedKg, reportedKg, expected.totalTrees),
    [expected.expectedKg, reportedKg, expected.totalTrees]
  );

  // The tree-age boxes should add up to the total the farmer already gave.
  const declaredTrees = Number(formData.totalMangoTrees) || 0;
  const treeCountMismatch =
    declaredTrees > 0 && expected.totalTrees > 0 && expected.totalTrees !== declaredTrees;

  const showYieldCheck = expected.totalTrees > 0 && reportedKg > 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    const treeAgeDistribution = TREE_AGE_RANGES
      .filter((range) => treeAges[range] !== '')
      .map((range) => ({ ageRange: range, numberOfTrees: Number(treeAges[range]) }));

    try {
      const payload = {
        ...formData,
        surveyYearBS: isEditing ? undefined : censusYear,
        age: Number(formData.age),
        householdMembers: Number(formData.householdMembers),
        orchardAreaKatha: Number(formData.orchardAreaKatha),
        totalMangoTrees: Number(formData.totalMangoTrees),
        productionCostNPR: formData.productionCostNPR ? Number(formData.productionCostNPR) : undefined,
        totalProductionKg: formData.totalProductionKg ? Number(formData.totalProductionKg) : 0,
        earningsCurrentYearNPR: formData.earningsCurrentYearNPR ? Number(formData.earningsCurrentYearNPR) : 0,
        earningsPreviousYearNPR: formData.earningsPreviousYearNPR ? Number(formData.earningsPreviousYearNPR) : 0,
        satisfactionLevel: Number(formData.satisfactionLevel),
        treeAgeDistribution,
      };

      if (isEditing) {
        await api.put(`/surveys/${editingId}`, payload);
        toast.success('Survey updated and sent back for review');
      } else {
        await api.post('/surveys', payload);
        toast.success(`Survey for ${censusYear} BS submitted successfully`);
      }

      dispatch(checkSurveyStatus());
      navigate('/farmer/dashboard');
    } catch (error) {
      toast.error(
        error.response?.data?.message ||
          (isEditing ? 'Failed to update survey' : 'Failed to submit survey')
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingExisting) {
    return <div className="form-container">Loading your survey...</div>;
  }

  return (
    <div className="form-container">
      <h1>{isEditing ? 'Correct Your Survey' : 'Farm Survey'}</h1>

      <div className="census-year-banner">
        <div>
          <span className="census-year-banner__label">Census year</span>
          <strong className="census-year-banner__year">{censusYear} BS</strong>
        </div>
        <p className="census-year-banner__note">
          This survey is recorded against {censusYear} BS. You file one survey per year —
          last year&apos;s record stays on file for comparison.
          {years?.length > 0 && (
            <> You have already filed for: {years.map((y) => y.year).join(', ')}.</>
          )}
        </p>
      </div>

      <form onSubmit={handleSubmit}>

        <h3 className="form-section">Your Details</h3>
        <div className="form-grid">
          <div>
            <label>Age</label>
            <input type="number" name="age" min="18" max="100" value={formData.age} onChange={handleChange} required />
          </div>
          <div>
            <label>Education Level</label>
            <select name="educationLevel" value={formData.educationLevel} onChange={handleChange}>
              {EDUCATION_LEVELS.map((lvl) => <option key={lvl} value={lvl}>{lvl}</option>)}
            </select>
          </div>
        </div>

        <h3 className="form-section">Farm Location</h3>
<div className="form-grid">
  <div>
    <label>Province</label>
    <select
      name="province"
      value={formData.province}
      onChange={(e) => setFormData({ ...formData, province: e.target.value, district: '', municipality: '' })}
      required
    >
      <option value="">Select Province</option>
      {getProvinces().map((p) => (
        <option key={p} value={p}>{p}</option>
      ))}
    </select>
  </div>
  <div>
    <label>District</label>
    <select
      name="district"
      value={formData.district}
      onChange={handleChange}
      required
      disabled={!formData.province}
    >
      <option value="">
        {formData.province ? 'Select District' : 'Select province first'}
      </option>
      {getDistricts(formData.province).map((d) => (
        <option key={d} value={d}>{d}</option>
      ))}
    </select>
  </div>
  <div>
    <label>Municipality</label>
    <select
      name="municipality"
      value={formData.municipality}
      onChange={handleChange}
      required
      disabled={!formData.district}
    >
      <option value="">
        {formData.district ? 'Select Municipality' : 'Select district first'}
      </option>
      {getMunicipalities(formData.province, formData.district).map((m) => (
        <option key={m} value={m}>{m}</option>
      ))}
    </select>
  </div>
</div>
        <h3 className="form-section">Household & Orchard</h3>
        <div className="form-grid">
          <div>
            <label>Household Members</label>
            <input type="number" name="householdMembers" min="1" value={formData.householdMembers} onChange={handleChange} required />
          </div>
          <div>
            <label>Orchard Area (katha)</label>
            <input type="number" step="0.1" name="orchardAreaKatha" min="0.1" value={formData.orchardAreaKatha} onChange={handleChange} required />
          </div>
          <div>
            <label>Total Mango Trees</label>
            <input type="number" name="totalMangoTrees" min="1" value={formData.totalMangoTrees} onChange={handleChange} required />
          </div>
        </div>

        <h3 className="form-section">Tree Age Distribution</h3>
        <p className="form-hint">
          How many of your trees fall in each age group? The typical production for that
          age is shown under each box, so you can check your harvest figure below.
        </p>
        <div className="tree-age-grid">
          {TREE_AGE_BRACKETS.map((bracket) => (
            <div key={bracket.key}>
              <label>{bracket.key} yrs</label>
              <input
                type="number"
                min="0"
                value={treeAges[bracket.key]}
                onChange={(e) => handleTreeAgeChange(bracket.key, e.target.value)}
              />
              <span className="tree-age-hint">
                {bracket.kgPerTree === 0 ? 'not bearing' : `~${bracket.kgPerTree} kg/tree`}
              </span>
            </div>
          ))}
        </div>

        {expected.totalTrees > 0 && (
          <div className="expected-panel">
            <div className="expected-panel__row">
              <span>Trees entered</span>
              <strong>
                {expected.totalTrees.toLocaleString('en-IN')}
                {expected.bearingTrees !== expected.totalTrees && (
                  <span className="expected-panel__sub"> ({expected.bearingTrees} bearing)</span>
                )}
              </strong>
            </div>
            <div className="expected-panel__row">
              <span>Typical production for these trees</span>
              <strong>{formatKg(expected.expectedKg)}</strong>
            </div>
            {expected.maxKg > expected.minKg && (
              <div className="expected-panel__row expected-panel__row--muted">
                <span>Usual range</span>
                <strong>{formatKg(expected.minKg)} – {formatKg(expected.maxKg)}</strong>
              </div>
            )}
            {treeCountMismatch && (
              <p className="expected-panel__warn">
                These age groups add up to {expected.totalTrees.toLocaleString('en-IN')} trees,
                but you entered {declaredTrees.toLocaleString('en-IN')} total mango trees above.
                Please check both numbers.
              </p>
            )}
            <p className="expected-panel__foot">
              This is a reference figure from standard production tables — not a target,
              and not a judgement of your orchard.
            </p>
          </div>
        )}

        <h3 className="form-section">Management</h3>
        <div className="form-grid">
          <div>
            <label>
              <input
                type="checkbox"
                name="selfManaged"
                checked={formData.selfManaged}
                onChange={handleChange}
                style={{ width: 'auto', marginRight: 8 }}
              />
              Self-managed
            </label>
          </div>
          <div>
            <label>Production Cost (NPR, optional)</label>
            <input type="number" name="productionCostNPR" value={formData.productionCostNPR} onChange={handleChange} />
          </div>
        </div>

        <h3 className="form-section">Production &amp; Earnings (optional)</h3>
        <div className="form-grid">
          <div>
            <label>Total Production (kg)</label>
            <input type="number" name="totalProductionKg" value={formData.totalProductionKg} onChange={handleChange} />
          </div>
          <div>
            <label>Earnings this year ({censusYear} BS, NPR)</label>
            <input type="number" name="earningsCurrentYearNPR" value={formData.earningsCurrentYearNPR} onChange={handleChange} />
          </div>
          <div>
            <label>Earnings last year ({previousYear} BS, NPR)</label>
            <input type="number" name="earningsPreviousYearNPR" value={formData.earningsPreviousYearNPR} onChange={handleChange} />
          </div>
        </div>

        {showYieldCheck && (
          <div className={`yield-check yield-check--${gap.flag}`}>
            <div className="yield-check__head">
              <span className="yield-check__dot" />
              <strong>
                {gap.flag === YIELD_FLAGS.OK && 'Your harvest matches your tree ages'}
                {gap.flag === YIELD_FLAGS.REVIEW && 'Worth double-checking'}
                {gap.flag === YIELD_FLAGS.OUTLIER && 'This looks quite different from expected'}
                {gap.flag === YIELD_FLAGS.NO_BEARING &&
                  'You reported a harvest, but none of your trees are old enough to bear yet'}
              </strong>
            </div>
            {gap.gapPercent !== null && (
              <p className="yield-check__body">
                You reported <strong>{formatKg(reportedKg)}</strong>; trees of these ages
                typically give <strong>{formatKg(expected.expectedKg)}</strong>
                {' '}({gap.gapPercent > 0 ? '+' : ''}{gap.gapPercent}%).
                {gap.flag !== YIELD_FLAGS.OK && ' Check the figure is in kilograms and covers the whole orchard.'}
              </p>
            )}
            {gap.flag === YIELD_FLAGS.NO_BEARING && (
              <p className="yield-check__body">
                Check the tree ages above — trees under 4 years are normally not yet fruiting.
              </p>
            )}
            <p className="yield-check__foot">
              You can still submit either way. Your officer will review it.
            </p>
          </div>
        )}

        <h3 className="form-section">Satisfaction</h3>
        <label>How satisfied are you with mango farming? (0 = not at all, 10 = extremely)</label>
        <input type="range" name="satisfactionLevel" min="0" max="10" value={formData.satisfactionLevel} onChange={handleChange} />
        <p style={{ fontFamily: 'var(--font-mono)', marginTop: 4 }}>{formData.satisfactionLevel} / 10</p>

        <h3 className="form-section">Assistance Received</h3>
        <div className="form-grid">
          <div>
            <label>
              <input
                type="checkbox"
                name="receivedGovernmentAssistance"
                checked={formData.receivedGovernmentAssistance}
                onChange={handleChange}
                style={{ width: 'auto', marginRight: 8 }}
              />
              Received government assistance
            </label>
            {formData.receivedGovernmentAssistance && (
              <input
                type="text"
                name="governmentOfficeSource"
                placeholder="Which office?"
                value={formData.governmentOfficeSource}
                onChange={handleChange}
                style={{ marginTop: 8 }}
              />
            )}
          </div>
          <div>
            <label>
              <input
                type="checkbox"
                name="receivedNonGovernmentAssistance"
                checked={formData.receivedNonGovernmentAssistance}
                onChange={handleChange}
                style={{ width: 'auto', marginRight: 8 }}
              />
              Received NGO/other assistance
            </label>
            {formData.receivedNonGovernmentAssistance && (
              <input
                type="text"
                name="nonGovernmentSource"
                placeholder="Which organization?"
                value={formData.nonGovernmentSource}
                onChange={handleChange}
                style={{ marginTop: 8 }}
              />
            )}
          </div>
        </div>

        <h3 className="form-section">Challenges & Suggestions (optional)</h3>
        <label>Production challenges</label>
        <textarea rows="3" name="productionChallenges" value={formData.productionChallenges} onChange={handleChange} />

        <label>Marketing challenges</label>
        <textarea rows="3" name="marketingChallenges" value={formData.marketingChallenges} onChange={handleChange} />

        <label>Suggestions for improvement</label>
        <textarea rows="3" name="suggestions" value={formData.suggestions} onChange={handleChange} />

        <button type="submit" disabled={submitting}>
          {submitting
            ? isEditing
              ? 'Resubmitting...'
              : 'Submitting...'
            : isEditing
              ? 'Resubmit for review'
              : 'Submit Survey'}
        </button>
      </form>
    </div>
  );
}