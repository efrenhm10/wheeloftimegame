// Enemy definitions, A* pathfinding and AI for Shadowspawn, constructs and human foes.

import { clamp, dist, normalize, RNG } from './util.js';
import { TILE } from './world.js';

/**
 * faction:     'shadowspawn' | 'human' | 'construct' | 'vision'
 * human:       protected by the Third Oath (only harmed by an oath-bound sister in the last extreme)
 * capturable:  can be seized by touch while stunned, rooted, pacified or shielded
 * severable:   channels the One Power and can be shielded / severed
 */
export const ENEMY_TYPES = {
  trolloc: {
    name: 'Trolloc', faction: 'shadowspawn', hp: 46, speed: 82, radius: 14, damage: 11,
    attackRange: 16, attackCooldown: 1.2, windup: 0.35, xp: 14, aggroRange: 300,
    shape: 'trolloc', color: '#7b4b2a', accent: '#3b2414',
  },
  darkhound: {
    name: 'Darkhound', faction: 'shadowspawn', hp: 24, speed: 150, radius: 10, damage: 7,
    attackRange: 12, attackCooldown: 0.8, windup: 0.18, xp: 9, aggroRange: 380,
    shape: 'hound', color: '#141414', accent: '#d0261b',
  },
  myrddraal: {
    name: 'Myrddraal', faction: 'shadowspawn', hp: 150, speed: 112, radius: 13, damage: 19,
    attackRange: 18, attackCooldown: 1.0, windup: 0.3, xp: 70, aggroRange: 440,
    shape: 'fade', color: '#1f1a2b', accent: '#a7a3b5', stunResist: 0.5, dread: 170,
    shadowstep: 7, pacifyImmune: true,
  },
  grayman: {
    name: 'Gray Man', faction: 'shadowspawn', hp: 34, speed: 118, radius: 11, damage: 22,
    attackRange: 14, attackCooldown: 1.4, windup: 0.25, xp: 32, aggroRange: 420,
    shape: 'grayman', color: '#7c7c80', accent: '#4a4a4e', stealth: 115,
  },
  phantom: {
    name: 'Phantom', faction: 'vision', hp: 28, speed: 96, radius: 12, damage: 8,
    attackRange: 14, attackCooldown: 1.0, windup: 0.3, xp: 6, aggroRange: 500,
    shape: 'phantom', color: '#cfd8ff', accent: '#8090c0',
  },
  sentinel: {
    name: 'Ward Sentinel', faction: 'construct', invulnerable: true, hp: 1, speed: 70, radius: 12,
    damage: 8, contactStun: 0.9, xp: 0, shape: 'sentinel', color: '#e2c35b', accent: '#fff3c0',
    passive: true, pacifyImmune: true,
  },
  rift: {
    name: 'Shadow Rift', faction: 'shadowspawn', hp: 180, speed: 0, radius: 22, damage: 0, xp: 45,
    shape: 'rift', color: '#3a0d18', accent: '#ff3b3b', stationary: true, pacifyImmune: true,
    spawner: { types: ['trolloc', 'trolloc', 'darkhound'], interval: 6.5, maxAlive: 4 },
  },
  practice_ward: {
    name: 'Ward-stone', faction: 'construct', hp: 1, speed: 0, radius: 14, damage: 0, xp: 4,
    shape: 'ward', color: '#9c968a', accent: '#ffffff', stationary: true, harmless: true, pacifyImmune: true,
  },
  lattice_lock: {
    name: 'Lattice Lock', faction: 'construct', hp: 1, speed: 0, radius: 18, damage: 0, xp: 20,
    shape: 'lock', color: '#e8eef8', accent: '#9ad9ea', stationary: true, harmless: true, pacifyImmune: true,
  },
  guard: {
    name: 'House Guard', faction: 'human', human: true, capturable: true, hp: 40, speed: 120, radius: 12,
    damage: 10, attackRange: 16, attackCooldown: 1.1, windup: 0.3, xp: 10, aggroRange: 280,
    shape: 'human', color: '#6b5a3a', accent: '#d8c27a', vision: { range: 185, fov: Math.PI * 0.42 },
    patrolSpeed: 62,
  },
  darkfriend: {
    name: 'Darkfriend', faction: 'human', human: true, capturable: true, hp: 36, speed: 96, radius: 11,
    damage: 9, attackRange: 14, attackCooldown: 1.0, windup: 0.28, xp: 12, aggroRange: 300,
    shape: 'human', color: '#2f2f2f', accent: '#a52020',
  },
  questioner: {
    name: 'Questioner of the Hand', faction: 'human', human: true, capturable: true, hp: 170, speed: 100,
    radius: 14, damage: 17, attackRange: 18, attackCooldown: 1.0, windup: 0.32, xp: 60, aggroRange: 360,
    shape: 'human', color: '#ece6d4', accent: '#b52020', stunResist: 0.3,
  },
  champion: {
    name: 'Sworn Champion', faction: 'human', human: true, capturable: true, hp: 150, speed: 104,
    radius: 14, damage: 16, attackRange: 18, attackCooldown: 0.95, windup: 0.3, xp: 55, aggroRange: 360,
    shape: 'human', color: '#2c3e66', accent: '#e0c060', stunResist: 0.3,
  },
  channeler: {
    name: 'Darkfriend Channeler', faction: 'human', human: true, capturable: true, severable: true,
    hp: 60, speed: 80, radius: 11, damage: 7, attackRange: 14, attackCooldown: 1.2, windup: 0.3, xp: 30,
    aggroRange: 420, shape: 'channeler', color: '#3a2048', accent: '#d070ff',
    ranged: { damage: 13, speed: 300, cooldown: 2.2, range: 360, windup: 0.45, color: '#c060f0', keepAway: 190 },
  },
  black_sister: {
    name: 'Black Sister', faction: 'human', human: true, capturable: true, severable: true,
    hp: 150, speed: 92, radius: 12, damage: 10, attackRange: 14, attackCooldown: 1.0, windup: 0.3, xp: 90,
    aggroRange: 460, shape: 'channeler', color: '#101010', accent: '#e04040', stunResist: 0.35,
    ranged: { damage: 18, speed: 340, cooldown: 1.7, range: 400, windup: 0.4, color: '#ff4d4d', keepAway: 220, bind: 1.1 },
  },
  tower_guard: {
    name: 'Tower Guard', faction: 'human', human: true, capturable: true, hp: 48, speed: 100, radius: 12,
    damage: 11, attackRange: 18, attackCooldown: 1.0, windup: 0.3, xp: 14, aggroRange: 360,
    shape: 'human', color: '#d8d4cc', accent: '#c9a64a',
  },
  rebel_sister: {
    name: 'Aes Sedai', faction: 'human', human: true, capturable: true, severable: true,
    hp: 80, speed: 88, radius: 12, damage: 8, attackRange: 14, attackCooldown: 1.1, windup: 0.3, xp: 34,
    aggroRange: 460, shape: 'channeler', color: '#e6e1d6', accent: '#9ad9ea', stunResist: 0.2,
    ranged: { damage: 14, speed: 330, cooldown: 2.0, range: 380, windup: 0.4, color: '#bfe6ff', keepAway: 200, bind: 0.8 },
  },
  rogue_channeler: {
    name: 'Rogue Channeler', faction: 'human', human: true, capturable: true, severable: true,
    hp: 420, speed: 96, radius: 15, damage: 14, attackRange: 18, attackCooldown: 1.0, windup: 0.3, xp: 160,
    aggroRange: 520, shape: 'channeler', color: '#3b3020', accent: '#f0c050', stunResist: 0.4, pacifyImmune: true,
    ranged: { damage: 19, speed: 360, cooldown: 1.35, range: 440, windup: 0.35, color: '#a08040', keepAway: 200, volley: 3 },
    surge: { interval: 7, radius: 125, damage: 24, windup: 0.9 },
    shieldBreak: 6,
  },
};

