/**
 * standings.js
 * Renders the full standings screen (all three leagues).
 * Triggered by 'render-screen' CustomEvent with detail.screen === 'standings'.
 */

// ─── League metadata ──────────────────────────────────────────────────────────

const LEAGUES = [
  { id: 'phl', name: 'Premier Hockey League', shortName: 'PHL' },
  { id: 'cd',  name: 'Continental Division',  shortName: 'CD'  },
  { id: 'rc',  name: 'Regional Circuit',      shortName: 'RC'  },
];

// Sort state per league — persists across re-renders
const standingsSort = {
  phl: { key: 'pts', dir: -1 },
  cd:  { key: 'pts', dir: -1 },
  rc:  { key: 'pts', dir: -1 },
};

window.standingsSortBy = function(leagueId, key) {
  const s = standingsSort[leagueId];
  if (!s) return;
  if (s.key === key) { s.dir *= -1; } else { s.key = key; s.dir = -1; }
  const state = window.hockeyGM?.getState?.();
  if (state) renderStandings(state);
};

// ─── Main render ──────────────────────────────────────────────────────────────

function renderStandings(state) {
  const container = document.getElementById('standings-all-leagues');
  if (!container) return;

  container.innerHTML = LEAGUES
    .map(league => renderLeagueBlock(state, league))
    .join('');
}

// ─── League block ─────────────────────────────────────────────────────────────

function renderLeagueBlock(state, league) {
  const standings = state.standings[league.id];
  if (!standings) return '';

  const lid = league.id;
  const ss  = standingsSort[lid] ?? { key: 'pts', dir: -1 };

  // Apply custom sort on top of the default PTS sort
  const base = sortStandings(standings); // always default-sorted first for zone lines
  const sortKeys = {
    pts: e => e.pts,
    w:   e => e.w,
    l:   e => e.l,
    otl: e => e.otl,
    gp:  e => e.gp,
    gd:  e => e.gd ?? (e.gf - e.ga),
  };
  const sorted = ss.key === 'pts'
    ? base // default: already pts-sorted with tiebreakers
    : [...base].sort((a, b) => ss.dir * ((sortKeys[ss.key]?.(b) ?? 0) - (sortKeys[ss.key]?.(a) ?? 0)));

  const teamCount = base.length; // use base for zone boundaries

  // Zone boundaries (0-based last index in each zone)
  const playoffCutoff  = 3;   // top 4 qualify
  const safeBottom     = teamCount - 3; // index of last safe team (bottom 2 go down)

  const rows = sorted.map((entry, idx) => {
    const baseIdx  = base.findIndex(e => e.teamId === entry.teamId);
    const team     = state.teams[entry.teamId] ?? {};
    const isPlayer = entry.teamId === state.playerTeamId;

    const rowClasses = ['standings-row'];
    if (isPlayer)          rowClasses.push('standings-player-row');
    if (baseIdx < 4)       rowClasses.push('standings-playoff-zone');
    if (baseIdx >= safeBottom) rowClasses.push('standings-danger-zone');

    const gd = entry.gd ?? (entry.gf - entry.ga);
    const gdStr = gd > 0 ? `+${gd}` : String(gd);

    return `
      <tr class="${rowClasses.join(' ')}">
        <td class="standings-pos">${baseIdx + 1}</td>
        <td class="standings-team-name">${team.fullName ?? entry.teamId}</td>
        <td class="standings-abbrev">${team.abbrev ?? ''}</td>
        <td>${entry.gp}</td>
        <td>${entry.w}</td>
        <td>${entry.l}</td>
        <td>${entry.otl}</td>
        <td class="standings-pts">${entry.pts}</td>
        <td class="standings-gd">${gdStr}</td>
      </tr>`;
  }).join('');

  // Sort indicator helper
  const ind = key => ss.key === key ? (ss.dir === -1 ? ' ▼' : ' ▲') : '';
  const th  = (key, label, title) =>
    `<th class="stats-th-sortable" onclick="window.standingsSortBy('${lid}','${key}')" title="${title ?? label}">${label}${ind(key)}</th>`;

  return `
    <section class="standings-league standings-league-${league.id}">
      <h2 class="standings-league-title">
        <span class="league-badge ${league.id}">${league.shortName}</span>
        ${league.name}
      </h2>
      <table class="standings-table standings-table-full">
        <thead>
          <tr>
            <th>#</th>
            <th class="standings-th-name">Team</th>
            <th></th>
            ${th('gp','GP','Games Played')}
            ${th('w','W','Wins')}
            ${th('l','L','Losses')}
            ${th('otl','OTL','Overtime Losses')}
            ${th('pts','PTS','Points')}
            ${th('gd','GD','Goal Differential')}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;
}

// ─── Sort helper ──────────────────────────────────────────────────────────────

function sortStandings(standings) {
  return Object.values(standings).sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.w   !== a.w)   return b.w   - a.w;
    const gdA = a.gd ?? (a.gf - a.ga);
    const gdB = b.gd ?? (b.gf - b.ga);
    return gdB - gdA;
  });
}

// ─── Event listener ───────────────────────────────────────────────────────────

document.addEventListener('render-screen', (e) => {
  if (e.detail?.screen !== 'standings') return;
  renderStandings(e.detail.state);
});
