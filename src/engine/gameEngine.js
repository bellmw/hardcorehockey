/**
 * gameEngine.js
 * Simulates individual hockey games. No Claude API calls here — runs fast.
 */

import { getPlayersByTeam } from './playerGenerator.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const HOME_ICE_BONUS = 3;       // added to home team offense rating
const MIN_EXPECTED_GOALS = 0.5;
const MAX_EXPECTED_GOALS = 6.0;

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Simulates a single game between two teams.
 * @param {Object} homeTeam  - team object from game state
 * @param {Object} awayTeam  - team object from game state
 * @param {Object} allPlayers - full player map { [playerId]: playerObject }
 * @returns {Object} result
 */
export function simulateGame(homeTeam, awayTeam, allPlayers) {
  const homeRatings = calculateTeamRatings(homeTeam, allPlayers);
  const awayRatings = calculateTeamRatings(awayTeam, allPlayers);

  // Simulate goals
  let homeGoals = sampleGoals(homeRatings.offense + HOME_ICE_BONUS, awayRatings.defense, awayRatings.goalie);
  let awayGoals = sampleGoals(awayRatings.offense, homeRatings.defense, homeRatings.goalie);

  let overtimeType = null;

  // Tied after regulation → OT / SO
  if (homeGoals === awayGoals) {
    const otResult = resolveOvertimeAndShootout(homeTeam, awayTeam, homeRatings, awayRatings);
    if (otResult.winner === 'home') {
      homeGoals += 1;
      overtimeType = otResult.type;
    } else {
      awayGoals += 1;
      overtimeType = otResult.type;
    }
  }

  const winner = homeGoals > awayGoals ? homeTeam : awayTeam;
  const loser  = homeGoals > awayGoals ? awayTeam  : homeTeam;

  // Pick standout players for highlights
  const homePlayers = getActivePlayers(homeTeam, allPlayers);
  const awayPlayers  = getActivePlayers(awayTeam,  allPlayers);

  const highlights = generateHighlights(
    homeTeam, awayTeam,
    homeGoals, awayGoals,
    homePlayers, awayPlayers,
    overtimeType
  );

  // Per-period goal distribution (regulation only; OT goal added to period 4)
  const homePeriods = splitGoalsAcrossPeriods(
    overtimeType ? homeGoals - (homeGoals > awayGoals && overtimeType ? 1 : 0) : homeGoals
  );
  const awayPeriods = splitGoalsAcrossPeriods(
    overtimeType ? awayGoals - (awayGoals > homeGoals && overtimeType ? 1 : 0) : awayGoals
  );
  if (overtimeType) {
    if (homeGoals > awayGoals) homePeriods.push(1), awayPeriods.push(0);
    else                       homePeriods.push(0), awayPeriods.push(1);
  }

  // Estimated shots: realistic range 22–40, influenced by team offense rating
  // offense is typically 55–80; we use a small modifier so variance dominates
  const homeShots = Math.round(clamp(24 + Math.random() * 14 + (homeRatings.offense - 65) * 0.25, 20, 42));
  const awayShots = Math.round(clamp(24 + Math.random() * 14 + (awayRatings.offense - 65) * 0.25, 20, 42));

  // Stars of the game: 1st star (winning team top fwd), 2nd star (best goalie), 3rd star (losing top fwd)
  const winnerPlayers = homeGoals > awayGoals ? homePlayers : awayPlayers;
  const loserPlayers  = homeGoals > awayGoals ? awayPlayers  : homePlayers;
  const winnerTeam    = homeGoals > awayGoals ? homeTeam : awayTeam;
  const loserTeam     = homeGoals > awayGoals ? awayTeam  : homeTeam;
  const topFwd    = [...winnerPlayers].filter(p => p.position !== 'G').sort((a, b) => b.overall - a.overall)[0];
  const topGoalie = [...homePlayers, ...awayPlayers].filter(p => p.position === 'G').sort((a, b) => b.overall - a.overall)[0];
  const topLoser  = [...loserPlayers].filter(p => p.position !== 'G').sort((a, b) => b.overall - a.overall)[0];
  const goalieTeam = topGoalie && homePlayers.includes(topGoalie) ? homeTeam : awayTeam;
  const stars = [
    topFwd    ? { player: topFwd,    teamId: winnerTeam.id } : null,
    topGoalie ? { player: topGoalie, teamId: goalieTeam.id } : null,
    topLoser  ? { player: topLoser,  teamId: loserTeam.id  } : null,
  ].filter(Boolean).slice(0, 3);

  return {
    homeTeamId: homeTeam.id,
    awayTeamId: awayTeam.id,
    homeGoals,
    awayGoals,
    winner: winner.id,
    loser: loser.id,
    overtimeType,    // null | 'OT' | 'SO'
    highlights,
    homePeriods,     // e.g. [1, 2, 0] or [1, 2, 0, 1] if OT
    awayPeriods,
    homeShots,
    awayShots,
    stars,           // array of player objects (up to 3)
    // Points: W=2, OTL=1, L=0
    homePoints: homeGoals > awayGoals ? 2 : overtimeType ? 1 : 0,
    awayPoints: awayGoals > homeGoals ? 2 : overtimeType ? 1 : 0,
  };
}

