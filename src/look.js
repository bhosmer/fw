// The tour's look: what the view sees, sparsely, read back without waiting
// for the GPU.
export class Look {
  constructor(gl, canvas) {
    this.gl = gl;
    this.canvas = canvas;
    this.sync = null;
  }

  // Whether a look is on its way back.
  get looking() {
    return this.sync !== null;
  }

  // For every stride-th pixel of the canvas (each drawn in as much detail as
  // on screen), the distance to what it hits, or -1 for nothing; drawn by
  // draw (with the view's program: see Renderer.look) into the look's own
  // target. It is read back without waiting for the GPU; seen() hands it
  // over once it has arrived. One at a time. (Drawn in the view's own
  // format, so that the GPU need build nothing new for it: as the log of
  // the distance, its whole part and the rest in two channels.)
  look(draw, view, stride) {
    const gl = this.gl;
    if (this.sync) return false;
    // (What the tour sees is sized by the canvas as it is, not as shown.)
    view = { ...view, lodH: this.canvas.height };
    const w = Math.ceil(this.canvas.width / stride), h = Math.ceil(this.canvas.height / stride);
    if (!this.tex || this.size[0] !== w || this.size[1] !== h) {
      if (this.tex) gl.deleteTexture(this.tex);
      this.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, w, h);
      this.fbo ??= gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
      this.pbo ??= gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
      // (Not STREAM_READ, though it is read back: for a buffer said to be for
      // reading, Chrome copies it aside at every fence, for a way of reading
      // that WebGL never takes, and warns each time that the copy was wasted.)
      gl.bufferData(gl.PIXEL_PACK_BUFFER, w * h * 16, gl.STREAM_COPY);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.size = [w, h];
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, w, h);
    draw({ ...view, debug: 5, reference: false }, stride);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    return true;
  }

  seen() {
    const gl = this.gl;
    if (!this.sync) return null;
    const s = gl.clientWaitSync(this.sync, 0, 0);
    if (s !== gl.ALREADY_SIGNALED && s !== gl.CONDITION_SATISFIED) return null;
    const [w, h] = this.size;
    const px = new Float32Array(w * h * 4);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, px);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.deleteSync(this.sync);
    this.sync = null;
    const dist = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) dist[i] = px[i * 4] < -500 ? -1 : 2 ** (px[i * 4] + px[i * 4 + 1]);
    return { w, h, dist };
  }
}
