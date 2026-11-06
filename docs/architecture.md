# How fw is put together
<!-- budget: 15400 -->

One world, the arcology. What it should be: the brief (`.claude/track/design/brief.md`, private). How its parts came to be: the design notes beside it, one-world.md among them.

## Worlds, as definitions
<!-- files: src/worlds.js,src/util.js,src/spaces/halls.js,src/spaces/arcology.js,src/spaces/hexahedron.js,src/spaces/town.js,src/flight.js,src/view.js  budget: 2850  verified: 02fdb91 -->

- `src/worlds.js`: what a world's space provides (the one contract the engine reads), the world there is (the arcology, made when first asked for), its named variants, and links: `index.html?variant&part.of.it=value#place` (a link need not name the world), with `&vs=other&vs.part=value` to compare two (V flips between them); and how we fly and how frames are drawn, apart from the world (`flight.*`, `view.*` and their `vs.` forms: settings, `FLIGHT` in `src/flight.js`, `VIEW` in `src/view.js`).
- `src/spaces/halls.js`: the halls the arcology is built of, `makeHalls(changes)` from `HALLS`: the share of cells left solid, and the kinds of room, wall opening, slab opening and furniture as rows (each kind's share, and its shape; each kind takes its share of a cell's hash in order, the last what is left; a link sets one, as `halls.walls.door.share=0.3`, and shares adding up to more than all are refused), and what is otherwise at some levels (`byLevel`: level 0, the building's chambers seen at scale 0, has its own); both copies of the halls, the cell included, are written from them (`pieces`), after `families` has checked them. Also where a cell of the halls sits in its parent (`ancestorDigit`, finer than level 0) and where a visit stands in a room (`STANDING`).
- `src/spaces/arcology.js`: the arcology, `makeArcology(changes)` from `ARCOLOGY`: its `building` (`src/spaces/hexahedron.js`: the Hexahedron's numbers, edge treatment, column), the `halls` it is built of, its `relief` (two levels of pockets cut into the masses' faces), its `town` (plans, densities, how far its buildings keep inside the band's edge (`setback`: by default 5 units; `town.setback.by=0` stands them at the edge), and the kinds of building: `src/spaces/town.js`, one catalogue from which both copies are written) and its `plaza` (whether its air fades with distance as the rest of its level does: by default it does not, and `plaza.fades=true` makes the plaza fade too; where it does not, the space names the city's level as `openAir`, which the shader never leaves out, and a plaza cell away from the building answers its air as one piece). A definition with changes is checked (`define` in `src/util.js`, and the arcology's own `check`) and frozen. The arcology's space states the world's own facts (how its levels fade, its look, where its sky is, where somewhere new starts, and the place a first visit opens at: `first`) and takes the halls' where they are the halls'.

## One geometry, written twice
<!-- files: src/pieces.js,src/shaders.js,src/debug.js,src/twin.js,src/spaces/arcology.js,src/spaces/halls.js,src/spaces/town.js,src/spaces/relief.js,src/spaces/cover.js,src/util.js,src/flight.js,src/air.js,src/position.js  budget: 4400  verified: 28038c5 -->

The world answers, for a point at a level, its distance to that level's air, and for a ray, how far it goes in the piece of air it is in and the surface it meets there. It does so in GLSL (for drawing: the shader text is generated from the definition when the page loads) and in JavaScript (for flying and the tests: `cellAir`), on the same pieces: `src/pieces.js` (with the rules for writing a cell that keep the world exact at any depth) and its GLSL twin in `src/shaders.js`. The two are kept in step by checks that compare them (`fw.check`, `fw.checkRays`, through the renderer's probe program: `src/debug.js`). Where a part is data (the town's buildings, the halls' kinds, the arcology's solids, its plaza (and, one level finer, the cells outside the building that add no air of their own: `groundCell`), its openings and its town), both are written from it: the part's own writer (`write` in `town.js`, `pieces` in `halls.js`, `cityPieces`, `openingsPieces`, `townPieces` and `cellPieces` in `arcology.js`) puts each language's functions together. The arcology's relief is data once more removed: its whole-number decisions (`reliefPieces`, made in JavaScript only) are worked out once by its builder (`src/spaces/relief.js`) into pieces of air, each the intersection of whole-number planes on what is carried across levels (the axes, and the slants, its own among them), listed for the table's cells they meet, with a cover laid over the seams where they meet (`src/spaces/cover.js`: pieces in the union of the pieces they are made from, each asked only where its seam is near, but those joining the levels, asked always); both copies ask a cell's list in one loop written once (`listedCarve`), from the same rows (the shader's table `uRelief`, the JavaScript's Int32Array). The rows are built as the world is made (about two seconds), or read back from what the browser keeps (IndexedDB: `stored` in `src/util.js`, by a `digest` of everything they are built from), in the space's `prepare`. `src/twin.js` checks a catalogue's expressions, in words both languages read the same way, and writes them out in each; it also holds what the writers write alike (`writer`, `planes`, `reask`, `arrays`, `unsigned`). Of the arcology, every cell is written once: the relief (its listed pieces, `listedCarve`; and how far inside the solids without relief a point is: `bareIn`), the table's cells (`reliefCell`), the city's cell and the level dispatch (`city`, and `cell` in GLSL, `cellAir` in JavaScript: `cellPieces`). Both answer for a fade's state where one is given (each level's air shrunk back, and the parts that fade their own way: `fade` in `src/pieces.js`): the flight asks the world as it is, and the tests may give a state, as the march would, to ask it as drawn; the march's choice of the state is the shader's alone. What only one language has is said as such where it is written: in the shader, gRay's saving and restoring, and the colours (gSkin); in the JavaScript, the point along the slants set (`setPoint`) and the clips counted for the checks.

Two planes are the world's, not any level's, and are handled where levels are asked, written by hand in each language as the engine's own (the levels' split into cells, diagonals and slants is too): over the sky's plane there is only sky (the march and map in `src/shaders.js`, `clearanceAt` and `ahead` in `src/flight.js`); under the ground (the space's `ground`: the arcology's plaza floor) there is only solid, at every level, each level's air cut off at it where it is asked (`levelRay` in `src/shaders.js`, `airAt` in `src/air.js`), as far under us as each level's record says (`ground`, from `groundHeight` in `src/position.js`). A browser check holds the two cuts together on the floor.