// ---------------------------------------------------------------------------
// Pathfinding
// ---------------------------------------------------------------------------

class MinHeap {
  constructor() {
    this.items = [];
    this.prio = [];
  }

  get size() {
    return this.items.length;
  }

  push(item, priority) {
    const { items, prio } = this;
    items.push(item);
    prio.push(priority);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (prio[parent] <= prio[i]) break;
      [items[i], items[parent]] = [items[parent], items[i]];
      [prio[i], prio[parent]] = [prio[parent], prio[i]];
      i = parent;
    }
  }

  pop() {
    const { items, prio } = this;
    const top = items[0];
    const lastItem = items.pop();
    const lastPrio = prio.pop();
    if (items.length) {
      items[0] = lastItem;
      prio[0] = lastPrio;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && prio[l] < prio[m]) m = l;
        if (r < items.length && prio[r] < prio[m]) m = r;
        if (m === i) break;
        [items[i], items[m]] = [items[m], items[i]];
        [prio[i], prio[m]] = [prio[m], prio[i]];
        i = m;
      }
    }
    return top;
  }
}

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/** 8-directional A* without corner cutting. Returns world-space waypoints or null. */
export function findPath(map, startX, startY, goalX, goalY, maxExpanded = 6000) {
  const cols = map.cols;
  const start = map.nearestOpenTile(Math.floor(startX / TILE), Math.floor(startY / TILE), 3);
  const goal = map.nearestOpenTile(Math.floor(goalX / TILE), Math.floor(goalY / TILE), 4);
  if (!start || !goal) return null;
  const total = map.cols * map.rows;
  const g = new Float32Array(total).fill(Infinity);
  const came = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const startIdx = start.r * cols + start.c;
  const goalIdx = goal.r * cols + goal.c;
  const h = (c, r) => {
    const dx = Math.abs(c - goal.c);
    const dy = Math.abs(r - goal.r);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };
  const heap = new MinHeap();
  g[startIdx] = 0;
  heap.push(startIdx, h(start.c, start.r));
  let expanded = 0;
  let found = false;
  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    if (cur === goalIdx) {
      found = true;
      break;
    }
    closed[cur] = 1;
    if (++expanded > maxExpanded) break;
    const cc = cur % cols;
    const cr = (cur / cols) | 0;
    for (const [dx, dy, cost] of DIRS) {
      const nc = cc + dx;
      const nr = cr + dy;
      if (map.isSolidTile(nc, nr)) continue;
      if (dx && dy && (map.isSolidTile(cc + dx, cr) || map.isSolidTile(cc, cr + dy))) continue;
      const ni = nr * cols + nc;
      if (closed[ni]) continue;
      const ng = g[cur] + cost;
      if (ng < g[ni]) {
        g[ni] = ng;
        came[ni] = cur;
        heap.push(ni, ng + h(nc, nr));
      }
    }
  }
  if (!found) return null;
  const path = [];
  for (let idx = goalIdx; idx !== startIdx && idx !== -1; idx = came[idx]) {
    path.push({ x: (idx % cols) * TILE + TILE / 2, y: ((idx / cols) | 0) * TILE + TILE / 2 });
  }
  return path.reverse();
}

/**
 * Lightweight steering helper shared by enemies and allied Warders: moves directly when the way
 * is clear, otherwise follows an A* path that is refreshed on a timer or when the goal moves.
 */
export class Navigator {
  constructor() {
    this.path = null;
    this.index = 0;
    this.repath = 0;
    this.goalKey = '';
    this.clearTimer = 0;
    this.direct = false;
  }

  reset() {
    this.path = null;
    this.index = 0;
    this.repath = 0;
  }

