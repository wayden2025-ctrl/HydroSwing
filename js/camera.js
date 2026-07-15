/* ============================================================
 * camera.js — CameraController
 *
 * Smooth follow with velocity look-ahead and a decaying shake.
 * Uses exponential damping (Utils.damp) so it never jitters and is
 * frame-rate independent. Exposes an apply()/reset() pair around the
 * world draw so systems can render in plain world coordinates.
 * ========================================================== */

class CameraController {
  constructor(canvas) {
    this.canvas = canvas;
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.shake = 0;
    this._shakeX = 0;
    this._shakeY = 0;
    this.lookAhead = 200; // px in front of the boat we bias toward
    this.anchorY = 0.62;  // boat's vertical screen position (moves to center during a world-spin)
  }

  reset(target) {
    this.x = target.x;
    this.y = target.y;
    this.shake = 0;
  }

  addShake(amount) { this.shake = Math.min(this.shake + amount, 26); }

  update(dt, target) {
    // Aim a little ahead in the direction of travel for reaction time.
    const ax = target.x + Math.cos(target.heading) * this.lookAhead;
    const ay = target.y + Math.sin(target.heading) * this.lookAhead;

    this.x = Utils.damp(this.x, ax, 4.5, dt);
    this.y = Utils.damp(this.y, ay, 4.5, dt);

    // Decay + randomise shake.
    this.shake = Utils.damp(this.shake, 0, 6, dt);
    this._shakeX = Utils.rand(-1, 1) * this.shake;
    this._shakeY = Utils.rand(-1, 1) * this.shake;
  }

  /** Push the world transform. Call ctx.restore() via reset() after. */
  apply(ctx) {
    const w = this.canvas.width / (window.devicePixelRatio || 1);
    const h = this.canvas.height / (window.devicePixelRatio || 1);
    ctx.save();
    ctx.translate(w / 2 + this._shakeX, h * this.anchorY + this._shakeY); // boat sits low-center
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }

  restore(ctx) { ctx.restore(); }
}
