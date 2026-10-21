// The channeler: progression from Novice to Aes Sedai, Ajah class templates, scars and movement.

import { clamp, normalize } from './util.js';

export const ELEMENT_IDS = ['earth', 'fire', 'air', 'water', 'spirit'];
export const STAT_IDS = ['strength', 'control', 'reserve', 'vitality'];

export const STAT_INFO = {
  strength: { label: 'Strength', description: 'Raw strength in the Power. Raises weave potency; capped by your Potential.' },
  control: { label: 'Control', description: 'Precision of your flows. Reduces strain and speeds recovery from over-channeling.' },
  reserve: { label: 'Reserve', description: 'How much saidar you can draw safely. Raises your One Power pool and its recovery.' },
  vitality: { label: 'Vitality', description: 'Bodily endurance. Raises maximum health.' },
};

export const RANKS = [
  { id: 'novice', title: 'Novice', tier: 1, statCap: 8, description: 'Garbed in white, forbidden to channel without a sister present.' },
  { id: 'accepted', title: 'Accepted', tier: 2, statCap: 12, description: 'Bearer of the Great Serpent ring and the banded hem of all seven Ajahs.' },
  { id: 'aes_sedai', title: 'Aes Sedai', tier: 3, statCap: 16, description: 'Full sister of the White Tower, bound by the Three Oaths.' },
];

export const AFFINITIES = {
  earth: { label: 'Earth', description: 'Stone answers you first. +12% potency and -10% strain on Earth weaves.' },
  fire: { label: 'Fire', description: 'Flame leaps to your call. +12% potency and -10% strain on Fire weaves.' },
  air: { label: 'Air', description: 'The wind is an old friend. +12% potency and -10% strain on Air weaves.' },
  water: { label: 'Water', description: 'Water flows through you easily. +12% potency and -10% strain on Water weaves.' },
  spirit: { label: 'Spirit', description: 'Rare and subtle. +12% potency and -10% strain on Spirit weaves.' },
};

export const DEFAULT_DANGER = Object.freeze({ strained: 35, volatile: 65, critical: 85, max: 100 });

/**
 * Ajah class templates. Applied permanently when an Accepted is raised to the shawl.
 * statTemplate  — permanent shifts to core stats
 * modifiers     — operational hooks read by player.js, magic.js, allies.js and missions.js
 * danger        — over-channeling thresholds (strained / volatile / critical / burnout max)
 * mastery       — recipe key whose weave is replaced by the Ajah's Mastery Weave
 */
