/**
 * trade.js
 * Renders the Trade Desk screen.
 * Triggered by 'render-screen' CustomEvent with detail.screen === 'trade'.
 *
 * Containers:
 *   #trade-offers-list   - pending offers + assistant/proposal builder
 *   #trade-history-list  - completed/declined offers + league browser
 */

const uiState = {
  needResults: [],
  expiringResults: [],
  browserTeamFilter: 'all',
  browserSearch: '',
  browserView: 'roster',
  selectedTargetTeamId: '',
  selectedOfferPlayerIds: [],
  selectedWantPlayerIds: [],
  selectedOfferPickIds: [],
  selectedWantPickIds: [],
};

// --- Main render --------------------------------------------------------------

function renderTrade(state) {
  renderTradeMarketStatus(state);
  renderPendingOffers(state);
  renderTradeHistory(state);
  renderLeagueBrowserPanel(state);
}

function renderTradeMarketStatus(state) {
  const el = document.getElementById('trade-market-status');
  if (!el) return;

  const weeksLeft = Math.max(0, (state.tradeDeadlineWeek ?? 0) - (state.week ?? 0));
  if (state.tradeMarketClosed) {
    el.className = 'trade-market-status trade-market-status--closed';
    el.textContent = 'Market closed until next season';
    return;
  }

  if (weeksLeft <= 1) {
    el.className = 'trade-market-status trade-market-status--hot';
    el.textContent = `Deadline week: ${state.tradeDeadlineWeek}`;
    return;
  }

  if (weeksLeft <= 5) {
    el.className = 'trade-market-status trade-market-status--hot';
    el.textContent = `Deadline watch - ${weeksLeft} weeks left`;
    return;
  }

  el.className = 'trade-market-status';
  el.textContent = `Open - ${weeksLeft} weeks to deadline`;
}

// --- Pending offers -----------------------------------------------------------

function renderPendingOffers(state) {
  const container = document.getElementById('trade-offers-list');
  if (!container) return;

  const pending = (state.pendingTrades || []).filter(trade => trade.status === 'pending');

  const emptyMessage = state.tradeMarketClosed
    ? '<p class="trade-empty text-3">Deadline passed. No new offers until next season.</p>'
    : '<p class="trade-empty text-3">No pending offers. Shop a player on the block or sim more games to attract interest.</p>';

  container.innerHTML = `
    ${renderAssistantPanel(state)}
    <div class="trade-pending-list">
      ${pending.length ? pending.map(trade => tradeCard(trade, state, true)).join('') : emptyMessage}
    </div>
  `;

  bindAssistantActions(state);

  container.querySelectorAll('.btn-accept').forEach(button => {
    button.addEventListener('click', () => {
      window.hockeyGM.acceptTrade(button.dataset.tradeId);
      window.hockeyGM.showScreen('trade');
    });
  });

  container.querySelectorAll('.btn-decline').forEach(button => {
    button.addEventListener('click', () => {
      window.hockeyGM.declineTrade(button.dataset.tradeId);
      window.hockeyGM.showScreen('trade');
    });
  });
}

