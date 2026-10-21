// The political climb: forcing a vacancy and winning a Sitter's chair, building coalitions and
// spending Tower gold in the Hall, the soft coup for the Amyrlin Seat, and the Amyrlin's rule of
// the nations (deploying forces against threats, funding decrees, resolving crises).

import { clamp, RNG } from './util.js';
import { AJAHS, AJAH_ORDER } from './player.js';
import { NATIONS, NATION_IDS } from './assignments.js';

const ELECTION_COOLDOWN_WEEKS = 4;
const SOFT_COUP_STABILITY = 35;
const MAJORITY = 4;
const THREAT_CRISIS = 80;
const FORCE_STRENGTH = 18;

/**
 * Tower gold projects. phase: the lowest office that can fund it. repeatable projects may be
 * funded again (max caps how often).
 */
export const PROJECTS = {
  ajah_library: {
    name: 'Endow your Ajah\'s library', cost: 15, phase: 'sitter',
    description: '+8 influence for your Ajah and +1 Potential.',
    apply: (asc) => { asc.tp.influence(asc.player.ajah, 8); asc.player.potential += 1; },
  },
  eyes_and_ears: {
    name: 'Fund an eyes-and-ears network', cost: 20, phase: 'sitter',
    description: 'One more assignment on the board every week, and assignment rewards +10%.',
  },
  novice_schools: {
    name: 'Found village novice schools', cost: 20, phase: 'sitter',
    description: 'Tower Stability +6 now, and +1 every week after.',
    apply: (asc) => asc.tp.adjustStability(6, 'Novice schools opened in the villages'),
  },
  border_garrisons: {
    name: 'Fund the Borderland garrisons', cost: 25, phase: 'sitter',
    description: 'The Borderlands\' regard +10, and Shadow threats there grow at half the rate.',
    apply: (asc) => { for (const id of NATION_IDS) if (NATIONS[id].terrain === 'borderland') asc.tp.nation(id, 10); },
  },
  warder_yards: {
    name: 'Build Warder training yards', cost: 25, phase: 'sitter',
    description: '+10 maximum health. A Green sister may bond a fourth Warder.',
    apply: (asc) => { asc.player.healthBonus += 10; },
  },
  angreal_vault: {
    name: 'Open the Tower\'s angreal vault', cost: 30, phase: 'amyrlin',
    description: '+1 Reserve and +1 Potential.',
    apply: (asc) => { asc.player.stats.reserve += 1; asc.player.potential += 1; },
  },
  gathering_of_kings: {
    name: 'Call a Gathering of Kings', cost: 35, phase: 'amyrlin', repeatable: true,
    description: 'Every nation\'s regard +8 and every threat -15.',
    apply: (asc) => {
      for (const id of NATION_IDS) {
        asc.tp.nation(id, 8);
        asc.pol.threats[id] = clamp((asc.pol.threats[id] ?? 0) - 15, 0, 100);
      }
    },
  },
  muster_warders: {
    name: 'Muster the Warders', cost: 25, phase: 'amyrlin', repeatable: true, max: 3,
    description: 'One more force to deploy every week (permanent, up to three times).',
    apply: (asc) => { asc.pol.flags.musters = (asc.pol.flags.musters ?? 0) + 1; },
  },
  day_of_unity: {
    name: 'Proclaim a day of unity', cost: 10, phase: 'amyrlin', repeatable: true,
    description: 'Tower Stability +8.',
    apply: (asc) => asc.tp.adjustStability(8, 'A day of unity was proclaimed'),
  },
};

const OFFICE_RANK = { sister: 0, sitter: 1, amyrlin: 2 };

export class Ascension {
  constructor(game) {
    this.game = game;
  }

  get tp() {
    return this.game.politics;
  }

  get pol() {
    return this.tp.pol;
  }

  get player() {
    return this.game.player;
  }

  get office() {
    const p = this.player;
    if (p.flags.amyrlin) return 'amyrlin';
    if (p.flags.sitter) return 'sitter';
    return 'sister';
  }

