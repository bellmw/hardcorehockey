# Hockey GM — Personal Hockey Management Sim

Current version: v1.3.2

A stripped-down, goofy hockey GM game. You manage a team, sim seasons, survive
relegation, and watch Claude-powered AI make absurd trade offers at you.

## Quick Start

```bash
# No build step needed. Just open index.html in a browser.
# Or if you want live reload:
npx live-server .
```

You will need a Claude API key for the in-game AI agents (trade offers, headlines,
random events, draft classes). See **API Setup** below.

---

## Features (v1.3.2)

- **90s Sega Genesis / Arcade UI** — Full CRT aesthetic reskin:
  - `Press Start 2P` pixel-art font + `Share Tech Mono` data font
  - CRT scanline overlay animation on the body
  - Beveled arcade-style buttons with bounce+flash micro-interactions
  - LED indicator dots (good / okay / poor / critical) on team overview
  - Segmented OVR stat bars on roster rows
  - Animated salary cap bar (cap-grow + cap-pulse)
  - Sticky roster table headers with frozen POS+Name columns and hover-reveal actions
  - Metal corner bracket SVGs on all panels and modals
  - Perspective ice-rink SVG arena background (stadium lights, vanishing point grid, rink markings)
  - Nav button hockey icon data URIs (roster, standings, trade, draft, news)
  - Spotlight sweep animation on title screen
- **Procedural Team Logo System** — Each of the 36 teams has a unique SVG shield badge:
  - Generated from each team's `primaryColor` + `secondaryColor` in `teams.json`
  - Shield with gradient fill, secondary-color stripe, bevel highlight, glow filter, and drop shadow
  - Team abbreviation rendered in `Press Start 2P` with matching glow
  - Logos appear on: team select cards, team intro screen (96px), game result modal (52px each), app header (28px mini)
- **Global team color theming** — After picking a team, CSS custom properties (`--team-primary`, `--team-secondary`, `--team-glow`, etc.) are applied to `:root`, so the header border, cap bar gradient, nav active tab, and button glows all automatically reflect your team's actual colors
- **Dual Simulation Modes** — Quick Sim (instant result) or Watch Game (period-by-period)
- **Event System** — Random in-season events with chaos level (0-10)
  - League-wide and team-specific events
  - Morale, salary cap, and player stat effects
  - Fires every 2 weeks during regular season (not during playoff sims)
  - **Event deduplication** — Each event fires only once per season
- **Player Injuries** — Random injuries from events or game impacts
  - Duration: 1-3 weeks per injury
  - Max 2 injured players per team
  - Injured players benched (not available for game lineups)
  - Cannot trade injured players
  - Auto-heal each week
- **8-Team Playoff Bracket** — Per league (24 teams total playoff)
  - First round: 1v8, 2v7, 3v6, 4v5 matchups
  - Semifinals and finals
- **Season Summary Screen** — End-of-season report card
  - Grades from A+ to F based on regular season + playoff performance
  - Team stats and narrative summary
  - "Start New Season" button for offseason progression
- **36-Team League** — 3 tiers with promotion/relegation
- **Salary Cap Management** — Trade, sign, or release players
- **Claude AI Agents** — Trade offers, headlines, events
- **LocalStorage Persistence** — Auto-save your game

---

## Tech Stack

- **Pure vanilla HTML / CSS / JS** — no framework, no bundler
- **Claude API** — powers the four in-game AI agents
- All game logic runs client-side; save state stored in localStorage

---

## API Setup

1. Get a Claude API key from https://console.anthropic.com
2. Open `src/api/claudeAgent.js`
3. Set your key at the top:

```js
const CLAUDE_API_KEY = 'sk-ant-...';
```

> Note: this is a personal game for local use only. Never expose your key in
> a deployed app.

---

## File Structure

