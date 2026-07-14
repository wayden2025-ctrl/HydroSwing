/* ============================================================
 * environment.js — EnvironmentManager
 *
 * A living tropical-ocean backdrop, rendered in SCREEN space so it
 * frames the play area and stays cheap. Everything responds to a single
 * `flow` value (0 = idle menu, 1 = full-speed gameplay): currents,
 * drift, reflections and marine-life speed all scale with it, and a
 * launch scatters the fish away from the boat.
 *
 * Layering (called by the game):
 *   drawWater(ctx)  — depth gradient, sandy shallows, wave shadows, caustics
 *   drawUnder(ctx)  — seabed props + marine life (behind the boat/river)
 *   drawOver(ctx)   — surface floaters: foam, lily pads, leaves, bubbles,
 *                     pollen, mist, edge splashes (in front)
 *
 * Props are stored in FRACTIONAL screen coords and resolved at draw
 * time, so they reflow on resize automatically. They cluster near the
 * edges to keep the center clean for gameplay.
 * ========================================================== */

class EnvironmentManager {
  constructor() { this.reset(); }

  reset() {
    this.time = 0;
    this.flow = 0;
    this._t = { creature: 1.5, drop: 1.2, leaf: 0.8, splash: 0.6 };
    this.creatures = [];
    this.leaves = [];
    this.foam = [];
    this.motes = [];
    this.drops = [];       // falling droplet + resulting ripple
    this.bubbles = [];
    this._initProps();
    // Seed some ambient so the scene starts alive.
    for (let i = 0; i < 22; i++) this.motes.push(this._newMote());
    for (let i = 0; i < 7; i++) this.foam.push(this._newFoam());
    for (let i = 0; i < 16; i++) this.bubbles.push(this._newBubble(Math.random()));
  }

  // ---------- static props (fractional coords, edge-biased) ----------
  _initProps() {
    const R = Utils.rand, RI = Utils.randInt;
    // Edge anchor helper: x in a side band, y anywhere-ish.
    const edgeX = () => (Math.random() < 0.5 ? R(0.02, 0.2) : R(0.8, 0.98));
    const cornerY = () => (Math.random() < 0.5 ? R(0.04, 0.24) : R(0.72, 0.96));

    this.sand = [];
    for (let i = 0; i < 7; i++) this.sand.push({ fx: edgeX(), fy: R(0.05, 0.95), r: R(90, 190), rot: R(0, 6.28) });

    this.rocks = [];
    for (let i = 0; i < 7; i++) this.rocks.push({ fx: edgeX(), fy: cornerY(), r: R(14, 34), tone: R(0, 1) });

    this.seaweed = [];
    for (let i = 0; i < 9; i++) {
      this.seaweed.push({ fx: edgeX(), fy: R(0.1, 0.94), strands: RI(3, 5), h: R(38, 78), phase: R(0, 6.28), hue: 130 + R(-14, 24) });
    }

    this.corals = [];
    for (let i = 0; i < 6; i++) this.corals.push({ fx: edgeX(), fy: cornerY(), r: R(12, 22), hue: Utils.pick([12, 335, 275, 30]) });

    this.driftwood = [];
    for (let i = 0; i < 2; i++) this.driftwood.push({ fx: edgeX(), fy: R(0.1, 0.9), len: R(46, 78), rot: R(-0.8, 0.8) });

    this.shells = [];
    for (let i = 0; i < 8; i++) this.shells.push({ fx: edgeX(), fy: R(0.06, 0.94), r: R(4, 7), rot: R(0, 6.28), hue: Utils.pick([28, 340, 200]) });

    this.starfish = [];
    for (let i = 0; i < 4; i++) this.starfish.push({ fx: edgeX(), fy: R(0.06, 0.94), r: R(9, 15), rot: R(0, 6.28), hue: Utils.pick([20, 340]) });

    this.lily = [];  // floating lily-pad clusters in a couple of corners
    for (let i = 0; i < 4; i++) {
      const cx = Math.random() < 0.5 ? R(0.05, 0.16) : R(0.84, 0.95);
      const cy = Math.random() < 0.5 ? R(0.06, 0.18) : R(0.82, 0.94);
      const pads = [];
      for (let j = 0; j < RI(3, 5); j++) pads.push({ dx: R(-30, 30), dy: R(-26, 26), r: R(10, 18) });
      this.lily.push({ fx: cx, fy: cy, pads, phase: R(0, 6.28) });
    }
  }

