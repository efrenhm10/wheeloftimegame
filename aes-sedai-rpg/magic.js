// The weaving engine: elemental thread combination, Ajah mastery weaves, the over-channeling
// risk engine, projectiles/areas, and ter'angreal artifacts.

import { clamp, dist, normalize, pointSegmentDistance, RNG } from './util.js';
import { TILE } from './world.js';
import { AJAHS, ELEMENT_IDS } from './player.js';

export const ELEMENTS = [
  { id: 'earth', name: 'Earth', key: '1', color: '#b07a3e' },
  { id: 'fire', name: 'Fire', key: '2', color: '#ff5a26' },
  { id: 'air', name: 'Air', key: '3', color: '#a8e4f5' },
  { id: 'water', name: 'Water', key: '4', color: '#2f86e0' },
  { id: 'spirit', name: 'Spirit', key: '5', color: '#e7d2ff' },
];
export const ELEMENT_BY_ID = Object.fromEntries(ELEMENTS.map((e) => [e.id, e]));
export const ELEMENT_COLORS = Object.fromEntries(ELEMENTS.map((e) => [e.id, e.color]));
export const MAX_THREADS = 3;

/** Threads sorted into element order (Earth, Fire, Air, Water, Spirit) so recipes are order-independent. */
export function canonicalRecipe(elements) {
  return elements.slice().sort((a, b) => ELEMENT_IDS.indexOf(a) - ELEMENT_IDS.indexOf(b));
}

export function recipeKey(elements) {
  return canonicalRecipe(elements).join('+');
}

const TIER_LABELS = { 1: 'Raw flow', 2: 'Woven', 3: 'Advanced' };

/**
 * cost: One Power drawn. strain: base over-channel strain. minStrength: below it, strain rises
 * (tier 2) or the weave cannot be held at all (tier 3). requires: { oaths, ajah }.
 */
