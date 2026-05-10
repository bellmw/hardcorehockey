/**
 * dashboard.js
 * Renders the dashboard screen.
 * Triggered by 'render-screen' CustomEvent on document with detail.screen === 'dashboard'.
 */
import { teamLogoSvg, applyTeamColors } from './teamLogo.js';

// ─── Carousel State ───────────────────────────────────────────────────────────

const leaderboardCarousel = {
  categories: ['Points', 'Goals', 'GAA', 'Save %'],
  currentIndex: 0,
  data: {
    Points: [],
    Goals: [],
    GAA: [],
    'Save %': [],
  },
};

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
  renderThisWeek(state, team);
  renderTeamSummary(team, state);
  renderRosterBreakdown(state, team);
  renderStandingsSnippet(state, leagueId, standings);
  renderCapBar(state, team);
  renderUpcomingGames(state, team);
  renderLeagueLeaders(state, team);
  renderNews(state);
  renderSimControls(state.phase);
  renderGameModeToggle();

  // Auto-open bracket if we just entered playoffs
  if (state.playoffBracketPending && window.hockeyGM?.showPlayoffBracket) {
    window.hockeyGM.showPlayoffBracket();
  }
}

// ─── Header ───────────────────────────────────────────────────────────────────

function renderHeader(state, team, teamEntry, leagueId) {
  // Apply team colors globally to CSS variables
  if (team.primaryColor) applyTeamColors(team.primaryColor, team.secondaryColor || '#FFFFFF');

  const nameEl = el('hdr-team-name');
  if (nameEl) {
    // Add mini logo before team name
    const logo = teamLogoSvg(team.abbrev, team.primaryColor, team.secondaryColor || '#FFFFFF', 28);
    nameEl.innerHTML = `<span class="hdr-team-logo">${logo}</span>${team.fullName}`;
  }

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

function renderTeamSummary(team, state) {
  const container = el('dash-team-summary');
  if (!container) return;

  // Build narrative voice from roster strengths
  const roster = (team.rosterIds || [])
    .map(id => state?.allPlayers?.[id])
    .filter(Boolean);
  const avg = arr => arr.length ? Math.round(arr.reduce((s, p) => s + p.overall, 0) / arr.length) : 0;
  const fwdAvg  = avg(roster.filter(p => ['C','LW','RW'].includes(p.position)));
  const defAvg  = avg(roster.filter(p => ['LD','RD'].includes(p.position)));
  const goalAvg = avg(roster.filter(p => p.position === 'G'));
  const groups  = [
    { label: 'forwards',    avg: fwdAvg  },
    { label: 'defence',     avg: defAvg  },
    { label: 'goaltending', avg: goalAvg },
  ].filter(g => g.avg > 0).sort((a, b) => b.avg - a.avg);
  const strength = groups[0];
  const weakness = groups[groups.length - 1];
  const narrative = (strength && weakness && strength.label !== weakness.label)
    ? `Your ${strength.label} are your foundation. Your ${weakness.label} needs work.`
    : '';

  const allAvg = roster.length ? Math.round(roster.reduce((s,p) => s + p.overall, 0) / roster.length) : 0;
  const fwdAvg2  = avg(roster.filter(p => ['C','LW','RW'].includes(p.position)));
  const defAvg2  = avg(roster.filter(p => ['LD','RD'].includes(p.position)));
  const goalAvg2 = avg(roster.filter(p => p.position === 'G'));

  function ovrLed(val) {
    if (val >= 82) return 'led-good';
    if (val >= 74) return 'led-okay';
    if (val >= 66) return 'led-poor';
    return 'led-critical';
  }

  container.innerHTML = `
    ${narrative ? `<div class="team-narrative">${narrative}</div>` : ''}
    <div class="team-record-bar">
      <div class="team-record-stat">
        <span class="team-record-stat-label">TEAM OVR</span>
        <span class="team-record-stat-value">${allAvg || '—'}</span>
      </div>
      <div class="team-record-stat">
        <span class="team-record-stat-label">FWD</span>
        <span class="team-record-stat-value">${fwdAvg2 || '—'}</span>
      </div>
      <div class="team-record-stat">
        <span class="team-record-stat-label">DEF</span>
        <span class="team-record-stat-value">${defAvg2 || '—'}</span>
      </div>
      <div class="team-record-stat">
        <span class="team-record-stat-label">G</span>
        <span class="team-record-stat-value">${goalAvg2 || '—'}</span>
      </div>
    </div>
    <div class="led-indicator-row" style="margin-top:8px">
      <span class="led-indicator ${ovrLed(fwdAvg2)}">FWD ${fwdAvg2}</span>
      <span class="led-indicator ${ovrLed(defAvg2)}">DEF ${defAvg2}</span>
      <span class="led-indicator ${ovrLed(goalAvg2)}">G ${goalAvg2}</span>
    </div>
    <div class="team-summary" style="margin-top:10px">
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
// ─── League leaders ──────────────────────────────────────────────────────────

function renderLeagueLeaders(state, team) {
  const container = el('dash-league-leaders');
  if (!container) return;

  const leagueId = team.leagueId;
  const playerTeamId = state.playerTeamId;
  
  // Get all players in the league (from all teams in same league) and build teamId mapping
  const allTeamsInLeague = Object.values(state.teams).filter(t => t.leagueId === leagueId);
  const leaguePlayers = [];
  const playerTeamMap = {};
  
  allTeamsInLeague.forEach(t => {
    (t.rosterIds || []).forEach(playerId => {
      const player = state.allPlayers[playerId];
      if (player) {
        leaguePlayers.push(player);
        playerTeamMap[playerId] = t.id;
      }
    });
  });

  // Separate skaters and goalies
  const skaters = leaguePlayers.filter(p => ['C', 'LW', 'RW', 'LD', 'RD'].includes(p.position));
  const goalies = leaguePlayers.filter(p => p.position === 'G');

  // Compute leaderboards
  const topPointScorers = [...skaters]
    .sort((a, b) => (b.seasonStats?.pts ?? 0) - (a.seasonStats?.pts ?? 0))
    .slice(0, 10);

  const topGoalScorers = [...skaters]
    .sort((a, b) => (b.seasonStats?.g ?? 0) - (a.seasonStats?.g ?? 0))
    .slice(0, 10);

  const gaaLeaders = [...goalies]
    .filter(g => (g.seasonStats?.gp ?? 0) > 0)
    .map(g => ({
      ...g,
      gaa: (g.seasonStats.ga ?? 0) / (g.seasonStats.gp ?? 1) * 3,
    }))
    .sort((a, b) => a.gaa - b.gaa)
    .slice(0, 10);

  const svpctLeaders = [...goalies]
    .filter(g => (g.seasonStats?.sa ?? 0) > 0)
    .map(g => ({
      ...g,
      svpct: ((g.seasonStats.sv ?? 0) / (g.seasonStats.sa ?? 1) * 100),
    }))
    .sort((a, b) => b.svpct - a.svpct)
    .slice(0, 10);

  // Store data in carousel
  leaderboardCarousel.data.Points = topPointScorers.map(p => ({ 
    ...p, 
    teamId: playerTeamMap[p.id], 
    stat: p.seasonStats?.pts ?? 0 
  }));
  leaderboardCarousel.data.Goals = topGoalScorers.map(p => ({ 
    ...p, 
    teamId: playerTeamMap[p.id], 
    stat: p.seasonStats?.g ?? 0 
  }));
  leaderboardCarousel.data.GAA = gaaLeaders.map(g => ({ 
    ...g, 
    teamId: playerTeamMap[g.id], 
    stat: g.gaa 
  }));
  leaderboardCarousel.data['Save %'] = svpctLeaders.map(g => ({ 
    ...g, 
    teamId: playerTeamMap[g.id], 
    stat: g.svpct 
  }));

  // Render current category
  renderLeaderboardCategory(container, state, playerTeamId);
}

function renderLeaderboardCategory(container, state, playerTeamId) {
  if (!container) return;
  
  const category = leaderboardCarousel.categories[leaderboardCarousel.currentIndex];
  const players = leaderboardCarousel.data[category] || [];
  
  // Update category label
  const label = el('leaders-category-label');
  if (label) label.textContent = category;
  
  const rows = players.map((p, idx) => {
    const team = state.teams[p.teamId];
    const teamBadge = team?.abbrev ?? '—';
    const isMyTeam = p.teamId === playerTeamId;
    const rowClass = isMyTeam ? 'leaders-table-row leaders-table-row--my-team' : 'leaders-table-row';
    
    let value = p.stat;
    if (category === 'GAA') value = p.stat.toFixed(2);
    else if (category === 'Save %') value = p.stat.toFixed(1) + '%';
    
    const playerClass = isMyTeam ? 'leaders-player leaders-player--my-team' : 'leaders-player';
    
    return `
      <tr class="${rowClass}" data-player-id="${p.id}">
        <td class="leaders-rank">${idx + 1}</td>
        <td class="leaders-name">
          <span class="${playerClass}" data-player-id="${p.id}" data-player-info='${JSON.stringify({
            fullName: p.fullName,
            position: p.position,
            overall: p.overall,
            age: p.age,
            salary: p.salary,
            contractYears: p.contractYears,
            contractType: p.contractType,
            teamId: p.teamId,
            teamAbbrev: teamBadge,
            gp: p.seasonStats?.gp ?? 0,
            g: p.seasonStats?.g ?? 0,
            a: p.seasonStats?.a ?? 0,
            pts: p.seasonStats?.pts ?? 0,
          }).replace(/'/g, "&apos;")}'>
            ${p.fullName}
          </span>
          <span class="leaders-team-badge">${teamBadge}</span>
        </td>
        <td class="leaders-stat">${value}</td>
      </tr>`;
  }).join('');

  const tableHtml = players.length
    ? `<table class="leaders-table"><tbody>${rows}</tbody></table>`
    : '<p class="leaders-empty">No data yet</p>';

  container.innerHTML = `<div class="leaders-card">${tableHtml}</div>`;
  
  // Bind player tooltips
  bindLeaderPlayerTooltips(state);
}

function bindLeaderPlayerTooltips(state) {
  const playerSpans = document.querySelectorAll('.leaders-player[data-player-info]');
  const tip = document.getElementById('leaders-player-tooltip');
  
  if (!tip) return;
  
  playerSpans.forEach(span => {
    span.addEventListener('mouseover', (e) => {
      const info = JSON.parse(e.target.dataset.playerInfo);
      const formatMoney = (amt) => {
        if (amt >= 1_000_000) return `$${(amt / 1_000_000).toFixed(1)}M`;
        return `$${(amt / 1_000).toFixed(0)}K`;
      };
      
      const salaryClass = info.contractType === 'entry' ? 'entry-deal' : 'standard-deal';
      const highlight = e.target.classList.contains('leaders-player--my-team') ? '★ ' : '';
      
      tip.innerHTML = `
        <div class="tip-name">${highlight}${info.fullName}</div>
        <div class="tip-position">${info.position} • OVR ${info.overall}</div>
        <div class="tip-meta">Age ${info.age} · ${info.teamAbbrev}</div>
        <div class="tip-salary">
          <span>${formatMoney(info.salary)}</span>
          <span class="contract-badge ${salaryClass}">${info.contractYears}yr ${info.contractType}</span>
        </div>
        <div class="tip-stats">GP: ${info.gp} | G: ${info.g} | A: ${info.a} | Pts: ${info.pts}</div>
      `;
      
      const rect = e.target.getBoundingClientRect();
      const scrollY = window.scrollY || 0;
      const scrollX = window.scrollX || 0;
      tip.style.display = 'block';
      
      let top = rect.bottom + scrollY + 6;
      let left = rect.left + scrollX;
      if (rect.bottom + 140 > window.innerHeight) {
        top = rect.top + scrollY - 6;
        tip.style.transform = 'translateY(-100%)';
      } else {
        tip.style.transform = '';
      }
      left = Math.min(left, window.innerWidth + scrollX - 220);
      tip.style.top = `${top}px`;
      tip.style.left = `${left}px`;
    });
    
    span.addEventListener('mouseout', () => {
      if (tip) tip.style.display = 'none';
    });
  });
}

// ─── Carousel Navigation ──────────────────────────────────────────────────────

window.dashboardLeadersPrev = function() {
  leaderboardCarousel.currentIndex = (leaderboardCarousel.currentIndex - 1 + leaderboardCarousel.categories.length) % leaderboardCarousel.categories.length;
  const state = window.hockeyGM?.getState?.();
  if (state) renderLeaderboardCategory(el('dash-league-leaders'), state, state.playerTeamId);
};

window.dashboardLeadersNext = function() {
  leaderboardCarousel.currentIndex = (leaderboardCarousel.currentIndex + 1) % leaderboardCarousel.categories.length;
  const state = window.hockeyGM?.getState?.();
  if (state) renderLeaderboardCategory(el('dash-league-leaders'), state, state.playerTeamId);
};
// ─── This Week zone ──────────────────────────────────────────────────────────

function renderThisWeek(state, team) {
  const container = el('dash-this-week');
  if (!container) return;

  const phase    = state.phase;
  const leagueId = team.leagueId;
  const standings = state.standings?.[leagueId];
  const sorted = standings
    ? Object.values(standings).sort((a, b) => {
        if (b.pts !== a.pts) return b.pts - a.pts;
        if (b.w   !== a.w)   return b.w   - a.w;
        return (b.gf - b.ga) - (a.gf - a.ga);
      })
    : [];
  const rank        = sorted.findIndex(e => e.teamId === state.playerTeamId) + 1;
  const inPlayoffs  = rank > 0 && rank <= 4;

  const pendingTrades = (state.pendingTrades || []).filter(t => t.status === 'pending');

  const weeksToDeadline = (state.phase === 'season' && !state.tradeMarketClosed)
    ? Math.max(0, (state.tradeDeadlineWeek ?? 14) - (state.week ?? 0))
    : null;

  const injuries = Object.values(state.allPlayers || {})
    .filter(p => (team.rosterIds || []).includes(p.id) && p.injured);

  const expiringContracts = (team.rosterIds || [])
    .map(id => state.allPlayers?.[id])
    .filter(p => p && p.contractYears <= 1 && p.overall >= 70);

  const schedule  = state.leagues?.[leagueId]?.schedule ?? [];
  const nextGame  = schedule
    .filter(g => !g.played && (g.homeTeamId === team.id || g.awayTeamId === team.id))
    .sort((a, b) => (a.week ?? 0) - (b.week ?? 0))[0];

  let urgency  = 'info';
  let headline = '';
  let detail   = '';
  let action   = '';

  if (phase === 'offseason') {
    urgency  = 'gold';
    headline = 'Off-season';
    detail   = 'Review your roster and prepare for next year.';
  } else if (phase === 'preseason_draft') {
    urgency  = 'ice';
    headline = 'Draft day';
    detail   = 'Your first pick is waiting. Choose wisely.';
  } else if (phase === 'playoffs') {
    urgency  = 'gold';
    headline = 'Playoffs';
    detail   = inPlayoffs
      ? 'Your team is in. Every game is elimination.'
      : 'Your season is over. Study your rivals.';
  } else if (pendingTrades.length > 0) {
    urgency  = 'accent';
    headline = `${pendingTrades.length} trade offer${pendingTrades.length > 1 ? 's' : ''} waiting`;
    const fromName = pendingTrades[0].fromTeamId
      ? (state.teams?.[pendingTrades[0].fromTeamId]?.fullName ?? 'A GM')
      : 'A GM';
    detail = `${fromName} wants to deal. Don't leave them hanging.`;
    action = `<button class="this-week-action-btn" onclick="hockeyGM.showScreen('trade')">Review offers →</button>`;
  } else if (weeksToDeadline === 1) {
    urgency  = 'accent';
    headline = 'Trade deadline: next week';
    detail   = `Window closes after Week ${state.tradeDeadlineWeek}. Last chance to make a move.`;
    action   = `<button class="this-week-action-btn" onclick="hockeyGM.showScreen('trade')">Go to trade desk →</button>`;
  } else if (injuries.length > 0) {
    urgency  = 'warn';
    headline = `${injuries.length} player${injuries.length > 1 ? 's' : ''} injured`;
    detail   = `${injuries[0].fullName} is out. Your depth is being tested.`;
    action   = `<button class="this-week-action-btn" onclick="hockeyGM.showScreen('roster')">Check roster →</button>`;
  } else if (expiringContracts.length > 0) {
    urgency  = 'warn';
    headline = `${expiringContracts.length} key contract${expiringContracts.length > 1 ? 's' : ''} expiring`;
    detail   = `${expiringContracts[0].fullName} (OVR ${expiringContracts[0].overall}) hits free agency this offseason.`;
    action   = `<button class="this-week-action-btn" onclick="hockeyGM.showScreen('roster')">Manage contracts →</button>`;
  } else if (nextGame) {
    const isHome  = nextGame.homeTeamId === team.id;
    const oppId   = isHome ? nextGame.awayTeamId : nextGame.homeTeamId;
    const opp     = state.teams?.[oppId];
    const venue   = isHome ? 'vs' : '@';
    const suffix  = rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th';
    const rankStr = rank > 0
      ? (inPlayoffs ? `You are ${rank}${suffix} — in a playoff spot.` : `You are ${rank}${suffix} — outside the playoffs.`)
      : '';
    urgency  = inPlayoffs ? 'ice' : 'warn';
    headline = `Week ${nextGame.week ?? '?'} — ${venue} ${opp?.fullName ?? oppId}`;
    detail   = rankStr;
  } else {
    urgency  = 'info';
    headline = 'Regular season';
    const suffix = rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th';
    detail   = rank > 0 ? `You are ${rank}${suffix} in your league.` : '';
  }

  container.innerHTML = `
    <div class="this-week-zone this-week--${urgency}">
      <div class="this-week-label">This week</div>
      <div class="this-week-headline">${headline}</div>
      ${detail ? `<div class="this-week-detail">${detail}</div>` : ''}
      ${action}
    </div>
  `;
}

