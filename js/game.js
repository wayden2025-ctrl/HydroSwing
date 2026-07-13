/* ============================================================
 * game.js — GameManager (entry point + main loop)
 *
 * The conductor. Owns the state machine (MENU / PLAYING / CRASHING /
 * OVER), the fixed-ish update loop, input, crash choreography,
 * scoring and a tiny synthesized-audio helper. Every other system is
 * created here and wired together.
 * ========================================================== */

/* --- Minimal WebAudio SFX (no asset files needed). --------- */
class Audio_ {
  constructor() { this.ctx = null; }
  _ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  blip(freq = 660, dur = 0.08, type = 'triangle', gain = 0.15) {
    const ctx = this._ensure(); if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + dur);
  }
  attach() { this.blip(520, 0.06, 'sine', 0.12); }
  release() { this.blip(760, 0.06, 'sine', 0.10); }
  swingOk() { this.blip(900, 0.07, 'triangle', 0.10); }
  crash() {
    const ctx = this._ensure(); if (!ctx) return;
    // Noise burst for a satisfying splash-smash.
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
    }
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = 0.35;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
    src.connect(f).connect(g).connect(ctx.destination);
    src.start();
  }
}

const STATE = { MENU: 0, PLAYING: 1, CRASHING: 2, OVER: 3 };

class GameManager {
  constructor() {
    this.canvas = document.getElementById('canvas');
    this.ctx = this.canvas.getContext('2d');

    // Systems.
    this.effects = new EffectsManager();
    this.river = new RiverGenerator();
    this.boundary = new RiverBoundarySystem(this.river);
    this.player = new PlayerController(this.effects);
    this.camera = new CameraController(this.canvas);
    this.ui = new UIManager();
    this.audio = new Audio_();

    this.state = STATE.MENU;
    this.held = false;
    this.distance = 0;
    this.swings = 0;
    this.best = Number(localStorage.getItem('hydroswing_best') || 0);
    this.freeze = 0;        // brief hit-stop timer
    this._lastT = 0;

    this._bindInput();
    this._resize();
    window.addEventListener('resize', () => this._resize());

    this.ui.showMenu();
    requestAnimationFrame((t) => this._loop(t));
  }

