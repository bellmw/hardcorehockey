/**
 * eventModal.js
 * Displays event popups when they are triggered
 */

const eventOverlay = document.getElementById('event-overlay');
const eventContent = document.getElementById('event-content');

let currentEvent = null;
let eventResolve = null;

function closeEventModal() {
  if (eventOverlay) eventOverlay.style.display = 'none';
  if (eventContent) eventContent.innerHTML = '';
}

window.closeEventModal = closeEventModal;
window.acknowledgeEvent = acknowledgeEvent;

// Close on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && eventOverlay && eventOverlay.style.display !== 'none') {
    acknowledgeEvent();
  }
});

// ─── Event Display ────────────────────────────────────────────────────────────

function renderEventModal(event, summary) {
  const typeColor = event.type === 'benefit' ? '#39ff14' : event.type === 'chaos' ? '#ff1e3c' : '#a8d8f0';
  const typeLabel = event.type === 'benefit' ? '✓ BENEFIT' : event.type === 'chaos' ? '⚠ CHAOS' : 'ℹ BENIGN';
  const scopeLabel = event.scope === 'league-wide' ? 'LEAGUE-WIDE' : event.scope === 'team-only' ? 'TEAM EVENT' : 'MINOR';

  let effectsHtml = '';
  if (summary && summary.effects && summary.effects.length > 0) {
    effectsHtml = `
      <div class="event-effects">
        <div class="event-effects-title">Effects:</div>
        <ul class="event-effects-list">
          ${summary.effects.map(effect => `<li>${effect}</li>`).join('')}
        </ul>
      </div>
    `;
  } else {
    effectsHtml = '<div class="event-effects"><div class="event-effects-title">Effects:</div><p class="event-no-effects">No material effects.</p></div>';
  }

  const html = `
    <div class="event-header" style="border-left-color: ${typeColor}">
      <div class="event-type-label" style="background: ${typeColor};">${typeLabel}</div>
      <div class="event-scope-label">${scopeLabel}</div>
    </div>
    
    <div class="event-title">${event.name}</div>
    
    <div class="event-description">${event.description}</div>
    
    ${effectsHtml}
    
    <div class="event-footer">
      <button class="btn-primary" onclick="window.acknowledgeEvent()">Continue →</button>
    </div>
  `;

  eventContent.innerHTML = html;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Show an event and wait for user acknowledgement
 * @param {object} event - Event object
 * @param {object} summary - Effects summary
 * @returns {Promise} - Resolves when user clicks Continue
 */
export function showEvent(event, summary) {
  currentEvent = event;
  
  return new Promise((resolve) => {
    eventResolve = resolve;
    renderEventModal(event, summary);
    if (eventOverlay) {
      eventOverlay.style.display = 'flex';
    }
  });
}

function acknowledgeEvent() {
  closeEventModal();
  if (eventResolve) {
    eventResolve();
    eventResolve = null;
  }
}
