// Tile maps, collision, line of sight, fog of war and transient visual effects.

import { clamp, RNG } from './util.js';

export const TILE = 32;

export const T = Object.freeze({
  GRASS: 0,
  PATH: 1,
  FLOOR: 2,
  WALL: 3,
  HEDGE: 4,
  WATER: 5,
  RUBBLE: 6,
  MARBLE: 7,
  SHELF: 8,
  PILLAR: 9,
  CARPET: 10,
  DIRT: 11,
  DOOR: 12,
  SECRET: 13,
  PASSAGE: 14,
  WOOD: 15,
  BLIGHT: 16,
});

const TILE_INFO = {
  [T.GRASS]: { solid: false, opaque: false, base: '#2f4a2a', accent: '#3a5a33', mini: '#3c5a35' },
  [T.PATH]: { solid: false, opaque: false, base: '#857a60', accent: '#978b6e', mini: '#9a8e70' },
  [T.FLOOR]: { solid: false, opaque: false, base: '#3d3d46', accent: '#4a4a55', mini: '#55555f' },
  [T.WALL]: { solid: true, opaque: true, base: '#c9c4b8', accent: '#a9a397', mini: '#e8e4da' },
  [T.HEDGE]: { solid: true, opaque: true, base: '#1d3a1f', accent: '#2b5230', mini: '#1f4a24' },
  [T.WATER]: { solid: true, opaque: false, base: '#2a5c87', accent: '#4d84b3', mini: '#3570a5' },
  [T.RUBBLE]: { solid: false, opaque: false, base: '#5f584c', accent: '#7c7464', mini: '#7a7262' },
  [T.MARBLE]: { solid: false, opaque: false, base: '#cfcac0', accent: '#bdb7ab', mini: '#d8d3c8' },
  [T.SHELF]: { solid: true, opaque: true, base: '#4e321d', accent: '#6c4628', mini: '#6e4a2c' },
  [T.PILLAR]: { solid: true, opaque: true, base: '#b5afa3', accent: '#e2ddd2', mini: '#e0dbd0' },
  [T.CARPET]: { solid: false, opaque: false, base: '#561c27', accent: '#6c2633', mini: '#7a2c3a' },
  [T.DIRT]: { solid: false, opaque: false, base: '#4a3a2a', accent: '#5a4834', mini: '#5d4a36' },
  [T.DOOR]: { solid: true, opaque: true, base: '#6b4a2b', accent: '#8f6a3f', mini: '#c08a4a' },
  [T.SECRET]: { solid: true, opaque: true, base: '#c4bfb2', accent: '#a9a397', mini: '#e8e4da' },
  [T.PASSAGE]: { solid: false, opaque: false, base: '#59534a', accent: '#6b6458', mini: '#b49bff' },
  [T.WOOD]: { solid: false, opaque: false, base: '#5c4128', accent: '#6d4d30', mini: '#7a5a3a' },
  [T.BLIGHT]: { solid: false, opaque: false, base: '#3a2f1c', accent: '#5a3d1e', mini: '#5a4520' },
};

export const tileCenter = (index) => index * TILE + TILE / 2;

export class TileMap {
  constructor(cols, rows, fill = T.GRASS, seed = 1) {
    this.cols = cols;
    this.rows = rows;
    this.tiles = new Uint8Array(cols * rows).fill(fill);
    this.explored = new Uint8Array(cols * rows);
    this.seed = seed;
    this.cache = null;
    this.dirty = true;
    this.background = '#0d0c12';
  }

  get width() {
    return this.cols * TILE;
  }

  get height() {
    return this.rows * TILE;
  }

  inBounds(c, r) {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows;
  }

  get(c, r) {
    return this.inBounds(c, r) ? this.tiles[r * this.cols + c] : T.WALL;
  }

  set(c, r, tile) {
    if (!this.inBounds(c, r)) return;
    this.tiles[r * this.cols + c] = tile;
    this.dirty = true;
  }