export const WEAVES = {
  stone_shard: {
    name: 'Stone Shard', recipe: ['earth'], tier: 1, cost: 6, strain: 4, cooldown: 0.45, minStrength: 1,
    description: 'A raw fist of Earth hurled with force. Heavy knockback; cracks hollow stone.',
    cast: (w, c) => w.projectile(c, { speed: 380, radius: 7, damage: 17, knockback: 200 }),
  },
  flame_lash: {
    name: 'Flame Lash', recipe: ['fire'], tier: 1, cost: 5, strain: 3.5, cooldown: 0.3, minStrength: 1,
    description: 'A whip of unrefined Fire. Fast, and it leaves foes burning.',
    cast: (w, c) => w.projectile(c, { speed: 520, radius: 5, damage: 13, burn: 2, burnDps: 4 }),
  },
  gust: {
    name: 'Gust', recipe: ['air'], tier: 1, cost: 6, strain: 4, cooldown: 0.6, minStrength: 1,
    description: 'A cone of raw Air that hurls enemies back.',
    cast: (w, c) => w.cone(c, { range: 135, arc: Math.PI * 0.42, damage: 4, knockback: 330 }),
  },
  tidal_lash: {
    name: 'Tidal Lash', recipe: ['water'], tier: 1, cost: 5, strain: 3, cooldown: 0.35, minStrength: 1,
    description: 'A lash of Water that drags at limbs, slowing its target.',
    cast: (w, c) => w.projectile(c, { speed: 420, radius: 6, damage: 9, slow: 2.5, slowFactor: 0.5 }),
  },
  spirit_pulse: {
    name: 'Spirit Pulse', recipe: ['spirit'], tier: 1, cost: 9, strain: 6, cooldown: 1.2, minStrength: 1,
    description: 'A ring of Spirit that briefly stuns everything nearby. Myrddraal resist it.',
    cast: (w, c) => w.pulse(c, { radius: 95, damage: 8, stun: 1.1 }),
  },
  fireball: {
    name: 'Fireball', recipe: ['air', 'fire'], tier: 2, cost: 16, strain: 11, cooldown: 0.8, minStrength: 6,
    description: 'Fire wrapped in Air, released to burst on impact.',
    cast: (w, c) => w.projectile(c, { speed: 360, radius: 8, damage: 30, explode: { radius: 70, damage: 30, burn: 2, burnDps: 5 } }),
  },
  air_shield: {
    name: 'Air Shield', recipe: ['air', 'spirit'], tier: 2, cost: 18, strain: 10, cooldown: 4, minStrength: 6,
    description: 'A hardened sphere of Air bound with Spirit that absorbs blows for eight seconds.',
    cast: (w, c) => w.shieldSelf(c, { amount: 30, duration: 8 }),
  },
  healing_flow: {
    name: 'Healing Flow', recipe: ['spirit', 'water'], tier: 2, cost: 20, strain: 10, cooldown: 5, minStrength: 6,
    description: 'Spirit and Water knit flesh over three seconds. Also mends nearby allies.',
    cast: (w, c) => w.healing(c, { amount: 34, duration: 3, allyRadius: 130 }),
  },
  earth_eruption: {
    name: 'Earth Eruption', recipe: ['earth', 'fire'], tier: 2, cost: 18, strain: 12, cooldown: 1.2, minStrength: 6,
    description: 'The ground at your target splits and erupts after a heartbeat. A small explosion.',
    cast: (w, c) => w.eruption(c, { range: 340, delay: 0.6, radius: 62, damage: 34, stun: 0.6 }),
  },
  bonds_of_air: {
    name: 'Bonds of Air', recipe: ['air', 'air'], tier: 2, cost: 14, strain: 9, cooldown: 2.5, minStrength: 6,
    description: 'Invisible bonds pin everything at the target. Harmless, so the Oaths allow it; the bound may be seized.',
    cast: (w, c) => w.bind(c, { range: 360, radius: 58, root: 3 }),
  },
  ice_lances: {
    name: 'Ice Lances', recipe: ['air', 'water'], tier: 2, cost: 14, strain: 9, cooldown: 0.7, minStrength: 6,
    description: 'Three piercing shards of frozen Water.',
    cast: (w, c) => w.spread(c, 3, 0.2, { speed: 460, radius: 5, damage: 14, pierce: 1, slow: 1.5, slowFactor: 0.6 }),
  },
  sky_lightning: {
    name: 'Sky Lightning', recipe: ['fire', 'air', 'water'], tier: 3, cost: 32, strain: 20, cooldown: 1.6, minStrength: 9,
    requires: { oaths: true },
    description: 'Calls lightning that leaps between up to five foes.',
    cast: (w, c) => w.chainLightning(c, { jumps: 5, damage: 46, falloff: 0.8, range: 190 }),
  },
  earthquake: {
    name: 'Earthquake', recipe: ['earth', 'earth', 'fire'], tier: 3, cost: 36, strain: 24, cooldown: 3, minStrength: 9,
    requires: { oaths: true },
    description: 'Shatters the ground across a wide area, stunning all within.',
    cast: (w, c) => w.eruption(c, { range: 360, delay: 0.4, radius: 125, damage: 40, stun: 1.4, shake: 12 }),
  },
  delving: {
    name: 'Delving', recipe: ['air', 'water', 'spirit'], tier: 3, cost: 34, strain: 8, cooldown: 8, minStrength: 9,
    requires: { oaths: true },
    description: 'Search yourself with Spirit and mend what you find. Heals and bleeds off over-channel strain.',
    cast: (w, c) => w.delve(c, { amount: 60, purge: 22 }),
  },
  gateway: {
    name: 'Gateway', recipe: ['air', 'spirit', 'spirit'], tier: 3, cost: 28, strain: 16, cooldown: 3, minStrength: 9,
    requires: { oaths: true },
    description: 'Fold the Pattern and step through to any open ground in sight.',
    validate: (w, c) => w.validateGateway(c, 380),
    cast: (w, c) => w.gateway(c),
  },
  balefire: {
    name: 'Balefire', recipe: ['fire', 'fire', 'spirit'], tier: 3, cost: 45, strain: 45, cooldown: 4, minStrength: 11,
    requires: { oaths: true }, forbidden: true, hidden: true,
    description: 'Forbidden by the Tower. Burns its target out of the Pattern itself. Every use costs prestige.',
    cast: (w, c) => w.balefire(c, { damage: 240, length: 640 }),
  },
  // Ajah Mastery Weaves — replace the base weave of the same recipe for that Ajah only.
  blossom_of_fire: {
    name: 'Blossom of Fire', recipe: ['earth', 'fire'], tier: 3, cost: 40, strain: 26, cooldown: 6, minStrength: 6,
    requires: { oaths: true, ajah: 'green' }, mastery: true,
    description: 'Green Mastery. Earth and Fire bloom beneath every foe in sight at once. It clears the field.',
    cast: (w, c) => w.blossom(c, { range: 470, radius: 52, damage: 55 }),
  },
  true_healing: {
    name: 'True Healing', recipe: ['spirit', 'water'], tier: 3, cost: 30, strain: 12, cooldown: 6, minStrength: 6,
    requires: { oaths: true, ajah: 'yellow' }, mastery: true,
    description: 'Yellow Mastery. Instantly restores most of your health and your allies\', revives fallen Warders, and erases one permanent injury.',
    cast: (w, c) => w.trueHealing(c, { fraction: 0.7, allyAmount: 90, allyRadius: 165 }),
  },
  shield_of_severing: {
    name: 'Shield of Severing', recipe: ['spirit', 'spirit'], tier: 3, cost: 20, strain: 10, cooldown: 2.5, minStrength: 6,
    requires: { oaths: true, ajah: 'red' }, mastery: true,
    description: 'Red Mastery. Instantly cuts an enemy channeler off from the Source. Against anything else it strikes as a stunning lance of Spirit.',
    cast: (w, c) => w.sever(c, { range: 380, shield: 12, damage: 30, stun: 1.5 }),
  },
  seeker_lances: {
    name: 'Seeker Lances', recipe: ['air', 'water'], tier: 3, cost: 18, strain: 10, cooldown: 0.8, minStrength: 6,
    requires: { oaths: true, ajah: 'blue' }, mastery: true,
    description: 'Blue Mastery. Four lances that hunt the nearest foes and strike where they are weakest.',
    cast: (w, c) => w.spread(c, 4, 0.5, { speed: 420, radius: 5, damage: 18, homing: 5, critBonus: 0.25, slow: 1.5, slowFactor: 0.6 }),
  },
  stone_sentinel: {
    name: 'Stone Sentinel', recipe: ['earth', 'earth'], tier: 3, cost: 30, strain: 14, cooldown: 8, minStrength: 6,
    requires: { oaths: true, ajah: 'brown' }, mastery: true,
    description: 'Brown Mastery. Raise an Age-of-Legends ward-construct that hurls stone at foes for sixteen seconds.',
    validate: (w, c) => w.validatePlacement(c, 320),
    cast: (w, c) => w.sentinel(c, { duration: 16, interval: 0.55, damage: 12 }),
  },
  accord_of_stillness: {
    name: 'Accord of Stillness', recipe: ['air', 'air'], tier: 3, cost: 22, strain: 11, cooldown: 6, minStrength: 6,
    requires: { oaths: true, ajah: 'gray' }, mastery: true,
    description: 'Gray Mastery. Binds and pacifies every foe in a wide circle. Myrddraal only stop moving.',
    cast: (w, c) => w.bind(c, { range: 380, radius: 120, root: 3.5, pacify: 7 }),
  },
  lattice_of_fire: {
    name: 'Lattice of Fire', recipe: ['air', 'fire'], tier: 3, cost: 16, strain: 12, cooldown: 0.9, minStrength: 6,
    requires: { oaths: true, ajah: 'white' }, mastery: true,
    description: 'White Mastery. A perfectly computed spread of three fireballs.',
    cast: (w, c) => w.spread(c, 3, 0.26, { speed: 380, radius: 7, damage: 22, explode: { radius: 58, damage: 26, burn: 1.5, burnDps: 4 } }),
  },
};

for (const [id, weave] of Object.entries(WEAVES)) {
  weave.id = id;
  weave.recipe = canonicalRecipe(weave.recipe);
  weave.key = recipeKey(weave.recipe);
  weave.elementColors = weave.recipe.map((e) => ELEMENT_COLORS[e]);
}

const BASE_BY_RECIPE = new Map(Object.values(WEAVES).filter((w) => !w.mastery).map((w) => [w.key, w]));

// Validate the Ajah templates against the weave database at load time.
for (const ajah of Object.values(AJAHS)) {
  const weave = WEAVES[ajah.mastery.weave];
  if (!weave || weave.key !== ajah.mastery.recipe) {
    throw new Error(`Ajah ${ajah.id} mastery "${ajah.mastery.weave}" does not match recipe ${ajah.mastery.recipe}`);
  }
}

export function weaveTierLabel(weave) {
  return weave.mastery ? 'Mastery' : TIER_LABELS[weave.tier];
}

