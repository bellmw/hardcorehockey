/**
 * leagueManager.js
 * Handles schedule generation, standings, playoffs, and promotion/relegation.
 */

// ─── Schedule Generation ──────────────────────────────────────────────────────

/**
 * Generates a balanced 20-game regular season schedule for a 12-team league.
 * Each team plays every other team at least once, with rematches to reach 20.
 * @param {Array} teams - array of team objects in the league
 * @param {string} leagueId - 'phl' | 'cd' | 'rc'
 * @returns {Array} games - sorted chronologically, assigned to weeks 1-20
 */
export function generateSchedule(teams, leagueId) {
  const teamIds = teams.map(t => t.id);
  const games = [];
  let gameId = 0;

  // Round-robin (each team plays each other once = 11 games per team, 66 total games)
  for (let i = 0; i < teamIds.length; i++) {
    for (let j = i + 1; j < teamIds.length; j++) {
      games.push({
        id: `${leagueId}_g${gameId++}`,
        homeTeamId: teamIds[i],
        awayTeamId: teamIds[j],
        played: false,
        result: null,
      });
    }
  }

  // Shuffle and add rematches until every team has ~20 games
  // Simple approach: shuffle the pool and take rematches from a second round-robin
  const rematches = shuffleArray(games.map(g => ({
    ...g,
    id: `${leagueId}_g${gameId++}`,
    homeTeamId: g.awayTeamId, // flip home/away for rematch
    awayTeamId: g.homeTeamId,
  })));

  // Count games per team and add rematches until target hit
  const gameCounts = {};
  teamIds.forEach(id => { gameCounts[id] = 0; });
  games.forEach(g => {
    gameCounts[g.homeTeamId]++;
    gameCounts[g.awayTeamId]++;
  });

  for (const rematch of rematches) {
    if (gameCounts[rematch.homeTeamId] >= 20 && gameCounts[rematch.awayTeamId] >= 20) continue;
    if (gameCounts[rematch.homeTeamId] >= 20 || gameCounts[rematch.awayTeamId] >= 20) continue;
    games.push(rematch);
    gameCounts[rematch.homeTeamId]++;
    gameCounts[rematch.awayTeamId]++;
  }

  // Assign week numbers (roughly 1 game per week per team)
  const shuffled = shuffleArray(games);
  return shuffled.map((game, idx) => ({
    ...game,
    week: Math.floor(idx / 6) + 1, // ~6 games per week across the league
    leagueId,
  }));
}

// ─── Standings ────────────────────────────────────────────────────────────────

/**
 * Creates a fresh standings entry for a team.
 */
export function createStandingsEntry(teamId) {
  return {
    teamId,
    gp: 0, w: 0, l: 0, otl: 0,
    pts: 0, gf: 0, ga: 0,
    get gd() { return this.gf - this.ga; },
  };
}

/**
 * Updates standings after a game result.
 * @param {Object} standings - { [teamId]: standingsEntry }
 * @param {Object} result    - from gameEngine.simulateGame()
 * @returns {Object} updated standings
 */
export function updateStandings(standings, result) {
  const s = { ...standings };

  const home = { ...s[result.homeTeamId] };
  const away = { ...s[result.awayTeamId] };

  home.gp++; away.gp++;
  home.gf += result.homeGoals; home.ga += result.awayGoals;
  away.gf += result.awayGoals; away.ga += result.homeGoals;

  if (result.homeGoals > result.awayGoals) {
    // Home win (regulation or OT or SO)
    home.w++; home.pts += 2;
    if (result.overtimeType) {
      away.otl++; away.pts += 1;
    } else {
      away.l++;
    }
  } else {
    // Away win
    away.w++; away.pts += 2;
    if (result.overtimeType) {
      home.otl++; home.pts += 1;
    } else {
      home.l++;
    }
  }

  s[result.homeTeamId] = home;
  s[result.awayTeamId] = away;
  return s;
}

/**
 * Sorts standings by: points → wins → goal differential.
 * @param {Object} standings - { [teamId]: standingsEntry }
 * @returns {Array} sorted array of standingsEntry
 */
