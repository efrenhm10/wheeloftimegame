// Friendly entities: bonded Warders (Green Ajah), wounded civilians and defendable structures.

import { clamp, dist } from './util.js';
import { Navigator } from './enemies.js';

export const WARDER_COMMANDS = Object.freeze({
  guard: { id: 'guard', label: 'Guard me', description: 'Warders stay close and cut down anything that nears you.' },
  engage: { id: 'engage', label: 'Engage', description: 'Warders charge the nearest Shadowspawn and hold their attention.' },
});

const BLEED_OUT_SECONDS = 18;

export class Warder {
  constructor(manager, record, slot, x, y) {
    this.manager = manager;
    this.record = record;
    this.name = record.name;
    this.slot = slot;
    this.x = x;
    this.y = y;
    this.radius = 12;
    const level = manager.game.player.level;
    this.maxHp = 90 + level * 7;
    this.hp = this.maxHp;
    this.speed = 165;
    this.damage = 13 + level * 1.4;
    this.attackCooldown = 0.85;
    this.attackTimer = 0;
    this.windup = 0;
    this.nav = new Navigator();
    this.downed = false;
    this.dead = false;
    this.bleed = 0;
    this.facing = 0;
    this.flash = 0;
    this.target = null;
  }

  get game() {
    return this.manager.game;
  }

  takeDamage(amount) {
    if (this.downed || this.dead) return;
    this.hp -= amount * 0.85;
    this.flash = 0.12;
    this.game.effects.text(this.x, this.y - 18, Math.round(amount * 0.85), '#ffb0b0', 11);
    if (this.hp <= 0) {
      this.hp = 0;
      this.downed = true;
      this.bleed = BLEED_OUT_SECONDS;
      this.game.effects.text(this.x, this.y - 26, `${this.name} falls!`, '#ff8080', 13);
      this.game.events.emit('warderDowned', this);
    }
  }

  heal(amount) {
    if (this.dead) return false;
    if (this.downed) {
      this.downed = false;
      this.hp = this.maxHp * 0.45;
      this.game.effects.text(this.x, this.y - 24, `${this.name} rises`, '#9effa0', 13);
      this.game.events.emit('warderRevived', this);
      return true;
    }
    if (this.hp >= this.maxHp) return false;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    return true;
  }

  update(dt) {
    if (this.dead) return;
    const game = this.game;
    this.flash = Math.max(0, this.flash - dt);
    if (this.downed) {
      this.bleed -= dt;
      if (this.bleed <= 0) {
        this.dead = true;
        this.record.alive = false;
        game.events.emit('warderDied', this);
      }
      return;
    }
    const player = game.player;
    const command = this.manager.command;
    const anchorRange = command === 'guard' ? 190 : 520;
    const anchorX = command === 'guard' ? player.x : this.x;
    const anchorY = command === 'guard' ? player.y : this.y;
    if (!this.target || this.target.dead || dist(anchorX, anchorY, this.target.x, this.target.y) > anchorRange) {
      this.target = game.enemies.nearest(anchorX, anchorY, anchorRange, (e) => e.countsAsHostile && e.isVisibleTo(player));
    }
    this.attackTimer -= dt;
    if (this.target) {
      const t = this.target;
      const d = dist(this.x, this.y, t.x, t.y);
      const reach = this.radius + t.radius + 10;
      this.facing = Math.atan2(t.y - this.y, t.x - this.x);
      if (this.windup > 0) {
        this.windup -= dt;
        if (this.windup <= 0) {
          if (d <= reach + 6) {
            t.takeDamage(this.damage, { source: 'warder', knockback: { x: Math.cos(this.facing), y: Math.sin(this.facing), force: 90 } });
            game.effects.beam(this.x, this.y, t.x, t.y, '#d8e0e8', 2, 0.1);
          }
          this.attackTimer = this.attackCooldown;
        }
        return;
      }
      if (d > reach) {
        const dir = this.nav.steer(game.map, this, t.x, t.y, dt);
        game.map.moveCircle(this, dir.x * this.speed * dt, dir.y * this.speed * dt);
      } else if (this.attackTimer <= 0) {
        this.windup = 0.18;
      }
      return;
    }
    // No foe: hold formation around the sister.
    const angle = player.facing + Math.PI + (this.slot - 1) * 0.8;
    const fx = player.x + Math.cos(angle) * 52;
    const fy = player.y + Math.sin(angle) * 52;
    const d = dist(this.x, this.y, fx, fy);
    if (d > 14) {
      const dir = this.nav.steer(game.map, this, fx, fy, dt);
      const speed = this.speed * clamp(d / 80, 0.4, 1.2);
      game.map.moveCircle(this, dir.x * speed * dt, dir.y * speed * dt);
      this.facing = Math.atan2(dir.y, dir.x);
    }
  }

