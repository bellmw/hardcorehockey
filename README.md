# Hockey GM — Personal Hockey Management Sim

Current version: v1.2.4

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
│   └── events.json         ← Random in-season events bank
│
├── src/
│   ├── main.js             ← Game init, screen router, save/load
│   │
│   ├── engine/
│   │   ├── gameEngine.js       ← Simulates individual games
│   │   ├── leagueManager.js    ← Standings, schedule, relegation
│   │   └── playerGenerator.js  ← Creates and ages players
│   │
│   ├── api/
│   │   └── claudeAgent.js  ← All Claude API calls (4 agents)
│   │
│   └── ui/
│       ├── dashboard.js    ← Main GM dashboard screen
│       ├── roster.js       ← Roster management screen
│       ├── trade.js        ← Trade desk screen
│       ├── draft.js        ← Draft day screen
│       └── news.js         ← Headlines and events feed
│
└── assets/
    └── style.css           ← Global styles
```

---

## The Four In-Game AI Agents

All run through `src/api/claudeAgent.js`:

| Agent | When it fires | What it does |
|---|---|---|
| **Commissioner** | Season start / end | Announces cap increases, relegation, rule changes |
| **Rival GMs** | Weekly during season | Proposes wacky trades based on their personality |
| **Headline Bot** | After each game sim | Generates funny post-game news stories |
| **Event Engine** | Random during season | Fires absurd one-off incidents |

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
2. **Signings** — sign/release free agents within salary cap
3. **Season** — sim 20 games; trades arrive, events fire, headlines generated
4. **Playoffs** — top 4 in your league, sim bracket
5. **Relegation** — bottom 2 drop, top 2 rise, 3rd vs 10th drama
6. **Off-season** — cap rises $2M, repeat

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