/** Ancient artifacts. Only a Brown sister can attune and use them. */
export const TER_ANGREAL = {
  ivory_angreal: {
    name: 'Ivory Angreal',
    description: 'A seated woman carved in yellowed ivory. For 10s your weaves draw no One Power and strike 35% harder.',
    cooldown: 60,
    use: (w) => {
      w.player.buffs.empower = { time: 10, potency: 0.35, free: true };
      return 'The angreal floods you with saidar.';
    },
  },
  twisted_ring: {
    name: 'Twisted Stone Ring',
    description: 'A ring of speckled stone twisted on itself. Purges half of your over-channel strain.',
    cooldown: 45,
    use: (w) => {
      w.channel.danger *= 0.5;
      return 'The ring drinks the strain from your channels.';
    },
  },
  ward_disc: {
    name: 'Bronze Ward-Disc',
    description: 'Sets a ward for 10s: Shadowspawn within it are slowed and seared.',
    cooldown: 40,
    use: (w) => {
      w.addZone({ x: w.player.x, y: w.player.y, radius: 150, time: 10, color: '#e0b060', slow: 0.4, dps: 7 });
      return 'An old ward wakes around you.';
    },
  },
  seeing_lens: {
    name: 'Crystal Seeing-Lens',
    description: 'For 12s reveals every hidden foe, trap and secret route, and sharpens your strikes (+25% crit).',
    cooldown: 50,
    use: (w) => {
      w.player.buffs.lens.time = 12;
      w.game.revealHidden();
      return 'Through the crystal, nothing is hidden.';
    },
  },
  binding_cord: {
    name: 'Silver Binding Cord',
    description: 'Roots every foe within reach for 3s.',
    cooldown: 35,
    use: (w) => {
      for (const e of w.game.enemies.inRadius(w.player.x, w.player.y, 170)) e.takeDamage(0, { source: 'player', root: 3 });
      w.game.effects.ring(w.player.x, w.player.y, 170, '#d8d8e8', 0.6, 3);
      return 'Silver threads lash out and hold fast.';
    },
  },
};

// ---------------------------------------------------------------------------
// Over-channeling risk engine
// ---------------------------------------------------------------------------

export const DANGER_STATES = [
  { id: 'stable', label: 'Stable', note: 'Your flows are steady.' },
  { id: 'strained', label: 'Strained', note: 'Recovery slows. The Source pulls at you.' },
  { id: 'volatile', label: 'Volatile', note: 'Every weave risks backlash. Extra strain accrues.' },
  { id: 'critical', label: 'Critical', note: 'Any weave may burn you out. Let go.' },
];

export function dangerState(danger, profile) {
  if (danger >= profile.critical) return DANGER_STATES[3];
  if (danger >= profile.volatile) return DANGER_STATES[2];
  if (danger >= profile.strained) return DANGER_STATES[1];
  return DANGER_STATES[0];
}

export class OverChannel {
  constructor(weaver) {
    this.weaver = weaver;
    this.danger = 0;
    this.sinceCast = 99;
    this.peak = 0;
  }

  reset() {
    this.danger = 0;
    this.sinceCast = 99;
    this.peak = 0;
  }

  get profile() {
    return this.weaver.player.dangerProfile;
  }

  get state() {
    return dangerState(this.danger, this.profile);
  }

  /**
   * Strain for a weave given the caster's title and strength. Weaving above your rank's tier or
   * below a weave's strength requirement multiplies strain sharply.
   */
  computeStrain(weave) {
    const p = this.weaver.player;
    const rankGap = Math.max(0, weave.tier - p.rank.tier);
    const strengthGap = Math.max(0, weave.minStrength - p.stats.strength);
    const multiplier = 1 + rankGap * 1.6 + strengthGap * 0.22 + (weave.forbidden ? 1 : 0);
    const resist = p.strainResist(weave.recipe);
    const st = this.state.id;
    const instability = st === 'volatile' || st === 'critical' ? 1.2 : 1;
    const strain = weave.strain * multiplier * (1 - resist) * instability * p.runMods.strain;
    return { strain, multiplier, rankGap, strengthGap, resist, instability };
  }

  add(amount) {
    this.danger = clamp(this.danger + amount, 0, this.profile.max);
    this.peak = Math.max(this.peak, this.danger);
    this.sinceCast = 0;
  }

  reduce(amount) {
    this.danger = clamp(this.danger - amount, 0, this.profile.max);
  }

  update(dt) {
    const p = this.weaver.player;
    this.sinceCast += dt;
    if (p.dread > 0) {
      this.danger = clamp(this.danger + 2.5 * dt, 0, this.profile.max);
      return;
    }
    const rate = p.dangerDecay * (this.sinceCast > 0.9 ? 1 : 0.35);
    this.danger = clamp(this.danger - rate * dt, 0, this.profile.max);
  }
}

// ---------------------------------------------------------------------------
// Runtime objects
// ---------------------------------------------------------------------------

class Projectile {
  constructor(o) {
    Object.assign(this, o);
    this.hitIds = new Set();
    this.dead = false;
  }
}

class Sentinel {
  constructor(o) {
    Object.assign(this, o);
    this.fireTimer = 0.3;
    this.dead = false;
    this.radius = 14;
  }
}

// ---------------------------------------------------------------------------
// Weaver
// ---------------------------------------------------------------------------

export class Weaver {
  constructor(game) {
    this.game = game;
    this.threads = [];
    this.lastPattern = null;
    this.cooldowns = {};
    this.globalCooldown = 0;
    this.projectiles = [];
    this.zones = [];
    this.delayed = [];
    this.sentinels = [];
    this.channel = new OverChannel(this);
    this.rng = new RNG();
    this.castCount = 0;
  }

  get player() {
    return this.game.player;
  }

  reset() {
    this.threads = [];
    this.cooldowns = {};
    this.globalCooldown = 0;
    this.projectiles = [];
    this.zones = [];
    this.delayed = [];
    this.sentinels = [];
    this.channel.reset();
    this.castCount = 0;
  }

  // -- thread building --------------------------------------------------------

  addThread(elementId) {
    if (!ELEMENT_BY_ID[elementId]) return false;
    if (this.player.channelLock > 0) {
      this.game.ui.toast(`The Source slips away from you (${Math.ceil(this.player.channelLock)}s).`, 'danger');
      return false;
    }
    if (this.threads.length >= MAX_THREADS) {
      this.game.ui.toast('Your weave holds three threads. Release it, or clear with Q.', 'warn');
      return false;
    }
    this.threads.push(elementId);
    return true;
  }

