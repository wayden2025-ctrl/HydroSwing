/* ============================================================
 * river.js — RiverGenerator + RiverBoundarySystem
 *
 * The river is a smooth centerline built from alternating STRAIGHT
 * segments and circular-ARC turns. Every arc's *center* becomes a
 * pivot buoy. That is the key fairness guarantee:
 *
 *   A boat sitting on the centerline is exactly `R` from the arc
 *   center. Attaching there gives an orbit radius of `R`, so a
 *   perfectly-timed swing traces the centerline itself. Hold too
 *   long -> over-rotate into the inside bank. Release early ->
 *   drift wide into the outside bank. That gap is the whole game.
 *
 * The centerline is sampled into a dense polyline; the banks are
 * just that polyline offset by +/- halfWidth along its normals.
 * ========================================================== */

class RiverGenerator {
  constructor() {
    this.halfWidth = 82;         // distance from centerline to each bank
    this.sampleStep = 5;         // px between centerline samples
    this.points = [];            // {x, y, nx, ny, s}  (n = left normal, s = arc length)
    this.pivots = [];            // {x, y, r, dir, startS, endS, cleared}
    this.reset();
  }

  reset() {
    this.points.length = 0;
    this.pivots.length = 0;

    // Generator cursor state.
    this.cx = 0;
    this.cy = 0;
    this.heading = -Math.PI / 2;   // start heading "up" the screen
    this.s = 0;
    this._sinceTurn = 0;
    this._featureCount = 0;

    // Seed with a generous straight so the player can settle in.
    this._pushPoint();
    this._addStraight(520);
  }

  _pushPoint() {
    // Left normal = heading rotated +90 degrees.
    const nx = -Math.sin(this.heading);
    const ny = Math.cos(this.heading);
    this.points.push({ x: this.cx, y: this.cy, nx, ny, s: this.s });
  }

  _addStraight(length) {
    const steps = Math.max(1, Math.round(length / this.sampleStep));
    const dx = Math.cos(this.heading) * this.sampleStep;
    const dy = Math.sin(this.heading) * this.sampleStep;
    for (let i = 0; i < steps; i++) {
      this.cx += dx; this.cy += dy; this.s += this.sampleStep;
      this._pushPoint();
    }
  }

  /**
   * Append a circular arc turn and register its center as a pivot.
   * dir = +1 turns left (CCW), -1 turns right (CW).
   */
  _addTurn(radius, angle, dir) {
    // Arc center sits perpendicular to travel, `radius` away, on the
    // turn side (left normal for a left turn).
    const nx = -Math.sin(this.heading);
    const ny = Math.cos(this.heading);
    const centerX = this.cx + dir * nx * radius;
    const centerY = this.cy + dir * ny * radius;

    const startPhi = Math.atan2(this.cy - centerY, this.cx - centerX);
    const startS = this.s;

    const dPhi = this.sampleStep / radius; // angular step for one sample
    const steps = Math.max(1, Math.round(angle / dPhi));
    for (let i = 0; i < steps; i++) {
      const phi = startPhi + dir * dPhi * (i + 1);
      this.cx = centerX + Math.cos(phi) * radius;
      this.cy = centerY + Math.sin(phi) * radius;
      this.s += this.sampleStep;
      this.heading = phi + dir * Math.PI / 2;  // tangent to the arc
      this._pushPoint();
    }

    this.pivots.push({
      x: centerX, y: centerY,
      r: radius, dir,
      startS, endS: this.s,
      cleared: false,
    });
  }

  /**
   * Difficulty curve keyed off distance travelled. Straights shrink
   * and turn radii tighten as the run goes on, but never below a
   * floor that keeps every layout physically clearable.
   */
  _difficulty() {
    const t = Utils.clamp(this.s / 26000, 0, 1); // ramps over ~26k px
    // Turn radii stay comfortably above halfWidth (82) so the inside
    // bank never collapses into an unfair pinch, even on hairpins.
    return {
      straight: Utils.lerp(320, 165, t),
      minR: Utils.lerp(185, 150, t),
      maxR: Utils.lerp(275, 185, t),
      t,
    };
  }

  /** Generate one feature: a straight + a turn (or an S-curve). */
  _nextFeature() {
    const d = this._difficulty();
    // Only three corner types exist, so the player builds muscle memory
    // for each: the 45 flick, the 90 quarter-swing, the 180 hairpin.
    const angles = this._featureCount < 3
      ? [45, 90]                            // ease players in (no hairpins yet)
      : [45, 45, 90, 90, 90, 180];          // 180s are the rare, dramatic ones

    // Reaction straight before the turn.
    this._addStraight(Utils.rand(d.straight * 0.8, d.straight * 1.2));

    const dir = Math.random() < 0.5 ? 1 : -1;
    const R = Utils.rand(d.minR, d.maxR);
    const angle = Utils.pick(angles) * Utils.DEG;

    // Occasionally build an S-curve: two opposite turns back-to-back
    // with a short breather between them.
    if (d.t > 0.25 && Math.random() < 0.3) {
      const R2 = Utils.rand(d.minR, d.maxR);
      const a2 = Utils.pick([45, 90]) * Utils.DEG;   // S-curve uses the same set
      this._addTurn(R, angle, dir);
      this._addStraight(Utils.rand(90, 150));
      this._addTurn(R2, a2, -dir);
    } else {
      this._addTurn(R, angle, dir);
    }

    this._featureCount++;
  }

