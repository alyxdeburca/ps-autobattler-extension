# PS Auto-Battler Extension

Chrome extension (Manifest V3) that brings [ps-autobattler](https://github.com/alyxdeburca/ps-autobattler)
onto [play.pokemonshowdown.com](https://play.pokemonshowdown.com) as a **live
battle advisor** with an optional **autoplay** mode.

The page's Showdown client already parses the whole battle — request JSON,
tracked pokemon, revealed foe moves — so this extension *reuses* that state
via a MAIN-world bridge and only adds a brain: the same heuristic decision
core that wins ~69% headless vs. random AI.

## Features

- **Live suggestion panel** — every turn, ranks your legal moves by expected
  damage (type chart incl. immunities, STAB, burn, accuracy) plus status /
  setup / switch scoring; shows estimated dmg % per move.
- **Switch analysis** — bench options scored by matchup (defensive typing vs
  foe + offensive potential), so pivots are suggested when they're genuinely
  better.
- **Autoplay (opt-in)** — checkbox makes the bot click the real UI buttons
  for the top choice each turn. Off by default.
- **Fair play by construction** — reads only what any client sees; no engine
  simulation of hidden information, no server modification.

## Architecture

```
play.pokemonshowdown.com tab
├── MAIN world:      src/inject/inject-bridge.js   (copied to dist/)
│     • exposes battle.request JSON + foe view from the client's own objects
│     • relays UI-click commands (autoplay)
└── ISOLATED world:  dist/content-main.js          (esbuild bundle)
      • vendor/ps-autobattler/src/decision-core.js  ← submodule brain
      • src/data/minidex.js + minidex.json          ← compact game data
      • renders #psab-panel overlay; polls bridge at 700ms
```

Why not bundle the whole simulator? Battles aren't simulated here — the real
server runs them. Only decision math + game data are needed (~300 KB data +
~100 KB code), so MiniDex (generated from the engine's Dex at build time)
replaces it via `dexShim.setBackend()`.

## Build & install

```bash
# prerequisite: node >= 18
git clone --recurse-submodules https://github.com/alyxdeburca/ps-autobattler-extension
cd ps-autobattler-extension
npm install
npm run build          # -> dist/content-main.js (+ dist/inject-bridge.js)
npm test               # 4 checks over the exact bundled pipeline
```

Then in Chrome:

1. Open `chrome://extensions`, enable **Developer mode**
2. **Load unpacked** → select this folder
3. Open any battle on play.pokemonshowdown.com — the panel appears top-right

## Regenerating game data

After upstream Pokémon Showdown data changes:

```bash
node tools/generate-minidex.js gen9randombattle
# requires sibling checkout: ../pokemon-showdown (built)
```

## Status & limits (v0.1)

- Singles-focused; team preview sends default ordering; autoplay clicks the
  standard control bar selectors (best-effort against client markup changes).
- Advisor-only by default; autoplay is opt-in per session.
- No external permissions beyond the Showdown origin.

See [`vendor/ps-autobattler/docs`](vendor/ps-autobattler/docs/architecture.md)
for how the decision core works.

## Credits

- Decision core: [ps-autobattler](https://github.com/alyxdeburca/ps-autobattler) by **ox-alpha**.
- Pokémon Showdown client & engine © Smogon / Guangcong Luo (MIT).
- Unofficial fan tool, not affiliated with Nintendo / The Pokémon Company.

## License

[MIT](LICENSE)
