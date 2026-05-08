/**
 * draft.js
 * Renders the Draft Day screen.
 * Triggered by 'render-screen' CustomEvent with detail.screen === 'draft'.
 *
 * States handled:
 *   phase !== 'draft' && draftClass empty  → pre-draft lobby
 *   phase === 'draft', player's turn        → board + pick action
 *   phase === 'draft', CPU's turn           → board + auto-advancing
 *   phase !== 'draft' && draftHistory exist → post-draft recap
 */

// ─── Module state ─────────────────────────────────────────────────────────────

let selectedProspectId = null;
let boardFilter        = 'all';   // 'all' | '1' | '2' | '3'  (round)
let boardSort          = 'score'; // 'score' | 'overall' | 'potential' | 'position'

// ─── Main render ──────────────────────────────────────────────────────────────

function renderDraft(state) {
  updateRoundIndicator(state);

  const phase = state.phase;
  const hasClass = state.draftClass?.length > 0;

  // Pre-season draft (new game flow)
  if (phase === 'preseason_draft') {
    if (hasClass) {
      renderActiveDraft(state);
      // Auto-advance CPU picks
      const onClock = currentPickTeam(state);
      if (onClock && onClock !== state.playerTeamId) {
        setTimeout(() => window.hockeyGM.advanceCPUPicks(), 400);
      }
    } else {
      renderPreseasonComplete(state);
    }
    return;
  }

  if (phase !== 'draft' && !hasClass) {
    renderPreDraft(state);
    return;
  }

  if (phase === 'draft') {
    renderActiveDraft(state);
    // Auto-advance CPU picks if it's not the player's turn
    const onClock = currentPickTeam(state);
    if (onClock && onClock !== state.playerTeamId) {
      setTimeout(() => {
        window.hockeyGM.advanceCPUPicks();
      }, 400);
    }
    return;
  }

  // Draft complete — show recap
  renderPostDraft(state);
}

// ─── Pre-season draft complete ────────────────────────────────────────────────

