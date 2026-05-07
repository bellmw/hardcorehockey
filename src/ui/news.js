/**
 * news.js
 * Renders the full news feed screen with filter tabs.
 * Triggered by 'render-screen' CustomEvent with detail.screen === 'news'.
 *
 * Also pre-loads data/events.json once so event_static items can be resolved.
 */

// ─── Static event bank ────────────────────────────────────────────────────────

let EVENT_BANK = null;

async function loadEventBank() {
  if (EVENT_BANK) return;
  try {
    EVENT_BANK = await fetch('./data/events.json').then(r => r.json());
  } catch {
    EVENT_BANK = [];
  }
}

// Load eagerly so it's ready when the screen first opens
loadEventBank();

// ─── Filter state ─────────────────────────────────────────────────────────────

let activeFilter = 'all';

// Map filter button values to the news item types they match
const FILTER_MAP = {
  all:          null,   // null = show everything
  game:         ['game'],
  trade:        ['trade_offer', 'trade_complete'],
  event:        ['event', 'event_static'],
  commissioner: ['commissioner', 'retirement', 'league'],
};

// ─── Main render ──────────────────────────────────────────────────────────────

async function renderNews(state) {
  await loadEventBank();

  const container = document.getElementById('news-full-feed');
  if (!container) return;

  bindFilterButtons(state);

  const allowedTypes = FILTER_MAP[activeFilter] ?? null;
  const items = (state.news || []).filter(item =>
    allowedTypes === null || allowedTypes.includes(item.type)
  );

  if (items.length === 0) {
    container.innerHTML = '<p class="news-empty text-3" style="padding:1rem">No news in this category yet.</p>';
    return;
  }

  container.innerHTML = items.map(item => renderItem(item, state)).join('');
}

// ─── Filter buttons ───────────────────────────────────────────────────────────

function bindFilterButtons(state) {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    // Replace with fresh clone to avoid stacking listeners across re-renders
    const fresh = btn.cloneNode(true);
    btn.replaceWith(fresh);
    fresh.classList.toggle('active', fresh.dataset.filter === activeFilter);

    fresh.addEventListener('click', () => {
      activeFilter = fresh.dataset.filter;
      renderNews(state);
    });
  });
}

// ─── Item renderers ───────────────────────────────────────────────────────────

function renderItem(item, state) {
  switch (item.type) {
    case 'game':           return renderGame(item, state);
    case 'trade_offer':    return renderTradeOffer(item, state);
    case 'trade_complete': return renderTradeComplete(item, state);
    case 'event':          return renderEvent(item, state);
    case 'event_static':   return renderEventStatic(item, state);
    case 'commissioner':
    case 'league':         return renderCommissioner(item);
    case 'retirement':     return renderRetirement(item);
    default:               return renderGeneric(item);
  }
}

function renderGame(item, state) {
  const home = state.teams[item.homeTeamId];
  const away = state.teams[item.awayTeamId];
  const homeAbbrev = home?.abbrev ?? item.homeTeamId;
  const awayAbbrev = away?.abbrev ?? item.awayTeamId;
  const leagueBadge = item.leagueId
    ? `<span class="league-badge ${item.leagueId}">${item.leagueId.toUpperCase()}</span>`
    : '';
  const score = (item.homeGoals != null && item.awayGoals != null)
    ? `<span class="news-score">${homeAbbrev} ${item.homeGoals} – ${item.awayGoals} ${awayAbbrev}</span>`
    : '';
  const headline = item.headline ?? `${homeAbbrev} vs ${awayAbbrev}`;
  const report   = item.report
    ? `<div class="news-report">${item.report}</div>`
    : '';

  return newsWrap('game', `
    <div class="news-game-header">
      ${leagueBadge}
      ${score}
    </div>
    <div class="news-headline">${headline}</div>
    ${report}
    <div class="news-meta">Week ${item.week ?? '—'}</div>
  `);
}

