# fw

A world without a size, in the browser: WebGL2, ray-marched, nested without end (every level is real geometry). No build step, no dependencies. Two worlds: the halls (a lattice of rooms at every scale) and the arcology (a building after Soleri's Hexahedron, standing in a city plaza, made of halls). Free flight; a tour.

## Where things are
- `.claude/ledger.md`: the state of the work. Read START HERE, Open items and the recent log before anything else (after a compaction too), and keep it current: every step, as you go.
- The plan: the artifact https://claude.ai/artifact/5iu5K4y3WQU14GuR1p6EjH ('Plan from here'; source `.claude/design/architecture-sweep.html`). Design notes: `.claude/design/`.
- How the code is put together: `docs/architecture.md`.
- Dev server: `python3 serve.py 8642`. Tests: `npm test` (unit + headless Chrome).

## Architecture
- Each part of a world is data, and both its copies (GLSL for drawing, JavaScript for flying and the tests) are written from it, as `src/spaces/town.js` does. Don't hand-write a new pair of twins.
- The twins answer the same questions (a level's distance; for a ray, how far it goes in its air, and the surface there) and must agree: distances never overstate; rays stay in air; pieces of air that join overlap, they don't just touch.
- A variant is a definition (`makeArcology`, `makeHalls`, `define`), opened by a link, not an edit. Nothing outside `src/spaces/` imports from it but `src/worlds.js`.
- Fix fundamentally, not by patching. Minimise redundant code, special cases and patches. The code should be a faithful model of the domain.
- No change to the look or the feel of flying unless intended; say so whenever one happens.
- GLSL: keep shifts and modulos inline (a Mac compiler fault: ledger B20); `P` is a macro, `out` and `half` are reserved; avoid loops the compiler unrolls and dynamically indexed local arrays (compile time).
- Comments in plain prose, accurate, in the style of the code around them.

## Process
- Subtle work: plan it in `.claude/design/`, have a fresh-eyes subagent review the plan, then build.
- Every chunk: a fresh-eyes review of the diff, and tests. For a change meant to keep things as they are, prove it: shader text equal, pictures byte-identical (`.claude/work-M/tools/ident.mjs`), flights identical (`fingerprint.mjs`).
- Anything deferred goes into the ledger's Open items.
- Commit locally as you go; messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push without Basil's OK. Ask before using other branches or `git worktree prune`; don't touch `../fw-A`, `../fw-B`, `../fw-C`. Never `git stash` to compare: use frozen copies (`git archive`).
- Prototypes and variants are tried headless: a new shader costs a GPU build in Basil's Chrome, which freezes it; never open an untried variant there.
- Don't write to Claude Code's auto-memory: everything goes in the ledger. Don't read `.claude/archive/`.
- Talk to Basil in chat: one list of questions, merged, not several.
