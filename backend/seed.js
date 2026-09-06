import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './models/User.js';
import Survey from './models/Survey.js';
import Farm from './models/Farm.js';
import BuyingRequirement from './models/BuyingRequirement.js';
import ChatMessage from './models/ChatMessage.js';
import Report from './models/Report.js';
import MarketPrice from './models/MarketPrice.js';
import {
  TREE_AGE_KEYS,
  calculateExpectedProduction,
  getCurrentBsYear,
} from './utils/constants.js';
import { estimateNationalProduction } from './utils/nationalEstimate.js';
import { NSCA_BENCHMARK } from './data/nscaMangoBenchmark.js';

dotenv.config();

// ---------------------------------------------------------------------------
// Shape of the seeded cohort
// ---------------------------------------------------------------------------

/**
 * The census pages treat registered farmers as a SAMPLE that is scaled against
 * the NSCA benchmark, so the sample has to be shaped like the country: many
 * farms in Madhesh, few in Gandaki. Both the number of farms per province and
 * their orchard sizes are derived from `data/nscaMangoBenchmark.js` rather than
 * typed in by hand, so the two cannot drift apart.
 */
const TARGET_FARMERS = 48;

/** Every province needs enough farms for the drill-down to show something. */
const MIN_FARMS_PER_PROVINCE = 3;

/**
 * Farms per province follow the benchmark bearing-tree share, compressed by
 * this exponent. Strict proportionality would put ~25 of 48 farms in Madhesh
 * alone and leave every other province sitting on the floor. Registration
 * uptake is not proportional to tree population anyway, and a compressed
 * weight keeps the real ordering (Madhesh largest, Gandaki smallest) while
 * leaving every province usable in the UI.
 */
const SHARE_COMPRESSION = 0.6;

/**
 * Benchmark trees-per-holding is a national average over every household that
 * owns a mango tree, back-garden ones included (Madhesh 18, Gandaki 3). The
 * farmers who register on a trading platform are commercial growers, so
 * orchard sizes are that average scaled up. The ratios between provinces are
 * what carry the benchmark shape, and scaling preserves them exactly.
 */
const ORCHARD_SCALE = 10;

/** Mango at roughly 10m spacing works out near 3.2 trees to a katha. */
const TREES_PER_KATHA = 3.2;

/** Indicative farmgate rate, used only to turn kg into plausible earnings. */
const FARMGATE_NPR_PER_KG = 70;