function renderPreseasonComplete(state) {
  const board  = el('draft-board');
  const detail = el('draft-pick-detail');

  const myPicks = (state.draftHistory || []).filter(pick => pick.teamId === state.playerTeamId);
  const playerTeam = state.teams[state.playerTeamId];

  // ── Player's picks table ──────────────────────────────────────────────────
  const rows = myPicks.map(pick => {
    const p = state.allPlayers[pick.prospectId];
    if (!p) return '';
    const posClass = positionGroupClass(p.position);
    const ovrClass = overallClass(p.overall);
    return `
      <tr>
        <td class="text-3">Rd ${pick.round} #${pick.pick}</td>
        <td><span class="pos-badge ${posClass}">${p.position}</span></td>
        <td class="td-name">${p.fullName}</td>
        <td class="${ovrClass}">${p.overall}</td>
        <td class="${overallClass(p.potential)}">${p.potential}</td>
        <td class="text-3">$700K · 3yr ELC</td>
      </tr>`;
  }).join('');

  // ── Team OVR delta table (all teams) ────────────────────────────────────
  const preDraft = state.preDraftOvr || {};
  const allTeams = Object.values(state.teams).sort((a, b) => {
    // Player's team first, then by current OVR desc
    if (a.id === state.playerTeamId) return -1;
    if (b.id === state.playerTeamId) return 1;
    return 0;
  });

  const LINEUP_SIZE = 20; // matches ROSTER_TEMPLATE length — only top-20 make the lineup

  const deltaRows = allTeams.map(team => {
    const allRoster = (team.rosterIds || []).map(id => state.allPlayers[id]).filter(Boolean);
    // Use only the top LINEUP_SIZE players by OVR — rookies below the cut don't move the needle
    const lineup   = allRoster.slice().sort((a, b) => b.overall - a.overall).slice(0, LINEUP_SIZE);
    const nowOvr   = lineup.length ? Math.round(lineup.reduce((s, p) => s + p.overall, 0) / lineup.length) : 0;
    const wasOvr   = preDraft[team.id] ?? nowOvr;
    const delta    = nowOvr - wasOvr;
    const deltaStr = delta > 0 ? `<span class="draft-delta-up">+${delta}</span>`
                   : delta < 0 ? `<span class="draft-delta-down">${delta}</span>`
                   : '<span class="text-3">—</span>';
    const isMe = team.id === state.playerTeamId;
    const lgClass = team.leagueId ?? '';
    return `<tr class="${isMe ? 'draft-delta-myrow' : ''}">
      <td><span class="league-badge ${lgClass}">${lgClass.toUpperCase()}</span></td>
      <td class="td-name">${team.fullName}${isMe ? ' <span class="text-3">(you)</span>' : ''}</td>
      <td class="${overallClass(wasOvr)}">${wasOvr}</td>
      <td class="${overallClass(nowOvr)}">${nowOvr}</td>
      <td>${deltaStr}</td>
    </tr>`;
  }).join('');

  if (board) board.innerHTML = `
    <div class="draft-lobby">
      <h2 class="draft-lobby-title">Pre-Season Draft Complete</h2>
      <p class="draft-lobby-sub">Your rookies have signed entry-level contracts — $700K · 3 years.</p>
      ${myPicks.length > 0 ? `
        <table class="standings-table" style="margin: 1rem 0">
          <thead><tr><th>Pick</th><th>POS</th><th>Name</th><th>OVR</th><th>POT</th><th>Contract</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>` : '<p class="text-3">You skipped all your picks.</p>'}

      <h3 class="draft-delta-heading">Team Strength After Draft</h3>
      <table class="standings-table draft-delta-table" style="margin: 0.5rem 0 1.5rem">
        <thead><tr><th></th><th>Team</th><th>Before</th><th>After</th><th>Δ</th></tr></thead>
        <tbody>${deltaRows}</tbody>
      </table>

      <button class="btn-primary" id="btn-begin-season" style="margin-top: 1rem">
        Begin Season →
      </button>
    </div>
  `;

  if (detail) detail.innerHTML = '';

  el('btn-begin-season')?.addEventListener('click', () => {
    window.hockeyGM.beginSeason();
  });
}

// ─── Pre-draft lobby ──────────────────────────────────────────────────────────

function renderPreDraft(state) {
  const board  = el('draft-board');
  const detail = el('draft-pick-detail');

  const hasPastDrafts = (state.draftHistory || []).length > 0;

  if (board) board.innerHTML = `
    <div class="draft-lobby">
      <h2 class="draft-lobby-title">Draft Day</h2>
      <p class="draft-lobby-sub">Year ${state.year} · ${Object.keys(state.teams).length} teams · 3 rounds</p>
      <p class="draft-lobby-hint text-2">
        Generate the draft class to see this year's prospects.<br>
        Draft order is set by reverse standings — worst team picks first.
      </p>
      <button class="btn-primary draft-start-btn" id="btn-start-draft">
        Generate Draft Class →
      </button>
      ${hasPastDrafts ? `<button class="btn-secondary draft-recap-btn" id="btn-view-recap">View past picks</button>` : ''}
    </div>
  `;

  if (detail) detail.innerHTML = '';

  el('btn-start-draft')?.addEventListener('click', async () => {
    const btn = el('btn-start-draft');
    if (btn) { btn.textContent = 'Generating…'; btn.disabled = true; }
    await window.hockeyGM.startDraft();
  });

  el('btn-view-recap')?.addEventListener('click', () => {
    renderRecapInDetail(state);
  });
}

// ─── Active draft ─────────────────────────────────────────────────────────────

function renderActiveDraft(state) {
  renderDraftBoard(state);
  renderPickDetail(state);
}