  /** Migrates older saves: every Ajah has a sitting incumbent, and the Crown has its ledgers. */
  ensureState() {
    const pol = this.pol;
    for (const ajah of AJAH_ORDER) {
      if (!pol.sisters.some((s) => s.ajah === ajah && s.role === 'sitter')) {
        const s = pol.sisters.find((x) => x.ajah === ajah && x.role === 'sister' && x.status === 'active');
        if (s) s.role = 'sitter';
      }
    }
    pol.coalition = Array.isArray(pol.coalition) ? pol.coalition : [];
    pol.gold = Number.isFinite(pol.gold) ? pol.gold : 0;
    pol.projects = pol.projects && typeof pol.projects === 'object' ? pol.projects : {};
    pol.threats = pol.threats && typeof pol.threats === 'object' ? pol.threats : {};
    pol.forces = pol.forces && typeof pol.forces === 'object' ? pol.forces : {};
    if (this.player.flags.sitter && !pol.coalition.includes(this.player.ajah)) pol.coalition.unshift(this.player.ajah);
  }

  funded(id) {
    return (this.pol.projects?.[id] ?? 0) > 0;
  }

  // -- Phase 1 → 2: the Sitter campaign --------------------------------------------

  campaignChecklist() {
    const p = this.player;
    const pol = this.pol;
    const done = pol.assignmentsDone ?? 0;
    return [
      { label: 'Be a full sister of an Ajah', met: p.rankIndex === 2 && !!p.ajah },
      { label: `Reach level 8 (now ${p.level})`, met: p.level >= 8 },
      { label: `Strength 8 in the Power (now ${p.stats.strength})`, met: p.stats.strength >= 8 },
      { label: `Earn 150 prestige (now ${p.prestige})`, met: p.prestige >= 150 },
      { label: `Favor of 55 with your Ajah (now ${pol.standing})`, met: pol.standing >= 55 },
      { label: `Complete 3 assignments abroad (now ${done})`, met: done >= 3 },
    ];
  }

  get electionCooldown() {
    const lost = this.pol.flags.electionLostWeek;
    return lost ? Math.max(0, lost + ELECTION_COOLDOWN_WEEKS - this.pol.week) : 0;
  }

  get campaignOpen() {
    return this.office === 'sister' && this.campaignChecklist().every((i) => i.met) && this.electionCooldown === 0;
  }

  incumbent() {
    const p = this.player;
    return this.pol.sisters.find((s) => s.ajah === p.ajah && s.role === 'sitter' && s.status === 'active') ?? null;
  }

  lawChance() {
    const p = this.player;
    const bonus = { gray: 25, white: 20, brown: 10 }[p.ajah] ?? 0;
    return clamp(20 + p.stats.control * 4 + bonus, 10, 95);
  }

  bestPatron() {
    const pol = this.pol;
    return NATION_IDS.filter((id) => (pol.nations[id] ?? 50) >= 65).sort((a, b) => pol.nations[b] - pol.nations[a])[0] ?? null;
  }

  /** The three ways to empty a chair. */
  vacancyOptions() {
    const inc = this.incumbent();
    const patron = this.bestPatron();
    const rel = inc ? this.tp.compare(inc) : 'peer';
    const noAction = this.pol.actions <= 0 ? 'No actions left this week' : null;
    return [
      { id: 'law', label: 'Find a flaw in her appointment (the Gray method)', detail: `${this.lawChance()}% from Control and your Ajah's grasp of Tower law · failure: Conflict +20, -8 favor`, reason: noAction },
      { id: 'reassign', label: 'Arrange her reassignment abroad (the covert method)', detail: patron ? `${NATIONS[patron].ruler} owes the Tower; spend 20 of ${NATIONS[patron].name}'s regard · Stability -4` : 'Needs a nation whose regard for the Tower is 65 or more', reason: noAction ?? (patron ? null : 'No ruler owes you enough') },
      { id: 'precedence', label: 'Challenge her precedence', detail: inc ? `Strength ${this.player.stats.strength} vs ${inc.strength} · Conflict +30, -5 favor` : '', reason: noAction ?? (rel === 'above' ? null : 'She does not stand below you in the Power') },
    ];
  }

