/**
 * teamIntro.js
 * Renders the scouting report / team intro screen shown immediately after
 * picking a team on a new game, before the dashboard.
 *
 * Triggered by 'render-screen' CustomEvent with detail.screen === 'team-intro'.
 */

// ─── Main render ──────────────────────────────────────────────────────────────

function renderTeamIntro(state) {
  const container = document.getElementById('team-intro-content');
  if (!container) return;

  const team   = state.teams[state.playerTeamId];
  if (!team) return;

  const roster = (team.rosterIds || [])
    .map(id => state.allPlayers[id])
    .filter(Boolean);

  const report = buildScoutingReport(roster, state);

  container.innerHTML = `
    <div class="intro-header">
      <div class="intro-header-league">
        <span class="league-badge ${team.leagueId}">${team.leagueId.toUpperCase()}</span>
      </div>
      <h1 class="intro-team-name">${team.fullName}</h1>
      <p class="intro-arena">${team.arena} · Est. ${team.founded}</p>
      <p class="intro-flavour">"${team.flavour}"</p>
      <p class="intro-gm">Outgoing GM: <strong>${team.gmName}</strong>
        <span class="team-card-personality">${formatPersonality(team.gmPersonality)}</span>
      </p>
    </div>

    <div class="intro-report">
      <h2 class="intro-section-title">Scouting Report</h2>
      <div class="intro-groups">
        ${report.groups.map(g => groupCard(g)).join('')}
      </div>

      <div class="intro-sw">
        <div class="intro-strength">
          <span class="intro-sw-label strength-label">Strength</span>
          <span>${report.strength}</span>
        </div>
        <div class="intro-weakness">
          <span class="intro-sw-label weakness-label">Weakness</span>
          <span>${report.weakness}</span>
        </div>
      </div>

      <div class="intro-stars">
        <h3 class="intro-section-sub">Key Players</h3>
        ${report.stars.map(p => starRow(p)).join('')}
      </div>

      <div class="intro-concerns">
        <h3 class="intro-section-sub">Concerns</h3>
        ${report.concerns.map(c => `<p class="intro-concern-line">⚠ ${c}</p>`).join('')}
      </div>
    </div>

    <div class="intro-chaos-section">
      <h3 class="intro-section-sub">Chaos Level</h3>
      <p class="intro-chaos-description">Choose how often wild events occur during the season (0 = none, 10 = constant chaos)</p>
      <div class="chaos-slider-container">
        <span class="chaos-label chaos-label-min">0 (Benign)</span>
        <input type="range" id="chaos-level-slider" class="chaos-slider" min="0" max="10" value="5" oninput="updateChaosDisplay()">
        <span class="chaos-label chaos-label-max">10 (Chaotic)</span>
      </div>
      <div class="chaos-display" id="chaos-display">Chaos Level: <strong>5</strong></div>
    </div>

    <button class="btn-primary intro-cta" onclick="window.startWithChaosLevel()">
      Head to Draft Day →
    </button>
  `;
}

// ─── Scouting logic ───────────────────────────────────────────────────────────

