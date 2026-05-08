/**
 * roster.js
 * Renders the roster screen.
 * Triggered by 'render-screen' CustomEvent with detail.screen === 'roster'.
 */

import { getDressedPlayers } from '../engine/playerGenerator.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const GROUPS = [
  { label: 'Forwards',   positions: ['C', 'LW', 'RW'], posClass: 'fwd'  },
  { label: 'Defence',    positions: ['LD', 'RD'],       posClass: 'def'  },
  { label: 'Goalies',    positions: ['G'],              posClass: 'goal' },
];

// ─── Main render ──────────────────────────────────────────────────────────────

function renderRoster(state) {
  renderCapSummary(state);
  renderPlayerTable(state);
  renderFreeAgents(state);
}

// ─── Cap summary ──────────────────────────────────────────────────────────────

function renderCapSummary(state) {
  const container = document.getElementById('roster-cap-summary');
  if (!container) return;

  const team  = state.teams[state.playerTeamId];
  const total = state.cap ?? 75_000_000;
  const used  = (team?.rosterIds || [])
    .map(id => state.allPlayers[id])
    .filter(Boolean)
    .reduce((sum, p) => sum + (p.salary || 0), 0);

  const pct       = Math.min((used / total) * 100, 100);
  const isOver    = used > total;
  const fillClass = isOver ? 'cap-bar-fill over-cap' : 'cap-bar-fill';

  container.innerHTML = `
    <div class="cap-summary-inner">
      <span class="cap-label">CAP</span>
      <div class="cap-bar-track cap-bar-track--inline">
        <div class="${fillClass}" style="width:${pct}%"></div>
      </div>
      <span class="cap-used ${isOver ? 'text-accent' : ''}">${formatMoney(used)}</span>
      <span class="cap-slash">/</span>
      <span class="cap-total">${formatMoney(total)}</span>
      ${isOver ? '<span class="cap-over-flag">OVER CAP</span>' : ''}
    </div>
  `;
}

// ─── Player table ─────────────────────────────────────────────────────────────

function renderPlayerTable(state) {
  const container = document.getElementById('roster-table-container');
  if (!container) return;

  const team = state.teams[state.playerTeamId];
  if (!team) { container.innerHTML = '<p class="text-3">No team loaded.</p>'; return; }

  const roster = (team.rosterIds || [])
    .map(id => state.allPlayers[id])
    .filter(Boolean);
  const dressedIds = new Set(getDressedPlayers(team, state.allPlayers).map(player => player.id));
  const dressedCounts = getDressedCounts(roster, dressedIds);

  if (roster.length === 0) {
    container.innerHTML = '<p class="text-3" style="padding:1rem">No players on roster.</p>';
    return;
  }

  const sections = GROUPS.map(group => {
    const players = roster
      .filter(p => group.positions.includes(p.position))
      .sort((a, b) => b.overall - a.overall);

    if (players.length === 0) return '';

    const rows = players.map(p => playerRow(p, group.posClass, dressedIds)).join('');

    return `
      <tr class="roster-group-header">
        <td colspan="8">${group.label.toUpperCase()}</td>
      </tr>
      ${rows}
    `;
  }).join('');

  container.innerHTML = `
    <div class="roster-dressed-summary text-3">
      Dressed tonight: <strong>${dressedCounts.total}</strong>/20
      <span>(${dressedCounts.forwards}F · ${dressedCounts.defence}D · ${dressedCounts.goalies}G)</span>
    </div>
    <table class="standings-table roster-table">
      <thead>
        <tr>
          <th>POS</th>
          <th>Name</th>
          <th>Age</th>
          <th>OVR</th>
          <th>Salary</th>
          <th>Contract</th>
          <th class="roster-th-trait">Trait</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${sections}</tbody>
    </table>
  `;

  // Bind release buttons after DOM is written
  container.querySelectorAll('.btn-release').forEach(btn => {
    btn.addEventListener('click', () => {
      const playerId = btn.dataset.playerId;
      const name     = btn.dataset.playerName;
      if (confirm(`Cut ${name}? This cannot be undone.`)) {
        releasePlayer(playerId, state);
      }
    });
  });

  container.querySelectorAll('.btn-trade-block').forEach(btn => {
    btn.addEventListener('click', () => {
      window.hockeyGM.toggleTradeBlock(btn.dataset.playerId);
      window.hockeyGM.showScreen('roster');
    });
  });

  container.querySelectorAll('.btn-extend').forEach(btn => {
    btn.addEventListener('click', () => {
      window.hockeyGM.renegotiatePlayer(btn.dataset.playerId);
      window.hockeyGM.showScreen('roster');
    });
  });
}

