// Suggested audiences for Tasty Food's ads.
//
// These are starting points built from what this business actually sells and
// who it actually recruits — not generic advice. Facebook's own optimiser beats
// hand-picked interests once it has conversions to learn from, so every preset
// here is deliberately broad rather than a long stack of narrow interests: a
// tightly stacked audience starves the algorithm and costs more per lead.
//
// Each preset says what it is FOR. An audience that is wrong for the offer is
// the most expensive mistake in advertising, and no amount of budget fixes it.

export interface TargetingPreset {
  key: string;
  label: string;
  audience: string; // DISTRIBUTOR | RESELLER | CONSUMER | FOODSERVICE
  goal: string;
  ageMin: number;
  ageMax: number;
  genders: 'ALL' | 'MALE' | 'FEMALE';
  locations: string[];
  interests: string[];
  behaviours: string[];
  placements: string[];
  why: string;
  watchOut: string;
}

export const TARGETING_PRESETS: TargetingPreset[] = [
  {
    key: 'PROVINCIAL_CITY',
    label: 'Provincial / City Distributor',
    audience: 'DISTRIBUTOR',
    goal: 'Find people with real capital who can hold stock and supply a territory.',
    ageMin: 28,
    ageMax: 55,
    genders: 'ALL',
    locations: ['Philippines — provinces you have not yet appointed'],
    interests: [
      'Small business',
      'Entrepreneurship',
      'Business opportunity',
      'Distribution (business)',
      'Franchising',
    ],
    behaviours: ['Small business owners', 'Facebook Page admins'],
    placements: ['Facebook Feed', 'Instagram Feed', 'Facebook Reels'],
    why:
      'A distributor needs ₱50,000–₱100,000 and somewhere to store stock, so the audience skews older and already running something. Page admins and small business owners are the closest Facebook gets to "already sells things for a living".',
    watchOut:
      'Exclude provinces you have already appointed, or you pay for leads you have to turn away — and a rejected applicant in a covered area is a wasted ad spend twice over.',
  },
  {
    key: 'RESELLER_HOME',
    label: 'Reseller — home-based sellers',
    audience: 'RESELLER',
    goal: 'The ₱5,000 entry: people who want extra income without leaving home.',
    ageMin: 22,
    ageMax: 50,
    genders: 'FEMALE',
    locations: ['Philippines — nationwide, or your open provinces'],
    interests: [
      'Online selling',
      'Sari-sari store',
      'Home business',
      'Direct selling',
      'Extra income',
    ],
    behaviours: ['Engaged shoppers', 'Facebook Marketplace users'],
    placements: ['Facebook Feed', 'Facebook Reels', 'Instagram Reels', 'Facebook Stories'],
    why:
      'This is the audience your best-performing ad already found — the "own brand of spreads" post. Home-based reselling in the Philippines skews strongly female and mobile-first, which is why Reels and Stories belong here and not on the distributor preset.',
    watchOut:
      'Do not stack more than four or five interests. Each one you add narrows the pool and pushes the cost per lead up; broad plus a good hook beats a clever interest list.',
  },
  {
    key: 'CONSUMER_RETAIL',
    label: 'Retail buyers — JuanPalaman',
    audience: 'CONSUMER',
    goal: 'Sell jars, not distributorships. Households that buy peanut butter.',
    ageMin: 25,
    ageMax: 55,
    genders: 'FEMALE',
    locations: ['Cities where your distributors already have stock on shelves'],
    interests: ['Peanut butter', 'Baking', 'Cooking', 'Grocery shopping', 'Filipino food'],
    behaviours: ['Engaged shoppers'],
    placements: ['Facebook Feed', 'Instagram Feed', 'Facebook Reels'],
    why:
      'Sixty per cent of Filipino households buy this category. The buying decision is usually made by whoever does the grocery run, which is why this one is narrower on gender than the recruitment presets.',
    watchOut:
      'Only run this where a distributor can actually supply. Demand you create in an unserved city is demand you hand to a competitor.',
  },
  {
    key: 'FOODSERVICE',
    label: 'Foodservice — Cielo’s bulk',
    audience: 'FOODSERVICE',
    goal: 'Bakeries, canteens and milk tea shops buying 1–20kg.',
    ageMin: 25,
    ageMax: 60,
    genders: 'ALL',
    locations: ['Metro Manila, Cavite, Laguna, Batangas — dense food-business areas'],
    interests: ['Bakery', 'Restaurant', 'Catering', 'Milk tea', 'Food business'],
    behaviours: ['Small business owners', 'Facebook Page admins'],
    placements: ['Facebook Feed', 'Instagram Feed'],
    why:
      'A bulk buyer is a business, not a household — the message is cost per kilo and consistency, not taste. Reels rarely work here; these people are on Facebook to run a business, not to browse.',
    watchOut:
      'Bulk buyers convert slowly and by message, not by form. Judge this audience on conversations started, not on same-day leads.',
  },
  {
    key: 'WELLNESS_STEVIA',
    label: 'Wellness — Cielo’s with Stevia',
    audience: 'CONSUMER',
    goal: 'The no-sugar-added line, to people already avoiding sugar.',
    ageMin: 28,
    ageMax: 60,
    genders: 'ALL',
    locations: ['Metro Manila and provincial city centres'],
    interests: ['Healthy eating', 'Diabetes awareness', 'Keto diet', 'Fitness and wellness', 'Sugar-free'],
    behaviours: ['Engaged shoppers'],
    placements: ['Facebook Feed', 'Instagram Feed'],
    why:
      'This is the one product with a reason to exist beyond taste, so it is the one where interest targeting genuinely helps. People managing sugar intake are actively looking.',
    watchOut:
      'Health claims are a regulated area and Facebook rejects ads that imply treatment of a condition. Say "no sugar added", never anything that sounds like a medical benefit.',
  },
];

// Brands the ads are run under, so the four can be read apart.
export const AD_BRANDS = [
  { key: 'TASTY_FOOD', label: 'Tasty Food', note: 'The company — recruitment and corporate.' },
  { key: 'JUANPALAMAN', label: 'JuanPalaman', note: 'Retail peanut butter line.' },
  { key: 'CIELOS', label: "Cielo's", note: 'Foodservice and wellness lines.' },
  { key: 'CHRISTIAN_E', label: 'Christian E.', note: 'Personal brand — founder-led content.' },
] as const;

export const AD_AUDIENCES = ['DISTRIBUTOR', 'RESELLER', 'CONSUMER', 'FOODSERVICE'] as const;