  render(ctx, time) {
    if (this.dead) return;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 8, 12, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    if (this.downed) {
      ctx.fillStyle = '#5c6b5c';
      ctx.beginPath();
      ctx.ellipse(0, 0, 14, 7, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff6b6b';
      ctx.font = '600 10px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.ceil(this.bleed)}s`, 0, -12);
      ctx.restore();
      return;
    }
    ctx.rotate(this.facing);
    // The colour-shifting Warder cloak.
    const hue = (time * 40 + this.slot * 70) % 360;
    ctx.fillStyle = this.flash > 0 ? '#fff' : `hsla(${hue}, 25%, 45%, 0.85)`;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2e4a33';
    ctx.beginPath();
    ctx.arc(0, 0, this.radius * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#e6edf2';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(6, 4);
    ctx.lineTo(this.windup > 0 ? 24 : 18, this.windup > 0 ? -6 : 8);
    ctx.stroke();
    ctx.restore();
    if (this.hp < this.maxHp) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(this.x - 14, this.y - 20, 28, 3);
      ctx.fillStyle = '#5fd36a';
      ctx.fillRect(this.x - 14, this.y - 20, 28 * clamp(this.hp / this.maxHp, 0, 1), 3);
    }
  }
}

/** Fever-stricken civilian whose life drains until a healing weave mends them fully. */
export class WoundedNPC {
  constructor(manager, opts) {
    this.manager = manager;
    this.name = opts.name;
    this.x = opts.x;
    this.y = opts.y;
    this.radius = 11;
    this.maxHp = 100;
    this.hp = opts.hp ?? 45;
    this.drain = opts.drain ?? 1.4;
    this.saved = false;
    this.dead = false;
    this.flash = 0;
  }

  get vulnerable() {
    return !this.saved && !this.dead;
  }

  heal(amount) {
    if (!this.vulnerable) return false;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    this.manager.game.effects.text(this.x, this.y - 18, `+${Math.round(amount)}`, '#9effa0', 11);
    if (this.hp >= this.maxHp) {
      this.saved = true;
      this.manager.game.effects.ring(this.x, this.y, 36, '#ffe680', 0.7, 3);
      this.manager.game.events.emit('npcSaved', this);
    }
    return true;
  }

  takeDamage(amount) {
    if (!this.vulnerable) return;
    this.hp -= amount;
    this.flash = 0.15;
    if (this.hp <= 0) this.die();
  }

  die() {
    this.dead = true;
    this.hp = 0;
    this.manager.game.effects.text(this.x, this.y - 18, `${this.name} is lost`, '#ff8080', 12);
    this.manager.game.events.emit('npcDied', this);
  }

  update(dt) {
    if (!this.vulnerable) return;
    this.flash = Math.max(0, this.flash - dt);
    this.hp -= this.drain * dt;
    if (this.hp <= 0) this.die();
  }

