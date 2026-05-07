/**
 * main.js
 * Game init, state machine, save/load, screen router.
 */

import { generateRoster, generatePlayer, generateDraftClass, ageAllPlayers, getExpiringContracts, formatSalary } from './engine/playerGenerator.js';
import { generateSchedule, updateStandings, sortStandings, createStandingsEntry,
         buildPlayoffBracket, determineRelegation, getSalaryCap, getTeamCapUsed } from './engine/leagueManager.js';
import { simulateGame } from './engine/gameEngine.js';
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
    phase: 'season',   // preseason | season | playoffs | offseason
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

  showScreen('dashboard');
}

// ─── Game Loop ────────────────────────────────────────────────────────────────

/**
 * Simulates the next game for each league (all leagues advance in parallel).
 * Fires Claude agents as appropriate.
 */
export async function simNextGame() {
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

    // Update standings
    state.standings[leagueId] = updateStandings(state.standings[leagueId], result);

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
  }

  // Trade offer (1-in-5 chance per sim)
  if (Math.random() < 0.20 && state.phase === 'season') {
    await generateIncomingTradeOffer();
  }

  saveGame();
  renderCurrentScreen();
}

/**
 * Sims all remaining regular season games at once.
 */
export async function simToPlayoffs() {
  while (GAME_STATE.phase === 'season') {
    await simNextGame();
  }
}

// ─── Playoffs ─────────────────────────────────────────────────────────────────

/**
 * Simulates the playoffs for all three leagues.
 * Runs semifinal A, semifinal B, then the final for each league.
 * Sets phase to 'offseason' when complete.
 */
export async function simPlayoffs() {
  const state = GAME_STATE;
  if (state.phase !== 'playoffs') return;

  const leagueIds = ['phl', 'cd', 'rc'];
  const leagueNames = { phl: 'PHL', cd: 'CD', rc: 'RC' };

  for (const leagueId of leagueIds) {
    const bracket = buildPlayoffBracket(state.standings[leagueId]);
    const leagueName = leagueNames[leagueId];

    // Semifinal A: seed 1 vs seed 4
    const sfAHome = state.teams[bracket.semifinalA.topSeed];
    const sfAAway = state.teams[bracket.semifinalA.bottomSeed];
    const sfAResult = simulateGame(sfAHome, sfAAway, state.allPlayers);
    const sfAWinner = sfAResult.homeGoals > sfAResult.awayGoals ? sfAHome : sfAAway;
    addNews({
      type: 'game',
      leagueId,
      headline: `${leagueName} Semis: ${sfAWinner.fullName} advance`,
      report: `${sfAHome.abbrev} ${sfAResult.homeGoals}–${sfAResult.awayGoals} ${sfAAway.abbrev}`,
      homeTeamId: sfAHome.id, awayTeamId: sfAAway.id,
      homeGoals: sfAResult.homeGoals, awayGoals: sfAResult.awayGoals,
      week: state.week,
    });

    // Semifinal B: seed 2 vs seed 3
    const sfBHome = state.teams[bracket.semifinalB.topSeed];
    const sfBAway = state.teams[bracket.semifinalB.bottomSeed];
    const sfBResult = simulateGame(sfBHome, sfBAway, state.allPlayers);
    const sfBWinner = sfBResult.homeGoals > sfBResult.awayGoals ? sfBHome : sfBAway;
    addNews({
      type: 'game',
      leagueId,
      headline: `${leagueName} Semis: ${sfBWinner.fullName} advance`,
      report: `${sfBHome.abbrev} ${sfBResult.homeGoals}–${sfBResult.awayGoals} ${sfBAway.abbrev}`,
      homeTeamId: sfBHome.id, awayTeamId: sfBAway.id,
      homeGoals: sfBResult.homeGoals, awayGoals: sfBResult.awayGoals,
      week: state.week,
    });

    // Final
    const finalHome = sfAWinner;
    const finalAway = sfBWinner;
    const finalResult = simulateGame(finalHome, finalAway, state.allPlayers);
    const champion = finalResult.homeGoals > finalResult.awayGoals ? finalHome : finalAway;

    // Store champion on league
    state.leagues[leagueId].champion = champion.id;

    const champAnnouncement = await generateCommissionerAnnouncement('champion', {
      champion: champion.fullName,
      league: leagueName,
    });
    addNews({
      type: 'commissioner',
      text: champAnnouncement,
      week: state.week,
    });
    addNews({
      type: 'game',
      leagueId,
      headline: `🏆 ${leagueName} Champions: ${champion.fullName}!`,
      report: `${finalHome.abbrev} ${finalResult.homeGoals}–${finalResult.awayGoals} ${finalAway.abbrev}`,
      homeTeamId: finalHome.id, awayTeamId: finalAway.id,
      homeGoals: finalResult.homeGoals, awayGoals: finalResult.awayGoals,
      week: state.week,
    });
  }

  state.phase = 'offseason';
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
  if (state.phase !== 'draft') return;
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
  if (state.draftCurrentPick >= totalPicks || state.draftClass.length === 0) {
    state.phase = 'offseason';
    addNews({
      type: 'commissioner',
      text: `Year ${state.year} draft complete. ${totalPicks} picks made across ${state.draftRounds} rounds.`,
      week: state.week,
    });
  }

  saveGame();
}

/**
 * Auto-picks best available for every CPU team until it's the player's turn
 * (or the draft ends). Call this after the player makes their own pick.
 */
export function advanceCPUPicks() {
  const state = GAME_STATE;
  if (state.phase !== 'draft') return;

  const totalTeams = state.draftOrder.length;

  while (state.phase === 'draft') {
    const pickingTeamId = state.draftOrder[state.draftCurrentPick % totalTeams];
    if (pickingTeamId === state.playerTeamId) break;
    if (state.draftClass.length === 0) break;

    const best = bestAvailableForTeam(pickingTeamId, state);
    if (!best) break;
    makeDraftPick(best);
  }

  saveGame();
  showScreen('draft');
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
  simNextGame,
  simToPlayoffs,
  simPlayoffs,
  endSeason,
  acceptTrade,
  declineTrade,
  signFreeAgent,
  startDraft,
  makeDraftPick,
  advanceCPUPicks,
  showScreen,
  saveGame,
  deleteSave,
  getState: () => GAME_STATE,
};

// Boot immediately when module loads — eliminates the setTimeout race condition
boot();
