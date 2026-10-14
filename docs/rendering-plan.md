# Rendering plan

Status: reviewed 2026-10-13 by an independent agent; the order of work below
is the reviewed one and supersedes the "Proposal" section, which is kept for
the reasoning. Steps 0, 1 and 2 are done.

## Order of work (after review)

0. **Done.** Stop waiting on the GPU every frame. The camera's clearance was
   read back synchronously, which made each frame wait for the last. The cell
   function now also exists in JavaScript (`cellAir` in `src/spaces/halls.js`)
   and the frame loop uses that. `fw.check()` compares it with the shader:
   agreement to 3e-7 over 200 positions x 16 levels.
1. **Done.** Carve a level as geometry only from 8 px per cell (was 2), fully
   by 24 (was 16); below that it is surface texture. Removes sub-pixel carving.
   GPU time: unchanged in open views, about 15-25% less skimming a wall.
2. **Done.** Exact ray stepping. Wherever a ray is, it is inside one convex
   piece of some level's air and stays in air until it leaves that piece, so
   it goes straight to the furthest such way out and looks again; if no level
   has air there, that way out was a surface, and its plane gives the normal.
   A space lists each piece's faces (`face`, `solidFace` in `shaders.js`;
   `roomReach` etc. in `halls.js`). The fade with distance now grows evenly
   with distance, so faces are planes that move at a constant rate and the
   way out is still a line meeting a plane. Solid levels are still skipped by
   the distance bound. The old sphere tracer is kept as `refProg`: key X
   switches, `fw.compare()` measures the difference in hit distance.
   Result over 40 random views: the new stepping is never nearer than the old
   by more than 2%; where it is further, the old one had stopped short (the
   smeared band toward a surface's horizon). No ray ran out of steps; the
   average was about 2 steps per pixel. GPU time 6-7 ms where the old took
   11-34 ms; at the test location below, 3 ms against 36-47 ms.
   Not done: the nine shared normals are not precomputed per ray (not needed
   at these step counts), and shading still uses the distance function for
   ambient occlusion and surface texture, which is now most of a frame.
3. Quarter-resolution cone pre-pass to start each ray near its hit.
4. Temporal anti-aliasing at full resolution (jitter, reproject, variance
   clip, depth rejection), built on the exact hit record from step 2.
5. Ambient occlusion: keep the distance-field version, spread its samples
   over frames.

Dropped: the polygon route, even as a reserve; screen-space ambient occlusion;
temporal upscaling (the pre-pass does that job without reconstruction).

(The test of whether evaluation cost was dominated by neighbouring pixels
taking different code paths was skipped: with about 2 evaluations per ray it
no longer decides anything.)

Test case for step 2 (reported 2026-10-13, fixed by it): at the mouth of a level-6 opening
in a large wall, looking along the wall. The camera's clearance is about 1e-9
of the wall's scale, and a ray leaving at 10 degrees to the wall gains only
17% in distance per step, about 20 steps per level, so it spends all 160 steps
getting away from where it started. Every pixel of the near wall (7% of the
frame) hits the cap and is shaded where it stopped, in mid-air: a smooth
smeared band with speckle. Location:
`#eyJGIjo2LCJmcmFjIjpbMC44MTc3MjkxNzk3NzQ2Njg2LDAuNjA5MDI3MzQ0NzI3OTk1MiwwLjM1MDk5ODUwOTA1MzAwOTMzXSwiZGlnaXRzIjpbWzAsWzEzLDE3LDJdXSxbLTEsWzIsMTcsOF1dLFstMixbMTcsMTcsMl1dLFstMyxbNiwxNywyMV1dLFstNCxbMTAsMTgsMjFdXSxbLTUsWzIxLDE2LDIwXV0sWy02LFsyLDE5LDRdXSxbLTcsWzIsMTksMTFdXSxbLTgsWzIsMTgsMjBdXSxbLTksWzUsMTYsMjFdXSxbLTEwLFs4LDE4LDIxXV0sWy0xMSxbMiwxOSwxMV1dLFstMTIsWzEwLDE1LDIxXV0sWy0xMyxbMTgsMTksMjFdXSxbMSxbMjAsNiwyMF1dLFsyLFsyMywxMiwxXV0sWzMsWzIzLDQsMTNdXSxbNCxbMjMsMTEsMjJdXSxbNSxbMjMsMCwyMV1dLFs2LFsyMywyMiw0XV1dLCJ5YXciOjUuNjA0NDc5OTk5OTk5OTY5NSwicGl0Y2giOi0wLjEwMDM5OTk5OTk5OTk5OTN9`

## Benchmarks

GPU timer, 1706x1458, M3 Max, after steps 0 and 1 (ms per frame):

| View | ms |
|---|---|
| Start room | 11 |
| Approaching an opening | 15 |
| Skimming a wall, three levels deep | 29 |
| Same place, turned to face the room | 15 |
| Looking back across a room from nine levels deep | 62 |

Use `python3 serve.py` for development, not `python3 -m http.server`: the
latter lets the browser reuse stale modules, which invalidated several earlier
comparisons.

---

# Original proposal (as sent for review)

## What this project is

"Fractal world": a browser 3D environment you fly through as a sizeless point.
Every surface, approached, opens into smaller built spaces, without limit, and
the room you start in is itself a speck in the wall of a larger room. There is
no gameplay; it is for exploring. The owner's priorities, in their words and in
order: keep the current mood (the 45-degree gables and the way diagonal cuts
slice open the rooms inside a wall are "key" to it); fix frame-rate drops and
aliasing; do it by getting the approach right, not by stacking patches.

## How it works today

- `src/position.js`: position is a path of base-R digits (R = 24) with no top
  or bottom level, plus a fraction inside the current "working level" F. F
  tracks the camera's clearance. `levels()` hands the shader, per level, the
  nearest lattice point (ints) and a small float offset, so distances to nearby
  features are exact at any depth. This has held up (tested to level +63) and
  is not in question.
- `src/spaces/halls.js`: the world is one GLSL function, `cellAir(L, f, id,
  seed)`: signed distance to the air of ONE cell, in units of its child cells.
  Air is a union of convex pieces, all bounded by axis-aligned or 45-degree
  planes on integer lattice coordinates: the room box, tunnels through each
  face (door, windows, arcade, fully open), slab openings, minus furniture.
  Variation is hashed per cell and per shared face.
- `src/shaders.js`: solid = intersection over all levels of each level's wall.
  `map()` loops levels coarse to fine and takes the max clearance. Levels fade
  in with screen size (air is shrunk by an offset until a cell is ~16 px), and
  a level too small to carve is drawn onto the surface as texture. Per-ray
  `gSolid[]` skips a level while the ray is known to be inside its solid.
  The march is plain sphere tracing, up to 160 steps, one sample per pixel.
  Shading: 3 extra `map()` calls for the normal, 4 for multi-scale ambient
  occlusion. Then an FXAA pass.
- `src/main.js`: a 16x1 GPU probe evaluates each level at the camera every
  frame (clearance sets speed, F, fog, and which levels are drawn, max 12).
  A governor lowers canvas resolution when frames run long. Draws only when
  something changed.

## Measured cost

GPU timer queries, 1706x1458 (one canvas pixel per CSS pixel on a 2x display),
Apple M3 Max, Chrome/ANGLE Metal. Earlier numbers in this project were about 5x
too low (successive full-screen draws to one target were being culled by the
tile-based GPU); these are from after that was fixed.

| View | ms/frame |
|---|---|
| Start room, looking across it | 9-13 |
| Approaching an opening in a wall | 15 |
| Grazing along a wall, three levels deep | 25-29 |
| Looking back across a room from nine levels deep | ~50 |

Observations from profiling:
- March is roughly 60-80% of a frame, shading the rest.
- Step counts are modest (mostly under 40) except for rays skimming a nearby
  surface, which run to the 160 cap.
- Back-of-envelope, one level evaluation costs several times what its
  arithmetic suggests (~500 operations estimated, ~4x that observed).
  Replacing integer divide/modulo with float arithmetic made no difference.
- Raising the level array size from 8 to 12 once appeared to cost a lot by
  itself, then did not after an unrelated fix; unresolved.
- Before the `gSolid` skip was made effective, enclosing levels evaluated on
  every step were over half the frame.

## Problems to solve

1. Frame rate: full resolution does not hold 60 fps in the heavier views, so
   the governor drops resolution and the picture goes soft.
2. Aliasing: one sample per pixel. FXAA helps straight high-contrast edges but
   not the fine repeating structure (facades of sub-pixel openings, the dense
   sliced surfaces on diagonals), which shimmers in motion.

## Proposal

Keep the distance-field world and the diagonals. Change how pixels are
produced, in three steps, measuring after each.

### Step 1: temporal anti-aliasing with upscaling

- Jitter each frame's rays by a sub-pixel offset (Halton sequence).
- View pass writes colour and hit distance to a float target.
- Resolve pass reprojects last frame's result using hit distance and the
  camera's change in orientation and position, clamps history to the 3x3
  neighbourhood of the new frame, and blends (about 10% new).
- Camera motion is already known in level-F cells per frame; when F changes
  the previous frame's distances are rescaled by R.
- When standing still, keep accumulating for a fixed number of frames, then
  stop drawing (today drawing stops immediately).
- Optionally render the view pass below output resolution and let the resolve
  reconstruct, replacing the current resolution governor's blunt downscale.
- The thread overlay moves to after the resolve. FXAA is removed if redundant.

Expected: properly smooth edges; freedom to shade fewer pixels per frame.
Known risk: ghosting at disocclusions; flicker where sub-pixel structure
defeats the neighbourhood clamp.

### Step 2: exact ray stepping

Replace "step by the safe distance" with "step to where the ray leaves the
piece of air it is in".

- Extend the space interface so a cell can answer, for a point and direction:
  if the point is in one of the cell's convex air pieces, how far the ray
  travels before leaving it (ray against that piece's planes); if the point is
  in the cell's solid, how far before the ray enters any air piece or leaves
  the cell.
- March: in air, advance by the largest exit distance among levels that have
  the point in air, then re-evaluate. A hit is an exit point at which no drawn
  level has air. In solid at a level, the entry distance replaces the
  spherical `gSolid` bound.
- Distance-based fade moves the planes by the same offset as today.
- Furniture is subtracted: travel is also limited by entry into it.

Expected: step count becomes the number of pieces a ray crosses, not a
convergence; skimming rays stop being special. Guess: 2-4x on the march.
Known risk: robustness at shared boundaries and corners (needing nudges that
interact with the exact-arithmetic scheme); unions of overlapping pieces;
more arithmetic per evaluation.

### Step 3: cheaper shading

- Normal: return the limiting plane's normal from the evaluation that
  produced the hit, instead of three more `map()` calls.
- Ambient occlusion: from the depth image at several radii (screen-space),
  in the resolve pass, instead of four more `map()` calls. The multi-scale
  look of the current ambient term is part of the mood and should survive.

## Alternatives considered

- Polygons with level-of-detail (chunked, instanced quads; hardware MSAA).
  Fastest, but clean only for grid-aligned geometry. Diagonals would need each
  sloped face drawn as a quad whose shader cuts holes by evaluating the cell
  function, with room interiors clipped behind it. Held in reserve as the
  hardest and riskiest route.
- Low-resolution cone-march pre-pass to give rays a head start.
- Baking cell templates into 3D textures (too many hashed combinations per
  cell as currently structured).
- Staying as is and making the geometry grid-aligned: rejected by the owner.

## Questions for the reviewer

1. Is keeping the per-pixel distance-field renderer the right call given the
   priorities, or is there a better architecture that keeps the diagonals?
2. Is the order right? Would you drop, replace or add a step?
3. Temporal AA in this setting: the scene is fine repeating structure at every
   scale, the camera's speed is proportional to clearance, and the working
   unit rescales by 24 at level changes. What will go wrong, and how would you
   set it up?
4. Is exact stepping sound as described, given unions of pieces per level,
   several levels at once, subtraction of furniture, and planes that shift
   with distance for level-of-detail? Is there a simpler formulation?
5. Is anything in the current shader structurally wasteful (see the gap
   between estimated and observed cost per level evaluation)?
6. Anything else you would do first.
