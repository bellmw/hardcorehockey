/**
 * dashboard.js
 * Renders the dashboard screen.
 * Triggered by 'render-screen' CustomEvent on document with detail.screen === 'dashboard'.
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

function el(id) {
  return document.getElementById(id);
}

function formatMoney(amount) {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  return `$${(amount / 1_000).toFixed(0)}K`;
}

// ─── Main render ──────────────────────────────────────────────────────────────

function renderDashboard(state) {
  const team = state.teams[state.playerTeamId];
  if (!team) return;

  const leagueId  = team.leagueId;
  const standings = state.standings[leagueId];
  const teamEntry = standings?.[state.playerTeamId] ?? { w: 0, l: 0, otl: 0 };

  renderHeader(state, team, teamEntry, leagueId);
  renderTeamSummary(team);
  renderStandingsSnippet(state, leagueId, standings);
  renderCapBar(state, team);
  renderNews(state.news);
  renderSimControls(state.phase);
}

// ─── Header ───────────────────────────────────────────────────────────────────

function renderHeader(state, team, teamEntry, leagueId) {
  const nameEl = el('hdr-team-name');
  if (nameEl) nameEl.textContent = team.fullName;

  const recordEl = el('hdr-record');
  if (recordEl) recordEl.textContent = `${teamEntry.w}-${teamEntry.l}-${teamEntry.otl}`;

  const yearEl = el('hdr-year');
  if (yearEl) yearEl.textContent = `Year ${state.year}`;

  const badgeEl = el('hdr-league-badge');
  if (badgeEl) {
    badgeEl.textContent = leagueId.toUpperCase();
    badgeEl.className   = `league-badge ${leagueId}`;
  }
}

// ─── Team summary ─────────────────────────────────────────────────────────────

function renderTeamSummary(team) {
  const container = el('dash-team-summary');
  if (!container) return;

  container.innerHTML = `
    <div class="team-summary">
      <div class="team-summary-name">${team.fullName}</div>
      <div class="team-summary-row"><span class="label">City</span><span>${team.city}</span></div>
      <div class="team-summary-row"><span class="label">Arena</span><span>${team.arena}</span></div>
      <div class="team-summary-row"><span class="label">GM</span><span>${team.gmName}</span></div>
    </div>
  `;
}

// ─── Standings snippet ────────────────────────────────────────────────────────

function renderStandingsSnippet(state, leagueId, standings) {
  const container = el('dash-standings-snippet');
  if (!container || !standings) return;

  const sorted = Object.values(standings).sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.w   !== a.w)   return b.w   - a.w;
    return (b.gf - b.ga) - (a.gf - a.ga);
  });

  // Bottom 2 face relegation; last safe position is index (length - 3), 0-based
  const lastSafeIdx = sorted.length - 3;
  const sliced      = sorted.slice(0, 6);

  const rows = sliced.map((entry, idx) => {
    const isPlayer = entry.teamId === state.playerTeamId;
    const team     = state.teams[entry.teamId];
    const abbrev   = team?.abbrev ?? entry.teamId;
    const rowClass = isPlayer ? 'standings-player-row' : '';

    const relegLine = idx === lastSafeIdx
      ? `<tr class="standings-relegate-line"><td colspan="7"></td></tr>`
      : '';

    return `
      <tr class="${rowClass}">
        <td class="standings-pos">${idx + 1}</td>
        <td class="standings-team">${abbrev}</td>
        <td>${entry.gp}</td>
        <td>${entry.w}</td>
        <td>${entry.l}</td>
        <td>${entry.otl}</td>
        <td class="standings-pts">${entry.pts}</td>
      </tr>${relegLine}`;
  }).join('');

  container.innerHTML = `
    <table class="standings-table">
      <thead>
        <tr>
          <th>#</th><th>Team</th><th>GP</th><th>W</th><th>L</th><th>OTL</th><th>PTS</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ─── Cap bar ──────────────────────────────────────────────────────────────────

function renderCapBar(state, team) {
  const container = el('dash-cap-bar');
  if (!container) return;

  const total = state.cap ?? 40_000_000;
  const used  = (team.rosterIds || [])
    .map(id => state.allPlayers[id])
    .filter(Boolean)
    .reduce((sum, p) => sum + (p.salary || 0), 0);

  const pct       = Math.min((used / total) * 100, 100);
  const fillClass = used > total ? 'cap-bar-fill over-cap' : 'cap-bar-fill';

  container.innerHTML = `
    <div class="cap-bar-track">
      <div class="${fillClass}" style="width:${pct}%"></div>
    </div>
    <div class="cap-bar-labels">
      <span class="cap-used">${formatMoney(used)}</span>
      <span class="cap-total">${formatMoney(total)}</span>
    </div>
  `;
}

// ─── News feed ────────────────────────────────────────────────────────────────

function renderNews(news) {
  const container = el('dash-news');
  if (!container) return;

  const items = (news || []).slice(0, 5);

  if (items.length === 0) {
    container.innerHTML = '<p class="news-empty">No news yet.</p>';
    return;
  }

  container.innerHTML = items.map(item => {
    const headlineText = item.headline ?? item.text ?? '';
    const reportHtml   = item.report
      ? `<div class="news-report">${item.report}</div>`
      : '';
    return `
      <div class="news-item news-type-${item.type ?? 'generic'}">
        <div class="news-headline">${headlineText}</div>
        ${reportHtml}
        <div class="news-meta">Week ${item.week ?? '—'}</div>
      </div>`;
  }).join('');
}

// ─── Sim controls ─────────────────────────────────────────────────────────────

function renderSimControls(phase) {
  const isPlayoffs  = phase === 'playoffs';
  const isOffseason = phase === 'offseason';
  const isSeason    = phase === 'season';

  const btnEnd      = el('btn-end-season');
  const btnNext     = el('btn-sim-next');
  const btnSimWeek  = el('btn-sim-week');
  const btnSimPO    = el('btn-sim-playoffs');  // "sim to playoffs" button

  // Hide all first, then show what's relevant
  [btnEnd, btnNext, btnSimWeek, btnSimPO].forEach(b => { if (b) b.style.display = 'none'; });

  if (isSeason) {
    if (btnNext)    btnNext.style.display    = '';
    if (btnSimWeek) btnSimWeek.style.display = '';
    if (btnSimPO)   btnSimPO.style.display   = '';
  }

  if (isPlayoffs) {
    // Only sim-playoffs visible — end-season must wait until playoffs are done
    if (btnSimPO) {
      btnSimPO.style.display = '';
      btnSimPO.textContent   = 'Sim playoffs →';
      btnSimPO.onclick       = () => window.hockeyGM.simPlayoffs();
    }
  }

  if (isOffseason) {
    if (btnEnd) {
      btnEnd.style.display = '';
      btnEnd.textContent   = 'Start new season →';
      btnEnd.onclick       = () => window.hockeyGM.endSeason();
    }
  }
}

// ─── Event listener ───────────────────────────────────────────────────────────

document.addEventListener('render-screen', (e) => {
  if (e.detail?.screen !== 'dashboard') return;
  renderDashboard(e.detail.state);
});