  removeThread() {
    this.threads.pop();
  }

  clearThreads() {
    this.threads = [];
  }

  /** Pain or a stun can shatter a half-formed weave. */
  disrupt() {
    if (!this.threads.length) return;
    this.threads = [];
    this.channel.add(4);
    this.game.effects.text(this.player.x, this.player.y - 28, 'Concentration broken', '#ffb0b0', 12);
  }

  identify(threads) {
    if (!threads.length) return null;
    const key = recipeKey(threads);
    const mastery = this.player.ajahDef?.mastery;
    if (mastery && mastery.recipe === key) return WEAVES[mastery.weave];
    return BASE_BY_RECIPE.get(key) ?? null;
  }

  costOf(weave) {
    const p = this.player;
    if (p.buffs.empower.time > 0 && p.buffs.empower.free) return 0;
    return weave.cost * p.mod('costMult', 1);
  }

  cooldownOf(weave) {
    return weave.cooldown * this.player.mod('cooldownMult', 1);
  }

  /** Full readiness and risk assessment for a weave, used by casting and the HUD preview. */
  assess(weave) {
    const p = this.player;
    if (!p.knows(weave.id)) return { status: 'unknown', reason: 'You have not been taught this weave.' };
    if (weave.requires?.oaths && !p.oathsSworn) return { status: 'locked', reason: 'Sealed until you swear the Three Oaths.' };
    if (weave.requires?.ajah && p.ajah !== weave.requires.ajah) {
      return { status: 'locked', reason: `Mastery of the ${AJAHS[weave.requires.ajah].name} Ajah.` };
    }
    if (weave.tier >= 3 && !weave.mastery && p.stats.strength < weave.minStrength) {
      return { status: 'locked', reason: `Requires Strength ${weave.minStrength} even to hold.` };
    }
    const cooldown = this.cooldowns[weave.id] ?? 0;
    const cost = this.costOf(weave);
    const strainInfo = this.channel.computeStrain(weave);
    const deficit = Math.max(0, cost - p.power);
    const strain = strainInfo.strain + deficit * 1.5;
    const projected = this.channel.danger + strain;
    const profile = p.dangerProfile;
    let risk;
    if (projected >= profile.max) risk = { level: 'burnout', label: 'Burnout certain' };
    else if (projected >= profile.critical) risk = { level: 'critical', label: 'Critical: burnout possible' };
    else if (projected >= profile.volatile) risk = { level: 'volatile', label: 'Volatile: backlash likely' };
    else if (deficit > 0) risk = { level: 'reckless', label: 'Overdrawing your reserves' };
    else if (strainInfo.rankGap > 0) risk = { level: 'reckless', label: `Beyond a ${p.rank.title}'s capability` };
    else if (strainInfo.strengthGap > 0) risk = { level: 'reckless', label: 'Beyond your strength' };
    else risk = { level: 'safe', label: 'Safe' };
    return { status: cooldown > 0 ? 'cooldown' : 'ready', cooldown, cost, deficit, projected, risk, ...strainInfo, strain };
  }

  preview() {
    const threads = this.threads;
    if (!threads.length) return { empty: true, threads };
    const weave = this.identify(threads);
    if (!weave) return { threads, status: 'unformed', title: 'Unformed flows', reason: 'No weave you know answers this pattern. Releasing it will strain you.' };
    const a = this.assess(weave);
    if (a.status === 'unknown') return { threads, weave, status: 'unknown', title: 'Untaught weave', reason: a.reason };
    return { threads, weave, title: weave.name, ...a };
  }

  // -- casting ----------------------------------------------------------------

  release(tx, ty) {
    if (!this.threads.length) {
      this.game.ui.toast('Gather threads first: keys 1-5 (Earth, Fire, Air, Water, Spirit).', 'info');
      return false;
    }
    return this.castPattern(this.threads.slice(), tx, ty);
  }

  recastLast(tx, ty) {
    if (!this.lastPattern) {
      this.game.ui.toast('No previous weave to repeat.', 'info');
      return false;
    }
    return this.castPattern(this.lastPattern.slice(), tx, ty);
  }

  castPattern(threads, tx, ty) {
    const game = this.game;
    const p = this.player;
    if (p.downed) return false;
    if (p.channelLock > 0) {
      game.ui.toast(`The Source slips away from you (${Math.ceil(p.channelLock)}s).`, 'danger');
      return false;
    }
    if (p.stun > 0 || this.globalCooldown > 0) return false;
    const weave = this.identify(threads);
    if (!weave) {
      this.fizzle('The flows tangle and snap back into you.', 8);
      return false;
    }
    const a = this.assess(weave);
    if (a.status === 'unknown') {
      this.fizzle('You fumble a weave you were never taught.', 10);
      return false;
    }
    if (a.status === 'locked') {
      game.ui.toast(`${weave.name}: ${a.reason}`, 'warn');
      this.threads = [];
      return false;
    }
    if (a.status === 'cooldown') {
      game.ui.toast(`${weave.name} is still settling (${a.cooldown.toFixed(1)}s).`, 'info');
      return false;
    }
    const angle = Math.atan2(ty - p.y, tx - p.x);
    const ctx = {
      weave,
      tx,
      ty,
      angle,
      elements: weave.recipe,
      potency: p.potency(weave.recipe),
      healMult: p.mod('healMult', 1),
    };
    if (weave.validate) {
      const error = weave.validate(this, ctx);
      if (error) {
        game.ui.toast(error, 'warn');
        return false;
      }
    }

    // Draw the Power. Overdrawing is possible, and dangerous.
    const cost = a.cost;
    let extraStrain = 0;
    if (p.power >= cost) {
      p.power -= cost;
    } else {
      const deficit = cost - p.power;
      p.power = 0;
      extraStrain = deficit * 1.5;
      game.harmPlayer(deficit * 0.35, 'You draw beyond your reserves!');
    }

    try {
      weave.cast(this, ctx);
    } catch (err) {
      console.error(`[magic] ${weave.id} failed`, err);
      game.ui.reportError(`The ${weave.name} weave unravelled unexpectedly.`);
    }

    this.cooldowns[weave.id] = this.cooldownOf(weave);
    this.globalCooldown = 0.12;
    this.lastPattern = threads.slice();
    this.threads = [];
    this.castCount += 1;
    const strain = a.strain - a.deficit * 1.5 + extraStrain;
    this.channel.add(strain);
    game.events.emit('weaveCast', weave, { strain, multiplier: a.multiplier, overRank: a.rankGap > 0 });
    if (weave.forbidden) game.onForbiddenWeave(weave);
    this.resolveDanger();
    return true;
  }