  // ---------- factories ----------
  _newMote() {
    const w = window.innerWidth, h = window.innerHeight;
    return { x: Math.random() * w, y: Math.random() * h, r: Utils.rand(0.6, 2), phase: Utils.rand(0, 6.28), sp: Utils.rand(0.5, 1.6), vx: Utils.rand(-6, 6), vy: Utils.rand(-8, -2) };
  }
  _newFoam() {
    const w = window.innerWidth, h = window.innerHeight;
    // Bias foam toward the edges.
    const fx = Math.random() < 0.5 ? Utils.rand(0, 0.28) : Utils.rand(0.72, 1);
    return { x: fx * w, y: Math.random() * h, r: Utils.rand(14, 34), a: Utils.rand(0.05, 0.13), drift: Utils.rand(0.3, 0.8) };
  }
  _newBubble(seed) {
    const w = window.innerWidth, h = window.innerHeight;
    return { x: Math.random() * w, y: h * (0.2 + 0.8 * seed) + Utils.rand(0, 40), r: Utils.rand(1.4, 4.5), vy: Utils.rand(12, 40), sway: Utils.rand(0, 6.28) };
  }
  _newLeaf() {
    const h = window.innerHeight;
    const fromLeft = Math.random() < 0.5;
    return {
      x: fromLeft ? -20 : window.innerWidth + 20,
      y: Utils.rand(0.06, 0.94) * h,
      vx: (fromLeft ? 1 : -1) * Utils.rand(8, 20),
      rot: Utils.rand(0, 6.28), vr: Utils.rand(-1, 1),
      r: Utils.rand(6, 11), hue: 95 + Utils.rand(-18, 30),
    };
  }

  /** Weighted pick — whale is the rarest, dolphins very rare, fish common. */
  _pickKind() {
    const table = [['fish', 34], ['ray', 14], ['jelly', 14], ['crab', 11], ['shrimp', 10], ['shark', 8], ['dolphin', 3], ['whale', 1.4]];
    let total = 0; for (const [, w] of table) total += w;
    let r = Math.random() * total;
    for (const [k, w] of table) { if ((r -= w) <= 0) return k; }
    return 'fish';
  }

  /** Spawn a marine creature crossing the screen. */
  _spawnCreature() {
    const w = window.innerWidth, h = window.innerHeight, R = Utils.rand;
    const kind = this._pickKind();
    const fromLeft = Math.random() < 0.5, dir = fromLeft ? 1 : -1;
    const x = fromLeft ? -90 : w + 90;
    const base = { kind, x, dir, phase: R(0, 6.28), life: 60 };

    switch (kind) {
      case 'whale':   return { ...base, y: R(0.28, 0.72) * h, sp: R(9, 16), blow: R(2.5, 5), roll: 0, scale: R(1, 1.25) };
      case 'shark':   return { ...base, y: R(0.15, 0.85) * h, sp: R(58, 86), dip: R(2.5, 5) };
      case 'dolphin': return { ...base, y: R(0.32, 0.62) * h, sp: R(92, 120), leapT: R(0.6, 1.6), z: 0, leaping: false };
      case 'turtle':  return { ...base, y: R(0.12, 0.9) * h, sp: R(20, 32) };
      case 'ray':     return { ...base, y: R(0.14, 0.9) * h, sp: R(28, 44) };
      case 'fish':    return { ...base, y: R(0.12, 0.9) * h, sp: R(42, 70), school: this._makeSchool() };
      case 'jelly':   return { kind, x: R(0.12, 0.88) * w, y: h + 30, dir: -1, sp: R(8, 15), phase: R(0, 6.28), life: 18, members: this._makeJellies() };
      case 'crab':    return { kind, x: R(0, 1) * w, y: R(0.82, 0.95) * h, dir, sp: R(10, 22), phase: 0, life: R(6, 10) };
      case 'shrimp':  return { kind, x: R(0, 1) * w, y: R(0.8, 0.95) * h, dir, sp: R(26, 46), phase: 0, dart: 0, life: R(4, 7) };
    }
  }
  _makeJellies() {
    const n = Utils.randInt(2, 4), out = [];
    for (let i = 0; i < n; i++) out.push({ dx: Utils.rand(-40, 40), dy: Utils.rand(-30, 30), phase: Utils.rand(0, 6.28), r: Utils.rand(8, 13) });
    return out;
  }
  _makeSchool() {
    const n = Utils.randInt(6, 11), fish = [];
    for (let i = 0; i < n; i++) fish.push({ dx: Utils.rand(-26, 26), dy: Utils.rand(-16, 16), scatter: 0, sx: 0, sy: 0, hue: Utils.pick([48, 30, 190, 12]) });
    return fish;
  }

  /** Boat launched: fish near it dart away, and currents pick up soon after. */
  scatter(sx, sy) {
    for (const c of this.creatures) {
      if (c.kind !== 'fish' || !c.school) continue;
      for (const f of c.school) {
        const fx = c.x + f.dx, fy = c.y + f.dy;
        const d = Math.hypot(fx - sx, fy - sy);
        if (d < 260) {
          const a = Math.atan2(fy - sy, fx - sx);
          f.scatter = 1; f.sx = Math.cos(a) * Utils.rand(80, 160); f.sy = Math.sin(a) * Utils.rand(80, 160);
        }
      }
    }
    this._t.creature = Math.min(this._t.creature, 0.4);
  }

