/**
 * teamLogo.js
 * Team logo system: real PNG logos (assets/logos/{ABBREV}.png) with automatic
 * fallback to procedural SVG shield for any team that doesn't have one yet.
 *
 * Usage:
 *   import { teamLogoEl, teamLogoSvg, teamColorVars, applyTeamColors } from './teamLogo.js';
 *
 *   teamLogoEl(abbrev, primary, secondary, size)
 *     → <img> if assets/logos/{ABBREV}.png exists, SVG shield otherwise
 */

// ─── Global onerror fallback (called by img tags in HTML strings) ─────────────
if (typeof window !== 'undefined') {
  window.__hgmLogoFallback = function (img) {
    const abbrev   = img.dataset.abbrev;
    const primary  = decodeURIComponent(img.dataset.primary);
    const secondary = decodeURIComponent(img.dataset.secondary);
    const size     = parseInt(img.dataset.size, 10);
    // Replace the broken img with the procedural SVG shield
    const tmp = document.createElement('span');
    tmp.innerHTML = teamLogoSvg(abbrev, primary, secondary, parseInt(size, 10));
    img.replaceWith(tmp.firstElementChild);
  };
}

/**
 * Returns an <img> pointing to assets/logos/{teamId}.png (e.g. phl_sud.png).
 * If the file is missing, onerror swaps it for the procedural SVG shield.
 * Drop any PNG into assets/logos/ and it is picked up automatically.
 *
 * @param {string} teamId    - Team ID used for the filename (e.g. "phl_sud")
 * @param {string} abbrev    - Short abbreviation for SVG fallback (e.g. "SUD")
 * @param {string} primary   - Primary color hex
 * @param {string} secondary - Secondary color hex
 * @param {number} [size=64] - Width/height in px
 */
export function teamLogoEl(teamId, abbrev, primary, secondary, size = 64) {
  return `<img
    src="assets/logos/${teamId}.png"
    width="${size}" height="${size}"
    style="object-fit:contain;display:block;image-rendering:auto;"
    data-abbrev="${abbrev}"
    data-primary="${encodeURIComponent(primary)}"
    data-secondary="${encodeURIComponent(secondary)}"
    data-size="${size}"
    onerror="window.__hgmLogoFallback(this)"
    alt="${abbrev} logo"
  >`;
}

// ─── Shield SVG generator ─────────────────────────────────────────────────────

/**
 * Returns an inline SVG string of a hockey-shield badge.
 * @param {string} abbrev        - Team abbreviation (e.g. "SUD")
 * @param {string} primary       - Primary color hex (e.g. "#8B4513")
 * @param {string} secondary     - Secondary color hex (e.g. "#C0C0C0")
 * @param {number} [size=64]     - Width/height in px
 * @returns {string} SVG markup
 */