function renderDraftBoard(state) {
  const board = el('draft-board');
  if (!board) return;

  const totalTeams  = (state.draftOrder || []).length;
  const pickIdx     = state.draftCurrentPick ?? 0;
  const round       = Math.floor(pickIdx / totalTeams) + 1;
  const pickInRound = (pickIdx % totalTeams) + 1;
  const onClockId   = currentPickTeam(state);
  const onClockTeam = state.teams[onClockId];
  const isPlayerTurn = onClockId === state.playerTeamId;

  const prospects = (state.draftClass || [])
    .map(id => state.allPlayers[id])
    .filter(Boolean);

  // Filter by round
  const filtered = boardFilter === 'all'
    ? prospects
    : prospects.filter(p => String(p.draftRound) === boardFilter);

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    if (boardSort === 'overall')   return b.overall   - a.overall;
    if (boardSort === 'potential') return b.potential - a.potential;
    if (boardSort === 'position')  return a.position.localeCompare(b.position);
    // default 'score': composite
    return draftScore(b) - draftScore(a);
  });

  const isPreseason  = state.phase === 'preseason_draft';

  const clockBanner = isPlayerTurn
    ? `<div class="draft-clock draft-clock--player">🏒 YOUR PICK — Round ${round}, Pick ${pickInRound} <span class="draft-pick-overall">#${pickIdx + 1} overall</span>${isPreseason ? ' · Pre-Season Draft' : ''}</div>`
    : `<div class="draft-clock draft-clock--cpu">⏳ ON THE CLOCK: ${onClockTeam?.fullName ?? onClockId} — Round ${round}, Pick ${pickInRound}</div>`;

  const filterBtns = ['all', '1', '2', '3'].map(f =>
    `<button class="filter-btn${boardFilter === f ? ' active' : ''}" data-round="${f}">
      ${f === 'all' ? 'All' : `Rd ${f}`}
    </button>`
  ).join('');

  const sortBtns = [
    ['score',     'Best'],
    ['overall',   'OVR'],
    ['potential', 'POT'],
    ['position',  'POS'],
  ].map(([s, label]) =>
    `<button class="filter-btn${boardSort === s ? ' active' : ''}" data-sort="${s}">${label}</button>`
  ).join('');

  const rows = sorted.map(p => {
    const isSelected = p.id === selectedProspectId;
    const posClass   = positionGroupClass(p.position);
    const ovrClass   = overallClass(p.overall);
    return `
      <tr class="draft-prospect-row${isSelected ? ' draft-prospect-selected' : ''}" data-id="${p.id}">
        <td><span class="pos-badge ${posClass}">${p.position}</span></td>
        <td class="td-name draft-prospect-name">${p.fullName}</td>
        <td>${p.age}</td>
        <td class="${ovrClass}">${p.overall}</td>
        <td class="${overallClass(p.potential)}">${p.potential}</td>
        <td><span class="trait-chip">${p.trait ?? '—'}</span></td>
        <td><span class="draft-round-badge rd-${p.draftRound}">Rd ${p.draftRound}</span></td>
      </tr>
    `;
  }).join('');

  board.innerHTML = `
    ${clockBanner}
    <div class="draft-board-controls">
      <div class="draft-filter-group">${filterBtns}</div>
      <div class="draft-filter-group">${sortBtns}</div>
    </div>
    <table class="standings-table draft-board-table">
      <thead>
        <tr>
          <th>POS</th><th>Name</th><th>Age</th>
          <th title="Current overall">OVR</th>
          <th title="Ceiling potential">POT</th>
          <th>Trait</th><th>Rd</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="7" class="text-3" style="padding:1rem">No prospects available.</td></tr>'}</tbody>
    </table>
  `;

  // Row click → select prospect
  board.querySelectorAll('.draft-prospect-row').forEach(row => {
    row.addEventListener('click', () => {
      selectedProspectId = row.dataset.id;
      renderActiveDraft(state);
    });
  });

  // Filter buttons
  board.querySelectorAll('[data-round]').forEach(btn => {
    btn.addEventListener('click', () => {
      boardFilter = btn.dataset.round;
      renderDraftBoard(state);
    });
  });

  // Sort buttons
  board.querySelectorAll('[data-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      boardSort = btn.dataset.sort;
      renderDraftBoard(state);
    });
  });
}

