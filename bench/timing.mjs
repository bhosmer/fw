// GPU milliseconds a frame, taken from a page by fw.bench, for the
// benchmarks. Where the GPU gives no timing (not answered, or disturbed: see
// Renderer.time; or a time of nothing at all), it is taken again, up to three
// times more; where there is no timer, not. Each one not given is counted by
// why, and so is each given up on, for the benchmark to report, tree by tree.
// A timing given up on is NaN, which no least or median may take: callers
// leave it out.
//
// A tree from before timings said why (fw.bench a bare number, its timing
// read after about 2 s whether answered or not, never asked whether it was
// disturbed) has its Renderer.time replaced, by `prepare`, by one that asks as
// the later one does and gives NaN where there is no timing, saying why in
// the renderer's `why`: so that trees old and new are timed alike. (Trees
// from before bb076cd keep no timer of their own: it is asked for.)

const OLDER = `(async () => {
  const r = fw.renderer, t = await r.time(() => {});
  if (t && typeof t === 'object') return 'says why';
  r.time = async function (fn) {
    const gl = this.gl, ext = this.timer ?? gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.why = 'no timer';
    if (!ext) return NaN;
    gl.getParameter(ext.GPU_DISJOINT_EXT);
    const q = gl.createQuery();
    try {
      this.timingPaused = true;
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      try { fn(); } finally { gl.endQuery(ext.TIME_ELAPSED_EXT); this.timingPaused = false; }
      gl.flush();
      const until = performance.now() + 8000;
      while (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
        if (performance.now() > until) return (this.why = 'unanswered'), NaN;
        await new Promise((ok) => setTimeout(ok, 4));
      }
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) return (this.why = 'disturbed'), NaN;
      return gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
    } finally { gl.deleteQuery(q); }
  };
  return 'older: replaced';
})()`;

// What was not given for a tree, by why, and how many were given up on.
export const missed = () => ({ givenUp: 0 });

// Make a page just opened time as the later trees do (see above). It says
// which it found: 'says why', or 'older: replaced'.
export const prepare = (page) => page.eval(OLDER);

// fw.bench(n) in the page: ms a frame, or NaN once given up on. (An older
// tree's NaN comes back as nothing: its why is the renderer's.)
const ASK = (n) => `(async () => {
  const t = await fw.bench(${n});
  return typeof t === 'number' ? (Number.isFinite(t) ? { ms: t } : { why: fw.renderer.why ?? 'not given' }) : t;
})()`;
export async function bench(page, n, miss) {
  for (let tries = 0; tries < 4; tries++) {
    const t = await page.eval(ASK(n));
    if (Number.isFinite(t?.ms) && t.ms > 0) return t.ms;
    const why = t?.why ?? (t?.ms === 0 ? 'a time of nothing' : 'not given');
    miss[why] = (miss[why] ?? 0) + 1;
    if (why === 'no timer') break;
  }
  miss.givenUp++;
  return NaN;
}

// One line for the benchmark's report, for a tree.
export const report = (miss, name = '') => {
  const why = Object.entries(miss).filter(([k]) => k !== 'givenUp');
  return `${name ? name + ': ' : ''}timings not given: ${why.length ? why.map(([k, v]) => `${k} ${v}`).join(', ') : 'none'}; given up on: ${miss.givenUp}`;
};
