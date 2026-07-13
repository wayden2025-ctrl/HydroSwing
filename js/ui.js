/* ============================================================
 * ui.js — UIManager
 *
 * Thin wrapper over the DOM overlays (menu, HUD, game over). Keeps
 * all element lookups and screen transitions in one place so the
 * GameManager only deals in high-level calls: showMenu(), showGame(),
 * showGameOver(stats), updateHud().
 * ========================================================== */

class UIManager {
  constructor() {
    this.menu = document.getElementById('menu');
    this.hud = document.getElementById('hud');
    this.gameover = document.getElementById('gameover');

    this.hudDist = document.getElementById('hudDist');
    this.hudSwings = document.getElementById('hudSwings');

    this.goDist = document.getElementById('goDist');
    this.goSwings = document.getElementById('goSwings');
    this.goBest = document.getElementById('goBest');

    this.playBtn = document.getElementById('playBtn');
    this.againBtn = document.getElementById('againBtn');
  }

  showMenu() {
    this.menu.classList.remove('hidden');
    this.hud.classList.add('hidden');
    this.gameover.classList.add('hidden');
  }

  showGame() {
    this.menu.classList.add('hidden');
    this.hud.classList.remove('hidden');
    this.gameover.classList.add('hidden');
  }

  showGameOver(stats) {
    this.hud.classList.add('hidden');
    this.gameover.classList.remove('hidden');
    this.goDist.textContent = stats.distance;
    this.goSwings.textContent = stats.swings;
    this.goBest.textContent = stats.best;
    // Re-trigger the pop animation.
    const panel = this.gameover.querySelector('.panel');
    panel.classList.remove('pop'); void panel.offsetWidth; panel.classList.add('pop');
  }

  updateHud(distance, swings) {
    this.hudDist.textContent = distance;
    this.hudSwings.textContent = swings;
  }
}
