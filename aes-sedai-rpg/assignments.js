// Assignments abroad: a weekly board of procedurally generated missions across the nations,
// with random road encounters on the way (Trollocs, bandits, Whitecloaks, Gray Men, men who channel).

import { clamp, dist, RNG } from './util.js';
import { T, TILE, TileMap } from './world.js';
import { AJAHS } from './player.js';
import { Navigator } from './enemies.js';

const at = (c, r) => ({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 });

export const NATIONS = {
  andor: { name: 'Andor', seat: 'Caemlyn', terrain: 'country', ruler: 'the Queen of Andor' },
  cairhien: { name: 'Cairhien', seat: 'Cairhien', terrain: 'town', ruler: 'the Sun Throne' },
  tear: { name: 'Tear', seat: 'the Stone of Tear', terrain: 'town', ruler: 'the High Lords of Tear' },
  illian: { name: 'Illian', seat: 'Illian', terrain: 'town', ruler: 'the Council of Nine' },
  shienar: { name: 'Shienar', seat: 'Fal Dara', terrain: 'borderland', ruler: 'the Lord of Fal Dara' },
  arafel: { name: 'Arafel', seat: 'Shol Arbela', terrain: 'borderland', ruler: 'the King of Arafel' },
  saldaea: { name: 'Saldaea', seat: 'Maradon', terrain: 'borderland', ruler: 'the Queen of Saldaea' },
  ghealdan: { name: 'Ghealdan', seat: 'Jehannah', terrain: 'country', ruler: 'the throne of Ghealdan' },
  amadicia: { name: 'Amadicia', seat: 'Amador', terrain: 'country', ruler: 'the King of Amadicia', whitecloaks: true },
  altara: { name: 'Altara', seat: 'Ebou Dar', terrain: 'town', ruler: 'the Queen of Altara' },
  murandy: { name: 'Murandy', seat: 'Lugard', terrain: 'country', ruler: 'the King of Murandy' },
  tarabon: { name: 'Tarabon', seat: 'Tanchico', terrain: 'town', ruler: 'the Panarch of Tarabon' },
};
export const NATION_IDS = Object.keys(NATIONS);

const HOUSES = ['House Arvenne', 'House Talmor', 'House Saredan', 'House Orvel', 'House Cairlin', 'House Venmar', 'House Dalsorn', 'House Hethar'];
const MEN = ['Garren Tal', 'Doral Messin', 'Hask Veyne', 'Corlan Brey', 'Mattin Sorde', 'Abel Teague', 'Joren Ashby'];
const ENVOYS = ['Envoy Teslyn Daroe', 'Lady Aemene Vass', 'Master-Envoy Corran', 'Lord Ethrin Malvar'];

/** Each Ajah's head sends her sisters on the work the Ajah exists for. */
const AJAH_TASK = { gray: 'treaty', blue: 'investigation', green: 'incursion', yellow: 'relief', red: 'channeler', brown: 'ruins', white: 'investigation' };

// ---------------------------------------------------------------------------
// Region maps
// ---------------------------------------------------------------------------

function buildTown(rng) {
  const m = new TileMap(52, 36, T.DIRT, rng.int(1, 1e6));
  m.outline(0, 0, 52, 36, T.WALL);
  for (const r of [8, 17, 26]) m.rect(1, r, 50, 2, T.PATH);
  for (const c of [12, 25, 38]) m.rect(c, 1, 2, 34, T.PATH);
  const xs = [[2, 10], [15, 23], [28, 36], [41, 49]];
  const ys = [[2, 6], [11, 15], [20, 24], [29, 33]];
  for (const [x0, x1] of xs) {
    for (const [y0, y1] of ys) {
      if (x0 === 15 && y0 === 11) {
        m.rect(x0, y0, x1 - x0 + 1, y1 - y0 + 1, T.MARBLE);
        continue;
      }
      if (rng.chance(0.25)) {
        m.rect(x0, y0, x1 - x0 + 1, y1 - y0 + 1, T.GRASS);
        m.rect(x0 + 2, y0 + 1, 3, 1, T.HEDGE);
        continue;
      }
      m.rect(x0, y0, x1 - x0 + 1, y1 - y0 + 1, T.WOOD);
      m.outline(x0, y0, x1 - x0 + 1, y1 - y0 + 1, T.WALL);
      const mid = Math.floor((x0 + x1) / 2);
      m.set(mid, rng.chance(0.5) ? y0 : y1, T.WOOD);
      if (rng.chance(0.5)) m.set(rng.chance(0.5) ? x0 : x1, Math.floor((y0 + y1) / 2), T.WOOD);
    }
  }
  return { map: m, spawn: at(3, 17.5), terrain: 'town' };
}

