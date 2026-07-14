#!/usr/bin/env node
/**
 * Generates inventory.json: ~350-400 realistic vehicle records standing in
 * for a future Dealer Management System / inventory API. Deterministic by
 * construction (seeded PRNG, fixed seed) — re-running this script produces a
 * byte-identical file, which is the point: this is checked-in demo data, not
 * a build artifact regenerated per-deploy.
 *
 * Strategy: ~30 hand-authored base models (brand/model/bodyType/fuel options/
 * price range/trims/year range) x ~12 deterministic variations each (year,
 * trim, fuel, mileage-derived-from-year, price-derived-from-year/trim,
 * estimatedMonthlyPayment derived from price — not independently randomized,
 * so a vehicle's fields stay internally consistent with each other).
 *
 * tags[] and features[] are derived FROM the generated attributes, not
 * randomized independently — that's what makes them meaningful signals for
 * the matching engine (js/inventory-engine.js) rather than noise.
 */

const fs = require('fs');
const path = require('path');

// --- Seeded PRNG (mulberry32) — small, dependency-free, deterministic ---
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEED = 20260712;
const rng = mulberry32(SEED);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const pickWeighted = (weighted) => { // [[value, weight], ...]
  const total = weighted.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [value, w] of weighted) { if ((r -= w) <= 0) return value; }
  return weighted[weighted.length - 1][0];
};
const randInt = (min, max) => Math.floor(rng() * (max - min + 1)) + min;
const jitter = (base, pct) => Math.round(base * (1 + (rng() * 2 - 1) * pct));

const CITIES = ['Helsinki', 'Espoo', 'Tampere', 'Turku', 'Oulu', 'Jyväskylä', 'Lahti'];

// Weighted toward real used-car market distribution (white/black/gray/silver
// dominate; red/blue are minority colors) — values match
// js/vehicle-preferences.js's COLOR_RULES output exactly, since a stated
// color preference is matched against this field verbatim.
const COLORS = [
  ['valkoinen', 0.24], ['musta', 0.20], ['harmaa', 0.19], ['hopea', 0.14],
  ['sininen', 0.11], ['punainen', 0.08], ['ruskea', 0.04],
];

const FEATURE_POOL = [
  'Adaptiivinen vakionopeudensäädin', '360° peruutuskamera', 'Apple CarPlay / Android Auto',
  'Istuinlämmitys edessä', 'Istuinlämmitys takana', 'Ilmastointi', 'Navigointijärjestelmä',
  'LED-ajovalot', 'Vetokoukku', 'Panoraamakatto', 'Sähkötoiminen takaluukku',
  'Kaistavahti', 'Kuolleen kulman varoitin', 'Langaton puhelinlaturi',
  'Nahkaverhoilu', 'Premium-äänijärjestelmä', 'Automaattinen hätäjarrutus', 'Avaimeton käynnistys',
];

