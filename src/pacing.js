// A frame the GPU takes longer over than one refresh is shown a refresh
// late, and nothing on this side sees it: frames are still asked for on
// time, but what is shown jumps (in a turn, the whole view). So on a fast
// display, when frames run long, we draw only every other refresh: each
// frame then has two, every step covers the same time, and the picture stays
// sharp. Which it should be goes by the GPU's own times for recent frames,
// where they can be had; it changes only after holding for a while either
// way.
const HEAVY = 0.7, LIGHT = 0.45; // shares of a refresh: GPU p90 above / below
const KEEP = 60; // how many recent times are gone by
const HOLD_FULL = 500, HOLD_HALF = 3000; // ms before changing from every one / every other

export class Pacing {
  constructor(now = 0) {
    this.every = 1; // draw every this many refreshes
    this.gpuMs = []; // the GPU's times for recent frames
    this.intervals = []; // recent intervals between refreshes, ms
    this.last = now; // when the last refresh came
    this.since = 0; // when every last changed
    this.count = 0;
  }

  // At each refresh (now, ms), with the GPU times that have come back since
  // the last: whether to draw at this one.
  refresh(now, gpuMs = []) {
    const { intervals } = this;
    intervals.push(now - this.last);
    this.last = now;
    if (intervals.length > KEEP) intervals.shift();
    for (const ms of gpuMs) {
      this.gpuMs.push(ms);
      if (this.gpuMs.length > KEEP) this.gpuMs.shift();
    }
    this.choose(now);
    return ++this.count % this.every === 0;
  }

  choose(now) {
    if (this.gpuMs.length < KEEP / 2 || this.intervals.length < KEEP / 2) return;
    if (now - this.since < (this.every === 1 ? HOLD_FULL : HOLD_HALF)) return;
    // (A low percentile: refreshes come no faster than the display's.)
    const refresh = this.intervals.slice().sort((a, b) => a - b)[Math.floor(this.intervals.length * 0.1)];
    const p90 = this.gpuMs.slice().sort((a, b) => a - b)[Math.floor(this.gpuMs.length * 0.9)];
    // (Only on a display fast enough that half its rate is still smooth.)
    const want = refresh < 12 && p90 > HEAVY * refresh ? 2 : p90 < LIGHT * refresh ? 1 : this.every;
    if (want !== this.every) {
      this.every = want;
      this.since = now;
    }
  }
}

// Resolution follows frame time (see resize in main.js): the view's share of
// the pixels each way, one for frames in motion and one for still frames,
// each learned from the frames drawn and kept between them. In motion it
// gives way quickly when frames run long and returns slowly; still frames may
// take longer, up to STILL (as long as a key or a drag can wait unnoticed).
// Each is kept with the canvas it was learned on, since a frame's time goes
// with the pixels drawn: on another canvas the same number of pixels. And the
// frame rate shown, from the frames in motion.
export const MIN_UPSCALE = 0.35;
const SLOW = 1 / 45, QUICK = 1 / 55; // s a frame in motion: over / under
const GIVE = 3, TAKE = 90; // how many frames in a row before giving way / returning
const MOTION = 1 / 50; // s: what a frame in motion is meant to take
const STILL = 0.1; // s: the most a still frame may take
const STILL_GIVE = 3; // still frames over STILL in a row before giving way
const RISE = 1.25; // how much more of the pixels each way a calm rest lets the next have

// A share kept, on a canvas of n pixels.
const share = (kept, n) => Math.min(1, Math.max(MIN_UPSCALE, kept.upscale * Math.sqrt(kept.n / n)));

export class Resolution {
  // (settle: how many still frames a rest draws: see TAA_N in frame.js.)
  constructor(settle) {
    this.settle = settle;
    this.fps = 0;
    this.slow = 0; // frames in motion over SLOW in a row
    this.quick = 0; // frames in motion under QUICK in a row
    this.moving = { upscale: 1, n: Infinity }; // the share in motion, and the canvas's pixels it was learned on
    this.still = { upscale: 1, n: Infinity };
    this.over = []; // the times of still frames over STILL in a row
    this.calm = 0; // still frames under STILL / 2 in a row since this rest began
    this.at = null; // the share of the last frame drawn
    this.last = null; // what the last tick drew: 'moving', 'still' or nothing
    this.was = null; // what the last frame drawn was (at a tick that drew one)
    this.timing = null; // the share of rest the still frames last timed were drawn at
    this.times = []; // their times, this rest
  }