function playerRow(player, posClass, dressedIds) {
  const ovrClass = overallClass(player.overall);
  const injFlag  = player.injured    ? ' <span title="Injured" style="color:var(--accent)">✦</span>' : '';
  const susFlag  = player.suspended  ? ' <span title="Suspended" style="color:var(--gold)">⚑</span>'  : '';
  const isDressed = dressedIds.has(player.id);
  const unavailable = player.injured || player.suspended;
  const lineupBadge = unavailable
    ? '<span class="roster-flag roster-flag--out">OUT</span>'
    : isDressed
      ? '<span class="roster-flag roster-flag--dressed">DRESSED</span>'
      : '<span class="roster-flag roster-flag--scratch">SCRATCH</span>';
  const tradeBlockBadge = player.tradeBlock ? '<span class="roster-flag roster-flag--trade">ON BLOCK</span>' : '';
  const extensionBadge = player.pendingExtension
    ? `<span class="roster-flag roster-flag--extension">EXT ${formatMoney(player.pendingExtension.salary)} · ${player.pendingExtension.years}y</span>`
    : '';
  const contractBadge = contractBadgeHtml(player);
  const canExtend = canRenegotiate(player);
  const extendTitle = canExtend ? 'Renegotiate' : 'Only available in the last year of the deal';
  const tradeBlockLabel = player.tradeBlock ? 'Unblock' : 'Shop';

  return `
    <tr>
      <td><span class="pos-badge ${posClass}">${player.position}</span></td>
      <td class="td-name">${player.fullName}${injFlag}${susFlag}<div class="roster-player-flags">${lineupBadge}${tradeBlockBadge}${extensionBadge}</div></td>
      <td>${player.age}</td>
      <td class="${ovrClass}">${player.overall}</td>
      <td>${formatMoney(player.salary ?? 0)}</td>
      <td>${contractBadge}</td>
      <td><span class="trait-chip" title="${player.trait ?? ''}">${player.trait ?? '—'}</span></td>
      <td class="roster-actions-cell">
        <button class="btn-trade-block"
          data-player-id="${player.id}">
          ${tradeBlockLabel}
        </button>
        <button class="btn-extend"
          data-player-id="${player.id}"
          ${canExtend ? '' : `disabled title="${extendTitle}"`}>
          Extend
        </button>
        <button class="btn-release"
          data-player-id="${player.id}"
          data-player-name="${escapeAttr(player.fullName)}">
          CUT
        </button>
      </td>
    </tr>
  `;
}

// ─── Free agents ──────────────────────────────────────────────────────────────

