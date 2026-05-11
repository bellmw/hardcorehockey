/**
 * teamSelect.js
 * Renders the team selection screen.
 * Triggered by 'render-screen' CustomEvent with detail.screen === 'team-select'.
 *
 * Container: #team-select-leagues
 * On team click → calls window.hockeyGM.newGame(teamId)
 */
import { teamLogoEl, teamColorVars } from './teamLogo.js';

const LEAGUES = [
  { id: 'phl', name: 'Premier Hockey League', shortName: 'PHL', tier: 1 },
  { id: 'cd',  name: 'Continental Division',  shortName: 'CD',  tier: 2 },
  { id: 'rc',  name: 'Regional Circuit',      shortName: 'RC',  tier: 3 },
];

const TIER_DESC = {
  1: 'Top flight. Forty teams dream of this. Fourteen survive.',
  2: 'Mid-tier. Promotion is everything. Relegation is the nightmare.',
  3: 'The bottom rung. Character builds here. Champions sometimes too.',
};

// ─── Render ───────────────────────────────────────────────────────────────────

function renderTeamSelect(state) {
  // state may be null on first load — that's fine, we don't need it here
  const container = document.getElementById('team-select-leagues');
  if (!container) return;

  // Use the pre-randomized league layout from main.js if available
  const preview = window.hockeyGM?.getPreviewTeams?.();
  if (preview) {
    buildScreenFromPreview(container, preview);
    return;
  }

  // Fallback: fetch raw teams.json (no randomization, used if preview not ready)
  fetch('./data/teams.json')
    .then(r => r.json())
    .then(data => buildScreen(container, data))
    .catch(() => {
      container.innerHTML = '<p class="text-accent">Failed to load teams. Is live-server running?</p>';
    });
}

function buildScreenFromPreview(container, preview) {
  // preview = { phl: [...teams], cd: [...teams], rc: [...teams] }
  let activeLeague = 'phl';

  function render() {
    const league    = LEAGUES.find(l => l.id === activeLeague);
    const teamsData = preview[activeLeague] ?? [];

    const tabs = LEAGUES.map(l => {
      const count = preview[l.id]?.length ?? 0;
      return `
        <button class="filter-btn league-tab${l.id === activeLeague ? ' active' : ''}" data-league="${l.id}">
          <span class="league-badge ${l.id}">${l.shortName}</span>
          ${l.name}
        </button>`;
    }).join('');

    const cards = teamsData.map(team => {
      const logo = teamLogoEl(team.id, team.abbrev, team.primaryColor, team.secondaryColor, 96);
      const colorVars = teamColorVars(team.primaryColor, team.secondaryColor);
      return `
      <button class="team-card" data-team-id="${team.id}"
        style="${colorVars}; border-color: var(--team-primary); --sega-border: var(--team-primary);">
        <div class="team-card-logo-row">
          <div class="team-card-logo">${logo}</div>
          <div class="team-card-header-info">
            <span class="team-card-abbrev" style="color:var(--team-secondary);text-shadow:0 0 12px var(--team-glow)">${team.abbrev}</span>
            <span class="team-card-city">${team.city}</span>
          </div>
        </div>
        <div class="team-card-name">${team.name}</div>
        <div class="team-card-arena">${team.arena}</div>
        <div class="team-card-gm">GM: ${team.gmName}
          <span class="team-card-personality">${formatPersonality(team.gmPersonality)}</span>
        </div>
        <div class="team-card-flavour">${team.flavour}</div>
      </button>`;
    }).join('');

    container.innerHTML = `
      <div class="team-select-tabs">${tabs}</div>
      <p class="team-select-tier-desc text-3">${TIER_DESC[league.tier]}</p>
      <div class="team-select-grid">${cards}</div>
    `;

    container.querySelectorAll('.league-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        activeLeague = btn.dataset.league;
        render();
      });
    });
    container.querySelectorAll('.team-card').forEach(btn => {
      btn.addEventListener('click', () => {
        window.hockeyGM.newGame(btn.dataset.teamId);
      });
    });
  }
  render();
}

function buildScreen(container, data) {
  let activeLeague = 'phl';

  function render() {
    const league     = LEAGUES.find(l => l.id === activeLeague);
    const teamsData  = data.leagues[activeLeague]?.teams ?? [];

    const tabs = LEAGUES.map(l => `
      <button class="filter-btn league-tab${l.id === activeLeague ? ' active' : ''}" data-league="${l.id}">
        <span class="league-badge ${l.id}">${l.shortName}</span>
        ${l.name}
      </button>
    `).join('');

    const cards = teamsData.map(team => {
      const logo = teamLogoEl(team.id, team.abbrev, team.primaryColor, team.secondaryColor, 96);
      const colorVars = teamColorVars(team.primaryColor, team.secondaryColor);
      return `
      <button class="team-card" data-team-id="${team.id}"
        style="${colorVars}; border-color: var(--team-primary); --sega-border: var(--team-primary);">
        <div class="team-card-logo-row">
          <div class="team-card-logo">${logo}</div>
          <div class="team-card-header-info">
            <span class="team-card-abbrev" style="color:var(--team-secondary);text-shadow:0 0 12px var(--team-glow)">${team.abbrev}</span>
            <span class="team-card-city">${team.city}</span>
          </div>
        </div>
        <div class="team-card-name">${team.name}</div>
        <div class="team-card-arena">${team.arena}</div>
        <div class="team-card-gm">GM: ${team.gmName}
          <span class="team-card-personality">${formatPersonality(team.gmPersonality)}</span>
        </div>
        <div class="team-card-flavour">${team.flavour}</div>
      </button>
      `;
    }).join('');

    container.innerHTML = `
      <div class="team-select-tabs">${tabs}</div>
      <p class="team-select-tier-desc text-3">${TIER_DESC[league.tier]}</p>
      <div class="team-select-grid">${cards}</div>
    `;

    // Tab clicks
    container.querySelectorAll('.league-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        activeLeague = btn.dataset.league;
        render();
      });
    });

    // Team card clicks
    container.querySelectorAll('.team-card').forEach(card => {
      card.addEventListener('click', async () => {
        const teamId = card.dataset.teamId;
        // Visual feedback
        card.classList.add('team-card--selected');
        card.textContent = 'Loading…';
        await window.hockeyGM.newGame(teamId);
      });
    });
  }

  render();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPersonality(p) {
  const map = {
    win_now:   'Win Now',
    cheapskate: 'Cheapskate',
    rebuilder:  'Rebuilder',
    gambler:    'Gambler',
    hoarder:    'Hoarder',
    desperate:  'Desperate',
  };
  return map[p] ?? p ?? '';
}

// ─── Event listener ───────────────────────────────────────────────────────────

document.addEventListener('render-screen', (e) => {
  if (e.detail?.screen !== 'team-select') return;
  renderTeamSelect(e.detail.state);
});

// Also trigger on DOMContentLoaded in case boot() fires before this module
// registers its listener (module load order is not guaranteed in all browsers).
// boot() calls showScreen('team-select') which fires render-screen — but if
// this module wasn't ready yet, the event was missed. Re-check on load:
document.addEventListener('DOMContentLoaded', () => {
  // If the team-select screen is already active, render it now
  const screen = document.getElementById('screen-team-select');
  if (screen?.classList.contains('active')) {
    renderTeamSelect(null);
  }
});
