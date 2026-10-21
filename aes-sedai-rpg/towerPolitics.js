// Tower politics: the weekly calendar, the strength hierarchy, Ajah influence, novice sponsorship,
// the conspiracy to depose the Amyrlin Seat, covert missions, and the Tower Coup.

import { clamp, dist, RNG } from './util.js';
import { T, TILE, TileMap } from './world.js';
import { AJAHS, AJAH_ORDER } from './player.js';
import { TER_ANGREAL, WEAVES } from './magic.js';
import { Navigator } from './enemies.js';

export const ACTIONS_PER_WEEK = 2;
const LEVERAGE_NEEDED = 3;
const CONSPIRACY_DRIFT = 4;

const FIRST_NAMES = ['Aveline', 'Berisha', 'Cerys', 'Doraine', 'Ilsabet', 'Kerene', 'Lirelle', 'Merisande', 'Naela', 'Orvanne', 'Pevara', 'Rhiannet', 'Saerin', 'Talva', 'Varilin', 'Yselde', 'Zemira', 'Adeleas', 'Coiren', 'Jesmaine', 'Marith', 'Toveine', 'Elsbet', 'Gwenneth'];
const FAMILY_NAMES = ['Corrin', 'Valdane', 'Morlaine', 'Hallet', 'Tamsor', 'Avenell', 'Druvain', 'Sorvale', 'Ketterin', 'Mallory', 'Rhosyn', 'Ansaline', 'Thorne', 'Dalvane', 'Ebrel', 'Farris'];
const NOVICE_NAMES = ['Lini Haral', 'Mera Doan', 'Sel Tarran', 'Ama Vorley', 'Tessa Brin', 'Ilyn Corso', 'Rhea Malden', 'Jaim Sorrel'];
const TALENTS = ['Earth-sight', 'Cloud Dancing', 'Foretelling', 'Healing', 'Reading residues', 'Making ter\'angreal', 'Dreaming', 'Unweaving'];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

function generateRoster(seed) {
  const rng = new RNG(seed);
  const used = new Set();
  const name = () => {
    for (;;) {
      const n = `${rng.pick(FIRST_NAMES)} ${rng.pick(FAMILY_NAMES)}`;
      if (!used.has(n)) {
        used.add(n);
        return n;
      }
    }
  };
  const sisters = [{ id: 'amyrlin', name: name(), ajah: 'blue', strength: 15, role: 'amyrlin', disposition: 50, status: 'active' }];
  for (const ajah of AJAH_ORDER) {
    sisters.push({ id: `head_${ajah}`, name: name(), ajah, strength: rng.int(12, 14), role: 'head', disposition: 50, status: 'active' });
    for (let i = 0; i < 2; i++) {
      sisters.push({ id: `${ajah}_${i}`, name: name(), ajah, strength: rng.int(4, 11), role: 'sister', disposition: 50, status: 'active' });
    }
  }
  return sisters;
}

function generateNovices(seed) {
  const rng = new RNG(seed + 17);
  return rng.shuffle(NOVICE_NAMES).slice(0, 5).map((n, i) => ({
    id: `novice_${i}`,
    name: n,
    talent: rng.pick(TALENTS),
    potential: rng.int(6, 14),
    sponsor: null,
    rivalId: null,
  }));
}

export function defaultPolitics(seed = Math.floor(Math.random() * 1e9)) {
  return {
    week: 1,
    actions: ACTIONS_PER_WEEK,
    penance: 0,
    stability: 72,
    conflict: 0,
    standing: 50,
    suspicion: 0,
    leverage: 0,
    influence: { green: 52, yellow: 48, red: 62, blue: 54, brown: 44, gray: 50, white: 46 },
    faction: null,
    conspiracy: null,
    pending: [],
    sisters: generateRoster(seed),
    novices: generateNovices(seed),
    sponsoredThisWeek: false,
    shawlWeek: null,
    coup: null,
    amyrlinId: 'amyrlin',
    flags: {},
    log: [],
    seed,
  };
}