function buildCountry(rng) {
  const m = new TileMap(60, 34, T.GRASS, rng.int(1, 1e6));
  m.outline(0, 0, 60, 34, T.HEDGE);
  for (let c = 1; c < 59; c++) {
    const r = 16 + Math.round(Math.sin(c / 7) * 2);
    m.rect(c, r, 1, 3, T.PATH);
  }
  for (let i = 0; i < 46; i++) {
    const c = rng.int(2, 57);
    const r = rng.int(2, 31);
    const roadRow = 16 + Math.round(Math.sin(c / 7) * 2);
    if (r >= roadRow - 2 && r <= roadRow + 4) continue;
    if (rng.chance(0.7)) m.rect(c, r, rng.int(1, 2), rng.int(1, 2), T.HEDGE);
    else m.set(c, r, T.PILLAR);
  }
  m.outline(44, 4, 7, 5, T.WALL);
  m.rect(45, 5, 5, 3, T.WOOD);
  m.set(47, 8, T.WOOD);
  return { map: m, spawn: at(3, 17), terrain: 'country' };
}

function buildBorder(rng) {
  const m = new TileMap(52, 36, T.BLIGHT, rng.int(1, 1e6));
  m.outline(0, 0, 52, 36, T.WALL);
  for (let i = 0; i < 90; i++) m.set(rng.int(1, 50), rng.int(1, 34), T.DIRT);
  for (let i = 0; i < 26; i++) {
    const c = rng.int(6, 48);
    const r = rng.int(3, 32);
    m.rect(c, r, rng.int(1, 3), rng.int(1, 3), rng.chance(0.75) ? T.WALL : T.PILLAR);
    if (rng.chance(0.5)) m.set(c - 1, r, T.RUBBLE);
  }
  m.rect(1, 15, 5, 6, T.DIRT);
  return { map: m, spawn: at(3, 18), terrain: 'borderland' };
}

function buildCourt(rng) {
  const m = new TileMap(42, 30, T.MARBLE, rng.int(1, 1e6));
  m.outline(0, 0, 42, 30, T.WALL);
  m.rect(1, 14, 40, 2, T.CARPET);
  for (let c = 6; c < 38; c += 5) {
    m.set(c, 10, T.PILLAR);
    m.set(c, 19, T.PILLAR);
  }
  m.rect(1, 6, 15, 1, T.WALL);
  m.rect(26, 6, 15, 1, T.WALL);
  m.rect(1, 23, 15, 1, T.WALL);
  m.rect(26, 23, 15, 1, T.WALL);
  for (const c of [7, 33]) {
    m.set(c, 6, T.MARBLE);
    m.set(c, 23, T.MARBLE);
  }
  m.rect(2, 1, 13, 5, T.CARPET);
  m.rect(27, 24, 13, 5, T.CARPET);
  return { map: m, spawn: at(3, 14.5), terrain: 'court' };
}

function buildRuins(rng) {
  const m = new TileMap(50, 34, T.FLOOR, rng.int(1, 1e6));
  m.outline(0, 0, 50, 34, T.WALL);
  for (let i = 0; i < 70; i++) m.set(rng.int(1, 48), rng.int(1, 32), T.RUBBLE);
  for (let i = 0; i < 18; i++) {
    const c = rng.int(6, 34);
    const r = rng.int(2, 30);
    const horizontal = rng.chance(0.5);
    for (let k = 0; k < rng.int(3, 6); k++) m.set(horizontal ? c + k : c, horizontal ? r : r + k, T.WALL);
  }
  m.rect(37, 7, 11, 11, T.WALL);
  m.rect(38, 8, 9, 9, T.MARBLE);
  m.set(37, 12, T.SECRET);
  m.rect(1, 15, 5, 5, T.FLOOR);
  return { map: m, spawn: at(3, 17), terrain: 'ruins' };
}

function buildRoad(rng, terrain) {
  const m = new TileMap(64, 22, terrain === 'borderland' ? T.BLIGHT : T.GRASS, rng.int(1, 1e6));
  m.outline(0, 0, 64, 22, T.HEDGE);
  m.rect(1, 10, 62, 3, terrain === 'borderland' ? T.DIRT : T.PATH);
  for (let i = 0; i < 60; i++) {
    const c = rng.int(2, 61);
    const r = rng.chance(0.5) ? rng.int(1, 7) : rng.int(15, 20);
    if (rng.chance(0.75)) m.rect(c, r, rng.int(1, 2), rng.int(1, 2), T.HEDGE);
    else m.set(c, r, terrain === 'borderland' ? T.WALL : T.PILLAR);
  }
  return { map: m, spawn: at(3, 11), terrain };
}


// ---------------------------------------------------------------------------
// The escorted envoy
// ---------------------------------------------------------------------------

class Envoy {
  constructor(run, name, route) {
    this.run = run;
    this.name = name;
    this.route = route;
    this.index = 1;
    this.x = route[0].x;
    this.y = route[0].y;
    this.radius = 12;
    this.maxHp = 150 + run.player.level * 10;
    this.hp = this.maxHp;
    this.destroyed = false;
    this.arrived = false;
    this.flash = 0;
    this.nav = new Navigator();
    this.waiting = false;
  }

  takeDamage(amount) {
    if (this.destroyed || this.arrived) return;
    this.hp -= amount;
    this.flash = 0.15;
    this.run.game.effects.text(this.x, this.y - 22, `-${Math.round(amount)}`, '#ffb0b0', 11);
    if (this.hp <= 0) {
      this.hp = 0;
      this.destroyed = true;
      this.run.fail('envoy');
    }
  }