function renderTradeOffer(item, state) {
  const trade = state.pendingTrades?.find(t => t.id === item.tradeId);
  const fromTeam = state.teams[item.fromTeamId];
  const teamName = fromTeam?.fullName ?? item.fromTeamId;
  const status = trade
    ? `<span class="trade-status trade-status-pending">PENDING — <button class="btn-inline-link" onclick="hockeyGM.showScreen('trade')">Review →</button></span>`
    : `<span class="trade-status trade-status-resolved">Resolved</span>`;

  return newsWrap('trade_offer', `
    <div class="news-headline">Trade offer from ${teamName}</div>
    <div class="news-meta-row">${status}</div>
    <div class="news-meta">Week ${item.week ?? '—'}</div>
  `);
}

function renderTradeComplete(item, state) {
  const trade = state.tradeHistory?.find(t => t.id === item.tradeId);
  if (!trade) return renderGeneric(item);

  const fromTeam = state.teams[trade.fromTeamId]?.fullName ?? trade.fromTeamId;
  const toTeam   = state.teams[trade.toTeamId]?.fullName   ?? trade.toTeamId;

  const playerNames = (arr) =>
    arr.map(id => state.allPlayers[id]?.fullName ?? id).join(', ');

  const gave     = playerNames(trade.wanted);
  const received = playerNames(trade.offered);

  return newsWrap('trade_complete', `
    <div class="news-headline">Trade completed</div>
    <div class="news-report">
      <strong>${toTeam}</strong> traded ${gave} to <strong>${fromTeam}</strong><br>
      Received: ${received}
    </div>
    <div class="news-meta">Week ${item.week ?? '—'}</div>
  `);
}

function renderEvent(item, state) {
  const team = state.teams[item.teamId];
  const teamName = team?.fullName ?? '';
  return newsWrap('event', `
    <div class="news-headline news-headline--event">${item.text ?? ''}</div>
    ${teamName ? `<div class="news-meta-row text-3">${teamName}</div>` : ''}
    <div class="news-meta">Week ${item.week ?? '—'}</div>
  `);
}

function renderEventStatic(item, state) {
  const team   = state.teams[item.teamId];
  const player = item.playerId ? state.allPlayers[item.playerId] : null;

  // Resolve template tokens from events.json
  let text = '—';
  if (EVENT_BANK && EVENT_BANK.length > 0) {
    const pool = EVENT_BANK.filter(e => e.tags?.includes('player') || !item.playerId);
    const evt  = pool[Math.abs(hashStr(item.id ?? '')) % pool.length];
    if (evt) {
      text = evt.text
        .replace('{player}',          player?.fullName   ?? 'A player')
        .replace('{arena}',           team?.arena        ?? 'the arena')
        .replace('{opponent_player}', 'an opponent');
    }
  }

  return newsWrap('event', `
    <div class="news-headline news-headline--event">${text}</div>
    <div class="news-meta">Week ${item.week ?? '—'}</div>
  `);
}

function renderCommissioner(item) {
  return newsWrap('commissioner', `
    <div class="news-commissioner-label">⚙ League Office</div>
    <div class="news-headline">${item.text ?? ''}</div>
    <div class="news-meta">Week ${item.week ?? '—'}</div>
  `);
}

function renderRetirement(item) {
  return newsWrap('retirement', `
    <div class="news-commissioner-label">📋 Retirement</div>
    <div class="news-headline">${item.text ?? ''}</div>
    <div class="news-meta">Week ${item.week ?? '—'}</div>
  `);
}

function renderGeneric(item) {
  const text = item.headline ?? item.text ?? JSON.stringify(item);
  return newsWrap(item.type ?? 'generic', `
    <div class="news-headline">${text}</div>
    <div class="news-meta">Week ${item.week ?? '—'}</div>
  `);
}

function newsWrap(type, inner) {
  return `<div class="news-item news-type-${type}">${inner}</div>`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Simple deterministic hash so the same event_static item always picks the same text. */
function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h;
}

// ─── Event listener ───────────────────────────────────────────────────────────

document.addEventListener('render-screen', (e) => {
  if (e.detail?.screen !== 'news') return;
  activeFilter = 'all'; // reset filter on each screen open
  renderNews(e.detail.state);
});
