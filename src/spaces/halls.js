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
//                  name (the space declares it)
//   maxInterior    largest clearance any point in a cell's air can have, as a
//                  fraction of the cell
//   longestWay     the longest way through any one convex piece of a cell's
//                  air, in cells
//   close          how far (fraction of the cell) air is shrunk to fade a level
//                  out with distance
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

import { hash32, hashCell, hsv, levelSeed, wrapId as wrapIdR, glf, hexu, define, frozen } from '../util.js';
import * as P from '../pieces.js';
import * as twin from '../twin.js';

const { S, at, aim, through, h01, beyond, NONE } = P;

export const R = 24; // children per cell edge
const wrapId = (id) => wrapIdR(id, R);
export const M = 3; // half the wall thickness between two rooms
const HLO = 12; // ceiling height of a low room; a tall room fills the cell (18)

// What the halls make of a cell's hashes, in one place for both copies (and
// for the planner, and the arcology's light wells): each choice is a hash of
// the cell, salted for what it chooses, as a number from 0 to 1, against
// these.
export const HALLS = {
  solid: 0.65, // the share of cells left solid, with no room
  low: 0.65, // the share of rooms that are low (HLO high); the rest fill the cell
  salt: { built: 0x3c6ef372, slab: 0x967a889b, furniture: 0x51ed270b, wallX: 0x68bc21eb, wallZ: 0x02e5be93 },
  // Through a wall: below none, nothing; then a door, a row of windows, an
  // arcade; above arcade, no wall at all (the rooms run together).
  wall: { none: 0.24, door: 0.52, windows: 0.68, arcade: 0.84 },
  // Through a slab: below solid, nothing; then an oculus; above, a light well.
  slab: { solid: 0.66, oculus: 0.88 },
  // In a room: below none, nothing; then piers, benches; above, a kiosk.
  furniture: { none: 0.4, piers: 0.62, benches: 0.82 },
};
// What each kind of opening and furniture is, as rows: the halls' pieces,
// in both languages, are written from them (see pieces below). (How often
// each comes is HALLS's.) Numbers are lattice units; a value may be an
// expression (see twin.js) in C, M, R, HLO and, where a kind is chosen by
// a cell's hash, bit(h, n) and field(h, n, m).
const KINDS = {
  // An opening through a wall, as a tunnel from room to room (see TUNNEL):
  // its middle along the wall (at), or a row of so many, one to each equal
  // bay of the wall, the one in the bay the point is across from; its half
  // width; its sill over the floor; how far its sides rise before a
  // 45-degree gable closes it; and a flat top over the sill (or none).
  walls: {
    // A door, in one of three places along the wall.
    door: { at: 'C + (div(field(h, 0, 256) * 3, 256) - 1) * 5', half: 2, rise: 5 },
    windows: { row: 3, half: 1, sill: 4, rise: 3 },
    // An arcade of three arches.
    arcade: { row: 3, half: 2, rise: 6 },
    // No wall at all: the two rooms run together.
    open: { at: 'C', half: 'C - M', top: 'HLO' },
  },
  // An opening through a slab (see HOLE): a square, its half width, its
  // corners cut at 45 degrees so far from its middle (or not).
  slabs: {
    oculus: { half: 3, cut: 4 },
    well: { half: 6 },
  },
  // What stands in a room: boxes ([x0, x1], [z0, z1], [y0, y1]) or
  // diamonds (their half width), one in the middle of the room, or one in
  // each quarter (at: where along x and along z, [low quarter, high]; a
  // box's sides then from there), turned a quarter round where the bit turn
  // of the cell's hash says. needs: the openings it must not stand over or under, as
  // the most open kind of slab it may (no light well near piers; nothing over
  // any hole in the floor).
  furniture: {
    // Four diamond piers, floor to ceiling.
    piers: { needs: { under: 'oculus', over: 'oculus' }, diamond: 2, at: [[7, 17], [7, 17]] },
    // Two rows of benches, running along x or z.
    benches: { needs: { under: 'solid' }, box: [[0, 5], [0, 1], ['M - 1', 'M + 1']], at: [[6, 13], [8, 15]], turn: 5 },
    // A kiosk in the middle of the floor.
    kiosk: { needs: { under: 'solid' }, box: [['C - 2', 'C + 2'], ['C - 2', 'C + 2'], ['M - 1', 'M + 3']] },
  },
};