function renderPickDetail(state) {
  const detail = el('draft-pick-detail');
  if (!detail) return;

  const totalTeams  = (state.draftOrder || []).length;
  const pickIdx     = state.draftCurrentPick ?? 0;
  const round       = Math.floor(pickIdx / totalTeams) + 1;
  const pickInRound = (pickIdx % totalTeams) + 1;
  const onClockId   = currentPickTeam(state);
  const isPlayerTurn = onClockId === state.playerTeamId;

  // Show history if nothing selected
  if (!selectedProspectId || !state.draftClass?.includes(selectedProspectId)) {
    detail.innerHTML = `
      <div class="draft-detail-empty">
        <p class="text-3">← Select a prospect to see their card</p>
        ${renderDraftHistorySnippet(state)}
      </div>
    `;
    return;
  }

  const p = state.allPlayers[selectedProspectId];
  if (!p) { detail.innerHTML = ''; return; }

  const posClass = positionGroupClass(p.position);
  const ovrClass = overallClass(p.overall);
  const isPreseason = state.phase === 'preseason_draft';

  const pickBtn = isPlayerTurn
    ? `<button class="btn-primary draft-pick-btn" id="btn-draft-pick">Draft ${p.firstName} →</button>`
    : `<button class="btn-secondary" disabled>Waiting for CPU…</button>`;

  const autoBtn = isPlayerTurn
    ? `<button class="btn-secondary draft-auto-btn" id="btn-draft-auto">Auto-pick best available</button>`
    : '';

  const skipBtn = isPreseason && isPlayerTurn
    ? `<button class="btn-secondary" id="btn-draft-skip">Skip this pick</button>`
    : '';

  const salaryLine = isPreseason
    ? `<p class="prospect-blurb text-3" style="margin-top:6px">Entry-level contract: <strong>$700K · 3 years</strong></p>`
    : '';

  detail.innerHTML = `
    <div class="draft-prospect-card">
      <div class="draft-card-pos-row">
        <span class="pos-badge ${posClass} pos-badge--lg">${p.position}</span>
        <span class="draft-round-badge rd-${p.draftRound}">Round ${p.draftRound}</span>
      </div>

      <div class="prospect-name">${p.fullName}</div>
      <div class="draft-card-meta text-2">Age ${p.age} · ${p.nationality}</div>

      <div class="draft-stats-row">
        <div class="draft-stat">
          <div class="draft-stat-label">OVR</div>
          <div class="draft-stat-value ${ovrClass}">${p.overall}</div>
        </div>
        <div class="draft-stat">
          <div class="draft-stat-label">POT</div>
          <div class="draft-stat-value ${overallClass(p.potential)}">${p.potential}</div>
        </div>
        <div class="draft-stat">
          <div class="draft-stat-label">AGE</div>
          <div class="draft-stat-value">${p.age}</div>
        </div>
      </div>

      ${p.scoutingBlurb
        ? `<p class="prospect-blurb">${p.scoutingBlurb}</p>`
        : `<p class="prospect-blurb text-3">No scouting report available.</p>`}

      ${salaryLine}

      ${p.weirdNote || p.trait
        ? `<p class="prospect-weird">⚡ ${p.weirdNote ?? p.trait}</p>`
        : ''}

      <div class="draft-pick-actions">
        ${isPlayerTurn ? `<div class="draft-pick-number">Round ${round}, Pick ${pickInRound} · <strong>#${pickIdx + 1} overall</strong></div>` : ''}
        ${pickBtn}
        ${autoBtn}
        ${skipBtn}
      </div>
    </div>
    ${renderDraftHistorySnippet(state)}
  `;

  el('btn-draft-pick')?.addEventListener('click', () => {
    window.hockeyGM.makeDraftPick(selectedProspectId);
    selectedProspectId = null;
    window.hockeyGM.advanceCPUPicks();
  });

  el('btn-draft-auto')?.addEventListener('click', () => {
    // Auto-pick best available for the player, then advance CPU
    const best = bestScoringAvailable(state);
    if (best) {
      window.hockeyGM.makeDraftPick(best);
      selectedProspectId = null;
      window.hockeyGM.advanceCPUPicks();
    }
  });

  el('btn-draft-skip')?.addEventListener('click', () => {
    // Skip: advance the pick counter without drafting anyone
    window.hockeyGM.skipDraftPick();
    selectedProspectId = null;
    window.hockeyGM.advanceCPUPicks();
  });
}

// ─── Post-draft / recap ───────────────────────────────────────────────────────

function renderPostDraft(state) {
  const board  = el('draft-board');
  const detail = el('draft-pick-detail');

  if (board) board.innerHTML = `
    <div class="draft-lobby">
      <h2 class="draft-lobby-title">Draft Complete</h2>
      <p class="draft-lobby-sub">Year ${state.year - 1} draft</p>
      <button class="btn-secondary" onclick="hockeyGM.showScreen('dashboard')">← Back to Dashboard</button>
    </div>
  `;

  if (detail) renderRecapInDetail(state);
}

function renderRecapInDetail(state) {
  const detail = el('draft-pick-detail');
  if (!detail) return;
  detail.innerHTML = `
    <div class="draft-recap">
      <h3 class="draft-recap-title panel-label">Your picks</h3>
      ${renderDraftHistorySnippet(state, true)}
    </div>
  `;
}

// ─── Draft history snippet ────────────────────────────────────────────────────

function renderDraftHistorySnippet(state, showAll = false) {
  const allPicks  = (state.draftHistory || []);
  const myPicks   = allPicks.filter(pick => pick.teamId === state.playerTeamId);
  const display   = showAll ? myPicks : myPicks.slice(-5).reverse();

  if (display.length === 0) return '';

  const rows = display.map(pick => {
    const p = state.allPlayers[pick.prospectId];
    if (!p) return '';
    const posClass = positionGroupClass(p.position);
    const ovrClass = overallClass(p.overall);
    return `
      <tr>
        <td class="text-3">Rd ${pick.round} #${pick.pick}</td>
        <td><span class="pos-badge ${posClass}">${p.position}</span></td>
        <td class="td-name">${p.fullName}</td>
        <td class="${ovrClass}">${p.overall}</td>
        <td class="ovr-good">${p.potential}</td>
      </tr>`;
  }).join('');

  return `
    <div class="draft-history-snippet">
      <div class="panel-label" style="margin-top:1rem">Your picks</div>
      <table class="standings-table">
        <thead>
          <tr><th>Pick</th><th>POS</th><th>Name</th><th>OVR</th><th>POT</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function updateRoundIndicator(state) {
  const ind = el('draft-round-indicator');
  if (!ind) return;
  if (state.phase !== 'draft') {
    ind.textContent = '';
    return;
  }
  const totalTeams = (state.draftOrder || []).length || 1;
  const round = Math.floor((state.draftCurrentPick ?? 0) / totalTeams) + 1;
  ind.textContent = `Round ${round}`;
}

function currentPickTeam(state) {
  if (!state.draftOrder || !state.draftOrder.length) return null;
  const totalTeams = state.draftOrder.length;
  return state.draftOrder[(state.draftCurrentPick ?? 0) % totalTeams];
}

function bestScoringAvailable(state) {
  if (!state.draftClass?.length) return null;
  return state.draftClass.reduce((bestId, id) => {
    const p = state.allPlayers[id];
    const b = state.allPlayers[bestId];
    if (!p) return bestId;
    if (!b) return id;
    return draftScore(p) > draftScore(b) ? id : bestId;
  });
}

function draftScore(p) {
  return (p?.overall ?? 0) + (p?.potential ?? 0) * 0.5;
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
  if (['LD', 'RD'].includes(pos))      return 'def';
  if (pos === 'G')                      return 'goal';
  return '';
}

function el(id) {
  return document.getElementById(id);
}

// ─── Event listener ───────────────────────────────────────────────────────────

document.addEventListener('render-screen', (e) => {
  if (e.detail?.screen !== 'draft') return;
  // Reset selection when screen first opens (not on re-renders)
  renderDraft(e.detail.state);
});
