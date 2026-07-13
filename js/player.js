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
  }

  /** Speed slowly climbs with distance for a rising difficulty curve. */
  setDifficulty(s) {
    const t = Utils.clamp(s / 26000, 0, 1);
    this.speed = Utils.lerp(this.baseSpeed, 450, t);
  }

  /**
   * @param dt        delta time (s)
   * @param held      is the input currently held?
   * @param pivots    candidate pivots from the river
   * @param currentS  boat's current arc-length position on the river
   */
  update(dt, held, pivots, currentS) {
    // --- Input edge handling: attach on press, release on let-go. ---
    if (held && !this.swing.attached) {
      const target = this.swing.findTarget(
        this.x, this.y, this.heading, pivots, this.grabRange, currentS
      );
      if (target) this.swing.attach(this.x, this.y, this.heading, this.speed, target);
    } else if (!held && this.swing.attached) {
      this.swing.release();
    }

    // --- Integrate motion. ---
    if (this.swing.swinging) {
      // Circular motion around the pivot.
      const s = this.swing.step(dt, this.speed);
      this.x = s.x; this.y = s.y; this.heading = s.heading;
    } else {
      // Straight motion. This also covers the tether/dead-zone phase:
      // hooked but cruising straight until the perpendicular trigger.
      this.x += Math.cos(this.heading) * this.speed * dt;
      this.y += Math.sin(this.heading) * this.speed * dt;
      if (this.swing.attached) {
        this.swing.updateTether(this.x, this.y, this.heading, this.speed);
      }
    }

    // --- Visual feel. ---
    this.bobPhase += dt * 6;
    this.bob = Math.sin(this.bobPhase) * 1.6;
    const targetLean = this.swing.attached ? this.swing.dir * this.swing.intensity * 0.5 : 0;
    this.lean = Utils.damp(this.lean, targetLean, 8, dt);

    // --- Effects hand-off. ---
    const wakeW = Utils.lerp(5, 9, this.swing.intensity);
    this.effects.addWake(
      this.x - Math.cos(this.heading) * 10,
      this.y - Math.sin(this.heading) * 10,
      this.heading, wakeW
    );
    if (this.swing.intensity > 0.35) {
      this.effects.addSpray(this.x, this.y, this.heading, this.swing.intensity);
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
