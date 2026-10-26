# Working on fps01

- Read [the shared engineering standard](docs/engineering/STANDARD.md) and [adoption exceptions](docs/engineering/ADOPTION.md) before coding; use its language, library, testing and architecture choices.

- Read [README.md](README.md) and [development guidance](docs/DEVELOPMENT.md), then the module and tests for the behavior you are changing.
- Preserve unrelated edits. Prefer a small change in the owning subsystem over adding branches to the browser or game coordinator.
- Keep shared rules and game subsystems browser-safe: the same authority runs headless and in a player page. Keep Node I/O in the LAN adapters or tools.
- Tune behavior through existing JSON blocks and update their schemas and semantic checks when the contract changes. Avoid a second hard-coded copy of a rule.
- The active data/map context is global. Call `game.enter()` at external entries and after asynchronous boundaries before using it; do not suspend mid-context.
- Treat network, saved and revision data as untrusted. Validate at the boundary; preserve size, rate, queue and player limits in both transports.
- Give asynchronous work, timers, listeners and connections explicit shutdown paths. A stopped owner must stay stopped.
- Add a behavior regression test for a bug. Reuse fixtures and public interfaces; do not test source spelling or mirror implementation details.
- Run `npm run check` before handing work back. Fix failures rather than skipping tests, weakening types or changing expectations to match a bug.
- Keep README.md at most 50 lines; put detailed controls and architecture in `docs/`. Preserve asset/music attribution and licences.
- Do not deploy, publish, change releases or add dependencies unless the task calls for it. Report what changed, what passed and any material limits honestly.
