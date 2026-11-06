// A place in a link: where we are and which way we face, kept in the hash of
// the page's URL (after the #) so that a place can be bookmarked or sent to
// someone. The hash is JSON in base64:
//
//   F, frac      the position (see position.js): a whole number (no
//                further either way than LEVEL_MOST), and three numbers in
//                [0, 1)
//   digits       of the position's digits, [j, [x, y, z]] for those (j <= F)
//                that are not what they would be anyway
//   yaw, pitch   which way we face (the pitch no further up or down than
//                we can face: see Flight.turn)
//   shown        'B' where two worlds are compared and the second is shown
//
// It is read here and written here, and a place is checked whole before any
// of it is applied: one that cannot be read is no place at all.
import { ALMOST_ONE } from './position.js';
import { PITCH_MAX } from './flight.js';
import { faceOpen } from './arrival.js';

// The furthest level from 0, either way, that a link may name, or a digit of
// a link be at: far beyond any flight (a level a second for hours on end),
// and near enough that the levels between are soon worked out. (A position
// keeps a digit for every level from where it is out to the coarsest it has
// been told of: a million levels takes seconds, ten million more than a Map
// can hold, failing in the midst of going there.)
export const LEVEL_MOST = 1e4;

// The place in a link, checked against the lattice it is to be in (R cells
// a side): { place }, or { why } it is no place. A place without yaw and
// pitch has facing null: it is faced as somewhere new is (see
// applyPlace).
export function readPlace(hash, R) {
  let at;
  try {
    at = JSON.parse(atob(hash.replace(/^#/, '')));
  } catch {}
  if (!at || typeof at !== 'object' || Array.isArray(at)) return { why: 'it cannot be read' };
  const { F, frac, digits = [], yaw, pitch } = at;
  const whole = (x) => Number.isInteger(x) && Math.abs(x) <= LEVEL_MOST;
  const triple = (v, ok) => Array.isArray(v) && v.length === 3 && v.every(ok);
  if (!whole(F)) return { why: `its level is not a whole number from -${LEVEL_MOST} to ${LEVEL_MOST}` };
  if (!triple(frac, (x) => typeof x === 'number' && x >= 0 && x <= ALMOST_ONE)) return { why: 'where it is in its cell is not three numbers from 0 to 1' };
  const digit = (e) => Array.isArray(e) && e.length === 2 && whole(e[0]) && e[0] <= F && triple(e[1], (x) => Number.isInteger(x) && x >= 0 && x < R);
  if (!Array.isArray(digits) || !digits.every(digit)) return { why: `its digits are not each a level from -${LEVEL_MOST} to ${F} and three whole numbers below ${R}` };
  // (A facing that was no number when it was written is written as null.)
  const faced = yaw != null && pitch != null;
  if ((yaw != null && !Number.isFinite(yaw)) || (pitch != null && !Number.isFinite(pitch))) return { why: 'which way it faces is not two numbers' };
  // (A pitch further up or down than we can face is taken to the most we
  // can, as turning would take it: see Flight.turn.)
  return {
    place: {
      F,
      frac: frac.slice(),
      digits: digits.map(([j, d]) => [j, d.slice()]),
      facing: faced ? { yaw, pitch: Math.min(PITCH_MAX, Math.max(-PITCH_MAX, pitch)) } : null,
      shown: at.shown === 'B' ? 'B' : 'A',
    },
  };
}

// Where a flight is, as a place, with the side shown ('A' or 'B').
export function placeOf(flight, shown = 'A') {
  const { pos } = flight;
  return {
    F: pos.F,
    frac: pos.frac.slice(),
    digits: [...pos.digits].map(([j, d]) => [j, d.slice()]),
    facing: { yaw: flight.yaw, pitch: flight.pitch },
    shown,
  };
}

// The hash for a place: of its digits, only those that are not what they
// would be anyway in each of spaces (the worlds compared, or the one).
export function writePlace({ F, frac, digits, facing, shown }, spaces) {
  const anyway = (j, d) => spaces.every((s) => s.ancestorDigit(j).every((x, a) => x === d[a]));
  const at = { F, frac, digits: digits.filter(([j, d]) => !anyway(j, d)), yaw: facing.yaw, pitch: facing.pitch, ...(shown === 'B' ? { shown } : {}) };
  return '#' + btoa(JSON.stringify(at));
}

// Be at a place (one readPlace has checked, so that none of this can fail
// halfway), and start out from there (see Flight.begin). show(side) shows
// the side of a comparison the place was shown on; it comes before the
// digits are set, as a flip makes the digits there into the other world's
// (see Flight.setSpace), and these are already in the world shown.
export function applyPlace(flight, { F, frac, digits, facing, shown }, show = () => {}) {
  const { pos } = flight;
  pos.F = F;
  show(shown);
  pos.frac = frac.slice();
  pos.digits = new Map(digits.map(([j, d]) => [j, d.slice()]));
  if (facing) {
    flight.yaw = facing.yaw;
    flight.pitch = facing.pitch;
  }
  flight.begin();
  // (Without a facing, the way somewhere new is faced: the most open.)
  if (!facing) faceOpen(flight);
}
