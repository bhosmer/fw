# fw

A world without a size, in the browser: WebGL2, ray-marched, nested without end (every level is real geometry). No build step, no dependencies. One world: the arcology (a building after Soleri's Hexahedron, standing in a city plaza, made of halls: a lattice of rooms at every scale). Free flight; a tour.

## Where things are
- The state of the work, as data: `.claude/track/` (its own private repo, bhosmer/fw-track; the rest of `.claude/` is ignored by git, and this repo is public). Its `STATE.md` is loaded at every session start; change the state only with `node .claude/track/track.mjs` (`help` lists its commands), every step as you go. Current design choices, open work and decisions live there, not here. Basil's view of it: http://localhost:8650/ (`node .claude/track/serve.mjs`, kept running).
- How the code is put together, with its traps and how to check things: `docs/architecture.md`. Design notes: `.claude/design/`. The old ledger, frozen: `.claude/ledger-to-2026-11-03.md` (grep it; don't write to it).
- Dev server: `python3 serve.py 8642`. Tests: `npm test` (the tracking's check, unit, headless Chrome).

## Design
- An engine for exploring sculpted megastructures, not a replica of one building: nothing may depend on one building's particulars.
- Never add detail as more blocks: each ray step costs more for everything a cell must ask. Faces of any orientation are first-class.
- New forms harmonise with the world's rhythm: neither fussy shapes nor too much order; one at a time, judged by Basil. With a named reference image as the target, be faithful to it.
- A rendering problem is fixed in the rendering, without degrading the construction.

## Architecture
- Each part of a world is data, and both its copies (GLSL for drawing, JavaScript for flying and the tests) are written from it, as `src/spaces/town.js` does. Don't hand-write a new pair of twins.
- The twins answer the same questions (a level's distance; for a ray, how far it goes in its air, and the surface there) and must agree: distances never overstate; rays stay in air; pieces of air that join overlap, they don't just touch.
- A variant is a definition, opened by a link, not an edit. Nothing outside `src/spaces/` imports from it but `src/worlds.js`. Make parts cheap to swap and try.
- Fix fundamentally, not by patching. Minimise redundant code, special cases and patches. The code should be a faithful model of the domain. No compatibility code for what is gone.
- GLSL: keep shifts and modulos inline (a Mac compiler fault: B20); `P` is a macro, `out` and `half` are reserved; avoid loops the compiler unrolls, returns in loops and dynamically indexed local arrays (compile time).
- Comments in plain prose, accurate, in the style of the code around them.

## Process
- Subtle work: plan it in `.claude/design/`, have a fresh-eyes subagent review the plan (give it the code, not your conclusions), then build.
- Every chunk: a fresh-eyes review of the diff, and the whole `npm test`. For a change meant to keep things as they are, prove it: shader text equal, pictures byte-identical, flights identical.
- No change to the look or the feel of flying unless intended; say so whenever one happens. A judgement of look or speed that is Basil's comes with A/B links to try, each build tried headless first; he judges speed by trying it.
- When Basil reports something he sees, reproduce what he sees (his canvas, scheme, place, flight) before testing causes. A cause is a hypothesis until a test shows it; every claim carries its source.
- Anything deferred goes into the tracking as an item (`track.mjs add`). Say whether work is principled or a patch.
- Commit locally as you go; messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push without Basil's OK (Pages deploys from main). Ask before using other branches or `git worktree prune`. Never `git stash` to compare: use frozen copies (`git archive`).
- Never open an untried build in Basil's Chrome: a new shader freezes it while it compiles. Say so before benchmarking while he is looking: the GPU is shared.
- Unattended work: proceed on your own judgement, commit locally, leave him a summary, and check in rather than go quiet.
- Don't write to Claude Code's auto-memory: everything goes in the tracking. Don't read `.claude/archive/`.
- Talk to Basil in chat: one list of questions, merged.