  update(dt) {
    if (this.destroyed || this.arrived) return;
    this.flash = Math.max(0, this.flash - dt);
    this.waiting = !!this.run.enemies.nearest(this.x, this.y, 170);
    if (this.waiting) return;
    const wp = this.route[this.index];
    if (dist(this.x, this.y, wp.x, wp.y) < 10) {
      this.index++;
      if (this.index >= this.route.length) {
        this.arrived = true;
        this.run.complete('escort');
        this.run.after(0.6, (r) => r.succeed());
      }
      return;
    }
    const dir = this.nav.steer(this.run.map, this, wp.x, wp.y, dt);
    this.run.map.moveCircle(this, dir.x * 46 * dt, dir.y * 46 * dt);
  }

  render(ctx, time) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.fillStyle = this.flash > 0 ? '#fff' : '#7a4fa0';
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8c35a';
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(-18, -22, 36, 4);
    ctx.fillStyle = this.hp / this.maxHp < 0.3 ? '#ff5050' : '#e0c070';
    ctx.fillRect(-18, -22, 36 * clamp(this.hp / this.maxHp, 0, 1), 4);
    ctx.font = '600 11px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f5efe0';
    ctx.fillText(this.waiting ? `${this.name} (waits)` : this.name, 0, -28 + Math.sin(time * 3) * 0.5);
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Assignment types
// ---------------------------------------------------------------------------

/**
 * Each type: label, verb, terrains (nations it fits), summary(a) and stage(run, a) which builds
 * the destination and its objectives. Destination handlers check run.flags.stage === 'dest'.
 */
const TYPES = {
  treaty: {
    label: 'Mediation',
    terrains: ['town', 'country'],
    summary: (a) => `${a.houseA} and ${a.houseB} are a word from open war in ${NATIONS[a.nation].seat}. Seize the agitators stirring them and talk down ${a.houseA}'s sworn sword.`,
    stage(run, a) {
      arrive(run, buildCourt(run.rng));
      const n = 2 + a.difficulty;
      run.flags.tension = 15;
      for (let i = 0; i < n; i++) {
        const pos = run.randomOpen({ minFromPlayer: 260 });
        run.spawn('darkfriend', pos.x, pos.y, { alerted: false, tag: 'agitator', name: 'Agitator', label: 'Agitator' });
      }
      const pos = at(36, 14.5);
      run.flags.champion = run.spawn('champion', pos.x, pos.y, {
        alerted: false,
        name: `${a.houseA}'s sworn sword`,
        label: `${a.houseA}'s sworn sword`,
        parley: {
          speaker: `${a.houseA}'s sworn sword`,
          text: `My lord says ${a.houseB} spat on his father's grave. Words will not wash that out, Aes Sedai.`,
          success: 'He sheathes his sword. "One week. If they keep the peace one week, I will carry your words to my lord."',
          failure: 'He shakes his head and draws steel. "Then the Light judge between us."',
          difficulty: a.difficulty * 10,
        },
      }).id;
      run.objective({ id: 'tension', label: 'Tension between the Houses (war at 100)', target: 100, counter: true });
      run.objective({ id: 'agitators', label: 'Seize the agitators (bind, then take hold)', target: n });
      run.objective({ id: 'parley', label: `Talk down ${a.houseA}'s sworn sword` });
      run.objective({ id: 'bloodless', label: 'Bonus: kill no one', optional: true, reward: { prestige: 8 } });
      run.every(1, (r) => {
        if (r.flags.stage !== 'dest') return;
        const active = r.enemies.list.filter((e) => !e.dead && e.tag === 'agitator').length;
        r.flags.tension = clamp(r.flags.tension + active * 0.2, 0, 100);
        r.setProgress('tension', Math.round(r.flags.tension));
        if (r.flags.tension >= 100) r.fail('war');
      });
      run.on('enemyKilled', (e, info) => {
        if (run.flags.stage !== 'dest') return;
        if (e.def.human && !info?.captured && !info?.parleyed) run.failObjective('bloodless');
        if (e.tag === 'agitator') {
          run.progress('agitators');
          run.flags.tension = clamp(run.flags.tension - 8, 0, 100);
        }
        if (e.id === run.flags.champion) run.complete('parley');
        if (run.obj('agitators').done && run.obj('parley').done) {
          if (!run.obj('bloodless').failed) run.complete('bloodless');
          run.after(0.8, (r) => r.succeed());
        }
      });
    },
  },
  escort: {
    label: 'Escort',
    terrains: ['country', 'borderland'],
    summary: (a) => `Bring ${a.envoy} safely to ${NATIONS[a.nation].seat}. The roads are watched.`,
    stage(run, a) {
      const built = buildCountry(run.rng);
      arrive(run, built);
      const route = [];
      for (let c = 3; c <= 56; c += 4) route.push(at(c, 17 + Math.round(Math.sin(c / 7) * 2)));
      const envoy = new Envoy(run, a.envoy, route);
      run.flags.envoy = envoy;
      run.addRenderer((ctx, time) => envoy.render(ctx, time));
      run.on('update', (dt) => {
        if (run.flags.stage !== 'dest') return;
        envoy.update(dt);
        run.setProgress('envoy', Math.round((envoy.hp / envoy.maxHp) * 100));
      });
      run.objective({ id: 'escort', label: `Bring ${a.envoy} to ${NATIONS[a.nation].seat}` });
      run.objective({ id: 'envoy', label: 'Envoy health %', target: 100, counter: true });
      const pool = NATIONS[a.nation].terrain === 'borderland' ? ['trolloc', 'trolloc', 'darkhound'] : ['bandit', 'bandit', 'darkhound', 'trolloc'];
      run.every(Math.max(9, 16 - a.difficulty * 2), (r) => {
        if (r.flags.stage !== 'dest' || envoy.arrived || r.hostilesRemaining() > 8) return;
        const ahead = Math.min(56, Math.floor(envoy.x / TILE) + r.rng.int(8, 14));
        const side = r.rng.chance(0.5) ? 5 : 29;
        const pos = r.map.findOpenNear(at(ahead, side).x, at(ahead, side).y, 14);
        for (let i = 0; i < 2 + a.difficulty; i++) r.spawn(r.rng.pick(pool), pos.x + r.rng.range(-30, 30), pos.y + r.rng.range(-30, 30), { goal: i % 2 ? envoy : null });
      });
    },
  },
  incursion: {
    label: 'Incursion',
    terrains: ['borderland'],
    summary: (a) => `Shadow rifts have opened outside ${NATIONS[a.nation].seat}. Seal them and kill the Myrddraal leading the fist.`,
    stage(run, a) {
      arrive(run, buildBorder(run.rng));
      const rifts = 1 + (a.difficulty >= 2 ? 1 : 0) + (a.difficulty >= 3 ? 1 : 0);
      const spots = [];
      for (let i = 0; i < rifts; i++) {
        const pos = run.randomOpen({ minFromPlayer: 480, avoid: spots, minSpacing: 300 });
        spots.push(pos);
        const rift = run.spawn('rift', pos.x, pos.y);
        rift.spawnScale = run.scale;
        run.group('trolloc', 2, pos.x - 40, pos.y, 30, { alerted: false });
      }
      run.objective({ id: 'rifts', label: 'Seal the Shadow rifts', target: rifts });
      run.objective({ id: 'fade', label: 'Kill the Myrddraal', hidden: true });
      run.on('enemyKilled', (e) => {
        if (run.flags.stage !== 'dest') return;
        if (e.type === 'rift') {
          run.progress('rifts');
          if (run.obj('rifts').done) {
            run.reveal('fade');
            const pos = run.randomOpen({ minFromPlayer: 360 });
            const fade = run.spawn('myrddraal', pos.x, pos.y, { boss: a.difficulty === 3, name: 'Myrddraal' });
            run.flags.fade = fade.id;
            run.group('trolloc', 2 + a.difficulty, pos.x, pos.y, 50, { linkedTo: fade.id });
          }
        } else if (e.id === run.flags.fade) {
          run.complete('fade');
          run.after(1, (r) => r.succeed());
        }
      });
    },
  },
  channeler: {
    label: 'A man who channels',
    terrains: ['country', 'town'],
    summary: (a) => `Villagers outside ${NATIONS[a.nation].seat} report lightning from a clear sky and a man who talks to no one. Stop him.`,
    stage(run, a) {
      arrive(run, run.rng.chance(0.5) ? buildTown(run.rng) : buildCountry(run.rng));
      const pos = run.randomOpen({ minFromPlayer: 600 });
      const name = run.rng.pick(MEN);
      run.flags.man = run.spawn('rogue_channeler', pos.x, pos.y, {
        boss: a.difficulty >= 2,
        alerted: false,
        name,
        label: `${name} (channels saidin)`,
        parley: {
          speaker: name,
          text: 'Stay back! It is in my head, the voices, I can hear them all, stay BACK, Aes Sedai!',
          success: 'He sinks to his knees, sobbing, and lets the Source go. "Take it away. Please. Take it away."',
          failure: 'His eyes go wild. The air around him starts to burn.',
          difficulty: 15 + a.difficulty * 10,
        },
      }).id;
      run.objective({ id: 'man', label: `Stop ${name}: shield or wear him down, bind and seize him (or kill him)` });
      run.objective({ id: 'alive', label: 'Bonus: take him alive', optional: true, reward: { prestige: 12 } });
      run.toast('A man channeling saidin at you is the last extreme: the Third Oath will not stay your hand against him.', 'warn');
      run.on('enemyKilled', (e, info) => {
        if (run.flags.stage !== 'dest' || e.id !== run.flags.man) return;
        if (info?.captured || info?.parleyed) run.complete('alive');
        else run.failObjective('alive');
        run.complete('man');
        run.after(1, (r) => r.succeed());
      });
    },
  },
  investigation: {
    label: 'Investigation',
    terrains: ['town'],
    summary: (a) => `A Darkfriend cell is working in ${NATIONS[a.nation].seat}. Find three pieces of proof, then take its leader.`,
    stage(run, a) {
      arrive(run, buildTown(run.rng));
      const clues = [];
      for (let i = 0; i < 3; i++) {
        const pos = run.randomOpen({ minFromPlayer: 300, avoid: clues, minSpacing: 260 });
        clues.push(pos);
        run.pickup({ id: `clue${i}`, kind: 'letter', label: 'Proof', ...pos });
      }
      for (let i = 0; i < 2 + a.difficulty; i++) {
        const pos = run.randomOpen({ minFromPlayer: 280 });
        run.spawn('darkfriend', pos.x, pos.y, { alerted: false });
      }
      for (let i = 0; i < (a.difficulty >= 3 ? 2 : 1); i++) {
        const pos = run.randomOpen({ minFromPlayer: 400 });
        run.spawn('grayman', pos.x, pos.y);
      }
      run.objective({ id: 'clues', label: 'Find the proof of the cell', target: 3 });
      run.objective({ id: 'leader', label: 'Seize or kill the cell\'s leader', hidden: true });
      run.on('pickup', (pk) => {
        if (run.flags.stage !== 'dest' || pk.kind !== 'letter') return;
        run.progress('clues');
        if (run.obj('clues').done) {
          run.reveal('leader');
          const pos = run.randomOpen({ minFromPlayer: 420 });
          run.flags.leader = run.spawn('channeler', pos.x, pos.y, { name: 'Cell leader', label: 'Darkfriend cell leader', scale: run.scale * (1 + a.difficulty * 0.25) }).id;
          run.toast('The proof names a channeler. She knows you are coming.', 'danger');
        }
      });
      run.on('enemyKilled', (e) => {
        if (run.flags.stage !== 'dest' || e.id !== run.flags.leader) return;
        run.complete('leader');
        run.after(1, (r) => r.succeed());
      });
    },
  },
  relief: {
    label: 'Healing',
    terrains: ['town', 'country'],
    summary: (a) => `A wasting sickness has struck near ${NATIONS[a.nation].seat}, and Darkhounds follow the smell of it. Heal the sick before they die.`,
    stage(run, a) {
      arrive(run, run.rng.chance(0.5) ? buildTown(run.rng) : buildCountry(run.rng));
      const n = 3 + a.difficulty;
      const placed = [];
      for (let i = 0; i < n; i++) {
        const pos = run.randomOpen({ minFromPlayer: 200, avoid: placed, minSpacing: 220 });
        placed.push(pos);
        run.allies.addNPC({ name: `Villager ${i + 1}`, ...pos, hp: 42, drain: 1 + a.difficulty * 0.15 });
      }
      run.objective({ id: 'heal', label: 'Heal the sick (healing weaves, standing close)', target: n });
      run.objective({ id: 'lost', label: 'Lives lost (two is failure)', target: 2, counter: true });
      run.every(14, (r) => {
        if (r.flags.stage !== 'dest') return;
        const pos = r.randomOpen({ minFromPlayer: 380 });
        r.group('darkhound', 1 + a.difficulty, pos.x, pos.y, 30, { preyOnNpcs: true });
      });
      const check = () => {
        if (run.flags.stage !== 'dest') return;
        const saved = run.allies.npcs.filter((x) => x.saved).length;
        const lost = run.allies.npcs.filter((x) => x.dead).length;
        run.setProgress('heal', saved);
        run.setProgress('lost', lost);
        if (lost >= 2) run.fail('lost');
        else if (saved + lost === run.allies.npcs.length) {
          run.complete('heal');
          run.after(0.8, (r) => r.succeed());
        }
      };
      run.on('npcSaved', check);
      run.on('npcDied', check);
    },
  },
  ruins: {
    label: 'Relic recovery',
    terrains: ['country', 'borderland'],
    summary: (a) => `Age-of-Legends ruins have surfaced near ${NATIONS[a.nation].seat}. Recover what lies inside before others do.`,
    stage(run, a) {
      arrive(run, buildRuins(run.rng));
      for (let i = 0; i < 4 + a.difficulty; i++) {
        const pos = run.randomOpen({ minFromPlayer: 160, avoid: run.traps, minSpacing: 80 });
        run.trap({ ...pos, radius: 18, damage: 12 + a.difficulty * 2, danger: 16 });
      }
      for (let i = 0; i < 2; i++) {
        const p0 = run.randomOpen({ minFromPlayer: 250 });
        const p1 = run.randomOpen({ minFromPlayer: 250 });
        run.spawn('sentinel', p0.x, p0.y, { patrol: [p0, p1], silent: true });
      }
      run.group('darkhound', 1 + a.difficulty, at(25, 26).x, at(25, 26).y, 30, { alerted: false });
      const outer = run.randomOpen({ minFromPlayer: 400 });
      if (!run.artifactPickup(outer)) run.pickup({ id: 'relic_outer', kind: 'relic', label: 'Relic', color: '#b49bff', ...outer, onCollect: (r) => { r.player.prestige += 4; } });
      run.pickup({ id: 'relic_vault', kind: 'relic', label: 'Vault relic', color: '#b49bff', ...at(42, 12), onCollect: (r) => { r.player.prestige += 6; r.toast('A sealed record of the Age of Legends (+6 prestige).', 'good'); } });
      run.objective({ id: 'relics', label: 'Recover the relics (one lies behind hollow stone)', target: 2 });
      run.objective({ id: 'out', label: 'Return to where you entered', hidden: true });
      run.on('pickup', () => {
        if (run.flags.stage !== 'dest') return;
        run.progress('relics');
        if (run.obj('relics').done && !run.flags.exit) {
          run.flags.exit = true;
          run.reveal('out');
          run.zone({ id: 'exit', ...at(3, 17), radius: 34, color: '#9ad9ea', label: 'Way out', onEnter: (r) => r.succeed() });
        }
      });
    },
  },
};

// ---------------------------------------------------------------------------
// Road encounters
// ---------------------------------------------------------------------------

const ENCOUNTERS = {
  quiet: { weight: () => 5 },
  trollocs: {
    weight: (n) => (n.terrain === 'borderland' ? 6 : 1.5),
    intro: 'Horns bray in the trees ahead. Trollocs, far south of where any Trolloc should be.',
    label: 'Survive the Trolloc raiders',
    spawn(run, a) {
      const pos = at(32, 6);
      run.group('trolloc', 3 + a.difficulty, pos.x, pos.y, 50);
      if (a.difficulty >= 2) {
        const fade = run.spawn('myrddraal', at(40, 16).x, at(40, 16).y);
        run.group('trolloc', 2, at(40, 16).x, at(40, 16).y, 40, { linkedTo: fade.id });
      }
    },
  },
  darkhounds: {
    weight: () => 1.5,
    intro: 'Something howls, and is answered from three directions at once. Darkhounds.',
    label: 'Fight off the Darkhound pack',
    spawn(run, a) {
      for (const [c, r] of [[30, 4], [36, 18], [44, 10]]) run.group('darkhound', 1 + Math.ceil(a.difficulty / 2), at(c, r).x, at(c, r).y, 25);
    },
  },
  bandits: {
    weight: (n) => (n.terrain === 'borderland' ? 0.4 : 2),
    intro: 'Men step onto the road with crossbows. Their leader smiles. "A toll, Aes Sedai. For the road."',
    label: 'Deal with the bandits (talk, or bind and seize)',
    spawn(run, a) {
      const pos = at(30, 11);
      run.spawn('champion', pos.x, pos.y, {
        name: 'Bandit captain',
        label: 'Bandit captain',
        parley: {
          speaker: 'Bandit captain',
          text: 'Your purse and your horse, and you walk on. I have no quarrel with the Tower beyond that.',
          success: 'He looks at your face a long moment, then waves his men back into the trees. "Another day."',
          failure: '"Take her."',
          difficulty: 5,
        },
      });
      run.group('bandit', 2 + a.difficulty, pos.x + 60, pos.y, 50);
    },
  },
  whitecloaks: {
    weight: (n) => (n.whitecloaks ? 5 : 0.8),
    intro: 'Riders in white cloaks block the road, a golden sunburst on every breast. Children of the Light.',
    label: 'Get past the Whitecloaks',
    spawn(run, a) {
      const pos = at(30, 11);
      run.spawn('questioner', pos.x, pos.y, {
        name: 'Questioner',
        label: 'Questioner of the Hand',
        parley: {
          speaker: 'Questioner of the Hand',
          text: 'Witch. Your kind is not welcome on the King\'s roads. Kneel, and we may only question you.',
          success: 'His Lord Captain calls him back. "Not today. Let the witch pass. We will remember her face."',
          failure: '"Seize her."',
          difficulty: 20,
        },
      });
      run.group('whitecloak', 2 + a.difficulty, pos.x + 50, pos.y, 50);
    },
  },
  grayman: {
    weight: () => 0.8,
    intro: 'The road is too quiet. A man you somehow did not notice is suddenly much closer than he should be.',
    label: 'Survive the Soulless',
    spawn(run, a) {
      for (let i = 0; i < 1 + Math.ceil(a.difficulty / 2); i++) run.spawn('grayman', at(20 + i * 10, 11).x, at(20 + i * 10, 11).y);
    },
  },
  man: {
    weight: () => 0.9,
    intro: 'A man sits by the road, rocking. The grass around him has burned in a perfect circle. He looks up, and the air begins to hum.',
    label: 'Stop the man who channels (capture or kill)',
    spawn(run, a) {
      const name = run.rng.pick(MEN);
      run.spawn('rogue_channeler', at(32, 11).x, at(32, 11).y, {
        name,
        label: `${name} (channels saidin)`,
        scale: run.scale * (0.6 + a.difficulty * 0.15),
        parley: {
          speaker: name,
          text: 'Aes Sedai. They told me you would come. I won\'t let you gentle me. I won\'t!',
          success: 'Something in your voice reaches him. He releases saidin and holds out his wrists, shaking.',
          failure: 'He screams, and the road erupts.',
          difficulty: 25,
        },
      });
      run.toast('A man channeling saidin at you is the last extreme: the Third Oath will not stay your hand against him.', 'warn');
    },
  },
};

function pickEncounter(rng, nation) {
  const entries = Object.entries(ENCOUNTERS).map(([id, e]) => [id, e.weight(nation)]);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = rng.next() * total;
  for (const [id, w] of entries) if ((roll -= w) <= 0) return id;
  return 'quiet';
}

/**
 * Loads a road or destination map and brings Green Warders along. Health and strain carry over
 * from the road to the destination; the first map of an assignment starts fresh.
 */
function arrive(run, built) {
  const fresh = !run.flags.arrived;
  run.flags.arrived = true;
  run.useMap(built, { keepVitals: !fresh });
  const p = run.player;
  if (p.mod('maxWarders', 0)) run.allies.spawnWarders(p.warders, p.x, p.y);
}

// ---------------------------------------------------------------------------
// The board and its mission
// ---------------------------------------------------------------------------

export class Assignments {
  constructor(game) {
    this.game = game;
    this.current = null;
  }