  rect(c, r, w, h, tile) {
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) this.set(x, y, tile);
  }

  outline(c, r, w, h, tile) {
    for (let x = c; x < c + w; x++) {
      this.set(x, r, tile);
      this.set(x, r + h - 1, tile);
    }
    for (let y = r; y < r + h; y++) {
      this.set(c, y, tile);
      this.set(c + w - 1, y, tile);
    }
  }

  isSolidTile(c, r) {
    return TILE_INFO[this.get(c, r)].solid;
  }

  isOpaqueTile(c, r) {
    return TILE_INFO[this.get(c, r)].opaque;
  }

  isSolidAt(x, y) {
    return this.isSolidTile(Math.floor(x / TILE), Math.floor(y / TILE));
  }

  collidesCircle(x, y, radius) {
    const minC = Math.floor((x - radius) / TILE);
    const maxC = Math.floor((x + radius) / TILE);
    const minR = Math.floor((y - radius) / TILE);
    const maxR = Math.floor((y + radius) / TILE);
    const rSq = radius * radius;
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        if (!this.isSolidTile(c, r)) continue;
        const nx = clamp(x, c * TILE, c * TILE + TILE);
        const ny = clamp(y, r * TILE, r * TILE + TILE);
        const dx = x - nx;
        const dy = y - ny;
        if (dx * dx + dy * dy < rSq) return true;
      }
    }
    return false;
  }

  /** Axis-separated movement with sub-stepping so fast bodies never tunnel through walls. */
  moveCircle(body, dx, dy, radius = body.radius) {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 4));
    const sx = dx / steps;
    const sy = dy / steps;
    let blockedX = false;
    let blockedY = false;
    for (let i = 0; i < steps; i++) {
      if (!blockedX) {
        if (this.collidesCircle(body.x + sx, body.y, radius)) blockedX = true;
        else body.x += sx;
      }
      if (!blockedY) {
        if (this.collidesCircle(body.x, body.y + sy, radius)) blockedY = true;
        else body.y += sy;
      }
    }
    return { blockedX, blockedY };
  }

  lineOfSight(x0, y0, x1, y1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const steps = Math.ceil(len / (TILE / 4));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.isOpaqueTile(Math.floor((x0 + dx * t) / TILE), Math.floor((y0 + dy * t) / TILE))) return false;
    }
    return true;
  }

  /** True when a circle of the given radius can slide from one point to another unobstructed. */
  isPathClear(x0, y0, x1, y1, radius) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(len / Math.max(6, radius * 0.75)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (this.collidesCircle(x0 + dx * t, y0 + dy * t, radius)) return false;
    }
    return true;
  }

  /** Distance along a ray until the first solid tile, capped at maxDist. */
  raycast(x, y, angle, maxDist) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (let d = 0; d <= maxDist; d += 4) {
      if (this.isSolidAt(x + cos * d, y + sin * d)) return { distance: d, x: x + cos * d, y: y + sin * d };
    }
    return { distance: maxDist, x: x + cos * maxDist, y: y + sin * maxDist };
  }

  nearestOpenTile(c, r, maxRing = 10) {
    if (this.inBounds(c, r) && !this.isSolidTile(c, r)) return { c, r };
    for (let ring = 1; ring <= maxRing; ring++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const nc = c + dx;
          const nr = r + dy;
          if (this.inBounds(nc, nr) && !this.isSolidTile(nc, nr)) return { c: nc, r: nr };
        }
      }
    }
    return null;
  }

  /** Returns a free world position near (x, y) that fits a circle of radius. */
  findOpenNear(x, y, radius = 12) {
    if (!this.collidesCircle(x, y, radius)) return { x, y };
    const c0 = Math.floor(x / TILE);
    const r0 = Math.floor(y / TILE);
    for (let ring = 0; ring <= 12; ring++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const px = (c0 + dx) * TILE + TILE / 2;
          const py = (r0 + dy) * TILE + TILE / 2;
          if (this.inBounds(c0 + dx, r0 + dy) && !this.collidesCircle(px, py, radius)) return { x: px, y: py };
        }
      }
    }
    return { x, y };
  }

  /** Flood fill of walkable tiles from a world position; used to validate procedural spawns. */
  reachableFrom(x, y) {
    const seen = new Uint8Array(this.cols * this.rows);
    const start = this.nearestOpenTile(Math.floor(x / TILE), Math.floor(y / TILE));
    if (!start) return seen;
    const stack = [start.r * this.cols + start.c];
    seen[stack[0]] = 1;
    while (stack.length) {
      const idx = stack.pop();
      const c = idx % this.cols;
      const r = (idx / this.cols) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dx;
        const nr = r + dy;
        if (!this.inBounds(nc, nr) || this.isSolidTile(nc, nr)) continue;
        const ni = nr * this.cols + nc;
        if (seen[ni]) continue;
        seen[ni] = 1;
        stack.push(ni);
      }
    }
    return seen;
  }

  revealSecret(c, r) {
    if (this.get(c, r) !== T.SECRET) return false;
    this.set(c, r, T.PASSAGE);
    return true;
  }

  revealAllSecrets() {
    let count = 0;
    for (let i = 0; i < this.tiles.length; i++) {
      if (this.tiles[i] === T.SECRET) {
        this.tiles[i] = T.PASSAGE;
        count++;
      }
    }
    if (count) this.dirty = true;
    return count;
  }

  /** Marks tiles within radius (in tiles) that are in line of sight as explored. */
  explore(x, y, radiusTiles) {
    const c0 = Math.floor(x / TILE);
    const r0 = Math.floor(y / TILE);
    const rSq = radiusTiles * radiusTiles;
    for (let r = r0 - radiusTiles; r <= r0 + radiusTiles; r++) {
      for (let c = c0 - radiusTiles; c <= c0 + radiusTiles; c++) {
        if (!this.inBounds(c, r)) continue;
        const idx = r * this.cols + c;
        if (this.explored[idx]) continue;
        const dc = c - c0;
        const dr = r - r0;
        if (dc * dc + dr * dr > rSq) continue;
        if (this.lineOfSight(x, y, c * TILE + TILE / 2, r * TILE + TILE / 2) || this.isOpaqueTile(c, r)) {
          this.explored[idx] = 1;
        }
      }
    }
  }

  exploreAll() {
    this.explored.fill(1);
  }

  miniColor(c, r) {
    return TILE_INFO[this.get(c, r)].mini;
  }

  buildCache() {
    if (typeof document === 'undefined') return;
    if (!this.cache) {
      this.cache = document.createElement('canvas');
    }
    this.cache.width = this.width;
    this.cache.height = this.height;
    const g = this.cache.getContext('2d');
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) drawTile(g, this.get(c, r), c, r, this.seed);
    }
    this.dirty = false;
  }

  render(ctx, view) {
    if (this.dirty || !this.cache) this.buildCache();
    if (!this.cache) return;
    const sx = clamp(Math.floor(view.x), 0, this.width);
    const sy = clamp(Math.floor(view.y), 0, this.height);
    const sw = clamp(Math.ceil(view.w) + 2, 0, this.width - sx);
    const sh = clamp(Math.ceil(view.h) + 2, 0, this.height - sy);
    if (sw > 0 && sh > 0) ctx.drawImage(this.cache, sx, sy, sw, sh, sx, sy, sw, sh);
  }
}

