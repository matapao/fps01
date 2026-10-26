# Asset and license inventory

Reviewed 2026-10-26 against the prepared public source snapshot. This records existing licenses;
it does not relicense third-party work or establish authorship independently of the source records.

## Source and shipped media

The source includes one PNG: the reused Zirbel cartridge described below. All other source
files decode as UTF-8 text. There are no binary model files, fonts, recordings, archives, vendored
packages or vendored third-party source trees. Installed `node_modules/` and generated `dist/`
are ignored and excluded from the source snapshot.

| Category                      | Included source assets                     | License/provenance                                             |
| ----------------------------- | ------------------------------------------ | -------------------------------------------------------------- |
| Models                        | 38 catalog entries, constructed at runtime | Catalog declares Langame, MIT, procedural, zero external bytes |
| Textures                      | 4 catalog entries, constructed at runtime  | Catalog declares Langame, MIT, procedural, zero external bytes |
| Sounds                        | 40 catalog entries, synthesized at runtime | Catalog declares Langame, MIT, procedural, zero external bytes |
| Binary/media/archive files    | One README cartridge PNG                   | Zirbel layout MIT; original FPS01 gameplay artwork MIT         |
| Fonts                         | None                                       | Browser/system font families; no font files included           |
| Historical recording metadata | 8 removed-recording records                | Informational source/title/creator/license/hash records only   |

All 82 catalog entries have `procedural: true` and `bytes: 0`. Their owning implementations are
listed below. Original repository code and documentation are offered under [LICENSE](../LICENSE),
which identifies Matapao and preserves third-party license scope. The catalog attributes the
procedural assets to Langame under MIT. Those declarations are preserved, rather than used to
assign MIT to unrelated imported work.

`public/audio/sources.json` retains eight withdrawal records marked `status: removed`, referring to
six previously imported Pixabay source recordings and eight derived WAV files. Those MP3/WAV bytes
are absent. The records retain the original Pixabay license names and URLs as provenance; they are
not an MIT grant for those removed recordings. `public/js/audio.js` synthesizes effects with Web
Audio noise and oscillators. The maintained browser-audio regression verifies that unlocking and
playing effects makes no requests for recordings.

## Complete procedural asset catalog

The source of record is [assets/assets.json](../assets/assets.json). All entries below declare
Langame as creator, `procedural: true` and `bytes: 0`.

