/* ============================================================
 * effects.js — EffectsManager
 *
 * All transient water visuals, tuned to make the boat feel like it's
 * carving through real water:
 *
 *   - wake      : a foam RIBBON that follows the exact path, widening
 *                 and fading behind the boat (not a single line).
 *   - foam      : churn bubbles kicked up at the stern.
 *   - spray     : sheets of foam thrown OUTWARD by centrifugal force
 *                 during drifts.
 *   - mist      : fine fast droplets trailing behind at speed.
 *   - ripples   : ambient expanding rings on the surface.
 *   - glints    : drifting light reflections on the water.
 *   - fragments : low-poly debris on crash, + splash.
 *
 * Everything is pooled in flat arrays with hard caps so the particle
 * load stays bounded at 60+ FPS.
 * ========================================================== */

class EffectsManager {
  constructor() {
    this.wake = [];       // ribbon trail points
    this.foam = [];       // stern churn bubbles
    this.spray = [];      // outward drift sheets
    this.mist = [];       // fine trailing droplets
    this.ripples = [];    // ambient rings
    this.glints = [];     // light reflections
    this.fragments = [];  // crash debris
    this.splash = [];     // crash splash
    this._rippleTimer = 0;
  }

  reset() {
    this.wake.length = 0;
    this.foam.length = 0;
    this.spray.length = 0;
    this.mist.length = 0;
    this.ripples.length = 0;
    this.glints.length = 0;
    this.fragments.length = 0;
    this.splash.length = 0;
    this._rippleTimer = 0;
  }

  // -------------------- emitters --------------------

  /** Drop a wake node. Perp is stored so the ribbon can be offset. */
  addWake(x, y, heading, baseW) {
    this.wake.push({
      x, y,
      px: -Math.sin(heading), py: Math.cos(heading), // left-perp unit
      w: baseW, life: 1,
    });
    if (this.wake.length > 120) this.wake.shift();
  }

  /** Churn foam bubbles at the stern. */
  emitFoam(x, y, heading, n) {
    for (let i = 0; i < n; i++) {
      const side = Math.random() < 0.5 ? 1 : -1;
      const ang = heading + Math.PI + side * Utils.rand(0.15, 0.7);
      const spd = Utils.rand(10, 55);
      this.foam.push({
        x: x + Utils.rand(-3, 3), y: y + Utils.rand(-3, 3),
        vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
        life: Utils.rand(0.5, 1.1), max: 1.1,
        r: Utils.rand(1.6, 4.2),
      });
    }
    if (this.foam.length > 240) this.foam.splice(0, this.foam.length - 240);
  }

  /** Sheets of foam thrown OUTWARD from a drift (dir = outward unit). */
  emitSpray(x, y, dirX, dirY, heading, intensity) {
    const n = Math.round(intensity * 4);
    for (let i = 0; i < n; i++) {
      // Blend outward (centrifugal) with a little backward drag.
      const bx = -Math.cos(heading), by = -Math.sin(heading);
      const mixX = dirX * 0.8 + bx * 0.35 + Utils.rand(-0.25, 0.25);
      const mixY = dirY * 0.8 + by * 0.35 + Utils.rand(-0.25, 0.25);
      const spd = Utils.rand(70, 180) * (0.6 + intensity);
      this.spray.push({
        x, y,
        vx: mixX * spd, vy: mixY * spd,
        life: Utils.rand(0.35, 0.75), max: 0.75,
        r: Utils.rand(1.8, 4.5),
      });
    }
    if (this.spray.length > 260) this.spray.splice(0, this.spray.length - 260);
  }

  /** Fine mist trailing behind at speed. */
  emitMist(x, y, heading, intensity) {
    const n = 1 + Math.round(intensity * 2);
    for (let i = 0; i < n; i++) {
      const ang = heading + Math.PI + Utils.rand(-0.5, 0.5);
      const spd = Utils.rand(20, 90);
      this.mist.push({
        x, y,
        vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
        life: Utils.rand(0.25, 0.55), max: 0.55,
        r: Utils.rand(0.8, 2),
      });
    }
    if (this.mist.length > 200) this.mist.splice(0, this.mist.length - 200);
  }

  /**
   * Ambient surface life: expanding ripples + drifting light glints
   * (reflections), kept populated near the camera and recycled as it
   * moves so they cost a fixed amount.
   */
  ambient(dt, camX, camY, viewR) {
    this._rippleTimer -= dt;
    if (this._rippleTimer <= 0) {
      this._rippleTimer = Utils.rand(0.35, 0.8);
      this.ripples.push({
        x: camX + Utils.rand(-viewR, viewR),
        y: camY + Utils.rand(-viewR, viewR),
        r: Utils.rand(4, 10), life: 1,
      });
    }

    // Maintain a fixed set of glints; recycle any that drift out of view.
    const TARGET = 22;
    while (this.glints.length < TARGET) {
      this.glints.push(this._newGlint(camX, camY, viewR));
    }
    for (const g of this.glints) {
      if (Utils.dist(g.x, g.y, camX, camY) > viewR * 1.4) {
        Object.assign(g, this._newGlint(camX, camY, viewR));
      }
    }
  }

  _newGlint(camX, camY, viewR) {
    return {
      x: camX + Utils.rand(-viewR, viewR),
      y: camY + Utils.rand(-viewR, viewR),
      size: Utils.rand(3, 8),
      phase: Utils.rand(0, Utils.TWO_PI),
      speed: Utils.rand(1.5, 3.5),
      drift: Utils.rand(4, 12),
    };
  }

