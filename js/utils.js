/* ============================================================
 * utils.js — small math/helper toolbox shared by every system.
 * Kept dependency-free and attached to the global scope so the
 * other classic-script modules can use it directly.
 * ========================================================== */

const Utils = {
  clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; },

  lerp(a, b, t) { return a + (b - a) * t; },

  /** Frame-rate independent smoothing factor for exponential lerp. */
  damp(a, b, lambda, dt) { return Utils.lerp(a, b, 1 - Math.exp(-lambda * dt)); },

  rand(min, max) { return min + Math.random() * (max - min); },

  randInt(min, max) { return Math.floor(Utils.rand(min, max + 1)); },

  pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; },

  dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); },

  /** 2D cross product z-component. */
  cross(ax, ay, bx, by) { return ax * by - ay * bx; },

  /** Shortest signed angular difference b - a, wrapped to [-PI, PI]. */
  angleDelta(a, b) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  },

  /** Interpolate an angle the short way around. */
  angleLerp(a, b, t) { return a + Utils.angleDelta(a, b) * t; },

  TWO_PI: Math.PI * 2,
  DEG: Math.PI / 180,
};