// Base model catalog: brand, model, bodyType, fuel options, trims, price range (€), year range
const BASE_MODELS = [
  { brand: 'Volvo', model: 'XC60', bodyType: 'suv', fuels: ['bensiini', 'hybridi', 'ladattava hybridi'], trims: ['Momentum', 'Inscription', 'R-Design'], price: [32000, 58000], years: [2018, 2024] },
  { brand: 'Volvo', model: 'V60', bodyType: 'combi', fuels: ['bensiini', 'diesel', 'ladattava hybridi'], trims: ['Momentum', 'Inscription'], price: [26000, 48000], years: [2017, 2024] },
  { brand: 'Volvo', model: 'V90', bodyType: 'combi', fuels: ['diesel', 'ladattava hybridi'], trims: ['Momentum', 'Inscription'], price: [34000, 62000], years: [2017, 2024] },
  { brand: 'Toyota', model: 'RAV4', bodyType: 'suv', fuels: ['hybridi', 'ladattava hybridi'], trims: ['Active', 'Style', 'Premium'], price: [28000, 49000], years: [2019, 2024] },
  { brand: 'Toyota', model: 'Corolla', bodyType: 'sedan', fuels: ['hybridi', 'bensiini'], trims: ['Active', 'Style'], price: [21000, 34000], years: [2018, 2024] },
  { brand: 'Toyota', model: 'Yaris', bodyType: 'hatchback', fuels: ['hybridi', 'bensiini'], trims: ['Active', 'Style'], price: [17000, 27000], years: [2018, 2024] },
  { brand: 'Skoda', model: 'Octavia', bodyType: 'combi', fuels: ['bensiini', 'diesel'], trims: ['Ambition', 'Style', 'RS'], price: [20000, 38000], years: [2017, 2024] },
  { brand: 'Skoda', model: 'Kodiaq', bodyType: 'suv', fuels: ['bensiini', 'diesel'], trims: ['Ambition', 'Style', 'Sportline'], price: [27000, 46000], years: [2018, 2024] },
  { brand: 'Skoda', model: 'Fabia', bodyType: 'hatchback', fuels: ['bensiini'], trims: ['Ambition', 'Style'], price: [15000, 24000], years: [2018, 2024] },
  { brand: 'Volkswagen', model: 'Passat', bodyType: 'combi', fuels: ['bensiini', 'diesel'], trims: ['Business', 'Elegance'], price: [18000, 36000], years: [2015, 2023] },
  { brand: 'Volkswagen', model: 'Tiguan', bodyType: 'suv', fuels: ['bensiini', 'diesel', 'ladattava hybridi'], trims: ['Life', 'Elegance', 'R-Line'], price: [26000, 47000], years: [2018, 2024] },
  { brand: 'Volkswagen', model: 'Golf', bodyType: 'hatchback', fuels: ['bensiini', 'diesel'], trims: ['Life', 'Style', 'GTI'], price: [18000, 35000], years: [2017, 2024] },
  { brand: 'BMW', model: '320', bodyType: 'sedan', fuels: ['bensiini', 'diesel'], trims: ['Business', 'M Sport'], price: [24000, 44000], years: [2016, 2023] },
  { brand: 'BMW', model: 'X3', bodyType: 'suv', fuels: ['diesel', 'ladattava hybridi'], trims: ['Business', 'M Sport'], price: [32000, 55000], years: [2018, 2024] },
  { brand: 'Ford', model: 'Kuga', bodyType: 'suv', fuels: ['ladattava hybridi', 'hybridi', 'diesel'], trims: ['Titanium', 'ST-Line'], price: [22000, 40000], years: [2018, 2024] },
  { brand: 'Ford', model: 'Focus', bodyType: 'hatchback', fuels: ['bensiini', 'diesel'], trims: ['Titanium', 'ST-Line'], price: [15000, 28000], years: [2017, 2023] },
  { brand: 'Kia', model: 'Niro', bodyType: 'suv', fuels: ['hybridi', 'ladattava hybridi', 'sähkö'], trims: ['Motion', 'Premium'], price: [25000, 42000], years: [2019, 2024] },
  { brand: 'Kia', model: 'Sportage', bodyType: 'suv', fuels: ['bensiini', 'hybridi', 'diesel'], trims: ['Motion', 'Premium', 'GT-Line'], price: [26000, 44000], years: [2019, 2024] },
  { brand: 'Hyundai', model: 'Tucson', bodyType: 'suv', fuels: ['hybridi', 'ladattava hybridi', 'diesel'], trims: ['Comfort', 'Style', 'N Line'], price: [26000, 45000], years: [2019, 2024] },
  { brand: 'Hyundai', model: 'i30', bodyType: 'hatchback', fuels: ['bensiini', 'diesel'], trims: ['Comfort', 'Style'], price: [16000, 28000], years: [2018, 2023] },
  { brand: 'Nissan', model: 'Qashqai', bodyType: 'suv', fuels: ['bensiini', 'hybridi'], trims: ['Acenta', 'Tekna'], price: [22000, 39000], years: [2018, 2024] },
  { brand: 'Nissan', model: 'Leaf', bodyType: 'hatchback', fuels: ['sähkö'], trims: ['Acenta', 'Tekna'], price: [18000, 33000], years: [2018, 2023] },
  { brand: 'Mercedes-Benz', model: 'GLC', bodyType: 'suv', fuels: ['diesel', 'ladattava hybridi'], trims: ['Business', 'AMG Line'], price: [36000, 62000], years: [2018, 2024] },
  { brand: 'Mercedes-Benz', model: 'C-Class', bodyType: 'sedan', fuels: ['bensiini', 'diesel'], trims: ['Business', 'AMG Line'], price: [28000, 50000], years: [2017, 2024] },
  { brand: 'Audi', model: 'Q5', bodyType: 'suv', fuels: ['diesel', 'ladattava hybridi'], trims: ['Business', 'S line'], price: [34000, 58000], years: [2018, 2024] },
  { brand: 'Audi', model: 'A4', bodyType: 'sedan', fuels: ['bensiini', 'diesel'], trims: ['Business', 'S line'], price: [26000, 46000], years: [2017, 2024] },
  { brand: 'Peugeot', model: '3008', bodyType: 'suv', fuels: ['bensiini', 'diesel', 'ladattava hybridi'], trims: ['Active', 'Allure', 'GT'], price: [22000, 42000], years: [2018, 2024] },
  { brand: 'Peugeot', model: '208', bodyType: 'hatchback', fuels: ['bensiini', 'sähkö'], trims: ['Active', 'Allure'], price: [15000, 27000], years: [2019, 2024] },
  { brand: 'Mazda', model: 'CX-5', bodyType: 'suv', fuels: ['bensiini', 'diesel'], trims: ['Prime-Line', 'Exclusive-Line'], price: [24000, 40000], years: [2018, 2024] },
  { brand: 'Mazda', model: '3', bodyType: 'hatchback', fuels: ['bensiini'], trims: ['Prime-Line', 'Exclusive-Line'], price: [17000, 29000], years: [2018, 2024] },

  // Panel vans (N1-class, pakettiauto) — appended at the end rather than
  // interleaved among the passenger-car models above, so the RNG draws
  // already consumed for those (already-verified) models stay byte-for-byte
  // identical on regeneration; only new draws are appended past them.
  // Smaller variationCount (see below) targets ~15-20 units total, not the
  // ~10-14-per-model the passenger-car catalog uses — vans are a small,
  // distinct segment here, not a proportionally-sized one.
  { brand: 'Volkswagen', model: 'Transporter', bodyType: 'van', fuels: ['diesel'], trims: ['Business', 'Kombi', 'L2H1'], price: [18000, 38000], years: [2017, 2024] },
  { brand: 'Mercedes-Benz', model: 'Sprinter', bodyType: 'van', fuels: ['diesel'], trims: ['Business', 'L2H2', 'L3H2'], price: [20000, 42000], years: [2017, 2024] },
  { brand: 'Renault', model: 'Trafic', bodyType: 'van', fuels: ['diesel', 'bensiini'], trims: ['Business', 'Grand Confort'], price: [15000, 32000], years: [2016, 2024] },
  { brand: 'Citroën', model: 'Berlingo', bodyType: 'van', fuels: ['diesel', 'bensiini', 'sähkö'], trims: ['Live', 'Driver', 'XL'], price: [14000, 30000], years: [2018, 2024] },
];