  /** Keep generating until the centerline extends past `targetS`. */
  ensureAhead(targetS) {
    let guard = 0;
    while (this.s < targetS && guard++ < 200) this._nextFeature();
  }

  /** Discard geometry well behind the player to bound memory. */
  cull(behindS) {
    let cut = 0;
    while (cut < this.points.length && this.points[cut].s < behindS) cut++;
    if (cut > 0) this.points.splice(0, cut);
    for (let i = this.pivots.length - 1; i >= 0; i--) {
      if (this.pivots[i].endS < behindS) this.pivots.splice(i, 1);
    }
    return cut; // caller shifts any stored indices by this amount
  }

  // -------------------- drawing --------------------

  /**
   * @param activeIdx  centerline index nearest the boat. The stretch
   *   around it is redrawn LAST so the lane you're actually in always
   *   wins over any overlapping/crossing branch. That is what makes the
   *   self-crossing river playable: what you see on top is exactly the
   *   lane you collide against.
   */
  draw(ctx, activeIdx) {
    const pts = this.points;
    if (pts.length < 2) return;
    const last = pts.length - 1;

    // Draw ONLY the boat's local stretch — a single continuous route.
    // The river is one self-crossing path, so rendering the whole thing
    // made older loops show up behind as phantom "extra" boundaries.
    // Limiting to this window means you only ever see one route; the
    // window is wide enough that its ends stay off-screen.
    const a = Utils.clamp((activeIdx | 0) - 130, 0, last);
    const b = Utils.clamp((activeIdx | 0) + 260, 0, last);
    this._strokePath(ctx, pts, a, b, this.halfWidth + 26, '#3fae5a');
    this._strokePath(ctx, pts, a, b, this.halfWidth + 10, '#5fd07a');
    this._strokePath(ctx, pts, a, b, this.halfWidth, '#37b3e6');

    // Subtle current line down the middle.
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(pts[a].x, pts[a].y);
    for (let i = a + 1; i <= b; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  _strokePath(ctx, pts, i0, i1, width, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width * 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[i0].x, pts[i0].y);
    for (let i = i0 + 1; i <= i1; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  drawPivots(ctx, activePivot, playerS) {
    for (const p of this.pivots) {
      const active = p === activePivot;
      // Declutter: only draw posts near the boat's current stretch
      // (plus whichever we're attached to), so crossing branches don't
      // spray unreachable posts across the screen.
      if (!active && (p.endS < playerS - 250 || p.startS > playerS + 1500)) continue;
      ctx.save();
      ctx.translate(p.x, p.y);

      // Shadow / water disturbance under the buoy.
      ctx.fillStyle = 'rgba(0,40,70,0.18)';
      ctx.beginPath(); ctx.arc(2, 3, 12, 0, Utils.TWO_PI); ctx.fill();

      // Buoy body.
      ctx.fillStyle = active ? '#ffd23f' : '#ff8a3d';
      ctx.beginPath(); ctx.arc(0, 0, active ? 12 : 10, 0, Utils.TWO_PI); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.arc(-3, -3, 3.5, 0, Utils.TWO_PI); ctx.fill();

      if (active) {
        ctx.strokeStyle = 'rgba(255,210,63,0.6)';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, 20, 0, Utils.TWO_PI); ctx.stroke();
      }
      ctx.restore();
    }
  }
}

/* ------------------------------------------------------------
 * RiverBoundarySystem — turns the centerline polyline into a
 * fast lateral-offset query and the crash test.
 * ---------------------------------------------------------- */
class RiverBoundarySystem {
  constructor(river) {
    this.river = river;
    this.index = 0; // last-known nearest centerline index (monotonic-ish)
  }

  reset() { this.index = 0; }

  /**
   * Find the nearest point on the centerline to (x, y) by scanning a
   * small window around the last index (the boat only moves forward,
   * so this stays O(1) amortised). Returns the perpendicular offset
   * and the arc length `s` at that point.
   */
  locate(x, y) {
    const pts = this.river.points;
    if (pts.length < 2) return { offset: 0, s: 0, index: 0 };

    const start = Math.max(0, this.index - 8);
    const end = Math.min(pts.length - 2, this.index + 80);

    let best = Infinity, bestIdx = start, bestT = 0;
    for (let i = start; i <= end; i++) {
      const a = pts[i], b = pts[i + 1];
      const abx = b.x - a.x, aby = b.y - a.y;
      const apx = x - a.x, apy = y - a.y;
      const len2 = abx * abx + aby * aby || 1e-6;
      let t = (apx * abx + apy * aby) / len2;
      t = Utils.clamp(t, 0, 1);
      const px = a.x + abx * t, py = a.y + aby * t;
      const d = Utils.dist(x, y, px, py);
      if (d < best) { best = d; bestIdx = i; bestT = t; }
    }

    this.index = bestIdx;
    const a = pts[bestIdx], b = pts[bestIdx + 1];
    // Signed offset using the (interpolated) left normal.
    const nx = Utils.lerp(a.nx, b.nx, bestT);
    const ny = Utils.lerp(a.ny, b.ny, bestT);
    const px = a.x + (b.x - a.x) * bestT;
    const py = a.y + (b.y - a.y) * bestT;
    const offset = (x - px) * nx + (y - py) * ny;
    const s = Utils.lerp(a.s, b.s, bestT);

    return { offset, s, index: bestIdx };
  }

  /** True if the boat (radius r) is touching or past either bank. */
  isCrashed(offset, r) {
    return Math.abs(offset) > this.river.halfWidth - r;
  }
}
