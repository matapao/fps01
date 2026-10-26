# Adoption and remaining differences

Updated 2026-10-24 against the four working trees, preserving their existing uncommitted work.
The repeated td01 name refers to craftdef. The documented legacy typing migrations are complete; the build-tool difference below is intentional. Generated output, vendor code, dependencies and archived scenarios are outside the
owned-source migration. Product and architecture contracts continue to apply.

## Active common baseline

All four projects now use Node >=24, native erasable TypeScript, npm with a version-3 lockfile,
Prettier 3.9.10 at 110 columns, the shared editor settings and exact versions for matching library roles.
`check:standards` verifies active settings, manifest/lock declarations and resolved strict-profile flags;
`format:check` checks maintained owned files without writing. Both run in the complete local/CI gate.
The canonical files live in Zirbel's `docs/engineering/`; synchronization checks all four mirrors.

| Project       | Build   | Type environments and maintained tests                                                                           |
| ------------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| zirbel        | esbuild | Shared strict base; per-package portable/browser/Node configs; `node:test` and Go `testing`                      |
| fps01         | esbuild | Full baseline in TS and every maintained application/tool JS module; browser/Node/portable profiles; `node:test` |
| td01/craftdef | Vite    | Separate portable/browser/Node/tooling configs; native Node tests; archived scenarios stay excluded              |
| derby01       | esbuild | Full baseline in browser, Node tooling and boundary profiles; platform-free gameplay; `node:test`                |

Matching roles use TypeScript 7.0.2, esbuild 0.28.2, @types/node 24.19.2, three 0.186.1,
@types/three 0.186.0, ws 8.22.0, @types/ws 8.18.2 and puppeteer-core 25.14.0.
A repository does not gain an unnecessary dependency merely to fill a version table.

## Completed adoption work

- **FMT-01:** Shared formatter and editor settings are active in all four gates. Existing dirty source
  was backed up before formatting; no reset, clean, commit or push forms part of adoption.
- **PKG-01 / RUN-01:** Derby uses npm and one lockfile; CI uses npm. td01 runs native TypeScript
  without tsx, explicit internal imports and Node 24 type declarations. CI exercises the common baseline.
- **DEP-01, declarations:** Matching dependencies are pinned and guarded, including Derby's paired
  three/types upgrade. Rendering acceptance remains part of its live browser verification below.
- **E2E-01, implementation:** Zirbel's compatibility export, Derby's live harness and td01's browser
  and screenshot helpers use the packaged Puppeteer adapter. No consumer imports sibling CDP source.
  The package rebuilds when packed; both game artifacts must remain identical. The local-hub fixture
  still requires a Zirbel installation and resolves its public hub export, a distinct test prerequisite.
- **TS-01:** FPS's legacy JavaScript ledger is exhausted. Every maintained application/tool JS module
  enters the real compiler gate, enforced by automatic coverage discovery. Root TS, browser JS,
  Node JS and portable profiles apply the complete shared baseline. Shared data, player, snapshot,
  action and event contracts replace unchecked imports; actual validation narrows external input.
  Browser and agent consumers reuse one checked host-message decoder. Runtime helpers remain JS
  so the LAN server still serves browser modules without a build step.
- **TS-02:** Derby's browser and Node tooling now inherit every shared supplemental flag.
  Fixed geometry tuples, explicit required entries and optional-state cleanup replace unsafe reads.
  Portable gameplay and the boundary profile retain their complete baseline. The runtime graph
  stays acyclic, and module budgets and acceptance assertions are unchanged.
- **TS-03:** td01's entire maintained browser/server/tooling TS graph enforces checked indexing
  and the remaining shared flags. Core/game compile in portable ES2022 without ambient platform
  types; host serialization remains checked by its real browser/Node environments. Focused modules
  preserve size budgets, deterministic rules, saved state, snapshots and incremental updates.
- **Zirbel coverage:** Maintained compiler discovery includes nested package build profiles as well
  as source/tests/browser adapters. Missing extension, engineering and deployment build scripts now
  have strict Node profiles. Compiler-discovery regression tests prevent silent build-script gaps.
- **TEST-01:** Maintained headless suites and the explicit LAN integration suite use named
  `node:test` cases, retaining authority, malformed input, incremental update and recovery assertions.

## Intentional build difference

The TS-01, TS-02 and TS-03 typing exceptions are retired. There is no unchecked application-JS
ledger to grow. Compiler-profile membership and maintained-source coverage must not shrink.
A config counts only when it runs in the real gate; child overrides must not weaken the baseline.

| ID / scope          | Current boundary and reason                                          | Follow-up                                                                                                                           |
| ------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| BUILD-01: td01 Vite | Vite owns the existing development server, assets and browser build. | Retain while useful; replace only for a concrete need with equivalent tested behavior. Uniformity alone does not justify a rewrite. |

No exception permits a competing library or implementation. Record a concrete reason, owner,
verification and removal condition before adding an exception.

## Implementation owners

| Concern                                                           | Reuse / boundary                                                              |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Portable platform validation, revisions, permissions and sessions | Public `@zirbel/core` exports                                                 |
| Host/seat/session transport                                       | Public `@zirbel/net` or the existing reproducibly built SDK                   |
| Browser process/control/cleanup                                   | `@zirbel/engineering/browser`; Puppeteer owns transport                       |
| fps01 portable game authority                                     | `shared/`; Node I/O in LAN adapters                                           |
| td01 algorithms, commands, simulation and saves                   | `src/core`, `src/game`; adapters in `server`, `src/net`, `src/view`, `src/ui` |
| Derby independent rules                                           | `src/gameplay`; explicit state/events, platform-free compiler profile         |

Similar-looking game RNG, movement, geometry or damage is not proof of identical semantics. Share a
public implementation only after comparing contracts and testing equivalent inputs and results.

## Required verification

- Zirbel: `npm run verify`; after dependency changes, `npm run audit`. QUIC changes additionally need
  `go test -race ./...` in `packages/quic`.
- FPS: `npm run verify` (the complete `check` gate); affected real browser/hub scenarios for visible or
  multiplayer behavior, and its dependency audit after dependency changes.
- td01: `npm run verify` (complete check plus LAN); `npm run test:browser` for UI/rendering/first-loop
  changes, and `npm run test:lan:browser` for the affected production LAN browser path.
- Derby: `npm run verify` (all compiler profiles, tests and both builds); affected device/visual flows
  and `test/live` local-hub scenarios. Audit runtime dependencies after dependency changes.

Verification results belong in the handoff for the actual working-tree snapshot. Earlier passing gates
are not proof that later concurrent edits pass. A timed-out browser startup or scenario is incomplete
acceptance; do not weaken assertions or label renderer/E2E runtime acceptance complete until it passes.

## Other languages and assets

Go is currently Zirbel's QUIC adapter: gofmt, standard `testing`, explicit errors, contexts/timeouts,
owned cleanup and go.mod/go.sum. Future Go modules reuse these conventions. HTML/CSS use UTF-8,
two-space formatting, accessible semantic controls, safe untrusted text and existing style tokens.
Shell remains small process glue with quoted expansions and explicit failure handling. No owned
Python/Rust application was found; generated/dependency code does not create a separate language policy.