  /** Explode the boat into low-poly shards + a splash. */
  crash(x, y, heading, speed) {
    for (let i = 0; i < 16; i++) {
      const ang = Utils.rand(0, Utils.TWO_PI);
      const spd = Utils.rand(60, 280);
      this.fragments.push({
        x, y,
        vx: Math.cos(ang) * spd + Math.cos(heading) * speed * 0.3,
        vy: Math.sin(ang) * spd + Math.sin(heading) * speed * 0.3,
        rot: Utils.rand(0, Utils.TWO_PI), vr: Utils.rand(-9, 9),
        size: Utils.rand(4, 11), life: Utils.rand(0.6, 1.1),
        color: Utils.pick(['#e23b2f', '#f4f7fb', '#1c1c1c', '#ff8a3d']),
      });
    }
    for (let i = 0; i < 34; i++) {
      const ang = Utils.rand(0, Utils.TWO_PI);
      const spd = Utils.rand(40, 260);
      this.splash.push({
        x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
        life: Utils.rand(0.4, 0.9), max: 0.9, r: Utils.rand(2, 5.5),
      });
    }
  }

  // -------------------- update --------------------

  update(dt) {
    for (const w of this.wake) w.life -= dt * 0.55; // ~1.8s wake
    while (this.wake.length && this.wake[0].life <= 0) this.wake.shift();

    this._stepParticles(this.foam, dt, 0.9);
    this._stepParticles(this.spray, dt, 0.9);
    this._stepParticles(this.mist, dt, 0.88);
    this._stepParticles(this.splash, dt, 0.9);

    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.r += 30 * dt; r.life -= dt * 1.2;
      if (r.life <= 0) this.ripples.splice(i, 1);
    }

    for (const g of this.glints) g.phase += g.speed * dt;

    for (let i = this.fragments.length - 1; i >= 0; i--) {
      const f = this.fragments[i];
      f.x += f.vx * dt; f.y += f.vy * dt;
      f.vx *= 0.94; f.vy *= 0.94;
      f.rot += f.vr * dt; f.life -= dt;
      if (f.life <= 0) this.fragments.splice(i, 1);
    }
  }

  _stepParticles(arr, dt, damp) {
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= damp; p.vy *= damp;
      p.life -= dt;
      if (p.life <= 0) arr.splice(i, 1);
    }
  }

  // -------------------- draw --------------------

  /** Water-surface effects that sit UNDER the boat. */
  drawUnder(ctx) {
    // Reflections / light glints.
    for (const g of this.glints) {
      const tw = 0.5 + 0.5 * Math.sin(g.phase);
      const a = 0.18 * tw;
      if (a < 0.02) continue;
      const dx = Math.cos(g.phase * 0.5) * g.drift;
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.beginPath();
      ctx.ellipse(g.x + dx, g.y, g.size * (0.6 + 0.4 * tw), g.size * 0.35, 0, 0, Utils.TWO_PI);
      ctx.fill();
    }

    // Ambient ripples.
    ctx.lineWidth = 1.5;
    for (const r of this.ripples) {
      ctx.strokeStyle = `rgba(255,255,255,${0.26 * r.life})`;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Utils.TWO_PI);
      ctx.stroke();
    }

    this._drawWakeRibbon(ctx);

    // Foam churn bubbles over the ribbon.
    for (const p of this.foam) {
      ctx.fillStyle = `rgba(255,255,255,${0.5 * (p.life / p.max)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Utils.TWO_PI);
      ctx.fill();
    }
  }

  /**
   * The wake as a widening, fading foam ribbon: a soft translucent body
   * plus a brighter churn core, both built by offsetting the trail along
   * its stored perpendicular. Width grows toward the tail (the wake
   * spreading) while alpha fades out.
   */
  _drawWakeRibbon(ctx) {
    if (this.wake.length < 2) return;

    const build = (widthScale, alpha) => {
      ctx.beginPath();
      // Left edge, boat -> tail.
      for (let i = this.wake.length - 1; i >= 0; i--) {
        const p = this.wake[i];
        const spread = 0.5 + (1 - p.life) * 1.4;         // wider toward tail
        const w = p.w * spread * widthScale;
        const x = p.x + p.px * w, y = p.y + p.py * w;
        if (i === this.wake.length - 1) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      // Right edge, tail -> boat.
      for (let i = 0; i < this.wake.length; i++) {
        const p = this.wake[i];
        const spread = 0.5 + (1 - p.life) * 1.4;
        const w = p.w * spread * widthScale;
        ctx.lineTo(p.x - p.px * w, p.y - p.py * w);
      }
      ctx.closePath();
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.fill();
    };

    build(1.0, 0.10);   // soft disturbed-water body
    build(0.5, 0.16);   // brighter churn core
  }

  /** Effects that sit OVER the boat. */
  drawOver(ctx) {
    for (const p of this.mist) {
      ctx.fillStyle = `rgba(226,244,255,${0.5 * (p.life / p.max)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Utils.TWO_PI);
      ctx.fill();
    }
    for (const p of this.spray) {
      ctx.fillStyle = `rgba(255,255,255,${0.9 * (p.life / p.max)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Utils.TWO_PI);
      ctx.fill();
    }
    for (const p of this.splash) {
      ctx.fillStyle = `rgba(235,248,255,${0.9 * (p.life / p.max)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Utils.TWO_PI);
      ctx.fill();
    }
    for (const f of this.fragments) {
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rot);
      ctx.globalAlpha = Utils.clamp(f.life, 0, 1);
      ctx.fillStyle = f.color;
      ctx.beginPath();
      ctx.moveTo(0, -f.size); ctx.lineTo(f.size, f.size); ctx.lineTo(-f.size, f.size);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}