function renderAssistantPanel(state) {
  const myTeam = state.teams[state.playerTeamId];
  if (!myTeam) return '';

  const myPlayers = (myTeam.rosterIds || [])
    .map(id => state.allPlayers[id])
    .filter(Boolean)
    .sort((a, b) => b.overall - a.overall);

  const suggestedNeed = detectSuggestedNeed(myPlayers);

  const targetTeams = Object.values(state.teams)
    .filter(team => team.id !== myTeam.id && team.leagueId === myTeam.leagueId)
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  const selectedTeamId = targetTeams.some(team => team.id === uiState.selectedTargetTeamId)
    ? uiState.selectedTargetTeamId
    : (targetTeams[0]?.id || '');
  uiState.selectedTargetTeamId = selectedTeamId;

  const targetTeam = state.teams[selectedTeamId];
  const targetPlayers = (targetTeam?.rosterIds || [])
    .map(id => state.allPlayers[id])
    .filter(Boolean)
    .sort((a, b) => b.overall - a.overall);

  const myPicks = (myTeam.tradablePicks || []).slice().sort((a, b) => (a.year - b.year) || (a.round - b.round));
  const targetPicks = (targetTeam?.tradablePicks || []).slice().sort((a, b) => (a.year - b.year) || (a.round - b.round));

  syncProposalSelections(myPlayers, targetPlayers, myPicks, targetPicks);

  const targetTeamOptions = targetTeams
    .map(team => `<option value="${team.id}" ${team.id === selectedTeamId ? 'selected' : ''}>${team.fullName}</option>`)
    .join('');

  return `
    <div class="trade-assistant-panel">
      <h3 class="trade-assistant-title">GM assistant</h3>
      <p class="text-3">Roster read: you should be looking for <strong>${suggestedNeed.label}</strong>.</p>

      <div class="trade-assistant-controls">
        <label>
          Need
          <select id="trade-need-select">
            <option value="any">Best player available</option>
            <option value="C">Center</option>
            <option value="LW">Left wing</option>
            <option value="RW">Right wing</option>
            <option value="fwd">Any forward</option>
            <option value="LD">Left defence</option>
            <option value="RD">Right defence</option>
            <option value="def">Any defence</option>
            <option value="G">Goalie</option>
          </select>
        </label>
        <button id="btn-find-need">Find Targets</button>
        <button id="btn-find-suggested" data-need="${suggestedNeed.need}">Search ${suggestedNeed.label}</button>
        <button id="btn-load-expiring">Expiring Deals</button>
      </div>

      ${renderNeedResults()}
      ${renderExpiringResults()}

      <div class="trade-proposal-builder">
        <h4>Propose trade (multi-asset)</h4>

        <div class="trade-proposal-grid trade-proposal-grid--top">
          <label>
            Target team
            <select id="proposal-team-select">${targetTeamOptions}</select>
          </label>
          <div class="trade-proposal-hint text-3">Build 2-for-1, 3-for-2, and pick packages from these checklists.</div>
        </div>

        <div class="trade-proposal-grid trade-proposal-grid--assets">
          <div class="trade-asset-box">
            <h5>You offer: players</h5>
            ${renderAssetChecks(myPlayers, uiState.selectedOfferPlayerIds, 'proposal-offer-player', player => `${player.fullName} (${player.position} ${player.overall})`, player => player.id)}
          </div>
          <div class="trade-asset-box">
            <h5>You offer: picks</h5>
            ${renderAssetChecks(myPicks, uiState.selectedOfferPickIds, 'proposal-offer-pick', pick => pick.label || `Y${pick.year} R${pick.round}`, pick => pick.id)}
          </div>
          <div class="trade-asset-box">
            <h5>You want: players</h5>
            ${renderAssetChecks(targetPlayers, uiState.selectedWantPlayerIds, 'proposal-want-player', player => `${player.fullName} (${player.position} ${player.overall})`, player => player.id)}
          </div>
          <div class="trade-asset-box">
            <h5>You want: picks</h5>
            ${renderAssetChecks(targetPicks, uiState.selectedWantPickIds, 'proposal-want-pick', pick => pick.label || `Y${pick.year} R${pick.round}`, pick => pick.id)}
          </div>
        </div>

        <button id="btn-send-proposal">Send Proposal</button>
      </div>
    </div>
  `;
}

function renderAssetChecks(items, selectedIds, inputClass, labelFn, idFn) {
  if (!items.length) return '<p class="text-3">No assets available.</p>';

  return `
    <div class="trade-asset-list">
      ${items.slice(0, 32).map(item => {
        const id = idFn(item);
        return `
          <label class="trade-asset-item">
            <input type="checkbox" class="${inputClass}" value="${id}" ${selectedIds.includes(id) ? 'checked' : ''}>
            <span>${labelFn(item)}</span>
          </label>
        `;
      }).join('')}
    </div>
  `;
}

