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
  /** Whooshing rising-then-falling sweep for the 360 world-spin. */
  vortex() {
    if (this.muted) return;
    const ctx = this._ensure(); if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(880, t + 0.5);
    o.frequency.exponentialRampToValueAtTime(150, t + 1.1);
    g.gain.setValueAtTime(0.13, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.15);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1600;
    o.connect(f).connect(g).connect(ctx.destination); o.start(); o.stop(t + 1.2);
  }
  /** Deep descending whoosh for the 180 reverse-current. */
  reverseSfx() {
    if (this.muted) return;
    const ctx = this._ensure(); if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.type = 'triangle';
    o.frequency.setValueAtTime(680, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.55);
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);
    o.connect(g).connect(ctx.destination); o.start(); o.stop(t + 0.7);
  }
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
    this.gemsRun = 0;       // gems COLLECTED this run
    this.gemItems = [];     // collectible gems floating in the river
    this._nextGemS = 900;   // arc-length of the next gem to spawn

    // Environmental twist-obstacles (purely visual — gameplay unchanged).
    this.obstacles = [];
    this._nextObsS = 5200;
    this.spin = { active: false, t: 0, dur: 2.6 };  // temporary 360 world-spin
    this.worldRot = 0;                              // eased current rotation
    this.worldRotTarget = 0;                        // persistent base (reverse flips 0<->PI)
    this.rev = { t: 1, dur: 1.0, from: 0, to: 0 };  // 180 reverse tween (t=1 = idle)
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
    this.ui.homeBtn.addEventListener('click', (e) => { e.stopPropagation(); this.enterMenu(); });

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
    this.gemItems = [];
    this._nextGemS = 900;
    this.obstacles = [];
    this._nextObsS = 5200;
    this.spin.active = false; this.spin.t = 0;
    this.worldRot = 0; this.worldRotTarget = 0;
    this.rev = { t: 1, dur: 1.0, from: 0, to: 0 };
    this.camera.anchorY = 0.62;
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
    this.gemItems = [];
    this._nextGemS = 900;
    this.obstacles = [];
    this._nextObsS = 5200;
    this.spin.active = false; this.spin.t = 0;
    this.worldRot = 0; this.worldRotTarget = 0;
    this.rev = { t: 1, dur: 1.0, from: 0, to: 0 };
    this.camera.anchorY = 0.62;
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
    if (this.river.split) {
      const sp = this.river.split;
      const sw = this.player.swing;
      const onBranchPost = sw.pivot === sp.branchPivot;
      const lb = this.river.locateBranch(this.player.x, this.player.y);
      sp.age = (sp.age || 0) + 1;

      // Hard safety: no fork may ever stay open more than ~4s — commit to
      // whichever lane the boat is actually nearest and move on.
      const forceOld = sp.age > 240;

      // Commit triggers (a fork can NEVER stay open past ~320px on either
      // lane — that stops the "invisible boundary" / stuck-fork glitches):
      //   • engaged the branch post, or clearly drifted down the branch → BRANCH
      //   • otherwise once you're past the fork on the main               → MAIN
      const tookBranch = (sw.swinging && onBranchPost) ||
        (lb.s > sp.forkS + 320 && Math.abs(lb.offset) < Math.abs(loc.offset)) ||
        (forceOld && Math.abs(lb.offset) < Math.abs(loc.offset));

      if (tookBranch) {
        this.river._commitToBranch();
        this.boundary.index = Math.max(0, this.river._promotedForkIdx);
        const nl = this.boundary.locate(this.player.x, this.player.y);
        activeOffset = nl.offset; activeS = nl.s; activeTangent = nl.tangent;
        crashed = false;                       // safe on the commit frame
      } else if (loc.s > sp.forkS + 300 || forceOld) {
        if (sw.attached && onBranchPost) sw.release();  // drop a lingering tether
        this.river._commitToMain();
        activeOffset = loc.offset; activeS = loc.s; activeTangent = loc.tangent;
        crashed = Math.abs(loc.offset) > hw - r;
      } else {
        // Undecided throat: water is the UNION of both channels — safe if
        // inside EITHER, so no phantom wall while the lanes are still shared.
        const nearBranch = Math.abs(lb.offset) < Math.abs(loc.offset);
        activeOffset = nearBranch ? lb.offset : loc.offset;
        activeS = nearBranch ? lb.s : loc.s;
        activeTangent = nearBranch ? lb.tangent : loc.tangent;
        crashed = Math.abs(loc.offset) > hw - r && Math.abs(lb.offset) > hw - r;
      }
    }
    // Fade the not-taken ghost path out once it's off-screen.
    this.river.updateGhost(this.camera.x, this.camera.y);

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
        this.audio.swingOk();
      }
    }

    // Collectible gems: spawn ahead in the middle of the river, collect on
    // touch, cull behind.
    while (this._nextGemS < this.river.s - 150 && this._nextGemS < activeS + 4000) {
      const gp = this.river.pointAtS(this._nextGemS);
      if (gp) {
        const off = Utils.rand(-0.3, 0.3) * this.river.halfWidth;   // near the center line
        this.gemItems.push({ x: gp.x + gp.nx * off, y: gp.y + gp.ny * off, s: this._nextGemS, bob: Math.random() * 6.28 });
      }
      this._nextGemS += Utils.rand(650, 1150);
    }
    for (let i = this.gemItems.length - 1; i >= 0; i--) {
      const gm = this.gemItems[i];
      gm.bob += dt * 4;
      if (gm.s < activeS - 250) { this.gemItems.splice(i, 1); continue; }   // behind us
      if (Math.abs(gm.s - activeS) < 300 && Math.hypot(gm.x - this.player.x, gm.y - this.player.y) < 26) {
        this.gemItems.splice(i, 1);
        this.gemsRun++;
        this.audio.blip(1080, 0.09, 'triangle', 0.12);
        this.ui.bumpGems();
        this.effects.ripples.push({ x: gm.x, y: gm.y, r: 3, life: 1 });
        this.effects.emitFoam(gm.x, gm.y, 0, 4);
      }
    }

    // Twist-obstacles: rare, spawned on the center line. On touch they fire a
    // purely-visual world rotation — the boat/river/collision never change.
    while (this._nextObsS < this.river.s - 150 && this._nextObsS < activeS + 4000) {
      const op = this.river.pointAtS(this._nextObsS);
      if (op) this.obstacles.push({ x: op.x, y: op.y, s: this._nextObsS, type: Math.random() < 0.5 ? 'spin' : 'reverse', spin: 0 });
      this._nextObsS += Utils.rand(3200, 5500);   // slightly more frequent
    }
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const o = this.obstacles[i];
      o.spin += dt * 2;
      if (o.s < activeS - 250) { this.obstacles.splice(i, 1); continue; }
      // Trigger only when it's on the stretch we're actually on (not a
      // crossing section that happens to overlap in world space).
      if (Math.abs(o.s - activeS) < 300 && Math.hypot(o.x - this.player.x, o.y - this.player.y) < 30) {
        this.obstacles.splice(i, 1);
        if (o.type === 'spin') this.triggerSpin(o.x, o.y); else this.triggerReverse(o.x, o.y);
      }
    }

    // Advance the world-rotation animations (view-only).
    if (this.spin.active) { this.spin.t += dt; if (this.spin.t >= this.spin.dur) { this.spin.active = false; this.spin.t = 0; } }
    // Reverse flip: a readable ~1s ease-in-out tween (slow, quick, slow).
    if (this.rev.t < 1) {
      this.rev.t = Math.min(1, this.rev.t + dt / this.rev.dur);
      const k = this.rev.t * this.rev.t * (3 - 2 * this.rev.t);
      this.worldRot = this.rev.from + (this.rev.to - this.rev.from) * k;
    }
    const rotBusy = this.spin.active || this.rev.t < 1 || Math.abs(this.worldRot) > 0.02;
    this.camera.anchorY = Utils.damp(this.camera.anchorY, rotBusy ? 0.5 : 0.62, 6, dt);

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

    // World-rotation twist effects rotate the ENTIRE scene about the boat's
    // screen anchor (the boat stays put). Physics/generation are untouched.
    const th = this._worldAngle();
    const rotating = Math.abs(th) > 0.0005;
    if (rotating) {
      // Fill first so any corner exposed by rotation shows ocean, not black.
      ctx.fillStyle = '#082438'; ctx.fillRect(0, 0, w, h);
      const c = Math.abs(Math.cos(th)), s = Math.abs(Math.sin(th));
      const k = Math.max(c + (h / w) * s, (w / h) * s + c);   // scale so it always covers
      const px = w / 2, py = h * this.camera.anchorY;
      ctx.save();
      ctx.translate(px, py); ctx.rotate(th); ctx.scale(k, k); ctx.translate(-px, -py);
    }

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
        ? (1 - (this._introK * this._introK * (3 - 2 * this._introK))) * 300 : 0;
      const waterFlow = Utils.clamp(this.player.speed / 420, 0, 1);
      if (this.river.split) {
        this.river.drawForked(ctx, this.boundary.index, this.player.swing.pivot, waterFlow);
      } else if (this.river.ghost) {
        this.river.drawWithGhost(ctx, this.boundary.index, waterFlow);
      } else {
        this.river.draw(ctx, this.boundary.index, bonus, waterFlow);
      }
    }

    this.effects.drawUnder(ctx);            // wake + ripples + glints

    if (!isMenu) this.river.drawPivots(ctx, this.player.swing.pivot, this._lastS || 0);
    if (!isMenu) this._drawGems(ctx);
    if (!isMenu) this._drawObstacles(ctx);

    if (this.player.alive) {
      if (!isMenu) this.player.drawCable(ctx);
      this.player.draw(ctx);
    }

    this.effects.drawOver(ctx);             // spray, debris, splash
    this.camera.restore(ctx);

    // Surface floaters + ambient (foam, leaves, pollen, mist); lily pads
    // only on the landing.
    this.env.drawOver(ctx, w, h, isMenu);

    // Close the world-rotation transform (everything above rotated together).
    if (rotating) ctx.restore();

    // Screen-space edge speed blur (ramps in during launch, lingers subtly
    // at high speed).
    this._drawEdgeBlur(ctx, w, h);
  }

  /** Draw the collectible rubies floating on the river (world space).
   *  Only those on the boat's current stretch — never on a crossing
   *  section that overlaps the background. */
  _drawGems(ctx) {
    const ps = this._lastS || 0;
    for (const gm of this.gemItems) {
      if (gm.s < ps - 200 || gm.s > ps + 1300) continue;
      const by = Math.sin(gm.bob) * 3;
      GameManager._drawRuby(ctx, gm.x, gm.y + by, 13, 0.22 + 0.16 * (0.5 + 0.5 * Math.sin(gm.bob)));
    }
  }

  /** A faceted ruby with glow + shine. Used for the collectibles (and the
   *  same silhouette matches the HUD icon) — no emoji anywhere. */
  static _drawRuby(ctx, x, y, r, glow) {
    ctx.save();
    ctx.translate(x, y);
    if (glow > 0) {
      ctx.fillStyle = `rgba(255, 70, 100, ${glow})`;
      ctx.beginPath(); ctx.arc(0, 0, r + 8, 0, Utils.TWO_PI); ctx.fill();
    }
    // Body
    ctx.fillStyle = '#d61f43';
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.9, -r * 0.32);
    ctx.lineTo(r * 0.55, r * 0.95);
    ctx.lineTo(-r * 0.55, r * 0.95);
    ctx.lineTo(-r * 0.9, -r * 0.32);
    ctx.closePath(); ctx.fill();
    // Top table (lighter)
    ctx.fillStyle = '#ff5c7a';
    ctx.beginPath();
    ctx.moveTo(0, -r); ctx.lineTo(r * 0.9, -r * 0.32); ctx.lineTo(0, -r * 0.05); ctx.lineTo(-r * 0.9, -r * 0.32);
    ctx.closePath(); ctx.fill();
    // Lower-left facet shade
    ctx.fillStyle = 'rgba(120, 10, 30, 0.35)';
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.05); ctx.lineTo(-r * 0.9, -r * 0.32); ctx.lineTo(-r * 0.55, r * 0.95); ctx.closePath(); ctx.fill();
    // Shine
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.beginPath();
    ctx.moveTo(-2, -r + 1.5); ctx.lineTo(2.5, -r + 1.5); ctx.lineTo(0, -r * 0.25); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  /** Draw the twist-obstacles: a glowing spinning vortex (cyan = 360 spin,
   *  orange = 180 reverse) so players learn each at a glance. */
  _drawObstacles(ctx) {
    const ps = this._lastS || 0;
    for (const o of this.obstacles) {
      if (o.s < ps - 200 || o.s > ps + 1300) continue;   // only on the current stretch
      const spin = o.type === 'spin';
      const col = spin ? '90,230,255' : '255,150,80';   // cyan = 360 spin, orange = 180 reverse
      const dir = spin ? 1 : -1;
      ctx.save();
      ctx.translate(o.x, o.y);
      const pulse = 0.22 + 0.12 * (0.5 + 0.5 * Math.sin(o.spin * 2));
      ctx.fillStyle = `rgba(${col},${pulse})`;
      ctx.beginPath(); ctx.arc(0, 0, 21, 0, Utils.TWO_PI); ctx.fill();
      ctx.rotate(o.spin * dir);
      // Three logarithmic-spiral arms curling into the center.
      ctx.strokeStyle = `rgba(${col},0.95)`; ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (let a = 0; a < 3; a++) {
        const base = a * (Utils.TWO_PI / 3);
        ctx.beginPath();
        for (let t = 0; t <= 1.001; t += 0.12) {
          const rr = 3.5 + t * 12, ang = base + t * 2.4 * dir;
          const px = Math.cos(ang) * rr, py = Math.sin(ang) * rr;
          if (t === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      ctx.fillStyle = `rgba(${col},1)`;
      ctx.beginPath(); ctx.arc(0, 0, 3, 0, Utils.TWO_PI); ctx.fill();
      ctx.restore();
    }
  }

  // -------------------- twist-obstacle effects (view-only) --------------------

  /** Total scene rotation this frame: persistent base + temporary spin. */
  _worldAngle() {
    if (!this.spin.active) return this.worldRot;
    const t = this.spin.t / this.spin.dur;
    const eased = t * t * (3 - 2 * t);          // smoothstep so it eases in/out
    return this.worldRot + eased * Utils.TWO_PI;
  }

  triggerSpin(x, y) {
    if (this.spin.active) return;
    this.spin.active = true; this.spin.t = 0;
    this.camera.addShake(20);
    this.audio.vortex();
    this._waterBurst(x, y);
    this._flashBlur();
  }

  triggerReverse(x, y) {
    this.worldRotTarget = this.worldRotTarget === 0 ? Math.PI : 0;  // flip persistent orientation
    this.rev = { t: 0, dur: 1.0, from: this.worldRot, to: this.worldRotTarget };
    this.camera.addShake(16);
    this.audio.reverseSfx();
    this._waterBurst(x, y);
    this._flashBlur();
  }

  _waterBurst(x, y) {
    this.effects.emitFoam(x, y, 0, 14);
    for (let a = 0; a < 6; a++) {
      const ang = (a / 6) * Utils.TWO_PI;
      this.effects.emitSpray(x, y, Math.cos(ang), Math.sin(ang), 0, 1.3);
    }
    this.effects.ripples.push({ x, y, r: 5, life: 1 });
    this.effects.ripples.push({ x, y, r: 20, life: 1 });
  }

  /** Quick CSS blur flash on the canvas (fraction of a second). */
  _flashBlur() {
    this.canvas.classList.add('rot-flash');
    clearTimeout(this._blurT);
    this._blurT = setTimeout(() => this.canvas.classList.remove('rot-flash'), 170);
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