/** Distributes N goals randomly across 3 regulation periods. */
function splitGoalsAcrossPeriods(total) {
  const periods = [0, 0, 0];
  for (let i = 0; i < total; i++) {
    periods[Math.floor(Math.random() * 3)]++;
  }
  return periods;
}
// ─── Season stat accumulation ─────────────────────────────────────────────────

/**
 * Generates per-player stat lines for a single game and returns a map of
 * { [playerId]: statDelta } to be merged into allPlayers[id].seasonStats.
 *
 * Skaters: gp, g, a, pts, pm
 * Goalies: gp, w, ga, sv, sa
 */
export function generateGameStats(homeTeam, awayTeam, result, allPlayers) {
  const { homeGoals, awayGoals, homeShots, awayShots } = result;
  const homePlayers = getActivePlayers(homeTeam, allPlayers);
  const awayPlayers = getActivePlayers(awayTeam, allPlayers);

  const homeSkaters = homePlayers.filter(p => p.position !== 'G');
  const awaySkaters = awayPlayers.filter(p => p.position !== 'G');
  const homeGoalie  = homePlayers.filter(p => p.position === 'G').sort((a, b) => b.overall - a.overall)[0];
  const awayGoalie  = awayPlayers.filter(p => p.position === 'G').sort((a, b) => b.overall - a.overall)[0];

  const deltas = {};

  const ensure = (id) => {
    if (!deltas[id]) deltas[id] = { gp: 0, g: 0, a: 0, pts: 0, pm: 0, w: 0, ga: 0, sv: 0, sa: 0 };
    return deltas[id];
  };

  // Each player played this game
  [...homePlayers, ...awayPlayers].forEach(p => { ensure(p.id).gp = 1; });

  // Distribute goals to skaters (weighted by OVR)
  const assignGoal = (scorers, assists) => {
    if (scorers.length === 0) return;
    const scorer = weightedPick(scorers);
    ensure(scorer.id).g++;
    ensure(scorer.id).pts++;
    // 0, 1 or 2 assists
    const numAssists = Math.random() < 0.15 ? 0 : Math.random() < 0.4 ? 1 : 2;
    const eligible = assists.filter(p => p.id !== scorer.id);
    for (let i = 0; i < Math.min(numAssists, eligible.length); i++) {
      const helper = weightedPick(eligible.filter((_, j) => j !== 0)); // rough pick
      if (helper) { ensure(helper.id).a++; ensure(helper.id).pts++; }
    }
  };

  for (let i = 0; i < homeGoals; i++) assignGoal(homeSkaters, homeSkaters);
  for (let i = 0; i < awayGoals; i++) assignGoal(awaySkaters, awaySkaters);

  // +/-: each home skater gets +(homeGoals - awayGoals), each away skater inverse
  const pm = homeGoals - awayGoals;
  homeSkaters.forEach(p => { ensure(p.id).pm += pm; });
  awaySkaters.forEach(p => { ensure(p.id).pm -= pm; });

  // Goalie stats
  const homeSaves = (awayShots ?? 0) - awayGoals;
  const awaySaves = (homeShots ?? 0) - homeGoals;

  if (homeGoalie) {
    ensure(homeGoalie.id).ga  += awayGoals;
    ensure(homeGoalie.id).sv  += Math.max(0, homeSaves);
    ensure(homeGoalie.id).sa  += awayShots ?? 0;
    if (homeGoals > awayGoals) ensure(homeGoalie.id).w++;
  }
  if (awayGoalie) {
    ensure(awayGoalie.id).ga  += homeGoals;
    ensure(awayGoalie.id).sv  += Math.max(0, awaySaves);
    ensure(awayGoalie.id).sa  += homeShots ?? 0;
    if (awayGoals > homeGoals) ensure(awayGoalie.id).w++;
  }

  return deltas;
}