function renderNeedResults() {
  if (!uiState.needResults.length) {
    return '<p class="text-3 trade-assistant-empty">Need search is empty. Pick a role and click Find Targets.</p>';
  }

  const items = uiState.needResults.map(target => `
    <div class="trade-assistant-result">
      <span class="pos-badge ${positionGroupClass(target.player.position)}">${target.player.position}</span>
      <strong>${target.player.fullName}</strong>
      <span class="text-3">${target.team.abbrev} - OVR ${target.player.overall} - ${formatMoney(target.player.salary || 0)} - ${target.player.contractYears || 0}y - Fit ${Math.round(target.fitScore || 0)} - Cap ${formatCapImpact(target.capImpact)}</span>
      <button class="btn-request-target" data-player-id="${target.player.id}" data-team-id="${target.team.id}">Ask For Offer</button>
    </div>
  `).join('');

  return `<div class="trade-assistant-results">${items}</div>`;
}

function renderExpiringResults() {
  if (!uiState.expiringResults.length) {
    return '<p class="text-3 trade-assistant-empty">No expiring targets loaded yet.</p>';
  }

  const rows = uiState.expiringResults.map(target => `
    <tr>
      <td><span class="pos-badge ${positionGroupClass(target.player.position)}">${target.player.position}</span></td>
      <td class="td-name">${target.player.fullName}</td>
      <td>${target.team.abbrev}</td>
      <td>${target.player.overall}</td>
      <td>${formatMoney(target.player.salary || 0)}</td>
      <td>${formatCapImpact(target.capImpact)}</td>
      <td>
        <button class="btn-request-target" data-player-id="${target.player.id}" data-team-id="${target.team.id}">Ask</button>
      </td>
    </tr>
  `).join('');

  return `
    <div class="trade-expiring-table-wrap">
      <table class="standings-table roster-table trade-expiring-table">
        <thead>
          <tr><th>POS</th><th>Player</th><th>Team</th><th>OVR</th><th>Cap Hit</th><th>Cap Room After</th><th></th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function bindAssistantActions(state) {
  const needBtn = document.getElementById('btn-find-need');
  if (needBtn) {
    needBtn.addEventListener('click', () => {
      const need = document.getElementById('trade-need-select')?.value || 'any';
      uiState.needResults = window.hockeyGM.findTradeTargets(need) || [];
      window.hockeyGM.showScreen('trade');
    });
  }

  const suggestedBtn = document.getElementById('btn-find-suggested');
  if (suggestedBtn) {
    suggestedBtn.addEventListener('click', () => {
      const need = suggestedBtn.dataset.need || 'any';
      uiState.needResults = window.hockeyGM.findTradeTargets(need) || [];
      const selector = document.getElementById('trade-need-select');
      if (selector) selector.value = need;
      window.hockeyGM.showScreen('trade');
    });
  }

  const expiringBtn = document.getElementById('btn-load-expiring');
  if (expiringBtn) {
    expiringBtn.addEventListener('click', () => {
      uiState.expiringResults = window.hockeyGM.findExpiringContractTargets(24) || [];
      window.hockeyGM.showScreen('trade');
    });
  }

  document.querySelectorAll('.btn-request-target').forEach(button => {
    button.addEventListener('click', () => {
      const playerId = button.dataset.playerId;
      const teamId = button.dataset.teamId;
      uiState.selectedTargetTeamId = teamId || uiState.selectedTargetTeamId;
      if (playerId && !uiState.selectedWantPlayerIds.includes(playerId)) {
        uiState.selectedWantPlayerIds.push(playerId);
      }
      const result = window.hockeyGM.requestTargetedOffer(playerId, teamId);
      if (result) window.hockeyGM.showScreen('trade');
    });
  });

  const teamSelect = document.getElementById('proposal-team-select');
  if (teamSelect) {
    teamSelect.value = uiState.selectedTargetTeamId || teamSelect.value;
    teamSelect.addEventListener('change', () => {
      uiState.selectedTargetTeamId = teamSelect.value;
      clearWantedSelections();
      window.hockeyGM.showScreen('trade');
    });
  }

  bindAssetCheckboxes('proposal-offer-player', selected => { uiState.selectedOfferPlayerIds = selected; });
  bindAssetCheckboxes('proposal-want-player', selected => { uiState.selectedWantPlayerIds = selected; });
  bindAssetCheckboxes('proposal-offer-pick', selected => { uiState.selectedOfferPickIds = selected; });
  bindAssetCheckboxes('proposal-want-pick', selected => { uiState.selectedWantPickIds = selected; });

  const sendProposalBtn = document.getElementById('btn-send-proposal');
  if (sendProposalBtn) {
    sendProposalBtn.addEventListener('click', () => {
      const targetTeamId = document.getElementById('proposal-team-select')?.value;
      if (!targetTeamId) {
        alert('Please choose a target team.');
        return;
      }
      if ((uiState.selectedOfferPlayerIds.length + uiState.selectedOfferPickIds.length) === 0) {
        alert('Add at least one offered asset.');
        return;
      }
      if ((uiState.selectedWantPlayerIds.length + uiState.selectedWantPickIds.length) === 0) {
        alert('Add at least one wanted asset.');
        return;
      }

      const outcome = window.hockeyGM.proposeTradeFromDesk(
        targetTeamId,
        uiState.selectedOfferPlayerIds,
        uiState.selectedWantPlayerIds,
        uiState.selectedOfferPickIds,
        uiState.selectedWantPickIds
      );

      if (outcome?.result === 'counter') alert('Counter offer received. Check Pending Offers.');
      if (outcome?.result === 'declined') alert('Proposal declined.');
      if (outcome?.result === 'invalid') alert('Invalid proposal assets. Refreshing desk.');

      window.hockeyGM.showScreen('trade');
    });
  }
}

// --- Trade history + league browser ------------------------------------------

function renderTradeHistory(state) {
  const container = document.getElementById('trade-history-list');
  if (!container) return;

  const history = [...(state.tradeHistory || [])];
  const declined = (state.pendingTrades || []).filter(trade => ['declined', 'expired'].includes(trade.status));
  const all = [...history, ...declined].sort((a, b) => (b.week ?? 0) - (a.week ?? 0));

  const historyHtml = all.length
    ? all.map(trade => tradeCard(trade, state, false)).join('')
    : '<p class="trade-empty text-3">No trade history yet.</p>';

  container.innerHTML = historyHtml;
}

function renderLeagueBrowserPanel(state) {
  const container = document.getElementById('trade-league-browser-root');
  if (!container) return;
  container.innerHTML = renderLeagueBrowser(state);
  bindLeagueBrowserActions(state);
}

function renderLeagueBrowser(state) {
  const team = state.teams[state.playerTeamId];
  if (!team) return '';

  const teams = (state.leagues?.[team.leagueId]?.teamIds || [])
    .map(id => state.teams[id])
    .filter(Boolean)
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  const allPlayers = teams.flatMap(teamItem => (teamItem.rosterIds || []).map(id => ({
    player: state.allPlayers[id],
    team: teamItem,
  }))).filter(row => row.player);

  const filtered = allPlayers.filter(row => {
    const teamPass = uiState.browserTeamFilter === 'all' || row.team.id === uiState.browserTeamFilter;
    const search = uiState.browserSearch.trim().toLowerCase();
    const searchPass = !search || row.player.fullName.toLowerCase().includes(search);
    return teamPass && searchPass;
  });

  const rows = uiState.browserView === 'stats'
    ? renderLeagueStatsRows(filtered)
    : renderLeagueRosterRows(filtered);

  const teamOptions = teams.map(teamItem => `<option value="${teamItem.id}" ${uiState.browserTeamFilter === teamItem.id ? 'selected' : ''}>${teamItem.fullName}</option>`).join('');

  return `
    <section class="trade-league-browser">
      <div class="trade-browser-controls">
        <label>
          Team
          <select id="league-browser-team">
            <option value="all" ${uiState.browserTeamFilter === 'all' ? 'selected' : ''}>All teams</option>
            ${teamOptions}
          </select>
        </label>
        <label>
          Search
          <input id="league-browser-search" type="text" value="${escapeAttr(uiState.browserSearch)}" placeholder="Player name">
        </label>
        <div class="trade-browser-view-toggle">
          <button id="league-browser-roster" class="${uiState.browserView === 'roster' ? 'is-active' : ''}">Roster view</button>
          <button id="league-browser-stats" class="${uiState.browserView === 'stats' ? 'is-active' : ''}">Stats view</button>
        </div>
      </div>
      <div class="trade-browser-table-wrap">
        <table class="standings-table roster-table">
          <thead>${uiState.browserView === 'stats' ? statsHead() : rosterHead()}</thead>
          <tbody>${rows || '<tr><td colspan="10" class="text-3">No players match this filter.</td></tr>'}</tbody>
        </table>
      </div>
    </section>
  `;
}

function rosterHead() {
  return '<tr><th>POS</th><th>Name</th><th>Team</th><th>Age</th><th>OVR</th><th>Salary</th><th>Contract</th><th>Trait</th><th></th></tr>';
}

function statsHead() {
  return '<tr><th>POS</th><th>Name</th><th>Team</th><th>GP</th><th>G</th><th>A</th><th>PTS</th><th>SV%</th><th>GAA</th><th></th></tr>';
}

function renderLeagueRosterRows(rows) {
  return rows
    .sort((a, b) => b.player.overall - a.player.overall)
    .map(({ player, team }) => `
      <tr>
        <td><span class="pos-badge ${positionGroupClass(player.position)}">${player.position}</span></td>
        <td class="td-name">${player.fullName}</td>
        <td>${team.abbrev}</td>
        <td>${player.age}</td>
        <td>${player.overall}</td>
        <td>${formatMoney(player.salary || 0)}</td>
        <td>${player.contractYears || 0}y</td>
        <td><span class="trait-chip">${player.trait || '—'}</span></td>
        <td><button class="btn-add-to-proposal" data-player-id="${player.id}" data-team-id="${team.id}">Add To Proposal</button></td>
      </tr>
    `).join('');
}

function renderLeagueStatsRows(rows) {
  return rows
    .sort((a, b) => {
      const aPts = a.player.seasonStats?.pts || 0;
      const bPts = b.player.seasonStats?.pts || 0;
      return bPts - aPts;
    })
    .map(({ player, team }) => {
      const s = player.seasonStats || {};
      const svPct = s.sa ? ((s.sv || 0) / s.sa).toFixed(3).replace('0.', '.') : '-';
      const gaa = s.gp ? (((s.ga || 0) / s.gp) * 3).toFixed(2) : '-';

      return `
        <tr>
          <td><span class="pos-badge ${positionGroupClass(player.position)}">${player.position}</span></td>
          <td class="td-name">${player.fullName}</td>
          <td>${team.abbrev}</td>
          <td>${s.gp || 0}</td>
          <td>${s.g || 0}</td>
          <td>${s.a || 0}</td>
          <td>${s.pts || 0}</td>
          <td>${player.position === 'G' ? svPct : '-'}</td>
          <td>${player.position === 'G' ? gaa : '-'}</td>
          <td><button class="btn-add-to-proposal" data-player-id="${player.id}" data-team-id="${team.id}">Add To Proposal</button></td>
        </tr>
      `;
    })
    .join('');
}

function bindLeagueBrowserActions() {
  const teamFilter = document.getElementById('league-browser-team');
  if (teamFilter) {
    teamFilter.addEventListener('change', () => {
      uiState.browserTeamFilter = teamFilter.value;
      window.hockeyGM.showScreen('trade');
    });
  }

  const searchInput = document.getElementById('league-browser-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      uiState.browserSearch = searchInput.value;
      window.hockeyGM.showScreen('trade');
    });
  }

  const rosterBtn = document.getElementById('league-browser-roster');
  if (rosterBtn) {
    rosterBtn.addEventListener('click', () => {
      uiState.browserView = 'roster';
      window.hockeyGM.showScreen('trade');
    });
  }

  const statsBtn = document.getElementById('league-browser-stats');
  if (statsBtn) {
    statsBtn.addEventListener('click', () => {
      uiState.browserView = 'stats';
      window.hockeyGM.showScreen('trade');
    });
  }

  document.querySelectorAll('.btn-add-to-proposal').forEach(button => {
    button.addEventListener('click', () => {
      const playerId = button.dataset.playerId;
      const teamId = button.dataset.teamId;
      uiState.selectedTargetTeamId = teamId;
      if (playerId && !uiState.selectedWantPlayerIds.includes(playerId)) {
        uiState.selectedWantPlayerIds.push(playerId);
      }
      alert('Target added to proposal builder in Pending Offers panel.');
      window.hockeyGM.showScreen('trade');
    });
  });
}

// --- Trade cards --------------------------------------------------------------

function tradeCard(trade, state, showActions) {
  const fromTeam = state.teams[trade.fromTeamId];
  const gmName = fromTeam?.gmName ?? 'Unknown GM';
  const teamName = fromTeam?.fullName ?? trade.fromTeamId;
  const leagueTag = fromTeam?.leagueId?.toUpperCase() ?? '-';

  const offeredPlayers = (trade.offered || []).map(id => state.allPlayers[id]).filter(Boolean);
  const wantedPlayers = (trade.wanted || []).map(id => state.allPlayers[id]).filter(Boolean);

  const valueClass = {
    good: 'value-good',
    bad: 'value-bad',
    fair: 'value-fair',
    robbery: 'value-robbery',
  }[trade.valueOpinion] ?? 'value-fair';

  const valueLabel = {
    good: 'Good deal for you',
    bad: 'Bad deal for you',
    fair: 'Fair deal',
    robbery: 'Highway robbery',
  }[trade.valueOpinion] ?? '';

  const statusBadge = !showActions
    ? `<span class="trade-status-badge trade-status-badge--${trade.status}">${trade.status.toUpperCase()}</span>`
    : '';

  const tags = (trade.tags || []).map(tag => `<span class="trade-tag">${tag}</span>`).join('');
  const salarySwing = salarySummary(trade);

  const actionsHtml = showActions ? `
    <div class="trade-actions">
      <button class="btn-accept" data-trade-id="${trade.id}">Accept</button>
      <button class="btn-decline" data-trade-id="${trade.id}">Decline</button>
    </div>
  ` : '';

  return `
    <div class="trade-card">
      <div class="trade-card-header">
        <span class="trade-gm-name">${gmName}</span>
        <span class="trade-team-name text-2">${teamName}</span>
        <span class="league-badge ${fromTeam?.leagueId ?? ''}">${leagueTag}</span>
        <span class="trade-week text-3">Wk ${trade.week ?? '-'}</span>
        ${statusBadge}
      </div>

      ${tags ? `<div class="trade-tag-row">${tags}</div>` : ''}

      <p class="trade-offer-text">${trade.offerText ?? ''}</p>

      <div class="trade-players-layout">
        <div class="trade-side">
          <div class="trade-side-label">They offer</div>
          ${offeredPlayers.map(player => playerChip(player, 'offered')).join('') || '<span class="text-3">-</span>'}
          ${(trade.offeredPicks || []).map(pick => pickChip(pick)).join('')}
        </div>
        <div class="trade-arrow">⇄</div>
        <div class="trade-side">
          <div class="trade-side-label">They want</div>
          ${wantedPlayers.map(player => playerChip(player, 'wanted')).join('') || '<span class="text-3">-</span>'}
          ${(trade.wantedPicks || []).map(pick => pickChip(pick)).join('')}
        </div>
      </div>

      ${trade.gmQuote ? `<blockquote class="trade-gm-quote">${trade.gmQuote}</blockquote>` : ''}

      <div class="trade-meta-row text-3">${salarySwing}</div>
      <div class="trade-value ${valueClass}">${valueLabel}</div>

      ${actionsHtml}
    </div>
  `;
}

function playerChip(player, side) {
  const ovrClass = overallClass(player.overall);
  const posClass = positionGroupClass(player.position);
  const contractLabel = player.contractType === 'entry' ? 'ELC' : `${player.contractYears ?? 0}y`;

  return `
    <div class="trade-player-chip trade-player-chip--${side}">
      <span class="pos-badge ${posClass}">${player.position}</span>
      <span class="trade-player-name">${player.fullName}</span>
      <span class="${ovrClass} trade-player-ovr">${player.overall}</span>
      <span class="trade-player-salary text-3">${formatMoney(player.salary ?? 0)}</span>
      <span class="trade-player-term text-3">${contractLabel}</span>
    </div>
  `;
}

function pickChip(pick) {
  return `<div class="trade-pick-chip text-2">${escapeHtml(pick)}</div>`;
}

// --- Helpers -----------------------------------------------------------------

function detectSuggestedNeed(players) {
  if (!players.length) return { need: 'any', label: 'depth' };

  const groups = [
    { need: 'fwd', label: 'forward help', positions: ['C', 'LW', 'RW'] },
    { need: 'def', label: 'defence help', positions: ['LD', 'RD'] },
    { need: 'G', label: 'goaltending help', positions: ['G'] },
  ];

  const ranked = groups.map(group => {
    const bucket = players.filter(player => group.positions.includes(player.position));
    const avg = bucket.length ? bucket.reduce((sum, player) => sum + (player.overall || 0), 0) / bucket.length : 0;
    return { ...group, avg };
  }).sort((a, b) => a.avg - b.avg);

  return { need: ranked[0].need, label: ranked[0].label };
}

function syncProposalSelections(myPlayers, targetPlayers, myPicks, targetPicks) {
  const myIds = new Set(myPlayers.map(player => player.id));
  const targetIds = new Set(targetPlayers.map(player => player.id));
  const myPickIds = new Set(myPicks.map(pick => pick.id));
  const targetPickIds = new Set(targetPicks.map(pick => pick.id));

  uiState.selectedOfferPlayerIds = uiState.selectedOfferPlayerIds.filter(id => myIds.has(id));
  uiState.selectedWantPlayerIds = uiState.selectedWantPlayerIds.filter(id => targetIds.has(id));
  uiState.selectedOfferPickIds = uiState.selectedOfferPickIds.filter(id => myPickIds.has(id));
  uiState.selectedWantPickIds = uiState.selectedWantPickIds.filter(id => targetPickIds.has(id));
}

function clearWantedSelections() {
  uiState.selectedWantPlayerIds = [];
  uiState.selectedWantPickIds = [];
}

function bindAssetCheckboxes(className, assign) {
  const nodes = Array.from(document.querySelectorAll(`.${className}`));
  nodes.forEach(node => {
    node.addEventListener('change', () => {
      const selected = nodes.filter(item => item.checked).map(item => item.value);
      assign(selected);
    });
  });
}

function overallClass(ovr) {
  if (ovr >= 85) return 'ovr-elite';
  if (ovr >= 72) return 'ovr-good';
  if (ovr >= 58) return 'ovr-avg';
  if (ovr >= 45) return 'ovr-poor';
  return 'ovr-bust';
}

function positionGroupClass(pos) {
  if (['C', 'LW', 'RW'].includes(pos)) return 'fwd';
  if (['LD', 'RD'].includes(pos)) return 'def';
  if (pos === 'G') return 'goal';
  return '';
}

function formatMoney(amount) {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  return `$${(amount / 1_000).toFixed(0)}K`;
}

function formatCapImpact(value) {
  const safe = Number(value || 0);
  const sign = safe >= 0 ? '+' : '-';
  return `${sign}${formatMoney(Math.abs(safe))}`;
}

function salarySummary(trade) {
  const offered = formatMoney(trade.offeredSalary ?? 0);
  const wanted = formatMoney(trade.wantedSalary ?? 0);
  return `Cap swing: incoming ${offered} - outgoing ${wanted}`;
}

function escapeAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtml(value) {
  return escapeAttr(value);
}

// --- Event listener -----------------------------------------------------------

document.addEventListener('render-screen', (event) => {
  if (event.detail?.screen !== 'trade') return;
  renderTrade(event.detail.state);
});