  fizzle(message, strain) {
    const p = this.player;
    this.channel.add(strain * (1 - p.strainResist([])));
    p.power = Math.max(0, p.power - 4);
    this.game.effects.burst(p.x, p.y, '#bbbbbb', 10, 90, 0.4, 2);
    this.game.ui.toast(message, 'warn');
    this.lastPattern = null;
    this.threads = [];
    this.resolveDanger();
  }

  /** Backlash and burnout rolls after strain has been applied. */
  resolveDanger() {
    const game = this.game;
    const p = this.player;
    const profile = p.dangerProfile;
    const d = this.channel.danger;
    if (d >= profile.max) {
      game.handleBurnout('overflow');
    } else if (d >= profile.critical && this.rng.chance(0.1)) {
      game.handleBurnout('surge');
    } else if (d >= profile.volatile && this.rng.chance(0.2)) {
      const dmg = this.rng.range(6, 14);
      game.harmPlayer(dmg, 'Backlash! The flows lash back through you.');
      p.stun = Math.max(p.stun, 0.3);
      game.effects.burst(p.x, p.y, '#ff6b3b', 16, 160, 0.5, 3);
    }
  }

  // -- Ajah abilities and artifacts ---------------------------------------------

  useAjahAbility() {
    const game = this.game;
    const p = this.player;
    const ability = p.ajahDef?.ability;
    if (!ability || ability.key !== 'F') {
      game.ui.toast('Your Ajah grants no ability on F.', 'info');
      return;
    }
    if (p.abilityCooldown > 0) {
      game.ui.toast(`${ability.name} ready in ${Math.ceil(p.abilityCooldown)}s.`, 'info');
      return;
    }
    if (ability.id === 'command_warders') {
      if (!game.allies.activeWarders.length) {
        game.ui.toast('No living Warders answer the bond.', 'warn');
        return;
      }
      const cmd = game.allies.toggleCommand();
      game.ui.toast(`Warders: ${cmd.label}. ${cmd.description}`, 'info');
      p.abilityCooldown = ability.cooldown;
    } else if (ability.id === 'compelling_voice') {
      let calmed = 0;
      for (const e of game.enemies.inRadius(p.x, p.y, ability.radius)) {
        if (e.def.pacifyImmune || e.boss || e.def.invulnerable) continue;
        e.takeDamage(0, { source: 'player', pacify: ability.duration });
        if (e.def.vision) e.suspicion = 0;
        calmed++;
      }
      game.effects.ring(p.x, p.y, ability.radius, '#c9c9d6', 0.8, 4);
      game.ui.toast(calmed ? `Your voice stills ${calmed} foe${calmed > 1 ? 's' : ''}.` : 'No one near enough to hear you.', 'info');
      p.abilityCooldown = ability.cooldown;
    }
  }

  useArtifact() {
    const game = this.game;
    const p = this.player;
    if (!p.canUseArtifacts) {
      game.ui.toast('Only a Brown sister knows how to wake a ter\'angreal.', 'info');
      return;
    }
    const art = TER_ANGREAL[p.equippedArtifact];
    if (!art) {
      game.ui.toast('No ter\'angreal equipped. Choose one in the Tower.', 'info');
      return;
    }
    if (p.artifactCooldown > 0) {
      game.ui.toast(`${art.name} is dormant (${Math.ceil(p.artifactCooldown)}s).`, 'info');
      return;
    }
    try {
      const msg = art.use(this);
      p.artifactCooldown = art.cooldown;
      game.effects.ring(p.x, p.y, 60, '#d9b26a', 0.6, 3);
      game.ui.toast(`${art.name}: ${msg}`, 'good');
    } catch (err) {
      console.error('[magic] artifact failed', err);
      game.ui.reportError(`${art.name} sputters and goes dark.`);
    }
  }

  // -- weave primitives ---------------------------------------------------------

  hitFor(ctx, extra = {}) {
    const p = this.player;
    const critChance = p.critChance + (extra.critBonus ?? 0);
    return {
      source: 'player',
      elements: ctx.elements,
      weaveId: ctx.weave.id,
      crit: critChance > 0 && this.rng.chance(critChance),
      critMult: p.critMult,
      ...extra,
    };
  }

  projectile(ctx, o, angle = ctx.angle) {
    const p = this.player;
    const color = ctx.weave.elementColors[ctx.weave.elementColors.length - 1];
    this.projectiles.push(new Projectile({
      x: p.x + Math.cos(angle) * (p.radius + 4),
      y: p.y + Math.sin(angle) * (p.radius + 4),
      vx: Math.cos(angle) * o.speed,
      vy: Math.sin(angle) * o.speed,
      speed: o.speed,
      radius: o.radius,
      damage: o.damage * ctx.potency,
      life: o.range ? o.range / o.speed : 1.4,
      pierce: o.pierce ?? 0,
      homing: o.homing ?? 0,
      colors: ctx.weave.elementColors,
      color,
      ctx,
      hit: {
        knockback: o.knockback ?? 0,
        burn: o.burn,
        burnDps: o.burnDps ? o.burnDps * ctx.potency : 0,
        slow: o.slow,
        slowFactor: o.slowFactor,
        stun: o.stun,
        critBonus: o.critBonus ?? 0,
      },
      explode: o.explode ? { ...o.explode, damage: o.explode.damage * ctx.potency, burnDps: (o.explode.burnDps ?? 0) * ctx.potency } : null,
      reveals: ctx.elements.includes('earth'),
    }));
  }

  spread(ctx, count, arc, o) {
    for (let i = 0; i < count; i++) {
      const offset = count === 1 ? 0 : -arc / 2 + (arc * i) / (count - 1);
      this.projectile(ctx, o, ctx.angle + offset);
    }
  }

  cone(ctx, o) {
    const p = this.player;
    const g = this.game;
    for (const e of g.enemies.inRadius(p.x, p.y, o.range, true)) {
      let diff = Math.atan2(e.y - p.y, e.x - p.x) - ctx.angle;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (Math.abs(diff) > o.arc / 2) continue;
      const dir = normalize(e.x - p.x, e.y - p.y);
      e.takeDamage(o.damage * ctx.potency, this.hitFor(ctx, { knockback: { x: dir.x, y: dir.y, force: o.knockback } }));
    }
    for (let i = 0; i < 18; i++) {
      const a = ctx.angle + (this.rng.next() - 0.5) * o.arc;
      const r = this.rng.range(20, o.range);
      g.effects.trail(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, '#cfefff', 3);
    }
  }