  // ------------------------------------------------------------------
  // Setup
  // ------------------------------------------------------------------
  _resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _bindInput() {
    const down = (e) => {
      this.audio._ensure(); // unlock audio on first gesture
      if (this.state === STATE.PLAYING) this.held = true;
      else if (this.state === STATE.MENU || this.state === STATE.OVER) this.start();
      if (e.cancelable) e.preventDefault();
    };
    const up = () => { this.held = false; };

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') { if (!e.repeat) down(e); }
    });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') up(); });

    this.canvas.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);

    // Buttons also start.
    this.ui.playBtn.addEventListener('click', (e) => { e.stopPropagation(); this.start(); });
    this.ui.againBtn.addEventListener('click', (e) => { e.stopPropagation(); this.start(); });
  }

  // ------------------------------------------------------------------
  // State transitions
  // ------------------------------------------------------------------
  start() {
    this.river.reset();
    this.boundary.reset();
    this.player.reset();
    this.effects.reset();
    this.river.ensureAhead(4000);
    this.camera.reset(this.player);
    this.distance = 0;
    this.swings = 0;
    this.freeze = 0;
    this.held = false;
    this.state = STATE.PLAYING;
    this.ui.showGame();
    this.ui.updateHud(0, 0);
  }

  crash() {
    this.state = STATE.CRASHING;
    this.freeze = 0.15; // brief freeze before the boat breaks apart
    this.player.alive = false;
    this.audio.crash();
    this.camera.addShake(22);
    this.effects.crash(this.player.x, this.player.y, this.player.heading, this.player.speed);
  }

  gameOver() {
    this.state = STATE.OVER;
    if (this.distance > this.best) {
      this.best = this.distance;
      localStorage.setItem('hydroswing_best', String(this.best));
    }
    this.ui.showGameOver({ distance: this.distance, swings: this.swings, best: this.best });
  }

  // ------------------------------------------------------------------
  // Main loop
  // ------------------------------------------------------------------
  _loop(t) {
    let dt = (t - this._lastT) / 1000;
    this._lastT = t;
    if (!isFinite(dt) || dt <= 0) dt = 1 / 60;
    dt = Math.min(dt, 1 / 30); // clamp big hitches

    this._update(dt);
    this._render();
    requestAnimationFrame((tt) => this._loop(tt));
  }

  _update(dt) {
    if (this.state === STATE.PLAYING) {
      this._updatePlaying(dt);
    } else if (this.state === STATE.CRASHING) {
      // Hit-stop, then let debris settle briefly before Game Over.
      if (this.freeze > 0) {
        this.freeze -= dt;
      } else {
        this.effects.update(dt);
        this.camera.update(dt, this.player);
        this._crashTimer = (this._crashTimer || 0) + dt;
        if (this._crashTimer > 0.7) { this._crashTimer = 0; this.gameOver(); }
      }
    }
    // MENU / OVER: keep ambient effects gently alive.
    if (this.state === STATE.MENU || this.state === STATE.OVER) {
      this.effects.update(dt);
    }
  }

  _updatePlaying(dt) {
    // Difficulty ramps with distance.
    this.player.setDifficulty(this.boundary.index >= 0 ? this._lastS || 0 : 0);

    // Keep the river generated ahead and trimmed behind.
    this.river.ensureAhead((this._lastS || 0) + 5000);

    // Swing state before this frame's update (for edge-triggered SFX).
    const wasAttached = this.player.swing.attached;
    const wasSwinging = this.player.swing.swinging;

    // Feed the boat its current track position so it hooks the right
    // upcoming turn's post.
    this.player.update(dt, this.held, this.river.pivots, this._lastS || 0);

    // SFX: soft click when the leash hooks, firmer note when the swing
    // actually bites, a light note on release.
    if (this.player.swing.attached && !wasAttached) this.audio.blip(430, 0.05, 'sine', 0.07);
    if (this.player.swing.swinging && !wasSwinging) this.audio.attach();
    if (!this.player.swing.attached && wasAttached) this.audio.release();

    // Locate on the centerline -> distance + crash test.
    const loc = this.boundary.locate(this.player.x, this.player.y);
    this._lastS = loc.s;
    this.distance = Math.max(this.distance, Math.floor(loc.s / 20));
    this.player.setDifficulty(loc.s);

    // Score: credit a swing only for pivots we actually grabbed and
    // then cleared while still on the water.
    for (const p of this.river.pivots) {
      if (!p.cleared && p.grabbed && loc.s > p.endS + 4 &&
          Math.abs(loc.offset) < this.river.halfWidth) {
        p.cleared = true;
        this.swings++;
        this.audio.swingOk();
      }
    }

    // Trim geometry behind us, then keep the tracked index aligned to
    // the shifted array so both collision and the "active corridor"
    // render stay locked to the boat.
    const removed = this.river.cull(loc.s - 1200);
    if (removed > 0) this.boundary.index = Math.max(0, this.boundary.index - removed);

    this.camera.update(dt, this.player);
    this.effects.ambientRipple(dt, this.camera.x, this.camera.y, 400);
    this.effects.update(dt);

    this.ui.updateHud(this.distance, this.swings);

    // Crash test — one touch of a bank ends the run.
    if (this.boundary.isCrashed(loc.offset, this.player.radius)) this.crash();
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  _render() {
    const ctx = this.ctx;
    const w = window.innerWidth, h = window.innerHeight;

    // Deep-water background gradient.
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1f8fc4');
    g.addColorStop(1, '#166a95');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    this.camera.apply(ctx);

    this.river.draw(ctx, this.boundary.index);
    this.effects.drawUnder(ctx);            // wake + ripples on the water
    this.river.drawPivots(ctx, this.player.swing.pivot, this._lastS || 0);

    if (this.player.alive) {
      this.player.drawCable(ctx);
      this.player.draw(ctx);
    }

    this.effects.drawOver(ctx);             // spray, debris, splash
    this.camera.restore(ctx);
  }
}

// Boot once the DOM is parsed.
window.addEventListener('DOMContentLoaded', () => { window.game = new GameManager(); });