/** Fills any missing fields so older saves load cleanly. */
export function normalizePolitics(raw) {
  const base = defaultPolitics(Number.isFinite(raw?.seed) ? raw.seed : undefined);
  if (!raw || typeof raw !== 'object') return base;
  const out = { ...base, ...raw };
  out.influence = { ...base.influence, ...(raw.influence ?? {}) };
  out.sisters = Array.isArray(raw.sisters) && raw.sisters.length ? raw.sisters : base.sisters;
  out.novices = Array.isArray(raw.novices) ? raw.novices : base.novices;
  out.pending = Array.isArray(raw.pending) ? raw.pending.filter((p) => p && EVENTS[p.id]) : [];
  out.flags = raw.flags && typeof raw.flags === 'object' ? raw.flags : {};
  out.log = Array.isArray(raw.log) ? raw.log.slice(-60) : [];
  for (const key of ['week', 'actions', 'penance', 'stability', 'conflict', 'standing', 'suspicion', 'leverage']) {
    if (!Number.isFinite(out[key])) out[key] = base[key];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Events: what sisters bring to you, in the halls or by letter at the week's end
// ---------------------------------------------------------------------------

const isSister = (player) => player.rankIndex === 2;

/**
 * Each event: weight(pol, player) → 0 means ineligible. pickSister chooses who brings it.
 * run(ctx) plays it out through dialogue and the TowerPolitics API.
 */
export const EVENTS = {
  errand: {
    title: 'A sister\'s errand',
    weight: (pol, p) => (p.rankIndex < 2 ? 3 : 1),
    pickSister: (tp) => tp.randomSister((s) => s.role === 'sister' && s.strength > tp.player.stats.strength) ?? tp.randomSister((s) => s.role === 'sister'),
    async run(ctx) {
      const { tp, sister } = ctx;
      const rel = tp.compare(sister);
      if (rel === 'above') return EVENTS.deference.run(ctx);
      const choice = await ctx.ask({
        speaker: tp.label(sister),
        text: `${tp.player.rankIndex < 2 ? 'Child' : 'Sister'}, I need these letters carried to the Traveling grounds and a reply brought back today. You will see to it.`,
        choices: [
          { label: 'Of course.', value: 'obey', detail: 'Costs one action this week · +2 prestige' },
          { label: 'I have duties of my own.', value: 'defy', detail: `She stands above you (Strength ${sister.strength} vs ${tp.player.stats.strength}) · Tower Conflict +30` },
        ],
      });
      if (choice === 'obey') {
        tp.spendAction(true);
        tp.player.prestige += 2;
        tp.disposition(sister, 10);
        ctx.note('You ran her errand. She will remember the courtesy.');
      } else {
        tp.disposition(sister, -20);
        ctx.note(tp.addConflict(30, `You refused ${sister.name}'s errand.`));
      }
    },
  },
  deference: {
    title: 'A matter of precedence',
    weight: (pol, p) => (isSister(p) && pol.sisters.some((s) => s.role === 'sister' && s.status === 'active' && s.strength <= p.stats.strength - 2) ? 2 : 0),
    pickSister: (tp) => tp.randomSister((s) => s.role === 'sister' && tp.compare(s) === 'above'),
    async run(ctx) {
      const { tp, sister } = ctx;
      const choice = await ctx.ask({
        speaker: tp.label(sister),
        text: 'The Hall has asked for a sister to escort the Cairhienin envoy. I meant to take it myself. I assume you will not object?',
        choices: [
          { label: 'Command her to step aside.', value: 'command', detail: `She must defer to you (Strength ${tp.player.stats.strength} vs ${sister.strength}) · +4 prestige, +3 ${tp.player.ajahDef?.name ?? ''} influence` },
          { label: 'Let her have it, graciously.', value: 'yield', detail: '+15 disposition · +2 standing' },
        ],
      });
      if (choice === 'command') {
        tp.player.prestige += 4;
        tp.influence(tp.player.ajah, 3);
        tp.disposition(sister, -10);
        ctx.note(`${sister.name} lowers her eyes. Among Aes Sedai, strength decides who speaks first.`);
      } else {
        tp.disposition(sister, 15);
        tp.standing(2);
        ctx.note('A small kindness. Small kindnesses are remembered in the Tower.');
      }
    },
  },
  seniority_clash: {
    title: 'Seniority',
    weight: (pol, p) => (isSister(p) ? 2 : 0),
    pickSister: (tp) => tp.randomSister((s) => s.strength > tp.player.stats.strength && s.role !== 'amyrlin' && s.ajah !== tp.player.ajah),
    async run(ctx) {
      const { tp, sister } = ctx;
      const rel = tp.compare(sister);
      const choices = [{ label: 'Comply.', value: 'comply', detail: 'Lose one action this week' }];
      if (rel === 'below') choices.push({ label: 'Push back.', value: 'push', detail: `She outranks you in the Power (${sister.strength} vs ${tp.player.stats.strength}) · Tower Conflict +35` });
      else choices.push({ label: 'Refuse. You are her equal.', value: 'refuse', detail: 'Tower Conflict +10' });
      choices.push({ label: 'Appeal to the head of your Ajah.', value: 'appeal', detail: '-5 standing · Tower Conflict +10' });
      const choice = await ctx.ask({
        speaker: tp.label(sister),
        text: 'Your Ajah\'s business can wait. I need a sister of your talents in the Hall\'s archive for the rest of the week, cataloguing. Do not make me ask twice.',
        choices,
      });
      if (choice === 'comply') {
        tp.spendAction(true);
        tp.disposition(sister, 10);
        ctx.note('Dust and ledgers. But she owes you now, a little.');
      } else if (choice === 'push') {
        tp.disposition(sister, -25);
        ctx.note(tp.addConflict(35, `You defied ${sister.name}, who stands above you.`));
      } else if (choice === 'refuse') {
        tp.disposition(sister, -10);
        ctx.note(tp.addConflict(10, `You refused ${sister.name} as an equal.`));
      } else {
        tp.standing(-5);
        ctx.note(tp.addConflict(10, 'Your Ajah head intervened on your behalf, and did not enjoy it.'));
      }
    },
  },
  rival_intel: {
    title: 'Whispers in the corridor',
    weight: (pol, p) => (isSister(p) ? 2 : 0),
    pickSister: (tp) => tp.randomSister((s) => s.ajah !== tp.player.ajah && s.role === 'sister'),
    async run(ctx) {
      const { tp, sister } = ctx;
      const myAjah = tp.player.ajahDef?.name ?? 'your';
      const choice = await ctx.ask({
        speaker: tp.label(sister),
        text: `A word, sister. Something has come to the ${AJAHS[sister.ajah].name} that your Ajah ought to know, and doesn't. I could tell you. A favour for a favour, someday.`,
        choices: [
          { label: 'Accept her intelligence.', value: 'accept', detail: `+8 prestige${tp.pol.conspiracy?.active ? ', +1 leverage on the conspiracy' : ''} · -12 standing with the ${myAjah} Ajah` },
          { label: 'Decline politely.', value: 'decline', detail: '+4 standing' },
          { label: 'Report the approach to your Ajah head.', value: 'report', detail: '+8 standing · she will not forget' },
        ],
      });
      if (choice === 'accept') {
        tp.player.prestige += 8;
        tp.standing(-12);
        tp.influence(sister.ajah, 4);
        if (tp.pol.conspiracy?.active) tp.addLeverage(1, 'Rival intelligence named a Sitter in the conspiracy.');
        ctx.note('Useful. And your Ajah head will hear of it before supper.');
      } else if (choice === 'decline') {
        tp.standing(4);
      } else {
        tp.standing(8);
        tp.disposition(sister, -25);
        tp.influence(sister.ajah, -3);
        ctx.note(`${sister.name} smiles thinly when she hears. That smile will cost you later.`);
      }
    },
  },
  novice_rivalry: {
    title: 'A contested pupil',
    weight: () => 0,
    pickSister: (tp, data) => tp.sisterById(data?.rivalId),
    async run(ctx) {
      const { tp, sister, data } = ctx;
      const novice = tp.pol.novices.find((n) => n.id === data?.noviceId);
      const rel = tp.compare(sister);
      const choices = [];
      if (rel === 'above') choices.push({ label: 'Remind her of her place.', value: 'command', detail: `She must defer (Strength ${tp.player.stats.strength} vs ${sister.strength}) · Conflict +5` });
      else choices.push({ label: 'Hold firm.', value: 'hold', detail: `She stands above you · Conflict +25` });
      choices.push({ label: 'Apologize and offer a gift.', value: 'apologize', detail: '-3 prestige · she warms to you' });
      const choice = await ctx.ask({
        speaker: tp.label(sister),
        text: `${novice?.name ?? 'That girl'} was mine to sponsor. I had watched her for a year. You took her while I was in Illian.`,
        choices,
      });
      if (choice === 'command') {
        tp.disposition(sister, -15);
        ctx.note(tp.addConflict(5, null));
      } else if (choice === 'hold') {
        tp.disposition(sister, -20);
        ctx.note(tp.addConflict(25, `You held your claim against ${sister.name}.`));
      } else {
        tp.player.prestige -= 3;
        tp.disposition(sister, 20);
      }
    },
  },
  ajah_summons: {
    title: 'Summoned by your Ajah',
    weight: (pol, p) => (isSister(p) && (pol.standing < 30 || pol.standing > 70) ? 3 : 0),
    pickSister: (tp) => tp.sisterById(`head_${tp.player.ajah}`),
    async run(ctx) {
      const { tp, sister } = ctx;
      if (tp.pol.standing > 70) {
        await ctx.say([{ speaker: tp.label(sister), text: 'You have served the Ajah well. The Ajah does not forget. Take this; you have earned the trust that comes with it.' }]);
        tp.player.prestige += 10;
        tp.player.gainXP(80);
        tp.standing(-10);
        ctx.note('+10 prestige · +80 XP');
      } else {
        await ctx.say([{ speaker: tp.label(sister), tone: 'danger', text: 'Your conduct shames the Ajah. You consort with rivals and forget whose shawl you wear. Mend it, or you will find yourself cataloguing ink in the Thirteenth Depository for a decade.' }]);
        ctx.note(tp.addConflict(15, 'Reprimanded by the head of your Ajah.'));
        tp.standing(8);
      }
    },
  },
  novice_life: {
    title: 'Life in the novice quarters',
    weight: (pol, p) => (p.rankIndex === 0 ? 3 : 0),
    pickSister: () => null,
    async run(ctx) {
      const { tp } = ctx;
      const choice = await ctx.ask({
        speaker: 'An Accepted',
        text: 'You there. Novice. You will scrub the second-floor corridor again; it was filthy when I passed. And curtsy when an Accepted addresses you.',
        choices: [
          { label: 'Curtsy, and scrub.', value: 'endure', detail: '+1 prestige' },
          { label: 'Report her to the Mistress of Novices.', value: 'report', detail: '+3 prestige · Conflict +10' },
          { label: 'Answer back.', value: 'defy', detail: 'Conflict +35' },
        ],
      });
      if (choice === 'endure') tp.player.prestige += 1;
      else if (choice === 'report') {
        tp.player.prestige += 3;
        ctx.note(tp.addConflict(10, null));
      } else ctx.note(tp.addConflict(35, 'You answered back to an Accepted.'));
    },
  },
  extra_lessons: {
    title: 'An offer of lessons',
    weight: (pol, p) => (p.rankIndex < 2 ? 2 : 0),
    pickSister: (tp) => tp.randomSister((s) => s.ajah === 'brown' || s.ajah === 'white'),
    async run(ctx) {
      const { tp, sister } = ctx;
      const choice = await ctx.ask({
        speaker: tp.label(sister),
        text: 'You have more talent than discipline, child. I teach a small class after supper. It would cost you your free hours this week.',
        choices: [
          { label: 'Gratefully accept.', value: 'yes', detail: 'Costs one action · +90 XP, +1 Control' },
          { label: 'I cannot spare the time.', value: 'no' },
        ],
      });
      if (choice === 'yes') {
        tp.spendAction(true);
        tp.player.gainXP(90);
        tp.player.stats.control += 1;
        tp.disposition(sister, 10);
        ctx.note('+90 XP · +1 Control');
      }
    },
  },
  conspiracy_approach: {
    title: 'An offer in the dark',
    weight: () => 0,
    pickSister: (tp) => tp.sisterById(tp.pol.conspiracy?.leaderId),
    async run(ctx) {
      const { tp, sister } = ctx;
      const p = tp.player;
      const amyrlin = tp.sisterById(tp.pol.amyrlinId);
      const material = tp.blackmailMaterial();
      await ctx.say([
        { speaker: tp.label(sister), tone: 'danger', text: `Walk with me, sister. Quietly. ${amyrlin.name} has held the stole too long and spent the Tower's strength on her own Ajah. The Hall can be persuaded otherwise. Some of us have begun persuading it.` },
        { speaker: tp.label(sister), tone: 'danger', text: material ? `I would rather have you as a friend. But understand: the ${AJAHS[sister.ajah].name} knows ${material}. Friends keep each other's secrets.` : 'You are strong, and you are new enough that no one watches you. Women like you are how a Tower changes hands.' },
      ]);
      const incentive = await ctx.ask({
        speaker: tp.label(sister),
        text: 'Join us, and you will not find us ungrateful. Choose what you would have.',
        choices: [
          { label: 'A purse of favours.', value: 'bribe', detail: '+15 prestige, and a ter\'angreal from her Ajah\'s vault' },
          { label: 'The weave her Ajah guards.', value: 'weave', detail: `Learn ${WEAVES.mirror_of_mists.name}: ${WEAVES.mirror_of_mists.description}` },
          { label: 'Nothing. I want no part of this.', value: 'none' },
        ],
      });
      const choice = incentive === 'none' ? 'refuse' : await ctx.ask({
        speaker: tp.label(sister),
        tone: 'danger',
        text: 'Well? I will have an answer before we reach the stair.',
        choices: [
          { label: 'Join the conspiracy.', value: 'join', detail: 'Covert missions open. If the coup fails, you will be tried for treason and stilled.' },
          { label: 'Pretend to join (double agent).', value: 'double', detail: 'Feed her nothing, gather leverage for the Amyrlin. If they suspect you, they will test you.' },
          { label: 'Refuse her.', value: 'refuse', detail: material ? 'She will make good on her threat.' : 'She will plot without you.' },
        ],
      });
      tp.pol.conspiracy.approached = true;
      if (choice === 'refuse') {
        tp.pol.faction = 'loyalist';
        tp.disposition(sister, -40);
        if (material) {
          p.prestige -= 15;
          ctx.note(tp.addConflict(20, `The ${AJAHS[sister.ajah].name} let it be known that ${material}.`));
          ctx.note('-15 prestige');
        }
        ctx.note('You are a loyalist now, whether the Amyrlin knows it or not. The conspiracy goes on without you. Gather leverage before Tower Stability collapses.');
        tp.log(`Refused ${sister.name}'s conspiracy.`, 'politics');
        return;
      }
      if (incentive === 'bribe') {
        p.prestige += 15;
        const owned = new Set(p.artifacts);
        const art = Object.keys(TER_ANGREAL).find((id) => !owned.has(id));
        if (art) tp.game.missions.claimArtifact(art);
        ctx.note('+15 prestige');
      } else if (incentive === 'weave') {
        p.learn('mirror_of_mists');
        ctx.note(`Learned ${WEAVES.mirror_of_mists.name} (Fire + Air + Spirit).`);
      }
      tp.pol.faction = choice === 'join' ? 'conspirator' : 'double';
      tp.disposition(sister, 30);
      tp.log(choice === 'join' ? `Joined ${sister.name}'s conspiracy against the Amyrlin.` : `Feigned joining ${sister.name}'s conspiracy.`, 'politics');
      p.addChronicle(choice === 'join' ? 'Swore yourself to a conspiracy against the Amyrlin Seat.' : 'Became a double agent inside a conspiracy against the Amyrlin Seat.', 'shadow');
      ctx.note(choice === 'join' ? 'Covert missions are open in the Missions tab. Every success drives Tower Stability down.' : 'Covert missions are open. In each, you may fake the act and keep evidence instead. Three pieces of leverage and you can bring her down.');
    },
  },
  blackmail: {
    title: 'Blackmail',
    weight: (pol, p) => (isSister(p) && pol.conspiracy?.active && pol.faction !== 'conspirator' && pol.conspiracy.approached ? 1.5 : 0),
    pickSister: (tp) => tp.sisterById(tp.pol.conspiracy?.leaderId),
    async run(ctx) {
      const { tp, sister } = ctx;
      const material = tp.blackmailMaterial() ?? 'which Sitters you have been seen speaking with';
      const choices = [
        { label: 'Give her what she wants: a small sabotage.', value: 'comply', detail: 'Tower Stability -10' },
        { label: 'Defy her.', value: 'defy', detail: '-15 prestige · Conflict +15' },
      ];
      if (tp.pol.faction === 'double') choices.push({ label: 'Feed her false information.', value: 'feed', detail: 'Suspicion +15 · +1 leverage' });
      const choice = await ctx.ask({
        speaker: tp.label(sister),
        tone: 'danger',
        text: `The Hall would be very interested to know ${material}. That need not happen. Leave a certain ward-door unlatched tonight.`,
        choices,
      });
      if (choice === 'comply') tp.adjustStability(-10, 'A ward-door was left unlatched.');
      else if (choice === 'defy') {
        tp.player.prestige -= 15;
        ctx.note(tp.addConflict(15, `${sister.name} made good on her threat.`));
      } else {
        tp.pol.suspicion = clamp(tp.pol.suspicion + 15, 0, 100);
        tp.addLeverage(1, 'Her instructions, in her own hand.');
      }
    },
  },
  loyalty_test: {
    title: 'A test of loyalty',
    weight: (pol) => (pol.faction === 'double' && pol.suspicion >= 50 ? 5 : 0),
    pickSister: (tp) => tp.sisterById(tp.pol.conspiracy?.leaderId),
    async run(ctx) {
      const { tp, sister } = ctx;
      const choice = await ctx.ask({
        speaker: tp.label(sister),
        tone: 'danger',
        text: 'Things go wrong when you are involved, sister. Ledgers go missing. So: tonight you will open the east ward-gate yourself, and I will watch you do it.',
        choices: [
          { label: 'Do it. Keep your cover.', value: 'prove', detail: 'Tower Stability -12 · Suspicion -30' },
          { label: 'Refuse. Your cover is blown.', value: 'blown', detail: 'You become an open loyalist · they come for you' },
        ],
      });
      if (choice === 'prove') {
        tp.adjustStability(-12, 'The east ward-gate stood open for an hour.');
        tp.pol.suspicion = clamp(tp.pol.suspicion - 30, 0, 100);
      } else {
        tp.pol.faction = 'loyalist';
        tp.pol.suspicion = 0;
        tp.player.prestige -= 10;
        ctx.note(tp.addConflict(25, 'Your cover inside the conspiracy was blown.'));
        ctx.note('Your leverage is still yours. Use it before they move.');
      }
    },
  },
  stability_tremor: {
    title: 'Unrest',
    weight: (pol) => (pol.conspiracy?.active && pol.stability < 45 ? 2 : 0),
    pickSister: (tp) => tp.randomSister((s) => s.role === 'sister'),
    async run(ctx) {
      const { tp, sister } = ctx;
      const choice = await ctx.ask({
        speaker: tp.label(sister),
        text: 'Have you heard? Sisters are refusing to sit with their own Ajahs at supper. The novices are frightened. Someone painted the Flame inverted on the Amyrlin\'s door.',
        choices: [
          { label: 'Calm the novices yourself.', value: 'calm', detail: 'Costs one action · Tower Stability +5' },
          { label: 'Let it lie.', value: 'ignore' },
        ],
      });
      if (choice === 'calm') {
        tp.spendAction(true);
        tp.adjustStability(5, 'You calmed the novice quarters.');
      }
    },
  },
};

// ---------------------------------------------------------------------------
// Tower map (shared by the Halls, covert missions and the Coup)
// ---------------------------------------------------------------------------

export const tileAt = (c, r) => ({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 });
export const ajahRoomCenter = (ajah) => tileAt(8.5 + AJAH_ORDER.indexOf(ajah) * 7, 19);

/** variant: 'day' | 'night' | 'coup'. The coup variant barricades and burns the corridors. */
export function buildTower(variant = 'day') {
  const m = new TileMap(60, 42, T.CARPET, variant === 'coup' ? 911 : 409);
  m.outline(0, 0, 60, 42, T.WALL);
  // Hall of the Tower.
  m.rect(20, 1, 20, 9, T.MARBLE);
  m.rect(28, 2, 4, 8, T.CARPET);
  m.rect(19, 1, 1, 10, T.WALL);
  m.rect(40, 1, 1, 10, T.WALL);
  m.rect(19, 10, 22, 1, T.WALL);
  for (let c = 28; c <= 31; c++) m.set(c, 10, T.MARBLE);
  // Keeper's archive (west).
  m.rect(1, 1, 18, 9, T.WOOD);
  for (const r of [3, 6]) {
    m.rect(3, r, 14, 1, T.SHELF);
    m.rect(9, r, 2, 1, T.WOOD);
  }
  m.rect(1, 10, 18, 1, T.WALL);
  m.set(9, 10, T.WOOD);
  m.set(10, 10, T.WOOD);
  // Sitters' chambers (east).
  m.rect(41, 1, 18, 9, T.WOOD);
  m.rect(47, 1, 1, 9, T.WALL);
  m.rect(53, 1, 1, 9, T.WALL);
  m.rect(41, 10, 18, 1, T.WALL);
  for (const c of [44, 50, 56]) m.set(c, 10, T.WOOD);
  // Hollow walls into the Hall.
  m.set(19, 5, T.SECRET);
  m.set(40, 5, T.SECRET);
  // Ajah quarters.
  m.rect(5, 14, 50, 1, T.WALL);
  m.rect(5, 24, 50, 1, T.WALL);
  for (let i = 0; i <= 7; i++) m.rect(5 + i * 7, 14, 1, 11, T.WALL);
  AJAH_ORDER.forEach((_, i) => {
    m.rect(6 + i * 7, 15, 6, 9, T.MARBLE);
    m.set(8 + i * 7, 14, T.CARPET);
    m.set(9 + i * 7, 14, T.CARPET);
  });
  // Novice garden.
  m.rect(1, 25, 58, 16, T.GRASS);
  m.rect(27, 30, 6, 6, T.MARBLE);
  m.rect(29, 32, 2, 2, T.WATER);
  for (const [c, r] of [[6, 28], [14, 33], [40, 28], [48, 34], [20, 37], [36, 37]]) m.rect(c, r, 3, 1, T.HEDGE);

  if (variant === 'coup') {
    // Barricades and burning corridors.
    for (let c = 28; c <= 31; c++) m.set(c, 10, T.WALL);
    m.rect(15, 11, 1, 2, T.WALL);
    m.rect(45, 12, 1, 2, T.WALL);
    m.rect(24, 11, 1, 1, T.WALL);
    m.rect(35, 13, 1, 1, T.WALL);
    const rng = new RNG(37);
    for (let i = 0; i < 60; i++) {
      const c = rng.int(1, 58);
      const r = rng.int(11, 40);
      if (m.get(c, r) === T.CARPET || m.get(c, r) === T.GRASS || m.get(c, r) === T.MARBLE) m.set(c, r, rng.chance(0.5) ? T.RUBBLE : T.BLIGHT);
    }
    m.background = '#140b0b';
  }
  return { map: m, spawn: tileAt(29, 12) };
}

/** Tints the floor (multiply blend) while leaving the entities drawn after it untouched. */
function tintOverlay(run, color) {
  run.addRenderer((ctx) => {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, run.map.width, run.map.height);
    ctx.restore();
  }, { under: true });
}

function nightOverlay(run, strength = 1) {
  tintOverlay(run, strength >= 1 ? '#3e4678' : '#5a628f');
}

/** Flickering fires across the scorched tiles of the coup map. */
function coupFires(run) {
  tintOverlay(run, '#c99a8a');
  const fires = [];
  for (let r = 0; r < run.map.rows; r++) for (let c = 0; c < run.map.cols; c++) if (run.map.get(c, r) === T.BLIGHT) fires.push(tileAt(c, r));
  run.addRenderer((ctx, time) => {
    for (const [i, f] of fires.entries()) {
      const flicker = 0.55 + Math.sin(time * 9 + i * 1.7) * 0.25;
      ctx.fillStyle = `rgba(255, 120, 30, ${0.35 * flicker})`;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 22 * flicker + 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255, 210, 90, ${0.8 * flicker})`;
      ctx.beginPath();
      ctx.arc(f.x + Math.sin(time * 13 + i) * 2, f.y - 3, 5 * flicker + 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }, { under: true });
}

// ---------------------------------------------------------------------------
// Sister NPCs (non-hostile figures in the Tower)
// ---------------------------------------------------------------------------

class SisterFigure {
  constructor(manager, opts) {
    this.manager = manager;
    this.record = opts.record ?? null;
    this.name = opts.name ?? opts.record?.name ?? 'Sister';
    this.color = opts.color ?? (this.record ? AJAHS[this.record.ajah]?.color : '#f7f4ee');
    this.novice = !!opts.novice;
    this.x = opts.x;
    this.y = opts.y;
    this.home = { x: opts.x, y: opts.y };
    this.radius = 12;
    this.mode = opts.mode ?? 'idle';
    this.onTalk = opts.onTalk ?? null;
    this.marker = opts.marker ?? null;
    this.speed = this.mode === 'approach' ? 120 : 45;
    this.nav = new Navigator();
    this.wanderTarget = null;
    this.wanderTimer = Math.random() * 2;
    this.cooldown = 0;
    this.busy = false;
    this.awaitLeave = false;
    this.facing = Math.random() * Math.PI * 2;
  }

  update(dt) {
    const game = this.manager.game;
    const p = game.player;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const d = dist(this.x, this.y, p.x, p.y);
    if (this.awaitLeave && d > 70) this.awaitLeave = false;
    if (this.onTalk && !this.busy && !this.awaitLeave && this.cooldown <= 0 && d < this.radius + p.radius + 18) {
      this.busy = true;
      this.manager.trigger(this);
      return;
    }
    let tx;
    let ty;
    let speed = this.speed;
    if (this.mode === 'approach' && this.onTalk) {
      tx = p.x;
      ty = p.y;
    } else if (this.mode === 'static') {
      return;
    } else {
      this.wanderTimer -= dt;
      if (!this.wanderTarget || this.wanderTimer <= 0) {
        this.wanderTimer = 2 + Math.random() * 3;
        const pos = game.map.findOpenNear(this.home.x + (Math.random() - 0.5) * 160, this.home.y + (Math.random() - 0.5) * 120, 12);
        this.wanderTarget = pos;
      }
      tx = this.wanderTarget.x;
      ty = this.wanderTarget.y;
      speed = this.speed;
    }
    const dd = dist(this.x, this.y, tx, ty);
    if (dd < 8) return;
    const dir = this.nav.steer(game.map, this, tx, ty, dt);
    game.map.moveCircle(this, dir.x * speed * dt, dir.y * speed * dt);
    this.facing = Math.atan2(dir.y, dir.x);
  }

  render(ctx, time) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(0, 9, 12, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(this.facing);
    ctx.fillStyle = this.novice ? '#ffffff' : '#e6e1d6';
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
    ctx.fill();
    if (!this.novice) {
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.moveTo(-this.radius - 2, -this.radius + 2);
      ctx.quadraticCurveTo(-this.radius - 8, 0, -this.radius - 2, this.radius - 2);
      ctx.lineTo(2, 0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#e9cfae';
    ctx.beginPath();
    ctx.arc(4, 0, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.font = '600 11px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f5efe0';
    ctx.fillText(this.name, this.x, this.y - 20);
    if (this.onTalk && this.marker) {
      ctx.fillStyle = this.marker === '!' ? '#ffd84a' : '#9ad9ea';
      ctx.font = '700 16px Georgia, serif';
      ctx.fillText(this.marker, this.x, this.y - 32 + Math.sin(time * 4) * 2);
    }
  }
}

export class SisterManager {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  clear() {
    this.list.length = 0;
  }

  add(opts) {
    const pos = this.game.map.findOpenNear(opts.x, opts.y, 12);
    const fig = new SisterFigure(this, { ...opts, ...pos });
    this.list.push(fig);
    return fig;
  }

  async trigger(fig) {
    try {
      const again = await fig.onTalk(fig);
      if (again) {
        fig.awaitLeave = true;
      } else {
        fig.onTalk = null;
        fig.mode = fig.mode === 'approach' ? 'idle' : fig.mode;
        fig.speed = 45;
      }
    } catch (err) {
      console.error('[politics] conversation failed', err);
      this.game.ui.reportError('A conversation in the halls broke off unexpectedly.');
    } finally {
      fig.busy = false;
      fig.cooldown = Math.max(fig.cooldown, 2);
    }
  }

  update(dt) {
    for (const f of this.list) f.update(dt);
  }

  render(ctx, time) {
    for (const f of this.list) f.render(ctx, time);
  }
}

// ---------------------------------------------------------------------------
// TowerPolitics engine
// ---------------------------------------------------------------------------

export class TowerPolitics {
  constructor(game) {
    this.game = game;
  }

  get player() {
    return this.game.player;
  }

  get pol() {
    const p = this.player;
    if (!p.politics) p.politics = defaultPolitics();
    return p.politics;
  }

  // -- roster helpers -----------------------------------------------------------

  sisterById(id) {
    return this.pol.sisters.find((s) => s.id === id) ?? null;
  }

  randomSister(predicate) {
    const pool = this.pol.sisters.filter((s) => s.status === 'active' && predicate(s));
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  }

  /** 'above' (you outrank her), 'below' (she outranks you) or 'peer'. Novices and Accepted are always below. */
  compare(sister) {
    const p = this.player;
    if (!sister) return 'peer';
    if (p.flags.amyrlin) return 'above';
    if (p.rankIndex < 2 || sister.role === 'amyrlin') return 'below';
    const diff = p.stats.strength - sister.strength;
    if (diff >= 2) return 'above';
    if (diff <= -2) return 'below';
    return 'peer';
  }

  label(sister) {
    if (!sister) return 'A sister';
    const role = sister.role === 'amyrlin' ? 'The Amyrlin Seat' : sister.role === 'head' ? `Head of the ${AJAHS[sister.ajah].name}` : `${AJAHS[sister.ajah].name} sister`;
    return `${sister.name} (${role})`;
  }

  disposition(sister, delta) {
    if (sister) sister.disposition = clamp(sister.disposition + delta, 0, 100);
  }

  // -- meters ------------------------------------------------------------------------

  log(text, tone = 'politics') {
    this.pol.log.push({ week: this.pol.week, text, tone });
    if (this.pol.log.length > 60) this.pol.log.shift();
  }

  influence(ajah, delta) {
    if (!ajah || !(ajah in this.pol.influence)) return;
    this.pol.influence[ajah] = clamp(this.pol.influence[ajah] + delta, 0, 100);
  }

  standing(delta) {
    this.pol.standing = clamp(this.pol.standing + delta, 0, 100);
  }

  /** Tower Conflict: at 100, a punishment detail costs you next week entirely. */
  addConflict(amount, reason) {
    const pol = this.pol;
    pol.conflict = clamp(pol.conflict + amount, 0, 100);
    if (reason) this.log(reason, 'conflict');
    if (pol.conflict < 100) return amount >= 20 ? `Tower Conflict ${pol.conflict}/100.` : null;
    pol.conflict = 35;
    pol.penance = 1;
    this.player.prestige -= 10;
    this.player.addChronicle('Assigned a punishment detail for defying your betters.', 'failure');
    this.log('Punishment detail: next week is spent scrubbing pots.', 'conflict');
    return 'Tower Conflict boiled over. You are assigned a punishment detail: next week you will have no free actions, and -10 prestige.';
  }

  adjustStability(delta, reason) {
    const pol = this.pol;
    pol.stability = clamp(pol.stability + delta, 0, 100);
    if (reason) this.log(`${reason} (Stability ${delta > 0 ? '+' : ''}${delta})`, delta < 0 ? 'unrest' : 'politics');
    if (pol.stability <= 0 && !pol.coup && pol.conspiracy?.active) {
      pol.coup = { pending: true, done: false };
      this.log('The Tower breaks. The coup begins.', 'unrest');
    }
  }

  addLeverage(n, reason) {
    this.pol.leverage = clamp(this.pol.leverage + n, 0, 9);
    if (reason) this.log(`Leverage: ${reason}`, 'politics');
  }

  /** Something a rival could hold over you, or null. */
  blackmailMaterial() {
    const p = this.player;
    if (p.flags.readBalefire) return 'that you broke the seal on the balefire folio';
    if (p.flags.wovebalefire) return 'that you have woven balefire';
    if (p.burnouts > 0) return `that you have burned yourself out ${p.burnouts === 1 ? 'once' : `${p.burnouts} times`}`;
    if (p.strikes > 1) return 'how close the Hall came to putting you out';
    return null;
  }

  // -- the week ------------------------------------------------------------------------

  canSpendAction() {
    return this.pol.actions > 0;
  }

  /** Spends an action; with fromEvent, borrows from next week if this week is already spent. */
  spendAction(fromEvent = false) {
    const pol = this.pol;
    if (pol.actions > 0) pol.actions -= 1;
    else if (fromEvent) pol.flags.borrowed = (pol.flags.borrowed ?? 0) + 1;
  }

  weeklyStudy() {
    const p = this.player;
    const byRank = [
      { label: 'Lessons, chores and the Mistress of Novices\' eye', xp: 60, prestige: 3 },
      { label: 'Teaching novice classes and private study', xp: 85, prestige: 4 },
      { label: 'Ajah duties and correspondence', xp: 100, prestige: 2 },
    ];
    return byRank[p.rankIndex];
  }

  /** Ends the week. Returns report lines; events still pending are returned for delivery. */
  advanceWeek() {
    const pol = this.pol;
    const p = this.player;
    const lines = [];
    const leftover = pol.pending.slice();
    pol.pending = [];

    if (pol.penance > 0) {
      lines.push('You spent the week on a punishment detail: pots, floors and silence. No study, no reward.');
    } else {
      const study = this.weeklyStudy();
      const { gained, levels } = p.gainXP(study.xp);
      p.prestige += study.prestige;
      lines.push(`${study.label}: +${gained} XP, +${study.prestige} prestige${levels ? ` (level ${p.level}!)` : ''}.`);
    }
    if (p.rankIndex === 2 && p.ajah) {
      const own = pol.influence[p.ajah];
      const bonus = Math.floor(own / 30);
      if (bonus) {
        p.prestige += bonus;
        lines.push(`The ${p.ajahDef.name} Ajah's influence (${own}) lends you +${bonus} prestige.`);
      }
      const sponsored = pol.novices.filter((n) => n.sponsor === p.ajah).length;
      if (sponsored) this.influence(p.ajah, sponsored);
    }
    pol.conflict = clamp(pol.conflict - 8, 0, 100);
    if (pol.conspiracy?.active) {
      pol.suspicion = clamp(pol.suspicion - 5, 0, 100);
      const drift = CONSPIRACY_DRIFT + (pol.faction === 'conspirator' ? 2 : 0);
      this.influence(pol.conspiracy.ajah, 1);
      this.adjustStability(-drift, 'The conspiracy whispers in the Hall');
      lines.push(`Tower Stability fell to ${pol.stability} as the conspiracy spreads.`);
    } else if (pol.stability < 70) {
      pol.stability = clamp(pol.stability + 3, 0, 100);
    }
    // A slow random walk in Ajah influence.
    const rng = new RNG(pol.seed + pol.week * 31);
    for (const ajah of AJAH_ORDER) this.influence(ajah, rng.int(-2, 2));

    pol.week += 1;
    pol.penance = Math.max(0, pol.penance - 1);
    pol.actions = pol.penance > 0 ? 0 : Math.max(0, ACTIONS_PER_WEEK - (pol.flags.borrowed ?? 0));
    if (pol.penance > 0) pol.actions = 0;
    pol.flags.borrowed = 0;
    pol.sponsoredThisWeek = false;
    if (pol.penance > 0) lines.push('This week you serve your punishment detail. You have no free actions.');
    this.maybeStartConspiracy();
    this.generateWeek();
    return { lines, leftover };
  }

  maybeStartConspiracy() {
    const pol = this.pol;
    const p = this.player;
    if (p.rankIndex < 2 || p.flags.amyrlin || pol.conspiracy?.active || pol.coup?.pending) return;
    if (pol.shawlWeek === null) pol.shawlWeek = pol.week;
    if (pol.week < pol.shawlWeek + 1) return;
    if (pol.flags.lastCoupWeek && pol.week < pol.flags.lastCoupWeek + 8) return;
    const amyrlin = this.sisterById(pol.amyrlinId);
    const candidates = AJAH_ORDER.filter((a) => a !== p.ajah && a !== amyrlin?.ajah).sort((a, b) => pol.influence[b] - pol.influence[a]);
    const ajah = candidates[0];
    const leader = this.sisterById(`head_${ajah}`) ?? this.randomSister((s) => s.ajah === ajah);
    if (!leader) return;
    pol.conspiracy = { active: true, leaderId: leader.id, ajah, approached: false, crushed: false };
    pol.stability = Math.min(pol.stability, 60);
    pol.pending.unshift({ id: 'conspiracy_approach', sisterId: leader.id });
    this.log(`Rumours: the ${AJAHS[ajah].name} Ajah is gathering Sitters.`, 'unrest');
  }

  generateWeek() {
    const pol = this.pol;
    const p = this.player;
    const count = p.rankIndex === 2 ? 2 : 1;
    const rng = new RNG(pol.seed + pol.week * 97);
    for (let i = 0; i < count; i++) {
      const pool = Object.entries(EVENTS)
        .map(([id, ev]) => [id, ev.weight(pol, p)])
        .filter(([id, w]) => w > 0 && !pol.pending.some((e) => e.id === id));
      if (!pool.length) break;
      const total = pool.reduce((s, [, w]) => s + w, 0);
      let roll = rng.next() * total;
      const [id] = pool.find(([, w]) => (roll -= w) <= 0) ?? pool[pool.length - 1];
      const sister = EVENTS[id].pickSister(this);
      pol.pending.push({ id, sisterId: sister?.id ?? null });
    }
  }

  /** Runs one event through dialogue. Returns once it has fully played out. */
  async runEvent(entry, via = 'hall') {
    const ev = EVENTS[entry.id];
    if (!ev) return;
    const game = this.game;
    const sister = entry.sisterId ? this.sisterById(entry.sisterId) : null;
    const notes = [];
    const ctx = {
      tp: this,
      pol: this.pol,
      sister,
      data: entry.data,
      via,
      say: (nodes) => game.dialogue(nodes),
      ask: async (node) => (await game.dialogue([node]))[0],
      note: (line) => {
        if (line) notes.push(line);
      },
    };
    if (via === 'letter') {
      await game.dialogue([{ speaker: `Week ${this.pol.week}: ${ev.title}`, tone: 'narration', text: sister ? `${this.label(sister)} found you before the week was out.` : 'Before the week was out...' }]);
    }
    await ev.run(ctx);
    this.pol.pending = this.pol.pending.filter((e) => e !== entry);
    if (notes.length) await game.dialogue([{ speaker: ev.title, tone: 'narration', text: notes.join('\n') }]);
    game.save();
  }

  // -- the conspiracy --------------------------------------------------------------------

  get canPresentEvidence() {
    const pol = this.pol;
    return !!pol.conspiracy?.active && pol.leverage >= LEVERAGE_NEEDED && (pol.faction === 'loyalist' || pol.faction === 'double');
  }

  async presentEvidence() {
    if (!this.canPresentEvidence) return;
    const pol = this.pol;
    const p = this.player;
    const leader = this.sisterById(pol.conspiracy.leaderId);
    const amyrlin = this.sisterById(pol.amyrlinId);
    await this.game.dialogue([
      { speaker: this.label(amyrlin), tone: 'ceremony', text: `Ledgers. Letters. A forged seal. And the name ${leader.name}. You have been busy, daughter.` },
      { speaker: 'Narrator', tone: 'ceremony', text: `By nightfall ${leader.name} is shielded and confined to her rooms, and three Sitters have resigned their chairs. The Hall closes ranks behind the Amyrlin.` },
    ]);
    leader.status = 'confined';
    this.influence(pol.conspiracy.ajah, -20);
    if (p.ajah) this.influence(p.ajah, 5);
    this.adjustStability(35, 'The conspiracy was exposed and crushed');
    pol.conspiracy = { ...pol.conspiracy, active: false, crushed: true };
    pol.leverage = 0;
    pol.suspicion = 0;
    pol.faction = null;
    pol.flags.lastCoupWeek = pol.week;
    this.clearCovertFlags();
    p.prestige += 35;
    p.gainXP(200);
    p.addChronicle(`Exposed ${leader.name}'s conspiracy against the Amyrlin Seat.`, 'success');
    await this.game.dialogue([{ speaker: 'The Conspiracy Crushed', tone: 'success', text: '+35 prestige · +200 XP · Tower Stability +35' }]);
    this.game.save();
  }

  clearCovertFlags() {
    for (const key of Object.keys(this.pol.flags)) if (key.startsWith('covert_')) delete this.pol.flags[key];
  }

  /** The side the player fights for when the Tower breaks. */
  coupSide() {
    return this.pol.faction === 'conspirator' ? 'rebel' : 'loyal';
  }

  /** Applies the result of the Tower Coup. winner: 'loyal' | 'rebel' | 'player'. */
  resolveCoup(winner) {
    const pol = this.pol;
    const p = this.player;
    const leader = this.sisterById(pol.conspiracy?.leaderId);
    const amyrlin = this.sisterById(pol.amyrlinId);
    const lines = [];
    if (winner === 'player') {
      p.flags.amyrlin = true;
      if (amyrlin) amyrlin.status = 'deposed';
      if (leader) leader.status = 'confined';
      if (p.ajah) this.influence(p.ajah, 25);
      pol.stability = 55;
      p.prestige += 80;
      p.addChronicle('Seized the Amyrlin Seat in the chaos of the Tower Coup.', 'ceremony');
      lines.push('You are raised Amyrlin Seat. The stole is striped in all seven colours, for you are of all Ajahs now.');
    } else if (winner === 'rebel') {
      if (amyrlin) amyrlin.status = 'deposed';
      if (leader) {
        leader.role = 'amyrlin';
        pol.amyrlinId = leader.id;
      }
      this.influence(pol.conspiracy?.ajah, 20);
      this.influence(amyrlin?.ajah, -15);
      pol.stability = 45;
      lines.push(`${leader?.name ?? 'The rebel leader'} is raised Amyrlin Seat. The Tower bends to the ${AJAHS[pol.conspiracy?.ajah]?.name ?? 'new'} Ajah.`);
    } else {
      if (leader) leader.status = 'confined';
      this.influence(pol.conspiracy?.ajah, -25);
      if (p.ajah) this.influence(p.ajah, 10);
      pol.stability = 75;
      lines.push(`${amyrlin?.name ?? 'The Amyrlin'} keeps the stole. The conspirators are shielded and confined to await the Hall's judgement.`);
    }
    pol.coup = { pending: false, done: true, winner };
    pol.conspiracy = pol.conspiracy ? { ...pol.conspiracy, active: false, crushed: winner !== 'rebel' } : null;
    pol.faction = null;
    pol.leverage = 0;
    pol.suspicion = 0;
    pol.flags.lastCoupWeek = pol.week;
    this.clearCovertFlags();
    this.log(lines[0], 'politics');
    return lines;
  }

  // -- the halls --------------------------------------------------------------------------

  /** Populates the walkable Tower with sisters, Ajah heads, the Amyrlin and the novices. */
  populateHalls(run) {
    const npcs = this.game.npcs;
    const pol = this.pol;
    const p = this.player;
    // Ajah heads in their quarters.
    for (const ajah of AJAH_ORDER) {
      const head = this.sisterById(`head_${ajah}`);
      if (!head || head.status !== 'active') continue;
      const pos = ajahRoomCenter(ajah);
      npcs.add({ record: head, x: pos.x, y: pos.y, mode: 'static', marker: ajah === p.ajah ? '?' : null, onTalk: () => this.talkToHead(head) });
    }
    run.addRenderer((ctx) => {
      ctx.font = '600 13px Georgia, serif';
      ctx.textAlign = 'center';
      for (const ajah of AJAH_ORDER) {
        const pos = ajahRoomCenter(ajah);
        ctx.fillStyle = AJAHS[ajah].color;
        ctx.fillText(`${AJAHS[ajah].name} quarters`, pos.x, tileAt(0, 22.5).y);
      }
    });
    // The Amyrlin on her seat.
    const amyrlin = this.sisterById(pol.amyrlinId);
    if (amyrlin && !p.flags.amyrlin) {
      npcs.add({ record: amyrlin, x: tileAt(29.5, 3).x, y: tileAt(0, 3).y, mode: 'static', marker: this.canPresentEvidence ? '!' : null, onTalk: () => this.audience(amyrlin) });
    }
    // Ordinary sisters wandering the corridor.
    const wanderers = pol.sisters.filter((s) => s.role === 'sister' && s.status === 'active');
    for (let i = 0; i < Math.min(6, wanderers.length); i++) {
      const s = wanderers[(i * 3 + pol.week) % wanderers.length];
      npcs.add({ record: s, x: tileAt(6 + i * 9, 12).x, y: tileAt(0, 12).y, mode: 'idle' });
    }
    // Pending events: these sisters seek you out.
    for (const entry of pol.pending.slice(0, 2)) {
      const sister = entry.sisterId ? this.sisterById(entry.sisterId) : null;
      const start = tileAt(entry.id === 'conspiracy_approach' ? 50 : 12, 12);
      npcs.add({
        record: sister,
        name: sister?.name ?? 'An Accepted',
        color: sister ? undefined : '#f2f2f2',
        x: start.x,
        y: start.y,
        mode: 'approach',
        marker: '!',
        onTalk: async () => {
          await this.runEvent(entry, 'hall');
          return false;
        },
      });
    }
    // Novices in the garden.
    pol.novices.forEach((n, i) => {
      const pos = tileAt(8 + i * 10, 30 + (i % 2) * 5);
      npcs.add({ name: n.sponsor ? `${n.name} (${AJAHS[n.sponsor].name})` : n.name, novice: true, x: pos.x, y: pos.y, mode: 'idle', marker: p.rankIndex === 2 && !n.sponsor ? '?' : null, onTalk: () => this.talkToNovice(n) });
    });
  }

  async talkToHead(head) {
    const p = this.player;
    const pol = this.pol;
    const game = this.game;
    const own = head.ajah === p.ajah;
    const rel = this.compare(head);
    if (p.rankIndex < 2) {
      await game.dialogue([{ speaker: this.label(head), text: own ? '' : `A ${p.rank.title}, wandering the Ajah quarters? Go back to your lessons, child. Your Ajah will find you when it is time.` }].filter((n) => n.text));
      return true;
    }
    if (own) {
      const choices = [{ label: 'Ask where you stand.', value: 'stand' }];
      if (pol.conspiracy?.active && pol.faction === 'loyalist') choices.push({ label: 'Warn her about the conspiracy.', value: 'warn', detail: '+6 standing' });
      choices.push({ label: 'Take your leave.', value: 'leave' });
      const choice = (await game.dialogue([{ speaker: this.label(head), text: `Sister. The ${AJAHS[head.ajah].name} holds ${pol.influence[head.ajah]} parts in a hundred of the Tower's ear this week. I would like more.`, choices }]))[0];
      if (choice === 'stand') {
        const verdict = pol.standing > 70 ? 'You are one of our best. Do not let it go to your head.' : pol.standing < 30 ? 'You have been an embarrassment. Mend it.' : 'Adequate. Bring us novices, and keep your hands clean.';
        await game.dialogue([{ speaker: this.label(head), text: `${verdict} (Standing ${pol.standing}/100)` }]);
      } else if (choice === 'warn' && !pol.flags.warnedHead) {
        pol.flags.warnedHead = true;
        this.standing(6);
        await game.dialogue([{ speaker: this.label(head), text: 'I suspected. Words are not proof, sister. Bring the Amyrlin proof.' }]);
      }
      return true;
    }
    const text = rel === 'above'
      ? `${head.name} inclines her head a fraction deeper than she would like. Even an Ajah head defers to strength like yours (${p.stats.strength} vs ${head.strength}).`
      : `${head.name} regards you coolly. She stands above you in the Power (${head.strength} vs ${p.stats.strength}), and makes sure you know it.`;
    await game.dialogue([{ speaker: this.label(head), tone: 'narration', text }]);
    return true;
  }

  async audience(amyrlin) {
    const game = this.game;
    if (this.canPresentEvidence) {
      const choice = (await game.dialogue([{ speaker: this.label(amyrlin), tone: 'ceremony', text: 'You asked to see me, daughter. Briefly.', choices: [{ label: 'Present your evidence against the conspiracy.', value: 'present', detail: `Leverage ${this.pol.leverage}/${LEVERAGE_NEEDED}` }, { label: 'It can wait.', value: 'wait' }] }]))[0];
      if (choice === 'present') {
        await this.presentEvidence();
        return false;
      }
      return true;
    }
    await game.dialogue([{ speaker: this.label(amyrlin), tone: 'ceremony', text: `The Amyrlin Seat looks up from a stack of reports. "The Tower is ${this.pol.stability > 60 ? 'calm, for now' : this.pol.stability > 30 ? 'restless' : 'on a knife\'s edge'}. Go about your duties."` }]);
    return true;
  }

  async talkToNovice(novice) {
    const p = this.player;
    const pol = this.pol;
    const game = this.game;
    if (p.rankIndex < 2) {
      await game.dialogue([{ speaker: novice.name, text: p.rankIndex === 0 ? `"Did you hear? They say ${this.sisterById(pol.amyrlinId).name} can hold more of the Power than any Amyrlin in a hundred years."` : '"Accepted! I mean, yes, Accepted. I was just going."' }]);
      return true;
    }
    if (novice.sponsor) {
      await game.dialogue([{ speaker: novice.name, text: `"Aes Sedai." She curtsies. ${novice.sponsor === p.ajah ? '"Thank you again for speaking for me."' : `The ${AJAHS[novice.sponsor].name} has already claimed her.`}` }]);
      return true;
    }
    if (pol.sponsoredThisWeek) {
      await game.dialogue([{ speaker: novice.name, text: `"Aes Sedai." A talent for ${novice.talent}, potential ${novice.potential}. You have already sponsored a novice this week.` }]);
      return true;
    }
    const rival = this.randomSister((s) => s.ajah !== p.ajah && s.role === 'sister');
    const choice = (await game.dialogue([{
      speaker: novice.name,
      text: `A novice with a rare talent for ${novice.talent} and a potential of ${novice.potential}. Sponsoring her would bind her to the ${p.ajahDef.name} Ajah's interest when she is raised.${rival ? ` ${rival.name} of the ${AJAHS[rival.ajah].name} has been watching her too.` : ''}`,
      choices: [
        { label: `Sponsor her for the ${p.ajahDef.name}.`, value: 'yes', detail: `+${2 + Math.floor(novice.potential / 4)} influence now, +1 every week · +5 standing${rival ? ' · a rivalry with ' + rival.name : ''}` },
        { label: 'Not now.', value: 'no' },
      ],
    }]))[0];
    if (choice === 'yes') {
      novice.sponsor = p.ajah;
      novice.rivalId = rival?.id ?? null;
      pol.sponsoredThisWeek = true;
      this.influence(p.ajah, 2 + Math.floor(novice.potential / 4));
      this.standing(5);
      if (rival) {
        this.disposition(rival, -20);
        pol.pending.push({ id: 'novice_rivalry', sisterId: rival.id, data: { rivalId: rival.id, noviceId: novice.id } });
      }
      this.log(`Sponsored ${novice.name} for the ${p.ajahDef.name} Ajah.`, 'politics');
      game.ui.toast(`${novice.name} is sponsored by the ${p.ajahDef.name} Ajah.`, 'good');
      game.save();
      return false;
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
// Missions: the halls, covert work, and the coup
// ---------------------------------------------------------------------------

const politicsOf = (game) => game.politics;
const covertRequires = (factions, flag) => (game) => {
  const pol = politicsOf(game).pol;
  if (!pol.conspiracy?.active) return 'There is no conspiracy to work for or against';
  if (!factions.includes(pol.faction)) return pol.faction ? 'Not your side of the conspiracy' : 'You have not been drawn into the conspiracy';
  if (pol.flags[flag]) return 'Already done';
  return null;
};

/** At the key moment of a covert mission, a double agent may fake it and keep evidence. */
async function covertChoice(run, { act, fake }) {
  const tp = run.game.politics;
  if (tp.pol.faction !== 'double') return 'real';
  const choice = await run.ask({
    speaker: 'Your choice',
    tone: 'danger',
    text: act,
    choices: [
      { label: 'Do it for real, and keep your cover.', value: 'real', detail: 'Tower Stability falls · suspicion -10' },
      { label: fake, value: 'fake', detail: '+1 leverage · suspicion +20' },
    ],
  });
  return choice;
}

/** Each covert mission yields at most one piece of leverage, however many acts it fakes. */
function applyCovert(run, choice, { stability, label, suspicion = 20 }) {
  const tp = run.game.politics;
  if (choice === 'fake') {
    if (!run.flags.leverageTaken) {
      run.flags.leverageTaken = true;
      tp.addLeverage(1, label);
    }
    tp.pol.suspicion = clamp(tp.pol.suspicion + suspicion, 0, 100);
    tp.adjustStability(-Math.ceil(stability / 4), 'A covert act, quietly undone');
  } else {
    if (tp.pol.faction === 'double') tp.pol.suspicion = clamp(tp.pol.suspicion - 10, 0, 100);
    tp.adjustStability(-stability, label);
  }
}

function watchGuards(run, routes) {
  routes.forEach((route) => run.spawn('guard', route[0].x, route[0].y, { patrol: route, alerted: false, silent: true, name: 'Tower Guard', label: null }));
  run.on('alarm', () => run.fail('caught'));
}

const COVERT_FAILURE = {
  prestige: -20,
  strike: true,
  text: (reason) => (reason === 'caught'
    ? 'Tower Guards caught you where no sister should be. The questions began that night, and they have not stopped. The conspiracy cannot afford you now.'
    : 'You were found senseless in a corridor of the Tower, with no good explanation for being there.'),
};

export const POLITICS_MISSIONS = [
  {
    id: 'tower_halls',
    title: 'Walk the Tower Halls',
    type: 'social',
    chapter: 'The White Tower',
    summary: 'Walk the corridors. Sisters with business will find you; Ajah heads hold court in their quarters; novices fill the garden.',
    free: true,
    safe: true,
    quiet: true,
    repeatable: true,
    retryable: true,
    requires: { minRank: 'novice', resolved: ['garden_breach'] },
    rewards: { xp: 0, prestige: 0 },
    failure: { prestige: 0, strike: false, text: () => '' },
    setup(run) {
      run.useMap(buildTower('day'));
      run.game.politics.populateHalls(run);
      run.objective({ id: 'walk', label: 'Seek out whoever wants a word (!)', counter: true, target: run.game.politics.pol.pending.length });
      run.objective({ id: 'leave', label: 'Return to your rooms (west corridor) or press Esc' });
      run.zone({ id: 'exit', ...tileAt(2, 12), radius: 30, color: '#9ad9ea', label: 'Your rooms', once: true, onEnter: (r) => r.succeed() });
      run.on('update', () => run.setProgress('walk', run.game.politics.pol.pending.length));
    },
  },
  {
    id: 'covert_bribe',
    hideWhenLocked: true,
    title: 'Silver for the Sitters',
    type: 'stealth',
    chapter: 'The Conspiracy',
    summary: 'At night, carry purses to three Sitters\' chambers without the Tower Guard seeing you. Stability falls with each one bought.',
    retryable: true,
    repeatable: true,
    requires: { minRank: 'aes_sedai', custom: covertRequires(['conspirator', 'double'], 'covert_bribe') },
    rewards: { xp: 150, prestige: 0 },
    failure: COVERT_FAILURE,
    setup(run) {
      run.useMap(buildTower('night'));
      nightOverlay(run);
      watchGuards(run, [
        [tileAt(3, 12), tileAt(56, 12)],
        [tileAt(56, 12), tileAt(3, 12)],
        [tileAt(42, 3), tileAt(46, 8)],
        [tileAt(55, 3), tileAt(57, 8)],
      ]);
      run.objective({ id: 'sitters', label: 'Visit the Sitters\' chambers', target: 3 });
      run.objective({ id: 'leave', label: 'Slip back to your rooms', hidden: true });
      for (const [i, c] of [44, 50, 56].entries()) {
        run.zone({
          id: `sitter${i}`,
          ...tileAt(c, 5),
          radius: 24,
          color: '#e0c060',
          label: `Sitter ${['Ellane', 'Doriva', 'Merrin'][i]}`,
          onEnter: async (r) => {
            const choice = await covertChoice(r, { act: 'The Sitter takes the purse without looking at it. Her ledger of debts lies open on the desk.', fake: 'Leave the purse, but copy her ledger of debts.' });
            if (!r.active) return;
            applyCovert(r, choice, { stability: 6, label: 'A Sitter\'s ledger of debts, copied', suspicion: 8 });
            r.progress('sitters');
            if (r.obj('sitters').done) {
              r.reveal('leave');
              r.zone({ id: 'exit', ...tileAt(2, 12), radius: 30, color: '#9ad9ea', label: 'Your rooms', onEnter: (rr) => rr.succeed() });
            }
          },
        });
      }
    },
    async debrief(run) {
      run.game.politics.pol.flags.covert_bribe = true;
    },
  },
  {
    id: 'covert_wards',
    hideWhenLocked: true,
    title: 'Darkened Wards',
    type: 'stealth',
    chapter: 'The Conspiracy',
    summary: 'Unravel four nodes of the Tower\'s ward-grid, each with its matching flow, while sentinels patrol and guards watch.',
    retryable: true,
    repeatable: true,
    requires: { minRank: 'aes_sedai', custom: covertRequires(['conspirator', 'double'], 'covert_wards') },
    rewards: { xp: 160, prestige: 0 },
    failure: COVERT_FAILURE,
    setup(run) {
      run.useMap(buildTower('night'));
      nightOverlay(run);
      watchGuards(run, [[tileAt(5, 12), tileAt(54, 12)], [tileAt(20, 33), tileAt(40, 33)]]);
      for (const route of [[tileAt(3, 15), tileAt(3, 23)], [tileAt(56, 15), tileAt(56, 23)]]) run.spawn('sentinel', route[0].x, route[0].y, { patrol: route, silent: true });
      const nodes = [tileAt(9.5, 8), tileAt(50, 2), tileAt(2.5, 35), tileAt(56.5, 38)];
      const elements = ['earth', 'fire', 'water', 'spirit'];
      nodes.forEach((pos, i) => run.spawn('practice_ward', pos.x, pos.y, { requiredElement: elements[(i + run.game.politics.pol.week) % 4], silent: true, label: 'Ward Node', xp: 10 }));
      run.objective({ id: 'nodes', label: 'Unravel the ward-nodes (matching flow)', target: 4 });
      run.objective({ id: 'decide', label: 'Leave the grid dark', hidden: true });
      run.on('wardMiss', (ward) => {
        const guard = run.enemies.nearest(ward.x, ward.y, 600, (e) => e.type === 'guard');
        if (guard) guard.suspicion = Math.min(0.95, guard.suspicion + 0.5);
        run.toast('The ward flares. Someone may have noticed.', 'warn');
      });
      run.on('enemyKilled', async (e) => {
        if (e.type !== 'practice_ward') return;
        run.progress('nodes');
        if (!run.obj('nodes').done) return;
        const choice = await covertChoice(run, { act: 'The last node gutters out. The Tower\'s ward-grid is dark.', fake: 'Leave a hidden trace that will lead the Amyrlin\'s Warders to the conspiracy.' });
        if (!run.active) return;
        applyCovert(run, choice, { stability: 18, label: 'The Tower\'s ward-grid went dark' });
        run.complete('decide');
        run.after(0.6, (r) => r.succeed());
      });
    },
    async debrief(run) {
      run.game.politics.pol.flags.covert_wards = true;
    },
  },
  {
    id: 'covert_forgery',
    hideWhenLocked: true,
    title: 'The Forged Hand',
    type: 'stealth',
    chapter: 'The Conspiracy',
    summary: 'Steal the Keeper\'s seal from the archive and plant forged orders in the Hall of the Tower, where the Sitters will find them.',
    retryable: true,
    repeatable: true,
    requires: { minRank: 'aes_sedai', custom: covertRequires(['conspirator', 'double'], 'covert_forgery') },
    rewards: { xp: 160, prestige: 0 },
    failure: COVERT_FAILURE,
    setup(run) {
      run.useMap(buildTower('night'));
      nightOverlay(run);
      watchGuards(run, [[tileAt(2, 2), tileAt(17, 8)], [tileAt(4, 12), tileAt(30, 12)], [tileAt(22, 3), tileAt(37, 8)]]);
      run.objective({ id: 'seal', label: 'Steal the Keeper\'s seal from the archive' });
      run.objective({ id: 'plant', label: 'Plant the forged orders in the Hall', hidden: true });
      run.pickup({ id: 'seal', kind: 'relic', label: 'Keeper\'s seal', color: '#c9a64a', ...tileAt(15, 2), onCollect: (r) => { r.complete('seal'); r.reveal('plant'); } });
      run.zone({
        id: 'chairs',
        ...tileAt(29.5, 4),
        radius: 28,
        color: '#e0c060',
        label: 'Sitters\' chairs',
        onEnter: async (r, z) => {
          if (!r.obj('seal').done) {
            z.triggered = false;
            return;
          }
          z.active = false;
          const choice = await covertChoice(r, { act: 'The forged orders, sealed with the Keeper\'s own seal, would set the Hall against the Amyrlin by morning.', fake: 'Keep the forgery and the seal as evidence.' });
          if (!r.active) return;
          applyCovert(r, choice, { stability: 16, label: 'Forged orders turned the Hall against the Amyrlin' });
          r.complete('plant');
          r.after(0.6, (rr) => rr.succeed());
        },
      });
    },
    async debrief(run) {
      run.game.politics.pol.flags.covert_forgery = true;
    },
  },
  {
    id: 'loyal_shadow',
    hideWhenLocked: true,
    title: 'Shadows in the Corridors',
    type: 'stealth',
    chapter: 'The Conspiracy',
    summary: 'Follow a conspirator through the night-dark Tower. Stay close enough to see where she goes, and never let her see you.',
    retryable: true,
    repeatable: true,
    requires: { minRank: 'aes_sedai', custom: (game) => {
      const pol = politicsOf(game).pol;
      if (!pol.conspiracy?.active) return 'There is no conspiracy to shadow';
      if (pol.faction !== 'loyalist' && pol.faction !== 'double') return 'Only those working against the conspiracy';
      if (pol.leverage >= LEVERAGE_NEEDED) return 'You already hold enough leverage. Go to the Amyrlin.';
      return null;
    } },
    rewards: { xp: 140, prestige: 5 },
    failure: { prestige: -10, strike: false, text: () => 'She saw you. By morning every conspirator knew your face, and they will be more careful now.' },
    setup(run) {
      run.useMap(buildTower('night'));
      nightOverlay(run, 0.5);
      const tp = run.game.politics;
      const leader = tp.sisterById(tp.pol.conspiracy.leaderId);
      const route = [tileAt(52, 12), tileAt(44, 6), tileAt(44, 12), tileAt(22, 12), tileAt(9.5, 8), tileAt(9.5, 12), tileAt(2.5, 20), tileAt(2.5, 30), tileAt(29, 37), tileAt(56.5, 30), tileAt(56.5, 12)];
      const mark = run.spawn('guard', route[0].x, route[0].y, { patrol: route, alerted: false, silent: true, name: leader.name, label: `${leader.name} (conspirator)` });
      run.flags.mark = mark;
      run.on('alarm', () => run.fail('seen'));
      run.objective({ id: 'tail', label: 'Keep her in sight without being seen (seconds)', target: 30 });
      const hide = tileAt(57, 21);
      run.player.x = hide.x;
      run.player.y = hide.y;
      run.toast(`${leader.name} leaves the Sitters' chambers. Follow her, and stay out of her sight.`, 'info');
      run.on('update', (dt) => {
        const p = run.player;
        const d = dist(p.x, p.y, mark.x, mark.y);
        if (d < 300 && run.map.lineOfSight(p.x, p.y, mark.x, mark.y)) {
          run.flags.seen = (run.flags.seen ?? 0) + dt;
          run.setProgress('tail', Math.floor(run.flags.seen));
          if (run.flags.seen >= 30 && !run.obj('tail').done) {
            run.complete('tail');
            tp.addLeverage(1, `Followed ${leader.name} to a meeting of Sitters.`);
            run.after(0.5, (r) => r.succeed());
          }
        }
      });
    },
  },
  {
    id: 'tower_coup',
    hideWhenLocked: true,
    title: 'The Tower Coup',
    type: 'combat',
    chapter: 'The White Tower',
    summary: 'The Tower has broken. Fight through burning corridors to the Hall of the Tower and decide who holds the stole.',
    free: true,
    retryable: true,
    repeatable: true,
    requires: { minRank: 'aes_sedai', custom: (game) => (politicsOf(game).pol.coup?.pending ? null : 'The Tower stands, for now') },
    rewards: { xp: 400, prestige: 30 },
    failure: { prestige: -30, strike: true, scar: 'fade_marked', text: () => 'You fell in the corridors. When you woke, shielded and bound, the other side held the Hall.' },
    async briefing(ctx) {
      const tp = ctx.game.politics;
      const side = tp.coupSide();
      await ctx.say([
        { speaker: 'Narrator', tone: 'danger', text: 'Every bell in the Tower rings at once. Somewhere above, saidar flares bright enough to taste. Warders run past your door with swords drawn, and you cannot tell whose Warders they are.' },
        { speaker: 'Narrator', tone: 'danger', text: side === 'rebel' ? 'This is the night you were promised. If it fails, there will be a trial, and a stilling.' : 'The conspiracy has moved. If they take the Hall, the Amyrlin falls, and everyone who stood with her.' },
        { speaker: 'Narrator', tone: 'narration', text: 'The main doors of the Hall are barricaded. The Keeper\'s archive has a hollow wall (strike it with Earth). The Oaths still bind you: bind, stun or shield the sisters and Guards who oppose you, then seize them.' },
      ]);
      return true;
    },
    setup(run) {
      const tp = run.game.politics;
      const p = run.player;
      run.flags.side = tp.coupSide();
      run.useMap(buildTower('coup'));
      coupFires(run);
      const start = p.ajah ? ajahRoomCenter(p.ajah) : tileAt(29, 12);
      p.x = start.x;
      p.y = start.y;
      if (p.mod('maxWarders', 0)) run.allies.spawnWarders(p.warders, p.x, p.y);
      run.objective({ id: 'reach', label: 'Reach the Hall of the Tower (break the archive\'s hollow wall)' });
      run.objective({ id: 'champion', label: 'Subdue the opposing champion', hidden: true });
      run.objective({ id: 'seat', label: 'Decide who holds the stole', hidden: true });
      run.on('playerDowned', () => run.fail('fallen'));
      const foeOpts = { alerted: true };
      const spawnFoes = (count) => {
        for (let i = 0; i < count; i++) {
          const pos = run.randomOpen({ minFromPlayer: 360 });
          run.spawn(Math.random() < 0.3 ? 'rebel_sister' : 'tower_guard', pos.x, pos.y, foeOpts);
        }
      };
      spawnFoes(6);
      run.every(11, (r) => {
        if (r.flags.stage2 || r.hostilesRemaining() >= 9) return;
        spawnFoes(2 + Math.floor(r.time / 60));
      });
      run.zone({ id: 'hollow', ...tileAt(17.5, 5), radius: 26, color: '#b49bff', label: 'Hollow wall', once: false });
      run.zone({
        id: 'hall',
        ...tileAt(29.5, 5),
        radius: 60,
        color: '#e0c060',
        label: 'The Amyrlin Seat',
        onEnter: async (r) => {
          r.complete('reach');
          r.flags.stage2 = true;
          const leader = tp.sisterById(tp.pol.conspiracy?.leaderId);
          const amyrlin = tp.sisterById(tp.pol.amyrlinId);
          const choice = await r.ask({
            speaker: 'The Hall of the Tower',
            tone: 'danger',
            text: `The Hall is split. ${amyrlin?.name ?? 'The Amyrlin'} stands before the Amyrlin Seat with a handful of loyal sisters. ${leader?.name ?? 'The rebels'} holds the far end with Sitters at her back. Both turn to you.`,
            choices: [
              { label: `Stand with ${amyrlin?.name ?? 'the Amyrlin'}, the Amyrlin Seat.`, value: 'loyal', detail: r.flags.side === 'rebel' ? 'Betray the conspiracy' : 'As you swore' },
              { label: `Stand with ${leader?.name ?? 'the rebel leader'} and the rebels.`, value: 'rebel', detail: r.flags.side === 'rebel' ? 'As you swore' : 'Turn your coat at the last moment' },
            ],
          });
          if (!r.active) return;
          r.flags.side = choice;
          for (const e of r.enemies.list) if (!e.dead && e.countsAsHostile) e.capture();
          const champ = choice === 'loyal' ? leader : r.game.politics.sisterById(`head_${amyrlin?.ajah ?? 'blue'}`) ?? amyrlin;
          r.flags.championRecord = champ;
          const pos = tileAt(29.5, 2.5);
          const boss = r.spawn('rebel_sister', pos.x, pos.y, { boss: true, name: champ?.name ?? 'Champion', label: `${champ?.name ?? 'Champion'} (${choice === 'loyal' ? 'rebel' : 'loyalist'})`, scale: r.scale * (1 + (champ?.strength ?? 12) / 20) });
          r.flags.boss = boss.id;
          r.group('tower_guard', 3, pos.x, pos.y + 80, 60);
          r.reveal('champion');
          r.toast('Subdue the champion: bind or shield her, then seize her.', 'danger');
        },
      });
      run.on('enemyKilled', async (e) => {
        if (e.id !== run.flags.boss) return;
        run.complete('champion');
        run.reveal('seat');
        for (const foe of run.enemies.list) if (!foe.dead && foe.countsAsHostile) foe.capture();
        const champ = run.flags.championRecord;
        const amyrlin = tp.sisterById(tp.pol.amyrlinId);
        const leader = tp.sisterById(tp.pol.conspiracy?.leaderId);
        const canSeize = p.stats.strength >= (champ?.strength ?? 12) && p.prestige >= 120;
        const choices = run.flags.side === 'loyal'
          ? [{ label: `Restore ${amyrlin?.name ?? 'the Amyrlin'} to the Seat.`, value: 'loyal' }]
          : [{ label: `Raise ${leader?.name ?? 'the rebel leader'} as Amyrlin.`, value: 'rebel' }];
        choices.push(canSeize
          ? { label: 'Take the stole yourself.', value: 'player', detail: `Your strength (${p.stats.strength}) and name (${p.prestige} prestige) can carry the Hall` }
          : { label: 'Take the stole yourself.', value: 'cannot', detail: `You need Strength ${champ?.strength ?? 12} and 120 prestige` });
        let pick = null;
        while (!pick || pick === 'cannot') {
          pick = await run.ask({ speaker: 'The Amyrlin Seat', tone: 'ceremony', text: 'The fighting stops. Every sister in the Hall is looking at the empty Seat, and at you.', choices });
          if (!run.active) return;
          if (pick === 'cannot') await run.say([{ speaker: 'The Hall of the Tower', tone: 'narration', text: 'The Sitters will not follow you. Not yet.' }]);
        }
        run.flags.winner = pick;
        run.complete('seat');
        run.after(0.5, (r) => r.succeed());
      });
    },
    async debrief(run, ctx) {
      const tp = ctx.game.politics;
      const lines = tp.resolveCoup(run.flags.winner);
      await ctx.say([{ speaker: 'After the Coup', tone: 'ceremony', text: lines.join('\n') }]);
    },
    onFailure(run, game) {
      const tp = game.politics;
      if (run?.flags.side === 'rebel' || (!run && tp.coupSide() === 'rebel')) {
        tp.player.addChronicle('Tried for treason after the failed coup, and stilled.', 'shadow');
        tp.resolveCoup('loyal');
        game.pendingEnding = 'traitor';
      } else {
        tp.resolveCoup('rebel');
        tp.pol.penance = 2;
        tp.pol.actions = 0;
      }
    },
  },
];
