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
    if (this.muted) return;
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
    if (this.muted) return;
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
    this.env = new EnvironmentManager();
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
    this.gemsRun = 0;       // gems earned this run (1 per swing)
    this.best = Number(localStorage.getItem('hydroswing_best') || 0);
    this.gems = Number(localStorage.getItem('hydroswing_gems') || 0);
    this.muted = localStorage.getItem('hydroswing_muted') === '1';
    this.freeze = 0;        // brief hit-stop timer
    this._lastT = 0;

    this.menuT = 0;         // menu animation clock
    this.introT = null;     // launch-transition progress 0..1 (null = not launching)
    this.introDur = 1.2;
    this.bubbles = [];      // drifting menu bubbles (screen space)

    this.MENU_ZOOM = 0.9;
    this.PLAY_ZOOM = 1.0;

    this._bindInput();
    this._resize();
    window.addEventListener('resize', () => this._resize());

    this.enterMenu();
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
      else if (this.state === STATE.MENU) this.beginPlay(true);
      else if (this.state === STATE.OVER) this.beginPlay(false);
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

    this.ui.againBtn.addEventListener('click', (e) => { e.stopPropagation(); this.beginPlay(false); });

    // Settings gear + mute toggle (do not start the game).
    this.ui.settingsBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.ui.settingsBtn.addEventListener('click', (e) => { e.stopPropagation(); this.ui.toggleSettings(); });
    this.ui.muteBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.ui.muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.muted = !this.muted;
      this.audio.muted = this.muted;
      localStorage.setItem('hydroswing_muted', this.muted ? '1' : '0');
      this.ui.setMuteLabel(this.muted);
    });
    this.audio.muted = this.muted;
    this.ui.setMuteLabel(this.muted);
  }

  // ------------------------------------------------------------------
  // State transitions
  // ------------------------------------------------------------------
  /** Reset the world and show the animated landing screen. */
  enterMenu() {
    this.env.reset();
    this.river.reset();
    this.boundary.reset();
    this.player.reset();
    this.effects.reset();
    this.river.ensureAhead(4000);
    this.camera.reset(this.player);
    this.camera.zoom = this.MENU_ZOOM;
    this.player.speed = 0;           // idle
    this.player.alive = true;
    this.distance = 0;
    this.swings = 0;
    this.gemsRun = 0;
    this.introT = null;
    this.held = false;
    this.state = STATE.MENU;
    this.ui.showMenu(this.gems, this.best);
  }

  /**
   * Seamlessly transform the menu into gameplay. `fromMenu` runs the full
   * 1.2s launch flourish (logo lift, banks slide in, speed ramp); retries
   * from game over use a quick 0.45s version so "one more try" stays snappy.
   */
  beginPlay(fromMenu) {
    this.river.reset();
    this.boundary.reset();
    this.player.reset();
    this.effects.reset();
    this.river.ensureAhead(4000);
    this.camera.reset(this.player);
    this.distance = 0;
    this.swings = 0;
    this.gemsRun = 0;
    this.freeze = 0;
    this.held = false;
    this.introT = 0;
    this.introDur = fromMenu ? 1.2 : 0.45;
    this.state = STATE.PLAYING;
    this.ui.updateHud(0, 0);
    // Fish dart away from the boat as it launches.
    this.env.scatter(window.innerWidth / 2, window.innerHeight * 0.62);
    if (fromMenu) this.ui.launch(); else this.ui.showGame();
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
    // Bank the gems earned this run into the lifetime total.
    this.gems += this.gemsRun;
    localStorage.setItem('hydroswing_gems', String(this.gems));
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
      this.env.update(dt, 0, { x: window.innerWidth / 2, y: window.innerHeight * 0.62 });
    }
    if (this.state === STATE.MENU) {
      this._updateMenu(dt);
    } else if (this.state === STATE.OVER) {
      this.effects.update(dt);
      this.env.update(dt, 0, { x: window.innerWidth / 2, y: window.innerHeight * 0.62 });
    }
  }

  /** Idle landing scene: the boat bobs and slowly rocks, alive but still. */
  _updateMenu(dt) {
    this.menuT += dt;
    const p = this.player;
    p.bobPhase += dt * 3;
    p.bob = Math.sin(p.bobPhase) * 2.4 + Math.sin(p.bobPhase * 2.1) * 0.8;
    p.lean = Math.sin(this.menuT * 0.6) * 0.13;   // gentle few-degree rock

    // Keep the camera locked on the idle boat (no follow jitter).
    this.camera.x = p.x;
    this.camera.y = p.y;
    this.camera.zoom = this.MENU_ZOOM;

    // Tiny ripples + hull splashes beneath the idle boat.
    if (Math.random() < 0.25) {
      this.effects.ripples.push({ x: p.x + Utils.rand(-14, 14), y: p.y + Utils.rand(-6, 16), r: Utils.rand(3, 7), life: 1 });
    }
    if (Math.random() < 0.12) {
      this.effects.emitFoam(p.x + Utils.rand(-8, 8), p.y + 12, p.bobPhase, 1);
    }
    this.effects.ambient(dt, p.x, p.y, 500);
    this.effects.update(dt);

    // Living ocean backdrop (idle: flow = 0).
    this.env.update(dt, 0, { x: window.innerWidth / 2, y: window.innerHeight * 0.62 });
  }

  _updatePlaying(dt) {
    // --- Launch transition: advance progress + acceleration ease. ---
    if (this.introT !== null) {
      this.introT += dt / this.introDur;
      if (this.introT >= 1) this.introT = null;
    }
    const introK = this.introT === null ? 1 : this.introT;
    const accel = introK * introK * (3 - 2 * introK);   // smoothstep 0..1
    this._introK = introK;
    this.camera.zoom = Utils.lerp(this.MENU_ZOOM, this.PLAY_ZOOM, accel);

    const d0 = this._lastS || 0;
    // Speed ramps up from a standstill during the launch (boat accelerates).
    this.player.speed = RiverGenerator.diff(d0).speed * accel;

    // Keep the river generated ahead and trimmed behind.
    this.river.ensureAhead(d0 + 5000);

    // Swing state before this frame's update (for edge-triggered SFX).
    const wasAttached = this.player.swing.attached;
    const wasSwinging = this.player.swing.swinging;

    // Feed the boat its current track position + the river's forward
    // tangent here (so it can straighten to the river after a swing).
    this.player.update(dt, this.held, this.river.activePivots(), this._lastS || 0, this._lastTangent);

    // SFX: soft click when the leash hooks, firmer note when the swing
    // actually bites, a light note on release.
    if (this.player.swing.attached && !wasAttached) this.audio.blip(430, 0.05, 'sine', 0.07);
    if (this.player.swing.swinging && !wasSwinging) this.audio.attach();
    if (!this.player.swing.attached && wasAttached) this.audio.release();

    // Locate on the main centerline.
    const loc = this.boundary.locate(this.player.x, this.player.y);

    const hw = this.river.halfWidth, r = this.player.radius;
    let activeOffset = loc.offset, activeS = loc.s, activeTangent = loc.tangent;
    let crashed = this.boundary.isCrashed(loc.offset, r);
    // Only engage the fork logic when the boat is actually near the fork
    // (it's generated ~5000px ahead, long before the boat reaches it).
    if (this.river.split && loc.s > this.river.split.forkS - 700) {
      const sp = this.river.split;
      const lb = this.river.locateBranch(this.player.x, this.player.y);
      this.river.lockSplitLane(loc, lb);   // lock to a lane once clearly diverged

      if (sp.locked === 'branch') {
        // Committed lane: ONLY this channel can crash us (no phantom walls).
        activeOffset = lb.offset; activeS = lb.s; activeTangent = lb.tangent;
        crashed = Math.abs(lb.offset) > hw - r;
      } else if (sp.locked === 'main') {
        activeOffset = loc.offset; activeS = loc.s; activeTangent = loc.tangent;
        crashed = Math.abs(loc.offset) > hw - r;
      } else {
        // Undecided (near the fork): in-bounds if inside either channel.
        const nearBranch = Math.abs(lb.offset) < Math.abs(loc.offset);
        activeOffset = nearBranch ? lb.offset : loc.offset;
        activeS = nearBranch ? lb.s : loc.s;
        activeTangent = nearBranch ? lb.tangent : loc.tangent;
        crashed = Math.abs(loc.offset) > hw - r && Math.abs(lb.offset) > hw - r;
      }

      // Finish the fork once it's scrolled off-screen; keep only the lane
      // we're in and continue generation there.
      if (this.river.finalizeSplitIfOffscreen(this.camera.x, this.camera.y) === 'promoted') {
        // The branch is now the main path; retarget the tracked index to
        // the boat's actual spot along it (it's well past the fork).
        const pts = this.river.points;
        let idx = Math.max(0, this.river._promotedForkIdx);
        while (idx < pts.length - 1 && pts[idx].s < activeS) idx++;
        this.boundary.index = idx;
      }
    }

    this._lastS = activeS;
    this._lastTangent = activeTangent;   // river forward direction for post-swing straighten
    this.distance = Math.max(this.distance, Math.floor(activeS / 20));

    // Progressive difficulty (speed still ramping during the launch).
    const diff = RiverGenerator.diff(activeS);
    this.player.speed = diff.speed * accel;
    this.river.halfWidth = diff.halfWidth;

    // Score: credit a swing only for posts we grabbed and then cleared
    // while on the water (main + branch during a fork).
    for (const p of this.river.activePivots()) {
      if (!p.cleared && p.grabbed && activeS > p.endS + 4 && Math.abs(activeOffset) < this.river.halfWidth) {
        p.cleared = true;
        this.swings++;
        this.gemsRun++;        // one gem per clean swing
        this.audio.swingOk();
      }
    }

    // Trim geometry behind us, then keep the tracked index aligned to
    // the shifted array so both collision and the "active corridor"
    // render stay locked to the boat. (Don't cull mid-fork — indices
    // there are in flux.)
    if (!this.river.split) {
      const removed = this.river.cull(activeS - 1200);
      if (removed > 0) this.boundary.index = Math.max(0, this.boundary.index - removed);
    }

    // Aggressive swings give a subtle camera rumble (scales with drift
    // intensity). Kept light so it reads as energy, not a jitter.
    if (this.player.swing.swinging) {
      this.camera.addShake(this.player.swing.intensity * 0.2);
    }

    this.camera.update(dt, this.player);
    this.effects.ambient(dt, this.camera.x, this.camera.y, 620);
    this.effects.update(dt);

    // Living ocean flows faster as the boat speeds up (0..1).
    const flow = Utils.clamp(this.player.speed / 380, 0, 1);
    this.env.update(dt, flow, { x: window.innerWidth / 2, y: window.innerHeight * 0.62 });

    this.ui.updateHud(this.distance, this.gemsRun);

    // Crash test — one touch of a bank ends the run (union of both
    // channels during a fork).
    if (crashed) this.crash();
  }

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  _render() {
    const ctx = this.ctx;
    const w = window.innerWidth, h = window.innerHeight;
    const isMenu = this.state === STATE.MENU;

    // Living tropical ocean backdrop (same in menu + gameplay = seamless):
    // depth-shaded water, then seabed props + marine life BEHIND the boat.
    // Static props (seaweed/coral/rocks/etc.) show on the landing only;
    // marine life + ambient keep going during gameplay.
    this.env.drawWater(ctx, w, h);
    this.env.drawUnder(ctx, w, h, isMenu);

    this.camera.apply(ctx);

    if (!isMenu) {
      // During the launch, banks start wide (off-screen) and slide inward.
      const bonus = this._introK != null && this._introK < 1
        ? (1 - (this._introK * this._introK * (3 - 2 * this._introK))) * 650 : 0;
      const waterFlow = Utils.clamp(this.player.speed / 420, 0, 1);
      if (this.river.split) {
        this.river.drawForked(ctx, this.boundary.index, this.player.swing.pivot, waterFlow);
      } else {
        this.river.draw(ctx, this.boundary.index, bonus, waterFlow);
      }
    }

    this.effects.drawUnder(ctx);            // wake + ripples + glints

    if (!isMenu) this.river.drawPivots(ctx, this.player.swing.pivot, this._lastS || 0);

    if (this.player.alive) {
      if (!isMenu) this.player.drawCable(ctx);
      this.player.draw(ctx);
    }

    this.effects.drawOver(ctx);             // spray, debris, splash
    this.camera.restore(ctx);

    // Surface floaters + ambient (foam, leaves, pollen, mist); lily pads
    // only on the landing.
    this.env.drawOver(ctx, w, h, isMenu);

    // Screen-space edge speed blur (ramps in during launch, lingers subtly
    // at high speed).
    this._drawEdgeBlur(ctx, w, h);
  }

  /** Darkened, motion-blurred screen edges — energy of speed. Ramps in
   *  during the launch and stays faintly present the faster you go. */
  _drawEdgeBlur(ctx, w, h) {
    let a = 0;
    if (this._introK != null && this._introK < 1) a += (1 - this._introK) * 0.35;
    if (this.state === STATE.PLAYING) {
      const sp = Utils.clamp((this.player.speed - 320) / 160, 0, 1);
      a += sp * 0.16;
    }
    if (a <= 0.01) return;
    const bw = w * 0.16;
    let lg = ctx.createLinearGradient(0, 0, bw, 0);
    lg.addColorStop(0, `rgba(3, 16, 30, ${a})`); lg.addColorStop(1, 'rgba(3,16,30,0)');
    ctx.fillStyle = lg; ctx.fillRect(0, 0, bw, h);
    let rg = ctx.createLinearGradient(w, 0, w - bw, 0);
    rg.addColorStop(0, `rgba(3, 16, 30, ${a})`); rg.addColorStop(1, 'rgba(3,16,30,0)');
    ctx.fillStyle = rg; ctx.fillRect(w - bw, 0, bw, h);
  }
}

// Boot once the DOM is parsed.
window.addEventListener('DOMContentLoaded', () => { window.game = new GameManager(); });