| Asset ID                   | Kind    | Owning source          | Declared license |
| -------------------------- | ------- | ---------------------- | ---------------- |
| `characters/box-body`      | model   | `public/js/body.js`    | MIT              |
| `characters/crown`         | model   | `public/js/avatars.js` | MIT              |
| `characters/shells`        | model   | `public/js/avatars.js` | MIT              |
| `weapons/rifle`            | model   | `public/js/guns.js`    | MIT              |
| `weapons/shotgun`          | model   | `public/js/guns.js`    | MIT              |
| `weapons/launcher`         | model   | `public/js/guns.js`    | MIT              |
| `weapons/rocket`           | model   | `public/js/guns.js`    | MIT              |
| `weapons/spark`            | model   | `public/js/guns.js`    | MIT              |
| `weapons/rail`             | model   | `public/js/guns.js`    | MIT              |
| `weapons/special`          | model   | `public/js/guns.js`    | MIT              |
| `weapons/juggling`         | model   | `public/js/tricks.js`  | MIT              |
| `pickups/health`           | model   | `public/js/pickups.js` | MIT              |
| `pickups/orb`              | model   | `public/js/pickups.js` | MIT              |
| `pickups/armor`            | model   | `public/js/pickups.js` | MIT              |
| `pickups/weapon`           | model   | `public/js/pickups.js` | MIT              |
| `props/jump-pad`           | model   | `public/js/effects.js` | MIT              |
| `props/pedestal`           | model   | `public/js/loot.js`    | MIT              |
| `props/flag`               | model   | `public/js/effects.js` | MIT              |
| `loot/powerup`             | model   | `public/js/loot.js`    | MIT              |
| `loot/crate-health`        | model   | `public/js/loot.js`    | MIT              |
| `loot/crate-special`       | model   | `public/js/loot.js`    | MIT              |
| `loot/woolly`              | model   | `public/js/loot.js`    | MIT              |
| `projectiles/grenade`      | model   | `public/js/effects.js` | MIT              |
| `projectiles/bouncer`      | model   | `public/js/effects.js` | MIT              |
| `projectiles/rocket`       | model   | `public/js/effects.js` | MIT              |
| `projectiles/mortar`       | model   | `public/js/effects.js` | MIT              |
| `projectiles/bomblet`      | model   | `public/js/effects.js` | MIT              |
| `projectiles/splitter`     | model   | `public/js/effects.js` | MIT              |
| `projectiles/splitter-bit` | model   | `public/js/effects.js` | MIT              |
| `projectiles/choir`        | model   | `public/js/effects.js` | MIT              |
| `projectiles/missile`      | model   | `public/js/effects.js` | MIT              |
| `projectiles/pilot`        | model   | `public/js/effects.js` | MIT              |
| `projectiles/ball`         | model   | `public/js/effects.js` | MIT              |
| `sky/planet-ringed`        | model   | `public/js/world.js`   | MIT              |
| `sky/planet-rocky`         | model   | `public/js/world.js`   | MIT              |
| `sky/planet-icy`           | model   | `public/js/world.js`   | MIT              |
| `sky/planet-moon`          | model   | `public/js/world.js`   | MIT              |
| `sky/planet-violet`        | model   | `public/js/world.js`   | MIT              |
| `sky/nebula`               | texture | `public/js/world.js`   | MIT              |
| `sky/stars`                | texture | `public/js/world.js`   | MIT              |
| `textures/puff`            | texture | `public/js/effects.js` | MIT              |
| `textures/tiles`           | texture | `public/js/world.js`   | MIT              |
| `sounds/shot`              | sound   | `public/js/audio.js`   | MIT              |
| `sounds/shotgun`           | sound   | `public/js/audio.js`   | MIT              |
| `sounds/launch`            | sound   | `public/js/audio.js`   | MIT              |
| `sounds/rocket`            | sound   | `public/js/audio.js`   | MIT              |
| `sounds/zap`               | sound   | `public/js/audio.js`   | MIT              |
| `sounds/overload`          | sound   | `public/js/audio.js`   | MIT              |
| `sounds/rail`              | sound   | `public/js/audio.js`   | MIT              |
| `sounds/boom`              | sound   | `public/js/audio.js`   | MIT              |
| `sounds/empty`             | sound   | `public/js/audio.js`   | MIT              |
| `sounds/clink`             | sound   | `public/js/audio.js`   | MIT              |
| `sounds/click`             | sound   | `public/js/audio.js`   | MIT              |
| `sounds/step`              | sound   | `public/js/audio.js`   | MIT              |
| `sounds/pad`               | sound   | `public/js/audio.js`   | MIT              |
| `sounds/dodge`             | sound   | `public/js/audio.js`   | MIT              |
| `sounds/kick`              | sound   | `public/js/audio.js`   | MIT              |
| `sounds/pickup-weapon`     | sound   | `public/js/audio.js`   | MIT              |
| `sounds/pickup-armor`      | sound   | `public/js/audio.js`   | MIT              |
| `sounds/pickup-orb`        | sound   | `public/js/audio.js`   | MIT              |
| `sounds/pickup-health`     | sound   | `public/js/audio.js`   | MIT              |
| `sounds/medal`             | sound   | `public/js/audio.js`   | MIT              |
| `sounds/strike`            | sound   | `public/js/audio.js`   | MIT              |
| `sounds/powerup`           | sound   | `public/js/audio.js`   | MIT              |
| `sounds/crate`             | sound   | `public/js/audio.js`   | MIT              |
| `sounds/baa`               | sound   | `public/js/audio.js`   | MIT              |
| `sounds/teleport`          | sound   | `public/js/audio.js`   | MIT              |
| `sounds/chew`              | sound   | `public/js/audio.js`   | MIT              |
| `sounds/creak`             | sound   | `public/js/audio.js`   | MIT              |
| `sounds/crash`             | sound   | `public/js/audio.js`   | MIT              |
| `sounds/pour`              | sound   | `public/js/audio.js`   | MIT              |
| `sounds/splash`            | sound   | `public/js/audio.js`   | MIT              |
| `sounds/planet`            | sound   | `public/js/audio.js`   | MIT              |
| `sounds/toss`              | sound   | `public/js/audio.js`   | MIT              |
| `sounds/thrown`            | sound   | `public/js/audio.js`   | MIT              |
| `sounds/charge`            | sound   | `public/js/audio.js`   | MIT              |
| `sounds/hit`               | sound   | `public/js/audio.js`   | MIT              |
| `sounds/hurt`              | sound   | `public/js/audio.js`   | MIT              |
| `sounds/hook`              | sound   | `public/js/audio.js`   | MIT              |
| `sounds/flourish`          | sound   | `public/js/audio.js`   | MIT              |
| `sounds/choir`             | sound   | `public/js/audio.js`   | MIT              |
| `sounds/rumble`            | sound   | `public/js/audio.js`   | MIT              |

