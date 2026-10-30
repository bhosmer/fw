# How fw is put together

As of 2026-10-29 (the architecture sweep); since 2026-10-30, one world, the arcology (the halls world went: .claude/design/one-world.md). For the history of how the drawing came to be as it is, see rendering-plan.md.

## Worlds, as definitions

- `src/worlds.js`: what a world's space provides (the one contract the engine reads), the world there is (the arcology, made when first asked for), its named variants, and links: `index.html?variant&part.of.it=value#place` (a link need not name the world), with `&vs=other&vs.part=value` to compare two (V flips between them); and how we fly and how frames are drawn, apart from the world (`flight.*`, `view.*` and their `vs.` forms: settings, `FLIGHT` in `src/flight.js`, `VIEW` in `src/view.js`).
- `src/spaces/halls.js`: the halls the arcology is built of, `makeHalls(changes)` from `HALLS`: the share of cells left solid, and the kinds of room, wall opening, slab opening and furniture as rows (each kind's share, and its shape), and what is otherwise at some levels (`byLevel`: level 0, the building's chambers seen at scale 0, has its own); both copies of the halls, the cell included, are written from them (`pieces`), after `families` has checked them. Also where a cell of the halls sits in its parent (`ancestorDigit`, finer than level 0) and where a visit stands in a room (`STANDING`).
- `src/spaces/arcology.js`: the arcology, `makeArcology(changes)` from `ARCOLOGY`: its `building` (`src/spaces/hexahedron.js`: the Hexahedron's numbers, edge treatment, column), the `halls` it is built of, its `relief` (two levels of pockets cut into the masses' faces), its `town` (plans, densities, how far its buildings keep inside the band's edge (`setback`: by default 5 units; `town.setback.by=0` stands them at the edge, as they were), and the kinds of building: `src/spaces/town.js`, one catalogue from which both copies are written) and its `plaza` (whether its air fades with distance as the rest of its level does: by default it does not, and `plaza.fades=true` is the fading plaza as it was; where it does not, the space names the city's level as `openAir`, which the shader never leaves out, and a plaza cell away from the building answers its air as one piece). A definition with changes is checked (`define` in `src/util.js`, and the arcology's own `check`) and frozen. The arcology's space states the world's own facts (how its levels fade, its look, where its sky is, where a visit starts) and takes the halls' where they are the halls'.

## One geometry, written twice

The world answers, for a point at a level, its distance to that level's air, and for a ray, how far it goes in the piece of air it is in and the surface it meets there. It does so in GLSL (for drawing: the shader text is generated from the definition when the page loads) and in JavaScript (for flying and the tests: `cellAir`), on the same pieces: `src/pieces.js` (with the rules for writing a cell that keep the world exact at any depth) and its GLSL twin in `src/shaders.js`. The two are kept in step by checks that compare them (`fw.check`, `fw.checkRays`, through the renderer's probe program: `src/debug.js`). Where a part is data (the town's buildings, the halls' kinds, the arcology's solids, its plaza, its ground, its openings, its town and its relief's decisions), both are written from it: the part's own writer (`write` in `town.js`, `pieces` in `halls.js`, `cityPieces`, `openingsPieces`, `townPieces`, `reliefPieces` and `cellPieces` in `arcology.js`) puts each language's functions together. `src/twin.js` checks a catalogue's expressions, in words both languages read the same way, and writes them out in each; it also holds what the writers write alike (`writer`, `planes`, `reask`, `arrays`, `unsigned`). Of the arcology, every cell is written once: the relief (its whole-number decisions, where the point is on a face, the backs of its cuts, a face's pockets and notches, which faces' pockets a cell asks, and how far inside the solids without relief a point is: `bareIn`), the table's cells (`reliefCell`), the city's cell and the level dispatch (`city`, and `cell` in GLSL, `cellAir` in JavaScript: `cellPieces`). What only one language has is said as such where it is written: in the shader, its fading with distance, and gRay's saving and restoring; in the JavaScript, the point along the slants set (`setPoint`) and the clips counted for the checks.

## Flying

- `src/flight.js`: sensing (what is around us at every scale, after every move: what the view is drawn from) and motion (how far the way ahead is open, each step, the trail), and which way we face.
- `src/arrival.js`: where a visit starts (somewhere new).
- `src/place.js`: a place in a link (the URL's hash; it names no world): read and checked whole, written, and gone to.
- `src/position.js`: where we are, as digits at every level; each level's record (`levels`).
- `src/air.js`: asking the world what the shader asks of it, in JavaScript (`airAt`), and a gradient of such answers.
- `src/view.js`: from the flight and how the view is shown: which levels to draw, the outer plane, the camera (how the screen maps to rays), the view as drawn (`makeView`) and its redraw key (`viewKey`).
- `src/controls.js`, `src/pacing.js`: input (which turns the flight), and frame pacing.

## Drawing

- `src/renderer.js`: the programs of the world drawn, and of one compared with it (the view; the older way and the probe, made when asked for), and their tables; the levels and the view given to them; each frame drawn and timed; the probe.
- `src/frame.js`: what each frame is drawn into, its gathering into the history (temporal antialiasing and upscaling) and its showing, smoothed; with their shaders.
- `src/look.js`: the tour's look, read back without waiting. `src/gl.js`: programs begun and finished (each finds its uniforms itself; its samplers get their texture units).
- `src/shaders.js`: the view shader's march and shading, the probe; `src/schemes.js`: colour schemes, and what a scheme may say (`SCHEME`), from which the shader's lights are declared and given their values.

## The tour

`src/pilot.js` (with what the tour asks of the flight: `awayFrom`, `outward`) and `src/planner.js`: to be redesigned (F13).

## The app

`src/main.js`: wiring, the frame loop, keys and buttons, links, and the `fw` console object.

## Checks and tools

- `tests/unit/*.test.js` (`node --test`): the world's properties, from first visits and from inside the building (distances never overstate, rays stay in air), the halls' catalogue on its own (`halls.test.js`), the variants and links, the town's catalogue, and more.
- `tests/browser/run.mjs` (headless Chrome): the shader against the JavaScript, pictures against goldens, flights, comparing.
- `bench/`: `cold.mjs` (a first visit's shader build), `warm.mjs` (build a link's shaders before it is opened), `bench.mjs`, `views.mjs`, `shoot.mjs`.
