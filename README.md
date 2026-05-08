# Hockey GM — Personal Hockey Management Sim

Current version: v1.2.5

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

## Features (v1.2.5)

- **Dual Simulation Modes** — Quick Sim (instant result) or Watch Game (period-by-period)
- **Event System** — Random in-season events with chaos level (0-10)
  - League-wide and team-specific events
  - Morale, salary cap, and player stat effects
  - Fires every 2 weeks during regular season
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
│   │   ├── gameEngine.js       ← Simulates individual games
│   │   ├── leagueManager.js    ← Standings, schedule, relegation
│   │   ├── playerGenerator.js  ← Creates and ages players
│   │   └── eventEngine.js      ← Event selection, effects (v1.2.5)
│   │
│   ├── api/
│   │   └── claudeAgent.js  ← All Claude API calls (4 agents)
│   │
│   └── ui/
│       ├── dashboard.js        ← Main GM dashboard screen
│       ├── roster.js           ← Roster management screen
│       ├── trade.js            ← Trade desk screen
│       ├── draft.js            ← Draft day screen
│       ├── news.js             ← Headlines and events feed
│       ├── gameWatch.js        ← Period-by-period game viewer (v1.2.4)
│       ├── teamIntro.js        ← Team intro with chaos selector (v1.2.5)
│       └── eventModal.js       ← Event display modal (v1.2.5)
│
└── assets/
    └── style.css           ← Global styles
```

---

## Event System (v1.2.5)

When you start a new game, you select a **Chaos Level** (0-10):

- **0 = Benign** — Mostly positive, low-impact events
- **5 = Balanced** — Mix of good and bad events
- **10 = Chaotic** — Frequent high-impact events affecting rosters and morale

Events fire automatically every 2 weeks during the regular season and pause the game
with a modal until you acknowledge them. Effects include:

- **Morale changes** — Team-wide or league-wide
- **Salary cap adjustments** — Unexpected costs or refunds
- **Player injuries/illness** — Random or targeted
- **Game bonuses/penalties** — Win/loss modifications
- **Revenue swings** — Economic impacts

Examples:
- "Commissioner Controversy" — All teams lose morale
- "Major Storm Rescheduling" — Schedule disruptions
- "Trade Deadline Panic" — Roster uncertainty effects
- "Star Player Breakthrough" — Targeted player boost

---

## The Four In-Game AI Agents

All run through `src/api/claudeAgent.js`:

| Agent | When it fires | What it does |
|---|---|---|
| **Commissioner** | Season start / end | Announces cap increases, relegation, rule changes |
| **Rival GMs** | Weekly during season | Proposes wacky trades based on their personality |
| **Headline Bot** | After each game sim | Generates funny post-game news stories |
| **Event Engine** | Every 2 weeks (season) | Fires random chaos events based on chaos level |

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
4. **Season** — Sim 20 games; trades arrive, events fire every 2 weeks, headlines generated
5. **Playoffs** — Top 4 in your league, sim bracket
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