export const AJAHS = {
  green: {
    id: 'green',
    name: 'Green',
    epithet: 'The Battle Ajah',
    archetype: 'Combat Mage',
    color: '#2e9e4f',
    creed: 'The Greens hold themselves ready for Tarmon Gai\'don. They alone love the company of men enough to bond many Warders, and they meet the Shadow with fire and stone.',
    statTemplate: { strength: 2, vitality: 3, control: -1 },
    buffs: ['+20% weave damage', '+3 Vitality (stamina)', 'Dash recovers 30% faster', '-1 Control'],
    modifiers: { damageMult: 1.2, dashCooldownMult: 0.7, maxWarders: 3 },
    passive: {
      id: 'warder_bond',
      name: 'Multi-Warder Bond',
      description: 'Up to three bonded Warders fight beside you and draw enemy aggro. Press F to switch them between Guard and Engage. A Warder left bleeding too long dies, and you will feel it.',
    },
    ability: { key: 'F', id: 'command_warders', name: 'Command Warders', cooldown: 0.4 },
    mastery: { recipe: 'earth+fire', weave: 'blossom_of_fire' },
    danger: { strained: 40, volatile: 80, critical: 108, max: 130 },
    dangerNote: 'Battle-hardened: burnout strikes only at 130 strain.',
  },
  yellow: {
    id: 'yellow',
    name: 'Yellow',
    epithet: 'The Healers',
    archetype: 'Healer / Support',
    color: '#e1c12b',
    creed: 'The Yellows give their lives to the study of Healing. Where other sisters mend, a Yellow restores what the Pattern itself thought lost.',
    statTemplate: { reserve: 3, control: 1, strength: -1 },
    buffs: ['+3 Reserve (spirit pool)', '+35% One Power recovery', 'Regenerate 1.5 health/s', 'Healing weaves +60%', '-1 Strength'],
    modifiers: { healMult: 1.6, powerRegenMult: 1.35, healthRegen: 1.5, curesInjuries: true },
    passive: {
      id: 'true_healing',
      name: 'True Healing',
      description: 'Your healing weaves mend flesh and permanent critical injuries alike: each True Healing erases one injury scar instantly.',
    },
    ability: null,
    mastery: { recipe: 'water+spirit', weave: 'true_healing' },
    danger: DEFAULT_DANGER,
    dangerNote: 'Standard thresholds; deep reserves keep you from overdrawing.',
  },
  red: {
    id: 'red',
    name: 'Red',
    epithet: 'The Enforcers',
    archetype: 'Anti-Mage / Enforcer',
    color: '#c62e2e',
    creed: 'The largest Ajah. The Reds guard the world against the misuse of the One Power, hunting and gentling men who channel. They bond no Warders and trust no man.',
    statTemplate: { strength: 1, control: 1, vitality: -1 },
    buffs: ['+15% movement speed', 'Air Shields absorb 60% more', '+1 Strength, +1 Control', '-1 Vitality'],
    modifiers: { moveSpeedMult: 1.15, shieldMult: 1.6, canSever: true },
    passive: {
      id: 'severing',
      name: 'Shielding / Severing',
      description: 'Only you may weave the Shield of Severing (Spirit + Spirit): it instantly cuts an enemy channeler off from the Source. A shielded foe can be seized by touch.',
    },
    ability: null,
    mastery: { recipe: 'spirit+spirit', weave: 'shield_of_severing' },
    danger: DEFAULT_DANGER,
    dangerNote: 'Standard thresholds.',
  },
  blue: {
    id: 'blue',
    name: 'Blue',
    epithet: 'The Spies & Justiciars',
    archetype: 'Tactician / Spy Master',
    color: '#2f6fd6',
    creed: 'Few in number, vast in reach. The Blues pursue justice and causes across nations, steering thrones through the widest web of eyes-and-ears in the world.',
    statTemplate: { control: 1, reserve: 1 },
    buffs: ['20% critical strike chance (x2 damage)', 'Wider vision and camera', 'Hidden foes always visible', '+1 Control, +1 Reserve'],
    modifiers: { critChance: 0.2, critMult: 2, visionRadius: 14, cameraZoom: 0.85, seesHidden: true, revealMap: true },
    passive: {
      id: 'eyes_and_ears',
      name: 'Eyes and Ears',
      description: 'Your minimap reveals the whole level on arrival: every hidden enemy, trap and secret route. Secret passages open to you.',
    },
    ability: null,
    mastery: { recipe: 'air+water', weave: 'seeker_lances' },
    danger: DEFAULT_DANGER,
    dangerNote: 'Standard thresholds.',
  },
  brown: {
    id: 'brown',
    name: 'Brown',
    epithet: 'The Scholars',
    archetype: 'Scholar / Lore Master',
    color: '#8a5a2b',
    creed: 'The Browns keep the Tower Library and the memory of Ages. Their minds live among lost texts and forgotten mysteries of the Power.',
    statTemplate: { reserve: 4, vitality: -1 },
    buffs: ['+4 Reserve (larger One Power cap)', '+25% experience (research)', '+1 Potential', 'Wider safe channeling band', '-1 Vitality'],
    modifiers: { xpMult: 1.25, potentialBonus: 1, artifactUse: true },
    passive: {
      id: 'terangreal_mastery',
      name: 'Ter\'angreal Mastery',
      description: 'You can attune ancient artifacts recovered from ruins. Equip one in the Tower and trigger it with R. Other sisters can only send such finds to the archives.',
    },
    ability: { key: 'R', id: 'use_artifact', name: 'Use Ter\'angreal' },
    mastery: { recipe: 'earth+earth', weave: 'stone_sentinel' },
    danger: { strained: 48, volatile: 72, critical: 90, max: 100 },
    dangerNote: 'Studied calm: a wider safe band before strain sets in.',
  },
  gray: {
    id: 'gray',
    name: 'Gray',
    epithet: 'The Diplomats',
    archetype: 'Diplomat / Crowd Control',
    color: '#8d8d94',
    creed: 'Mediators and negotiators, the Grays end wars at the table and bind nations with treaties. A Gray sister\'s voice can still a battlefield.',
    statTemplate: { control: 2, vitality: 1, strength: -1 },
    buffs: ['+40% dialogue check chance', 'Take 20% less damage (armor)', '+2 Control, +1 Vitality', '-1 Strength'],
    modifiers: { persuasion: 40, armor: 0.2, compellingVoice: true },
    passive: {
      id: 'compelling_voice',
      name: 'Compelling Voice',
      description: 'Talk your way past certain mini-bosses, and press F to pacify every non-Myrddraal foe within reach for six seconds.',
    },
    ability: { key: 'F', id: 'compelling_voice', name: 'Compelling Voice', cooldown: 22, radius: 210, duration: 6 },
    mastery: { recipe: 'air+air', weave: 'accord_of_stillness' },
    danger: DEFAULT_DANGER,
    dangerNote: 'Standard thresholds.',
  },
  white: {
    id: 'white',
    name: 'White',
    epithet: 'The Philosophers',
    archetype: 'Glass Cannon / Logician',
    color: '#f2f2f2',
    creed: 'The Whites seek truth through pure reason, logic and philosophy. Cool and aloof, they weave with mathematical perfection.',
    statTemplate: { control: 3, vitality: -2 },
    buffs: ['Weaves cost 60% less One Power', 'Weave cooldowns 45% faster', 'Wider safe channeling band', '+3 Control', '-20% max health, -2 Vitality'],
    modifiers: { costMult: 0.4, cooldownMult: 0.55, maxHealthMult: 0.8 },
    passive: {
      id: 'perfect_flow',
      name: 'Perfect Flow',
      description: 'Weaving cost drops dramatically and recovery quickens, allowing rapid-fire casting at the price of a frail body.',
    },
    ability: null,
    mastery: { recipe: 'fire+air', weave: 'lattice_of_fire' },
    danger: { strained: 50, volatile: 74, critical: 90, max: 100 },
    dangerNote: 'Logical discipline: a wider safe band before strain sets in.',
  },
};

