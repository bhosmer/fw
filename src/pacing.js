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
