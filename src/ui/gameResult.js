/**
 * gameResult.js
 * Shows a modal with per-period scores, shots, stars, and highlights
 * whenever the player's team finishes a game.
 * Listens for the 'game-result' CustomEvent dispatched by simNextGame().
 */
import { teamLogoSvg } from './teamLogo.js';

const overlay = document.getElementById('game-result-overlay');
const content = document.getElementById('game-result-content');
const modal = document.getElementById('game-result-modal');

function closeModal() {
  if (modal) modal.scrollTop = 0;
  if (content) content.scrollTop = 0;
  overlay.style.display = 'none';
}

window.closeGameResultModal = closeModal;

// Close on overlay background click
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeModal();
});

// Close on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && overlay.style.display !== 'none') closeModal();
});

// ─── Render ───────────────────────────────────────────────────────────────────

function renderGameResult({ result, home, away, allPlayers, socialFeed = [] }) {
  const { homeGoals, awayGoals, homePeriods, awayPeriods,
          homeShots, awayShots, overtimeType, highlights, stars } = result;

  const finalLabel = overtimeType ? `FINAL / ${overtimeType}` : 'FINAL';

  // Generate logos for each team
  const awayLogo = teamLogoSvg(
    away.abbrev,
    away.primaryColor || '#0055CC',
    away.secondaryColor || '#FFFFFF',
    52
  );
  const homeLogo = teamLogoSvg(
    home.abbrev,
    home.primaryColor || '#0055CC',
    home.secondaryColor || '#FFFFFF',
    52
  );

  // Header score
  const homeWin = homeGoals > awayGoals;
  const scoreHtml = `
    <div class="gr-scoreboard">
      <div class="gr-team ${!homeWin ? 'gr-winner' : 'gr-loser'}">
        <div class="gr-team-logo">${awayLogo}</div>
        <div class="gr-team-name" style="color:${!homeWin ? (away.secondaryColor||'#FFFF00') : '#444488'}">${away.abbrev}</div>
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
        <div class="gr-team-logo">${homeLogo}</div>
        <div class="gr-team-name" style="color:${homeWin ? (home.secondaryColor||'#FFFF00') : '#444488'}">${home.abbrev}</div>
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

  const socialHtml = socialFeed.length > 0 ? `
    <div class="gr-section">
      <div class="gr-section-title">Social Pulse</div>
      <div class="gr-social-feed">
        ${socialFeed.map(post => `
          <article class="gr-social-post gr-social-post--${post.kind}">
            <div class="gr-social-handle">${post.handle}</div>
            <div class="gr-social-text">${post.text}</div>
          </article>
        `).join('')}
      </div>
    </div>
  ` : '';

  content.innerHTML = `
    <div class="gr-header">
      <span class="gr-header-label">Game Result</span>
      <button class="gr-close" onclick="window.closeGameResultModal?.()" aria-label="Close">✕</button>
    </div>
    ${scoreHtml}
    ${periodHtml}
    ${shotsHtml}
    ${starsHtml}
    ${highlightsHtml}
    ${socialHtml}
    <div class="gr-footer">
      <button class="btn-primary gr-dismiss" onclick="window.closeGameResultModal?.()">
        Back to Dashboard
      </button>
    </div>
  `;

  if (modal) modal.scrollTop = 0;
  if (content) content.scrollTop = 0;
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
