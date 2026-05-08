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
  renderRosterBreakdown(state, team);
  renderStandingsSnippet(state, leagueId, standings);
  renderCapBar(state, team);
  renderUpcomingGames(state, team);
  renderNews(state);
  renderSimControls(state.phase);

  // Auto-open bracket if we just entered playoffs
  if (state.playoffBracketPending && window.hockeyGM?.showPlayoffBracket) {
    window.hockeyGM.showPlayoffBracket();
  }
}

// ─── Header ───────────────────────────────────────────────────────────────────

function renderHeader(state, team, teamEntry, leagueId) {
  const nameEl = el('hdr-team-name');
  if (nameEl) nameEl.textContent = team.fullName;

  const recordEl = el('hdr-record');
  if (recordEl) recordEl.textContent = `${teamEntry.w}-${teamEntry.l}-${teamEntry.otl}`;

  const capEl = el('hdr-cap');
  if (capEl) {
    const total = state.cap ?? 75_000_000;
    const used  = (team.rosterIds || [])
      .map(id => state.allPlayers[id])
      .filter(Boolean)
      .reduce((sum, p) => sum + (p.salary || 0), 0);
    const pct = Math.min((used / total) * 100, 100);
    capEl.textContent = `${formatMoney(used)} / ${formatMoney(total)} (${pct.toFixed(0)}%)`;
  }

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

// ─── Roster breakdown ────────────────────────────────────────────────────────

function renderRosterBreakdown(state, team) {
  const container = el('dash-roster-breakdown');
  if (!container) return;

  const roster = (team.rosterIds || [])
    .map(id => state.allPlayers[id])
    .filter(Boolean);

  const fwd  = roster.filter(p => ['C','LW','RW'].includes(p.position));
  const def  = roster.filter(p => ['LD','RD'].includes(p.position));
  const goal = roster.filter(p => p.position === 'G');
  const avg  = arr => arr.length ? Math.round(arr.reduce((s, p) => s + p.overall, 0) / arr.length) : 0;

  const groups = [
    { label: 'Forwards',     avg: avg(fwd),  players: fwd  },
    { label: 'Defence',      avg: avg(def),  players: def  },
    { label: 'Goaltending',  avg: avg(goal), players: goal },
  ];

  const sorted = [...groups].sort((a, b) => b.avg - a.avg);
  const best   = sorted[0];
  const worst  = sorted[sorted.length - 1];

  const barHTML = groups.map(g => {
    const pct = Math.min(Math.max((g.avg - 40) / 50 * 100, 2), 100);
    const cls = ovrClassDash(g.avg);
    return `
      <div class="breakdown-row">
        <span class="breakdown-label">${g.label}</span>
        <div class="breakdown-bar-track">
          <div class="breakdown-bar ${cls}" style="width:${pct}%"></div>
        </div>
        <span class="breakdown-avg ${cls}">${g.avg}</span>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="breakdown-bars">${barHTML}</div>
    <div class="breakdown-sw">
      <span class="sw-pill strength-label">↑ ${best.label}</span>
      <span class="sw-pill weakness-label">↓ ${worst.label}</span>
    </div>
  `;
}

function ovrClassDash(ovr) {
  if (ovr >= 80) return 'ovr-elite';
  if (ovr >= 70) return 'ovr-good';
  if (ovr >= 60) return 'ovr-avg';
  return 'ovr-poor';
}

// ─── Standings snippet ─────────────────────────────────────────────────────────

function renderStandingsSnippet(state, leagueId, standings) {
  const container = el('dash-standings-snippet');
  if (!container || !standings) return;

  const sorted = Object.values(standings).sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.w   !== a.w)   return b.w   - a.w;
    return (b.gf - b.ga) - (a.gf - a.ga);
  });

  // Show all 12 teams
  const lastSafeIdx = sorted.length - 3;

  const rows = sorted.map((entry, idx) => {
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
        <td class="standings-team"><span class="team-tip" data-team-id="${entry.teamId}">${abbrev}</span></td>
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

  const total = state.cap ?? 75_000_000;
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

// ─── Upcoming games ──────────────────────────────────────────────────────────

function renderUpcomingGames(state, team) {
  const container = el('dash-schedule');
  if (!container) return;

  const leagueId = team.leagueId;
  const schedule = state.leagues[leagueId]?.schedule ?? [];

  const upcoming = schedule
    .filter(g => !g.played && (g.homeTeamId === team.id || g.awayTeamId === team.id))
    .sort((a, b) => (a.week ?? 0) - (b.week ?? 0))
    .slice(0, 5);

  if (upcoming.length === 0) {
    container.innerHTML = '<p class="schedule-empty">No upcoming games.</p>';
    return;
  }

  const rows = upcoming.map(g => {
    const isHome   = g.homeTeamId === team.id;
    const oppId    = isHome ? g.awayTeamId : g.homeTeamId;
    const opp      = state.teams[oppId];
    const oppName  = opp?.abbrev ?? oppId;
    const venue    = isHome ? 'vs' : '@';
    const venueClass = isHome ? 'sched-home' : 'sched-away';
    return `
      <div class="sched-row">
        <span class="sched-week">Wk ${g.week ?? '?'}</span>
        <span class="sched-venue ${venueClass}">${venue}</span>
        <span class="sched-opp team-tip" data-team-id="${oppId}">${oppName}</span>
      </div>`;
  }).join('');

  container.innerHTML = `<div class="sched-list">${rows}</div>`;
}

// ─── News feed ────────────────────────────────────────────────────────────────

function renderNews(state) {
  const container = el('dash-news');
  if (!container) return;

  const news = state.news || [];
  const pendingTrades = (state.pendingTrades || []).length;
  const weeksToDeadline = Math.max(0, state.tradeDeadlineWeek - state.week);
  const isTradeWindowOpen = state.phase === 'season' && !state.tradeMarketClosed && state.week <= state.tradeDeadlineWeek;

  // Trade status widget
  const tradeWidget = `
    <div class="news-trade-widget">
      <div class="trade-widget-row">
        <button class="trade-widget-item" onclick="hockeyGM.showScreen('trade')" title="View trade offers">
          <span class="trade-widget-label">Pending Trades</span>
          <span class="trade-widget-value">${pendingTrades}</span>
        </button>
        <button class="trade-widget-item" onclick="hockeyGM.showScreen('trade')" title="View trade deadline" ${!isTradeWindowOpen ? 'disabled' : ''}>
          <span class="trade-widget-label">Weeks to Deadline</span>
          <span class="trade-widget-value">${isTradeWindowOpen ? weeksToDeadline : '—'}</span>
        </button>
      </div>
    </div>
  `;

  const items = news.slice(0, 5);

  if (items.length === 0) {
    container.innerHTML = tradeWidget + '<p class="news-empty">No news yet.</p>';
    return;
  }

  const newsItems = items.map(item => {
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

  container.innerHTML = tradeWidget + newsItems;
}

// ─── Sim controls ─────────────────────────────────────────────────────────────

function renderSimControls(phase) {
  const state = window.hockeyGM?.getState?.();
  const isPlayoffs  = phase === 'playoffs';
  const isOffseason = phase === 'offseason';
  const isSeason    = phase === 'season';
  const isPreseasonDraft = phase === 'preseason_draft' && !!state?.draftClass && state.draftClass.length > 0;
  const isPreseasonComplete = phase === 'preseason_draft' && (!state?.draftClass || state.draftClass.length === 0);

  const btnEnd      = el('btn-end-season');
  const btnNext     = el('btn-sim-next');
  const btnSimWeek  = el('btn-sim-week');
  const btnSimPO    = el('btn-sim-playoffs');
  const btnSeries   = el('btn-sim-series');

  // Hide all first, then show what's relevant
  [btnEnd, btnNext, btnSimWeek, btnSimPO, btnSeries].forEach(b => { if (b) b.style.display = 'none'; });

  if (isSeason) {
    if (btnNext)    { btnNext.style.display    = ''; btnNext.textContent = 'Sim my next game'; btnNext.onclick = () => window.hockeyGM.simToMyNextGame(); }
    if (btnSimWeek) btnSimWeek.style.display = '';
    if (btnSimPO)   { btnSimPO.style.display = ''; btnSimPO.textContent = 'Sim to playoffs'; btnSimPO.onclick = () => window.hockeyGM.simToPlayoffs(); }
  }

  if (isPreseasonDraft) {
    if (btnNext) {
      btnNext.style.display = '';
      btnNext.textContent = 'Go to draft';
      btnNext.onclick = () => window.hockeyGM.showScreen('draft');
    }
    if (btnSimWeek) {
      btnSimWeek.style.display = '';
      btnSimWeek.textContent = 'Skip draft, begin season';
      btnSimWeek.onclick = () => window.hockeyGM.skipPreseasonDraft();
    }
  }

  if (isPreseasonComplete) {
    if (btnNext) {
      btnNext.style.display = '';
      btnNext.textContent = 'Begin season';
      btnNext.onclick = () => window.hockeyGM.beginSeason();
    }
  }

  if (isPlayoffs) {
    if (btnNext)  { btnNext.style.display = '';  btnNext.textContent  = 'Sim my next playoff game'; btnNext.onclick  = () => window.hockeyGM.simMyNextPlayoffGame(); }
    if (btnSeries){ btnSeries.style.display = ''; }
    if (btnSimPO) { btnSimPO.style.display  = ''; btnSimPO.textContent = 'Sim all playoffs →';     btnSimPO.onclick = () => window.hockeyGM.simPlayoffs(); }
    // Add view bracket button dynamically if not already present
    const simCtrl = btnNext?.closest('.sim-controls');
    if (simCtrl && !simCtrl.querySelector('.btn-view-bracket')) {
      const bkt = document.createElement('button');
      bkt.className   = 'btn-secondary btn-view-bracket';
      bkt.textContent = 'View bracket';
      bkt.onclick     = () => window.hockeyGM.showPlayoffBracket();
      simCtrl.insertBefore(bkt, btnNext);
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

// ─── Team tooltip ────────────────────────────────────────────────────────────

(function initTeamTooltip() {
  const tip = document.getElementById('team-tooltip');
  if (!tip) return;

  let _state = null;

  // Keep a reference to the latest state so tooltip always has fresh data
  document.addEventListener('render-screen', (e) => {
    if (e.detail?.state) _state = e.detail.state;
  });

  document.addEventListener('mouseover', (e) => {
    const target = e.target.closest('.team-tip');
    if (!target || !_state) return;

    const teamId = target.dataset.teamId;
    const team   = _state.teams?.[teamId];
    if (!team) return;

    const leagueId  = team.leagueId;
    const standings = _state.standings?.[leagueId];
    const entry     = standings?.[teamId];
    const record    = entry ? `${entry.w}–${entry.l}–${entry.otl}` : '—';
    const pts       = entry ? `${entry.pts} pts` : '';
    const leagueBadge = leagueId?.toUpperCase() ?? '';

    // Build roster breakdown
    const roster = (team.rosterIds || [])
      .map(id => _state.allPlayers[id])
      .filter(Boolean);
    const fwd  = roster.filter(p => ['C','LW','RW'].includes(p.position));
    const def  = roster.filter(p => ['LD','RD'].includes(p.position));
    const goal = roster.filter(p => p.position === 'G');
    const avg  = arr => arr.length ? Math.round(arr.reduce((s, p) => s + p.overall, 0) / arr.length) : 0;
    const rosterBreakdown = `${fwd.length} Fwd (${avg(fwd)}) · ${def.length} Def (${avg(def)}) · ${goal.length} G (${avg(goal)})`;

    tip.innerHTML = `
      <div class="tip-name">${team.fullName}</div>
      <div class="tip-meta">
        <span class="league-badge ${leagueId}">${leagueBadge}</span>
        <span class="tip-record">${record}</span>
        ${pts ? `<span class="tip-pts">${pts}</span>` : ''}
      </div>
      <div class="tip-detail">${team.city} · ${team.arena}</div>
      <div class="tip-roster">${rosterBreakdown}</div>
    `;

    const rect = target.getBoundingClientRect();
    const scrollY = window.scrollY || 0;
    const scrollX = window.scrollX || 0;
    tip.style.display = 'block';

    // Position below the element, flip up if near bottom
    let top  = rect.bottom + scrollY + 6;
    let left = rect.left  + scrollX;
    if (rect.bottom + 110 > window.innerHeight) {
      top = rect.top + scrollY - 6;
      tip.style.transform = 'translateY(-100%)';
    } else {
      tip.style.transform = '';
    }
    // Keep tooltip on screen horizontally
    left = Math.min(left, window.innerWidth + scrollX - 200);
    tip.style.top  = `${top}px`;
    tip.style.left = `${left}px`;
  });

  document.addEventListener('mouseout', (e) => {
    if (!e.target.closest('.team-tip')) return;
    tip.style.display = 'none';
  });
})();

// ─── Event listener ───────────────────────────────────────────────────────────

document.addEventListener('render-screen', (e) => {
  if (e.detail?.screen !== 'dashboard') return;
  renderDashboard(e.detail.state);
});
