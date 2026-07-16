/* ============================================================
 * player.js — PlayerController (with the PhysicsController inline)
 *
 * Owns the boat's kinematic state and marries three systems:
 *   1. constant-speed forward motion (the PhysicsController role)
 *   2. the SwingSystem for orbiting pivots
 *   3. visual feel: bob, lean, wake + spray hand-off to effects
 *
 * The controller is intentionally dumb about failure — the
 * GameManager owns crash detection via the boundary system.
 * ========================================================== */

class PlayerController {
  constructor(effects) {
    this.effects = effects;
    this.swing = new SwingSystem();
    this.radius = 9;           // collision radius against the banks
    this.baseSpeed = 340;      // px/s at run start
    this.grabRange = 400;      // how far the cable can reach a buoy

    // Optional sprite: drop a top-down PNG at assets/jetski.png and it's
    // used automatically; otherwise we draw the vector jet ski below.
    this.sprite = new Image();
    this.spriteReady = false;
    this.sprite.onload = () => { this.spriteReady = true; };
    this.sprite.onerror = () => { this.spriteReady = false; };
    this.sprite.src = 'assets/jetski.png';
    this.spriteSize = 42;      // on-screen length of the sprite

    this.reset();
  }

  reset() {
    this.x = 0;
    this.y = 0;
    this.heading = -Math.PI / 2; // matches river's initial heading
    this.speed = this.baseSpeed;
    this.swing.reset();

    // Visual-only state.
    this.bobPhase = 0;
    this.bob = 0;
    this.lean = 0;   // radians, leans into turns
    this.alive = true;
    this._wasHeld = false;
    this.recoverT = 0;   // >0 = straightening toward the river after a swing
  }

  /** Speed slowly climbs with distance — from the shared difficulty curve. */
  setDifficulty(s) {
    this.speed = RiverGenerator.diff(s).speed;
  }

  /**
   * @param dt        delta time (s)
   * @param held      is the input currently held?
   * @param pivots    candidate pivots from the river
   * @param currentS  boat's current arc-length position on the river
   */
  update(dt, held, pivots, currentS, riverTangent, preferredPost) {
    const wasSwinging = this.swing.swinging;

    // --- Input edge handling: attach on press, release on let-go. ---
    if (held && !this.swing.attached) {
      const target = this.swing.findTarget(
        this.x, this.y, this.heading, pivots, this.grabRange, currentS, preferredPost
      );
      if (target) this.swing.attach(this.x, this.y, this.heading, this.speed, target);
    } else if (!held && this.swing.attached) {
      this.swing.release();
    }

    // The instant a swing ends, begin a brief straighten-out: the boat's
    // exit heading is whatever the orbit tangent was, which is usually NOT
    // aligned with the river. Recover toward the river's tangent so the
    // boat never keeps travelling at a diagonal (like a jet ski squaring
    // up after a turn).
    if (wasSwinging && !this.swing.swinging) this.recoverT = 0.18;

    // --- Integrate motion. ---
    if (this.swing.swinging) {
      // Circular motion around the pivot.
      const s = this.swing.step(dt, this.speed);
      this.x = s.x; this.y = s.y; this.heading = s.heading;
      this.recoverT = 0;
    } else {
      // While free (not hooked), smoothly rotate the heading toward the
      // river's forward tangent for the short recovery window, then hold
      // straight. Movement always follows the (recovered) heading, so the
      // boat never slides sideways.
      if (this.recoverT > 0 && !this.swing.attached &&
          riverTangent !== undefined && isFinite(riverTangent)) {
        this.heading = Utils.angleLerp(this.heading, riverTangent, 1 - Math.exp(-22 * dt));
        this.recoverT -= dt;
      }
      this.x += Math.cos(this.heading) * this.speed * dt;
      this.y += Math.sin(this.heading) * this.speed * dt;
      if (this.swing.attached) {
        this.swing.updateTether(this.x, this.y, this.heading, this.speed);
      }
    }

    // --- Visual feel: bob over waves + carve/lean into drifts. ---
    const inten = this.swing.intensity;
    this.bobPhase += dt * 6;
    // Two-frequency bob so it reads as riding chop, not a clean sine.
    this.bob = Math.sin(this.bobPhase) * 1.5 + Math.sin(this.bobPhase * 2.3 + 1) * 0.7;
    // Carve: nose points into the turn (rear kicks out) — eased in/out so
    // it recovers smoothly to upright on the straights.
    const targetLean = this.swing.swinging ? this.swing.dir * inten * 0.6 : 0;
    this.lean = Utils.damp(this.lean, targetLean, 7, dt);

    // --- Effects hand-off. ---
    const speedK = this.speed / this.baseSpeed;             // faster => more churn
    const sternX = this.x - Math.cos(this.heading) * 11;
    const sternY = this.y - Math.sin(this.heading) * 11;

    // Foam ribbon follows the exact path, widening with drift intensity.
    this.effects.addWake(sternX, sternY, this.heading, Utils.lerp(4.5, 9, inten));

    // Constant light churn + mist at the stern; more at speed.
    this.effects.emitFoam(sternX, sternY, this.heading, inten > 0.3 ? 3 : 1);
    this.effects.emitMist(sternX, sternY, this.heading, 0.3 * speedK + inten);

    // Centrifugal spray sheets during a drift, thrown to the OUTSIDE.
    if (this.swing.swinging && inten > 0.1) {
      const p = this.swing.pivot;
      let ox = this.x - p.x, oy = this.y - p.y;         // outward = away from pivot
      const m = Math.hypot(ox, oy) || 1; ox /= m; oy /= m;
      this.effects.emitSpray(this.x + ox * 6, this.y + oy * 6, ox, oy, this.heading, inten * speedK);
    }
  }

