/**
 * Population benchmark for the mango census: National Sample Census of
 * Agriculture 2021/22 (NSCA, BS 2078/79), Table 7.7 — "Plantation features
 * and ages of mango by district".
 *
 * This is the actual tree population of Nepal, independent of how many
 * farmers have registered on the platform. `getCensusSummary` treats
 * registered, surveyed farmers as a SAMPLE and scales that sample against
 * this benchmark (see `backend/utils/nationalEstimate.js`) to produce a
 * national-level production estimate — rather than quietly presenting "sum
 * of our registered farmers" as if it were "Nepal".
 *
 * Table 7.7 has no production/kg figures, only holdings and tree counts
 * (compact-plantation vs scattered, productive vs non-productive age):
 *   totalTrees   = compact productive + compact non-productive
 *                  + scattered productive + scattered non-productive
 *   bearingTrees = compact productive + scattered productive
 * so it can scale a sample's kg-per-bearing-tree rate up to a population
 * total, but cannot validate a kg figure on its own.
 *
 * District keys are remapped to match `frontend/src/data/nepal-locations.json`
 * exactly, since that file is what Survey.district is populated from:
 *   Kapilbastu       -> Kapilvastu
 *   Kavreplanchok    -> Kavrepalanchowk
 *   Makawanpur       -> Makwanpur
 *   Nawalparasi East -> Nawalpur
 *   Nawalparasi West -> Parasi
 *   Ramechap         -> Ramechhap
 *   Sindhupalchok    -> Sindhupalchowk
 *   Tanahu           -> Tanahun
 *   Terhthum         -> Tehrathum
 * plus three typos in the source workbook itself:
 *   Sirah   -> Siraha
 *   Manag   -> Manang
 *   Dailekha -> Dailekh
 *
 * Holding counts are non-integer at the national level (1,228,103.9) because
 * the census itself is sample-expanded — that is expected, not a rounding bug.
 *
 * Verified while building this table: district totals sum to their province
 * row (to within ~1-2 trees of rounding), provinces sum to the national row,
 * and the district key set is an exact match (77/77, no missing, no extra)
 * against nepal-locations.json.
 */

