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
    this.halfWidth = 96;         // widest — the game narrows this with distance
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

    // Branching state.
    this.split = null;             // active fork (see _startSplit)
    this.ghost = null;             // the NOT-taken path, kept visible until off-screen
    this._forceTurnDir = 0;        // forces the main's next turn away from a fresh branch
    this._lastSplitS = -99999;
    this._nextForkS = undefined;   // distance-scheduled next fork (re-randomized each run)
    this._promotedForkIdx = -1;    // set when a branch is promoted (game resets index)

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
   * SINGLE SOURCE OF TRUTH for progressive difficulty, as a function of
   * distance travelled `d` (px). Everything — river width, boat speed,
   * turn radii, straight spacing — is derived here so the game, the
   * player and the generator all ramp together and stay in balance.
   *
   * The ramp is long and smoothstep-eased, so it's nearly invisible from
   * one section to the next but clearly tighter and faster after a long
   * run. Floors guarantee fairness: perfect play always traces the
   * centerline, and these limits keep the banks and spacing beatable.
   */
  static diff(d) {
    const raw = Utils.clamp(d / 30000, 0, 1);   // full ramp over ~30k px
    const t = raw * raw * (3 - 2 * raw);        // smoothstep — gentle at both ends

    const speed = Utils.lerp(340, 470, t);      // capped top speed
    return {
      t,
      speed,
      halfWidth: Utils.lerp(96, 46, t),         // wide -> tight (never impossible)
      minR: Utils.lerp(210, 150, t),            // stays > halfWidth: inside bank never pinches
      maxR: Utils.lerp(300, 195, t),
      // Reaction straight: long at first; late-game floor scales with
      // speed so there's always ~0.42s of straight to react between turns.
      straight: Math.max(Utils.lerp(340, 180, t), speed * 0.42),
    };
  }

  /** Geometry difficulty at the current GENERATION distance. */
  _difficulty() {
    return RiverGenerator.diff(this.s);
  }

  /** Generate one feature: a straight + a turn (or an S-curve). */
  _nextFeature() {
    const d = this._difficulty();
    // Turns take ANY natural angle (not snapped to 45/90/180) so the river
    // meanders like real flowing water. Spacing, radii and pivot placement
    // are unchanged — only the bend amount is now continuous. Gentle early,
    // wider range once players have settled in.
    // Moderate bends only (no near-hairpins) so the river meanders like real
    // flowing water and never doubles back to cross itself.
    const angleRange = this._featureCount < 3 ? [16, 42] : [20, 68];
    const randAngle = () => Utils.rand(angleRange[0], angleRange[1]) * Utils.DEG;

    // Reaction straight before the turn.
    this._addStraight(Utils.rand(d.straight * 0.8, d.straight * 1.2));

    // After a fork, force the first turn AWAY from the branch so the two
    // channels can never curve back and cross each other.
    let dir;
    if (this._forceTurnDir) { dir = this._forceTurnDir; this._forceTurnDir = 0; }
    else dir = Math.random() < 0.5 ? 1 : -1;
    const R = Utils.rand(d.minR, d.maxR);
    const angle = randAngle();

    // Occasionally build a gentle S-curve: two opposite bends with a breather.
    if (d.t > 0.25 && Math.random() < 0.22) {
      const R2 = Utils.rand(d.minR, d.maxR);
      const a2 = Utils.rand(18, 45) * Utils.DEG;      // gentle opposite bend
      // Breather between the two opposite turns — scaled to speed so it
      // never drops below ~0.3s of reaction even late in a run.
      const breather = Math.max(120, d.speed * 0.32);
      this._addTurn(R, angle, dir);
      this._addStraight(Utils.rand(breather, breather * 1.3));
      this._addTurn(R2, a2, -dir);
    } else {
      this._addTurn(R, angle, dir);
    }

    this._featureCount++;
  }

  /** Keep generating until the centerline extends past `targetS`. */
  ensureAhead(targetS) {
    let guard = 0;
    while (this.s < targetS && guard++ < 200) {
      this._maybeStartSplit();
      this._nextFeature();
    }
    // The branch is a fixed non-crossing stub built in _maybeStartSplit;
    // nothing more to generate on it until it's chosen and promoted.
  }

  // ============================================================
  // Branching — a second, FULL-WIDTH river peels away at a fork. The
  // main keeps going straight (no pivot near the fork) so releasing the
  // button glides you straight on; the branch has a swing post at the
  // fork so HOLDING hooks it and swings you onto the branch. The loser
  // is unloaded once the player has clearly committed.
  // ============================================================

  _maybeStartSplit() {
    return;                                                    // branching disabled — one river only
    if (this.split || this.ghost) return;                      // one fork at a time
    if (this.s < 2600) return;                                 // let players settle first
    // Distance-based, jittered spacing so forks feel irregular/organic.
    if (this._nextForkS === undefined) this._nextForkS = Utils.rand(2000, 2800);
    if (this.s < this._nextForkS) return;
    this._nextForkS = this.s + Utils.rand(1900, 3100);         // schedule the next one (more frequent)

    const forkIdx = this.points.length - 1;
    const forkS = this.s, fx = this.cx, fy = this.cy, fh = this.heading;

    // Main continues straight well past the fork so it stays straight
    // through the whole choose-a-lane window and its next turn is off-screen.
    this._addStraight(Utils.rand(720, 900));

    // Branch peels away with a turn whose ARC ENTRY is the fork, so the
    // post sits right where the player draws level with it.
    const d = RiverGenerator.diff(forkS);
    const dir = Math.random() < 0.5 ? 1 : -1;
    // Force the main's first turn to bend AWAY from the branch (no crossing).
    this._forceTurnDir = -dir;
    // A clean 90° branch: the main goes straight, the branch turns a full
    // quarter-circle off to the side (a normal 90° swing). The tight peel
    // separates the channels fast so the banks never overlap.
    const R = Utils.rand(d.minR, d.maxR);
    const b = { points: [], pivots: [], cx: fx, cy: fy, heading: fh, s: forkS, featureCount: 3 };
    this._bPush(b);
    this._bTurn(b, R, Math.PI / 2, dir);
    this._bStraight(b, 1100);   // non-crossing stub; real turns resume after commit

    // branchPivot is the single peel post: swinging it = you took the branch.
    this.split = { forkS, forkIdx, fork: { x: fx, y: fy }, dir, branch: b, branchPivot: b.pivots[0] };
    this._lastSplitS = forkS;
  }

  // Branch builders (mirror the main ones, operating on a branch object
  // so the working main generation stays completely untouched).
  _bPush(b) {
    const nx = -Math.sin(b.heading), ny = Math.cos(b.heading);
    b.points.push({ x: b.cx, y: b.cy, nx, ny, s: b.s });
  }
  _bStraight(b, length) {
    const steps = Math.max(1, Math.round(length / this.sampleStep));
    const dx = Math.cos(b.heading) * this.sampleStep, dy = Math.sin(b.heading) * this.sampleStep;
    for (let i = 0; i < steps; i++) { b.cx += dx; b.cy += dy; b.s += this.sampleStep; this._bPush(b); }
  }
  _bTurn(b, radius, angle, dir) {
    const nx = -Math.sin(b.heading), ny = Math.cos(b.heading);
    const cX = b.cx + dir * nx * radius, cY = b.cy + dir * ny * radius;
    const startPhi = Math.atan2(b.cy - cY, b.cx - cX);
    const startS = b.s, dPhi = this.sampleStep / radius;
    const steps = Math.max(1, Math.round(angle / dPhi));
    for (let i = 0; i < steps; i++) {
      const phi = startPhi + dir * dPhi * (i + 1);
      b.cx = cX + Math.cos(phi) * radius; b.cy = cY + Math.sin(phi) * radius;
      b.s += this.sampleStep; b.heading = phi + dir * Math.PI / 2; this._bPush(b);
    }
    b.pivots.push({ x: cX, y: cY, r: radius, dir, startS, endS: b.s, cleared: false });
  }
  _bFeature(b) {
    const d = RiverGenerator.diff(b.s);
    this._bStraight(b, Utils.rand(d.straight * 0.8, d.straight * 1.2));
    const dir = Math.random() < 0.5 ? 1 : -1;
    const R = Utils.rand(d.minR, d.maxR);
    const angle = Utils.rand(22, 115) * Utils.DEG;   // continuous natural bend
    if (d.t > 0.25 && Math.random() < 0.3) {
      const R2 = Utils.rand(d.minR, d.maxR), a2 = Utils.rand(20, 60) * Utils.DEG;
      const breather = Math.max(120, d.speed * 0.32);
      this._bTurn(b, R, angle, dir); this._bStraight(b, Utils.rand(breather, breather * 1.3)); this._bTurn(b, R2, a2, -dir);
    } else { this._bTurn(b, R, angle, dir); }
    b.featureCount++;
  }

  /** Pivots the player can currently hook (main + the active branch). */
  activePivots() {
    return this.split ? this.pivots.concat(this.split.branch.pivots) : this.pivots;
  }

  /** Nearest-point query against the branch centerline (short, so a full
   *  scan is cheap). Returns {offset, s, dist}. */
  locateBranch(x, y) {
    const b = this.split && this.split.branch;
    if (!b || b.points.length < 2) return { offset: 1e9, s: 0, dist: 1e9, tangent: 0 };
    let best = Infinity, bi = 0, bt = 0;
    for (let i = 0; i < b.points.length - 1; i++) {
      const p = b.points[i], q = b.points[i + 1];
      const abx = q.x - p.x, aby = q.y - p.y, apx = x - p.x, apy = y - p.y;
      const len2 = abx * abx + aby * aby || 1e-6;
      const t = Utils.clamp((apx * abx + apy * aby) / len2, 0, 1);
      const px = p.x + abx * t, py = p.y + aby * t, dd = Math.hypot(x - px, y - py);
      if (dd < best) { best = dd; bi = i; bt = t; }
    }
    const a = b.points[bi], c = b.points[bi + 1];
    const nx = Utils.lerp(a.nx, c.nx, bt), ny = Utils.lerp(a.ny, c.ny, bt);
    const px = a.x + (c.x - a.x) * bt, py = a.y + (c.y - a.y) * bt;
    return { offset: (x - px) * nx + (y - py) * ny, s: Utils.lerp(a.s, c.s, bt), dist: best, tangent: Math.atan2(-nx, ny) };
  }

  /**
   * Lock collision to the lane the player has clearly entered. Called
   * every frame during a fork: once the boat is well past the fork and
   * one channel is clearly nearer, that channel becomes the only one
   * that can crash the boat (`split.locked`). This stops the other path's
   * banks from ever causing an "invisible boundary".
   */
  /**
   * The fork commits the instant you ENGAGE the branch post (you took the
   * branch) or pass the fork without it (you stayed on main) — see the
   * GameManager. Both cases call one of these: the chosen lane becomes THE
   * river and generation continues on it (so the tracked index never snaps
   * — that snap was the "teleport"); the other lane is kept only as a
   * fading visual ghost until it scrolls off-screen.
   */
  _commitToBranch() {
    const sp = this.split, b = sp.branch;
    // The old main-forward becomes a visual ghost (no posts, not hookable).
    this.ghost = { points: this.points.slice(sp.forkIdx + 1), fork: sp.fork };
    // Promote the branch: splice it in as the continuation of the trunk.
    this.points.length = sp.forkIdx + 1;
    for (let i = 1; i < b.points.length; i++) this.points.push(b.points[i]);
    this.pivots = this.pivots.filter(p => p.endS <= sp.forkS).concat(b.pivots);
    this.cx = b.cx; this.cy = b.cy; this.heading = b.heading; this.s = b.s; this._featureCount = b.featureCount;
    this._promotedForkIdx = sp.forkIdx;
    this.split = null;
  }

  _commitToMain() {
    const sp = this.split;
    this.ghost = { points: sp.branch.points, fork: sp.fork };
    this.split = null;                                          // main already IS the river
  }

  /** Smoothly fade the ghost as the fork recedes, and drop it only once
   *  it's well off-screen (so it never vanishes while still visible). */
  updateGhost(camX, camY) {
    const g = this.ghost;
    if (!g) return;
    const d = Math.hypot(g.fork.x - camX, g.fork.y - camY);
    g.alpha = Utils.clamp((1500 - d) / 400, 0, 1);   // fade over d = 1100..1500
    if (d > 1500) this.ghost = null;
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

  /** Interpolated centerline point at arc-length `s` (for placing gems). */
  pointAtS(s) {
    const pts = this.points;
    if (pts.length < 2) return null;
    let i = pts.length - 1;
    while (i > 0 && pts[i].s > s) i--;
    const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)];
    const t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
    return {
      x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
      nx: Utils.lerp(a.nx, b.nx, t), ny: Utils.lerp(a.ny, b.ny, t), s,
    };
  }

  // -------------------- drawing --------------------

  /**
   * @param activeIdx  centerline index nearest the boat. The stretch
   *   around it is redrawn LAST so the lane you're actually in always
   *   wins over any overlapping/crossing branch. That is what makes the
   *   self-crossing river playable: what you see on top is exactly the
   *   lane you collide against.
   */
  draw(ctx, activeIdx, widthBonus = 0, flow = 0) {
    const pts = this.points;
    if (pts.length < 2) return;
    const last = pts.length - 1;

    // Draw ONLY the boat's local stretch — a single continuous route.
    // The river is one self-crossing path, so rendering the whole thing
    // made older loops show up behind as phantom "extra" boundaries.
    // Limiting to this window means you only ever see one route; the
    // window is wide enough that its ends stay off-screen.
    //
    // widthBonus is a RENDER-ONLY inflation used by the launch transition
    // to slide the banks in from the screen edges (collision always uses
    // the true halfWidth).
    const hw = this.halfWidth + widthBonus;
    const a = Utils.clamp((activeIdx | 0) - 130, 0, last);
    const b = Utils.clamp((activeIdx | 0) + 260, 0, last);
    // Banks themed to the ocean: a deep teal-navy shore with a glowing
    // aqua rim (matching the landing's cyan accents) around bright water.
    this._strokePath(ctx, pts, a, b, hw + 26, '#0a3a52');   // outer shore
    this._strokePath(ctx, pts, a, b, hw + 11, '#4fe3d8');   // glowing aqua rim
    this._strokePath(ctx, pts, a, b, hw, '#3bb6ea');        // bright water channel
    this._drawWaterAnim(ctx, pts, a, b, hw, flow);          // flowing foam + current
  }

  /**
   * Animated water material painted along the river: faint current/flow
   * lines and brighter white foam streaks, all following the centerline
   * (so they bend around curves) and scrolling downstream over time.
   * Because everything is parameterised along the continuous centerline,
   * it's seamless across segments and inherited by branches for free.
   * Foam streaks stretch and speed up with `flow` (the boat's speed).
   */
  _drawWaterAnim(ctx, pts, i0, i1, hw, flow) {
    if (i1 - i0 < 2) return;
    const t = performance.now() / 1000;
    const scroll = t * (44 + flow * 150);        // downstream scroll, faster with speed
    const stretch = 1 + flow * 1.6;              // foam elongates with speed

    ctx.lineCap = 'round';
    const streak = (off, width, color, dash, gap, speedMul) => {
      ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.setLineDash([dash * stretch, gap]);
      ctx.lineDashOffset = scroll * speedMul;
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) {
        const p = pts[i], x = p.x + p.nx * off, y = p.y + p.ny * off;
        if (i === i0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    // Faint current / flow lines.
    streak(-0.56 * hw, 2, 'rgba(190,240,255,0.09)', 30, 46, 1.0);
    streak(-0.20 * hw, 2, 'rgba(190,240,255,0.08)', 24, 52, 1.1);
    streak(0.22 * hw, 2, 'rgba(190,240,255,0.08)', 28, 48, 0.95);
    streak(0.56 * hw, 2, 'rgba(190,240,255,0.09)', 26, 50, 1.05);

    // Brighter white foam streaks.
    streak(-0.38 * hw, 3.6, 'rgba(255,255,255,0.16)', 46, 150, 1.2);
    streak(0.34 * hw, 3.6, 'rgba(255,255,255,0.15)', 52, 160, 1.15);
    streak(0.03 * hw, 3.0, 'rgba(255,255,255,0.12)', 40, 175, 1.25);

    // Sunlight sheen near the middle (flickers).
    const flick = 0.10 + 0.07 * Math.sin(t * 3);
    streak(0.0, 2.6, `rgba(215,250,255,${flick})`, 16, 96, 1.4);

    ctx.setLineDash([]);
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
    // During a fork, hide the main's post-fork posts so the ONLY post at the
    // split is the branch peel post — one clear choice, no clutter.
    const hideAfter = this.split ? this.split.forkS : Infinity;
    for (const p of this.pivots) {
      const active = p === activePivot;
      if (!active && p.startS > hideAfter) continue;
      // Declutter: only draw posts near the boat's current stretch.
      if (!active && (p.endS < playerS - 250 || p.startS > playerS + 1500)) continue;
      this._drawBuoy(ctx, p, active);
    }
  }

  _drawBuoy(ctx, p, active) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = 'rgba(0,40,70,0.18)';
    ctx.beginPath(); ctx.arc(2, 4, 16, 0, Utils.TWO_PI); ctx.fill();
    ctx.fillStyle = active ? '#ffd23f' : '#ff8a3d';
    ctx.beginPath(); ctx.arc(0, 0, active ? 15 : 13, 0, Utils.TWO_PI); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.arc(-4, -4, 4.5, 0, Utils.TWO_PI); ctx.fill();
    if (active) {
      ctx.strokeStyle = 'rgba(255,210,63,0.6)';
      ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.arc(0, 0, 25, 0, Utils.TWO_PI); ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Draw a FORK. The trick: paint both channels' shores, then both rims,
   * then both WATER bodies last. Because the water is drawn on top of all
   * the banks, the two channels merge cleanly in the shared throat (no
   * inner bank cutting across the other path) — banks only survive on the
   * OUTER edges where no water covers them. The island sits in the gap as
   * the divider. Exactly one continuous split, no overlapping boundaries.
   */
  drawForked(ctx, activeIdx, activePivot, flow = 0) {
    const sp = this.split;
    if (!sp) return;
    const pts = this.points, last = pts.length - 1;
    const a = Utils.clamp((activeIdx | 0) - 130, 0, last);
    const b = Utils.clamp((activeIdx | 0) + 260, 0, last);
    const bp = sp.branch.points, blast = bp.length - 1;
    const hw = this.halfWidth;

    const both = (width, color) => {
      this._strokePath(ctx, pts, a, b, width, color);
      if (blast >= 1) this._strokePath(ctx, bp, 0, blast, width, color);
    };
    both(hw + 26, '#0a3a52');   // outer shores
    both(hw + 11, '#4fe3d8');   // aqua rims
    both(hw, '#3bb6ea');        // water LAST — merges the throat, hides inner banks
    this._drawWaterAnim(ctx, pts, a, b, hw, flow);
    if (blast >= 1) this._drawWaterAnim(ctx, bp, 0, blast, hw, flow);

    if (blast >= 1) for (const p of sp.branch.pivots) this._drawBuoy(ctx, p, p === activePivot);
  }

  /** After committing, keep drawing the not-taken (ghost) path — faded and
   *  BEHIND the main so it recedes and dissolves cleanly instead of popping
   *  or overlapping the lane you're on. */
  drawWithGhost(ctx, activeIdx, flow = 0) {
    const g = this.ghost;
    const gp = g && g.points, glast = gp ? gp.length - 1 : 0;
    const hw = this.halfWidth;

    if (gp && glast >= 1) {
      ctx.save();
      ctx.globalAlpha = g.alpha != null ? g.alpha : 1;
      this._strokePath(ctx, gp, 0, glast, hw + 26, '#0a3a52');
      this._strokePath(ctx, gp, 0, glast, hw + 11, '#4fe3d8');
      this._strokePath(ctx, gp, 0, glast, hw, '#3bb6ea');
      this._drawWaterAnim(ctx, gp, 0, glast, hw, flow);
      ctx.restore();
    }

    // The lane you're on, full strength, on top.
    this.draw(ctx, activeIdx, 0, flow);
  }

  /** A long rounded sandbar/reef down the middle of a split. */
  _drawIsland(ctx, is) {
    const len = is.len || 460, w = is.w || 40;
    ctx.save();
    ctx.translate(is.x, is.y);
    ctx.rotate((is.dir || 0) + Math.PI / 2);   // +y runs down the length
    const leaf = (sw) => {
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.bezierCurveTo(sw, len * 0.16, sw, len * 0.7, 0, len);
      ctx.bezierCurveTo(-sw, len * 0.7, -sw, len * 0.16, 0, -8);
      ctx.closePath();
    };
    ctx.fillStyle = 'rgba(18, 66, 88, 0.6)'; leaf(w + 9); ctx.fill();   // submerged reef halo
    ctx.fillStyle = '#c9b487'; leaf(w); ctx.fill();                      // sand
    ctx.fillStyle = '#d8c79c'; leaf(w * 0.66); ctx.fill();
    // A few rocks + tufts of green scattered along it.
    const rnd = (n) => { const v = Math.sin((is.seed || 0) + n * 12.9898) * 43758.5; return v - Math.floor(v); };
    for (let i = 0; i < 6; i++) {
      const y = (0.14 + 0.72 * (i / 5)) * len, rx = (rnd(i) - 0.5) * w * 0.8, k = rnd(i + 20);
      if (k < 0.5) { ctx.fillStyle = '#5a6a72'; ctx.beginPath(); ctx.arc(rx, y, 3.5 + rnd(i + 5) * 3, 0, Utils.TWO_PI); ctx.fill(); }
      else { ctx.fillStyle = '#2f8f5e'; ctx.beginPath(); ctx.arc(rx, y, 4 + rnd(i + 7) * 3, 0, Utils.TWO_PI); ctx.fill(); }
    }
    ctx.restore();
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
    // Forward tangent of the river here (left normal is (-sin h, cos h),
    // so the heading down the river is atan2(-nx, ny)).
    const tangent = Math.atan2(-nx, ny);

    return { offset, s, index: bestIdx, tangent };
  }

  /** True if the boat (radius r) is touching or past either bank. */
  isCrashed(offset, r) {
    return Math.abs(offset) > this.river.halfWidth - r;
  }

  /** Full scan for the nearest centerline index to (x, y). Used once when a
   *  branch is promoted so the tracked index lands on the boat's ACTUAL spot
   *  on the new path — it can never snap/teleport regardless of distance. */
  reindex(x, y) {
    const pts = this.river.points;
    if (pts.length < 2) { this.index = 0; return 0; }
    let best = Infinity, bi = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const abx = b.x - a.x, aby = b.y - a.y, apx = x - a.x, apy = y - a.y;
      const len2 = abx * abx + aby * aby || 1e-6;
      const t = Utils.clamp((apx * abx + apy * aby) / len2, 0, 1);
      const px = a.x + abx * t, py = a.y + aby * t, d = Utils.dist(x, y, px, py);
      if (d < best) { best = d; bi = i; }
    }
    this.index = bi;
    return bi;
  }
}