  async forceVacancy(method) {
    const opt = this.vacancyOptions().find((o) => o.id === method);
    const inc = this.incumbent();
    if (!opt || opt.reason || !inc || !this.campaignOpen) return;
    const game = this.game;
    const tp = this.tp;
    tp.spendAction();
    if (method === 'law') {
      if (Math.random() * 100 < this.lawChance()) {
        inc.status = 'removed';
        tp.log(`Found a flaw in ${inc.name}'s appointment; she was stripped of her chair.`, 'politics');
        await game.dialogue([{ speaker: 'The Tower Library', tone: 'success', text: `Three nights among the protocols of the Hall, and there it is: ${inc.name} was raised to her chair by a vote one Sitter short of the Law's requirement, three hundred years of precedent unbroken. By noon the chair stands empty.` }]);
      } else {
        tp.disposition(inc, -30);
        tp.standing(-8);
        const note = tp.addConflict(20, `You tried to unseat ${inc.name} on a point of law, and failed.`);
        await game.dialogue([{ speaker: this.tp.label(inc), tone: 'danger', text: `A point of law? Against me? I wrote half the precedents you were reading, child.${note ? `\n${note}` : ''}` }]);
        game.save();
        return;
      }
    } else if (method === 'reassign') {
      const patron = this.bestPatron();
      tp.nation(patron, -20);
      tp.adjustStability(-4, `A crisis in ${NATIONS[patron].name} called a Sitter away`);
      inc.status = 'reassigned';
      tp.log(`${inc.name} was sent to ${NATIONS[patron].name} indefinitely.`, 'politics');
      await game.dialogue([{ speaker: NATIONS[patron].name, tone: 'narration', text: `A letter from ${NATIONS[patron].ruler} reaches the Hall: a dispute only a Sitter of the ${AJAHS[inc.ajah].name} can settle, and it will take years. ${inc.name} leaves Tar Valon within the week. Her chair stands empty.` }]);
    } else {
      tp.standing(-5);
      const note = tp.addConflict(30, `You forced ${inc.name} from her chair by precedence.`);
      inc.status = 'stepped down';
      tp.log(`${inc.name} yielded her chair to your precedence.`, 'politics');
      await game.dialogue([{ speaker: this.tp.label(inc), tone: 'danger', text: `She stands above me in the Power, and so I yield. Remember that the Tower watched you do this.${note ? `\n${note}` : ''}` }]);
    }
    this.pol.vacancy = { ajah: this.player.ajah, week: this.pol.week, method };
    await this.runElection();
  }

  /** The Ajah votes. You spend favor to buy support; rivals bring their own strength. */
  async runElection() {
    const p = this.player;
    const pol = this.pol;
    const tp = this.tp;
    const game = this.game;
    const ask = async (node) => (await game.dialogue([node]))[0];
    const rng = new RNG(pol.seed + pol.week * 53);
    const rivals = pol.sisters.filter((s) => s.ajah === p.ajah && s.role === 'sister' && s.status === 'active').slice(0, 2);
    const rivalScore = (s) => 4 + Math.floor(s.strength / 3) + rng.int(0, 2);
    const best = rivals.reduce((acc, s) => {
      const score = rivalScore(s);
      return !acc || score > acc.score ? { s, score } : acc;
    }, null);
    const head = tp.sisterById(`head_${p.ajah}`);
    await game.dialogue([{ speaker: tp.label(head), tone: 'ceremony', text: `The chair is empty. ${rivals.length ? `${rivals.map((r) => r.name).join(' and ')} ${rivals.length > 1 ? 'have' : 'has'} put ${rivals.length > 1 ? 'their names' : 'her name'} forward beside yours.` : 'Yours is the only name.'} The Ajah will vote tonight.` }]);
    const spends = [[10, 2], [25, 5], [40, 8]].filter(([cost]) => pol.standing >= cost);
    const spend = await ask({
      speaker: 'Your favor with the Ajah',
      text: `You hold ${pol.standing} favor. How much will you spend calling in debts and promises?`,
      choices: [...spends.map(([cost, votes]) => ({ label: `Spend ${cost} favor.`, value: cost, detail: `+${votes} votes` })), { label: 'Spend nothing.', value: 0 }],
    });
    let votes = spends.find(([cost]) => cost === spend)?.[1] ?? 0;
    pol.standing = clamp(pol.standing - (spend ?? 0), 0, 100);
    const chance = p.persuasionChance;
    const choices = [];
    if (p.mod('compellingVoice', false)) choices.push({ label: 'Speak with the Compelling Voice.', value: 'voice', detail: 'Gray Ajah: certain' });
    choices.push({ label: 'Speak to the Ajah.', value: 'persuade', detail: `Persuasion ${chance}%` });
    if (best && tp.compare(best.s) === 'above') choices.push({ label: `Remind them that ${best.s.name} stands below you.`, value: 'precedence', detail: 'Conflict +15' });
    const second = await ask({ speaker: 'The Ajah\'s sitting room', tone: 'narration', text: 'The sisters of your Ajah have gathered. This is your last chance to speak.', choices });
    if (second === 'voice') votes += 5;
    else if (second === 'persuade') votes += Math.random() * 100 < chance ? 4 : 1;
    else {
      votes += 4;
      tp.addConflict(15, 'You pressed your precedence in the election.');
    }
    votes += Math.floor(pol.influence[p.ajah] / 25) + Math.floor(p.prestige / 100);
    const rivalVotes = best ? best.score : 0;
    pol.vacancy = null;
    if (votes > rivalVotes) {
      p.flags.sitter = true;
      pol.coalition = [p.ajah];
      pol.actions += 1;
      p.prestige += 25;
      p.addChronicle(`Raised to the Hall as a Sitter for the ${p.ajahDef.name} Ajah.`, 'ceremony');
      tp.log(`Elected Sitter for the ${p.ajahDef.name}.`, 'politics');
      await game.dialogue([
        { speaker: 'The Ajah decides', tone: 'success', text: `${votes} votes for you${best ? `, ${rivalVotes} for ${best.s.name}` : ''}.` },
        { speaker: tp.label(head), tone: 'ceremony', text: `Then it is decided. You will sit for the ${p.ajahDef.name} in the Hall of the Tower. Vote wisely, Sitter.` },
        { speaker: 'A Sitter\'s chair', tone: 'success', text: '+25 prestige · one extra action every week · Hall votes come to you · build coalitions with other Ajahs · Tower gold to fund your own projects' },
      ]);
    } else {
      pol.flags.electionLostWeek = pol.week;
      if (best) best.s.role = 'sitter';
      p.prestige -= 5;
      tp.log(`Lost the election for the ${p.ajahDef.name}'s chair to ${best?.s.name}.`, 'politics');
      await game.dialogue([{ speaker: 'The Ajah decides', tone: 'danger', text: `${votes} votes for you, ${rivalVotes} for ${best?.s.name}. She takes the chair. You may try again in ${ELECTION_COOLDOWN_WEEKS} weeks, when you have found another way to empty one. (-5 prestige)` }]);
    }
    game.save();
  }