  pulse(ctx, o) {
    const p = this.player;
    this.areaHit(p.x, p.y, o.radius, o.damage * ctx.potency, ctx, { stun: o.stun });
    this.game.effects.ring(p.x, p.y, o.radius, ELEMENT_COLORS.spirit, 0.45, 4);
  }

  areaHit(x, y, radius, damage, ctx, extra = {}) {
    for (const e of this.game.enemies.inRadius(x, y, radius, true)) {
      const dir = normalize(e.x - x, e.y - y);
      const hit = this.hitFor(ctx, extra);
      if (extra.knockback) hit.knockback = { x: dir.x, y: dir.y, force: extra.knockback };
      e.takeDamage(damage, hit);
    }
    if (ctx.elements.includes('earth')) this.revealSecretsNear(x, y, radius);
  }

  revealSecretsNear(x, y, radius) {
    const map = this.game.map;
    const r = Math.ceil(radius / TILE);
    const c0 = Math.floor(x / TILE);
    const r0 = Math.floor(y / TILE);
    let found = 0;
    for (let rr = r0 - r; rr <= r0 + r; rr++) {
      for (let cc = c0 - r; cc <= c0 + r; cc++) {
        if (map.revealSecret(cc, rr)) found++;
      }
    }
    if (found) {
      this.game.effects.text(x, y - 20, 'A hidden passage!', '#b49bff', 13);
      this.game.events.emit('secretFound', found);
    }
  }

  shieldSelf(ctx, o) {
    const p = this.player;
    const amount = o.amount * ctx.potency * p.mod('shieldMult', 1);
    p.buffs.shield = { amount: Math.max(p.buffs.shield.amount, amount), time: o.duration };
    this.game.effects.ring(p.x, p.y, 30, '#bfe6ff', 0.5, 3);
  }

  healing(ctx, o) {
    const p = this.player;
    const amount = o.amount * ctx.healMult * Math.sqrt(ctx.potency);
    p.buffs.regen = { perSec: amount / o.duration, time: o.duration };
    const allies = this.game.allies.healArea(p.x, p.y, o.allyRadius, amount * 0.8);
    this.game.effects.ring(p.x, p.y, o.allyRadius, '#9effa0', 0.6, 2);
    this.game.effects.burst(p.x, p.y, '#9effa0', 14, 70, 0.7, 3);
    if (allies) this.game.effects.text(p.x, p.y - 30, `Mended ${allies}`, '#9effa0', 12);
  }

  trueHealing(ctx, o) {
    const p = this.player;
    const g = this.game;
    p.heal(p.maxHealth * o.fraction);
    p.stun = 0;
    p.root = 0;
    g.allies.healArea(p.x, p.y, o.allyRadius, o.allyAmount * ctx.healMult);
    g.effects.ring(p.x, p.y, o.allyRadius, '#ffe680', 0.8, 4);
    g.effects.burst(p.x, p.y, '#ffe680', 30, 120, 0.9, 3);
    if (p.mod('curesInjuries', false)) {
      const cured = p.cureInjury();
      if (cured) {
        g.ui.toast(`True Healing erases your ${cured.label}.`, 'good');
        g.events.emit('injuryCured', cured);
      }
    }
  }

  delve(ctx, o) {
    const p = this.player;
    p.heal(o.amount * ctx.healMult);
    p.stun = 0;
    p.root = 0;
    // Purge happens after this cast's strain is added; queue it for the next tick.
    this.delayed.push({ time: 0, run: () => this.channel.reduce(o.purge) });
    this.game.effects.ring(p.x, p.y, 40, '#e7d2ff', 0.6, 3);
  }

  eruption(ctx, o) {
    const p = this.player;
    const d = Math.min(o.range, dist(p.x, p.y, ctx.tx, ctx.ty));
    const x = p.x + Math.cos(ctx.angle) * d;
    const y = p.y + Math.sin(ctx.angle) * d;
    this.delayed.push({
      time: o.delay,
      max: o.delay,
      x,
      y,
      radius: o.radius,
      color: '#ff8a3a',
      run: () => {
        this.areaHit(x, y, o.radius, o.damage * ctx.potency, ctx, { stun: o.stun, knockback: 160 });
        this.game.effects.ring(x, y, o.radius, '#ff8a3a', 0.5, 5);
        this.game.effects.burst(x, y, '#b07a3e', 22, 200, 0.6, 4);
        this.game.effects.burst(x, y, '#ff5a26', 16, 160, 0.5, 3);
        this.game.effects.shake(o.shake ?? 5, 0.25);
      },
    });
  }

  blossom(ctx, o) {
    const p = this.player;
    const g = this.game;
    const targets = g.enemies.list.filter(
      (e) => e.countsAsHostile && e.isVisibleTo(p) && dist(p.x, p.y, e.x, e.y) <= o.range,
    );
    g.effects.ring(p.x, p.y, o.range, '#ff7a2a', 0.9, 4);
    g.effects.shake(10, 0.6);
    targets.forEach((e, i) => {
      const x = e.x;
      const y = e.y;
      this.delayed.push({
        time: 0.08 + i * 0.05,
        max: 0.3,
        x,
        y,
        radius: o.radius,
        color: '#ff5a26',
        run: () => {
          this.areaHit(x, y, o.radius, o.damage * ctx.potency, ctx, { burn: 2, burnDps: 6 * ctx.potency, knockback: 120 });
          g.effects.burst(x, y, '#ff5a26', 20, 220, 0.6, 4);
          g.effects.burst(x, y, '#ffd84a', 10, 120, 0.5, 3);
        },
      });
    });
    if (!targets.length) g.ui.toast('The blossom finds no foe to bloom beneath.', 'info');
  }

  bind(ctx, o) {
    const p = this.player;
    const d = Math.min(o.range, dist(p.x, p.y, ctx.tx, ctx.ty));
    const x = p.x + Math.cos(ctx.angle) * d;
    const y = p.y + Math.sin(ctx.angle) * d;
    for (const e of this.game.enemies.inRadius(x, y, o.radius, true)) {
      const hit = this.hitFor(ctx, { root: o.root });
      if (o.pacify) hit.pacify = o.pacify;
      e.takeDamage(0, hit);
      if (o.pacify && e.def.vision) e.suspicion = 0;
    }
    this.game.effects.ring(x, y, o.radius, '#cfefff', 0.6, 3);
    this.game.effects.burst(x, y, '#cfefff', 14, 60, 0.6, 2);
  }

