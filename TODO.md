# Hockey GM — Build Checklist

Work through phases in order. Each phase should be playable before moving on.

---

## Phase 1 — Foundation
> Architect agent leads. Goal: data structures and league exist in memory.

- [ ] Load `data/teams.json` into game state
- [ ] Build `playerGenerator.js` — generatePlayer(), generateRoster()
- [ ] Generate full 36-team world with rosters (20 players each)
- [ ] Build salary cap system — hard cap enforcement, release logic
- [ ] Build contract expiry logic (contractYears ticks down each season)
- [ ] Build `leagueManager.js` — generateSchedule() for 20-game season
- [ ] Build standings update logic (W/L/OTL/points/GD)
- [ ] Build save/load (localStorage)
- [ ] Build `main.js` — game init, state machine (preseason/season/playoffs/offseason)
- [ ] Console-log test: init a full season, verify standings make sense

**Done when:** You can start a new game and see a full 20-game schedule with
two valid rosters per game.

---

## Phase 2 — Simulation Engine
> Sim engineer agent leads. Goal: games simulate with believable results.

- [ ] Build `gameEngine.js` — simulateGame(home, away) → result
- [ ] Implement offense / defence / goalie rating calculation
- [ ] Implement Poisson goal distribution (use approximation, not real Poisson)
- [ ] Add home ice advantage (+3 offense)
- [ ] Add OT and SO resolution
- [ ] Build template-based highlight generator (no Claude API — fast)
- [ ] Sim full 20-game season, check standings look reasonable
- [ ] Build player aging logic (runs at season end)
- [ ] Build player improvement/decline logic (young/old players)

**Done when:** You can sim an entire 20-game season and the standings pass a
smell test (teams with better rosters win more often).

---

## Phase 3 — Content
> Content writer agent leads. Goal: all flavour text exists.

- [ ] Finalize `data/teams.json` — all 36 teams with full fields
- [ ] Build `data/player-names.json` — 200+ first names, 200+ last names
- [ ] Build `data/events.json` — 60+ random events (mix of types)
- [ ] Write all 6 GM personality descriptions for use in Claude prompts
- [ ] Write 30+ headline templates (player names injected at runtime)
- [ ] Write arena names for all 36 teams
- [ ] Write team "flavour" text used in Commissioner announcements

**Done when:** The game world feels like it has a personality before Claude
API is even turned on.

---

## Phase 4 — Interface
> UI designer agent leads. Goal: full playable UI in the browser.

- [ ] Build base HTML structure (`index.html`) with screen containers
- [ ] Build CSS design system (`assets/style.css`) — colours, typography, components
- [ ] Build **Dashboard** screen
- [ ] Build **Roster** screen with release action
- [ ] Build **News Feed** screen
- [ ] Build **Trade Desk** screen (pending offers + history)
- [ ] Build **Draft** screen (draft board + prospect cards)
- [ ] Build **Sim Controls** — next game / week / to playoffs
- [ ] Add screen router in `main.js`
- [ ] Wire all UI to game state (read-only for now is fine)
- [ ] Add game-over / championship / relegation screens

**Done when:** You can click through every screen and it looks like a real
(if basic) app.

---

## Phase 5 — Claude API Integration
> All agents review. Goal: the AI agents are live and the game is fun.

- [ ] Build `claudeAgent.js` with API wrapper function
- [ ] Wire **Headline Bot** — fires after every simulated game
- [ ] Wire **Event Engine** — fires randomly during season (1 per 3–4 games)
- [ ] Wire **Rival GMs** — trade offer fires 1–2× per 5 games
- [ ] Wire **Commissioner** — fires at season start/end
- [ ] Wire **Draft Scout** — generates draft class at off-season start
- [ ] Add error handling (API timeout → fallback text)
- [ ] Add API call rate limiting (don't fire too many at once)
- [ ] Playtest full season start to finish
- [ ] Balance check: does it feel fun? Is the relegation playoff tense?
- [ ] Bug hunt pass

**Done when:** You play a full season — draft, sim all 20 games, hit playoffs,
survive or get relegated — and it's genuinely fun.

---

## Stretch Goals (post-launch)
- [ ] Expand to 40-game season option
- [ ] Add player morale system
- [ ] Add coaching staff (passive bonuses)
- [ ] Add arena upgrades (home ice advantage boost)
- [ ] Add GM reputation score (affects free agent willingness to sign)
- [ ] Add historical records screen (all-time stats, past champions)
- [ ] Add "dark horse" player trait — hidden gem who breaks out mid-season