  // -- Phase 2: the Hall -----------------------------------------------------------------

  allianceChance(ajah) {
    const head = this.tp.sisterById(`head_${ajah}`);
    const p = this.player;
    let chance = 25 + (head?.disposition ?? 50) * 0.5 + p.persuasionChance * 0.3;
    if (p.ajah === 'gray') chance += 20;
    if (this.pol.conspiracy?.active && this.pol.conspiracy.ajah === ajah && this.pol.faction !== 'conspirator') chance -= 30;
    return Math.round(clamp(chance, 5, 95));
  }

  async seekAlliance(ajah) {
    const pol = this.pol;
    if (this.office !== 'sitter' || pol.coalition.includes(ajah) || pol.actions <= 0) return;
    const tp = this.tp;
    const head = tp.sisterById(`head_${ajah}`);
    tp.spendAction();
    const chance = this.allianceChance(ajah);
    if (Math.random() * 100 < chance) {
      pol.coalition.push(ajah);
      tp.disposition(head, 10);
      tp.log(`The ${AJAHS[ajah].name} Ajah's Sitters joined your coalition.`, 'politics');
      await this.game.dialogue([{ speaker: tp.label(head), tone: 'success', text: `The ${AJAHS[ajah].name} will stand with you in the Hall, Sitter, for as long as you stand with us. Vote against us, and we are done.` }]);
    } else {
      tp.disposition(head, -10);
      await this.game.dialogue([{ speaker: tp.label(head), tone: 'narration', text: `The ${AJAHS[ajah].name} keeps its own counsel. Perhaps another time.` }]);
    }
    this.game.save();
  }

  /** Decides a Hall vote: a majority coalition carries it; otherwise it is close to a coin toss. */
  decideVote(choice, motion) {
    const pol = this.pol;
    const size = pol.coalition.length;
    let passes;
    if (choice === 'abstain') passes = Math.random() < 0.5;
    else if (size >= MAJORITY) passes = choice === 'yes';
    else passes = Math.random() < 0.5 + (choice === 'yes' ? 0.08 : -0.08) * size;
    const lines = [`The motion ${passes ? 'passes' : 'fails'}.${size >= MAJORITY && choice !== 'abstain' ? ' Your coalition carried the Hall.' : ''}`];
    if (choice === 'no' && motion.sponsor !== 'amyrlin' && pol.coalition.includes(motion.sponsor) && motion.sponsor !== this.player.ajah) {
      pol.coalition = pol.coalition.filter((a) => a !== motion.sponsor);
      lines.push(`The ${AJAHS[motion.sponsor].name} leaves your coalition. You voted against them.`);
    }
    if (motion.sponsor === 'amyrlin' && !passes && choice === 'no') {
      const amyrlin = this.tp.sisterById(pol.amyrlinId);
      this.tp.disposition(amyrlin, -15);
      this.tp.adjustStability(-3, 'The Hall blocked the Amyrlin\'s decree');
      lines.push('You blocked the Amyrlin\'s decree. Her authority weakens.');
    }
    return { passes, lines };
  }

