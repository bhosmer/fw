import { VERT } from './shaders.js';

// A program is built in two halves: begun (compiled and linked, without
// asking how that went, which would wait for it), then finished (its status
// checked, its uniforms found). Between them the GPU works on it while the
// page goes on (KHR_parallel_shader_compile: see Renderer.ready).
export function begin(gl, frag) {
  const prog = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, frag]]) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog);
  return prog;
}

// Its uniforms, as the program has them (u: by name, an array by its name
// without [0]; one the compiler found no use for is not among them, and
// setting it does nothing, as for a location of null); and its samplers,
// each given a texture unit of its own, in turn (units: by name). (It is
// left the program in use.)
export function finish(gl, prog) {
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    for (const sh of gl.getAttachedShaders(prog))
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('shader compile failed:\n' + gl.getShaderInfoLog(sh));
    throw new Error('program link failed:\n' + gl.getProgramInfoLog(prog));
  }
  // (The kinds of sampler drawn with; any other, or an array of them, is
  // refused rather than left to read whatever unit 0 holds.)
  const SAMPLERS = new Set([gl.SAMPLER_2D, gl.SAMPLER_3D, gl.INT_SAMPLER_2D, gl.INT_SAMPLER_3D, gl.UNSIGNED_INT_SAMPLER_2D, gl.UNSIGNED_INT_SAMPLER_3D]);
  const OTHER = new Set([gl.SAMPLER_CUBE, gl.SAMPLER_2D_ARRAY, gl.SAMPLER_2D_SHADOW, gl.SAMPLER_2D_ARRAY_SHADOW, gl.SAMPLER_CUBE_SHADOW, gl.INT_SAMPLER_CUBE, gl.INT_SAMPLER_2D_ARRAY, gl.UNSIGNED_INT_SAMPLER_CUBE, gl.UNSIGNED_INT_SAMPLER_2D_ARRAY]);
  const u = {}, units = {};
  gl.useProgram(prog);
  for (let i = 0; i < gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS); i++) {
    const { name, type, size } = gl.getActiveUniform(prog, i);
    if (name.startsWith('gl_')) continue;
    const n = name.replace(/\[0\]$/, '');
    u[n] = gl.getUniformLocation(prog, n);
    if (OTHER.has(type) || (SAMPLERS.has(type) && size > 1)) throw new Error(`a program samples ${n} as nothing here binds`);
    if (SAMPLERS.has(type)) gl.uniform1i(u[n], (units[n] = Object.keys(units).length));
  }
  return { prog, u, units };
}

export const link = (gl, frag) => finish(gl, begin(gl, frag));

// Texture tex on the unit the program's sampler name has (target: its kind).
export function bindSampler(gl, p, name, tex, target = gl.TEXTURE_2D) {
  if (!(name in p.units)) return;
  gl.activeTexture(gl.TEXTURE0 + p.units[name]);
  gl.bindTexture(target, tex);
  gl.activeTexture(gl.TEXTURE0);
}