/** Picks a random player weighted by overall rating. */
function weightedPick(players) {
  if (!players || players.length === 0) return null;
  const total = players.reduce((s, p) => s + p.overall, 0);
  let r = Math.random() * total;
  for (const p of players) {
    r -= p.overall;
    if (r <= 0) return p;
  }
  return players[players.length - 1];
}
// ─── Team Ratings ─────────────────────────────────────────────────────────────

/**
 * Calculates composite offense, defense, and goalie ratings for a team.
 * Injured / suspended players are excluded from the calculation.
 */
export function calculateTeamRatings(team, allPlayers) {
  const roster = getActivePlayers(team, allPlayers);

  const forwards   = roster.filter(p => ['C', 'LW', 'RW'].includes(p.position));
  const defensemen = roster.filter(p => ['LD', 'RD'].includes(p.position));
  const goalies    = roster.filter(p => p.position === 'G');

  // Use best available goalie
  const startingGoalie = goalies.sort((a, b) => b.overall - a.overall)[0];

  const offenseRating = forwards.length > 0
    ? avg(forwards.map(p => p.overall)) * 0.65 + avg(defensemen.map(p => p.overall)) * 0.35
    : 40;

  const defenseRating = defensemen.length > 0
    ? avg(defensemen.map(p => p.overall)) * 0.65 + avg(forwards.map(p => p.overall)) * 0.35
    : 40;

  const goalieRating = startingGoalie ? startingGoalie.overall : 40;

  return {
    offense: offenseRating,
    defense: defenseRating,
    goalie: goalieRating,
    startingGoalie,
    forwards,
    defensemen,
  };
}

// ─── Goal Simulation ──────────────────────────────────────────────────────────

/**
 * Samples a goal count from a rough Poisson-like approximation.
 * Uses a simple additive formula rather than a true Poisson for performance.
 */
function sampleGoals(offenseRating, opponentDefense, opponentGoalie) {
  // Base expected goals: difference in offense vs combined defense+goalie
  const combined = (opponentDefense * 0.5 + opponentGoalie * 0.5);
  let expected = (offenseRating - combined + 50) / 18;
  expected = clamp(expected, MIN_EXPECTED_GOALS, MAX_EXPECTED_GOALS);

  // Sample using approximated Poisson (sum of independent Bernoulli trials)
  let goals = 0;
  const trials = 12; // number of "scoring chances"
  const prob = expected / trials;

  for (let i = 0; i < trials; i++) {
    if (Math.random() < prob) goals++;
  }

  // Add slight variance — occasionally a team just has a great/terrible night
  const variance = Math.floor((Math.random() - 0.45) * 2);
  goals = Math.max(0, goals + variance);

  return goals;
}

/**
 * Resolves ties after regulation.
 * Returns { winner: 'home'|'away', type: 'OT'|'SO' }
 */
