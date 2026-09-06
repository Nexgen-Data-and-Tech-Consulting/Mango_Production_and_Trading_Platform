import Survey from '../models/Survey.js';
import User from '../models/User.js';
import logger from '../utils/logger.js';
import {
  TREE_AGE_BRACKETS,
  YIELD_FLAG_LABELS,
  getCurrentBsYear,
  isValidCensusYear,
  censusYearOptions,
  calculateExpectedProduction,
} from '../utils/constants.js';
import { estimateNationalProduction } from '../utils/nationalEstimate.js';

/**
 * Officers only ever act within their assigned district. Mirrors the scoping
 * already used by reportController so surveys and reports agree on who sees
 * what.
 *
 * An officer with no coverage district is scoped to nothing rather than to
 * everything: `createStaffAccount` requires a district for every officer, so
 * a missing one means the account is malformed, not unrestricted.
 */
const officerDistrict = (user) => user.coverageArea?.district || null;

const applyOfficerScope = (filter, user) => {
  if (user.role === 'surveyor') {
    const district = officerDistrict(user);
    // No coverage district means the account is malformed. Match nothing
    // rather than everything: $in: [] can never match a document.
    filter.district = district ? district : { $in: [] };
  }
  return filter;
};

/**
 * Who may read survey records, and how much.
 *
 *   farmer   → only their own submissions
 *   surveyor → only their assigned coverage district
 *   admin    → everything
 *
 * Every other role — traders above all — is refused outright. A survey holds a
 * farmer's income, household size, stated difficulties and contact details;
 * a trader has no business reading it. The production figures traders
 * legitimately need are already served, scoped and reduced to
 * `recentProduction`/`recentEarnings`, by the trader endpoints themselves
 * (`getFarmerDirectory`, `getFarmerProfile`, and the accepted-response branch
 * of `getBuyingRequirementById`). No trader screen calls this endpoint.
 */
const SURVEY_READERS = ['farmer', 'surveyor', 'admin'];

const denySurveyRead = (res, role) =>
  res.status(403).json({
    success: false,
    message: `User role ${role} is not authorized to read survey records`,
  });

/**
 * Paths a client may never set on a survey, on create or on update. They are
 * the record's provenance and verification state, owned by the server: a
 * farmer who could post `status: 'verified'` would have the record counted in
 * the district roll-up and the national estimate without an officer ever
 * seeing it. One list, applied by both createSurvey and updateSurvey.
 */
const SERVER_OWNED_SURVEY_FIELDS = ['farmerId', 'status', 'verifiedBy', 'verifiedAt', '_id'];

const stripServerOwnedFields = (body) => {
  const payload = { ...body };
  SERVER_OWNED_SURVEY_FIELDS.forEach((field) => delete payload[field]);
  return payload;
};

/**
 * Who may modify a survey record. The mirror of SURVEY_READERS on the write
 * side:
 *
 *   farmer   → only their own submissions
 *   surveyor → only within their assigned coverage district
 *   admin    → everything
 *
 * Every other role — traders above all — is refused outright. The only gate
 * before this was "is this a farmer editing someone else's record", so every
 * non-farmer role fell straight through to the write and could PUT or DELETE
 * any census record by id.
 *
 * Returns a refusal message, or null when the write is allowed.
 */
const SURVEY_WRITERS = ['farmer', 'surveyor', 'admin'];

const surveyWriteDenial = (survey, user, action) => {
  if (!SURVEY_WRITERS.includes(user.role)) {
    return `User role ${user.role} is not authorized to ${action} survey records`;
  }

  if (user.role === 'farmer' && survey.farmerId.toString() !== user.id) {
    return `Not authorized to ${action} this survey`;
  }

  if (user.role === 'surveyor') {
    // Fails closed, like applyOfficerScope: an officer with no coverage
    // district has a malformed account, not an unrestricted one.
    const district = officerDistrict(user);
    if (!district || survey.district !== district) {
      return `Not authorized to ${action} surveys outside your coverage area`;
    }
  }

  return null;
};