  chainLightning(ctx, o) {
    const g = this.game;
    const p = this.player;
    const visible = (e) => e.countsAsHostile && e.isVisibleTo(p);
    let current = g.enemies.nearest(ctx.tx, ctx.ty, 150, visible) ?? g.enemies.nearest(p.x, p.y, 380, visible);
    if (!current) {
      const end = g.map.raycast(p.x, p.y, ctx.angle, 260);
      g.effects.beam(p.x, p.y, end.x, end.y, '#e9f4ff', 3, 0.2);
      return;
    }
    const hit = new Set();
    let fromX = p.x;
    let fromY = p.y;
    let damage = o.damage * ctx.potency;
    for (let i = 0; i < o.jumps && current; i++) {
      hit.add(current.id);
      g.effects.beam(fromX, fromY, current.x, current.y, '#e9f4ff', 4, 0.25);
      g.effects.beam(fromX, fromY, current.x, current.y, '#8fd0ff', 8, 0.15);
      current.takeDamage(damage, this.hitFor(ctx, { stun: 0.25 }));
      fromX = current.x;
      fromY = current.y;
      damage *= o.falloff;
      current = g.enemies.nearest(fromX, fromY, o.range, (e) => visible(e) && !hit.has(e.id) && g.map.lineOfSight(fromX, fromY, e.x, e.y));
    }
    g.effects.shake(4, 0.15);
  }

  balefire(ctx, o) {
    const g = this.game;
    const p = this.player;
    const end = g.map.raycast(p.x, p.y, ctx.angle, o.length);
    for (const e of g.enemies.list) {
      if (e.dead) continue;
      if (pointSegmentDistance(e.x, e.y, p.x, p.y, end.x, end.y) < e.radius + 10) {
        e.takeDamage(o.damage * ctx.potency, this.hitFor(ctx, { erase: true }));
      }
    }
    g.effects.beam(p.x, p.y, end.x, end.y, '#ffffff', 14, 0.5);
    g.effects.beam(p.x, p.y, end.x, end.y, '#ffd0ff', 24, 0.3);
    g.effects.shake(12, 0.5);
  }

  sever(ctx, o) {
    const g = this.game;
    const p = this.player;
    const inReach = (e) => !e.dead && dist(p.x, p.y, e.x, e.y) <= o.range && g.map.lineOfSight(p.x, p.y, e.x, e.y);
    const channeler = g.enemies.nearest(ctx.tx, ctx.ty, 110, (e) => e.isChanneler && inReach(e));
    if (channeler) {
      channeler.takeDamage(0, this.hitFor(ctx, { shield: o.shield, stun: 1 }));
      g.effects.beam(p.x, p.y, channeler.x, channeler.y, '#f2e6ff', 3, 0.4);
      return;
    }
    const target = g.enemies.nearest(ctx.tx, ctx.ty, 110, (e) => e.countsAsHostile && inReach(e));
    if (target) {
      target.takeDamage(o.damage * ctx.potency, this.hitFor(ctx, { stun: o.stun }));
      g.effects.beam(p.x, p.y, target.x, target.y, '#c62e2e', 4, 0.3);
    } else {
      g.ui.toast('No channeler within reach of your shield.', 'info');
    }
  }

  validateGateway(ctx, range) {
    const p = this.player;
    const map = this.game.map;
    if (dist(p.x, p.y, ctx.tx, ctx.ty) > range) return 'Too far to open a gateway.';
    if (map.collidesCircle(ctx.tx, ctx.ty, p.radius)) return 'No room to open a gateway there.';
    if (!map.lineOfSight(p.x, p.y, ctx.tx, ctx.ty)) return 'You must see where you would step.';
    return null;
  }

  validatePlacement(ctx, range) {
    const p = this.player;
    if (dist(p.x, p.y, ctx.tx, ctx.ty) > range) return 'Too far to raise a sentinel.';
    if (this.game.map.collidesCircle(ctx.tx, ctx.ty, 14)) return 'No footing for a sentinel there.';
    return null;
  }

  gateway(ctx) {
    const p = this.player;
    const g = this.game;
    g.effects.beam(p.x, p.y - 20, p.x, p.y + 20, '#ffffff', 3, 0.4);
    p.x = ctx.tx;
    p.y = ctx.ty;
    p.invuln = Math.max(p.invuln, 0.3);
    g.effects.beam(p.x, p.y - 24, p.x, p.y + 24, '#ffffff', 4, 0.5);
    g.effects.burst(p.x, p.y, '#e7d2ff', 18, 120, 0.5, 3);
  }

  sentinel(ctx, o) {
    if (this.sentinels.length >= 2) this.sentinels.shift();
    this.sentinels.push(new Sentinel({ x: ctx.tx, y: ctx.ty, time: o.duration, max: o.duration, interval: o.interval, damage: o.damage, ctx }));
    this.game.effects.burst(ctx.tx, ctx.ty, '#b07a3e', 20, 140, 0.6, 4);
  }

  addZone(z) {
    this.zones.push({ ...z, max: z.time });
  }

  // -- simulation -------------------------------------------------------------

  update(dt) {
    const g = this.game;
    const p = this.player;
    this.globalCooldown = Math.max(0, this.globalCooldown - dt);
    for (const id of Object.keys(this.cooldowns)) {
      this.cooldowns[id] -= dt;
      if (this.cooldowns[id] <= 0) delete this.cooldowns[id];
    }
    this.channel.update(dt);
    if (!p.downed) {
      // Saidar refills continuously, more slowly mid-weave and while strained.
      const weaving = this.channel.sinceCast < 0.4 ? 0.5 : 1;
      const strained = this.channel.state.id !== 'stable' ? 0.75 : 1;
      p.power = Math.min(p.maxPower, p.power + p.powerRegen * dt * weaving * strained);
    }

    for (const d of this.delayed) {
      d.time -= dt;
      if (d.time <= 0 && !d.done) {
        d.done = true;
        try {
          d.run();
        } catch (err) {
          console.error('[magic] delayed effect failed', err);
        }
      }
    }
    this.delayed = this.delayed.filter((d) => !d.done);

    for (const z of this.zones) {
      z.time -= dt;
      for (const e of g.enemies.inRadius(z.x, z.y, z.radius)) {
        if (e.def.faction !== 'shadowspawn') continue;
        e.slow = Math.max(e.slow, 0.3);
        e.slowFactor = Math.min(e.slowFactor, z.slow);
        if (z.dps) {
          e.hp -= z.dps * dt;
          if (e.hp <= 0) e.die({ cause: 'ward' });
        }
      }
    }
    this.zones = this.zones.filter((z) => z.time > 0);

    for (const s of this.sentinels) this.updateSentinel(s, dt);
    this.sentinels = this.sentinels.filter((s) => !s.dead);

    for (const pr of this.projectiles) this.updateProjectile(pr, dt);
    this.projectiles = this.projectiles.filter((pr) => !pr.dead);
  }

