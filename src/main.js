/**
 * main.js
 * Game init, state machine, save/load, screen router.
 */

import { generateRoster, generatePlayer, generateDraftClass, ageAllPlayers, getExpiringContracts, formatSalary } from './engine/playerGenerator.js';
import { generateSchedule, updateStandings, sortStandings, createStandingsEntry,
         buildPlayoffBracket, determineRelegation, getSalaryCap, getTeamCapUsed } from './engine/leagueManager.js';
import { simulateGame, generateGameStats } from './engine/gameEngine.js';
import { generateHeadline, generateTradeOffer, generateCommissionerAnnouncement,
         generateRandomEvent, augmentDraftClass } from './api/claudeAgent.js';

// ─── State ────────────────────────────────────────────────────────────────────

let GAME_STATE = null;
let NAME_DATA  = null;
let TEAMS_DATA = null;

// ─── Boot ─────────────────────────────────────────────────────────────────────

/**
 * Entry point — called from index.html on DOMContentLoaded.
 */
export async function boot() {
  // Load static data
  [NAME_DATA, TEAMS_DATA] = await Promise.all([
    fetch('./data/player-names.json').then(r => r.json()),
    fetch('./data/teams.json').then(r => r.json()),
  ]);

  // Check for saved game
  const saved = loadGame();
  if (saved) {
    GAME_STATE = saved;
    showScreen('dashboard');
  } else {
    showScreen('team-select');
  }
}

// ─── New Game ─────────────────────────────────────────────────────────────────

/**
 * Initialises a brand new game.
 * @param {string} playerTeamId - the team the player chose to manage
 */
export async function newGame(playerTeamId) {
  const allTeams   = getAllTeams();
  const allPlayers = {};

  // Generate rosters for all 36 teams
  allTeams.forEach(team => {
    const tier    = team.tier; // from leagueId
    const roster  = generateRoster(NAME_DATA, tier);
    roster.forEach(p => { allPlayers[p.id] = p; });
    team.rosterIds = roster.map(p => p.id);
    team.tradablePicks = []; // future draft picks this team holds
  });

  // Build standings for each league
  const buildStandings = (teams) => {
    const s = {};
    teams.forEach(t => { s[t.id] = createStandingsEntry(t.id); });
    return s;
  };

  const phlTeams = allTeams.filter(t => t.leagueId === 'phl');
  const cdTeams  = allTeams.filter(t => t.leagueId === 'cd');
  const rcTeams  = allTeams.filter(t => t.leagueId === 'rc');

  GAME_STATE = {
    version: '1.0',
    year: 1,
    week: 0,
    phase: 'preseason_draft',   // preseason_draft → season → playoffs → offseason
    playerTeamId,

    // Team maps
    teams: Object.fromEntries(allTeams.map(t => [t.id, t])),
    allPlayers,

    // League data
    leagues: {
      phl: { teamIds: phlTeams.map(t => t.id), schedule: generateSchedule(phlTeams, 'phl') },
      cd:  { teamIds: cdTeams.map(t => t.id),  schedule: generateSchedule(cdTeams,  'cd')  },
      rc:  { teamIds: rcTeams.map(t => t.id),  schedule: generateSchedule(rcTeams,  'rc')  },
    },
    standings: {
      phl: buildStandings(phlTeams),
      cd:  buildStandings(cdTeams),
      rc:  buildStandings(rcTeams),
    },

    // Off-season data
    freeAgents: [],
    draftClass: [],
    pendingTrades: [],

    // History
    news: [],
    tradeHistory: [],
    draftHistory: [],
    capHistory: [],

    // Convenience
    get cap() { return getSalaryCap(this.year); },
  };

  saveGame();

  // Commissioner opens the season
  const announcement = await generateCommissionerAnnouncement('season_start', {
    year: GAME_STATE.year,
    cap: GAME_STATE.cap,
  });
  addNews({ type: 'commissioner', text: announcement, week: 0 });

  // Generate pre-season draft class immediately so it's ready on team-intro
  const rawProspects = generateDraftClass(NAME_DATA, GAME_STATE.year);
  // Give all prospects entry-level contracts (age 18–21, $700K, 3 years)
  rawProspects.forEach(p => {
    p.age           = Math.floor(Math.random() * 4) + 18; // 18–21
    p.salary        = 700_000;
    p.contractYears = 3;
    p.isRookie      = true;
    GAME_STATE.allPlayers[p.id] = p;
  });

  // Build draft order: player's team picks first (new GM gets priority), then random
  const otherTeamIds = Object.keys(GAME_STATE.teams).filter(id => id !== playerTeamId);
  otherTeamIds.sort(() => Math.random() - 0.5);
  const draftOrder = [playerTeamId, ...otherTeamIds];

  GAME_STATE.draftClass       = rawProspects.map(p => p.id);
  GAME_STATE.draftOrder       = draftOrder;
  GAME_STATE.draftCurrentPick = 0;
  GAME_STATE.draftRounds      = 3;

  // Snapshot pre-draft roster OVR for every team so we can show deltas after draft
  const preDraftOvr = {};
  Object.values(GAME_STATE.teams).forEach(team => {
    const players = (team.rosterIds || []).map(id => GAME_STATE.allPlayers[id]).filter(Boolean);
    preDraftOvr[team.id] = players.length
      ? Math.round(players.reduce((s, p) => s + p.overall, 0) / players.length)
      : 0;
  });
  GAME_STATE.preDraftOvr = preDraftOvr;

  saveGame();
  showScreen('team-intro');
}

// ─── Begin Season (after pre-season draft) ───────────────────────────────────

/**
 * Called when the player clicks "Begin Season" after the preseason draft.
 * Clears leftover draft state and starts the regular season.
 */
