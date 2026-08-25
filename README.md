# PS Auto-Battler Extension

Chrome extension (Manifest V3) that brings [ps-autobattler](https://github.com/alyxdeburca/ps-autobattler)
onto [play.pokemonshowdown.com](https://play.pokemonshowdown.com) as a **live
battle advisor** with an optional **autoplay** mode.

The page's Showdown client already parses the whole battle — request JSON,
tracked pokemon, revealed foe moves — so this extension *reuses* that state
via a MAIN-world bridge and only adds a brain: the same heuristic decision
core that wins ~69% headless vs. random AI.

## Features

- **Toolbar-popup advisor** — click the extension icon on a battle tab to see
  your legal moves ranked by expected damage (type chart incl. immunities,
  STAB, burn, accuracy) plus status / setup / switch scoring, with estimated
  dmg % per move. No persistent in-page UI.
- **Switch analysis** — bench options scored by matchup (defensive typing vs
  foe + offensive potential), so pivots are suggested when they're genuinely
  better.
- **Autoplay (opt-in)** — tick the box inside the popup and the bot clicks the
  real UI buttons for the top choice each turn. Off by default; the popup
  stays open while it plays.
- **Fair play by construction** — reads only what any client sees; no engine
  simulation of hidden information, no server modification.

## Architecture

```
play.pokemonshowdown.com tab
├── MAIN world:      src/inject/inject-bridge.js   (copied to dist/)
│     • exposes room.request JSON + foe view from the client's own objects
│     • autoplay sends "/choose ..." via the room's own sendDirect()
├── ISOLATED world:  dist/content-main.js          (esbuild bundle)
│     • vendor/ps-autobattler/src/decision-core.js  ← submodule brain
│     • src/data/minidex.js + minidex.json          ← compact game data
│     • silent decision loop; answers chrome.runtime messages
└── toolbar popup:   popup/popup.html + dist/popup.js
      • shown only when you click the extension icon
      • queries the active tab for ranked suggestions & autoplay toggle
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
3. Open any battle on play.pokemonshowdown.com, then click the extension
   icon to see ranked suggestions

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