## Flying
<!-- files: src/flight.js,src/arrival.js,src/place.js,src/position.js,src/air.js,src/view.js,src/controls.js,src/pacing.js  budget: 1400  verified: e2e8c7d -->

- `src/flight.js`: sensing (what is around us at every scale, after every move: what the view is drawn from) and motion (how far the way ahead is open, each step, the trail), and which way we face.
- `src/arrival.js`: somewhere new (where N takes us).
- `src/place.js`: a place in a link (the URL's hash; it names no world): read and checked whole, written, and gone to (as a first visit goes to the space's `first`).
- `src/position.js`: where we are, as digits at every level; each level's record (`levels`).
- `src/air.js`: asking the world what the shader asks of it, in JavaScript (`airAt`), and a gradient of such answers.
- `src/view.js`: from the flight and how the view is shown: which levels to draw (those the flight looks at as a rule, and coarser ones whose air is in sight, as far up as `view.fit`, and further up the room we are in, zoomed about the corner of it we are near: `zoomed` in `src/position.js`; but not those the space draws only near the level we work at, `nearOnly`), the outer plane (for such a level that cannot be drawn), the camera (how the screen maps to rays), the view as drawn (`makeView`) and its redraw key (`viewKey`).
- `src/controls.js`, `src/pacing.js`: input (which turns the flight), and frame pacing.

## Drawing
<!-- files: src/renderer.js,src/frame.js,src/look.js,src/gl.js,src/shaders.js,src/schemes.js  budget: 1100  verified: eb72ec5 -->

- `src/renderer.js`: the programs of the world drawn, and of one compared with it (the view; the older way and the probe, made when asked for), and their tables; the levels and the view given to them; each frame drawn and timed; the probe.
- `src/frame.js`: what each frame is drawn into, its gathering into the history (temporal antialiasing and upscaling) and its showing, smoothed; with their shaders. History cannot mend boil at a low upscale: the samples are too sparse to gather. The lever there is the shader's speed.
- `src/look.js`: the tour's look, read back without waiting. `src/gl.js`: programs begun and finished (each finds its uniforms itself; its samplers get their texture units).
- `src/shaders.js`: the view shader's march and shading, the probe; `src/schemes.js`: colour schemes, and what a scheme may say (`SCHEME`), from which the shader's lights are declared and given their values.

## The tour
<!-- files: src/pilot.js,src/planner.js  budget: 200  verified: f78846c -->

`src/pilot.js` (with what the tour asks of the flight: `awayFrom`, `outward`) and `src/planner.js`: to be redesigned (F13).

