/**
 * main.js
 * Game init, state machine, save/load, screen router.
 */

import {
  generateRoster,
  generatePlayer,
  generateDraftClass,
  ageAllPlayers,
  getExpiringContracts,
  formatSalary,
  calculateSalary,
  LEAGUE_MIN_SALARY,
  ENTRY_LEVEL_YEARS,
  MAX_CONTRACT_YEARS,
} from './engine/playerGenerator.js';
import { generateSchedule, updateStandings, sortStandings, createStandingsEntry,
         buildPlayoffBracket, determineRelegation, getSalaryCap, getTeamCapUsed } from './engine/leagueManager.js';
import { simulateGame, generateGameStats } from './engine/gameEngine.js';
import { generateHeadline, generateTradeOffer, generateCommissionerAnnouncement,
         generateRandomEvent, augmentDraftClass } from './api/claudeAgent.js';
import { startGameWatch } from './ui/gameWatch.js';
import { loadEvents, checkForEvent, applyEventEffects } from './engine/eventEngine.js';
import { showEvent } from './ui/eventModal.js';
import { healInjuries, canPlayerBeTrade } from './engine/injurySystem.js';
import { showSeasonSummary } from './ui/seasonSummary.js';

// ─── State ────────────────────────────────────────────────────────────────────

let GAME_STATE = null;
let NAME_DATA  = null;
let TEAMS_DATA = null;
let PENDING_GAME_MODE = null;  // 'quick' or 'watch'

const APP_VERSION = '1.2.7';
const TRADE_DEADLINE_WEEK = 14;
const TRADEABLE_PICK_YEARS = 2;
const TRADEABLE_PICK_ROUNDS = [1, 2, 3];

const LEAGUE_SOCIAL_ACCOUNTS = {
  phl: {
    fan: ['@PHLNorthEnd', '@PHLBleacherLine', '@PHLSection312'],
    insider: ['@PHLInsiderDesk', '@PHLFrontOffice', '@PHLTradeRadar'],
    analytics: ['@PHLNumbersLab', '@PHLPuckModel', '@PHLDataDesk'],
    pressure: ['@PHLHotSeatWatch', '@PHLGMPressure', '@PHLMorningAfter'],
    chaos: ['@PHLRumourFlood', '@PHLConcourseOracle', '@PHLPuckspiracy'],
  },
  cd: {
    fan: ['@CDRinkRail', '@CDUpperBowl', '@CDFanWire'],
    insider: ['@CDInsiderDesk', '@CDTradeRadio', '@CDCapSheet'],
    analytics: ['@CDNumbersLab', '@CDExpectedIce', '@CDDataDesk'],
    pressure: ['@CDHotSeatWatch', '@CDGMPressure', '@CDMorningAfter'],
    chaos: ['@CDRumourFlood', '@CDConcourseOracle', '@CDPuckspiracy'],
  },
  rc: {
    fan: ['@RCRinkRail', '@RCBlueLineTalk', '@RCSectionBuzz'],
    insider: ['@RCInsiderDesk', '@RCTradeRadio', '@RCCapSheet'],
    analytics: ['@RCNumbersLab', '@RCExpectedIce', '@RCDataDesk'],
    pressure: ['@RCHotSeatWatch', '@RCGMPressure', '@RCMorningAfter'],
    chaos: ['@RCRumourFlood', '@RCConcourseOracle', '@RCPuckspiracy'],
  },
};

// ─── Boot ─────────────────────────────────────────────────────────────────────

/**
 * Entry point — called from index.html on DOMContentLoaded.
 */