// Real photo per brand+model (not per vehicle — every year/trim/color
// variation of the same model shares one illustrative photo), sourced from
// Wikimedia Commons under free licenses and checked into assets/cars/ so the
// demo stays offline/deterministic, same property the old emoji-icon
// approach was protecting. See assets/cars/CREDITS.md for author/license
// per file. Keyed by "brand|model" — verified unique across BASE_MODELS.
const IMAGES = {
  'Volvo|XC60': 'assets/cars/volvo-xc60.jpg',
  'Volvo|V60': 'assets/cars/volvo-v60.jpg',
  'Volvo|V90': 'assets/cars/volvo-v90.jpg',
  'Toyota|RAV4': 'assets/cars/toyota-rav4.jpg',
  'Toyota|Corolla': 'assets/cars/toyota-corolla.jpg',
  'Toyota|Yaris': 'assets/cars/toyota-yaris.jpg',
  'Skoda|Octavia': 'assets/cars/skoda-octavia.jpg',
  'Skoda|Kodiaq': 'assets/cars/skoda-kodiaq.jpg',
  'Skoda|Fabia': 'assets/cars/skoda-fabia.jpg',
  'Volkswagen|Passat': 'assets/cars/volkswagen-passat.jpg',
  'Volkswagen|Tiguan': 'assets/cars/volkswagen-tiguan.jpg',
  'Volkswagen|Golf': 'assets/cars/volkswagen-golf.jpg',
  'BMW|320': 'assets/cars/bmw-320.jpg',
  'BMW|X3': 'assets/cars/bmw-x3.jpg',
  'Ford|Kuga': 'assets/cars/ford-kuga.jpg',
  'Ford|Focus': 'assets/cars/ford-focus.jpg',
  'Kia|Niro': 'assets/cars/kia-niro.jpg',
  'Kia|Sportage': 'assets/cars/kia-sportage.jpg',
  'Hyundai|Tucson': 'assets/cars/hyundai-tucson.jpg',
  'Hyundai|i30': 'assets/cars/hyundai-i30.jpg',
  'Nissan|Qashqai': 'assets/cars/nissan-qashqai.jpg',
  'Nissan|Leaf': 'assets/cars/nissan-leaf.jpg',
  'Mercedes-Benz|GLC': 'assets/cars/mercedes-benz-glc.jpg',
  'Mercedes-Benz|C-Class': 'assets/cars/mercedes-benz-c-class.jpg',
  'Audi|Q5': 'assets/cars/audi-q5.jpg',
  'Audi|A4': 'assets/cars/audi-a4.jpg',
  'Peugeot|3008': 'assets/cars/peugeot-3008.jpg',
  'Peugeot|208': 'assets/cars/peugeot-208.jpg',
  'Mazda|CX-5': 'assets/cars/mazda-cx-5.jpg',
  'Mazda|3': 'assets/cars/mazda-3.jpg',
  'Volkswagen|Transporter': 'assets/cars/volkswagen-transporter.jpg',
  'Mercedes-Benz|Sprinter': 'assets/cars/mercedes-benz-sprinter.jpg',
  'Renault|Trafic': 'assets/cars/renault-trafic.jpg',
  'Citroën|Berlingo': 'assets/cars/citroen-berlingo.jpg',
};