export function beginSeason() {
  const state = GAME_STATE;
  state.phase          = 'season';
  state.draftClass     = [];
  state.draftOrder     = [];
  state.draftCurrentPick = 0;
  // Reset all season stats at start of season
  Object.values(state.allPlayers).forEach(p => {
    p.seasonStats = { gp:0, g:0, a:0, pts:0, pm:0, w:0, ga:0, sv:0, sa:0 };
  });
  saveGame();
  showScreen('dashboard');
}

// ─── Game Loop ────────────────────────────────────────────────────────────────

/**
 * Simulates the next game for each league (all leagues advance in parallel).
 * Fires Claude agents as appropriate.
 */
export async function simNextGame(silent = false) {
  const state = GAME_STATE;
  state.week++;

  const leagueIds = ['phl', 'cd', 'rc'];

  for (const leagueId of leagueIds) {
    const league   = state.leagues[leagueId];
    const unplayed = league.schedule.filter(g => !g.played);
    if (unplayed.length === 0) continue;

    // Pick first unplayed game (loosely ordered by week)
    const game = unplayed.sort((a, b) => a.week - b.week)[0];
    const home = state.teams[game.homeTeamId];
    const away = state.teams[game.awayTeamId];

    if (!home || !away) continue;

    // Simulate
    const result = simulateGame(home, away, state.allPlayers);
    game.played = true;
    game.result = result;

    // Show game result modal for the player's own team
    const playerInvolved = home.id === state.playerTeamId || away.id === state.playerTeamId;
    if (!silent && playerInvolved) {
      document.dispatchEvent(new CustomEvent('game-result', {
        detail: { result, home, away, allPlayers: state.allPlayers },
      }));
    }

    // Update standings
    state.standings[leagueId] = updateStandings(state.standings[leagueId], result);

    // Accumulate season stats for all players in this game
    const statDeltas = generateGameStats(home, away, result, state.allPlayers);
    Object.entries(statDeltas).forEach(([pid, delta]) => {
      const p = state.allPlayers[pid];
      if (!p) return;
      if (!p.seasonStats) p.seasonStats = { gp:0, g:0, a:0, pts:0, pm:0, w:0, ga:0, sv:0, sa:0 };
      Object.keys(delta).forEach(k => { p.seasonStats[k] = (p.seasonStats[k] || 0) + delta[k]; });
    });

    // Generate headline (Claude API — only for player's league or all if preferred)
    const headline = await generateHeadline(result, home, away, result.highlights);
    addNews({
      type: 'game',
      leagueId,
      gameId: game.id,
      headline: headline.headline,
      report: headline.report,
      homeTeamId: home.id,
      awayTeamId: away.id,
      homeGoals: result.homeGoals,
      awayGoals: result.awayGoals,
      week: state.week,
    });

    // Random event (1-in-4 chance per game)
    if (Math.random() < 0.25) {
      await fireRandomEvent(leagueId);
    }
  }

  // Check if season is complete
  const allGamesPlayed = leagueIds.every(lid =>
    state.leagues[lid].schedule.every(g => g.played)
  );

  if (allGamesPlayed) {
    state.phase = 'playoffs';
    addNews({ type: 'league', text: 'Regular season complete. Playoffs begin!', week: state.week });
    initPlayoffsState(state);
    state.playoffBracketPending = true;
  }

  // Trade offer (1-in-5 chance per sim)
  if (Math.random() < 0.20 && state.phase === 'season') {
    await generateIncomingTradeOffer();
  }

  saveGame();
  renderCurrentScreen();
}

// ─── Playoff bracket modal ───────────────────────────────────────────────

function teamLabel(team) {
  return `<span class="po-team-name team-tip" data-team-id="${team.id}">${team.abbrev}</span>`;
}

function seriesScoreLine(series, teamA, teamB) {
  if (!series) return '';
  const wA = series.winsA ?? 0;
  const wB = series.winsB ?? 0;
  if (wA === 0 && wB === 0) return '<span class="po-series-score">0–0</span>';
  const leader = wA > wB ? teamA.abbrev : wB > wA ? teamB.abbrev : null;
  const score  = leader ? `${Math.max(wA, wB)}–${Math.min(wA, wB)} ${leader}` : `${wA}–${wB}`;
  return `<span class="po-series-score">${score}</span>`;
}

function buildBracketHTML(state) {
  const leagueLabels = { phl: 'Premier Hockey League', cd: 'Continental Division', rc: 'Regional Circuit' };

  return ['phl', 'cd', 'rc'].map(lid => {
    const po = state.playoffs?.[lid];
    if (!po) return '';
    const teamName = id => state.teams[id]?.fullName ?? id;
    const abbrev   = id => state.teams[id];

    const sf1tA = abbrev(po.sf1.teamA), sf1tB = abbrev(po.sf1.teamB);
    const sf2tA = abbrev(po.sf2.teamA), sf2tB = abbrev(po.sf2.teamB);
    const isPlayerLeague = state.leagues[lid].teamIds.includes(state.playerTeamId);

    const finalistA = po._sf1Winner ? abbrev(po._sf1Winner) : null;
    const finalistB = po._sf2Winner ? abbrev(po._sf2Winner) : null;
    const finalSeries = po.final;
    const champion   = po.champion ? abbrev(po.champion) : null;

    const sf1Done = po.sf1.winsA >= 4 || po.sf1.winsB >= 4;
    const sf2Done = po.sf2.winsA >= 4 || po.sf2.winsB >= 4;

    const matchup = (s, tA, tB, label) => {
      if (!tA || !tB) return `<div class="po-matchup po-matchup-tbd"><span class="po-round-label">${label}</span><span class="text-3">TBD</span></div>`;
      const wA = s?.winsA ?? 0, wB = s?.winsB ?? 0;
      const done = wA >= 4 || wB >= 4;
      const winnerId = wA >= 4 ? tA.id : wB >= 4 ? tB.id : null;
      const playerIn  = tA.id === state.playerTeamId || tB.id === state.playerTeamId;
      return `
        <div class="po-matchup ${playerIn ? 'po-matchup-player' : ''}">
          <span class="po-round-label">${label}</span>
          <div class="po-seed ${done && tA.id !== winnerId ? 'po-eliminated' : ''}">${teamLabel(tA)} <small class="text-3">${teamName(tA.id)}</small></div>
          <div class="po-vs">vs</div>
          <div class="po-seed ${done && tB.id !== winnerId ? 'po-eliminated' : ''}">${teamLabel(tB)} <small class="text-3">${teamName(tB.id)}</small></div>
          ${seriesScoreLine(s, tA, tB)}
        </div>`;
    };

    return `
      <div class="po-league-bracket ${isPlayerLeague ? 'po-player-league' : ''}">
        <h3 class="po-league-title ${lid}">${leagueLabels[lid]}</h3>
        <div class="po-bracket-grid">
          <div class="po-col po-col-semis">
            <div class="po-col-label">Semifinals</div>
            ${matchup(po.sf1, sf1tA, sf1tB, '1 vs 4')}
            ${matchup(po.sf2, sf2tA, sf2tB, '2 vs 3')}
          </div>
          <div class="po-col po-col-final">
            <div class="po-col-label">Final</div>
            ${matchup(finalSeries, finalistA, finalistB, 'Championship')}
          </div>
          <div class="po-col po-col-champ">
            <div class="po-col-label">Champion</div>
            <div class="po-champion-slot">
              ${champion
                ? `<span class="po-champion-crown">🏆</span><span class="po-champion-name team-tip" data-team-id="${champion.id}">${champion.fullName}</span>`
                : '<span class="text-3">Undecided</span>'}
            </div>
          </div>
        </div>
      </div>`;
  }).join('');
}

