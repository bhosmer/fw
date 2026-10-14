// Lighting schemes: L cycles through them, and the choice is remembered.
//   fill  a light from the sun's direction that reaches everywhere, sun or
//         no sun (it gives indoor surfaces their shape)
//   sun   direct sunlight, only where a ray toward the sun reaches the sky
// (Colour schemes can go here too, when there are some.)
export const SCHEMES = [
  { name: 'sunlit', fill: 0.25, sun: 1.0 },
  { name: 'classic', fill: 0.55, sun: 0.9 },
];

const KEY = 'fw.scheme';

export function loadScheme() {
  try {
    const i = SCHEMES.findIndex((s) => s.name === localStorage.getItem(KEY));
    return Math.max(i, 0);
  } catch {
    return 0;
  }
}

export function saveScheme(i) {
  try {
    localStorage.setItem(KEY, SCHEMES[i].name);
  } catch {}
}
