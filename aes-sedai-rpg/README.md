# The Wheel Weaves: Aes Sedai

A 2D top-down action RPG set in the Wheel of Time. You rise from a frightened Novice to a full Aes Sedai, weaving combinations of the Five Powers while a volatile over-channeling engine threatens to burn you out. It is written in plain HTML5 canvas and vanilla JavaScript ES modules. It has no dependencies and no external assets: every character, spell and tile is drawn from coloured geometric shapes.

## Run it

ES modules need to be served over HTTP (opening the file directly will not work). From this directory:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Any static server works, for example `npx http-server -p 8000 -c-1`.

## Controls

| Input | Action |
| --- | --- |
| `W A S D` / arrows | Move |
| `1`–`5` | Gather a thread: Earth, Fire, Air, Water, Spirit (up to three) |
| Left click | Release the weave toward the cursor |
| Right click | Repeat the last weave |
| `Backspace` / `Q` | Drop the last thread / clear the pattern |
| `Space` | Dash |
| `F` | Ajah ability (Green: command Warders · Gray: Compelling Voice) |
| `R` | Use the equipped ter'angreal (Brown) |
| `Esc` / `P` | Pause (abandoning a mission counts as failure) |

## Architecture

| File | Responsibility |
| --- | --- |
| `index.html` | Canvas plus the DOM overlay: HUD, minimap, dialogue box, title, creation, hub, Ajah selection, pause, help and game-over screens |
| `styles.css` | All presentation. Stat bars (health, One Power, XP) and the over-channel meter are driven by CSS custom properties (`--fill`, `data-state`, threshold ticks) that the UI sets |
| `game.js` | Entry point: state machine, fixed-step loop with per-subsystem error containment, input, camera, rendering, save/load, burnout and endings |
| `player.js` | `Player` progression (ranks, XP, stats, potential, scars, strikes, Oaths), the **Ajah class templates**, movement and serialization |
| `magic.js` | Weave database, thread to recipe resolution, Ajah Mastery overrides, the **over-channeling risk engine**, projectiles and areas, ter'angreal |
| `enemies.js` | Enemy types, A* pathfinding, `Navigator` steering, AI (melee, ranged channelers, guards with vision cones, Myrddraal shadow-step and dread, rifts) |
| `allies.js` | Green Ajah Warders (aggro-drawing companions), wounded civilians and defendable structures |
| `missions.js` | Mission engine (`MissionEngine` / `MissionRun`), map builders, every mission, parley and the Ajah / Three Oaths ceremony |
| `ui.js` | HUD updates, minimap with fog of war, dialogue queue, hub tabs, Ajah selection cards, toasts and rate-limited error notices |
| `world.js` | Tile maps, collision, line of sight, secret walls, fog of war, particle and screen-shake effects |
| `util.js` | Math helpers, seeded RNG, event bus, safe `localStorage` wrapper |

## Progression