export function showPlayoffBracket() {
  const state   = GAME_STATE;
  const overlay = document.getElementById('playoff-bracket-overlay');
  const content = document.getElementById('playoff-bracket-content');
  if (!overlay || !content) return;
  content.innerHTML = buildBracketHTML(state);
  overlay.style.display = '';
  // Close button
  document.getElementById('playoff-bracket-close').onclick = () => closePlayoffBracket();
  overlay.addEventListener('click', e => { if (e.target === overlay) closePlayoffBracket(); }, { once: true });
}

export function closePlayoffBracket() {
  const overlay = document.getElementById('playoff-bracket-overlay');
  if (overlay) overlay.style.display = 'none';
  GAME_STATE.playoffBracketPending = false;
  saveGame();
  renderCurrentScreen();
}

// ─── Playoff state helpers ───────────────────────────────────────────────────

/** Builds best-of-7 series brackets for all leagues from current standings. */
function initPlayoffsState(state) {
  state.playoffs = {};
  for (const leagueId of ['phl', 'cd', 'rc']) {
    const bracket = buildPlayoffBracket(state.standings[leagueId]);
    state.playoffs[leagueId] = {
      round:      'semis',  // 'semis' | 'final' | 'complete'
      sf1:        { teamA: bracket.semifinalA.topSeed,  teamB: bracket.semifinalA.bottomSeed, winsA: 0, winsB: 0, gameNum: 0 },
      sf2:        { teamA: bracket.semifinalB.topSeed,  teamB: bracket.semifinalB.bottomSeed, winsA: 0, winsB: 0, gameNum: 0 },
      final:      null,
      _sf1Winner: null,
      _sf2Winner: null,
      champion:   null,
    };
  }
}

/** Returns 'sf1', 'sf2', 'final', or null — the player team's active series. */
function getPlayerSeriesKey(state, leagueId) {
  const po  = state.playoffs[leagueId];
  const pid = state.playerTeamId;
  if (po.round === 'semis') {
    if ((po.sf1.teamA === pid || po.sf1.teamB === pid) && po.sf1.winsA < 4 && po.sf1.winsB < 4) return 'sf1';
    if ((po.sf2.teamA === pid || po.sf2.teamB === pid) && po.sf2.winsA < 4 && po.sf2.winsB < 4) return 'sf2';
  }
  if (po.round === 'final' && po.final) {
    if ((po.final.teamA === pid || po.final.teamB === pid) && po.final.winsA < 4 && po.final.winsB < 4) return 'final';
  }
  return null; // eliminated or league playoffs done
}

/** Returns the key of the first incomplete series in a league playoff object. */
function getActiveSeries(po) {
  if (po.round === 'semis') {
    if (po.sf1 && po.sf1.winsA < 4 && po.sf1.winsB < 4) return 'sf1';
    if (po.sf2 && po.sf2.winsA < 4 && po.sf2.winsB < 4) return 'sf2';
  }
  if (po.round === 'final' && po.final && po.final.winsA < 4 && po.final.winsB < 4) return 'final';
  return null;
}

/**
 * Simulates one game in a best-of-7 series. Updates winsA/winsB.
 * Fires game-result event for player's team unless silent=true.
 * Returns { result, home, away } or null if series is already over.
 */