export const AJAH_ORDER = ['green', 'yellow', 'red', 'blue', 'brown', 'gray', 'white'];

/** Permanent wounds. kind: injury (curable by Yellow True Healing) | trauma | burnout. */
export const SCARS = {
  shadow_touched: {
    label: 'Shadow-Touched', kind: 'injury', effects: { maxHealth: -12 },
    description: 'A Trolloc blade opened you in the garden. The wound never fully closed.',
  },
  arch_haunted: {
    label: 'Arch-Haunted', kind: 'trauma', effects: { control: -1 },
    description: 'Something from the arches followed you out. Your flows tremble when you remember.',
  },
  blight_burned: {
    label: 'Blight-Burned', kind: 'injury', effects: { reserve: -1 },
    description: 'Rift-fire seared your channels at the Shining Walls.',
  },
  fade_marked: {
    label: 'Fade-Marked', kind: 'injury', effects: { vitality: -1 },
    description: 'A Myrddraal blade left a wound that festers cold.',
  },
  saidar_burn: {
    label: 'Saidar Burn', kind: 'burnout', effects: { strength: -1, reserve: -1 },
    description: 'You drew more than you could hold. Part of you burned away.',
  },
  bond_severed: {
    label: 'Bond Severed', kind: 'trauma', effects: { control: -1 },
    description: 'A Warder died at the end of your bond. The grief does not fade.',
  },
  plague_guilt: {
    label: 'Ferry Fever', kind: 'injury', effects: { maxHealth: -10 },
    description: 'The fever you could not stop found its way into you.',
  },
};

