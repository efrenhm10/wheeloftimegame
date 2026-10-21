// Mission engine: requirements, briefing → setup → objectives → resolution, plus every mission
// in the campaign (core storyline, repeatable patrols, trials and the seven Ajah-specific missions).

import { clamp, dist, RNG } from './util.js';
import { T, TILE, TileMap } from './world.js';
import { AJAHS, Player, RANKS, SCARS } from './player.js';
import { ELEMENTS, TER_ANGREAL, WEAVES } from './magic.js';

const at = (c, r) => ({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 });
const rankIndexOf = (id) => RANKS.findIndex((r) => r.id === id);
const ELEMENT_NAMES = ELEMENTS.map((e) => e.name);

// ---------------------------------------------------------------------------
// MissionRun: the live state of one undertaken mission
// ---------------------------------------------------------------------------

export class MissionRun {
  constructor(engine, def) {
    this.engine = engine;
    this.game = engine.game;
    this.def = def;
    this.state = 'running';
    this.time = 0;
    this.objectives = [];
    this.zones = [];
    this.pickups = [];
    this.traps = [];
    this.timers = [];
    this.handlers = new Map();
    this.renderers = [];
    this.flags = {};
    this.timeLimit = null;
    this.onTimeout = null;
    this.rng = new RNG();
    this.reachable = null;
    this.stats = { kills: 0, captures: 0, weaves: 0, overRank: 0 };
    const p = this.game.player;
    this.scale = 1 + (p.level - 1) * 0.07 + p.rankIndex * 0.1;
  }

  get active() {
    return this.state === 'running';
  }

  get player() {
    return this.game.player;
  }

  get map() {
    return this.game.map;
  }

  get enemies() {
    return this.game.enemies;
  }

  get allies() {
    return this.game.allies;
  }

  // -- arena -----------------------------------------------------------------

  useMap(built, options = {}) {
    this.zones = [];
    this.pickups = [];
    this.traps = [];
    this.game.loadArena(built, options);
    this.reachable = this.map.reachableFrom(built.spawn.x, built.spawn.y);
  }

  /** A random reachable open tile, optionally far from the player and other points. */
  randomOpen({ minFromPlayer = 0, avoid = [], minSpacing = 0, region = null, attempts = 400 } = {}) {
    const map = this.map;
    for (let i = 0; i < attempts; i++) {
      const c = region ? this.rng.int(region.c0, region.c1) : this.rng.int(1, map.cols - 2);
      const r = region ? this.rng.int(region.r0, region.r1) : this.rng.int(1, map.rows - 2);
      if (map.isSolidTile(c, r) || (this.reachable && !this.reachable[r * map.cols + c])) continue;
      const pos = at(c, r);
      if (map.collidesCircle(pos.x, pos.y, 14)) continue;
      if (dist(pos.x, pos.y, this.player.x, this.player.y) < minFromPlayer) continue;
      if (avoid.some((a) => dist(pos.x, pos.y, a.x, a.y) < minSpacing)) continue;
      return pos;
    }
    return { x: this.player.x + 120, y: this.player.y };
  }

  // -- objectives --------------------------------------------------------------

  objective({ id, label, target = 1, optional = false, hidden = false, reward = null, counter = false }) {
    const obj = { id, label, target, current: 0, done: false, failed: false, optional, hidden, reward, counter };
    this.objectives.push(obj);
    return obj;
  }

  obj(id) {
    return this.objectives.find((o) => o.id === id) ?? null;
  }

  reveal(id) {
    const o = this.obj(id);
    if (o) o.hidden = false;
  }

  progress(id, amount = 1) {
    const o = this.obj(id);
    if (!o || o.done || o.failed) return o;
    o.current = Math.min(o.target, o.current + amount);
    if (!o.counter && o.current >= o.target) this.complete(id);
    return o;
  }

  setProgress(id, value) {
    const o = this.obj(id);
    if (o) o.current = value;
  }

  complete(id) {
    const o = this.obj(id);
    if (!o || o.done) return;
    o.done = true;
    o.current = o.target;
    o.hidden = false;
    if (!o.optional) this.game.ui.toast(`Objective complete: ${o.label}`, 'good');
    this.emit('objectiveComplete', o);
  }

  failObjective(id) {
    const o = this.obj(id);
    if (!o || o.done || o.failed) return;
    o.failed = true;
    if (o.optional) this.game.ui.toast(`Lost: ${o.label}`, 'warn');
  }

  // -- scheduling and events ---------------------------------------------------

  after(seconds, fn) {
    this.timers.push({ t: seconds, fn, every: 0 });
  }

