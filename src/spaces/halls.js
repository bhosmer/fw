// "Halls": a lattice of built rooms, each of whose walls, floors and
// furnishings is in turn a lattice of smaller rooms.
//
// A space is a description of ONE cell, in lattice units where the cell spans
// 0..R and one unit is a child cell. The engine stacks that description at
// every scale. What a space provides:
//
//   R              children per cell edge
//   glsl           float cell(ivec3 L, vec3 f, ivec3 id, uint seed, int level,
//                             out float reach, out vec3 nrm)
//                  signed distance to the cell's air (negative inside air) at
//                  the point L + f. It may understate a distance but must
//                  never overstate one, on either side of the surface.
//                  When gRay is set it also answers for a ray: if the point
//                  is in air, reach is how far the ray goes before leaving
//                  the piece of air it is in (and nrm the surface there);
//                  otherwise reach is negative. See "Rays" below. The id
//                  of the cell's parent is in gUp.
//   cellAir        the same in JavaScript (see below), given (L, f, id,
//                  seed, dg, level, up, ray), up the parent's id; the ray
//                  ({ dir }, or none) told how far it goes (see hallsAir)
//   volume         optionally, a table the space looks things up in rather
//                  than work them out: { size, data, words }, data a
//                  Uint32Array of `words` numbers (2 or 4) for each of
//                  size[0] * size[1] * size[2] cells, x fastest; in the
//                  shader, the usampler3D uVolume
//   tables         optionally, more tables, 2D: [{ name, size, data }], data
//                  an Int32Array of four numbers for each of size[0] *
//                  size[1], x fastest; in the shader, the isampler2D of that
//                  name (declared for it)
//   maxInterior    largest clearance any point in a cell's air can have, as a
//                  fraction of the cell
//   longestWay     the longest way through any one convex piece of a cell's
//                  air, in cells
//   close          how far (fraction of the cell) air is shrunk to fade a level
//                  out with distance
//   openAir        optionally, the one level some of whose air is open at
//                  every distance (none here): its features have no bound,
//                  where maxInterior and longestWay bound every other
//                  level's. The shader does not leave it out for being small
//                  or far itself (a coarser level's bound may still end a
//                  step's asking before it, as for any level); the space
//                  fades the rest of it its own way (see gScale in
//                  shaders.js), and when that is gone leaves only the open
//                  air and what stands in it, as grown as it grows
//   openArea       roughly what fraction of a surface is openings
//   ancestorDigit  where a cell sits inside its parent when nothing says
//                  otherwise (must be somewhere solid in the parent)
//   palette, sky, fogK, start
//   ground         the world has a top: above one horizontal plane there is
//                  only open sky. This says where: the plane is this many
//                  level-0 cells up from the floor of the level -1 cell that
//                  ancestorDigit leads to. Being on a cell boundary of level
//                  0, it leaves the rooms under it their roofs.
//   skyPlane       optionally, in place of ground: the plane's height as a
//                  digit at each level j <= 0 (in the cells of level j), to be
//                  compared with ours digit by digit; where our digits are
//                  the default ones, those of the levels coarser than any
//                  we have been elsewhere at must cancel
//   skyClear       how far under the plane, in level-0 cells, it is open air
//                  everywhere (optional; none here)
//   sunReach       how far under the ground plane, in level-0 cells, there
//                  can be open air the sun shines into (optional; none here)
//   zenith, roof   the sky's colour overhead; the colour of the ground seen
//                  from above
//
// Rules for cellAir that keep the world exact at any depth:
//   - put every feature on integer lattice coordinates, with faces that are
//     axis-aligned or at 45 degrees in a coordinate plane
//   - always form distances as float(L - anchor) + f, never float(L) + f - anchor
//   - form the distance to a 45-degree plane with diag(), never from the f of
//     two axes: close to the plane those cancel
//   - when choosing which of several features a point is nearest, go by L + f,
//     not L: a wrong choice overstates the clearance and rays step into solid
// A feature aligned this way also never slices a child cell in half, so every
// surface of a room is a clean facade of the rooms one level down.
//
// Pieces. A cell's air is a union of convex pieces (the room, a tunnel
// through each face) less some convex solids (furniture). Each piece is
// written once, as the planes that bound it: airPiece() then airPlane() for
// each (or solidPiece(), solidPlane() and solidDone() for a solid). From
// those the engine has both the piece's distance and, for a ray, where it
// leaves the piece or strikes the solid, so the two always agree; and it
// shrinks or grows everything with distance. The JavaScript below is the
// same, piece for piece, on the same pieces (src/pieces.js). Rules:
//   - pieces of one cell that join must overlap, not just touch
//   - a solid may only stand in the room piece, clear of every tunnel
//   - a tunnel may run on into the next cell, where that cell's own
//     description of it must agree

import { hash32, hashCell, wrapId as wrapIdR, glf, hexu, define, keyed, frozen } from '../util.js';
import * as P from '../pieces.js';
import * as twin from '../twin.js';

const { h01 } = P;

export const R = 24; // children per cell edge
const wrapId = (id) => wrapIdR(id, R);
export const M = 3; // half the wall thickness between two rooms
const HLO = 12; // ceiling height of a low room (see rooms in HALLS)