  render(ctx, time) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.globalAlpha = this.dead ? 0.35 : 1;
    ctx.fillStyle = this.flash > 0 ? '#fff' : this.saved ? '#d8c98f' : '#a58f6a';
    ctx.beginPath();
    ctx.ellipse(0, 0, 14, 7, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8cfa8';
    ctx.beginPath();
    ctx.arc(-10, -3, 5, 0, Math.PI * 2);
    ctx.fill();
    if (this.vulnerable) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(-15, -18, 30, 4);
      ctx.fillStyle = this.hp < 25 ? '#ff5050' : '#f0d060';
      ctx.fillRect(-15, -18, 30 * clamp(this.hp / this.maxHp, 0, 1), 4);
      if (this.hp < 25) {
        ctx.strokeStyle = `rgba(255,80,80,${0.4 + Math.sin(time * 8) * 0.3})`;
        ctx.beginPath();
        ctx.arc(0, 0, 20, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (this.saved) {
      ctx.fillStyle = '#ffe680';
      ctx.font = '700 14px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText('+', 0, -12);
    }
    ctx.restore();
  }
}

/** A door, watchtower or ward that Shadowspawn try to batter down. */
export class Structure {
  constructor(manager, opts) {
    this.manager = manager;
    this.id = opts.id;
    this.name = opts.name;
    this.x = opts.x;
    this.y = opts.y;
    this.radius = opts.radius ?? 22;
    this.maxHp = opts.hp ?? 100;
    this.hp = this.maxHp;
    this.color = opts.color ?? '#8f6a3f';
    this.destroyed = false;
    this.flash = 0;
  }

  takeDamage(amount) {
    if (this.destroyed) return;
    this.hp = Math.max(0, this.hp - amount);
    this.flash = 0.15;
    const game = this.manager.game;
    game.effects.burst(this.x, this.y, '#c9a46b', 6, 90, 0.4, 3);
    game.events.emit('structureDamaged', this);
    if (this.hp <= 0) {
      this.destroyed = true;
      game.effects.shake(8, 0.4);
      game.effects.burst(this.x, this.y, '#c9a46b', 40, 220, 0.8, 5);
      game.events.emit('structureDestroyed', this);
    }
  }

  render(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.globalAlpha = this.destroyed ? 0.4 : 1;
    ctx.strokeStyle = this.flash > 0 ? '#fff' : this.color;
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    const w = 52;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(-w / 2, -this.radius - 14, w, 5);
    ctx.fillStyle = this.hp / this.maxHp < 0.3 ? '#ff5050' : '#e0c070';
    ctx.fillRect(-w / 2, -this.radius - 14, w * clamp(this.hp / this.maxHp, 0, 1), 5);
    ctx.font = '600 11px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f0e6d0';
    ctx.fillText(this.name, 0, -this.radius - 18);
    ctx.restore();
  }
}

export class AllyManager {
  constructor(game) {
    this.game = game;
    this.warders = [];
    this.npcs = [];
    this.structures = [];
    this.command = 'guard';
  }

  clear() {
    this.warders.length = 0;
    this.npcs.length = 0;
    this.structures.length = 0;
    this.command = 'guard';
  }

  spawnWarders(roster, x, y) {
    roster
      .filter((r) => r.alive)
      .forEach((record, i) => {
        const pos = this.game.map.findOpenNear(x - 30 + i * 30, y + 36, 12);
        this.warders.push(new Warder(this, record, i, pos.x, pos.y));
      });
  }

  addNPC(opts) {
    const pos = this.game.map.findOpenNear(opts.x, opts.y, 11);
    const npc = new WoundedNPC(this, { ...opts, ...pos });
    this.npcs.push(npc);
    return npc;
  }

  addStructure(opts) {
    const s = new Structure(this, opts);
    this.structures.push(s);
    return s;
  }

  toggleCommand() {
    this.command = this.command === 'guard' ? 'engage' : 'guard';
    for (const w of this.warders) w.target = null;
    return WARDER_COMMANDS[this.command];
  }

  get activeWarders() {
    return this.warders.filter((w) => !w.dead);
  }

  /** Heals bonded Warders (reviving the fallen) and wounded civilians within radius. */
  healArea(x, y, radius, amount) {
    let touched = 0;
    for (const w of this.warders) {
      if (!w.dead && dist(x, y, w.x, w.y) <= radius && w.heal(amount)) touched++;
    }
    for (const n of this.npcs) {
      if (n.vulnerable && dist(x, y, n.x, n.y) <= radius && n.heal(amount)) touched++;
    }
    return touched;
  }

  update(dt) {
    for (const w of this.warders) w.update(dt);
    for (const n of this.npcs) n.update(dt);
  }

  renderUnder(ctx, time) {
    for (const s of this.structures) s.render(ctx, time);
    for (const n of this.npcs) n.render(ctx, time);
  }

  render(ctx, time) {
    for (const w of this.warders) w.render(ctx, time);
  }
}