  // The share to draw at, in motion or not, on a canvas of n pixels. The
  // first still frame after motion begins a rest: if the last rest was calm
  // all through (all its frames timed: the first may not be), this one has
  // more of the pixels. (A share only rises between rests: a change of size
  // starts the history's still average over, so each change costs a settle
  // of its own: see Frames.resolve.) The first frame in motion after a rest
  // is sized by what that rest's still frames took (their median, a frame's
  // time going as its pixels): what a frame costs here and now, wherever
  // motion last learned its share. Frames quick enough say only that they
  // took no longer than the display allowed, so then it is no less than what
  // motion learned.
  upscale(moving, n) {
    const kept = moving ? this.moving : this.still;
    if (!moving && this.was === 'moving') {
      if (this.calm >= this.settle - 1 && kept.upscale < 1) this.keep(kept, Math.min(1, kept.upscale * RISE), kept.n);
      // (Nothing timed before counts in this rest; nor its first frame,
      // whose time may still be the frame's in motion before it.)
      this.calm = 0;
      this.times = [];
      this.over = [];
      this.timing = null;
    }
    if (moving && this.was === 'still' && this.times.length >= 3) {
      const t = this.times.slice().sort((a, b) => a - b)[this.times.length >> 1];
      const fits = Math.min(1, Math.max(MIN_UPSCALE, this.timing * Math.sqrt(MOTION / t)));
      this.keep(kept, t > MOTION ? fits : Math.max(fits, share(kept, n)), n);
      this.slow = this.quick = 0;
      this.times = [];
    }
    return share(kept, n);
  }

  // (All of the pixels is kept as no limit, on any canvas: nothing learned
  // says otherwise.)
  keep(kept, upscale, n) {
    kept.upscale = upscale;
    kept.n = upscale < 1 ? n : Infinity;
  }

  // A tick of the loop, raw s after the last, which drew (drawn) a frame in
  // motion, a still one or none, at upscale on a canvas of n pixels. (exact:
  // a view drawn at full resolution, as debug views and references are, from
  // which nothing is learned.) A frame in motion counts its own raw, as
  // always; a still frame's time is the raw of the tick after it (when the
  // GPU is the bottleneck, the loop waits for it), counted only if drawn at
  // the share of rest as it is. Every frame counts, however slow: a GPU that
  // takes far longer than the display allows is the one that most needs
  // fewer pixels; and a lone hitch (a tab shown again, a shader built) gives
  // way to nothing, since only frames slow in a row do.
  frame(raw, drawn, upscale, n, exact = false) {
    if (this.last === 'still') this.stillFrame(raw, n);
    this.last = exact ? null : drawn;
    if (this.last) this.was = this.last;
    this.at = upscale;
    if (drawn === 'moving') this.movingFrame(raw, upscale, n, exact);
  }

  movingFrame(raw, upscale, n, exact) {
    this.fps += (1 / raw - this.fps) * 0.1;
    if (raw > SLOW) this.slow++;
    else this.slow = 0;
    if (raw < QUICK) this.quick++;
    else this.quick = 0;
    if (exact) this.slow = this.quick = 0;
    if (this.slow >= GIVE) {
      this.slow = this.quick = 0;
      this.keep(this.moving, Math.max(MIN_UPSCALE, upscale * 0.8), n);
    } else if (this.quick >= TAKE) {
      this.quick = 0;
      this.keep(this.moving, Math.min(1, upscale * 1.1), n);
    }
  }

  stillFrame(raw, n) {
    // (Drawn at another share than the one of rest now, learned before a
    // change, it says nothing of this one; nor does the first drawn at a
    // share, whose time may still be the frame's before, the GPU being a
    // frame behind.)
    if (this.at !== share(this.still, n)) return;
    if (this.at !== this.timing) return void ((this.timing = this.at), (this.times = []));
    this.times.push(raw);
    this.calm = raw < STILL / 2 ? this.calm + 1 : 0;
    if (raw > STILL) this.over.push(raw);
    else this.over = [];
    if (this.over.length >= STILL_GIVE) {
      // (Pixels, and a GPU-bound frame's time, go as the share squared.)
      const t = Math.min(...this.over);
      this.keep(this.still, Math.max(MIN_UPSCALE, this.at * Math.sqrt(STILL / t)), n);
      this.over = [];
    }
  }

  // What is learned, to keep between visits (see restore).
  get saved() {
    return JSON.stringify({ moving: this.moving, still: this.still });
  }

  // What saved said, where it can be read; else nothing changes.
  restore(text) {
    let got;
    try {
      got = JSON.parse(text);
    } catch {
      return;
    }
    // (No limit is saved as n null.)
    const good = (k) => k && k.upscale >= MIN_UPSCALE && k.upscale <= 1 && (k.upscale === 1 || k.n >= 1);
    for (const kind of ['moving', 'still']) if (good(got?.[kind])) this.keep(this[kind], got[kind].upscale, got[kind].n);
  }
}
