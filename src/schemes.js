// Colour and lighting schemes: L cycles through them, and the choice is
// remembered.
import { hash32, hsv } from './util.js';

// What a scheme may say, a row each. is: what it is where a scheme says
// nothing, a value or the space's own (a function of the space). light: for
// a light, its uniform's GLSL type; the uniform is named u + Name (uFill
// for fill) and declared from this table (see lightGlsl).
export const SCHEME = {
  // A light from the sun's direction that reaches everywhere, sun or no
  // sun (it gives indoor surfaces their shape).
  fill: { is: 0.25, light: 'float' },
  // Direct sunlight, only where a ray toward the sun reaches the sky; its
  // colour; and toward the sun (made of unit length, whatever is given).
  sun: { is: 1.0, light: 'float' },
  sunCol: { is: [1.0, 0.88, 0.7], light: 'vec3' },
  sunDir: { is: [0.4657, 0.8279, 0.3105], light: 'vec3' },
  // How much light comes from the sky (the haze) all round.
  ambient: { is: 1, light: 'float' },
  // A soft light carried with us, falling off lampReach clearances out.
  lamp: { is: 0.35, light: 'float' },
  lampReach: { is: 8, light: 'float' },
  // How bright the sun's disc is in the sky; how much cloud; how bright the
  // stars are.
  disc: { is: 1, light: 'float' },
  clouds: { is: 1, light: 'float' },
  stars: { is: 0, light: 'float' },
  // How strongly finer levels show as coloured inlay, before they open up
  // (else they show as shadowed recesses).
  inlay: { is: 0, light: 'float' },
  // The haze, and the colour of the light from it; the sky overhead; the
  // sky's plane seen from above, where nothing is drawn under it (the space's
  // roof).
  sky: { is: (space) => space.sky, light: 'vec3' },
  zenith: { is: (space) => space.zenith, light: 'vec3' },
  roof: { is: (space) => space.roof, light: 'vec3' },
  // Visibility, relative to the space's own.
  fog: { is: 1 },
  // level => { wall, floor }: the colours of each level, or none to keep
  // the space's palette.
  stone: { is: null },
};

// The lights' uniforms in GLSL; and each one's value in a scheme (made
// below, with every default but the space's own), for a space.
const uniform = (name) => 'u' + name[0].toUpperCase() + name.slice(1);
export const LIGHTS = Object.entries(SCHEME).filter(([, r]) => r.light).map(([name, r]) => ({ name, uniform: uniform(name), type: r.light }));
export const lightGlsl = () => LIGHTS.map((l) => `uniform ${l.type} ${l.uniform};`).join('\n');
export const lightOf = (scheme, name, space) => scheme[name] ?? SCHEME[name].is(space);

const jitter = (level, k) => ((hash32(level * 7 + k) & 0xffff) / 0xffff) * 2 - 1;

// Levels take colours from a set in turn, so that neighbours always differ;
// floors are the same colour, darker.
const turn = (colours, floorK) => (level) => {
  const n = colours.length;
  const wall = colours[((level % n) + n) % n];
  return { wall, floor: wall.map((x) => x * floorK) };
};

export const SCHEMES = [
  // Night: the light we carry, a pale moon, stars.
  {
    name: 'nocturne',
    fill: 0.03,
    sun: 0.3,
    sunCol: [0.6, 0.7, 1.0],
    sunDir: [-0.5, 0.75, 0.45],
    ambient: 0.12,
    lamp: 1.2,
    lampReach: 2.5,
    fog: 0.7,
    sky: [0.035, 0.045, 0.1],
    zenith: [0.01, 0.015, 0.05],
    roof: hsv(0.62, 0.3, 0.1),
    disc: 0.5,
    clouds: 0,
    stars: 1,
    stone(level) {
      return { wall: hsv(0.09 + 0.03 * jitter(level, 1), 0.12, 0.8), floor: hsv(0.08, 0.15, 0.5) };
    },
  },

  // De Chirico: a low sun, long dark shadows, ochre arcades under a green sky.
  {
    name: 'de chirico',
    fill: 0.12,
    sun: 1.5,
    sunCol: [1.0, 0.84, 0.58],
    sunDir: [0.75, 0.3, 0.55],
    ambient: 0.4,
    sky: [0.72, 0.78, 0.58],
    zenith: [0.08, 0.32, 0.33],
    roof: hsv(0.08, 0.35, 0.6),
    disc: 0.6,
    clouds: 0,
    stone: turn([hsv(0.07, 0.42, 0.84), hsv(0.11, 0.22, 0.92), hsv(0.04, 0.48, 0.74), hsv(0.09, 0.3, 0.88)], 0.7),
  },

  // The Alhambra: tilework in jewel colours, each level's openings inlaid
  // in the walls of the one above before they open up.
  {
    name: 'alhambra',
    fill: 0.35,
    inlay: 1,
    stone: turn([hsv(0.6, 0.6, 0.72), hsv(0.12, 0.12, 0.93), hsv(0.42, 0.5, 0.62), hsv(0.11, 0.55, 0.86), hsv(0.5, 0.5, 0.75), hsv(0.03, 0.55, 0.72)], 0.75),
  },
].map((s) => {
  // (A scheme as given, with what it leaves out as the table has it, but
  // for the space's own; the sun's direction of unit length.)
  const out = { ...Object.fromEntries(Object.entries(SCHEME).filter(([, r]) => typeof r.is !== 'function').map(([k, r]) => [k, r.is])), ...s };
  const d = Math.hypot(...out.sunDir);
  return { ...out, sunDir: out.sunDir.map((x) => x / d) };
});

const KEY = 'fw.scheme';

// The scheme a first visit starts in.
const FIRST = SCHEMES.findIndex((s) => s.name === 'alhambra');

export function loadScheme() {
  try {
    const i = SCHEMES.findIndex((s) => s.name === localStorage.getItem(KEY));
    return i >= 0 ? i : FIRST;
  } catch {
    return FIRST;
  }
}

export function saveScheme(i) {
  try {
    localStorage.setItem(KEY, SCHEMES[i].name);
  } catch {}
}