function tileHash(c, r, seed) {
  let h = (c * 374761393 + r * 668265263 + seed * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function drawTile(g, tile, c, r, seed) {
  const info = TILE_INFO[tile];
  const x = c * TILE;
  const y = r * TILE;
  const h = tileHash(c, r, seed);
  g.fillStyle = info.base;
  g.fillRect(x, y, TILE, TILE);
  g.fillStyle = info.accent;
  switch (tile) {
    case T.GRASS:
    case T.DIRT:
    case T.BLIGHT:
      for (let i = 0; i < 4; i++) {
        const px = x + tileHash(c + i, r, seed + 7) * (TILE - 3);
        const py = y + tileHash(c, r + i, seed + 13) * (TILE - 3);
        g.fillRect(px, py, 2, tile === T.GRASS ? 4 : 2);
      }
      if (tile === T.BLIGHT && h > 0.6) {
        g.fillStyle = '#6b2a1a';
        g.fillRect(x + h * 20, y + 8, 3, 3);
      }
      break;
    case T.PATH:
    case T.RUBBLE:
      for (let i = 0; i < (tile === T.RUBBLE ? 6 : 3); i++) {
        const px = x + tileHash(c, r + i, seed + 3) * (TILE - 6);
        const py = y + tileHash(c + i, r, seed + 5) * (TILE - 6);
        g.fillRect(px, py, tile === T.RUBBLE ? 6 : 4, tile === T.RUBBLE ? 5 : 3);
      }
      break;
    case T.WALL:
    case T.SECRET:
      g.fillRect(x, y + TILE / 2 - 1, TILE, 2);
      g.fillRect(x + (r % 2 ? TILE / 2 : 0), y, 2, TILE / 2);
      g.fillRect(x + (r % 2 ? 0 : TILE / 2), y + TILE / 2, 2, TILE / 2);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(x, y, TILE, 3);
      if (tile === T.SECRET) {
        g.strokeStyle = 'rgba(70,60,50,0.35)';
        g.beginPath();
        g.moveTo(x + 8, y + 4);
        g.lineTo(x + 14, y + 16);
        g.lineTo(x + 10, y + 28);
        g.stroke();
      }
      break;
    case T.HEDGE:
      for (let i = 0; i < 4; i++) {
        g.beginPath();
        g.arc(x + 8 + (i % 2) * 16, y + 8 + Math.floor(i / 2) * 16, 9, 0, Math.PI * 2);
        g.fill();
      }
      break;
    case T.WATER:
      g.fillRect(x + 4 + h * 10, y + 10, 10, 2);
      g.fillRect(x + 14 - h * 8, y + 22, 12, 2);
      break;
    case T.MARBLE:
      if (h > 0.55) {
        g.strokeStyle = info.accent;
        g.beginPath();
        g.moveTo(x, y + h * TILE);
        g.lineTo(x + TILE, y + (1 - h) * TILE);
        g.stroke();
      }
      g.fillStyle = 'rgba(0,0,0,0.06)';
      g.fillRect(x, y, TILE, 1);
      g.fillRect(x, y, 1, TILE);
      break;
    case T.SHELF: {
      const colors = ['#8c2f2f', '#2f4f8c', '#2f7a46', '#b08a3a', '#5e3a7a'];
      for (let i = 0; i < 6; i++) {
        g.fillStyle = colors[Math.floor(tileHash(c + i, r, seed) * colors.length)];
        g.fillRect(x + 2 + i * 5, y + 4, 4, 10);
        g.fillRect(x + 2 + i * 5, y + 18, 4, 10);
      }
      break;
    }
    case T.PILLAR:
      g.fillStyle = '#3d3d46';
      g.fillRect(x, y, TILE, TILE);
      g.fillStyle = info.base;
      g.beginPath();
      g.arc(x + TILE / 2, y + TILE / 2, TILE / 2 - 2, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = info.accent;
      g.beginPath();
      g.arc(x + TILE / 2 - 3, y + TILE / 2 - 3, TILE / 4, 0, Math.PI * 2);
      g.fill();
      break;
    case T.CARPET:
      g.fillRect(x, y + 3, TILE, 2);
      g.fillRect(x, y + TILE - 5, TILE, 2);
      break;
    case T.DOOR:
      g.fillRect(x + 3, y, 4, TILE);
      g.fillRect(x + TILE - 7, y, 4, TILE);
      g.fillStyle = '#d6b36a';
      g.fillRect(x + TILE / 2 - 2, y + TILE / 2 - 2, 4, 4);
      break;
    case T.PASSAGE:
      g.fillRect(x + 4, y + 4, TILE - 8, TILE - 8);
      break;
    case T.WOOD:
      for (let i = 0; i < 4; i++) g.fillRect(x, y + i * 8, TILE, 1);
      break;
    default:
      if (h > 0.7) g.fillRect(x + h * 20, y + h * 16, 3, 3);
  }
}

/** Particles, floating combat text, shockwave rings, beams and screen shake. */
export class Effects {
  constructor() {
    this.particles = [];
    this.texts = [];
    this.rings = [];
    this.beams = [];
    this.shakeMag = 0;
    this.shakeTime = 0;
    this.rng = new RNG(7);
    this.maxParticles = 1400;
  }

  clear() {
    this.particles.length = 0;
    this.texts.length = 0;
    this.rings.length = 0;
    this.beams.length = 0;
    this.shakeMag = 0;
    this.shakeTime = 0;
  }

  burst(x, y, color, count = 12, speed = 120, life = 0.6, size = 3) {
    for (let i = 0; i < count && this.particles.length < this.maxParticles; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const s = this.rng.range(speed * 0.3, speed);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: this.rng.range(life * 0.5, life),
        max: life,
        color,
        size: this.rng.range(size * 0.6, size * 1.3),
      });
    }
  }

  trail(x, y, color, size = 2.5) {
    if (this.particles.length >= this.maxParticles) return;
    this.particles.push({
      x: x + this.rng.range(-2, 2),
      y: y + this.rng.range(-2, 2),
      vx: this.rng.range(-15, 15),
      vy: this.rng.range(-15, 15),
      life: 0.3,
      max: 0.3,
      color,
      size,
    });
  }

  ring(x, y, radius, color, life = 0.45, width = 3) {
    this.rings.push({ x, y, radius, color, life, max: life, width });
  }

  beam(x1, y1, x2, y2, color, width = 4, life = 0.25) {
    this.beams.push({ x1, y1, x2, y2, color, width, life, max: life });
  }

  text(x, y, value, color = '#fff', size = 14) {
    if (this.texts.length > 80) this.texts.shift();
    this.texts.push({ x, y, value: String(value), color, size, life: 1, max: 1 });
  }

  shake(magnitude, duration = 0.25) {
    this.shakeMag = Math.max(this.shakeMag, magnitude);
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

  shakeOffset() {
    if (this.shakeTime <= 0) return { x: 0, y: 0 };
    return { x: this.rng.range(-1, 1) * this.shakeMag, y: this.rng.range(-1, 1) * this.shakeMag };
  }

  update(dt) {
    const step = (list, fn) => {
      let w = 0;
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        item.life -= dt;
        if (item.life > 0) {
          if (fn) fn(item);
          list[w++] = item;
        }
      }
      list.length = w;
    };
    const drag = Math.exp(-3 * dt);
    step(this.particles, (p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= drag;
      p.vy *= drag;
    });
    step(this.texts, (t) => {
      t.y -= 32 * dt;
    });
    step(this.rings);
    step(this.beams);
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      if (this.shakeTime <= 0) this.shakeMag = 0;
    }
  }

  render(ctx) {
    for (const r of this.rings) {
      const t = 1 - r.life / r.max;
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width;
      ctx.beginPath();
      ctx.arc(r.x, r.y, Math.max(1, r.radius * (0.25 + 0.75 * t)), 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const b of this.beams) {
      ctx.globalAlpha = b.life / b.max;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = b.width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(b.x1, b.y1);
      ctx.lineTo(b.x2, b.y2);
      ctx.stroke();
    }
    for (const p of this.particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    for (const t of this.texts) {
      ctx.globalAlpha = clamp(t.life / t.max + 0.2, 0, 1);
      ctx.font = `600 ${t.size}px Georgia, serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(t.value, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.value, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }
}
