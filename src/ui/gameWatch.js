/**
 * gameWatch.js
 * Shows a period-by-period progression of a hockey game
 * before displaying the full final result.
 */
import { teamLogoEl } from './teamLogo.js';

const watchOverlay = document.getElementById('game-watch-overlay');
const watchContent = document.getElementById('game-watch-content');
const watchModal = document.getElementById('game-watch-modal');

let currentWatchState = {
  result: null,
  home: null,
  away: null,
  allPlayers: null,
  socialFeed: [],
  currentPeriod: 0,
  periods: 3,
};

function closeWatchModal() {
  if (watchModal) watchModal.scrollTop = 0;
  if (watchContent) watchContent.scrollTop = 0;
  watchOverlay.style.display = 'none';
}

window.closeGameWatchModal = closeWatchModal;
window.advanceGameWatch = advanceGameWatch;

// Close on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && watchOverlay.style.display !== 'none') closeWatchModal();
});

// ─── Render Period View ─────────────────────────────────────────────────────

function renderGameWatchPeriod(periodNum) {
  const { result, home, away } = currentWatchState;
  const { homePeriods, awayPeriods, overtimeType } = result;

  // Determine if this is OT
  const isOT = periodNum >= 3 && homePeriods.length > 3;
  const periodLabel = periodNum < 3 ? `PERIOD ${periodNum + 1}` : (overtimeType || 'OVERTIME');

  // Calculate cumulative scores through this period
  const homeTotal = homePeriods.slice(0, periodNum + 1).reduce((a, b) => a + b, 0);
  const awayTotal = awayPeriods.slice(0, periodNum + 1).reduce((a, b) => a + b, 0);

  // Current period goals
  const homeThisPeriod = homePeriods[periodNum] || 0;
  const awayThisPeriod = awayPeriods[periodNum] || 0;

  const awayLogo = teamLogoEl(away.id, away.abbrev, away.primaryColor || '#0055CC', away.secondaryColor || '#FFFFFF', 44);
  const homeLogo = teamLogoEl(home.id, home.abbrev, home.primaryColor || '#0055CC', home.secondaryColor || '#FFFFFF', 44);
  const awayPrimary = safeHexColor(away.primaryColor, '#00CCFF');
  const awaySecondary = safeHexColor(away.secondaryColor, '#FFFFFF');
  const homePrimary = safeHexColor(home.primaryColor, '#FF2255');
  const homeSecondary = safeHexColor(home.secondaryColor, '#FFFFFF');
  const awayMarkers = goalMarkers('away', awayThisPeriod, awayPrimary, awaySecondary);
  const homeMarkers = goalMarkers('home', homeThisPeriod, homePrimary, homeSecondary);

  const html = `
    <div class="gw-header">
      <div class="gw-team-header">
        <div class="gw-team-logo">${awayLogo}</div>
        <div class="gw-team-name">${away.abbrev}</div>
        <div class="gw-team-full">${away.fullName}</div>
      </div>
      <div class="gw-period-label">${periodLabel}</div>
      <div class="gw-team-header">
        <div class="gw-team-logo">${homeLogo}</div>
        <div class="gw-team-name">${home.abbrev}</div>
        <div class="gw-team-full">${home.fullName}</div>
      </div>
    </div>

    <div class="gw-content">
      <div class="gw-rink" aria-label="Gamecast rink">
        <div class="gw-rink-scorebug">
          <span class="gw-rink-team gw-rink-team--away">${away.abbrev}</span>
          <strong>${awayTotal}</strong>
          <span class="gw-rink-period">${periodLabel}</span>
          <strong>${homeTotal}</strong>
          <span class="gw-rink-team gw-rink-team--home">${home.abbrev}</span>
        </div>
        <div class="gw-goal-layer" aria-hidden="true">
          ${awayMarkers}
          ${homeMarkers}
        </div>
        <div class="gw-rink-period-chip">
          This period: ${away.abbrev} ${awayThisPeriod} - ${homeThisPeriod} ${home.abbrev}
        </div>
      </div>

      <div class="gw-score-display">
        <div class="gw-score-column gw-away">
          <div class="gw-team-abbrev">${away.abbrev}</div>
          <div class="gw-period-goals">${awayThisPeriod}</div>
          <div class="gw-running-total">${awayTotal}</div>
        </div>
        <div class="gw-score-column gw-divider">
          <div style="font-size: 10px; color: var(--text-muted);">This</div>
          <div style="font-size: 10px; color: var(--text-muted);">Total</div>
        </div>
        <div class="gw-score-column gw-home">
          <div class="gw-team-abbrev">${home.abbrev}</div>
          <div class="gw-period-goals">${homeThisPeriod}</div>
          <div class="gw-running-total">${homeTotal}</div>
        </div>
      </div>

      <div class="gw-progress">
        <div class="gw-progress-label">Game Progress</div>
        <div class="gw-progress-bar">
          <div class="gw-progress-fill" style="width: ${((periodNum + 1) / currentWatchState.periods) * 100}%"></div>
        </div>
        <div class="gw-progress-text">${periodNum + 1} of ${currentWatchState.periods}</div>
      </div>
    </div>

    <div class="gw-footer">
      <button class="btn-primary" onclick="window.advanceGameWatch()">
        ${periodNum + 1 >= currentWatchState.periods ? 'See Final Result →' : 'Next Period →'}
      </button>
    </div>
  `;

  watchContent.innerHTML = html;
}

function safeHexColor(value, fallback) {
  return /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value || '') ? value : fallback;
}

function goalMarkers(side, count, primary, secondary) {
  const awaySpots = [
    [20, 30], [28, 58], [38, 43], [48, 66], [34, 24], [44, 53],
  ];
  const homeSpots = [
    [80, 30], [72, 58], [62, 43], [52, 66], [66, 24], [56, 53],
  ];
  const spots = side === 'away' ? awaySpots : homeSpots;
  const visibleCount = Math.min(count, spots.length);

  return Array.from({ length: visibleCount }, (_, idx) => {
    const [x, y] = spots[idx];
    return `
      <span
        class="gw-goal-marker gw-goal-marker--${side}"
        style="--x:${x}%;--y:${y}%;--delay:${idx * 90}ms;--team-primary:${primary};--team-secondary:${secondary};">
      </span>
    `;
  }).join('');
}

// ─── Game Watch State ────────────────────────────────────────────────────────

export function startGameWatch({ result, home, away, allPlayers, socialFeed = [] }) {
  currentWatchState = {
    result,
    home,
    away,
    allPlayers,
    socialFeed,
    currentPeriod: 0,
    periods: result.homePeriods.length,
  };

  watchOverlay.style.display = 'flex';
  renderGameWatchPeriod(0);
}

function advanceGameWatch() {
  const { currentPeriod, periods } = currentWatchState;

  if (currentPeriod + 1 >= periods) {
    // Show final result
    closeWatchModal();
    // Dispatch the game result event to show the full result modal
    document.dispatchEvent(new CustomEvent('game-result', {
      detail: {
        result: currentWatchState.result,
        home: currentWatchState.home,
        away: currentWatchState.away,
        allPlayers: currentWatchState.allPlayers,
        socialFeed: currentWatchState.socialFeed,
      },
    }));
  } else {
    // Show next period
    currentWatchState.currentPeriod += 1;
    renderGameWatchPeriod(currentWatchState.currentPeriod);
  }
}
