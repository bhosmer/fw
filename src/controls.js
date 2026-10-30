// Free flight, by mouse alone or with keys: dragging looks, dragging with the
// right button (or with ctrl or cmd held) slides sideways and up and down, the
// wheel travels forward and back. Or by touch (see below). There is no body, so no gravity and no
// collision; the only thing scale does is set how fast we travel (see step in
// flight.js). Which way we face is the flight's: these turn it.

const WHEEL = 0.004; // paces travelled per unit of wheel (see nudge)
const WHEEL_EASE = 0.08; // seconds over which a turn of the wheel is spent
const GRIP = 3; // how far off, in paces, a dragged scene is taken to be
const PINCH = 4; // paces travelled for spreading two fingers e times as far apart

export class Controls {
  // flight: what these turn, and move along the way it faces.
  constructor(el, fovY, flight) {
    this.el = el;
    this.flight = flight;
    this.keys = new Set();
    this.speed = 1;
    this.turned = -Infinity; // when the view was last turned by hand
    this.slide = [0, 0]; // dragged sideways and up, not yet travelled (radians)
    this.dolly = 0; // wheeled forward, not yet travelled (paces)

    // Dragging takes hold of the scene: what is under the cursor stays under it.
    let dragging = 0;
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      dragging = e.button === 2 || e.ctrlKey || e.metaKey ? 2 : 1;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mouseup', () => (dragging = 0));
    addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const k = fovY / el.clientHeight;
      if (dragging === 1) this.turn(-e.movementX * k, e.movementY * k);
      else (this.slide[0] -= e.movementX * k), (this.slide[1] += e.movementY * k);
    });
    addEventListener('keydown', (e) => {
      if (e.metaKey || e.altKey || e.ctrlKey) return;
      this.keys.add(e.code);
      if (e.code === 'Minus') this.faster(1 / 1.25);
      if (e.code === 'Equal') this.faster(1.25);
      if (e.code === 'Space' || e.code === 'Backspace' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));

    // On a touch screen: one finger looks, two slide, and spreading or
    // pinching them travels forward or back.
    let touches = null; // where each finger was, by id
    const spread = (t) => (t.length > 1 ? Math.hypot(t[0].x - t[1].x, t[0].y - t[1].y) : 0);
    const read = (e) => [...e.touches].map((t) => ({ id: t.identifier, x: t.clientX, y: t.clientY }));
    const touch = (e) => {
      e.preventDefault();
      const now = read(e);
      if (touches && now.length === touches.length && now.every((t, i) => t.id === touches[i].id)) {
        const k = fovY / el.clientHeight;
        const n = now.length;
        const dx = now.reduce((s, t, i) => s + t.x - touches[i].x, 0) / n;
        const dy = now.reduce((s, t, i) => s + t.y - touches[i].y, 0) / n;
        if (n === 1) this.turn(-dx * k, dy * k);
        else {
          this.slide[0] -= dx * k;
          this.slide[1] += dy * k;
          const a = spread(touches), b = spread(now);
          if (a > 0 && b > 0) this.dolly += Math.log(b / a) * PINCH;
        }
      }
      touches = now.length ? now : null;
    };
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) el.addEventListener(type, touch, { passive: false });
    addEventListener('blur', () => {
      this.keys.clear();
      dragging = 0;
    });
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const lines = e.deltaMode === 1 ? 33 : 1;
        this.dolly -= e.deltaY * lines * WHEEL;
      },
      { passive: false },
    );
  }

  faster(k) {
    this.speed = Math.min(8, Math.max(0.05, this.speed * k));
  }

  // What the mouse has asked for since last time, as a displacement in paces
  // (one is the distance a wish of 1 goes in a second: see Flight.paced and
  // step). A drag is travelled at once; the wheel is spent smoothly.
  nudge(dt) {
    const { fwd, right, up } = this.flight.basis();
    const go = this.dolly * (1 - Math.exp(-dt / WHEEL_EASE));
    this.dolly = Math.abs(this.dolly - go) < 1e-4 ? 0 : this.dolly - go;
    const [sx, sy] = this.slide;
    this.slide = [0, 0];
    return [0, 1, 2].map((a) => (fwd[a] * go + (right[a] * sx + up[a] * sy) * GRIP) * this.speed);
  }

  // Let go of whatever the mouse had asked for.
  drop() {
    this.slide = [0, 0];
    this.dolly = 0;
  }

  turn(dyaw, dpitch) {
    if (dyaw || dpitch) this.turned = performance.now();
    this.flight.turn(dyaw, dpitch);
  }

  axis(pos, neg) {
    return (this.keys.has(pos) ? 1 : 0) - (this.keys.has(neg) ? 1 : 0);
  }

  update(dt) {
    this.turn(this.axis('ArrowRight', 'ArrowLeft') * 1.6 * dt, this.axis('ArrowUp', 'ArrowDown') * 1.6 * dt);
  }

  // Direction we want to travel (not normalised to zero when idle), and boost.
  wish() {
    const { fwd, right } = this.flight.basis();
    const f = this.axis('KeyW', 'KeyS');
    const r = this.axis('KeyD', 'KeyA');
    const u = this.axis('Space', 'KeyC');
    const v = [0, 1, 2].map((a) => fwd[a] * f + right[a] * r + (a === 1 ? u : 0));
    const len = Math.hypot(...v);
    return len > 0 ? v.map((x) => (x / len) * this.boost() * this.speed) : [0, 0, 0];
  }

  boost() {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 3 : 1;
  }

  // -1 to fly back along the way we came, 1 to fly it forward again.
  retracing() {
    if (this.keys.has('KeyR') || this.keys.has('Backspace')) return -1;
    return this.keys.has('KeyF') ? 1 : 0;
  }
}