  /** Draw the jet ski, leaning + bobbing. Uses the PNG sprite if it
   *  loaded, otherwise a vector jet ski in the same red/black/white style. */
  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y + this.bob);
    ctx.rotate(this.heading + Math.PI / 2 + this.lean);

    // Soft shadow on the water.
    ctx.fillStyle = 'rgba(0,40,70,0.20)';
    ctx.beginPath();
    ctx.ellipse(0, 4, 9, 16, 0, 0, Utils.TWO_PI);
    ctx.fill();

    if (this.spriteReady) {
      // Sprite is top-down with the nose pointing up, matching local space.
      const s = this.spriteSize;
      const ar = this.sprite.width / this.sprite.height || 1;
      const h = s, w = s * ar;
      ctx.drawImage(this.sprite, -w / 2, -h / 2, w, h);
    } else {
      this._drawVectorJetSki(ctx);
    }

    ctx.restore();
  }

  /** Vector jet ski (nose up at -y), red hull / black seat / white trim. */
  _drawVectorJetSki(ctx) {
    const rr = (x, y, w, h, r) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };

    // White hull with dark outline (pointed nose, rounded stern).
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#141416';
    ctx.lineWidth = 2.4;
    ctx.fillStyle = '#f2f5f8';
    ctx.beginPath();
    ctx.moveTo(0, -19);
    ctx.bezierCurveTo(7, -17, 10.5, -7, 10.5, 2);
    ctx.bezierCurveTo(10.5, 11, 8, 15, 6, 17);
    ctx.lineTo(-6, 17);
    ctx.bezierCurveTo(-8, 15, -10.5, 11, -10.5, 2);
    ctx.bezierCurveTo(-10.5, -7, -7, -17, 0, -19);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Red body down the front and center.
    ctx.fillStyle = '#e0231c';
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.bezierCurveTo(5.5, -14, 7.5, -6, 7, 1);
    ctx.bezierCurveTo(7, 9, 5, 14, 3, 15);
    ctx.lineTo(-3, 15);
    ctx.bezierCurveTo(-5, 14, -7, 9, -7, 1);
    ctx.bezierCurveTo(-7.5, -6, -5.5, -14, 0, -16);
    ctx.closePath();
    ctx.fill();

    // Black seat / engine cover with ridge segments.
    ctx.fillStyle = '#26262a';
    rr(-4.6, -4, 9.2, 18, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    for (let yy = 1; yy < 12; yy += 3.5) {
      ctx.beginPath(); ctx.moveTo(-3.6, yy); ctx.lineTo(3.6, yy); ctx.stroke();
    }

    // Handlebars across the front, with a center console hub.
    ctx.strokeStyle = '#161618';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-8.5, -6);
    ctx.lineTo(8.5, -6);
    ctx.stroke();
    ctx.fillStyle = '#161618';
    ctx.beginPath();
    ctx.arc(0, -7, 3.2, 0, Utils.TWO_PI);
    ctx.fill();

    // Dark ridged rear footpad.
    ctx.fillStyle = '#3a3a3e';
    rr(-6, 9.5, 12, 7, 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.30)';
    ctx.lineWidth = 0.8;
    for (let yy = 11; yy < 16; yy += 1.5) {
      ctx.beginPath(); ctx.moveTo(-5, yy); ctx.lineTo(5, yy); ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  /** Draw the line to the pivot: a faint dashed "leash" while tethered
   *  in the dead zone, a bright taut cable once the swing engages. */
  drawCable(ctx) {
    if (!this.swing.attached) return;
    const p = this.swing.pivot;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y + this.bob);
    ctx.lineTo(p.x, p.y);
    if (this.swing.swinging) {
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