// One representative district per province was not enough to drill into.
// Districts are listed largest-benchmark-first; the first is the province
// officer coverage district and carries the most farms. Every district and
// municipality name below is copied from frontend/src/data/nepal-locations.json,
// which is what Survey.district and Survey.municipality are populated from.
const PROVINCE_PLAN = [
  {
    province: 'Koshi',
    districts: [
      { district: 'Morang', municipalities: ['Belbari', 'Biratnagar', 'Budhiganga'] },
      { district: 'Jhapa', municipalities: ['Birtamod', 'Damak', 'Mechinagar'] },
      { district: 'Sunsari', municipalities: ['Barah', 'Dewanganj', 'Barju'] },
      { district: 'Udayapur', municipalities: ['Belaka', 'Katari'] },
    ],
    // Tree-age mixes cycled across the province farms. Koshi has ~64% of its
    // benchmark trees bearing, so the rotation is mid-aged with young in it.
    ageProfiles: ['prime', 'mixed', 'mature', 'establishing', 'prime', 'young', 'mature', 'mixed'],
  },
  {
    province: 'Madhesh',
    districts: [
      { district: 'Dhanusha', municipalities: ['Chhireshwornath', 'Bateshwor', 'Bideha'] },
      { district: 'Siraha', municipalities: ['Bhagawanpur', 'Aurahi', 'Bariyarpatti'] },
      { district: 'Mahottari', municipalities: ['Bardibas', 'Balwa', 'Bhangaha'] },
      { district: 'Saptari', municipalities: ['Bishnupur', 'Balan Bihul', 'Belhi Chapena'] },
      { district: 'Sarlahi', municipalities: ['Barahathawa', 'Balara'] },
      { district: 'Bara', municipalities: ['Adarshkotwal', 'Baragadhi'] },
    ],
    // ~80% of Madhesh benchmark trees already bear fruit: old orchards.
    ageProfiles: ['mature', 'old', 'prime', 'mature', 'mixed', 'old', 'prime', 'mature'],
  },
  {
    province: 'Bagmati',
    districts: [
      { district: 'Chitwan', municipalities: ['Bharatpur', 'Khairahani', 'Kalika'] },
      { district: 'Sindhuli', municipalities: ['Dudhouli', 'Golanjor'] },
      { district: 'Makwanpur', municipalities: ['Hetauda', 'Bakaiya'] },
      { district: 'Bhaktapur', municipalities: ['Bhaktapur', 'Changunarayan'] },
    ],
    ageProfiles: ['establishing', 'prime', 'young', 'mixed', 'mature'],
  },
  {
    province: 'Gandaki',
    districts: [
      { district: 'Nawalpur', municipalities: ['Devchuli', 'Binayee Tribeni'] },
      { district: 'Tanahun', municipalities: ['Bhimad', 'Bhanu'] },
      { district: 'Kaski', municipalities: ['Madi', 'Pokhara Lekhnath'] },
    ],
    // Lowest bearing share in the benchmark (~59%): the youngest rotation.
    ageProfiles: ['young', 'establishing', 'prime'],
  },
  {
    province: 'Lumbini',
    districts: [
      { district: 'Kapilvastu', municipalities: ['Kapilbastu', 'Banganga', 'Buddhabhumi'] },
      { district: 'Rupandehi', municipalities: ['Butwal', 'Devdaha', 'Kanchan'] },
      { district: 'Bardiya', municipalities: ['Bansagadhi', 'Barbardiya'] },
      { district: 'Dang', municipalities: ['Babai', 'Gadhawa'] },
      { district: 'Arghakhanchi', municipalities: ['Bhumekasthan', 'Chhatradev'] },
    ],
    ageProfiles: ['prime', 'mature', 'mixed', 'young', 'prime', 'establishing', 'mature', 'prime'],
  },
  {
    province: 'Karnali',
    districts: [
      { district: 'Surkhet', municipalities: ['Birendranagar', 'Bheriganga'] },
      { district: 'Dailekh', municipalities: ['Aathabis', 'Chamunda Bindrasaini'] },
      { district: 'Rukum West', municipalities: ['Musikot', 'Chaurjahari'] },
      { district: 'Salyan', municipalities: ['Bagchaur', 'Bangad Kupinde'] },
    ],
    ageProfiles: ['mixed', 'prime', 'establishing', 'mature'],
  },
  {
    province: 'Sudurpashchim',
    districts: [
      { district: 'Kailali', municipalities: ['Dhangadhi', 'Bhajani', 'Chure'] },
      { district: 'Kanchanpur', municipalities: ['Bhimdatta', 'Bedkot', 'Belauri'] },
      { district: 'Achham', municipalities: ['Kamalbazar', 'Bannigadhi Jayagadh'] },
      { district: 'Baitadi', municipalities: ['Dasharathchanda', 'Melauli'] },
    ],
    ageProfiles: ['prime', 'mature', 'establishing', 'mixed', 'prime', 'young'],
  },
];

/**
 * Tree-age mixes, as weights over TREE_AGE_KEYS. The point is that farms must
 * NOT look alike: a young orchard weighted to 1-3/4-5 barely bears, a mature
 * one weighted to 16-25/26-40 carries the district production. Weights are
 * proportions of a farm tree count, normalised, so they work at any size.
 */