1. **Novice.** *Shadow in the Gardens* opens the game: a Shadowspawn breach on your first day, fought with raw single-thread flows. *The Lesson Yard* teaches your first woven weaves. *The Three Arches* is the test for Accepted: three dialogue-driven visions, each followed by a phantom fight.
2. **Accepted.** *Breach at the Shining Walls* (seal Shadow rifts, find hidden ter'angreal) and *The Thirteenth Depository* (timed folio recovery, glyph-traps, Gray Men, and a choice about a forbidden balefire folio).
3. **Test for the Shawl.** Weave forty times under duress without letting the danger meter pass 90%. Then comes the **Ajah ceremony**: choose one of seven Ajahs on a dedicated screen and swear the **Three Oaths** on the Oath Rod. Refusing an Oath ends the game.
4. **Aes Sedai.** Each Ajah gets its own mid-game mission, followed by *The Eyeless Hunt* finale. *Patrol the Tower Grounds* is repeatable at every rank.

Advanced weaves (Sky Lightning, Earthquake, Delving, Gateway, Balefire) stay sealed until you have sworn the Oaths and reached the required Strength. After you swear, the Third Oath takes effect in play: your weaves cannot harm humans unless you are below 40% health. You bind, shield or pacify them and seize them by touch instead.

## Ajah class templates

Choosing an Ajah permanently applies a stat template, a passive mechanic, a Mastery Weave that replaces a base recipe, and its own over-channeling thresholds.

| Ajah | Archetype | Stat template | Passive | Mastery Weave | Burnout at |
| --- | --- | --- | --- | --- | --- |
| Green | Combat Mage | +2 Str, +3 Vit, −1 Ctl · +20% damage | **Multi-Warder Bond**: three AI Warders draw aggro; `F` toggles Guard / Engage; a Warder dies if left bleeding | Earth + Fire → *Blossom of Fire* (hits every visible foe) | 130 |
| Yellow | Healer / Support | +3 Res, +1 Ctl, −1 Str · +35% power regen, 1.5 HP/s | **True Healing**: heals self and allies, revives Warders, erases a permanent injury scar | Water + Spirit → *True Healing* | 100 |
| Red | Anti-Mage / Enforcer | +1 Str, +1 Ctl, −1 Vit · +15% speed, +60% shields | **Shielding / Severing**: exclusive Spirit + Spirit shield that cuts enemy channelers from the Source | Spirit + Spirit → *Shield of Severing* | 100 |
| Blue | Tactician / Spy Master | +1 Ctl, +1 Res · 20% crit (×2), wider vision | **Eyes and Ears**: minimap reveals the whole level, hidden foes, traps and secret routes | Air + Water → *Seeker Lances* (homing) | 100 |
| Brown | Scholar / Lore Master | +4 Res, −1 Vit · +25% XP, +1 Potential | **Ter'angreal Mastery**: attune and use artifacts found in ruins (`R`) | Earth + Earth → *Stone Sentinel* (turret) | 100 (wider safe band) |
| Gray | Diplomat / Crowd Control | +2 Ctl, +1 Vit, −1 Str · −20% damage taken, +40% persuasion | **Compelling Voice**: talk down mini-bosses in parley; `F` pacifies nearby mobs | Air + Air → *Accord of Stillness* | 100 |
| White | Glass Cannon / Logician | +3 Ctl, −2 Vit · −60% weave cost, −45% cooldowns, −20% max health | **Perfect Flow**: rapid-fire casting at the cost of defence | Fire + Air → *Lattice of Fire* | 100 (wider safe band) |

Ajah missions: Green *The Blightborder Stand* (defend a tower until dawn), Yellow *Fever at the Ferry* (heal dying refugees), Red *The Borderland Hunt* (three random rogue-lite stages, boons, capture a False Dragon), Blue *Whispers at the Sun Court* (stealth past vision-cone guards), Brown *Ruins of the Collam Daan* (traps, hollow walls, artifacts), Gray *The Broken Truce* (seize provocateurs, parley, keep tension below war), White *The Theorem of Shadows* (logic-sequence locks, then unmask a Black sister).

## Over-channeling

Every weave adds strain to the danger meter. Strain is multiplied when you weave **above your rank's tier**, **below a weave's Strength requirement**, while already Volatile, or when you overdraw an empty One Power pool (overdrawing also costs health). Control, your elemental affinity and some Ajahs reduce strain. Danger fades when you stop weaving, but a nearby Myrddraal's gaze halts recovery.

| State | Effect |
| --- | --- |
| Stable | Normal |
| Strained | One Power recovers 25% slower |
| Volatile | 20% chance per weave of backlash damage and a stagger; extra strain |
| Critical | 10% chance per weave of sudden burnout |
| Max | Burnout: permanent −1 Strength / −1 Reserve, 10 s cut off from the Source, heavy damage. A third burnout **stills** you (game over). |

## Stakes

- Failing a mission costs prestige and, for most missions, a **strike**. Some failures also leave permanent scars (stat losses). Three strikes and you are put out of the Tower.
- The opening mission cannot be retried. Failing it still advances the story, but you carry the scar.
- Progress autosaves. Reloading mid-mission counts as abandoning it. A game over erases the save.