const FAMILY_BODY_TYPES = new Set(['suv', 'combi', 'mpv']);
const HIGH_TRIM_KEYWORDS = /Inscription|R-Design|Premium|RS|Sportline|R-Line|M Sport|ST-Line|GT-Line|N Line|AMG Line|S line|GT|Exclusive-Line|Style|Elegance|Tekna/;

function buildVehicle(id, base, year, trim, fuel) {
  const yearsSpan = base.years[1] - base.years[0];
  const ageFactor = yearsSpan > 0 ? (year - base.years[0]) / yearsSpan : 1; // 0 = oldest, 1 = newest

  // Mileage: newer -> lower km, with jitter. Oldest cars ~140-180k, newest ~5-25k.
  const baseMileage = Math.round(150000 - ageFactor * 130000);
  const mileage = Math.max(2000, jitter(baseMileage, 0.25));

  // Price: base range adjusted by how new/high-trim the car is, plus jitter.
  const [priceMin, priceMax] = base.price;
  const trimBoost = HIGH_TRIM_KEYWORDS.test(trim) ? 0.15 : 0;
  const priceBase = priceMin + (priceMax - priceMin) * Math.min(1, ageFactor + trimBoost);
  const price = Math.max(priceMin, jitter(Math.round(priceBase), 0.08));

  // Monthly payment derived FROM price (not independently randomized) —
  // a simple amortization-style estimate: 60 months, ~5.5% APR flat approximation.
  const estimatedMonthlyPayment = Math.round((price * 1.15) / 60 / 10) * 10;

  const financeAvailable = rng() < 0.9;
  const transmission = base.bodyType === 'suv' || price > 30000
    ? pickWeighted([['Automaatti', 0.75], ['Manuaali', 0.25]])
    : pickWeighted([['Manuaali', 0.55], ['Automaatti', 0.45]]);
  const availability = pickWeighted([['available', 0.7], ['reserved', 0.2], ['incoming', 0.1]]);
  const familyFriendly = FAMILY_BODY_TYPES.has(base.bodyType);
  const dealershipLocation = pick(CITIES);
  const color = pickWeighted(COLORS);
  // ALV-vähennyskelpoisuus is a legal-category property of N1-class panel
  // vans, not a per-vehicle variable one — every van qualifies (subject to
  // the actual driving-log/business-use conditions, spelled out in the UI
  // caveat text, not implied as an unconditional guarantee). Passenger cars
  // deliberately get no equivalent field: their VAT deductibility depends
  // entirely on how the specific owner uses the specific car (taxi, driving
  // school, dealer demo stock...), not on anything the vehicle record itself
  // could state truthfully.
  const vatDeductible = base.bodyType === 'van';

  const tags = [];
  if (base.bodyType === 'suv') tags.push('suv');
  if (familyFriendly) tags.push('family');
  if (fuel === 'hybridi' || fuel === 'ladattava hybridi') tags.push('hybrid');
  if (fuel === 'sähkö') tags.push('ev');
  if (financeAvailable) tags.push('financing');
  if (price < 25000) tags.push('budget');
  if (HIGH_TRIM_KEYWORDS.test(trim)) tags.push('safety');

  const featureCount = HIGH_TRIM_KEYWORDS.test(trim) ? randInt(7, 11) : randInt(4, 7);
  const shuffled = [...FEATURE_POOL].sort(() => rng() - 0.5);
  const features = shuffled.slice(0, featureCount);

  const image = IMAGES[`${base.brand}|${base.model}`];
  if (!image) throw new Error(`No photo mapped for ${base.brand} ${base.model} — add it to IMAGES`);

  return {
    id: `veh-${String(id).padStart(4, '0')}`,
    brand: base.brand,
    model: base.model,
    trim,
    year,
    price,
    estimatedMonthlyPayment,
    fuel,
    bodyType: base.bodyType,
    mileage,
    color,
    transmission,
    familyFriendly,
    financeAvailable,
    vatDeductible,
    available: availability,
    dealershipLocation,
    features,
    tags,
    image,
  };
}