function simSeriesGame(leagueId, seriesKey, silent = true) {
  const state  = GAME_STATE;
  const po     = state.playoffs[leagueId];
  const series = po[seriesKey];
  if (!series || !series.teamA || !series.teamB) return null;
  if (series.winsA >= 4 || series.winsB >= 4)   return null;

  series.gameNum++;

  // Standard home-ice schedule: games 1,2,5,7 at teamA (higher seed); 3,4,6 at teamB
  const aHosts  = [1, 2, 5, 7].includes(series.gameNum);
  const homeTeam = aHosts ? state.teams[series.teamA] : state.teams[series.teamB];
  const awayTeam = aHosts ? state.teams[series.teamB] : state.teams[series.teamA];

  const result  = simulateGame(homeTeam, awayTeam, state.allPlayers);
  const homeWon = result.homeGoals > result.awayGoals;
  if ((homeWon && aHosts) || (!homeWon && !aHosts)) series.winsA++;
  else series.winsB++;

  // Accumulate season stats
  const statDeltas = generateGameStats(homeTeam, awayTeam, result, state.allPlayers);
  Object.entries(statDeltas).forEach(([pid, delta]) => {
    const p = state.allPlayers[pid];
    if (!p) return;
    if (!p.seasonStats) p.seasonStats = { gp:0, g:0, a:0, pts:0, pm:0, w:0, ga:0, sv:0, sa:0 };
    Object.keys(delta).forEach(k => { p.seasonStats[k] = (p.seasonStats[k] || 0) + delta[k]; });
  });

  // Player involvement modal
  const ptId = state.playerTeamId;
  if (!silent && (homeTeam.id === ptId || awayTeam.id === ptId)) {
    document.dispatchEvent(new CustomEvent('game-result', {
      detail: { result, home: homeTeam, away: awayTeam, allPlayers: state.allPlayers },
    }));
  }

  // News
  const lgName  = leagueId.toUpperCase();
  const round   = seriesKey === 'final' ? 'Final' : 'Semis';
  const leader  = series.winsA > series.winsB ? state.teams[series.teamA]
                : series.winsA < series.winsB ? state.teams[series.teamB] : null;
  const seriesNote = leader
    ? `${leader.abbrev} lead ${Math.max(series.winsA, series.winsB)}-${Math.min(series.winsA, series.winsB)}`
    : `Series tied ${series.winsA}-${series.winsB}`;
  addNews({
    type: 'game', leagueId,
    headline: `${lgName} ${round} Gm${series.gameNum}: ${homeTeam.abbrev} ${result.homeGoals}–${result.awayGoals} ${awayTeam.abbrev}`,
    report:   seriesNote,
    homeTeamId: homeTeam.id, awayTeamId: awayTeam.id,
    homeGoals: result.homeGoals, awayGoals: result.awayGoals,
    week: state.week,
  });

  // Series over?
  if (series.winsA >= 4 || series.winsB >= 4) {
    const winnerId = series.winsA >= 4 ? series.teamA : series.teamB;
    _advanceSeriesWinner(state, leagueId, seriesKey, winnerId);
  }

  return { result, home: homeTeam, away: awayTeam };
}

function _advanceSeriesWinner(state, leagueId, seriesKey, winnerId) {
  const po     = state.playoffs[leagueId];
  const winner = state.teams[winnerId];
  const lgName = leagueId.toUpperCase();
  const loserId = po[seriesKey].teamA === winnerId ? po[seriesKey].teamB : po[seriesKey].teamA;
  const loser   = state.teams[loserId];

  if (seriesKey === 'sf1' || seriesKey === 'sf2') {
    if (seriesKey === 'sf1') po._sf1Winner = winnerId;
    else                     po._sf2Winner = winnerId;
    addNews({ type: 'league', text: `${winner.fullName} defeat ${loser.fullName} and advance to the ${lgName} Final!`, week: state.week });
    if (po._sf1Winner && po._sf2Winner) {
      po.round = 'final';
      po.final = { teamA: po._sf1Winner, teamB: po._sf2Winner, winsA: 0, winsB: 0, gameNum: 0 };
      const t1 = state.teams[po._sf1Winner];
      const t2 = state.teams[po._sf2Winner];
      addNews({ type: 'league', text: `${lgName} Final set: ${t1.fullName} vs ${t2.fullName}`, week: state.week });
    }
  } else if (seriesKey === 'final') {
    po.champion = winnerId;
    po.round    = 'complete';
    state.leagues[leagueId].champion = winnerId;
    addNews({ type: 'commissioner', text: `🏆 ${winner.fullName} are the ${lgName} Champions!`, week: state.week });
  }
}

/**
 * Sims all remaining regular season games at once.
 */
export async function simToPlayoffs() {
  while (GAME_STATE.phase === 'season') {
    await simNextGame(true); // silent — no per-game modals during bulk sim
  }
}

/**
 * Silently sims all games until the player's next scheduled game, then sims
 * that game normally so the result modal fires.
 */
export async function simToMyNextGame() {
  const state = GAME_STATE;
  if (state.phase !== 'season') return;

  const playerTeamId  = state.playerTeamId;
  const playerLeagueId = ['phl', 'cd', 'rc'].find(lid =>
    state.leagues[lid].teamIds.includes(playerTeamId)
  );
  if (!playerLeagueId) return;

  // Find the player's next unplayed game
  const playerNextGame = state.leagues[playerLeagueId].schedule
    .filter(g => !g.played && (g.homeTeamId === playerTeamId || g.awayTeamId === playerTeamId))
    .sort((a, b) => a.week - b.week)[0];

  if (!playerNextGame) {
    // No more games — just do a normal sim tick
    await simNextGame(false);
    return;
  }

  // Sim silently until the player's game is the very next one in their league
  let safety = 300;
  while (safety-- > 0) {
    const nextInLeague = state.leagues[playerLeagueId].schedule
      .filter(g => !g.played)
      .sort((a, b) => a.week - b.week)[0];

    if (!nextInLeague) break;

    if (nextInLeague.id === playerNextGame.id) {
      // Player's game is next — sim with popup
      await simNextGame(false);
      break;
    }

    // Not the player's game yet — advance silently
    await simNextGame(true);

    if (state.phase !== 'season') break;
  }
}

// ─── Playoffs ─────────────────────────────────────────────────────────────────

/**
 * Simulates all remaining playoff games (best-of-7) silently for all leagues.
 */
export async function simPlayoffs() {
  const state = GAME_STATE;
  if (state.phase !== 'playoffs') return;
  if (!state.playoffs) initPlayoffsState(state);

  let safety = 400;
  while (safety-- > 0) {
    const allComplete = ['phl', 'cd', 'rc'].every(lid => state.playoffs[lid].round === 'complete');
    if (allComplete) break;
    for (const leagueId of ['phl', 'cd', 'rc']) {
      const po = state.playoffs[leagueId];
      if (po.round === 'complete') continue;
      const sk = getActiveSeries(po);
      if (sk) simSeriesGame(leagueId, sk, true);
    }
  }

  state.phase = 'offseason';
  saveGame();
  renderCurrentScreen();
}

