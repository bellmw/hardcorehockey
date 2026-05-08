/**
 * seasonSummary.js
 * Displays end-of-season summary with grade and stats
 */

/**
 * Calculate season grade based on regular season record and playoff performance
 * @param {object} teamStandings - Team standings entry with w, l, otl, pts
 * @param {string} playoffResult - null (missed), 'first_round', 'semifinals', 'finals', 'champion'
 * @returns {object} - { grade: 'A+', summary: '...', reasoning: '...' }
 */
function calculateSeasonGrade(teamStandings, playoffResult) {
  const totalGames = teamStandings.gp;
  const wins = teamStandings.w;
  const losses = teamStandings.l;
  const winPct = totalGames > 0 ? (wins / totalGames) : 0;
  
  let grade = 'F';
  let summary = '';
  let reasoning = '';
  
  // Playoff results take priority
  if (playoffResult === 'champion') {
    grade = 'A+';
    summary = 'CHAMPIONSHIP SEASON';
    reasoning = 'You won it all! Season of success.';
  } else if (playoffResult === 'finals') {
    grade = winPct >= 0.600 ? 'A' : 'B+';
    summary = `FINALS APPEARANCE (${wins}W-${losses}L)`;
    reasoning = winPct >= 0.600 
      ? 'Strong season cut short in Finals.' 
      : 'Solid playoff run despite regular season inconsistency.';
  } else if (playoffResult === 'semifinals') {
    grade = winPct >= 0.550 ? 'B+' : 'B';
    summary = `SEMIFINALS (${wins}W-${losses}L)`;
    reasoning = 'Good playoff performance and solid regular season.';
  } else if (playoffResult === 'first_round') {
    grade = winPct >= 0.550 ? 'B' : 'C+';
    summary = `FIRST ROUND EXIT (${wins}W-${losses}L)`;
    reasoning = winPct >= 0.550 
      ? 'Decent regular season but short playoff run.' 
      : 'Made playoffs but lacked momentum.';
  } else if (playoffResult === 'missed') {
    // Missed playoffs
    if (wins < 3) {
      grade = 'F';
      reasoning = 'Catastrophic season.';
    } else if (winPct >= 0.600) {
      grade = 'C+';
      reasoning = 'Winning record but missed playoffs — tough luck.';
    } else if (winPct >= 0.500) {
      grade = 'C';
      reasoning = '.500 record, playoff drought.';
    } else {
      grade = 'D';
      reasoning = 'Below .500 and missed playoffs.';
    }
    summary = `MISSED PLAYOFFS (${wins}W-${losses}L)`;
  } else {
    // Unknown/ongoing
    grade = 'C';
    summary = `SEASON ENDED (${wins}W-${losses}L)`;
    reasoning = 'Regular season complete.';
  }
  
  return { grade, summary, reasoning, winPct: (winPct * 100).toFixed(1) };
}

/**
 * Render season summary screen
 * @param {object} state - Game state
 * @param {string} playoffResult - How season ended
 */
export function renderSeasonSummary(state, playoffResult) {
  const container = document.getElementById('screen-content');
  if (!container) return;
  
  const myTeam = state.teams[state.playerTeamId];
  const standings = state.standings[myTeam.leagueId];
  const myStanding = standings[state.playerTeamId];
  
  const { grade, summary, reasoning, winPct } = calculateSeasonGrade(myStanding, playoffResult);
  
  const gradeColor = {
    'A+': '#FFD700', 'A': '#C0C0C0', 'B+': '#CD7F32', 'B': '#B8860B',
    'C+': '#8B4513', 'C': '#696969', 'D': '#483D8B', 'F': '#8B0000'
  }[grade] || '#999';
  
  container.innerHTML = `
    <div class="season-summary-container">
      <div class="season-summary-header">
        <h1>${myTeam.fullName}</h1>
        <p class="season-summary-year">Season ${state.year}</p>
      </div>
      
      <div class="season-summary-main">
        <div class="season-summary-grade-box">
          <div class="season-summary-grade" style="color: ${gradeColor}">
            ${grade}
          </div>
          <p class="season-summary-grade-label">FINAL GRADE</p>
        </div>
        
        <div class="season-summary-stats">
          <div class="season-summary-stat">
            <span class="season-summary-stat-label">Record</span>
            <span class="season-summary-stat-value">${myStanding.w}W - ${myStanding.l}L - ${myStanding.otl}OTL</span>
          </div>
          <div class="season-summary-stat">
            <span class="season-summary-stat-label">Win %</span>
            <span class="season-summary-stat-value">${winPct}%</span>
          </div>
          <div class="season-summary-stat">
            <span class="season-summary-stat-label">Goals</span>
            <span class="season-summary-stat-value">${myStanding.gf} For / ${myStanding.ga} Against</span>
          </div>
          <div class="season-summary-stat">
            <span class="season-summary-stat-label">Points</span>
            <span class="season-summary-stat-value">${myStanding.pts}</span>
          </div>
        </div>
      </div>
      
      <div class="season-summary-narrative">
        <h2>${summary}</h2>
        <p>${reasoning}</p>
      </div>
      
      <div class="season-summary-footer">
        <button class="btn-primary" onclick="hockeyGM.restartGame()">
          Start New Season →
        </button>
      </div>
    </div>
  `;
}

/**
 * Show season summary screen
 * @param {object} state - Game state
 * @param {string} playoffResult - How season ended
 */
export function showSeasonSummary(state, playoffResult) {
  renderSeasonSummary(state, playoffResult);
  window.hockeyGM?.showScreen('season-summary');
}
