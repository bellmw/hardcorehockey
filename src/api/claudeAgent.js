/**
 * claudeAgent.js
 * All Claude API calls for the four in-game AI agents.
 * Replace CLAUDE_API_KEY with your actual key.
 *
 * ── STUB MODE ──────────────────────────────────────────────────────────────
 * Per Chairman recommendation, callClaude() returns null immediately during
 * game loop verification. Every agent function falls through to its fallback.
 * To re-enable: set CLAUDE_STUB = false and paste your API key below.
 * ───────────────────────────────────────────────────────────────────────────
 */

const CLAUDE_STUB    = true;  // ← flip to false when ready to wire live API
const CLAUDE_API_KEY = 'YOUR_API_KEY_HERE';
const CLAUDE_MODEL   = 'claude-sonnet-4-20250514';
const API_URL        = 'https://api.anthropic.com/v1/messages';

// ─── Shared API caller ────────────────────────────────────────────────────────

async function callClaude(systemPrompt, userPrompt, maxTokens = 300) {
  if (CLAUDE_STUB) return null; // stub — instant fallback, no network call

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      console.warn(`Claude API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data.content?.[0]?.text?.trim() ?? null;
  } catch (err) {
    console.warn('Claude API call failed:', err);
    return null;
  }
}

// ─── Agent 1: Headline Bot ────────────────────────────────────────────────────

const HEADLINE_SYSTEM = `You write deadpan sports headlines and short match reports for a goofy minor-league
hockey simulation set in small Canadian and American cities. Tone: dry, understated, vaguely absurd.
Think small-town sports section. Keep headlines under 15 words. Match report under 60 words.
Respond with JSON only: { "headline": "...", "report": "..." }`;

/**
 * Generates a headline and short match report after a game.
 * @param {Object} result     - game result from gameEngine.simulateGame()
 * @param {Object} homeTeam   - team object
 * @param {Object} awayTeam   - team object
 * @param {Array}  highlights - template highlights from game engine
 * @returns {Object} { headline, report } — falls back to template if API fails
 */
export async function generateHeadline(result, homeTeam, awayTeam, highlights) {
  const prompt = `
Game result:
- ${homeTeam.fullName} ${result.homeGoals} — ${result.awayGoals} ${awayTeam.fullName}
- Played at: ${homeTeam.arena}
- Ended in: ${result.overtimeType || 'regulation'}
- Game highlights: ${highlights.join(' ')}

Write a dry, deadpan headline and a 2-sentence match report. JSON only.`;

  const raw = await callClaude(HEADLINE_SYSTEM, prompt, 200);

  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return { headline: raw.split('\n')[0], report: raw };
    }
  }

  // Fallback if API fails
  const winner = result.homeGoals > result.awayGoals ? homeTeam : awayTeam;
  const score  = `${result.homeGoals}–${result.awayGoals}`;
  return {
    headline: `${winner.name} win ${score} in ${result.overtimeType || 'regulation'}.`,
    report: highlights[0] || `Final score: ${homeTeam.abbrev} ${score} ${awayTeam.abbrev}.`,
  };
}

// ─── Agent 2: Rival GMs (Trade Offers) ───────────────────────────────────────

const TRADE_SYSTEM = `You are an AI running rival hockey GMs in a goofy hockey management sim set in small
Canadian and American cities. Each GM has a personality. Generate trade offers that match their personality.
Offers should be entertaining — sometimes absurd, sometimes reasonable, always in character.
Respond with JSON only: { "offerText": "...", "gmQuote": "...", "valueOpinion": "fair"|"good"|"bad"|"robbery" }
Keep offerText under 40 words. gmQuote under 25 words (first-person, in character).`;

const GM_PERSONALITY_DESCRIPTIONS = {
  cheapskate: 'Always lowballs. Offers scrubs for stars. Genuinely believes they are being generous.',
  win_now:    'Desperate for veterans. Will massively overpay. Ignores age and injury history.',
  rebuilder:  'Wants prospects and picks. Happy to dump aging vets. Thinks long-term.',
  gambler:    'Random chaos. Offers make no logical sense. Sometimes accidentally gets it right.',
  hoarder:    'Protective of good players. Rarely offers, and when they do, barely gives anything up.',
  desperate:  'Near relegation. Will trade almost anything. Panicking but trying to hide it.',
};

/**
 * Generates a trade offer from a rival GM.
 * @param {Object} rivalTeam     - the offering team
 * @param {Array}  offeredPlayers - players the rival is offering
 * @param {Array}  wantedPlayers  - players the rival wants from you
 * @param {Array}  offeredPicks   - optional draft picks being offered
 * @param {Array}  wantedPicks    - optional draft picks being requested
 * @returns {Object} { offerText, gmQuote, valueOpinion }
 */
export async function generateTradeOffer(rivalTeam, offeredPlayers, wantedPlayers, offeredPicks = [], wantedPicks = []) {
  const gmPersonality = GM_PERSONALITY_DESCRIPTIONS[rivalTeam.gmPersonality] || 'Unknown personality.';

  const offered = offeredPlayers.map(p => `${p.fullName} (${p.position}, OVR ${p.overall}, age ${p.age})`).join(', ');
  const wanted  = wantedPlayers.map(p => `${p.fullName} (${p.position}, OVR ${p.overall}, age ${p.age})`).join(', ');
  const picksOffered  = offeredPicks.length > 0 ? `+ ${offeredPicks.join(', ')}` : '';
  const picksWanted   = wantedPicks.length  > 0 ? `+ ${wantedPicks.join(', ')}`  : '';

  const prompt = `
Rival GM: ${rivalTeam.gmName} (${rivalTeam.fullName})
GM Personality: ${gmPersonality}

Trade offer:
- They offer: ${offered || 'nothing'} ${picksOffered}
- They want:  ${wanted  || 'nothing'} ${picksWanted}

Generate the offer text (how this would appear in my trade inbox) and a GM quote in character.
Include a valueOpinion of whether this deal is fair from my perspective.
JSON only.`;

  const raw = await callClaude(TRADE_SYSTEM, prompt, 250);

  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return {
        offerText: `${rivalTeam.gmName} has made you a trade offer involving ${offered || 'unknown players'}.`,
        gmQuote: `"This is a very good deal for both sides." — ${rivalTeam.gmName}`,
        valueOpinion: 'fair',
      };
    }
  }

  // Fallback
  return {
    offerText: `${rivalTeam.gmName} of the ${rivalTeam.fullName} has proposed a trade.`,
    gmQuote: `"Think it over." — ${rivalTeam.gmName}`,
    valueOpinion: 'fair',
  };
}

// ─── Agent 3: Commissioner Announcements ─────────────────────────────────────

const COMMISSIONER_SYSTEM = `You are the Commissioner of a goofy minor-league hockey simulation with three tiers
of 12 teams in small Canadian and American cities. You make official-sounding league announcements that are
slightly pompous and occasionally absurd. Keep announcements under 80 words. Tone: formal but self-important.`;

/**
 * Generates a Commissioner announcement (season start, cap change, relegation, etc.)
 * @param {string} type    - 'season_start' | 'season_end' | 'cap_increase' | 'relegation' | 'championship'
 * @param {Object} context - relevant data (teams, year, cap, etc.)
 * @returns {string} announcement text
 */
export async function generateCommissionerAnnouncement(type, context) {
  const prompts = {
    season_start: `It is the start of Year ${context.year} of the league. Salary cap is now $${(context.cap / 1_000_000).toFixed(0)}M. Write a pompous season-opening announcement.`,
    cap_increase: `The salary cap has increased from $${((context.cap - 2_000_000) / 1_000_000).toFixed(0)}M to $${(context.cap / 1_000_000).toFixed(0)}M. Announce this with excessive gravitas.`,
    relegation: `${context.relegated?.join(' and ')} have been relegated. ${context.promoted?.join(' and ')} have been promoted. Write the official announcement.`,
    championship: `${context.champion} have won the ${context.league} championship. Write a brief, self-important Commissioner proclamation.`,
    survival_playoff: `${context.teamA} and ${context.teamB} will play a one-game survival playoff to determine relegation. The stakes are high. Make it sound dramatic.`,
  };

  const prompt = prompts[type] || `Write a brief league announcement about: ${JSON.stringify(context)}`;
  const result = await callClaude(COMMISSIONER_SYSTEM, prompt, 150);

  return result || `The Commissioner wishes to inform all clubs that the ${type.replace('_', ' ')} has been processed accordingly.`;
}

// ─── Agent 4: Event Engine ────────────────────────────────────────────────────

const EVENT_SYSTEM = `You write random absurd news items for a goofy hockey simulation set in small Canadian
and American cities. Events should feel like they came from a small-town sports section — mundane, slightly
bizarre, occasionally affecting player performance. Keep under 60 words. No formatting, just plain text.`;

/**
 * Generates a Claude-powered random event (supplements the events.json bank).
 * @param {Object} context - { team, player, league, week }
 * @returns {string} event text
 */
export async function generateRandomEvent(context) {
  const prompt = `
Generate a random minor incident for a hockey team.
Team: ${context.team.fullName}
Featured player (optional): ${context.player ? context.player.fullName + ` (${context.player.position})` : 'any player'}
Week of season: ${context.week} of 20
Location: ${context.team.city}, ${context.team.arena}

Write one short absurd news item. Plain text only. Under 60 words.`;

  const result = await callClaude(EVENT_SYSTEM, prompt, 120);
  return result || `Something happened in ${context.team.city}. The team is handling it internally.`;
}

// ─── Draft Class Augmentation ─────────────────────────────────────────────────

const SCOUT_SYSTEM = `You are a hockey scout writing prospect blurbs for a goofy hockey simulation.
Your scouting reports are earnest but occasionally off-base. Each blurb should be 1-2 sentences max.
Include one weird personal detail. Return JSON array only: [{"id":"...","blurb":"...","weirdNote":"..."}]`;

/**
 * Adds scouting blurbs to a list of draft prospects.
 * @param {Array} prospects - from playerGenerator.generateDraftClass()
 * @returns {Array} prospects with blurb and weirdNote added
 */
export async function augmentDraftClass(prospects) {
  // Process in batches of 10 to keep API responses manageable
  const results = [...prospects];
  const batchSize = 10;

  for (let i = 0; i < prospects.length; i += batchSize) {
    const batch = prospects.slice(i, i + batchSize);
    const prompt = `
Write scouting blurbs for these prospects:
${batch.map(p => `- id:${p.id} | ${p.fullName} | ${p.position} | OVR ${p.overall} | Age ${p.age} | Potential ${p.potential}`).join('\n')}

JSON array only. Each object: { "id": "...", "blurb": "1-2 sentences", "weirdNote": "one odd personal detail" }`;

    const raw = await callClaude(SCOUT_SYSTEM, prompt, 600);

    if (raw) {
      try {
        const blurbs = JSON.parse(raw.replace(/```json|```/g, '').trim());
        blurbs.forEach(b => {
          const p = results.find(r => r.id === b.id);
          if (p) {
            p.scoutingBlurb = b.blurb;
            p.weirdNote     = b.weirdNote;
          }
        });
      } catch {
        console.warn('Could not parse draft class blurbs for batch', i);
      }
    }
  }

  return results;
}