/**
 * Sims one game in the player's current playoff series (with popup).
 * All other leagues and the other semi (if still running) advance one game silently.
 */
export async function simMyNextPlayoffGame() {
  const state = GAME_STATE;
  if (state.phase !== 'playoffs') return;
  if (!state.playoffs) initPlayoffsState(state);

  const playerLeagueId = ['phl', 'cd', 'rc'].find(lid =>
    state.leagues[lid].teamIds.includes(state.playerTeamId)
  );
  if (!playerLeagueId) return;

  // Silently advance all other leagues one game
  for (const lid of ['phl', 'cd', 'rc']) {
    if (lid === playerLeagueId) continue;
    const sk = getActiveSeries(state.playoffs[lid]);
    if (sk) simSeriesGame(lid, sk, true);
  }

  const seriesKey = getPlayerSeriesKey(state, playerLeagueId);
  if (seriesKey) {
    // Also advance the OTHER semi in player's league silently (they run in parallel)
    if (state.playoffs[playerLeagueId].round === 'semis') {
      const otherSk = seriesKey === 'sf1' ? 'sf2' : 'sf1';
      const other = state.playoffs[playerLeagueId][otherSk];
      if (other && other.winsA < 4 && other.winsB < 4) simSeriesGame(playerLeagueId, otherSk, true);
    }
    // Sim player's game — fires popup
    simSeriesGame(playerLeagueId, seriesKey, false);
  } else {
    // Player eliminated — silently advance their league
    const sk = getActiveSeries(state.playoffs[playerLeagueId]);
    if (sk) simSeriesGame(playerLeagueId, sk, true);
  }

  const allComplete = ['phl', 'cd', 'rc'].every(lid => state.playoffs[lid].round === 'complete');
  if (allComplete) state.phase = 'offseason';

  saveGame();
  renderCurrentScreen();
}

/**
 * Sims the player's entire current series to completion, showing popup each game.
 * Other leagues advance one game silently per player game.
 */
export async function simPlayerSeries() {
  const state = GAME_STATE;
  if (state.phase !== 'playoffs') return;
  if (!state.playoffs) initPlayoffsState(state);

  const playerLeagueId = ['phl', 'cd', 'rc'].find(lid =>
    state.leagues[lid].teamIds.includes(state.playerTeamId)
  );
  if (!playerLeagueId) return;

  let seriesKey = getPlayerSeriesKey(state, playerLeagueId);
  if (!seriesKey) return; // eliminated

  let safety = 7;
  while (safety-- > 0) {
    const series = state.playoffs[playerLeagueId][seriesKey];
    if (!series || series.winsA >= 4 || series.winsB >= 4) break;

    simSeriesGame(playerLeagueId, seriesKey, false); // popup for player games

    // Advance other leagues and the other semi silently
    for (const lid of ['phl', 'cd', 'rc']) {
      if (lid === playerLeagueId) continue;
      const sk = getActiveSeries(state.playoffs[lid]);
      if (sk) simSeriesGame(lid, sk, true);
    }
    if (state.playoffs[playerLeagueId].round === 'semis') {
      const otherSk = seriesKey === 'sf1' ? 'sf2' : 'sf1';
      const other = state.playoffs[playerLeagueId][otherSk];
      if (other && other.winsA < 4 && other.winsB < 4) simSeriesGame(playerLeagueId, otherSk, true);
    }
  }

  const allComplete = ['phl', 'cd', 'rc'].every(lid => state.playoffs[lid].round === 'complete');
  if (allComplete) state.phase = 'offseason';

  saveGame();
  renderCurrentScreen();
}

// ─── Events ───────────────────────────────────────────────────────────────────

async function fireRandomEvent(leagueId) {
  const state = GAME_STATE;
  const teamIds = state.leagues[leagueId].teamIds;
  const teamId  = teamIds[Math.floor(Math.random() * teamIds.length)];
  const team    = state.teams[teamId];

  const rosterIds = team.rosterIds || [];
  const randomPlayerId = rosterIds[Math.floor(Math.random() * rosterIds.length)];
  const player = state.allPlayers[randomPlayerId];

  // 50% chance Claude generates one, 50% use events.json bank
  if (Math.random() < 0.5) {
    const eventText = await generateRandomEvent({ team, player, league: leagueId, week: state.week });
    addNews({ type: 'event', teamId, text: eventText, week: state.week });
  } else {
    // Pick from static bank — handled by UI layer (events.json loaded separately)
    addNews({ type: 'event_static', teamId, playerId: player?.id, week: state.week });
  }
}

// ─── Trades ───────────────────────────────────────────────────────────────────