  every(seconds, fn) {
    this.timers.push({ t: seconds, fn, every: seconds });
  }

  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(fn);
  }

  emit(event, ...args) {
    if (!this.active) return;
    for (const fn of this.handlers.get(event) ?? []) {
      try {
        const result = fn(...args);
        if (result && typeof result.catch === 'function') result.catch((err) => this.reportError(err));
      } catch (err) {
        this.reportError(err);
      }
    }
  }

  reportError(err) {
    console.error(`[mission:${this.def.id}]`, err);
    this.game.ui.reportError('A mission script faltered; the Pattern adjusts.');
  }

  setTimeLimit(seconds, onTimeout) {
    this.timeLimit = seconds;
    this.onTimeout = onTimeout;
  }

  addRenderer(fn) {
    this.renderers.push(fn);
  }

  // -- world helpers -----------------------------------------------------------

  zone(z) {
    const zone = { active: true, visible: true, once: true, triggered: false, color: '#e8e2d0', radius: 40, ...z };
    this.zones.push(zone);
    return zone;
  }

  pickup(p) {
    const pickup = { collected: false, color: '#d9b26a', ...p };
    this.pickups.push(pickup);
    return pickup;
  }

  /** Hidden glyph trap. Only Blue sisters (and a Seeing-Lens) see them before they spring. */
  trap(t) {
    const trap = { radius: 20, damage: 12, danger: 15, root: 1.2, revealed: false, armed: true, ...t };
    this.traps.push(trap);
    return trap;
  }

  /** Places a ter'angreal the player does not yet own. Brown sisters attune; others send it to the archives. */
  artifactPickup(pos, preferred) {
    const owned = new Set(this.player.artifacts);
    const options = Object.keys(TER_ANGREAL).filter((id) => !owned.has(id));
    const artifactId = preferred && !owned.has(preferred) ? preferred : options.length ? this.rng.pick(options) : null;
    if (!artifactId) return null;
    return this.pickup({
      id: `artifact_${artifactId}`,
      kind: 'artifact',
      label: 'Ter\'angreal',
      artifactId,
      ...pos,
      onCollect: (run) => run.engine.claimArtifact(artifactId),
    });
  }

  spawn(type, x, y, opts = {}) {
    return this.enemies.spawn(type, x, y, { scale: this.scale, ...opts });
  }

  group(type, count, x, y, spread = 40, opts = {}) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const a = (i / Math.max(1, count)) * Math.PI * 2 + this.rng.range(-0.3, 0.3);
      out.push(this.spawn(type, x + Math.cos(a) * spread, y + Math.sin(a) * spread, opts));
    }
    return out;
  }

  hostilesRemaining(predicate = () => true) {
    return this.enemies.list.filter((e) => e.countsAsHostile && predicate(e)).length;
  }

  toast(text, tone = 'info') {
    this.game.ui.toast(text, tone);
  }

  async say(nodes) {
    if (!this.active) return [];
    return this.game.dialogue(nodes);
  }

  async ask(node) {
    if (!this.active) return null;
    const [choice] = await this.game.dialogue([node]);
    return choice;
  }

  succeed() {
    this.engine.resolve(true);
  }

  fail(reason) {
    this.engine.resolve(false, reason);
  }

  // -- simulation ----------------------------------------------------------------

  update(dt) {
    if (!this.active) return;
    this.time += dt;
    const p = this.player;
    for (const t of this.timers) {
      if (t.done) continue;
      t.t -= dt;
      if (t.t <= 0) {
        try {
          const result = t.fn(this);
          if (result && typeof result.catch === 'function') result.catch((err) => this.reportError(err));
        } catch (err) {
          this.reportError(err);
        }
        if (t.every > 0) t.t += t.every;
        else t.done = true;
      }
      if (!this.active) return;
    }
    this.timers = this.timers.filter((t) => !t.done);

    for (const z of this.zones) {
      if (!z.active || (z.once && z.triggered)) continue;
      if (dist(p.x, p.y, z.x, z.y) <= z.radius) {
        z.triggered = true;
        if (z.onEnter) {
          try {
            const result = z.onEnter(this, z);
            if (result && typeof result.catch === 'function') result.catch((err) => this.reportError(err));
          } catch (err) {
            this.reportError(err);
          }
        }
        if (!this.active) return;
      }
    }

    for (const pk of this.pickups) {
      if (pk.collected || dist(p.x, p.y, pk.x, pk.y) > p.radius + 14) continue;
      pk.collected = true;
      this.game.effects.burst(pk.x, pk.y, pk.color, 14, 100, 0.5, 3);
      try {
        pk.onCollect?.(this, pk);
      } catch (err) {
        this.reportError(err);
      }
      this.emit('pickup', pk);
      if (!this.active) return;
    }

    for (const trap of this.traps) {
      if (!trap.armed || dist(p.x, p.y, trap.x, trap.y) > trap.radius + p.radius * 0.5) continue;
      trap.armed = false;
      trap.revealed = true;
      this.game.effects.ring(trap.x, trap.y, trap.radius * 2.5, '#ff4b4b', 0.6, 4);
      this.game.harmPlayer(trap.damage, 'A hidden glyph-trap bursts beneath you!');
      p.root = Math.max(p.root, trap.root);
      this.game.weaver.channel.add(trap.danger);
      this.game.weaver.resolveDanger();
      this.emit('trapSprung', trap);
    }

    if (this.timeLimit !== null) {
      this.timeLimit -= dt;
      if (this.timeLimit <= 0) {
        this.timeLimit = 0;
        const fn = this.onTimeout;
        this.onTimeout = null;
        this.timeLimit = null;
        try {
          fn?.(this);
        } catch (err) {
          this.reportError(err);
        }
      }
    }
    this.emit('update', dt);
  }

  render(ctx, time) {
    const p = this.player;
    for (const z of this.zones) {
      if (!z.visible || !z.active || (z.once && z.triggered)) continue;
      ctx.save();
      ctx.globalAlpha = 0.18 + Math.sin(time * 3) * 0.06;
      ctx.fillStyle = z.color;
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = z.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      if (z.arch) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#dfe6ee';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(z.x, z.y + 6, 24, Math.PI, 0);
        ctx.stroke();
      }
      if (z.label) {
        ctx.globalAlpha = 1;
        ctx.font = '600 12px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#f5efe0';
        ctx.fillText(z.label, z.x, z.y - z.radius - 6);
      }
      ctx.restore();
    }
    for (const pk of this.pickups) {
      if (pk.collected) continue;
      const bob = Math.sin(time * 3 + pk.x) * 3;
      ctx.save();
      ctx.translate(pk.x, pk.y + bob);
      ctx.fillStyle = 'rgba(255,240,200,0.18)';
      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, Math.PI * 2);
      ctx.fill();
      if (pk.kind === 'artifact') {
        ctx.rotate(time);
        ctx.fillStyle = '#e8c35a';
        ctx.beginPath();
        ctx.moveTo(0, -9);
        ctx.lineTo(8, 0);
        ctx.lineTo(0, 9);
        ctx.lineTo(-8, 0);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#fff6d0';
        ctx.fillRect(-2, -2, 4, 4);
      } else if (pk.kind === 'letter') {
        ctx.fillStyle = '#f2ecd8';
        ctx.fillRect(-8, -6, 16, 12);
        ctx.strokeStyle = '#a5341f';
        ctx.beginPath();
        ctx.moveTo(-8, -6);
        ctx.lineTo(0, 1);
        ctx.lineTo(8, -6);
        ctx.stroke();
      } else {
        ctx.fillStyle = pk.color;
        ctx.fillRect(-7, -9, 14, 18);
        ctx.fillStyle = '#e8d8b0';
        ctx.fillRect(-5, -7, 10, 14);
      }
      ctx.restore();
    }
    for (const trap of this.traps) {
      if (!trap.revealed && !p.seesHidden) continue;
      ctx.save();
      ctx.globalAlpha = trap.armed ? 0.75 : 0.3;
      ctx.strokeStyle = '#ff4b4b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(trap.x, trap.y, trap.radius, 0, Math.PI * 2);
      ctx.moveTo(trap.x - trap.radius * 0.6, trap.y);
      ctx.lineTo(trap.x + trap.radius * 0.6, trap.y);
      ctx.moveTo(trap.x, trap.y - trap.radius * 0.6);
      ctx.lineTo(trap.x, trap.y + trap.radius * 0.6);
      ctx.stroke();
      ctx.restore();
    }
    for (const fn of this.renderers) {
      try {
        fn(ctx, time);
      } catch (err) {
        console.error('[mission] renderer failed', err);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Map builders
// ---------------------------------------------------------------------------

function buildGardens() {
  const m = new TileMap(48, 30, T.GRASS, 11);
  m.outline(0, 0, 48, 30, T.WALL);
  m.rect(1, 1, 3, 28, T.WALL);
  m.set(3, 14, T.DOOR);
  m.set(3, 15, T.DOOR);
  m.rect(41, 1, 6, 28, T.DIRT);
  m.rect(40, 1, 1, 28, T.WALL);
  m.rect(4, 14, 36, 2, T.PATH);
  m.rect(21, 1, 2, 28, T.PATH);
  m.rect(18, 11, 8, 8, T.MARBLE);
  m.rect(20, 13, 4, 4, T.WATER);
  for (const [c, r, w, h] of [[7, 5, 9, 2], [7, 23, 9, 2], [27, 5, 9, 2], [27, 23, 9, 2], [10, 9, 2, 3], [10, 18, 2, 3], [31, 9, 2, 3], [31, 18, 2, 3]]) {
    m.rect(c, r, w, h, T.HEDGE);
  }
  return { map: m, spawn: { x: 9 * TILE, y: 15 * TILE } };
}

function buildPracticeYard() {
  const m = new TileMap(30, 22, T.MARBLE, 23);
  m.outline(0, 0, 30, 22, T.WALL);
  for (const [c, r] of [[7, 6], [21, 6], [7, 14], [21, 14]]) m.rect(c, r, 2, 2, T.PILLAR);
  m.rect(12, 9, 6, 4, T.CARPET);
  return { map: m, spawn: at(15, 11) };
}

function buildArches() {
  const m = new TileMap(46, 16, T.MARBLE, 31);
  m.outline(0, 0, 46, 16, T.WALL);
  m.rect(15, 1, 1, 14, T.WALL);
  m.rect(30, 1, 1, 14, T.WALL);
  m.rect(1, 7, 14, 2, T.CARPET);
  m.rect(16, 7, 14, 2, T.CARPET);
  m.rect(31, 7, 14, 2, T.CARPET);
  return { map: m, spawn: at(3, 8) };
}

function buildOuterGrounds(rng) {
  const m = new TileMap(60, 40, T.GRASS, rng.int(1, 9999));
  m.outline(0, 0, 60, 40, T.WALL);
  m.rect(1, 1, 2, 38, T.MARBLE);
  for (const [c, r] of [[50, 8], [52, 30], [34, 34]]) m.rect(c - 4, r - 3, 9, 7, T.BLIGHT);
  for (let i = 0; i < 26; i++) {
    const c = rng.int(8, 56);
    const r = rng.int(3, 36);
    const horizontal = rng.chance(0.5);
    const len = rng.int(2, 5);
    for (let k = 0; k < len; k++) {
      const cc = horizontal ? c + k : c;
      const rr = horizontal ? r : r + k;
      if (cc < 57 && rr < 38) m.set(cc, rr, rng.chance(0.75) ? T.WALL : T.RUBBLE);
    }
  }
  // A collapsed guardhouse with a hollow wall hiding an old artifact.
  m.outline(27, 3, 6, 5, T.WALL);
  m.rect(28, 4, 4, 3, T.FLOOR);
  m.set(29, 7, T.SECRET);
  // Keep the spawn, rifts and commander's ground clear of debris.
  for (const [c, r] of [[5, 20], [50, 8], [52, 30], [34, 34], [44, 20]]) {
    for (let y = r - 2; y <= r + 2; y++) for (let x = c - 2; x <= c + 2; x++) if (m.isSolidTile(x, y) && m.inBounds(x, y) && x > 0 && y > 0 && x < 59 && y < 39) m.set(x, y, T.RUBBLE);
  }
  return { map: m, spawn: at(5, 20) };
}

function buildLibrary() {
  const m = new TileMap(50, 34, T.CARPET, 41);
  m.outline(0, 0, 50, 34, T.WALL);
  for (const r of [5, 11, 17, 23, 29]) {
    m.rect(3, r, 44, 2, T.SHELF);
    for (const gap of [12, 24, 36]) m.rect(gap, r, 2, 2, T.CARPET);
  }
  m.rect(43, 1, 1, 4, T.WALL);
  m.rect(44, 4, 5, 1, T.WALL);
  m.set(43, 2, T.SECRET);
  m.rect(44, 1, 5, 3, T.MARBLE);
  return { map: m, spawn: at(3, 2) };
}

function buildShawlHall() {
  const m = new TileMap(36, 26, T.MARBLE, 53);
  m.outline(0, 0, 36, 26, T.WALL);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    m.set(Math.round(18 + Math.cos(a) * 11), Math.round(13 + Math.sin(a) * 8), T.PILLAR);
  }
  for (let r = 9; r <= 17; r++) for (let c = 13; c <= 23; c++) if ((c - 18) ** 2 / 25 + (r - 13) ** 2 / 16 <= 1) m.set(c, r, T.CARPET);
  return { map: m, spawn: at(18, 13) };
}

function buildPatrol(rng) {
  const m = new TileMap(44, 32, T.GRASS, rng.int(1, 9999));
  m.outline(0, 0, 44, 32, T.WALL);
  m.rect(1, 15, 42, 2, T.PATH);
  m.rect(21, 1, 2, 30, T.PATH);
  for (let i = 0; i < 34; i++) {
    const c = rng.int(2, 40);
    const r = rng.int(2, 28);
    if (Math.abs(c - 5) < 4 && Math.abs(r - 16) < 4) continue;
    const kind = rng.chance(0.6) ? T.HEDGE : T.PILLAR;
    m.rect(c, r, kind === T.PILLAR ? 1 : rng.int(2, 3), kind === T.PILLAR ? 1 : rng.int(1, 2), kind);
  }
  return { map: m, spawn: at(5, 16) };
}

function buildBorderland(rng) {
  const m = new TileMap(46, 32, T.DIRT, rng.int(1, 9999));
  m.outline(0, 0, 46, 32, T.WALL);
  for (let i = 0; i < 70; i++) m.set(rng.int(1, 44), rng.int(1, 30), T.BLIGHT);
  for (let i = 0; i < 22; i++) {
    const c = rng.int(3, 42);
    const r = rng.int(3, 28);
    if (Math.abs(c - 4) < 4 && Math.abs(r - 16) < 4) continue;
    const w = rng.int(1, 3);
    const h = rng.int(1, 3);
    m.rect(c, r, w, h, rng.chance(0.7) ? T.WALL : T.PILLAR);
    if (rng.chance(0.5)) m.rect(c - 1, r + h, w + 2, 1, T.RUBBLE);
  }
  return { map: m, spawn: at(4, 16) };
}

function buildCourtyard(seed) {
  const m = new TileMap(52, 36, T.FLOOR, seed);
  m.outline(0, 0, 52, 36, T.WALL);
  for (let r = 5; r < 32; r += 6) for (let c = 8; c < 48; c += 8) m.set(c, r, T.PILLAR);
  for (const [c, r] of [[14, 10], [30, 22], [40, 8], [22, 28]]) m.rect(c, r, 3, 2, T.RUBBLE);
  m.rect(1, 16, 6, 4, T.MARBLE);
  return { map: m, spawn: at(3, 18) };
}

function buildBlightborder() {
  const m = new TileMap(50, 34, T.BLIGHT, 61);
  m.outline(0, 0, 50, 34, T.WALL);
  m.rect(19, 12, 12, 10, T.DIRT);
  // Palisade around the watchtower with four gaps.
  m.outline(20, 13, 10, 8, T.WALL);
  for (const [c, r] of [[24, 13], [25, 13], [24, 20], [25, 20], [20, 16], [20, 17], [29, 16], [29, 17]]) m.set(c, r, T.DIRT);
  m.rect(24, 16, 2, 2, T.PILLAR);
  return { map: m, spawn: at(22, 17) };
}

function buildFerry() {
  const m = new TileMap(46, 30, T.GRASS, 71);
  m.outline(0, 0, 46, 30, T.WALL);
  m.rect(1, 13, 44, 4, T.WATER);
  m.rect(20, 13, 6, 4, T.WOOD);
  m.rect(8, 2, 2, 9, T.PATH);
  m.rect(36, 19, 2, 9, T.PATH);
  for (const [c, r] of [[4, 5], [14, 8], [30, 4], [40, 9], [6, 22], [16, 25], [28, 21]]) m.rect(c, r, 2, 2, T.HEDGE);
  return { map: m, spawn: at(22, 11) };
}

function buildManor() {
  const m = new TileMap(48, 34, T.WOOD, 83);
  m.outline(0, 0, 48, 34, T.WALL);
  m.rect(1, 24, 46, 9, T.GRASS);
  m.rect(1, 12, 46, 3, T.CARPET);
  // North rooms.
  m.rect(1, 11, 46, 1, T.WALL);
  for (const c of [8, 20, 32, 42]) m.set(c, 11, T.WOOD);
  for (const c of [14, 26, 38]) m.rect(c, 1, 1, 10, T.WALL);
  m.rect(39, 1, 8, 10, T.CARPET);
  // South rooms.
  m.rect(1, 15, 46, 1, T.WALL);
  for (const c of [10, 30]) m.set(c, 15, T.WOOD);
  m.rect(1, 23, 46, 1, T.WALL);
  for (const c of [6, 40]) m.set(c, 23, T.GRASS);
  m.rect(24, 16, 1, 7, T.WALL);
  // Hidden servants' passages known only to the Tower's eyes-and-ears.
  for (const [c, r] of [[14, 5], [38, 5], [24, 19], [20, 23]]) m.set(c, r, T.SECRET);
  for (const [c, r] of [[30, 27], [12, 28], [36, 29]]) m.rect(c, r, 2, 1, T.HEDGE);
  return { map: m, spawn: at(3, 30) };
}

function buildRuins() {
  const m = new TileMap(50, 36, T.FLOOR, 97);
  m.outline(0, 0, 50, 36, T.WALL);
  // 4 x 3 grid of chambers.
  for (const c of [12, 24, 36]) m.rect(c, 1, 1, 34, T.WALL);
  for (const r of [12, 24]) m.rect(1, r, 48, 1, T.WALL);
  const openings = [[6, 12], [18, 12], [30, 12], [42, 24], [6, 24], [18, 24], [30, 24], [12, 6], [24, 6], [36, 6], [12, 18], [24, 18], [12, 30], [24, 30]];
  for (const [c, r] of openings) m.set(c, r, T.MARBLE);
  // Sealed vault (bottom-right) reachable only through hollow walls.
  m.set(36, 30, T.SECRET);
  m.set(42, 24, T.SECRET);
  m.rect(37, 25, 12, 10, T.MARBLE);
  m.set(36, 18, T.SECRET);
  for (let i = 0; i < 40; i++) {
    const c = 2 + ((i * 7919) % 46);
    const r = 2 + ((i * 104729) % 32);
    if (m.get(c, r) === T.FLOOR) m.set(c, r, T.RUBBLE);
  }
  return { map: m, spawn: at(3, 3) };
}

function buildTruce() {
  const m = new TileMap(48, 32, T.GRASS, 107);
  m.outline(0, 0, 48, 32, T.WALL);
  m.rect(22, 1, 4, 30, T.WATER);
  m.rect(22, 14, 4, 4, T.WOOD);
  m.rect(1, 15, 21, 2, T.PATH);
  m.rect(26, 15, 21, 2, T.PATH);
  for (const [c, r] of [[5, 5], [10, 8], [5, 24], [12, 22], [15, 4]]) m.rect(c, r, 3, 2, T.WALL);
  for (const [c, r] of [[33, 5], [40, 9], [34, 24], [41, 22], [30, 10]]) m.rect(c, r, 3, 2, T.PILLAR);
  return { map: m, spawn: at(4, 16) };
}

function buildWhiteHall() {
  const m = new TileMap(36, 28, T.MARBLE, 113);
  m.outline(0, 0, 36, 28, T.WALL);
  for (const [c, r] of [[9, 7], [26, 7], [9, 20], [26, 20], [17, 4], [17, 23]]) m.rect(c, r, 2, 1, T.PILLAR);
  m.rect(15, 12, 6, 4, T.CARPET);
  return { map: m, spawn: at(18, 24) };
}

// ---------------------------------------------------------------------------
// Shared mission behaviours
// ---------------------------------------------------------------------------

/** Counts kills of real foes (not wards or constructs) toward an objective. */
function countFoes(run, id, filter = () => true) {
  run.on('enemyKilled', (e) => {
    if (e.def.harmless || e.def.invulnerable || !filter(e)) return;
    run.progress(id);
  });
}

function trackStats(run) {
  run.on('enemyKilled', (e, info) => {
    if (info?.captured) run.stats.captures++;
    else run.stats.kills++;
  });
  run.on('weaveCast', (w, info) => {
    run.stats.weaves++;
    if (info.overRank) run.stats.overRank++;
  });
}

const failIfDowned = (run) => run.on('playerDowned', () => run.fail('fallen'));

/** Green Ajah: Warders join; losing one scars the bond. */
function bringWarders(run) {
  const p = run.player;
  if (!p.mod('maxWarders', 0)) return;
  run.allies.spawnWarders(p.warders, p.x, p.y);
  run.on('warderDied', (w) => {
    run.game.weaver.channel.add(35);
    p.stun = Math.max(p.stun, 1.2);
    p.applyScar('bond_severed');
    run.toast(`${w.name} is dead. The bond tears through you like a blade.`, 'danger');
    run.game.weaver.resolveDanger();
    run.failObjective('no_warder_lost');
  });
}

// ---------------------------------------------------------------------------
// Mission definitions
// ---------------------------------------------------------------------------

/**
 * Mission shape:
 *  id, title, type ('combat' | 'academic' | 'trial' | 'stealth' | 'diplomacy' | 'support' | 'roguelite')
 *  chapter, summary, repeatable, retryable
 *  requires: { minRank, maxRank, ajah, success: [], resolved: [], level, prestige }
 *  rewards: object or (run) => object { xp, prestige, stats, learn }
 *  failure: { prestige, strike, scar, text(reason) }
 *  briefing(ctx) → Promise<boolean>   (false aborts without penalty)
 *  setup(run)                         (builds the arena, objectives and scripts)
 *  debrief(run, ctx) → Promise        (ceremonies, choices, promotions)
 */
export const MISSIONS = [
  // ── Chapter I: Novice ──────────────────────────────────────────────────────
  {
    id: 'garden_breach',
    title: 'Shadow in the Gardens',
    type: 'combat',
    chapter: 'Novice',
    summary: 'Your first day in the White Tower. Something is wrong beyond the garden wall.',
    retryable: false,
    requires: { minRank: 'novice', maxRank: 'novice' },
    rewards: { xp: 120, prestige: 15 },
    failure: {
      prestige: -10,
      strike: true,
      scar: 'shadow_touched',
      text: (reason) =>
        reason === 'door'
          ? 'The door to the novice quarters gave way. Three girls died in their beds before the sisters arrived. The Tower will not forget whose watch it was.'
          : 'You fell in the gardens. Sisters pulled you from beneath a Trolloc, and novices died in the time it took them to reach you.',
    },
    async briefing(ctx) {
      await ctx.say([
        { speaker: 'Narrator', tone: 'narration', text: 'Tar Valon. The White Tower rises over the island city like a spear of bone. You came here with nothing but a spark that would not stop burning.' },
        { speaker: 'Mistress of Novices', text: '{name}. You will address Aes Sedai with respect, speak when spoken to, and you will not touch saidar without a sister present. Is that understood?' },
      ]);
      const answer = await ctx.ask({
        speaker: 'Mistress of Novices',
        text: 'Well, child?',
        choices: [
          { label: 'Yes, Mistress.', value: 'humble' },
          { label: 'I already know how to channel.', value: 'proud' },
        ],
      });
      if (answer === 'proud') {
        ctx.player.prestige -= 2;
        ctx.player.flags.proud = true;
        await ctx.say([{ speaker: 'Mistress of Novices', text: 'Then you will learn humility before anything else. The gardens need weeding. Go.' }]);
      } else {
        await ctx.say([{ speaker: 'Mistress of Novices', text: 'Good. The novice gardens need tending. Go, and walk to the fountain; a sister will find you there.' }]);
      }
      return true;
    },
    setup(run) {
      run.useMap(buildGardens());
      trackStats(run);
      failIfDowned(run);
      const door = run.allies.addStructure({ id: 'door', name: 'Novice Quarters', x: 4 * TILE + TILE / 2, y: 15 * TILE, radius: 26, hp: 300 });
      run.objective({ id: 'tend', label: 'Tend the gardens: walk to the fountain' });
      const outside = { x: 44 * TILE, y: 15 * TILE };
      const waves = [
        (r) => {
          r.spawn('trolloc', outside.x, outside.y - 60, { goal: door });
          r.group('trolloc', 3, outside.x, outside.y + 60, 30);
        },
        (r) => {
          r.group('trolloc', 2, outside.x, outside.y, 40, { goal: door });
          r.spawn('trolloc', outside.x, outside.y + 80);
          r.group('darkhound', 3, outside.x, outside.y - 70, 30);
        },
        (r) => {
          // A Novice faces a Fade weakened by the breach itself; still deadly, but survivable.
          const fade = r.spawn('myrddraal', outside.x, outside.y, { label: 'Myrddraal', xp: 90, scale: 0.8, damageScale: 0.8 });
          r.flags.fadeId = fade.id;
          r.group('trolloc', 3, outside.x - 30, outside.y, 40, { linkedTo: fade.id });
          r.reveal('fade');
          r.toast('A Myrddraal glides through the breach. Its Trollocs are linked to it: kill the Fade and they die with it.', 'danger');
        },
      ];
      let waveIndex = -1;
      let waveTime = 0;
      const nextWave = () => {
        waveIndex++;
        waveTime = 0;
        run.setProgress('waves', Math.min(waveIndex + 1, waves.length));
        if (waveIndex < waves.length) waves[waveIndex](run);
      };

      const breach = async () => {
        if (run.flags.breached) return;
        run.flags.breached = true;
        run.complete('tend');
        for (let r = 12; r <= 17; r++) run.map.set(40, r, T.RUBBLE);
        const bx = 40 * TILE;
        const by = 15 * TILE;
        run.game.effects.shake(16, 1.1);
        run.game.effects.burst(bx, by, '#c9c4b8', 60, 340, 1.2, 6);
        run.game.effects.burst(bx, by, '#ff7a2a', 40, 260, 0.9, 5);
        run.game.effects.ring(bx, by, 160, '#ff7a2a', 0.8, 6);
        await run.say([
          { speaker: 'Narrator', tone: 'danger', text: 'The garden wall explodes inward. Stone and fire rain across the hedges. Through the breach come shapes in black mail, too large, with snouts and horns: Trollocs.' },
          { speaker: 'Accepted Elin Marrow', tone: 'danger', text: 'Novice! Hold the path to the novice quarters; the girls are still inside! Use whatever you have, Light help us, use it!' },
          { speaker: 'Narrator', tone: 'narration', text: 'You know no weaves. Only raw flows. Press 1-5 to gather a thread of Earth, Fire, Air, Water or Spirit, and click to release it. Do not hold on too long; saidar can burn.' },
        ]);
        run.objective({ id: 'door_hold', label: 'Keep the Novice Quarters door standing' });
        run.objective({ id: 'waves', label: 'Repel the Shadowspawn waves', target: 3, counter: true });
        run.objective({ id: 'fade', label: 'Slay the Myrddraal', hidden: true });
        run.objective({ id: 'door_intact', label: 'Bonus: keep the door above half strength', optional: true, reward: { prestige: 10 } });
        nextWave();
      };

      run.zone({ id: 'fountain', x: 22 * TILE, y: 15 * TILE, radius: 110, color: '#9ad9ea', label: 'Fountain', onEnter: breach });
      run.after(16, breach);
      run.on('structureDestroyed', () => run.fail('door'));
      run.on('structureDamaged', (s) => {
        if (s.hp < s.maxHp * 0.5) run.failObjective('door_intact');
      });
      run.on('enemyKilled', (e) => {
        if (e.id === run.flags.fadeId) {
          run.complete('fade');
          if (!run.obj('door_intact').failed) run.complete('door_intact');
          run.complete('door_hold');
          run.setProgress('waves', 3);
          run.after(1.2, (r) => r.succeed());
        }
      });
      run.on('update', (dt) => {
        if (!run.flags.breached || waveIndex >= waves.length - 1 || waveIndex < 0) return;
        waveTime += dt;
        if (run.hostilesRemaining() <= 1 || waveTime > 38) nextWave();
      });
    },
    async debrief(run, ctx) {
      await ctx.say([
        { speaker: 'Narrator', tone: 'narration', text: 'Sisters arrive in a rush of skirts and saidar. Warders cut down the last of the Shadowspawn. The Myrddraal\'s body is still thrashing when they burn it.' },
        { speaker: 'Mistress of Novices', text: 'Raw flows. Untrained, unshielded, and you held the path. Do you understand how close you came to burning yourself out, child? The Amyrlin Seat will hear of this. So will I, every day, until you learn to weave properly.' },
      ]);
    },
  },
  {
    id: 'lessons_flows',
    title: 'The Lesson Yard',
    type: 'academic',
    chapter: 'Novice',
    summary: 'Strike ward-stones with the matching flow, swiftly and under control. Mistakes are punished.',
    retryable: true,
    requires: { minRank: 'novice', maxRank: 'novice', resolved: ['garden_breach'] },
    rewards: { xp: 90, prestige: 10, stats: { control: 1, potential: 1 }, learn: ['fireball', 'air_shield', 'healing_flow'] },
    failure: {
      prestige: -8,
      strike: true,
      text: (reason) =>
        reason === 'control'
          ? 'You let the Power run wild in the lesson yard. The Mistress of Novices shielded you herself and sent you to her study. You will not sit comfortably for days.'
          : 'You failed the lesson. The Mistress of Novices recorded every mistake in her book, and the book does not forget.',
    },
    async briefing(ctx) {
      await ctx.say([
        { speaker: 'Mistress of Novices', text: 'After the gardens, the Amyrlin has decided the Tower will not wait for novices to grow comfortable. Each ward-stone answers to one flow. Strike it with the wrong one and I will note it. Let your weaving run wild, and I will switch you myself.' },
      ]);
      return true;
    },
    setup(run) {
      run.useMap(buildPracticeYard());
      trackStats(run);
      failIfDowned(run);
      run.objective({ id: 'strike', label: 'Strike ward-stones with their matching flow', target: 12 });
      run.objective({ id: 'mistakes', label: 'Mistakes before the lesson is halted', target: 4, counter: true });
      run.objective({ id: 'control', label: 'Keep your danger under 60', counter: true });
      run.objective({ id: 'swift', label: 'Bonus: finish with 40s remaining', optional: true, reward: { prestige: 8 } });
      run.setTimeLimit(100, (r) => r.fail('time'));
      let spawned = 0;
      const placed = [];
      const spawnWard = () => {
        if (spawned >= 12) return;
        spawned++;
        const pos = run.randomOpen({ minFromPlayer: 110, avoid: placed.filter((p) => !p.dead), minSpacing: 90 });
        const el = run.rng.pick(ELEMENTS).id;
        const ward = run.spawn('practice_ward', pos.x, pos.y, { requiredElement: el, silent: true });
        placed.push(ward);
      };
      for (let i = 0; i < 3; i++) spawnWard();
      run.on('enemyKilled', (e) => {
        if (e.type !== 'practice_ward') return;
        run.progress('strike');
        spawnWard();
        if (run.obj('strike').done) {
          if (run.timeLimit !== null && run.timeLimit >= 40) run.complete('swift');
          run.after(0.6, (r) => r.succeed());
        }
      });
      run.on('wardMiss', () => {
        const o = run.progress('mistakes');
        run.game.weaver.channel.add(5);
        run.toast('"Again! The other flow, child!"', 'warn');
        if (o.current >= o.target) run.fail('mistakes');
      });
      run.on('update', () => {
        const d = run.game.weaver.channel.danger;
        run.setProgress('control', Math.round(d));
        if (d >= 60) run.fail('control');
      });
    },
    async debrief(run, ctx) {
      await ctx.say([
        { speaker: 'Mistress of Novices', text: 'Adequate. You will now learn three weaves of two threads: Fireball, the Air Shield, and the Healing Flow.' },
        { speaker: 'Mistress of Novices', text: 'Hear me well. A Novice holding a woven flow draws far more than she can bear. Every two-thread weave you make before you are raised Accepted will strain you twice over. Use them only when you must.' },
      ]);
    },
  },
  {
    id: 'grounds_patrol',
    title: 'Patrol the Tower Grounds',
    type: 'combat',
    chapter: 'Any',
    summary: 'Shadowspawn still slip across the river. Hunt them through the grounds. Repeatable.',
    repeatable: true,
    retryable: true,
    requires: { minRank: 'novice', resolved: ['garden_breach'] },
    rewards: (run) => ({ xp: 50 + run.player.rankIndex * 35 + run.stats.kills * 2, prestige: 4 }),
    failure: { prestige: -5, strike: false, text: () => 'Warders carried you back across the grounds. The Tower notes your weakness, and so do the other initiates.' },
    async briefing(ctx) {
      return ctx.confirm('Patrol the Tower Grounds', 'Hunt down Shadowspawn on the Tower grounds. Failure costs prestige but not your place in the Tower.');
    },
    setup(run) {
      const p = run.player;
      run.useMap(buildPatrol(run.rng));
      trackStats(run);
      failIfDowned(run);
      bringWarders(run);
      const pool = ['trolloc', 'trolloc', 'darkhound'];
      if (p.rankIndex >= 1) pool.push('grayman', 'trolloc');
      if (p.rankIndex >= 2) pool.push('channeler', 'darkhound');
      const total = 8 + p.rankIndex * 3 + Math.floor(p.level / 2);
      const points = [];
      let made = 0;
      while (made < total) {
        const pos = run.randomOpen({ minFromPlayer: 360, avoid: points, minSpacing: 120 });
        points.push(pos);
        const size = Math.min(total - made, run.rng.int(2, 4));
        for (let i = 0; i < size; i++) run.spawn(run.rng.pick(pool), pos.x + run.rng.range(-30, 30), pos.y + run.rng.range(-30, 30), { alerted: false });
        made += size;
      }
      let fades = 0;
      if (p.rankIndex >= 1) {
        const pos = run.randomOpen({ minFromPlayer: 420, avoid: points, minSpacing: 100 });
        const fade = run.spawn('myrddraal', pos.x, pos.y, { alerted: false });
        run.group('trolloc', 2, pos.x, pos.y, 36, { linkedTo: fade.id, alerted: false });
        fades = 3;
      }
      run.objective({ id: 'purge', label: 'Purge the Shadowspawn', target: total + fades });
      if (run.rng.chance(0.3)) run.artifactPickup(run.randomOpen({ minFromPlayer: 300 }));
      countFoes(run, 'purge');
      run.on('objectiveComplete', (o) => {
        if (o.id === 'purge') run.after(0.8, (r) => r.succeed());
      });
    },
  },
  {
    id: 'test_arches',
    title: 'The Three Arches',
    type: 'trial',
    chapter: 'Novice',
    summary: 'The test for Accepted. Three times you enter, three times you must return.',
    retryable: true,
    requires: { minRank: 'novice', maxRank: 'novice', success: ['lessons_flows'], level: 3, prestige: 30 },
    rewards: { xp: 150, prestige: 25, stats: { potential: 1 }, learn: ['earth_eruption', 'bonds_of_air', 'ice_lances'] },
    failure: {
      prestige: -15,
      strike: true,
      scar: 'arch_haunted',
      text: (reason) =>
        reason === 'turned_back'
          ? 'You hesitated within the arch, and the ter\'angreal does not forgive hesitation. Sisters dragged you out shaking. You are still a Novice, and something of the vision came with you.'
          : 'You collapsed within the arches. The sisters pulled you out before you were lost, but not before the visions left their mark.',
    },
    async briefing(ctx) {
      await ctx.say([
        { speaker: 'Mistress of Novices', text: 'Three silver arches. Three times you will enter, and three times you will return. What you see may be what was, what is, or what will be. Do not hesitate. Do not look back.' },
        { speaker: 'Mistress of Novices', text: 'If you fail to return, you will not return at all. Some women go in and never come out.' },
      ]);
      const ready = await ctx.ask({
        speaker: 'Mistress of Novices',
        text: 'Are you ready, child?',
        choices: [
          { label: 'I am ready.', value: true },
          { label: 'I need more time.', value: false },
        ],
      });
      return !!ready;
    },
    setup(run) {
      run.useMap(buildArches());
      trackStats(run);
      failIfDowned(run);
      const visions = [
        {
          name: 'First Arch',
          c: 8,
          text: 'You stand in the village of your childhood. It is burning. Your mother calls your name from the doorway of your home, begging you to come back to her.',
          choices: [
            { label: 'Walk on toward the light.', value: 'walk' },
            { label: 'Run to her.', value: 'fail' },
            { label: 'Seize saidar and smother the flames.', value: 'surge', detail: 'Strain +35' },
          ],
        },
        {
          name: 'Second Arch',
          c: 23,
          text: 'The Hall of the Tower. A sister in a red-fringed shawl names you Darkfriend before the Amyrlin. Every eye turns to you. Every sister embraces the Source.',
          choices: [
            { label: 'Hold your tongue and walk on.', value: 'walk' },
            { label: 'Strike her down with the Power.', value: 'fail' },
            { label: 'Plead your innocence.', value: 'plead', detail: 'The vision fights harder' },
          ],
        },
        {
          name: 'Third Arch',
          c: 38,
          text: 'You wear the shawl. The Tower is split in two and sisters lie dead in the corridors. A voice offers you the Amyrlin\'s stole, if only you will stay.',
          choices: [
            { label: 'Walk on.', value: 'walk' },
            { label: 'Stay, and rule.', value: 'fail' },
            { label: 'Weep for what will be.', value: 'weep', detail: 'Health -20' },
          ],
        },
      ];
      visions.forEach((v, i) => run.objective({ id: `arch${i}`, label: `Return through the ${v.name}`, hidden: i > 0 }));
      run.objective({ id: 'endure', label: 'Endure the vision', target: 1, hidden: true });

      const openDoor = (col) => {
        run.map.set(col, 7, T.CARPET);
        run.map.set(col, 8, T.CARPET);
        run.game.effects.burst(col * TILE + TILE / 2, 8 * TILE, '#dfe6ee', 20, 120, 0.6, 3);
      };

      const startArch = (i) => {
        const v = visions[i];
        const pos = at(v.c, 8);
        run.zone({
          id: `arch${i}`,
          ...pos,
          radius: 28,
          arch: true,
          color: '#dfe6ee',
          label: v.name,
          onEnter: async (r) => {
            const choice = await r.ask({ speaker: v.name, tone: 'vision', text: v.text, choices: v.choices });
            if (!r.active) return;
            if (choice === 'fail') {
              r.fail('turned_back');
              return;
            }
            let count = 3 + i;
            if (choice === 'surge') {
              r.game.weaver.channel.add(35);
              r.player.prestige -= 3;
              r.game.weaver.resolveDanger();
            }
            if (choice === 'plead') count *= 2;
            if (choice === 'weep') r.game.harmPlayer(20, 'Grief tears at you.');
            const endure = r.obj('endure');
            endure.target = count;
            endure.current = 0;
            endure.done = false;
            endure.hidden = false;
            for (let k = 0; k < count; k++) {
              const a = (k / count) * Math.PI * 2;
              r.spawn('phantom', pos.x + Math.cos(a) * 140, pos.y + Math.sin(a) * 140, { tag: `vision${i}` });
            }
            r.flags.current = i;
          },
        });
      };

      run.on('enemyKilled', (e) => {
        if (e.tag !== `vision${run.flags.current}`) return;
        run.progress('endure');
        if (run.hostilesRemaining((x) => x.tag === e.tag) > 0) return;
        const i = run.flags.current;
        const pos = at(visions[i].c, 8);
        run.obj('endure').hidden = true;
        run.zone({
          id: `return${i}`,
          ...pos,
          radius: 28,
          arch: true,
          color: '#fff6c0',
          label: 'Return',
          onEnter: (r) => {
            r.complete(`arch${i}`);
            if (i === visions.length - 1) {
              r.after(0.5, (rr) => rr.succeed());
              return;
            }
            openDoor(i === 0 ? 15 : 30);
            r.reveal(`arch${i + 1}`);
            startArch(i + 1);
          },
        });
      });
      startArch(0);
    },
    async debrief(run, ctx) {
      await ctx.say([
        { speaker: 'Narrator', tone: 'ceremony', text: 'You step from the third arch soaked and trembling. A cup of water is poured over your head, and another, and another: once for each arch, washing away what you saw.' },
        { speaker: 'Mistress of Novices', tone: 'ceremony', text: 'You are washed clean of the arches. You are Accepted of the White Tower.' },
        { speaker: 'Narrator', tone: 'ceremony', text: 'A golden ring is slipped onto your finger: the Great Serpent, eating its own tail. Your white dress now bears seven bands of colour at the hem, one for every Ajah.' },
      ]);
      ctx.player.promote();
      await ctx.say([{ speaker: 'Mistress of Novices', text: 'Woven flows will no longer strain you as they did. But Accepted who reach too far still burn. You will learn Earth Eruption, Bonds of Air, and Ice Lances.' }]);
    },
  },

  // ── Chapter II: Accepted ───────────────────────────────────────────────────
  {
    id: 'shining_walls',
    title: 'Breach at the Shining Walls',
    type: 'combat',
    chapter: 'Accepted',
    summary: 'Shadow rifts have opened outside Tar Valon. Seal them and kill the Myrddraal that commands the host.',
    retryable: true,
    requires: { minRank: 'accepted' },
    rewards: { xp: 220, prestige: 25, stats: { strength: 1 } },
    failure: { prestige: -12, strike: true, scar: 'blight_burned', text: () => 'The rifts stayed open until the sisters of the Hall came in force. Rift-fire seared your channels as you were carried away.' },
    async briefing(ctx) {
      await ctx.say([
        { speaker: 'Keeper of the Chronicles', text: 'Three wounds in the Pattern have opened beyond the Shining Walls: rifts that bleed Shadowspawn. A Myrddraal holds the host together. Seal the rifts, then find it.' },
        { speaker: 'Keeper of the Chronicles', text: 'Old guardhouses stand in that field. If you find hollow stone, strike it with Earth; the Tower lost much there in the Trolloc Wars.' },
      ]);
      return true;
    },
    setup(run) {
      run.useMap(buildOuterGrounds(run.rng));
      trackStats(run);
      failIfDowned(run);
      bringWarders(run);
      const rifts = [[50, 8], [52, 30], [34, 34]].map(([c, r]) => {
        const pos = at(c, r);
        const rift = run.spawn('rift', pos.x, pos.y, {});
        rift.spawnScale = run.scale;
        run.group('trolloc', 2, pos.x - 40, pos.y, 30, { alerted: false });
        return rift;
      });
      run.objective({ id: 'rifts', label: 'Seal the Shadow rifts', target: rifts.length });
      run.objective({ id: 'commander', label: 'Slay the Myrddraal commander', hidden: true });
      run.artifactPickup(at(30, 5), 'twisted_ring');
      run.on('enemyKilled', (e) => {
        if (e.type === 'rift') {
          run.progress('rifts');
          if (run.obj('rifts').done) {
            run.reveal('commander');
            const pos = at(44, 20);
            const fade = run.spawn('myrddraal', pos.x, pos.y, { boss: true, name: 'Myrddraal Commander' });
            run.flags.boss = fade.id;
            run.group('trolloc', 4, pos.x, pos.y, 50, { linkedTo: fade.id });
            run.toast('The commander comes for you.', 'danger');
          }
        } else if (e.id === run.flags.boss) {
          run.complete('commander');
          run.after(1, (r) => r.succeed());
        }
      });
    },
  },
  {
    id: 'depository',
    title: 'The Thirteenth Depository',
    type: 'academic',
    chapter: 'Accepted',
    summary: 'Recover six lost folios from the forbidden depository before the wards reseal. Something hunts the stacks.',
    retryable: true,
    requires: { minRank: 'accepted' },
    rewards: { xp: 180, prestige: 15, stats: { potential: 2 }, learn: ['sky_lightning', 'earthquake', 'delving', 'gateway'] },
    failure: { prestige: -10, strike: true, text: (reason) => (reason === 'time' ? 'The wards resealed with you inside. You were found at dawn, and questioned for a week about what you read.' : 'You were found senseless between the shelves. Whatever struck you down left no trace.') },
    async briefing(ctx) {
      await ctx.say([
        { speaker: 'Librarian', text: 'Six folios on the higher weaves were misfiled in the Thirteenth Depository, among texts no Accepted should read. The wards there reseal in under three minutes.' },
        { speaker: 'Librarian', text: 'The ward-sentinels cannot be harmed and will stun anyone they touch. And there have been... reports. Of men in gray who are hard to see.' },
      ]);
      return true;
    },
    setup(run) {
      run.useMap(buildLibrary());
      trackStats(run);
      failIfDowned(run);
      bringWarders(run);
      const aisles = [3, 8, 9, 14, 15, 20, 21, 26, 27, 32];
      const tomes = [];
      for (let i = 0; i < 6; i++) {
        let pos;
        for (let tries = 0; tries < 100; tries++) {
          pos = at(run.rng.int(5, 46), run.rng.pick(aisles));
          if (!run.map.isSolidAt(pos.x, pos.y) && dist(pos.x, pos.y, run.player.x, run.player.y) > 200 && tomes.every((t) => dist(t.x, t.y, pos.x, pos.y) > 150)) break;
        }
        tomes.push(pos);
        run.pickup({ id: `tome${i}`, kind: 'tome', label: 'Folio', color: '#7a3e2e', ...pos });
      }
      for (const row of [8.5, 14.5, 20.5, 26.5]) {
        const y = row * TILE;
        run.spawn('sentinel', 30 * TILE, y, { patrol: [{ x: 4 * TILE, y }, { x: 46 * TILE, y }], silent: true });
      }
      run.spawn('grayman', 30 * TILE, 21 * TILE, { alerted: true });
      run.spawn('grayman', 40 * TILE, 32 * TILE, { alerted: true });
      for (const [c, r] of [[12, 5], [24, 11], [36, 17], [24, 23], [12, 29]]) run.trap({ ...at(c, r + 0.5), radius: 18 });
      run.artifactPickup(at(46, 2), 'seeing_lens');
      run.objective({ id: 'tomes', label: 'Recover the lost folios', target: 6 });
      run.objective({ id: 'escape', label: 'Return to the depository door', hidden: true });
      run.setTimeLimit(165, (r) => r.fail('time'));
      run.on('pickup', (pk) => {
        if (pk.kind !== 'tome') return;
        run.progress('tomes');
        if (run.obj('tomes').done) {
          run.reveal('escape');
          run.zone({ id: 'exit', ...at(3, 2), radius: 36, color: '#9ad9ea', label: 'Depository Door', onEnter: (r) => r.succeed() });
        }
      });
    },
    async debrief(run, ctx) {
      await ctx.say([{ speaker: 'Narrator', tone: 'narration', text: 'Among the six folios is a seventh, sealed in black wax stamped with the Flame of Tar Valon inverted: the Tower\'s own warning. Inside are the flows of balefire.' }]);
      const choice = await ctx.ask({
        speaker: 'Narrator',
        text: 'No one saw you take it.',
        choices: [
          { label: 'Surrender it to the Librarian, seal unbroken.', value: 'surrender', detail: 'Prestige +10' },
          { label: 'Break the seal and read.', value: 'read', detail: 'Learn Balefire. Prestige -10' },
        ],
      });
      if (choice === 'read') {
        ctx.player.learn('balefire');
        ctx.player.prestige -= 10;
        ctx.player.flags.readBalefire = true;
        ctx.player.addChronicle('Read the forbidden folio of balefire.', 'shadow');
        await ctx.say([{ speaker: 'Narrator', tone: 'danger', text: 'The weave burns itself into your memory. You could never unlearn it now. Fire, Fire and Spirit. You hope you never have to.' }]);
      } else {
        ctx.player.prestige += 10;
        await ctx.say([{ speaker: 'Librarian', text: 'Unbroken. Good. There are Accepted who would not have hesitated. The Tower remembers its honest daughters.' }]);
      }
      await ctx.say([{ speaker: 'Librarian', text: 'The folios teach Sky Lightning, Earthquake, Delving and Gateway. You may learn their flows, but you cannot hold them until the Oath Rod binds you.' }]);
    },
  },
  {
    id: 'test_shawl',
    title: 'The Test for the Shawl',
    type: 'trial',
    chapter: 'Accepted',
    summary: 'Weave under unimaginable duress with perfect calm. Then choose your Ajah and swear the Three Oaths.',
    retryable: true,
    requires: { minRank: 'accepted', maxRank: 'accepted', success: ['shining_walls', 'depository'], level: 5, prestige: 90 },
    rewards: { xp: 250, prestige: 30 },
    failure: {
      prestige: -20,
      strike: true,
      text: (reason) =>
        reason === 'calm'
          ? 'You lost your calm. The sisters watching the test cut you off from the Source before you could burn. You remain Accepted, and the Hall will wonder whether you ever should have been.'
          : 'You broke within the test. Sisters carried you out of the chamber in silence.',
    },
    async briefing(ctx) {
      await ctx.say([
        { speaker: 'The Amyrlin Seat', tone: 'ceremony', text: 'Within this chamber you will weave, without pause and in perfect calm, while the chamber itself tries to break you. If your danger passes nine tenths of what you can bear, the test ends.' },
        { speaker: 'The Amyrlin Seat', tone: 'ceremony', text: 'If you pass, you will choose your Ajah, and you will swear the Three Oaths. There is no unchoosing either.' },
      ]);
      const ready = await ctx.ask({ speaker: 'The Amyrlin Seat', text: 'Do you come of your own will?', choices: [{ label: 'I come of my own will.', value: true }, { label: 'Not yet, Mother.', value: false }] });
      return !!ready;
    },
    setup(run) {
      run.useMap(buildShawlHall());
      trackStats(run);
      failIfDowned(run);
      const center = at(18, 13);
      run.objective({ id: 'weaves', label: 'Weave under duress', target: 40 });
      run.objective({ id: 'calm', label: 'Never let your danger pass 90%', counter: true });
      run.objective({ id: 'final', label: 'Defeat the final apparition', hidden: true });
      run.every(4.5, (r) => {
        if (r.obj('weaves').done) return;
        if (r.hostilesRemaining() >= 9) return;
        const count = r.obj('weaves').current > 20 ? 3 : 2;
        for (let i = 0; i < count; i++) {
          const a = r.rng.range(0, Math.PI * 2);
          r.spawn('phantom', center.x + Math.cos(a) * 300, center.y + Math.sin(a) * 220, { scale: r.scale * (r.obj('weaves').current > 20 ? 1.3 : 1) });
        }
      });
      run.on('weaveCast', () => {
        const o = run.progress('weaves');
        if (o.done && !run.flags.final) {
          run.flags.final = true;
          run.reveal('final');
          const boss = run.spawn('myrddraal', center.x + 200, center.y, { boss: true, name: 'Apparition of the Eyeless' });
          run.flags.boss = boss.id;
          run.toast('The chamber shapes your fear into a Myrddraal. Its gaze presses on your channels.', 'danger');
        }
      });
      run.on('enemyKilled', (e) => {
        if (e.id === run.flags.boss) {
          run.complete('final');
          run.after(0.8, (r) => r.succeed());
        }
      });
      run.on('burnout', () => run.fail('calm'));
      run.on('update', () => {
        const ch = run.game.weaver.channel;
        const pct = Math.round((ch.danger / ch.profile.max) * 100);
        run.setProgress('calm', pct);
        if (pct >= 90) run.fail('calm');
      });
    },
    async debrief(run, ctx) {
      await run.engine.ajahCeremony(ctx);
    },
  },

  // ── Chapter III: Ajah missions ─────────────────────────────────────────────
  {
    id: 'green_stand',
    title: 'The Blightborder Stand',
    type: 'combat',
    chapter: 'Green Ajah',
    summary: 'Hold a Shienaran watchtower until dawn with your Warders at your side.',
    retryable: true,
    requires: { minRank: 'aes_sedai', ajah: 'green' },
    rewards: { xp: 320, prestige: 30, stats: { vitality: 1 } },
    failure: { prestige: -15, strike: true, scar: 'fade_marked', text: () => 'The watchtower fell before dawn. You were dragged south by the surviving lancers, a Myrddraal\'s cut festering in your side.' },
    async briefing(ctx) {
      await ctx.say([
        { speaker: 'Captain-General of the Green', text: 'The Battle Ajah does not wait for the Last Battle to come to it. A watchtower on the Blightborder has lost its sisters. Hold it until dawn: a hundred and fifty heartbeats of the long night.' },
        { speaker: 'Captain-General of the Green', text: 'Your Warders will follow your word. F switches them between guarding you and charging the foe. Keep them alive; you will feel every one of them die.' },
      ]);
      return true;
    },
    setup(run) {
      run.useMap(buildBlightborder());
      trackStats(run);
      failIfDowned(run);
      bringWarders(run);
      const tower = run.allies.addStructure({ id: 'tower', name: 'Watchtower', ...at(25, 17), radius: 40, hp: 420, color: '#c0b090' });
      tower.x -= TILE / 2;
      tower.y -= TILE / 2;
      run.objective({ id: 'dawn', label: 'Hold the watchtower until dawn' });
      run.objective({ id: 'tower', label: 'Keep the watchtower standing' });
      run.objective({ id: 'no_warder_lost', label: 'Bonus: lose no Warder', optional: true, reward: { prestige: 15 } });
      const edges = [at(3, 3), at(46, 3), at(3, 30), at(46, 30), at(25, 2), at(25, 31)];
      let wave = 0;
      run.every(16, (r) => {
        wave++;
        const edge = r.rng.pick(edges);
        const n = 3 + wave;
        for (let i = 0; i < n; i++) r.spawn(i % 3 === 2 ? 'darkhound' : 'trolloc', edge.x + r.rng.range(-50, 50), edge.y + r.rng.range(-50, 50), { goal: i % 2 ? tower : null });
        if (wave % 3 === 0) {
          const e2 = r.rng.pick(edges);
          const fade = r.spawn('myrddraal', e2.x, e2.y, {});
          r.group('trolloc', 3, e2.x, e2.y, 40, { linkedTo: fade.id, goal: tower });
          r.toast('A Myrddraal leads a fist toward the tower.', 'danger');
        }
      });
      run.after(1, (r) => r.group('trolloc', 3, edges[0].x, edges[0].y, 40, { goal: tower }));
      run.setTimeLimit(150, (r) => {
        r.complete('dawn');
        r.complete('tower');
        if (!r.obj('no_warder_lost').failed) r.complete('no_warder_lost');
        r.succeed();
      });
      run.on('structureDestroyed', () => run.fail('tower'));
    },
    async debrief(run, ctx) {
      await ctx.say([{ speaker: 'Narrator', tone: 'narration', text: 'Dawn breaks grey over the Blight. Shienaran lancers ride up to find the watchtower still standing, and a Green sister among the dead Trollocs, her Warders leaning on their swords.' }]);
    },
  },
  {
    id: 'yellow_ferry',
    title: 'Fever at the Ferry',
    type: 'support',
    chapter: 'Yellow Ajah',
    summary: 'Refugees burn with a Shadow-born fever while Darkhounds circle. Heal them before they die.',
    retryable: true,
    requires: { minRank: 'aes_sedai', ajah: 'yellow' },
    rewards: { xp: 300, prestige: 30, stats: { reserve: 1 } },
    failure: { prestige: -15, strike: true, scar: 'plague_guilt', text: () => 'Too many died at the ferry. You carried the fever home in your own blood, and the Yellow sisters will speak of this for a long time.' },
    async briefing(ctx) {
      await ctx.say([{ speaker: 'First Weaver of the Yellow', text: 'A Shadow-born fever has struck refugees at the Alindaer ferry, and Darkhounds have caught the scent. Six lives. Healing flows reach anyone near you; mend each of them fully. Lose three, and you have failed them.' }]);
      return true;
    },
    setup(run) {
      run.useMap(buildFerry());
      trackStats(run);
      failIfDowned(run);
      const names = ['Mother Alsa', 'Old Perrin', 'Little Jeyne', 'Brother Tam', 'Marla the Weaver', 'Young Hob'];
      const spots = [[6, 4], [15, 6], [36, 6], [8, 24], [26, 26], [40, 22]];
      spots.forEach(([c, r], i) => run.allies.addNPC({ name: names[i], ...at(c, r), hp: 40 + i * 4, drain: 1.1 + i * 0.08 }));
      run.objective({ id: 'heal', label: 'Heal the fevered refugees', target: 6 });
      run.objective({ id: 'lost', label: 'Refugees lost (three is failure)', target: 3, counter: true });
      run.every(12, (r) => {
        const pos = r.randomOpen({ minFromPlayer: 380 });
        r.group('darkhound', 2 + Math.floor(r.time / 40), pos.x, pos.y, 30, { preyOnNpcs: true });
      });
      run.after(2, (r) => {
        const pos = r.randomOpen({ minFromPlayer: 360 });
        r.group('trolloc', 2, pos.x, pos.y, 30, { preyOnNpcs: true });
      });
      const check = () => {
        const saved = run.allies.npcs.filter((n) => n.saved).length;
        const lost = run.allies.npcs.filter((n) => n.dead).length;
        run.setProgress('heal', saved);
        run.setProgress('lost', lost);
        if (lost >= 3) run.fail('lost');
        else if (saved + lost === run.allies.npcs.length) {
          run.complete('heal');
          run.after(0.8, (r) => r.succeed());
        }
      };
      run.on('npcSaved', check);
      run.on('npcDied', check);
    },
  },
  {
    id: 'red_hunt',
    title: 'The Borderland Hunt',
    type: 'roguelite',
    chapter: 'Red Ajah',
    summary: 'A rogue-lite hunt across three random borderland stages for a man who channels. Shield him. Seize him.',
    retryable: true,
    requires: { minRank: 'aes_sedai', ajah: 'red' },
    rewards: (run) => ({ xp: 380, prestige: run.flags.captured ? 40 : 20, stats: { strength: 1 } }),
    failure: { prestige: -15, strike: true, scar: 'blight_burned', text: () => 'The False Dragon escaped into the Blight. Somewhere, a man who channels walks free because of you, and the taint will drive him to slaughter.' },
    async briefing(ctx) {
      await ctx.say([
        { speaker: 'Highest of the Red', text: 'A man channels in the Borderlands and calls himself the Dragon Reborn. Kaedran Vos. Three days\' ride of broken country lie between you and him, and every league of it crawls with Shadowspawn.' },
        { speaker: 'Highest of the Red', text: 'Saidin is tainted; he will go mad and kill thousands. Shield him with Spirit, cut him off from the Source, and seize him. The Oaths forbid you to strike him down unless your life hangs by a thread.' },
        { speaker: 'Narrator', tone: 'narration', text: 'Rogue-lite hunt: three random stages. Your health does not recover between them. After each stage you will choose a boon.' },
      ]);
      return true;
    },
    setup(run) {
      run.flags.stage = 0;
      const p = run.player;
      run.objective({ id: 'stage', label: 'Cross the Borderlands', target: 3, counter: true });
      run.objective({ id: 'clear', label: 'Clear the way', target: 1 });
      run.objective({ id: 'seize', label: 'Shield and seize the False Dragon', hidden: true });
      trackStats(run);
      failIfDowned(run);
      const MODS = [
        { id: 'frenzy', label: 'Frenzied: Shadowspawn move 25% faster', apply: (o) => ({ ...o, speedScale: 1.25 }) },
        { id: 'horde', label: 'Horde: half again as many foes', count: 1.5 },
        { id: 'taint', label: 'Tainted ground: your danger fades 40% slower', run: () => { p.runMods.dangerDecay *= 0.6; } },
        { id: 'still', label: 'Still air: no modifier', apply: (o) => o },
      ];
      const BOONS = [
        { id: 'fury', label: 'Fury of the Red: +20% weave potency', apply: () => { p.runMods.potency *= 1.2; } },
        { id: 'focus', label: 'Iron Focus: -20% strain from every weave', apply: () => { p.runMods.strain *= 0.8; } },
        { id: 'vigor', label: 'Shienaran Hospitality: heal fully', apply: () => p.heal(p.maxHealth) },
        { id: 'clarity', label: 'Clarity: danger fades 40% faster', apply: () => { p.runMods.dangerDecay *= 1.4; } },
        { id: 'well', label: 'Deep Well: refill the One Power and purge all strain', apply: () => { p.power = p.maxPower; run.game.weaver.channel.reset(); } },
      ];
      const loadStage = (n) => {
        const vitals = n > 0;
        run.useMap(buildBorderland(new RNG(run.rng.int(1, 1e9))), { keepVitals: vitals });
        run.setProgress('stage', n);
        const mod = run.rng.pick(MODS);
        mod.run?.();
        if (mod.id !== 'still') run.toast(`Stage ${n + 1}: ${mod.label}`, 'warn');
        const mult = mod.count ?? 1;
        const base = Math.round((6 + n * 3) * mult);
        const clear = run.obj('clear');
        clear.done = false;
        clear.current = 0;
        clear.hidden = n === 2;
        clear.target = n === 2 ? 1 : base;
        const pool = n === 0 ? ['trolloc', 'darkhound'] : ['trolloc', 'darkhound', 'grayman', 'channeler'];
        if (n < 2) {
          for (let i = 0; i < base; i++) {
            const pos = run.randomOpen({ minFromPlayer: 320 });
            const opts = mod.apply ? mod.apply({}) : {};
            run.spawn(run.rng.pick(pool), pos.x, pos.y, { ...opts, alerted: run.rng.chance(0.5) });
          }
        } else {
          run.reveal('seize');
          const pos = run.randomOpen({ minFromPlayer: 520 });
          const boss = run.spawn('rogue_channeler', pos.x, pos.y, { boss: true, name: 'Kaedran Vos, False Dragon' });
          run.flags.boss = boss.id;
          run.group('trolloc', 3, pos.x, pos.y, 60, mod.apply ? mod.apply({}) : {});
          run.toast('The air tastes of hot metal. He is near, and he is holding saidin.', 'danger');
        }
      };
      const offerBoon = async () => {
        const options = run.rng.shuffle(BOONS).slice(0, 3);
        const pick = await run.ask({
          speaker: 'The Hunt',
          tone: 'narration',
          text: `Stage ${run.flags.stage + 1} is behind you. A moment's rest before the next. Choose your boon.`,
          choices: options.map((b) => ({ label: b.label, value: b.id })),
        });
        if (!run.active) return;
        BOONS.find((b) => b.id === pick)?.apply();
        run.flags.stage += 1;
        loadStage(run.flags.stage);
      };
      run.on('enemyKilled', (e, info) => {
        if (e.id === run.flags.boss) {
          run.flags.captured = !!info?.captured;
          run.complete('seize');
          run.after(1, (r) => r.succeed());
          return;
        }
        if (run.flags.stage >= 2 || e.def.harmless) return;
        run.progress('clear');
        if (run.obj('clear').done && !run.flags.transition) {
          run.flags.transition = true;
          run.after(0.8, async (r) => {
            await offerBoon();
            r.flags.transition = false;
          });
        }
      });
      loadStage(0);
    },
    async debrief(run, ctx) {
      if (run.flags.captured) {
        await ctx.say([
          { speaker: 'Narrator', tone: 'narration', text: 'Kaedran Vos kneels in the dust, shielded and bound, weeping for the Source he can no longer touch. You will bring him to Tar Valon to be gentled.' },
          { speaker: 'Highest of the Red', text: 'Taken alive. That is how the Red Ajah does its work. The Hall will hear your name.' },
        ]);
      } else {
        await ctx.say([{ speaker: 'Highest of the Red', text: 'Dead, not gentled. The world is safer, but the Hall wanted him in chains. Next time, sister, shield first.' }]);
      }
    },
  },
  {
    id: 'blue_court',
    title: 'Whispers at the Sun Court',
    type: 'stealth',
    chapter: 'Blue Ajah',
    summary: 'Infiltrate a corrupt Cairhienin lord\'s manor at night, steal his letters, plant a forgery, and leave unseen.',
    retryable: true,
    requires: { minRank: 'aes_sedai', ajah: 'blue' },
    rewards: { xp: 320, prestige: 35, stats: { control: 1 } },
    failure: { prestige: -15, strike: true, text: () => 'Lord Daeral\'s men hauled you before his court. The Tower will spend years undoing the damage, and the Blue Ajah\'s eyes-and-ears in Cairhien are burned.' },
    async briefing(ctx) {
      await ctx.say([
        { speaker: 'First Selector of the Blue', text: 'Lord Daeral of House Taravin sells grain to the Shadow\'s friends while his people starve. Our eyes-and-ears have mapped his manor, every guard route and every servants\' passage.' },
        { speaker: 'First Selector of the Blue', text: 'Take his three letters. Leave a forged one in his study. Be gone before dawn. If you are seen, the Game of Houses turns bloody, and the Oaths forbid you to harm his guards unless your life is at stake. Bind them with Air and seize them if you must.' },
      ]);
      return true;
    },
    setup(run) {
      run.useMap(buildManor());
      trackStats(run);
      failIfDowned(run);
      const routes = [
        [at(4, 13), at(44, 13)],
        [at(16, 3), at(24, 3), at(24, 9), at(16, 9)],
        [at(28, 3), at(36, 9)],
        [at(5, 27), at(44, 27)],
        [at(3, 18), at(22, 21)],
        [at(26, 17), at(45, 21)],
        [at(40, 2), at(45, 9)],
      ];
      routes.forEach((route) => run.spawn('guard', route[0].x, route[0].y, { patrol: route, alerted: false, silent: true }));
      const letters = [at(6, 4), at(32, 6), at(40, 19)];
      letters.forEach((pos, i) => run.pickup({ id: `letter${i}`, kind: 'letter', label: 'Letter', ...pos }));
      run.objective({ id: 'letters', label: 'Steal Lord Daeral\'s letters', target: 3 });
      run.objective({ id: 'plant', label: 'Plant the forgery in the study', hidden: true });
      run.objective({ id: 'escape', label: 'Slip out through the garden gate', hidden: true });
      run.objective({ id: 'unseen', label: 'Bonus: remain unseen', optional: true, reward: { prestige: 20 } });
      run.on('pickup', (pk) => {
        if (pk.kind !== 'letter') return;
        run.progress('letters');
        if (run.obj('letters').done) {
          run.reveal('plant');
          run.zone({
            id: 'study',
            ...at(43, 4),
            radius: 26,
            color: '#e0c060',
            label: 'Lord Daeral\'s desk',
            onEnter: (r) => {
              r.complete('plant');
              r.reveal('escape');
              r.zone({
                id: 'gate',
                ...at(3, 31),
                radius: 34,
                color: '#9ad9ea',
                label: 'Garden Gate',
                onEnter: (rr) => {
                  if (!rr.obj('unseen').failed) rr.complete('unseen');
                  rr.complete('escape');
                  rr.succeed();
                },
              });
            },
          });
        }
      });
      run.on('alarm', () => {
        run.failObjective('unseen');
        run.toast('The alarm is raised! Daeral\'s Darkfriend retainers pour from the barracks.', 'danger');
        run.group('darkfriend', 3, at(24, 28).x, at(24, 28).y, 50);
        const champ = run.spawn('champion', at(8, 27).x, at(8, 27).y, {
          name: 'Daeral\'s Sworn Champion',
          boss: false,
          label: 'Sworn Champion',
          parley: {
            speaker: 'Sworn Champion',
            text: 'Aes Sedai. My lord pays me to stop thieves, witch or not. Turn around, or draw whatever you draw.',
            success: 'The champion lowers his blade. "No coin is worth this. Go, then, and I never saw you."',
            failure: 'He spits. "Words. I\'ve heard enough of them from your kind."',
            difficulty: 0,
          },
        });
        run.flags.champion = champ.id;
      });
    },
  },
  {
    id: 'brown_ruins',
    title: 'Ruins of the Collam Daan',
    type: 'academic',
    chapter: 'Brown Ajah',
    summary: 'Explore Age-of-Legends ruins riddled with glyph-traps and hollow walls. Recover three ter\'angreal and reach the sealed vault.',
    retryable: true,
    requires: { minRank: 'aes_sedai', ajah: 'brown' },
    rewards: { xp: 300, prestige: 30, stats: { potential: 1, reserve: 1 } },
    failure: { prestige: -15, strike: true, text: () => 'The ruins kept their secrets, and nearly kept you. The Browns retrieved you from beneath a collapsed arch, and your notes were lost.' },
    async briefing(ctx) {
      await ctx.say([
        { speaker: 'Brown Ajah Chair', text: 'The Collam Daan was the greatest centre of learning in the Age of Legends. A collapse has opened part of it. Three ter\'angreal lie somewhere inside, and a sealed vault no one has reached in three thousand years.' },
        { speaker: 'Brown Ajah Chair', text: 'Mind the floors: the ancients warded their halls with glyphs that do not show themselves. And the walls lie. Strike suspicious stone with Earth.' },
      ]);
      return true;
    },
    setup(run) {
      run.useMap(buildRuins());
      trackStats(run);
      failIfDowned(run);
      const owned = new Set(run.player.artifacts);
      const choices = run.rng.shuffle(Object.keys(TER_ANGREAL).filter((id) => !owned.has(id)));
      const spots = [at(30, 5), at(6, 30), at(42, 9)];
      let placed = 0;
      spots.forEach((pos, i) => {
        if (choices[i]) {
          run.artifactPickup(pos, choices[i]);
          placed++;
        } else {
          run.pickup({ id: `relic${i}`, kind: 'relic', label: 'Relic', color: '#b49bff', ...pos, onCollect: (r) => { r.player.prestige += 5; r.toast('An ancient relic for the Brown archives (+5 prestige).', 'good'); } });
        }
      });
      for (let i = 0; i < 10; i++) {
        const pos = run.randomOpen({ minFromPlayer: 140, avoid: run.traps, minSpacing: 70 });
        run.trap({ ...pos, radius: 18, damage: 14, danger: 18 });
      }
      for (const route of [[at(18, 3), at(18, 10)], [at(30, 14), at(30, 22)], [at(6, 14), at(6, 22)], [at(18, 26), at(30, 33)]]) {
        run.spawn('sentinel', route[0].x, route[0].y, { patrol: route, silent: true });
      }
      run.group('darkhound', 3, at(30, 18).x, at(30, 18).y, 30, { alerted: false });
      run.spawn('grayman', at(18, 20).x, at(18, 20).y);
      run.group('trolloc', 2, at(42, 5).x, at(42, 5).y, 30, { alerted: false });
      run.objective({ id: 'artifacts', label: 'Recover the ter\'angreal', target: 3 });
      run.objective({ id: 'vault', label: 'Reach the sealed vault', hidden: false });
      run.objective({ id: 'escape', label: 'Return to the collapse', hidden: true });
      run.on('pickup', (pk) => {
        if (pk.kind === 'artifact' || pk.kind === 'relic') run.progress('artifacts');
        checkDone();
      });
      run.zone({
        id: 'vault',
        ...at(43, 30),
        radius: 40,
        color: '#b49bff',
        label: 'Sealed Vault',
        onEnter: async (r) => {
          r.complete('vault');
          r.player.potential += 1;
          await r.say([{ speaker: 'Narrator', tone: 'narration', text: 'The vault holds no weapon, only a crystal sphere that hums with a record of the Age of Legends. You spend a long moment listening. When you look up, you understand the Power a little better than you did.' }]);
          checkDone();
        },
      });
      const checkDone = () => {
        if (run.obj('artifacts').done && run.obj('vault').done && !run.flags.exit) {
          run.flags.exit = true;
          run.reveal('escape');
          run.zone({ id: 'exit', ...at(3, 3), radius: 34, color: '#9ad9ea', label: 'The Collapse', onEnter: (r) => r.succeed() });
        }
      };
      if (placed === 0) run.toast('You already hold every known ter\'angreal; the Browns will want what relics you find.', 'info');
    },
  },
  {
    id: 'gray_truce',
    title: 'The Broken Truce',
    type: 'diplomacy',
    chapter: 'Gray Ajah',
    summary: 'Andoran soldiers and Whitecloaks face each other across a bridge. Seize the provocateurs, parley with the Questioner, and keep the peace.',
    retryable: true,
    requires: { minRank: 'aes_sedai', ajah: 'gray' },
    rewards: { xp: 320, prestige: 35, stats: { control: 1 } },
    failure: {
      prestige: -15,
      strike: true,
      text: (reason) => (reason === 'war' ? 'Steel rang on the bridge. By nightfall two hundred men were dead and Andor and Amadicia were at war. The Gray Ajah does not forgive a broken peace.' : 'You fell on the bridge, and the peace fell with you.'),
    },
    async briefing(ctx) {
      await ctx.say([
        { speaker: 'Head of the Gray', text: 'Andoran soldiers on one bank, Children of the Light on the other. Someone is stirring them toward slaughter: Darkfriend provocateurs moving between the camps.' },
        { speaker: 'Head of the Gray', text: 'Seize them; bind them with Air, or still them with your voice, then take hold. A Questioner of the Hand waits on the bridge. Talk him down if you can. Tension rises while the provocateurs work. If it reaches its peak, there will be war.' },
      ]);
      return true;
    },
    setup(run) {
      run.useMap(buildTruce());
      trackStats(run);
      failIfDowned(run);
      run.flags.tension = 20;
      for (const [c, r] of [[10, 12], [14, 20], [33, 12], [38, 20], [6, 18]]) {
        const pos = at(c, r);
        run.spawn('darkfriend', pos.x, pos.y, { alerted: false, tag: 'provocateur', label: 'Provocateur' });
      }
      const q = at(24, 16);
      const questioner = run.spawn('questioner', q.x, q.y, {
        alerted: false,
        label: 'Questioner Eamon Valda',
        parley: {
          speaker: 'Questioner of the Hand',
          text: 'A witch of Tar Valon on my bridge. The Children have every right to put this whole valley to the question, and every reason.',
          success: 'The Questioner\'s jaw works. "...The Lord Captain will hear of your words. Not your witchery. Your words." He withdraws to his camp.',
          failure: 'His hand drops to his sword. "Enough. The Light will judge you."',
          difficulty: 20,
        },
      });
      run.flags.questioner = questioner.id;
      run.objective({ id: 'tension', label: 'Tension between the camps (war at 100)', target: 100, counter: true });
      run.objective({ id: 'provocateurs', label: 'Seize the provocateurs', target: 5 });
      run.objective({ id: 'parley', label: 'Resolve the Questioner on the bridge' });
      run.objective({ id: 'ambush', label: 'Destroy the Shadow\'s ambush', hidden: true });
      run.objective({ id: 'bloodless', label: 'Bonus: kill no human', optional: true, reward: { prestige: 20 } });
      run.every(1, (r) => {
        const active = r.enemies.list.filter((e) => !e.dead && e.tag === 'provocateur').length;
        r.flags.tension = clamp(r.flags.tension + active * 0.18, 0, 100);
        r.setProgress('tension', Math.round(r.flags.tension));
        if (r.flags.tension >= 100) r.fail('war');
      });
      run.on('enemyKilled', (e, info) => {
        if (e.def.human && !info?.captured && !info?.parleyed) run.failObjective('bloodless');
        if (e.tag === 'provocateur') {
          run.progress('provocateurs');
          run.flags.tension = clamp(run.flags.tension - 8, 0, 100);
        }
        if (e.id === run.flags.questioner) {
          run.complete('parley');
          run.flags.tension = clamp(run.flags.tension - (info?.parleyed ? 25 : 10), 0, 100);
        }
        if (run.flags.ambushStarted && run.hostilesRemaining() === 0 && !run.obj('ambush').done) {
          run.complete('ambush');
          if (!run.obj('bloodless').failed) run.complete('bloodless');
          run.after(1, (r) => r.succeed());
        }
        if (!run.flags.ambushStarted && run.obj('provocateurs').done && run.obj('parley').done) {
          run.flags.ambushStarted = true;
          run.reveal('ambush');
          run.toast('Horns on the ridge! Trollocs pour down on both camps: the Shadow\'s true design.', 'danger');
          const pos = at(44, 4);
          const fade = run.spawn('myrddraal', pos.x, pos.y, {});
          run.group('trolloc', 5, pos.x, pos.y, 50, { linkedTo: fade.id });
          run.group('darkhound', 3, at(4, 28).x, at(4, 28).y, 30);
        }
      });
    },
  },
  {
    id: 'white_theorem',
    title: 'The Theorem of Shadows',
    type: 'academic',
    chapter: 'White Ajah',
    summary: 'A corrupted lattice ter\'angreal poses three theorems. Answer each with the one pure flow that completes it. Then find who corrupted it.',
    retryable: true,
    requires: { minRank: 'aes_sedai', ajah: 'white' },
    rewards: { xp: 320, prestige: 35, stats: { control: 1, potential: 1 } },
    failure: { prestige: -15, strike: true, text: () => 'The lattice collapsed with you inside it. The White Ajah\'s halls are sealed, and someone you trusted walks free.' },
    async briefing(ctx) {
      await ctx.say([
        { speaker: 'First Reasoner of the White', text: 'A lattice ter\'angreal in our hall has begun spawning phantoms. Each of its three locks displays a sequence of flows with one missing. Answer each with the single pure flow, Earth, Fire, Air, Water or Spirit, that completes it.' },
        { speaker: 'First Reasoner of the White', text: 'A wrong answer feeds the lattice your strain. Reason, sister. Do not guess.' },
      ]);
      return true;
    },
    setup(run) {
      run.useMap(buildWhiteHall());
      trackStats(run);
      failIfDowned(run);
      const generators = [
        () => {
          const s = run.rng.int(0, 4);
          const k = run.rng.int(1, 4);
          return { seq: [0, 1, 2, 3].map((i) => (s + i * k) % 5), answer: (s + 4 * k) % 5, hint: 'Each flow advances by the same measure.' };
        },
        () => {
          const a = run.rng.int(0, 4);
          let b = run.rng.int(0, 4);
          if (b === a) b = (a + 2) % 5;
          const c = (b + 1 + run.rng.int(0, 2)) % 5;
          return { seq: [a, b, c, b], answer: a, hint: 'The theorem reflects upon itself.' };
        },
        () => {
          const a = run.rng.int(0, 4);
          const b = run.rng.int(0, 4);
          const k = run.rng.int(1, 4);
          return { seq: [a, b, (a + k) % 5, (b + k) % 5], answer: (a + 2 * k) % 5, hint: 'Two threads, interleaved, each advancing alike.' };
        },
      ];
      const spots = [at(8, 12), at(28, 12), at(18, 6)];
      run.flags.locks = generators.map((gen, i) => {
        const puzzle = gen();
        const lock = run.spawn('lattice_lock', spots[i].x, spots[i].y, { requiredRecipe: [ELEMENTS[puzzle.answer].id], silent: true, label: `Theorem ${i + 1}` });
        return { lock, ...puzzle };
      });
      run.addRenderer((ctx) => {
        for (const { lock, seq, hint } of run.flags.locks) {
          if (lock.dead) continue;
          const y = lock.y - 62;
          seq.forEach((el, i) => {
            ctx.fillStyle = ELEMENTS[el].color;
            ctx.beginPath();
            ctx.arc(lock.x - 40 + i * 20, y, 7, 0, Math.PI * 2);
            ctx.fill();
          });
          ctx.font = '700 14px Georgia, serif';
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.fillText('?', lock.x + 40, y + 5);
          ctx.font = '11px Georgia, serif';
          ctx.fillStyle = '#d8e4f0';
          ctx.fillText(seq.map((s) => ELEMENT_NAMES[s][0]).join(' · ') + ' · ?', lock.x, y - 14);
          if (dist(run.player.x, run.player.y, lock.x, lock.y) < 160) ctx.fillText(hint, lock.x, y + 22);
        }
      });
      run.objective({ id: 'locks', label: 'Resolve the lattice theorems (pure flows only)', target: 3 });
      run.objective({ id: 'traitor', label: 'Unmask and seize the Black sister', hidden: true });
      run.every(6, (r) => {
        if (r.flags.traitorRevealed || r.hostilesRemaining((e) => e.type === 'phantom') >= 6) return;
        const pos = r.randomOpen({ minFromPlayer: 240 });
        r.spawn('phantom', pos.x, pos.y);
      });
      run.on('wardMiss', (lock) => {
        if (lock.type !== 'lattice_lock') return;
        run.game.weaver.channel.add(12);
        run.game.weaver.resolveDanger();
        run.toast('The lattice drinks your error.', 'warn');
        for (let i = 0; i < 2; i++) run.spawn('phantom', lock.x + (i ? 60 : -60), lock.y + 40);
      });
      run.on('enemyKilled', async (e, info) => {
        if (e.type === 'lattice_lock') {
          run.progress('locks');
          if (run.obj('locks').done && !run.flags.traitorRevealed) {
            run.flags.traitorRevealed = true;
            for (const ph of run.enemies.list) if (ph.type === 'phantom') ph.die({});
            await run.say([
              { speaker: 'Narrator', tone: 'danger', text: 'As the last theorem resolves, the lattice shows its maker: a White sister you have shared tea with for a decade. Her eyes go flat. She is Black Ajah, and her Oaths are long since broken.' },
              { speaker: 'Black Sister', tone: 'danger', text: 'Logic, sister. You should have reasoned that someone built it. The Great Lord rewards the clever.' },
            ]);
            const pos = at(18, 4);
            const sister = run.spawn('black_sister', pos.x, pos.y, { name: 'Black Sister Merane', label: 'Merane Sedai (Black Ajah)' });
            run.flags.sister = sister.id;
            run.reveal('traitor');
          }
        } else if (e.id === run.flags.sister) {
          run.flags.captured = !!info?.captured;
          run.complete('traitor');
          run.after(1, (r) => r.succeed());
        }
      });
    },
    async debrief(run, ctx) {
      await ctx.say([{ speaker: 'First Reasoner of the White', text: run.flags.captured ? 'Taken alive. She will be put to the Oath Rod and made to answer. The Black Ajah exists, then. That is no longer a theorem.' : 'Dead. A pity: the dead answer no questions. But the Black Ajah exists. That is no longer a theorem.' }]);
    },
  },

  // ── Chapter IV: The Eyeless Hunt ──────────────────────────────────────────
  {
    id: 'eyeless_hunt',
    title: 'The Eyeless Hunt',
    type: 'combat',
    chapter: 'Aes Sedai',
    summary: 'Three Myrddraal, a Black sister, and the Myrddraal Lord who planned the garden breach. End it.',
    retryable: true,
    requires: { minRank: 'aes_sedai', anyAjahMission: true },
    rewards: { xp: 450, prestige: 50, stats: { strength: 1, potential: 1 } },
    failure: { prestige: -20, strike: true, scar: 'fade_marked', text: () => 'The Myrddraal Lord escaped into the shadows it came from. The Tower will be breached again, and the blood will be on the Hall\'s hands, and yours.' },
    async briefing(ctx) {
      await ctx.say([
        { speaker: 'The Amyrlin Seat', tone: 'ceremony', text: 'The breach in the novice gardens on the day you arrived was no accident, daughter. A Myrddraal Lord planned it, and a sister of the Black Ajah, the Ajah we swear does not exist, opened the way.' },
        { speaker: 'The Amyrlin Seat', tone: 'ceremony', text: 'We have found their nest in the ruined courtyard below the Tower. You began this the day you arrived. Finish it.' },
      ]);
      return true;
    },
    setup(run) {
      run.useMap(buildCourtyard(127));
      trackStats(run);
      failIfDowned(run);
      bringWarders(run);
      run.flags.fades = [];
      for (const [c, r] of [[20, 8], [36, 26], [44, 10]]) {
        const pos = at(c, r);
        const fade = run.spawn('myrddraal', pos.x, pos.y, { alerted: false });
        run.flags.fades.push(fade.id);
        run.group('trolloc', 3, pos.x, pos.y, 44, { linkedTo: fade.id, alerted: false });
      }
      const sp = at(28, 18);
      const sister = run.spawn('black_sister', sp.x, sp.y, { name: 'Black Sister Ilyena', label: 'Ilyena Sedai (Black Ajah)', alerted: false });
      run.flags.sister = sister.id;
      run.objective({ id: 'fades', label: 'Slay the Myrddraal', target: 3 });
      run.objective({ id: 'sister', label: 'Seize or slay the Black sister' });
      run.objective({ id: 'lord', label: 'Destroy the Myrddraal Lord', hidden: true });
      run.on('enemyKilled', (e) => {
        if (run.flags.fades.includes(e.id)) run.progress('fades');
        if (e.id === run.flags.sister) run.complete('sister');
        if (e.id === run.flags.lord) {
          run.complete('lord');
          run.after(1.2, (r) => r.succeed());
          return;
        }
        if (!run.flags.lord && run.obj('fades').done && run.obj('sister').done) {
          run.reveal('lord');
          const pos = at(46, 30);
          const lord = run.spawn('myrddraal', pos.x, pos.y, { boss: true, scale: run.scale * 1.6, name: 'The Myrddraal Lord' });
          run.flags.lord = lord.id;
          run.group('trolloc', 5, pos.x, pos.y, 60, { linkedTo: lord.id });
          run.toast('The shadows deepen. The Myrddraal Lord has come for you itself.', 'danger');
        }
      });
    },
    async debrief(run, ctx) {
      ctx.player.flags.epilogue = true;
      await ctx.say([
        { speaker: 'Narrator', tone: 'ceremony', text: 'The Myrddraal Lord dies hard, and its linked Trollocs fall with it like puppets with cut strings. When the sisters arrive they find you standing alone in the ruin, saidar still shining around you.' },
        { speaker: 'The Amyrlin Seat', tone: 'ceremony', text: '{title}. You came to us a frightened girl with a wild spark. The Tower will remember this day. So will the Shadow.' },
        { speaker: 'Narrator', tone: 'narration', text: 'Your story continues. The Tower\'s grounds still need patrolling, and the Wheel turns on.' },
      ]);
    },
  },
];

export const MISSION_BY_ID = Object.fromEntries(MISSIONS.map((m) => [m.id, m]));

// ---------------------------------------------------------------------------
// MissionEngine
// ---------------------------------------------------------------------------

const FORWARDED_EVENTS = [
  'enemyKilled', 'enemyCaptured', 'enemyReachedGoal', 'weaveCast', 'wardMiss', 'structureDestroyed',
  'structureDamaged', 'npcSaved', 'npcDied', 'warderDied', 'warderDowned', 'warderRevived', 'alarm', 'burnout',
  'playerDowned', 'channelerShielded', 'secretFound', 'oathRestrained', 'injuryCured',
];

export class MissionEngine {
  constructor(game) {
    this.game = game;
    this.run = null;
    this.unsubscribe = [];
    this.parleyLock = false;
  }

  get active() {
    return !!this.run && this.run.active;
  }

  context() {
    const game = this.game;
    return {
      game,
      player: game.player,
      engine: this,
      say: (nodes) => game.dialogue(nodes),
      ask: async (node) => (await game.dialogue([node]))[0],
      confirm: async (title, text) => (await game.dialogue([{ speaker: title, text, choices: [{ label: 'Undertake it', value: true }, { label: 'Not now', value: false }] }]))[0],
    };
  }

  /** Returns { def, state: 'available'|'locked'|'completed'|'closed', reason, outcome } for each visible mission. */
  catalog() {
    const p = this.game.player;
    return MISSIONS.filter((def) => !def.requires.ajah || def.requires.ajah === p.ajah).map((def) => ({ def, ...this.availability(def) }));
  }

  availability(def) {
    const p = this.game.player;
    const outcome = p.outcomes[def.id] ?? null;
    const req = def.requires ?? {};
    if (outcome === 'success' && !def.repeatable) return { state: 'completed', outcome, reason: 'Completed' };
    if (outcome === 'failed' && !def.retryable) return { state: 'closed', outcome, reason: 'Failed, and it cannot be undone' };
    if (req.minRank && p.rankIndex < rankIndexOf(req.minRank)) return { state: 'locked', outcome, reason: `Requires the rank of ${RANKS[rankIndexOf(req.minRank)].title}` };
    if (req.maxRank && p.rankIndex > rankIndexOf(req.maxRank)) return { state: 'closed', outcome, reason: 'You have risen beyond this' };
    if (req.ajah && p.ajah !== req.ajah) return { state: 'locked', outcome, reason: `For sisters of the ${AJAHS[req.ajah].name} Ajah` };
    for (const id of req.resolved ?? []) {
      if (!p.outcomes[id]) return { state: 'locked', outcome, reason: `First: ${MISSION_BY_ID[id].title}` };
    }
    for (const id of req.success ?? []) {
      if (p.outcomes[id] !== 'success') return { state: 'locked', outcome, reason: `Requires success in ${MISSION_BY_ID[id].title}` };
    }
    if (req.anyAjahMission && !MISSIONS.some((m) => m.requires.ajah && p.outcomes[m.id] === 'success')) {
      return { state: 'locked', outcome, reason: 'Complete your Ajah\'s mission first' };
    }
    if (req.level && p.level < req.level) return { state: 'locked', outcome, reason: `Requires level ${req.level} (you are ${p.level})` };
    if (req.prestige && p.prestige < req.prestige) return { state: 'locked', outcome, reason: `Requires ${req.prestige} prestige (you have ${p.prestige})` };
    return { state: 'available', outcome, reason: '' };
  }

  /** The trial that leads to the next rank, and what still stands in the way. */
  nextPromotion() {
    const p = this.game.player;
    const trial = p.rankIndex === 0 ? MISSION_BY_ID.test_arches : p.rankIndex === 1 ? MISSION_BY_ID.test_shawl : null;
    if (!trial) return null;
    return { trial, ...this.availability(trial), next: RANKS[p.rankIndex + 1] };
  }

  rewardsPreview(def) {
    if (typeof def.rewards === 'function') return 'Rewards scale with your performance';
    const r = def.rewards;
    const parts = [`${r.xp} XP`, `${r.prestige} prestige`];
    for (const [k, v] of Object.entries(r.stats ?? {})) parts.push(`${v > 0 ? '+' : ''}${v} ${k}`);
    if (r.learn?.length) parts.push(`learn ${r.learn.map((id) => WEAVES[id].name).join(', ')}`);
    return parts.join(' · ');
  }

  async start(id) {
    const def = MISSION_BY_ID[id];
    if (!def) throw new Error(`Unknown mission "${id}"`);
    const avail = this.availability(def);
    if (avail.state !== 'available') {
      this.game.ui.toast(avail.reason, 'warn');
      this.game.enterHub();
      return false;
    }
    const ctx = this.context();
    const proceed = def.briefing ? await def.briefing(ctx) : true;
    if (proceed === false) {
      this.game.enterHub();
      return false;
    }
    const run = new MissionRun(this, def);
    this.run = run;
    this.game.player.runMods = { potency: 1, strain: 1, dangerDecay: 1 };
    this.bind(run);
    try {
      def.setup(run);
    } catch (err) {
      console.error(`[mission:${id}] setup failed`, err);
      this.unbind();
      this.run = null;
      this.game.ui.reportError('The mission could not begin. You return to the Tower.');
      this.game.enterHub();
      return false;
    }
    this.game.markMissionStarted(def.id);
    this.game.enterMission();
    return true;
  }

  bind(run) {
    this.unbind();
    for (const evt of FORWARDED_EVENTS) {
      this.unsubscribe.push(this.game.events.on(evt, (...args) => run.emit(evt, ...args)));
    }
  }

  unbind() {
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
  }

  /** Ends the current run immediately without consequences (used when the game itself ends). */
  abort() {
    if (this.run) this.run.state = 'aborted';
    this.unbind();
    this.run = null;
  }

  update(dt) {
    if (!this.active) return;
    this.run.update(dt);
    this.checkParley();
  }

  render(ctx, time) {
    this.run?.render(ctx, time);
  }

  // -- parley (dialogue-driven mini-boss resolution) -----------------------------

  checkParley() {
    if (this.parleyLock) return;
    const p = this.game.player;
    for (const e of this.game.enemies.list) {
      if (e.dead || !e.parley || e.parley.done) continue;
      if (dist(e.x, e.y, p.x, p.y) > 170 || !this.game.map.lineOfSight(e.x, e.y, p.x, p.y)) continue;
      e.parley.done = true;
      this.runParley(e);
      return;
    }
  }

  async runParley(enemy) {
    this.parleyLock = true;
    const p = this.game.player;
    const run = this.run;
    try {
      const gray = !!p.mod('compellingVoice', false);
      const chance = clamp(p.persuasionChance - (enemy.parley.difficulty ?? 0), 5, 95);
      const choices = [];
      if (gray) choices.push({ label: 'Speak with the Compelling Voice.', value: 'voice', detail: 'Gray Ajah: certain success' });
      choices.push({ label: 'Reason with him.', value: 'reason', detail: `Persuasion ${chance}%` });
      choices.push({ label: 'Embrace the Source.', value: 'fight' });
      const choice = (await this.game.dialogue([{ speaker: enemy.parley.speaker, text: enemy.parley.text, choices }]))[0];
      if (!run.active) return;
      const success = choice === 'voice' || (choice === 'reason' && Math.random() * 100 < chance);
      if (success) {
        await this.game.dialogue([{ speaker: enemy.parley.speaker, text: enemy.parley.success }]);
        this.game.effects.ring(enemy.x, enemy.y, 40, '#c9c9d6', 0.8, 3);
        enemy.dead = true;
        enemy.deathTimer = 0.4;
        this.game.events.emit('enemyKilled', enemy, { parleyed: true });
      } else {
        if (choice === 'reason') await this.game.dialogue([{ speaker: enemy.parley.speaker, text: enemy.parley.failure }]);
        enemy.alerted = true;
        enemy.aggroPlayer = true;
      }
    } finally {
      this.parleyLock = false;
    }
  }

  // -- artifacts -------------------------------------------------------------------

  claimArtifact(artifactId) {
    const p = this.game.player;
    const art = TER_ANGREAL[artifactId];
    if (p.canUseArtifacts) {
      if (!p.artifacts.includes(artifactId)) p.artifacts.push(artifactId);
      if (!p.equippedArtifact) p.equippedArtifact = artifactId;
      p.addChronicle(`Attuned the ter'angreal: ${art.name}.`, 'growth');
      this.game.ui.toast(`Attuned: ${art.name}. ${art.description}`, 'good');
    } else {
      p.prestige += 4;
      p.addChronicle(`Recovered ${art.name} for the Brown Ajah's archives.`, 'info');
      this.game.ui.toast(`${art.name}: inert in your hands. Sent to the Brown archives (+4 prestige).`, 'good');
    }
  }

  // -- ceremonies ------------------------------------------------------------------

  async ajahCeremony(ctx) {
    const game = this.game;
    const p = game.player;
    await ctx.say([
      { speaker: 'Narrator', tone: 'ceremony', text: 'You kneel in the Hall of the Tower. Seven Sitters\' chairs, seven colours. The Amyrlin Seat rises, the striped stole on her shoulders.' },
      { speaker: 'The Amyrlin Seat', tone: 'ceremony', text: '{name}, you have passed the test for the shawl. Before you take it, you must choose the Ajah that will be your home for the rest of your life. No sister has ever left her Ajah. Choose well.' },
      { speaker: 'The Amyrlin Seat', tone: 'ceremony', text: 'There are seven Ajahs. Some whisper of an eighth, black as the Shadow. That Ajah does not exist. Remember that you heard me say so.' },
    ]);
    let ajahId = null;
    while (!ajahId) {
      const pick = await game.ui.chooseAjah(p);
      const def = AJAHS[pick];
      const confirm = await ctx.ask({
        speaker: `Sitter of the ${def.name}`,
        tone: 'ceremony',
        text: `${def.creed} Will you be one of us, {name}? This cannot be undone.`,
        choices: [
          { label: `I choose the ${def.name} Ajah.`, value: true },
          { label: 'Let me consider the others again.', value: false },
        ],
      });
      if (confirm) ajahId = pick;
    }

    await ctx.say([{ speaker: 'The Amyrlin Seat', tone: 'ceremony', text: 'Take the Oath Rod. Swear upon it, and every word will be bound into your flesh.' }]);
    const OATHS = [
      'Under the Light, I vow to speak no word that is not true.',
      'Under the Light, I vow to make no weapon with which one man may kill another.',
      'Under the Light, I vow never to use the One Power as a weapon except against Shadowspawn, or in the last extreme of defending my life, the life of my Warder, or the life of another sister.',
    ];
    for (const [i, oath] of OATHS.entries()) {
      let sworn = false;
      let hesitated = false;
      while (!sworn) {
        const choice = await ctx.ask({
          speaker: `The ${['First', 'Second', 'Third'][i]} Oath`,
          tone: 'ceremony',
          text: oath,
          choices: hesitated
            ? [{ label: 'Swear it.', value: 'swear' }, { label: 'Refuse the Oath Rod.', value: 'refuse', detail: 'You will be put out of the Tower' }]
            : [{ label: 'Swear it.', value: 'swear' }, { label: 'Hesitate.', value: 'hesitate' }],
        });
        if (choice === 'swear') {
          sworn = true;
          await ctx.say([{ speaker: 'Narrator', tone: 'ceremony', text: 'The Rod is cold. The oath settles into your bones like iron.' }]);
        } else if (choice === 'hesitate') {
          hesitated = true;
          p.prestige -= 5;
          await ctx.say([{ speaker: 'The Amyrlin Seat', tone: 'danger', text: 'The Rod does not wait, child. Swear, or be put out of this Tower forever.' }]);
        } else {
          p.addChronicle('Refused the Oath Rod and was put out of the White Tower.', 'shadow');
          game.pendingEnding = 'oathless';
          return;
        }
      }
    }
    p.promote();
    p.chooseAjah(ajahId);
    p.swearOaths();
    const def = AJAHS[ajahId];
    await ctx.say([
      { speaker: 'Narrator', tone: 'ceremony', text: `A shawl fringed in ${def.name.toLowerCase()} is laid across your shoulders. The Great Serpent ring moves to whichever finger you choose.` },
      { speaker: 'The Amyrlin Seat', tone: 'ceremony', text: 'Rise, {title}.' },
      { speaker: def.passive.name, tone: 'ceremony', text: `${def.passive.description} Mastery Weave: ${WEAVES[def.mastery.weave].name}. ${WEAVES[def.mastery.weave].description}` },
    ]);
  }

  // -- resolution ------------------------------------------------------------------

  async resolve(success, reason = '') {
    const run = this.run;
    if (!run || !run.active) return;
    run.state = success ? 'succeeded' : 'failed';
    if (this.game.state === 'gameover') return;
    const game = this.game;
    game.freezeMission();
    try {
      if (success) await this.applySuccess(run);
      else await this.applyFailure(run.def, reason);
    } catch (err) {
      console.error('[missions] resolution failed', err);
      game.ui.reportError('Something went wrong closing the mission; your progress was kept.');
    }
    if (this.run !== run) return;
    this.unbind();
    this.run = null;
    game.finishMission();
  }

  async applySuccess(run) {
    const game = this.game;
    const p = game.player;
    const def = run.def;
    const ctx = this.context();
    p.outcomes[def.id] = 'success';
    p.counts[def.id] = (p.counts[def.id] ?? 0) + 1;
    const r = typeof def.rewards === 'function' ? def.rewards(run) : def.rewards;
    let bonus = 0;
    const bonusLabels = [];
    for (const o of run.objectives) {
      if (o.optional && o.done && o.reward?.prestige) {
        bonus += o.reward.prestige;
        bonusLabels.push(`${o.label.replace(/^Bonus: /, '')} (+${o.reward.prestige})`);
      }
    }
    if (def.debrief) await def.debrief(run, ctx);
    if (game.pendingEnding) return;
    const { gained, levels } = p.gainXP(r.xp);
    p.prestige += r.prestige + bonus;
    p.adjustStats(r.stats);
    const learned = (r.learn ?? []).filter((id) => p.learn(id)).map((id) => WEAVES[id].name);
    p.addChronicle(`${def.title}: success.`, 'success');
    const lines = [`+${gained} experience${levels ? ` (level ${p.level}!)` : ''}`, `+${r.prestige + bonus} prestige`];
    for (const [k, v] of Object.entries(r.stats ?? {})) lines.push(`${v > 0 ? '+' : ''}${v} ${k}`);
    if (learned.length) lines.push(`Learned: ${learned.join(', ')}`);
    if (bonusLabels.length) lines.push(`Bonus: ${bonusLabels.join('; ')}`);
    if (p.rankIndex === 2 && p.mod('maxWarders', 0)) {
      const record = p.bondWarder();
      if (record) lines.push(`Bonded a new Warder: ${record.name}`);
    }
    if (levels) lines.push(`${levels * 2} stat points to spend in the Tower.`);
    await game.dialogue([{ speaker: 'Mission Complete', tone: 'success', text: `${def.title}\n\n${lines.join('\n')}` }]);
  }

  async applyFailure(def, reason, fromAbandon = false) {
    const game = this.game;
    const p = game.player;
    if (p.outcomes[def.id] !== 'success') p.outcomes[def.id] = 'failed';
    const f = def.failure;
    const lines = [];
    p.prestige += f.prestige;
    lines.push(`${f.prestige} prestige`);
    if (f.strike) {
      p.strikes += 1;
      lines.push(`Strike ${p.strikes} of ${Player.MAX_STRIKES}: the Tower's patience wears thin.`);
    }
    if (f.scar) {
      const scar = p.applyScar(f.scar);
      lines.push(`Permanent scar: ${scar.label} (${Object.entries(SCARS[f.scar].effects).map(([k, v]) => `${v} ${k}`).join(', ')})`);
    }
    const abandoned = fromAbandon || reason === 'abandoned';
    const narrative = abandoned ? `You abandoned ${def.title}. Those who were counting on you were left to their fate.` : f.text(reason);
    p.addChronicle(`${def.title}: failed. ${narrative}`, 'failure');
    await game.dialogue([
      { speaker: 'Mission Failed', tone: 'danger', text: narrative },
      { speaker: 'Consequences', tone: 'danger', text: lines.join('\n') },
    ]);
    if (p.expelled) game.pendingEnding = 'expelled';
  }
}