// The words KINDS is written in (see twin.js).
const LANG = { name: 'halls', hashes: ['h'], hashed: ['bit', 'field'], helpers: { bit: twin.HELPERS.bit, field: twin.HELPERS.field, div: twin.HELPERS.div, min: twin.HELPERS.min, max: twin.HELPERS.max } };
const NAMES = new Set(['C', 'M', 'R', 'HLO']);

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

// The halls, made from HALLS with what set changes (see define in util.js):
// their space, and the parts other spaces build on (see the end), so that a
// variant of them is another call of this.
export function makeHalls(set) {
  const spec = frozen(define(HALLS, set));
  const { salt, wall, slab, furniture: stands } = spec;

  // The halls' pieces in either language (js: true, or GLSL), from KINDS:
  // wallShape (which opening a wall has: its middle, half width, sill, rise
  // and top), wallOpening, slabOpening, furniture and roomAir (see hallsCell).
  function pieces(js) {
    const e = (x, where) => {
      const w = twin.words(LANG, String(x), NAMES, where);
      return js ? w : twin.glsl(LANG, w);
    };
    // (In JavaScript, a point's coordinates are arrays.)
    const lang = (lines) => lines.map((l) => (js ? l.replace(/\b([Lf])\.([xyz])\b/g, (_, v, a) => `${v}[${'xyz'.indexOf(a)}]`) : l));
    const num = (x) => (js ? String(x) : glf(x));
    const out = [];
    // (Each kind in order, the first being none, and its threshold (HALLS's):
    // below it, that kind or one before it; the last has none.)
    const kinds = (family, names) => names.map((name, i) => ({ name, to: i < names.length - 1 ? family[name] : null }));
    const walls = kinds(wall, ['none', ...Object.keys(KINDS.walls)]);
    const slabs = kinds(slab, ['solid', ...Object.keys(KINDS.slabs)]);
    const stand = kinds(stands, ['none', ...Object.keys(KINDS.furniture)]);
    const below = (list, name) => list.find((k) => k.name === name).to;

    // Which of n equal bays across the wall holds u (integer division is
    // slow), for each n a row has.
    const rows = [...new Set(Object.values(KINDS.walls).filter((k) => k.row).map((k) => k.row))];
    for (const n of rows) {
      const pitch = (R - 2 * M) / n;
      if (!Number.isInteger(pitch / 2)) throw new Error(`halls: a row of ${n} has no whole middles`);
      out.push(js
        ? `const bay${n} = (u, fu) => Math.min(${n - 1}, Math.max(0, Math.floor((u - M + fu) / ${pitch})));`
        : `int bay${n}(int u, float fu) { return int(clamp(floor((float(u - M) + fu) * (1.0 / ${num(pitch)})), 0.0, ${num(n - 1)})); }`);
    }

    // The opening, if any, through the wall on one horizontal side of the
    // cell. Faces are shared, so the two cells either side hash the same
    // owner (h) and agree on what is there.
    out.push(js ? 'function wallShape(h, u, fu) {' : 'bool wallShape(uint h, int u, float fu, out int cu, out int hw, out int y0, out int sp, out int top) {');
    out.push(js ? '  const t = h01(h);' : '  float t = h01(h);');
    out.push(`  if (t < ${num(walls[0].to)}) return ${js ? 'null' : 'false'};`);
    for (const k of walls.slice(1)) {
      const r = KINDS.walls[k.name], where = `the wall's ${k.name}`;
      const v = [r.row ? `M + ${(R - 2 * M) / r.row / 2} + ${(R - 2 * M) / r.row} * bay${r.row}(u, fu)` : e(r.at, where), e(r.half, where), e(r.sill ?? 0, where), e(r.rise ?? 1000, where), e(r.top ?? 1000, where)];
      const give = js ? `return { cu: ${v[0]}, hw: ${v[1]}, y0: ${v[2]}, sp: ${v[3]}, top: ${v[4]} };` : `cu = ${v[0]}; hw = ${v[1]}; y0 = ${v[2]}; sp = ${v[3]}; top = ${v[4]}; return true;`;
      out.push(k.to === null ? `  ${give}` : `  if (t < ${num(k.to)}) { ${give} }`);
    }
    out.push('}');

    // That opening as a piece of air (see TUNNEL).
    out.push(js ? 'function wallOpening(p, a, fa, u, fu, y, fy, high, h, ea, eu) {' : 'float wallOpening(int p, int a, float fa, int u, float fu, int y, float fy, bool high, uint h, vec3 ea, vec3 eu) {');
    out.push(...(js
      ? ['  const s = wallShape(h, u, fu);', '  if (!s) return NONE;', '  const { cu, hw, y0, sp, top } = s;', '  const x = u - cu, yy = y - M - y0;']
      : ['  int cu, hw, y0, sp, top;', '  if (!wallShape(h, u, fu, cu, hw, y0, sp, top)) return 1e9;', '  int x = u - cu, yy = y - M - y0;']));
    out.push('  airPiece();', ...twin.planes(js, 'air', TUNNEL).map((l) => '  ' + l), js ? '  return S.d;' : '  return gD;', '}');

    // An opening through the slab above (up) or below the room (see HOLE).
    out.push(js ? 'function slabOpening(L, f, up, H, h) {' : 'float slabOpening(ivec3 L, vec3 f, bool up, int H, uint h) {');
    out.push(js ? '  const t = h01(h);' : '  float t = h01(h);');
    out.push(`  if (t < ${num(slabs[0].to)}) return ${js ? 'NONE' : '1e9'};`);
    out.push(js ? '  let w, dg;' : '  int w, dg;');
    slabs.slice(1).forEach((k, i) => {
      const r = KINDS.slabs[k.name], where = `the slab's ${k.name}`, give = `{ w = ${e(r.half, where)}; dg = ${e(r.cut ?? 1000, where)}; }`;
      out.push(`  ${i ? 'else ' : ''}${k.to === null ? '' : `if (t < ${num(k.to)}) `}${give}`);
    });
    out.push(js ? '  const y0 = up ? M + H - 1 : -M, y1 = up ? R + M : M + 1;' : '  int y0 = up ? M + H - 1 : -M, y1 = up ? R + M : M + 1;');
    out.push('  airPiece();', ...lang(twin.planes(js, 'air', HOLE)).map((l) => '  ' + l), js ? '  return S.d;' : '  return gD;', '}');

    // Solid things standing in the room: the distance to the nearest
    // (negative inside it). under and over are what picks the openings in
    // the floor and the ceiling (see needs in KINDS). (An opening reaches a
    // unit into the room so that the two join cleanly; furniture in the way
    // would leave a skin where they meet.) A ray may strike any of a set of
    // them, so then all are asked; otherwise the one in our quarter of the
    // room is the nearest.
    out.push(js ? 'function furniture(L, f, h, under, over) {' : 'float furniture(ivec3 L, vec3 f, uint h, float under, float over) {');
    out.push(js ? '  const t = h01(h);' : '  float t = h01(h);');
    out.push(`  if (t < ${num(stand[0].to)}) return ${js ? 'NONE' : '1e9'};`);
    const none = js ? 'NONE' : '1e9';
    for (const k of stand.slice(1)) {
      const r = KINDS.furniture[k.name], where = `the ${k.name}`;
      const body = [];
      const needs = Object.entries(r.needs ?? {}).map(([side, most]) => `${side} >= ${num(below(slabs, most))}`);
      if (needs.length) body.push(`if (${needs.join(' || ')}) return ${none};`);
      // (A box, from the place it stands at (p and q along the floor, which
      // may be turned), or from the room's corner.)
      const from = (a, x) => (!a ? e(x, where) : x === 0 ? a : `${a} + ${e(x, where)}`);
      const box = (p, fp, ep, q, fq, eq, ap, aq) => [
        { span: [p, fp, from(ap, r.box[0][0]), from(ap, r.box[0][1]), ep] },
        { span: [q, fq, from(aq, r.box[1][0]), from(aq, r.box[1][1]), eq] },
        { span: ['L.y', 'f.y', e(r.box[2][0], where), e(r.box[2][1], where), 1] },
      ];
      if (!r.at) {
        body.push('solidPiece();', ...lang(twin.planes(js, 'solid', box('L.x', 'f.x', 0, 'L.z', 'f.z', 2))), 'return solidDone();');
      } else {
        if (r.diamond && r.turn !== undefined) throw new Error(`halls: ${k.name}: a diamond has no turning`);
        // (Only the one in our quarter is asked for a distance: each must
        // keep to its own side of the middle.)
        const [ax, az] = r.at, reach = (a) => (r.diamond ? [-r.diamond, r.diamond] : r.box[a]);
        if (!(ax[0] + reach(0)[1] <= C && ax[1] + reach(0)[0] >= C && az[0] + reach(1)[1] <= C && az[1] + reach(1)[0] >= C)) throw new Error(`halls: ${k.name}: not one to a quarter`);
        if (r.turn !== undefined) {
          body.push(...lang(js
            ? [`const turn = bit(h, ${r.turn}) === 1;`, 'const p = turn ? L.z : L.x, q = turn ? L.x : L.z;', 'const fp = turn ? f.z : f.x, fq = turn ? f.x : f.z;', 'const ep = turn ? 2 : 0, eq = turn ? 0 : 2;']
            : [`bool turn = ${twin.glsl(LANG, `bit(h, ${r.turn})`)} == 1;`, 'int p = turn ? L.z : L.x, q = turn ? L.x : L.z;', 'float fp = turn ? f.z : f.x, fq = turn ? f.x : f.z;', 'vec3 ep = turn ? EZ : EX, eq = turn ? EX : EZ;']));
        } else body.push(...lang(js ? ['const p = L.x, q = L.z, fp = f.x, fq = f.z;'] : ['int p = L.x, q = L.z;', 'float fp = f.x, fq = f.z;']));
        body.push(js ? 'let d = NONE;' : 'float d = 1e9;');
        body.push(js ? 'const np = beyond(p, fp, C) ? 1 : 0, nq = beyond(q, fq, C) ? 1 : 0;' : 'int np = beyond(p, fp, C) ? 1 : 0, nq = beyond(q, fq, C) ? 1 : 0;');
        body.push(js ? 'for (let k = 0; k < 4; k++) {' : 'for (int k = 0; k < 4; k++) {');
        body.push(js ? '  const kp = k & 1, kq = k >> 1;' : '  int kp = k & 1, kq = k >> 1;');
        body.push(js ? '  if (!S.ray && (kp !== np || kq !== nq)) continue;' : '  if (!gRay && (kp != np || kq != nq)) continue;');
        body.push(js ? `  const cp = kp === 1 ? ${ax[1]} : ${ax[0]}, cq = kq === 1 ? ${az[1]} : ${az[0]};` : `  int cp = kp == 1 ? ${ax[1]} : ${ax[0]}, cq = kq == 1 ? ${az[1]} : ${az[0]};`);
        body.push('  solidPiece();');
        const turns = r.turn !== undefined;
        const shape = r.diamond ? [{ corners: [2, 'cp', 'cq', e(r.diamond, where)], axes: [0, 2] }] : box('p', 'fp', turns ? 'ep' : 0, 'q', 'fq', turns ? 'eq' : 2, 'cp', 'cq');
        body.push(...lang(twin.planes(js, 'solid', shape)).map((l) => '  ' + l));
        body.push(js ? '  d = Math.min(d, solidDone());' : '  d = min(d, solidDone());', '}', 'return d;');
      }
      if (k.to === null) out.push(...body.map((l) => '  ' + l));
      else out.push(`  if (t < ${num(k.to)}) {`, ...body.map((l) => '    ' + l), '  }');
    }
    out.push('}');

    // The room: a box, less whatever stands in it.
    out.push(js ? 'function roomAir(L, f, H, h, under, over) {' : 'float roomAir(ivec3 L, vec3 f, int H, uint h, float under, float over) {');
    out.push('  airPiece();', ...lang(twin.planes(js, 'air', ROOM)).map((l) => '  ' + l));
    out.push(js ? '  return Math.max(S.d, -furniture(L, f, h, under, over));' : '  float box = gD;\n  return max(box, -furniture(L, f, h, under, over));', '}');
    return out.join('\n');
  }
  const C = R / 2;
  const HHI = R - 2 * M;
  const H2 = Math.SQRT1_2;
  // (The JavaScript's, made into functions.)
  const { wallShape, wallOpening, slabOpening, furniture, roomAir } = new Function(
    'P', 'C', 'M', 'R', 'HLO', 'H2',
    `const { S, airPiece, airPlane, airSpan, solidPiece, solidPlane, solidSpan, solidDone, diag, h01, beyond, NONE } = P;\n${twin.jsHelpers(LANG)}\n${pieces(true)}\nreturn { wallShape, wallOpening, slabOpening, furniture, roomAir };\n//# sourceURL=hallsPieces.gen.js`,
  )(P, C, M, R, HLO, H2);

  // (Other spaces build on these halls: hallsGlsl and hallsAir are a halls
  // cell, whatever its level.)
  const hallsGlsl = /* glsl */ `
const int M = ${M};
const int HLO = ${HLO};
const int HHI = R - 2 * M;
const int C = R / 2;
const vec3 EX = vec3(1.0, 0.0, 0.0), EY = vec3(0.0, 1.0, 0.0), EZ = vec3(0.0, 0.0, 1.0);

float h01(uint h) { return float(h >> 8) * (1.0 / 16777216.0); }

// Does this cell have a room in it? Some are left solid, so that a surface
// which cuts through cells (any diagonal) is not all cut-open rooms.
// (And only where the space allows a room: spaceRoom, which each space
// defines; the halls everywhere.)
bool spaceRoom(ivec3 id, uint seed);
bool built(ivec3 id, uint seed) { return spaceRoom(id, seed) && h01(hashCell(id, seed ^ ${hexu(salt.built)})) >= ${glf(spec.solid)}; }

// Is the point x + f on the upper side of c? (L alone is rounded, and can
// put a point half a unit on the wrong side.)
bool beyond(int x, float f, int c) { return x > c || (x == c && f >= 0.0); }

${pieces(false)}

float hallsCell(ivec3 L, vec3 f, ivec3 id, uint seed, out float reach, out vec3 nrm) {
  reach = -1.0;
  nrm = vec3(0.0);
  uint hc = hashCell(id, seed);
  bool here = built(id, seed);
  int H = here && h01(hc) < ${glf(spec.low)} ? HLO : HHI;

  // Of the pieces of air the point is in, the ray stays in air to the end of
  // whichever it is in for longest. Each piece is first asked only its
  // distance; only one the point turns out to be in is asked again, for
  // where the ray leaves it (asking that of every piece costs far more).
  bool ray = gRay;
  gRay = false;
  float room = 1e9;
  uint hup = hashCell(id, seed ^ ${hexu(salt.slab)});
  uint hdn = hashCell(wrapId(id - ivec3(0, 1, 0)), seed ^ ${hexu(salt.slab)});
  uint hf = hashCell(id, seed ^ ${hexu(salt.furniture)});
  if (here) {
    room = roomAir(L, f, H, hf, h01(hdn), h01(hup));
    if (ray && room + gO <= 0.0) {
      gRay = true;
      roomAir(L, f, H, hf, h01(hdn), h01(hup));
      gRay = false;
      reach = gX;
      nrm = gN;
    }
  }
  // Openings reach only one unit into the room; deeper in, they change nothing.
  if (room < -1.0) {
    gRay = ray;
    return room;
  }

  // Only the nearer face on each axis can matter to a point in this cell.
  bool hx = beyond(L.x, f.x, C), hz = beyond(L.z, f.z, C), hy = beyond(L.y, f.y, M + H / 2);
  ivec3 ox = hx ? id : wrapId(id - ivec3(1, 0, 0));
  ivec3 oz = hz ? id : wrapId(id - ivec3(0, 0, 1));
  uint hwx = hashCell(ox, seed ^ ${hexu(salt.wallX)}), hwz = hashCell(oz, seed ^ ${hexu(salt.wallZ)});
  uint hwy = hy ? hup : hdn;
  if (!here) {
    // A face has an opening only if there is a room on one side of it at
    // least. From a room, an opening into a solid cell is a niche.
    if (!built(wrapId(id + ivec3(hx ? 1 : -1, 0, 0)), seed)) hwx = 0u;
    if (!built(wrapId(id + ivec3(0, 0, hz ? 1 : -1)), seed)) hwz = 0u;
    if (!built(wrapId(id + ivec3(0, hy ? 1 : -1, 0)), seed)) hwy = 0u;
  }
  float ax = wallOpening(1, L.x, f.x, L.z, f.z, L.y, f.y, hx, hwx, EX, EZ);
  float az = wallOpening(0, L.z, f.z, L.x, f.x, L.y, f.y, hz, hwz, EZ, EX);
  float ay = slabOpening(L, f, hy, H, hwy);
  gRay = ray;
  if (ray && ax + gO <= 0.0) {
    wallOpening(1, L.x, f.x, L.z, f.z, L.y, f.y, hx, hwx, EX, EZ);
    if (gX > reach) { reach = gX; nrm = gN; }
  }
  if (ray && az + gO <= 0.0) {
    wallOpening(0, L.z, f.z, L.x, f.x, L.y, f.y, hz, hwz, EZ, EX);
    if (gX > reach) { reach = gX; nrm = gN; }
  }
  if (ray && ay + gO <= 0.0) {
    slabOpening(L, f, hy, H, hwy);
    if (gX > reach) { reach = gX; nrm = gN; }
  }

  // From inside the slab over a low room, the nearest air may be the room
  // above. This cell says nothing else about its neighbours' rooms.
  float above = max(max(max(float(M - L.x) - f.x, float(L.x - (R - M)) + f.x),
                        max(float(M - L.z) - f.z, float(L.z - (R - M)) + f.z)), float(R + M - L.y) - f.y);

  float a = min(min(min(room, above), ax), min(az, ay));
  if (a <= 0.0) return a;

  // In solid, a must not overstate how far the nearest air is, and the above
  // only looked at part of it. Air it did not look at is at least this far:
  // the far-side openings of this cell, which come no nearer than M + 1 to
  // their own side (so C - M - 1 from the middle across, and H / 2 - 1 from
  // it up or down, H being at least HLO); and whatever the neighbours hold,
  // none of which comes within M of the cell boundary unseen.
  vec3 q = vec3(L) + f;
  vec3 e = min(q, float(R) - q);
  float unseen = min(min(abs(q.x - float(C)), abs(q.z - float(C))) + float(C - M - 1), abs(q.y - float(M + H / 2)) + float(HLO / 2 - 1));
  unseen = min(unseen, min(e.x, min(e.y, e.z)) + float(M));
  return min(a, unseen);
}
`;

  // The same cell, in JavaScript (its pieces written above from the same
  // rows). The flight asks this every frame (asking the GPU would mean
  // waiting for it), so it must agree with the GLSL above: the tests compare
  // the two.

  const ancestors = new Map(); // level -> where its cell sits in its parent
  // (rule: where the space allows a room, as spaceRoom in the GLSL; none, everywhere.)
  const built = (id, seed, rule) => (!rule || rule(id, seed)) && h01(hashCell(id, seed ^ salt.built)) >= spec.solid;

  // dg is the point along the diagonals (see Position.levels). Without it they
  // are worked out from L and f, which is only good far from any such surface.
  // For finding a way through the halls (see planner.js): a cell's room, if
  // it has one (its height, its middle in its lattice units, and whether
  // piers stand in it, which a way across it must go round), and the
  // openings in its six faces, each as the middle of where it crosses the
  // face, the way across it (e), and the cell on the other side. (Of a row
  // of three windows or arches, the middle one.) The same hashes as above.
  function hallsRoom(id, seed, rule) {
    if (!built(id, seed, rule)) return null;
    const H = h01(hashCell(id, seed)) < spec.low ? HLO : HHI;
    // (As furniture has it: piers, unless over or under a light well.)
    const t = h01(hashCell(id, seed ^ salt.furniture));
    const under = h01(hashCell(wrapId([id[0], id[1] - 1, id[2]]), seed ^ salt.slab)), over = h01(hashCell(id, seed ^ salt.slab));
    return { H, middle: [C, M + H / 2, C], piers: t >= stands.none && t < stands.piers && Math.max(under, over) < slab.oculus };
  }
  function hallsOpenings(id, seed, rule) {
    const here = built(id, seed, rule);
    const out = [];
    for (const [a, sign] of [[0, 1], [0, -1], [2, 1], [2, -1], [1, 1], [1, -1]]) {
      const e = [0, 0, 0];
      e[a] = sign;
      const nb = wrapId(id.map((x, b) => x + e[b]));
      if (!here && !built(nb, seed, rule)) continue;
      // A face belongs to the cell on its lower side.
      const owner = sign > 0 ? id : nb;
      const at = [C, 0, C];
      at[a] = sign > 0 ? R : 0;
      if (a === 1) {
        if (h01(hashCell(owner, seed ^ salt.slab)) < slab.solid) continue;
      } else {
        const s = wallShape(hashCell(owner, seed ^ (a === 0 ? salt.wallX : salt.wallZ)), C, 0);
        if (!s) continue;
        at[a === 0 ? 2 : 0] = s.cu;
        at[1] = M + s.y0 + Math.min(s.top, s.sp + s.hw) / 2;
      }
      out.push({ e, at, nb });
    }
    return out;
  }

  // The halls cell's distance at L + f (dg: its diagonals, see pieces.at). And
  // if ray is given ({ dir }), for a ray along dir from there: how far it goes
  // in the piece of air it is in (reach, in lattice units; less than 0, in
  // solid), and the surface it meets there (nx, ny, nz); known says whether
  // the cell answers that (here, always).
  function hallsAir(L, f, id, seed, dg, rule, ray) {
    at(L, f, dg);
    if (ray) aim(ray);
    const here = built(id, seed, rule);
    const H = here && h01(hashCell(id, seed)) < spec.low ? HLO : HHI;
    let room = NONE;
    const hup = hashCell(id, seed ^ salt.slab);
    const hdn = hashCell(wrapId([id[0], id[1] - 1, id[2]]), seed ^ salt.slab);
    const hf = hashCell(id, seed ^ salt.furniture);
    if (here) {
      room = roomAir(L, f, H, hf, h01(hdn), h01(hup));
      through(ray, room, () => roomAir(L, f, H, hf, h01(hdn), h01(hup)));
    }
    // Openings reach only one unit into the room; deeper in, they change nothing.
    if (room < -1) return room;

    // Only the nearer face on each axis can matter to a point in this cell.
    const hx = beyond(L[0], f[0], C), hz = beyond(L[2], f[2], C), hy = beyond(L[1], f[1], M + H / 2);
    const ox = hx ? id : wrapId([id[0] - 1, id[1], id[2]]);
    const oz = hz ? id : wrapId([id[0], id[1], id[2] - 1]);
    let hwx = hashCell(ox, seed ^ salt.wallX), hwz = hashCell(oz, seed ^ salt.wallZ), hwy = hy ? hup : hdn;
    if (!here) {
      // A face has an opening only if there is a room on one side of it at
      // least. From a room, an opening into a solid cell is a niche.
      if (!built(wrapId([id[0] + (hx ? 1 : -1), id[1], id[2]]), seed, rule)) hwx = 0;
      if (!built(wrapId([id[0], id[1], id[2] + (hz ? 1 : -1)]), seed, rule)) hwz = 0;
      if (!built(wrapId([id[0], id[1] + (hy ? 1 : -1), id[2]]), seed, rule)) hwy = 0;
    }
    const wx = () => wallOpening(1, L[0], f[0], L[2], f[2], L[1], f[1], hx, hwx, 0, 2);
    const wz = () => wallOpening(0, L[2], f[2], L[0], f[0], L[1], f[1], hz, hwz, 2, 0);
    const wy = () => slabOpening(L, f, hy, H, hwy);
    const ax = wx(), az = wz(), ay = wy();
    through(ray, ax, wx);
    through(ray, az, wz);
    through(ray, ay, wy);

    // From inside the slab over a low room, the nearest air may be the room
    // above. This cell says nothing else about its neighbours' rooms.
    const above = Math.max(M - L[0] - f[0], L[0] - (R - M) + f[0], M - L[2] - f[2], L[2] - (R - M) + f[2], R + M - L[1] - f[1]);

    const a = Math.min(room, above, ax, az, ay);
    if (a <= 0) return a;

    // In solid, a must not overstate how far the nearest air is (see the GLSL).
    const q = [L[0] + f[0], L[1] + f[1], L[2] + f[2]];
    const edge = Math.min(q[0], R - q[0], q[1], R - q[1], q[2], R - q[2]);
    const unseen = Math.min(Math.abs(q[0] - C) + (C - M - 1), Math.abs(q[2] - C) + (C - M - 1), Math.abs(q[1] - (M + H / 2)) + (HLO / 2 - 1), edge + M);
    return Math.min(a, unseen);
  }

  const halls = {
    name: 'halls',
    R,
    glsl: hallsGlsl + /* glsl */ `
bool spaceRoom(ivec3 id, uint seed) { return true; }
float cell(ivec3 L, vec3 f, ivec3 id, uint seed, int level, out float reach, out vec3 nrm) {
  return hallsCell(L, f, id, seed, reach, nrm);
}
`,
    cellAir: (L, f, id, seed, dg, level, up, ray) => hallsAir(L, f, id, seed, dg, null, ray),
    maxInterior: 0.375,
    longestWay: 1.4,
    close: 0.3,
    openArea: 0.07,

    // Standing height in the middle of a room.
    start: [0.5, (M + 4.5) / R, 0.5],

    // By default a cell sits in the surface layer of one of its parent's four
    // walls, above the height any opening reaches, which is the one place that
    // is solid whatever the parent turns out to be. If the parent is a tall
    // room, it is just outside.
    //
    // The cell one level in from this one must have a room for that to mean
    // anything, so of the places this could be, take the first that gives it one.
    ancestorDigit(level) {
      let d = ancestors.get(level);
      if (d) return d;
      // (Worked from level 0 outward, and not by recursion, which a first call
      // for a very distant level would overrun.)
      for (let j = Math.max(level, 0); j >= level; j--) {
        if (ancestors.has(j)) continue;
        const inner = j < 0 ? ancestors.get(j + 1) : null;
        for (let k = 0; ; k++) {
          const h = hash32((j * 2 + 1) ^ Math.imul(k, 0x632be5ab));
          const g = hash32(h);
          const across = M + ((h >>> 8) % (R - 2 * M));
          const y = M + HLO + ((h >>> 16) % (R - 2 * M - HLO));
          const depth = g & 2 ? M - 1 : R - M;
          d = g & 1 ? [depth, y, across] : [across, y, depth];
          if (!inner || k > 60 || built(inner.map((x, a) => x + R * d[a]), levelSeed(j + 1))) break;
        }
        ancestors.set(j, d);
      }
      return ancestors.get(level);
    },

    // Each level gets its own colour so that scale is legible: hue steps by the
    // golden angle, so neighbouring levels always contrast.
    palette(level) {
      const j = (hash32(level) & 0xffff) / 0xffff;
      const h = 0.085 + level * 0.381966;
      const s = 0.2 + 0.14 * j;
      return {
        wall: hsv(h, s, 0.86),
        floor: hsv(h + 0.02, s * 1.15, 0.56),
      };
    },

    sky: [0.72, 0.8, 0.9],
    zenith: [0.3, 0.5, 0.82],
    roof: hsv(0.09, 0.16, 0.6),
    // The room we start in is in the top storey.
    get ground() {
      return this.ancestorDigit(0)[1] + 1;
    },
    fogK: 250, // visibility, in cells of the room we are in
    // For finding ways (see planner.js): its rooms' walls, half their
    // thickness; a cell's room and its openings.
    halfWall: M,
    room: (id, seed) => hallsRoom(id, seed),
    openings: (id, seed) => hallsOpenings(id, seed),
  };
  return { space: halls, spec, glsl: hallsGlsl, air: hallsAir, room: hallsRoom, openings: hallsOpenings, built };
}

// The halls as they are (and their parts, for the spaces built on them).
export const madeHalls = makeHalls();
export default madeHalls.space;
