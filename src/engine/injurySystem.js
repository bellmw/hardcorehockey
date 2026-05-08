/**
 * injurySystem.js
 * Manages player injuries: application, recovery, and trading restrictions.
 */

/**
 * Get count of injured players on a team
 * @param {object} team - Team object
 * @param {object} allPlayers - All player objects
 * @returns {number} Count of injured players
 */
export function getInjuredPlayerCount(team, allPlayers) {
  if (!team.rosterIds) return 0;
  return team.rosterIds.filter(id => {
    const player = allPlayers[id];
    return player && player.injured && player.injuredGames > 0;
  }).length;
}

/**
 * Check if a player can be traded (not injured)
 * @param {object} player - Player object
 * @returns {boolean} True if player can be traded
 */
export function canPlayerBeTrade(player) {
  return !player.injured || player.injuredGames <= 0;
}

/**
 * Apply injury to a random eligible player on a team
 * @param {object} team - Team object
 * @param {object} allPlayers - All player objects
 * @param {object} summary - Summary array to push effect descriptions
 * @returns {object|null} - Injured player or null if no eligible player or max injuries reached
 */
export function injureRandomPlayer(team, allPlayers, summary = []) {
  // Check max injury limit (2 per team)
  if (getInjuredPlayerCount(team, allPlayers) >= 2) {
    if (summary) summary.push(`✓ ${team.abbr}: Injury limit reached (2 players)`);
    return null;
  }
  
  // Get non-injured, healthy players
  const healthyPlayers = (team.rosterIds || [])
    .map(id => allPlayers[id])
    .filter(p => p && !p.injured && p.position !== 'G');  // Goalies rarely injured for narrative
  
  if (healthyPlayers.length === 0) {
    if (summary) summary.push(`✓ ${team.abbr}: No eligible players for injury`);
    return null;
  }
  
  // Pick random healthy player
  const player = healthyPlayers[Math.floor(Math.random() * healthyPlayers.length)];
  
  // Injury duration: 1-3 weeks
  const durationWeeks = Math.floor(Math.random() * 3) + 1;
  
  player.injured = true;
  player.injuredGames = durationWeeks;
  
  if (summary) {
    summary.push(`✓ ${team.abbr}: ${player.fullName} (${player.position}) injured for ${durationWeeks} week(s)`);
  }
  
  return player;
}

/**
 * Heal injuries by decrementing injuredGames counters
 * Called each week during season
 * @param {object} state - Game state
 */
export function healInjuries(state) {
  Object.values(state.allPlayers).forEach(player => {
    if (player.injured && player.injuredGames > 0) {
      player.injuredGames--;
      if (player.injuredGames <= 0) {
        player.injured = false;
      }
    }
  });
}

/**
 * Get available roster for game simulation (excludes injured players)
 * @param {object} team - Team object
 * @param {object} allPlayers - All player objects
 * @returns {array} Available player IDs
 */
export function getAvailableRoster(team, allPlayers) {
  if (!team.rosterIds) return [];
  return team.rosterIds.filter(id => {
    const player = allPlayers[id];
    return player && (!player.injured || player.injuredGames <= 0);
  });
}