  /** Returns a unit direction toward (tx, ty) for a body of the given radius. */
  steer(map, body, tx, ty, dt) {
    this.clearTimer -= dt;
    if (this.clearTimer <= 0) {
      this.clearTimer = 0.18 + Math.random() * 0.08;
      this.direct = map.isPathClear(body.x, body.y, tx, ty, body.radius * 0.9);
    }
    if (this.direct) return normalize(tx - body.x, ty - body.y);
    const key = `${Math.floor(tx / TILE)},${Math.floor(ty / TILE)}`;
    this.repath -= dt;
    if (!this.path || this.repath <= 0 || key !== this.goalKey) {
      this.path = findPath(map, body.x, body.y, tx, ty);
      this.index = 0;
      this.goalKey = key;
      this.repath = 0.55 + Math.random() * 0.3;
    }
    if (!this.path || !this.path.length) return normalize(tx - body.x, ty - body.y);
    while (this.index < this.path.length - 1 && dist(body.x, body.y, this.path[this.index].x, this.path[this.index].y) < 10) {
      this.index++;
    }
    // Skip ahead when a later waypoint is directly reachable to smooth grid zig-zags.
    const ahead = this.path[Math.min(this.index + 1, this.path.length - 1)];
    if (ahead && map.isPathClear(body.x, body.y, ahead.x, ahead.y, body.radius * 0.9)) {
      this.index = Math.min(this.index + 1, this.path.length - 1);
    }
    const node = this.path[this.index];
    return normalize(node.x - body.x, node.y - body.y);
  }
}

// ---------------------------------------------------------------------------
// Enemy
// ---------------------------------------------------------------------------

let nextEnemyId = 1;

export class Enemy {
  constructor(manager, typeId, x, y, opts = {}) {
    const def = ENEMY_TYPES[typeId];
    if (!def) throw new Error(`Unknown enemy type "${typeId}"`);
    this.manager = manager;
    this.id = nextEnemyId++;
    this.type = typeId;
    this.def = def;
    const scale = opts.scale ?? 1;
    this.boss = !!opts.boss;
    this.name = opts.name ?? def.name;
    this.radius = def.radius * (this.boss ? 1.3 : 1);
    this.maxHp = Math.round(def.hp * scale * (this.boss ? 1.8 : 1));
    this.hp = this.maxHp;
    this.damage = def.damage * (opts.damageScale ?? 1 + (scale - 1) * 0.5);
    this.speed = def.speed * (opts.speedScale ?? 1);
    this.xp = Math.round((opts.xp ?? def.xp) * (this.boss ? 2 : 1));
    this.x = x;
    this.y = y;
    this.kx = 0;
    this.ky = 0;
    this.facing = opts.facing ?? Math.random() * Math.PI * 2;
    this.goal = opts.goal ?? null;
    this.alerted = opts.alerted ?? true;
    this.aggroPlayer = false;
    this.preyOnNpcs = !!opts.preyOnNpcs;
    this.linkedTo = opts.linkedTo ?? null;
    this.spawnedBy = opts.spawnedBy ?? null;
    this.patrol = opts.patrol ?? null;
    this.patrolIndex = 0;
    this.requiredElement = opts.requiredElement ?? null;
    this.requiredRecipe = opts.requiredRecipe ?? null;
    this.parley = opts.parley ?? null;
    this.tag = opts.tag ?? null;
    this.label = opts.label ?? null;
    this.nav = new Navigator();
    this.stun = 0;
    this.root = 0;
    this.slow = 0;
    this.slowFactor = 1;
    this.pacify = 0;
    this.shielded = 0;
    this.burn = 0;
    this.burnDps = 0;
    this.attackTimer = 0.4 + Math.random() * 0.6;
    this.windup = 0;
    this.rangedTimer = 1 + Math.random() * 1.5;
    this.rangedWindup = 0;
    this.surgeTimer = def.surge?.interval ?? 0;
    this.surgeWindup = 0;
    this.abilityTimer = def.shadowstep ?? 0;
    this.noSight = 0;
    this.canSee = false;
    this.losTimer = 0;
    this.spawnTimer = def.spawner ? def.spawner.interval * 0.5 : 0;
    this.contactCooldown = 0;
    this.suspicion = 0;
    this.revealed = !def.stealth;
    this.flash = 0;
    this.oathNotice = 0;
    this.wanderAngle = Math.random() * Math.PI * 2;
    this.wanderTimer = 0;
    this.dead = false;
    this.removed = false;
    this.captured = false;
    this.deathTimer = 0;
    this.lastTarget = null;
  }

  get game() {
    return this.manager.game;
  }

  get countsAsHostile() {
    return !this.dead && !this.def.invulnerable && !this.def.harmless;
  }

  get isChanneler() {
    return !!this.def.severable;
  }

  get canBeCaptured() {
    if (!this.def.capturable || this.dead) return false;
    if (this.type === 'rogue_channeler') return this.shielded > 0;
    return this.stun > 0 || this.root > 0 || this.pacify > 0 || this.shielded > 0;
  }

  // -- damage and status ----------------------------------------------------