export const STARTING_WEAVES = ['stone_shard', 'flame_lash', 'gust', 'tidal_lash', 'spirit_pulse'];
const WARDER_NAMES = ['Tarn al\'Cerin', 'Joric Valmere', 'Edrin Thalvar', 'Dav Holloway', 'Kaer Sandovan', 'Mattin Roak', 'Bren Ostrander', 'Lorin Gaedal'];
const BASE_SPEED = 155;
const MAX_STRIKES = 3;
const MAX_BURNOUTS = 3;

export class Player {
  constructor({ name, affinity }) {
    if (!name || typeof name !== 'string') throw new Error('A channeler needs a name.');
    if (!AFFINITIES[affinity]) throw new Error(`Unknown affinity "${affinity}"`);
    this.name = name;
    this.affinity = affinity;
    this.rankIndex = 0;
    this.level = 1;
    this.xp = 0;
    this.statPoints = 0;
    this.stats = { strength: 4, control: 4, reserve: 4, vitality: 4 };
    this.potential = 7;
    this.prestige = 0;
    this.strikes = 0;
    this.burnouts = 0;
    this.ajah = null;
    this.oathsSworn = false;
    this.healthBonus = 0;
    this.knownWeaves = new Set(STARTING_WEAVES);
    this.outcomes = {};
    this.counts = {};
    this.chronicle = [];
    this.scars = [];
    this.flags = {};
    this.warders = [];
    this.artifacts = [];
    this.equippedArtifact = null;
    this.radius = 12;
    this.runMods = { potency: 1, strain: 1, dangerDecay: 1 };
    this.resetRuntime(0, 0);
  }

  static get MAX_STRIKES() {
    return MAX_STRIKES;
  }

  static get MAX_BURNOUTS() {
    return MAX_BURNOUTS;
  }

  // -- derived values ---------------------------------------------------------

  get rank() {
    return RANKS[this.rankIndex];
  }

  get ajahDef() {
    return this.ajah ? AJAHS[this.ajah] : null;
  }

  mod(key, fallback) {
    const value = this.ajahDef?.modifiers?.[key];
    return value === undefined ? fallback : value;
  }

  get title() {
    if (this.rank.id === 'aes_sedai' && this.ajahDef) return `Aes Sedai of the ${this.ajahDef.name} Ajah`;
    return this.rank.title;
  }

  get maxHealth() {
    return Math.max(20, Math.round((50 + this.stats.vitality * 10 + this.healthBonus) * this.mod('maxHealthMult', 1)));
  }

  get maxPower() {
    return 40 + this.stats.reserve * 10;
  }

  get powerRegen() {
    return (8 + this.stats.reserve * 0.9) * this.mod('powerRegenMult', 1);
  }

  get dangerProfile() {
    return this.ajahDef?.danger ?? DEFAULT_DANGER;
  }

  get dangerDecay() {
    return (7 + this.stats.control * 0.9) * this.runMods.dangerDecay;
  }

  get moveSpeed() {
    const haste = this.buffs.haste.time > 0 ? this.buffs.haste.mult : 1;
    return BASE_SPEED * this.mod('moveSpeedMult', 1) * haste;
  }

  get critChance() {
    return this.mod('critChance', 0) + (this.buffs.lens.time > 0 ? 0.25 : 0);
  }

  get critMult() {
    return this.mod('critMult', 1.75);
  }

  get seesHidden() {
    return !!this.mod('seesHidden', false) || this.buffs.lens.time > 0;
  }

  get visionRadius() {
    return this.mod('visionRadius', 9);
  }

  get persuasionChance() {
    return clamp(Math.round(25 + this.stats.control * 3 + this.prestige / 6 + this.mod('persuasion', 0)), 5, 95);
  }

  get damageTakenMult() {
    return 1 - this.mod('armor', 0);
  }

  get canUseArtifacts() {
    return !!this.mod('artifactUse', false);
  }