async function generateIncomingTradeOffer() {
  const state = GAME_STATE;
  const playerTeam = state.teams[state.playerTeamId];
  const playerTeamId = state.playerTeamId;

  // Pick a random rival team
  const allTeamIds = Object.keys(state.teams).filter(id => id !== playerTeamId);
  const rivalTeamId = allTeamIds[Math.floor(Math.random() * allTeamIds.length)];
  const rivalTeam   = state.teams[rivalTeamId];

  // Build a simple offer: rival gives 1 player, wants 1 of yours
  const rivalPlayers = (rivalTeam.rosterIds || []).map(id => state.allPlayers[id]).filter(Boolean);
  const yourPlayers  = (playerTeam.rosterIds || []).map(id => state.allPlayers[id]).filter(Boolean);

  if (rivalPlayers.length === 0 || yourPlayers.length === 0) return;

  const sortByOverall = arr => [...arr].sort((a, b) => b.overall - a.overall);

  // Rival offers a mid-tier player (5th–9th best)
  const rivalSorted = sortByOverall(rivalPlayers);
  const offeredPlayer = rivalSorted[Math.floor(Math.random() * 5) + 4] || rivalSorted[0];

  // Rival wants one of your better players (1st–5th best)
  const yourSorted  = sortByOverall(yourPlayers);
  const wantedPlayer = yourSorted[Math.floor(Math.random() * 5)];

  const offerData = await generateTradeOffer(
    rivalTeam,
    [offeredPlayer],
    [wantedPlayer],
    [], []
  );

  const trade = {
    id: `trade_${Date.now()}`,
    fromTeamId: rivalTeamId,
    toTeamId: playerTeamId,
    offered: [offeredPlayer.id],
    wanted:  [wantedPlayer.id],
    offeredPicks: [],
    wantedPicks:  [],
    offerText: offerData.offerText,
    gmQuote:   offerData.gmQuote,
    valueOpinion: offerData.valueOpinion,
    status: 'pending',
    week: state.week,
  };

  state.pendingTrades.push(trade);
  addNews({ type: 'trade_offer', tradeId: trade.id, fromTeamId: rivalTeamId, week: state.week });
}

/**
 * Accepts a trade offer.
 */
export function acceptTrade(tradeId) {
  const state = GAME_STATE;
  const trade = state.pendingTrades.find(t => t.id === tradeId);
  if (!trade || trade.status !== 'pending') return;

  const fromTeam = state.teams[trade.fromTeamId];
  const toTeam   = state.teams[trade.toTeamId];

  // Swap player roster entries
  trade.wanted.forEach(pid => {
    fromTeam.rosterIds.push(pid);
    toTeam.rosterIds = toTeam.rosterIds.filter(id => id !== pid);
  });
  trade.offered.forEach(pid => {
    toTeam.rosterIds.push(pid);
    fromTeam.rosterIds = fromTeam.rosterIds.filter(id => id !== pid);
  });

  trade.status = 'accepted';
  state.tradeHistory.push(trade);
  addNews({ type: 'trade_complete', tradeId, week: state.week });
  saveGame();
}

export function declineTrade(tradeId) {
  const state = GAME_STATE;
  const trade = state.pendingTrades.find(t => t.id === tradeId);
  if (!trade) return;
  trade.status = 'declined';
  saveGame();
}

// ─── Free Agency ──────────────────────────────────────────────────────────────

/**
 * Signs a free agent to the player's team.
 * @param {string} playerId
 */
export function signFreeAgent(playerId) {
  const state = GAME_STATE;
  const team  = state.teams[state.playerTeamId];
  const player = state.allPlayers[playerId];
  if (!team || !player) return;

  // Cap check
  const used = (team.rosterIds || [])
    .map(id => state.allPlayers[id])
    .filter(Boolean)
    .reduce((sum, p) => sum + (p.salary || 0), 0);

  if (used + (player.salary || 0) > state.cap) {
    alert(`Cannot sign ${player.fullName} — not enough cap space.`);
    return;
  }

  // Add to roster, remove from free agents
  if (!team.rosterIds) team.rosterIds = [];
  team.rosterIds.push(playerId);
  state.freeAgents = state.freeAgents.filter(id => id !== playerId);

  addNews({
    type: 'league',
    text: `Signed: ${player.fullName} (${player.position}, ${formatSalary(player.salary)}/yr)`,
    week: state.week,
  });

  saveGame();
}

// ─── News Feed ────────────────────────────────────────────────────────────────

function addNews(item) {
  GAME_STATE.news.unshift({ ...item, id: `news_${Date.now()}_${Math.random()}` });
  // Cap news feed at 200 items
  if (GAME_STATE.news.length > 200) GAME_STATE.news.pop();
}

// ─── Save / Load ──────────────────────────────────────────────────────────────

const SAVE_KEY = 'hockeygm_save';

export function saveGame() {
  try {
    const saveable = { ...GAME_STATE };
    delete saveable.cap; // computed getter — re-derived on load
    const serialised = JSON.stringify(saveable);
    localStorage.setItem(SAVE_KEY, serialised);
    setSaveIndicator('saved');
  } catch (err) {
    // Surface save failures to the player — silent failure = lost progress
    setSaveIndicator('failed');
    console.warn('Save failed:', err);
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw);
    // Re-attach the cap getter that can't survive JSON serialisation
    Object.defineProperty(state, 'cap', {
      get() { return getSalaryCap(this.year); },
      enumerable: false,
      configurable: true,
    });
    return state;
  } catch {
    return null;
  }
}

export function deleteSave() {
  localStorage.removeItem(SAVE_KEY);
  GAME_STATE = null;
}

export function restartGame() {
  if (!confirm('Abandon this save and start a new game? This cannot be undone.')) return;
  localStorage.removeItem(SAVE_KEY);
  location.reload();
}

/** Shows a small save status indicator in the UI if the element exists. */
function setSaveIndicator(status) {
  const el = document.getElementById('save-indicator');
  if (!el) return;
  el.textContent = status === 'saved' ? '✓ saved' : '⚠ save failed';
  el.className   = status === 'saved' ? 'save-ok' : 'save-fail';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.textContent = ''; }, 3000);
}

// ─── Off-Season / End of Season ───────────────────────────────────────────────

/**
 * Runs the full end-of-season sequence:
 * relegation → aging → contracts → free agency list → year increment.
 * Call this after playoffs are complete.
 */
