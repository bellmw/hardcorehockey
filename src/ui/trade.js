/**
 * trade.js
 * Renders the Trade Desk screen.
 * Triggered by 'render-screen' CustomEvent with detail.screen === 'trade'.
 *
 * Containers:
 *   #trade-offers-list   — pending offers (accept / decline)
 *   #trade-history-list  — completed / declined trades
 */

// ─── Main render ──────────────────────────────────────────────────────────────

function renderTrade(state) {
  renderPendingOffers(state);
  renderTradeHistory(state);
}

// ─── Pending offers ───────────────────────────────────────────────────────────

function renderPendingOffers(state) {
  const container = document.getElementById('trade-offers-list');
  if (!container) return;

  const pending = (state.pendingTrades || []).filter(t => t.status === 'pending');

  if (pending.length === 0) {
    container.innerHTML = '<p class="trade-empty text-3">No pending offers. Sim more games to attract interest.</p>';
    return;
  }

  container.innerHTML = pending.map(trade => tradeCard(trade, state, true)).join('');

  // Bind buttons after DOM write
  container.querySelectorAll('.btn-accept').forEach(btn => {
    btn.addEventListener('click', () => {
      const tradeId = btn.dataset.tradeId;
      window.hockeyGM.acceptTrade(tradeId);
      window.hockeyGM.showScreen('trade');
    });
  });

  container.querySelectorAll('.btn-decline').forEach(btn => {
    btn.addEventListener('click', () => {
      const tradeId = btn.dataset.tradeId;
      window.hockeyGM.declineTrade(tradeId);
      window.hockeyGM.showScreen('trade');
    });
  });
}

// ─── Trade history ────────────────────────────────────────────────────────────

function renderTradeHistory(state) {
  const container = document.getElementById('trade-history-list');
  if (!container) return;

  // Show declined trades too, most recent first
  const history = [...(state.tradeHistory || [])];
  const declined = (state.pendingTrades || []).filter(t => t.status === 'declined');
  const all = [...history, ...declined].sort((a, b) => (b.week ?? 0) - (a.week ?? 0));

  if (all.length === 0) {
    container.innerHTML = '<p class="trade-empty text-3">No trade history yet.</p>';
    return;
  }

  container.innerHTML = all.map(trade => tradeCard(trade, state, false)).join('');
}

// ─── Trade card ───────────────────────────────────────────────────────────────

function tradeCard(trade, state, showActions) {
  const fromTeam = state.teams[trade.fromTeamId];
  const gmName   = fromTeam?.gmName   ?? 'Unknown GM';
  const teamName = fromTeam?.fullName ?? trade.fromTeamId;

  const offeredPlayers = (trade.offered || [])
    .map(id => state.allPlayers[id])
    .filter(Boolean);
  const wantedPlayers  = (trade.wanted  || [])
    .map(id => state.allPlayers[id])
    .filter(Boolean);

  const valueClass = {
    good:    'value-good',
    bad:     'value-bad',
    fair:    'value-fair',
    robbery: 'value-robbery',
  }[trade.valueOpinion] ?? 'value-fair';

  const valueLabel = {
    good:    '↑ Good deal for you',
    bad:     '↓ Bad deal for you',
    fair:    '= Fair deal',
    robbery: '⚠ Highway robbery',
  }[trade.valueOpinion] ?? '';

  const statusBadge = !showActions
    ? `<span class="trade-status-badge trade-status-badge--${trade.status}">${trade.status.toUpperCase()}</span>`
    : '';

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
        <span class="trade-week text-3">Wk ${trade.week ?? '—'}</span>
        ${statusBadge}
      </div>

      <p class="trade-offer-text">${trade.offerText ?? ''}</p>

      <div class="trade-players-layout">
        <div class="trade-side">
          <div class="trade-side-label">They offer</div>
          ${offeredPlayers.map(p => playerChip(p, 'offered')).join('') || '<span class="text-3">—</span>'}
          ${(trade.offeredPicks || []).map(pick => pickChip(pick)).join('')}
        </div>
        <div class="trade-arrow">⇄</div>
        <div class="trade-side">
          <div class="trade-side-label">They want</div>
          ${wantedPlayers.map(p => playerChip(p, 'wanted')).join('') || '<span class="text-3">—</span>'}
          ${(trade.wantedPicks || []).map(pick => pickChip(pick)).join('')}
        </div>
      </div>

      ${trade.gmQuote ? `<blockquote class="trade-gm-quote">${trade.gmQuote}</blockquote>` : ''}

      <div class="trade-value ${valueClass}">${valueLabel}</div>

      ${actionsHtml}
    </div>
  `;
}

// ─── Player chip ──────────────────────────────────────────────────────────────

function playerChip(player, side) {
  const ovrClass = overallClass(player.overall);
  const posClass = positionGroupClass(player.position);
  return `
    <div class="trade-player-chip trade-player-chip--${side}">
      <span class="pos-badge ${posClass}">${player.position}</span>
      <span class="trade-player-name">${player.fullName}</span>
      <span class="${ovrClass} trade-player-ovr">${player.overall}</span>
      <span class="trade-player-salary text-3">${formatMoney(player.salary ?? 0)}</span>
    </div>
  `;
}

function pickChip(pick) {
  return `<div class="trade-pick-chip text-2">${pick}</div>`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function overallClass(ovr) {
  if (ovr >= 85) return 'ovr-elite';
  if (ovr >= 72) return 'ovr-good';
  if (ovr >= 58) return 'ovr-avg';
  if (ovr >= 45) return 'ovr-poor';
  return 'ovr-bust';
}

function positionGroupClass(pos) {
  if (['C', 'LW', 'RW'].includes(pos)) return 'fwd';
  if (['LD', 'RD'].includes(pos))      return 'def';
  if (pos === 'G')                      return 'goal';
  return '';
}

function formatMoney(amount) {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  return `$${(amount / 1_000).toFixed(0)}K`;
}

// ─── Event listener ───────────────────────────────────────────────────────────

document.addEventListener('render-screen', (e) => {
  if (e.detail?.screen !== 'trade') return;
  renderTrade(e.detail.state);
});