// What the halls make of a cell's hashes, in one place for both copies (and
// for the planner, and the arcology's light wells): each choice is a hash of
// the cell, salted for what it chooses, as a number from 0 to 1, which picks
// one of the kinds of each part in order, each taking its share of the
// numbers (the last, what is left). The first kind of the walls, slabs and
// furniture is nothing there (a wall with no opening, a solid slab, an
// empty room). The halls' pieces, in both languages, are written from the
// kinds (see pieces below). Sizes are lattice units; a size may be an
// expression (see check in twin.js) in C, M, R, HLO, FAR (so far off it is
// never met: no gable, no top, no cut), and the cell's hash h, by its
// helpers bit(h, n), field(h, n, m) and among(h, n) (one of n, 0 to n - 1);
// and div, min and max.
export const HALLS = {
  solid: 0.65, // the share of cells left solid, with no room
  // Rooms, by their ceilings' height over the floor: low, or tall, filling
  // the cell. (A cell with no room is measured as a room filling it.)
  rooms: {
    low: { share: 0.65, high: 'HLO' },
    tall: { high: 'R - 2 * M' },
  },
  salt: { built: 0x3c6ef372, slab: 0x967a889b, furniture: 0x51ed270b, wallX: 0x68bc21eb, wallZ: 0x02e5be93 },
  // An opening through a wall, as a tunnel from room to room (see TUNNEL),
  // one in each of so many equal bays across the wall (a row of them, each
  // in the middle of its bay: the one the point is across from is the
  // nearest), or one in the whole wall, at so far from its middle; its half
  // width; its sill over the floor; how far its sides rise before a
  // 45-degree gable closes it; and a flat top over its sill.
  walls: {
    none: { share: 0.24 },
    // A door, in one of three places along the wall.
    door: { share: 0.28, bays: 1, at: '(among(h, 3) - 1) * 5', half: 2, sill: 0, rise: 5, top: 'FAR' },
    // A row of three windows.
    windows: { share: 0.16, bays: 3, at: 0, half: 1, sill: 4, rise: 3, top: 'FAR' },
    // An arcade of three arches.
    arcade: { share: 0.16, bays: 3, at: 0, half: 2, sill: 0, rise: 6, top: 'FAR' },
    // No wall at all: the two rooms run together.
    open: { bays: 1, at: 0, half: 'C - M', sill: 0, rise: 'FAR', top: 'HLO' },
  },
  // An opening through a slab (see HOLE), from the least open to the most: a
  // square, its half width, its corners cut at 45 degrees so far from its
  // middle.
  slabs: {
    solid: { share: 0.66 },
    // An octagonal oculus.
    oculus: { share: 0.22, half: 3, cut: 4 },
    // A square light well.
    well: { half: 6, cut: 'FAR' },
  },
  // What stands in a room: a box ([x0, x1], [z0, z1], [y0, y1], from where
  // it stands, y from the floor) or a diamond (its half width, floor to
  // ceiling). It stands at one place [x, z], or, quartered, there and in
  // each other quarter of the room, as in a mirror across the room's middle
  // each way. Where turn holds, x and z are exchanged. upTo: the most open
  // kind of slab it may have under it, and over it. blocks: it stands in the
  // way across the room, as piers do (the tour goes round it: see planner).
  furniture: {
    none: { share: 0.4 },
    // Four diamond piers, floor to ceiling.
    piers: { share: 0.22, upTo: { under: 'oculus', over: 'oculus' }, at: [7, 7], quartered: true, turn: 'false', diamond: 2, blocks: true },
    // Two rows of benches, running along x or z.
    benches: { share: 0.2, upTo: { under: 'solid', over: 'well' }, at: [6, 8], quartered: true, turn: 'bit(h, 5) == 1', box: [[0, 5], [0, 1], [-1, 1]], blocks: false },
    // A kiosk in the middle of the floor.
    kiosk: { upTo: { under: 'solid', over: 'well' }, at: ['C', 'C'], quartered: false, turn: 'false', box: [[-2, 2], [-2, 2], [-1, 3]], blocks: false },
  },
};
// And what is otherwise at some levels: for each level given (as a whole
// number, written: '-1'), changes there to any of the above but the salts,
// to the halls as defined (byLevel: { '-1': { solid: 0.8 } }). Levels are
// the arcology's (-1 is the building's cells). At level 0, the building's
// chambers seen at scale 0: nine cells in ten rooms and almost no blank
// walls, the rest of the walls open (Basil, 2026-10-30: ledger F11);
// halls.byLevel.0.solid=0.65&halls.byLevel.0.walls.none.share=0.24 is that
// level as it was.
HALLS.byLevel = keyed(['salt'], { 0: { solid: 0.1, walls: { none: { share: 0.02 } } } });
frozen(HALLS);
const FAR = 1000;
// The longest way through any one piece of a cell's air, and the largest
// clearance in it (families checks the kinds keep to them; the arcology's
// own bounds, its space's longestWay and maxInterior, are no less).
const LONGEST_WAY = 1.4, MAX_INTERIOR = 0.375;

// The words the kinds are written in (see twin.js): the shared helpers, and
// among; and the names they may use, with their values.
const LANG = {
  name: 'halls',
  hashes: ['h'],
  hashed: ['bit', 'field', 'among'],
  helpers: {
    ...twin.HELPERS,
    among: {
      n: 2,
      args: ['hash', 'int'],
      all: (n) => Array.from({ length: n }, (_, i) => i),
      glsl: ([h, n]) => twin.HELPERS.div.glsl([`${twin.HELPERS.field.glsl([h, '0', '256'])} * (${n})`, '256']),
      js: '(x, n) => Math.floor(((x & 255) * n) / 256)',
      checked: "(x, n) => { if (!(n > 0 && n <= 256)) throw new Error('among(' + n + ')'); return Math.floor(((x & 255) * n) / 256); }",
    },
  },
};
const NAMES = Object.fromEntries([
  ...Object.entries({ C: R / 2, M, R, HLO, FAR }).map(([n, value]) => [n, { kind: 'int', value }]),
  ['true', { kind: 'bool', value: true }],
  ['false', { kind: 'bool', value: false }],
]);

// The pieces the halls are made of, as planes (see planes in twin.js), in
// the names their functions give them (below). A wall's opening: a tunnel
// along a (the wall's normal, ea), x across the wall (eu) from the
// opening's middle and yy up from its sill, which reaches one unit into our
// own room and stops at the neighbour's; p is the pair of axes (u, y), for
// diag().
const TUNNEL = [
  { span: ['a', 'fa', 'high ? R - M - 1 : -M', 'high ? R + M : M + 1', 'ea'] },
  { span: ['x', 'fu', '-hw', 'hw', 'eu'] },
  { span: ['yy', 'fy', '0', 'top', 1] },
  { diag: ['p', 1, 1, 'cu', 'M + y0', 'sp + hw'], axes: ['eu', 1] },
  { diag: ['p', -1, 1, 'cu', 'M + y0', 'sp + hw'], axes: ['eu', 1] },
];
// A slab's opening, from y0 to y1 (see slabOpening), w its half width, its
// corners cut dg from its middle.
const HOLE = [
  { span: ['L.y', 'f.y', 'y0', 'y1', 1] },
  { span: ['L.x - C', 'f.x', '-w', 'w', 0] },
  { span: ['L.z - C', 'f.z', '-w', 'w', 2] },
  { corners: [2, 'C', 'C', 'dg'], axes: [0, 2] },
];
// The room: a box H high (less whatever stands in it).
const ROOM = [
  { span: ['L.x', 'f.x', 'M', 'R - M', 0] },
  { span: ['L.z', 'f.z', 'M', 'R - M', 2] },
  { span: ['L.y', 'f.y', 'M', 'M + H', 1] },
];