  get xpToNext() {
    return Player.xpForLevel(this.level);
  }

  static xpForLevel(level) {
    return Math.round(100 * Math.pow(level, 1.5));
  }

  /** Damage multiplier for a weave made of the given elements. */
  potency(elements) {
    const base = 0.7 + this.stats.strength * 0.075;
    let mastery = 0;
    for (const el of elements) if (el === this.affinity) mastery += 0.12 / elements.length;
    const rankBonus = 1 + this.rankIndex * 0.06;
    const empower = this.buffs.empower.time > 0 ? 1 + this.buffs.empower.potency : 1;
    return base * (1 + mastery) * rankBonus * this.mod('damageMult', 1) * empower * this.runMods.potency;
  }

  /** Fraction of strain shed by control, affinity and active focus (0 – 0.7). */
  strainResist(elements) {
    let resist = Math.min(0.5, this.stats.control * 0.03);
    if (elements.includes(this.affinity)) resist += 0.1;
    if (this.buffs.focus.time > 0) resist += 0.25;
    return clamp(resist, 0, 0.7);
  }

  /** Third Oath: a sworn sister may harm humans only in the last extreme of defending her life. */
  oathBlocksHarm() {
    return this.oathsSworn && this.health / this.maxHealth > 0.4;
  }

  // -- progression ------------------------------------------------------------

