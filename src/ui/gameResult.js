/**
 * gameResult.js
 * Shows a modal with per-period scores, shots, stars, and highlights
 * whenever the player's team finishes a game.
 * Listens for the 'game-result' CustomEvent dispatched by simNextGame().
 */

const overlay = document.getElementById('game-result-overlay');
const content = document.getElementById('game-result-content');

function closeModal() {
  overlay.style.display = 'none';
}

// Close on overlay background click
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeModal();
});

// Close on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && overlay.style.display !== 'none') closeModal();
});

// ─── Render ───────────────────────────────────────────────────────────────────

function renderGameResult({ result, home, away, allPlayers }) {
  const { homeGoals, awayGoals, homePeriods, awayPeriods,
          homeShots, awayShots, overtimeType, highlights, stars } = result;

  const finalLabel = overtimeType ? `FINAL / ${overtimeType}` : 'FINAL';

  // Header score
  const homeWin = homeGoals > awayGoals;
  const scoreHtml = `
    <div class="gr-scoreboard">
      <div class="gr-team ${!homeWin ? 'gr-winner' : 'gr-loser'}">
        <div class="gr-team-name">${away.abbrev}</div>
        <div class="gr-team-full">${away.fullName}</div>
      </div>
      <div class="gr-score-center">
        <div class="gr-score">
          <span class="${!homeWin ? 'gr-score-win' : 'gr-score-loss'}">${awayGoals}</span>
          <span class="gr-score-dash">–</span>
          <span class="${homeWin ? 'gr-score-win' : 'gr-score-loss'}">${homeGoals}</span>
        </div>
        <div class="gr-final-label">${finalLabel}</div>
      </div>
      <div class="gr-team ${homeWin ? 'gr-winner' : 'gr-loser'}">
        <div class="gr-team-name">${home.abbrev}</div>
        <div class="gr-team-full">${home.fullName}</div>
      </div>
    </div>
  `;

  // Period breakdown table
  const periods = homePeriods?.length ?? 3;
  const colHeaders = homePeriods.map((_, i) =>
    i < 3 ? `P${i + 1}` : (overtimeType || 'OT')
  );

  const awayPeriodCells = (awayPeriods || []).map(g => `<td>${g}</td>`).join('');
  const homePeriodCells = (homePeriods || []).map(g => `<td>${g}</td>`).join('');

  const periodHtml = `
    <div class="gr-section">
      <div class="gr-section-title">Period by Period</div>
      <table class="gr-periods">
        <thead>
          <tr>
            <th></th>
            ${colHeaders.map(h => `<th>${h}</th>`).join('')}
            <th>T</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="gr-period-team">${away.abbrev}</td>
            ${awayPeriodCells}
            <td class="gr-period-total">${awayGoals}</td>
          </tr>
          <tr>
            <td class="gr-period-team">${home.abbrev}</td>
            ${homePeriodCells}
            <td class="gr-period-total">${homeGoals}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  // Shots
  const shotsHtml = `
    <div class="gr-section gr-shots-row">
      <div class="gr-section-title">Shots on Goal</div>
      <div class="gr-shots">
        <span class="gr-shots-team">${away.abbrev}</span>
        <span class="gr-shots-num ${awayShots > homeShots ? 'gr-shots-leader' : ''}">${awayShots}</span>
        <span class="gr-shots-sep">–</span>
        <span class="gr-shots-num ${homeShots > awayShots ? 'gr-shots-leader' : ''}">${homeShots}</span>
        <span class="gr-shots-team">${home.abbrev}</span>
      </div>
    </div>
  `;

  // Stars
  const starLabels = ['⭐⭐⭐', '⭐⭐', '⭐'];
  const starsHtml = stars && stars.length > 0 ? `
    <div class="gr-section">
      <div class="gr-section-title">Stars of the Game</div>
      <div class="gr-stars">
        ${stars.map(({ player: p, teamId }, i) => {
          const teamObj = teamId === home.id ? home : away;
          return `
            <div class="gr-star-row">
              <span class="gr-star-num">${i + 1}</span>
              <span class="gr-star-name">${p.fullName ?? p.lastName}</span>
              <span class="gr-star-pos pos-badge ${posClass(p.position)}">${p.position}</span>
              <span class="gr-star-ovr ovr-badge ${ovrClass(p.overall)}">${p.overall}</span>
              <span class="gr-star-team-badge">${teamObj.abbrev}</span>
              <span class="gr-star-team-name">${teamObj.fullName}</span>
            </div>`;
        }).join('')}
      </div>
    </div>
  ` : '';

  // Highlights
  const highlightsHtml = highlights && highlights.length > 0 ? `
    <div class="gr-section">
      <div class="gr-section-title">Game Notes</div>
      <ul class="gr-highlights">
        ${highlights.map(h => `<li>${h}</li>`).join('')}
      </ul>
    </div>
  ` : '';

  content.innerHTML = `
    <div class="gr-header">
      <span class="gr-header-label">Game Result</span>
      <button class="gr-close" onclick="document.getElementById('game-result-overlay').style.display='none'" aria-label="Close">✕</button>
    </div>
    ${scoreHtml}
    ${periodHtml}
    ${shotsHtml}
    ${starsHtml}
    ${highlightsHtml}
    <div class="gr-footer">
      <button class="btn-primary gr-dismiss" onclick="document.getElementById('game-result-overlay').style.display='none'">
        Back to Dashboard
      </button>
    </div>
  `;

  overlay.style.display = 'flex';
}

function ovrClass(ovr) {
  if (ovr >= 85) return 'ovr-elite';
  if (ovr >= 72) return 'ovr-good';
  if (ovr >= 58) return 'ovr-avg';
  if (ovr >= 45) return 'ovr-poor';
  return 'ovr-bust';
}

function posClass(pos) {
  if (['C', 'LW', 'RW'].includes(pos)) return 'fwd';
  if (['LD', 'RD'].includes(pos))      return 'def';
  return 'goal';
}

// ─── Event listener ───────────────────────────────────────────────────────────

document.addEventListener('game-result', (e) => {
  renderGameResult(e.detail);
});