  weeklyGold() {
    const pol = this.pol;
    const p = this.player;
    if (this.office === 'sitter') return 6 + pol.coalition.length * 2 + (pol.influence[p.ajah] >= 60 ? 3 : 0);
    if (this.office === 'amyrlin') {
      const avg = NATION_IDS.reduce((s, id) => s + (pol.nations[id] ?? 50), 0) / NATION_IDS.length;
      return 15 + Math.floor(avg / 10) + Math.floor(pol.stability / 20);
    }
    return 0;
  }

  projectsFor() {
    const rank = OFFICE_RANK[this.office];
    return Object.entries(PROJECTS)
      .filter(([, pr]) => OFFICE_RANK[pr.phase] <= rank)
      .map(([id, pr]) => {
        const count = this.pol.projects[id] ?? 0;
        const maxed = pr.repeatable ? (pr.max ? count >= pr.max : false) : count > 0;
        return { id, ...pr, count, maxed, affordable: this.pol.gold >= pr.cost };
      });
  }

  fund(id) {
    const pr = PROJECTS[id];
    const entry = this.projectsFor().find((x) => x.id === id);
    if (!pr || !entry || entry.maxed || !entry.affordable) return false;
    this.pol.gold -= pr.cost;
    this.pol.projects[id] = (this.pol.projects[id] ?? 0) + 1;
    pr.apply?.(this);
    this.tp.log(`Funded: ${pr.name}.`, 'politics');
    this.game.ui.toast(`${pr.name}: funded.`, 'good');
    this.game.save();
    return true;
  }

  // -- Phase 3: the Amyrlin Seat ---------------------------------------------------------

  softCoupChecklist() {
    const pol = this.pol;
    return [
      { label: 'Sit in the Hall', met: this.office === 'sitter' },
      { label: `A coalition of ${MAJORITY} Ajahs including your own (now ${pol.coalition.length})`, met: pol.coalition.length >= MAJORITY },
      { label: `Tower Stability at ${SOFT_COUP_STABILITY} or below: the Amyrlin must be weak (now ${pol.stability})`, met: pol.stability <= SOFT_COUP_STABILITY },
    ];
  }

  get canDepose() {
    return this.softCoupChecklist().every((i) => i.met) && this.pol.actions > 0;
  }

