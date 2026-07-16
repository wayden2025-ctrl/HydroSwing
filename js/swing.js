/* ============================================================
 * swing.js — SwingSystem
 *
 * A two-phase "leash" around a pivot, modelled on Sling Drift:
 *
 *   1. TETHER (dead zone). Pressing hooks the boat to a pivot, but the
 *      boat keeps moving STRAIGHT. The line just tracks your position —
 *      no turn is forced yet. You can hook the post early, from way back
 *      on the straight, and nothing happens until you reach the corner.
 *
 *   2. SWING (perpendicular trigger). The circular motion engages the
 *      instant the boat's heading becomes perpendicular to the line to
 *      the pivot — i.e. the moment you draw level with the post and the
 *      leash "snags." At that point your distance to the post equals the
 *      turn's radius, so the swing traces the river automatically. From
 *      there it's constant-speed circular motion; releasing flies you off
 *      tangent into the next straight.
 *
 * How long you hold AFTER the swing engages decides how far around you
 * go — a flick for 45 degrees, a beat for 90, a long hold for a 180.
 * ========================================================== */

class SwingSystem {
  constructor() {
    this.attached = false;  // hooked (tethered OR swinging)
    this.swinging = false;  // circular motion has engaged
    this.pivot = null;
    this.r = 0;       // orbit radius (fixed once swinging)
    this.phi = 0;     // current angle of boat around pivot
    this.dir = 1;     // +1 CCW, -1 CW
    this.omega = 0;   // angular speed (rad/s)
  }

  reset() {
    this.attached = false;
    this.swinging = false;
    this.pivot = null;
  }

  /**
   * Pick the CLOSEST post on the stretch just ahead. Because the swing
   * now only engages at the perpendicular point, hooking early is safe,
   * so this can arm across the whole approach straight (LOOKAHEAD) — we
   * just need the right upcoming turn, not perfect timing. Guards skip
   * posts we've already swung and posts whose arc is behind us.
   *
   * @param currentS  the boat's current arc-length position on the river
   */
  findTarget(x, y, heading, pivots, maxRange, currentS, preferred) {
    // At a fork the branch peel post is PREFERRED: while you're near it and
    // holding, hook it (not the nearest main post) so "hold = take the
    // branch" is reliable. Given a generous approach window.
    if (preferred && !preferred.cleared && currentS < preferred.endS &&
        currentS >= preferred.startS - 220 &&
        Math.hypot(preferred.x - x, preferred.y - y) <= maxRange) {
      return preferred;
    }
    const LOOKAHEAD = 900; // how far up the track we'll hook a post from
    let best = null, bestD = Infinity;
    for (const p of pivots) {
      if (p.cleared) continue;                       // already swung this turn
      if (p.endS <= currentS) continue;              // arc is behind us
      if (p.startS > currentS + LOOKAHEAD) continue; // turn is too far ahead
      const d = Math.hypot(p.x - x, p.y - y);
      if (d > maxRange) continue;                    // cable can't reach yet
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  /**
   * Hook onto a post. Starts in the tether/dead-zone phase; the swing
   * engages later via the perpendicular trigger. If we hook while already
   * level with (or past) the post, engage immediately.
   */
  attach(x, y, heading, speed, pivot) {
    this.pivot = pivot;
    this.attached = true;
    this.swinging = false;

    const dot = Math.cos(heading) * (pivot.x - x) + Math.sin(heading) * (pivot.y - y);
    if (dot <= 0) this._engage(x, y, heading, speed); // already at/past perpendicular
  }

  /**
   * The perpendicular trigger. While tethered, the boat moves straight;
   * once its heading is no longer pointing toward the post (the dot
   * product crosses zero at the perpendicular/closest-approach point),
   * the leash snags and the swing engages. Returns true if it engaged.
   */
  updateTether(x, y, heading, speed) {
    if (!this.attached || this.swinging) return false;
    const dot = Math.cos(heading) * (this.pivot.x - x) + Math.sin(heading) * (this.pivot.y - y);
    if (dot <= 0) { this._engage(x, y, heading, speed); return true; }
    return false;
  }

  /** Lock in the circular motion, preserving momentum. */
  _engage(x, y, heading, speed) {
    const dx = x - this.pivot.x, dy = y - this.pivot.y;
    this.r = Math.hypot(dx, dy) || 1;    // = perpendicular distance = turn radius
    this.phi = Math.atan2(dy, dx);
    this.omega = speed / this.r;
    this.swinging = true;
    this.pivot.grabbed = true;           // scoring credits only real swings

    // Spin direction that continues the incoming velocity.
    const tx = -Math.sin(this.phi), ty = Math.cos(this.phi);
    const along = Math.cos(heading) * tx + Math.sin(heading) * ty;
    this.dir = along >= 0 ? 1 : -1;
  }

  release() {
    this.attached = false;
    this.swinging = false;
    this.pivot = null;
  }

  /**
   * Advance the orbit by dt. Only meaningful once swinging. Mutates and
   * returns the boat's new {x, y, heading}.
   */
  step(dt, speed) {
    this.omega = speed / this.r;
    this.phi += this.dir * this.omega * dt;

    const x = this.pivot.x + Math.cos(this.phi) * this.r;
    const y = this.pivot.y + Math.sin(this.phi) * this.r;
    const tx = this.dir * -Math.sin(this.phi);
    const ty = this.dir * Math.cos(this.phi);
    const heading = Math.atan2(ty, tx);
    return { x, y, heading };
  }

  /** How hard we're cornering right now, 0..1 (for spray/lean). Zero
   *  during the tether phase — no spray until the swing actually bites. */
  get intensity() {
    if (!this.swinging) return 0;
    return Utils.clamp(220 / this.r, 0.3, 1.4) / 1.4;
  }
}
