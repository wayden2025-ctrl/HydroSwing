/* ============================================================
 * ui.js — UIManager
 *
 * Thin wrapper over the DOM chrome: the landing screen (logo, press
 * prompt, glass panels, settings), the in-game HUD, and the game-over
 * card. The GameManager drives it with high-level calls; all the fade /
 * launch transitions are CSS, toggled here by class.
 * ========================================================== */

class UIManager {
  constructor() {
    this.menu = document.getElementById('menu');
    this.hud = document.getElementById('hud');
    this.gameover = document.getElementById('gameover');

    // Landing
    this.gemCount = document.getElementById('gemCount');
    this.bestCount = document.getElementById('bestCount');
    this.settingsBtn = document.getElementById('settingsBtn');
    this.settingsPanel = document.getElementById('settingsPanel');
    this.muteBtn = document.getElementById('muteBtn');

    // HUD
    this.hudDist = document.getElementById('hudDist');
    this.hudGems = document.getElementById('hudGems');

    // Game over
    this.goDist = document.getElementById('goDist');
    this.goSwings = document.getElementById('goSwings');
    this.goBest = document.getElementById('goBest');
    this.againBtn = document.getElementById('againBtn');
    this.homeBtn = document.getElementById('homeBtn');

    this._scoreGems = document.querySelector('.score-gems');
    this._hideTimer = null;
  }

  /** Pop the gem counter when one is collected. */
  bumpGems() {
    const el = this._scoreGems;
    if (!el) return;
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }

  /** Show the landing screen (fresh, un-launched). */
  showMenu(gems, best) {
    clearTimeout(this._hideTimer);
    this.menu.classList.remove('hidden', 'launching');
    this.settingsPanel.classList.add('hidden');
    this.hud.classList.remove('show');
    this.gameover.classList.add('hidden');
    this.gemCount.textContent = gems;
    this.bestCount.textContent = best;
  }

  /** Begin the seamless launch: animate the landing out, fade the HUD in. */
  launch() {
    this.menu.classList.add('launching');
    this.gameover.classList.add('hidden');
    this.hud.classList.add('show');
    // Remove the landing from the layout once its fade-out finishes.
    this._hideTimer = setTimeout(() => this.menu.classList.add('hidden'), 900);
  }

  /** Straight to gameplay HUD (used for fast retries, no landing anim). */
  showGame() {
    clearTimeout(this._hideTimer);
    this.menu.classList.add('hidden');
    this.hud.classList.add('show');
    this.gameover.classList.add('hidden');
  }

  showGameOver(stats) {
    this.hud.classList.remove('show');
    this.gameover.classList.remove('hidden');
    this.goDist.textContent = stats.distance;
    this.goSwings.textContent = stats.swings;
    this.goBest.textContent = stats.best;
    // Restart the drop-in / rise-in CSS animations (same elements reused).
    for (const sel of ['.go-title', '.go-panel']) {
      const el = this.gameover.querySelector(sel);
      if (!el) continue;
      el.style.animation = 'none';
      void el.offsetWidth;      // force reflow
      el.style.animation = '';
    }
  }

  updateHud(distance, gems) {
    this.hudDist.textContent = distance;
    this.hudGems.textContent = gems;
  }

  setMuteLabel(muted) { if (this.muteBtn) this.muteBtn.textContent = muted ? 'OFF' : 'ON'; }
  toggleSettings() { this.settingsPanel.classList.toggle('hidden'); }
}