export async function endSeason() {
  const state = GAME_STATE;
  if (state.phase !== 'offseason') {
    console.warn('endSeason() called outside offseason phase — ignored.');
    return;
  }

  // 1. Determine promotion / relegation
  const relegation = determineRelegation(
    state.standings.phl,
    state.standings.cd,
    state.standings.rc,
  );

  // Move relegated PHL teams to CD
  relegation.phlRelegated.forEach(teamId => {
    state.leagues.phl.teamIds = state.leagues.phl.teamIds.filter(id => id !== teamId);
    state.leagues.cd.teamIds.push(teamId);
    state.teams[teamId].leagueId = 'cd';
  });

  // Move promoted CD teams to PHL
  relegation.cdPromoted.forEach(teamId => {
    state.leagues.cd.teamIds = state.leagues.cd.teamIds.filter(id => id !== teamId);
    state.leagues.phl.teamIds.push(teamId);
    state.teams[teamId].leagueId = 'phl';
  });

  // Move relegated CD teams to RC
  relegation.cdRelegated.forEach(teamId => {
    state.leagues.cd.teamIds = state.leagues.cd.teamIds.filter(id => id !== teamId);
    state.leagues.rc.teamIds.push(teamId);
    state.teams[teamId].leagueId = 'rc';
  });

  // Move promoted RC teams to CD
  relegation.rcPromoted.forEach(teamId => {
    state.leagues.rc.teamIds = state.leagues.rc.teamIds.filter(id => id !== teamId);
    state.leagues.cd.teamIds.push(teamId);
    state.teams[teamId].leagueId = 'cd';
  });

  // Commissioner announcement
  const playerLeague = state.teams[state.playerTeamId]?.leagueId?.toUpperCase() ?? '';
  const relAnnouncement = await generateCommissionerAnnouncement('relegation', {
    relegated: [
      ...relegation.phlRelegated,
      ...relegation.cdRelegated,
    ].map(id => state.teams[id]?.fullName).filter(Boolean),
    promoted: [
      ...relegation.cdPromoted,
      ...relegation.rcPromoted,
    ].map(id => state.teams[id]?.fullName).filter(Boolean),
  });
  addNews({ type: 'commissioner', text: relAnnouncement, week: state.week });

  // 2. Age all players, handle retirements
  const { updatedPlayers, retiredPlayers } = ageAllPlayers(state.allPlayers);
  state.allPlayers = updatedPlayers;

  retiredPlayers.forEach(p => {
    // Remove from any roster
    Object.values(state.teams).forEach(team => {
      if (team.rosterIds) {
        team.rosterIds = team.rosterIds.filter(id => id !== p.id);
      }
    });
    addNews({
      type: 'retirement',
      text: `${p.fullName} (${p.position}, age ${p.age}) has retired after ${p.seasonsInLeague} seasons.`,
      week: state.week,
    });
  });

  // 3. Tick contracts down — players at 0 become free agents
  const newFreeAgents = [];
  Object.values(state.allPlayers).forEach(p => {
    if (p.contractYears > 0) {
      p.contractYears--;
    }
    if (p.contractYears === 0) {
      // Remove from roster, add to free agent pool
      Object.values(state.teams).forEach(team => {
        if (team.rosterIds?.includes(p.id)) {
          team.rosterIds = team.rosterIds.filter(id => id !== p.id);
        }
      });
      newFreeAgents.push(p.id);
    }
  });
  state.freeAgents = newFreeAgents;

  // 4. Advance year and cap
  state.year++;
  state.capHistory.push({ year: state.year, cap: getSalaryCap(state.year) });

  // 5. Reset season state
  state.week = 0;
  state.phase = 'season';
  state.pendingTrades = [];

  // Reset season stats for new year
  Object.values(state.allPlayers).forEach(p => {
    p.seasonStats = { gp:0, g:0, a:0, pts:0, pm:0, w:0, ga:0, sv:0, sa:0 };
  });

  // Rebuild standings and schedules for new league compositions
  const buildStandings = (teamIds) => {
    const s = {};
    teamIds.forEach(id => { s[id] = createStandingsEntry(id); });
    return s;
  };

  state.standings.phl = buildStandings(state.leagues.phl.teamIds);
  state.standings.cd  = buildStandings(state.leagues.cd.teamIds);
  state.standings.rc  = buildStandings(state.leagues.rc.teamIds);

  state.leagues.phl.schedule = generateSchedule(
    state.leagues.phl.teamIds.map(id => state.teams[id]), 'phl'
  );
  state.leagues.cd.schedule = generateSchedule(
    state.leagues.cd.teamIds.map(id => state.teams[id]), 'cd'
  );
  state.leagues.rc.schedule = generateSchedule(
    state.leagues.rc.teamIds.map(id => state.teams[id]), 'rc'
  );

  // Cap increase announcement
  const capAnnouncement = await generateCommissionerAnnouncement('cap_increase', {
    cap: getSalaryCap(state.year),
  });
  addNews({ type: 'commissioner', text: capAnnouncement, week: 0 });

  saveGame();
  showScreen('dashboard');
}

// ─── Draft ───────────────────────────────────────────────────────────────────

/**
 * Generates the draft class, builds pick order, transitions to 'draft' phase.
 * Call this from the Draft screen when the player opens it in the off-season.
 */
export async function startDraft() {
  const state = GAME_STATE;

  // Build draft order: all teams sorted by standings points, worst first
  const allTeamIds = Object.keys(state.teams);
  const getTeamPts = (teamId) => {
    const leagueId = state.teams[teamId]?.leagueId;
    return state.standings[leagueId]?.[teamId]?.pts ?? 0;
  };
  const draftOrder = [...allTeamIds].sort((a, b) => getTeamPts(a) - getTeamPts(b));

  // Generate prospects
  const rawProspects = generateDraftClass(NAME_DATA, state.year);
  const prospects    = await augmentDraftClass(rawProspects); // stubs in dev

  // Register prospects in allPlayers so they're addressable by ID
  prospects.forEach(p => { state.allPlayers[p.id] = p; });

  state.draftClass       = prospects.map(p => p.id);
  state.draftOrder       = draftOrder;
  state.draftCurrentPick = 0;
  state.draftRounds      = 3;
  state.phase            = 'draft';

  saveGame();
  showScreen('draft');
}

