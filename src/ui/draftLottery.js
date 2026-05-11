/**
 * draftLottery.js
 * Shows a dramatic draft lottery reveal modal.
 * Call showDraftLottery(pickNumber, teamName) — returns a Promise that resolves
 * when the user clicks "Enter the Draft Room".
 */

const overlay = document.getElementById('draft-lottery-overlay');
const content = document.getElementById('draft-lottery-content');

let lotteryResolve = null;

function closeLottery() {
  if (overlay) overlay.style.display = 'none';
  if (content) content.innerHTML = '';
  if (lotteryResolve) { lotteryResolve(); lotteryResolve = null; }
}

window.closeDraftLottery = closeLottery;

// ─── Copy / flavour ───────────────────────────────────────────────────────────

const PICK_COPY = {
  1: {
    label:    'THE #1 OVERALL PICK',
    sub:      'The hockey world is watching. This pick changes everything.',
    urgency:  'gold',
    fireworks: true,
  },
  2: {
    label:    'THE #2 OVERALL PICK',
    sub:      'One of the most coveted spots in the draft. Build around this.',
    urgency:  'ice',
    fireworks: false,
  },
  3: {
    label:    'THE #3 OVERALL PICK',
    sub:      'Franchise talent is still on the board. Make it count.',
    urgency:  'ice',
    fireworks: false,
  },
  4: {
    label:    'THE #4 OVERALL PICK',
    sub:      'A top-four pick. Smart GMs find hidden gems here.',
    urgency:  'accent',
    fireworks: false,
  },
  5: {
    label:    'THE #5 OVERALL PICK',
    sub:      'High lottery. Plenty of talent still waiting for the right team.',
    urgency:  'accent',
    fireworks: false,
  },
};

const ORDINAL = ['', '1ST', '2ND', '3RD', '4TH', '5TH'];

// ─── Fireworks particle helper ────────────────────────────────────────────────

function buildFireworks() {
  const colours = ['#FFFF00','#FF00FF','#00FFFF','#FF4444','#44FF44','#FF8800'];
  let html = '';
  for (let i = 0; i < 40; i++) {
    const x    = Math.random() * 100;
    const y    = Math.random() * 80;
    const size = 4 + Math.random() * 8;
    const col  = colours[Math.floor(Math.random() * colours.length)];
    const dur  = 0.8 + Math.random() * 1.2;
    const del  = Math.random() * 1.5;
    const tx   = (Math.random() - 0.5) * 120;
    const ty   = -(20 + Math.random() * 120);
    html += `<div class="dl-particle" style="
      left:${x}%;top:${y}%;
      width:${size}px;height:${size}px;
      background:${col};
      animation:dl-burst ${dur}s ${del}s ease-out infinite;
      --tx:${tx}px;--ty:${ty}px;
    "></div>`;
  }
  return `<div class="dl-fireworks">${html}</div>`;
}

// ─── Slot machine counter ─────────────────────────────────────────────────────

function buildReveal(pickNum) {
  const copy = PICK_COPY[pickNum] || PICK_COPY[5];

  return `
    <div class="dl-body dl-urgency--${copy.urgency}${copy.fireworks ? ' dl-is-one' : ''}">
      ${copy.fireworks ? buildFireworks() : ''}
      <div class="dl-crown">${copy.fireworks ? '🏒' : '📋'}</div>
      <div class="dl-title">DRAFT LOTTERY</div>
      <div class="dl-slot-wrap">
        <div class="dl-slot-track" id="dl-slot-track">
          ${[1,2,3,4,5,1,2,3,4,5,pickNum].map(n =>
            `<div class="dl-slot-num dl-slot-${n === pickNum ? 'final' : 'spin'}">${n}</div>`
          ).join('')}
        </div>
      </div>
      <div class="dl-pick-label" id="dl-pick-label" style="opacity:0">${ORDINAL[pickNum]} PICK</div>
      <div class="dl-pick-copy" id="dl-pick-copy" style="opacity:0">${copy.label}</div>
      <div class="dl-pick-sub"  id="dl-pick-sub"  style="opacity:0">${copy.sub}</div>
      <button class="btn-primary dl-cta" id="dl-cta" style="opacity:0;pointer-events:none"
        onclick="window.closeDraftLottery()">
        Enter the Draft Room →
      </button>
    </div>
  `;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @param {number} pickNumber — 1 through 5
 * @returns {Promise} resolves when user dismisses
 */
export function showDraftLottery(pickNumber) {
  const pick = Math.max(1, Math.min(5, pickNumber));

  return new Promise((resolve) => {
    lotteryResolve = resolve;
    content.innerHTML = buildReveal(pick);
    overlay.style.display = 'flex';

    // Animate the slot track scrolling then stopping
    const track = document.getElementById('dl-slot-track');
    const total  = track.children.length;
    let idx = 0;
    const interval = setInterval(() => {
      idx++;
      const speed = idx < total * 0.5 ? 80 : idx < total * 0.8 ? 140 : 220;
      clearInterval(interval);
      if (idx < total - 1) {
        // Highlight current
        Array.from(track.children).forEach((el, i) => el.classList.toggle('dl-slot-active', i === idx));
        setTimeout(() => {
          const inner = setInterval(() => {
            idx++;
            Array.from(track.children).forEach((el, i) => el.classList.toggle('dl-slot-active', i === idx));
            if (idx >= total - 1) {
              clearInterval(inner);
              revealFinal();
            }
          }, speed);
        }, speed);
      } else {
        revealFinal();
      }
    }, 80);

    function revealFinal() {
      // Show the last (final) slot number
      const children = Array.from(track.children);
      children.forEach(el => el.classList.remove('dl-slot-active'));
      children[children.length - 1].classList.add('dl-slot-active', 'dl-slot-winner');

      // Stagger fade-in of label / copy / button
      const fadeIn = (id, delay) => {
        setTimeout(() => {
          const el = document.getElementById(id);
          if (el) { el.style.transition = 'opacity 0.5s'; el.style.opacity = '1'; }
        }, delay);
      };
      fadeIn('dl-pick-label', 200);
      fadeIn('dl-pick-copy',  600);
      fadeIn('dl-pick-sub',   900);
      setTimeout(() => {
        const cta = document.getElementById('dl-cta');
        if (cta) { cta.style.transition = 'opacity 0.5s'; cta.style.opacity = '1'; cta.style.pointerEvents = ''; }
      }, 1400);
    }
  });
}