## The app
<!-- files: src/main.js  budget: 150  verified: f78846c -->

`src/main.js`: wiring, the frame loop, keys and buttons (their legend: `index.html`), links, the HUD, and the `fw` console object.

## Checks and tools
<!-- files: tests/,bench/  budget: 800  verified: 05bc585 -->

- `tests/unit/*.test.js` (`node --test`): the world's properties, from somewhere new (`elsewhere`) and from inside the building (distances never overstate, rays stay in air), the halls' catalogue on its own (`halls.test.js`), the variants and links, the town's catalogue, and more.
- `tests/browser/run.mjs` (headless Chrome): the shader against the JavaScript, pictures against goldens, flights, comparing.
- `bench/`: `cold.mjs` (a first visit's shader build), `warm.mjs` (build a link's shaders before it is opened), `bench.mjs` (with `timing.mjs`: GPU timings from fw.bench, those the GPU does not give taken again and counted), `views.mjs`, `shoot.mjs`.

## Traps, and how to look
<!-- files: src/twin.js,src/shaders.js,src/debug.js,src/main.js,tests/,bench/  budget: 4400  verified: eb72ec5 -->

**GLSL.** Chrome on macOS compiles through ANGLE to Metal, and its compiler has a fault (B20): a value shifted right by exactly 16 (or divided by 65536), then taken `%` or `/` a constant that is not a power of two, comes out as garbage when the shift and the modulo meet only once a function is inlined; a `min()` around it is then dropped. Written inline, through a temporary, or with a divisor the compiler cannot know, it is right; so the writers keep shifts and modulos inline (`glsl` in `src/twin.js`), and a browser check compares the town's shapes in both languages. `P` is a macro; `out` and `half` are reserved words. Compile time, not speed, is what loops and arrays cost: loops the compiler can bound are unrolled, and returns inside loops and dynamically indexed local arrays blow it up; so where the openings' windows are asked, the shader loops over the set bits of a mask (`lowBit`).

**The shader cache.** Chrome strips comments before it looks a shader up, and macOS keeps the compiled Metal pipelines keyed by the source after translation, where an unused constant is gone; so a shader meant to miss the caches needs a change in what its code does, a number it uses (as `bench/cold.mjs` does: a test of a uniform against it in `main`). Many large variants evict each other from the Metal cache, so one variant tried after several may build cold again.

**Reloading.** Going to the same URL with a new hash is a same-document navigation and keeps the old code: reload for real. A picture judged in a browser that has not been hard-refreshed may be of the old build.

**Timing on the GPU.** The GPU is shared with whatever else the machine draws, Basil's browser included, so a timing is provisional until it is repeated on an idle machine. Prove a difference with paired runs, an A/A pair as a control (the scratch tool gpupair in .claude/work-M/tools does this), and a cold build, and bench frozen copies against frozen copies, never the live checkout as one side. Per-pass timer queries on ANGLE's Metal time the whole frame, so they say nothing about a pass. What the viewer feels is the resolution held through a scripted flight. `fw.snap` sets `lodH` to its picture's own height, so a picture smaller than the canvas is drawn with coarser detail than the app's: patch it for a fair comparison.

**Looking at an artefact.** `bench/shoot.mjs` draws in the alhambra scheme unless `SCHEME` says otherwise (the app's HUD names the scheme for 2 s after a change), at `W` x `H`, and draws another tree when `FW_ROOT` names it (a scratch copy with one mechanism switched off). To find what an artefact is, compare what the rays of pixels on it and beside it meet (level, normal, distance, the lighting's terms). Before calling a pixel geometry, compare the exact stepping with the old one there (`fw.compare`; `fw.reference = true` draws with the old). A true reference draws every level whatever its size: the grazing skip off (`fw.debug = 2`, skip nothing) and the fading off (there is no switch for it: a scratch copy). Measure an artefact as it is described, frame to frame, not as an average over the frame.

**Checks that sample.** A sampled overlap check misses slivers: check overlaps exactly, at the vertices.

**Modules in Node.** Importing a module again with a `?query` reuses the modules it imports (`hexahedron.js` among them), so layouts to compare are tested in separate trees or processes. A camera placed by hand needs `flight.begin()` before it senses.

**The pictures.** `npm test` runs the tracking's check (where `.claude/track` is there), the unit tests and the headless-Chrome checks. The reference pictures in `tests/golden/` depend on the machine that drew them: `npm run test:pictures` draws them again, and they must be looked at before they are kept.