  /**
   * hit: { source, elements, weaveId, crit, knockback:{x,y,force}, stun, slow, slowFactor, root,
   *        burn, burnDps, pacify, shield, vsMyrddraal }
   * Returns true when the hit was absorbed by this enemy (projectiles stop on it).
   */
  takeDamage(amount, hit = {}) {
    if (this.dead) return false;
    const { effects, events } = this.game;
    if (this.def.invulnerable) {
      if (this.flash <= 0) effects.text(this.x, this.y - this.radius - 6, 'Unharmed', '#e2c35b', 11);
      this.flash = 0.1;
      return true;
    }
    if (this.requiredElement || this.requiredRecipe) return this.resolveWardHit(hit);

    let damage = amount;
    const oathBlocks = amount > 0 && this.def.human && hit.source === 'player' && this.game.player.oathBlocksHarm();
    if (oathBlocks) {
      damage = 0;
      if (this.oathNotice <= 0) {
        effects.text(this.x, this.y - this.radius - 10, 'The Oath binds you', '#f2e6ff', 11);
        this.oathNotice = 1.2;
        events.emit('oathRestrained', this);
      }
    }
    if (damage > 0) {
      if (this.type === 'myrddraal' && hit.vsMyrddraal) damage *= hit.vsMyrddraal;
      if (hit.crit) damage *= hit.critMult ?? 2;
      damage = Math.max(1, Math.round(damage));
      this.hp -= damage;
      this.flash = 0.12;
      effects.text(this.x, this.y - this.radius - 4, hit.crit ? `${damage}!` : damage, hit.crit ? '#ffd84a' : '#fff', hit.crit ? 16 : 13);
      if (hit.burn && hit.burnDps) {
        this.burn = Math.max(this.burn, hit.burn);
        this.burnDps = Math.max(this.burnDps, hit.burnDps);
      }
      if (hit.source === 'player') this.aggroPlayer = true;
      this.alerted = true;
      this.revealed = true;
    }
    const resist = 1 - (this.def.stunResist ?? 0);
    const bossResist = this.boss ? 0.6 : 1;
    if (hit.stun) this.stun = Math.max(this.stun, hit.stun * resist * bossResist);
    if (hit.root) this.root = Math.max(this.root, hit.root * resist * bossResist);
    if (hit.slow) {
      this.slow = Math.max(this.slow, hit.slow);
      this.slowFactor = Math.min(this.slowFactor === 1 ? 1 : this.slowFactor, hit.slowFactor ?? 0.5);
    }
    if (hit.pacify && !this.def.pacifyImmune && !this.boss) this.pacify = Math.max(this.pacify, hit.pacify);
    if (hit.shield && this.isChanneler) this.applyShield(hit.shield);
    if (hit.knockback && !this.def.stationary) {
      const force = hit.knockback.force * (this.boss ? 0.35 : 1);
      this.kx += hit.knockback.x * force;
      this.ky += hit.knockback.y * force;
    }
    if (this.hp <= 0) this.die({ cause: hit.weaveId, erased: !!hit.erase });
    return true;
  }

  applyShield(duration) {
    const cap = this.def.shieldBreak ?? Infinity;
    const wasShielded = this.shielded > 0;
    this.shielded = Math.max(this.shielded, Math.min(duration, cap));
    this.rangedWindup = 0;
    if (!wasShielded) {
      this.game.effects.ring(this.x, this.y, this.radius + 18, '#f2e6ff', 0.6, 3);
      this.game.effects.text(this.x, this.y - this.radius - 14, 'Severed from the Source', '#f2e6ff', 12);
      this.game.events.emit('channelerShielded', this);
    }
  }

  resolveWardHit(hit) {
    const { effects, events } = this.game;
    const elements = hit.elements ?? [];
    let correct;
    if (this.requiredRecipe) {
      correct = elements.length === this.requiredRecipe.length && elements.every((e, i) => e === this.requiredRecipe[i]);
    } else {
      correct = elements.includes(this.requiredElement);
    }
    if (!correct) {
      if (this.flash <= 0) {
        effects.text(this.x, this.y - this.radius - 6, 'Wrong flow', '#ff7b7b', 12);
        events.emit('wardMiss', this, hit);
      }
      this.flash = 0.35;
      return true;
    }
    this.die({ cause: hit.weaveId });
    return true;
  }

  die(info = {}) {
    if (this.dead) return;
    this.dead = true;
    this.deathTimer = info.erased ? 0.05 : 0.45;
    const { effects, events } = this.game;
    if (info.erased) {
      effects.burst(this.x, this.y, '#ffffff', 26, 220, 0.5, 3);
      effects.text(this.x, this.y - 18, 'Erased from the Pattern', '#ffffff', 12);
    } else {
      effects.burst(this.x, this.y, this.def.color === '#141414' ? '#5a1010' : this.def.accent, 14, 140, 0.55, 3);
    }
    events.emit('enemyKilled', this, info);
    if (this.type === 'myrddraal') {
      for (const other of this.manager.list) {
        if (!other.dead && other.linkedTo === this.id) {
          effects.text(other.x, other.y - 18, 'Link severed!', '#c9b6ff', 12);
          other.die({ cause: 'severed', severed: true });
        }
      }
    }
  }

  capture() {
    if (this.dead) return;
    this.captured = true;
    this.dead = true;
    this.deathTimer = 0.3;
    const { effects, events } = this.game;
    effects.ring(this.x, this.y, 30, '#9ad9ea', 0.5, 2);
    effects.text(this.x, this.y - 20, 'Captured', '#9ad9ea', 13);
    events.emit('enemyCaptured', this);
    events.emit('enemyKilled', this, { captured: true });
  }

  tickStatus(dt) {
    this.stun = Math.max(0, this.stun - dt);
    this.root = Math.max(0, this.root - dt);
    this.pacify = Math.max(0, this.pacify - dt);
    this.shielded = Math.max(0, this.shielded - dt);
    this.oathNotice -= dt;
    if (this.slow > 0) {
      this.slow -= dt;
      if (this.slow <= 0) this.slowFactor = 1;
    }
    if (this.burn > 0) {
      this.burn -= dt;
      this.hp -= this.burnDps * dt;
      if (Math.random() < dt * 8) this.game.effects.trail(this.x, this.y - 4, '#ff8a3a', 3);
      if (this.hp <= 0) this.die({ cause: 'burn' });
    }
  }

  // -- update ---------------------------------------------------------------

  update(dt) {
    const game = this.game;
    if (this.dead) {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) this.removed = true;
      return;
    }
    this.flash = Math.max(0, this.flash - dt);
    this.tickStatus(dt);
    if (this.dead) return;

    if (Math.abs(this.kx) + Math.abs(this.ky) > 2) {
      game.map.moveCircle(this, this.kx * dt, this.ky * dt);
      const decay = Math.exp(-7 * dt);
      this.kx *= decay;
      this.ky *= decay;
    } else {
      this.kx = 0;
      this.ky = 0;
    }

    if (this.def.spawner) this.updateSpawner(dt);
    if (this.def.stationary || this.stun > 0) return;
    if (this.def.passive) {
      this.updateSentinel(dt);
      return;
    }
    if (this.def.vision && !this.manager.alarmed) {
      this.updateWatch(dt);
      return;
    }

