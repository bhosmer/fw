// 32-bit integer hash (any int in, uint32 out).
export function hash32(x) {
  x |= 0;
  x = (x ^ 61) ^ (x >>> 16);
  x = Math.imul(x, 9);
  x ^= x >>> 4;
  x = Math.imul(x, 0x27d4eb2d);
  x ^= x >>> 15;
  return x >>> 0;
}

// HSV (all 0..1, hue wraps) to linear RGB.
export function hsv(h, s, v) {
  h = ((h % 1) + 1) % 1;
  const f = (n) => {
    const k = (n + h * 6) % 6;
    const c = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.pow(c, 2.2);
  };
  return [f(5), f(3), f(1)];
}

// The same cell hash the shaders use (hashCell in shaders.js), bit for bit.
export function hashCell(p, s) {
  let h = Math.imul(p[0], 0x9e3779b1) ^ Math.imul(p[1], 0x85ebca77) ^ Math.imul(p[2], 0xc2b2ae3d) ^ s;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

// Cell ids repeat with period R^2 (wrapId in shaders.js, the same).
export function wrapId(id, R) {
  const P = R * R;
  return id.map((x) => ((x % P) + P) % P);
}

// What makes one level's cells differ from another's.
export function levelSeed(level) {
  return hash32(level ^ 0x5bd1e995);
}