function renderFreeAgents(state) {
  const container = document.getElementById('roster-free-agents');
  if (!container) return;

  const faIds = state.freeAgents || [];

  if (faIds.length === 0) {
    container.innerHTML = '';
    return;
  }

  const fas = faIds
    .map(id => state.allPlayers[id])
    .filter(Boolean)
    .sort((a, b) => b.overall - a.overall);

  const team  = state.teams[state.playerTeamId];
  const total = state.cap ?? 75_000_000;
  const used  = (team?.rosterIds || [])
    .map(id => state.allPlayers[id])
    .filter(Boolean)
    .reduce((sum, p) => sum + (p.salary || 0), 0);
  const remaining = total - used;

  const rows = fas.map(p => {
    const ovrClass = overallClass(p.overall);
    const posClass = p.position === 'G' ? 'goal' : ['LD','RD'].includes(p.position) ? 'def' : 'fwd';
    const askingSalary = p.askingSalary ?? p.salary ?? 0;
    const askingYears = p.askingContractYears ?? p.contractYears ?? 1;
    const canSign  = askingSalary <= remaining;
    return `
      <tr>
        <td><span class="pos-badge ${posClass}">${p.position}</span></td>
        <td class="td-name">${p.fullName}</td>
        <td>${p.age}</td>
        <td class="${ovrClass}">${p.overall}</td>
        <td>${formatMoney(askingSalary)}</td>
        <td>${askingYears}y</td>
        <td><span class="trait-chip">${p.trait ?? '—'}</span></td>
        <td>
          <button class="btn-sign"
            data-player-id="${p.id}"
            ${canSign ? '' : 'disabled title="Not enough cap space"'}>
            SIGN
          </button>
        </td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <h2 class="panel-label" style="margin-top:2rem">Free Agents
      <span style="margin-left:.5rem;font-size:.75rem;color:var(--neon-green)">
        $${(remaining / 1_000_000).toFixed(1)}M cap available
      </span>
    </h2>
    <table class="standings-table roster-table">
      <thead>
        <tr>
          <th>POS</th><th>Name</th><th>Age</th><th>OVR</th>
          <th>Salary</th><th>Yrs</th><th>Trait</th><th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  container.querySelectorAll('.btn-sign').forEach(btn => {
    btn.addEventListener('click', () => {
      window.hockeyGM.signFreeAgent(btn.dataset.playerId);
      window.hockeyGM.showScreen('roster');
    });
  });
}

// ─── Season stats view ────────────────────────────────────────────────────────

function renderStatsView(state) {
  const container = document.getElementById('roster-stats-container');
  if (!container) return;

  const team = state.teams[state.playerTeamId];
  if (!team) { container.innerHTML = '<p class="text-3">No team loaded.</p>'; return; }

  const roster = (team.rosterIds || [])
    .map(id => state.allPlayers[id])
    .filter(Boolean);

  const skaters = roster.filter(p => p.position !== 'G')
    .sort((a, b) => ((b.seasonStats?.pts ?? 0) - (a.seasonStats?.pts ?? 0)) || (b.overall - a.overall));

  const goalies = roster.filter(p => p.position === 'G')
    .sort((a, b) => {
      const safeGAA = (p) => {
        const s = p.seasonStats;
        if (!s || !s.gp) return 99;
        return (s.ga / s.gp) * 3; // goals per game × 3 periods ≈ GAA
      };
      return safeGAA(a) - safeGAA(b);
    });

  const skaterRows = skaters.map(p => {
    const s = p.seasonStats || {};
    const posClass = ['LD','RD'].includes(p.position) ? 'def' : 'fwd';
    return `
      <tr>
        <td><span class="pos-badge ${posClass}">${p.position}</span></td>
        <td class="td-name">${p.fullName}</td>
        <td>${s.gp ?? 0}</td>
        <td>${s.g  ?? 0}</td>
        <td>${s.a  ?? 0}</td>
        <td><strong>${s.pts ?? 0}</strong></td>
        <td class="${(s.pm ?? 0) >= 0 ? 'stats-pm-pos' : 'stats-pm-neg'}">${(s.pm ?? 0) >= 0 ? '+' : ''}${s.pm ?? 0}</td>
      </tr>`;
  }).join('');

  const goalieRows = goalies.map(p => {
    const s = p.seasonStats || {};
    const gaa = s.gp ? ((s.ga ?? 0) / s.gp * 3).toFixed(2) : '—';
    const svPct = s.sa ? ((s.sv ?? 0) / s.sa).toFixed(3).replace('0.', '.') : '—';
    return `
      <tr>
        <td><span class="pos-badge goal">G</span></td>
        <td class="td-name">${p.fullName}</td>
        <td>${s.gp ?? 0}</td>
        <td>${s.w  ?? 0}</td>
        <td>${s.ga ?? 0}</td>
        <td>${s.sa ?? 0}</td>
        <td>${svPct}</td>
        <td>${gaa}</td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <table class="standings-table roster-table stats-table">
      <thead>
        <tr class="roster-group-header"><td colspan="7">SKATERS</td></tr>
        <tr>
          <th>POS</th><th>Name</th>
          <th title="Games Played">GP</th>
          <th title="Goals">G</th>
          <th title="Assists">A</th>
          <th title="Points">PTS</th>
          <th title="Plus/Minus">+/-</th>
        </tr>
      </thead>
      <tbody>${skaterRows || '<tr><td colspan="7" class="text-3" style="padding:.75rem">No games played yet.</td></tr>'}</tbody>
    </table>
    ${goalies.length ? `
    <table class="standings-table roster-table stats-table" style="margin-top:1.5rem">
      <thead>
        <tr class="roster-group-header"><td colspan="8">GOALIES</td></tr>
        <tr>
          <th>POS</th><th>Name</th>
          <th title="Games Played">GP</th>
          <th title="Wins">W</th>
          <th title="Goals Against">GA</th>
          <th title="Shots Against">SA</th>
          <th title="Save Percentage">SV%</th>
          <th title="Goals Against Average">GAA</th>
        </tr>
      </thead>
      <tbody>${goalieRows}</tbody>
    </table>` : ''}
  `;
}

// ─── Release player ───────────────────────────────────────────────────────────

function releasePlayer(playerId, state) {
  const team = state.teams[state.playerTeamId];
  if (!team) return;

  team.rosterIds = (team.rosterIds || []).filter(id => id !== playerId);

  // Add to free agent pool if not already there
  if (!state.freeAgents.includes(playerId)) {
    state.freeAgents.push(playerId);
  }

  window.hockeyGM.saveGame?.();
  // Re-render via the standard mechanism
  window.hockeyGM.showScreen('roster');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function overallClass(ovr) {
  if (ovr >= 85) return 'ovr-elite';
  if (ovr >= 72) return 'ovr-good';
  if (ovr >= 58) return 'ovr-avg';
  if (ovr >= 45) return 'ovr-poor';
  return 'ovr-bust';
}

function canRenegotiate(player) {
  return (player.contractYears ?? 0) === 1;
}

function getDressedCounts(roster, dressedIds) {
  const dressed = roster.filter(player => dressedIds.has(player.id));
  return {
    total: dressed.length,
    forwards: dressed.filter(player => ['C', 'LW', 'RW'].includes(player.position)).length,
    defence: dressed.filter(player => ['LD', 'RD'].includes(player.position)).length,
    goalies: dressed.filter(player => player.position === 'G').length,
  };
}

function contractBadgeHtml(player) {
  const label = player.contractType === 'entry' ? 'ELC' : 'STD';
  const expiring = (player.contractYears ?? 0) === 1 ? '<span class="contract-pill contract-pill--expiring">LAST YEAR</span>' : '';
  return `
    <div class="contract-stack">
      <span class="contract-pill ${player.contractType === 'entry' ? 'contract-pill--entry' : ''}">${label} · ${player.contractYears ?? 0}y</span>
      ${expiring}
    </div>
  `;
}

function formatMoney(amount) {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  return `$${(amount / 1_000).toFixed(0)}K`;
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─── Event listener ───────────────────────────────────────────────────────────

document.addEventListener('render-screen', (e) => {
  if (e.detail?.screen !== 'roster') return;
  const state = e.detail.state;
  // Cache state for the stats renderer called by toggle
  window._renderRosterStats = () => renderStatsView(state);
  // Always default back to roster tab
  const statsEl = document.getElementById('roster-stats-container');
  const rosterEl = document.getElementById('roster-table-container');
  if (statsEl) statsEl.style.display = 'none';
  if (rosterEl) rosterEl.style.display = '';
  document.getElementById('roster-tab-roster')?.classList.add('active');
  document.getElementById('roster-tab-stats')?.classList.remove('active');
  renderRoster(state);
});
