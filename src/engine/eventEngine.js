/**
 * eventEngine.js
 * Manages league and team events during regular season play
 */

import { injureRandomPlayer, getInjuredPlayerCount } from './injurySystem.js';

let eventsList = [];

/**
 * Load all events from data file
 */
export async function loadEvents() {
  try {
    const res = await fetch('/data/leagueEvents.json');
    eventsList = await res.json();
    console.log(`Loaded ${eventsList.length} events`);
  } catch (err) {
    console.error('Failed to load events:', err);
  }
}

/**
 * Check if an event should fire this week
 * @param {number} week - Current week
 * @param {number} chaosLevel - 0-10 chaos level
 * @param {string} phase - Current game phase (should be 'season')
 * @param {Array} firedEventIds - List of event IDs that have fired this season (prevents duplicates)
 * @returns {object|null} - Event object if triggered, null otherwise
 */
export function checkForEvent(week, chaosLevel, phase, firedEventIds = []) {
  // Only fire during regular season
  if (phase !== 'season') return null;
  
  // Events fire every 2 weeks (even weeks, starting from week 2)
  if (week < 2 || week % 2 !== 0) return null;
  
  // Probability based on chaos level (increased base chance)
  const baseChance = (chaosLevel / 10) * 0.85;
  if (Math.random() > baseChance) return null;
  
  // Filter out events that have already fired this season
  const availableEvents = eventsList.filter(e => !firedEventIds.includes(e.id));
  
  if (availableEvents.length === 0) return null;  // All events used
  
  // Select random event weighted by type
  const benefitEvents = availableEvents.filter(e => e.type === 'benefit');
  const chaosEvents = availableEvents.filter(e => e.type === 'chaos');
  const benignEvents = availableEvents.filter(e => e.type === 'benign');
  
  let event = null;
  
  // Higher chaos = more chaos events
  const roll = Math.random();
  if (chaosLevel >= 7 && roll < 0.4 && chaosEvents.length > 0) {
    event = chaosEvents[Math.floor(Math.random() * chaosEvents.length)];
  } else if (chaosLevel >= 4 && roll < 0.3 && chaosEvents.length > 0) {
    event = chaosEvents[Math.floor(Math.random() * chaosEvents.length)];
  } else if (roll < 0.5 && benefitEvents.length > 0) {
    event = benefitEvents[Math.floor(Math.random() * benefitEvents.length)];
  } else if (benignEvents.length > 0) {
    event = benignEvents[Math.floor(Math.random() * benignEvents.length)];
  } else {
    event = availableEvents[Math.floor(Math.random() * availableEvents.length)];
  }
  
  return event;
}

/**
 * Apply event effects to a team/league
 * @param {object} event - Event object
 * @param {object} state - Game state
 * @param {string} teamId - Target team ID (player's team for team-only events)
 * @returns {object} - Applied effects summary
 */
export function applyEventEffects(event, state, teamId) {
  if (!event.effects || Object.keys(event.effects).length === 0) {
    return { message: 'No material effects.' };
  }
  
  const summary = [];
  const effects = event.effects;
  
  // League-wide effects
  if (effects.allTeams) {
    applyTeamEffects(effects.allTeams, state, 'all', summary);
  }
  
  // Player team only effects
  if (effects.playerTeam) {
    applyTeamEffects(effects.playerTeam, state, teamId, summary);
  }
  
  return { effects: summary, duration: effects.allTeams?.duration || effects.playerTeam?.duration || 1 };
}

/**
 * Apply effects to team(s)
 */