const AGE_PROFILES = {
  young:        { '1-3': 0.45, '4-5': 0.30, '6-10': 0.20, '11-15': 0.05 },
  establishing: { '1-3': 0.20, '4-5': 0.20, '6-10': 0.35, '11-15': 0.20, '16-25': 0.05 },
  prime:        { '1-3': 0.10, '4-5': 0.10, '6-10': 0.25, '11-15': 0.30, '16-25': 0.25 },
  mature:       { '1-3': 0.05, '4-5': 0.05, '6-10': 0.15, '11-15': 0.15, '16-25': 0.35, '26-40': 0.25 },
  old:          { '1-3': 0.05, '6-10': 0.10, '11-15': 0.10, '16-25': 0.25, '26-40': 0.35, '40+': 0.15 },
  mixed:        { '1-3': 0.15, '4-5': 0.10, '6-10': 0.20, '11-15': 0.20, '16-25': 0.20, '26-40': 0.10, '40+': 0.05 },
};

/**
 * Reported production is always the farm OWN expected figure (from the
 * tree-age table) times a variance, so a farm numbers hang together. Most
 * farms draw a variance inside +/-18% and land on the 'ok' flag; the entries
 * below are deliberate exceptions, keyed by position in the farm list, so the
 * 'review' and 'outlier' flags actually appear on the officer screen. These
 * are not broken data, they are the finding the yield gap exists to surface.
 */
const BASE_VARIANCE = 0.18;
const YIELD_VARIANCE_OVERRIDES = {
  5: 0.34,   // review  - reports well above what its tree ages support
  17: -0.31, // review  - under-reporting, or a poor flowering year
  30: 0.44,  // review
  11: 0.78,  // outlier - far above the table
  41: -0.62, // outlier - far below the table
};

/**
 * The previous census year was a slightly weaker season across the board. A
 * single factor for every farm keeps each farm flag stable between the two
 * years while still making the year selector show a real difference.
 */
const PREVIOUS_SEASON_FACTOR = 0.94;

/** Share of a bracket that crossed into it during the year... */
const AGE_BACK_FRACTION = 0.15;
/** ...and the share of the youngest bracket planted during the year. */
const NEW_PLANTING_FRACTION = 0.25;

const VARIETIES = ['Maldaha', 'Amrapali', 'Sindhure', 'Langra', 'Dusehri', 'Chaunsa'];
const EDUCATION_LEVELS = ['None', 'Primary', 'Secondary', 'Higher Secondary', 'Bachelor'];

const slug = (province) => province.toLowerCase();

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

/** mulberry32 - a fixed seed so every run produces the same cohort. */
const makeRng = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const rng = makeRng(20820883);
const between = (min, max) => min + rng() * (max - min);
const intBetween = (min, max) => Math.round(between(min, max));
const pick = (list, i) => list[i % list.length];

/**
 * Split `target` across `keys` in proportion to `weightOf`, give every key at
 * least `minEach`, and land on `target` exactly (largest remainder, then trim
 * from the biggest). Used for both farms-per-province and farms-per-district
 * so both stay tied to the benchmark.
 */
const allocate = (target, keys, weightOf, minEach = 0) => {
  const weights = keys.map((k) => Math.max(weightOf(k), 0));
  const weightSum = weights.reduce((a, b) => a + b, 0) || keys.length;
  const exact = keys.map((k, i) => (target * weights[i]) / weightSum);

  const counts = {};
  keys.forEach((k, i) => {
    counts[k] = Math.max(minEach, Math.floor(exact[i]));
  });
  let total = keys.reduce((sum, k) => sum + counts[k], 0);

  const byRemainder = keys
    .map((k, i) => ({ key: k, frac: exact[i] - Math.floor(exact[i]) }))
    .sort((a, b) => b.frac - a.frac)
    .map((e) => e.key);
  for (let i = 0; total < target; i++, total++) counts[pick(byRemainder, i)] += 1;

  // The minEach floor can overshoot the target; take the excess off the
  // largest allocations first so the shape is preserved.
  let guard = 0;
  while (total > target && guard++ < 1000) {
    const trimmable = keys
      .filter((k) => counts[k] > minEach)
      .sort((a, b) => counts[b] - counts[a]);
    if (!trimmable.length) break;
    counts[trimmable[0]] -= 1;
    total -= 1;
  }
  return counts;
};