```
hockey-gm/
├── index.html              ← Entry point, loads all screens
├── README.md
├── GAME_DESIGN.md          ← Full rules and mechanics spec
├── TODO.md                 ← Phase-by-phase build checklist
│
├── data/
│   ├── teams.json          ← All 36 teams (3 leagues × 12)
│   ├── player-names.json   ← Name pools for player generation
│   └── leagueEvents.json   ← Event bank (40+ events with effects)
│
├── src/
│   ├── main.js             ← Game init, screen router, save/load
│   │
│   ├── engine/
│   │   ├── gameEngine.js         ← Simulates individual games
│   │   ├── leagueManager.js      ← Standings, schedule, relegation
│   │   ├── playerGenerator.js    ← Creates and ages players
│   │   ├── eventEngine.js        ← Event selection, effects
│   │   └── injurySystem.js       ← Player injuries (v1.2.6)
│   │
│   ├── api/
│   │   └── claudeAgent.js    ← All Claude API calls (4 agents)
│   │
│   └── ui/
│       ├── dashboard.js         ← Main GM dashboard screen
│       ├── roster.js            ← Roster management screen
│       ├── trade.js             ← Trade desk screen
│       ├── draft.js             ← Draft day screen
│       ├── news.js              ← Headlines and events feed
│       ├── gameWatch.js         ← Period-by-period game viewer
│       ├── teamIntro.js         ← Team intro with chaos selector
│       ├── teamLogo.js          ← Procedural SVG shield logo generator
│       ├── teamSelect.js        ← Team selection screen
│       ├── gameResult.js        ← Game result modal
│       ├── seasonSummary.js     ← End-of-season report card
│       ├── standings.js         ← League standings table
│       └── eventModal.js        ← Event display modal
│
└── assets/
    ├── style.css           ← Global styles (includes full Sega Genesis reskin)
    ├── arena-bg.svg        ← Perspective ice-rink background illustration
    ├── corner-tl.svg       ← Metal corner bracket decorators (×4 directions)
    ├── corner-tr.svg
    ├── corner-bl.svg
    └── corner-br.svg
```

---

## Event System (v1.2.5+)

When you start a new game, you select a **Chaos Level** (0-10):

- **0 = Benign** — Mostly positive, low-impact events
- **5 = Balanced** — Mix of good and bad events
- **10 = Chaotic** — Frequent high-impact events affecting rosters and morale

Events fire automatically every 2 weeks during the regular season and pause the game
with a modal until you acknowledge them. Effects include:

- **Morale changes** — Team-wide or league-wide
- **Salary cap adjustments** — Unexpected costs or refunds
- **Player injuries/illness** — Random or targeted (1-3 weeks)
- **Game bonuses/penalties** — Win/loss modifications
- **Revenue swings** — Economic impacts

**v1.2.6 Update:** Each event fires only once per season, preventing repeats.

---

## Player Injuries (v1.2.6)

Injuries can occur from:
- In-game "player injury" events
- Random "star player illness" events

Effects:
- Player is **benched** (unavailable for lineups)
- **Cannot be traded** while injured
- Maximum **2 injured players per team**
- Duration: **1-3 weeks**
- Auto-heal at the start of each week

Example: If your star player gets injured in week 2 for 2 weeks, they return in week 4.

---

## Playoff Structure (v1.2.8)

Each of the 3 leagues sends 8 teams to playoffs:

```
Round 1 (4 games per league):
  1 vs 8  →  Winner A
  2 vs 7  →  Winner B
  3 vs 6  →  Winner C
  4 vs 5  →  Winner D

Semifinals (2 games per league):
  Winner A vs Winner D
  Winner B vs Winner C

Finals (1 game per league):
  Winner 1 vs Winner 2

League Champions: Top 3 teams
```

---

## The Four In-Game AI Agents

All run through `src/api/claudeAgent.js`:

| Agent | When it fires | What it does |
|---|---|---|
| **Commissioner** | Season start / end | Announces cap increases, relegation, rule changes |
| **Rival GMs** | Weekly during season | Proposes wacky trades based on their personality |
| **Headline Bot** | After each game sim | Generates funny post-game news stories |
| **Event Engine** | Every 2 weeks (season) | Fires random chaos events (no duplicates per season) |

---

## League Structure

```
Premier Hockey League  (Tier 1, 12 teams)
Continental Division   (Tier 2, 12 teams)
Regional Circuit       (Tier 3, 12 teams)

Promotion / Relegation each season:
  Top 2    → auto-promote
  Bottom 2 → auto-relegate
  3rd place vs 10th place → one-game survival playoff
```

---

## Season Loop

1. **Draft** — 3 rounds, pick rookies from Claude-generated class
2. **Chaos Selection** — Choose chaos level (0-10) for event frequency
3. **Signings** — Sign/release free agents within salary cap
4. **Season** — Sim 20 games; trades arrive, events fire every 2 weeks (no repeats), headlines generated, injuries tracked
5. **Playoffs** — Top 8 per league in bracket (1v8, 2v7, 3v6, 4v5)
6. **Relegation** — Bottom 2 drop, top 2 rise, 3rd vs 10th drama
7. **Off-season** — Cap rises $2M, repeat

---

## Game Simulation Modes

When you click **"Sim my next game"** on the dashboard, you can choose how to experience the game:

### ⚡ Quick Sim
- Jumps directly to the final result
- Perfect for when you want fast outcomes
- Displays full scoreboard, period breakdown, shots, stars, and social feed immediately