// What each part's kinds have (beyond a share), and what each holds: a
// size (a whole number, or an expression giving one), a condition (an
// expression giving true or false), a count (a whole number over 0), or as
// it says; of the parts in a list, one. nothing: the first kind of the part
// is nothing there, and has only its share.
const FORMS = {
  rooms: { high: 'size' },
  walls: { nothing: true, bays: 'count', at: 'size', half: 'size', sill: 'size', rise: 'size', top: 'size' },
  slabs: { nothing: true, half: 'size', cut: 'size' },
  furniture: { nothing: true, upTo: 'upTo', at: 'place', quartered: 'yes', turn: 'condition', shape: [['box', 'box'], ['diamond', 'size']], blocks: 'yes' },
};
// (Every value an expression of a kind's, or a number, can have; and its
// kind, int or bool: see check in twin.js.)
const values = (x, where) => (typeof x === 'number' ? { kind: Number.isInteger(x) && Math.abs(x) < 2 ** 31 ? 'int' : 'number', values: [x] } : twin.check(LANG, x, NAMES, where));

// (A share's threshold: see pieces.js.)
const { threshold } = P;

// Each part's kinds in order, checked, each with the number below which it
// (or one before it) is chosen (to; the last, none).
function families(spec) {
  const out = {};
  for (const part of Object.keys(FORMS)) {
    const bad = (what) => {
      throw new Error(`halls: ${part}: ${what}`);
    };
    const names = Object.keys(spec[part]);
    if (names.length < 2) bad('fewer than two kinds');
    let sum = 0;
    out[part] = names.map((name, i) => {
      const k = spec[part][name], last = i === names.length - 1;
      if (last && 'share' in k) bad(`the last kind, ${name}, takes what is left: it has no share`);
      if (!last && !(typeof k.share === 'number' && k.share >= 0)) bad(`${name}: a share of ${JSON.stringify(k.share)}`);
      // (Rounded: 0.24 + 0.28 + 0.16 + 0.16 is not quite 0.84.)
      if (!last) sum = +(sum + k.share).toPrecision(12);
      return { name, ...k, to: last ? null : threshold(sum) };
    });
    if (sum > 1) bad(`shares adding up to ${sum}, more than all`);
    // (Each kind's parts, as the part's form has them, each holding what it
    // should: of a list, the one the kind has.)
    const { nothing, ...form } = FORMS[part];
    for (const k of out[part]) {
      const where = `${part}.${k.name}`, has = {};
      if (!(nothing && k === out[part][0]))
        for (const [f, holds] of Object.entries(form)) {
          if (!Array.isArray(holds)) has[f] = holds;
          else {
            const one = holds.filter(([g]) => Object.hasOwn(k, g));
            if (one.length !== 1) bad(`${k.name}: one of ${holds.map(([g]) => g).join(', ')}`);
            has[one[0][0]] = one[0][1];
          }
        }
      for (const f of Object.keys(k)) if (!['name', 'share', 'to'].includes(f) && !Object.hasOwn(has, f)) bad(`${k.name} has ${f}, which ${Object.keys(has).length ? `is not among ${Object.keys(has).join(', ')}` : 'a kind of nothing has not'}`);
      for (const [f, holds] of Object.entries(has)) {
        const v = k[f];
        if (v === undefined) bad(`${k.name} has no ${f}`);
        const size = (x) => values(x, where).kind === 'int';
        const ok =
          holds === 'size' ? size(v)
          : holds === 'count' ? Number.isInteger(v) && v > 0
          : holds === 'condition' ? values(v, where).kind === 'bool'
          : holds === 'yes' ? typeof v === 'boolean'
          : holds === 'place' ? Array.isArray(v) && v.length === 2 && v.every(size)
          : holds === 'box' ? Array.isArray(v) && v.length === 3 && v.every((s) => Array.isArray(s) && s.length === 2 && s.every((x) => typeof x === 'number' && size(x)) && s[0] < s[1])
          : holds === 'upTo' ? Object.keys(v).join() === 'under,over' && Object.values(v).every((s) => Object.hasOwn(spec.slabs, s))
          : false;
        if (!ok) bad(`${k.name}: its ${f}, ${JSON.stringify(v)}, is not ${{ size: 'a whole number', count: 'a whole number over 0', condition: 'true or false', yes: 'true or false', place: '[x, z], whole numbers', box: '[[x0, x1], [z0, z1], [y0, y1]], whole numbers', upTo: '{ under, over }, kinds of slab' }[holds]}`);
      }
    }
  }
  // (A room fits its cell, no lower than a low room: see unseen.)
  for (const k of out.rooms) if (!values(k.high, `rooms.${k.name}`).values.every((x) => x >= HLO && x <= R - 2 * M)) throw new Error(`halls: rooms: ${k.name}: its height, ${k.high}, is not between HLO and R - 2 * M`);
  // (A row's openings each in the middle of its bay, the bays' middles whole
  // numbers, and each opening inside its bay: then the one in the bay the
  // point is across from is the nearest; one alone, inside the wall.)
  for (const k of out.walls.slice(1)) {
    const bad = (what) => {
      throw new Error(`halls: walls: ${k.name}: ${what}`);
    };
    const pitch = (R - 2 * M) / k.bays, at = values(k.at, `walls.${k.name}`).values, half = values(k.half, `walls.${k.name}`).values;
    if (!Number.isInteger(pitch / 2)) bad(`${k.bays} bays have no whole middles`);
    if (k.bays > 1 && !at.every((x) => x === 0)) bad('a row stands in the middle of its bays (at 0)');
    // (In a row, not quite to the bay's side: two that met there would only
    // touch.)
    if (!at.every((x) => half.every((w) => w >= 1 && (k.bays > 1 ? Math.abs(x) + w < pitch / 2 : Math.abs(x) + w <= pitch / 2)))) bad(`its openings are narrower than a unit, or reach out of their bay${k.bays > 1 ? 's' : ''}`);
    // (Between the floor and a low room's ceiling: in both rooms, whatever
    // their heights, and clear of the cells over and under, which see
    // nothing nearer than M from their sides (see unseen).)
    const [sill, rise, top] = ['sill', 'rise', 'top'].map((f) => values(k[f], `walls.${k.name}`).values);
    if (!sill.every((y) => y >= 0 && rise.every((r) => half.every((w) => top.every((t) => Math.min(t, r + w) >= 1 && y + Math.min(t, r + w) <= HLO))))) bad('its openings reach below the floor or over a low room\'s ceiling');
  }
  // (Nothing so thin that two pieces only touch.)
  // (A slab's opening clear of the cells beside, which see nothing nearer
  // than M from their sides, its corners cut by a unit at least.)
  for (const k of out.slabs.slice(1)) {
    if (!values(k.half, `slabs.${k.name}`).values.every((w) => w >= 1 && w <= R / 2 - M)) throw new Error(`halls: slabs: ${k.name}: an opening narrower than a unit, or wider than the room`);
    if (!values(k.cut, `slabs.${k.name}`).values.every((c) => c >= 1)) throw new Error(`halls: slabs: ${k.name}: its corners cut at less than a unit`);
  }
  // (Quartered, only the one in our quarter is asked for a distance: it must
  // keep to its quarter, and its mirrors to theirs.)
  for (const k of out.furniture.slice(1)) {
    if ('diamond' in k && !values(k.diamond, `furniture.${k.name}`).values.every((w) => w >= 1)) throw new Error(`halls: furniture: ${k.name}: a diamond narrower than a unit`);
    if (!k.quartered) continue;
    if (!k.at.every(Number.isInteger)) throw new Error(`halls: furniture: ${k.name}: quartered, it stands at whole numbers, not ${JSON.stringify(k.at)}`);
    const r = 'diamond' in k && Math.max(...values(k.diamond, `furniture.${k.name}`).values);
    const far = 'diamond' in k ? [r, r] : [k.box[0][1], k.box[1][1]];
    if (!k.at.every((c, a) => c + far[a] <= R / 2)) throw new Error(`halls: furniture: ${k.name}: quartered, at ${JSON.stringify(k.at)} reaches past the room's middle`);
  }
  // (What stands in a room keeps clear of the openings, which reach a unit
  // into it, so that solid never stands in their air: of the walls', a unit
  // in from each; of the slabs', any it may stand under or over, where it
  // reaches the floor or the ceiling; and of where a visit starts, in the
  // room's middle (see start).)
  const placed = (k) => {
    const where = `furniture.${k.name}`, all = (x) => values(x, where).values;
    const list = [];
    for (const turn of all(k.turn))
      for (const ax of all(k.at[0]))
        for (const az of all(k.at[1])) {
          const places = k.quartered ? [ax, 'diamond' in k ? R - ax : R - ax - k.box[0][0] - k.box[0][1]].flatMap((x) => [az, 'diamond' in k ? R - az : R - az - k.box[1][0] - k.box[1][1]].map((z) => [x, z])) : [[ax, az]];
          for (const [p, q] of places) {
            // (Along x and z: p and q, or q and p, turned.)
            const piece = 'diamond' in k
              ? { diamond: Math.max(...all(k.diamond)), x: turn ? q : p, z: turn ? p : q, y: [M, R] }
              : { x: [p + k.box[0][0], p + k.box[0][1]], z: [q + k.box[1][0], q + k.box[1][1]], y: [M + k.box[2][0], M + k.box[2][1]] };
            if (!piece.diamond && turn) [piece.x, piece.z] = [piece.z, piece.x];
            list.push(piece);
          }
        }
    return list;
  };
  // (Strictly inside, at (x, z), seen from above.)
  const inside = (c, x, z) => (c.diamond ? Math.abs(x - c.x) + Math.abs(z - c.z) < c.diamond : x > c.x[0] && x < c.x[1] && z > c.z[0] && z < c.z[1]);
  const lowRoom = Math.min(...out.rooms.flatMap((k) => values(k.high, `rooms.${k.name}`).values));
  for (const k of out.furniture.slice(1)) {
    const bad = (what) => {
      throw new Error(`halls: furniture: ${k.name}: ${what}`);
    };
    for (const c of placed(k)) {
      const [x0, x1, z0, z1] = c.diamond ? [c.x - c.diamond, c.x + c.diamond, c.z - c.diamond, c.z + c.diamond] : [...c.x, ...c.z];
      if (Math.min(x0, z0) < M + 1 || Math.max(x1, z1) > R - M - 1) bad('it stands within a unit of a wall, where the walls\' openings reach into the room');
      if (inside(c, R / 2, R / 2) && c.y[0] < M + 4.5 && c.y[1] > M + 4.5) bad('it stands where a visit starts, in the room\'s middle');
      // (Each kind of slab opening it may have under it, if it stands on the
      // floor; over it, if it reaches the lowest ceiling's last unit.)
      for (const [side, near] of [['under', c.y[0] < M + 1], ['over', c.y[1] > M + lowRoom - 1]]) {
        if (!near) continue;
        const most = out.slabs.findIndex((s) => s.name === k.upTo[side]);
        for (const s of out.slabs.slice(1, most + 1)) {
          const w = Math.max(...values(s.half, `slabs.${s.name}`).values), dg = Math.max(...values(s.cut, `slabs.${s.name}`).values);
          for (let x = 1 / 8; x < R; x += 1 / 4)
            for (let z = 1 / 8; z < R; z += 1 / 4)
              if (inside(c, x, z) && Math.abs(x - R / 2) < w && Math.abs(z - R / 2) < w && Math.abs(x - R / 2) + Math.abs(z - R / 2) < dg) bad(`it stands ${side === 'under' ? 'over' : 'under'} an opening it may have there (${s.name})`);
        }
      }
    }
  }
  // (The space's longest way through a piece of air, and largest clearance
  // (see longestWay and maxInterior), hold: a room fills at most its cell
  // less the walls; a wall's opening reaches a unit into the room, within
  // the wall, no higher than a low room; a slab's, from the room's ceiling
  // through the slab, within the room. As R and M are, the rooms' heights
  // checked above keep them so; this says so, should those change.)
  const highest = Math.max(...out.rooms.flatMap((k) => values(k.high, `rooms.${k.name}`).values));
  if (Math.hypot(R - 2 * M, R - 2 * M, highest) / R > LONGEST_WAY || highest / 2 / R > MAX_INTERIOR) throw new Error('halls: rooms: higher than the space allows for');
  return out;
}