## External package licenses

No package code is vendored into this public source snapshot. npm installs dependencies from the
committed lockfile. Their own licenses apply after installation; root MIT does not replace them.
The runtime dependencies are MIT. The development compiler is Apache-2.0, so the complete installed
toolchain is not MIT-only. All 61 lockfile dependency records declare MIT (39) or Apache-2.0 (22),
including optional platform/compiler packages.

| Direct package | Pinned version | Declared package license | Role        |
| -------------- | -------------- | ------------------------ | ----------- |
| `three`        | `0.186.1`      | MIT                      | runtime     |
| `ws`           | `8.22.0`       | MIT                      | runtime     |
| `@types/node`  | `24.19.2`      | MIT                      | development |
| `@types/three` | `0.186.0`      | MIT                      | development |
| `@types/ws`    | `8.18.2`       | MIT                      | development |
| `esbuild`      | `0.28.2`       | MIT                      | development |
| `prettier`     | `3.9.10`       | MIT                      | development |
| `typescript`   | `7.0.2`        | Apache-2.0               | development |

The production browser build bundles three.js. `tools/build.js` retains linked legal comments and
copies its upstream MIT text into `vendor/three/LICENSE` in the generated game. The LAN server uses
installed three.js and ws. Their packages keep their upstream notices. No Pixabay, itch.io, KayKit,
OFL font files or external gameplay media bytes are present in this repository's source.
The separate README cartridge PNG reuses the Zirbel layout as documented below.

## Evidence and limits

The copy excludes old Git history. File-by-file SHA-256/mode inventories and the source secret scan
are retained as local preparation evidence outside the candidate. Source classification, the
catalog assertions above, existing sound regression, and the complete quality gate were checked.
License names in a manifest document the upstream grant; this inventory does not assert a separate
license for the user's entire installed operating system, browser or development toolchain.

## README logo

`docs/cartridge.png` reuses the actual cartridge from [Zirbel](https://zirbel.app/), exported
from its existing front-face markup, styles and painted key art. The cartridge and README carry
no status label. The README displays the cartridge at 112 pixels wide.
The cartridge layout is from Zirbel’s `packages/web/lib/cover.ts` and site styles; retain
[its MIT notice](ZIRBEL_CARTRIDGE_LICENSE.txt). The image includes rendered lettering, not font
software; the SIL OFL does not require documents or artwork produced with a font to use OFL.
The pictured FPS01 gameplay uses the original procedural MIT artwork.
