/* ============================================================
 * effects.js — EffectsManager
 * Owns every transient particle/visual: the wake trail, drifting
 * spray, ambient ripples, crash fragments and splash. Everything
 * is pooled in flat arrays and drawn in world space.
 * ========================================================== */

class EffectsManager {
  constructor() {
    this.wake = [];       // trail ribbon behind the ski
    this.spray = [];      // white droplets kicked up while swinging
    this.ripples = [];    // ambient expanding rings on the water
    this.fragments = [];  // low-poly debris on crash
    this.splash = [];     // crash splash droplets
    this._rippleTimer = 0;
  }

  reset() {
    this.wake.length = 0;
    this.spray.length = 0;
    this.ripples.length = 0;
    this.fragments.length = 0;
    this.splash.length = 0;
    this._rippleTimer = 0;
  }

  /** Continuous wake ribbon point dropped every frame behind the boat. */
  addWake(x, y, heading, width) {
    this.wake.push({ x, y, heading, w: width, life: 1 });
    if (this.wake.length > 90) this.wake.shift();
  }

  /** Spray droplets — stronger while drifting hard around a pivot. */
  addSpray(x, y, heading, intensity) {
    const n = Math.round(intensity * 3);
    for (let i = 0; i < n; i++) {
      const side = Math.random() < 0.5 ? 1 : -1;
      const ang = heading + Math.PI + side * Utils.rand(0.2, 0.9);
      const spd = Utils.rand(40, 130) * intensity;
      this.spray.push({
        x, y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: Utils.rand(0.3, 0.7),
        max: 0.7,
        r: Utils.rand(1.5, 3.5),
      });
    }
  }

  /** Ambient ripples so the water reads as alive even on straights. */
  ambientRipple(dt, x, y, radius) {
    this._rippleTimer -= dt;
    if (this._rippleTimer <= 0) {
      this._rippleTimer = Utils.rand(0.4, 0.9);
      this.ripples.push({
        x: x + Utils.rand(-radius, radius),
        y: y + Utils.rand(-radius, radius),
        r: Utils.rand(4, 10), life: 1,
      });
    }
  }

  /** Explode the boat into low-poly shards + a splash. */
  crash(x, y, heading, speed) {
    for (let i = 0; i < 14; i++) {
      const ang = Utils.rand(0, Utils.TWO_PI);
      const spd = Utils.rand(60, 260);
      this.fragments.push({
        x, y,
        vx: Math.cos(ang) * spd + Math.cos(heading) * speed * 0.3,
        vy: Math.sin(ang) * spd + Math.sin(heading) * speed * 0.3,
        rot: Utils.rand(0, Utils.TWO_PI),
        vr: Utils.rand(-8, 8),
        size: Utils.rand(4, 11),
        life: Utils.rand(0.6, 1.1),
        color: Utils.pick(['#ffd23f', '#ff8a3d', '#f4f7fb', '#e04f3d']),
      });
    }
    for (let i = 0; i < 26; i++) {
      const ang = Utils.rand(0, Utils.TWO_PI);
      const spd = Utils.rand(40, 240);
      this.splash.push({
        x, y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: Utils.rand(0.4, 0.9), max: 0.9,
        r: Utils.rand(2, 5),
      });
    }
  }

  update(dt) {
    // Wake fades over ~1.4s.
    for (const w of this.wake) w.life -= dt * 0.7;
    if (this.wake.length && this.wake[0].life <= 0) this.wake.shift();

    for (let i = this.spray.length - 1; i >= 0; i--) {
      const p = this.spray[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.92; p.vy *= 0.92;
      p.life -= dt;
      if (p.life <= 0) this.spray.splice(i, 1);
    }

    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.r += 30 * dt; r.life -= dt * 1.2;
      if (r.life <= 0) this.ripples.splice(i, 1);
    }

    for (let i = this.fragments.length - 1; i >= 0; i--) {
      const f = this.fragments[i];
      f.x += f.vx * dt; f.y += f.vy * dt;
      f.vx *= 0.94; f.vy *= 0.94;
      f.rot += f.vr * dt; f.life -= dt;
      if (f.life <= 0) this.fragments.splice(i, 1);
    }

    for (let i = this.splash.length - 1; i >= 0; i--) {
      const p = this.splash[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.9; p.vy *= 0.9; p.life -= dt;
      if (p.life <= 0) this.splash.splice(i, 1);
    }
  }

  /** Draw water-surface effects that sit *under* the boat. */
  drawUnder(ctx) {
    // Ambient ripples.
    ctx.lineWidth = 1.5;
    for (const r of this.ripples) {
      ctx.strokeStyle = `rgba(255,255,255,${0.28 * r.life})`;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Utils.TWO_PI);
      ctx.stroke();
    }

    // Wake ribbon — draw as a widening translucent band.
    if (this.wake.length > 1) {
      ctx.lineCap = 'round';
      for (let i = 1; i < this.wake.length; i++) {
        const a = this.wake[i - 1], b = this.wake[i];
        const life = Math.max(0, b.life);
        ctx.strokeStyle = `rgba(255,255,255,${0.5 * life})`;
        ctx.lineWidth = b.w * life;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }

  /** Draw effects that sit *over* the boat (spray, debris, splash). */
  drawOver(ctx) {
    for (const p of this.spray) {
      ctx.fillStyle = `rgba(255,255,255,${0.85 * (p.life / p.max)})`;
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
      // Simple low-poly triangle shard.
      ctx.beginPath();
      ctx.moveTo(0, -f.size);
      ctx.lineTo(f.size, f.size);
      ctx.lineTo(-f.size, f.size);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}