function resolveOvertimeAndShootout(homeTeam, awayTeam, homeRatings, awayRatings) {
  // OT: quick 5-min period. Home advantage slight edge.
  const homeOtProb = 0.52 + (homeRatings.offense - awayRatings.offense) / 400;
  const clampedProb = clamp(homeOtProb, 0.35, 0.65);

  // 70% chance OT produces a winner
  if (Math.random() < 0.70) {
    return {
      winner: Math.random() < clampedProb ? 'home' : 'away',
      type: 'OT',
    };
  }

  // Goes to shootout — essentially a coin flip with tiny skill adjustment
  const homeSOProb = 0.50 + (homeRatings.offense - awayRatings.offense) / 600;
  return {
    winner: Math.random() < clamp(homeSOProb, 0.40, 0.60) ? 'home' : 'away',
    type: 'SO',
  };
}

// ─── Highlights ───────────────────────────────────────────────────────────────

/**
 * Generates 2–3 template-based highlight strings.
 * Player names are injected — no Claude API call (for speed).
 */
function generateHighlights(homeTeam, awayTeam, homeGoals, awayGoals, homePlayers, awayPlayers, overtimeType) {
  const highlights = [];
  const winner = homeGoals > awayGoals ? homeTeam : awayTeam;
  const winnerPlayers = homeGoals > awayGoals ? homePlayers : awayPlayers;

  const topScorer = pickRandom(winnerPlayers.filter(p => p.position !== 'G')) || winnerPlayers[0];
  const topGoalie = pickRandom(homePlayers.concat(awayPlayers).filter(p => p.position === 'G'));
  const randomPlayer = pickRandom(awayPlayers.filter(p => p.position !== 'G'));

  const scorerName = topScorer ? `${topScorer.lastName}` : 'Unknown';
  const goalieName = topGoalie ? `${topGoalie.lastName}` : 'the netminder';
  const randomName = randomPlayer ? `${randomPlayer.lastName}` : 'a forward';

  const totalGoals = homeGoals + awayGoals;

  // Opening highlight — game narrative
  const gameTemplates = [
    `${winner.name} grind out a ${homeGoals}–${awayGoals} victory in a game with more whistles than chances.`,
    `${scorerName} leads the charge as ${winner.name} win ${homeGoals}–${awayGoals} in front of a patient crowd.`,
    `A ${totalGoals > 8 ? 'high-scoring' : totalGoals < 4 ? 'defensive' : 'competitive'} affair ends ${homeGoals}–${awayGoals} in favour of ${winner.name}.`,
    `${homeGoals}–${awayGoals}. ${winner.name} take the two points and don't look back.`,
  ];
  highlights.push(pickRandom(gameTemplates));

  // Goalie highlight
  if (Math.random() > 0.4 && topGoalie) {
    const savesEst = Math.floor(20 + Math.random() * 20);
    const goalieTemplates = [
      `${goalieName} stops ${savesEst} shots, some of them very deliberately.`,
      `A strong night for ${goalieName}, who made the difference when it mattered.`,
      `${goalieName} with a key stop in the third to preserve the lead.`,
      `${goalieName} kept ${randomName} off the scoresheet all night.`,
    ];
    highlights.push(pickRandom(goalieTemplates));
  }

  // OT or SO highlight
  if (overtimeType === 'OT') {
    highlights.push(`${scorerName} ends it in overtime. The building went briefly wild.`);
  } else if (overtimeType === 'SO') {
    highlights.push(`After a shootout that went longer than anyone wanted, ${winner.name} take the extra point.`);
  } else if (Math.random() > 0.5) {
    // Bonus flavour
    const bonusTemplates = [
      `${randomName} was ejected in the second for a reason officials described as 'excessive.'`,
      `Two of the goals were scored by defencemen. Nobody predicted that.`,
      `The game was played in front of a crowd the PA announcer described as 'enthusiastic.'`,
      `${scorerName} added two assists and looked like he was barely trying.`,
      `The penalty kill went 4-for-4. That is, frankly, impressive.`,
    ];
    highlights.push(pickRandom(bonusTemplates));
  }

  return highlights;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getActivePlayers(team, allPlayers) {
  return (team.rosterIds || [])
    .map(id => allPlayers[id])
    .filter(p => p && !p.injured && !p.suspended);
}

function avg(arr) {
  if (!arr || arr.length === 0) return 50;
  return arr.reduce((sum, v) => sum + v, 0) / arr.length;
}

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function pickRandom(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}
