/**
 * roster.js
 * Renders the roster screen.
 * Triggered by 'render-screen' CustomEvent with detail.screen === 'roster'.
 */

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
  const total = state.cap ?? 40_000_000;
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

  if (roster.length === 0) {
    container.innerHTML = '<p class="text-3" style="padding:1rem">No players on roster.</p>';
    return;
  }

  const sections = GROUPS.map(group => {
    const players = roster
      .filter(p => group.positions.includes(p.position))
      .sort((a, b) => b.overall - a.overall);

    if (players.length === 0) return '';

    const rows = players.map(p => playerRow(p, group.posClass)).join('');

    return `
      <tr class="roster-group-header">
        <td colspan="8">${group.label.toUpperCase()}</td>
      </tr>
      ${rows}
    `;
  }).join('');

  container.innerHTML = `
    <table class="standings-table roster-table">
      <thead>
        <tr>
          <th>POS</th>
          <th>Name</th>
          <th>Age</th>
          <th>OVR</th>
          <th>Salary</th>
          <th>Yrs</th>
          <th class="roster-th-trait">Trait</th>
          <th></th>
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
}

function playerRow(player, posClass) {
  const ovrClass = overallClass(player.overall);
  const injFlag  = player.injured    ? ' <span title="Injured" style="color:var(--accent)">✦</span>' : '';
  const susFlag  = player.suspended  ? ' <span title="Suspended" style="color:var(--gold)">⚑</span>'  : '';

  return `
    <tr>
      <td><span class="pos-badge ${posClass}">${player.position}</span></td>
      <td class="td-name">${player.fullName}${injFlag}${susFlag}</td>
      <td>${player.age}</td>
      <td class="${ovrClass}">${player.overall}</td>
      <td>${formatMoney(player.salary ?? 0)}</td>
      <td>${player.contractYears ?? 0}y</td>
      <td><span class="trait-chip" title="${player.trait ?? ''}">${player.trait ?? '—'}</span></td>
      <td>
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
  const total = state.cap ?? 40_000_000;
  const used  = (team?.rosterIds || [])
    .map(id => state.allPlayers[id])
    .filter(Boolean)
    .reduce((sum, p) => sum + (p.salary || 0), 0);
  const remaining = total - used;

  const rows = fas.map(p => {
    const ovrClass = overallClass(p.overall);
    const posClass = p.position === 'G' ? 'goal' : ['LD','RD'].includes(p.position) ? 'def' : 'fwd';
    const canSign  = (p.salary || 0) <= remaining;
    return `
      <tr>
        <td><span class="pos-badge ${posClass}">${p.position}</span></td>
        <td class="td-name">${p.fullName}</td>
        <td>${p.age}</td>
        <td class="${ovrClass}">${p.overall}</td>
        <td>${formatMoney(p.salary ?? 0)}</td>
        <td>${p.contractYears ?? 1}y</td>
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
  renderRoster(e.detail.state);
});
