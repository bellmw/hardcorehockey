/**
 * playerGenerator.js
 * Creates, ages, and manages players.
 * Uses data/player-names.json for name pools.
 */

// ─── Player Generation ────────────────────────────────────────────────────────

const POSITIONS = ['C', 'LW', 'RW', 'LD', 'RD', 'G'];

// Roster composition: 12 forwards, 6 defence, 2 goalies (+ depth = 20 total)
const ROSTER_TEMPLATE = [
  'C','C','C','C',
  'LW','LW','LW','LW',
  'RW','RW','RW','RW',
  'LD','LD','LD',
  'RD','RD','RD',
  'G','G',
];

let playerIdCounter = 1;

/**
 * Generates a single player.
 * @param {Object} nameData - loaded player-names.json
 * @param {Object} options  - overrides: { position, tier, age, overall }
 * @returns {Object} player
 */
export function generatePlayer(nameData, options = {}) {
  const {
    position = pickWeightedPosition(),
    tier = 2,          // 1=PHL, 2=CD, 3=RC — affects overall range
    age = randomAge(),
  } = options;

  const overall = options.overall ?? generateOverall(tier, age);
  const salary  = calculateSalary(overall, age);
  const contractYears = randomContractLength(age);

  const firstName = pickFirstName(nameData);
  const lastName  = pickLastName(nameData);
  const trait     = pickRandom(nameData.traits);
  const nationality = pickWeightedNationality(nameData.nationalities);

  return {
    id: `p${String(playerIdCounter++).padStart(5, '0')}`,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    position,
    overall,
    age,
    salary,
    contractYears,
    nationality,
    trait,
    injured: false,
    injuredGames: 0,
    suspended: false,
    suspendedGames: 0,
    morale: 0,           // -5 to +5, affects effective overall by morale/2
    isRookie: age <= 20,
    // Development tracking
    potential: generatePotential(overall, age),
    seasonsInLeague: 0,
  };
}

/**
 * Generates a full 20-player roster for a team.
 * @param {Object} nameData
 * @param {number} tier - 1, 2, or 3
 * @returns {Array} players
 */
export function generateRoster(nameData, tier) {
  return ROSTER_TEMPLATE.map(position => generatePlayer(nameData, { position, tier }));
}

/**
 * Returns all active (non-injured, non-suspended) players for a team.
 */
export function getPlayersByTeam(team, allPlayers) {
  return (team.rosterIds || [])
    .map(id => allPlayers[id])
    .filter(Boolean);
}

export function getActivePlayers(team, allPlayers) {
  return getPlayersByTeam(team, allPlayers)
    .filter(p => !p.injured && !p.suspended);
}

// ─── Player Aging & Development ───────────────────────────────────────────────

/**
 * Ages all players by 1 year at season end.
 * Applies improvement/decline, handles retirements.
 * @param {Object} allPlayers - { [playerId]: player }
 * @returns {Object} { updatedPlayers, retiredPlayers }
 */
export function ageAllPlayers(allPlayers) {
  const updated = {};
  const retired = [];

  for (const [id, player] of Object.entries(allPlayers)) {
    const p = { ...player, age: player.age + 1, seasonsInLeague: player.seasonsInLeague + 1 };

    // Retirement check
    if (p.age >= 36) {
      const retireChance = 0.20 + (p.age - 36) * 0.15;
      if (Math.random() < retireChance) {
        retired.push(p);
        continue;
      }
    }

    // Youth development (18–24)
    if (p.age <= 24 && Math.random() < 0.30) {
      const improvement = Math.floor(Math.random() * 3) + 1; // +1 to +3
      p.overall = Math.min(p.potential, p.overall + improvement);
    }

    // Prime years — slight variance (25–29)
    if (p.age >= 25 && p.age <= 28) {
      p.overall += Math.round((Math.random() - 0.45) * 2);
      p.overall = Math.min(p.potential, Math.max(40, p.overall));
    }

    // Decline phase (30–34)
    if (p.age >= 30 && Math.random() < 0.25) {
      const decline = Math.floor(Math.random() * 2) + 1; // -1 to -2
      p.overall = Math.max(40, p.overall - decline);
    }

    // Heavy decline (35+)
    if (p.age >= 35 && Math.random() < 0.40) {
      p.overall = Math.max(38, p.overall - (Math.floor(Math.random() * 3) + 1));
    }

    // Tick down contract
    p.contractYears = Math.max(0, p.contractYears - 1);

    // Reset season-level statuses
    p.injured = false;
    p.injuredGames = 0;
    p.suspended = false;
    p.suspendedGames = 0;
    p.morale = Math.max(-2, Math.min(2, p.morale)); // morale regresses to 0

    updated[id] = p;
  }

  return { updatedPlayers: updated, retiredPlayers: retired };
}

// ─── Draft Class Generation ───────────────────────────────────────────────────

/**
 * Generates a draft class (3 rounds × 36 picks = 108 prospects).
 * Called at off-season start. Claude API can AUGMENT this with scouting blurbs.
 * @param {Object} nameData
 * @param {number} year
 * @returns {Array} prospects (unsorted — draft order applied later)
 */
