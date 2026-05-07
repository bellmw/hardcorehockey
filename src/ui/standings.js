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

  const sorted = sortStandings(standings);
  const teamCount = sorted.length;

  // Zone boundaries (0-based last index in each zone)
  const playoffCutoff  = 3;   // top 4 qualify
  const safeBottom     = teamCount - 3; // index of last safe team (bottom 2 go down)

  const rows = sorted.map((entry, idx) => {
    const team     = state.teams[entry.teamId] ?? {};
    const isPlayer = entry.teamId === state.playerTeamId;

    const rowClasses = ['standings-row'];
    if (isPlayer)      rowClasses.push('standings-player-row');
    if (idx < 4)       rowClasses.push('standings-playoff-zone');
    if (idx >= safeBottom) rowClasses.push('standings-danger-zone');

    const gd = entry.gd ?? (entry.gf - entry.ga);
    const gdStr = gd > 0 ? `+${gd}` : String(gd);

    // Separator rows: after position 4 (playoff cut) and after last-safe position
    const playoffLine = idx === playoffCutoff
      ? `<tr class="standings-playoff-line"><td colspan="9"></td></tr>`
      : '';
    const relegateLine = idx === safeBottom
      ? `<tr class="standings-relegate-line"><td colspan="9"></td></tr>`
      : '';

    return `${playoffLine}
      <tr class="${rowClasses.join(' ')}">
        <td class="standings-pos">${idx + 1}</td>
        <td class="standings-team-name">${team.fullName ?? entry.teamId}</td>
        <td class="standings-abbrev">${team.abbrev ?? ''}</td>
        <td>${entry.gp}</td>
        <td>${entry.w}</td>
        <td>${entry.l}</td>
        <td>${entry.otl}</td>
        <td class="standings-pts">${entry.pts}</td>
        <td class="standings-gd">${gdStr}</td>
      </tr>${relegateLine}`;
  }).join('');

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
            <th>GP</th>
            <th>W</th>
            <th>L</th>
            <th>OTL</th>
            <th>PTS</th>
            <th>GD</th>
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
