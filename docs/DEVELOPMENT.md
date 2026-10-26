# Development

Use Node.js 24+, `npm ci`, then `npm run check`. CI runs the same command. `npm audit` checks known dependency advisories separately and needs network access.

All maintained application and tool JavaScript is checked, alongside TypeScript, with the shared strict compiler baseline. Browser, Node and portable profiles use their own platform types; `check:javascript` verifies complete owned-source membership, with no legacy exclusion ledger.
Portable coverage includes every shared rule and contract with ES2022 and no ambient platform types.
Text encoding and host-message decoding stay in the browser and Node transport profiles.

## Module boundaries

| Area                                                                                                 | Owns                                                                   | Allowed dependencies                                |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------- |
| `data/`                                                                                              | Tuning and declarative content, with schemas                           | Other data IDs checked by `shared/check.js`         |
| `shared/`                                                                                            | Data validation, geometry, movement, grappling, reach and wire formats | Other shared modules and JSON data; browser-safe    |
| `server/game.js`                                                                                     | Game state and subsystem coordination                                  | Shared modules and game subsystems                  |
| `server/arsenal.js`, other subsystems                                                                | Combat, physics, items, rounds and world changes                       | Shared rules and the owning game                    |
| `server/index.js`, `connections.js`, `lobbies.js`, `static.js`, `release.js`, `updates.js`, `run.js` | LAN I/O, releases and lifecycle                                        | Node APIs, ws and game modules                      |
| `zirbel/`                                                                                            | Host/seat transport adapter                                            | Shared rules, browser-safe game modules, zirbel-net |
| `public/js/`                                                                                         | Rendering, local movement/input, HUD, audio and transport              | Shared modules, three.js and browser modules        |
| `src/agent/`                                                                                         | Agent play, look and data-check interfaces                             | Shared modules and platform contracts               |
| `tools/`                                                                                             | Build, validation and development utilities                            | Node APIs and tool dependencies                     |

The bundled authority also runs in a browser. Never import Node I/O into shared rules or game subsystems. A bundle test checks that boundary. Keep new behavior in its owning subsystem; `main.js` and `game.js` coordinate them.

## State and authority

Browsers predict their own movement; the authority checks combat, ammo, cooldowns, hook visibility and terrain changes. Client positions are bounded, but this is not a server-authoritative movement or anti-cheat system. Do not present it as one.

`shared/data.js` and `shared/map.js` expose the active context. Every external game entry calls `game.enter()` before reading it. Do not `await` between selecting a game's context and using it; asynchronous continuations must re-enter. Data changes belong in JSON plus its schema and semantic checks, and activate at a round boundary.

`shared/messages.js` owns input sizes/rates and player limits for both transports. LAN origin checks, heartbeats and frame errors belong in `server/connections.js`. Outgoing LAN queues are bounded in `server/util.js`. Limits protect an instance; they do not provide public-host admission or authentication.

Each timer, listener, connection and asynchronous load needs an owner and a shutdown path. Never let a completed load revive a stopped authority or a departed seat. A new host starts with a full wire keyframe; malformed wire data must reconnect.

## Change workflow

1. Read the owning module and its tests; preserve unrelated working-tree changes.
2. Reproduce a bug with a behavior test at the nearest boundary, then fix it there.
3. Keep LAN and zirbel behavior aligned, and schema/data/fixtures aligned when contracts change.
4. Run `npm run check`; inspect any visible change in a browser. Do not weaken checks to pass.
5. Describe changed behavior, validation and remaining limits. Keep credentials and private files out of browser mounts and generated bundles.

Tests use a small, stable data fixture where deterministic geometry matters. Tests for shipped data validate `BUNDLED`; never replace the fixture wholesale to hide a regression.

`node tools/play.js --url ws://127.0.0.1:7777/mp --room TEST --net <zirbel>/packages/net/src/index.ts --agents 2` exercises a hub room with scripted agents.

Credits live in `assets/assets.json`; recorded sound provenance is also in `public/audio/sources.json`. Preserve third-party licences when updating or bundling assets.

## Anonymous game metrics

The game authority emits eliminations, flag captures, completed round counts and durations.
Completed rounds submit the highest elimination score and total flag captures as numeric records.
No name, seat, token or winner identifier enters this port. Zirbel binds it to `net.metric`;
LAN embedders may inject `startServer({ reportMetric: (room, name, value) => ... })`.
The sink owns local storage and any explicit publication. A browser-hosted authority is still
a browser host; these reports are not a server anti-cheat guarantee.
