# Public source snapshot

Prepared on 2026-10-26 from the current fps01 working tree. The new repository begins with one
source snapshot; earlier private Git history is intentionally excluded. Uncommitted application,
test and documentation work is retained in the snapshot.

The source copy includes Git-visible files only and applies ignore rules even to previously tracked
files. Dependencies, generated builds, local environment files, private keys and old Git metadata
are excluded. Installation uses the committed npm lockfile and public npm packages; no sibling
checkout is needed for the LAN game, checks or production build.

Use Node.js 24+, `npm ci --ignore-scripts` and `npm run check`. `npm run audit` checks current
npm advisories separately. Security reporting and LAN-host limitations are described in
[SECURITY.md](../SECURITY.md). Original MIT code and all third-party provenance remain with
[the asset catalog](../assets/assets.json), [sound credits](../public/audio.html) and LICENSE.

Repository preparation does not deploy a game or publish an npm package. `private: true` continues
to prevent accidental npm publication. GitHub visibility and the initial push are separate operations.
