// Main state machine, fixed-step loop, input, camera, rendering, persistence and failure handling.

import { clamp, EventBus, RNG, storage } from './util.js';
import { Effects, TileMap, T } from './world.js';
import { Player } from './player.js';
import { ELEMENTS, ELEMENT_COLORS, Weaver } from './magic.js';
import { EnemyManager } from './enemies.js';
import { AllyManager } from './allies.js';
import { MissionEngine, MISSION_BY_ID } from './missions.js';
import { UI } from './ui.js';

const SAVE_KEY = 'wot-aes-sedai:save:v1';
const SAVE_VERSION = 1;
const STEP = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;

class Input {
  constructor() {
    this.keys = new Set();
    this.queued = new Set();
    this.mouse = { x: 0, y: 0, worldX: 0, worldY: 0, inside: false };
  }

  isDown(code) {
    return this.keys.has(code);
  }

  queue(action) {
    this.queued.add(action);
  }

  consume(action) {
    const had = this.queued.has(action);
    this.queued.delete(action);
    return had;
  }

  reset() {
    this.keys.clear();
    this.queued.clear();
  }
}

class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.events = new EventBus();
    this.effects = new Effects();
    this.rng = new RNG();
    this.input = new Input();
    this.map = new TileMap(4, 4, T.FLOOR);
    this.player = null;
    this.enemies = new EnemyManager(this);
    this.enemies.elementColors = ELEMENT_COLORS;
    this.allies = new AllyManager(this);
    this.weaver = new Weaver(this);
    this.missions = new MissionEngine(this);
    this.ui = new UI(this);
    this.state = 'title';
    this.time = 0;
    this.camera = { x: 0, y: 0, zoom: 1, viewW: 0, viewH: 0 };
    this.dpr = 1;
    this.pendingEnding = null;
    this.activeMissionId = null;
    this.burnoutActive = false;
    this.exploreTimer = 0;
    this.lastFrame = performance.now();
    this.accumulator = 0;
    this.errorCount = 0;
    this.motes = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), s: 0.2 + Math.random() * 0.8 }));
  }

  init() {
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindInput();
    window.addEventListener('error', (e) => this.ui.reportError(`Unexpected error: ${e.message ?? 'unknown'}`));
    window.addEventListener('unhandledrejection', (e) => {
      console.error('[game] unhandled rejection', e.reason);
      this.ui.reportError('A background task failed; the game continues.');
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'mission') this.pause();
    });
    this.returnToTitle();
    requestAnimationFrame((t) => this.frame(t));
  }

  // -- input --------------------------------------------------------------------

  bindInput() {
    const typing = (e) => e.target instanceof HTMLElement && e.target.matches('input, textarea, select');
    window.addEventListener('keydown', (e) => {
      if (typing(e)) return;
      if (this.ui.handleKey(e)) return;
      if (this.state === 'paused' && (e.code === 'Escape' || e.code === 'KeyP')) {
        e.preventDefault();
        this.resume();
        return;
      }
      if (this.state !== 'mission') return;
      this.input.keys.add(e.code);
      const digit = /^Digit([1-5])$/.exec(e.code) ?? /^Numpad([1-5])$/.exec(e.code);
      if (digit) {
        e.preventDefault();
        if (!e.repeat) this.weaver.addThread(ELEMENTS[Number(digit[1]) - 1].id);
        return;
      }
      switch (e.code) {
        case 'Backspace':
          e.preventDefault();
          this.weaver.removeThread();
          break;
        case 'KeyQ':
          this.weaver.clearThreads();
          break;
        case 'Space':
          e.preventDefault();
          if (!e.repeat) this.input.queue('dash');
          break;
        case 'KeyF':
          if (!e.repeat) this.safely('ability', () => this.weaver.useAjahAbility());
          break;
        case 'KeyR':
          if (!e.repeat) this.safely('artifact', () => this.weaver.useArtifact());
          break;
        case 'Escape':
        case 'KeyP':
          e.preventDefault();
          this.pause();
          break;
        case 'KeyH':
          this.pause();
          this.ui.returnScreen = 'pause';
          this.ui.showScreen('help');
          break;
        default:
          if (e.code.startsWith('Arrow')) e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.input.keys.delete(e.code));
    window.addEventListener('blur', () => this.input.reset());
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('pointermove', (e) => this.updatePointer(e));
    this.canvas.addEventListener('pointerleave', () => {
      this.input.mouse.inside = false;
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      this.updatePointer(e);
      if (this.state !== 'mission' || this.ui.dialogueOpen || !this.player) return;
      e.preventDefault();
      const { worldX, worldY } = this.input.mouse;
      this.safely('weave', () => {
        if (e.button === 2) this.weaver.recastLast(worldX, worldY);
        else if (e.button === 0) this.weaver.release(worldX, worldY);
      });
    });
  }

  updatePointer(e) {
    const rect = this.canvas.getBoundingClientRect();
    const m = this.input.mouse;
    m.x = e.clientX - rect.left;
    m.y = e.clientY - rect.top;
    m.inside = true;
    this.updateMouseWorld();
  }

  updateMouseWorld() {
    const m = this.input.mouse;
    const cam = this.camera;
    m.worldX = cam.x - cam.viewW / 2 + m.x / cam.zoom;
    m.worldY = cam.y - cam.viewH / 2 + m.y / cam.zoom;
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth || window.innerWidth;
    const hgt = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(hgt * this.dpr);
    this.updateCameraZoom();
  }

  updateCameraZoom() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const hgt = this.canvas.clientHeight || window.innerHeight;
    const vision = this.player?.mod('cameraZoom', 1) ?? 1;
    this.camera.zoom = clamp(Math.min(w / 1000, hgt / 680), 0.65, 1.6) * vision;
    this.camera.viewW = w / this.camera.zoom;
    this.camera.viewH = hgt / this.camera.zoom;
  }

  // -- flow -----------------------------------------------------------------------

  returnToTitle() {
    this.state = 'title';
    this.ui.setHUDVisible(false);
    this.ui.showTitle(!!storage.read(SAVE_KEY));
  }

  beginCreation() {
    this.state = 'create';
    this.ui.showCreate();
  }

  startNewGame(name, affinity) {
    try {
      this.player = new Player({ name, affinity });
    } catch (err) {
      this.ui.reportError(err.message);
      return;
    }
    this.player.addChronicle('Arrived at the White Tower as a Novice.', 'ceremony');
    this.pendingEnding = null;
    this.save();
    this.updateCameraZoom();
    this.startMission('garden_breach');
  }

  async continueGame() {
    const data = storage.read(SAVE_KEY);
    if (!data || data.version !== SAVE_VERSION) {
      this.ui.reportError('No readable save was found.');
      this.returnToTitle();
      return;
    }
    try {
      this.player = Player.deserialize(data.player);
    } catch (err) {
      console.error('[game] save load failed', err);
      this.ui.reportError('Your save could not be read. Begin a new life.');
      this.returnToTitle();
      return;
    }
    this.pendingEnding = null;
    this.updateCameraZoom();
    const abandoned = data.inMission && MISSION_BY_ID[data.inMission];
    if (abandoned) {
      this.ui.hideScreens();
      this.state = 'briefing';
      await this.missions.applyFailure(abandoned, 'abandoned', true);
      this.save();
      if (this.pendingEnding) {
        this.gameOver(this.pendingEnding);
        return;
      }
    }
    this.enterHub();
  }

  enterHub() {
    this.state = 'hub';
    this.activeMissionId = null;
    this.ui.setHUDVisible(false);
    if (this.player) this.player.resetRuntime(0, 0);
    this.ui.renderHub();
    this.ui.showScreen('hub');
  }

  async startMission(id) {
    this.ui.hideScreens();
    this.state = 'briefing';
    try {
      await this.missions.start(id);
    } catch (err) {
      console.error('[game] mission start failed', err);
      this.ui.reportError('The mission could not begin.');
      this.enterHub();
    }
  }

  markMissionStarted(id) {
    this.activeMissionId = id;
    this.save();
  }

  enterMission() {
    this.state = 'mission';
    this.input.reset();
    this.ui.hideScreens();
    this.ui.setHUDVisible(true);
  }

  freezeMission() {
    this.state = 'resolving';
    this.weaver.clearThreads();
  }

  finishMission() {
    this.activeMissionId = null;
    if (this.pendingEnding) {
      this.gameOver(this.pendingEnding);
      return;
    }
    this.save();
    this.enterHub();
  }

  pause() {
    if (this.state !== 'mission') return;
    this.state = 'paused';
    this.input.reset();
    this.ui.showScreen('pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'mission';
    this.ui.hideScreens();
  }

  async abandonMission() {
    if (this.state !== 'paused' || !this.missions.active) return;
    this.ui.hideScreens();
    const [confirm] = await this.dialogue([
      {
        speaker: 'Abandon the mission?',
        tone: 'danger',
        text: 'Walking away counts as failure, with every consequence that carries.',
        choices: [{ label: 'Stay and fight.', value: false }, { label: 'Abandon it.', value: true }],
      },
    ]);
    if (!confirm) {
      this.state = 'mission';
      return;
    }
    this.state = 'mission';
    this.missions.resolve(false, 'abandoned');
  }

  gameOver(kind) {
    this.missions.abort();
    this.state = 'gameover';
    this.activeMissionId = null;
    storage.remove(SAVE_KEY);
    this.ui.setHUDVisible(false);
    this.ui.showGameOver(kind, this.player);
  }

  save() {
    if (!this.player) return;
    const ok = storage.write(SAVE_KEY, {
      version: SAVE_VERSION,
      savedAt: new Date().toISOString(),
      inMission: this.activeMissionId,
      player: this.player.serialize(),
    });
    if (!ok) this.ui.reportError('Progress could not be saved in this browser.');
  }

  dialogue(nodes) {
    return this.ui.dialogue(nodes);
  }

  // -- arena ------------------------------------------------------------------------

  loadArena(built, { keepVitals = false } = {}) {
    if (!built?.map || !built.spawn) throw new Error('Arena is missing a map or spawn point.');
    this.map = built.map;
    this.enemies.clear();
    this.allies.clear();
    this.effects.clear();
    const p = this.player;
    if (keepVitals) {
      const { health, power } = p;
      const danger = this.weaver.channel.danger;
      this.weaver.reset();
      this.weaver.channel.danger = danger;
      p.x = built.spawn.x;
      p.y = built.spawn.y;
      p.health = health;
      p.power = power;
      p.stun = 0;
      p.root = 0;
    } else {
      this.weaver.reset();
      p.resetRuntime(built.spawn.x, built.spawn.y);
    }
    this.camera.x = p.x;
    this.camera.y = p.y;
    this.updateCameraZoom();
    this.map.explore(p.x, p.y, p.visionRadius);
    if (p.mod('revealMap', false)) {
      const found = this.revealHidden();
      if (found) this.ui.toast(`Eyes and Ears: ${found} secret route${found > 1 ? 's' : ''} revealed.`, 'good');
    }
  }

  /** Reveals the whole map, every secret passage and every trap (Blue Ajah, Seeing-Lens). */
  revealHidden() {
    this.map.exploreAll();
    const found = this.map.revealAllSecrets();
    for (const trap of this.missions.run?.traps ?? []) trap.revealed = true;
    for (const e of this.enemies.list) e.revealed = true;
    return found;
  }

  // -- player harm and burnout ----------------------------------------------------------

  damagePlayer(amount, source, opts = {}) {
    const p = this.player;
    if (!p || p.downed || this.state !== 'mission') return;
    if (opts.stun) p.stun = Math.max(p.stun, opts.stun);
    if (opts.root) p.root = Math.max(p.root, opts.root);
    if (p.invuln > 0) return;
    let dmg = amount * p.damageTakenMult;
    const shield = p.buffs.shield;
    if (shield.amount > 0) {
      const absorbed = Math.min(shield.amount, dmg);
      shield.amount -= absorbed;
      dmg -= absorbed;
      this.effects.ring(p.x, p.y, 26, '#bfe6ff', 0.3, 2);
      if (dmg <= 0) {
        this.effects.text(p.x, p.y - 26, 'Absorbed', '#bfe6ff', 11);
        return;
      }
    }
    p.health -= dmg;
    p.invuln = 0.35;
    p.flash = 0.15;
    this.effects.text(p.x, p.y - 22, `-${Math.round(dmg)}`, '#ff6b6b', 14);
    this.effects.shake(Math.min(8, 2 + dmg * 0.2), 0.18);
    if (this.weaver.threads.length && this.rng.chance(0.35)) this.weaver.disrupt();
    if (p.health <= 0) this.downPlayer(source?.name ?? 'the Shadow');
  }

  /** Self-inflicted harm (overdraw, backlash, traps, burnout). Ignores shields and invulnerability. */
  harmPlayer(amount, message) {
    const p = this.player;
    if (!p || p.downed || this.state !== 'mission') return;
    p.health -= amount;
    p.flash = 0.2;
    this.effects.text(p.x, p.y - 22, `-${Math.round(amount)}`, '#ff9a5a', 14);
    if (message) this.ui.toast(message, 'danger');
    if (p.health <= 0) this.downPlayer('your own channeling');
  }

  downPlayer(cause) {
    const p = this.player;
    p.health = 0;
    p.downed = true;
    this.weaver.clearThreads();
    this.effects.shake(10, 0.5);
    this.ui.toast(`You fall, struck down by ${cause}.`, 'danger');
    this.events.emit('playerDowned', cause);
  }

  async handleBurnout(cause) {
    const p = this.player;
    if (this.burnoutActive || !p || this.state !== 'mission') return;
    this.burnoutActive = true;
    try {
      p.burnouts += 1;
      this.weaver.clearThreads();
      this.weaver.channel.danger = p.dangerProfile.max * 0.45;
      p.channelLock = 10;
      p.applyScar('saidar_burn');
      this.effects.burst(p.x, p.y, '#ffffff', 60, 320, 1, 5);
      this.effects.ring(p.x, p.y, 200, '#ffffff', 0.8, 8);
      this.effects.shake(18, 0.9);
      this.save();
      if (p.stilled) {
        p.addChronicle('Burned out a third time, and was stilled.', 'shadow');
        await this.dialogue([
          { speaker: 'Burnout', tone: 'danger', text: cause === 'surge' ? 'The flows surge without warning, and this time there is no end to it. Saidar pours through you, and then it is gone.' : 'You reach for more than you can hold, one time too many. The One Power fills you to bursting, and then it is gone.' },
        ]);
        this.gameOver('stilled');
        return;
      }
      const remaining = Player.MAX_BURNOUTS - p.burnouts;
      await this.dialogue([
        {
          speaker: 'Burnout',
          tone: 'danger',
          text: `${cause === 'surge' ? 'Without warning the flows surge past your control.' : 'You draw past the limit of what you can bear.'} Saidar roars through you like a river through a broken dam, and something inside you scorches. When it passes, the Source is a distant glow you cannot reach.`,
        },
        {
          speaker: 'Consequences',
          tone: 'danger',
          text: `Permanent: Saidar Burn (-1 Strength, -1 Reserve). You cannot channel for 10 seconds.\n${remaining === 1 ? 'One more burnout and you will be stilled, cut off from the Source forever.' : `${remaining} more burnouts and you will be stilled.`}`,
        },
      ]);
      this.events.emit('burnout', cause);
      this.harmPlayer(p.maxHealth * 0.25, null);
      this.save();
    } finally {
      this.burnoutActive = false;
    }
  }

  onForbiddenWeave(weave) {
    const p = this.player;
    p.prestige -= 6;
    if (!p.flags.wovebalefire) {
      p.flags.wovebalefire = true;
      p.addChronicle(`Wove ${weave.name}, forbidden by the Tower.`, 'shadow');
    }
    this.ui.toast(`You have woven ${weave.name}. If the Hall learns of it... (-6 prestige)`, 'danger');
  }

  // -- loop ----------------------------------------------------------------------------

  frame(now) {
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= STEP && steps < MAX_STEPS_PER_FRAME) {
      this.safely('update', () => this.update(STEP));
      this.accumulator -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    this.safely('render', () => this.render());
    requestAnimationFrame((t) => this.frame(t));
  }

  /** Runs a subsystem step; a thrown error is reported once and never stops the loop. */
  safely(label, fn) {
    try {
      fn();
    } catch (err) {
      this.errorCount++;
      console.error(`[game] ${label} failed`, err);
      this.ui.reportError(`A ${label} error was contained: ${err.message}`);
    }
  }

  update(dt) {
    this.time += dt;
    if (this.state === 'mission' && !this.ui.dialogueOpen && this.player) {
      const p = this.player;
      this.updateMouseWorld();
      p.update(dt, this.input, this.map);
      this.weaver.update(dt);
      this.enemies.update(dt);
      this.allies.update(dt);
      this.missions.update(dt);
      this.exploreTimer -= dt;
      if (this.exploreTimer <= 0) {
        this.exploreTimer = 0.2;
        this.map.explore(p.x, p.y, p.visionRadius);
      }
      this.updateCamera(dt);
    }
    if (this.state !== 'paused' && !this.ui.dialogueOpen) this.effects.update(dt);
    if (!this.ui.el.hud.hidden) this.ui.updateHUD(dt);
  }

  updateCamera(dt) {
    const p = this.player;
    const cam = this.camera;
    const t = 1 - Math.exp(-8 * dt);
    cam.x += (p.x - cam.x) * t;
    cam.y += (p.y - cam.y) * t;
    const halfW = cam.viewW / 2;
    const halfH = cam.viewH / 2;
    cam.x = this.map.width <= cam.viewW ? this.map.width / 2 : clamp(cam.x, halfW, this.map.width - halfW);
    cam.y = this.map.height <= cam.viewH ? this.map.height / 2 : clamp(cam.y, halfH, this.map.height - halfH);
  }

  render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const hgt = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const inWorld = this.player && ['mission', 'paused', 'resolving'].includes(this.state);
    if (!inWorld) {
      this.renderAmbient(ctx, w, hgt);
      return;
    }
    ctx.fillStyle = this.map.background;
    ctx.fillRect(0, 0, w, hgt);
    const cam = this.camera;
    const shake = this.effects.shakeOffset();
    const left = cam.x - cam.viewW / 2 + shake.x;
    const top = cam.y - cam.viewH / 2 + shake.y;
    const scale = this.dpr * cam.zoom;
    ctx.setTransform(scale, 0, 0, scale, -left * scale, -top * scale);
    const time = this.time;
    this.map.render(ctx, { x: left, y: top, w: cam.viewW, h: cam.viewH });
    this.allies.renderUnder(ctx, time);
    this.missions.render(ctx, time);
    this.weaver.renderUnder(ctx, time);
    this.enemies.render(ctx, time);
    this.allies.render(ctx, time);
    this.player.render(ctx, time, this.weaver.threads.map((id) => ELEMENT_COLORS[id]));
    this.weaver.render(ctx, time);
    this.effects.render(ctx);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.renderOverlays(ctx, w / this.dpr, hgt / this.dpr);
  }

  renderOverlays(ctx, w, hgt) {
    const p = this.player;
    const ch = this.weaver.channel;
    const ratio = ch.danger / p.dangerProfile.max;
    const state = ch.state.id;
    if (ratio > 0.3) {
      const pulse = state === 'critical' ? 0.5 + Math.sin(this.time * 9) * 0.25 : 0.35;
      const g = ctx.createRadialGradient(w / 2, hgt / 2, Math.min(w, hgt) * 0.3, w / 2, hgt / 2, Math.max(w, hgt) * 0.75);
      const color = state === 'critical' ? '255,40,40' : state === 'volatile' ? '200,60,255' : '255,220,140';
      g.addColorStop(0, `rgba(${color},0)`);
      g.addColorStop(1, `rgba(${color},${(ratio * pulse).toFixed(3)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, hgt);
    }
    if (p.health / p.maxHealth < 0.3 && !p.downed) {
      ctx.fillStyle = `rgba(120,0,0,${0.12 + Math.sin(this.time * 4) * 0.06})`;
      ctx.fillRect(0, 0, w, hgt);
    }
    if (p.channelLock > 0) {
      ctx.fillStyle = 'rgba(20,20,30,0.25)';
      ctx.fillRect(0, 0, w, hgt);
    }
    const m = this.input.mouse;
    if (m.inside && this.state === 'mission') {
      const colors = this.weaver.threads.map((id) => ELEMENT_COLORS[id]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = colors[0] ?? 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.arc(m.x, m.y, 9, 0, Math.PI * 2);
      ctx.stroke();
      colors.forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(m.x + (i - (colors.length - 1) / 2) * 8, m.y + 16, 3, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }

  /** Title and hub backdrop: the White Tower under a night sky. */
  renderAmbient(ctx, w, hgt) {
    const g = ctx.createLinearGradient(0, 0, 0, hgt);
    g.addColorStop(0, '#0b0a16');
    g.addColorStop(1, '#1d1626');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, hgt);
    for (const mote of this.motes) {
      const x = ((mote.x + this.time * 0.004 * mote.s) % 1) * w;
      const y = ((mote.y - this.time * 0.01 * mote.s + 1) % 1) * hgt;
      ctx.fillStyle = `rgba(255,246,216,${0.2 + mote.s * 0.5})`;
      ctx.fillRect(x, y, 2 * this.dpr * mote.s, 2 * this.dpr * mote.s);
    }
    const tw = Math.min(w, hgt) * 0.09;
    const tx = w * 0.72;
    ctx.fillStyle = 'rgba(232,228,218,0.9)';
    ctx.beginPath();
    ctx.moveTo(tx - tw, hgt);
    ctx.lineTo(tx - tw * 0.7, hgt * 0.22);
    ctx.lineTo(tx, hgt * 0.12);
    ctx.lineTo(tx + tw * 0.7, hgt * 0.22);
    ctx.lineTo(tx + tw, hgt);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,240,190,0.5)';
    for (let i = 0; i < 9; i++) ctx.fillRect(tx - tw * 0.15, hgt * (0.3 + i * 0.07), tw * 0.3, hgt * 0.015);
  }
}

// Expose nothing globally; the single game instance lives in this module.
const game = new Game();
export default game;

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => game.init());
else game.init();