  // ---------- update ----------
  update(dt, flow, boat) {
    this.flow = flow;
    const cur = 1 + flow * 2.2;          // current speed multiplier
    this.time += dt;

    // Ambient spawns.
    this._t.creature -= dt;
    if (this._t.creature <= 0 && this.creatures.length < 4) {
      this._t.creature = Utils.rand(2.4, 5.5) / (1 + flow);
      this.creatures.push(this._spawnCreature());
    }
    this._t.leaf -= dt;
    if (this._t.leaf <= 0 && this.leaves.length < 12) { this._t.leaf = Utils.rand(1.2, 3) / (0.5 + flow); this.leaves.push(this._newLeaf()); }
    this._t.drop -= dt;
    if (this._t.drop <= 0) { this._t.drop = Utils.rand(1.6, 3.4); this._spawnDrop(); }
    this._t.splash -= dt;
    if (this._t.splash <= 0) { this._t.splash = Utils.rand(0.9, 2.2); this._edgeSplash(); }

    const w = window.innerWidth, h = window.innerHeight;

    // Creatures.
    for (let i = this.creatures.length - 1; i >= 0; i--) {
      const c = this.creatures[i];
      c.life -= dt;
      const off = () => this.creatures.splice(i, 1);
      switch (c.kind) {
        case 'crab':
          c.phase += dt * 8; c.x += c.dir * c.sp * dt * (1 + flow);
          if (c.life <= 0) off();
          break;
        case 'shrimp':
          // Little jittery hops; occasionally darts.
          c.dart = Math.max(0, c.dart - dt);
          c.x += c.dir * (c.sp + c.dart * 90) * dt; c.phase += dt * 16;
          if (Math.random() < 0.01) c.dart = 0.4;
          if (c.life <= 0) off();
          break;
        case 'jelly':
          c.phase += dt * 1.4; c.y -= c.sp * dt * (0.6 + flow * 0.6); c.x += Math.sin(c.phase) * 6 * dt;
          if (c.y < -60 || c.life <= 0) off();
          break;
        case 'whale': {
          c.x += c.dir * c.sp * (1 + flow * 0.8) * dt;
          c.phase += dt * 0.9; c.roll = Math.sin(c.phase * 0.5) * 0.12;
          c.blow -= dt;
          if (c.blow <= 0) { c.blow = Utils.rand(5, 9); this._spout(c.x + c.dir * 34 * c.scale, c.y - 4); }
          if (Math.random() < 0.4 * dt) this.drops.push({ x: c.x + Utils.rand(-40, 40) * c.scale, y: c.y + Utils.rand(-14, 14), state: 'ripple', r: 6, life: 0.9 }); // broad wake
          if (c.x < -260 || c.x > w + 260) off();
          break;
        }
        case 'shark': {
          const speed = c.sp * (1 + flow * 1.4);
          c.x += c.dir * speed * dt; c.phase += dt * 4;
          c.y += Math.sin(c.phase * 0.4) * 10 * dt;              // slow sweeping arc
          if (c.x < -160 || c.x > w + 160) off();
          break;
        }
        case 'dolphin': {
          const speed = c.sp * (1 + flow * 1.4);
          c.x += c.dir * speed * dt;
          if (c.leaping) {
            c.z += dt; const T = 0.85;
            if (c.z >= T) { c.leaping = false; c.z = 0; this._splash(c.x, c.y); }   // landing splash
          } else {
            c.leapT -= dt;
            if (c.leapT <= 0) { c.leapT = Utils.rand(1.2, 2.6); c.leaping = true; c.z = 0; this._splash(c.x, c.y); } // takeoff splash
          }
          if (c.x < -140 || c.x > w + 140) off();
          break;
        }
        default: { // turtle, ray, fish
          const speed = c.sp * (1 + flow * 1.6);
          c.x += c.dir * speed * dt; c.phase += dt * 6;
          if (c.school) for (const f of c.school) {
            if (f.scatter > 0) { f.dx += f.sx * dt; f.dy += f.sy * dt; f.scatter -= dt * 0.6; f.sx *= 0.94; f.sy *= 0.94; }
          }
          if (c.x < -140 || c.x > w + 140) off();
        }
      }
    }

    // Leaves drift + spin with the current.
    for (let i = this.leaves.length - 1; i >= 0; i--) {
      const l = this.leaves[i];
      l.x += l.vx * cur * dt; l.y += Math.sin(this.time + l.rot) * 4 * dt; l.rot += l.vr * dt;
      if (l.x < -40 || l.x > w + 40) this.leaves.splice(i, 1);
    }

    // Foam patches drift slowly sideways with the current, wrap around.
    for (const p of this.foam) {
      p.x += p.drift * cur * 6 * dt;
      if (p.x > w + 40) p.x = -40;
    }

    // Bubbles rise.
    for (const b of this.bubbles) {
      b.y -= b.vy * (1 + flow) * dt; b.sway += dt * 1.6;
      if (b.y < -12) { b.y = h + Utils.rand(0, 30); b.x = Math.random() * w; }
    }

    // Pollen / dust motes drift, twinkle.
    for (const m of this.motes) {
      m.x += (m.vx - flow * 30) * dt; m.y += m.vy * dt; m.phase += m.sp * dt;
      if (m.y < -6 || m.x < -6 || m.x > w + 6) Object.assign(m, this._newMote(), { y: h + 4 });
    }

    // Falling droplets + their ripples.
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      if (d.state === 'fall') {
        d.t += dt;
        if (d.t >= 0 && d.sy !== undefined) { d.x += (d.vx || 0) * dt; d.y += d.sy * dt; d.sy += 150 * dt; } // arc up then down
        if (d.t >= d.dur) { d.state = 'ripple'; d.r = 2; d.life = 1; }
      } else { d.r += 40 * dt; d.life -= dt * 1.1; if (d.life <= 0) this.drops.splice(i, 1); }
    }
  }

  _spawnDrop() {
    const w = window.innerWidth, h = window.innerHeight;
    // Bias toward edges/corners.
    const x = Math.random() < 0.5 ? Utils.rand(0, 0.3) * w : Utils.rand(0.7, 1) * w;
    this.drops.push({ x, y: Utils.rand(0.1, 0.9) * h, state: 'fall', t: 0, dur: Utils.rand(0.1, 0.25) });
  }
  _edgeSplash() {
    const w = window.innerWidth, h = window.innerHeight;
    const x = Math.random() < 0.5 ? Utils.rand(0, 0.12) * w : Utils.rand(0.88, 1) * w;
    this.drops.push({ x, y: Utils.rand(0.08, 0.92) * h, state: 'ripple', r: 2, life: 0.7 });
  }
  /** Whale blowhole spout: a little burst of droplets rising, then ripples. */
  _spout(x, y) {
    for (let i = 0; i < 8; i++) this.drops.push({ x, y, state: 'fall', t: -Utils.rand(0, 0.3), dur: 0.35, vx: Utils.rand(-12, 12), sy: -Utils.rand(20, 46), vy2: 0 });
    this.drops.push({ x, y, state: 'ripple', r: 4, life: 1 });
  }
  /** Splash ring (dolphin leap take-off / landing). */
  _splash(x, y) {
    this.drops.push({ x, y, state: 'ripple', r: 3, life: 0.9 });
    for (let i = 0; i < 6; i++) this.drops.push({ x, y, state: 'fall', t: -Utils.rand(0, 0.15), dur: 0.3, vx: Utils.rand(-40, 40), sy: -Utils.rand(20, 50) });
  }

  // ================= drawing =================

  /** Depth-shaded tropical water + sandy shallows + wave shadows + caustics. */
  drawWater(ctx, w, h) {
    const t = this.time;
    // Base vertical gradient: deep navy top -> teal.
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#051a30');
    g.addColorStop(0.55, '#0a4a63');
    g.addColorStop(1, '#12798f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    // Depth: darker (deeper) center, lighter turquoise shallows at edges.
    const rg = ctx.createRadialGradient(w / 2, h * 0.5, Math.min(w, h) * 0.18, w / 2, h * 0.5, Math.max(w, h) * 0.72);
    rg.addColorStop(0, 'rgba(3, 16, 30, 0.55)');       // deep, dark center
    rg.addColorStop(0.6, 'rgba(3, 16, 30, 0)');
    rg.addColorStop(1, 'rgba(60, 208, 208, 0.20)');    // turquoise shallows
    ctx.fillStyle = rg; ctx.fillRect(0, 0, w, h);

    // Faint sandy seabed patches in the shallows (edges).
    ctx.save();
    for (const s of this.sand) {
      const x = s.fx * w, y = s.fy * h;
      const edge = Math.min(s.fx, 1 - s.fx);            // 0 at edge, 0.5 center
      const a = Utils.clamp(0.16 * (1 - edge / 0.42), 0, 0.16);
      if (a < 0.01) continue;
      const sg = ctx.createRadialGradient(x, y, 0, x, y, s.r);
      sg.addColorStop(0, `rgba(196, 178, 120, ${a})`);
      sg.addColorStop(1, 'rgba(196, 178, 120, 0)');
      ctx.fillStyle = sg; ctx.fillRect(x - s.r, y - s.r, s.r * 2, s.r * 2);
    }
    ctx.restore();

    // Moving wave shadows above the seabed (slow dark bands).
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    for (let i = 0; i < 5; i++) {
      const y = ((i / 5 + (t * 0.02)) % 1) * (h + 200) - 100;
      const a = 0.05 + 0.03 * Math.sin(t * 0.4 + i);
      ctx.fillStyle = `rgba(2, 18, 32, ${Math.max(0, a)})`;
      ctx.beginPath();
      ctx.ellipse(w / 2 + Math.sin(t * 0.15 + i) * 60, y, w * 0.75, 42, 0, 0, Utils.TWO_PI);
      ctx.fill();
    }
    ctx.restore();

    // Caustic light network + sunlight reflection streaks (stream faster with flow).
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 7; i++) {
      const cx = w * ((0.12 + 0.76 * ((i * 0.31 + t * (0.03 + this.flow * 0.14)) % 1)));
      const cy = h * (0.15 + 0.7 * (0.5 + 0.5 * Math.sin(t * 0.24 + i * 1.6)));
      const rad = 110 + 60 * Math.sin(t * 0.4 + i);
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      cg.addColorStop(0, `rgba(120, 230, 255, ${0.09 + this.flow * 0.05})`);
      cg.addColorStop(1, 'rgba(120, 230, 255, 0)');
      ctx.fillStyle = cg; ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    }
    // Diagonal sun rays; they streak longer/brighter as flow rises.
    for (let i = 0; i < 4; i++) {
      const x = w * (0.08 + 0.27 * i) + Math.sin(t * 0.3 + i) * 40 - this.flow * t * 60 % w;
      const a = 0.045 + 0.03 * Math.sin(t * 0.7 + i) + this.flow * 0.04;
      ctx.fillStyle = `rgba(180, 245, 255, ${Math.max(0, a)})`;
      ctx.beginPath();
      ctx.moveTo(x, -20); ctx.lineTo(x + 54, -20);
      ctx.lineTo(x + 54 + h * 0.32, h + 20); ctx.lineTo(x + h * 0.32, h + 20);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  /**
   * Seabed props + marine life (behind the boat). The static shoreline
   * props only render when `showProps` is true (landing screen); marine
   * life always swims, including during gameplay.
   */
  drawUnder(ctx, w, h, showProps) {
    const t = this.time, sway = (this.flow * 1.6 + 0.5);

    if (showProps) {
    // Sandy driftwood.
    for (const d of this.driftwood) {
      ctx.save(); ctx.translate(d.fx * w, d.fy * h); ctx.rotate(d.rot);
      ctx.fillStyle = 'rgba(120, 92, 60, 0.6)';
      this._roundRect(ctx, -d.len / 2, -5, d.len, 10, 5); ctx.fill();
      ctx.strokeStyle = 'rgba(80, 60, 40, 0.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-d.len / 2 + 6, 0); ctx.lineTo(d.len / 2 - 6, 0); ctx.stroke();
      ctx.restore();
    }

    // Rocks (partially submerged: darker base, lighter wet top).
    for (const r of this.rocks) {
      const x = r.fx * w, y = r.fy * h;
      ctx.fillStyle = `rgba(${44 + r.tone * 20}, ${58 + r.tone * 18}, ${66 + r.tone * 14}, 0.85)`;
      ctx.beginPath(); ctx.ellipse(x, y, r.r, r.r * 0.8, 0, 0, Utils.TWO_PI); ctx.fill();
      ctx.fillStyle = 'rgba(150, 178, 190, 0.35)';
      ctx.beginPath(); ctx.ellipse(x - r.r * 0.2, y - r.r * 0.3, r.r * 0.55, r.r * 0.4, 0, 0, Utils.TWO_PI); ctx.fill();
    }

    // Coral clusters.
    for (const c of this.corals) {
      const x = c.fx * w, y = c.fy * h;
      ctx.strokeStyle = `hsla(${c.hue}, 75%, 62%, 0.8)`; ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (let a = -1; a <= 1; a++) {
        ctx.beginPath(); ctx.moveTo(x + a * 5, y + c.r);
        ctx.quadraticCurveTo(x + a * 10, y, x + a * 12, y - c.r); ctx.stroke();
      }
      ctx.fillStyle = `hsla(${c.hue}, 75%, 66%, 0.5)`;
      ctx.beginPath(); ctx.arc(x, y + c.r * 0.7, c.r * 0.5, 0, Utils.TWO_PI); ctx.fill();
    }

    // Seaweed swaying.
    for (const s of this.seaweed) {
      const x = s.fx * w, y = s.fy * h;
      ctx.strokeStyle = `hsla(${s.hue}, 62%, 45%, 0.72)`; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
      for (let k = 0; k < s.strands; k++) {
        const off = (k - s.strands / 2) * 5;
        const bend = Math.sin(t * 1.1 + s.phase + k) * (7 + sway * 8);
        ctx.beginPath(); ctx.moveTo(x + off, y);
        ctx.quadraticCurveTo(x + off + bend * 0.5, y - s.h * 0.5, x + off + bend, y - s.h);
        ctx.stroke();
      }
    }

    // Shells + starfish resting on the seabed.
    for (const s of this.shells) {
      const x = s.fx * w, y = s.fy * h;
      ctx.save(); ctx.translate(x, y); ctx.rotate(s.rot);
      ctx.fillStyle = `hsla(${s.hue}, 55%, 82%, 0.8)`;
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.arc(0, 0, s.r, Math.PI, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(120,90,80,0.35)'; ctx.lineWidth = 0.6;
      for (let a = -2; a <= 2; a++) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a * 0.4 - Math.PI / 2) * s.r, Math.sin(a * 0.4 - Math.PI / 2) * s.r + 0); ctx.stroke(); }
      ctx.restore();
    }
    for (const s of this.starfish) {
      const x = s.fx * w, y = s.fy * h;
      ctx.save(); ctx.translate(x, y); ctx.rotate(s.rot + Math.sin(t * 0.5) * 0.05);
      ctx.fillStyle = `hsla(${s.hue}, 80%, 62%, 0.85)`;
      ctx.beginPath();
      for (let a = 0; a < 5; a++) {
        const ao = (a / 5) * Utils.TWO_PI - Math.PI / 2, ai = ao + Math.PI / 5;
        ctx.lineTo(Math.cos(ao) * s.r, Math.sin(ao) * s.r);
        ctx.lineTo(Math.cos(ai) * s.r * 0.45, Math.sin(ai) * s.r * 0.45);
      }
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    } // end showProps

    // Marine life (semi-transparent = submerged) — always, even in gameplay.
    for (const c of this.creatures) this._drawCreature(ctx, c, t);
  }

  _drawCreature(ctx, c, t) {
    ctx.save();
    switch (c.kind) {
      case 'fish': {
        for (const f of c.school) {
          const x = c.x + f.dx, y = c.y + f.dy + Math.sin(t * 6 + f.dx) * 1.5;
          ctx.fillStyle = `hsla(${f.hue}, 88%, 60%, 0.78)`;
          ctx.save(); ctx.translate(x, y); ctx.scale(c.dir, 1);
          ctx.beginPath(); ctx.ellipse(0, 0, 5, 2.6, 0, 0, Utils.TWO_PI); ctx.fill();
          ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(-8, -3); ctx.lineTo(-8, 3); ctx.closePath(); ctx.fill();
          ctx.restore();
        }
        break;
      }
      case 'whale': {
        // Massive, mostly-visible body: dark back over turquoise, tail strokes.
        const s = c.scale, x = c.x, y = c.y;
        ctx.save(); ctx.translate(x, y); ctx.scale(c.dir * s, s); ctx.rotate(c.roll * 0.3);
        const tail = Math.sin(c.phase) * 0.4;
        // soft body shadow
        ctx.fillStyle = 'rgba(2, 20, 40, 0.18)';
        ctx.beginPath(); ctx.ellipse(0, 6, 70, 24, 0, 0, Utils.TWO_PI); ctx.fill();
        // fluke
        ctx.fillStyle = 'rgba(24, 58, 96, 0.7)';
        ctx.save(); ctx.translate(-58, 0); ctx.rotate(tail);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-14, -16, -26, -14); ctx.quadraticCurveTo(-16, 0, -26, 14); ctx.quadraticCurveTo(-14, 16, 0, 0); ctx.fill();
        ctx.restore();
        // dark blue back
        ctx.fillStyle = 'rgba(26, 62, 104, 0.82)';
        ctx.beginPath(); ctx.ellipse(0, 0, 60, 20, 0, 0, Utils.TWO_PI); ctx.fill();
        // lighter underside hint on roll
        ctx.fillStyle = `rgba(150, 200, 220, ${0.15 + Math.abs(c.roll) * 1.2})`;
        ctx.beginPath(); ctx.ellipse(6, 6, 48, 12, 0, 0, Utils.TWO_PI); ctx.fill();
        // head + blowhole
        ctx.fillStyle = 'rgba(20, 50, 88, 0.85)';
        ctx.beginPath(); ctx.arc(52, 0, 15, 0, Utils.TWO_PI); ctx.fill();
        ctx.restore();
        break;
      }
      case 'shark': {
        const x = c.x, y = c.y, wag = Math.sin(c.phase) * 6;
        // Faint streamlined body under the surface.
        ctx.save(); ctx.translate(x, y); ctx.scale(c.dir, 1);
        ctx.globalAlpha = 0.3; ctx.fillStyle = '#5b6b78';
        ctx.beginPath();
        ctx.moveTo(30, 0); ctx.quadraticCurveTo(6, -9, -20, -2);
        ctx.lineTo(-34, -7 + wag * 0.3); ctx.lineTo(-28, 0); ctx.lineTo(-34, 7 + wag * 0.3);
        ctx.lineTo(-20, 2); ctx.quadraticCurveTo(6, 9, 30, 0); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 0.85; ctx.fillStyle = '#8794a0';                  // dorsal fin breaks surface
        ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(-8, -16); ctx.lineTo(6, -2); ctx.closePath(); ctx.fill();
        // clean V-wake behind the fin
        ctx.globalAlpha = 0.5; ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(-2, -6); ctx.lineTo(-26, -18); ctx.moveTo(-2, -6); ctx.lineTo(-26, 6); ctx.stroke();
        ctx.restore();
        break;
      }
      case 'dolphin': {
        const T = 0.85, x = c.x;
        // Leap arc height (0 at water, peak mid-leap).
        const lift = c.leaping ? Math.sin((c.z / T) * Math.PI) : 0;
        const y = c.y - lift * 46;
        ctx.save(); ctx.translate(x, y); ctx.scale(c.dir, 1); ctx.rotate((c.leaping ? (c.z / T - 0.5) * 1.1 : 0));
        if (lift > 0.05) {
          // Above water: bright grey body.
          ctx.fillStyle = '#3d5566';
          ctx.beginPath(); ctx.ellipse(0, 0, 20, 6.5, 0, 0, Utils.TWO_PI); ctx.fill();
          ctx.fillStyle = '#d9e6ee';
          ctx.beginPath(); ctx.ellipse(2, 3, 14, 3.5, 0, 0, Utils.TWO_PI); ctx.fill();     // belly
          ctx.fillStyle = '#3d5566';
          ctx.beginPath(); ctx.moveTo(-2, -3); ctx.lineTo(-8, -14); ctx.lineTo(3, -3); ctx.closePath(); ctx.fill();
          ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(24, -4); ctx.lineTo(20, 2); ctx.closePath(); ctx.fill(); // snout
        } else {
          // Beneath the surface: soft shadow.
          ctx.globalAlpha = 0.3; ctx.fillStyle = '#0a2033';
          ctx.beginPath(); ctx.ellipse(0, 0, 22, 7, 0, 0, Utils.TWO_PI); ctx.fill();
        }
        ctx.restore();
        break;
      }
      case 'turtle': {
        const x = c.x, y = c.y + Math.sin(t * 1.5) * 3;
        ctx.save(); ctx.translate(x, y); ctx.scale(c.dir, 1);
        ctx.globalAlpha = 0.82;
        const paddle = Math.sin(t * 2.4);
        ctx.fillStyle = '#c9b083';                                   // tan flippers, alternating
        ctx.beginPath(); ctx.ellipse(3, -13, 9, 4.5, -0.6 + paddle * 0.3, 0, Utils.TWO_PI); ctx.fill();
        ctx.beginPath(); ctx.ellipse(3, 13, 9, 4.5, 0.6 - paddle * 0.3, 0, Utils.TWO_PI); ctx.fill();
        ctx.beginPath(); ctx.ellipse(-9, -9, 6, 3, 0.8, 0, Utils.TWO_PI); ctx.fill();
        ctx.beginPath(); ctx.ellipse(-9, 9, 6, 3, -0.8, 0, Utils.TWO_PI); ctx.fill();
        ctx.fillStyle = '#c9b083';                                   // head
        ctx.beginPath(); ctx.arc(15, 0, 4.5, 0, Utils.TWO_PI); ctx.fill();
        ctx.fillStyle = '#1a2e2a';
        ctx.beginPath(); ctx.arc(17, -1.6, 0.9, 0, Utils.TWO_PI); ctx.arc(17, 1.6, 0.9, 0, Utils.TWO_PI); ctx.fill(); // eyes
        ctx.fillStyle = '#2f8f5e';                                   // green shell
        ctx.beginPath(); ctx.ellipse(0, 0, 15, 12.5, 0, 0, Utils.TWO_PI); ctx.fill();
        ctx.strokeStyle = 'rgba(20, 90, 60, 0.7)'; ctx.lineWidth = 1;  // hexagon pattern
        for (let a = 0; a < 6; a++) {
          const ang = a / 6 * Utils.TWO_PI;
          ctx.beginPath(); ctx.arc(Math.cos(ang) * 6.5, Math.sin(ang) * 5.5, 3, 0, Utils.TWO_PI); ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(0, 0, 3.2, 0, Utils.TWO_PI); ctx.stroke();
        ctx.restore();
        break;
      }
      case 'ray': {
        const x = c.x, y = c.y, flap = Math.sin(t * 3) * 6;
        ctx.save(); ctx.translate(x, y); ctx.scale(c.dir, 1);
        ctx.globalAlpha = 0.62; ctx.fillStyle = '#2a5570';
        ctx.beginPath();
        ctx.moveTo(12, 0); ctx.quadraticCurveTo(-4, -20 - flap, -18, 0);
        ctx.quadraticCurveTo(-4, 20 + flap, 12, 0); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(210,230,240,0.25)';
        ctx.beginPath(); ctx.ellipse(2, 0, 6, 4, 0, 0, Utils.TWO_PI); ctx.fill();
        ctx.strokeStyle = 'rgba(30,60,80,0.55)'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-16, 0); ctx.quadraticCurveTo(-30, Math.sin(t * 2) * 6, -40, Math.sin(t * 2 + 1) * 8); ctx.stroke();
        ctx.restore();
        break;
      }
      case 'jelly': {
        // A small drifting group.
        for (const m of c.members) {
          const x = c.x + m.dx, y = c.y + m.dy, pulse = 1 + Math.sin(c.phase + m.phase) * 0.14;
          ctx.globalAlpha = 0.55;
          const bg = ctx.createRadialGradient(x, y - 2, 1, x, y, m.r * 1.3);
          bg.addColorStop(0, 'rgba(150, 160, 240, 0.6)');
          bg.addColorStop(1, 'rgba(120, 90, 210, 0.3)');
          ctx.fillStyle = bg;
          ctx.beginPath(); ctx.ellipse(x, y, m.r * pulse, m.r * 0.85 * pulse, 0, Math.PI, 0); ctx.fill();
          ctx.strokeStyle = 'rgba(140, 240, 255, 0.5)'; ctx.lineWidth = 1.4;  // cyan rim
          ctx.beginPath(); ctx.ellipse(x, y, m.r * pulse, m.r * 0.85 * pulse, 0, Math.PI, 0); ctx.stroke();
          ctx.strokeStyle = 'rgba(190, 170, 240, 0.4)'; ctx.lineWidth = 1.1; ctx.lineCap = 'round';
          for (let k = -2; k <= 2; k++) {
            ctx.beginPath(); ctx.moveTo(x + k * m.r * 0.3, y);
            ctx.quadraticCurveTo(x + k * m.r * 0.3 + Math.sin(c.phase + k + m.phase) * 4, y + m.r + 6, x + k * m.r * 0.3, y + m.r + 14); ctx.stroke();
          }
        }
        break;
      }
      case 'crab': {
        const x = c.x, y = c.y, legs = Math.sin(c.phase) * 2;
        ctx.globalAlpha = 0.9; ctx.fillStyle = '#d65438'; ctx.strokeStyle = '#d65438'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
        for (let s = -1; s <= 1; s += 2) for (let k = 0; k < 3; k++) {
          ctx.beginPath(); ctx.moveTo(x + s * 4, y); ctx.lineTo(x + s * (9 + k * 3), y + (k - 1) * 3 + legs * s); ctx.stroke();
        }
        ctx.beginPath(); ctx.ellipse(x, y, 6, 4.5, 0, 0, Utils.TWO_PI); ctx.fill();
        ctx.beginPath(); ctx.arc(x + 6, y - 2, 2, 0, Utils.TWO_PI); ctx.arc(x - 6, y - 2, 2, 0, Utils.TWO_PI); ctx.fill();
        break;
      }
      case 'shrimp': {
        const x = c.x, y = c.y, curl = Math.sin(c.phase) * 0.3;
        ctx.globalAlpha = 0.8; ctx.save(); ctx.translate(x, y); ctx.scale(c.dir, 1); ctx.rotate(curl);
        ctx.strokeStyle = '#f2916b'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(5, 0); ctx.quadraticCurveTo(-2, 2, -7, -1); ctx.stroke(); // curled body
        ctx.strokeStyle = 'rgba(242,145,107,0.6)'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(11, -2); ctx.moveTo(6, 0); ctx.lineTo(11, 2); ctx.stroke(); // antennae
        ctx.restore();
        break;
      }
    }
    ctx.restore();
  }

  /** Surface floaters + ambient, in front of the boat but edge-biased.
   *  Lily pads are props (landing only); the rest of the ambient always
   *  plays so the ocean stays alive during gameplay. */
  drawOver(ctx, w, h, showProps) {
    const t = this.time;

    // Droplet ripples + falling drops.
    for (const d of this.drops) {
      if (d.state === 'fall') {
        if (d.t < 0) continue;   // delayed spurt droplet not visible yet
        ctx.fillStyle = 'rgba(210,240,255,0.8)';
        ctx.beginPath(); ctx.arc(d.x, d.y, 1.6, 0, Utils.TWO_PI); ctx.fill();
      } else {
        ctx.strokeStyle = `rgba(255,255,255,${0.4 * d.life})`; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Utils.TWO_PI); ctx.stroke();
      }
    }

    // Foam patches.
    for (const p of this.foam) {
      ctx.fillStyle = `rgba(235, 250, 255, ${p.a})`;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r, p.r * 0.6, 0, 0, Utils.TWO_PI); ctx.fill();
    }

    // Lily-pad clusters (corners) — landing only.
    if (showProps) for (const cl of this.lily) {
      const bx = cl.fx * w, by = cl.fy * h;
      for (const p of cl.pads) {
        const x = bx + p.dx + Math.sin(t * 0.6 + cl.phase) * 3, y = by + p.dy + Math.cos(t * 0.5 + cl.phase) * 3;
        ctx.fillStyle = 'rgba(46, 140, 74, 0.85)';
        ctx.beginPath(); ctx.arc(x, y, p.r, 0.5, Utils.TWO_PI + 0.2); ctx.lineTo(x, y); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(80, 180, 110, 0.5)';
        ctx.beginPath(); ctx.arc(x - p.r * 0.2, y - p.r * 0.2, p.r * 0.4, 0, Utils.TWO_PI); ctx.fill();
      }
    }

    // Leaves.
    for (const l of this.leaves) {
      ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.rot);
      ctx.fillStyle = `hsla(${l.hue}, 55%, 45%, 0.8)`;
      ctx.beginPath(); ctx.ellipse(0, 0, l.r, l.r * 0.45, 0, 0, Utils.TWO_PI); ctx.fill();
      ctx.strokeStyle = 'rgba(40,70,30,0.5)'; ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(-l.r, 0); ctx.lineTo(l.r, 0); ctx.stroke();
      ctx.restore();
    }

    // Rising bubbles.
    for (const b of this.bubbles) {
      const bx = b.x + Math.sin(b.sway) * 6;
      ctx.fillStyle = 'rgba(200, 240, 255, 0.26)';
      ctx.beginPath(); ctx.arc(bx, b.y, b.r, 0, Utils.TWO_PI); ctx.fill();
      ctx.strokeStyle = 'rgba(230, 250, 255, 0.32)'; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.arc(bx, b.y, b.r, 0, Utils.TWO_PI); ctx.stroke();
    }

    // Pollen / dust motes catching the light.
    for (const m of this.motes) {
      const a = 0.10 + 0.14 * (0.5 + 0.5 * Math.sin(m.phase));
      ctx.fillStyle = `rgba(255, 246, 214, ${a})`;
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Utils.TWO_PI); ctx.fill();
    }

    // Soft mist in the corners.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const corners = [[0, 0], [w, 0], [0, h], [w, h]];
    for (const [cx, cy] of corners) {
      const mg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * 0.34);
      const a = 0.05 + 0.02 * Math.sin(t * 0.5 + cx);
      mg.addColorStop(0, `rgba(180, 235, 245, ${a})`);
      mg.addColorStop(1, 'rgba(180, 235, 245, 0)');
      ctx.fillStyle = mg; ctx.fillRect(cx - 300, cy - 300, 600, 600);
    }
    ctx.restore();
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
