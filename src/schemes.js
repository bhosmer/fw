// Colour and lighting schemes: L cycles through them, and the choice is
// remembered. Anything a scheme leaves out is as in DEFAULTS, or for colours,
// as the space has them.
//   fill     a light from the sun's direction that reaches everywhere, sun or
//            no sun (it gives indoor surfaces their shape)
//   sun      direct sunlight, only where a ray toward the sun reaches the sky
//   sunCol   the colour of sunlight
//   ambient  how much light comes from the sky (the haze) all round
//   lamp     a soft light carried with us, falling off reach clearances out
//   glow     light every surface gives off of itself
//   mirror   how much floors (and the ground) reflect, at a grazing angle
//   fog      visibility, relative to the space's own
//   sky      the haze, and the colour of the light from it; zenith is the
//            sky overhead, ground the ground seen from above
//   sunDir   toward the sun (need not be of unit length)
//   disc     how bright the sun's disc is in the sky; clouds, how much cloud;
//            stars, how bright the stars are
//   shafts   how much sunlight the haze catches, showing shafts of light
//   inlay    how strongly finer levels show as coloured inlay, before they
//            open up (else they show as shadowed recesses)
//   stone    level => { wall, floor }: the colours of each level, or none
//            to keep the space's palette
import { hash32, hsv } from './util.js';

const DEFAULTS = {
  fill: 0.25, sun: 1.0, sunCol: [1.0, 0.88, 0.7], sunDir: [0.4657, 0.8279, 0.3105],
  ambient: 1, lamp: 0.35, reach: 8, glow: 0, mirror: 0, fog: 1,
  disc: 1, clouds: 1, stars: 0, shafts: 0, inlay: 0,
};

const jitter = (level, k) => ((hash32(level * 7 + k) & 0xffff) / 0xffff) * 2 - 1;

// Levels take colours from a set in turn, so that neighbours always differ;
// floors are the same colour, darker.
const turn = (colours, floorK) => (level) => {
  const n = colours.length;
  const wall = colours[((level % n) + n) % n];
  return { wall, floor: wall.map((x) => x * floorK) };
};

export const SCHEMES = [
  { name: 'sunlit' },

  // Piranesi's Carceri: brown stone in a smoky dusk, lit from far above by
  // hard light that only some openings let in.
  {
    name: 'carceri',
    fill: 0.4,
    sun: 1.7,
    sunCol: [1.0, 0.82, 0.58],
    ambient: 0.18,
    lamp: 0.15,
    fog: 0.4,
    sky: [0.34, 0.3, 0.24],
    zenith: [0.5, 0.47, 0.42],
    ground: hsv(0.08, 0.2, 0.4),
    disc: 0.5,
    clouds: 1.5,
    shafts: 1.2,
    // One stone throughout, each level a little lighter or darker, warmer
    // or cooler than the next, so that scale still shows.
    stone(level) {
      const h = 0.08 + 0.025 * jitter(level, 1);
      const s = 0.2 + 0.06 * jitter(level, 2);
      const v = 0.7 + 0.12 * jitter(level, 3);
      return { wall: hsv(h, s, v), floor: hsv(h + 0.01, s * 1.2, v * 0.62) };
    },
  },

  // Baudelaire's Rêve parisien: no sun, no stars; marble that shines with
  // its own light, over floors of still water.
  {
    name: 'rêve',
    fill: 0.22,
    sun: 0,
    lamp: 0.2,
    glow: 0.32,
    mirror: 0.85,
    fog: 1.3,
    sky: [0.55, 0.56, 0.66],
    zenith: [0.36, 0.36, 0.5],
    ground: hsv(0.6, 0.35, 0.16),
    disc: 0,
    clouds: 0,
    // Pale marble, faintly tinted level by level; the floors dark water.
    stone(level) {
      const h = 0.085 + level * 0.381966;
      return { wall: hsv(h, 0.07 + 0.03 * jitter(level, 1), 0.9), floor: hsv(0.58 + 0.04 * jitter(level, 2), 0.4, 0.14) };
    },
  },

  // Night: the light we carry, a pale moon, stars.
  {
    name: 'nocturne',
    fill: 0.03,
    sun: 0.3,
    sunCol: [0.6, 0.7, 1.0],
    sunDir: [-0.5, 0.75, 0.45],
    ambient: 0.12,
    lamp: 1.2,
    reach: 2.5,
    fog: 0.7,
    sky: [0.035, 0.045, 0.1],
    zenith: [0.01, 0.015, 0.05],
    ground: hsv(0.62, 0.3, 0.1),
    disc: 0.5,
    clouds: 0,
    stars: 1,
    stone(level) {
      return { wall: hsv(0.09 + 0.03 * jitter(level, 1), 0.12, 0.8), floor: hsv(0.08, 0.15, 0.5) };
    },
  },

  // Morandi: chalky, quiet colours in a soft light.
  {
    name: 'morandi',
    fill: 0.45,
    sun: 0.45,
    sunCol: [1.0, 0.95, 0.88],
    ambient: 0.85,
    sky: [0.78, 0.76, 0.72],
    zenith: [0.62, 0.66, 0.7],
    ground: hsv(0.09, 0.14, 0.72),
    disc: 0.4,
    clouds: 0.6,
    stone: turn([hsv(0.03, 0.2, 0.84), hsv(0.25, 0.14, 0.74), hsv(0.11, 0.28, 0.82), hsv(0.58, 0.13, 0.76), hsv(0.09, 0.09, 0.88)], 0.78),
  },

  // Hammershøi: grey rooms, pale light from one side.
  {
    name: 'hammershøi',
    fill: 0.3,
    sun: 0.9,
    sunCol: [0.93, 0.96, 1.0],
    sunDir: [0.85, 0.35, -0.3],
    ambient: 0.75,
    sky: [0.72, 0.73, 0.74],
    zenith: [0.58, 0.62, 0.66],
    ground: hsv(0.1, 0.06, 0.6),
    disc: 0.2,
    clouds: 1.4,
    stone(level) {
      return { wall: hsv(0.1, 0.04 + 0.02 * jitter(level, 1), 0.78 + 0.06 * jitter(level, 2)), floor: hsv(0.08, 0.1, 0.48) };
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
    ground: hsv(0.08, 0.35, 0.6),
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
].map((s) => ({ ...DEFAULTS, ...s }));

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
