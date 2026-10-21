// DOM overlay: HUD, minimap, dialogue, hub screens, Ajah selection, toasts and error reporting.

import { clamp, dist, fillTemplate, formatTime } from './util.js';
import { TILE, T } from './world.js';
import { AFFINITIES, AJAHS, AJAH_ORDER, Player, STAT_IDS, STAT_INFO } from './player.js';
import { ELEMENTS, ELEMENT_BY_ID, TER_ANGREAL, WEAVES, dangerState, weaveTierLabel } from './magic.js';
import { WARDER_COMMANDS } from './allies.js';
import { actionsPerWeek } from './towerPolitics.js';
import { NATIONS } from './assignments.js';

const $ = (id) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing UI element #${id}`);
  return el;
};

/** Tiny element builder. Text is always assigned via textContent, never parsed as HTML. */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'style') {
      for (const [prop, v] of Object.entries(value)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, v);
        else el.style[prop] = v;
      }
    }
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const SCREENS = ['title', 'create', 'hub', 'ajah', 'pause', 'help', 'gameover'];
const TYPE_LABELS = {
  combat: 'Combat', academic: 'Academic', trial: 'Trial', stealth: 'Stealth', diplomacy: 'Diplomacy', support: 'Support', roguelite: 'Rogue-lite Hunt',
};
const ENDINGS = {
  stilled: {
    title: 'Stilled',
    text: 'You reached for the Source one last time and found nothing. Where saidar burned there is only a void, and it will never fill again. Stilled women rarely live long. Most simply stop wanting to.',
  },
  expelled: {
    title: 'Put Out of the Tower',
    text: 'The Hall has run out of patience. You are given a purse, a horse and a shield on your channeling that will hold for a year. The White Tower closes its gates behind you, and the Wheel turns without you.',
  },
  oathless: {
    title: 'Oathless',
    text: 'You would not take the Oaths. The Tower cannot hold a woman of your strength unbound. You are put out at dawn, and the sisters watch you from the walls until you are out of sight.',
  },
  traitor: {
    title: 'Stilled for Treason',
    text: 'The coup failed. The Hall tried you in a single afternoon, and by evening you were stilled before the assembled Ajahs. Your name is struck from the Tower\'s rolls, and your conspirators will not say it aloud.',
  },
};
const TOWER_MISSIONS = new Set(['tower_halls', 'covert_bribe', 'covert_wards', 'covert_forgery', 'loyal_shadow', 'tower_coup']);