function buildScoutingReport(roster, state) {
  const fwd  = roster.filter(p => ['C','LW','RW'].includes(p.position));
  const def  = roster.filter(p => ['LD','RD'].includes(p.position));
  const goal = roster.filter(p => p.position === 'G');

  const avg = arr => arr.length ? Math.round(arr.reduce((s, p) => s + p.overall, 0) / arr.length) : 0;

  const fwdAvg  = avg(fwd);
  const defAvg  = avg(def);
  const goalAvg = avg(goal);

  const groups = [
    { label: 'Forwards',  avg: fwdAvg,  count: fwd.length,  players: fwd },
    { label: 'Defence',   avg: defAvg,  count: def.length,  players: def },
    { label: 'Goaltending', avg: goalAvg, count: goal.length, players: goal },
  ];

  const sorted = [...groups].sort((a, b) => b.avg - a.avg);
  const strengthGroup = sorted[0];
  const weaknessGroup = sorted[sorted.length - 1];

  // Top 3 players overall
  const stars = [...roster]
    .sort((a, b) => b.overall - a.overall)
    .slice(0, 3);

  // Build concern list
  const concerns = [];
  if (weaknessGroup.avg < 55) concerns.push(`${weaknessGroup.label} are a serious liability (avg OVR ${weaknessGroup.avg}).`);
  const agingStars = roster.filter(p => p.age >= 33 && p.overall >= 70);
  if (agingStars.length >= 2) concerns.push(`${agingStars.length} aging top players (33+) could decline soon.`);
  const rookies = roster.filter(p => p.isRookie);
  if (rookies.length >= 4) concerns.push(`${rookies.length} rookies on the roster — development risk.`);

  // Cap situation
  const totalSalary = roster.reduce((s, p) => s + (p.salary || 0), 0);
  const cap = state.cap ?? 75_000_000;
  const capPct = (totalSalary / cap) * 100;
  if (capPct > 90) concerns.push(`Over 90% of the salary cap committed — little flexibility.`);
  else if (capPct < 50) concerns.push(`Lots of cap space but a thin roster — may need reinforcements.`);

  if (concerns.length === 0) concerns.push('No major red flags. A solid foundation.');

  const strength = `${strengthGroup.label} (avg ${strengthGroup.avg} OVR) — the backbone of this team.`;
  const weakness = `${weaknessGroup.label} (avg ${weaknessGroup.avg} OVR) — needs attention.`;

  return { groups, strength, weakness, stars, concerns };
}

// ─── Rendering helpers ────────────────────────────────────────────────────────

function groupCard(g) {
  const barPct = Math.min(Math.max((g.avg - 40) / 50 * 100, 2), 100);
  const cls    = ovrClass(g.avg);
  return `
    <div class="intro-group-card">
      <div class="intro-group-label">${g.label}</div>
      <div class="intro-group-bar-track">
        <div class="intro-group-bar ${cls}" style="width:${barPct}%"></div>
      </div>
      <div class="intro-group-avg ${cls}">${g.avg}</div>
    </div>
  `;
}

function starRow(p) {
  const cls = ovrClass(p.overall);
  return `
    <div class="intro-star-row">
      <span class="pos-badge ${posBadgeClass(p.position)}">${p.position}</span>
      <span class="intro-star-name">${p.fullName}</span>
      <span class="intro-star-ovr ${cls}">${p.overall}</span>
      <span class="intro-star-age text-3">Age ${p.age}</span>
      ${p.trait ? `<span class="intro-star-trait text-3">${p.trait}</span>` : ''}
    </div>
  `;
}

function ovrClass(ovr) {
  if (ovr >= 80) return 'ovr-elite';
  if (ovr >= 70) return 'ovr-good';
  if (ovr >= 60) return 'ovr-avg';
  return 'ovr-poor';
}

function posBadgeClass(pos) {
  if (['C','LW','RW'].includes(pos)) return 'fwd';
  if (['LD','RD'].includes(pos)) return 'def';
  return 'goal';
}

function formatPersonality(p) {
  const map = {
    win_now:    'Win Now',
    cheapskate: 'Cheapskate',
    rebuilder:  'Rebuilder',
    gambler:    'Gambler',
    hoarder:    'Hoarder',
    desperate:  'Desperate',
  };
  return map[p] ?? p ?? '';
}

// ─── Chaos Level Controls ─────────────────────────────────────────────────────

window.updateChaosDisplay = function() {
  const slider = document.getElementById('chaos-level-slider');
  const display = document.getElementById('chaos-display');
  if (slider && display) {
    display.innerHTML = `Chaos Level: <strong>${slider.value}</strong>`;
  }
};

window.startWithChaosLevel = function() {
  const slider = document.getElementById('chaos-level-slider');
  if (slider) {
    const chaosLevel = parseInt(slider.value, 10);
    const state = window.hockeyGM?.getState?.();
    if (state) {
      state.chaosLevel = chaosLevel;
    }
  }
  window.hockeyGM?.showScreen('draft');
};

// ─── Event listener ───────────────────────────────────────────────────────────

document.addEventListener('render-screen', (e) => {
  if (e.detail?.screen !== 'team-intro') return;
  renderTeamIntro(e.detail.state);
});