/** Spread `totalTrees` across the age brackets by weight, summing exactly. */
const distributeTrees = (totalTrees, weights) => {
  const dist = TREE_AGE_KEYS.reduce((acc, k) => ({ ...acc, [k]: 0 }), {});
  const used = TREE_AGE_KEYS.filter((k) => (weights[k] || 0) > 0);
  const counts = allocate(totalTrees, used, (k) => weights[k]);
  used.forEach((k) => {
    dist[k] = counts[k];
  });
  return dist;
};

/**
 * The same orchard one census year earlier: trees that crossed a bracket
 * boundary during the year were one bracket younger, and saplings planted
 * during the year did not exist at all. This keeps the two years tree ages
 * consistent with each other instead of inventing a second unrelated orchard.
 */
const previousYearDistribution = (dist) => {
  const prev = { ...dist };
  for (let i = TREE_AGE_KEYS.length - 1; i >= 1; i--) {
    const key = TREE_AGE_KEYS[i];
    const younger = TREE_AGE_KEYS[i - 1];
    const moved = Math.round(dist[key] * AGE_BACK_FRACTION);
    prev[key] -= moved;
    prev[younger] += moved;
  }
  prev['1-3'] = Math.max(0, prev['1-3'] - Math.round(dist['1-3'] * NEW_PLANTING_FRACTION));
  return prev;
};

/** Survey stores [{ ageRange, numberOfTrees }]; Farm stores { key: count }. */
const toSurveyAges = (dist) =>
  TREE_AGE_KEYS.map((key) => ({ ageRange: key, numberOfTrees: dist[key] }));

const sumTrees = (dist) => TREE_AGE_KEYS.reduce((sum, k) => sum + dist[k], 0);

// ---------------------------------------------------------------------------
// Build the cohort - pure, no database access
// ---------------------------------------------------------------------------

const buildFarmPlans = () => {
  const provinces = PROVINCE_PLAN.map((p) => p.province);
  const nationalBearing = NSCA_BENCHMARK.national.bearingTrees;

  // Farms per province, proportional to (benchmark bearing share ^ compression).
  const provinceCounts = allocate(
    TARGET_FARMERS,
    provinces,
    (name) =>
      Math.pow(NSCA_BENCHMARK.provinces[name].bearingTrees / nationalBearing, SHARE_COMPRESSION),
    MIN_FARMS_PER_PROVINCE
  );

  const plans = [];

  PROVINCE_PLAN.forEach((entry) => {
    const { province, districts, ageProfiles } = entry;
    const bench = NSCA_BENCHMARK.provinces[province];

    // Average orchard size for the province, straight off the benchmark.
    const avgTrees = Math.max(8, Math.round((bench.totalTrees / bench.holdings) * ORCHARD_SCALE));

    // Farms per district, proportional to that district benchmark bearing trees.
    const districtKeys = districts.map((d) => d.district);
    const districtCounts = allocate(
      provinceCounts[province],
      districtKeys,
      (name) => NSCA_BENCHMARK.districts[name]?.bearingTrees || 0,
      1
    );

    let indexInProvince = 0;
    districts.forEach(({ district, municipalities }) => {
      for (let i = 0; i < districtCounts[district]; i++) {
        const profileName = pick(ageProfiles, indexInProvince);
        const totalTrees = Math.max(6, Math.round(avgTrees * between(0.65, 1.35)));

        plans.push({
          province,
          district,
          municipality: pick(municipalities, i),
          indexInProvince,
          indexInDistrict: i,
          profileName,
          distribution: distributeTrees(totalTrees, AGE_PROFILES[profileName]),
          variety: pick(VARIETIES, plans.length),
          orchardAreaKatha: Math.max(1, Math.round(totalTrees / TREES_PER_KATHA)),
          ward: intBetween(1, 9),
          farmerAge: intBetween(26, 64),
          householdMembers: intBetween(3, 9),
          satisfactionLevel: intBetween(4, 9),
          educationLevel: pick(EDUCATION_LEVELS, plans.length),
        });
        indexInProvince++;
      }
    });
  });

  // Yield variance is assigned by position in the whole list, so the review
  // and outlier farms land in different provinces rather than one district.
  plans.forEach((plan, index) => {
    plan.variance =
      index in YIELD_VARIANCE_OVERRIDES
        ? YIELD_VARIANCE_OVERRIDES[index]
        : between(-BASE_VARIANCE, BASE_VARIANCE);
  });

  return plans;
};