// The halls in either language (js: true, or GLSL), from their kinds (see
// families): roomHigh (a room's height, by the cell's hash), wallShape
// (which opening a wall has: its middle, half width, sill, rise and top),
// wallOpening, slabOpening, furniture and roomAir, the pieces; the cell
// (hallsCell in GLSL, hallsAir in JavaScript); and, in JavaScript,
// furnitureKind (for the planner). levels: the kinds at each level (null: at
// any level not given its own).
function pieces(js, levels, salt) {
  // (An expression (checked: see families), in the language.)
  const e = (x) => (js || typeof x === 'number' ? String(x) : twin.glsl(LANG, x));
  const { fn, decl, loop, num, aim, D, NOTHING } = twin.writer(js);
  // (The kind the hash's number t picks: for each kind, the lines give(kind)
  // writes, one kind's only; none: what is returned instead, below the first
  // kind's share, when that kind is nothing.)
  const choose = (list, give, none) => [
    decl('float', 't = h01(h)'),
    ...(none ? [`if (t < ${num(list[0].to)}) return ${none};`] : []),
    ...(none ? list.slice(1) : list).flatMap((k, i) => [`${i ? '} else ' : ''}${k.to === null ? '{' : `if (t < ${num(k.to)}) {`}`, ...give(k).map((l) => '  ' + l), ...(k.to === null ? ['}'] : [])]),
  ].map((l) => '  ' + l);
  // (What write(kinds) writes, for the level asked at: each level's own,
  // where its kinds write other lines than the rest, else the default's.)
  const atLevel = (write) => {
    const base = write(levels.get(null));
    const own = [...levels].filter(([l]) => l !== null).map(([l, kinds]) => [l, write(kinds)]).filter(([, lines]) => lines.join('\n') !== base.join('\n'));
    if (!own.length) return base;
    return [...own.flatMap(([l, lines], i) => [`  ${i ? '} else ' : ''}if (level == ${l}) {`, ...lines.map((x) => '  ' + x)]), '  } else {', ...base.map((x) => '  ' + x), '  }'];
  };
  const out = [];

  // A room's height.
  out.push(fn('int', 'roomHigh', ['uint h', 'int level']), ...atLevel((kinds) => choose(kinds.rooms, (k) => [`return ${e(k.high)};`])), '}');

  // Which of n equal bays across the wall holds u (integer division is
  // slow), for each n a row has.
  for (const n of new Set([...levels.values()].flatMap((kinds) => kinds.walls.slice(1).filter((k) => k.bays > 1).map((k) => k.bays)))) {
    const pitch = (R - 2 * M) / n;
    out.push(js
      ? `const bay${n} = (u, fu) => Math.min(${n - 1}, Math.max(0, Math.floor((u - M + fu) / ${pitch})));`
      : `int bay${n}(int u, float fu) { return int(clamp(floor((float(u - M) + fu) * (1.0 / ${num(pitch)})), 0.0, ${num(n - 1)})); }`);
  }

  // The opening, if any, through the wall on one horizontal side of the
  // cell. Faces are shared, so the two cells either side hash the same
  // owner (h) and agree on what is there.
  out.push(js ? 'function wallShape(h, u, fu, level) {' : 'bool wallShape(uint h, int u, float fu, int level, out int cu, out int hw, out int y0, out int sp, out int top) {');
  out.push(...atLevel((kinds) => choose(kinds.walls, (k) => {
    // (Its middle: a row's in the middle of the bay the point is across from,
    // one alone at so far from the wall's.)
    const pitch = (R - 2 * M) / k.bays, at = k.bays > 1 ? `M + ${pitch / 2} + ${pitch} * bay${k.bays}(u, fu)` : k.at === 0 ? 'C' : `C + (${e(k.at)})`;
    const v = [at, ...['half', 'sill', 'rise', 'top'].map((f) => e(k[f]))];
    return [js ? `return { cu: ${v[0]}, hw: ${v[1]}, y0: ${v[2]}, sp: ${v[3]}, top: ${v[4]} };` : `cu = ${v[0]}; hw = ${v[1]}; y0 = ${v[2]}; sp = ${v[3]}; top = ${v[4]}; return true;`];
  }, js ? 'null' : 'false')));
  out.push('}');

  // That opening as a piece of air (see TUNNEL).
  out.push(fn('float', 'wallOpening', ['int p', 'int a', 'float fa', 'int u', 'float fu', 'int y', 'float fy', 'bool high', 'uint h', 'vec3 ea', 'vec3 eu', 'int level']));
  out.push(...(js
    ? ['  const s = wallShape(h, u, fu, level);', '  if (!s) return NONE;', '  const { cu, hw, y0, sp, top } = s;']
    : ['  int cu, hw, y0, sp, top;', '  if (!wallShape(h, u, fu, level, cu, hw, y0, sp, top)) return 1e9;']));
  out.push('  ' + decl('int', 'x = u - cu, yy = y - M - y0'), '  airPiece();', ...twin.planes(js, 'air', TUNNEL).map((l) => '  ' + l), `  return ${D};`, '}');

  // An opening through a slab, from y0 to y1 (see HOLE), as h picks it: in
  // a room's floor or ceiling (slabOpening: the one above, up, or below), or
  // carried further (as the arcology's light wells are, up to its plaza).
  out.push(fn('float', 'slabHole', ['ivec3 L', 'vec3 f', 'int y0', 'int y1', 'uint h', 'int level']));
  out.push('  ' + decl('int', 'w, dg', true));
  out.push(...atLevel((kinds) => choose(kinds.slabs, (k) => [`w = ${e(k.half)}; dg = ${e(k.cut)};`], NOTHING)));
  out.push('  airPiece();', ...twin.planes(js, 'air', HOLE).map((l) => '  ' + l), `  return ${D};`, '}');
  out.push(fn('float', 'slabOpening', ['ivec3 L', 'vec3 f', 'bool up', 'int H', 'uint h', 'int level']));
  out.push('  return slabHole(L, f, up ? M + H - 1 : -M, up ? R + M : M + 1, h, level);', '}');
  // (And in JavaScript, the opening's half width, or none: for a check of
  // where there is one.)
  if (js) out.push('function slabHalf(h, level) {', ...atLevel((kinds) => choose(kinds.slabs, (k) => [`return ${e(k.half)};`], 'null')), '}');

  // Solid things standing in the room: the distance to the nearest
  // (negative inside it). under and over are what picks the openings in
  // the floor and the ceiling (see upTo). (An opening reaches a unit into
  // the room so that the two join cleanly; furniture in the way would leave
  // a skin where they meet.) A ray may strike any of a set of them, so then
  // all are asked; otherwise the one in our quarter of the room is the
  // nearest.
  // (What a kind must have under and over it: no slab more open than upTo's,
  // of the slabs of its level.)
  const allowed = (k, kinds) => {
    const slab = (name) => kinds.slabs.find((s) => s.name === name).to;
    return Object.entries(k.upTo).filter(([, most]) => slab(most) !== null).map(([side, most]) => `${side} >= ${num(slab(most))}`);
  };
  out.push(fn('float', 'furniture', ['ivec3 L', 'vec3 f', 'uint h', 'float under', 'float over', 'int level']));
  out.push(...atLevel((kinds) => choose(kinds.furniture, (k) => {
    const body = [], diamond = 'diamond' in k;
    const not = allowed(k, kinds);
    if (not.length) body.push(`if (${not.join(' || ')}) return ${NOTHING};`);
    // (Along the floor, p and q: x and z, or z and x where it turns.)
    const turns = values(k.turn, `furniture.${k.name}`).values.includes(true);
    if (turns) {
      body.push(decl('bool', `turn = ${e(k.turn)}`));
      body.push(decl('int', 'p = turn ? L.z : L.x, q = turn ? L.x : L.z'), decl('float', 'fp = turn ? f.z : f.x, fq = turn ? f.x : f.z'));
      body.push(js ? 'const ep = turn ? 2 : 0, eq = turn ? 0 : 2;' : 'vec3 ep = turn ? EZ : EX, eq = turn ? EX : EZ;');
    } else if (k.quartered || !diamond) body.push(decl('int', 'p = L.x, q = L.z'), decl('float', 'fp = f.x, fq = f.z'));
    const [ep, eq] = turns ? ['ep', 'eq'] : [0, 2];
    // (Its sides from where it stands, cp and cq along p and q; a diamond's
    // middle along x and z.)
    const from = (c, x) => (x === 0 ? c : x < 0 ? `${c} - ${-x}` : `${c} + ${x}`);
    const shape = diamond
      ? [{ corners: [2, turns ? 'turn ? cq : cp' : 'cp', turns ? 'turn ? cp : cq' : 'cq', e(k.diamond)], axes: [0, 2] }]
      : [
          { span: ['p', 'fp', from('cp', k.box[0][0]), from('cp', k.box[0][1]), ep] },
          { span: ['q', 'fq', from('cq', k.box[1][0]), from('cq', k.box[1][1]), eq] },
          { span: ['L.y', 'f.y', from('M', k.box[2][0]), from('M', k.box[2][1]), 1] },
        ];
    const piece = ['solidPiece();', ...twin.planes(js, 'solid', shape)];
    const [ax, az] = k.at.map((c) => e(c));
    if (!k.quartered) return [...body, decl('int', `cp = ${ax}, cq = ${az}`), ...piece, 'return solidDone();'];
    // (Its mirror across the middle: from R - c less the sides.)
    const [mx, mz] = diamond ? k.at.map((c) => R - c) : k.at.map((c, a) => R - c - k.box[a][0] - k.box[a][1]);
    return [
      ...body,
      decl('float', `d = ${NOTHING}`, true),
      decl('int', 'np = beyond(p, fp, C) ? 1 : 0, nq = beyond(q, fq, C) ? 1 : 0'),
      loop('k', 0, 4),
      '  ' + decl('int', 'kp = k & 1, kq = k >> 1'),
      js ? '  if (!S.ray && (kp !== np || kq !== nq)) continue;' : '  if (!gRay && (kp != np || kq != nq)) continue;',
      '  ' + decl('int', `cp = kp ${js ? '===' : '=='} 1 ? ${mx} : ${ax}, cq = kq ${js ? '===' : '=='} 1 ? ${mz} : ${az}`),
      ...piece.map((l) => '  ' + l),
      js ? '  d = Math.min(d, solidDone());' : '  d = min(d, solidDone());',
      '}',
      'return d;',
    ];
  }, NOTHING)));
  out.push('}');

  // The room: a box, less whatever stands in it.
  out.push(fn('float', 'roomAir', ['ivec3 L', 'vec3 f', 'int H', 'uint h', 'float under', 'float over', 'int level']));
  out.push('  airPiece();', ...twin.planes(js, 'air', ROOM).map((l) => '  ' + l));
  out.push('  ' + decl('float', `box = ${D}`), `  return ${js ? 'Math.max' : 'max'}(box, -furniture(L, f, h, under, over, level));`, '}');

  // The kind of furniture a room has (for the planner), or none.
  if (js) {
    out.push('function furnitureKind(h, under, over, level) {');
    out.push(...atLevel((kinds) => choose(kinds.furniture, (k) => {
      const not = allowed(k, kinds);
      return [...(not.length ? [`if (${not.join(' || ')}) return null;`] : []), `return '${k.name}';`];
    }, 'null')), '}');
  }
  // The halls cell: its room, and of the
  // openings in its faces, those in the nearer face on each axis. Of the
  // pieces of air the point is in, the ray stays in air to the end of
  // whichever it is in for longest. Each piece is first asked only its
  // distance; only one the point turns out to be in is asked again, for
  // where the ray leaves it (asking that of every piece costs far more).
  // (Where the languages differ: a cell's hash, salted or not; whether a
  // cell has a room; a neighbour's id, d from this one; and a piece the
  // point is in, d its distance as first asked, asked again for the ray.
  // Otherwise the text is both's: in JavaScript float and abs are as GLSL
  // has them, min and max the language's own, and a whole number is halved
  // by div.)
  const hash = (id, s) => `hashCell(${id}, ${s === undefined ? 'seed' : `seed ^ ${js ? `0x${(s >>> 0).toString(16)}` : hexu(s)}`})`;
  const hasRoom = (id) => (js ? `built(${id}, seed, level, rule)` : `built(${id}, seed, level)`);
  const next = (d) => (js ? `wrapId([${d.map((x, a) => (x === 0 ? `id[${a}]` : `id[${a}] + (${x})`)).join(', ')}])` : `wrapId(id + ivec3(${d.join(', ')}))`);
  const most = (f, xs) => xs.reduce((a, x) => `${f}(${a}, ${x})`);
  const half = (x) => (js ? `div(${x}, 2)` : twin.HELPERS.div.glsl([x, '2']));
  const through = (d, ask) => twin.reask(js, d, ask);
  const wall = (x) => (x
    ? `wallOpening(1, L.x, f.x, L.z, f.z, L.y, f.y, hx, hwx, ${js ? '0, 2' : 'EX, EZ'}, level)`
    : `wallOpening(0, L.z, f.z, L.x, f.x, L.y, f.y, hz, hwz, ${js ? '2, 0' : 'EZ, EX'}, level)`);
  const slabIn = 'slabOpening(L, f, hy, H, hwy, level)', roomIn = 'roomAir(L, f, H, hf, h01(hdn), h01(hup), level)';
  // (In GLSL, the cell asks its pieces with gRay clear but where it says,
  // and gives it back as it was: see hallsCell below.)
  out.push(js ? 'function hallsAir(L, f, id, seed, dg, level, rule, ray) {' : 'float hallsCellIn(ivec3 L, vec3 f, ivec3 id, uint seed, int level, bool ray, out float reach, out vec3 nrm) {');
  out.push(...(js ? ["if (!Number.isInteger(level)) throw new Error('halls: a cell asked at no level');", 'at(L, f, dg);'] : []).map((l) => '  ' + l), ...aim('  '));
  out.push(
    ...[
      decl('bool', `here = ${hasRoom('id')}`),
      // (A cell with no room is measured as a room filling it.)
      decl('int', `H = here ? roomHigh(${hash('id')}, level) : HHI`),
      decl('uint', `hup = ${hash('id', salt.slab)}`),
      decl('uint', `hdn = ${hash(next([0, -1, 0]), salt.slab)}`),
      decl('uint', `hf = ${hash('id', salt.furniture)}`),
      decl('float', `room = ${NOTHING}`, true),
      'if (here) {',
      `  room = ${roomIn};`,
      ...through('room', roomIn).map((l) => '  ' + l),
      '}',
      // Openings reach only one unit into the room; deeper in, they change
      // nothing.
      'if (room < -1.0) return room;',
      // Only the nearer face on each axis can matter to a point in this cell.
      decl('bool', `hx = beyond(L.x, f.x, C), hz = beyond(L.z, f.z, C), hy = beyond(L.y, f.y, M + ${half('H')})`),
      decl('uint', `hwx = ${hash('hx ? id : ' + next([-1, 0, 0]), salt.wallX)}, hwz = ${hash('hz ? id : ' + next([0, 0, -1]), salt.wallZ)}, hwy = hy ? hup : hdn`, true),
      // A face has an opening only if there is a room on one side of it at
      // least. From a room, an opening into a solid cell is a niche.
      'if (!here) {',
      `  if (!${hasRoom(next(['hx ? 1 : -1', 0, 0]))}) hwx = 0${js ? '' : 'u'};`,
      `  if (!${hasRoom(next([0, 0, 'hz ? 1 : -1']))}) hwz = 0${js ? '' : 'u'};`,
      `  if (!${hasRoom(next([0, 'hy ? 1 : -1', 0]))}) hwy = 0${js ? '' : 'u'};`,
      '}',
      decl('float', `ax = ${wall(true)}, az = ${wall(false)}, ay = ${slabIn}`),
      ...through('ax', wall(true)),
      ...through('az', wall(false)),
      ...through('ay', slabIn),
      // From inside the slab over a low room, the nearest air may be the
      // room above. This cell says nothing else about its neighbours' rooms.
      decl('float', `above = ${most('max', ['float(M - L.x) - f.x', 'float(L.x - (R - M)) + f.x', 'float(M - L.z) - f.z', 'float(L.z - (R - M)) + f.z', 'float(R + M - L.y) - f.y'])}`),
      decl('float', `a = ${most('min', ['room', 'above', 'ax', 'az', 'ay'])}`),
      'if (a <= 0.0) return a;',
      // In solid, a must not overstate how far the nearest air is, and the
      // `above` only looked at part of it. Air it did not look at is at least
      // this far: the far-side openings of this cell, which come no nearer
      // than M + 1 to their own side (so C - M - 1 from the middle across,
      // and H / 2 - 1 from it up or down, H being at least HLO); and
      // whatever the neighbours hold, none of which comes within M of the
      // cell boundary unseen.
      decl('float', `unseen = ${most('min', ['abs(float(L.x - C) + f.x) + float(C - M - 1)', 'abs(float(L.z - C) + f.z) + float(C - M - 1)', `abs(float(L.y - M - ${half('H')}) + f.y) + float(${half('HLO')} - 1)`, `${most('min', ['float(L.x) + f.x', 'float(R - L.x) - f.x', 'float(L.y) + f.y', 'float(R - L.y) - f.y', 'float(L.z) + f.z', 'float(R - L.z) - f.z'])} + float(M)`])}`),
      `return ${most('min', ['a', 'unseen'])};`,
    ].map((l) => '  ' + l),
    '}',
  );
  if (!js)
    out.push(
      'float hallsCell(ivec3 L, vec3 f, ivec3 id, uint seed, int level, out float reach, out vec3 nrm) {',
      '  bool ray = gRay;',
      '  gRay = false;',
      '  float d = hallsCellIn(L, f, id, seed, level, ray, reach, nrm);',
      '  gRay = ray;',
      '  return d;',
      '}',
    );

  return js ? twin.arrays(out.join('\n'), ['L', 'f']) : out.join('\n');
}

// The halls, made from HALLS with what set changes (see define in util.js):
// their space, and the parts other spaces build on (see the end), so that a
// variant of them is another call of this.
export function makeHalls(set) {
  const spec = frozen(define(HALLS, set));
  const { salt } = spec;

  // (The halls at each level: their definition and kinds, the default's at
  // any level not given its own.)
  const specAt = (level) => spec.byLevel[level] ?? spec;
  const levels = new Map([[null, families(spec)], ...Object.entries(spec.byLevel).map(([l, s]) => [+l, families(s)])]);
  const kindsAt = (level) => levels.get(level) ?? levels.get(null);
  // (Below which number a part's kind name, or one before it, is chosen at a
  // level: none, the last.)
  const wholeLevel = (level) => {
    if (!Number.isInteger(level)) throw new Error('halls: asked at no level');
    return level;
  };
  const to = (part, name, level) => kindsAt(wholeLevel(level))[part].find((k) => k.name === name).to;
  const C = R / 2;
  const HHI = R - 2 * M;
  // Does this cell have a room in it? (rule: where the space allows a room,
  // as spaceRoom in the GLSL; none, everywhere.)
  const built = (id, seed, level, rule) => (!rule || rule(id, seed)) && h01(hashCell(id, seed ^ salt.built)) >= threshold(specAt(wholeLevel(level)).solid);
  // The halls in JavaScript, made into functions (the flight asks the cell
  // every frame: asking the GPU would mean waiting for it; the tests compare
  // the two languages); and of them, hallsAir:
  // the halls cell's distance at L + f (dg: its diagonals, see pieces.at; rule:
  // where the space allows a room, as spaceRoom in the GLSL; none,
  // everywhere). And if ray is given ({ dir }), for a ray along dir from
  // there: how far it goes in the piece of air it is in (reach, in lattice
  // units; less than 0, in solid), and the surface it meets there (nx, ny,
  // nz); known says whether the cell answers that (here, always).
  const { roomHigh, wallShape, slabHole, slabHalf, furnitureKind, hallsAir } = new Function(
    'P', 'C', 'M', 'R', 'HLO', 'HHI', 'FAR', 'H2', 'hashCell', 'wrapId', 'built',
    `'use strict';\nconst { S, at, aim, through, airPiece, airPlane, airSpan, solidPiece, solidPlane, solidSpan, solidDone, diag, h01, beyond, NONE } = P;\n${twin.AS_GLSL}\n${twin.jsHelpers(LANG)}\n${pieces(true, levels, salt)}\nreturn { roomHigh, wallShape, wallOpening, slabHole, slabHalf, slabOpening, furniture, roomAir, furnitureKind, hallsAir };\n//# sourceURL=hallsPieces.gen.js`,
  )(P, C, M, R, HLO, HHI, FAR, Math.SQRT1_2, hashCell, wrapId, built);

  // (Other spaces build on these halls: hallsGlsl and hallsAir are a halls
  // cell, whatever its level.)
  const hallsGlsl = /* glsl */ `
const int M = ${M};
const int HLO = ${HLO};
const int FAR = ${FAR};
const int HHI = R - 2 * M;
// Does this cell have a room in it? Some are left solid, so that a surface
// which cuts through cells (any diagonal) is not all cut-open rooms.
// (And only where the space allows a room: spaceRoom, which each space
// defines; the halls everywhere.)
bool spaceRoom(ivec3 id, uint seed);
bool built(ivec3 id, uint seed, int level) { return spaceRoom(id, seed) && h01(hashCell(id, seed ^ ${hexu(salt.built)})) >= (${[...Object.entries(spec.byLevel).filter(([, s]) => s.solid !== spec.solid).map(([l, s]) => `level == ${l} ? ${glf(threshold(s.solid))} : `), glf(threshold(spec.solid))].join('')}); }

${pieces(false, levels, salt)}

`;

  // For finding a way through the halls (see planner.js): a cell's room, if
  // it has one (its height, its middle in its lattice units, and whether
  // what stands in it blocks the way across its middle, as piers do: the
  // planner goes round them), and the openings in its six faces, each as
  // the middle of where it crosses the face, the way across it (e), and the
  // cell on the other side. (Of a row of openings, the one at the wall's
  // middle.) The same hashes as above.
  function hallsRoom(id, seed, level, rule) {
    if (!built(id, seed, level, rule)) return null;
    const H = roomHigh(hashCell(id, seed), level);
    // (What stands in it, as furniture has it: whether it is in a way
    // across the room's middle.)
    const under = h01(hashCell(wrapId([id[0], id[1] - 1, id[2]]), seed ^ salt.slab)), over = h01(hashCell(id, seed ^ salt.slab));
    const stands = furnitureKind(hashCell(id, seed ^ salt.furniture), under, over, level);
    return { H, middle: [C, M + (H >> 1), C], piers: !!stands && !!specAt(level).furniture[stands].blocks };
  }
  function hallsOpenings(id, seed, level, rule) {
    const here = built(id, seed, level, rule);
    const out = [];
    for (const [a, sign] of [[0, 1], [0, -1], [2, 1], [2, -1], [1, 1], [1, -1]]) {
      const e = [0, 0, 0];
      e[a] = sign;
      const nb = wrapId(id.map((x, b) => x + e[b]));
      if (!here && !built(nb, seed, level, rule)) continue;
      // A face belongs to the cell on its lower side.
      const owner = sign > 0 ? id : nb;
      const at = [C, 0, C];
      at[a] = sign > 0 ? R : 0;
      if (a === 1) {
        if (h01(hashCell(owner, seed ^ salt.slab)) < to('slabs', 'solid', level)) continue;
      } else {
        const s = wallShape(hashCell(owner, seed ^ (a === 0 ? salt.wallX : salt.wallZ)), C, 0, level);
        if (!s) continue;
        at[a === 0 ? 2 : 0] = s.cu;
        at[1] = M + s.y0 + Math.min(s.top, s.sp + s.hw) / 2;
      }
      out.push({ e, at, nb });
    }
    return out;
  }

  return { spec, kindsAt, to, glsl: hallsGlsl, air: hallsAir, room: hallsRoom, openings: hallsOpenings, built, slabHole, slabHalf };
}

// Standing height in the middle of a room, in its cell.
export const STANDING = [0.5, (M + 4.5) / R, 0.5];

// Where a cell of the halls sits in its parent, where nothing says otherwise
// (as a space's ancestorDigit says, at the levels that are halls all
// through: finer than level 0): in the surface layer of one of its parent's
// four walls, above the height any opening reaches, which is the one place
// that is solid whatever the parent turns out to be (if the parent is a tall
// room, just outside it); which wall and where on it, by the level's hash.
const ancestors = new Map(); // level -> where its cell sits in its parent
export function ancestorDigit(level) {
  let d = ancestors.get(level);
  if (d) return d;
  const h = hash32(level * 2 + 1), g = hash32(h);
  const across = M + ((h >>> 8) % (R - 2 * M));
  const y = M + HLO + ((h >>> 16) % (R - 2 * M - HLO));
  const depth = g & 2 ? M - 1 : R - M;
  d = g & 1 ? [depth, y, across] : [across, y, depth];
  ancestors.set(level, d);
  return d;
}