export function teamLogoSvg(abbrev, primary, secondary, size = 64) {
  const w = size;
  const h = size;

  // Determine font size based on abbrev length
  const fontSize = abbrev.length <= 2 ? size * 0.30
                 : abbrev.length === 3 ? size * 0.24
                 : size * 0.19;

  // Lighten primary for the top shield stripe
  const lightPrimary = lightenHex(primary, 40);
  // Darken primary for shadow/bevel
  const darkPrimary  = darkenHex(primary, 40);

  // Build unique id for gradients (avoid collisions with multiple logos on page)
  const uid = abbrev.replace(/[^a-zA-Z0-9]/g, '') + '_' + size;

  return `<svg xmlns="http://www.w3.org/2000/svg"
    width="${w}" height="${h}" viewBox="0 0 100 110"
    role="img" aria-label="${abbrev} logo">
  <defs>
    <!-- Main shield gradient: primary top → darker bottom -->
    <linearGradient id="shield_${uid}" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%"   stop-color="${lightPrimary}"/>
      <stop offset="40%"  stop-color="${primary}"/>
      <stop offset="100%" stop-color="${darkPrimary}"/>
    </linearGradient>
    <!-- Bevel highlight: white sheen top-left -->
    <linearGradient id="bevel_${uid}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="rgba(255,255,255,0.35)"/>
      <stop offset="50%"  stop-color="rgba(255,255,255,0)"/>
    </linearGradient>
    <!-- Glow filter -->
    <filter id="glow_${uid}" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <!-- Drop shadow -->
    <filter id="shadow_${uid}" x="-10%" y="-5%" width="130%" height="130%">
      <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="rgba(0,0,0,0.7)"/>
    </filter>
  </defs>

  <!-- Outer shadow shield -->
  <path d="M50 4 L96 22 L96 62 Q96 90 50 106 Q4 90 4 62 L4 22 Z"
        fill="rgba(0,0,0,0.4)" transform="translate(0,3)" filter="url(#shadow_${uid})"/>

  <!-- Shield border (secondary color) -->
  <path d="M50 4 L96 22 L96 62 Q96 90 50 106 Q4 90 4 62 L4 22 Z"
        fill="${secondary}" stroke="${darkenHex(secondary, 30)}" stroke-width="1.5"/>

  <!-- Shield body (primary gradient) -->
  <path d="M50 9 L91 25 L91 62 Q91 87 50 101 Q9 87 9 62 L9 25 Z"
        fill="url(#shield_${uid})"/>

  <!-- Secondary color banner stripe across middle -->
  <path d="M9 48 L91 48 L91 55 Q91 74 50 86 Q9 74 9 55 Z"
        fill="${secondary}" opacity="0.25"/>

  <!-- Inner thin border line -->
  <path d="M50 12 L88 27 L88 62 Q88 85 50 98 Q12 85 12 62 L12 27 Z"
        fill="none" stroke="${secondary}" stroke-width="1.2" opacity="0.6"/>

  <!-- Bevel sheen -->
  <path d="M50 9 L91 25 L91 62 Q91 87 50 101 Q9 87 9 62 L9 25 Z"
        fill="url(#bevel_${uid})"/>

  <!-- Team abbreviation text -->
  <text x="50" y="62"
        font-family="'Press Start 2P', monospace"
        font-size="${fontSize}"
        font-weight="700"
        fill="${secondary}"
        text-anchor="middle"
        dominant-baseline="middle"
        filter="url(#glow_${uid})"
        letter-spacing="-1">${abbrev}</text>

  <!-- Text drop shadow (painted before main text so it sits behind) -->
  <text x="51" y="63.5"
        font-family="'Press Start 2P', monospace"
        font-size="${fontSize}"
        font-weight="700"
        fill="rgba(0,0,0,0.6)"
        text-anchor="middle"
        dominant-baseline="middle"
        letter-spacing="-1"
        style="pointer-events:none">${abbrev}</text>

  <!-- Top highlight dot row (scoreboard-style decorators) -->
  <circle cx="30" cy="19" r="2" fill="${secondary}" opacity="0.7"/>
  <circle cx="50" cy="14" r="2.5" fill="${secondary}" opacity="0.9"/>
  <circle cx="70" cy="19" r="2" fill="${secondary}" opacity="0.7"/>
</svg>`;
}

/**
 * Returns CSS custom property declarations for a team's colors.
 * Paste these as an inline style="" on a container element.
 */
export function teamColorVars(primary, secondary) {
  const dark    = darkenHex(primary, 50);
  const light   = lightenHex(primary, 60);
  const glow    = hexToRgba(primary, 0.65);
  const secGlow = hexToRgba(secondary, 0.45);
  return [
    `--team-primary:${primary}`,
    `--team-secondary:${secondary}`,
    `--team-dark:${dark}`,
    `--team-light:${light}`,
    `--team-glow:${glow}`,
    `--team-sec-glow:${secGlow}`,
  ].join(';');
}

/**
 * Apply a team's colors to the global app header and body accent vars.
 * Call this once after a team is selected / when dashboard loads.
 */
export function applyTeamColors(primary, secondary) {
  const root = document.documentElement;
  root.style.setProperty('--team-primary',   primary);
  root.style.setProperty('--team-secondary', secondary);
  root.style.setProperty('--team-glow',      hexToRgba(primary, 0.6));
  root.style.setProperty('--team-sec-glow',  hexToRgba(secondary, 0.45));
  root.style.setProperty('--team-dark',      darkenHex(primary, 50));
  root.style.setProperty('--team-light',     lightenHex(primary, 60));
}

// ─── Color utilities ──────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3
    ? h.split('').map(c => c + c).join('')
    : h;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function hexToRgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function lightenHex(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  return `rgb(${Math.min(255, r + amount)},${Math.min(255, g + amount)},${Math.min(255, b + amount)})`;
}

function darkenHex(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  return `rgb(${Math.max(0, r - amount)},${Math.max(0, g - amount)},${Math.max(0, b - amount)})`;
}