  get pol() {
    return this.game.politics.pol;
  }

  /** The week's board: refreshed when the week changes. */
  board() {
    const p = this.game.player;
    const pol = this.pol;
    if (p.rankIndex < 1) return [];
    if (!Array.isArray(pol.board) || pol.boardWeek !== pol.week || pol.boardRank !== p.rankIndex) this.refresh();
    return pol.board;
  }

  refresh() {
    const p = this.game.player;
    const pol = this.pol;
    const rng = new RNG(pol.seed + pol.week * 131 + p.rankIndex * 7);
    const entries = [];
    const count = (p.rankIndex === 2 ? 3 : 2) + (pol.projects?.eyes_and_ears ? 1 : 0);
    const types = Object.keys(TYPES).filter((t) => p.rankIndex === 2 || !['treaty', 'channeler'].includes(t));
    for (let i = 0; i < count; i++) {
      const ajahTask = i === 0 && p.rankIndex === 2 && !!p.ajah;
      const used = new Set(entries.map((e) => e.type));
      const fresh = types.filter((t) => !used.has(t));
      const type = ajahTask ? AJAH_TASK[p.ajah] : rng.pick(fresh.length ? fresh : types);
      const fits = NATION_IDS.filter((id) => TYPES[type].terrains.includes(NATIONS[id].terrain));
      const nation = rng.pick(fits.length ? fits : NATION_IDS);
      const houses = rng.shuffle(HOUSES);
      entries.push({
        key: `${pol.week}-${i}`,
        type,
        nation,
        difficulty: Math.min(3, 1 + rng.int(0, p.rankIndex === 2 ? 2 : 1)),
        ajahTask,
        houseA: houses[0],
        houseB: houses[1],
        envoy: rng.pick(ENVOYS),
        done: false,
      });
    }
    // As Amyrlin, the gravest crisis among the nations lands on your own desk.
    const crisis = this.game.ascension?.worstThreat();
    if (crisis) {
      const houses = rng.shuffle(HOUSES);
      entries.unshift({
        key: `${pol.week}-crisis`,
        type: NATIONS[crisis].terrain === 'borderland' ? 'incursion' : rng.pick(['treaty', 'investigation']),
        nation: crisis,
        difficulty: 3,
        ajahTask: false,
        crisis: true,
        houseA: houses[0],
        houseB: houses[1],
        envoy: rng.pick(ENVOYS),
        done: false,
      });
    }
    pol.board = entries;
    pol.boardWeek = pol.week;
    pol.boardRank = p.rankIndex;
  }