/**
 * Turn one plan into its figures for a census year. Reported production is
 * the farm own expected figure times its variance - never a hardcoded kg -
 * so the yield flag is a property of the data rather than a label pasted on.
 */
const yearFigures = (plan, { previous }) => {
  const distribution = previous ? previousYearDistribution(plan.distribution) : plan.distribution;
  const expected = calculateExpectedProduction(distribution);
  const factor = (1 + plan.variance) * (previous ? PREVIOUS_SEASON_FACTOR : 1);
  const productionKg = Math.max(0, Math.round(expected.expectedKg * factor));

  return {
    distribution,
    expected,
    totalTrees: sumTrees(distribution),
    productionKg,
    earningsNPR: Math.round(productionKg * FARMGATE_NPR_PER_KG),
  };
};

// ---------------------------------------------------------------------------
// Post-seed report
// ---------------------------------------------------------------------------

const fmt = (n) => Number(n).toLocaleString('en-US');
const pad = (s, width, left = false) => (left ? String(s).padStart(width) : String(s).padEnd(width));

/**
 * Re-computes the same roll-up `getCensusSummary` serves, straight from what
 * landed in the database, so the printout can be checked against the NSCA
 * benchmark before anyone opens the UI.
 */
const printCensusTotals = async (year) => {
  const surveys = await Survey.find({ surveyYearBS: year });

  const blank = () => ({
    farmers: 0,
    totalTrees: 0,
    bearingTrees: 0,
    expectedProductionKg: 0,
    reportedProductionKg: 0,
  });

  const totals = blank();
  const byProvince = {};
  const flagCounts = {};
  const statusCounts = {};

  surveys.forEach((s) => {
    byProvince[s.province] = byProvince[s.province] || blank();
    [totals, byProvince[s.province]].forEach((r) => {
      r.farmers += 1;
      r.totalTrees += s.totalMangoTrees || 0;
      r.bearingTrees += s.bearingTreeCount || 0;
      r.expectedProductionKg += s.expectedProductionKg || 0;
      r.reportedProductionKg += s.totalProductionKg || 0;
    });
    flagCounts[s.yieldFlag] = (flagCounts[s.yieldFlag] || 0) + 1;
    statusCounts[s.status] = (statusCounts[s.status] || 0) + 1;
  });

  const gapPct = (r) =>
    r.expectedProductionKg
      ? (((r.reportedProductionKg - r.expectedProductionKg) / r.expectedProductionKg) * 100).toFixed(1)
      : 'n/a';

  const row = (name, r) =>
    `${pad(name, 16)}${pad(r.farmers, 7, true)}${pad(fmt(r.totalTrees), 9, true)}` +
    `${pad(fmt(r.bearingTrees), 9, true)}${pad(fmt(r.expectedProductionKg), 14, true)}` +
    `${pad(fmt(r.reportedProductionKg), 14, true)}${pad(gapPct(r), 9, true)}`;

  console.log(`\n=== Census ${year} BS ===`);
  console.log(
    `${pad('Province', 16)}${pad('farmers', 7, true)}${pad('trees', 9, true)}${pad('bearing', 9, true)}` +
      `${pad('expected kg', 14, true)}${pad('reported kg', 14, true)}${pad('gap %', 9, true)}`
  );
  Object.keys(byProvince)
    .sort((a, b) => byProvince[b].reportedProductionKg - byProvince[a].reportedProductionKg)
    .forEach((name) => console.log(row(name, byProvince[name])));
  console.log(row('NATIONAL', totals));
  console.log(`  yield flags: ${JSON.stringify(flagCounts)}`);
  console.log(`  statuses:    ${JSON.stringify(statusCounts)}`);

  // The same call the census endpoint makes, so this is what the national
  // estimate panel will render for the "All provinces" scope.
  const treeAgeProfile = TREE_AGE_KEYS.map((key) => ({
    key,
    trees: surveys.reduce(
      (sum, s) => sum + (s.treeAgeDistribution.find((t) => t.ageRange === key)?.numberOfTrees || 0),
      0
    ),
  }));
  const estimate = estimateNationalProduction({ scope: {}, totals, treeAgeProfile });
  console.log(
    `  NSCA ${estimate.benchmark.yearBS} benchmark: ${fmt(estimate.benchmark.bearingTrees)} bearing trees nationally; ` +
      `sample covers ${estimate.coveragePercent}% of trees (${estimate.reliability})`
  );
  console.log(
    `  scaled national estimate: ${fmt(estimate.estimatedProductionKg.reported)} kg at the reported rate, ` +
      `${fmt(estimate.estimatedProductionKg.planning)} kg at the planning rate ` +
      `(${estimate.perBearingTreeKg.reported} vs ${estimate.perBearingTreeKg.planning} kg per bearing tree)`
  );
};

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