function generate() {
  const vehicles = [];
  let id = 1;
  for (const base of BASE_MODELS) {
    // Deterministic but not a fixed round number per model — a real DMS feed
    // never lines up to an exact 12 units of every model, and a suspiciously
    // even split (e.g. exactly 36/24 per brand) reads as synthetic to
    // anyone reviewing the dataset closely. Still fully reproducible: same
    // seed, same draw from the same rng stream, same result every time.
    const variationCount = base.bodyType === 'van' ? randInt(4, 5) : randInt(10, 14);
    for (let v = 0; v < variationCount; v++) {
      const year = randInt(base.years[0], base.years[1]);
      const trim = pick(base.trims);
      const fuel = pick(base.fuels);
      vehicles.push(buildVehicle(id++, base, year, trim, fuel));
    }
  }
  // Stable ordering for reviewable diffs on regeneration.
  vehicles.sort((a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model) || a.year - b.year);
  // Re-sequence ids after sort so they read in the same order as the file.
  vehicles.forEach((v, i) => { v.id = `veh-${String(i + 1).padStart(4, '0')}`; });
  return vehicles;
}

const vehicles = generate();

if (vehicles.length < 300 || vehicles.length > 500) {
  throw new Error(`Generated ${vehicles.length} vehicles — outside the required 300-500 range. Adjust BASE_MODELS or variationCount.`);
}

const outPath = path.join(__dirname, '..', 'inventory.json');
fs.writeFileSync(outPath, JSON.stringify(vehicles, null, 2) + '\n');
console.log(`Generated ${vehicles.length} vehicles -> ${outPath} (seed ${SEED})`);
