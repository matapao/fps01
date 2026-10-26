# Contributing

Use Node.js 24 or newer and install the locked dependencies with `npm ci --ignore-scripts`.
Run `npm start` for a local LAN game and `npm run check` before submitting a change.
The check covers formatting, strict type checks, architecture, tests and a temporary production build.
`npm run audit` checks dependency advisories separately and requires access to the npm registry.

Read [AGENTS.md](AGENTS.md), [development guidance](docs/DEVELOPMENT.md) and the
[shared engineering standard](docs/engineering/STANDARD.md) before changing code.
Keep changes focused, include a regression test for a bug, and describe what you verified.
Rules and maps belong in the existing `data/` JSON blocks and their schemas.

The LAN server and production build work from this repository alone. A Zirbel host supplies
`/zirbel-net.js` when running the optional Zirbel build; the game does not require a sibling checkout.
`package.json` intentionally keeps `private: true` to prevent accidental npm publication.

Keep credentials, local environment files and personal data out of contributions. Preserve asset
creators, source links and licences in [the asset catalog](assets/assets.json). New assets need clear
redistribution rights; the MIT code licence does not replace a third-party asset's licence.
Use [the security guidance](SECURITY.md) for vulnerabilities.