const seedData = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { family: 4 });
    console.log('Connected to MongoDB');

    console.log('Clearing existing data...');
    await Promise.all([
      User.deleteMany({}),
      Survey.deleteMany({}),
      Farm.deleteMany({}),
      BuyingRequirement.deleteMany({}),
      ChatMessage.deleteMany({}),
      Report.deleteMany({}),
      MarketPrice.deleteMany({}),
    ]);
    console.log('Existing users, farms, surveys, buying requirements, chat messages, reports, and market prices cleared.');

    // Two census years, so the year selector on the census page is a working
    // control rather than a dead dropdown. CURRENT_YEAR is what the page
    // defaults to; PREVIOUS_YEAR is the closed year behind it. The unique
    // {farmerId, surveyYearBS} index allows exactly one survey per farmer
    // per year, which is what these two are.
    const CURRENT_YEAR = getCurrentBsYear();
    const PREVIOUS_YEAR = CURRENT_YEAR - 1;

    let phoneCounter = 9800000100;
    const nextPhone = () => String(phoneCounter++);

    console.log('Creating admin...');
    // NOTE: passwords are passed in PLAIN here, not pre-hashed. User.js's
    // pre('save') hook hashes on every new document, so hashing here too
    // would double-hash and make the account unable to log in.
    await User.create({
      name: 'Platform Admin',
      email: 'admin@test.com',
      phone: nextPhone(),
      password: 'Admin@123',
      role: 'admin',
      verified: true,
      active: true,
      address: { province: 'Bagmati', district: 'Kathmandu', municipality: 'Kathmandu Metropolitan', ward: 1, tole: 'Board Office' },
    });

    const plans = buildFarmPlans();
    console.log(
      `Creating a trader and an officer per province, plus ${plans.length} farmers weighted by the NSCA benchmark...`
    );

    for (let p = 0; p < PROVINCE_PLAN.length; p++) {
      const { province, districts } = PROVINCE_PLAN[p];
      const key = slug(province);
      const home = districts[0];
      const variety = pick(VARIETIES, p);

      const trader = await User.create({
        name: `Trader ${province}`,
        email: `trader.${key}@test.com`,
        phone: nextPhone(),
        password: 'Trader@123',
        role: 'trader',
        verified: true,
        active: true,
        businessName: `${province} Mango Traders`,
        businessType: 'wholesaler',
        address: { province, district: home.district, municipality: home.municipalities[0], ward: 1, tole: 'Bazaar Area' },
      });

      // The officer covers the province's largest mango district, which is
      // also where most of its seeded farms sit - so the coverage filter puts
      // them on a populated queue rather than an empty one.
      const officer = await User.create({
        name: `Officer ${province}`,
        email: `officer.${key}@test.com`,
        phone: nextPhone(),
        password: 'Officer@123',
        role: 'surveyor',
        verified: true,
        active: true,
        address: { province, district: home.district, municipality: home.municipalities[0], ward: 1, tole: 'District Office' },
        coverageArea: { province, district: home.district, municipality: home.municipalities[0] },
      });

      // Officer publishes today's reference price for their district before
      // the trader posts a requirement, so the trader's price can actually
      // be validated against it (same as the real create-requirement flow).
      const marketPrice = await MarketPrice.create({
        province,
        district: home.district,
        municipality: home.municipalities[0],
        variety,
        wholesalePricePerKg: 90,
        retailPricePerKg: 110,
        quality: 'good',
        supply: 'normal',
        setBy: officer._id,
      });

      // Priced within the "good" quality band (officer wholesale price ± 5)
      // enforced by createBuyingRequirement, so this doubles as a working
      // example of the price-band feature rather than arbitrary numbers.
      await BuyingRequirement.create({
        traderId: trader._id,
        variety,
        quantityMT: 2,
        quality: 'good',
        location: { province, district: home.district, municipality: home.municipalities[0], ward: 1 },
        budget: { minPricePerKg: marketPrice.wholesalePricePerKg - 3, maxPricePerKg: marketPrice.wholesalePricePerKg + 3 },
        requiredByDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        contact: { phone: trader.phone, email: trader.email },
      });

      let firstFarmer = null;

      for (const plan of plans.filter((entry) => entry.province === province)) {
        const n = plan.indexInProvince;

        const farmer = await User.create({
          name: n === 0 ? `Farmer ${province}` : `Farmer ${province} ${n + 1}`,
          // The first farmer in a province keeps the original login and the
          // rest are numbered from it, so the documented pattern still holds.
          email: n === 0 ? `farmer.${key}@test.com` : `farmer.${key}${n + 1}@test.com`,
          phone: nextPhone(),
          password: 'Farmer@123',
          role: 'farmer',
          verified: true,
          active: true,
          address: {
            province,
            district: plan.district,
            municipality: plan.municipality,
            ward: plan.ward,
            tole: 'Main Tole',
          },
        });
        if (!firstFarmer) firstFarmer = farmer;

        const current = yearFigures(plan, { previous: false });
        const previous = yearFigures(plan, { previous: true });

        // The farm record mirrors this farmer's current census year - same
        // district, same trees, same harvest - rather than carrying its own
        // independent numbers.
        await Farm.create({
          userId: farmer._id,
          farmName: `${plan.municipality} Orchard`,
          description: `Family mango orchard in ${plan.municipality}, ${plan.district}.`,
          location: {
            province,
            district: plan.district,
            municipality: plan.municipality,
            ward: plan.ward,
            tole: 'Main Tole',
          },
          orchardAreaKatha: plan.orchardAreaKatha,
          totalTreeCount: current.totalTrees,
          bearingTreeCount: current.expected.bearingTrees,
          treeAgeDistribution: current.distribution,
          varieties: [{ name: plan.variety, percentage: 100 }],
          soilType: pick(['loamy', 'sandy', 'clay', 'mixed'], n),
          terrain: pick(['flat', 'sloped', 'hilly'], plan.indexInDistrict),
          irrigationSystem: pick(['drip', 'flood', 'sprinkler', 'rainfed'], n),
          lastHarvestDate: new Date(new Date().getFullYear() - 1, 5, 15),
          lastHarvestQuantityKg: current.productionKg,
          lastHarvestRevenuNPR: current.earningsNPR,
        });

        // Everything that does not change between the two census years.
        const common = {
          farmerId: farmer._id,
          age: plan.farmerAge,
          educationLevel: plan.educationLevel,
          province,
          district: plan.district,
          municipality: plan.municipality,
          householdMembers: plan.householdMembers,
          orchardAreaKatha: plan.orchardAreaKatha,
          selfManaged: n % 3 !== 0,
          satisfactionLevel: plan.satisfactionLevel,
          receivedGovernmentAssistance: n % 4 === 0,
          receivedNonGovernmentAssistance: n % 5 === 0,
        };

        // Last year's census is closed, so all of it is verified. This year's
        // is still open, and every fourth farm in a province is left
        // 'submitted'. Counting within the province rather than the district
        // matters: most districts hold one or two farms, so a district-level
        // stride would leave almost everything pending. Index 0 always lands
        // on the province's first district, which is the officer's coverage
        // district, so no officer opens an empty queue.
        const isPending = n % 4 === 0;

        await Survey.create([
          {
            ...common,
            surveyYearBS: PREVIOUS_YEAR,
            totalMangoTrees: previous.totalTrees,
            treeAgeDistribution: toSurveyAges(previous.distribution),
            totalProductionKg: previous.productionKg,
            earningsCurrentYearNPR: previous.earningsNPR,
            // No survey exists for the year before that, so this is the
            // farmer's recalled figure, sitting a little under it.
            earningsPreviousYearNPR: Math.round(previous.earningsNPR * 0.9),
            status: 'verified',
            verifiedBy: officer._id,
            verifiedAt: new Date(),
          },
          {
            ...common,
            surveyYearBS: CURRENT_YEAR,
            totalMangoTrees: current.totalTrees,
            treeAgeDistribution: toSurveyAges(current.distribution),
            totalProductionKg: current.productionKg,
            earningsCurrentYearNPR: current.earningsNPR,
            earningsPreviousYearNPR: previous.earningsNPR,
            status: isPending ? 'submitted' : 'verified',
            verifiedBy: isPending ? undefined : officer._id,
            verifiedAt: isPending ? undefined : new Date(),
          },
        ]);
      }

      await Report.create({
        reporterId: firstFarmer._id,
        reporterName: firstFarmer.name,
        reporterRole: 'farmer',
        province,
        district: home.district,
        message: `Sample issue reported from ${home.district} to test officer review.`,
      });
    }

    const [totalUsers, totalFarmers, totalSurveys, totalFarms] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: 'farmer' }),
      Survey.countDocuments(),
      Farm.countDocuments(),
    ]);

    console.log(
      `\nCreated: 1 admin, ${totalFarmers} farmers, ${PROVINCE_PLAN.length} traders, ` +
        `${PROVINCE_PLAN.length} officers (${totalUsers} users total), ${totalFarms} farms, ` +
        `${totalSurveys} surveys across census years ${PREVIOUS_YEAR} and ${CURRENT_YEAR} BS.`
    );
    console.log('Each officer has published a market price, each trader has an open buying requirement priced within that officer band, each province has one report.');
    console.log('Login pattern: farmer.<province>@test.com / Farmer@123 (further farmers are farmer.<province>2@test.com, 3, ...), trader.<province>@test.com / Trader@123, officer.<province>@test.com / Officer@123, admin@test.com / Admin@123');
    console.log('Officer coverage districts: ' + PROVINCE_PLAN.map((p) => `${slug(p.province)}=${p.districts[0].district}`).join(', '));

    await printCensusTotals(PREVIOUS_YEAR);
    await printCensusTotals(CURRENT_YEAR);

    console.log('\nDATABASE SEEDED SUCCESSFULLY');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Seeding failed:', error.message);
    process.exit(1);
  }
};

seedData();