function applyTeamEffects(teamEffects, state, teamIdOrAll, summary) {
  const targetTeams = teamIdOrAll === 'all' 
    ? Object.values(state.teams) 
    : [state.teams[teamIdOrAll]];
  
  targetTeams.forEach(team => {
    if (!team) return;
    
    // Salary cap bonus/penalty
    if (teamEffects.salary_cap) {
      team.salaryCap = (team.salaryCap || 0) + teamEffects.salary_cap;
      const sign = teamEffects.salary_cap > 0 ? '+' : '';
      summary.push(`${team.abbrev}: Salary cap ${sign}$${(teamEffects.salary_cap / 1000000).toFixed(1)}M`);
    }
    
    // Revenue bonus
    if (teamEffects.revenue) {
      team.revenue = (team.revenue || 0) + teamEffects.revenue;
      const sign = teamEffects.revenue > 0 ? '+' : '';
      summary.push(`${team.abbrev}: Revenue ${sign}$${(teamEffects.revenue / 1000000).toFixed(1)}M`);
    }
    
    // Morale boost/penalty
    if (teamEffects.morale_boost) {
      team.morale = (team.morale || 50) + teamEffects.morale_boost;
      summary.push(`${team.abbrev}: Morale +${teamEffects.morale_boost}`);
    }
    
    if (teamEffects.morale_penalty) {
      team.morale = (team.morale || 50) - teamEffects.morale_penalty;
      summary.push(`${team.abbrev}: Morale -${teamEffects.morale_penalty}`);
    }
    
    // Player stat boosts
    if (teamEffects.all_players_stat_boost) {
      const players = team.rosterIds.map(id => state.allPlayers[id]).filter(Boolean);
      players.forEach(p => {
        p.overall = Math.min(99, (p.overall || 70) + teamEffects.all_players_stat_boost);
      });
      summary.push(`${team.abbrev}: All players +${teamEffects.all_players_stat_boost} OVR`);
    }
    
    if (teamEffects.all_players_stat_penalty) {
      const players = team.rosterIds.map(id => state.allPlayers[id]).filter(Boolean);
      players.forEach(p => {
        p.overall = Math.max(40, (p.overall || 70) - teamEffects.all_players_stat_penalty);
      });
      summary.push(`${team.abbrev}: All players -${teamEffects.all_players_stat_penalty} OVR`);
    }
    
    // Random player effects
    if (teamEffects.random_player_stat_boost) {
      const players = team.rosterIds.map(id => state.allPlayers[id]).filter(Boolean);
      if (players.length > 0) {
        const player = players[Math.floor(Math.random() * players.length)];
        player.overall = Math.min(99, (player.overall || 70) + teamEffects.random_player_stat_boost);
        summary.push(`${team.abbrev}: ${player.fullName || player.lastName} breaks through! +${teamEffects.random_player_stat_boost} OVR`);
      }
    }
    
    if (teamEffects.random_player_illness) {
      injureRandomPlayer(team, state.allPlayers, summary);
    }
    
    if (teamEffects.top_player_injury) {
      const players = team.rosterIds
        .map(id => state.allPlayers[id])
        .filter(Boolean)
        .sort((a, b) => (b.overall || 70) - (a.overall || 70));
      if (players.length > 0) {
        const player = players[0];
        // Check max injury limit
        if (getInjuredPlayerCount(team, state.allPlayers) < 2 && !player.injured) {
          const durationWeeks = Math.floor(Math.random() * 3) + 1;
          player.injured = true;
          player.injuredGames = durationWeeks;
          summary.push(`${team.abbrev}: Star player ${player.fullName || player.lastName} injured for ${durationWeeks} week(s)`);
        }
      }
    }
    
    if (teamEffects.top_player_illness) {
      const players = team.rosterIds
        .map(id => state.allPlayers[id])
        .filter(Boolean)
        .sort((a, b) => (b.overall || 70) - (a.overall || 70));
      if (players.length > 0) {
        const player = players[0];
        // Check max injury limit
        if (getInjuredPlayerCount(team, state.allPlayers) < 2 && !player.injured) {
          const durationWeeks = Math.floor(Math.random() * 3) + 1;
          player.injured = true;
          player.injuredGames = durationWeeks;
          summary.push(`${team.abbrev}: Star player ${player.fullName || player.lastName} out sick for ${durationWeeks} week(s)`);
        }
      }
    }
  });
}

/**
 * Get random event for testing
 */
export function getRandomEvent() {
  return eventsList[Math.floor(Math.random() * eventsList.length)];
}