### 🎬 Watch Game  
- Shows the game **period-by-period**
- Displays goals scored in each period with running totals
- Progress bar tracks game progression (1 of 3, 2 of 3, 3 of 3)
- After all three periods, displays the complete final result
- Great for getting immersed in the action

Both modes display the same final information:
- **Period-by-period scoring**
- **Shots on goal**
- **Stars of the Game** (3-star selections)
- **Game Notes** (key moments)
- **Social Pulse** (community reaction)

---

## Salary Cap

| Year | Cap |
|------|-----|
| 1 | $40M |
| 2 | $42M |
| 3 | $44M |
| ... | +$2M/yr |

Player salary range: $500K (rookies) → $6M (stars)

---

## Recent Features (v1.3.0–v1.3.2)

### v1.3.2
- **Draft screen scroll fix** — Draft screen now scrolls to the top on load
- **Post-draft grade leaderboard** — After the draft completes, the recap panel shows a full league-wide draft grade table (A–F) with winners, losers, and your rank highlighted
- **Team tooltip logo** — Hovering over any team name now shows the team's procedural SVG logo alongside their record and roster breakdown
- **Gus Pawlowski scout panel** — Draft screen right panel shows your team's roster needs (critical/high/medium) and Gus's scouting recommendation, updated live as you click prospects

### v1.3.1
- **Dashboard scroll preservation** — Panel and window scroll positions are saved and restored on every dashboard re-render, so modals no longer snap you back to the top
- **Relegation status in dashboard** — The THIS WEEK zone and news widget now show whether you are safe from relegation, in danger (survival playoff spot), or likely being relegated — colour-coded green/yellow/red
- **Sim 5 games** — "Sim 5 games" button now correctly sims your next 5 matches and shows a combined results modal with W/L/OTL summary and per-game scorelines
- **Watch mode logos** — Team logos now appear above each team name in the period-by-period game watch view
- **Draft lottery reveal** — A dramatic slot-machine modal fires before every draft (new game and off-season). Your pick is always 1–5, weighted by your standing. The #1 pick triggers fireworks and a gold-glow presentation

### v1.3.0
- **90s Sega Genesis / Arcade UI** — Full CRT aesthetic reskin with `Press Start 2P` pixel-art font, scanline overlay, beveled arcade buttons, LED indicator dots, segmented OVR stat bars, animated salary cap bar, sticky frozen roster headers, metal corner bracket SVGs, perspective ice-rink arena background, spotlight sweep on title, and nav hockey icon URIs
- **Procedural Team Logo System** — Unique SVG shield badge per team generated from `primaryColor` + `secondaryColor`; appears on team select cards, team intro, game result modal, and app header
- **Global team color theming** — After picking a team, `--team-primary` / `--team-secondary` CSS custom properties propagate to header, cap bar, nav tab, and button glows automatically

### v1.2.8
- **8-team playoff bracket** — Quarter-finals (1v8, 2v7, 3v6, 4v5), semis, and final per league
- **Instant elimination** — Lose a playoff series and you go straight to the season summary; no sitting through other teams' games
- **Missed playoffs** — If you don't make top 8, bracket screen shows then auto-sims all playoffs and takes you to summary
- **Dashboard THIS WEEK zone** — Context-aware urgency card surfacing injuries, deadlines, expiring contracts, and next game
- **Sortable tables** — Click any column header in Standings or Season Stats to re-sort
- **Active nav highlight** — Current screen is highlighted in the header nav
- **Team narrative** — Dashboard team summary includes a one-line read on your squad's strengths and weaknesses
- **Inline game mode toggle** — Quick / Watch preference persisted in localStorage directly from the dashboard
- **Trade deadline warning** — Commissioner news + THIS WEEK alert fires one week before the deadline
- **Contract offer timing** — Extensions now take up to 3 weeks to resolve (82% accept rate; 65% for peak-age elites)

### v1.2.7
- **Player injury system** — Random injuries from events or game impacts; injured players benched and untradeable
- **Event deduplication** — Each random event fires only once per season

## Recent Features (v1.2.3–v1.2.4)

### v1.2.4
- **Dual game simulation modes**: Choose between Quick Sim (instant result) and Watch Game (period-by-period)
- Period-by-period display shows cumulative scoring with progress tracking
- Enhanced visual feedback during game progression

### v1.2.3
- **Trade desk shortcuts**: Quick links to GM Assistant, trade history, and league roster
- **League leaders carousel**: Navigate between Points, Goals, GAA, and Save % leaderboards
- **Player tooltips**: Hover over leaders to see full player stats, contract details, and salary info
- **Team highlighting**: User's roster players are visually distinguished on leaderboards