export const createSurvey = async (req, res) => {
  try {
    const surveyYearBS = req.body.surveyYearBS
      ? Number(req.body.surveyYearBS)
      : getCurrentBsYear();

    if (!isValidCensusYear(surveyYearBS)) {
      return res.status(400).json({
        success: false,
        message: `Invalid census year: ${req.body.surveyYearBS}`,
      });
    }

    const survey = await Survey.create({
      ...stripServerOwnedFields(req.body),
      surveyYearBS,
      farmerId: req.user.id,
    });

    // farmCount tracks how many census records this farmer has on file.
    await User.findByIdAndUpdate(req.user.id, { $inc: { farmCount: 1 } });

    logger.info(`Survey created: ${survey._id} (census year ${surveyYearBS})`);

    res.status(201).json({
      success: true,
      message: 'Survey created successfully',
      survey,
    });
  } catch (error) {
    // Unique index on { farmerId, surveyYearBS }
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message:
          'You have already submitted a survey for this census year. Edit the existing one instead.',
      });
    }

    logger.error(`Survey creation error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getSurveys = async (req, res) => {
  try {
    if (!SURVEY_READERS.includes(req.user.role)) {
      return denySurveyRead(res, req.user.role);
    }

    const { page = 1, limit = 10, status, year, district } = req.query;
    const skip = (page - 1) * limit;

    const filter = {};

    if (req.user.role === 'farmer') {
      filter.farmerId = req.user.id;
    } else if (req.user.role === 'surveyor') {
      const scoped = officerDistrict(req.user);
      // Mirrors reportController: an officer with no coverage district gets an
      // empty page, never the whole country.
      if (!scoped) {
        return res.json({ success: true, total: 0, page: 1, pages: 0, surveys: [] });
      }
      filter.district = scoped;
    } else if (district) {
      // Admin is the only unfiltered reader, and may narrow by district.
      filter.district = district;
    }

    if (status) filter.status = status;
    if (year) filter.surveyYearBS = Number(year);

    const surveys = await Survey.find(filter)
      .populate('farmerId', 'name email phone address')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ surveyYearBS: -1, createdAt: -1 });

    const total = await Survey.countDocuments(filter);

    res.json({
      success: true,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      surveys,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

/**
 * Which census years the signed-in farmer has already filed, so the client can
 * prompt for the current year without guessing from a bare count.
 */
export const getMySurveyYears = async (req, res) => {
  try {
    const surveys = await Survey.find({ farmerId: req.user.id })
      .select('surveyYearBS status createdAt verificationNotes')
      .sort({ surveyYearBS: -1 });

    const currentYearBS = getCurrentBsYear();

    res.json({
      success: true,
      currentYearBS,
      hasCurrentYear: surveys.some((s) => s.surveyYearBS === currentYearBS),
      years: surveys.map((s) => ({
        // The id is what lets a farmer open an existing record to correct it;
        // without it the client can only ever POST a new survey and hit the
        // one-per-year conflict. verificationNotes is why it was rejected.
        id: s._id,
        year: s.surveyYearBS,
        status: s.status,
        submittedAt: s.createdAt,
        verificationNotes: s.verificationNotes,
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getSurveyById = async (req, res) => {
  try {
    // Same rule as the list endpoint. Without this, scoping `getSurveys`
    // achieves nothing: a trader could simply walk survey ids instead.
    if (!SURVEY_READERS.includes(req.user.role)) {
      return denySurveyRead(res, req.user.role);
    }

    const survey = await Survey.findById(req.params.id).populate(
      'farmerId',
      'name email phone'
    );

    if (!survey) {
      return res.status(404).json({
        success: false,
        message: 'Survey not found',
      });
    }

    // Authorization
    if (
      req.user.role === 'farmer' &&
      survey.farmerId._id.toString() !== req.user.id
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this survey',
      });
    }

    if (
      req.user.role === 'surveyor' &&
      survey.district !== req.user.coverageArea?.district
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view surveys outside your coverage area',
      });
    }

    res.json({
      success: true,
      survey,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const updateSurvey = async (req, res) => {
  try {
    const survey = await Survey.findById(req.params.id);

    if (!survey) {
      return res.status(404).json({
        success: false,
        message: 'Survey not found',
      });
    }

    const denial = surveyWriteDenial(survey, req.user, 'update');
    if (denial) {
      return res.status(403).json({ success: false, message: denial });
    }

    // A verified census record is the district's record of the year — reopening
    // it is the officer's call, not the farmer's.
    if (survey.status === 'verified' && req.user.role === 'farmer') {
      return res.status(403).json({
        success: false,
        message: 'This survey has been verified and can no longer be edited. Contact your officer.',
      });
    }

    // Assigning then saving (rather than findByIdAndUpdate) is what lets the
    // pre-save hook recompute expected production and the yield gap.
    const updates = stripServerOwnedFields(req.body);
    Object.keys(updates).forEach((key) => survey.set(key, updates[key]));

    // A farmer correcting a rejected record is resubmitting it. Status is
    // immutable from the request body, so move it back into the officer's
    // `status=submitted` queue here — otherwise the correction is saved but no
    // officer ever sees it again, and the rejection is still a dead end.
    if (survey.status === 'rejected' && req.user.role === 'farmer') {
      survey.status = 'submitted';
      survey.verifiedBy = undefined;
      survey.verifiedAt = undefined;
    }

    await survey.save();

    res.json({
      success: true,
      message: 'Survey updated successfully',
      survey,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'A survey already exists for that census year.',
      });
    }
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const deleteSurvey = async (req, res) => {
  try {
    const survey = await Survey.findById(req.params.id);

    if (!survey) {
      return res.status(404).json({
        success: false,
        message: 'Survey not found',
      });
    }

    const denial = surveyWriteDenial(survey, req.user, 'delete');
    if (denial) {
      return res.status(403).json({ success: false, message: denial });
    }

    await Survey.findByIdAndDelete(req.params.id);

    // Decrement the owner's count, not the caller's — an officer or admin
    // deleting a record must not decrement their own.
    await User.findByIdAndUpdate(survey.farmerId, { $inc: { farmCount: -1 } });

    logger.info(`Survey deleted: ${req.params.id}`);

    res.json({
      success: true,
      message: 'Survey deleted successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const verifySurvey = async (req, res) => {
  try {
    if (req.user.role !== 'surveyor') {
      return res.status(403).json({
        success: false,
        message: 'Only officers can verify surveys',
      });
    }

    const { status, verificationNotes } = req.body;

    if (!['verified', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be either verified or rejected',
      });
    }

    const survey = await Survey.findById(req.params.id);

    if (!survey) {
      return res.status(404).json({ success: false, message: 'Survey not found' });
    }

    // An officer can only verify records inside their coverage area. Fails
    // closed, like applyOfficerScope: without the district check an officer
    // with no coverage area could verify anywhere in the country.
    if (
      !officerDistrict(req.user) ||
      survey.district !== officerDistrict(req.user)
    ) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to verify surveys outside your coverage area',
      });
    }

    survey.status = status;
    survey.verificationNotes = verificationNotes;
    survey.verifiedBy = req.user.id;
    survey.verifiedAt = new Date();
    await survey.save();

    await survey.populate('verifiedBy', 'name email');

    logger.info(`Survey ${status}: ${survey._id} by ${req.user.email}`);

    res.json({
      success: true,
      message: `Survey ${status} successfully`,
      survey,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getSurveyStats = async (req, res) => {
  try {
    // Aggregate figures only, but still derived from survey records — same
    // readers as the endpoints above.
    if (!SURVEY_READERS.includes(req.user.role)) {
      return denySurveyRead(res, req.user.role);
    }

    const filter = {};
    if (req.user.role === 'farmer') filter.farmerId = req.user.id;
    else applyOfficerScope(filter, req.user);
    if (req.query.year) filter.surveyYearBS = Number(req.query.year);

    const stats = await Survey.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalSurveys: { $sum: 1 },
          averageProduction: { $avg: '$totalProductionKg' },
          averageEarnings: { $avg: '$earningsCurrentYearNPR' },
          averageSatisfaction: { $avg: '$satisfactionLevel' },
        },
      },
    ]);

    res.json({
      success: true,
      stats: stats[0] || {},
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ---------------------------------------------------------------------------
// Annual census
// ---------------------------------------------------------------------------

/**
 * The census reports on a four-level geography: Nepal → province → district →
 * municipality. The narrowest filter supplied decides which level the rows are
 * grouped at, so the same endpoint serves every tier of the drill-down:
 *
 *   (nothing)            → rows are provinces
 *   ?province=Madhesh    → rows are districts within Madhesh
 *   ?district=Bara       → rows are municipalities within Bara
 *
 * An officer's coverage district is applied first and cannot be widened by a
 * query parameter — passing ?province= as an officer changes nothing.
 */
const buildCensusScope = (query, user) => {
  const filter = {};
  applyOfficerScope(filter, user);

  // Only an unscoped caller (admin) may set these.
  if (!filter.district) {
    if (query.province) filter.province = query.province;
    if (query.district) filter.district = query.district;
  }
  if (query.status) filter.status = query.status;

  const district = typeof filter.district === 'string' ? filter.district : null;
  const province = filter.province || null;

  const groupKey = filter.district ? 'municipality' : province ? 'district' : 'province';

  return {
    filter,
    groupKey,
    province,
    district,
    // Human-readable label for the current position in the hierarchy.
    label: district || province || 'All provinces',
  };
};

/**
 * The officer's yearly roll-up: totals for the district, a breakdown by
 * municipality, and the tree-age profile. Everything is plain arithmetic over
 * the recorded answers — the same sums an officer would do by hand.
 */
export const getCensusSummary = async (req, res) => {
  try {
    const year = req.query.year ? Number(req.query.year) : getCurrentBsYear();

    if (!isValidCensusYear(year)) {
      return res.status(400).json({ success: false, message: `Invalid census year: ${req.query.year}` });
    }

    const scope = buildCensusScope(req.query, req.user);
    const filter = { ...scope.filter, surveyYearBS: year };

    const surveys = await Survey.find(filter)
      .populate('farmerId', 'name phone')
      .sort({ province: 1, district: 1, municipality: 1 });

    // Headline totals
    const totals = surveys.reduce(
      (acc, s) => {
        acc.farmers += 1;
        acc.orchardAreaHectare += s.orchardAreaHectare || 0;
        acc.totalTrees += s.totalMangoTrees || 0;
        acc.bearingTrees += s.bearingTreeCount || 0;
        acc.expectedProductionKg += s.expectedProductionKg || 0;
        acc.reportedProductionKg += s.totalProductionKg || 0;
        acc.satisfactionSum += s.satisfactionLevel || 0;
        acc.statusCounts[s.status] = (acc.statusCounts[s.status] || 0) + 1;
        if (s.yieldFlag) acc.flagCounts[s.yieldFlag] = (acc.flagCounts[s.yieldFlag] || 0) + 1;
        return acc;
      },
      {
        farmers: 0,
        orchardAreaHectare: 0,
        totalTrees: 0,
        bearingTrees: 0,
        expectedProductionKg: 0,
        reportedProductionKg: 0,
        satisfactionSum: 0,
        statusCounts: {},
        flagCounts: {},
      }
    );

    const gapKg = totals.reportedProductionKg - totals.expectedProductionKg;

    // Tree-age profile across the whole cohort
    const treeAgeProfile = TREE_AGE_BRACKETS.map((bracket) => {
      const trees = surveys.reduce((sum, s) => {
        const entry = s.treeAgeDistribution?.find((t) => t.ageRange === bracket.key);
        return sum + (entry?.numberOfTrees || 0);
      }, 0);
      return {
        key: bracket.key,
        label: bracket.label,
        kgPerTree: bracket.kgPerTree,
        trees,
        expectedKg: trees * bracket.kgPerTree,
      };
    });

    // Rows for the current tier of the hierarchy: provinces, districts, or
    // municipalities depending on how far the caller has drilled in.
    const groupKey = scope.groupKey;
    const grouped = {};
    surveys.forEach((s) => {
      const key = s[groupKey] || 'Not recorded';
      if (!grouped[key]) {
        grouped[key] = {
          name: key,
          farmers: 0,
          totalTrees: 0,
          bearingTrees: 0,
          orchardAreaHectare: 0,
          expectedProductionKg: 0,
          reportedProductionKg: 0,
        };
      }
      const g = grouped[key];
      g.farmers += 1;
      g.totalTrees += s.totalMangoTrees || 0;
      g.bearingTrees += s.bearingTreeCount || 0;
      g.orchardAreaHectare += s.orchardAreaHectare || 0;
      g.expectedProductionKg += s.expectedProductionKg || 0;
      g.reportedProductionKg += s.totalProductionKg || 0;
    });

    const breakdown = Object.values(grouped)
      .map((g) => ({
        ...g,
        orchardAreaHectare: parseFloat(g.orchardAreaHectare.toFixed(2)),
        gapKg: Math.round(g.reportedProductionKg - g.expectedProductionKg),
        gapPercent: g.expectedProductionKg
          ? parseFloat(
              (((g.reportedProductionKg - g.expectedProductionKg) / g.expectedProductionKg) * 100).toFixed(1)
            )
          : null,
      }))
      .sort((a, b) => b.reportedProductionKg - a.reportedProductionKg);

    // Registered, surveyed farmers are a sample of the district/province/
    // country, not the whole population. Scale that sample against the
    // NSCA 2021/22 tree-count benchmark for this same scope so the page can
    // show an actual national-level estimate alongside the raw roll-up.
    const nationalEstimate = estimateNationalProduction({
      scope: { province: scope.province, district: scope.district },
      totals,
      treeAgeProfile,
    });

    res.json({
      success: true,
      year,
      groupedBy: groupKey,
      // `scope` stays a plain label for existing callers; province/district are
      // echoed separately so a client can render breadcrumbs and drill deeper.
      scope: scope.label,
      province: scope.province,
      district: scope.district,
      availableYears: censusYearOptions(),
      totals: {
        ...totals,
        orchardAreaHectare: parseFloat(totals.orchardAreaHectare.toFixed(2)),
        expectedProductionKg: Math.round(totals.expectedProductionKg),
        reportedProductionKg: Math.round(totals.reportedProductionKg),
        expectedProductionMT: parseFloat((totals.expectedProductionKg / 1000).toFixed(3)),
        reportedProductionMT: parseFloat((totals.reportedProductionKg / 1000).toFixed(3)),
        gapKg: Math.round(gapKg),
        gapPercent: totals.expectedProductionKg
          ? parseFloat(((gapKg / totals.expectedProductionKg) * 100).toFixed(1))
          : null,
        averageSatisfaction: totals.farmers
          ? parseFloat((totals.satisfactionSum / totals.farmers).toFixed(1))
          : 0,
      },
      treeAgeProfile,
      nationalEstimate,
      breakdown,
      surveys,
    });
  } catch (error) {
    logger.error(`Census summary error: ${error.message}`);
    res.status(500).json({ success: false, message: error.message });
  }
};

const CSV_COLUMNS = [
  ['Census Year (BS)', (s) => s.surveyYearBS],
  ['Farmer', (s) => s.farmerId?.name],
  ['Phone', (s) => s.farmerId?.phone],
  ['Province', (s) => s.province],
  ['District', (s) => s.district],
  ['Municipality', (s) => s.municipality],
  ['Farmer Age', (s) => s.age],
  ['Education', (s) => s.educationLevel],
  ['Household Members', (s) => s.householdMembers],
  ['Orchard Area (katha)', (s) => s.orchardAreaKatha],
  ['Orchard Area (ha)', (s) => s.orchardAreaHectare],
  ['Total Trees', (s) => s.totalMangoTrees],
  ['Bearing Trees', (s) => s.bearingTreeCount],
  ...TREE_AGE_BRACKETS.map((b) => [
    `Trees ${b.label}`,
    (s) => s.treeAgeDistribution?.find((t) => t.ageRange === b.key)?.numberOfTrees ?? 0,
  ]),
  ['Expected Production (kg)', (s) => s.expectedProductionKg],
  ['Reported Production (kg)', (s) => s.totalProductionKg],
  ['Yield Gap (kg)', (s) => s.yieldGapKg],
  ['Yield Gap (%)', (s) => s.yieldGapPercent],
  ['Review Flag', (s) => YIELD_FLAG_LABELS[s.yieldFlag] || ''],
  ['Production Cost (NPR)', (s) => s.productionCostNPR],
  ['Earnings This Year (NPR)', (s) => s.earningsCurrentYearNPR],
  ['Earnings Last Year (NPR)', (s) => s.earningsPreviousYearNPR],
  ['Earnings Growth (%)', (s) => s.earningsGrowth],
  ['Self Managed', (s) => (s.selfManaged ? 'Yes' : 'No')],
  ['Satisfaction (0-10)', (s) => s.satisfactionLevel],
  ['Govt Assistance', (s) => (s.receivedGovernmentAssistance ? s.governmentOfficeSource || 'Yes' : 'No')],
  ['NGO Assistance', (s) => (s.receivedNonGovernmentAssistance ? s.nonGovernmentSource || 'Yes' : 'No')],
  ['Production Challenges', (s) => s.productionChallenges],
  ['Marketing Challenges', (s) => s.marketingChallenges],
  ['Suggestions', (s) => s.suggestions],
  ['Status', (s) => s.status],
  ['Verification Notes', (s) => s.verificationNotes],
  ['Submitted On', (s) => isoDate(s.createdAt)],
  ['Verified On', (s) => isoDate(s.verifiedAt)],
];

/** A single unparseable date must not take down the whole export. */
const isoDate = (value) => {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

const csvCell = (value) => {
  if (value === null || value === undefined) return '';
  const str = String(value);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

/**
 * Download the year's census as a spreadsheet. This is the artefact the
 * district office actually files — the register has to leave the app.
 */
export const exportCensusCsv = async (req, res) => {
  try {
    const year = req.query.year ? Number(req.query.year) : getCurrentBsYear();

    if (!isValidCensusYear(year)) {
      return res.status(400).json({ success: false, message: `Invalid census year: ${req.query.year}` });
    }

    const scope = buildCensusScope(req.query, req.user);
    const filter = { ...scope.filter, surveyYearBS: year };

    const surveys = await Survey.find(filter)
      .populate('farmerId', 'name phone')
      .sort({ province: 1, district: 1, municipality: 1 });

    const rows = [
      CSV_COLUMNS.map(([header]) => csvCell(header)).join(','),
      ...surveys.map((s) => CSV_COLUMNS.map(([, get]) => csvCell(get(s))).join(',')),
    ];

    // Name the file after whichever tier was exported, so a district and a
    // province download never collide in the officer's downloads folder.
    const slug = (scope.district || scope.province || 'nepal')
      .toLowerCase()
      .replace(/\s+/g, '-');
    const filename = `mango-census-${year}-${slug}.csv`;

    logger.info(`Census CSV exported: ${filename} (${surveys.length} rows) by ${req.user.email}`);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // BOM so Excel opens Nepali place names in UTF-8 rather than mojibake.
    res.send('﻿' + rows.join('\r\n'));
  } catch (error) {
    logger.error(`Census export error: ${error.message}`);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * The tree-age yield table itself, so the frontend can render officer-facing
 * reference material without keeping its own copy of the numbers.
 */
export const getTreeAgeReference = async (req, res) => {
  res.json({
    success: true,
    currentYearBS: getCurrentBsYear(),
    availableYears: censusYearOptions(),
    brackets: TREE_AGE_BRACKETS,
  });
};

/** Preview expected production for a distribution without saving anything. */
export const previewExpectedProduction = async (req, res) => {
  try {
    const result = calculateExpectedProduction(req.body.treeAgeDistribution);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export default {
  createSurvey,
  getSurveys,
  getMySurveyYears,
  getSurveyById,
  updateSurvey,
  deleteSurvey,
  verifySurvey,
  getSurveyStats,
  getCensusSummary,
  exportCensusCsv,
  getTreeAgeReference,
  previewExpectedProduction,
};
