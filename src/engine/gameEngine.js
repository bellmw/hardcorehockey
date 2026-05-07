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

  return {
    homeTeamId: homeTeam.id,
    awayTeamId: awayTeam.id,
    homeGoals,
    awayGoals,
    winner: winner.id,
    loser: loser.id,
    overtimeType,    // null | 'OT' | 'SO'
    highlights,
    // Points: W=2, OTL=1, L=0
    homePoints: homeGoals > awayGoals ? 2 : overtimeType ? 1 : 0,
    awayPoints: awayGoals > homeGoals ? 2 : overtimeType ? 1 : 0,
  };
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