export async function boot() {
  syncAppVersionUI();

  // Load static data
  [NAME_DATA, TEAMS_DATA] = await Promise.all([
    fetch('./data/player-names.json').then(r => r.json()),
    fetch('./data/teams.json').then(r => r.json()),
  ]);
  
  // Load event data
  await loadEvents();

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
    team.tradablePicks = createTeamTradablePicks(team.id, 1);
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
    version: APP_VERSION,
    year: 1,
    week: 0,
    phase: 'preseason_draft',   // preseason_draft → season → playoffs → offseason
    playerTeamId,
    tradeDeadlineWeek: TRADE_DEADLINE_WEEK,
    tradeMarketClosed: false,
    tradeDeadlineClosedInYear: null,
    chaosLevel: 5,    // Event system: 0 (benign) to 10 (chaotic)
    firedEventIds: [], // Track events that have fired this season to prevent duplicates

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
    p.salary        = LEAGUE_MIN_SALARY;
    p.contractYears = 3;
    p.contractLength = 3;
    p.contractType = 'entry';
    p.accruedSeasons = 0;
    p.isRookie      = true;
    p.tradeBlock = false;
    p.pendingExtension = null;
    p.askingSalary = null;
    p.askingContractYears = null;
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
  state.tradeDeadlineWeek = TRADE_DEADLINE_WEEK;
  state.tradeMarketClosed = false;
  state.tradeDeadlineClosedInYear = null;
  state.firedEventIds  = [];  // Reset event tracking for new season
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

export function skipPreseasonDraft() {
  const state = GAME_STATE;
  if (state.phase !== 'preseason_draft') return;

  state.draftClass = [];
  state.draftOrder = [];
  state.draftCurrentPick = 0;
  beginSeason();
}

// ─── Game Loop ────────────────────────────────────────────────────────────────

/**
 * Simulates the next game for each league (all leagues advance in parallel).
 * Fires Claude agents as appropriate.
 * @param {boolean} silent - If true, don't show game result modals
 * @param {boolean} skipEvents - If true, don't check for or fire events (for bulk simulations)
 */
export async function simNextGame(silent = false, skipEvents = false) {
  const state = GAME_STATE;

  if (state.phase === 'season') {
    state.week = getCurrentScheduleWeek(state);
    // Heal player injuries at the start of each week
    healInjuries(state);
    closeTradeMarketIfNeeded(state);
  }

  if (state.phase === 'season' && !skipEvents) {
    // Check for league events (every 2 weeks during regular season)
    const eventData = checkForEvent(state.week, state.chaosLevel, state.phase, state.firedEventIds);
    if (eventData && !silent) {
      const effects = applyEventEffects(eventData, state, state.playerTeamId);
      await showEvent(eventData, effects);
      // Mark this event as fired to prevent duplicates this season
      state.firedEventIds.push(eventData.id);
    }
  }

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

    // Update standings
    state.standings[leagueId] = updateStandings(state.standings[leagueId], result);

    // Show game result modal for the player's own team after standings update
    const playerInvolved = home.id === state.playerTeamId || away.id === state.playerTeamId;
    const socialFeed = playerInvolved
      ? generatePostGameSocialFeed(state, home, away, result)
      : [];
    if (!silent && playerInvolved) {
      // Check if user wants to watch period-by-period
      if (PENDING_GAME_MODE === 'watch') {
        PENDING_GAME_MODE = null;  // Reset after using
        startGameWatch({
          result,
          home,
          away,
          allPlayers: state.allPlayers,
          socialFeed,
        });
      } else {
        // Quick sim — show result directly
        PENDING_GAME_MODE = null;  // Reset after using
        document.dispatchEvent(new CustomEvent('game-result', {
          detail: { result, home, away, allPlayers: state.allPlayers, socialFeed },
        }));
      }
    }

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

    if (playerInvolved && socialFeed.length > 0) {
      addSocialPulseNews(state, home, away, result, socialFeed, leagueId);
    }

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

  // Trade offers intensify near the deadline and stop once the market closes.
  if (Math.random() < getTradeOfferChance(state) && isTradeWindowOpen(state)) {
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

/**
 * Determine playoff result for the player's team
 * @param {object} state - Game state
 * @returns {string} - 'champion', 'finals', 'semifinals', 'first_round', or 'missed'
 */
function getPlayerPlayoffResult(state) {
  const playerLeagueId = ['phl', 'cd', 'rc'].find(lid =>
    state.leagues[lid].teamIds.includes(state.playerTeamId)
  );
  if (!playerLeagueId) return 'missed';

  const po = state.playoffs[playerLeagueId];
  const pid = state.playerTeamId;

  // Check if player won the championship (first round -> semis -> final -> champion)
  if (po.final && po.final.champion === pid) {
    return 'champion';
  }

  // Check if player made finals but didn't win
  if (po.final && (po.final.teamA === pid || po.final.teamB === pid)) {
    return 'finals';
  }

  // Check if player is in semis or was in semis
  if (po.sf1 && (po.sf1.teamA === pid || po.sf1.teamB === pid)) {
    if (po.sf1.champion === pid || (po.sf1.winsA === 4 && po.sf1.teamA === pid) || (po.sf1.winsB === 4 && po.sf1.teamB === pid)) {
      return 'semifinals'; // Won semis, lost in finals or still playing
    } else if (po.sf1.winsA >= 4 || po.sf1.winsB >= 4) {
      return 'first_round'; // Lost semis
    }
  }
  if (po.sf2 && (po.sf2.teamA === pid || po.sf2.teamB === pid)) {
    if (po.sf2.champion === pid || (po.sf2.winsA === 4 && po.sf2.teamA === pid) || (po.sf2.winsB === 4 && po.sf2.teamB === pid)) {
      return 'semifinals'; // Won semis, lost in finals or still playing
    } else if (po.sf2.winsA >= 4 || po.sf2.winsB >= 4) {
      return 'first_round'; // Lost semis
    }
  }

  // Check if player is/was in first round
  if (po.round === 'first_round' || po.round === 'semis' || po.round === 'final') {
    // Player was in playoffs at some point but not in current round
    // This means they lost in first round or earlier
    if (po.first_round) {
      for (const skKey of ['q1', 'q2', 'q3', 'q4']) {
        const series = po.first_round[skKey];
        if (series && (series.teamA === pid || series.teamB === pid)) {
          if (series.winsA >= 4 || series.winsB >= 4) {
            // Series is over, player lost
            return 'first_round';
          }
        }
      }
    }
  }

  // Player didn't make playoffs or missed early
  return 'missed';
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
  const playerInvolved = homeTeam.id === ptId || awayTeam.id === ptId;
  const socialFeed = playerInvolved
    ? generatePostGameSocialFeed(state, homeTeam, awayTeam, result)
    : [];
  if (!silent && playerInvolved) {
    document.dispatchEvent(new CustomEvent('game-result', {
      detail: { result, home: homeTeam, away: awayTeam, allPlayers: state.allPlayers, socialFeed },
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

  if (playerInvolved && socialFeed.length > 0) {
    addSocialPulseNews(state, homeTeam, awayTeam, result, socialFeed, leagueId);
  }

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
    await simNextGame(true, true); // silent + skipEvents — no modals or events during bulk sim
  }
}

/**
 * Silently sims all games until the player's next scheduled game, then sims
 * that game normally so the result modal fires.
 */
export async function simToMyNextGame() {
  const state = GAME_STATE;
  if (state.phase === 'preseason_draft' && state.draftClass && state.draftClass.length > 0) {
    showScreen('draft');
    return;
  }
  if (state.phase === 'preseason_draft' && (!state.draftClass || state.draftClass.length === 0)) {
    beginSeason();
    return;
  }
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

  // Show game mode selection modal
  showGameModeModal();
}

/**
 * Internal function to continue the simulation after mode is selected
 */
async function continueSimToMyNextGame() {
  const state = GAME_STATE;
  const playerTeamId  = state.playerTeamId;
  const playerLeagueId = ['phl', 'cd', 'rc'].find(lid =>
    state.leagues[lid].teamIds.includes(playerTeamId)
  );

  // Sim silently until the player's game is the very next one in their league
  let safety = 300;
  while (safety-- > 0) {
    const nextInLeague = state.leagues[playerLeagueId].schedule
      .filter(g => !g.played)
      .sort((a, b) => a.week - b.week)[0];

    if (!nextInLeague) break;

    // Need to find the player's target game
    const playerTargetGame = state.leagues[playerLeagueId].schedule
      .filter(g => !g.played && (g.homeTeamId === playerTeamId || g.awayTeamId === playerTeamId))
      .sort((a, b) => a.week - b.week)[0];

    if (!playerTargetGame) break;

    if (nextInLeague.id === playerTargetGame.id) {
      // Player's game is next — sim with popup
      await simNextGame(false);
      break;
    }

    // Not the player's game yet — advance silently
    await simNextGame(true);

    if (state.phase !== 'season') break;
  }
}

// ─── Game Mode Selection ───────────────────────────────────────────────────────

function showGameModeModal() {
  const modal = document.getElementById('game-mode-overlay');
  if (modal) {
    modal.style.display = 'flex';
  }
}

function closeGameModeModal() {
  const modal = document.getElementById('game-mode-overlay');
  if (modal) {
    modal.style.display = 'none';
  }
}

/**
 * Called when player selects a game mode (Quick Sim or Watch Game)
 */
export async function setGameMode(mode) {
  PENDING_GAME_MODE = mode;
  closeGameModeModal();
  await continueSimToMyNextGame();
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

  // Determine playoff result and show season summary
  const playoffResult = getPlayerPlayoffResult(state);
  state.phase = 'offseason';
  saveGame();
  renderCurrentScreen();
  showSeasonSummary(state, playoffResult);
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
  if (allComplete) {
    const playoffResult = getPlayerPlayoffResult(state);
    showSeasonSummary(state, playoffResult);
  }
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
  if (allComplete) {
    const playoffResult = getPlayerPlayoffResult(state);
    showSeasonSummary(state, playoffResult);
  }
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

function isTradeWindowOpen(state) {
  return state.phase === 'season' && !state.tradeMarketClosed && state.week <= state.tradeDeadlineWeek;
}

function getTradeOfferChance(state) {
  if (!isTradeWindowOpen(state)) return 0;
  const weeksToDeadline = Math.max(0, state.tradeDeadlineWeek - state.week);
  const lateSeasonBoost = weeksToDeadline <= 1 ? 0.34 : weeksToDeadline <= 3 ? 0.24 : 0.16;
  const blockBoost = getTeamPlayers(state.playerTeamId, state).some(player => player.tradeBlock) ? 0.08 : 0;
  return Math.min(0.7, lateSeasonBoost + blockBoost);
}

function closeTradeMarketIfNeeded(state) {
  if (state.tradeMarketClosed || state.week <= state.tradeDeadlineWeek) return;

  state.tradeMarketClosed = true;
  state.tradeDeadlineClosedInYear = state.year;

  const expiredCount = (state.pendingTrades || []).reduce((count, trade) => {
    if (trade.status === 'pending') {
      trade.status = 'expired';
      return count + 1;
    }
    return count;
  }, 0);

  addNews({
    type: 'league',
    text: expiredCount > 0
      ? `Trade deadline passed in Week ${state.tradeDeadlineWeek}. ${expiredCount} open offers died on the table.`
      : `Trade deadline passed in Week ${state.tradeDeadlineWeek}. No more trades until next season.`,
    week: state.week,
  });
}

function getTeamPlayers(teamId, state) {
  return (state.teams[teamId]?.rosterIds || [])
    .map(id => state.allPlayers[id])
    .filter(Boolean);
}

function getTeamRankContext(teamId, state) {
  const leagueId = state.teams[teamId]?.leagueId;
  const sorted = sortStandings(state.standings[leagueId] || {});
  const rank = sorted.findIndex(entry => entry.teamId === teamId) + 1;
  const size = sorted.length || 1;
  return {
    rank,
    size,
    contender: rank > 0 && rank <= 4,
    promotionChase: leagueId !== 'phl' && rank > 0 && rank <= 3,
    relegationFight: rank >= Math.max(1, size - 2),
    bubble: rank >= 4 && rank <= 6,
  };
}

function getTradeApproach(teamId, state) {
  const team = state.teams[teamId];
  const context = getTeamRankContext(teamId, state);
  const capUsed = getTeamCapUsed(team, state.allPlayers);
  const capPressure = capUsed / Math.max(1, state.cap);

  if (context.relegationFight) return 'desperate';
  if (team.gmPersonality === 'rebuilder') return 'retool';
  if (team.gmPersonality === 'win_now' || context.contender || context.promotionChase) return 'buy';
  if (team.gmPersonality === 'cheapskate' || capPressure > 0.92) return 'dump';
  return 'balanced';
}

function roundContractMoney(amount) {
  return Math.round(amount / 50_000) * 50_000;
}

function getPlayerTradeValue(player, fromTeamId, toTeamId, state) {
  const yearsRemaining = Math.max(1, player.contractYears || 1);
  const salaryMillions = (player.salary || LEAGUE_MIN_SALARY) / 1_000_000;
  const upside = Math.max(0, (player.potential || player.overall) - player.overall);
  const ageBonus = player.age <= 24 ? 8 : player.age >= 32 ? -4 : 0;
  const termBonus = Math.min(MAX_CONTRACT_YEARS, yearsRemaining) * 2.6;
  const salaryPenalty = salaryMillions * (player.contractType === 'entry' ? 0.4 : 1.5);
  const cheapTermBonus = player.contractType === 'entry' ? 10 : 0;
  const tradeBlockBonus = player.tradeBlock ? 4 : 0;

  let value = (player.overall * 2.9) + (upside * 1.35) + ageBonus + termBonus + cheapTermBonus + tradeBlockBonus - salaryPenalty;

  const fromLeague = state.teams[fromTeamId]?.leagueId;
  const toLeague = state.teams[toTeamId]?.leagueId;
  if (fromLeague !== toLeague) {
    const leagueGap = ({ phl: 3, cd: 2, rc: 1 }[toLeague] || 0) - ({ phl: 3, cd: 2, rc: 1 }[fromLeague] || 0);
    if (leagueGap > 0 && player.age <= 25) value += 6;
    if (leagueGap < 0 && player.overall >= 74) value += 5;
  }

  return value;
}

function getDemandScore(player, acquiringTeamId, state, preferTradeBlock = false) {
  const mode = getTradeApproach(acquiringTeamId, state);
  let score = getPlayerTradeValue(player, acquiringTeamId, acquiringTeamId, state);

  if (mode === 'buy' || mode === 'desperate') {
    score += player.overall * 0.8;
    if ((player.contractYears || 0) === 1) score += 6;
  }
  if (mode === 'retool') {
    score += Math.max(0, 30 - player.age) * 1.2;
    score += Math.max(0, (player.potential || player.overall) - player.overall) * 1.3;
  }
  if (mode === 'dump') {
    score += Math.max(0, 28 - player.age);
    score += player.contractType === 'entry' ? 8 : 0;
  }
  if (preferTradeBlock && player.tradeBlock) score += 20;

  return score + Math.random() * 6;
}

function getAvailabilityScore(player, teamId, targetTeamId, state) {
  const mode = getTradeApproach(teamId, state);
  const rankContext = getTeamRankContext(teamId, state);
  const teamPlayers = getTeamPlayers(teamId, state).sort((a, b) => b.overall - a.overall);
  const topCoreIds = new Set(teamPlayers.slice(0, 3).map(p => p.id));

  let score = getPlayerTradeValue(player, teamId, targetTeamId, state);
  if (player.tradeBlock) score += 18;
  if (mode === 'dump') score += (player.salary || 0) / 250_000;
  if (mode === 'retool') score += player.age >= 29 ? 10 : -4;
  if (mode === 'buy' && (player.contractYears || 0) === 1) score += 8;
  if ((rankContext.contender || rankContext.promotionChase) && topCoreIds.has(player.id) && !player.tradeBlock) score -= 24;

  return score + Math.random() * 5;
}

function randomTopCandidate(candidates, scoreKey, poolSize = 5) {
  const sorted = [...candidates].sort((a, b) => b[scoreKey] - a[scoreKey]);
  const pool = sorted.slice(0, Math.max(1, Math.min(poolSize, sorted.length)));
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

function selectWantedPackage(players, rivalTeamId, state) {
  const candidates = players.map(player => ({
    player,
    demandScore: getDemandScore(player, rivalTeamId, state, true),
  }));

  const packageSize = Math.random() < 0.25 ? 3 : (Math.random() < 0.65 ? 2 : 1);
  const chosen = [];

  while (chosen.length < packageSize && candidates.length) {
    const picked = randomTopCandidate(candidates.filter(candidate => !chosen.some(item => item.id === candidate.player.id)), 'demandScore');
    if (!picked) break;
    chosen.push(picked.player);
    if (chosen.some(player => player.tradeBlock)) break;
  }

  return chosen;
}

function personalityTradeRatio(personality) {
  switch (personality) {
    case 'cheapskate': return 0.78;
    case 'win_now': return 1.08;
    case 'rebuilder': return 0.96;
    case 'gambler': return 0.72 + (Math.random() * 0.6);
    case 'hoarder': return 0.82;
    case 'desperate': return 1.14;
    default: return 0.95;
  }
}

function selectOfferedPackage(players, rivalTeamId, playerTeamId, state, targetValue) {
  const candidates = players.map(player => ({
    player,
    availability: getAvailabilityScore(player, rivalTeamId, playerTeamId, state),
    tradeValue: getPlayerTradeValue(player, rivalTeamId, playerTeamId, state),
  })).sort((a, b) => b.availability - a.availability);

  const chosen = [];
  let totalValue = 0;

  for (const candidate of candidates) {
    if (chosen.some(player => player.id === candidate.player.id)) continue;

    const overshoot = totalValue + candidate.tradeValue - targetValue;
    const allowOvershoot = chosen.length === 0 || overshoot <= 18 || Math.random() < 0.22;
    if (!allowOvershoot) continue;

    chosen.push(candidate.player);
    totalValue += candidate.tradeValue;

    if (chosen.length >= 3 || totalValue >= targetValue * 0.92) break;
  }

  return { players: chosen, totalValue };
}

function chooseRivalTeam(state) {
  const playerLeagueId = state.teams[state.playerTeamId]?.leagueId;
  const candidates = Object.values(state.teams)
    .filter(team => team.id !== state.playerTeamId)
    .map(team => {
      const sameLeague = team.leagueId === playerLeagueId;
      const crossLeagueBoost = sameLeague ? 1 : 1.15;
      const approach = getTradeApproach(team.id, state);
      const urgencyBoost = approach === 'buy' || approach === 'desperate' ? 1.25 : 1;
      const deadlineBoost = (state.tradeDeadlineWeek - state.week) <= 2 ? 1.25 : 1;
      return { team, weight: crossLeagueBoost * urgencyBoost * deadlineBoost };
    });

  const total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
  let roll = Math.random() * total;
  for (const candidate of candidates) {
    roll -= candidate.weight;
    if (roll <= 0) return candidate.team;
  }
  return candidates[0]?.team ?? null;
}

function buildTradeTags(state, rivalTeam, offeredPlayers, wantedPlayers) {
  const tags = [];
  if (rivalTeam.leagueId !== state.teams[state.playerTeamId]?.leagueId) tags.push('cross-league');
  if ((offeredPlayers.length + wantedPlayers.length) >= 4 || [...offeredPlayers, ...wantedPlayers].some(player => player.overall >= 82)) tags.push('blockbuster');
  if ((state.tradeDeadlineWeek - state.week) <= 1) tags.push('deadline day');
  if (wantedPlayers.some(player => player.tradeBlock)) tags.push('trade block');
  if (getTeamRankContext(rivalTeam.id, state).promotionChase) tags.push('promotion push');
  if (getTeamRankContext(rivalTeam.id, state).relegationFight) tags.push('survival push');
  return tags;
}

function classifyTradeValue(offeredValue, wantedValue) {
  if (wantedValue <= 0) return 'fair';
  const ratio = offeredValue / wantedValue;
  if (ratio >= 1.12) return 'good';
  if (ratio <= 0.7) return 'robbery';
  if (ratio <= 0.92) return 'bad';
  return 'fair';
}

function calculateTeamSalaryAfterTrade(teamId, state, incomingIds, outgoingIds) {
  const team = state.teams[teamId];
  if (!team) return 0;

  const rosterIds = new Set(team.rosterIds || []);
  outgoingIds.forEach(id => rosterIds.delete(id));
  incomingIds.forEach(id => rosterIds.add(id));

  return [...rosterIds].reduce((sum, id) => sum + (state.allPlayers[id]?.salary || 0), 0);
}

function applyContract(player, salary, years, contractType = 'standard') {
  player.salary = roundContractMoney(Math.max(LEAGUE_MIN_SALARY, salary));
  player.contractYears = Math.min(MAX_CONTRACT_YEARS, Math.max(1, years));
  player.contractLength = player.contractYears;
  player.contractType = contractType;
  player.askingSalary = null;
  player.askingContractYears = null;
}

function getProjectedNextYearCap(state) {
  return getSalaryCap(state.year + 1);
}

function getProjectedNextYearSalary(teamId, state, override = null) {
  const team = state.teams[teamId];
  if (!team) return 0;

  return (team.rosterIds || []).reduce((sum, playerId) => {
    const player = state.allPlayers[playerId];
    if (!player) return sum;
    if (override && override.playerId === playerId) return sum + override.salary;
    if (player.pendingExtension) return sum + player.pendingExtension.salary;
    if ((player.contractYears || 0) > 1) return sum + (player.salary || 0);
    return sum;
  }, 0);
}

function canRenegotiate(player) {
  return Boolean(player) && (player.contractYears || 0) === 1;
}

function buildExtensionOffer(player) {
  const baseSalary = calculateSalary(player.overall, player.age + 1);
  const multiplier = player.contractType === 'entry' ? 1.1 : player.age >= 31 ? 0.98 : 1.05;
  const years = Math.min(
    MAX_CONTRACT_YEARS,
    Math.max(2, player.overall >= 84 ? 5 : player.overall >= 75 ? 4 : player.overall >= 66 ? 3 : 2)
  );
  return {
    salary: roundContractMoney(Math.max(baseSalary, (player.salary || LEAGUE_MIN_SALARY) * multiplier)),
    years,
  };
}

function prepareFreeAgentMarket(player) {
  const askingYears = Math.min(
    MAX_CONTRACT_YEARS,
    Math.max(1, player.age >= 33 ? 1 : player.overall >= 82 ? 4 : player.overall >= 72 ? 3 : 2)
  );
  player.askingContractYears = askingYears;
  player.askingSalary = roundContractMoney(calculateSalary(player.overall, player.age) * (1.03 + (askingYears * 0.03)));
  player.contractYears = 0;
  player.contractLength = 0;
  player.contractType = 'standard';
  player.pendingExtension = null;
}

function normalizeLoadedPlayer(player) {
  const accruedSeasons = Math.max(0, player.accruedSeasons ?? (player.age ? player.age - 18 : 0));
  const contractYears = Math.max(0, player.contractYears ?? 0);
  const onEntryDeal = player.contractType
    ? player.contractType === 'entry'
    : (contractYears > 0 && accruedSeasons < ENTRY_LEVEL_YEARS && (player.salary || 0) <= LEAGUE_MIN_SALARY);

  return {
    ...player,
    salary: onEntryDeal ? LEAGUE_MIN_SALARY : Math.max(LEAGUE_MIN_SALARY, player.salary || LEAGUE_MIN_SALARY),
    contractYears,
    contractLength: Math.max(contractYears, player.contractLength ?? contractYears),
    contractType: onEntryDeal ? 'entry' : (player.contractType || 'standard'),
    accruedSeasons,
    tradeBlock: Boolean(player.tradeBlock),
    pendingExtension: player.pendingExtension ?? null,
    askingSalary: player.askingSalary ?? null,
    askingContractYears: player.askingContractYears ?? null,
  };
}

function normalizeLoadedState(state) {
  state.version = APP_VERSION;
  state.tradeDeadlineWeek = state.tradeDeadlineWeek ?? TRADE_DEADLINE_WEEK;
  state.tradeMarketClosed = Boolean(state.tradeMarketClosed);
  state.tradeDeadlineClosedInYear = state.tradeDeadlineClosedInYear ?? null;
  state.pendingTrades = (state.pendingTrades || []).map(trade => ({
    ...trade,
    tags: trade.tags || [],
    offeredSalary: trade.offeredSalary ?? null,
    wantedSalary: trade.wantedSalary ?? null,
  }));
  state.tradeHistory = (state.tradeHistory || []).map(trade => ({
    ...trade,
    tags: trade.tags || [],
    offeredSalary: trade.offeredSalary ?? null,
    wantedSalary: trade.wantedSalary ?? null,
  }));

  Object.keys(state.allPlayers || {}).forEach(playerId => {
    state.allPlayers[playerId] = normalizeLoadedPlayer(state.allPlayers[playerId]);
  });

  Object.keys(state.teams || {}).forEach(teamId => {
    normalizeTeamTradablePicks(state.teams[teamId], teamId, state.year ?? 1);
  });

  if (state.phase === 'season') {
    state.week = getCurrentScheduleWeek(state);
  }
}

function getCurrentScheduleWeek(state) {
  const nextWeeks = Object.values(state.leagues || {})
    .map(league => (league.schedule || [])
      .filter(game => !game.played)
      .sort((a, b) => (a.week ?? 0) - (b.week ?? 0))[0]?.week)
    .filter(week => week != null);

  if (nextWeeks.length === 0) {
    return state.week ?? 0;
  }

  return Math.min(...nextWeeks);
}

function syncAppVersionUI() {
  document.title = `Hockey GM v${APP_VERSION}`;

  const titleVersion = document.getElementById('title-app-version');
  if (titleVersion) titleVersion.textContent = `v${APP_VERSION}`;

  const headerVersion = document.getElementById('hdr-app-version');
  if (headerVersion) headerVersion.textContent = `v${APP_VERSION}`;
}

function createTeamTradablePicks(teamId, startYear = 1) {
  const picks = [];
  for (let offset = 1; offset <= TRADEABLE_PICK_YEARS; offset++) {
    const year = startYear + offset;
    TRADEABLE_PICK_ROUNDS.forEach(round => {
      picks.push({
        id: `pick_${teamId}_y${year}_r${round}`,
        year,
        round,
        originalTeamId: teamId,
        currentTeamId: teamId,
        label: `Y${year} R${round} (${teamId.toUpperCase()})`,
      });
    });
  }
  return picks;
}

function normalizeTeamTradablePicks(team, teamId, currentYear = 1) {
  if (!team) return;
  const fallback = createTeamTradablePicks(teamId, currentYear);
  if (!Array.isArray(team.tradablePicks) || team.tradablePicks.length === 0) {
    team.tradablePicks = fallback;
    return;
  }

  const seen = new Set();
  team.tradablePicks = team.tradablePicks
    .map((pick, idx) => {
      const year = Math.max(currentYear + 1, Number(pick.year ?? (currentYear + 1)));
      const round = Math.min(3, Math.max(1, Number(pick.round ?? 1)));
      const originalTeamId = pick.originalTeamId || teamId;
      const id = pick.id || `pick_${originalTeamId}_y${year}_r${round}_${idx}`;
      if (seen.has(id)) return null;
      seen.add(id);
      return {
        id,
        year,
        round,
        originalTeamId,
        currentTeamId: teamId,
        label: pick.label || `Y${year} R${round} (${String(originalTeamId).toUpperCase()})`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.year - b.year) || (a.round - b.round));
}

function getTeamTradablePicks(teamId, state) {
  return (state.teams[teamId]?.tradablePicks || []).slice();
}

function findTeamPickById(teamId, pickId, state) {
  return getTeamTradablePicks(teamId, state).find(pick => pick.id === pickId) || null;
}

function getPickTradeValue(pick, acquiringTeamId, state) {
  const yearsOut = Math.max(0, (pick.year || state.year) - state.year);
  const base = pick.round === 1 ? 38 : pick.round === 2 ? 24 : 15;
  const timingPenalty = yearsOut * 4;
  const mode = getTradeApproach(acquiringTeamId, state);

  let modeAdj = 0;
  if (mode === 'buy') modeAdj = pick.round === 1 ? -8 : -5;
  if (mode === 'desperate') modeAdj = pick.round === 1 ? -10 : -6;
  if (mode === 'retool') modeAdj = pick.round === 1 ? 7 : 4;
  if (mode === 'dump') modeAdj = 5;

  return Math.max(6, base - timingPenalty + modeAdj);
}

function sumPlayerTradeValue(playerIds, fromTeamId, toTeamId, state) {
  return (playerIds || []).reduce((sum, playerId) => {
    const player = state.allPlayers[playerId];
    if (!player) return sum;
    return sum + getPlayerTradeValue(player, fromTeamId, toTeamId, state);
  }, 0);
}

function sumPickTradeValue(pickIds, fromTeamId, toTeamId, state) {
  return (pickIds || []).reduce((sum, pickId) => {
    const pick = findTeamPickById(fromTeamId, pickId, state);
    if (!pick) return sum;
    return sum + getPickTradeValue(pick, toTeamId, state);
  }, 0);
}

function teamOwnsPicks(teamId, pickIds, state) {
  const owned = new Set(getTeamTradablePicks(teamId, state).map(pick => pick.id));
  return (pickIds || []).every(pickId => owned.has(pickId));
}

// ─── Trades ───────────────────────────────────────────────────────────────────

async function generateIncomingTradeOffer() {
  const state = GAME_STATE;
  const playerTeam = state.teams[state.playerTeamId];
  const playerTeamId = state.playerTeamId;

  const rivalTeam = chooseRivalTeam(state);
  if (!rivalTeam) return;

  const rivalPlayers = getTeamPlayers(rivalTeam.id, state);
  const yourPlayers  = getTeamPlayers(playerTeamId, state);
  if (rivalPlayers.length === 0 || yourPlayers.length === 0) return;

  const wantedPlayers = selectWantedPackage(yourPlayers, rivalTeam.id, state);
  if (wantedPlayers.length === 0) return;

  const desiredReturn = wantedPlayers.reduce(
    (sum, player) => sum + getPlayerTradeValue(player, playerTeamId, rivalTeam.id, state),
    0,
  ) * personalityTradeRatio(rivalTeam.gmPersonality);

  const offerResult = selectOfferedPackage(rivalPlayers, rivalTeam.id, playerTeamId, state, desiredReturn);
  const offeredPlayers = offerResult.players;
  if (offeredPlayers.length === 0) return;

  const offeredValue = offeredPlayers.reduce(
    (sum, player) => sum + getPlayerTradeValue(player, rivalTeam.id, playerTeamId, state),
    0,
  );
  const wantedValue = wantedPlayers.reduce(
    (sum, player) => sum + getPlayerTradeValue(player, playerTeamId, rivalTeam.id, state),
    0,
  );
  const rivalPostTradeSalary = calculateTeamSalaryAfterTrade(rivalTeam.id, state, wantedPlayers.map(player => player.id), offeredPlayers.map(player => player.id));
  const playerPostTradeSalary = calculateTeamSalaryAfterTrade(playerTeamId, state, offeredPlayers.map(player => player.id), wantedPlayers.map(player => player.id));
  if (rivalPostTradeSalary > state.cap || playerPostTradeSalary > state.cap) return;

  const tags = buildTradeTags(state, rivalTeam, offeredPlayers, wantedPlayers);

  const offerData = await generateTradeOffer(
    rivalTeam,
    offeredPlayers,
    wantedPlayers,
    [],
    [],
    {
      week: state.week,
      deadlineWeek: state.tradeDeadlineWeek,
      tags,
      fromLeague: rivalTeam.leagueId,
      toLeague: playerTeam.leagueId,
    }
  );

  const trade = {
    id: `trade_${Date.now()}`,
    fromTeamId: rivalTeam.id,
    toTeamId: playerTeamId,
    offered: offeredPlayers.map(player => player.id),
    wanted:  wantedPlayers.map(player => player.id),
    offeredPicks: [],
    wantedPicks:  [],
    offerText: offerData.offerText,
    gmQuote:   offerData.gmQuote,
    valueOpinion: classifyTradeValue(offeredValue, wantedValue),
    status: 'pending',
    week: state.week,
    tags,
    offeredSalary: offeredPlayers.reduce((sum, player) => sum + (player.salary || 0), 0),
    wantedSalary: wantedPlayers.reduce((sum, player) => sum + (player.salary || 0), 0),
  };

  state.pendingTrades.push(trade);
  addNews({ type: 'trade_offer', tradeId: trade.id, fromTeamId: rivalTeam.id, week: state.week, tags });
}

export function findTradeTargets(need = 'any') {
  const state = GAME_STATE;
  const playerTeamId = state.playerTeamId;
  const playerTeam = state.teams[playerTeamId];
  if (!playerTeam) return [];

  const leagueId = playerTeam.leagueId;
  const teamsInLeague = state.leagues?.[leagueId]?.teamIds || [];
  const teamApproach = getTradeApproach(playerTeamId, state);
  const capRoom = Math.max(0, state.cap - getTeamCapUsed(playerTeam, state.allPlayers));
  const candidates = [];

  teamsInLeague.forEach(teamId => {
    if (teamId === playerTeamId) return;
    const roster = getTeamPlayers(teamId, state);
    roster.forEach(player => {
      if (!matchesNeed(player, need)) return;
      const tradeValue = getPlayerTradeValue(player, teamId, playerTeamId, state);
      const fitScore = getNeedFitScore(player, need);
      const capImpact = capRoom - (player.salary || 0);
      const capPenalty = capImpact >= 0 ? 0 : Math.abs(capImpact) / 350_000;
      const teamWeight = teamApproach === 'buy'
        ? (player.overall >= 76 ? 14 : 6)
        : teamApproach === 'retool'
          ? (player.age <= 26 ? 12 : -5)
          : teamApproach === 'dump'
            ? ((player.contractYears || 0) === 1 ? 10 : 2)
            : 4;
      const expiringBonus = (player.contractYears || 0) === 1 ? 8 : 0;
      const score = tradeValue + fitScore + expiringBonus + teamWeight - capPenalty;
      candidates.push({
        playerId: player.id,
        teamId,
        score,
        expiring: (player.contractYears || 0) === 1,
        fitScore,
        capImpact,
      });
    });
  });

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 16)
    .map(entry => ({
      ...entry,
      player: state.allPlayers[entry.playerId],
      team: state.teams[entry.teamId],
    }));
}

export function findExpiringContractTargets(limit = 30) {
  const state = GAME_STATE;
  const playerTeamId = state.playerTeamId;
  const playerTeam = state.teams[playerTeamId];
  if (!playerTeam) return [];

  const leagueId = playerTeam.leagueId;
  const teamsInLeague = state.leagues?.[leagueId]?.teamIds || [];
  const capRoom = Math.max(0, state.cap - getTeamCapUsed(playerTeam, state.allPlayers));
  const targets = [];

  teamsInLeague.forEach(teamId => {
    if (teamId === playerTeamId) return;
    getTeamPlayers(teamId, state).forEach(player => {
      if ((player.contractYears || 0) !== 1) return;
      targets.push({
        playerId: player.id,
        teamId,
        capImpact: capRoom - (player.salary || 0),
        score: (player.overall * 3) + Math.max(0, (player.potential || player.overall) - player.overall) + (capRoom >= (player.salary || 0) ? 6 : -8),
      });
    });
  });

  return targets
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit))
    .map(entry => ({
      ...entry,
      player: state.allPlayers[entry.playerId],
      team: state.teams[entry.teamId],
    }));
}

export function requestTargetedOffer(playerId, fromTeamId) {
  const state = GAME_STATE;
  if (!isTradeWindowOpen(state)) {
    alert('Trade market is closed.');
    return null;
  }

  const playerTeamId = state.playerTeamId;
  const rivalTeam = state.teams[fromTeamId];
  const targetPlayer = state.allPlayers[playerId];
  if (!rivalTeam || !targetPlayer) return null;
  if (!rivalTeam.rosterIds?.includes(playerId)) return null;

  const targetValue = getPlayerTradeValue(targetPlayer, rivalTeam.id, playerTeamId, state);
  const yourPlayers = getTeamPlayers(playerTeamId, state)
    .map(player => ({
      player,
      demandScore: getDemandScore(player, rivalTeam.id, state, player.tradeBlock),
      tradeValue: getPlayerTradeValue(player, playerTeamId, rivalTeam.id, state),
    }))
    .sort((a, b) => b.demandScore - a.demandScore);

  const wantedPlayers = [];
  let wantedValue = 0;
  for (const candidate of yourPlayers) {
    if (candidate.player.id === playerId) continue;
    wantedPlayers.push(candidate.player);
    wantedValue += candidate.tradeValue;
    if (wantedPlayers.length >= 2 || wantedValue >= targetValue * 0.92) break;
  }

  if (wantedPlayers.length === 0) return null;

  const offeredPlayers = [targetPlayer];
  const playerPostTradeSalary = calculateTeamSalaryAfterTrade(playerTeamId, state, offeredPlayers.map(player => player.id), wantedPlayers.map(player => player.id));
  const rivalPostTradeSalary = calculateTeamSalaryAfterTrade(rivalTeam.id, state, wantedPlayers.map(player => player.id), offeredPlayers.map(player => player.id));
  if (playerPostTradeSalary > state.cap || rivalPostTradeSalary > state.cap) {
    alert('Could not find a cap-compliant framework for that target.');
    return null;
  }

  const trade = {
    id: `trade_${Date.now()}`,
    fromTeamId: rivalTeam.id,
    toTeamId: playerTeamId,
    offered: offeredPlayers.map(player => player.id),
    wanted: wantedPlayers.map(player => player.id),
    offeredPicks: [],
    wantedPicks: [],
    offerText: `You asked about ${targetPlayer.fullName}. ${rivalTeam.gmName} replied with this framework.`,
    gmQuote: `"If you want ${targetPlayer.lastName}, this is what it costs today."`,
    valueOpinion: classifyTradeValue(
      offeredPlayers.reduce((sum, player) => sum + getPlayerTradeValue(player, rivalTeam.id, playerTeamId, state), 0),
      wantedPlayers.reduce((sum, player) => sum + getPlayerTradeValue(player, playerTeamId, rivalTeam.id, state), 0)
    ),
    status: 'pending',
    week: state.week,
    tags: ['requested', 'targeted'],
    offeredSalary: offeredPlayers.reduce((sum, player) => sum + (player.salary || 0), 0),
    wantedSalary: wantedPlayers.reduce((sum, player) => sum + (player.salary || 0), 0),
  };

  state.pendingTrades.push(trade);
  addNews({ type: 'trade_offer', tradeId: trade.id, fromTeamId: rivalTeam.id, week: state.week, tags: trade.tags });
  saveGame();
  return trade;
}

export function proposeTradeFromDesk(targetTeamId, offeredPlayerIds, wantedPlayerIds, offeredPickIds = [], wantedPickIds = []) {
  const state = GAME_STATE;
  if (!isTradeWindowOpen(state)) {
    alert('Trade market is closed.');
    return { result: 'closed' };
  }

  const playerTeamId = state.playerTeamId;
  const fromTeam = state.teams[targetTeamId];
  const toTeam = state.teams[playerTeamId];
  if (!fromTeam || !toTeam) return { result: 'invalid' };

  const outgoingPlayerIds = Array.isArray(offeredPlayerIds)
    ? [...new Set(offeredPlayerIds)]
    : (offeredPlayerIds ? [offeredPlayerIds] : []);
  const incomingPlayerIds = Array.isArray(wantedPlayerIds)
    ? [...new Set(wantedPlayerIds)]
    : (wantedPlayerIds ? [wantedPlayerIds] : []);
  const outgoingPickIds = [...new Set(Array.isArray(offeredPickIds) ? offeredPickIds : (offeredPickIds ? [offeredPickIds] : []))];
  const incomingPickIds = [...new Set(Array.isArray(wantedPickIds) ? wantedPickIds : (wantedPickIds ? [wantedPickIds] : []))];

  if (outgoingPlayerIds.length === 0 && outgoingPickIds.length === 0) return { result: 'invalid' };
  if (incomingPlayerIds.length === 0 && incomingPickIds.length === 0) return { result: 'invalid' };

  if (!outgoingPlayerIds.every(playerId => toTeam.rosterIds?.includes(playerId))) return { result: 'invalid' };
  if (!incomingPlayerIds.every(playerId => fromTeam.rosterIds?.includes(playerId))) return { result: 'invalid' };
  if (!teamOwnsPicks(toTeam.id, outgoingPickIds, state) || !teamOwnsPicks(fromTeam.id, incomingPickIds, state)) return { result: 'invalid' };

  const fromPostTradeSalary = calculateTeamSalaryAfterTrade(fromTeam.id, state, outgoingPlayerIds, incomingPlayerIds);
  const toPostTradeSalary = calculateTeamSalaryAfterTrade(toTeam.id, state, incomingPlayerIds, outgoingPlayerIds);
  if (fromPostTradeSalary > state.cap || toPostTradeSalary > state.cap) {
    alert('That proposal fails the cap check.');
    return { result: 'cap' };
  }

  const offeredValue = sumPlayerTradeValue(outgoingPlayerIds, toTeam.id, fromTeam.id, state)
    + sumPickTradeValue(outgoingPickIds, toTeam.id, fromTeam.id, state);
  const wantedValue = sumPlayerTradeValue(incomingPlayerIds, fromTeam.id, toTeam.id, state)
    + sumPickTradeValue(incomingPickIds, fromTeam.id, toTeam.id, state);

  const rivalApproach = getTradeApproach(fromTeam.id, state);
  const weighting = rivalApproach === 'buy' || rivalApproach === 'desperate'
    ? 1.03
    : rivalApproach === 'retool'
      ? 0.97
      : 1;

  const ratio = offeredValue / Math.max(1, wantedValue);
  const acceptanceThreshold = fromTeam.gmPersonality === 'cheapskate' ? 1.05
    : fromTeam.gmPersonality === 'gambler' ? 0.88
    : 0.96 * weighting;

  const incomingNames = incomingPlayerIds
    .map(playerId => state.allPlayers[playerId]?.fullName)
    .filter(Boolean)
    .join(', ');

  const trade = {
    id: `trade_${Date.now()}`,
    fromTeamId: fromTeam.id,
    toTeamId: toTeam.id,
    offered: incomingPlayerIds,
    wanted: outgoingPlayerIds,
    offeredPicks: incomingPickIds,
    wantedPicks: outgoingPickIds,
    offerText: `Your proposal targets: ${incomingNames || 'pick package'}`,
    gmQuote: '',
    valueOpinion: classifyTradeValue(wantedValue, offeredValue),
    status: 'pending',
    week: state.week,
    tags: ['user-proposal'],
    offeredSalary: incomingPlayerIds.reduce((sum, playerId) => sum + (state.allPlayers[playerId]?.salary || 0), 0),
    wantedSalary: outgoingPlayerIds.reduce((sum, playerId) => sum + (state.allPlayers[playerId]?.salary || 0), 0),
  };

  if (ratio >= acceptanceThreshold || Math.random() < 0.12) {
    trade.status = 'accepted';
    trade.gmQuote = `"Deal. We'll file it with the league office."`;
    executeAcceptedTrade(state, trade);
    alert(`${fromTeam.gmName} accepted your proposal.`);
    return { result: 'accepted', trade };
  }

  const closeEnough = ratio >= (acceptanceThreshold - 0.08);
  if (closeEnough) {
    const sweetener = getTeamPlayers(playerTeamId, state)
      .filter(player => !outgoingPlayerIds.includes(player.id))
      .sort((a, b) => getPlayerTradeValue(a, playerTeamId, fromTeam.id, state) - getPlayerTradeValue(b, playerTeamId, fromTeam.id, state))[0];

    if (sweetener) {
      trade.wanted.push(sweetener.id);
      trade.offerText = `${fromTeam.gmName} countered your proposal.`;
      trade.gmQuote = `"Add ${sweetener.fullName} and we can make this work."`;
      trade.tags.push('counter');
      trade.wantedSalary += sweetener.salary || 0;
      state.pendingTrades.push(trade);
      addNews({ type: 'trade_offer', tradeId: trade.id, fromTeamId: fromTeam.id, week: state.week, tags: trade.tags });
      saveGame();
      return { result: 'counter', trade };
    }

    const pickSweetener = getTeamTradablePicks(playerTeamId, state).find(pick => !outgoingPickIds.includes(pick.id));
    if (pickSweetener) {
      trade.wantedPicks.push(pickSweetener.id);
      trade.offerText = `${fromTeam.gmName} countered your proposal.`;
      trade.gmQuote = `"Include ${pickSweetener.label} and we're done."`;
      trade.tags.push('counter');
      state.pendingTrades.push(trade);
      addNews({ type: 'trade_offer', tradeId: trade.id, fromTeamId: fromTeam.id, week: state.week, tags: trade.tags });
      saveGame();
      return { result: 'counter', trade };
    }
  }

  addNews({
    type: 'league',
    text: `${fromTeam.gmName} declined your trade proposal.`,
    week: state.week,
  });
  saveGame();
  return { result: 'declined' };
}

/**
 * Accepts a trade offer.
 */
export function acceptTrade(tradeId) {
  const state = GAME_STATE;
  const trade = state.pendingTrades.find(t => t.id === tradeId);
  if (!trade || trade.status !== 'pending') return;
  if (!isTradeWindowOpen(state)) {
    alert('Trade deadline has passed. This offer is no longer valid.');
    trade.status = 'expired';
    saveGame();
    return;
  }

  const fromTeam = state.teams[trade.fromTeamId];
  const toTeam   = state.teams[trade.toTeamId];

  // Check if any offered players are injured
  for (const playerId of trade.offered) {
    const player = state.allPlayers[playerId];
    if (player && !canPlayerBeTrade(player)) {
      alert(`${player.fullName} is injured and cannot be traded.`);
      return;
    }
  }

  for (const playerId of trade.wanted) {
    const player = state.allPlayers[playerId];
    if (player && !canPlayerBeTrade(player)) {
      alert(`${player.fullName} is injured and cannot be traded.`);
      return;
    }
  }

  const fromPostTradeSalary = calculateTeamSalaryAfterTrade(fromTeam.id, state, trade.wanted, trade.offered);
  const toPostTradeSalary = calculateTeamSalaryAfterTrade(toTeam.id, state, trade.offered, trade.wanted);
  if (fromPostTradeSalary > state.cap || toPostTradeSalary > state.cap) {
    alert('This trade would put one of the teams over the salary cap.');
    return;
  }

  executeAcceptedTrade(state, trade);
}

export function declineTrade(tradeId) {
  const state = GAME_STATE;
  const trade = state.pendingTrades.find(t => t.id === tradeId);
  if (!trade) return;
  trade.status = 'declined';
  saveGame();
}

function executeAcceptedTrade(state, trade) {
  const fromTeam = state.teams[trade.fromTeamId];
  const toTeam = state.teams[trade.toTeamId];
  if (!fromTeam || !toTeam) return;

  trade.wanted.forEach(pid => {
    fromTeam.rosterIds.push(pid);
    toTeam.rosterIds = toTeam.rosterIds.filter(id => id !== pid);
    if (state.allPlayers[pid]) state.allPlayers[pid].tradeBlock = false;
  });
  trade.offered.forEach(pid => {
    toTeam.rosterIds.push(pid);
    fromTeam.rosterIds = fromTeam.rosterIds.filter(id => id !== pid);
    if (state.allPlayers[pid]) state.allPlayers[pid].tradeBlock = false;
  });

  transferPickOwnership(fromTeam, toTeam, trade.offeredPicks || []);
  transferPickOwnership(toTeam, fromTeam, trade.wantedPicks || []);

  trade.status = 'accepted';
  state.tradeHistory.push(trade);
  addNews({ type: 'trade_complete', tradeId: trade.id, week: state.week });
  saveGame();
}

function transferPickOwnership(fromTeam, toTeam, pickIds) {
  if (!Array.isArray(pickIds) || pickIds.length === 0) return;
  if (!Array.isArray(fromTeam.tradablePicks)) fromTeam.tradablePicks = [];
  if (!Array.isArray(toTeam.tradablePicks)) toTeam.tradablePicks = [];

  pickIds.forEach(pickId => {
    const idx = fromTeam.tradablePicks.findIndex(pick => pick.id === pickId);
    if (idx === -1) return;
    const [pick] = fromTeam.tradablePicks.splice(idx, 1);
    pick.currentTeamId = toTeam.id;
    toTeam.tradablePicks.push(pick);
  });

  const sorter = (a, b) => (a.year - b.year) || (a.round - b.round);
  fromTeam.tradablePicks.sort(sorter);
  toTeam.tradablePicks.sort(sorter);
}

function getNeedFitScore(player, need) {
  if (!need || need === 'any') return 5;
  const position = player.position;
  if (need === position) return 20;
  if (need === 'fwd' && ['C', 'LW', 'RW'].includes(position)) return 14;
  if (need === 'def' && ['LD', 'RD'].includes(position)) return 14;
  if (need === 'G' && position === 'G') return 18;
  return -6;
}

function matchesNeed(player, need) {
  if (!need || need === 'any') return true;
  const pos = player.position;
  switch (need) {
    case 'fwd': return ['C', 'LW', 'RW'].includes(pos);
    case 'def': return ['LD', 'RD'].includes(pos);
    case 'g': return pos === 'G';
    default: return pos === need;
  }
}

export function toggleTradeBlock(playerId) {
  const player = GAME_STATE?.allPlayers?.[playerId];
  if (!player) return;
  player.tradeBlock = !player.tradeBlock;
  saveGame();
}

export function renegotiatePlayer(playerId) {
  const state = GAME_STATE;
  const player = state?.allPlayers?.[playerId];
  const team = state?.teams?.[state.playerTeamId];
  if (!player || !team || !team.rosterIds?.includes(playerId)) return;
  if (!canRenegotiate(player)) {
    alert(`${player.fullName} can only renegotiate in the final year of the deal.`);
    return;
  }

  const offer = buildExtensionOffer(player);
  const projectedCap = getProjectedNextYearCap(state);
  const projectedSalary = getProjectedNextYearSalary(state.playerTeamId, state, { playerId, salary: offer.salary });
  if (projectedSalary > projectedCap) {
    alert(`Cannot extend ${player.fullName}. Next year's projected cap hit would be ${formatSalary(projectedSalary)} against a ${formatSalary(projectedCap)} cap.`);
    return;
  }

  const confirmed = confirm(
    `Offer ${player.fullName} an extension worth ${formatSalary(offer.salary)} for ${offer.years} years starting next season?`
  );
  if (!confirmed) return;

  player.pendingExtension = offer;
  addNews({
    type: 'league',
    text: `Extension agreed in principle: ${player.fullName} (${player.position}) for ${offer.years} years at ${formatSalary(offer.salary)} per season.`,
    week: state.week,
  });
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

  const contractSalary = player.askingSalary ?? player.salary ?? LEAGUE_MIN_SALARY;
  const contractYears = player.askingContractYears ?? Math.max(1, player.contractYears || 1);

  // Cap check
  const used = (team.rosterIds || [])
    .map(id => state.allPlayers[id])
    .filter(Boolean)
    .reduce((sum, p) => sum + (p.salary || 0), 0);

  if (used + contractSalary > state.cap) {
    alert(`Cannot sign ${player.fullName} — not enough cap space.`);
    return;
  }

  // Add to roster, remove from free agents
  if (!team.rosterIds) team.rosterIds = [];
  team.rosterIds.push(playerId);
  state.freeAgents = state.freeAgents.filter(id => id !== playerId);
  applyContract(player, contractSalary, contractYears, 'standard');
  player.tradeBlock = false;

  addNews({
    type: 'league',
    text: `Signed: ${player.fullName} (${player.position}, ${formatSalary(contractSalary)}/yr for ${contractYears} years)`,
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

function generatePostGameSocialFeed(state, homeTeam, awayTeam, result) {
  const playerTeam = state.teams[state.playerTeamId];
  if (!playerTeam) return [];

  const isHome = homeTeam.id === playerTeam.id;
  const opponent = isHome ? awayTeam : homeTeam;
  const teamGoals = isHome ? result.homeGoals : result.awayGoals;
  const oppGoals = isHome ? result.awayGoals : result.homeGoals;
  const teamShots = isHome ? result.homeShots : result.awayShots;
  const oppShots = isHome ? result.awayShots : result.homeShots;
  const won = teamGoals > oppGoals;
  const goalDiff = teamGoals - oppGoals;
  const shotDiff = teamShots - oppShots;
  const overtimeLabel = result.overtimeType ? ` in ${result.overtimeType}` : '';
  const standings = state.standings?.[playerTeam.leagueId]?.[playerTeam.id];
  const record = standings ? `${standings.w}-${standings.l}-${standings.otl}` : '0-0-0';
  const topStar = (result.stars || []).find(({ teamId }) => teamId === playerTeam.id)?.player;
  const starName = topStar?.lastName || topStar?.fullName || 'the top line';
  const leagueTag = playerTeam.leagueId?.toUpperCase() || 'LEAGUE';

  const accountSeed = (state.week || 0) + teamGoals + oppGoals;
  const lossStreak = getCurrentLossStreak(state, playerTeam.id, !won);
  const recentTrade = getRecentTradeForTeam(state, playerTeam.id);
  const pendingTrades = (state.pendingTrades || []).filter(t => t.status === 'pending').length;
  const goalieSvPct = oppShots > 0 ? (oppShots - oppGoals) / oppShots : 1;

  const tradeLine = recentTrade
    ? `Insiders are still arguing about last week's move with ${state.teams[recentTrade.fromTeamId === playerTeam.id ? recentTrade.toTeamId : recentTrade.fromTeamId]?.abbrev ?? 'a rival'}.`
    : pendingTrades >= 3
      ? `Phones are buzzing with ${pendingTrades} active proposals and the deadline clock ticking.`
      : state.tradeMarketClosed
        ? 'Deadline has passed, so tonight was all about the room and the bench.'
        : 'No confirmed move yet, but cap chatter is back in every postgame thread.';

  const streakLine = lossStreak >= 3
    ? `${playerTeam.abbrev} are now on a ${lossStreak}-game skid and the timeline is demanding a shakeup tonight.`
    : !won && lossStreak === 2
      ? `${playerTeam.abbrev} have dropped two straight and fans are already circling the next road game.`
      : won && lossStreak === 0
        ? `${playerTeam.abbrev} finally calm things down with two points${overtimeLabel}.`
        : `${playerTeam.abbrev} are still searching for consistency game to game.`;

  const goalieLine = goalieSvPct >= 0.93
    ? `Goalie watch: ${(goalieSvPct * 100).toFixed(1)}% save rate tonight. ${playerTeam.abbrev} stole this one in net.`
    : goalieSvPct <= 0.85
      ? `Goalie watch: ${(goalieSvPct * 100).toFixed(1)}% save rate tonight. Social is questioning the crease plan.`
      : `Goalie watch: ${(goalieSvPct * 100).toFixed(1)}% save rate. Solid enough, but not a bailout performance.`;

  const fanPost = won
    ? `${playerTeam.abbrev} bank two points${overtimeLabel}. ${starName} showed up and the building felt alive.`
    : `${playerTeam.abbrev} drop another one${overtimeLabel}. ${goalDiff <= -3 ? 'That was a flat-out collapse.' : 'Fans are staring at the GM now.'}`;
  const insiderPost = won
    ? `${leagueTag} chatter: ${teamGoals}-${oppGoals} over ${opponent.abbrev}. ${tradeLine}`
    : `${leagueTag} insiders after ${teamGoals}-${oppGoals} vs ${opponent.abbrev}: ${tradeLine}`;
  const shotPost = shotDiff >= 8
    ? `${playerTeam.abbrev} owned shots ${teamShots}-${oppShots}. Process people are calling this sustainable.`
    : shotDiff <= -8
      ? `${playerTeam.abbrev} were underwater in shots ${teamShots}-${oppShots}. Social is calling out the pace.`
      : `${playerTeam.abbrev} and ${opponent.abbrev} traded chances all night. The timeline is split.`;
  const pressurePost = won
    ? `${record} doesn't look like a fire drill anymore. ${streakLine}`
    : `${record} is the kind of record that turns every rumor into a five-alarm story. ${streakLine}`;
  const chaosPost = `${goalieLine} Wild rumor hour says "deadline plans changed" from a source who may literally be the mascot.`;

  const candidates = [
    { handle: pickLeagueAccount(playerTeam.leagueId, 'fan', accountSeed), kind: 'fan', text: fanPost },
    { handle: pickLeagueAccount(playerTeam.leagueId, 'insider', accountSeed + 1), kind: 'insider', text: insiderPost },
    { handle: pickLeagueAccount(playerTeam.leagueId, 'analytics', accountSeed + 2), kind: 'analytics', text: shotPost },
    { handle: pickLeagueAccount(playerTeam.leagueId, 'pressure', accountSeed + 3), kind: 'pressure', text: pressurePost },
    { handle: pickLeagueAccount(playerTeam.leagueId, 'chaos', accountSeed + 4), kind: 'rumor', text: chaosPost },
  ];

  return [...candidates]
    .sort(() => Math.random() - 0.5)
    .slice(0, 5);
}

function pickLeagueAccount(leagueId, kind, seed = 0) {
  const bank = LEAGUE_SOCIAL_ACCOUNTS[leagueId] || LEAGUE_SOCIAL_ACCOUNTS.phl;
  const accounts = bank[kind] || ['@LeagueWire'];
  return accounts[Math.abs(seed) % accounts.length];
}

function getRecentTradeForTeam(state, teamId) {
  return (state.tradeHistory || []).find(trade =>
    (trade.fromTeamId === teamId || trade.toTeamId === teamId) &&
    ((state.week ?? 0) - (trade.week ?? 0) <= 2)
  ) || null;
}

function getCurrentLossStreak(state, teamId, currentGameWasLoss) {
  let streak = currentGameWasLoss ? 1 : 0;
  const teamGames = (state.news || []).filter(item =>
    item.type === 'game' && (item.homeTeamId === teamId || item.awayTeamId === teamId)
  );

  for (const game of teamGames) {
    const isHome = game.homeTeamId === teamId;
    const teamGoals = isHome ? game.homeGoals : game.awayGoals;
    const oppGoals = isHome ? game.awayGoals : game.homeGoals;
    if (teamGoals < oppGoals) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

function addSocialPulseNews(state, homeTeam, awayTeam, result, posts, leagueId) {
  const playerTeam = state.teams[state.playerTeamId];
  if (!playerTeam) return;

  const isHome = homeTeam.id === playerTeam.id;
  const teamGoals = isHome ? result.homeGoals : result.awayGoals;
  const oppGoals = isHome ? result.awayGoals : result.homeGoals;
  const opponent = isHome ? awayTeam : homeTeam;

  addNews({
    type: 'social',
    leagueId,
    teamId: playerTeam.id,
    opponentTeamId: opponent.id,
    headline: `Social pulse: ${playerTeam.abbrev} ${teamGoals}-${oppGoals} ${opponent.abbrev}`,
    report: `${posts[0]?.handle ?? '@LeagueWire'}: ${posts[0]?.text ?? ''}`,
    posts,
    week: state.week,
  });
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
    normalizeLoadedState(state);
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

  // 3. Tick contracts down once, resolve extensions, then send expired deals to market
  const newFreeAgents = [];
  const rosteredPlayerIds = new Set(Object.values(state.teams).flatMap(team => team.rosterIds || []));

  Object.values(state.allPlayers).forEach(p => {
    if (rosteredPlayerIds.has(p.id)) {
      p.accruedSeasons = (p.accruedSeasons || 0) + 1;
      p.isRookie = (p.accruedSeasons || 0) === 0;
    }

    if (p.contractYears > 0) {
      p.contractYears--;
    }
    if (p.contractYears === 0) {
      if (p.pendingExtension) {
        applyContract(p, p.pendingExtension.salary, p.pendingExtension.years, 'standard');
        p.pendingExtension = null;
        return;
      }

      // Remove from roster, add to free agent pool
      Object.values(state.teams).forEach(team => {
        if (team.rosterIds?.includes(p.id)) {
          team.rosterIds = team.rosterIds.filter(id => id !== p.id);
        }
      });
      prepareFreeAgentMarket(p);
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
  state.tradeMarketClosed = false;
  state.tradeDeadlineWeek = TRADE_DEADLINE_WEEK;
  state.tradeDeadlineClosedInYear = null;

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
    previousCap: getSalaryCap(state.year - 1),
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
  skipPreseasonDraft,
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
  findTradeTargets,
  findExpiringContractTargets,
  requestTargetedOffer,
  proposeTradeFromDesk,
  toggleTradeBlock,
  renegotiatePlayer,
  signFreeAgent,
  startDraft,
  makeDraftPick,
  skipDraftPick,
  advanceCPUPicks,
  showScreen,
  saveGame,
  deleteSave,
  restartGame,
  setGameMode,
  getState: () => GAME_STATE,
};

// Boot immediately when module loads — eliminates the setTimeout race condition
boot();
