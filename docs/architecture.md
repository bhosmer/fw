# How fw is put together

As of 2026-10-29 (the architecture sweep). For the history of how the drawing came to be as it is, see rendering-plan.md.

## Worlds, as definitions

- `src/worlds.js`: the worlds there are (made when first asked for), named variants, and links: `index.html?variant&part.of.it=value#place`, with `&vs=other&vs.part=value` to compare two (V flips between them).
- `src/spaces/halls.js`: the halls, `makeHalls(changes)` from `HALLS`: the share of cells left solid, and the kinds of room, wall opening, slab opening and furniture as rows (each kind's share, and its shape), and what is otherwise at some levels (`byLevel`); both copies of the halls, the cell included, are written from them (`pieces`), after `families` has checked them.
- `src/spaces/arcology.js`: the arcology, `makeArcology(changes)` from `ARCOLOGY`: its `building` (`src/spaces/hexahedron.js`: the Hexahedron's numbers, edge treatment, column), the `halls` it is built of, its `relief` (two levels of pockets cut into the masses' faces) and its `town` (plans, densities, and the kinds of building: `src/spaces/town.js`, one catalogue from which both copies are written). A definition with changes is checked (`define` in `src/util.js`, and the arcology's own `check`) and frozen.

## One geometry, written twice

Each world answers, for a point at a level, its distance to that level's air, and for a ray, how far it goes in the piece of air it is in and the surface it meets there. It does so in GLSL (for drawing: the shader text is generated from the definition when the page loads) and in JavaScript (for flying and the tests: `cellAir`), on the same pieces: `src/pieces.js` and its GLSL twin in `src/shaders.js`. The two are kept in step by checks that compare them (`fw.check`, `fw.checkRays`, through the renderer's probe program: `src/debug.js`). Where a part is data (the town's buildings, the halls' kinds, the arcology's solids, its plaza, its ground, its openings, its town and its relief's decisions), both are written from it: the part's own writer (`write` in `town.js`, `pieces` in `halls.js`, `cityPieces`, `openingsPieces`, `townPieces` and `reliefPieces` in `arcology.js`) puts each language's functions together. `src/twin.js` checks a catalogue's expressions, in words both languages read the same way, and writes them out in each; it also holds what the writers write alike (`writer`, `planes`, `reask`, `arrays`, `unsigned`). Of the arcology, the relief is written once (its whole-number decisions, where the point is on a face, the backs of its cuts, a face's pockets and notches, and how far inside the solids without relief a point is: `bareIn`); still written by hand in both: carve (which faces' pockets a cell asks), the city's cell and the level dispatch.

## Flying

- `src/flight.js`: sensing (what is around us at every scale) and motion (how far the way ahead is open, each step, the trail).
- `src/arrival.js`: where a visit starts (somewhere new in a world).
- `src/position.js`: where we are, as digits at every level; each level's record (`levels`).
- `src/air.js`: asking a world what the shader asks of it, in JavaScript (`airAt`), and a gradient of such answers.
- `src/view.js`: which levels to draw, and the outer plane.
- `src/controls.js`, `src/pacing.js`: input, and frame pacing.

## Drawing

- `src/renderer.js`: each world's programs (the view; the older way and the probe, made when asked for) and its tables; the levels and the view given to them; each frame drawn and timed; the probe.
- `src/frame.js`: what each frame is drawn into, its gathering into the history (temporal antialiasing and upscaling) and its showing, smoothed; with their shaders.
- `src/look.js`: the tour's look, read back without waiting. `src/gl.js`: programs begun and finished (each finds its uniforms itself; its samplers get their texture units).
- `src/shaders.js`: the view shader's march and shading, the probe; `src/schemes.js`: colour schemes, and what a scheme may say (`SCHEME`), from which the shader's lights are declared and given their values.

## The tour

`src/pilot.js` (with what the tour asks of the flight: `awayFrom`, `outward`) and `src/planner.js`: to be redesigned (F13).

## The app

`src/main.js`: wiring, the frame loop, keys and buttons, links, and the `fw` console object.

## Checks and tools

- `tests/unit/*.test.js` (`node --test`): every world's properties (distances never overstate, rays stay in air), the variants and links, the town's catalogue, and more.
- `tests/browser/run.mjs` (headless Chrome): the shader against the JavaScript, pictures against goldens, flights, comparing.
- `bench/`: `cold.mjs` (a first visit's shader build), `warm.mjs` (build a link's shaders before it is opened), `bench.mjs`, `views.mjs`, `shoot.mjs`.