    const player = game.player;
    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.2 + Math.random() * 0.1;
      const dp = dist(this.x, this.y, player.x, player.y);
      this.canSee = dp < this.def.aggroRange && game.map.lineOfSight(this.x, this.y, player.x, player.y);
      if (this.def.stealth && !this.revealed && dp < this.def.stealth) {
        this.revealed = true;
        game.effects.text(this.x, this.y - 20, 'A Gray Man!', '#cfcfcf', 13);
      }
    }
    if (this.canSee) this.alerted = true;
    this.noSight = this.canSee ? 0 : this.noSight + dt;

    if (this.pacify > 0) {
      this.wander(dt, 0.35);
      return;
    }

    if (this.def.dread && dist(this.x, this.y, player.x, player.y) < this.def.dread) player.dread = 0.25;
    if (this.def.surge) this.updateSurge(dt);
    if (this.def.shadowstep) this.updateShadowstep(dt);

    const target = this.chooseTarget();
    this.lastTarget = target;
    if (!target) {
      if (this.patrol) this.followPatrol(dt, this.speed * 0.6);
      else this.wander(dt, 0.25);
      return;
    }

    const d = dist(this.x, this.y, target.x, target.y);
    const reach = this.radius + target.radius + (this.def.attackRange ?? 14);
    const ranged = this.def.ranged && this.shielded <= 0 && target.kind !== 'structure' ? this.def.ranged : null;
    let desired = reach * 0.85;
    if (ranged && d < ranged.range && this.canSeePoint(target)) {
      desired = ranged.keepAway;
      this.updateRanged(dt, target, ranged);
    }

    if (this.root <= 0 && this.windup <= 0 && this.rangedWindup <= 0) {
      let dir = null;
      if (d > desired) dir = this.nav.steer(game.map, this, target.x, target.y, dt);
      else if (ranged && d < desired * 0.7) dir = normalize(this.x - target.x, this.y - target.y);
      if (dir) {
        const speed = this.speed * (this.slow > 0 ? this.slowFactor : 1);
        game.map.moveCircle(this, dir.x * speed * dt, dir.y * speed * dt);
      }
    }
    this.facing = Math.atan2(target.y - this.y, target.x - this.x);

    if (target.kind === 'point') {
      if (d < target.radius + this.radius) {
        game.events.emit('enemyReachedGoal', this, this.goal);
        this.dead = true;
        this.removed = true;
      }
      return;
    }
    this.updateMelee(dt, target, d <= reach);
  }

  canSeePoint(target) {
    return this.game.map.lineOfSight(this.x, this.y, target.x, target.y);
  }

  /** Picks among the player, bonded Warders, wounded NPCs and objective structures. */
  chooseTarget() {
    const game = this.game;
    const player = game.player;
    const candidates = [];
    const dp = dist(this.x, this.y, player.x, player.y);
    if (this.goal && !this.aggroPlayer && this.canSee && dp < this.def.aggroRange * 0.45) this.aggroPlayer = true;

    if (this.goal && !this.aggroPlayer) {
      if (this.goal.takeDamage) {
        if (!this.goal.destroyed) return { kind: 'structure', ref: this.goal, x: this.goal.x, y: this.goal.y, radius: this.goal.radius };
      } else {
        return { kind: 'point', ref: this.goal, x: this.goal.x, y: this.goal.y, radius: this.goal.radius ?? 20 };
      }
    }

    if (this.preyOnNpcs) {
      let best = null;
      let bestD = Infinity;
      for (const npc of game.allies.npcs) {
        if (!npc.vulnerable) continue;
        const d = dist(this.x, this.y, npc.x, npc.y);
        if (d < bestD) {
          bestD = d;
          best = npc;
        }
      }
      if (best && !(dp < 110 && this.canSee)) return { kind: 'npc', ref: best, x: best.x, y: best.y, radius: best.radius };
    }

    if (!player.downed && (this.alerted || this.canSee)) {
      candidates.push({ kind: 'player', ref: player, x: player.x, y: player.y, radius: player.radius, weight: dp });
    }
    for (const w of game.allies.warders) {
      if (w.downed || w.dead) continue;
      const dw = dist(this.x, this.y, w.x, w.y);
      if (dw > this.def.aggroRange) continue;
      // Warders deliberately draw aggro: they read as closer than they are.
      candidates.push({ kind: 'warder', ref: w, x: w.x, y: w.y, radius: w.radius, weight: dw * 0.65 });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => a.weight - b.weight);
    return candidates[0];
  }

  updateMelee(dt, target, inRange) {
    this.attackTimer -= dt;
    if (this.windup > 0) {
      this.windup -= dt;
      if (this.windup <= 0) {
        const d = dist(this.x, this.y, target.ref.x, target.ref.y);
        if (d <= this.radius + target.radius + (this.def.attackRange ?? 14) + 6) this.strike(target);
        this.attackTimer = this.def.attackCooldown;
      }
      return;
    }
    if (inRange && this.attackTimer <= 0 && this.root <= 0) this.windup = this.def.windup;
  }

  strike(target) {
    const game = this.game;
    switch (target.kind) {
      case 'player':
        game.damagePlayer(this.damage, this);
        break;
      case 'warder':
      case 'npc':
      case 'structure':
        target.ref.takeDamage(this.damage, this);
        break;
      default:
        break;
    }
  }

  updateRanged(dt, target, ranged) {
    this.rangedTimer -= dt;
    if (this.rangedWindup > 0) {
      this.rangedWindup -= dt;
      if (this.rangedWindup <= 0) {
        const volley = ranged.volley ?? 1;
        const base = Math.atan2(target.y - this.y, target.x - this.x);
        for (let i = 0; i < volley; i++) {
          const a = base + (i - (volley - 1) / 2) * 0.16;
          this.manager.fireBolt(this, a, ranged);
        }
        this.rangedTimer = ranged.cooldown;
      }
      return;
    }
    if (this.rangedTimer <= 0 && this.root <= 0) this.rangedWindup = ranged.windup;
  }

  updateSurge(dt) {
    const surge = this.def.surge;
    if (this.shielded > 0) return;
    if (this.surgeWindup > 0) {
      this.surgeWindup -= dt;
      if (this.surgeWindup <= 0) {
        const game = this.game;
        game.effects.ring(this.x, this.y, surge.radius, '#f0c050', 0.5, 5);
        game.effects.burst(this.x, this.y, '#a08040', 30, 260, 0.6, 4);
        game.effects.shake(6, 0.3);
        if (dist(this.x, this.y, game.player.x, game.player.y) < surge.radius + game.player.radius) {
          game.damagePlayer(surge.damage, this);
        }
        for (const w of game.allies.warders) {
          if (!w.downed && dist(this.x, this.y, w.x, w.y) < surge.radius) w.takeDamage(surge.damage, this);
        }
        this.surgeTimer = surge.interval;
      }
      return;
    }
    this.surgeTimer -= dt;
    if (this.surgeTimer <= 0) {
      this.surgeWindup = surge.windup;
      this.game.effects.text(this.x, this.y - 26, 'The taint surges!', '#f0c050', 12);
    }
  }

  updateShadowstep(dt) {
    this.abilityTimer -= dt;
    if (this.abilityTimer > 0 || this.root > 0) return;
    const game = this.game;
    const player = game.player;
    if (player.downed) return;
    const dp = dist(this.x, this.y, player.x, player.y);
    if (!(dp > 260 || this.noSight > 1.5)) return;
    for (let attempt = 0; attempt < 8; attempt++) {
      const a = player.facing + Math.PI + (Math.random() - 0.5) * 1.6;
      const r = 70 + Math.random() * 40;
      const nx = player.x + Math.cos(a) * r;
      const ny = player.y + Math.sin(a) * r;
      if (!game.map.collidesCircle(nx, ny, this.radius)) {
        game.effects.burst(this.x, this.y, '#2a2238', 18, 120, 0.5, 4);
        this.x = nx;
        this.y = ny;
        this.nav.reset();
        game.effects.burst(nx, ny, '#2a2238', 18, 120, 0.5, 4);
        game.effects.text(nx, ny - 22, 'It steps from the shadows', '#b9b3c9', 12);
        this.abilityTimer = this.def.shadowstep;
        this.windup = 0;
        this.attackTimer = 0.6;
        return;
      }
    }
    this.abilityTimer = 1.5;
  }

  updateSpawner(dt) {
    const sp = this.def.spawner;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = sp.interval;
    const alive = this.manager.list.filter((e) => !e.dead && e.spawnedBy === this.id).length;
    if (alive >= sp.maxAlive) return;
    const type = sp.types[Math.floor(Math.random() * sp.types.length)];
    const a = Math.random() * Math.PI * 2;
    this.manager.spawn(type, this.x + Math.cos(a) * 40, this.y + Math.sin(a) * 40, {
      spawnedBy: this.id,
      alerted: true,
      scale: this.spawnScale ?? 1,
    });
  }

  updateSentinel(dt) {
    const game = this.game;
    this.contactCooldown -= dt;
    this.followPatrol(dt, this.speed);
    const p = game.player;
    if (!p.downed && this.contactCooldown <= 0 && dist(this.x, this.y, p.x, p.y) < this.radius + p.radius + 2) {
      game.damagePlayer(this.damage, this, { stun: this.def.contactStun });
      this.contactCooldown = 1.5;
    }
  }

  /** Guards on watch: patrol, sweep a vision cone, build suspicion, then raise the alarm. */
  updateWatch(dt) {
    const game = this.game;
    const p = game.player;
    const vision = this.def.vision;
    if (this.pacify > 0) {
      this.suspicion = Math.max(0, this.suspicion - dt);
      return;
    }
    if (this.root <= 0) this.followPatrol(dt, this.def.patrolSpeed);
    const d = dist(this.x, this.y, p.x, p.y);
    let seen = false;
    if (d < vision.range && !p.downed) {
      let diff = Math.atan2(p.y - this.y, p.x - this.x) - this.facing;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (Math.abs(diff) < vision.fov / 2 && game.map.lineOfSight(this.x, this.y, p.x, p.y)) seen = true;
    }
    if (seen) {
      this.suspicion += dt * (0.45 + 1.7 * (1 - d / vision.range));
      if (this.suspicion >= 1) this.manager.raiseAlarm(this);
    } else {
      this.suspicion = Math.max(0, this.suspicion - dt * 0.35);
    }
  }

  followPatrol(dt, speed) {
    if (!this.patrol || this.patrol.length === 0 || this.root > 0) return;
    const wp = this.patrol[this.patrolIndex % this.patrol.length];
    const d = dist(this.x, this.y, wp.x, wp.y);
    if (d < 8) {
      this.patrolIndex = (this.patrolIndex + 1) % this.patrol.length;
      return;
    }
    const dir = this.nav.steer(this.game.map, this, wp.x, wp.y, dt);
    const s = speed * (this.slow > 0 ? this.slowFactor : 1);
    this.game.map.moveCircle(this, dir.x * s * dt, dir.y * s * dt);
    this.facing = Math.atan2(dir.y, dir.x);
  }

  wander(dt, speedFactor) {
    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) {
      this.wanderTimer = 1 + Math.random() * 1.5;
      this.wanderAngle = Math.random() * Math.PI * 2;
    }
    if (this.root > 0) return;
    const s = this.speed * speedFactor * dt;
    const res = this.game.map.moveCircle(this, Math.cos(this.wanderAngle) * s, Math.sin(this.wanderAngle) * s);
    if (res.blockedX || res.blockedY) this.wanderTimer = 0;
  }

  // -- rendering ------------------------------------------------------------

  isVisibleTo(player) {
    if (!this.def.stealth) return true;
    return this.revealed || player.seesHidden;
  }

  render(ctx, time) {
    const def = this.def;
    const player = this.game.player;
    const visible = this.isVisibleTo(player);
    const fade = this.dead ? Math.max(0, this.deathTimer / 0.45) : 1;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.globalAlpha = fade * (visible ? 1 : 0.1);
    if (def.vision && !this.manager.alarmed && !this.dead) this.renderCone(ctx);

    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, this.radius * 0.7, this.radius, this.radius * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    const flash = this.flash > 0 && !this.dead;
    const body = flash ? '#ffffff' : def.color;
    const r = this.radius;
    switch (def.shape) {
      case 'trolloc':
        ctx.rotate(this.facing);
        ctx.fillStyle = body;
        ctx.fillRect(-r, -r, r * 2, r * 2);
        ctx.fillStyle = def.accent;
        ctx.fillRect(-r + 3, -r + 3, r * 2 - 6, r * 2 - 6);
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.moveTo(r - 2, -r);
        ctx.lineTo(r + 7, -r - 6);
        ctx.lineTo(r - 6, -r + 4);
        ctx.moveTo(r - 2, r);
        ctx.lineTo(r + 7, r + 6);
        ctx.lineTo(r - 6, r - 4);
        ctx.fill();
        ctx.fillRect(r - 2, -4, 8, 8);
        break;
      case 'hound':
        ctx.rotate(this.facing);
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.moveTo(r + 5, 0);
        ctx.lineTo(-r, -r);
        ctx.lineTo(-r * 0.5, 0);
        ctx.lineTo(-r, r);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = def.accent;
        ctx.fillRect(r - 4, -4, 3, 3);
        ctx.fillRect(r - 4, 2, 3, 3);
        break;
      case 'fade':
        ctx.rotate(this.facing);
        ctx.fillStyle = '#0b0910';
        ctx.beginPath();
        ctx.moveTo(-r - 8, -r - 2);
        ctx.lineTo(-r - 8 - Math.sin(time * 6) * 3, r + 2);
        ctx.lineTo(0, r * 0.6);
        ctx.lineTo(0, -r * 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.moveTo(r + 2, 0);
        ctx.lineTo(0, -r);
        ctx.lineTo(-r, 0);
        ctx.lineTo(0, r);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = def.accent;
        ctx.beginPath();
        ctx.ellipse(r * 0.3, 0, 4, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'grayman':
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = def.accent;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'phantom':
        ctx.globalAlpha *= 0.55 + Math.sin(time * 5 + this.id) * 0.2;
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = def.accent;
        ctx.lineWidth = 2;
        ctx.stroke();
        break;
      case 'sentinel':
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = def.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, 0, r + 3, r * 0.45, time * 2, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'rift': {
        const pulse = 1 + Math.sin(time * 4) * 0.08;
        ctx.fillStyle = flash ? '#fff' : def.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * pulse, r * 0.75 * pulse, time * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = def.accent;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.6, r * 0.35, -time, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'ward':
      case 'lock':
        this.renderWard(ctx, time, flash);
        break;
      case 'human':
      case 'channeler':
        ctx.rotate(this.facing);
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = def.accent;
        if (def.shape === 'channeler') {
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2);
          ctx.fill();
          if (this.rangedWindup > 0 || this.surgeWindup > 0) {
            ctx.strokeStyle = def.ranged?.color ?? def.accent;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, r + 6 + Math.sin(time * 30) * 2, 0, Math.PI * 2);
            ctx.stroke();
          }
        } else {
          ctx.fillRect(r - 4, -2, 9, 4);
          ctx.fillRect(-r * 0.6, -r * 0.6, r * 0.5, r * 1.2);
        }
        break;
      default:
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();

    if (this.dead || !visible) return;
    ctx.save();
    ctx.translate(this.x, this.y);
    if (this.windup > 0 || this.surgeWindup > 0) {
      ctx.strokeStyle = '#ff3b3b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, this.surgeWindup > 0 ? this.def.surge.radius * (1 - this.surgeWindup / this.def.surge.windup) : r + 5, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (this.shielded > 0) {
      ctx.strokeStyle = 'rgba(242,230,255,0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(0, 0, r + 8, time * 2, time * 2 + Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (this.root > 0) {
      ctx.strokeStyle = '#cfe8ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, r * 0.6, r + 5, r * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (this.stun > 0) {
      ctx.fillStyle = '#ffe36b';
      for (let i = 0; i < 3; i++) {
        const a = time * 5 + (i * Math.PI * 2) / 3;
        ctx.fillRect(Math.cos(a) * (r + 2) - 2, -r - 6 + Math.sin(a) * 3 - 2, 4, 4);
      }
    }
    if (this.pacify > 0) {
      ctx.fillStyle = 'rgba(220,220,235,0.85)';
      ctx.font = '12px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText('~', 0, -r - 8);
    }
    if (this.slow > 0) {
      ctx.fillStyle = 'rgba(80,150,255,0.25)';
      ctx.beginPath();
      ctx.arc(0, 0, r + 2, 0, Math.PI * 2);
      ctx.fill();
    }
    if (this.canBeCaptured) {
      ctx.strokeStyle = '#9ad9ea';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, r + 12 + Math.sin(time * 6) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    const showBar = !def.invulnerable && !def.harmless && (this.hp < this.maxHp || this.boss);
    if (showBar) {
      const w = Math.max(28, r * 2.4);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(-w / 2, -r - 12, w, 4);
      ctx.fillStyle = this.boss ? '#c94bff' : '#d33';
      ctx.fillRect(-w / 2, -r - 12, w * clamp(this.hp / this.maxHp, 0, 1), 4);
    }
    if (this.boss || this.label || def.vision) {
      ctx.font = '600 11px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = this.boss ? '#e7c6ff' : '#e8e2d0';
      const label = this.label ?? this.name;
      if (this.boss || this.label) ctx.fillText(label, 0, -r - 16);
    }
    ctx.restore();
  }

  renderCone(ctx) {
    const v = this.def.vision;
    const s = clamp(this.suspicion, 0, 1);
    ctx.fillStyle = `rgba(${Math.round(240 + 15 * s)}, ${Math.round(220 - 170 * s)}, 80, ${0.1 + s * 0.2})`;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, v.range, this.facing - v.fov / 2, this.facing + v.fov / 2);
    ctx.closePath();
    ctx.fill();
    if (s > 0.05) {
      ctx.fillStyle = s > 0.66 ? '#ff4b4b' : '#ffd84a';
      ctx.font = '700 14px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText(s > 0.66 ? '!' : '?', 0, -this.radius - 6);
    }
  }

  renderWard(ctx, time, flash) {
    const r = this.radius;
    ctx.fillStyle = flash ? '#7a2a2a' : this.def.color;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i + Math.PI / 6;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    const colors = this.manager.elementColors;
    const glyphs = this.requiredRecipe ?? (this.requiredElement ? [this.requiredElement] : []);
    if (this.def.shape === 'lock') {
      ctx.strokeStyle = '#9ad9ea';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r + 4 + Math.sin(time * 3) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    glyphs.forEach((el, i) => {
      const offset = (i - (glyphs.length - 1) / 2) * 10;
      ctx.fillStyle = colors[el] ?? '#fff';
      ctx.beginPath();
      ctx.arc(offset, 0, glyphs.length > 1 ? 5 : r * 0.45 + Math.sin(time * 4) * 1.2, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class EnemyManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.bolts = [];
    this.alarmed = false;
    this.elementColors = {};
    this.rng = new RNG(99);
  }

  clear() {
    this.list.length = 0;
    this.bolts.length = 0;
    this.alarmed = false;
  }

  spawn(typeId, x, y, opts = {}) {
    const def = ENEMY_TYPES[typeId];
    if (!def) throw new Error(`Unknown enemy type "${typeId}"`);
    const pos = this.game.map.findOpenNear(x, y, def.radius * (opts.boss ? 1.3 : 1));
    const enemy = new Enemy(this, typeId, pos.x, pos.y, opts);
    this.list.push(enemy);
    if (!def.harmless && !opts.silent) this.game.effects.burst(pos.x, pos.y, '#2a1a2a', 10, 90, 0.5, 4);
    return enemy;
  }

  get(id) {
    return this.list.find((e) => e.id === id) ?? null;
  }

  hostiles() {
    return this.list.filter((e) => e.countsAsHostile);
  }

  inRadius(x, y, radius, includeHarmless = false) {
    return this.list.filter((e) => !e.dead && (includeHarmless || !e.def.harmless) && dist(x, y, e.x, e.y) <= radius + e.radius);
  }

  nearest(x, y, maxDist, predicate = (e) => e.countsAsHostile) {
    let best = null;
    let bestD = maxDist;
    for (const e of this.list) {
      if (e.dead || !predicate(e)) continue;
      const d = dist(x, y, e.x, e.y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  raiseAlarm(source) {
    if (this.alarmed) return;
    this.alarmed = true;
    for (const e of this.list) {
      if (e.def.vision) {
        e.alerted = true;
        e.aggroPlayer = true;
      }
    }
    this.game.effects.text(source.x, source.y - 24, 'ALARM!', '#ff4b4b', 18);
    this.game.events.emit('alarm', source);
  }

  fireBolt(owner, angle, ranged) {
    this.bolts.push({
      x: owner.x + Math.cos(angle) * (owner.radius + 4),
      y: owner.y + Math.sin(angle) * (owner.radius + 4),
      vx: Math.cos(angle) * ranged.speed,
      vy: Math.sin(angle) * ranged.speed,
      damage: ranged.damage * (owner.damage / owner.def.damage),
      bind: ranged.bind ?? 0,
      color: ranged.color,
      radius: 6,
      life: ranged.range / ranged.speed + 0.2,
      owner,
    });
  }

  updateBolts(dt) {
    const game = this.game;
    const player = game.player;
    for (const b of this.bolts) {
      b.life -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (Math.random() < 0.6) game.effects.trail(b.x, b.y, b.color, 3);
      if (game.map.isSolidAt(b.x, b.y)) {
        b.life = 0;
        game.effects.burst(b.x, b.y, b.color, 6, 80, 0.3, 2);
        continue;
      }
      if (!player.downed && dist(b.x, b.y, player.x, player.y) < b.radius + player.radius) {
        b.life = 0;
        game.damagePlayer(b.damage, b.owner, { root: b.bind });
        game.effects.burst(b.x, b.y, b.color, 10, 120, 0.4, 3);
        continue;
      }
      for (const w of game.allies.warders) {
        if (!w.downed && !w.dead && dist(b.x, b.y, w.x, w.y) < b.radius + w.radius) {
          b.life = 0;
          w.takeDamage(b.damage, b.owner);
          break;
        }
      }
    }
    this.bolts = this.bolts.filter((b) => b.life > 0);
  }

  update(dt) {
    for (const e of this.list) e.update(dt);
    this.separate();
    this.captureCheck();
    this.updateBolts(dt);
    this.list = this.list.filter((e) => !e.removed);
  }

  separate() {
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.dead || a.def.stationary) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.dead) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = a.radius + b.radius;
        const dSq = dx * dx + dy * dy;
        if (dSq >= min * min || dSq < 1e-6) continue;
        const d = Math.sqrt(dSq);
        const push = (min - d) / 2;
        const nx = dx / d;
        const ny = dy / d;
        this.game.map.moveCircle(a, -nx * push, -ny * push);
        if (!b.def.stationary) this.game.map.moveCircle(b, nx * push, ny * push);
      }
    }
  }

  captureCheck() {
    const p = this.game.player;
    if (p.downed) return;
    for (const e of this.list) {
      if (e.canBeCaptured && dist(e.x, e.y, p.x, p.y) < e.radius + p.radius + 14) e.capture();
    }
  }

  render(ctx, time) {
    const sorted = this.list.slice().sort((a, b) => a.y - b.y);
    for (const e of sorted) e.render(ctx, time);
    for (const b of this.bolts) {
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