export function sortStandings(standings) {
  return Object.values(standings).sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.w !== a.w) return b.w - a.w;
    return (b.gf - b.ga) - (a.gf - a.ga);
  });
}

// ─── Playoffs ─────────────────────────────────────────────────────────────────

/**
 * Returns the four playoff teams for a league (top 4 from standings).
 * Bracket: (1 vs 4), (2 vs 3) → winners meet in final.
 * @param {Object} standings
 * @returns {Object} bracket
 */
export function buildPlayoffBracket(standings) {
  const sorted = sortStandings(standings);
  const [p1, p2, p3, p4, p5, p6, p7, p8] = sorted.slice(0, 8);
  return {
    // First round matchups: 1vs8, 2vs7, 3vs6, 4vs5
    firstRoundA: { topSeed: p1.teamId, bottomSeed: p8.teamId, result: null },
    firstRoundB: { topSeed: p2.teamId, bottomSeed: p7.teamId, result: null },
    firstRoundC: { topSeed: p3.teamId, bottomSeed: p6.teamId, result: null },
    firstRoundD: { topSeed: p4.teamId, bottomSeed: p5.teamId, result: null },
    // Semifinals (winners advance)
    semifinalA:  { teamA: null, teamB: null, result: null },
    semifinalB:  { teamA: null, teamB: null, result: null },
    // Finals
    final:       { teamA: null, teamB: null, result: null },
    champion:    null,
  };
}

// ─── Promotion & Relegation ───────────────────────────────────────────────────

/**
 * Determines promotion/relegation outcomes after the season.
 * @param {Object} phlStandings
 * @param {Object} cdStandings
 * @param {Object} rcStandings
 * @returns {Object} - lists of promoted, relegated, and playoff teams
 */
export function determineRelegation(phlStandings, cdStandings, rcStandings) {
  const phlSorted = sortStandings(phlStandings);
  const cdSorted  = sortStandings(cdStandings);
  const rcSorted  = sortStandings(rcStandings);

  const phlLen = phlSorted.length;
  const cdLen  = cdSorted.length;

  return {
    // PHL → CD: bottom 2 auto-relegated, 3rd-from-bottom in survival playoff
    phlRelegated: [
      phlSorted[phlLen - 2].teamId,
      phlSorted[phlLen - 1].teamId,
    ],
    phlSurvivalPlayoff: {
      stay:   phlSorted[phlLen - 3].teamId, // survives if wins
      threat: cdSorted[2].teamId,           // 3rd in CD promoted if wins
    },

    // CD → PHL: top 2 auto-promoted
    cdPromoted: [cdSorted[0].teamId, cdSorted[1].teamId],

    // CD → RC: bottom 2 auto-relegated, 3rd-from-bottom in survival playoff
    cdRelegated: [
      cdSorted[cdLen - 2].teamId,
      cdSorted[cdLen - 1].teamId,
    ],
    cdSurvivalPlayoff: {
      stay:   cdSorted[cdLen - 3].teamId,
      threat: rcSorted[2].teamId,
    },

    // RC → CD: top 2 auto-promoted
    rcPromoted: [rcSorted[0].teamId, rcSorted[1].teamId],
  };
}

// ─── Salary Cap ───────────────────────────────────────────────────────────────

const BASE_CAP = 75_000_000;
const CAP_GROWTH_RATE = 1.20;

export function getSalaryCap(year) {
  return Math.round((BASE_CAP * Math.pow(CAP_GROWTH_RATE, Math.max(0, year - 1))) / 50_000) * 50_000;
}

export function getTeamCapUsed(team, allPlayers) {
  return (team.rosterIds || [])
    .map(id => allPlayers[id])
    .filter(Boolean)
    .reduce((sum, p) => sum + (p.salary || 0), 0);
}

export function isTeamOverCap(team, allPlayers, year) {
  return getTeamCapUsed(team, allPlayers) > getSalaryCap(year);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