  /** The soft coup: the Hall votes the Amyrlin out and raises you in her place. */
  async deposeAmyrlin() {
    if (!this.canDepose) return;
    const pol = this.pol;
    const p = this.player;
    const tp = this.tp;
    const game = this.game;
    tp.spendAction();
    const amyrlin = tp.sisterById(pol.amyrlinId);
    const size = pol.coalition.length;
    const chance = size >= MAJORITY + 1 ? 100 : clamp(55 + (p.ajah === 'gray' ? 25 : 0) + Math.floor(p.persuasionChance / 10), 5, 95);
    await game.dialogue([
      { speaker: 'The Hall of the Tower', tone: 'ceremony', text: `You stand and call for the Sitters to stand with you. The Hall goes very quiet. ${amyrlin?.name ?? 'The Amyrlin'} watches from the Amyrlin Seat as, one by one, the Sitters of ${pol.coalition.map((a) => `the ${AJAHS[a].name}`).join(', ')} rise to their feet.` },
    ]);
    if (Math.random() * 100 < chance) {
      await game.dialogue([{ speaker: 'The Hall of the Tower', tone: 'ceremony', text: `The greater consensus is reached. ${amyrlin?.name ?? 'The Amyrlin'} is stripped of the stole and the staff, and the Hall turns to you.` }]);
      await this.ascend('soft');
    } else {
      const lost = pol.coalition.pop();
      tp.standing(-20);
      tp.adjustStability(-5, 'A failed attempt to depose the Amyrlin');
      const note = tp.addConflict(30, 'You called for the Amyrlin\'s deposition and lost the vote.');
      await game.dialogue([{ speaker: 'The Hall of the Tower', tone: 'danger', text: `Not enough Sitters stand. ${lost ? `The ${AJAHS[lost].name}'s Sitters sit down again, and will not meet your eyes. ` : ''}${amyrlin?.name ?? 'The Amyrlin'} smiles. She will not forget this.${note ? `\n${note}` : ''}` }]);
    }
    game.save();
  }

  /** Raises the player to the Amyrlin Seat by any road: soft coup, hard coup or schism. */
  async ascend(method) {
    const pol = this.pol;
    const p = this.player;
    const amyrlin = this.tp.sisterById(pol.amyrlinId);
    if (amyrlin) amyrlin.status = 'deposed';
    p.flags.amyrlin = true;
    p.flags.sitter = false;
    pol.actions = Math.max(pol.actions, 1);
    if (method === 'soft') {
      this.tp.adjustStability(25, 'The Hall raised a new Amyrlin');
      p.prestige += 60;
      p.addChronicle('Raised to the Amyrlin Seat by the greater consensus of the Hall.', 'ceremony');
    }
    this.initCrown();
    await this.game.dialogue([{ speaker: 'The Amyrlin Seat', tone: 'ceremony', text: 'The stole striped in seven colours is laid on your shoulders. You are of all Ajahs now, and of none. Every Ajah\'s Mastery Weave is yours to command, and every nation\'s troubles are yours to answer. (See the Amyrlin\'s study in the Tower tab.)' }]);
  }

  initCrown() {
    const pol = this.pol;
    const p = this.player;
    for (const ajah of Object.values(AJAHS)) p.learn(ajah.mastery.weave);
    const rng = new RNG(pol.seed + 7);
    for (const id of NATION_IDS) {
      if (pol.threats[id] === undefined) pol.threats[id] = NATIONS[id].terrain === 'borderland' ? rng.int(40, 55) : rng.int(15, 35);
    }
    pol.forces = {};
    pol.gold = Math.max(pol.gold, 20);
  }

  forcesAvailable() {
    return 3 + (this.pol.flags.musters ?? 0) + Math.floor(this.pol.coalition.length / 3);
  }

  forcesDeployed() {
    return Object.values(this.pol.forces).reduce((s, n) => s + n, 0);
  }

  deploy(nation, delta) {
    const pol = this.pol;
    const now = pol.forces[nation] ?? 0;
    if (delta > 0 && this.forcesDeployed() >= this.forcesAvailable()) return;
    pol.forces[nation] = clamp(now + delta, 0, 9);
    if (!pol.forces[nation]) delete pol.forces[nation];
  }

  /** The nation in the gravest danger, for crisis assignments on the Amyrlin's board. */
  worstThreat() {
    if (this.office !== 'amyrlin') return null;
    const entries = NATION_IDS.map((id) => [id, this.pol.threats[id] ?? 0]).sort((a, b) => b[1] - a[1]);
    return entries[0][1] >= 60 ? entries[0][0] : null;
  }

  /** Called when the week ends: gold, schools, and (for the Amyrlin) forces against threats. */
  weekly(lines) {
    this.ensureState();
    const pol = this.pol;
    const tp = this.tp;
    const income = this.weeklyGold();
    if (income) {
      pol.gold += income;
      lines.push(`Tower gold: +${income} (treasury ${pol.gold}).`);
    }
    if (this.funded('novice_schools')) pol.stability = clamp(pol.stability + 1, 0, 100);
    if (this.office !== 'amyrlin') return;
    const rng = new RNG(pol.seed + pol.week * 211);
    const crises = [];
    for (const id of NATION_IDS) {
      const border = NATIONS[id].terrain === 'borderland';
      let rise = border ? rng.int(3, 8) : rng.int(1, 5);
      if (border && this.funded('border_garrisons')) rise = Math.ceil(rise / 2);
      const relief = (pol.forces[id] ?? 0) * FORCE_STRENGTH;
      pol.threats[id] = clamp((pol.threats[id] ?? 0) + rise - relief, 0, 100);
      if (pol.threats[id] >= THREAT_CRISIS) {
        crises.push(NATIONS[id].name);
        tp.nation(id, -10);
        tp.adjustStability(-4, `Crisis in ${NATIONS[id].name}`);
        pol.threats[id] = 60;
      }
    }
    const deployed = Object.entries(pol.forces).map(([id, n]) => `${n} to ${NATIONS[id].name}`);
    if (deployed.length) lines.push(`Your forces held the line: ${deployed.join(', ')}.`);
    if (crises.length) lines.push(`Crises the Tower failed to answer: ${crises.join(', ')}. Their regard falls, and the Tower trembles.`);
  }
}