/**
 * Records a single draft pick for whatever team is currently on the clock.
 * @param {string} prospectId
 */
export function makeDraftPick(prospectId) {
  const state = GAME_STATE;
  if (state.phase !== 'draft' && state.phase !== 'preseason_draft') return;
  if (!state.draftClass.includes(prospectId)) return;

  const totalTeams  = state.draftOrder.length;
  const pickIdx     = state.draftCurrentPick;
  const round       = Math.floor(pickIdx / totalTeams) + 1;
  const pickInRound = (pickIdx % totalTeams) + 1;
  const pickingTeamId = state.draftOrder[pickIdx % totalTeams];

  // Add prospect to team roster
  const team = state.teams[pickingTeamId];
  if (!team.rosterIds) team.rosterIds = [];
  team.rosterIds.push(prospectId);

  // Remove from available pool
  state.draftClass = state.draftClass.filter(id => id !== prospectId);

  // Record pick
  state.draftHistory.push({
    round,
    pick: pickInRound,
    overall: pickIdx + 1,
    teamId: pickingTeamId,
    prospectId,
    year: state.year,
  });

  state.draftCurrentPick++;

  const totalPicks = totalTeams * state.draftRounds;
  const isPreseason = state.phase === 'preseason_draft';
  if (state.draftCurrentPick >= totalPicks || state.draftClass.length === 0) {
    // Preseason: leave phase as-is so draft UI shows the summary + "Begin Season"
    // Regular draft: flip to offseason
    if (!isPreseason) {
      state.phase = 'offseason';
      addNews({
        type: 'commissioner',
        text: `Year ${state.year} draft complete. ${totalPicks} picks made across ${state.draftRounds} rounds.`,
        week: state.week,
      });
    } else {
      // Empty draftClass signals draft is over in preseason mode
      state.draftClass = [];
    }
  }

  saveGame();
}

/**
 * Auto-picks best available for every CPU team until it's the player's turn
 * (or the draft ends). Call this after the player makes their own pick.
 */
export function advanceCPUPicks() {
  const state = GAME_STATE;
  if (state.phase !== 'draft' && state.phase !== 'preseason_draft') return;

  const totalTeams  = state.draftOrder.length;
  const totalPicks  = totalTeams * state.draftRounds;
  const activePhase = state.phase;

  while (state.phase === activePhase && state.draftClass.length > 0 && state.draftCurrentPick < totalPicks) {
    const pickingTeamId = state.draftOrder[state.draftCurrentPick % totalTeams];
    if (pickingTeamId === state.playerTeamId) break;

    const best = bestAvailableForTeam(pickingTeamId, state);
    if (!best) break;
    makeDraftPick(best);
  }

  saveGame();
  showScreen('draft');
}

/**
 * Skips the player's current preseason draft pick (no player added).
 */
export function skipDraftPick() {
  const state = GAME_STATE;
  if (state.phase !== 'preseason_draft') return;

  const totalTeams = state.draftOrder.length;
  const totalPicks = totalTeams * state.draftRounds;
  state.draftCurrentPick++;

  if (state.draftCurrentPick >= totalPicks || state.draftClass.length === 0) {
    state.draftClass = [];
  }

  saveGame();
}

/** Scores a prospect for a given team based on positional need + quality. */
function bestAvailableForTeam(teamId, state) {
  if (state.draftClass.length === 0) return null;

  const team    = state.teams[teamId];
  const roster  = (team?.rosterIds || []).map(id => state.allPlayers[id]).filter(Boolean);

  // Count current roster positions
  const posCounts = {};
  roster.forEach(p => { posCounts[p.position] = (posCounts[p.position] || 0) + 1; });

  // Need weights: under-stocked positions score higher
  const need = (pos) => {
    const current = posCounts[pos] || 0;
    const targets = { C: 4, LW: 4, RW: 4, LD: 3, RD: 3, G: 2 };
    const target  = targets[pos] ?? 2;
    return Math.max(0, target - current) * 3;
  };

  // Score each available prospect
  let bestId    = null;
  let bestScore = -Infinity;

  state.draftClass.forEach(id => {
    const p = state.allPlayers[id];
    if (!p) return;
    // Add small random jitter so CPU teams don't all pick identically
    const score = p.overall + p.potential * 0.4 + need(p.position) + Math.random() * 4;
    if (score > bestScore) { bestScore = score; bestId = id; }
  });

  return bestId;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAllTeams() {
  const all = [];
  Object.entries(TEAMS_DATA.leagues).forEach(([leagueId, league]) => {
    league.teams.forEach(t => {
      all.push({ ...t, leagueId, tier: league.tier });
    });
  });
  return all;
}

// ─── Screen Router ────────────────────────────────────────────────────────────

let currentScreen = null;

export function showScreen(screenId) {
  currentScreen = screenId;
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  const el = document.getElementById(`screen-${screenId}`);
  if (el) el.classList.add('active');
  renderCurrentScreen();
}

function renderCurrentScreen() {
  if (!currentScreen) return;
  const event = new CustomEvent('render-screen', {
    detail: { screen: currentScreen, state: GAME_STATE }
  });
  document.dispatchEvent(event);
}

// ─── Expose to global scope ───────────────────────────────────────────────────

window.hockeyGM = {
  boot,
  newGame,
  beginSeason,
  simNextGame,
  simToMyNextGame,
  simToPlayoffs,
  simPlayoffs,
  simMyNextPlayoffGame,
  simPlayerSeries,
  showPlayoffBracket,
  closePlayoffBracket,
  endSeason,
  acceptTrade,
  declineTrade,
  signFreeAgent,
  startDraft,
  makeDraftPick,
  skipDraftPick,
  advanceCPUPicks,
  showScreen,
  saveGame,
  deleteSave,
  restartGame,
  getState: () => GAME_STATE,
};

// Boot immediately when module loads — eliminates the setTimeout race condition
boot();