export const NSCA_BENCHMARK = {
  yearBS: 2078,
  source: 'National Sample Census of Agriculture 2021/22, Table 7.7',
  national: { holdings: 1228103.9, totalTrees: 7866002, bearingTrees: 5630757 },
  provinces: {
    Koshi: { holdings: 296831, totalTrees: 1206281, bearingTrees: 773611 },
    Madhesh: { holdings: 197813, totalTrees: 3636813, bearingTrees: 2929391 },
    Bagmati: { holdings: 135179, totalTrees: 454603, bearingTrees: 291174 },
    Gandaki: { holdings: 75637, totalTrees: 222721, bearingTrees: 132200 },
    Lumbini: { holdings: 262942, totalTrees: 1146179, bearingTrees: 732238 },
    Karnali: { holdings: 61106, totalTrees: 393068, bearingTrees: 234818 },
    Sudurpashchim: { holdings: 198597, totalTrees: 806337, bearingTrees: 537326 },
  },

  districts: {
    // ---- Koshi ----
    "Taplejung": { province: "Koshi", holdings: 2490, totalTrees: 8207, bearingTrees: 5557 },
    "Sankhuwasabha": { province: "Koshi", holdings: 3937, totalTrees: 18572, bearingTrees: 11222 },
    "Solukhumbu": { province: "Koshi", holdings: 228, totalTrees: 1607, bearingTrees: 1220 },
    "Okhaldhunga": { province: "Koshi", holdings: 6726, totalTrees: 36576, bearingTrees: 16732 },
    "Khotang": { province: "Koshi", holdings: 8958, totalTrees: 28864, bearingTrees: 16943 },
    "Bhojpur": { province: "Koshi", holdings: 3823, totalTrees: 25835, bearingTrees: 12443 },
    "Dhankuta": { province: "Koshi", holdings: 7727, totalTrees: 179522, bearingTrees: 64301 },
    "Tehrathum": { province: "Koshi", holdings: 1905, totalTrees: 8016, bearingTrees: 4792 },
    "Panchthar": { province: "Koshi", holdings: 5610, totalTrees: 40447, bearingTrees: 23898 },
    "Ilam": { province: "Koshi", holdings: 12754, totalTrees: 37351, bearingTrees: 26792 },
    "Jhapa": { province: "Koshi", holdings: 83624, totalTrees: 226090, bearingTrees: 160975 },
    "Morang": { province: "Koshi", holdings: 76428, totalTrees: 236819, bearingTrees: 162242 },
    "Sunsari": { province: "Koshi", holdings: 56799, totalTrees: 207630, bearingTrees: 152433 },
    "Udayapur": { province: "Koshi", holdings: 25822, totalTrees: 150746, bearingTrees: 114061 },
    // ---- Madhesh ----
    "Saptari": { province: "Madhesh", holdings: 39263, totalTrees: 538108, bearingTrees: 429055 },
    "Siraha": { province: "Madhesh", holdings: 43203, totalTrees: 829209, bearingTrees: 730432 },
    "Dhanusha": { province: "Madhesh", holdings: 41341, totalTrees: 931091, bearingTrees: 783851 },
    "Mahottari": { province: "Madhesh", holdings: 25835, totalTrees: 570756, bearingTrees: 478450 },
    "Sarlahi": { province: "Madhesh", holdings: 19591, totalTrees: 302908, bearingTrees: 215969 },
    "Rautahat": { province: "Madhesh", holdings: 14118, totalTrees: 317017, bearingTrees: 176827 },
    "Bara": { province: "Madhesh", holdings: 7205, totalTrees: 68383, bearingTrees: 52804 },
    "Parsa": { province: "Madhesh", holdings: 7256, totalTrees: 79341, bearingTrees: 62004 },
    // ---- Bagmati ----
    "Dolakha": { province: "Bagmati", holdings: 1809, totalTrees: 6894, bearingTrees: 5012 },
    "Sindhupalchowk": { province: "Bagmati", holdings: 9981, totalTrees: 26139, bearingTrees: 15364 },
    "Rasuwa": { province: "Bagmati", holdings: 239, totalTrees: 510, bearingTrees: 286 },
    "Dhading": { province: "Bagmati", holdings: 11605, totalTrees: 50701, bearingTrees: 32283 },
    "Nuwakot": { province: "Bagmati", holdings: 9864, totalTrees: 33747, bearingTrees: 23361 },
    "Kathmandu": { province: "Bagmati", holdings: 3355, totalTrees: 7949, bearingTrees: 5851 },
    "Bhaktapur": { province: "Bagmati", holdings: 631, totalTrees: 2560, bearingTrees: 1400 },
    "Lalitpur": { province: "Bagmati", holdings: 531, totalTrees: 1867, bearingTrees: 923 },
    "Kavrepalanchowk": { province: "Bagmati", holdings: 13529, totalTrees: 42922, bearingTrees: 27396 },
    "Ramechhap": { province: "Bagmati", holdings: 9203, totalTrees: 35895, bearingTrees: 17198 },
    "Sindhuli": { province: "Bagmati", holdings: 21524, totalTrees: 100655, bearingTrees: 65089 },
    "Makwanpur": { province: "Bagmati", holdings: 12028, totalTrees: 58938, bearingTrees: 38190 },
    "Chitwan": { province: "Bagmati", holdings: 40878, totalTrees: 85827, bearingTrees: 58823 },
    // ---- Gandaki ----
    "Gorkha": { province: "Gandaki", holdings: 8998, totalTrees: 35325, bearingTrees: 20875 },
    "Manang": { province: "Gandaki", holdings: 0, totalTrees: 0, bearingTrees: 0 },
    "Mustang": { province: "Gandaki", holdings: 0, totalTrees: 0, bearingTrees: 0 },
    "Myagdi": { province: "Gandaki", holdings: 596, totalTrees: 3750, bearingTrees: 3104 },
    "Kaski": { province: "Gandaki", holdings: 5516, totalTrees: 19742, bearingTrees: 6183 },
    "Lamjung": { province: "Gandaki", holdings: 3358, totalTrees: 11511, bearingTrees: 7582 },
    "Tanahun": { province: "Gandaki", holdings: 16035, totalTrees: 54727, bearingTrees: 32200 },
    "Nawalpur": { province: "Gandaki", holdings: 27226, totalTrees: 62880, bearingTrees: 42529 },
    "Syangja": { province: "Gandaki", holdings: 7408, totalTrees: 19075, bearingTrees: 11518 },
    "Parbat": { province: "Gandaki", holdings: 4349, totalTrees: 10284, bearingTrees: 4675 },
    "Baglung": { province: "Gandaki", holdings: 2151, totalTrees: 5428, bearingTrees: 3535 },
    // ---- Lumbini ----
    "Rukum East": { province: "Lumbini", holdings: 127, totalTrees: 271, bearingTrees: 175 },
    "Rolpa": { province: "Lumbini", holdings: 3186, totalTrees: 15314, bearingTrees: 7654 },
    "Pyuthan": { province: "Lumbini", holdings: 13734, totalTrees: 51074, bearingTrees: 26502 },
    "Gulmi": { province: "Lumbini", holdings: 9243, totalTrees: 29225, bearingTrees: 18029 },
    "Arghakhanchi": { province: "Lumbini", holdings: 16264, totalTrees: 57191, bearingTrees: 35201 },
    "Palpa": { province: "Lumbini", holdings: 19260, totalTrees: 67249, bearingTrees: 32541 },
    "Parasi": { province: "Lumbini", holdings: 18019, totalTrees: 104286, bearingTrees: 56129 },
    "Rupandehi": { province: "Lumbini", holdings: 40462, totalTrees: 184797, bearingTrees: 128216 },
    "Kapilvastu": { province: "Lumbini", holdings: 25743, totalTrees: 176404, bearingTrees: 130539 },
    "Dang": { province: "Lumbini", holdings: 40131, totalTrees: 149032, bearingTrees: 97497 },
    "Banke": { province: "Lumbini", holdings: 24020, totalTrees: 125374, bearingTrees: 87366 },
    "Bardiya": { province: "Lumbini", holdings: 52754, totalTrees: 185962, bearingTrees: 112388 },
    // ---- Karnali ----
    "Dolpa": { province: "Karnali", holdings: 0, totalTrees: 0, bearingTrees: 0 },
    "Mugu": { province: "Karnali", holdings: 0, totalTrees: 0, bearingTrees: 0 },
    "Humla": { province: "Karnali", holdings: 8, totalTrees: 3439, bearingTrees: 2242 },
    "Jumla": { province: "Karnali", holdings: 0, totalTrees: 0, bearingTrees: 0 },
    "Kalikot": { province: "Karnali", holdings: 277, totalTrees: 1290, bearingTrees: 626 },
    "Dailekh": { province: "Karnali", holdings: 7026, totalTrees: 63530, bearingTrees: 42434 },
    "Jajarkot": { province: "Karnali", holdings: 4430, totalTrees: 37794, bearingTrees: 17790 },
    "Rukum West": { province: "Karnali", holdings: 4421, totalTrees: 43117, bearingTrees: 26831 },
    "Salyan": { province: "Karnali", holdings: 10903, totalTrees: 55985, bearingTrees: 24914 },
    "Surkhet": { province: "Karnali", holdings: 34041, totalTrees: 187912, bearingTrees: 119980 },
    // ---- Sudurpashchim ----
    "Bajura": { province: "Sudurpashchim", holdings: 489, totalTrees: 1947, bearingTrees: 855 },
    "Bajhang": { province: "Sudurpashchim", holdings: 2064, totalTrees: 11311, bearingTrees: 6757 },
    "Darchula": { province: "Sudurpashchim", holdings: 7174, totalTrees: 38646, bearingTrees: 27091 },
    "Baitadi": { province: "Sudurpashchim", holdings: 13048, totalTrees: 80713, bearingTrees: 55262 },
    "Dadeldhura": { province: "Sudurpashchim", holdings: 15020, totalTrees: 89474, bearingTrees: 52411 },
    "Doti": { province: "Sudurpashchim", holdings: 8960, totalTrees: 32992, bearingTrees: 20071 },
    "Achham": { province: "Sudurpashchim", holdings: 9380, totalTrees: 60770, bearingTrees: 49488 },
    "Kailali": { province: "Sudurpashchim", holdings: 71848, totalTrees: 250683, bearingTrees: 169413 },
    "Kanchanpur": { province: "Sudurpashchim", holdings: 70615, totalTrees: 239799, bearingTrees: 155976 },
  },
};

export default NSCA_BENCHMARK;