export class UI {
  constructor(game) {
    this.game = game;
    this.cache = new Map();
    this.toastHistory = new Map();
    this.errorHistory = new Map();
    this.dialogueOpen = false;
    this.dialogueQueue = Promise.resolve();
    this.dialogueState = null;
    this.hubTab = 'missions';
    this.minimapTimer = 0;
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.el = {
      hud: $('hud'),
      name: $('hud-name'),
      title: $('hud-title'),
      ajah: $('hud-ajah'),
      level: $('hud-level'),
      prestige: $('hud-prestige'),
      strikes: $('hud-strikes'),
      barXp: $('bar-xp'),
      barHealth: $('bar-health'),
      barPower: $('bar-power'),
      danger: $('danger-meter'),
      dangerState: $('danger-state'),
      dangerValue: $('danger-value'),
      dangerNote: $('danger-note'),
      effects: $('hud-effects'),
      mission: $('hud-mission'),
      missionTitle: $('mission-title'),
      missionType: $('mission-type'),
      missionTimer: $('mission-timer'),
      objectives: $('mission-objectives'),
      elementBar: $('element-bar'),
      pattern: $('pattern-slots'),
      preview: $('weave-preview'),
      previewName: $('preview-name'),
      previewTier: $('preview-tier'),
      previewCost: $('preview-cost'),
      previewRisk: $('preview-risk'),
      previewReason: $('preview-reason'),
      abilities: $('hud-abilities'),
      minimap: $('minimap'),
      minimapLabel: $('minimap-label'),
      toasts: $('toasts'),
      dialogue: $('dialogue'),
      dialogueSpeaker: $('dialogue-speaker'),
      dialogueText: $('dialogue-text'),
      dialogueChoices: $('dialogue-choices'),
      dialogueHint: $('dialogue-hint'),
      hubHeader: $('hub-header'),
      hubTabs: $('hub-tabs'),
      hubBody: $('hub-body'),
      ajahGrid: $('ajah-grid'),
      createForm: $('create-form'),
      createName: $('create-name'),
      affinityGrid: $('affinity-grid'),
      createError: $('create-error'),
      continueBtn: $('btn-continue'),
      gameoverTitle: $('gameover-title'),
      gameoverText: $('gameover-text'),
      gameoverChronicle: $('gameover-chronicle'),
    };
    this.screens = Object.fromEntries(SCREENS.map((s) => [s, $(`screen-${s}`)]));
    this.buildElementBar();
    this.buildCreateForm();
    this.bindStaticButtons();
    this.el.dialogue.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      this.advanceDialogue();
    });
  }

  // -- screens -----------------------------------------------------------------

  showScreen(name) {
    if (name !== 'pause' && name !== 'help') this.clearToasts();
    for (const [key, el] of Object.entries(this.screens)) el.hidden = key !== name;
    const focusTarget = this.screens[name]?.querySelector('[data-autofocus], button, input');
    if (focusTarget) setTimeout(() => focusTarget.focus({ preventScroll: true }), 0);
  }

  hideScreens() {
    for (const el of Object.values(this.screens)) el.hidden = true;
  }

  get modalOpen() {
    return Object.values(this.screens).some((el) => !el.hidden);
  }

  setHUDVisible(visible) {
    this.el.hud.hidden = !visible;
    if (visible) this.cache.clear();
  }

  bindStaticButtons() {
    const g = this.game;
    $('btn-new').addEventListener('click', () => g.beginCreation());
    this.el.continueBtn.addEventListener('click', () => g.continueGame());
    for (const btn of document.querySelectorAll('[data-action="help"]')) {
      btn.addEventListener('click', () => {
        this.returnScreen = Object.entries(this.screens).find(([, el]) => !el.hidden)?.[0] ?? null;
        this.showScreen('help');
      });
    }
    $('btn-help-close').addEventListener('click', () => {
      if (this.returnScreen) this.showScreen(this.returnScreen);
      else this.hideScreens();
    });
    $('btn-resume').addEventListener('click', () => g.resume());
    $('btn-abandon').addEventListener('click', () => g.abandonMission());
    $('btn-new-life').addEventListener('click', () => g.returnToTitle());
    $('btn-create-back').addEventListener('click', () => g.returnToTitle());
  }

  showTitle(hasSave) {
    this.el.continueBtn.hidden = !hasSave;
    this.showScreen('title');
  }

  // -- creation ----------------------------------------------------------------

  buildCreateForm() {
    const grid = this.el.affinityGrid;
    grid.replaceChildren();
    for (const [id, aff] of Object.entries(AFFINITIES)) {
      const el = ELEMENT_BY_ID[id];
      grid.append(
        h('label', { class: 'affinity-card', style: { '--accent': el.color } },
          h('input', { type: 'radio', name: 'affinity', value: id, checked: id === 'fire' }),
          h('span', { class: 'affinity-card__name', text: aff.label }),
          h('span', { class: 'affinity-card__desc', text: aff.description })),
      );
    }
    this.el.createForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = this.el.createName.value.trim().replace(/\s+/g, ' ');
      const affinity = new FormData(this.el.createForm).get('affinity');
      if (name.length < 2 || name.length > 24) {
        this.el.createError.textContent = 'Your name must be between 2 and 24 characters.';
        return;
      }
      if (!/^[\p{L}\p{M}' .-]+$/u.test(name)) {
        this.el.createError.textContent = 'Use letters, spaces, apostrophes or hyphens only.';
        return;
      }
      if (!AFFINITIES[affinity]) {
        this.el.createError.textContent = 'Choose the flow that answers you first.';
        return;
      }
      this.el.createError.textContent = '';
      this.game.startNewGame(name, affinity);
    });
  }

  showCreate() {
    this.el.createName.value = '';
    this.el.createError.textContent = '';
    this.showScreen('create');
  }

  // -- toasts and errors ---------------------------------------------------------

  toast(text, tone = 'info', seconds = 3.5) {
    const now = performance.now();
    const last = this.toastHistory.get(text);
    if (last && now - last < 1200) return;
    this.toastHistory.set(text, now);
    const el = h('div', { class: `toast toast--${tone}`, role: tone === 'danger' || tone === 'error' ? 'alert' : 'status', text });
    this.el.toasts.append(el);
    while (this.el.toasts.children.length > 5) this.el.toasts.firstElementChild.remove();
    setTimeout(() => {
      el.classList.add('toast--leaving');
      setTimeout(() => el.remove(), 400);
    }, seconds * 1000);
  }

  clearToasts() {
    this.el.toasts.replaceChildren();
    this.toastHistory.clear();
  }

  /** User-facing error notice, rate-limited so a recurring fault never floods the screen. */
  reportError(message) {
    const now = performance.now();
    const last = this.errorHistory.get(message);
    if (last && now - last < 8000) return;
    this.errorHistory.set(message, now);
    this.toast(message, 'error', 6);
  }

  // -- HUD -----------------------------------------------------------------------

  set(key, el, prop, value) {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    if (prop === 'text') el.textContent = value;
    else if (prop === 'fill') el.style.setProperty('--fill', value);
    else if (prop.startsWith('data-')) el.setAttribute(prop, value);
    else if (prop === 'hidden') el.hidden = value;
    else if (prop === 'color') el.style.setProperty('--accent', value);
  }

  setBar(key, el, value, max, label) {
    this.set(`${key}:fill`, el, 'fill', clamp(max > 0 ? value / max : 0, 0, 1).toFixed(3));
    this.set(`${key}:label`, el.querySelector('.bar__label'), 'text', label);
  }

  buildElementBar() {
    const bar = this.el.elementBar;
    bar.replaceChildren();
    for (const el of ELEMENTS) {
      bar.append(
        h('button', {
          class: 'element-btn',
          type: 'button',
          style: { '--accent': el.color },
          title: `${el.name} (${el.key})`,
          'aria-label': `Add a thread of ${el.name}`,
          onClick: () => this.game.weaver.addThread(el.id),
        }, h('kbd', { text: el.key }), h('span', { text: el.name })),
      );
    }
  }

  updateHUD(dt) {
    const g = this.game;
    const p = g.player;
    if (!p) return;
    this.set('name', this.el.name, 'text', p.name);
    this.set('title', this.el.title, 'text', p.title);
    this.set('rank', this.el.title, 'data-rank', p.rank.id);
    const ajah = p.ajahDef;
    this.set('ajah', this.el.ajah, 'text', ajah ? `${ajah.archetype}: ${ajah.passive.name}` : p.rank.id === 'novice' ? 'Raw flows only' : 'Ajah undecided');
    this.set('ajahColor', this.el.ajah, 'color', ajah?.color ?? '#cfc8b8');
    this.set('level', this.el.level, 'text', String(p.level));
    this.set('prestige', this.el.prestige, 'text', String(p.prestige));
    this.set('strikes', this.el.strikes, 'text', `${'●'.repeat(p.strikes)}${'○'.repeat(Math.max(0, Player.MAX_STRIKES - p.strikes))}`);
    this.setBar('xp', this.el.barXp, p.xp, p.xpToNext, `XP ${p.xp} / ${p.xpToNext}`);
    this.setBar('hp', this.el.barHealth, p.health, p.maxHealth, `Health ${Math.ceil(p.health)} / ${p.maxHealth}`);
    this.setBar('power', this.el.barPower, p.power, p.maxPower, `One Power ${Math.floor(p.power)} / ${p.maxPower}`);
    this.set('lowhp', this.el.barHealth, 'data-low', String(p.health / p.maxHealth < 0.3));

    // Over-channeling meter with Ajah-specific thresholds.
    const ch = g.weaver.channel;
    const profile = p.dangerProfile;
    const state = dangerState(ch.danger, profile);
    this.set('dangerFill', this.el.danger, 'fill', (ch.danger / profile.max).toFixed(3));
    this.set('dangerState', this.el.danger, 'data-state', state.id);
    this.set('dangerLabel', this.el.dangerState, 'text', state.label);
    this.set('dangerValue', this.el.dangerValue, 'text', `${Math.round(ch.danger)} / ${profile.max}`);
    const note = p.channelLock > 0 ? `The Source eludes you: ${Math.ceil(p.channelLock)}s` : p.dread > 0 ? 'The eyeless gaze presses on you: strain will not fade.' : state.note;
    this.set('dangerNote', this.el.dangerNote, 'text', note);
    const profileKey = `${profile.strained}/${profile.volatile}/${profile.critical}/${profile.max}`;
    if (this.cache.get('dangerProfile') !== profileKey) {
      this.cache.set('dangerProfile', profileKey);
      this.el.danger.style.setProperty('--t-strained', profile.strained / profile.max);
      this.el.danger.style.setProperty('--t-volatile', profile.volatile / profile.max);
      this.el.danger.style.setProperty('--t-critical', profile.critical / profile.max);
    }

    this.updateEffects(p);
    this.updateAbilities(p);
    this.updateWeavePreview();
    this.updateMission();
    this.minimapTimer -= dt;
    if (this.minimapTimer <= 0) {
      this.minimapTimer = 0.12;
      try {
        this.renderMinimap();
      } catch (err) {
        console.error('[ui] minimap failed', err);
      }
    }
  }

  updateEffects(p) {
    const chips = [];
    const b = p.buffs;
    if (b.shield.amount > 0) chips.push(['shield', `Air Shield ${Math.ceil(b.shield.amount)}`]);
    if (b.regen.time > 0) chips.push(['heal', `Healing ${Math.ceil(b.regen.time)}s`]);
    if (b.haste.time > 0) chips.push(['haste', `Haste ${Math.ceil(b.haste.time)}s`]);
    if (b.empower.time > 0) chips.push(['artifact', `Angreal ${Math.ceil(b.empower.time)}s`]);
    if (b.lens.time > 0) chips.push(['artifact', `Seeing-Lens ${Math.ceil(b.lens.time)}s`]);
    if (p.channelLock > 0) chips.push(['danger', `Source lost ${Math.ceil(p.channelLock)}s`]);
    if (p.dread > 0) chips.push(['danger', 'Dread']);
    if (p.stun > 0) chips.push(['danger', 'Stunned']);
    if (p.root > 0) chips.push(['danger', 'Bound']);
    if (p.oathsSworn) chips.push(['oath', p.oathBlocksHarm() ? 'Third Oath: humans protected' : 'Last extreme: Oath released']);
    const runId = this.game.missions.run?.def.id;
    if (TOWER_MISSIONS.has(runId) && p.politics && p.rankIndex === 2) chips.push(['danger', `Tower Stability ${Math.round(p.politics.stability)}`]);
    if (p.ajah === 'green') {
      const alive = this.game.allies.activeWarders.length;
      chips.push(['ally', `Warders ${alive} · ${WARDER_COMMANDS[this.game.allies.command].label}`]);
    }
    const key = chips.map((c) => c.join(':')).join('|');
    if (this.cache.get('effects') === key) return;
    this.cache.set('effects', key);
    this.el.effects.replaceChildren(...chips.map(([tone, text]) => h('span', { class: `chip chip--${tone}`, text })));
  }

  updateAbilities(p) {
    const items = [['Space', 'Dash', p.dashCooldown]];
    const ability = p.ajahDef?.ability;
    if (ability?.key === 'F') items.push(['F', ability.name, p.abilityCooldown]);
    if (p.canUseArtifacts) {
      const art = TER_ANGREAL[p.equippedArtifact];
      items.push(['R', art ? art.name : 'No ter\'angreal', art ? p.artifactCooldown : -1]);
    }
    items.push(['RMB', 'Repeat weave', 0]);
    const key = items.map(([k, n, cd]) => `${k}${n}${Math.ceil(cd)}`).join('|');
    if (this.cache.get('abilities') === key) return;
    this.cache.set('abilities', key);
    this.el.abilities.replaceChildren(
      ...items.map(([k, name, cd]) =>
        h('span', { class: `ability${cd > 0 ? ' ability--cooling' : ''}${cd < 0 ? ' ability--empty' : ''}` },
          h('kbd', { text: k }), h('span', { text: cd > 0 ? `${name} ${Math.ceil(cd)}s` : name }))),
    );
  }

  updateWeavePreview() {
    const g = this.game;
    const pv = g.weaver.preview();
    const threadsKey = pv.threads.join(',');
    if (this.cache.get('threads') !== threadsKey) {
      this.cache.set('threads', threadsKey);
      const slots = [];
      for (let i = 0; i < 3; i++) {
        const el = pv.threads[i] ? ELEMENT_BY_ID[pv.threads[i]] : null;
        slots.push(h('span', { class: `slot${el ? ' slot--filled' : ''}`, style: el ? { '--accent': el.color } : {}, text: el ? el.name[0] : '' }));
      }
      this.el.pattern.replaceChildren(...slots);
    }
    let name;
    let tier = '';
    let cost = '';
    let risk = '';
    let riskLevel = 'none';
    let reason = '';
    if (pv.empty) {
      name = g.weaver.lastPattern ? `Ready: ${g.weaver.identify(g.weaver.lastPattern)?.name ?? 'last pattern'} on right-click` : 'Gather threads (1-5)';
    } else if (pv.status === 'unformed' || pv.status === 'unknown') {
      name = pv.title;
      riskLevel = 'volatile';
      risk = 'Will fizzle and strain you';
      reason = pv.reason;
    } else {
      name = pv.title;
      tier = weaveTierLabel(pv.weave);
      if (pv.status === 'locked') {
        riskLevel = 'locked';
        risk = 'Locked';
        reason = pv.reason;
      } else {
        cost = `${Math.round(pv.cost)} power · +${Math.round(pv.strain)} strain`;
        risk = pv.status === 'cooldown' ? `Settling ${pv.cooldown.toFixed(1)}s` : pv.risk.label;
        riskLevel = pv.risk.level;
        if (pv.multiplier > 1.01) reason = `Strain x${pv.multiplier.toFixed(1)}`;
      }
    }
    this.set('pvName', this.el.previewName, 'text', name);
    this.set('pvTier', this.el.previewTier, 'text', tier);
    this.set('pvCost', this.el.previewCost, 'text', cost);
    this.set('pvRisk', this.el.previewRisk, 'text', risk);
    this.set('pvRiskLevel', this.el.preview, 'data-risk', riskLevel);
    this.set('pvReason', this.el.previewReason, 'text', reason);
  }

  updateMission() {
    const run = this.game.missions.run;
    this.set('missionVisible', this.el.mission, 'hidden', !run);
    if (!run) return;
    this.set('missionTitle', this.el.missionTitle, 'text', run.title);
    this.set('missionType', this.el.missionType, 'text', run.typeLabel ?? TYPE_LABELS[run.def.type] ?? run.def.type);
    this.set('missionTimer', this.el.missionTimer, 'text', run.timeLimit !== null ? formatTime(run.timeLimit) : '');
    this.set('missionUrgent', this.el.missionTimer, 'data-urgent', String(run.timeLimit !== null && run.timeLimit < 20));
    const visible = run.objectives.filter((o) => !o.hidden);
    const key = visible.map((o) => `${o.id}${o.current}/${o.target}${o.done}${o.failed}${o.label}`).join('|');
    if (this.cache.get('objectives') === key) return;
    this.cache.set('objectives', key);
    this.el.objectives.replaceChildren(
      ...visible.map((o) => {
        const state = o.done ? 'done' : o.failed ? 'failed' : 'active';
        const showCount = o.target > 1 || o.counter;
        return h('li', { class: `objective objective--${state}${o.optional ? ' objective--optional' : ''}` },
          h('span', { class: 'objective__mark', 'aria-hidden': 'true', text: o.done ? '✓' : o.failed ? '✗' : '◆' }),
          h('span', { class: 'objective__label', text: o.label }),
          showCount ? h('span', { class: 'objective__count', text: o.counter && o.target === 1 ? `${o.current}` : `${o.current}/${o.target}` }) : null);
      }),
    );
  }

  // -- minimap with fog of war -----------------------------------------------------

  renderMinimap() {
    const g = this.game;
    const map = g.map;
    const canvas = this.el.minimap;
    if (!map || this.el.hud.hidden) return;
    const p = g.player;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const hgt = canvas.height;
    const scale = Math.min(w / map.cols, hgt / map.rows);
    const ox = (w - map.cols * scale) / 2;
    const oy = (hgt - map.rows * scale) / 2;
    ctx.fillStyle = '#07060b';
    ctx.fillRect(0, 0, w, hgt);
    const revealAll = !!p.mod('revealMap', false);
    for (let r = 0; r < map.rows; r++) {
      for (let c = 0; c < map.cols; c++) {
        if (!revealAll && !map.explored[r * map.cols + c]) continue;
        const tile = map.get(c, r);
        ctx.fillStyle = tile === T.SECRET && revealAll ? '#b49bff' : map.miniColor(c, r);
        ctx.fillRect(ox + c * scale, oy + r * scale, Math.ceil(scale), Math.ceil(scale));
      }
    }
    const toMini = (x, y) => [ox + (x / TILE) * scale, oy + (y / TILE) * scale];
    const seen = (x, y) => revealAll || map.explored[Math.floor(y / TILE) * map.cols + Math.floor(x / TILE)];
    const run = g.missions.run;
    if (run) {
      for (const z of run.zones) {
        if (!z.active || (z.once && z.triggered) || !z.visible) continue;
        const [x, y] = toMini(z.x, z.y);
        ctx.strokeStyle = z.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(3, (z.radius / TILE) * scale), 0, Math.PI * 2);
        ctx.stroke();
      }
      for (const pk of run.pickups) {
        if (pk.collected) continue;
        if (!seen(pk.x, pk.y) && !(pk.kind === 'artifact' && p.canUseArtifacts)) continue;
        const [x, y] = toMini(pk.x, pk.y);
        ctx.fillStyle = pk.kind === 'artifact' ? '#e8c35a' : '#f2ecd8';
        ctx.fillRect(x - 2, y - 2, 4, 4);
      }
      for (const trap of run.traps) {
        if (!trap.armed || !(trap.revealed || p.seesHidden)) continue;
        const [x, y] = toMini(trap.x, trap.y);
        ctx.strokeStyle = '#ff4b4b';
        ctx.beginPath();
        ctx.moveTo(x - 2, y - 2);
        ctx.lineTo(x + 2, y + 2);
        ctx.moveTo(x + 2, y - 2);
        ctx.lineTo(x - 2, y + 2);
        ctx.stroke();
      }
    }
    const vision = p.visionRadius * TILE;
    for (const e of g.enemies.list) {
      if (e.dead) continue;
      const visible = p.seesHidden || (e.isVisibleTo(p) && dist(p.x, p.y, e.x, e.y) < vision && map.lineOfSight(p.x, p.y, e.x, e.y));
      if (!visible) continue;
      const [x, y] = toMini(e.x, e.y);
      ctx.fillStyle = e.def.harmless ? '#9ad9ea' : e.def.invulnerable ? '#e2c35b' : e.boss ? '#d06bff' : e.def.human ? '#ffb347' : '#ff4b4b';
      ctx.beginPath();
      ctx.arc(x, y, e.boss ? 3 : 2, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const wd of g.allies.warders) {
      if (wd.dead) continue;
      const [x, y] = toMini(wd.x, wd.y);
      ctx.fillStyle = '#5fd36a';
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    for (const n of g.allies.npcs) {
      const [x, y] = toMini(n.x, n.y);
      ctx.fillStyle = n.saved ? '#ffe680' : n.dead ? '#555' : '#f0a060';
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    const [px, py] = toMini(p.x, p.y);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(px, py, (vision / TILE) * scale, 0, Math.PI * 2);
    ctx.stroke();
    this.set('miniLabel', this.el.minimapLabel, 'text', revealAll ? 'Eyes and Ears: all revealed' : p.seesHidden ? 'Seeing-Lens active' : 'Explored');
  }

  // -- dialogue --------------------------------------------------------------------

  /** Queues a dialogue script. Resolves with the values of every choice made, in order. */
  dialogue(nodes) {
    const result = this.dialogueQueue.then(() => this.runDialogue(nodes));
    this.dialogueQueue = result.catch((err) => console.error('[ui] dialogue failed', err));
    return result;
  }

  async runDialogue(nodes) {
    const values = [];
    this.dialogueOpen = true;
    this.el.dialogue.hidden = false;
    try {
      for (const node of nodes) {
        const value = await this.presentNode(node);
        if (node.choices?.length) values.push(value);
      }
    } finally {
      this.dialogueOpen = false;
      this.el.dialogue.hidden = true;
      this.dialogueState = null;
    }
    return values;
  }

  presentNode(node) {
    const p = this.game.player;
    const vars = p ? { name: p.name, title: p.title, rank: p.rank.title, ajah: p.ajahDef?.name ?? '' } : {};
    const text = fillTemplate(node.text ?? '', vars);
    this.el.dialogue.dataset.tone = node.tone ?? 'speech';
    this.el.dialogueSpeaker.textContent = fillTemplate(node.speaker ?? '', vars);
    this.el.dialogueText.textContent = '';
    this.el.dialogueChoices.replaceChildren();
    return new Promise((resolve) => {
      const state = { node, text, shown: 0, done: false, resolve, choices: node.choices ?? [] };
      this.dialogueState = state;
      if (state.choices.length) {
        state.choices.forEach((choice, i) => {
          this.el.dialogueChoices.append(
            h('button', { type: 'button', class: 'choice', onClick: () => this.pickChoice(i) },
              h('kbd', { text: String(i + 1) }),
              h('span', { class: 'choice__label', text: fillTemplate(choice.label, vars) }),
              choice.detail ? h('span', { class: 'choice__detail', text: choice.detail }) : null),
          );
        });
        this.el.dialogueHint.textContent = 'Choose with 1-' + state.choices.length + ' or click';
      } else {
        this.el.dialogueHint.textContent = 'Enter / Space / click to continue';
      }
      if (this.reducedMotion) this.finishReveal();
      else this.tickReveal(state);
    });
  }

  tickReveal(state) {
    const step = () => {
      if (this.dialogueState !== state || state.done) return;
      state.shown = Math.min(state.text.length, state.shown + 2);
      this.el.dialogueText.textContent = state.text.slice(0, state.shown);
      if (state.shown >= state.text.length) {
        state.done = true;
        return;
      }
      setTimeout(step, 22);
    };
    step();
  }

  finishReveal() {
    const state = this.dialogueState;
    if (!state) return;
    state.done = true;
    state.shown = state.text.length;
    this.el.dialogueText.textContent = state.text;
  }

  advanceDialogue() {
    const state = this.dialogueState;
    if (!state) return;
    if (!state.done) {
      this.finishReveal();
      return;
    }
    if (state.choices.length) return;
    this.dialogueState = null;
    state.resolve(undefined);
  }

  pickChoice(index) {
    const state = this.dialogueState;
    if (!state || !state.choices[index]) return;
    this.dialogueState = null;
    state.resolve(state.choices[index].value);
  }

  /** Keyboard routing for overlays. Returns true when the key was consumed. */
  handleKey(e) {
    if (this.dialogueOpen) {
      if (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') {
        if (!e.target.closest?.('button')) this.advanceDialogue();
        else if (!this.dialogueState?.done) this.finishReveal();
        else return false;
        e.preventDefault();
        return true;
      }
      const digit = /^Digit([1-9])$/.exec(e.code) ?? /^Numpad([1-9])$/.exec(e.code);
      if (digit) {
        e.preventDefault();
        if (this.dialogueState && !this.dialogueState.done) this.finishReveal();
        this.pickChoice(Number(digit[1]) - 1);
        return true;
      }
      return true;
    }
    if (!this.screens.help.hidden && e.code === 'Escape') {
      $('btn-help-close').click();
      return true;
    }
    return false;
  }

  // -- Ajah selection --------------------------------------------------------------

  chooseAjah(player) {
    return new Promise((resolve) => {
      const grid = this.el.ajahGrid;
      grid.replaceChildren();
      for (const id of AJAH_ORDER) {
        const a = AJAHS[id];
        const mastery = WEAVES[a.mastery.weave];
        const preview = Object.entries(a.statTemplate).map(([k, v]) => `${STAT_INFO[k].label} ${v > 0 ? '+' : ''}${v} → ${Math.max(1, player.stats[k] + v)}`);
        grid.append(
          h('article', { class: 'ajah-card', style: { '--accent': a.color } },
            h('header', {},
              h('h3', { text: `${a.name} Ajah` }),
              h('p', { class: 'ajah-card__epithet', text: `${a.epithet} · ${a.archetype}` })),
            h('p', { class: 'ajah-card__creed', text: a.creed }),
            h('h4', { text: 'Core buffs' }),
            h('ul', {}, a.buffs.map((b) => h('li', { text: b }))),
            h('h4', { text: `Passive: ${a.passive.name}` }),
            h('p', { text: a.passive.description }),
            h('h4', { text: `Mastery Weave: ${mastery.name}` }),
            h('p', { class: 'recipe-line' }, recipeChips(mastery.recipe), h('span', { text: ` ${mastery.description}` })),
            h('h4', { text: 'Over-channeling' }),
            h('p', { text: `Strained ${a.danger.strained} · Volatile ${a.danger.volatile} · Critical ${a.danger.critical} · Burnout ${a.danger.max}. ${a.dangerNote}` }),
            h('h4', { text: 'Your stats would become' }),
            h('p', { class: 'ajah-card__stats', text: preview.join(' · ') }),
            h('button', {
              type: 'button',
              class: 'btn btn--primary',
              onClick: () => {
                this.hideScreens();
                resolve(id);
              },
            }, `Choose the ${a.name}`)),
        );
      }
      this.showScreen('ajah');
    });
  }

  // -- hub ---------------------------------------------------------------------------

  renderHub() {
    const g = this.game;
    const p = g.player;
    if (!p) return;
    const ajah = p.ajahDef;
    this.el.hubHeader.replaceChildren(
      h('div', { class: 'hub-identity', style: { '--accent': ajah?.color ?? '#e8e2d0' } },
        h('h2', { text: p.name }),
        h('p', { class: 'hub-title', text: p.title }),
        h('p', { class: 'hub-sub', text: `Level ${p.level} · ${p.xp}/${p.xpToNext} XP · ${p.prestige} prestige · ${AFFINITIES[p.affinity].label} affinity` })),
      h('div', { class: 'hub-pips' },
        h('p', {}, h('span', { text: 'Tower\'s patience ' }), h('span', { class: 'pips pips--strikes', text: `${'●'.repeat(p.strikes)}${'○'.repeat(Math.max(0, Player.MAX_STRIKES - p.strikes))}` })),
        h('p', {}, h('span', { text: 'Saidar burns ' }), h('span', { class: 'pips pips--burnouts', text: `${'●'.repeat(p.burnouts)}${'○'.repeat(Math.max(0, Player.MAX_BURNOUTS - p.burnouts))}` })),
        h('button', { type: 'button', class: 'btn btn--ghost', 'data-action': 'help', onClick: () => { this.returnScreen = 'hub'; this.showScreen('help'); } }, 'How to play')),
      this.weekBar(),
    );
    const tabs = [['missions', 'Missions'], ['tower', p.politics?.pending.length ? `Tower (${p.politics.pending.length})` : 'Tower'], ['initiate', p.statPoints ? `Initiate (${p.statPoints})` : 'Initiate'], ['weaves', 'Weaves'], ['chronicle', 'Chronicle']];
    if (p.canUseArtifacts) tabs.splice(3, 0, ['artifacts', 'Ter\'angreal']);
    if (!tabs.some(([id]) => id === this.hubTab)) this.hubTab = 'missions';
    this.el.hubTabs.replaceChildren(
      ...tabs.map(([id, label]) =>
        h('button', {
          type: 'button',
          role: 'tab',
          class: `tab${this.hubTab === id ? ' tab--active' : ''}`,
          'aria-selected': String(this.hubTab === id),
          onClick: () => {
            this.hubTab = id;
            this.renderHub();
          },
        }, label)),
    );
    const body = { missions: () => this.hubMissions(), tower: () => this.hubTower(), initiate: () => this.hubInitiate(), weaves: () => this.hubWeaves(), artifacts: () => this.hubArtifacts(), chronicle: () => this.hubChronicle() }[this.hubTab]();
    this.el.hubBody.replaceChildren(body);
  }

  hubMissions() {
    const g = this.game;
    const wrap = h('div', { class: 'hub-missions' });
    const promo = g.missions.nextPromotion();
    if (promo) {
      wrap.append(
        h('section', { class: 'promotion' },
          h('h3', { text: `Path to ${promo.next.title}` }),
          h('p', { text: `${promo.trial.title}: ${promo.state === 'available' ? 'the trial awaits you.' : 'what still stands in your way:'}` }),
          h('ul', { class: 'checklist' }, promo.checklist.map((item) => h('li', { class: item.met ? 'checklist__item--met' : 'checklist__item--open' }, h('span', { 'aria-hidden': 'true', text: item.met ? '✓ ' : '○ ' }), item.label))),
          h('p', { class: 'muted', text: 'Every week you end grants XP and prestige from your studies. Patrols and the Tower Halls fill in the rest.' })),
      );
    } else if (g.player.ajahDef) {
      const a = g.player.ajahDef;
      wrap.append(h('section', { class: 'promotion', style: { '--accent': a.color } }, h('h3', { text: `${a.name} Ajah: ${a.archetype}` }), h('p', { text: a.passive.description })));
    }
    const board = g.assignments.board();
    if (board.length) {
      const pol = g.player.politics;
      wrap.append(h('h3', { class: 'chapter', text: `Assignments abroad · week ${pol.week}` }));
      const list = h('div', { class: 'mission-list' });
      for (const a of board) {
        const d = g.assignments.describe(a);
        const nation = NATIONS[a.nation];
        const canGo = !a.done && pol.actions > 0 && !pol.coup?.pending;
        list.append(
          h('article', { class: `mission-card mission-card--${a.done ? 'completed' : canGo ? 'available' : 'locked'}${a.ajahTask ? ' mission-card--ajah' : ''}`, style: a.ajahTask && g.player.ajahDef ? { '--accent': g.player.ajahDef.color } : {} },
            h('header', {},
              h('h4', { text: d.title }),
              h('span', { class: 'tag tag--combat', text: '◆'.repeat(a.difficulty) })),
            a.ajahTask ? h('p', { class: 'mission-card__ajah', text: `★ Sent by the head of the ${g.player.ajahDef.name} Ajah` }) : null,
            h('p', { text: d.summary }),
            h('p', { class: 'mission-card__rewards', text: `1 action · ${d.rewards.xp} XP · ${d.rewards.prestige} prestige · ${nation.name}'s regard ${pol.nations?.[a.nation] ?? 50}` }),
            h('p', { class: 'mission-card__state', text: a.done ? 'Done this week' : `${d.roads}. ${canGo ? '' : pol.actions <= 0 ? 'No actions left this week.' : ''}` }),
            canGo ? h('button', { type: 'button', class: 'btn btn--primary', onClick: () => g.startAssignment(a.key) }, 'Set out') : null),
        );
      }
      wrap.append(list, h('p', { class: 'muted', text: 'A new set of assignments is posted every week. Roads between the Tower and the kingdoms are rarely quiet.' }));
    }
    const groups = new Map([['The White Tower', []]]);
    for (const entry of g.missions.catalog()) {
      if (!groups.has(entry.def.chapter)) groups.set(entry.def.chapter, []);
      groups.get(entry.def.chapter).push(entry);
    }
    for (const [chapter, entries] of groups) {
      if (!entries.length) continue;
      wrap.append(h('h3', { class: 'chapter', text: chapter === 'Any' ? 'Standing Duties' : chapter }));
      const list = h('div', { class: 'mission-list' });
      for (const { def, state, reason, outcome } of entries) {
        const count = g.player.counts[def.id] ?? 0;
        list.append(
          h('article', { class: `mission-card mission-card--${state}` },
            h('header', {},
              h('h4', { text: def.title }),
              h('span', { class: `tag tag--${def.type}`, text: TYPE_LABELS[def.type] ?? def.type })),
            h('p', { text: def.summary }),
            h('p', { class: 'mission-card__rewards', text: `${def.free ? 'No action needed' : '1 action'} · ${def.quiet ? 'Tower politics' : g.missions.rewardsPreview(def)}` }),
            h('p', { class: 'mission-card__state', text: state === 'available' ? (outcome === 'failed' ? 'Failed before. You may try again.' : def.repeatable && count ? `Completed ${count} time${count > 1 ? 's' : ''}` : 'Available') : reason }),
            state === 'available'
              ? h('button', { type: 'button', class: 'btn btn--primary', onClick: () => g.startMission(def.id) }, def.type === 'trial' ? 'Face the trial' : 'Undertake')
              : null),
        );
      }
      wrap.append(list);
    }
    return wrap;
  }

  setAbandonLabel(safe) {
    $('btn-abandon').textContent = safe ? 'Leave the halls' : 'Abandon mission (counts as failure)';
  }

  weekBar() {
    const g = this.game;
    const pol = g.player.politics;
    if (!pol) return null;
    const pips = `${'●'.repeat(pol.actions)}${'○'.repeat(Math.max(0, actionsPerWeek(g.player) - pol.actions))}`;
    const waiting = pol.pending.length;
    return h('div', { class: 'week-bar' },
      h('span', { class: 'week-bar__week', text: `Week ${pol.week}` }),
      h('span', { class: 'week-bar__actions', title: 'Each mission (other than the Tower Halls) uses one action' }, 'Actions ', h('span', { class: 'pips', text: pips })),
      pol.penance > 0 ? h('span', { class: 'chip chip--danger', text: 'Punishment detail' }) : null,
      waiting ? h('span', { class: 'chip chip--artifact', text: `${waiting} sister${waiting > 1 ? 's' : ''} seek${waiting > 1 ? '' : 's'} a word in the halls` }) : null,
      h('button', { type: 'button', class: 'btn btn--primary btn--small', onClick: () => g.endWeek() }, 'End the week'));
  }

  hubTower() {
    const g = this.game;
    const p = g.player;
    const tp = g.politics;
    const pol = tp.pol;
    const wrap = h('div', { class: 'hub-initiate' });
    const meter = (label, value, max, tone, note, accent) =>
      h('div', { class: 'meter-row' },
        h('div', { class: 'meter-row__head' }, h('span', { text: label }), h('span', { class: 'meter-row__value', text: `${Math.round(value)} / ${max}` })),
        h('div', { class: `meter meter--${tone}`, style: { '--fill': clamp(value / max, 0, 1).toFixed(3), ...(accent ? { '--accent': accent } : {}) } }, h('div', { class: 'meter__fill' })),
        note ? h('p', { class: 'muted', text: note }) : null);

    wrap.append(h('section', { class: 'panel' },
      h('h3', { text: 'The state of the Tower' }),
      meter('Tower Stability', pol.stability, 100, pol.stability < 25 ? 'critical' : pol.stability < 50 ? 'warn' : 'good', pol.conspiracy?.active ? 'A conspiracy erodes it every week. At zero, the Tower breaks and the coup begins.' : 'Calm, for now.'),
      meter('Your Tower Conflict', pol.conflict, 100, pol.conflict > 70 ? 'critical' : 'warn', 'Defying sisters who outrank you raises it. At 100 you are given a punishment detail.'),
      p.rankIndex === 2 && p.ajahDef ? meter(`Favor with the ${p.ajahDef.name} Ajah`, pol.standing, 100, 'ajah', 'Earned by backing your Ajah and running its head\'s errands; spent to win elections.', p.ajahDef.color) : null,
      pol.faction === 'double' ? meter('Conspirators\' suspicion', pol.suspicion, 100, 'critical', 'Too high, and they will test your loyalty.') : null,
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn btn--primary', onClick: () => g.startMission('tower_halls'), disabled: pol.coup?.pending }, 'Walk the Tower halls'),
        tp.canPresentEvidence ? h('button', { type: 'button', class: 'btn btn--danger', onClick: () => g.presentEvidence() }, 'Present evidence to the Amyrlin') : null)));

    const order = AJAH_ORDER.slice().sort((a, b) => pol.influence[b] - pol.influence[a]);
    wrap.append(h('section', { class: 'panel' },
      h('h3', { text: 'Ajah influence in the Hall' }),
      ...order.map((a) => h('div', { class: 'influence-row' },
        h('span', { text: `${AJAHS[a].name}${a === p.ajah ? ' (yours)' : ''}${a === pol.conspiracy?.ajah && pol.conspiracy.active ? ' ⚑' : ''}` }),
        h('div', { class: 'meter meter--ajah', style: { '--fill': (pol.influence[a] / 100).toFixed(3), '--accent': AJAHS[a].color } }, h('div', { class: 'meter__fill' })),
        h('span', { class: 'meter-row__value', text: String(pol.influence[a]) })))));

    const cons = h('section', { class: 'panel' }, h('h3', { text: 'The conspiracy' }));
    const leader = tp.sisterById(pol.conspiracy?.leaderId);
    const lines = [];
    if (p.rankIndex < 2) lines.push('The Hall\'s factions take no notice of novices and Accepted. That changes the day you take the shawl.');
    else if (p.flags.amyrlin) lines.push('You hold the stole. Every sister in the Tower must defer to you, and every one of them is watching for the first crack.');
    else if (pol.coup?.done && !pol.conspiracy?.active) lines.push(`The coup is over. ${tp.label(tp.sisterById(pol.amyrlinId))} holds the stole.`);
    else if (!pol.conspiracy) lines.push('No conspiracy stirs that you know of. Give it time; there is always one.');
    else if (pol.conspiracy.crushed) lines.push('The last conspiracy was crushed. Its leaders are confined to their rooms.');
    else if (!pol.conspiracy.approached) lines.push(`Rumours say the ${AJAHS[pol.conspiracy.ajah].name} Ajah is gathering Sitters. Someone will approach you soon.`);
    else if (pol.faction === 'conspirator') lines.push(`You are sworn to ${leader?.name}'s conspiracy. Covert missions drive Stability down; when it reaches zero, the coup begins. If the coup fails, you will be stilled.`);
    else if (pol.faction === 'double') lines.push(`You are a double agent inside ${leader?.name}'s conspiracy. In each covert mission you may fake the act and keep evidence instead.`);
    else lines.push(`You refused ${leader?.name}. Gather leverage by shadowing the conspirators before Stability collapses.`);
    if (pol.conspiracy?.active && pol.conspiracy.approached && pol.faction !== 'conspirator') lines.push(`Leverage gathered: ${pol.leverage} of 3 needed to bring her before the Amyrlin.`);
    for (const line of lines) cons.append(h('p', { text: line }));
    wrap.append(cons);

    const table = h('table', { class: 'roster' },
      h('thead', {}, h('tr', {}, ...['Sister', 'Ajah', 'Strength', 'Precedence', 'Regard'].map((t) => h('th', { text: t })))),
      h('tbody', {}, pol.sisters.filter((s) => s.status === 'active').sort((a, b) => b.strength - a.strength).map((s) => {
        const rel = tp.compare(s);
        return h('tr', {},
          h('td', { text: s.role === 'amyrlin' ? `${s.name} (Amyrlin)` : s.role === 'head' ? `${s.name} (head)` : s.name }),
          h('td', {}, h('span', { class: 'ajah-dot', style: { '--accent': AJAHS[s.ajah].color } }), AJAHS[s.ajah].name),
          h('td', { class: 'num', text: String(s.strength) }),
          h('td', { class: `rel rel--${rel}`, text: rel === 'above' ? 'Defers to you' : rel === 'below' ? 'You defer' : 'Equals' }),
          h('td', { class: 'num', text: s.disposition >= 65 ? 'Warm' : s.disposition <= 35 ? 'Cold' : 'Neutral' }));
      })));
    wrap.append(h('section', { class: 'panel panel--wide' }, h('h3', { text: `Notable sisters · your Strength ${p.stats.strength}` }), h('div', { class: 'table-scroll' }, table)));

    if (p.rankIndex === 2) {
      wrap.append(h('section', { class: 'panel' },
        h('h3', { text: 'Novices in the garden' }),
        h('ul', {}, pol.novices.map((n) => h('li', { text: `${n.name}: ${n.talent}, potential ${n.potential}${n.sponsor ? ` · sponsored by the ${AJAHS[n.sponsor].name}` : ''}` }))),
        h('p', { class: 'muted', text: 'Sponsor one novice a week in the Tower Halls garden to grow your Ajah\'s influence.' })));
    }
    if (p.rankIndex === 2) wrap.append(...this.ascensionPanels());
    const reach = h('section', { class: 'panel' }, h('h3', { text: 'The Tower\'s reach: the nations\' regard' }));
    for (const [id, n] of Object.entries(NATIONS).sort((a, b) => (pol.nations?.[b[0]] ?? 50) - (pol.nations?.[a[0]] ?? 50))) {
      const v = pol.nations?.[id] ?? 50;
      reach.append(h('div', { class: 'influence-row' }, h('span', { text: n.name }), h('div', { class: `meter meter--${v >= 60 ? 'good' : v <= 35 ? 'critical' : 'warn'}`, style: { '--fill': (v / 100).toFixed(3) } }, h('div', { class: 'meter__fill' })), h('span', { class: 'meter-row__value', text: String(v) })));
    }
    wrap.append(reach);
    const log = h('section', { class: 'panel' }, h('h3', { text: 'Corridor whispers' }));
    const recent = pol.log.slice(-10).reverse();
    if (!recent.length) log.append(h('p', { class: 'muted', text: 'Nothing yet. Walk the halls, or end the week.' }));
    for (const entry of recent) log.append(h('p', { class: `log-entry log-entry--${entry.tone}` }, h('span', { class: 'muted', text: `Week ${entry.week}: ` }), entry.text));
    wrap.append(log);
    return wrap;
  }

  /** The three-phase climb: standalone sister → Sitter → Amyrlin Seat. */
  ascensionPanels() {
    const g = this.game;
    const p = g.player;
    const asc = g.ascension;
    const tp = g.politics;
    const pol = tp.pol;
    const office = asc.office;
    const checklist = (items) => h('ul', { class: 'checklist' }, items.map((item) => h('li', { class: item.met ? 'checklist__item--met' : 'checklist__item--open' }, h('span', { 'aria-hidden': 'true', text: item.met ? '✓ ' : '○ ' }), item.label)));
    const act = (fn) => () => g.hubAction(fn);
    const panels = [];

    const phases = [['sister', 'Aes Sedai', 'Build prestige, favor and strength'], ['sitter', 'Sitter', 'Force a vacancy, win the vote, lead a coalition'], ['amyrlin', 'Amyrlin Seat', 'Unite the Hall, rule the nations']];
    panels.push(h('section', { class: 'panel panel--wide' },
      h('h3', { text: 'The ascension' }),
      h('ol', { class: 'roadmap' }, phases.map(([id, name, note]) => h('li', { class: `roadmap__step${id === office ? ' roadmap__step--current' : ''}` }, h('strong', { text: name }), h('span', { class: 'muted', text: note }))))));

    if (office === 'sister') {
      const panel = h('section', { class: 'panel' }, h('h3', { text: 'Phase I: a chair in the Hall' }),
        h('p', { text: `Each Ajah's chairs in the Hall are all filled. To sit, you must first empty one, then win your Ajah's vote by spending favor.` }),
        checklist(asc.campaignChecklist()));
      if (asc.electionCooldown) panel.append(h('p', { class: 'muted', text: `You lost the last election. Try again in ${asc.electionCooldown} week${asc.electionCooldown > 1 ? 's' : ''}.` }));
      const inc = asc.incumbent();
      if (asc.campaignOpen && inc) {
        panel.append(h('p', {}, h('strong', { text: 'The incumbent: ' }), `${inc.name}, Strength ${inc.strength}.`));
        for (const opt of asc.vacancyOptions()) {
          panel.append(h('div', { class: 'option-row' },
            h('div', {}, h('strong', { text: opt.label }), h('p', { class: 'muted', text: opt.reason ? `${opt.detail} · ${opt.reason}` : opt.detail })),
            h('button', { type: 'button', class: 'btn btn--small', disabled: !!opt.reason, onClick: act(() => asc.forceVacancy(opt.id)) }, 'Act')));
        }
      }
      panels.push(panel);
    }

    if (office === 'sitter') {
      const coalition = h('section', { class: 'panel' }, h('h3', { text: `Phase II: your coalition (${pol.coalition.length} of 7 Ajahs)` }),
        h('p', { class: 'muted', text: 'With four Ajahs behind you, your vote carries the Hall and can block the Amyrlin\'s decrees. Vote against an ally\'s motion and she leaves you.' }));
      for (const ajah of AJAH_ORDER) {
        const inIt = pol.coalition.includes(ajah);
        coalition.append(h('div', { class: 'option-row' },
          h('div', {}, h('span', { class: 'ajah-dot', style: { '--accent': AJAHS[ajah].color } }), h('strong', { text: AJAHS[ajah].name }), h('span', { class: 'muted', text: inIt ? (ajah === p.ajah ? ' · your Ajah' : ' · allied') : ` · ${asc.allianceChance(ajah)}% to win over` })),
          inIt ? null : h('button', { type: 'button', class: 'btn btn--small', disabled: pol.actions <= 0, onClick: act(() => asc.seekAlliance(ajah)) }, 'Seek alliance')));
      }
      panels.push(coalition);
      panels.push(h('section', { class: 'panel' }, h('h3', { text: 'Phase III: the soft coup' }),
        h('p', { text: 'When the Amyrlin is weak, a united Hall can strip her of the stole and raise you in her place. (Or back a conspiracy and take it by force.)' }),
        checklist(asc.softCoupChecklist()),
        h('button', { type: 'button', class: 'btn btn--danger', disabled: !asc.canDepose, onClick: act(() => asc.deposeAmyrlin()) }, 'Call the Hall to depose the Amyrlin (1 action)')));
    }

    if (office === 'sitter' || office === 'amyrlin') {
      const treasury = h('section', { class: 'panel' }, h('h3', { text: `Tower gold: ${pol.gold}` }),
        h('p', { class: 'muted', text: `+${asc.weeklyGold()} every week. Fund projects that serve you.` }));
      for (const pr of asc.projectsFor()) {
        treasury.append(h('div', { class: 'option-row' },
          h('div', {}, h('strong', { text: `${pr.name} (${pr.cost})` }), h('p', { class: 'muted', text: pr.count && !pr.repeatable ? `${pr.description} Funded.` : pr.description })),
          h('button', { type: 'button', class: 'btn btn--small', disabled: pr.maxed || !pr.affordable, onClick: () => { asc.fund(pr.id); this.renderHub(); } }, pr.maxed ? 'Done' : 'Fund')));
      }
      panels.push(treasury);
    }

    if (office === 'amyrlin') {
      const used = asc.forcesDeployed();
      const avail = asc.forcesAvailable();
      const study = h('section', { class: 'panel panel--wide' }, h('h3', { text: `The Amyrlin's study: forces deployed ${used} of ${avail}` }),
        h('p', { class: 'muted', text: `Each force lowers a nation's threat by 18 every week. Threats rise every week, fastest in the Borderlands. At 80 a nation falls into crisis: its regard and the Tower's stability suffer. The gravest crisis also appears on your assignment board.` }));
      const table = h('div', { class: 'threat-grid' });
      for (const id of Object.keys(NATIONS).sort((a, b) => (pol.threats[b] ?? 0) - (pol.threats[a] ?? 0))) {
        const threat = pol.threats[id] ?? 0;
        const n = pol.forces[id] ?? 0;
        table.append(h('div', { class: 'threat-row' },
          h('span', { text: NATIONS[id].name }),
          h('div', { class: `meter meter--${threat >= 60 ? 'critical' : threat >= 40 ? 'warn' : 'good'}`, style: { '--fill': (threat / 100).toFixed(3) } }, h('div', { class: 'meter__fill' })),
          h('span', { class: 'meter-row__value', text: `${threat}` }),
          h('button', { type: 'button', class: 'btn btn--small', 'aria-label': `Withdraw a force from ${NATIONS[id].name}`, disabled: n <= 0, onClick: () => { asc.deploy(id, -1); g.save(); this.renderHub(); } }, '−'),
          h('span', { class: 'meter-row__value', text: String(n) }),
          h('button', { type: 'button', class: 'btn btn--small', 'aria-label': `Send a force to ${NATIONS[id].name}`, disabled: used >= avail, onClick: () => { asc.deploy(id, 1); g.save(); this.renderHub(); } }, '+')));
      }
      study.append(table);
      panels.push(study);
    }
    return panels;
  }

  hubInitiate() {
    const g = this.game;
    const p = g.player;
    const wrap = h('div', { class: 'hub-initiate' });
    const stats = h('section', { class: 'panel' }, h('h3', { text: `Core stats${p.statPoints ? ` · ${p.statPoints} point${p.statPoints > 1 ? 's' : ''} to spend` : ''}` }));
    for (const id of STAT_IDS) {
      const cap = p.statCap(id);
      stats.append(
        h('div', { class: 'stat-row' },
          h('div', {}, h('strong', { text: STAT_INFO[id].label }), h('p', { class: 'muted', text: STAT_INFO[id].description })),
          h('span', { class: 'stat-value', text: p.stats[id] > cap ? `${p.stats[id]} (cap ${cap})` : `${p.stats[id]} / ${cap}` }),
          h('button', {
            type: 'button',
            class: 'btn btn--small',
            disabled: !p.canRaise(id),
            'aria-label': `Raise ${STAT_INFO[id].label}`,
            onClick: () => {
              if (p.raise(id)) {
                g.save();
                this.renderHub();
              }
            },
          }, '+')),
      );
    }
    stats.append(h('p', { class: 'muted', text: `Potential ${p.potential}: your Strength can never exceed it. Rank caps all stats at ${p.rank.statCap}.` }));
    const derived = h('section', { class: 'panel' },
      h('h3', { text: 'In the field' }),
      h('dl', { class: 'derived' },
        ...[
          ['Max health', p.maxHealth],
          ['One Power', p.maxPower],
          ['Power recovery', `${p.powerRegen.toFixed(1)}/s`],
          ['Weave potency', `x${p.potency([]).toFixed(2)}`],
          ['Strain shed by control', `${Math.round(p.strainResist([]) * 100)}%`],
          ['Danger recovery', `${p.dangerDecay.toFixed(1)}/s`],
          ['Burnout threshold', p.dangerProfile.max],
          ['Persuasion', `${p.persuasionChance}%`],
          ['Critical chance', `${Math.round(p.critChance * 100)}%`],
        ].flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: String(v) })])),
    );
    const a = p.ajahDef;
    const ajahPanel = h('section', { class: 'panel', style: a ? { '--accent': a.color } : {} });
    if (a) {
      ajahPanel.append(
        h('h3', { text: `${a.name} Ajah: ${a.archetype}` }),
        h('ul', {}, a.buffs.map((b) => h('li', { text: b }))),
        h('p', {}, h('strong', { text: `${a.passive.name}: ` }), a.passive.description),
        h('p', {}, h('strong', { text: `Mastery: ${WEAVES[a.mastery.weave].name} ` }), recipeChips(WEAVES[a.mastery.weave].recipe)),
        h('p', { class: 'muted', text: a.dangerNote }),
      );
      if (a.modifiers.maxWarders) {
        ajahPanel.append(h('h4', { text: 'Bonded Warders' }), h('ul', {}, p.warders.map((w) => h('li', { class: w.alive ? '' : 'muted', text: `${w.name}${w.alive ? '' : ' (dead)'}` }))));
      }
    } else {
      ajahPanel.append(h('h3', { text: 'Ajah' }), h('p', { text: 'You will choose your Ajah when you pass the test for the shawl. The choice reshapes your stats, your passive talents and your Mastery Weave, forever.' }));
    }
    ajahPanel.append(h('p', {}, h('strong', { text: 'Three Oaths: ' }), p.oathsSworn ? 'Sworn. You cannot harm humans with the Power unless your life is in danger (health below 40%).' : 'Not yet sworn. Advanced weaves remain sealed.'));
    const scars = h('section', { class: 'panel' }, h('h3', { text: 'Scars' }));
    if (!p.scars.length) scars.append(h('p', { class: 'muted', text: 'None, yet.' }));
    for (const s of p.scars) {
      scars.append(h('div', { class: `scar scar--${s.kind}` }, h('strong', { text: s.label }), h('span', { class: 'tag', text: s.kind }), h('p', { text: s.description })));
    }
    if (p.scars.some((s) => s.kind === 'injury')) scars.append(h('p', { class: 'muted', text: 'Injuries can be erased by a Yellow sister\'s True Healing.' }));
    wrap.append(stats, derived, ajahPanel, scars);
    return wrap;
  }

  hubWeaves() {
    const p = this.game.player;
    const wrap = h('div', { class: 'weave-grid' });
    for (const weave of Object.values(WEAVES)) {
      if (weave.hidden && !p.knows(weave.id)) continue;
      if (weave.mastery && weave.requires.ajah !== p.ajah) continue;
      const a = this.game.weaver.assess(weave);
      let status;
      if (a.status === 'unknown') status = 'Not yet taught';
      else if (a.status === 'locked') status = a.reason;
      else if (weave.tier > p.rank.tier) status = `Known, but beyond a ${p.rank.title}: strain x${(1 + (weave.tier - p.rank.tier) * 1.6).toFixed(1)}`;
      else if (p.stats.strength < weave.minStrength) status = `Known; below Strength ${weave.minStrength} it strains you more`;
      else status = 'Mastered';
      wrap.append(
        h('article', { class: `weave-card weave-card--${a.status === 'unknown' ? 'unknown' : a.status === 'locked' ? 'locked' : 'known'}${weave.forbidden ? ' weave-card--forbidden' : ''}` },
          h('header', {}, h('h4', { text: weave.name }), h('span', { class: 'tag', text: weaveTierLabel(weave) })),
          h('p', { class: 'recipe-line' }, recipeChips(weave.recipe)),
          h('p', { text: weave.description }),
          h('p', { class: 'muted', text: `Cost ${weave.cost} · Strain ${weave.strain} · Settles ${weave.cooldown}s` }),
          h('p', { class: 'weave-card__status', text: status })),
      );
    }
    return wrap;
  }

  hubArtifacts() {
    const g = this.game;
    const p = g.player;
    const wrap = h('div', { class: 'weave-grid' });
    if (!p.artifacts.length) wrap.append(h('p', { class: 'muted', text: 'You hold no ter\'angreal yet. Search ruins and forgotten places.' }));
    for (const id of p.artifacts) {
      const art = TER_ANGREAL[id];
      if (!art) continue;
      const equipped = p.equippedArtifact === id;
      wrap.append(
        h('article', { class: `weave-card${equipped ? ' weave-card--equipped' : ''}` },
          h('header', {}, h('h4', { text: art.name }), h('span', { class: 'tag', text: `${art.cooldown}s` })),
          h('p', { text: art.description }),
          h('button', {
            type: 'button',
            class: 'btn btn--small',
            disabled: equipped,
            onClick: () => {
              p.equippedArtifact = id;
              g.save();
              this.renderHub();
            },
          }, equipped ? 'Equipped (R)' : 'Equip')),
      );
    }
    return wrap;
  }

  hubChronicle() {
    const p = this.game.player;
    const list = h('ol', { class: 'chronicle', reversed: true });
    for (const entry of p.chronicle.slice().reverse()) {
      list.append(h('li', { class: `chronicle__entry chronicle__entry--${entry.tone}` }, h('span', { class: 'muted', text: `${entry.rank}, level ${entry.level}: ` }), entry.text));
    }
    if (!p.chronicle.length) list.append(h('li', { class: 'muted', text: 'Your story has not yet begun.' }));
    return list;
  }

  // -- endings -------------------------------------------------------------------------

  showGameOver(kind, player) {
    const ending = ENDINGS[kind] ?? ENDINGS.expelled;
    this.el.gameoverTitle.textContent = ending.title;
    this.el.gameoverText.textContent = ending.text;
    const items = (player?.chronicle ?? []).slice(-8).map((c) => h('li', { text: c.text }));
    this.el.gameoverChronicle.replaceChildren(...items);
    this.showScreen('gameover');
  }
}

function recipeChips(recipe) {
  return h('span', { class: 'recipe' }, recipe.map((id) => h('span', { class: 'recipe__chip', style: { '--accent': ELEMENT_BY_ID[id].color }, text: ELEMENT_BY_ID[id].name })));
}