export function generateDraftClass(nameData, year) {
  const prospects = [];

  // Round 1: higher potential players
  for (let i = 0; i < 36; i++) {
    const p = generatePlayer(nameData, {
      position: pickWeightedPosition(),
      tier: 2,
      age: 18 + Math.floor(Math.random() * 3), // 18–20
    });
    p.overall = randomInRange(52, 70);
    p.potential = randomInRange(p.overall + 5, Math.min(95, p.overall + 20));
    p.draftRound = 1;
    p.draftYear = year;
    p.scoutingBlurb = null; // filled in by Claude API
    prospects.push(p);
  }

  // Round 2: mid-range
  for (let i = 0; i < 36; i++) {
    const p = generatePlayer(nameData, {
      position: pickWeightedPosition(),
      tier: 3,
      age: 18 + Math.floor(Math.random() * 3),
    });
    p.overall = randomInRange(44, 60);
    p.potential = randomInRange(p.overall + 3, Math.min(85, p.overall + 15));
    p.draftRound = 2;
    p.draftYear = year;
    p.scoutingBlurb = null;
    prospects.push(p);
  }

  // Round 3: developmental
  for (let i = 0; i < 36; i++) {
    const p = generatePlayer(nameData, {
      position: pickWeightedPosition(),
      tier: 3,
      age: 18 + Math.floor(Math.random() * 4),
    });
    p.overall = randomInRange(38, 52);
    p.potential = randomInRange(p.overall + 2, Math.min(78, p.overall + 12));
    p.draftRound = 3;
    p.draftYear = year;
    p.scoutingBlurb = null;
    prospects.push(p);
  }

  return prospects;
}

// ─── Salary Helpers ───────────────────────────────────────────────────────────

/**
 * Calculates asking salary based on overall rating and age.
 * Range: $500K (raw rookie) → $6M (elite veteran)
 */
export function calculateSalary(overall, age) {
  // Base salary from overall
  const baseSalary = Math.pow((overall - 40) / 55, 1.8) * 5_500_000 + 500_000;
  // Age modifier: prime age (27–30) commands a small premium
  const ageMultiplier = age >= 27 && age <= 30 ? 1.08 : age > 33 ? 0.9 : 1.0;
  // Round to nearest $50K
  return Math.round((baseSalary * ageMultiplier) / 50_000) * 50_000;
}

/**
 * Returns a display string for salary (e.g. "$2.1M").
 */
export function formatSalary(salary) {
  if (salary >= 1_000_000) return `$${(salary / 1_000_000).toFixed(1)}M`;
  return `$${(salary / 1_000).toFixed(0)}K`;
}

// ─── Free Agency ──────────────────────────────────────────────────────────────

/**
 * Returns players whose contractYears === 0 (free agents after season).
 */
export function getExpiringContracts(allPlayers) {
  return Object.values(allPlayers).filter(p => p.contractYears === 0);
}

/**
 * Generates the asking price for a free agent (slight premium on base salary).
 */
export function getFreAgentAskingSalary(player) {
  const premium = 1.0 + Math.random() * 0.15; // 0–15% premium
  return Math.round((player.salary * premium) / 50_000) * 50_000;
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function randomAge() {
  // Weighted toward mid-career (24–30)
  const weights = [3,4,6,8,9,10,10,9,8,7,6,5,4,3,2,1,1,1]; // 18–35
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return 18 + i;
  }
  return 28;
}

function generateOverall(tier, age) {
  // Tier 1 (PHL): 60–85 | Tier 2 (CD): 50–75 | Tier 3 (RC): 40–65
  const ranges = { 1: [60, 85], 2: [50, 75], 3: [40, 65] };
  const [min, max] = ranges[tier] || [50, 75];
  let overall = randomInRange(min, max);
  // Young players slightly worse; old players slightly declining
  if (age <= 20) overall = Math.max(min, overall - randomInRange(0, 8));
  if (age >= 33) overall = Math.max(min, overall - randomInRange(0, 6));
  return overall;
}

function generatePotential(overall, age) {
  if (age >= 30) return overall; // no upside
  const upside = Math.floor((30 - age) * 0.8 * Math.random() + 2);
  return Math.min(95, overall + upside);
}

function randomContractLength(age) {
  if (age >= 33) return Math.random() < 0.7 ? 1 : 2;
  if (age <= 22) return Math.random() < 0.5 ? 2 : 3;
  return Math.floor(Math.random() * 3) + 1; // 1–3
}

function pickWeightedPosition() {
  // Roughly realistic distribution
  const pool = ['C','C','C','LW','LW','LW','RW','RW','RW','LD','LD','RD','RD','G'];
  return pickRandom(pool);
}

function pickFirstName(nameData) {
  const pools = [
    ...nameData.firstNames.common,
    ...nameData.firstNames.french,
    ...nameData.firstNames.scandinavian,
    ...nameData.firstNames.eastern_european,
    ...(Math.random() < 0.1 ? nameData.firstNames.funny : []),
  ];
  return pickRandom(pools);
}

function pickLastName(nameData) {
  const pools = [
    ...nameData.lastNames.common,
    ...nameData.lastNames.french_canadian,
    ...nameData.lastNames.scandinavian,
    ...nameData.lastNames.eastern_european,
    ...nameData.lastNames.ukrainian_canadian,
    ...nameData.lastNames.northern_ontario,
  ];
  return pickRandom(pools);
}

function pickWeightedNationality(nationalities) {
  const total = nationalities.reduce((s, n) => s + n.weight, 0);
  let r = Math.random() * total;
  for (const n of nationalities) {
    r -= n.weight;
    if (r <= 0) return n.code;
  }
  return 'CAN';
}

function randomInRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}