  gainXP(amount) {
    const gained = Math.max(0, Math.round(amount * this.mod('xpMult', 1)));
    this.xp += gained;
    let levels = 0;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level += 1;
      this.statPoints += 2;
      if (this.level % 3 === 0) this.potential += 1;
      levels += 1;
    }
    if (levels) {
      this.addChronicle(`Reached level ${this.level}. Your strength in the Power deepens.`, 'growth');
    }
    return { gained, levels };
  }

  statCap(stat) {
    const cap = this.rank.statCap;
    return stat === 'strength' ? Math.min(cap, this.potential) : cap;
  }

  canRaise(stat) {
    return this.statPoints > 0 && STAT_IDS.includes(stat) && this.stats[stat] < this.statCap(stat);
  }

  raise(stat) {
    if (!this.canRaise(stat)) return false;
    this.stats[stat] += 1;
    this.statPoints -= 1;
    return true;
  }

  adjustStats(delta) {
    for (const [key, value] of Object.entries(delta ?? {})) {
      if (STAT_IDS.includes(key)) this.stats[key] = Math.max(1, this.stats[key] + value);
      else if (key === 'potential') this.potential = Math.max(1, this.potential + value);
      else if (key === 'maxHealth') this.healthBonus += value;
    }
  }

  knows(weaveId) {
    return this.knownWeaves.has(weaveId);
  }

  learn(weaveId) {
    if (this.knownWeaves.has(weaveId)) return false;
    this.knownWeaves.add(weaveId);
    return true;
  }

  promote() {
    if (this.rankIndex >= RANKS.length - 1) return false;
    this.rankIndex += 1;
    this.addChronicle(`Raised to ${this.rank.title}.`, 'ceremony');
    return true;
  }

  chooseAjah(id) {
    const def = AJAHS[id];
    if (!def) throw new Error(`Unknown Ajah "${id}"`);
    if (this.ajah) throw new Error('An Aes Sedai never leaves her Ajah.');
    this.ajah = id;
    this.adjustStats(def.statTemplate);
    if (def.modifiers.potentialBonus) this.potential += def.modifiers.potentialBonus;
    this.learn(def.mastery.weave);
    if (def.modifiers.maxWarders) {
      while (this.warders.length < def.modifiers.maxWarders) this.bondWarder(false);
    }
    if (def.modifiers.artifactUse && !this.artifacts.includes('ivory_angreal')) {
      this.artifacts.push('ivory_angreal');
      this.equippedArtifact = 'ivory_angreal';
    }
    this.addChronicle(`Chose the ${def.name} Ajah: ${def.epithet}.`, 'ceremony');
  }

  bondWarder(announce = true) {
    const max = this.mod('maxWarders', 0);
    const living = this.warders.filter((w) => w.alive).length;
    if (living >= max) return null;
    const used = new Set(this.warders.map((w) => w.name));
    const name = WARDER_NAMES.find((n) => !used.has(n)) ?? `Warder ${this.warders.length + 1}`;
    const record = { name, alive: true };
    this.warders.push(record);
    if (announce) this.addChronicle(`Bonded ${name} as your Warder.`, 'growth');
    return record;
  }

  swearOaths() {
    this.oathsSworn = true;
    this.addChronicle('Swore the Three Oaths upon the Oath Rod.', 'ceremony');
  }

  applyScar(id) {
    const def = SCARS[id];
    if (!def) throw new Error(`Unknown scar "${id}"`);
    const applied = {};
    for (const [key, value] of Object.entries(def.effects)) {
      if (STAT_IDS.includes(key)) {
        const before = this.stats[key];
        this.stats[key] = Math.max(1, before + value);
        applied[key] = this.stats[key] - before;
      } else if (key === 'maxHealth') {
        this.healthBonus += value;
        applied.maxHealth = value;
      }
    }
    const scar = { id, label: def.label, kind: def.kind, description: def.description, applied };
    this.scars.push(scar);
    this.addChronicle(`Scarred: ${def.label}. ${def.description}`, 'wound');
    this.health = Math.min(this.health, this.maxHealth);
    return scar;
  }

  /** Yellow True Healing: removes the oldest injury scar and restores what it took. */
  cureInjury() {
    const index = this.scars.findIndex((s) => s.kind === 'injury');
    if (index === -1) return null;
    const [scar] = this.scars.splice(index, 1);
    for (const [key, value] of Object.entries(scar.applied)) {
      if (STAT_IDS.includes(key)) this.stats[key] -= value;
      else if (key === 'maxHealth') this.healthBonus -= value;
    }
    this.addChronicle(`Healed of ${scar.label}. The old wound is gone as if it never was.`, 'growth');
    return scar;
  }

  addChronicle(text, tone = 'info') {
    this.chronicle.push({ text, tone, level: this.level, rank: this.rank.title });
    if (this.chronicle.length > 200) this.chronicle.shift();
  }

  get expelled() {
    return this.strikes >= MAX_STRIKES;
  }

  get stilled() {
    return this.burnouts >= MAX_BURNOUTS;
  }

  // -- runtime ----------------------------------------------------------------

  resetRuntime(x, y) {
    this.x = x;
    this.y = y;
    this.facing = 0;
    this.health = this.maxHealth;
    this.power = this.maxPower;
    this.invuln = 0;
    this.stun = 0;
    this.root = 0;
    this.dashTime = 0;
    this.dashCooldown = 0;
    this.dashDir = { x: 1, y: 0 };
    this.downed = false;
    this.dread = 0;
    this.channelLock = 0;
    this.flash = 0;
    this.abilityCooldown = 0;
    this.artifactCooldown = 0;
    this.buffs = {
      shield: { amount: 0, time: 0 },
      regen: { perSec: 0, time: 0 },
      haste: { mult: 1, time: 0 },
      focus: { time: 0 },
      empower: { time: 0, potency: 0, free: false },
      lens: { time: 0 },
    };
  }

  heal(amount) {
    if (this.downed) return 0;
    const before = this.health;
    this.health = Math.min(this.maxHealth, this.health + amount);
    return this.health - before;
  }

  update(dt, input, map) {
    for (const key of ['invuln', 'stun', 'root', 'dashCooldown', 'channelLock', 'flash', 'abilityCooldown', 'artifactCooldown']) {
      this[key] = Math.max(0, this[key] - dt);
    }
    this.dread = Math.max(0, this.dread - dt);
    for (const buff of Object.values(this.buffs)) buff.time = Math.max(0, buff.time - dt);
    if (this.buffs.shield.time <= 0) this.buffs.shield.amount = 0;
    if (this.downed) return;
    if (this.buffs.regen.time > 0) this.heal(this.buffs.regen.perSec * dt);
    const passiveRegen = this.mod('healthRegen', 0);
    if (passiveRegen) this.heal(passiveRegen * dt);

    this.facing = Math.atan2(input.mouse.worldY - this.y, input.mouse.worldX - this.x);
    if (this.stun > 0) return;

    let mx = 0;
    let my = 0;
    if (input.isDown('KeyW') || input.isDown('ArrowUp')) my -= 1;
    if (input.isDown('KeyS') || input.isDown('ArrowDown')) my += 1;
    if (input.isDown('KeyA') || input.isDown('ArrowLeft')) mx -= 1;
    if (input.isDown('KeyD') || input.isDown('ArrowRight')) mx += 1;
    const dir = normalize(mx, my);

    if (input.consume('dash') && this.dashCooldown <= 0 && this.root <= 0) {
      this.dashDir = dir.len > 0 ? dir : { x: Math.cos(this.facing), y: Math.sin(this.facing) };
      this.dashTime = 0.16;
      this.dashCooldown = 1.1 * this.mod('dashCooldownMult', 1);
      this.invuln = Math.max(this.invuln, 0.16);
    }
    if (this.dashTime > 0) {
      this.dashTime -= dt;
      map.moveCircle(this, this.dashDir.x * 520 * dt, this.dashDir.y * 520 * dt);
      return;
    }
    if (this.root > 0 || dir.len === 0) return;
    const speed = this.moveSpeed;
    map.moveCircle(this, dir.x * speed * dt, dir.y * speed * dt);
  }

  render(ctx, time, threadColors) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 9, 12, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    if (this.downed) {
      ctx.fillStyle = '#d8d4cc';
      ctx.beginPath();
      ctx.ellipse(0, 0, 15, 8, 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    if (threadColors.length) {
      ctx.globalAlpha = 0.35 + Math.sin(time * 6) * 0.1;
      ctx.fillStyle = '#fff6d8';
      ctx.beginPath();
      ctx.arc(0, 0, this.radius + 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      threadColors.forEach((color, i) => {
        const a = time * 3 + (i * Math.PI * 2) / threadColors.length;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * (this.radius + 9), Math.sin(a) * (this.radius + 9), 4, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    if (this.buffs.shield.amount > 0) {
      ctx.strokeStyle = 'rgba(190,230,255,0.85)';
      ctx.lineWidth = 2 + Math.min(4, this.buffs.shield.amount / 15);
      ctx.beginPath();
      ctx.arc(0, 0, this.radius + 13, 0, Math.PI * 2);
      ctx.stroke();
    }

    const flashing = this.flash > 0 || (this.invuln > 0 && Math.floor(time * 20) % 2 === 0 && this.dashTime <= 0);
    ctx.rotate(this.facing);
    ctx.fillStyle = flashing ? '#ffb4b4' : this.rank.id === 'aes_sedai' ? '#e6e1d6' : '#f7f4ee';
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fill();

    if (this.rank.id === 'accepted') {
      const bands = ['#2e9e4f', '#e1c12b', '#c62e2e', '#2f6fd6', '#8a5a2b', '#8d8d94', '#f2f2f2'];
      bands.forEach((color, i) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        const a0 = Math.PI * 0.55 + (i * Math.PI * 0.9) / bands.length;
        ctx.arc(0, 0, this.radius - 1.5, a0, a0 + (Math.PI * 0.9) / bands.length);
        ctx.stroke();
      });
    } else if (this.rank.id === 'aes_sedai' && this.ajahDef) {
      ctx.fillStyle = this.ajahDef.color;
      ctx.beginPath();
      ctx.moveTo(-this.radius - 2, -this.radius + 2);
      ctx.quadraticCurveTo(-this.radius - 8, 0, -this.radius - 2, this.radius - 2);
      ctx.lineTo(2, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = this.ajahDef.color;
      ctx.lineWidth = 1;
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(-this.radius - 4, i * 3);
        ctx.lineTo(-this.radius - 9, i * 3.5);
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#e9cfae';
    ctx.beginPath();
    ctx.arc(4, 0, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3a2a1e';
    ctx.beginPath();
    ctx.arc(1, 0, 5, Math.PI * 0.5, Math.PI * 1.5);
    ctx.fill();
    ctx.restore();

    if (this.stun > 0 || this.root > 0) {
      ctx.strokeStyle = this.stun > 0 ? '#ffe36b' : '#cfe8ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // -- persistence ------------------------------------------------------------

  serialize() {
    return {
      name: this.name,
      affinity: this.affinity,
      rankIndex: this.rankIndex,
      level: this.level,
      xp: this.xp,
      statPoints: this.statPoints,
      stats: { ...this.stats },
      potential: this.potential,
      prestige: this.prestige,
      strikes: this.strikes,
      burnouts: this.burnouts,
      ajah: this.ajah,
      oathsSworn: this.oathsSworn,
      healthBonus: this.healthBonus,
      knownWeaves: [...this.knownWeaves],
      outcomes: { ...this.outcomes },
      counts: { ...this.counts },
      chronicle: this.chronicle.slice(),
      scars: this.scars.map((s) => ({ ...s, applied: { ...s.applied } })),
      flags: { ...this.flags },
      warders: this.warders.map((w) => ({ ...w })),
      artifacts: this.artifacts.slice(),
      equippedArtifact: this.equippedArtifact,
    };
  }

  static deserialize(data) {
    if (!data || typeof data !== 'object') throw new Error('Save data is missing.');
    const p = new Player({ name: String(data.name || 'Initiate').slice(0, 24), affinity: AFFINITIES[data.affinity] ? data.affinity : 'fire' });
    const int = (v, fallback, min = 0) => (Number.isFinite(v) ? Math.max(min, Math.floor(v)) : fallback);
    p.rankIndex = clamp(int(data.rankIndex, 0), 0, RANKS.length - 1);
    p.level = int(data.level, 1, 1);
    p.xp = int(data.xp, 0);
    p.statPoints = int(data.statPoints, 0);
    for (const stat of STAT_IDS) p.stats[stat] = int(data.stats?.[stat], p.stats[stat], 1);
    p.potential = int(data.potential, p.potential, 1);
    p.prestige = Number.isFinite(data.prestige) ? Math.floor(data.prestige) : 0;
    p.strikes = int(data.strikes, 0);
    p.burnouts = int(data.burnouts, 0);
    p.ajah = AJAHS[data.ajah] ? data.ajah : null;
    p.oathsSworn = !!data.oathsSworn;
    p.healthBonus = Number.isFinite(data.healthBonus) ? data.healthBonus : 0;
    if (Array.isArray(data.knownWeaves)) p.knownWeaves = new Set([...STARTING_WEAVES, ...data.knownWeaves.filter((w) => typeof w === 'string')]);
    p.outcomes = data.outcomes && typeof data.outcomes === 'object' ? { ...data.outcomes } : {};
    p.counts = data.counts && typeof data.counts === 'object' ? { ...data.counts } : {};
    p.chronicle = Array.isArray(data.chronicle) ? data.chronicle.filter((c) => c && typeof c.text === 'string').slice(-200) : [];
    p.scars = Array.isArray(data.scars) ? data.scars.filter((s) => s && SCARS[s.id]).map((s) => ({ ...s, applied: { ...(s.applied ?? {}) } })) : [];
    p.flags = data.flags && typeof data.flags === 'object' ? { ...data.flags } : {};
    p.warders = Array.isArray(data.warders) ? data.warders.filter((w) => w && typeof w.name === 'string').map((w) => ({ name: w.name, alive: !!w.alive })) : [];
    p.artifacts = Array.isArray(data.artifacts) ? data.artifacts.filter((a) => typeof a === 'string') : [];
    p.equippedArtifact = p.artifacts.includes(data.equippedArtifact) ? data.equippedArtifact : null;
    p.resetRuntime(0, 0);
    return p;
  }
}