// ─── Game mode toggle ─────────────────────────────────────────────────────────

function renderGameModeToggle() {
  const container = el('game-mode-toggle');
  if (!container) return;
  const current = localStorage.getItem('hgm-game-mode') ?? 'quick';
  container.innerHTML = `
    <div class="game-mode-toggle-row">
      <span class="game-mode-toggle-label">Watch mode</span>
      <div class="game-mode-toggle-btns">
        <button class="gm-toggle-btn ${current === 'quick' ? 'gm-toggle-btn--active' : ''}"
          onclick="hockeyGM.setPersistedGameMode('quick')" title="Jump to final score">⚡ Quick</button>
        <button class="gm-toggle-btn ${current === 'watch' ? 'gm-toggle-btn--active' : ''}"
          onclick="hockeyGM.setPersistedGameMode('watch')" title="Period by period">🎬 Watch</button>
      </div>
    </div>
  `;
}

// ─── News feed ────────────────────────────────────────────────────────────────

function renderNews(state) {
  const container = el('dash-news');
  if (!container) return;

  const news = state.news || [];
  const pendingTrades = (state.pendingTrades || []).length;
  const weeksToDeadline = Math.max(0, state.tradeDeadlineWeek - state.week);
  const isTradeWindowOpen = state.phase === 'season' && !state.tradeMarketClosed && state.week <= state.tradeDeadlineWeek;
  const deadlineLabel = isTradeWindowOpen && weeksToDeadline <= 5 ? 'Deadline Watch' : 'Weeks to Deadline';
  const deadlineValue = !isTradeWindowOpen
    ? '—'
    : weeksToDeadline <= 5
      ? `${weeksToDeadline} ${weeksToDeadline === 1 ? 'WEEK' : 'WEEKS'} LEFT`
      : `${weeksToDeadline}`;

  const team = state.teams[state.playerTeamId];
  const leagueStandings = team ? state.standings?.[team.leagueId] : null;
  const sortedStandings = leagueStandings
    ? Object.values(leagueStandings).sort((a, b) => {
        if (b.pts !== a.pts) return b.pts - a.pts;
        if (b.w   !== a.w)   return b.w   - a.w;
        return (b.gf - b.ga) - (a.gf - a.ga);
      })
    : [];
  const rank = sortedStandings.findIndex(entry => entry.teamId === state.playerTeamId) + 1;
  const inPlayoffSpot = rank > 0 && rank <= 4;
  const playoffValue = rank > 0
    ? (inPlayoffSpot ? `IN (${rank})` : `OUT (${rank})`)
    : '—';

  const schedule = team ? (state.leagues?.[team.leagueId]?.schedule ?? []) : [];
  const unplayed = schedule.filter(g => !g.played);
  const lastWeek = unplayed.length ? Math.max(...unplayed.map(g => g.week ?? 0)) : state.week;
  const seasonWeeksLeft = state.phase === 'season' ? Math.max(0, lastWeek - state.week + 1) : 0;
  const seasonWeeksValue = state.phase === 'season'
    ? `${seasonWeeksLeft}`
    : '—';

  // Trade status widget
  const tradeWidget = `
    <div class="news-trade-widget">
      <div class="trade-widget-row">
        <button class="trade-widget-item" onclick="hockeyGM.showScreen('trade')" title="View trade offers">
          <span class="trade-widget-label">Pending Trades</span>
          <span class="trade-widget-value">${pendingTrades}</span>
        </button>
        <button class="trade-widget-item" onclick="hockeyGM.showScreen('trade')" title="View trade deadline" ${!isTradeWindowOpen ? 'disabled' : ''}>
          <span class="trade-widget-label">${deadlineLabel}</span>
          <span class="trade-widget-value">${deadlineValue}</span>
        </button>
      </div>
      <div class="trade-widget-row" style="margin-top:8px">
        <button class="trade-widget-item" onclick="hockeyGM.showScreen('standings')" title="View season status">
          <span class="trade-widget-label">Weeks Left (Season)</span>
          <span class="trade-widget-value">${seasonWeeksValue}</span>
        </button>
        <button class="trade-widget-item" onclick="hockeyGM.showScreen('standings')" title="View standings">
          <span class="trade-widget-label">Playoff Spot</span>
          <span class="trade-widget-value">${playoffValue}</span>
        </button>
      </div>
    </div>
  `;

  const items = news.slice(0, 10);

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
