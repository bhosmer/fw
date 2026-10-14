// Free flight, by mouse alone or with keys: dragging looks, dragging with the
// right button (or with ctrl or cmd held) slides sideways and up and down, the
// wheel travels forward and back. There is no body, so no gravity and no
// collision; the only thing scale does is set how fast we travel (see main.js).

const PITCH_MAX = 1.55;
const WHEEL = 0.004; // clearances travelled per unit of wheel
const WHEEL_EASE = 0.08; // seconds over which a turn of the wheel is spent
const GRIP = 3; // how far off, in clearances, a dragged scene is taken to be

export class Controls {
  constructor(el, fovY) {
    this.el = el;
    this.keys = new Set();
    this.yaw = 0.6;
    this.pitch = -0.05;
    this.speed = 1;
    this.thread = false;
    this.slide = [0, 0]; // dragged sideways and up, not yet travelled (radians)
    this.dolly = 0; // wheeled forward, not yet travelled (clearances)

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
      if (e.code === 'KeyT' && !e.repeat) this.thread = !this.thread;
      if (e.code === 'Minus') this.faster(1 / 1.25);
      if (e.code === 'Equal') this.faster(1.25);
      if (e.code === 'Space' || e.code === 'Backspace' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
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

  // What the mouse has asked for since last time, as a displacement in
  // clearances. A drag is travelled at once; the wheel is spent smoothly.
  nudge(dt) {
    const { fwd, right, up } = this.basis();
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
    this.yaw += dyaw;
    this.pitch = Math.min(PITCH_MAX, Math.max(-PITCH_MAX, this.pitch + dpitch));
  }

  axis(pos, neg) {
    return (this.keys.has(pos) ? 1 : 0) - (this.keys.has(neg) ? 1 : 0);
  }

  update(dt) {
    // Trying flight-stick pitch (up arrow tips the nose down); swap back if not.
    this.turn(this.axis('ArrowRight', 'ArrowLeft') * 1.6 * dt, this.axis('ArrowDown', 'ArrowUp') * 1.6 * dt);
  }

  basis() {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const fwd = [sy * cp, sp, -cy * cp];
    const right = [cy, 0, sy];
    const up = [-sy * sp, cp, cy * sp];
    return { fwd, right, up };
  }

  // Direction we want to travel (not normalised to zero when idle), and boost.
  wish() {
    const { fwd, right } = this.basis();
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