  describe(a) {
    const t = TYPES[a.type];
    const n = NATIONS[a.nation];
    return {
      title: `${a.crisis ? 'Crisis: ' : ''}${t.label} in ${n.name}`,
      summary: t.summary(a),
      roads: n.terrain === 'borderland' ? 'Borderland roads: Trollocs likely' : n.whitecloaks ? 'Whitecloak country' : 'The roads are seldom quiet',
      rewards: this.rewardsFor(a),
    };
  }

  rewardsFor(a) {
    const p = this.game.player;
    const office = p.flags.sitter || p.flags.amyrlin ? 1.25 : 1;
    const network = this.pol.projects?.eyes_and_ears ? 1.1 : 1;
    const sitter = office * network * (a.crisis ? 1.5 : 1);
    return {
      xp: Math.round((80 + a.difficulty * 45 + p.level * 12) * sitter),
      prestige: Math.round((5 + a.difficulty * 3 + (a.ajahTask ? 5 : 0)) * sitter),
    };
  }

  start(key) {
    const a = this.board().find((x) => x.key === key);
    if (!a || a.done) return;
    this.current = a;
    this.game.startMission('assignment');
  }

  /** Politics effects of the outcome, applied on success or failure. */
  settle(a, success) {
    const tp = this.game.politics;
    const pol = this.pol;
    const p = this.game.player;
    a.done = true;
    pol.nations = pol.nations ?? {};
    pol.nations[a.nation] = clamp((pol.nations[a.nation] ?? 50) + (success ? 8 : -10), 0, 100);
    if (success && a.crisis && pol.threats) pol.threats[a.nation] = clamp((pol.threats[a.nation] ?? 0) - 40, 0, 100);
    if (success) {
      pol.assignmentsDone = (pol.assignmentsDone ?? 0) + 1;
      if (p.ajah) tp.influence(p.ajah, a.ajahTask ? 4 : 2);
      tp.standing(a.ajahTask ? 8 : 3);
      tp.log(`${this.describe(a).title}: done.`, 'politics');
    } else {
      if (a.ajahTask) tp.standing(-6);
      tp.log(`${this.describe(a).title}: failed.`, 'unrest');
    }
    this.current = null;
  }
}

let ACTIVE = null;

export const ASSIGNMENT_MISSIONS = [
  {
    id: 'assignment',
    title: 'Assignment abroad',
    type: 'combat',
    chapter: 'Abroad',
    hidden: true,
    repeatable: true,
    retryable: true,
    requires: { minRank: 'accepted', custom: (game) => (game.assignments.current ? null : 'Choose an assignment from the board') },
    rewards: (run) => run.game.assignments.rewardsFor(run.flags.a),
    failure: {
      prestige: -8,
      strike: false,
      text: (reason) => {
        const where = ACTIVE ? NATIONS[ACTIVE.nation].seat : 'the field';
        if (reason === 'war') return `The Houses went to war in ${where} before you could stop it. They will remember that the Tower failed them.`;
        if (reason === 'envoy') return 'The envoy died on the road with you standing over the body. The Tower\'s word is worth a little less tonight.';
        if (reason === 'lost') return `The sick died faster than you could reach them. The people of ${where} will not soon forget it.`;
        return `You were carried back to Tar Valon from ${where}, and the work was left undone.`;
      },
    },
    async briefing(ctx) {
      const asg = ctx.game.assignments;
      const a = asg.current;
      if (!a) return false;
      const d = asg.describe(a);
      const head = ctx.game.politics.sisterById(`head_${ctx.player.ajah}`);
      const from = a.ajahTask && head ? `${head.name}, head of the ${AJAHS[ctx.player.ajah].name}` : ctx.player.rankIndex === 1 ? 'The Mistress of Novices' : 'The Keeper of the Chronicles';
      const go = await ctx.ask({
        speaker: from,
        text: `${d.summary} ${ctx.player.rankIndex === 1 ? 'You will accompany a sister and do as she says.' : ''} ${d.roads}.`,
        choices: [{ label: 'Set out at once.', value: true }, { label: 'Not yet.', value: false }],
      });
      if (!go) asg.current = null;
      return !!go;
    },
    setup(run) {
      const asg = run.game.assignments;
      const a = asg.current;
      ACTIVE = a;
      run.flags.a = a;
      const d = asg.describe(a);
      const nation = NATIONS[a.nation];
      run.title = d.title;
      run.typeLabel = TYPES[a.type].label;
      run.scale *= 0.85 + a.difficulty * 0.12;
      run.on('playerDowned', () => run.fail('fallen'));
      const encounterId = pickEncounter(run.rng, nation);
      const goToDestination = () => {
        run.flags.stage = 'dest';
        TYPES[a.type].stage(run, a);
        run.toast(`You reach ${nation.seat}.`, 'info');
      };
      if (encounterId === 'quiet') {
        run.flags.stage = 'dest';
        TYPES[a.type].stage(run, a);
        run.toast(`The road to ${nation.seat} is quiet. You arrive rested.`, 'info');
        return;
      }
      const enc = ENCOUNTERS[encounterId];
      run.flags.stage = 'road';
      arrive(run, buildRoad(run.rng, nation.terrain));
      run.objective({ id: 'road', label: enc.label });
      enc.spawn(run, a);
      run.after(0.3, (r) => r.say([{ speaker: `The road to ${nation.seat}`, tone: 'danger', text: enc.intro }]));
      run.on('update', () => {
        if (run.flags.stage !== 'road' || run.flags.roadClear || run.time < 1.5) return;
        if (run.hostilesRemaining() > 0) return;
        run.flags.roadClear = true;
        run.complete('road');
        run.zone({ id: 'onward', ...at(61, 11), radius: 40, color: '#9ad9ea', label: `Ride on to ${nation.seat}`, onEnter: goToDestination });
        run.toast(`The way to ${nation.seat} is clear. Ride east.`, 'good');
      });
    },
    async debrief(run, ctx) {
      const a = run.flags.a;
      const asg = ctx.game.assignments;
      asg.settle(a, true);
      ctx.player.counts.assignment = (ctx.player.counts.assignment ?? 0) + 1;
      const n = NATIONS[a.nation];
      await ctx.say([{ speaker: n.ruler.replace(/^the /, 'The '), tone: 'ceremony', text: `${n.name} will remember the Tower's help. (${n.name}'s regard for the Tower: ${ctx.game.politics.pol.nations[a.nation]})` }]);
    },
    onFailure(run, game) {
      const a = run?.flags.a ?? game.assignments.current ?? ACTIVE;
      if (a) game.assignments.settle(a, false);
    },
  },
];