  updateSentinel(s, dt) {
    const g = this.game;
    s.time -= dt;
    if (s.time <= 0) {
      s.dead = true;
      g.effects.burst(s.x, s.y, '#b07a3e', 14, 100, 0.5, 3);
      return;
    }
    s.fireTimer -= dt;
    if (s.fireTimer > 0) return;
    const target = g.enemies.nearest(s.x, s.y, 330, (e) => e.countsAsHostile && e.isVisibleTo(this.player) && g.map.lineOfSight(s.x, s.y, e.x, e.y));
    if (!target) {
      s.fireTimer = 0.2;
      return;
    }
    s.fireTimer = s.interval;
    const a = Math.atan2(target.y - s.y, target.x - s.x);
    this.projectiles.push(new Projectile({
      x: s.x + Math.cos(a) * 16,
      y: s.y + Math.sin(a) * 16,
      vx: Math.cos(a) * 420,
      vy: Math.sin(a) * 420,
      speed: 420,
      radius: 6,
      damage: s.damage * s.ctx.potency,
      life: 0.9,
      pierce: 0,
      homing: 0,
      colors: [ELEMENT_COLORS.earth],
      color: ELEMENT_COLORS.earth,
      ctx: s.ctx,
      hit: { knockback: 120 },
      explode: null,
      reveals: true,
    }));
  }

  updateProjectile(pr, dt) {
    const g = this.game;
    pr.life -= dt;
    if (pr.homing) {
      const target = g.enemies.nearest(pr.x, pr.y, 300, (e) => e.countsAsHostile && !pr.hitIds.has(e.id) && e.isVisibleTo(this.player));
      if (target) {
        const desired = Math.atan2(target.y - pr.y, target.x - pr.x);
        let current = Math.atan2(pr.vy, pr.vx);
        const diff = Math.atan2(Math.sin(desired - current), Math.cos(desired - current));
        current += clamp(diff, -pr.homing * dt, pr.homing * dt);
        pr.vx = Math.cos(current) * pr.speed;
        pr.vy = Math.sin(current) * pr.speed;
      }
    }
    const steps = Math.max(1, Math.ceil((pr.speed * dt) / 6));
    for (let s = 0; s < steps && !pr.dead; s++) {
      pr.x += (pr.vx * dt) / steps;
      pr.y += (pr.vy * dt) / steps;
      if (g.map.isSolidAt(pr.x, pr.y)) {
        if (pr.reveals) {
          const c = Math.floor(pr.x / TILE);
          const r = Math.floor(pr.y / TILE);
          if (g.map.revealSecret(c, r)) {
            g.effects.text(pr.x, pr.y - 16, 'A hidden passage!', '#b49bff', 13);
            g.events.emit('secretFound', 1);
          }
        }
        this.impact(pr);
        return;
      }
      for (const e of g.enemies.list) {
        if (e.dead || pr.hitIds.has(e.id)) continue;
        if (dist(pr.x, pr.y, e.x, e.y) >= pr.radius + e.radius) continue;
        pr.hitIds.add(e.id);
        if (pr.explode) {
          this.impact(pr);
          return;
        }
        const dir = normalize(pr.vx, pr.vy);
        const hit = this.hitFor(pr.ctx, { ...pr.hit, knockback: pr.hit.knockback ? { x: dir.x, y: dir.y, force: pr.hit.knockback } : null });
        e.takeDamage(pr.damage, hit);
        g.effects.burst(pr.x, pr.y, pr.color, 6, 90, 0.3, 2);
        if (e.def.invulnerable || pr.pierce-- <= 0) {
          pr.dead = true;
          return;
        }
      }
    }
    if (pr.life <= 0) {
      if (pr.explode) this.impact(pr);
      else pr.dead = true;
      return;
    }
    if (this.rng.chance(0.7)) g.effects.trail(pr.x, pr.y, pr.colors[Math.floor(this.rng.next() * pr.colors.length)], pr.radius * 0.6);
  }

  impact(pr) {
    const g = this.game;
    pr.dead = true;
    if (pr.explode) {
      const ex = pr.explode;
      this.areaHit(pr.x, pr.y, ex.radius, ex.damage, pr.ctx, { burn: ex.burn, burnDps: ex.burnDps, knockback: 140 });
      g.effects.ring(pr.x, pr.y, ex.radius, '#ffb347', 0.45, 5);
      g.effects.burst(pr.x, pr.y, '#ff5a26', 26, 220, 0.6, 4);
      g.effects.burst(pr.x, pr.y, '#ffd84a', 12, 140, 0.4, 3);
      g.effects.shake(5, 0.2);
    } else {
      g.effects.burst(pr.x, pr.y, pr.color, 8, 100, 0.35, 2);
    }
  }

  renderUnder(ctx, time) {
    for (const z of this.zones) {
      ctx.globalAlpha = 0.18 + Math.sin(time * 4) * 0.05;
      ctx.fillStyle = z.color;
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    for (const d of this.delayed) {
      if (d.x === undefined || !d.max) continue;
      const t = 1 - clamp(d.time / d.max, 0, 1);
      ctx.strokeStyle = d.color;
      ctx.globalAlpha = 0.5 + t * 0.5;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = d.color;
      ctx.globalAlpha = 0.15 + t * 0.2;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.radius * t, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  render(ctx, time) {
    for (const s of this.sentinels) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.fillStyle = '#7a5530';
      ctx.fillRect(-12, -12, 24, 24);
      ctx.fillStyle = '#b07a3e';
      ctx.fillRect(-8, -8, 16, 16);
      ctx.strokeStyle = '#e7d2ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (s.time / s.max));
      ctx.stroke();
      ctx.restore();
    }
    for (const pr of this.projectiles) {
      ctx.fillStyle = pr.color;
      ctx.beginPath();
      ctx.arc(pr.x, pr.y, pr.radius, 0, Math.PI * 2);
      ctx.fill();
      if (pr.colors.length > 1) {
        ctx.strokeStyle = pr.colors[0];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pr.x, pr.y, pr.radius + 2 + Math.sin(time * 20) * 1, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
}
